import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";
import { hasDocumentSummary } from "../services/document-summary-readiness.ts";

// Keep the real availability/query implementations; replace transport, auth
// and generation so these tests cannot contact Supabase or an AI provider.
const stubUrl = `data:text/javascript,${encodeURIComponent(`
  export const state = { db: null };
  export const supabase = { from: (...args) => state.db.from(...args) };
  export const requireSupabaseAuth = {};
  export function createServerFn() {
    let validate = value => value;
    const builder = {
      middleware() { return builder; },
      inputValidator(fn) { validate = fn; return builder; },
      handler(fn) { return ({ data, context }) => fn({ data: validate(data), context }); }
    };
    return builder;
  }
  const unavailable = () => { throw new Error("UNCACHED_GENERATION_BOUNDARY"); };
  export const extractDocumentText = unavailable, generateAiText = unavailable;
  export const finishAiGeneration = unavailable, reserveAiGeneration = unavailable;
  export const isAiGenerationInProgressError = () => false, isAiDailyLimitError = () => false;
  export const normalizeAiError = error => error;
  export const getUserLocale = metadata => metadata?.locale ?? "en";
  export const getAiLocaleContext = claims => ({ locale: getUserLocale(claims.user_metadata), languageInstruction: "" });
`)}`;
const urls = [
  new URL("../services/documentService.ts", import.meta.url).href,
  new URL("./progress.functions.ts", import.meta.url).href,
  new URL("./summaries.functions.ts", import.meta.url).href,
];
const mocked = new Set([
  "@tanstack/react-start", "@/lib/supabase", "@/lib/documents.functions",
  "@/integrations/supabase/auth-middleware", "@/lib/ai-gateway.server",
  "@/lib/ai-usage-limit.server", "@/lib/i18n",
]);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (urls.includes(context.parentURL ?? "")) {
      if (mocked.has(specifier)) return { url: stubUrl, shortCircuit: true };
      if (specifier.startsWith("@/lib/")) {
        return { url: new URL(`${specifier.slice("@/lib/".length)}.ts`, import.meta.url).href, shortCircuit: true };
      }
      if (specifier.startsWith("./") && !specifier.endsWith(".ts")) {
        return { url: new URL(`${specifier}.ts`, context.parentURL).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});
type Row = Record<string, unknown>;
type Context = { supabase: ReturnType<typeof database>; userId: string; claims: { user_metadata: { locale: string } } };
type SummaryRead = { current: { id: string } | null; alternatives: Array<{ id: string }> };
let listDocuments: () => Promise<Array<{ hasSummary: boolean }>>;
let renameDocument: (id: string, title: string) => Promise<{ hasSummary: boolean }>;
let getStudySession: (input: { data: { sessionId: string }; context: Context }) => Promise<{ hasSummary: boolean } | null>;
let getDocumentSummary: (input: { data: { documentId: string; topicId?: string }; context: Context }) => Promise<SummaryRead>;
let generateDocumentSummary: (input: { data: { documentId: string }; context: Context }) => Promise<{ reused: boolean; id: string }>;
let state: { db: ReturnType<typeof database> };
try {
  ({ listDocuments, renameDocument } = await import(urls[0]!));
  ({ getStudySession } = await import(urls[1]!));
  ({ getDocumentSummary, generateDocumentSummary } = await import(urls[2]!));
  ({ state } = await import(stubUrl));
} finally {
  hooks.deregister();
}

const USER = "11111111-1111-4111-8111-111111111111";
const DOCUMENT = "22222222-2222-4222-8222-222222222222";
const TOPIC = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";
const SOURCE = "Synthetic academic text explaining probability and distributions. ".repeat(8);

function summary(id: string, topic_id: string | null, locale = "pt-BR"): Row {
  return {
    id, topic_id, locale, document_id: DOCUMENT,
    created_at: "2026-09-16T12:00:00.000Z", updated_at: "2026-09-16T12:00:00.000Z",
    content: { title: id, keyConcepts: [], explanations: [], definitions: [], relationships: [], review: "Synthetic review" },
  };
}

function database(summaries: Row[]) {
  const document = {
    id: DOCUMENT, user_id: USER, title: "Synthetic material", file_url: null,
    status: "processed", extracted_text: SOURCE, created_at: "2026-09-16T12:00:00.000Z",
    summaries,
  };
  const tables: Record<string, Row[]> = {
    documents: [document], summaries,
    document_topics: [{
      id: TOPIC, user_id: USER, document_id: DOCUMENT, title: "Synthetic topic",
      source_ranges: [{ start: 0, end: SOURCE.length }],
      source_hash: createHash("sha256").update(SOURCE).digest("hex"),
    }],
    question_sessions: [{
      id: SESSION, user_id: USER, document_id: DOCUMENT, question_set_id: null,
      documents: { title: document.title }, question_sets: null, answers: [],
      total_questions: 1, correct_answers: 1, accuracy: 100, completed_at: document.created_at,
    }],
  };
  const queries: Array<{ table: string; columns: string; filters: Array<[string, unknown]> }> = [];
  return {
    queries,
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let columns = "";
      let limit = Infinity;
      let update: Row | undefined;
      const execute = () => {
        queries.push({ table, columns, filters: [...filters] });
        const rows = tables[table]!.filter((row) => filters.every(([key, value]) => row[key] === value)).slice(0, limit);
        if (update) rows.forEach((row) => Object.assign(row, update));
        return { data: rows, error: null };
      };
      const query = {
        select(value: string) { columns = value; return query; },
        eq(key: string, value: unknown) { filters.push([key, value]); return query; },
        is(key: string, value: unknown) { filters.push([key, value]); return query; },
        order() { return query; },
        limit(value: number) { limit = value; return query; },
        abortSignal() { return query; },
        update(value: Row) { update = value; return query; },
        async maybeSingle() { const result = execute(); return { ...result, data: result.data[0] ?? null }; },
        async single() { return query.maybeSingle(); },
        then(resolve: (result: ReturnType<typeof execute>) => unknown) { return Promise.resolve(execute()).then(resolve); },
      };
      return query;
    },
  };
}

function context(db: ReturnType<typeof database>, locale = "pt-BR"): Context {
  return { supabase: db, userId: USER, claims: { user_metadata: { locale } } };
}

const cases = [
  { name: "none", rows: [], documentReady: false, replayReady: false },
  { name: "document only", rows: [summary("document-summary", null)], documentReady: true, replayReady: true },
  { name: "topic only", rows: [summary("topic-summary", TOPIC)], documentReady: false, replayReady: true },
  { name: "both", rows: [summary("topic-summary", TOPIC), summary("other-topic", "other-topic"), summary("document-summary", null)], documentReady: true, replayReady: true },
];

for (const scenario of cases) {
  test(`Summary scope (${scenario.name}): helper, list and rename require document scope; replay accepts any scope`, async () => {
    const db = database(scenario.rows);
    state.db = db;
    assert.equal(hasDocumentSummary(scenario.rows as Array<{ topic_id: string | null }>), scenario.documentReady);
    assert.equal((await listDocuments())[0]!.hasSummary, scenario.documentReady);
    assert.equal((await renameDocument(DOCUMENT, "Renamed synthetic material")).hasSummary, scenario.documentReady);
    assert.equal((await getStudySession({ data: { sessionId: SESSION }, context: context(db) }))!.hasSummary, scenario.replayReady);
    assert.deepEqual(db.queries.find((query) => query.table === "summaries")!.filters, [["document_id", DOCUMENT]]);
  });

  test(`Summary read/cache (${scenario.name}) excludes topics from document availability`, async () => {
    const db = database(scenario.rows);
    const result = await getDocumentSummary({ data: { documentId: DOCUMENT }, context: context(db) });
    assert.equal(result.current?.id ?? null, scenario.documentReady ? "document-summary" : null);
    assert.deepEqual(result.alternatives, []);
    assert.deepEqual(db.queries[0]!.filters, [["document_id", DOCUMENT], ["topic_id", null]]);
    const request = { data: { documentId: DOCUMENT }, context: context(db) };
    if (scenario.documentReady) {
      const cached = await generateDocumentSummary(request);
      assert.equal(cached.reused, true);
      assert.equal(cached.id, "document-summary");
    } else {
      await assert.rejects(generateDocumentSummary(request), /UNCACHED_GENERATION_BOUNDARY/);
    }
    const cacheQuery = db.queries.filter((query) => query.table === "summaries").at(-1)!;
    assert.deepEqual(cacheQuery.filters, [["document_id", DOCUMENT], ["locale", "pt-BR"], ["topic_id", null]]);
  });
}

test("document readiness/replay ignore locale while Summary reads expose other-locale and legacy document rows as alternatives", async () => {
  for (const locale of ["en", "und"]) {
    const db = database([summary("alternate-document", null, locale), summary("active-topic", TOPIC)]);
    state.db = db;
    assert.equal((await listDocuments())[0]!.hasSummary, true);
    assert.equal((await renameDocument(DOCUMENT, "Renamed")).hasSummary, true);
    assert.equal((await getStudySession({ data: { sessionId: SESSION }, context: context(db) }))!.hasSummary, true);
    const result = await getDocumentSummary({ data: { documentId: DOCUMENT }, context: context(db) });
    assert.equal(result.current, null);
    assert.deepEqual(result.alternatives.map((variant) => variant.id), ["alternate-document"]);
  }
});

test("topic Summary reads select exactly the requested topic, excluding document and other-topic rows", async () => {
  const db = database([summary("document", null), summary("selected-topic", TOPIC), summary("other-topic", "other-topic")]);
  const result = await getDocumentSummary({ data: { documentId: DOCUMENT, topicId: TOPIC }, context: context(db) });
  assert.equal(result.current?.id, "selected-topic");
  assert.deepEqual(result.alternatives, []);
  assert.deepEqual(db.queries.at(-1)!.filters, [["document_id", DOCUMENT], ["topic_id", TOPIC]]);
});
