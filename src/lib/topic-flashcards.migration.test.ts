import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/0010_topic_flashcards.sql", import.meta.url),
  "utf8",
);
const functions = readFileSync(new URL("./flashcards.functions.ts", import.meta.url), "utf8");
const component = readFileSync(
  new URL("../components/app/DocumentFlashcards.tsx", import.meta.url),
  "utf8",
);
const topicRoute = readFileSync(
  new URL("../routes/app.materials_.$documentId.topics_.$topicId.tsx", import.meta.url),
  "utf8",
);
const overviewFunctions = readFileSync(
  new URL("./flashcards.overview.functions.ts", import.meta.url),
  "utf8",
);
const overviewRoute = readFileSync(new URL("../routes/app.index.tsx", import.meta.url), "utf8");
const scheduling = readFileSync(
  new URL("../../supabase/migrations/0005_flashcard_spaced_repetition.sql", import.meta.url),
  "utf8",
);
const phaseOneFlashcards = readFileSync(
  new URL("../../supabase/migrations/0004_flashcards.sql", import.meta.url),
  "utf8",
);

test("0010 adds normalized topic scope only to flashcard sets", () => {
  assert.match(
    migration,
    /ALTER TABLE public\.flashcard_sets[\s\S]*ADD COLUMN topic_id uuid[\s\S]*REFERENCES public\.document_topics\(id\)[\s\S]*ON DELETE CASCADE/u,
  );
  assert.doesNotMatch(migration, /ADD COLUMN topic_scope_id/u);
  assert.doesNotMatch(migration, /ALTER TABLE public\.(?:flashcards|flashcard_reviews)/u);
  assert.doesNotMatch(migration, /UPDATE public\.(?:flashcard_sets|flashcards|flashcard_reviews)/u);
});

test("document, topic, and locale deck identities use partial unique indexes", () => {
  assert.match(migration, /DROP CONSTRAINT IF EXISTS flashcard_sets_document_locale_key/u);
  assert.match(
    migration,
    /CREATE UNIQUE INDEX flashcard_sets_document_locale_uidx[\s\S]*\(document_id, locale\)[\s\S]*WHERE topic_id IS NULL/u,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX flashcard_sets_topic_locale_uidx[\s\S]*\(document_id, topic_id, locale\)[\s\S]*WHERE topic_id IS NOT NULL/u,
  );
  assert.match(
    migration,
    /flashcard_sets_user_document_topic_locale_idx[\s\S]*\(user_id, document_id, topic_id, locale\)/u,
  );
});

test("persistence RPC validates ownership and fresh persisted topic source", () => {
  assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path = pg_catalog, public/u);
  assert.match(migration, /v_user_id uuid := auth\.uid\(\)/u);
  assert.match(migration, /FROM public\.documents[\s\S]*id = p_document_id[\s\S]*user_id = v_user_id/u);
  assert.match(migration, /FROM public\.document_topics[\s\S]*id = p_topic_id[\s\S]*document_id = p_document_id[\s\S]*user_id = v_user_id/u);
  assert.match(migration, /extensions\.digest\(convert_to\(v_source_text, 'UTF8'\), 'sha256'\)/u);
  assert.match(migration, /jsonb_typeof\(v_topic_ranges\) <> 'array'/u);
  assert.match(migration, /v_start_value < v_previous_end/u);
  assert.match(migration, /v_end_value > char_length\(v_source_text\)::numeric/u);
  assert.match(migration, /jsonb_array_length\(p_cards\) NOT BETWEEN 10 AND 15/u);
});

test("persistence lock and conflict branches are scope-aware and immutable", () => {
  assert.match(
    migration,
    /COALESCE\(p_topic_id::text, 'document'\)[\s\S]*':flashcards:'[\s\S]*p_locale/u,
  );
  assert.match(
    migration,
    /ON CONFLICT \(document_id, locale\) WHERE topic_id IS NULL DO NOTHING/u,
  );
  assert.match(
    migration,
    /ON CONFLICT \(document_id, topic_id, locale\) WHERE topic_id IS NOT NULL DO NOTHING/u,
  );
  assert.match(migration, /topic_id IS NULL[\s\S]*RETURN v_set_id/u);
  assert.match(migration, /topic_id = p_topic_id[\s\S]*RETURN v_set_id/u);
  assert.doesNotMatch(migration, /superseded_at|DELETE FROM public\.flashcards|UPDATE public\.flashcards/u);
});

test("RPC execution remains authenticated-only", () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.create_flashcard_set_with_cards\(uuid, text, text, jsonb, uuid\) FROM PUBLIC/u);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.create_flashcard_set_with_cards\(uuid, text, text, jsonb, uuid\) FROM anon/u);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.create_flashcard_set_with_cards\(uuid, text, text, jsonb, uuid\) TO authenticated/u);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.reserve_ai_generation\(text, uuid, text, uuid\) FROM PUBLIC/u);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.reserve_ai_generation\(text, uuid, text, uuid\) FROM anon/u);
});

test("reservation adds flashcards topic scope without changing global quota semantics", () => {
  assert.match(
    migration,
    /p_kind NOT IN \('summary', 'questions', 'practice_questions', 'flashcards', 'topic_discovery'\)/u,
  );
  assert.match(
    migration,
    /p_kind NOT IN \('summary', 'questions', 'practice_questions', 'flashcards'\)/u,
  );
  assert.match(migration, /v_limit integer := 20/u);
  assert.match(migration, /now\(\) \+ interval '30 minutes'/u);
  assert.match(migration, /topic_scope_id IS NOT DISTINCT FROM p_topic_id/u);
  assert.match(migration, /p_topic_id,[\s\S]*p_topic_id,[\s\S]*p_locale,[\s\S]*'reserved'/u);
  assert.match(migration, /status = 'succeeded'[\s\S]*status = 'reserved' AND reserved_until > now\(\)/u);
});

test("generation reconstructs verified topic source before reservation and never falls back", () => {
  const topicLoad = functions.indexOf("loadTopicFlashcardContext");
  const reserve = functions.indexOf('reserveAiGeneration(supabase, "flashcards"');
  assert.ok(topicLoad >= 0 && reserve > topicLoad);
  assert.match(functions, /parseTopicSummarySourceRanges\(topic\.source_ranges\)/u);
  assert.match(functions, /reconstructVerifiedTopicSource\(/u);
  assert.match(functions, /TOPIC-FOCUSED MODE:[\s\S]*TOPIC EXCERPT \(the only allowed source\)/u);
  assert.match(functions, /reserveAiGeneration\(supabase, "flashcards", doc\.id, localeContext\.locale, userId, topicId\)/u);
  assert.match(functions, /p_topic_id: topicId/u);
  assert.doesNotMatch(functions, /topic\?\.sourceText \?\? doc\.extracted_text/u);
});

test("every deck and review-queue lookup is explicitly scoped", () => {
  assert.match(functions, /query\.eq\("topic_id", topicId\)[\s\S]*query\.is\("topic_id", null\)/u);
  assert.match(functions, /loadDeck\(supabase, doc\.id, localeContext\.locale, topicId\)/u);
  assert.match(functions, /waitForDeck\(supabase, doc\.id, localeContext\.locale, topicId\)/u);
  assert.match(functions, /loadReviewQueue\(context\.supabase, data\.documentId, data\.flashcardSetId, data\.topicId \?\? null\)/u);
  assert.match(component, /getDocumentFlashcardReviewQueue\([\s\S]*topicId/u);
});

test("Topic Detail reuses the existing panel without introducing another generator", () => {
  assert.match(topicRoute, /<DocumentFlashcardsPanel documentId=\{state\.document\.id\} topicId=\{state\.topic\.id\}/u);
  assert.doesNotMatch(topicRoute, /generateDocumentFlashcards/u);
  assert.match(component, /DocumentFlashcardsPanel\(\{ documentId, topicId, canGenerate = true \}/u);
});

test("Overview preserves topic metadata internally but offers only document navigation", () => {
  assert.match(overviewFunctions, /topic_id[\s\S]*document_topics\(title\)/u);
  assert.match(overviewRoute, /documentReviews\[0\]/u);
  assert.match(overviewRoute, /to="\/app\/flashcards\/\$documentId"/u);
  assert.doesNotMatch(overviewRoute, /to="\/app\/materials\/\$documentId\/topics\/\$topicId"/u);
});

test("spaced-repetition math and controlled review writes remain unchanged", () => {
  assert.match(scheduling, /WHEN 'again'[\s\S]*interval '10 minutes'/u);
  assert.match(scheduling, /WHEN 'hard'[\s\S]*interval '12 hours'/u);
  assert.match(scheduling, /WHEN 'good'[\s\S]*v_next_interval := 1[\s\S]*v_next_interval := 3/u);
  assert.match(scheduling, /WHEN 'easy'[\s\S]*least\(3\.00, v_previous_ease \+ 0\.15\)/u);
  assert.match(scheduling, /FOR UPDATE OF card/u);
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.review_flashcard|CREATE FUNCTION public\.review_flashcard/u);
});

test("topic deletion cascades only its deck graph while AI scope history remains independent", () => {
  assert.match(migration, /topic_id uuid[\s\S]*REFERENCES public\.document_topics\(id\)[\s\S]*ON DELETE CASCADE/u);
  assert.match(phaseOneFlashcards, /document_id uuid NOT NULL REFERENCES public\.documents\(id\) ON DELETE CASCADE/u);
  assert.match(phaseOneFlashcards, /user_id uuid NOT NULL REFERENCES auth\.users\(id\) ON DELETE CASCADE/u);
  assert.match(phaseOneFlashcards, /flashcard_set_id uuid NOT NULL REFERENCES public\.flashcard_sets\(id\) ON DELETE CASCADE/u);
  assert.match(scheduling, /flashcard_id uuid NOT NULL REFERENCES public\.flashcards\(id\) ON DELETE CASCADE/u);
  assert.doesNotMatch(migration, /ALTER TABLE public\.ai_generation_events[\s\S]*ADD COLUMN topic_scope_id/u);
});

test("direct table writes remain blocked and no service-role client is introduced", () => {
  assert.match(phaseOneFlashcards, /REVOKE ALL ON public\.flashcard_sets, public\.flashcards FROM authenticated/u);
  assert.match(phaseOneFlashcards, /GRANT SELECT ON public\.flashcard_sets, public\.flashcards TO authenticated/u);
  assert.match(scheduling, /REVOKE ALL ON public\.flashcard_reviews FROM authenticated/u);
  assert.match(scheduling, /GRANT SELECT ON public\.flashcard_reviews TO authenticated/u);
  assert.doesNotMatch(migration, /GRANT (?:INSERT|UPDATE|DELETE|ALL).*TO authenticated/iu);
  assert.doesNotMatch(functions, /SUPABASE_SERVICE_ROLE_KEY|serviceRole/u);
});
