import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { summarySchema, type StudySummary } from "@/lib/summary.schema";
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
import type { SupabaseClient } from "@supabase/supabase-js";
import { getUserLocale, type Locale, type PersistedContentLocale } from "@/lib/i18n";
import { runBoundedServerOperation } from "@/lib/bounded-server-operation";
import { resolveSummaryAvailability } from "@/lib/summary-availability";
import {
  parseTopicSummarySourceRanges,
  reconstructVerifiedTopicSource,
} from "@/lib/topic-summary-source";
import { MARKDOWN_SUMMARY_FORMAT, SUMMARY_SYSTEM_PROMPT } from "@/lib/summary.prompt";
import { parseMarkdownSummary } from "@/lib/summary.parser";

const MAX_INPUT_CHARS = 60_000;
const DOCUMENT_SUMMARY_MAX_OUTPUT_TOKENS = 1_600;
const TOPIC_SUMMARY_MAX_OUTPUT_TOKENS = 2_500;

type SummaryVariant = {
  id: string;
  locale: PersistedContentLocale;
  createdAt: string;
  updatedAt: string;
  summary: StudySummary;
};

type SummaryDocument = {
  id: string;
  title: string;
  user_id: string;
  status: string;
  extracted_text: string | null;
};

type TopicSummaryContext = {
  id: string;
  title: string;
  sourceText: string;
};

function mapSummaryVariant(row: {
  id: string;
  locale: string;
  created_at: string;
  updated_at: string;
  content: Json;
}): SummaryVariant {
  return {
    id: row.id,
    locale: row.locale as PersistedContentLocale,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    summary: row.content as unknown as StudySummary,
  };
}

async function loadSummaryVariant(
  supabase: SupabaseClient<Database>,
  documentId: string,
  locale: Locale,
  topicId: string | null = null,
) {
  const query = supabase
    .from("summaries")
    .select("id, locale, content, created_at, updated_at")
    .eq("document_id", documentId)
    .eq("locale", locale);
  const { data, error } = await (topicId
    ? query.eq("topic_id", topicId)
    : query.is("topic_id", null)
  ).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapSummaryVariant(data) : null;
}

async function loadSummaryVariants(
  supabase: SupabaseClient<Database>,
  documentId: string,
  topicId: string | null,
  signal?: AbortSignal,
) {
  const query = supabase
    .from("summaries")
    .select("id, locale, content, created_at, updated_at")
    .eq("document_id", documentId)
    .order("created_at", { ascending: false });
  const scopedQuery = topicId ? query.eq("topic_id", topicId) : query.is("topic_id", null);
  const { data, error } = await (signal ? scopedQuery.abortSignal(signal) : scopedQuery);
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapSummaryVariant);
}

async function loadOwnedSummaryDocument(
  supabase: SupabaseClient<Database>,
  userId: string,
  documentId: string,
  signal?: AbortSignal,
) {
  const query = supabase
    .from("documents")
    .select("id, title, user_id, status, extracted_text")
    .eq("id", documentId);
  const { data, error } = await (signal ? query.abortSignal(signal) : query).maybeSingle();
  if (error || !data || data.user_id !== userId) throw new Error("Document not found.");
  return data satisfies SummaryDocument;
}

async function loadTopicSummaryContext(
  supabase: SupabaseClient<Database>,
  userId: string,
  document: SummaryDocument,
  topicId: string,
  signal?: AbortSignal,
): Promise<TopicSummaryContext> {
  const query = supabase
    .from("document_topics")
    .select("id, user_id, document_id, title, source_ranges, source_hash")
    .eq("id", topicId);
  const { data: topic, error } = await (signal ? query.abortSignal(signal) : query).maybeSingle();
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
  return { id: topic.id, title: topic.title, sourceText };
}

async function waitForSummary(
  supabase: SupabaseClient<Database>,
  documentId: string,
  locale: Locale,
  previousUpdatedAt: string | null,
  topicId: string | null = null,
) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const summary = await loadSummaryVariant(supabase, documentId, locale, topicId);
    if (summary && summary.updatedAt !== previousUpdatedAt) return summary;
  }
  return null;
}

export const getDocumentSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ documentId: z.string().uuid(), topicId: z.string().uuid().optional() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    const locale = getUserLocale(claims.user_metadata as Record<string, unknown> | undefined);
    const topicId = data.topicId ?? null;
    const variants = await runBoundedServerOperation(async (signal) => {
      if (topicId) {
        const document = await loadOwnedSummaryDocument(supabase, userId, data.documentId, signal);
        await loadTopicSummaryContext(supabase, userId, document, topicId, signal);
      }
      return loadSummaryVariants(supabase, data.documentId, topicId, signal);
    });
    return resolveSummaryAvailability(variants, locale);
  });

export const generateDocumentSummary = createServerFn({ method: "POST" })
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
    const topicId = data.topicId ?? null;

    // RLS already scopes rows to the caller; the explicit user check is a second gate.
    const documentRow = await loadOwnedSummaryDocument(supabase, userId, data.documentId);
    const topic = topicId
      ? await loadTopicSummaryContext(supabase, userId, documentRow, topicId)
      : null;

    const extractedText = documentRow.extracted_text;
    if (!topic && (!extractedText || extractedText.trim().length < 200)) {
      throw new Error(
        "This document has no readable extracted text yet. Process the PDF before generating a summary.",
      );
    }
    const summaryText = topic?.sourceText ?? extractedText!;
    const summaryTitle = topic?.title ?? documentRow.title;

    const existing = await loadSummaryVariant(
      supabase,
      documentRow.id,
      localeContext.locale,
      topicId,
    );
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
          reserveAiGeneration(
            supabase,
            "summary",
            documentRow.id,
            localeContext.locale,
            userId,
            topicId,
          ),
        generate: () =>
          generateAiText({
            system: SUMMARY_SYSTEM_PROMPT,
            prompt: topic
              ? `Document title: ${documentRow.title}\nTopic title: ${topic.title}\n\nTOPIC-FOCUSED MODE:\nSummarize ONLY the topic excerpt below. Do not expand into other sections of the document or add related background that is absent from this excerpt.\n\nTOPIC EXCERPT (the only allowed source):\n"""\n${summaryText.slice(0, MAX_INPUT_CHARS)}\n"""\n\nProduce the structured study summary for this topic.`
              : `Document title: ${documentRow.title}\n\nMATERIAL (the only allowed source):\n"""\n${summaryText.slice(0, MAX_INPUT_CHARS)}\n"""\n\nProduce the structured study summary.`,
            outputFormat: MARKDOWN_SUMMARY_FORMAT,
            languageInstruction: localeContext.languageInstruction,
            ...(topic
              ? {
                  maxOutputTokens: TOPIC_SUMMARY_MAX_OUTPUT_TOKENS,
                  reasoningEffort: "low" as const,
                }
              : {
                  maxOutputTokens: DOCUMENT_SUMMARY_MAX_OUTPUT_TOKENS,
                  reasoningEffort: "low" as const,
                }),
          }),
        afterGenerate: async (result) => {
          const output = summarySchema.parse(parseMarkdownSummary(result.text, summaryTitle));
          const { data: summaryId, error: saveError } = await supabase.rpc(
            "save_summary_version",
            {
              p_document_id: documentRow.id,
              p_locale: localeContext.locale,
              p_title: output.title || summaryTitle,
              p_content: output as unknown as Json,
              p_model: result.model,
              p_topic_id: topicId,
            },
          );
          if (saveError || !summaryId) {
            throw new Error(saveError?.message ?? "The summary was generated but couldn't be saved.");
          }
          const persisted = await loadSummaryVariant(
            supabase,
            documentRow.id,
            localeContext.locale,
            topicId,
          );
          if (!persisted) throw new Error("The summary was generated but couldn't be loaded.");
          return persisted;
        },
        finish: (reservation, status) => finishAiGeneration(supabase, userId, reservation, status),
      });
      return { reused: false as const, ...saved };
    } catch (error) {
      if (isAiDailyLimitError(error)) throw error;
      if (isAiGenerationInProgressError(error)) {
        const saved = await waitForSummary(
          supabase,
          documentRow.id,
          localeContext.locale,
          existing?.updatedAt ?? null,
          topicId,
        );
        if (saved) return { reused: true as const, ...saved };
        throw new Error("Summary generation is already in progress. Please try again shortly.");
      }
      throw normalizeAiError(error, "The AI couldn't generate a summary for this material.");
    }
  });
