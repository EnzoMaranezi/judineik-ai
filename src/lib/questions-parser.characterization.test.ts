import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import type { StudyQuestion } from "./questions.schema.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const DOCUMENT = "22222222-2222-4222-8222-222222222222";
const STANDARD_SET = "33333333-3333-4333-8333-333333333333";
const SOURCE = "Academic source text about databases, transactions, isolation, recovery, and indexes. ".repeat(8);

const stubUrl = `data:text/javascript,${encodeURIComponent(`
  export const state = { markdown: "" };
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
  export function getAiLocaleContext(claims) {
    return { locale: claims?.user_metadata?.locale ?? "en", languageInstruction: "Use the requested language." };
  }
  export function isLocale(value) {
    return value === "en" || value === "pt-BR";
  }
  export function languageInstruction(locale) {
    return locale === "pt-BR" ? "Use Brazilian Portuguese." : "Use English.";
  }
  export async function generateAiText() {
    return { text: state.markdown, model: "characterization-model" };
  }
  export function normalizeAiError(error) { return error; }
  export async function reserveAiGeneration() { return { reservationId: "questions-parser-reservation" }; }
  export async function finishAiGeneration() {}
  export function isAiGenerationInProgressError() { return false; }
  export function isAiDailyLimitError() { return false; }
  export async function runReservedAiGeneration({ reserve, generate, afterGenerate, finish }) {
    const reservation = await reserve();
    try {
      const generated = await generate();
      const value = await afterGenerate(generated);
      await finish(reservation, "succeeded");
      return value;
    } catch (error) {
      await finish(reservation, "failed");
      throw error;
    }
  }
  export function parseTopicSummarySourceRanges() { return []; }
  export function reconstructVerifiedTopicSource() { return ""; }
  export const QUESTION_SYSTEM_PROMPT = "";
  export const PRACTICE_QUESTION_SYSTEM_PROMPT = "";
  export const MARKDOWN_QUESTION_FORMAT = "";
`)}`;

type Row = Record<string, unknown>;
type QueryResult = { data: Row[]; error: null };

const previousQuestions: StudyQuestion[] = [
  {
    question: "How does locking protect a transaction?",
    options: ["By serializing conflicting writes", "By deleting logs", "By skipping commits", "By disabling indexes"],
    correctIndex: 0,
    explanation: "Locks reduce unsafe concurrent writes.",
  },
  {
    question: "Why does recovery use durable logs?",
    options: ["To rebuild indexes only", "To restore committed changes", "To avoid all reads", "To remove transactions"],
    correctIndex: 1,
    explanation: "Durable logs support recovery after failures.",
  },
];

function createSupabase(options: { seedStandardSet?: boolean } = {}) {
  const document = {
    id: DOCUMENT,
    user_id: USER,
    title: "Questions parser material",
    status: "processed",
    extracted_text: SOURCE,
  };
  const questionSets: Row[] = options.seedStandardSet
    ? [{
        id: STANDARD_SET,
        document_id: DOCUMENT,
        user_id: USER,
        locale: "en",
        kind: "standard",
        questions: previousQuestions,
        source_question_set_id: null,
        topic_id: null,
        topic_scope_id: null,
        superseded_at: null,
        created_at: "2026-09-16T12:00:00.000Z",
      }]
    : [];

  return {
    from(table: string) {
      const filters: Array<[string, unknown, "eq" | "is"]> = [];
      const query = {
        select() {
          return query;
        },
        eq(key: string, value: unknown) {
          filters.push([key, value, "eq"]);
          return query;
        },
        is(key: string, value: unknown) {
          filters.push([key, value, "is"]);
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return query;
        },
        async maybeSingle() {
          const result = execute();
          return { ...result, data: result.data[0] ?? null };
        },
        async single() {
          return query.maybeSingle();
        },
        then(resolve: (result: QueryResult) => unknown) {
          return Promise.resolve(execute()).then(resolve);
        },
      };

      function execute(): QueryResult {
        const rows = table === "documents" ? [document] : table === "question_sets" ? questionSets : [];
        return {
          data: rows.filter((row) =>
            filters.every(([key, value, op]) =>
              op === "is" ? row[key] === value : row[key] === value,
            ),
          ),
          error: null,
        };
      }

      return query;
    },
    async rpc(name: string, payload: Record<string, unknown>) {
      if (name !== "create_question_set_version") throw new Error(`Unexpected RPC: ${name}`);
      const id = `44444444-4444-4444-8444-${String(questionSets.length + 1).padStart(12, "4")}`;
      questionSets.push({
        id,
        document_id: payload["p_document_id"],
        user_id: USER,
        locale: payload["p_locale"],
        kind: payload["p_kind"],
        questions: payload["p_questions"],
        source_question_set_id: payload["p_source_question_set_id"],
        topic_id: payload["p_topic_id"] ?? null,
        topic_scope_id: payload["p_topic_id"] ?? null,
        superseded_at: null,
        created_at: "2026-09-16T12:00:00.000Z",
      });
      return { data: id, error: null };
    },
  };
}

const urls = [new URL("./questions.functions.ts", import.meta.url).href];
const mocked = new Set([
  "@tanstack/react-start",
  "@/integrations/supabase/auth-middleware",
  "@/lib/ai-gateway.server",
  "@/lib/ai-usage-limit.server",
  "@/lib/ai-generation-action",
  "@/lib/i18n",
  "@/lib/topic-summary-source",
  "@/lib/questions.prompt",
]);

let state: { markdown: string };
let generateDocumentQuestions: (input: {
  data: { documentId: string; regenerate?: boolean };
  context: {
    supabase: ReturnType<typeof createSupabase>;
    userId: string;
    claims: { user_metadata: { locale: string } };
  };
}) => Promise<{ questions: StudyQuestion[] }>;
let generatePracticeQuestions: (input: {
  data: { documentId: string; questionSetId: string; wrongIndexes: number[] };
  context: {
    supabase: ReturnType<typeof createSupabase>;
    userId: string;
  };
}) => Promise<{ questions: StudyQuestion[] }>;

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (urls.includes(context.parentURL ?? "")) {
      if (mocked.has(specifier)) return { url: stubUrl, shortCircuit: true };
      if (specifier.startsWith("@/lib/")) {
        return {
          url: new URL(`${specifier.slice("@/lib/".length)}.ts`, import.meta.url).href,
          shortCircuit: true,
        };
      }
      if (specifier.startsWith("@/integrations/")) {
        return { url: stubUrl, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});

try {
  ({ generateDocumentQuestions, generatePracticeQuestions } = await import(urls[0]!));
  ({ state } = await import(stubUrl));
} finally {
  hooks.deregister();
}

async function parseViaNormalQuestionGeneration(markdown: string, locale = "en") {
  state.markdown = markdown;
  const result = await generateDocumentQuestions({
    data: { documentId: DOCUMENT, regenerate: true },
    context: {
      supabase: createSupabase(),
      userId: USER,
      claims: { user_metadata: { locale } },
    },
  });
  return result.questions;
}

async function parseViaPracticeQuestionGeneration(markdown: string, wrongIndexes = [0, 1]) {
  state.markdown = markdown;
  const result = await generatePracticeQuestions({
    data: { documentId: DOCUMENT, questionSetId: STANDARD_SET, wrongIndexes },
    context: {
      supabase: createSupabase({ seedStandardSet: true }),
      userId: USER,
    },
  });
  return result.questions;
}

test("production Questions parser accepts current EN/PT-BR labels and normalizes markdown wrappers", async () => {
  const questions = await parseViaNormalQuestionGeneration(`
## Question 1: **What does \`atomicity\` protect?**
A. **All-or-nothing changes**
B) Partial writes
C - Outside facts
D. Untracked edits
Correct: A
Explanation: **Atomicity** keeps grouped changes together.
Additional explanation line is appended.

Pergunta 2
Por que logs duráveis ajudam na recuperação?
A) Eles removem índices.
B) Eles preservam mudanças confirmadas.
C) Eles bloqueiam leituras.
D) Eles apagam sessões.
Correta: B
Explicação: Logs duráveis permitem restaurar estado confirmado.

### Questão 3: Como o isolamento reduz interferência?
A. Removendo transações
B. Ignorando conflitos
C. Separando operações concorrentes
D. Apagando bloqueios
Resposta correta: C
Explicacao: O isolamento controla efeitos concorrentes.

**Questao 4 - Qual etapa confirma uma transação?**
A. Rollback
B. Scan
C. Parse
D. Commit
Resposta: D
Explanation: Commit torna os efeitos duráveis.

5. Numbered syntax becomes question text
A. First option
B. Second option
C. Third option
D. Fourth option
Correct: C
Explanation: Numbered blocks are accepted by the parser.
`);

  assert.equal(questions.length, 5);
  assert.deepEqual(questions[0], {
    question: "What does atomicity protect?",
    options: ["All-or-nothing changes", "Partial writes", "Outside facts", "Untracked edits"],
    correctIndex: 0,
    explanation: "Atomicity keeps grouped changes together. Additional explanation line is appended.",
  });
  assert.deepEqual(questions[1], {
    question: "Por que logs duráveis ajudam na recuperação?",
    options: [
      "Eles removem índices.",
      "Eles preservam mudanças confirmadas.",
      "Eles bloqueiam leituras.",
      "Eles apagam sessões.",
    ],
    correctIndex: 1,
    explanation: "Logs duráveis permitem restaurar estado confirmado.",
  });
  assert.equal(questions[2]?.correctIndex, 2);
  assert.equal(questions[3]?.correctIndex, 3);
  assert.equal(questions[4]?.question, "Numbered syntax becomes question text");
});

test("normal generation requires five parser-produced questions while Practice accepts a smaller set", async () => {
  const twoQuestions = `
Question 1: Which mechanism protects concurrent updates?
A. Locks
B. Deletions
C. Guessing
D. Formatting
Correct: A
Explanation: Locks coordinate conflicting updates.

Question 2: Which artifact supports recovery?
A. Temporary color
B. Durable log
C. Empty cache
D. Removed index
Correct: B
Explanation: Durable logs preserve committed information.
`;

  await assert.rejects(
    () => parseViaNormalQuestionGeneration(twoQuestions),
    /Array must contain exactly 5 element\(s\)/u,
  );

  const practice = await parseViaPracticeQuestionGeneration(twoQuestions);
  assert.deepEqual(
    practice.map((question) => question.question),
    [
      "Which mechanism protects concurrent updates?",
      "Which artifact supports recovery?",
    ],
  );
});

test("incomplete parser output reaches caller validation and is rejected by schema rules", async () => {
  await assert.rejects(
    () =>
      parseViaNormalQuestionGeneration(`
Question 1: Which property requires all-or-nothing changes?
A. Atomicity
B. Latency
C. Styling
D. Routing
Explanation: Missing Correct leaves correctIndex at the parser default.

Question 2: Which structure records durable operations?
A. Cache
B. Log
C. Theme
D. Button
Correct: B
Explanation: Logs support recovery.

Question 3: Which level reduces concurrent interference?
A. Isolation
B. Upload
C. Rename
D. Search
Correct: A
Explanation: Isolation controls concurrency effects.

Question 4: Which action makes a transaction durable?
A. Commit
B. Rollback
C. Preview
D. Delete
Correct: A
Explanation: Commit records success.

Question 5: Which syntax can start a block?
A. A numbered line
B. A secret
C. A filename
D. A token
Correct: A
Explanation: Numbered headings can split blocks.
`),
    /Number must be greater than or equal to 0/u,
  );
});
