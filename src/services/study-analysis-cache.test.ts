import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, beforeEach, test } from "node:test";
import type { PendingInput } from "./storageService.ts";
import { storageService } from "./storageService.ts";
import type { StudyAnalysis } from "../types/study.ts";

// Resolve only this service's dependencies; exercise its actual implementation
// and the real storage adapter without loading the browser Supabase client.
const doublesUrl = `data:text/javascript,${encodeURIComponent(`
  export const state = { reads: [], inputs: [], row: null, result: null };
  export const supabase = {
    from(table) {
      const query = {
        select() { return query; },
        eq(column, value) { state.reads.push({ table, column, value }); return query; },
        async maybeSingle() { return { data: state.row, error: null }; }
      };
      return query;
    }
  };
  export async function analyzeMaterial(input) {
    state.inputs.push(input);
    return state.result;
  }
`)}`;
const serviceUrl = new URL("./studyAnalysisService.ts", import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === serviceUrl) {
      if (specifier === "@/services/aiService" || specifier === "@/lib/supabase") {
        return { url: doublesUrl, shortCircuit: true };
      }
      if (specifier === "@/services/storageService") {
        return {
          url: new URL("./storageService.ts", import.meta.url).href,
          shortCircuit: true,
        };
      }
    }
    return nextResolve(specifier, context);
  },
});
let getStudyAnalysisForDocument: typeof import("./studyAnalysisService.ts").getStudyAnalysisForDocument;
let state: {
  reads: Array<{ table: string; column: string; value: string }>;
  inputs: PendingInput[];
  row: { id: string; title: string; file_url: null; extracted_text: string; status: string } | null;
  result: StudyAnalysis | null;
};
try {
  ({ getStudyAnalysisForDocument } = await import(serviceUrl));
  ({ state } = await import(doublesUrl));
} finally {
  hooks.deregister();
}

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

function analysis(documentId: string): StudyAnalysis {
  return {
    id: `analysis-${documentId}`, documentId, title: "Synthetic notes",
    subject: "Probability", chapter: "Distributions", summary: "Synthetic summary",
    createdAt: 1, concepts: [], weakAreas: [], questions: [], flashcards: [],
    recommendedSession: { minutes: 0, blocks: [] },
  };
}

let storage: MemoryStorage;
let priorWindow: PropertyDescriptor | undefined;
beforeEach(() => {
  priorWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  storage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true, value: { localStorage: storage },
  });
  state.reads = [];
  state.inputs = [];
  state.row = {
    id: "document-b", title: "Fresh synthetic notes", file_url: null,
    extracted_text: "A synthetic academic explanation of probability. ".repeat(10),
    status: "processed",
  };
  state.result = analysis("document-b");
});
afterEach(() => {
  if (priorWindow) Object.defineProperty(globalThis, "window", priorWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

test("a matching document ID returns even an old cached analysis without reading or recomputing", async () => {
  const cached = analysis("document-a");
  storageService.setAnalysis(cached);
  state.row = null;

  assert.deepEqual(await getStudyAnalysisForDocument("document-a"), cached);
  assert.deepEqual(await getStudyAnalysisForDocument("document-a"), cached);
  assert.deepEqual(state.reads, []);
  assert.deepEqual(state.inputs, []);
});

test("a different document ID reads and analyzes the requested document, replacing the single cache", async () => {
  storageService.setAnalysis(analysis("document-a"));

  assert.deepEqual(await getStudyAnalysisForDocument("document-b"), state.result);
  assert.deepEqual(state.reads, [{ table: "documents", column: "id", value: "document-b" }]);
  assert.deepEqual(state.inputs, [{
    kind: "notes", name: state.row!.title, text: state.row!.extracted_text.trim(),
    documentId: "document-b", filePath: undefined,
  }]);
  assert.deepEqual(storageService.getAnalysis(), state.result);
  await getStudyAnalysisForDocument("document-b");
  assert.equal(state.reads.length, 1);
  assert.equal(state.inputs.length, 1);
});

test("a missing cache reads, recomputes and saves analysis", async () => {
  assert.equal(storageService.getAnalysis(), null);
  await getStudyAnalysisForDocument("document-b");
  assert.equal(state.reads.length, 1);
  assert.equal(state.inputs.length, 1);
  assert.deepEqual(storageService.getAnalysis(), state.result);
});

test("analysis uses one browser-wide key and survives a new window/session wrapper over the same storage", async () => {
  const cached = analysis("document-a");
  storageService.setAnalysis(cached);
  assert.deepEqual([...storage.values.keys()], ["nexa:analysis"]);
  Object.defineProperty(globalThis, "window", {
    configurable: true, value: { localStorage: storage },
  });

  assert.deepEqual(await getStudyAnalysisForDocument("document-a"), cached);
  assert.deepEqual(state.reads, []);
  assert.deepEqual(state.inputs, []);
});

test("clearing pending input or session progress leaves analysis intact; removing its key causes a cache miss", async () => {
  const cached = analysis("document-b");
  storageService.setAnalysis(cached);
  storageService.setPendingInput({ kind: "notes", name: "Temporary notes" });
  storageService.setProgress({ analysisId: cached.id, index: 1, correct: 0, answered: 1 });
  storageService.clearPendingInput();
  storageService.clearProgress();
  assert.deepEqual(await getStudyAnalysisForDocument("document-b"), cached);
  assert.deepEqual(state.reads, []);

  storage.removeItem("nexa:analysis");
  await getStudyAnalysisForDocument("document-b");
  assert.equal(state.reads.length, 1);
  assert.equal(state.inputs.length, 1);
});

test("invalid stored JSON is treated as an absent analysis and replaced after recomputing", async () => {
  storage.setItem("nexa:analysis", "{invalid-json");
  assert.equal(storageService.getAnalysis(), null);
  await getStudyAnalysisForDocument("document-b");
  assert.equal(state.reads.length, 1);
  assert.equal(state.inputs.length, 1);
  assert.deepEqual(storageService.getAnalysis(), state.result);
});
