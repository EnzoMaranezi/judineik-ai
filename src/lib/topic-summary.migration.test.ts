import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/0008_topic_generated_content.sql", import.meta.url),
  "utf8",
);
const previousMigration = readFileSync(
  new URL("../../supabase/migrations/0006_multilingual_generated_content.sql", import.meta.url),
  "utf8",
);
const quotaMigration = readFileSync(
  new URL("../../supabase/migrations/0003_ai_generation_rate_limits.sql", import.meta.url),
  "utf8",
);
const summaries = readFileSync(new URL("./summaries.functions.ts", import.meta.url), "utf8");
const summaryPrompt = readFileSync(new URL("./summary.prompt.ts", import.meta.url), "utf8");
const sourceHelper = readFileSync(new URL("./topic-summary-source.ts", import.meta.url), "utf8");
const topicRoute = readFileSync(
  new URL("../routes/app.materials_.$documentId.topics_.$topicId.tsx", import.meta.url),
  "utf8",
);
const questions = readFileSync(new URL("./questions.functions.ts", import.meta.url), "utf8");
const flashcards = readFileSync(new URL("./flashcards.functions.ts", import.meta.url), "utf8");

test("existing summaries stay document-scoped while topic summaries use independent partial uniqueness", () => {
  assert.match(migration, /ADD COLUMN topic_id uuid\s+REFERENCES public\.document_topics\(id\)\s+ON DELETE CASCADE/u);
  assert.doesNotMatch(migration, /UPDATE public\.summaries/u);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS summaries_document_locale_key/u);
  assert.match(migration, /UNIQUE INDEX summaries_document_locale_uidx[\s\S]*\(document_id, locale\)[\s\S]*WHERE topic_id IS NULL/u);
  assert.match(migration, /UNIQUE INDEX summaries_topic_locale_uidx[\s\S]*\(topic_id, locale\)[\s\S]*WHERE topic_id IS NOT NULL/u);
  assert.match(migration, /ON CONFLICT \(document_id, locale\) WHERE topic_id IS NULL DO UPDATE/u);
  assert.match(migration, /ON CONFLICT \(topic_id, locale\) WHERE topic_id IS NOT NULL DO UPDATE/u);
});

test("topic quota identity is independent while daily quota remains global", () => {
  assert.match(migration, /ADD COLUMN topic_id uuid[\s\S]*ON DELETE SET NULL/u);
  assert.match(migration, /ADD COLUMN topic_scope_id uuid/u);
  assert.doesNotMatch(migration, /topic_scope_id uuid[\s\S]{0,100}REFERENCES/u);
  assert.match(migration, /ai_generation_events_generation_identity_idx[\s\S]*user_id,[\s\S]*document_id,[\s\S]*topic_scope_id,[\s\S]*kind,[\s\S]*locale/u);
  assert.match(migration, /topic_scope_id IS NOT DISTINCT FROM p_topic_id/u);
  assert.doesNotMatch(migration, /AND topic_id IS NOT DISTINCT FROM p_topic_id/u);
  assert.match(
    migration,
    /INSERT INTO public\.ai_generation_events \([\s\S]*topic_id,[\s\S]*topic_scope_id,[\s\S]*\)[\s\S]*VALUES \([\s\S]*p_topic_id,[\s\S]*p_topic_id,/u,
  );
  assert.match(migration, /COALESCE\(p_topic_id::text, 'document'\)[\s\S]*p_kind[\s\S]*p_locale/u);
  const countStart = migration.indexOf("SELECT count(*)::integer");
  const countEnd = migration.indexOf("IF v_used >= v_limit", countStart);
  const quotaCount = migration.slice(countStart, countEnd);
  assert.doesNotMatch(quotaCount, /topic_id|document_id|kind|locale/u);
  assert.match(migration, /v_limit integer := 20/u);
  assert.match(migration, /now\(\) \+ interval '30 minutes'/u);
  const ownershipValidation = migration.indexOf("IF p_topic_id IS NOT NULL THEN", migration.indexOf("CREATE FUNCTION public.reserve_ai_generation"));
  const dailyLock = migration.indexOf("hashtext(v_usage_date::text)", ownershipValidation);
  const activeReservationCheck = migration.indexOf("IF EXISTS (", dailyLock);
  const quotaCountStart = migration.indexOf("SELECT count(*)::integer", activeReservationCheck);
  assert.ok(ownershipValidation > -1 && ownershipValidation < dailyLock);
  assert.ok(dailyLock < activeReservationCheck && activeReservationCheck < quotaCountStart);
});

test("deleted topic history retains its immutable scope without becoming document scope", () => {
  const topicA = "00000000-0000-0000-0000-00000000000a";
  const documentReservation = { topicId: null, topicScopeId: null, status: "succeeded" };
  const topicReservation = { topicId: topicA, topicScopeId: topicA, status: "reserved" };
  const afterTopicDeletion = { ...topicReservation, topicId: null };

  assert.deepEqual(
    { topicId: documentReservation.topicId, topicScopeId: documentReservation.topicScopeId },
    { topicId: null, topicScopeId: null },
  );
  assert.deepEqual(
    { topicId: topicReservation.topicId, topicScopeId: topicReservation.topicScopeId },
    { topicId: topicA, topicScopeId: topicA },
  );
  assert.equal(afterTopicDeletion.topicId, null);
  assert.equal(afterTopicDeletion.topicScopeId, topicA);
  assert.notEqual(afterTopicDeletion.topicScopeId, documentReservation.topicScopeId);
  assert.equal(afterTopicDeletion.status, "reserved");
  assert.equal([documentReservation, afterTopicDeletion].filter((event) =>
    event.status === "succeeded" || event.status === "reserved"
  ).length, 2);
});

test("topic-scoped RPCs derive identity and validate ownership, relationship, and source freshness", () => {
  assert.equal((migration.match(/SECURITY DEFINER\s+SET search_path = pg_catalog, public/gu) ?? []).length, 2);
  assert.equal((migration.match(/v_user_id uuid := auth\.uid\(\)/gu) ?? []).length, 2);
  assert.match(migration, /WHERE id = p_topic_id\s+AND document_id = p_document_id\s+AND user_id = v_user_id/gu);
  assert.equal((migration.match(/extensions\.digest\(convert_to\(v_source_text, 'UTF8'\), 'sha256'\)/gu) ?? []).length, 2);
  assert.match(migration, /RAISE EXCEPTION 'STALE_TOPIC_SOURCE'/u);
  assert.match(migration, /p_topic_id IS NOT NULL AND p_kind <> 'summary'/u);
  assert.match(migration, /p_kind = 'topic_discovery'[\s\S]*p_topic_id IS NOT NULL/u);
  assert.doesNotMatch(migration, /p_user_id|SUPABASE_SERVICE_ROLE_KEY|serviceRole/u);
});

test("topic ranges are validated as bounded Unicode offsets before persistence", () => {
  assert.match(migration, /jsonb_typeof\(v_topic_ranges\) <> 'array'/u);
  assert.match(migration, /jsonb_typeof\(v_range->'start'\) <> 'number'/u);
  assert.match(migration, /\(v_range->>'start'\)::numeric/u);
  assert.match(migration, /v_end_value > char_length\(v_source_text\)::numeric/u);
  assert.match(migration, /v_start_value < v_previous_end/u);
  assert.doesNotMatch(migration, /\(v_range->>'(?:start|end)'\)::integer/u);
});

test("summary and quota writes remain authenticated RPC-only operations", () => {
  assert.match(previousMigration, /REVOKE ALL ON public\.summaries, public\.question_sets FROM authenticated/u);
  assert.match(previousMigration, /GRANT SELECT ON public\.summaries, public\.question_sets TO authenticated/u);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.save_summary_version\([^)]+\) FROM PUBLIC/u);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.save_summary_version\([^)]+\) FROM anon/u);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.save_summary_version\([^)]+\) TO authenticated/u);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.reserve_ai_generation\([^)]+\) FROM PUBLIC/u);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.reserve_ai_generation\([^)]+\) FROM anon/u);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.reserve_ai_generation\([^)]+\) TO authenticated/u);
  assert.match(quotaMigration, /REVOKE ALL ON public\.ai_generation_events FROM anon/u);
  assert.match(quotaMigration, /REVOKE ALL ON public\.ai_generation_events FROM authenticated/u);
  assert.doesNotMatch(migration, /GRANT (?:SELECT|INSERT|UPDATE|DELETE|ALL) ON public\.ai_generation_events TO authenticated/u);
});

test("server cache, locale, quota, prompt, and persistence share one optional topic scope", () => {
  assert.match(summaries, /topicId: z\.string\(\)\.uuid\(\)\.optional\(\)/u);
  assert.match(summaries, /topicId \? query\.eq\("topic_id", topicId\) : query\.is\("topic_id", null\)/u);
  assert.match(summaries, /const localeContext = getAiLocaleContext\(claims\)/u);
  assert.match(summaries, /loadTopicSummaryContext/u);
  assert.match(summaries, /reconstructVerifiedTopicSource\([\s\S]*parseTopicSummarySourceRanges\(topic\.source_ranges\)/u);
  assert.match(summaries, /reserveAiGeneration\([\s\S]*"summary"[\s\S]*localeContext\.locale,[\s\S]*topicId/u);
  assert.match(summaries, /TOPIC EXCERPT \(the only allowed source\)/u);
  assert.match(summaryPrompt, /DOCUMENT_SUMMARY_SYSTEM_PROMPT = `You are NEXA\. Create a concise/u);
  assert.match(summaryPrompt, /DOCUMENT_MARKDOWN_SUMMARY_FORMAT = `Return Markdown with exactly these headings/u);
  assert.match(summaryPrompt, /## Key concepts[\s\S]*## Explanations[\s\S]*## Definitions[\s\S]*## Relationships[\s\S]*## Final review[\s\S]*## Limitations/u);
  assert.match(summaries, /system: topic \? SUMMARY_SYSTEM_PROMPT : DOCUMENT_SUMMARY_SYSTEM_PROMPT/u);
  assert.match(summaries, /outputFormat: topic \? MARKDOWN_SUMMARY_FORMAT : DOCUMENT_MARKDOWN_SUMMARY_FORMAT/u);
  assert.match(summaries, /languageInstructionPlacement: topic \? "system-and-prompt" : "prompt-only"/u);
  assert.match(summaries, /languageInstructionFormat: topic \? "contract" : "instruction-only"/u);
  assert.match(summaries, /DOCUMENT_SUMMARY_MAX_OUTPUT_TOKENS = 1_600/u);
  assert.match(
    summaries,
    /topic[\s\S]*\?[\s\S]*maxOutputTokens: TOPIC_SUMMARY_MAX_OUTPUT_TOKENS,[\s\S]*reasoningEffort: "low" as const,[\s\S]*:[\s\S]*maxOutputTokens: DOCUMENT_SUMMARY_MAX_OUTPUT_TOKENS,[\s\S]*reasoningEffort: "low" as const/u,
  );
  assert.doesNotMatch(summaries, /DOCUMENT_MARKDOWN_SUMMARY_FORMAT[\s\S]*Conceitos-chave/u);
  assert.match(summaries, /system: topic \? SUMMARY_SYSTEM_PROMPT/u);
  assert.match(summaries, /outputFormat: topic \? MARKDOWN_SUMMARY_FORMAT/u);
  assert.match(summaries, /maxOutputTokens: TOPIC_SUMMARY_MAX_OUTPUT_TOKENS/u);
  assert.match(summaries, /reasoningEffort: "low" as const/u);
  assert.match(summaries, /TOPIC_SUMMARY_MAX_OUTPUT_TOKENS = 2_500/u);
  const gateway = readFileSync(new URL("./ai-gateway.server.ts", import.meta.url), "utf8");
  assert.match(gateway, /attempt\.provider === "nvidia" && reasoningEffort/u);
  assert.match(gateway, /\{ nvidia: \{ reasoningEffort \} \}/u);
  assert.match(summaries, /p_topic_id: topicId/u);
  assert.match(summaries, /waitForSummary\([\s\S]*topicId/u);
  assert.match(sourceHelper, /reconstructTopicSource\(source, sourceRanges\)/u);
  assert.doesNotMatch(sourceHelper, /segmentDocumentSource|generateAiText/u);
});

test("topic detail reuses the summary and language-mismatch UI without automatic generation", () => {
  assert.match(topicRoute, /<DocumentSummaryPanel[\s\S]*topicId=\{state\.topic\.id\}/u);
  assert.match(summaries, /resolveSummaryAvailability\(variants, locale\)/u);
  assert.doesNotMatch(topicRoute, /generateDocumentSummary/u);
  assert.match(topicRoute, /<DocumentQuestionsPanel[\s\S]*topicId=\{state\.topic\.id\}/u);
});

test("topic summaries do not alter flashcards, sessions, Progress, or Overview", () => {
  assert.doesNotMatch(migration, /ALTER TABLE public\.(?:question_sets|question_sessions|flashcard_sets|flashcards|flashcard_reviews|documents)/u);
  assert.doesNotMatch(migration, /UPDATE public\.(?:question_sets|question_sessions|flashcard_sets|flashcards|flashcard_reviews)/u);
});
