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
    if (["/questions.functions.ts", "/flashcards.functions.ts", "/summaries.functions.ts", "/document-topics.functions.ts"].some((suffix) => context.parentURL?.endsWith(suffix))) {
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

async function inputFor(source: string, options: { topicLengths?: number[]; sourceHash?: string; sourceRanges?: { start: number; end: number }[]; savedContent?: boolean; savedLocale?: string; owner?: string; missingTopic?: boolean } = {}) {
  const document = { id: documentId, user_id: options.owner ?? userId, title: "Synthetic source", extracted_text: source };
  const topic = {
    id: topicId, user_id: userId, document_id: documentId, title: "Synthetic topic",
    source_ranges: options.sourceRanges ?? [{ start: 0, end: Array.from(source).length }],
    source_hash: options.sourceHash ?? await hashTopicSource(source),
    description: "Synthetic topic description", position: 1, discovery_model: null, created_at: "2026-01-01T00:00:00Z",
  };
  const topics = options.missingTopic ? [] : [topic, ...[2, 3].map((position) => ({ ...topic, id: `00000000-0000-4000-8000-00000000000${position}`, position }))];
  if (options.topicLengths) {
    let start = 0;
    topics.forEach((row, index) => {
      const end = start + options.topicLengths![index]!;
      row.source_ranges = [{ start, end }];
      start = end;
    });
  }
  const set = { id: "saved-set", document_id: documentId, topic_id: topicId, topic_scope_id: topicId, locale: options.savedLocale ?? "en", created_at: topic.created_at, updated_at: topic.created_at, model: null };
  const savedRows: Record<string, Row[]> = options.savedContent ? {
    summaries: [{ ...set, content: { marker: "saved summary" } }],
    question_sets: [{ ...set, kind: "standard", superseded_at: null, questions: [{ question: "Saved question", options: ["A", "B", "C", "D"], correctIndex: 0, explanation: "Saved explanation" }] }],
    flashcard_sets: [set],
    flashcards: [{ id: "saved-card", flashcard_set_id: set.id, front: "Saved front", back: "Saved back", position: 1, due_at: topic.created_at, last_reviewed_at: null, interval_days: 0, repetitions: 0, ease_factor: 2.5 }],
  } : {};
  const supabase = {
    from(table: string) {
      let rows: Row[] = table === "documents" ? [document] : table === "document_topics" ? topics : savedRows[table] ?? [];
      const query = {
        insert() { throw new Error("Unexpected persistence mutation"); },
        update() { throw new Error("Unexpected persistence mutation"); },
        delete() { throw new Error("Unexpected persistence mutation"); },
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
const { getDocumentQuestions, generateDocumentQuestions } = await import("./questions.functions.ts");
const { getDocumentFlashcards, generateDocumentFlashcards } = await import("./flashcards.functions.ts");
const { getDocumentSummary } = await import("./summaries.functions.ts");
const { getDocumentTopic, getDocumentTopics, discoverDocumentTopics } = await import("./document-topics.functions.ts");
hooks.deregister();
const readQuestions = getDocumentQuestions as unknown as ReadHandler;
const readFlashcards = getDocumentFlashcards as unknown as ReadHandler;
const readSummary = getDocumentSummary as unknown as ReadHandler;
const generateQuestions = generateDocumentQuestions as unknown as ReadHandler;
const generateFlashcards = generateDocumentFlashcards as unknown as ReadHandler;
const readTopic = getDocumentTopic as unknown as (input: Awaited<ReturnType<typeof inputFor>>) => Promise<{ capabilities: { summary: boolean; questions: boolean; flashcards: boolean } }>;

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

const readTopics = getDocumentTopics as unknown as (input: Awaited<ReturnType<typeof inputFor>>) => Promise<{ topics: { id: string; position: number }[]; sourceState: string }>;

for (const length of [199, 200, 201]) {
  test(`studyable visibility uses the verified canonical ${length}-character boundary without writes, quota or providers`, async () => {
    const input = await inputFor("a".repeat(length));
    const before = await input.context.supabase.from("document_topics").select();
    const result = await readTopics(input);
    assert.equal(result.topics.length, length < 200 ? 0 : 3);
    if (length < 200) {
      assert.equal(result.sourceState, "insufficient");
      await assert.rejects(readTopic(input), /^Error: TOPIC_SOURCE_UNAVAILABLE$/);
    } else {
      assert.deepEqual((await readTopic(input)).capabilities, { summary: true, questions: true, flashcards: true });
    }
    assert.deepEqual(await input.context.supabase.from("document_topics").select(), before);
  });
}

test("mixed saved 120/200/350 topics expose only studyable choices without changing persisted rows", async () => {
  const input = await inputFor("a".repeat(670), { topicLengths: [120, 200, 350] });
  const result = await readTopics(input);
  assert.deepEqual(result.topics.map(topic => topic.position), [2, 3]);
  assert.equal((await input.context.supabase.from("document_topics").select()).data.length, 3);
  for (const topic of result.topics) {
    assert.deepEqual((await readTopic({ ...input, data: { ...input.data, topicId: topic.id } })).capabilities, { summary: true, questions: true, flashcards: true });
  }
});

test("all-small saved topics use insufficient recovery without automatic generation; integrity is checked before filtering", async () => {
  const input = await inputFor("a".repeat(360), { topicLengths: [120, 120, 120] });
  assert.deepEqual((await readTopics(input)).topics, []);
  assert.equal((await readTopics(input)).sourceState, "insufficient");
  await assert.rejects(readTopics(await inputFor("a".repeat(199), { sourceRanges: [{ start: 0, end: 200 }] })), /INVALID_TOPIC_SOURCE_RANGE/);
  await assert.rejects(readTopics(await inputFor("a".repeat(199), { sourceHash: "0".repeat(64) })), /STALE_TOPIC_SOURCE/);
  assert.equal((await readTopics(await inputFor(Array(199).fill("\u{1f4d8}").join(" \t\n")))).topics.length, 0);
});

test("write-once Discovery cache reuses all-small legacy rows without providers, reservations or persistence", async () => {
  const source = ["Alpha", "Beta", "Gamma"].map(title => `# ${title}\n${"a".repeat(250)}`).join("\n\n");
  const input = await inputFor(source, { topicLengths: [120, 120, 120] });
  const before = await input.context.supabase.from("document_topics").select();
  const discover = discoverDocumentTopics as unknown as (request: typeof input) => Promise<{ reused: boolean; topics: unknown[]; sourceState: string }>;
  const result = await discover(input);
  assert.equal(result.reused, true);
  assert.deepEqual(result.topics, []);
  assert.equal(result.sourceState, "insufficient");
  assert.deepEqual(await input.context.supabase.from("document_topics").select(), before);
});

test("Topic Questions requires 200 non-whitespace code points, not UTF-16 units", async () => {
  await assert.rejects(generateQuestions(await inputFor("a".repeat(199))), /TOPIC_QUESTION_SOURCE_INSUFFICIENT/);
  await assert.rejects(generateQuestions(await inputFor("a".repeat(200))), /Unexpected generation/);
  await assert.rejects(generateQuestions(await inputFor(Array(199).fill("a").join(" \t\n"))), /TOPIC_QUESTION_SOURCE_INSUFFICIENT/);
  const supplementary = "\u{1f4d8}".repeat(100);
  assert.equal(countTopicSourceCharacters(supplementary), 100);
  await assert.rejects(generateQuestions(await inputFor(supplementary)), /TOPIC_QUESTION_SOURCE_INSUFFICIENT/);
  await assert.rejects(generateQuestions(await inputFor("\u{1f4d8}".repeat(200))), /Unexpected generation/);
});

test("Topic Flashcards requires 200 non-whitespace code points; whitespace cannot inflate eligibility", async () => {
  await assert.rejects(generateFlashcards(await inputFor("a".repeat(199))), /TOPIC_SOURCE_UNAVAILABLE/);
  await assert.rejects(generateFlashcards(await inputFor(` \n${"a".repeat(199)}\t `)), /TOPIC_SOURCE_UNAVAILABLE/);
  await assert.rejects(generateFlashcards(await inputFor("a".repeat(200))), /Unexpected generation/);
  const spaced = Array(100).fill("a").join("  ");
  assert.equal(countTopicSourceCharacters(spaced), 100);
  await assert.rejects(generateFlashcards(await inputFor(spaced)), /TOPIC_SOURCE_UNAVAILABLE/);
  await assert.rejects(generateFlashcards(await inputFor("\u{1f4d8}".repeat(100))), /TOPIC_SOURCE_UNAVAILABLE/);
  await assert.rejects(generateFlashcards(await inputFor("\u{1f4d8}".repeat(200))), /Unexpected generation/);
});

for (const length of [79, 80, 199, 200]) {
  test(`topic read handlers enforce canonical ${length}-character capabilities without generation`, async () => {
    const input = await inputFor("a".repeat(length));
    if (length < 80) {
      for (const read of [readSummary, readQuestions, readFlashcards, readTopic]) {
        await assert.rejects(read(input), /^Error: TOPIC_SOURCE_UNAVAILABLE$/);
      }
    } else {
      assert.equal((await readSummary(input)).current, null);
      assert.equal((await readQuestions(input)).current, null);
      assert.equal((await readFlashcards(input)).current, null);
      if (length < 200) await assert.rejects(readTopic(input), /^Error: TOPIC_SOURCE_UNAVAILABLE$/);
      else assert.deepEqual((await readTopic(input)).capabilities, { summary: true, questions: true, flashcards: true });
    }
  });
}

test("199 canonical characters plus heavy internal whitespace remain Summary-only", async () => {
  const input = await inputFor(` \t${Array(199).fill("a").join(" \t\r\n".repeat(20))}\r\n `);
  assert.equal((await readSummary(input)).current, null);
  await assert.rejects(readTopic(input), /^Error: TOPIC_SOURCE_UNAVAILABLE$/);
  await assert.rejects(generateQuestions(input), /^Error: TOPIC_QUESTION_SOURCE_INSUFFICIENT$/);
  await assert.rejects(generateFlashcards(input), /^Error: TOPIC_SOURCE_UNAVAILABLE$/);
});

test("integrity errors precede capability errors in every topic read handler", async () => {
  for (const read of [readSummary, readQuestions, readFlashcards, readTopic]) {
    await assert.rejects(read(await inputFor("a".repeat(79), { sourceHash: "0".repeat(64) })), /^Error: STALE_TOPIC_SOURCE$/);
    await assert.rejects(read(await inputFor("a".repeat(79), { sourceRanges: [{ start: 0, end: 80 }] })), /^Error: INVALID_TOPIC_SOURCE_RANGE$/);
  }
});

test("topic capabilities use code points and expose no reconstructed source", async () => {
  await assert.rejects(readTopic(await inputFor("\u{1f4d8}".repeat(79))), /^Error: TOPIC_SOURCE_UNAVAILABLE$/);
  await assert.rejects(readTopic(await inputFor("\u{1f4d8}".repeat(100))), /^Error: TOPIC_SOURCE_UNAVAILABLE$/);
  const result = await readTopic(await inputFor("\u{1f4d8}".repeat(200)));
  assert.deepEqual(result.capabilities, { summary: true, questions: true, flashcards: true });
  assert.deepEqual(Object.keys(result).sort(), ["capabilities", "document", "topic"]);
  assert.deepEqual((await readTopic(await inputFor("\u{1f4d8}".repeat(200)))).capabilities, { summary: true, questions: true, flashcards: true });
});

test("legacy saved Summary, Questions and Flashcards remain readable without generation", async () => {
  for (const length of [80, 199]) {
    const input = await inputFor("a".repeat(length), { savedContent: true });
    await assert.rejects(readTopic(input), /^Error: TOPIC_SOURCE_UNAVAILABLE$/);
    for (const read of [readSummary, readQuestions, readFlashcards]) {
      assert.ok((await read(input)).current);
    }
    await assert.rejects(generateQuestions(input), /TOPIC_QUESTION_SOURCE_INSUFFICIENT/);
    await assert.rejects(generateFlashcards(input), /TOPIC_SOURCE_UNAVAILABLE/);
  }
});

test("legacy topics keep alternate-locale and und saved content accessible", async () => {
  for (const savedLocale of ["pt-BR", "und"]) {
    const input = await inputFor("a".repeat(80), { savedContent: true, savedLocale });
    for (const read of [readSummary, readQuestions, readFlashcards]) {
      const result = await read(input) as { current: unknown; alternatives: { locale: string }[] };
      assert.equal(result.current, null);
      assert.equal(result.alternatives.length, 1);
      assert.equal(result.alternatives[0]?.locale, savedLocale);
    }
  }
});

test("topic capabilities reject inaccessible documents and missing topics", async () => {
  await assert.rejects(readTopic(await inputFor("a".repeat(200), { owner: "another-user" })), /^Error: TOPIC_DOCUMENT_NOT_FOUND$/);
  await assert.rejects(readTopic(await inputFor("a".repeat(200), { missingTopic: true })), /^Error: TOPIC_NOT_FOUND$/);
});
