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
    if (context.parentURL?.endsWith("/questions.functions.ts") || context.parentURL?.endsWith("/flashcards.functions.ts")) {
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

async function inputFor(source: string) {
  const document = { id: documentId, user_id: userId, title: "Synthetic source", extracted_text: source };
  const topic = {
    id: topicId, user_id: userId, document_id: documentId, title: "Synthetic topic",
    source_ranges: [{ start: 0, end: Array.from(source).length }],
    source_hash: await hashTopicSource(source),
  };
  const supabase = {
    from(table: string) {
      let rows: Row[] = table === "documents" ? [document] : table === "document_topics" ? [topic] : [];
      const query = {
        select() { return query; },
        eq(field: string, value: unknown) { rows = rows.filter((row) => row[field] === value); return query; },
        is(field: string, value: unknown) { return query.eq(field, value); },
        order() { return query; },
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
hooks.deregister();
const readQuestions = getDocumentQuestions as unknown as ReadHandler;
const readFlashcards = getDocumentFlashcards as unknown as ReadHandler;

test("current shared reconstruction uses 80 non-whitespace UTF-16 units, not code points", async () => {
  async function reconstruct(source: string) {
    return reconstructVerifiedTopicSource({ source, sourceHash: await hashTopicSource(source), sourceRanges: [{ start: 0, end: Array.from(source).length }] });
  }
  await assert.rejects(reconstruct("a".repeat(79)), /TOPIC_SOURCE_UNAVAILABLE/);
  assert.equal(await reconstruct("a".repeat(80)), "a".repeat(80));
  const supplementary = "\u{1f4d8}".repeat(40);
  assert.equal(supplementary.length, 80);
  assert.equal(countTopicSourceCharacters(await reconstruct(supplementary)), 40);
  await assert.rejects(reconstruct(Array(79).fill("a").join(" \t\n")), /TOPIC_SOURCE_UNAVAILABLE/);
});

test("current Topic Questions uses 200 non-whitespace UTF-16 units", async () => {
  await assert.rejects(readQuestions(await inputFor("a".repeat(199))), /TOPIC_QUESTION_SOURCE_INSUFFICIENT/);
  assert.equal((await readQuestions(await inputFor("a".repeat(200)))).current, null);
  await assert.rejects(readQuestions(await inputFor(Array(199).fill("a").join(" \t\n"))), /TOPIC_QUESTION_SOURCE_INSUFFICIENT/);
  const supplementary = "\u{1f4d8}".repeat(100);
  assert.equal(countTopicSourceCharacters(supplementary), 100);
  assert.equal((await readQuestions(await inputFor(supplementary))).current, null);
});

test("current Topic Flashcards uses 200 trimmed UTF-16 units including internal whitespace", async () => {
  await assert.rejects(readFlashcards(await inputFor("a".repeat(199))), /TOPIC_SOURCE_UNAVAILABLE/);
  await assert.rejects(readFlashcards(await inputFor(` \n${"a".repeat(199)}\t `)), /TOPIC_SOURCE_UNAVAILABLE/);
  assert.equal((await readFlashcards(await inputFor("a".repeat(200)))).current, null);
  const spaced = Array(100).fill("a").join("  ");
  assert.equal(countTopicSourceCharacters(spaced), 100);
  assert.equal((await readFlashcards(await inputFor(spaced))).current, null);
  assert.equal((await readFlashcards(await inputFor("\u{1f4d8}".repeat(100)))).current, null);
});
