import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { hashTopicSource } from "./document-topics.source.ts";
import { reconstructVerifiedTopicSource } from "./topic-summary-source.ts";
import { countTopicSourceCharacters } from "./topic-source-eligibility.ts";

// Only infrastructure is stubbed: production source reconstruction and read handlers execute.
const stubUrl = `data:text/javascript,${encodeURIComponent(`
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
  export function getAiLocaleContext() { return { locale: "en" }; }
  export function getUserLocale() { return "en"; }
  export function isLocale(value) { return value === "en" || value === "pt-BR"; }
  export function languageInstruction() { return "Use English."; }
  export function normalizeAiError(error) { return error; }
  export function generateAiText() { throw new Error("Unexpected provider call"); }
  export function reserveAiGeneration() { throw new Error("Unexpected quota reservation"); }
  export function finishAiGeneration() { throw new Error("Unexpected quota finalization"); }
  export function runReservedAiGeneration() { throw new Error("Unexpected generation"); }
  export function isAiDailyLimitError() { return false; }
  export function isAiGenerationInProgressError() { return false; }
`)}`;

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (["/questions.functions.ts", "/flashcards.functions.ts", "/summaries.functions.ts"].some((suffix) => context.parentURL?.endsWith(suffix))) {
      if (["@tanstack/react-start", "@/integrations/supabase/auth-middleware", "@/lib/ai-gateway.server", "@/lib/ai-usage-limit.server", "@/lib/ai-generation-action", "@/lib/i18n"].includes(specifier)) {
        return { url: stubUrl, shortCircuit: true };
      }
      if (specifier.startsWith("@/lib/")) {
        return { url: new URL(`./${specifier.slice("@/lib/".length)}.ts`, import.meta.url).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});

type Row = Record<string, unknown>;
const userId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const topicId = "33333333-3333-4333-8333-333333333333";

async function inputFor(source: string, options: { sourceHash?: string; sourceRanges?: { start: number; end: number }[] } = {}) {
  const document = { id: documentId, user_id: userId, title: "Synthetic source", extracted_text: source };
  const topic = {
    id: topicId, user_id: userId, document_id: documentId, title: "Synthetic topic",
    source_ranges: options.sourceRanges ?? [{ start: 0, end: Array.from(source).length }],
    source_hash: options.sourceHash ?? await hashTopicSource(source),
  };
  const supabase = {
    from(table: string) {
      let rows: Row[] = table === "documents" ? [document] : table === "document_topics" ? [topic] : [];
      const query = {
        select() { return query; },
        eq(field: string, value: unknown) { rows = rows.filter((row) => row[field] === value); return query; },
        is(field: string, value: unknown) { return query.eq(field, value); },
        order() { return query; },
        abortSignal() { return query; },
        maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
        then(resolve: (result: { data: Row[]; error: null }) => unknown) { return Promise.resolve({ data: rows, error: null }).then(resolve); },
      };
      return query;
    },
  };
  return { data: { documentId, topicId }, context: { supabase, userId, claims: {} } };
}

type ReadHandler = (input: Awaited<ReturnType<typeof inputFor>>) => Promise<{ current: unknown }>;
const { getDocumentQuestions } = await import("./questions.functions.ts");
const { getDocumentFlashcards } = await import("./flashcards.functions.ts");
const { getDocumentSummary } = await import("./summaries.functions.ts");
hooks.deregister();
const readQuestions = getDocumentQuestions as unknown as ReadHandler;
const readFlashcards = getDocumentFlashcards as unknown as ReadHandler;
const readSummary = getDocumentSummary as unknown as ReadHandler;

test("shared reconstruction uses the canonical 80-code-point Summary baseline", async () => {
  async function reconstruct(source: string) {
    return reconstructVerifiedTopicSource({ source, sourceHash: await hashTopicSource(source), sourceRanges: [{ start: 0, end: Array.from(source).length }] });
  }
  await assert.rejects(reconstruct("a".repeat(79)), /TOPIC_SOURCE_UNAVAILABLE/);
  assert.equal(await reconstruct("a".repeat(80)), "a".repeat(80));
  const supplementary = "\u{1f4d8}".repeat(40);
  assert.equal(supplementary.length, 80);
  await assert.rejects(reconstruct(supplementary), /TOPIC_SOURCE_UNAVAILABLE/);
  assert.equal(countTopicSourceCharacters(await reconstruct("\u{1f4d8}".repeat(80))), 80);
  await assert.rejects(reconstruct(Array(79).fill("a").join(" \t\n")), /TOPIC_SOURCE_UNAVAILABLE/);
});

test("Topic Questions requires 200 non-whitespace code points, not UTF-16 units", async () => {
  await assert.rejects(readQuestions(await inputFor("a".repeat(199))), /TOPIC_QUESTION_SOURCE_INSUFFICIENT/);
  assert.equal((await readQuestions(await inputFor("a".repeat(200)))).current, null);
  await assert.rejects(readQuestions(await inputFor(Array(199).fill("a").join(" \t\n"))), /TOPIC_QUESTION_SOURCE_INSUFFICIENT/);
  const supplementary = "\u{1f4d8}".repeat(100);
  assert.equal(countTopicSourceCharacters(supplementary), 100);
  await assert.rejects(readQuestions(await inputFor(supplementary)), /TOPIC_QUESTION_SOURCE_INSUFFICIENT/);
  assert.equal((await readQuestions(await inputFor("\u{1f4d8}".repeat(200)))).current, null);
});

test("Topic Flashcards requires 200 non-whitespace code points; whitespace cannot inflate eligibility", async () => {
  await assert.rejects(readFlashcards(await inputFor("a".repeat(199))), /TOPIC_SOURCE_UNAVAILABLE/);
  await assert.rejects(readFlashcards(await inputFor(` \n${"a".repeat(199)}\t `)), /TOPIC_SOURCE_UNAVAILABLE/);
  assert.equal((await readFlashcards(await inputFor("a".repeat(200)))).current, null);
  const spaced = Array(100).fill("a").join("  ");
  assert.equal(countTopicSourceCharacters(spaced), 100);
  await assert.rejects(readFlashcards(await inputFor(spaced)), /TOPIC_SOURCE_UNAVAILABLE/);
  await assert.rejects(readFlashcards(await inputFor("\u{1f4d8}".repeat(100))), /TOPIC_SOURCE_UNAVAILABLE/);
  assert.equal((await readFlashcards(await inputFor("\u{1f4d8}".repeat(200)))).current, null);
});

for (const length of [79, 80, 199, 200]) {
  test(`topic read handlers enforce canonical ${length}-character capabilities without generation`, async () => {
    const input = await inputFor("a".repeat(length));
    if (length < 80) {
      for (const read of [readSummary, readQuestions, readFlashcards]) {
        await assert.rejects(read(input), /^Error: TOPIC_SOURCE_UNAVAILABLE$/);
      }
    } else {
      assert.equal((await readSummary(input)).current, null);
      if (length < 200) {
        await assert.rejects(readQuestions(input), /^Error: TOPIC_QUESTION_SOURCE_INSUFFICIENT$/);
        await assert.rejects(readFlashcards(input), /^Error: TOPIC_SOURCE_UNAVAILABLE$/);
      } else {
        assert.equal((await readQuestions(input)).current, null);
        assert.equal((await readFlashcards(input)).current, null);
      }
    }
  });
}

test("199 canonical characters plus heavy internal whitespace remain Summary-only", async () => {
  const input = await inputFor(` \t${Array(199).fill("a").join(" \t\r\n".repeat(20))}\r\n `);
  assert.equal((await readSummary(input)).current, null);
  await assert.rejects(readQuestions(input), /^Error: TOPIC_QUESTION_SOURCE_INSUFFICIENT$/);
  await assert.rejects(readFlashcards(input), /^Error: TOPIC_SOURCE_UNAVAILABLE$/);
});

test("integrity errors precede capability errors in every topic read handler", async () => {
  for (const read of [readSummary, readQuestions, readFlashcards]) {
    await assert.rejects(read(await inputFor("a".repeat(79), { sourceHash: "0".repeat(64) })), /^Error: STALE_TOPIC_SOURCE$/);
    await assert.rejects(read(await inputFor("a".repeat(79), { sourceRanges: [{ start: 0, end: 80 }] })), /^Error: INVALID_TOPIC_SOURCE_RANGE$/);
  }
});
