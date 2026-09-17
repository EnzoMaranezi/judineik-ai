import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json, Database } from "@/integrations/supabase/types";
import { generateAiText, getAiLocaleContext, normalizeAiError } from "@/lib/ai-gateway.server";
import { runReservedAiGeneration } from "@/lib/ai-generation-action";
import { finishAiGeneration, isAiDailyLimitError, isAiGenerationInProgressError, reserveAiGeneration } from "@/lib/ai-usage-limit.server";
import { flashcardRatingSchema, type FlashcardDeck, type FlashcardReviewResult, type StoredFlashcard } from "@/lib/flashcards.schema";
import { assertOwnedFlashcardDocument, parseMarkdownFlashcards } from "@/lib/flashcards.parser";
import { evaluateTopicSourceEligibility } from "@/lib/topic-source-eligibility";
import type { Locale, PersistedContentLocale } from "@/lib/i18n";
import {
  parseTopicSummarySourceRanges,
  reconstructVerifiedTopicSource,
} from "@/lib/topic-summary-source";

const MAX_INPUT_CHARS = 60_000;
const SYSTEM_PROMPT = `You are NEXA, an academic study agent. Create recall flashcards based EXCLUSIVELY on the supplied material.
Rules:
- Never use outside knowledge or invent unsupported facts.
- Create exactly 12 independently understandable cards. Avoid duplicate prompts.
- Prioritize important definitions, concepts, relationships, and recall.
- Follow the output language requirement for all user-facing card text. Preserve source terminology when technically necessary.`;
const MARKDOWN_FLASHCARD_FORMAT = `Return exactly 12 cards using this format:
## Card 1
Front: concise recall prompt
Back: concise sufficient answer

Repeat for every card.
The labels "Front:" and "Back:" and the heading token "## Card" are fixed parser tokens and must remain literal English. Only their values use the requested output language.`;

type FlashcardRow = Database["public"]["Tables"]["flashcards"]["Row"];

function mapStoredFlashcard(card: FlashcardRow): StoredFlashcard {
  return {
    id: card.id,
    front: card.front,
    back: card.back,
    position: card.position,
    dueAt: card.due_at,
    lastReviewedAt: card.last_reviewed_at,
    intervalDays: card.interval_days,
    repetitions: card.repetitions,
    easeFactor: card.ease_factor,
  };
}

async function loadDeckBySet(
  supabase: SupabaseClient<Database>,
  set: { id: string; locale: string; created_at: string; model: string | null },
) {
  const { data: cards, error: cardsError } = await supabase.from("flashcards").select("id, front, back, position, due_at, last_reviewed_at, interval_days, repetitions, ease_factor, flashcard_set_id, created_at").eq("flashcard_set_id", set.id).order("position");
  if (cardsError || !cards) throw new Error(cardsError?.message ?? "Could not load flashcards.");
  return { id: set.id, locale: set.locale as PersistedContentLocale, createdAt: set.created_at, model: set.model, cards: cards.map(mapStoredFlashcard) };
}

async function loadDeck(
  supabase: SupabaseClient<Database>,
  documentId: string,
  locale: Locale,
  topicId: string | null = null,
) {
  const query = supabase
    .from("flashcard_sets")
    .select("id, locale, created_at, model")
    .eq("document_id", documentId)
    .eq("locale", locale);
  const { data: set, error } = await (topicId
    ? query.eq("topic_id", topicId)
    : query.is("topic_id", null)
  ).maybeSingle();
  if (error || !set) return null;
  return loadDeckBySet(supabase, set);
}

async function loadDeckAvailability(
  supabase: SupabaseClient<Database>,
  documentId: string,
  locale: Locale,
  topicId: string | null = null,
) {
  const query = supabase
    .from("flashcard_sets")
    .select("id, locale, created_at, model")
    .eq("document_id", documentId)
    .order("created_at", { ascending: false });
  const { data: sets, error } = await (topicId
    ? query.eq("topic_id", topicId)
    : query.is("topic_id", null));
  if (error) throw new Error(error.message);
  const variants = await Promise.all((sets ?? []).map((set) => loadDeckBySet(supabase, set)));
  return {
    requestedLocale: locale,
    current: variants.find((variant) => variant.locale === locale) ?? null,
    alternatives: variants.filter((variant) => variant.locale !== locale),
  };
}

async function loadReviewQueue(
  supabase: SupabaseClient<Database>,
  documentId: string,
  setId: string,
  topicId: string | null = null,
) {
  const query = supabase
    .from("flashcard_sets")
    .select("id")
    .eq("id", setId)
    .eq("document_id", documentId);
  const { data: set, error } = await (topicId
    ? query.eq("topic_id", topicId)
    : query.is("topic_id", null)
  ).maybeSingle();
  if (error) throw new Error(error.message);
  if (!set) return null;

  const now = new Date().toISOString();
  const cardFields = "id, front, back, position, due_at, last_reviewed_at, interval_days, repetitions, ease_factor, flashcard_set_id, created_at" as const;
  const { data: dueCards, error: dueError } = await supabase
    .from("flashcards")
    .select(cardFields)
    .eq("flashcard_set_id", set.id)
    .lte("due_at", now)
    .order("due_at")
    .order("position");
  if (dueError || !dueCards) throw new Error(dueError?.message ?? "Could not load due flashcards.");

  const { data: nextCard, error: nextError } = await supabase
    .from("flashcards")
    .select("due_at")
    .eq("flashcard_set_id", set.id)
    .gt("due_at", now)
    .order("due_at")
    .limit(1)
    .maybeSingle();
  if (nextError) throw new Error(nextError.message);

  return {
    setId: set.id,
    dueCards: dueCards.map(mapStoredFlashcard),
    dueCount: dueCards.length,
    nextDueAt: nextCard?.due_at ?? null,
  };
}

const FLASHCARD_GENERATION_WAIT_MS = 500;
const FLASHCARD_GENERATION_WAIT_ATTEMPTS = 40;

async function waitForDeck(
  supabase: SupabaseClient<Database>,
  documentId: string,
  locale: Locale,
  topicId: string | null = null,
) {
  for (let attempt = 0; attempt < FLASHCARD_GENERATION_WAIT_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, FLASHCARD_GENERATION_WAIT_MS));
    const existing = await loadDeck(supabase, documentId, locale, topicId);
    if (existing) return existing;
  }
  return null;
}

type FlashcardDocument = {
  id: string;
  user_id: string;
  title: string;
  extracted_text: string | null;
};

async function loadOwnedFlashcardDocument(
  supabase: SupabaseClient<Database>,
  userId: string,
  documentId: string,
) {
  const { data, error } = await supabase
    .from("documents")
    .select("id, user_id, title, extracted_text")
    .eq("id", documentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  assertOwnedFlashcardDocument(data, userId);
  return data satisfies FlashcardDocument;
}

async function loadTopicFlashcardContext(
  supabase: SupabaseClient<Database>,
  userId: string,
  document: FlashcardDocument,
  topicId: string,
  requireGenerationSource = true,
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
  if (requireGenerationSource && !evaluateTopicSourceEligibility(sourceText).flashcards) throw new Error("TOPIC_SOURCE_UNAVAILABLE");
  return { id: topic.id, title: topic.title, sourceText };
}

export const getDocumentFlashcards = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ documentId: z.string().uuid(), topicId: z.string().uuid().optional() }).parse(data))
  .handler(async ({ data, context }) => {
    const { locale } = getAiLocaleContext(context.claims);
    const topicId = data.topicId ?? null;
    if (topicId) {
      const document = await loadOwnedFlashcardDocument(context.supabase, context.userId, data.documentId);
      await loadTopicFlashcardContext(context.supabase, context.userId, document, topicId, false);
    }
    return loadDeckAvailability(context.supabase, data.documentId, locale, topicId);
  });

export const getDocumentFlashcardReviewQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ documentId: z.string().uuid(), flashcardSetId: z.string().uuid(), topicId: z.string().uuid().optional() }).parse(data))
  .handler(async ({ data, context }) => loadReviewQueue(context.supabase, data.documentId, data.flashcardSetId, data.topicId ?? null));

export const reviewFlashcard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ flashcardId: z.string().uuid(), rating: flashcardRatingSchema }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase
      .rpc("review_flashcard", { p_flashcard_id: data.flashcardId, p_rating: data.rating })
      .single();
    if (error || !result) throw new Error(error?.message ?? "Could not save flashcard review.");
    return {
      flashcardId: result.flashcard_id,
      rating: flashcardRatingSchema.parse(result.rating),
      reviewedAt: result.reviewed_at,
      nextDueAt: result.next_due_at,
      intervalDays: result.interval_days,
      repetitions: result.repetitions,
      easeFactor: result.ease_factor,
    } satisfies FlashcardReviewResult;
  });

export const generateDocumentFlashcards = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ documentId: z.string().uuid(), topicId: z.string().uuid().optional() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    const localeContext = getAiLocaleContext(claims);
    const doc = await loadOwnedFlashcardDocument(supabase, userId, data.documentId);
    const topicId = data.topicId ?? null;
    const topic = topicId
      ? await loadTopicFlashcardContext(supabase, userId, doc, topicId)
      : null;
    const extractedText = topic ? topic.sourceText : doc.extracted_text;
    if (!extractedText || extractedText.trim().length < 200) throw new Error("This document has no readable extracted text yet. Process the PDF before generating flashcards.");
    const existing = await loadDeck(supabase, doc.id, localeContext.locale, topicId);
    if (existing) return { reused: true as const, ...existing };
    try {
      const saved = await runReservedAiGeneration({
        reserve: () => reserveAiGeneration(supabase, "flashcards", doc.id, localeContext.locale, userId, topicId),
        generate: () => generateAiText({
          system: SYSTEM_PROMPT,
          prompt: topic
            ? `Document title: ${doc.title}\nTopic title: ${topic.title}\n\nTOPIC-FOCUSED MODE:\nCreate flashcards ONLY from the selected topic excerpt. Do not use other document sections or outside context.\n\nTOPIC EXCERPT (the only allowed source):\n"""\n${extractedText.slice(0, MAX_INPUT_CHARS)}\n"""\n\nCreate the flashcard deck.`
            : `Document title: ${doc.title}\n\nMATERIAL (the only allowed source):\n"""\n${extractedText.slice(0, MAX_INPUT_CHARS)}\n"""\n\nCreate the flashcard deck.`,
          outputFormat: MARKDOWN_FLASHCARD_FORMAT,
          languageInstruction: localeContext.languageInstruction,
        }),
        afterGenerate: async (result) => {
          const deck: FlashcardDeck = parseMarkdownFlashcards(result.text);
          const { error: persistError } = await supabase.rpc("create_flashcard_set_with_cards", { p_document_id: doc.id, p_locale: localeContext.locale, p_model: result.model, p_cards: deck.cards as unknown as Json, p_topic_id: topicId });
          if (persistError) throw new Error(persistError.message);
          const savedDeck = await loadDeck(supabase, doc.id, localeContext.locale, topicId);
          if (!savedDeck) throw new Error("The flashcards were generated but couldn't be saved.");
          return savedDeck;
        },
        finish: (reservation, status) => finishAiGeneration(supabase, userId, reservation, status),
      });
      return { reused: false as const, ...saved };
    } catch (cause) {
      if (isAiDailyLimitError(cause)) throw cause;
      if (isAiGenerationInProgressError(cause)) {
        const saved = await waitForDeck(supabase, doc.id, localeContext.locale, topicId);
        if (saved) return { reused: true as const, ...saved };
        throw new Error("Flashcard generation is already in progress. Please try again shortly.");
      }
      throw normalizeAiError(cause, "The AI couldn't generate flashcards for this material.");
    }
  });
