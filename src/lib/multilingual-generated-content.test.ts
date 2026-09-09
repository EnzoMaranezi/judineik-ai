import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/0006_multilingual_generated_content.sql", import.meta.url),
  "utf8",
);
const summaries = readFileSync(new URL("./summaries.functions.ts", import.meta.url), "utf8");
const questions = readFileSync(new URL("./questions.functions.ts", import.meta.url), "utf8");
const flashcards = readFileSync(new URL("./flashcards.functions.ts", import.meta.url), "utf8");
const summaryUi = readFileSync(
  new URL("../components/app/DocumentSummary.tsx", import.meta.url),
  "utf8",
);
const questionsUi = readFileSync(
  new URL("../components/app/DocumentQuestions.tsx", import.meta.url),
  "utf8",
);
const flashcardsUi = readFileSync(
  new URL("../components/app/DocumentFlashcards.tsx", import.meta.url),
  "utf8",
);
const authService = readFileSync(new URL("../services/authService.ts", import.meta.url), "utf8");

test("historical generated content is backfilled without guessing its locale", () => {
  assert.match(migration, /UPDATE public\.summaries\s+SET locale = 'und'/);
  assert.match(migration, /UPDATE public\.flashcard_sets\s+SET locale = 'und'/);
  assert.match(migration, /UPDATE public\.question_sets\s+SET\s+locale = 'und',\s+kind = 'legacy'/);
  assert.match(migration, /UPDATE public\.ai_generation_events\s+SET locale = 'und'/);
  assert.doesNotMatch(migration, /SET locale = '(?:en|pt-BR)'\s+WHERE locale IS NULL/);
});

test("locale constraints allow only known generated locales and the legacy sentinel", () => {
  for (const constraint of [
    "summaries_locale_check",
    "flashcard_sets_locale_check",
    "question_sets_locale_check",
    "ai_generation_events_locale_check",
  ]) {
    assert.match(migration, new RegExp(`${constraint} CHECK \\(locale IN \\('und', 'en', 'pt-BR'\\)\\)`));
  }
  assert.match(migration, /IF p_locale NOT IN \('en', 'pt-BR'\)[\s\S]*UNSUPPORTED_CONTENT_LOCALE/);
});

test("summaries and flashcard decks are unique per document and locale", () => {
  assert.match(migration, /summaries_document_locale_key UNIQUE \(document_id, locale\)/);
  assert.match(migration, /flashcard_sets_document_locale_key UNIQUE \(document_id, locale\)/);
  assert.match(migration, /ON CONFLICT \(document_id, locale\) DO UPDATE/);
  assert.match(migration, /ON CONFLICT \(document_id, locale\) DO NOTHING/);
});

test("question versioning preserves historical sets and separates practice", () => {
  assert.match(migration, /kind IN \('legacy', 'standard', 'practice'\)/);
  assert.match(migration, /source_question_set_id[\s\S]*REFERENCES public\.question_sets\(id\)[\s\S]*ON DELETE SET NULL/);
  assert.match(migration, /WHERE kind = 'standard' AND superseded_at IS NULL/);
  assert.match(migration, /UPDATE public\.question_sets[\s\S]*SET superseded_at = now\(\)[\s\S]*kind = 'standard'/);
  assert.match(migration, /p_kind = 'practice'[\s\S]*kind = 'standard'/);
  assert.doesNotMatch(migration, /DELETE FROM public\.question_sets/);
});

test("existing sessions and spaced-repetition state are not rewritten", () => {
  assert.doesNotMatch(migration, /UPDATE public\.question_sessions/);
  assert.doesNotMatch(migration, /DELETE FROM public\.question_sessions/);
  assert.doesNotMatch(migration, /UPDATE public\.flashcards/);
  assert.doesNotMatch(migration, /UPDATE public\.flashcard_reviews/);
  assert.doesNotMatch(migration, /DELETE FROM public\.flashcard_reviews/);
});

test("quota remains global while duplicate protection includes locale", () => {
  assert.match(migration, /hashtext\(v_usage_date::text\)/);
  assert.match(migration, /p_document_id::text \|\| ':' \|\| p_kind \|\| ':' \|\| p_locale/);
  assert.match(migration, /kind = p_kind\s+AND locale = p_locale\s+AND status = 'reserved'/);
  const countStart = migration.indexOf("SELECT count(*)::integer");
  const countEnd = migration.indexOf("IF v_used >= v_limit", countStart);
  assert.doesNotMatch(migration.slice(countStart, countEnd), /locale\s*=/);
  assert.match(migration, /v_limit integer := 20/);
});

test("generated-content writes are owner-validated RPC-only operations", () => {
  assert.match(migration, /REVOKE ALL ON public\.summaries, public\.question_sets FROM authenticated/);
  assert.match(migration, /GRANT SELECT ON public\.summaries, public\.question_sets TO authenticated/);
  assert.match(migration, /SECURITY DEFINER\s+SET search_path = pg_catalog, public/g);
  assert.match(migration, /IF v_user_id IS NULL[\s\S]*AUTH_REQUIRED/);
  assert.match(migration, /WHERE id = p_document_id AND user_id = v_user_id/);
  assert.doesNotMatch(migration, /SUPABASE_SERVICE_ROLE_KEY|serviceRole/);
});

test("question-session RLS validates the document and exact set relationship", () => {
  assert.match(migration, /owned_document\.id = question_sessions\.document_id[\s\S]*owned_document\.user_id = auth\.uid\(\)/);
  assert.match(migration, /owned_set\.id = question_sessions\.question_set_id[\s\S]*owned_set\.user_id = auth\.uid\(\)[\s\S]*owned_set\.document_id = question_sessions\.document_id/);
});

test("generation captures one verified locale context and uses it for cache, quota, prompt, and persistence", () => {
  assert.match(summaries, /const localeContext = getAiLocaleContext\(claims\)/);
  assert.match(summaries, /loadSummaryVariant\([\s\S]*documentRow\.id,[\s\S]*localeContext\.locale,[\s\S]*topicId/);
  assert.match(summaries, /reserveAiGeneration\([\s\S]*"summary",[\s\S]*documentRow\.id,[\s\S]*localeContext\.locale,[\s\S]*userId,[\s\S]*topicId/);
  assert.match(summaries, /p_locale: localeContext\.locale/);
  assert.match(
    questions,
    /reserveAiGeneration\(supabase, "questions", doc\.id, localeContext\.locale, userId, topicId\)/,
  );
  assert.match(
    flashcards,
    /reserveAiGeneration\(supabase, "flashcards", doc\.id, localeContext\.locale, userId, topicId\)/,
  );
});

test("normal question cache excludes practice and superseded sets", () => {
  assert.match(questions, /eq\("kind", "standard"\)[\s\S]*is\("superseded_at", null\)/);
  assert.match(questions, /row\.kind === "legacy" \|\| \(row\.kind === "standard" && !row\.superseded_at\)/);
  assert.doesNotMatch(
    questions.slice(questions.indexOf("async function loadCurrentStandardSet"), questions.indexOf("async function waitForQuestionSet")),
    /practice/,
  );
});

test("practice generation keeps the original standard-set locale", () => {
  assert.match(questions, /const practiceLocale = sourceSet\.locale/);
  assert.match(questions, /sourceSet\.locale !== previousSet\.locale/);
  assert.match(questions, /previousSet\.kind === "practice"[\s\S]*previousSet\.source_question_set_id/);
  assert.match(questions, /languageInstruction\(practiceLocale\)/);
  assert.match(questions, /p_source_question_set_id: sourceQuestionSetId/);
  assert.match(questions, /p_locale: practiceLocale/);
});

test("unfinished sessions remain bound to their exact set and require explicit cross-locale opening", () => {
  assert.match(questions, /questionSetId: set\.id,\s+locale: set\.locale/);
  assert.match(questionsUi, /active\?\.locale === locale/);
  assert.match(questionsUi, /restorableSession\?\.questionSetId === variant\.id/);
  assert.match(questionsUi, /setActiveSessionId\(restorableSession\.id\)/);
});

test("all three UIs reload on locale changes and require explicit generation", () => {
  for (const source of [summaryUi, questionsUi, flashcardsUi]) {
    assert.match(source, /GeneratedContentLanguageState/);
    assert.match(source, /\[documentId,(?: topicId,)? locale(?:, [^\]]+)?\]/);
    assert.doesNotMatch(source, /useEffect\([\s\S]{0,500}generate\(/);
  }
});

test("saving a locale refreshes JWT claims used by authenticated cache reads", () => {
  assert.match(
    authService,
    /updateLanguagePreference[\s\S]*updateUser\(\{ data: \{ locale \} \}\)[\s\S]*refreshSession\(\)/,
  );
});
