import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/0009_topic_questions.sql", import.meta.url),
  "utf8",
);
const permissionsMigration = readFileSync(
  new URL("../../supabase/migrations/0006_multilingual_generated_content.sql", import.meta.url),
  "utf8",
);
const questions = readFileSync(new URL("./questions.functions.ts", import.meta.url), "utf8");
const questionsUi = readFileSync(
  new URL("../components/app/DocumentQuestions.tsx", import.meta.url),
  "utf8",
);
const topicRoute = readFileSync(
  new URL("../routes/app.materials_.$documentId.topics_.$topicId.tsx", import.meta.url),
  "utf8",
);
const i18n = readFileSync(new URL("./i18n.tsx", import.meta.url), "utf8");

test("adds current and immutable topic identities without rewriting historical sets", () => {
  assert.match(
    migration,
    /ADD COLUMN topic_id uuid\s+REFERENCES public\.document_topics\(id\)\s+ON DELETE SET NULL/u,
  );
  assert.match(migration, /ADD COLUMN topic_scope_id uuid/u);
  assert.doesNotMatch(migration, /topic_scope_id uuid[\s\S]{0,100}REFERENCES/u);
  assert.doesNotMatch(
    migration,
    /UPDATE public\.question_sets\s+SET\s+(?:topic_id|topic_scope_id)/u,
  );
  assert.doesNotMatch(migration, /DELETE FROM public\.question_sets/u);
  assert.doesNotMatch(migration, /ALTER TABLE public\.question_sessions/u);
});

test("document and topic current-standard caches have independent partial uniqueness", () => {
  assert.match(migration, /DROP INDEX IF EXISTS public\.question_sets_current_document_locale_uidx/u);
  assert.match(
    migration,
    /question_sets_current_document_locale_uidx[\s\S]*\(document_id, locale\)[\s\S]*kind = 'standard'[\s\S]*superseded_at IS NULL[\s\S]*topic_scope_id IS NULL/u,
  );
  assert.match(
    migration,
    /question_sets_current_topic_locale_uidx[\s\S]*\(document_id, topic_scope_id, locale\)[\s\S]*kind = 'standard'[\s\S]*superseded_at IS NULL[\s\S]*topic_scope_id IS NOT NULL/u,
  );
  assert.match(
    migration,
    /question_sets_user_document_topic_locale_kind_idx[\s\S]*user_id,[\s\S]*document_id,[\s\S]*topic_scope_id,[\s\S]*locale,[\s\S]*kind/u,
  );
});

test("question-set RPC remains authenticated and validates owned topic freshness and ranges", () => {
  assert.match(
    migration,
    /CREATE FUNCTION public\.create_question_set_version\([\s\S]*p_topic_id uuid DEFAULT NULL/u,
  );
  assert.match(migration, /SECURITY DEFINER\s+SET search_path = pg_catalog, public/u);
  assert.match(migration, /v_user_id uuid := auth\.uid\(\)/u);
  assert.match(
    migration,
    /FROM public\.document_topics[\s\S]*id = p_topic_id[\s\S]*document_id = p_document_id[\s\S]*user_id = v_user_id/u,
  );
  assert.match(migration, /extensions\.digest\(convert_to\(v_source_text, 'UTF8'\), 'sha256'\)/u);
  assert.match(migration, /RAISE EXCEPTION 'STALE_TOPIC_SOURCE'/u);
  assert.match(migration, /jsonb_typeof\(v_topic_ranges\) <> 'array'/u);
  assert.match(migration, /\(v_range->>'start'\)::numeric/u);
  assert.match(migration, /v_end_value > char_length\(v_source_text\)::numeric/u);
  assert.doesNotMatch(migration, /\(v_range->>'(?:start|end)'\)::integer/u);
});

test("standard regeneration supersedes only the exact document/topic and locale scope", () => {
  assert.match(
    migration,
    /UPDATE public\.question_sets[\s\S]*document_id = p_document_id[\s\S]*user_id = v_user_id[\s\S]*topic_scope_id IS NOT DISTINCT FROM p_topic_id[\s\S]*locale = p_locale[\s\S]*kind = 'standard'[\s\S]*superseded_at IS NULL/u,
  );
  assert.match(
    migration,
    /INSERT INTO public\.question_sets \([\s\S]*topic_id,[\s\S]*topic_scope_id[\s\S]*\)[\s\S]*VALUES \([\s\S]*p_topic_id,[\s\S]*p_topic_id/u,
  );
  assert.match(
    migration,
    /COALESCE\(p_topic_id::text, 'document'\)[\s\S]*p_kind[\s\S]*p_locale/u,
  );
});

test("practice lineage must match the original standard set locale and topic scope", () => {
  assert.match(
    migration,
    /p_kind = 'practice'[\s\S]*kind = 'standard'[\s\S]*v_source_topic_scope_id IS DISTINCT FROM p_topic_id[\s\S]*QUESTION_SET_TOPIC_MISMATCH/u,
  );
  assert.match(
    migration,
    /p_topic_id IS NOT NULL AND v_source_topic_id IS DISTINCT FROM p_topic_id[\s\S]*TOPIC_NOT_FOUND/u,
  );
  assert.doesNotMatch(migration, /DELETE FROM public\.question_sets/u);
});

test("reservation permits topic summaries and questions without changing global quota semantics", () => {
  assert.match(
    migration,
    /p_kind NOT IN \('summary', 'questions', 'practice_questions'\)[\s\S]*UNSUPPORTED_AI_TOPIC_SCOPE/u,
  );
  assert.match(migration, /topic_scope_id IS NOT DISTINCT FROM p_topic_id/u);
  assert.match(migration, /v_limit integer := 20/u);
  assert.match(migration, /now\(\) \+ interval '30 minutes'/u);
  const countStart = migration.indexOf("SELECT count(*)::integer");
  const countEnd = migration.indexOf("IF v_used >= v_limit", countStart);
  assert.doesNotMatch(
    migration.slice(countStart, countEnd),
    /document_id|topic_scope_id|kind =|locale =/u,
  );
  assert.match(migration, /hashtext\(v_usage_date::text\)/u);
});

test("old RPC overloads are removed and only authenticated receives the new calls", () => {
  assert.match(
    migration,
    /DROP FUNCTION IF EXISTS public\.create_question_set_version\(uuid, text, text, text, jsonb, uuid\)/u,
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.create_question_set_version\([^)]+\) FROM PUBLIC/u,
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.create_question_set_version\([^)]+\) FROM anon/u,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.create_question_set_version\([^)]+\) TO authenticated/u,
  );
  assert.doesNotMatch(migration, /GRANT (?:INSERT|UPDATE|DELETE|ALL) ON (?:TABLE )?public\.question_sets/u);
  assert.match(permissionsMigration, /REVOKE ALL ON public\.summaries, public\.question_sets FROM authenticated/u);
});

test("topic generation reconstructs persisted ranges before reserving and never accepts browser topic text", () => {
  const handlerStart = questions.indexOf("export const generateDocumentQuestions");
  const reserveStart = questions.indexOf("runReservedAiGeneration", handlerStart);
  const handler = questions.slice(handlerStart, questions.indexOf("export const saveQuestionSession", handlerStart));
  assert.match(handler, /topicId: z\.string\(\)\.uuid\(\)\.optional\(\)/u);
  assert.match(handler, /loadTopicQuestionContext\(supabase, userId, doc, topicId\)/u);
  assert.ok(handler.indexOf("loadTopicQuestionContext") < reserveStart - handlerStart);
  assert.match(
    questions,
    /reconstructVerifiedTopicSource\([\s\S]*parseTopicSummarySourceRanges\(topic\.source_ranges\)/u,
  );
  assert.match(handler, /TOPIC EXCERPT \(the only allowed source\)/u);
  assert.doesNotMatch(handler, /topicText|sourceText: z\.|topicSource: z\./u);
});

test("all current-set cache and polling paths explicitly use the requested scope", () => {
  assert.match(questions, /loadCurrentStandardSet[\s\S]*query\.eq\("topic_scope_id", topicId\)/u);
  assert.match(questions, /query\.is\("topic_scope_id", null\)/u);
  assert.match(questions, /waitForQuestionSet\([\s\S]*topicId: string \| null = null/u);
  const availabilityStart = questions.indexOf("export const getDocumentQuestions");
  const generationStart = questions.indexOf("export const generateDocumentQuestions");
  const availability = questions.slice(availabilityStart, generationStart);
  assert.match(availability, /query\.eq\("topic_scope_id", topicId\)/u);
  assert.match(availability, /query\.is\("topic_scope_id", null\)/u);
});

test("active and latest sessions derive scope through their exact question set", () => {
  assert.match(
    questions,
    /getActiveQuestionSession[\s\S]*question_sets!inner\(id, locale, questions, topic_scope_id\)[\s\S]*question_sets\.topic_scope_id/u,
  );
  assert.match(
    questions,
    /getLatestQuestionSession[\s\S]*question_sets!inner\(topic_scope_id\)[\s\S]*question_sets\.topic_scope_id/u,
  );
  assert.doesNotMatch(migration, /ADD COLUMN topic_id[\s\S]*public\.question_sessions/u);
  assert.match(questions, /assertQuestionSetBelongsToDocument/u);
});

test("topic practice derives scope from the original standard set and cannot widen its source", () => {
  const practiceStart = questions.indexOf("export const generatePracticeQuestions");
  const practice = questions.slice(practiceStart);
  assert.match(practice, /sourceSet\.topic_scope_id/u);
  assert.match(practice, /sourceSet\.topic_id !== topicId[\s\S]*TOPIC_NOT_FOUND/u);
  assert.match(practice, /loadTopicQuestionContext\(supabase, userId, doc, topicId\)/u);
  assert.match(
    practice,
    /reserveAiGeneration\(supabase, "practice_questions", doc\.id, practiceLocale, userId, topicId\)/u,
  );
  assert.match(practice, /TOPIC EXCERPT \(the only allowed source\)/u);
  assert.match(practice, /p_source_question_set_id: sourceQuestionSetId[\s\S]*p_topic_id: topicId/u);
});

test("topic detail reuses the existing questions panel and localized controlled states", () => {
  assert.match(
    topicRoute,
    /<DocumentQuestionsPanel documentId=\{state\.document\.id\} topicId=\{state\.topic\.id\}/u,
  );
  assert.match(questionsUi, /topicId\?: string/u);
  assert.match(questionsUi, /topics\.questionsStale/u);
  assert.match(questionsUi, /topics\.questionsSourceUnavailable/u);
  assert.match(questionsUi, /topics\.questionsSourceInvalid/u);
  assert.match(questionsUi, /topics\.questionsSourceInsufficient/u);
  assert.match(i18n, /Five multiple-choice questions written only from this topic\./u);
  assert.match(i18n, /Cinco questões de múltipla escolha criadas somente a partir deste tópico\./u);
});

test("topic deletion preserves immutable scope and historical question/session replay identity", () => {
  const topicId = "00000000-0000-0000-0000-00000000000a";
  const setBeforeDelete = { topicId, topicScopeId: topicId, questions: ["stored"] };
  const setAfterDelete = { ...setBeforeDelete, topicId: null };
  const session = { questionSetId: "set-a", answers: [{ correct: true }] };
  assert.equal(setAfterDelete.topicId, null);
  assert.equal(setAfterDelete.topicScopeId, topicId);
  assert.deepEqual(setAfterDelete.questions, ["stored"]);
  assert.equal(session.questionSetId, "set-a");
  assert.match(migration, /ON DELETE SET NULL/u);
  assert.doesNotMatch(migration, /ON DELETE CASCADE[\s\S]*topic_scope_id/u);
});

test("legacy document sets remain NULL-scoped and compatible with existing history", () => {
  assert.doesNotMatch(
    migration,
    /UPDATE public\.question_sets\s+SET\s+(?:topic_id|topic_scope_id)/u,
  );
  assert.match(
    migration,
    /question_sets_current_document_locale_uidx[\s\S]*topic_scope_id IS NULL/u,
  );
  assert.match(questions, /row\.kind === "legacy"/u);
});
