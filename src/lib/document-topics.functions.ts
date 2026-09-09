import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database, Json } from "@/integrations/supabase/types";
import { generateAiText, normalizeAiError } from "@/lib/ai-gateway.server";
import { pollForCachedValue, runCachedTopicDiscovery } from "@/lib/document-topics.discovery";
import { parseTopicDiscoveryResponse } from "@/lib/document-topics.parser";
import {
  TOPIC_DISCOVERY_LANGUAGE_INSTRUCTION,
  TOPIC_DISCOVERY_OUTPUT_FORMAT,
  TOPIC_DISCOVERY_SYSTEM_PROMPT,
} from "@/lib/document-topics.prompt";
import {
  buildTopicSegmentMap,
  hashTopicSource,
  segmentDocumentSource,
  type TopicSourceRange,
} from "@/lib/document-topics.source";
import {
  finishAiGeneration,
  isAiDailyLimitError,
  isAiGenerationInProgressError,
  reserveAiGeneration,
} from "@/lib/ai-usage-limit.server";

export const TOPIC_DOCUMENT_NOT_FOUND = "TOPIC_DOCUMENT_NOT_FOUND";
export const TOPIC_NOT_FOUND = "TOPIC_NOT_FOUND";
export const TOPIC_SOURCE_UNAVAILABLE = "TOPIC_SOURCE_UNAVAILABLE";
export const TOPIC_SOURCE_INSUFFICIENT = "TOPIC_SOURCE_INSUFFICIENT";
export const TOPIC_SOURCE_TOO_LARGE = "TOPIC_SOURCE_TOO_LARGE";
export const STALE_TOPIC_SOURCE = "STALE_TOPIC_SOURCE";
export const TOPIC_OUTPUT_INVALID = "TOPIC_OUTPUT_INVALID";
export const TOPIC_PERSISTENCE_FAILED = "TOPIC_PERSISTENCE_FAILED";

const MIN_SOURCE_TEXT_CHARS = 600;
const MAX_SOURCE_CODE_POINTS = 100_000;
const TOPIC_GENERATION_WAIT_MS = 5_000;
const TOPIC_GENERATION_WAIT_ATTEMPTS = 48;

const sourceRangeSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
});

export type StoredDocumentTopic = {
  id: string;
  documentId: string;
  title: string;
  description: string;
  sourceRanges: TopicSourceRange[];
  sourceHash: string;
  position: number;
  discoveryModel: string | null;
  createdAt: string;
};

type TopicDocument = {
  id: string;
  user_id: string;
  title: string;
  extracted_text: string | null;
};

function mapTopic(row: Database["public"]["Tables"]["document_topics"]["Row"]): StoredDocumentTopic {
  const sourceRanges = z.array(sourceRangeSchema).min(1).parse(row.source_ranges);
  return {
    id: row.id,
    documentId: row.document_id,
    title: row.title,
    description: row.description,
    sourceRanges,
    sourceHash: row.source_hash,
    position: row.position,
    discoveryModel: row.discovery_model,
    createdAt: row.created_at,
  };
}

async function loadOwnedDocument(
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
  if (!data || data.user_id !== userId) throw new Error(TOPIC_DOCUMENT_NOT_FOUND);
  return data satisfies TopicDocument;
}

async function loadTopics(supabase: SupabaseClient<Database>, documentId: string) {
  const { data, error } = await supabase
    .from("document_topics")
    .select("id, user_id, document_id, title, description, source_ranges, source_hash, position, discovery_model, created_at, updated_at")
    .eq("document_id", documentId)
    .order("position");
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapTopic);
}

function validateDiscoverableSource(source: string | null) {
  if (!source || !source.trim()) throw new Error(TOPIC_SOURCE_UNAVAILABLE);
  const sourceLength = Array.from(source).length;
  if (sourceLength > MAX_SOURCE_CODE_POINTS) throw new Error(TOPIC_SOURCE_TOO_LARGE);
  if (source.replace(/\s+/gu, "").length < MIN_SOURCE_TEXT_CHARS) {
    throw new Error(TOPIC_SOURCE_INSUFFICIENT);
  }
  const segments = segmentDocumentSource(source);
  if (segments.length < 3) throw new Error(TOPIC_SOURCE_INSUFFICIENT);
  return segments;
}

async function loadCurrentTopics(
  supabase: SupabaseClient<Database>,
  documentId: string,
  sourceHash: string,
) {
  const topics = await loadTopics(supabase, documentId);
  if (topics.length === 0) return null;
  if (topics.some((topic) => topic.sourceHash !== sourceHash)) throw new Error(STALE_TOPIC_SOURCE);
  if (
    topics.length < 3 ||
    topics.length > 12 ||
    topics.some((topic, index) => topic.position !== index + 1)
  ) {
    throw new Error(TOPIC_PERSISTENCE_FAILED);
  }
  return topics;
}

async function waitForTopics(
  supabase: SupabaseClient<Database>,
  documentId: string,
  sourceHash: string,
) {
  return pollForCachedValue({
    loadCached: () => loadCurrentTopics(supabase, documentId, sourceHash),
    wait: (milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
    intervalMs: TOPIC_GENERATION_WAIT_MS,
    maxAttempts: TOPIC_GENERATION_WAIT_ATTEMPTS,
  });
}

function topicPersistencePayload(
  topics: ReturnType<typeof parseTopicDiscoveryResponse>,
): Json {
  return topics.map((topic) => ({
    title: topic.title,
    description: topic.description,
    position: topic.position,
    source_ranges: topic.sourceRanges.map((range) => ({ start: range.start, end: range.end })),
  }));
}

function normalizeTopicError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (
    message.includes("MALFORMED_TOPIC_OUTPUT") ||
    message.includes("INVALID_TOPIC_OUTPUT") ||
    message.includes("DUPLICATE_TOPIC") ||
    message.includes("UNKNOWN_TOPIC_SEGMENT") ||
    message.includes("OVERLAPPING_DOCUMENT_TOPICS") ||
    message.includes("INSUFFICIENT_TOPIC_COVERAGE") ||
    message.includes("TOPIC_SOURCE_TOO_SHORT") ||
    message.includes("TOPIC_SOURCE_TOO_BROAD")
  ) {
    return new Error(TOPIC_OUTPUT_INVALID);
  }
  if (message.includes("STALE_TOPIC_SOURCE")) return new Error(STALE_TOPIC_SOURCE);
  return normalizeAiError(error, "Topic discovery failed.");
}

export const getDocumentTopics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ documentId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const document = await loadOwnedDocument(context.supabase, context.userId, data.documentId);
    const source = document.extracted_text;
    const topics = await loadTopics(context.supabase, document.id);
    if (topics.length > 0) {
      if (!source) throw new Error(STALE_TOPIC_SOURCE);
      const sourceHash = await hashTopicSource(source);
      if (topics.some((topic) => topic.sourceHash !== sourceHash)) throw new Error(STALE_TOPIC_SOURCE);
    }
    let sourceState: "ready" | "unavailable" | "insufficient" | "too_large" = "ready";
    try {
      validateDiscoverableSource(source);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === TOPIC_SOURCE_UNAVAILABLE) sourceState = "unavailable";
      else if (message === TOPIC_SOURCE_TOO_LARGE) sourceState = "too_large";
      else sourceState = "insufficient";
    }
    return {
      document: { id: document.id, title: document.title },
      sourceState,
      topics,
    };
  });

export const getDocumentTopic = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ documentId: z.string().uuid(), topicId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const document = await loadOwnedDocument(context.supabase, context.userId, data.documentId);
    if (!document.extracted_text) throw new Error(STALE_TOPIC_SOURCE);
    const sourceHash = await hashTopicSource(document.extracted_text);
    const topics = await loadCurrentTopics(context.supabase, document.id, sourceHash);
    const topic = topics?.find((candidate) => candidate.id === data.topicId);
    if (!topic) throw new Error(TOPIC_NOT_FOUND);
    return { document: { id: document.id, title: document.title }, topic };
  });

export const waitForDocumentTopics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ documentId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const document = await loadOwnedDocument(context.supabase, context.userId, data.documentId);
    const source = document.extracted_text;
    validateDiscoverableSource(source);
    if (!source) throw new Error(TOPIC_SOURCE_UNAVAILABLE);
    const sourceHash = await hashTopicSource(source);
    const topics = await waitForTopics(context.supabase, document.id, sourceHash);
    if (!topics) throw new Error("AI_GENERATION_IN_PROGRESS");
    return { document: { id: document.id, title: document.title }, topics };
  });

export const discoverDocumentTopics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ documentId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const document = await loadOwnedDocument(supabase, userId, data.documentId);
    const source = document.extracted_text;
    const segments = validateDiscoverableSource(source);
    if (!source) throw new Error(TOPIC_SOURCE_UNAVAILABLE);
    const sourceHash = await hashTopicSource(source);

    try {
      const result = await runCachedTopicDiscovery({
        loadCached: () => loadCurrentTopics(supabase, document.id, sourceHash),
        reserve: () => reserveAiGeneration(supabase, "topic_discovery", document.id, "und", userId),
        generate: () =>
          generateAiText({
            system: TOPIC_DISCOVERY_SYSTEM_PROMPT,
            prompt: `Document title: ${document.title}\n\nSOURCE SEGMENT TOKEN MAP:\n${buildTopicSegmentMap(segments)}\n\nUse only ALLOWED_SEGMENT_TOKENS and group this material into topics now.`,
            outputFormat: TOPIC_DISCOVERY_OUTPUT_FORMAT,
            languageInstruction: TOPIC_DISCOVERY_LANGUAGE_INSTRUCTION,
          }),
        persist: async (generated) => {
          let parsed;
          try {
            parsed = parseTopicDiscoveryResponse(generated.text, source, segments);
          } catch (error) {
            throw normalizeTopicError(error);
          }
          const { data: saved, error } = await supabase.rpc("create_document_topics", {
            p_document_id: document.id,
            p_source_hash: sourceHash,
            p_discovery_model: generated.model,
            p_topics: topicPersistencePayload(parsed),
          });
          if (error) {
            if (error.message.includes("STALE_TOPIC_SOURCE")) throw new Error(STALE_TOPIC_SOURCE);
            throw new Error(TOPIC_PERSISTENCE_FAILED);
          }
          if (!saved || saved.length === 0) throw new Error(TOPIC_PERSISTENCE_FAILED);
          return saved.map(mapTopic);
        },
        finish: (reservation, status) => finishAiGeneration(supabase, userId, reservation, status),
        isGenerationInProgress: isAiGenerationInProgressError,
        waitForCached: () => loadCurrentTopics(supabase, document.id, sourceHash),
      });
      return { reused: result.reused, document: { id: document.id, title: document.title }, topics: result.value };
    } catch (error) {
      if (isAiDailyLimitError(error)) throw error;
      if (isAiGenerationInProgressError(error)) throw new Error("AI_GENERATION_IN_PROGRESS");
      throw normalizeTopicError(error);
    }
  });
