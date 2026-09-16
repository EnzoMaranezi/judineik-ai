import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// Replace transport/auth and unused generation dependencies only. The actual
// session validator, handler and ownership helper execute against the boundary fake.
const stubUrl = `data:text/javascript,${encodeURIComponent(`
  const unused = () => { throw new Error("Unexpected non-session dependency"); };
  export const requireSupabaseAuth = {};
  export function createServerFn() {
    let validate;
    const builder = {
      middleware() { return builder; },
      inputValidator(fn) { validate = fn; return builder; },
      handler(fn) { return ({ data, context }) => fn({ data: validate(data), context }); }
    };
    return builder;
  }
  export const generateAiText = unused, getAiLocaleContext = unused, normalizeAiError = unused;
  export const finishAiGeneration = unused, isAiGenerationInProgressError = unused;
  export const isAiDailyLimitError = unused, reserveAiGeneration = unused;
  export const isLocale = unused, languageInstruction = unused;
  export const parseTopicSummarySourceRanges = unused, reconstructVerifiedTopicSource = unused;
  export const MARKDOWN_QUESTION_FORMAT = "", PRACTICE_QUESTION_SYSTEM_PROMPT = "", QUESTION_SYSTEM_PROMPT = "";
`)}`;
const serviceUrl = new URL("./questions.functions.ts", import.meta.url).href;
const stubbed = new Set([
  "@tanstack/react-start", "@/integrations/supabase/auth-middleware",
  "@/lib/ai-gateway.server", "@/lib/ai-usage-limit.server", "@/lib/i18n",
  "@/lib/topic-summary-source", "@/lib/questions.prompt",
]);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === serviceUrl) {
      if (stubbed.has(specifier)) return { url: stubUrl, shortCircuit: true };
      if (specifier.startsWith("@/lib/")) {
        return {
          url: new URL(`${specifier.slice("@/lib/".length)}.ts`, import.meta.url).href,
          shortCircuit: true,
        };
      }
    }
    return nextResolve(specifier, context);
  },
});
type Row = Record<string, unknown>;
type SaveBoundary = (input: {
  data: unknown;
  context: { userId: string; supabase: ReturnType<typeof database> };
}) => Promise<{ id: string; accuracy: number; completedAt: string }>;
let save: SaveBoundary;
try {
  ({ saveQuestionSession: save } = await import(serviceUrl));
} finally {
  hooks.deregister();
}

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";
const DOCUMENT = "33333333-3333-4333-8333-333333333333";
const OTHER_DOCUMENT = "44444444-4444-4444-8444-444444444444";
const SET = "55555555-5555-4555-8555-555555555555";
const SESSION = "66666666-6666-4666-8666-666666666666";

function submission() {
  return {
    documentId: DOCUMENT, questionSetId: SET,
    totalQuestions: 3, correctAnswers: 2, startedAt: "2026-09-16T12:00:00.000Z",
    answers: [0, 1, 2].map((questionIndex) => ({
      questionIndex, selectedIndex: questionIndex < 2 ? 0 : 1,
      correctIndex: 0, correct: questionIndex < 2,
      answeredAt: "2026-09-16T12:01:00.000Z",
    })),
  };
}

function database() {
  const tables: Record<string, Row[]> = {
    documents: [{ id: DOCUMENT, user_id: USER }],
    question_sets: [{
      id: SET, user_id: USER, document_id: DOCUMENT,
      questions: [0, 1, 2].map(() => ({ correctIndex: 0, options: ["A", "B", "C", "D"] })),
    }],
    question_sessions: [],
  };
  const reads: Array<{ table: string; columns: string }> = [];
  const writes: Array<{ operation: string; payload: Row }> = [];
  return {
    tables, reads, writes,
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let columns = "";
      let operation = "";
      let payload: Row = {};
      const query = {
        select(value: string) { columns = value; return query; },
        eq(column: string, value: unknown) { filters.push([column, value]); return query; },
        is(column: string, value: unknown) { filters.push([column, value]); return query; },
        insert(value: Row) { operation = "insert"; payload = value; return query; },
        update(value: Row) { operation = "update"; payload = value; return query; },
        async maybeSingle() {
          reads.push({ table, columns });
          const row = tables[table]!.find((candidate) => filters.every(([key, value]) => candidate[key] === value));
          const projected = row && Object.fromEntries(columns.split(",").map((key) => [key.trim(), row[key.trim()]]));
          return { data: projected ?? null, error: null };
        },
        async single() {
          assert.equal(table, "question_sessions");
          assert.ok(operation === "insert" || operation === "update");
          let row: Row;
          if (operation === "update") {
            const existing = tables[table]!.find((candidate) => filters.every(([key, value]) => candidate[key] === value));
            if (!existing) return { data: null, error: { message: "No matching session" } };
            Object.assign(existing, payload);
            row = existing;
          } else {
            row = { id: SESSION, ...payload };
            tables[table]!.push(row);
          }
          writes.push({ operation, payload });
          return { data: row, error: null };
        },
      };
      return query;
    },
  };
}

function persist(db: ReturnType<typeof database>, data: unknown = submission()) {
  return save({ data, context: { userId: USER, supabase: db } });
}

test("a valid completed session persists submitted answers/counts with authenticated ownership and rounded accuracy", async () => {
  const db = database();
  const data = submission();
  const result = await persist(db, { ...data, userId: OTHER_USER });
  const row = db.tables["question_sessions"]![0]!;
  assert.equal(row["user_id"], USER);
  assert.equal(row["document_id"], DOCUMENT);
  assert.equal(row["question_set_id"], SET);
  assert.equal(row["total_questions"], 3);
  assert.equal(row["correct_answers"], 2);
  assert.equal(row["accuracy"], 67);
  assert.deepEqual(row["answers"], data.answers);
  assert.equal(row["started_at"], data.startedAt);
  assert.ok(Number.isFinite(Date.parse(String(row["completed_at"]))));
  assert.deepEqual(result, { id: SESSION, accuracy: 67, completedAt: row["completed_at"] });
});

test("correctness and aggregate counts are trusted independently rather than recomputed from canonical questions", async () => {
  const db = database();
  const data = submission();
  data.correctAnswers = 2;
  data.answers = data.answers.map((answer) => ({ ...answer, selectedIndex: 1, correctIndex: 1, correct: true }));
  await persist(db, data);
  const row = db.tables["question_sessions"]![0]!;
  assert.equal(row["correct_answers"], 2);
  assert.equal(row["accuracy"], 67);
  assert.deepEqual(row["answers"], data.answers);
  assert.deepEqual(db.reads, [
    { table: "documents", columns: "id, user_id" },
    { table: "question_sets", columns: "id, user_id, document_id" },
  ]);
});

test("structure validation does not enforce totals/answer coverage, index bounds or timestamp formats", async () => {
  const db = database();
  await persist(db, {
    ...submission(), totalQuestions: 1, correctAnswers: 2, startedAt: "not-a-date",
    answers: [{ questionIndex: 99, selectedIndex: 99, correctIndex: 99, correct: true, answeredAt: "not-a-date" }],
  });
  assert.equal(db.writes[0]!.payload["accuracy"], 200);
});

test("questionSetId is optional and an empty submitted answer array passes the current validator", async () => {
  const db = database();
  const { questionSetId: _omitted, ...data } = submission();
  await persist(db, { ...data, answers: [] });
  assert.equal(db.writes[0]!.payload["question_set_id"], null);
  assert.deepEqual(db.writes[0]!.payload["answers"], []);
  assert.equal(db.reads.length, 1);
});

test("missing/foreign documents and missing/foreign/cross-document sets are rejected before writing", async (t) => {
  for (const scenario of ["missing document", "foreign document", "missing set", "foreign set", "cross-document set"]) {
    await t.test(scenario, async () => {
      const db = database();
      if (scenario === "missing document") db.tables["documents"] = [];
      if (scenario === "foreign document") db.tables["documents"]![0]!["user_id"] = OTHER_USER;
      if (scenario === "missing set") db.tables["question_sets"] = [];
      if (scenario === "foreign set") db.tables["question_sets"]![0]!["user_id"] = OTHER_USER;
      if (scenario === "cross-document set") db.tables["question_sets"]![0]!["document_id"] = OTHER_DOCUMENT;
      await assert.rejects(persist(db), scenario.includes("document") && !scenario.includes("set")
        ? /Document not found/ : /Question set does not belong/);
      assert.deepEqual(db.writes, []);
    });
  }
});

test("clearly invalid input is rejected by the actual session validator before any database operation", async (t) => {
  const invalid = [
    { ...submission(), documentId: "invalid" },
    { ...submission(), questionSetId: "invalid" },
    { ...submission(), sessionId: "invalid" },
    { ...submission(), totalQuestions: 0 },
    { ...submission(), correctAnswers: -1 },
    { ...submission(), totalQuestions: 1.5 },
    { ...submission(), answers: [{ ...submission().answers[0], correct: "true" }] },
    { ...submission(), answers: [{ ...submission().answers[0], questionIndex: -1 }] },
  ];
  for (const [index, data] of invalid.entries()) {
    await t.test(`invalid structure ${index + 1}`, async () => {
      const db = database();
      await assert.rejects(async () => persist(db, data), { name: "ZodError" });
      assert.deepEqual(db.reads, []);
      assert.deepEqual(db.writes, []);
    });
  }
});

test("completion updates only the specified owned unfinished session", async (t) => {
  for (const scenario of ["unfinished", "foreign", "completed", "missing"]) {
    await t.test(scenario, async () => {
      const db = database();
      if (scenario !== "missing") db.tables["question_sessions"]!.push({
        id: SESSION, user_id: scenario === "foreign" ? OTHER_USER : USER,
        completed_at: scenario === "completed" ? "2026-09-15T12:00:00.000Z" : null,
      });
      if (scenario === "unfinished") {
        await persist(db, { ...submission(), sessionId: SESSION });
        assert.equal(db.writes[0]!.operation, "update");
        assert.equal(db.tables["question_sessions"]!.length, 1);
      } else {
        const before = structuredClone(db.tables["question_sessions"]);
        await assert.rejects(persist(db, { ...submission(), sessionId: SESSION }), /No matching session/);
        assert.deepEqual(db.tables["question_sessions"], before);
        assert.deepEqual(db.writes, []);
      }
    });
  }
});
