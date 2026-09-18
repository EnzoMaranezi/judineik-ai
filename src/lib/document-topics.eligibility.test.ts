import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { parseTopicDiscoveryResponse } from "./document-topics.parser.ts";
import { reconstructTopicSource, segmentDocumentSource, topicSegmentToken } from "./document-topics.source.ts";
import { countTopicSourceCharacters } from "./topic-source-eligibility.ts";

function fixture(parts: string[], groups: number[][] = [[0], [1], [2]]) {
  const source = parts.join("\n\n");
  let offset = 0;
  const segments = parts.map((part, index) => {
    const start = offset;
    offset += Array.from(part).length + 2;
    return { id: `S${String(index + 1).padStart(3, "0")}`, start, end: offset - 2, text: "Deliberately unrelated segment display text" };
  });
  const output = JSON.stringify({ topics: groups.map((indexes, index) => ({
    title: ["Processes", "Scheduling", "Synchronization"][index] ?? `Topic ${index}`,
    description: "An academic description of this assigned source topic.",
    segmentIds: indexes.map((i) => topicSegmentToken(segments[i]!.id)),
    coreSegmentIds: [topicSegmentToken(segments[indexes[0]!]!.id)],
  })) });
  return { source, segments, output };
}

function parse(parts: string[], groups?: number[][]) {
  const { source, segments, output } = fixture(parts, groups);
  return parseTopicDiscoveryResponse(output, source, segments);
}

for (const length of [199, 200, 201]) {
  test(`new Discovery topic canonical ${length}-character boundary uses exact persisted ranges`, () => {
    const data = fixture(["a".repeat(200), "b".repeat(200), "c".repeat(length)]);
    const run = () => parseTopicDiscoveryResponse(data.output, data.source, data.segments);
    if (length < 200) assert.throws(run, /^Error: TOPIC_SOURCE_TOO_SHORT$/);
    else {
      const topics = run();
      assert.equal(topics.length, 3);
      assert.equal(countTopicSourceCharacters(reconstructTopicSource(data.source, topics[2]!.sourceRanges)), length);
      assert.deepEqual(topics[2]!.sourceRanges, [{ start: data.segments[2]!.start, end: data.segments[2]!.end }]);
    }
  });
}

test("internal whitespace and supplementary Unicode cannot inflate new-topic size", () => {
  const spaced = Array(199).fill("a").join(" \t\r\n".repeat(10));
  assert.ok(spaced.trim().length > 200);
  assert.throws(() => parse(["a".repeat(200), "b".repeat(200), spaced]), /TOPIC_SOURCE_TOO_SHORT/);
  const supplementary = "\u{1f4d8}".repeat(100);
  assert.equal(supplementary.length, 200);
  assert.throws(() => parse(["a".repeat(200), "b".repeat(200), supplementary]), /TOPIC_SOURCE_TOO_SHORT/);
  assert.equal(parse(["a".repeat(200), "b".repeat(200), "\u{1f4d8}".repeat(200)]).length, 3);
});

test("accented Portuguese, formula symbols, punctuation and code count normally", () => {
  const portuguese = "a\u00e7\u00e3o".repeat(50);
  const technical = "\u2211x=2;{y++;}".repeat(20);
  assert.equal(countTopicSourceCharacters(portuguese), 200);
  assert.equal(countTopicSourceCharacters(technical), 220);
  assert.equal(parse([portuguese, technical, "z".repeat(200)]).length, 3);
});

test("full assigned ranges, not only core segments, determine eligibility", () => {
  const parts = ["a".repeat(500), "Professor: ".repeat(4), "b".repeat(200), "c".repeat(200)];
  assert.equal(parse(parts, [[0, 1], [2], [3]]).length, 3);
  assert.throws(() => parse(["a".repeat(200), "b".repeat(200), "Professor:".repeat(12)]), /TOPIC_SOURCE_TOO_SHORT/);
  // Deterministic size is not a semantic metadata filter.
  assert.equal(parse(["a".repeat(200), "b".repeat(200), "Professor:".repeat(20)]).length, 3);
  assert.equal(parse(["a".repeat(120), "Header:".repeat(12), "b".repeat(200), "c".repeat(200)], [[0, 1], [2], [3]]).length, 3);
});

test("3-12 structure and broad-topic rejection remain enforced", () => {
  assert.throws(() => parse(["a".repeat(200), "b".repeat(200), "c".repeat(199)]), /TOPIC_SOURCE_TOO_SHORT/);
  assert.throws(() => parse(["a".repeat(500), "b".repeat(500)], [[0], [1]]), /INVALID_TOPIC_OUTPUT/);
  assert.throws(() => parse(["a".repeat(3000), "b".repeat(200), "c".repeat(200)]), /TOPIC_SOURCE_TOO_BROAD/);
  assert.throws(() => parse(["\u{1f4d8}".repeat(1500), "b".repeat(200), "c".repeat(200)]), /TOPIC_SOURCE_TOO_BROAD/);
});

const stubUrl = `data:text/javascript,${encodeURIComponent(`
  export const state = { output: "", reservations: 0, providers: 0, finalStatuses: [] };
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
  export function normalizeAiError(error) { return error; }
  export async function generateAiText() { state.providers++; return { text: state.output, model: "synthetic-model" }; }
  export async function reserveAiGeneration() { state.reservations++; return "synthetic-reservation"; }
  export async function finishAiGeneration(_db, _user, _reservation, status) { state.finalStatuses.push(status); }
  export function isAiDailyLimitError() { return false; }
  export function isAiGenerationInProgressError() { return false; }
`)}`;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith("/document-topics.functions.ts")) {
      if (["@tanstack/react-start", "@/integrations/supabase/auth-middleware", "@/lib/ai-gateway.server", "@/lib/ai-usage-limit.server"].includes(specifier)) return { url: stubUrl, shortCircuit: true };
      if (specifier.startsWith("@/lib/")) return { url: new URL(`./${specifier.slice("@/lib/".length)}.ts`, import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { discoverDocumentTopics } = await import("./document-topics.functions.ts");
const { state } = await import(stubUrl) as { state: { output: string; reservations: number; providers: number; finalStatuses: string[] } };
hooks.deregister();

test("real Discovery handler logs safe rejection diagnostics before sanitizing, without persistence/retry/quota changes", async (t) => {
  const warnings = t.mock.method(console, "warn", () => {});
  const source = ["# A\n" + "a".repeat(199), "# B\n" + "b".repeat(198), "# C\n" + "c".repeat(197)].join("\n\n");
  assert.equal(countTopicSourceCharacters(source), 600);
  const segments = segmentDocumentSource(source);
  assert.equal(segments.length, 3);
  assert.deepEqual(segments.map(({ start, end }) => countTopicSourceCharacters(reconstructTopicSource(source, [{ start, end }]))), [201, 200, 199]);
  state.output = fixture(["a".repeat(201), "b".repeat(200), "c".repeat(199)]).output;
  state.reservations = 0; state.providers = 0; state.finalStatuses = [];
  const documentId = "22222222-2222-4222-8222-222222222222";
  const userId = "11111111-1111-4111-8111-111111111111";
  let persistenceCalls = 0;
  let extractedText = source;
  const supabase = {
    from(table: string) {
      const query = {
        select() { return query; }, eq() { return query; }, order() { return query; },
        maybeSingle: async () => ({ data: { id: documentId, user_id: userId, title: "Synthetic material", extracted_text: extractedText }, error: null }),
        then(resolve: (value: { data: unknown[]; error: null }) => unknown) { assert.equal(table, "document_topics"); return Promise.resolve({ data: [], error: null }).then(resolve); },
      };
      return query;
    },
    rpc() { persistenceCalls++; throw new Error("Unexpected persistence"); },
  };
  const discover = discoverDocumentTopics as unknown as (input: { data: { documentId: string }; context: { supabase: typeof supabase; userId: string } }) => Promise<unknown>;
  await assert.rejects(discover({ data: { documentId }, context: { supabase, userId } }), /^Error: TOPIC_OUTPUT_INVALID$/);
  assert.equal(persistenceCalls, 0);
  assert.equal(state.reservations, 1);
  assert.equal(state.providers, 1);
  assert.deepEqual(state.finalStatuses, ["succeeded"]);
  assert.deepEqual(warnings.mock.calls.map(call => call.arguments), [[
    "[topic-discovery-parser]",
    JSON.stringify({
      errorCode: "TOPIC_SOURCE_TOO_SHORT", category: "grounding",
      totalSegmentCount: 3, assignedSegmentCount: 3, proposedTopicCount: 3,
      topicIndex: 2, topicSegmentCount: 1, topicSourceCharacters: 199, minimumSourceCharacters: 200,
    }),
  ]]);
  const logged = JSON.stringify(warnings.mock.calls.map(call => call.arguments));
  for (const privateValue of [source, state.output, documentId, userId, "Synthetic material",
    "Processes", "Scheduling", "Synchronization", "An academic description of this assigned source topic."]) {
    assert.ok(!logged.includes(privateValue));
  }
  state.output = "PRIVATE_RAW_PROVIDER_OUTPUT";
  state.reservations = 0; state.providers = 0; state.finalStatuses = [];
  await assert.rejects(discover({ data: { documentId }, context: { supabase, userId } }),
    /^Error: TOPIC_OUTPUT_INVALID$/);
  assert.deepEqual(warnings.mock.calls[1]!.arguments, ["[topic-discovery-parser]", JSON.stringify({
    errorCode: "MALFORMED_TOPIC_OUTPUT", category: "json", totalSegmentCount: 3, assignedSegmentCount: 0,
  })]);
  assert.equal(warnings.mock.calls.length, 2);
  assert.equal(persistenceCalls, 0);
  assert.equal(state.reservations, 1);
  assert.equal(state.providers, 1);
  assert.deepEqual(state.finalStatuses, ["succeeded"]);
  extractedText = source.replace("a", "");
  state.reservations = 0; state.providers = 0; state.finalStatuses = [];
  await assert.rejects(discover({ data: { documentId }, context: { supabase, userId } }), /^Error: TOPIC_SOURCE_INSUFFICIENT$/);
  assert.equal(state.reservations, 0);
  assert.equal(state.providers, 0);
  assert.equal(persistenceCalls, 0);
  assert.deepEqual(state.finalStatuses, []);
  assert.equal(warnings.mock.calls.length, 2);
});
