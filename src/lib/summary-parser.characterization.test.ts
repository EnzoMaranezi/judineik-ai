import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import type { StudySummary } from "./summary.schema.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const DOCUMENT = "22222222-2222-4222-8222-222222222222";
const SOURCE = "Academic source text about databases, transactions, isolation, and recovery. ".repeat(6);

const stubUrl = `data:text/javascript,${encodeURIComponent(`
  export const state = { markdown: "", saved: null };
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
  export function getUserLocale(metadata) { return metadata?.locale ?? "en"; }
  export async function generateAiText() {
    return { text: state.markdown, model: "characterization-model" };
  }
  export function normalizeAiError(error) { return error; }
  export async function reserveAiGeneration() { return { reservationId: "summary-parser-reservation" }; }
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
`)}`;

type Row = Record<string, unknown>;
type QueryResult = { data: Row[]; error: null };

function createSupabase() {
  const document = {
    id: DOCUMENT,
    user_id: USER,
    title: "Fallback material title",
    status: "processed",
    extracted_text: SOURCE,
  };
  const summaries: Row[] = [];

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
        abortSignal() {
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
        const rows = table === "documents" ? [document] : table === "summaries" ? summaries : [];
        return {
          data: rows.filter((row) =>
            filters.every(([key, value]) => row[key] === value),
          ),
          error: null,
        };
      }

      return query;
    },
    async rpc(name: string, payload: Record<string, unknown>) {
      if (name !== "save_summary_version") throw new Error(`Unexpected RPC: ${name}`);
      const id = `summary-${summaries.length + 1}`;
      summaries.push({
        id,
        document_id: payload["p_document_id"],
        locale: payload["p_locale"],
        topic_id: payload["p_topic_id"] ?? null,
        content: payload["p_content"],
        created_at: "2026-09-16T12:00:00.000Z",
        updated_at: "2026-09-16T12:00:00.000Z",
      });
      return { data: id, error: null };
    },
  };
}

const urls = [new URL("./summaries.functions.ts", import.meta.url).href];
const mocked = new Set([
  "@tanstack/react-start",
  "@/integrations/supabase/auth-middleware",
  "@/lib/ai-gateway.server",
  "@/lib/ai-usage-limit.server",
  "@/lib/ai-generation-action",
  "@/lib/i18n",
]);

let state: { markdown: string; saved: unknown };
let generateDocumentSummary: (input: {
  data: { documentId: string; regenerate?: boolean };
  context: {
    supabase: ReturnType<typeof createSupabase>;
    userId: string;
    claims: { user_metadata: { locale: string } };
  };
}) => Promise<{ summary: StudySummary }>;

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
  ({ generateDocumentSummary } = await import(urls[0]!));
  ({ state } = await import(stubUrl));
} finally {
  hooks.deregister();
}

async function parseViaProductionSummaryGeneration(markdown: string, locale = "en") {
  state.markdown = markdown;
  const result = await generateDocumentSummary({
    data: { documentId: DOCUMENT, regenerate: true },
    context: {
      supabase: createSupabase(),
      userId: USER,
      claims: { user_metadata: { locale } },
    },
  });
  return result.summary;
}

test("production Summary parser accepts canonical EN headings and normalizes markdown wrappers", async () => {
  const summary = await parseViaProductionSummaryGeneration(`
# **Transaction \`Summary\`**
## Key concepts
- **Atomicity**
2. \`Isolation\`

## Explanations
### **Transaction guarantees**
- Transactions keep grouped changes consistent.
Additional detail stays in the same explanation body.

## Definitions
- ACID: A set of transaction guarantees.
- Commit: The point where changes become durable.

## Relationships
- Isolation reduces interference between concurrent transactions.

## Final review
- Review how atomicity and isolation support reliable updates.

## Limitations
None
`);

  assert.deepEqual(summary, {
    title: "Transaction Summary",
    keyConcepts: ["Atomicity", "Isolation"],
    explanations: [{
      heading: "Transaction guarantees",
      body: "Transactions keep grouped changes consistent.\nAdditional detail stays in the same explanation body.",
    }],
    definitions: [
      { term: "ACID", definition: "A set of transaction guarantees." },
      { term: "Commit", definition: "The point where changes become durable." },
    ],
    relationships: ["Isolation reduces interference between concurrent transactions."],
    review: "Review how atomicity and isolation support reliable updates.",
    limitations: null,
  });
});

test("production Summary parser accepts current PT-BR heading aliases", async () => {
  const summary = await parseViaProductionSummaryGeneration(`
# Resumo de transações
## Conceitos-chave
- Atomicidade

## Explicações
### Garantias de transação
As operações são tratadas como uma unidade.

## Definições
- Log: registro usado para recuperação.

## Relacionamentos
- Recuperação depende dos registros persistidos.

## Revisão final
Revise as garantias e seus efeitos.

## Limitações
O material não detalha exemplos numéricos.
`, "pt-BR");

  assert.deepEqual(summary, {
    title: "Resumo de transações",
    keyConcepts: ["Atomicidade"],
    explanations: [{
      heading: "Garantias de transação",
      body: "As operações são tratadas como uma unidade.",
    }],
    definitions: [{ term: "Log", definition: "registro usado para recuperação." }],
    relationships: ["Recuperação depende dos registros persistidos."],
    review: "Revise as garantias e seus efeitos.",
    limitations: "O material não detalha exemplos numéricos.",
  });
});

test("production Summary parser falls back to document title and review body when sections are incomplete", async () => {
  const fallback = await parseViaProductionSummaryGeneration(`
## Key concepts
- Cache
## Explanations
- Lookup: Saved summaries can avoid generation.
## Definitions
- Cache: saved generated content.
## Relationships
- Cache lookup happens before generation.
## Final review
Use saved content when present.
## Limitations
none
`);
  assert.equal(fallback.title, "Fallback material title");
  assert.deepEqual(fallback.explanations, [{ heading: "Lookup", body: "Saved summaries can avoid generation." }]);
  assert.equal(fallback.limitations, null);

  const missingReview = await parseViaProductionSummaryGeneration(`
# Missing review
## Key concepts
- Cache
## Explanations
### Lookup
Saved summaries can avoid generation.
## Definitions
- Cache: saved generated content.
## Relationships
- Cache lookup happens before generation.
## Limitations
None
`);
  assert.equal(missingReview.title, "Missing review");
  assert.match(missingReview.review, /Missing review/u);
  assert.match(missingReview.review, /Cache lookup happens before generation/u);
});

test("production Summary parser truncates over-limit sections before schema validation", async () => {
  const summary = await parseViaProductionSummaryGeneration(`
# Truncated definitions
## Key concepts
- Cache
## Explanations
### Lookup
Saved summaries can avoid generation.
## Definitions
${Array.from({ length: 11 }, (_, index) => `- Term ${index + 1}: definition`).join("\n")}
## Relationships
- Cache lookup happens before generation.
## Final review
Use saved content when present.
## Limitations
None
`);

  assert.equal(summary.definitions.length, 10);
  assert.equal(summary.definitions[0]?.term, "Term 1");
  assert.equal(summary.definitions.at(-1)?.term, "Term 10");
});
