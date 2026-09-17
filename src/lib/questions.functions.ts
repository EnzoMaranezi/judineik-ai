import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  practiceQuestionSetSchema,
  questionSetSchema,
  sessionAnswerSchema,
  type SessionAnswer,
  type StudyQuestion,
} from "@/lib/questions.schema";
import {
  generateAiText,
  getAiLocaleContext,
  normalizeAiError,
} from "@/lib/ai-gateway.server";
import {
  finishAiGeneration,
  isAiGenerationInProgressError,
  isAiDailyLimitError,
  reserveAiGeneration,
} from "@/lib/ai-usage-limit.server";
import { runReservedAiGeneration } from "@/lib/ai-generation-action";
import type { Database, Json } from "@/integrations/supabase/types";
import {
  isLocale,
  languageInstruction,
  type Locale,
  type PersistedContentLocale,
} from "@/lib/i18n";
import {
  parseTopicSummarySourceRanges,
  reconstructVerifiedTopicSource,
} from "@/lib/topic-summary-source";
import {
  MARKDOWN_QUESTION_FORMAT,
  PRACTICE_QUESTION_SYSTEM_PROMPT,
  QUESTION_SYSTEM_PROMPT,
} from "@/lib/questions.prompt";
import { parseMarkdownQuestions } from "@/lib/questions.parser";
import { assertDistinctGeneratedQuestions } from "@/lib/questions.validation";
import { evaluateTopicSourceEligibility } from "@/lib/topic-source-eligibility";

const MAX_INPUT_CHARS = 60_000;
const MIN_QUESTION_SOURCE_CHARS = 200;
const QUESTION_GENERATION_MAX_OUTPUT_TOKENS = 2_000;
export const TOPIC_QUESTION_SOURCE_INSUFFICIENT = "TOPIC_QUESTION_SOURCE_INSUFFICIENT";

async function assertQuestionSetBelongsToDocument(
  supabase: SupabaseClient<Database>,
  questionSetId: string,
  documentId: string,
  userId: string,
) {
  const { data: questionSet, error } = await supabase
    .from("question_sets")
    .select("id, user_id, document_id")
    .eq("id", questionSetId)
    .maybeSingle();

  if (
    error ||
    !questionSet ||
    questionSet.user_id !== userId ||
    questionSet.document_id !== documentId
  ) {
    throw new Error("Question set does not belong to this material.");
  }
}

type QuestionVariant = {
  id: string;
  locale: PersistedContentLocale;
  createdAt: string;
  questions: StudyQuestion[];
};

type QuestionDocument = {
  id: string;
  title: string;
  user_id: string;
  extracted_text: string | null;
};

async function loadOwnedQuestionDocument(
  supabase: SupabaseClient<Database>,
  userId: string,
  documentId: string,
) {
  const { data, error } = await supabase
    .from("documents")
    .select("id, title, user_id, extracted_text")
    .eq("id", documentId)
    .maybeSingle();
  if (error || !data || data.user_id !== userId) throw new Error("Document not found.");
  return data satisfies QuestionDocument;
}

async function loadTopicQuestionContext(
  supabase: SupabaseClient<Database>,
  userId: string,
  document: QuestionDocument,
  topicId: string,
) {
  const { data: topic, error } = await supabase
    .from("document_topics")
    .select("id, user_id, document_id, title, source_ranges, source_hash")
    .eq("id", topicId)
    .maybeSingle();
  if (
    error ||
    !topic ||
    topic.user_id !== userId ||
    topic.document_id !== document.id
  ) {
    throw new Error("TOPIC_NOT_FOUND");
  }

  const sourceText = await reconstructVerifiedTopicSource({
    source: document.extracted_text,
    sourceRanges: parseTopicSummarySourceRanges(topic.source_ranges),
    sourceHash: topic.source_hash,
  });
  if (!evaluateTopicSourceEligibility(sourceText).questions) {
    throw new Error(TOPIC_QUESTION_SOURCE_INSUFFICIENT);
  }
  return { id: topic.id, title: topic.title, sourceText };
}

function mapQuestionVariant(row: {
  id: string;
  locale: string;
  created_at: string;
  questions: Json;
}): QuestionVariant {
  return {
    id: row.id,
    locale: row.locale as PersistedContentLocale,
    createdAt: row.created_at,
    questions: row.questions as unknown as StudyQuestion[],
  };
}

async function loadCurrentStandardSet(
  supabase: SupabaseClient<Database>,
  documentId: string,
  locale: Locale,
  topicId: string | null = null,
) {
  const query = supabase
    .from("question_sets")
    .select("id, locale, questions, created_at")
    .eq("document_id", documentId)
    .eq("locale", locale)
    .eq("kind", "standard")
    .is("superseded_at", null);
  const { data, error } = await (topicId
    ? query.eq("topic_scope_id", topicId)
    : query.is("topic_scope_id", null)
  ).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapQuestionVariant(data) : null;
}

async function waitForQuestionSet(
  supabase: SupabaseClient<Database>,
  documentId: string,
  locale: Locale,
  previousSetId: string | null,
  topicId: string | null = null,
) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const set = await loadCurrentStandardSet(supabase, documentId, locale, topicId);
    if (set && set.id !== previousSetId) return set;
  }
  return null;
}

export const getDocumentQuestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ documentId: z.string().uuid(), topicId: z.string().uuid().optional() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    const { locale } = getAiLocaleContext(claims);
    const topicId = data.topicId ?? null;
    if (topicId) {
      const document = await loadOwnedQuestionDocument(supabase, userId, data.documentId);
      await loadTopicQuestionContext(supabase, userId, document, topicId);
    }
    const query = supabase
      .from("question_sets")
      .select("id, locale, kind, superseded_at, questions, created_at")
      .eq("document_id", data.documentId)
      .order("created_at", { ascending: false });
    const { data: rows, error } = await (topicId
      ? query.eq("topic_scope_id", topicId)
      : query.is("topic_scope_id", null));
    if (error) throw new Error(error.message);
    const visibleRows = (rows ?? []).filter(
      (row) => row.kind === "legacy" || (row.kind === "standard" && !row.superseded_at),
    );
    const variants: QuestionVariant[] = [];
    const seenLocales = new Set<string>();
    for (const row of visibleRows) {
      if (seenLocales.has(row.locale)) continue;
      seenLocales.add(row.locale);
      variants.push(mapQuestionVariant(row));
    }
    return {
      requestedLocale: locale,
      current: variants.find((variant) => variant.locale === locale) ?? null,
      alternatives: variants.filter((variant) => variant.locale !== locale),
    };
  });

export const generateDocumentQuestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({
      documentId: z.string().uuid(),
      topicId: z.string().uuid().optional(),
      regenerate: z.boolean().optional(),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    const localeContext = getAiLocaleContext(claims);

    const doc = await loadOwnedQuestionDocument(supabase, userId, data.documentId);
    const topicId = data.topicId ?? null;
    const topic = topicId
      ? await loadTopicQuestionContext(supabase, userId, doc, topicId)
      : null;
    if (!topic && (!doc.extracted_text || doc.extracted_text.trim().length < MIN_QUESTION_SOURCE_CHARS)) {
      throw new Error(
        "This document has no readable extracted text yet. Process the PDF before generating questions.",
      );
    }
    const questionSource = topic?.sourceText ?? doc.extracted_text!;

    const existing = await loadCurrentStandardSet(supabase, doc.id, localeContext.locale, topicId);
    if (!data.regenerate) {
      if (existing) {
        return {
          reused: true as const,
          ...existing,
        };
      }
    }

    try {
      const saved = await runReservedAiGeneration({
        reserve: () =>
          reserveAiGeneration(supabase, "questions", doc.id, localeContext.locale, userId, topicId),
        generate: () =>
          generateAiText({
            system: QUESTION_SYSTEM_PROMPT,
            prompt: topic
              ? `Document title: ${doc.title}\nTopic title: ${topic.title}\n\nTOPIC-FOCUSED MODE:\nWrite questions ONLY about the selected topic excerpt. Do not use other document sections or outside context.\n\nTOPIC EXCERPT (the only allowed source):\n"""\n${questionSource.slice(0, MAX_INPUT_CHARS)}\n"""\n\nCreate exactly 5 distinct multiple-choice questions. Each question must have 4 options, exactly one correct answer, and a concise source-grounded explanation.`
              : `Document title: ${doc.title}\n\nMATERIAL:\n"""\n${questionSource.slice(0, MAX_INPUT_CHARS)}\n"""\n\nCreate exactly 5 distinct multiple-choice questions. Each question must have 4 options, exactly one correct answer, and a concise source-grounded explanation.`,
            outputFormat: MARKDOWN_QUESTION_FORMAT,
            languageInstruction: localeContext.languageInstruction,
            languageInstructionPlacement: "prompt-only",
            languageInstructionFormat: "instruction-only",
            maxOutputTokens: QUESTION_GENERATION_MAX_OUTPUT_TOKENS,
            reasoningEffort: "low" as const,
          }),
        afterGenerate: async (result) => {
          const parsed = parseMarkdownQuestions(result.text);
          const questions = assertDistinctGeneratedQuestions(
            questionSetSchema.parse(parsed).questions,
          );
          const { data: setId, error: saveError } = await supabase.rpc(
            "create_question_set_version",
            {
              p_document_id: doc.id,
              p_locale: localeContext.locale,
              p_kind: "standard",
              p_model: result.model,
              p_questions: questions as unknown as Json,
              p_source_question_set_id: null,
              p_topic_id: topicId,
            },
          );
          if (saveError || !setId) {
            throw new Error(saveError?.message ?? "The questions were generated but couldn't be saved.");
          }
          const persisted = await loadCurrentStandardSet(
            supabase,
            doc.id,
            localeContext.locale,
            topicId,
          );
          if (!persisted) throw new Error("The questions were generated but couldn't be loaded.");
          return persisted;
        },
        finish: (reservation, status) => finishAiGeneration(supabase, userId, reservation, status),
      });
      return { reused: false as const, ...saved };
    } catch (error) {
      if (isAiDailyLimitError(error)) throw error;
      if (isAiGenerationInProgressError(error)) {
        const saved = await waitForQuestionSet(
          supabase,
          doc.id,
          localeContext.locale,
          existing?.id ?? null,
          topicId,
        );
        if (saved) return { reused: true as const, ...saved };
        throw new Error("Question generation is already in progress. Please try again shortly.");
      }
      throw normalizeAiError(error, "The AI couldn't generate questions for this material.");
    }
  });

/** Persists a finished question session for the authenticated owner. */
export const saveQuestionSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        sessionId: z.string().uuid().optional(),
        documentId: z.string().uuid(),
        questionSetId: z.string().uuid().optional(),
        totalQuestions: z.number().int().positive(),
        correctAnswers: z.number().int().min(0),
        startedAt: z.string(),
        answers: z.array(sessionAnswerSchema),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: doc } = await supabase
      .from("documents")
      .select("id, user_id")
      .eq("id", data.documentId)
      .maybeSingle();
    if (!doc || doc.user_id !== userId) throw new Error("Document not found.");

    if (data.questionSetId) {
      await assertQuestionSetBelongsToDocument(supabase, data.questionSetId, data.documentId, userId);
    }

    const accuracy =
      data.totalQuestions > 0
        ? Math.round((data.correctAnswers / data.totalQuestions) * 100)
        : 0;

    const payload = {
      user_id: userId,
      document_id: data.documentId,
      question_set_id: data.questionSetId ?? null,
      total_questions: data.totalQuestions,
      correct_answers: data.correctAnswers,
      accuracy,
      answers: data.answers as unknown as Json,
      started_at: data.startedAt,
      completed_at: new Date().toISOString(),
    };

    const query = data.sessionId
      ? supabase
          .from("question_sessions")
          .update(payload)
          .eq("id", data.sessionId)
          .eq("user_id", userId)
          .is("completed_at", null)
      : supabase.from("question_sessions").insert(payload);

    const { data: saved, error } = await query.select("id, accuracy, completed_at").single();

    if (error || !saved) {
      throw new Error(error?.message ?? "The session result couldn't be saved.");
    }

    return { id: saved.id, accuracy, completedAt: saved.completed_at };
  });

export const saveQuestionSessionDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        sessionId: z.string().uuid().optional(),
        documentId: z.string().uuid(),
        questionSetId: z.string().uuid(),
        totalQuestions: z.number().int().positive(),
        correctAnswers: z.number().int().min(0),
        startedAt: z.string(),
        answers: z.array(sessionAnswerSchema),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: doc } = await supabase
      .from("documents")
      .select("id, user_id")
      .eq("id", data.documentId)
      .maybeSingle();
    if (!doc || doc.user_id !== userId) throw new Error("Document not found.");

    await assertQuestionSetBelongsToDocument(supabase, data.questionSetId, data.documentId, userId);

    const accuracy =
      data.totalQuestions > 0
        ? Math.round((data.correctAnswers / data.totalQuestions) * 100)
        : 0;

    const payload = {
      user_id: userId,
      document_id: data.documentId,
      question_set_id: data.questionSetId,
      total_questions: data.totalQuestions,
      correct_answers: data.correctAnswers,
      accuracy,
      answers: data.answers as unknown as Json,
      started_at: data.startedAt,
      completed_at: null,
    };

    const query = data.sessionId
      ? supabase
          .from("question_sessions")
          .update(payload)
          .eq("id", data.sessionId)
          .eq("user_id", userId)
          .is("completed_at", null)
      : supabase.from("question_sessions").insert(payload);

    const { data: saved, error } = await query.select("id, started_at").single();
    if (error || !saved) {
      throw new Error(error?.message ?? "The session progress couldn't be saved.");
    }

    return { id: saved.id, startedAt: saved.started_at };
  });

/** Loads the latest unfinished question session for one material (owner only). */
export const getActiveQuestionSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ documentId: z.string().uuid(), topicId: z.string().uuid().optional() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const topicId = data.topicId ?? null;
    const query = supabase
      .from("question_sessions")
      .select(
        "id, question_set_id, total_questions, correct_answers, accuracy, answers, started_at, question_sets!inner(id, locale, questions, topic_scope_id)",
      )
      .eq("document_id", data.documentId)
      .is("completed_at", null)
      .order("updated_at", { ascending: false })
      .limit(1);
    const { data: row } = await (topicId
      ? query.eq("question_sets.topic_scope_id", topicId)
      : query.is("question_sets.topic_scope_id", null)
    ).maybeSingle();

    if (!row) return null;
    if (!row.question_set_id) return null;
    const set = row.question_sets;
    if (!set) return null;

    return {
      id: row.id,
      questionSetId: set.id,
      locale: set.locale as PersistedContentLocale,
      questions: set.questions as unknown as StudyQuestion[],
      totalQuestions: row.total_questions,
      correctAnswers: row.correct_answers,
      accuracy: Number(row.accuracy),
      startedAt: row.started_at,
      answers: row.answers as unknown as SessionAnswer[],
    };
  });

/** Loads the most recent completed session for one material (owner only). */
export const getLatestQuestionSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ documentId: z.string().uuid(), topicId: z.string().uuid().optional() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const topicId = data.topicId ?? null;
    const query = supabase
      .from("question_sessions")
      .select(
        "id, question_set_id, total_questions, correct_answers, accuracy, answers, completed_at, question_sets!inner(topic_scope_id)",
      )
      .eq("document_id", data.documentId)
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(1);
    const { data: row } = await (topicId
      ? query.eq("question_sets.topic_scope_id", topicId)
      : query.is("question_sets.topic_scope_id", null)
    ).maybeSingle();

    if (!row) return null;
    return {
      id: row.id,
      questionSetId: row.question_set_id,
      totalQuestions: row.total_questions,
      correctAnswers: row.correct_answers,
      accuracy: Number(row.accuracy),
      completedAt: row.completed_at,
      answers: row.answers as unknown as SessionAnswer[],
    };
  });

export const getDocumentReinforcementAreas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ documentId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: sessions } = await supabase
      .from("question_sessions")
      .select("id, question_set_id, answers")
      .eq("document_id", data.documentId)
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false });

    const completedSessions = sessions ?? [];
    const questionSetIds = [
      ...new Set(
        completedSessions
          .map((session) => session.question_set_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    if (completedSessions.length === 0 || questionSetIds.length === 0) {
      return { completedSessions: completedSessions.length, areas: [] };
    }

    const { data: sets } = await supabase
      .from("question_sets")
      .select("id, questions")
      .in("id", questionSetIds)
      .eq("document_id", data.documentId);

    const questionsBySet = new Map(
      (sets ?? []).map((set) => [set.id, set.questions as unknown as StudyQuestion[]]),
    );
    const areas = new Map<
      string,
      { title: string; misses: number; total: number; reasonCode: "incorrectAnswer" }
    >();

    for (const session of completedSessions) {
      const questions = session.question_set_id ? questionsBySet.get(session.question_set_id) : undefined;
      if (!questions) continue;

      for (const answer of session.answers as unknown as SessionAnswer[]) {
        const question = questions[answer.questionIndex];
        if (!question) continue;
        const title = question.topic?.trim() || question.question.trim();
        const key = title.toLowerCase();
        const current = areas.get(key) ?? {
          title,
          misses: 0,
          total: 0,
          reasonCode: "incorrectAnswer",
        };
        current.total += 1;
        if (!answer.correct) current.misses += 1;
        areas.set(key, current);
      }
    }

    return {
      completedSessions: completedSessions.length,
      areas: [...areas.values()]
        .filter((area) => area.misses > 0)
        .sort((a, b) => b.misses - a.misses || b.total - a.total)
        .slice(0, 3),
    };
  });


/**
 * Generates a new question set focused on the concepts the user answered incorrectly.
 * The missed questions are read server-side from the stored set (RLS-scoped), never trusted
 * from the client, and the material's extracted text stays the primary source of truth.
 */
export const generatePracticeQuestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        documentId: z.string().uuid(),
        questionSetId: z.string().uuid(),
        wrongIndexes: z.array(z.number().int().min(0)).min(1).max(5),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const doc = await loadOwnedQuestionDocument(supabase, userId, data.documentId);

    const { data: previousSet } = await supabase
      .from("question_sets")
      .select(
        "id, questions, document_id, user_id, locale, kind, source_question_set_id, topic_id, topic_scope_id",
      )
      .eq("id", data.questionSetId)
      .maybeSingle();
    if (!previousSet || previousSet.user_id !== userId || previousSet.document_id !== doc.id) {
      throw new Error("Previous question set not found.");
    }
    if (!isLocale(previousSet.locale)) {
      throw new Error(
        "The language of this legacy question set was not recorded. Generate a current-language question set before practising mistakes.",
      );
    }
    const sourceQuestionSetId =
      previousSet.kind === "standard"
        ? previousSet.id
        : previousSet.kind === "practice"
          ? previousSet.source_question_set_id
          : null;
    if (!sourceQuestionSetId) {
      throw new Error("The original question set for this practice session could not be found.");
    }
    const { data: sourceSet } = await supabase
      .from("question_sets")
      .select("id, document_id, user_id, locale, kind, topic_id, topic_scope_id")
      .eq("id", sourceQuestionSetId)
      .maybeSingle();
    if (
      !sourceSet ||
      sourceSet.kind !== "standard" ||
      sourceSet.user_id !== userId ||
      sourceSet.document_id !== doc.id ||
      sourceSet.locale !== previousSet.locale
    ) {
      throw new Error("The original question set for this practice session could not be found.");
    }
    const practiceLocale = sourceSet.locale;
    if (!isLocale(practiceLocale)) {
      throw new Error(
        "The language of this legacy question set was not recorded. Generate a current-language question set before practising mistakes.",
      );
    }

    const topicId = sourceSet.topic_scope_id;
    if (topicId && sourceSet.topic_id !== topicId) throw new Error("TOPIC_NOT_FOUND");
    if (!topicId && sourceSet.topic_id) throw new Error("QUESTION_SET_TOPIC_MISMATCH");
    const topic = topicId
      ? await loadTopicQuestionContext(supabase, userId, doc, topicId)
      : null;
    if (!topic && (!doc.extracted_text || doc.extracted_text.trim().length < MIN_QUESTION_SOURCE_CHARS)) {
      throw new Error("This document has no readable extracted text yet.");
    }
    const questionSource = topic?.sourceText ?? doc.extracted_text!;

    const previousQuestions = previousSet.questions as unknown as StudyQuestion[];
    const missed = data.wrongIndexes
      .map((i) => previousQuestions[i])
      .filter((q): q is StudyQuestion => Boolean(q));
    if (missed.length === 0) throw new Error("No incorrect answers to practise.");

    const count = Math.min(missed.length, 5);

    const missedBlock = missed
      .map(
        (q, i) =>
          `${i + 1}. Missed question (DO NOT REUSE): ${q.question}\n   Correct answer: ${q.options[q.correctIndex]}\n   Why: ${q.explanation}${q.topic ? `\n   Topic: ${q.topic}` : ""}`,
      )
      .join("\n");

    const bannedBlock = previousQuestions.map((q) => `- ${q.question}`).join("\n");
    try {
      const saved = await runReservedAiGeneration({
        reserve: () =>
          reserveAiGeneration(supabase, "practice_questions", doc.id, practiceLocale, userId, topicId),
        generate: () =>
          generateAiText({
            system: PRACTICE_QUESTION_SYSTEM_PROMPT,
            prompt: topic
              ? `Document title: ${doc.title}\nTopic title: ${topic.title}\n\nTOPIC-FOCUSED MODE:\nWrite practice questions ONLY from the selected topic excerpt. Do not widen the scope to the rest of the document.\n\nTOPIC EXCERPT (the only allowed source):\n"""\n${questionSource.slice(0, MAX_INPUT_CHARS)}\n"""\n\nMISSED QUESTIONS (content to reinforce, not to copy):\n${missedBlock}\n\nQUESTIONS ALREADY ASKED (must not be repeated or paraphrased):\n${bannedBlock}\n\nProduce exactly ${count} NEW multiple-choice question${count === 1 ? "" : "s"} covering the concepts behind the missed questions, grounded strictly in the topic excerpt.`
              : `Document title: ${doc.title}\n\nMATERIAL (the only allowed source):\n"""\n${questionSource.slice(0, MAX_INPUT_CHARS)}\n"""\n\nMISSED QUESTIONS (content to reinforce, not to copy):\n${missedBlock}\n\nQUESTIONS ALREADY ASKED (must not be repeated or paraphrased):\n${bannedBlock}\n\nProduce exactly ${count} NEW multiple-choice question${count === 1 ? "" : "s"} covering the concepts behind the missed questions, grounded strictly in the material.`,
            outputFormat: MARKDOWN_QUESTION_FORMAT,
            languageInstruction: languageInstruction(practiceLocale),
          }),
        afterGenerate: async (result) => {
          const output = parseMarkdownQuestions(result.text);
          let questions = practiceQuestionSetSchema.parse(output).questions.slice(0, count);
          const normalize = (value: string) =>
            value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
          const banned = new Set(previousQuestions.map((question) => normalize(question.question)));
          const filtered = questions.filter((question) => !banned.has(normalize(question.question)));
          if (filtered.length > 0) questions = filtered;
          questions = assertDistinctGeneratedQuestions(questions);

          const { data: setId, error: saveError } = await supabase.rpc(
            "create_question_set_version",
            {
              p_document_id: doc.id,
              p_locale: practiceLocale,
              p_kind: "practice",
              p_model: result.model,
              p_questions: questions as unknown as Json,
              p_source_question_set_id: sourceQuestionSetId,
              p_topic_id: topicId,
            },
          );
          if (saveError || !setId) {
            throw new Error(saveError?.message ?? "The practice questions couldn't be saved.");
          }
          const { data: savedSet, error: loadError } = await supabase
            .from("question_sets")
            .select("id, created_at")
            .eq("id", setId)
            .single();
          if (loadError || !savedSet) {
            throw new Error(loadError?.message ?? "The practice questions couldn't be loaded.");
          }
          return { id: savedSet.id, createdAt: savedSet.created_at, questions };
        },
        finish: (reservation, status) => finishAiGeneration(supabase, userId, reservation, status),
      });
      return saved;
    } catch (error) {
      if (isAiDailyLimitError(error)) throw error;
      if (isAiGenerationInProgressError(error)) {
        throw new Error("Practice question generation is already in progress. Please try again shortly.");
      }
      throw normalizeAiError(error, "The AI couldn't generate practice questions for this material.");
    }
  });
