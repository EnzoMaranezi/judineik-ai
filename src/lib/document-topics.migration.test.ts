import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/0007_document_topics.sql", import.meta.url),
  "utf8",
);
const functions = readFileSync(new URL("./document-topics.functions.ts", import.meta.url), "utf8");
const materials = readFileSync(new URL("../routes/app.materials.tsx", import.meta.url), "utf8");
const topicsRoute = readFileSync(
  new URL("../routes/app.materials_.$documentId.topics.tsx", import.meta.url),
  "utf8",
);
const i18n = readFileSync(new URL("./i18n.tsx", import.meta.url), "utf8");

const MAX_RANGES_PER_TOPIC = 256;
const MAX_RANGES_TOTAL = 512;

function acceptsPosition(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 12;
}

function acceptsRange(start: unknown, end: unknown, sourceLength: number) {
  return (
    typeof start === "number" &&
    typeof end === "number" &&
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    end > start &&
    end <= sourceLength
  );
}

function acceptsRangeCounts(counts: number[]) {
  return (
    counts.every((count) => count >= 1 && count <= MAX_RANGES_PER_TOPIC) &&
    counts.reduce((total, count) => total + count, 0) <= MAX_RANGES_TOTAL
  );
}

type CachedTopicContract = { position: number; userId: string; sourceHash: string };

function acceptsCachedTopics(rows: CachedTopicContract[], userId: string, sourceHash: string) {
  return (
    rows.length >= 3 &&
    rows.length <= 12 &&
    rows.every((row, index) => row.position === index + 1) &&
    rows.every((row) => row.userId === userId && row.sourceHash === sourceHash)
  );
}

test("creates only the topic foundation schema with document cascade and immutable positions", () => {
  assert.match(migration, /CREATE TABLE public\.document_topics/u);
  assert.match(migration, /document_id uuid NOT NULL REFERENCES public\.documents\(id\) ON DELETE CASCADE/u);
  assert.match(migration, /UNIQUE \(document_id, position\)/u);
  assert.match(migration, /jsonb_typeof\(source_ranges\) = 'array'/u);
  assert.doesNotMatch(migration, /ALTER TABLE public\.(?:summaries|question_sets|flashcard_sets).*topic_id/su);
});

test("allows owner reads only and routes every write through the secure RPC", () => {
  assert.match(migration, /REVOKE ALL ON TABLE public\.document_topics FROM PUBLIC/u);
  assert.match(migration, /REVOKE ALL ON TABLE public\.document_topics FROM anon/u);
  assert.match(migration, /REVOKE ALL ON TABLE public\.document_topics FROM authenticated/u);
  assert.match(migration, /GRANT SELECT ON TABLE public\.document_topics TO authenticated/u);
  assert.match(migration, /USING \(user_id = auth\.uid\(\)\)/u);
  assert.match(migration, /SECURITY DEFINER\s+SET search_path = pg_catalog, public/gu);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.create_document_topics[^;]+ FROM PUBLIC/u);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.create_document_topics[^;]+ FROM anon/u);
  assert.doesNotMatch(functions, /SUPABASE_SERVICE_ROLE_KEY|service_role/u);
});

test("RPC validates ownership, exact SHA-256, ranges, coverage, overlap, and atomic full creation", () => {
  assert.match(migration, /WHERE id = p_document_id\s+AND user_id = v_user_id/u);
  assert.match(migration, /extensions\.digest\(convert_to\(v_source_text, 'UTF8'\), 'sha256'\)/u);
  assert.match(migration, /pg_advisory_xact_lock[\s\S]*:document_topics/u);
  assert.match(
    migration,
    /v_end_value > char_length\(v_source_text\)::numeric/u,
  );
  assert.match(migration, /OVERLAPPING_DOCUMENT_TOPICS/u);
  assert.match(migration, /INSUFFICIENT_TOPIC_SOURCE_COVERAGE/u);
  assert.match(migration, /jsonb_array_length\(p_topics\) NOT BETWEEN 3 AND 12/u);
  assert.doesNotMatch(migration, /EXCEPTION[\s\S]*COMMIT|BEGIN TRANSACTION|COMMIT;/u);
});

test("validates numeric JSON safely before bounded integer conversion", () => {
  assert.match(migration, /v_position_value numeric;/u);
  assert.match(migration, /v_start_value numeric;/u);
  assert.match(migration, /v_end_value numeric;/u);
  assert.match(migration, /v_position_value := \(v_topic->>'position'\)::numeric;/u);
  assert.match(migration, /v_position_value NOT BETWEEN 1 AND 12/u);
  assert.match(migration, /v_end_value > char_length\(v_source_text\)::numeric/u);
  assert.doesNotMatch(migration, /\(v_topic->>'position'\)::integer/u);
  assert.doesNotMatch(migration, /\(v_range->>'(?:start|end)'\)::integer/u);

  for (const value of [2147483648, Number.MAX_SAFE_INTEGER, -1, 1.5, "2147483648", "invalid"]) {
    assert.equal(acceptsPosition(value), false);
  }
  assert.equal(acceptsPosition(12), true);

  for (const [start, end] of [
    [2147483648, 2147483649],
    [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    [-1, 10],
    [0.5, 10],
    ["0", "10"],
    ["invalid", 10],
  ]) {
    assert.equal(acceptsRange(start, end, 100_000), false);
  }
  assert.equal(acceptsRange(0, 100_000, 100_000), true);
});

test("bounds per-topic and total source ranges without rejecting legitimate multi-range topics", () => {
  assert.match(migration, /v_max_ranges_per_topic constant integer := 256;/u);
  assert.match(migration, /v_max_ranges_total constant integer := 512;/u);
  assert.match(migration, /jsonb_array_length\(v_ranges\) NOT BETWEEN 1 AND v_max_ranges_per_topic/u);
  assert.match(migration, /v_total_range_count > v_max_ranges_total/u);

  assert.equal(acceptsRangeCounts([255, 256, 1]), true);
  assert.equal(acceptsRangeCounts([257, 1, 1]), false);
  assert.equal(acceptsRangeCounts([171, 171, 171]), false);
  assert.equal(acceptsRangeCounts([4, 7, 3, 9]), true);
});

test("validates the complete existing cache before reuse", () => {
  assert.match(migration, /count\(DISTINCT position\)/u);
  assert.match(migration, /count\(DISTINCT source_hash\)/u);
  assert.match(migration, /count\(\*\) FILTER \(WHERE user_id <> v_user_id\)/u);
  assert.match(migration, /v_existing_count NOT BETWEEN 3 AND 12/u);
  assert.match(migration, /v_existing_min_position <> 1/u);
  assert.match(migration, /v_existing_max_position <> v_existing_count/u);
  assert.match(migration, /p_topics := v_existing_topics;[\s\S]*IF p_topics IS NULL[\s\S]*FOR v_topic, v_position IN/u);

  const valid = [1, 2, 3].map((position) => ({ position, userId: "owner", sourceHash: "hash" }));
  assert.equal(acceptsCachedTopics(valid, "owner", "hash"), true);
  assert.equal(acceptsCachedTopics(valid.slice(0, 1), "owner", "hash"), false);
  assert.equal(
    acceptsCachedTopics(
      [{ position: 1, userId: "owner", sourceHash: "hash" }, { position: 3, userId: "owner", sourceHash: "hash" }, { position: 4, userId: "owner", sourceHash: "hash" }],
      "owner",
      "hash",
    ),
    false,
  );
  assert.equal(
    acceptsCachedTopics(
      valid.map((row, index) => index === 2 ? { ...row, sourceHash: "other" } : row),
      "owner",
      "hash",
    ),
    false,
  );
  assert.equal(acceptsCachedTopics([], "owner", "hash"), false);
});

test("topic discovery alone may use und while generated-content kinds still require a UI locale", () => {
  assert.match(migration, /p_kind = 'topic_discovery'[\s\S]*p_locale <> 'und'/u);
  assert.match(migration, /ELSIF p_locale NOT IN \('en', 'pt-BR'\)/u);
  assert.match(migration, /v_limit integer := 20/u);
  assert.match(functions, /reserveAiGeneration\(supabase, "topic_discovery", document\.id, "und", userId\)/u);
});

test("server cache and distributed in-progress handling prevent duplicate discovery", () => {
  assert.match(functions, /loadCurrentTopics[\s\S]*runCachedTopicDiscovery/u);
  assert.match(functions, /isGenerationInProgress: isAiGenerationInProgressError/u);
  assert.match(functions, /waitForCached: \(\) => loadCurrentTopics/u);
  assert.match(functions, /TOPIC_GENERATION_WAIT_MS = 5_000/u);
  assert.match(functions, /TOPIC_GENERATION_WAIT_ATTEMPTS = 48/u);
  assert.match(
    functions,
    /export const waitForDocumentTopics[\s\S]*requireSupabaseAuth[\s\S]*loadOwnedDocument[\s\S]*waitForTopics/u,
  );
  assert.match(migration, /kind = p_kind\s+AND locale = p_locale\s+AND status = 'reserved'/u);
});

test("legacy topic UI is retained behind recovery with no Materials entry point", () => {
  assert.doesNotMatch(materials, /materials\.studyTopics/u);
  assert.match(topicsRoute, /beforeLoad: \(\) => \{ throw notFound\(\); \}/u);
  assert.match(topicsRoute, /topics\.notAnalyzed/u);
  assert.match(topicsRoute, /topics\.analyzing/u);
  assert.match(topicsRoute, /AI_GENERATION_IN_PROGRESS[\s\S]*setWaiting\(true\)[\s\S]*waitForDocumentTopics/u);
  assert.match(topicsRoute, /topics\.waiting/u);
  assert.match(topicsRoute, /topics\.cached/u);
  assert.match(i18n, /Another process is analyzing this material\. Waiting for topics\.\.\./u);
  assert.match(i18n, /Outro processo está analisando este material\. Aguardando os tópicos\.\.\./u);
  assert.match(topicsRoute, /\/app\/materials\/\$documentId\/topics\/\$topicId/u);
  assert.doesNotMatch(topicsRoute, /generateDocumentSummary|generateDocumentQuestions|generateDocumentFlashcards/u);
});
