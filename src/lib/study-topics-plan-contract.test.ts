import assert from "node:assert/strict";
import test from "node:test";
import type { StoredDocumentTopic } from "./document-topics.functions.ts";

type PersistedTopicViewModel = {
  id: string;
  title: string;
  context: string;
};

type TopicBoundaryState =
  | { status: "ready"; documentTitle: string; topics: PersistedTopicViewModel[] }
  | { status: "unavailable"; reason: "missing" | "stale"; recoveryTo: string };

const document = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Operating Systems Notes",
};

function topic(position: number): StoredDocumentTopic {
  return {
    id: `topic-${String(position).padStart(2, "0")}`,
    documentId: document.id,
    title: `Topic ${String(position).padStart(2, "0")}`,
    description: `Grounded context for topic ${position}.`,
    sourceRanges: [{ start: position * 10, end: position * 10 + 8 }],
    sourceHash: "fresh-source-hash",
    position,
    discoveryModel: "openai/gpt-oss-20b",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function toStudyTopicViewModel(topics: StoredDocumentTopic[]) {
  return [...topics]
    .sort((a, b) => a.position - b.position)
    .map((persistedTopic): PersistedTopicViewModel => ({
      id: persistedTopic.id,
      title: persistedTopic.title,
      context: persistedTopic.description,
    }));
}

function toKnowledgeMapTopics(topics: PersistedTopicViewModel[]) {
  return topics.slice(0, 6);
}

function resolveTopicBoundary(args: {
  documentId: string;
  documentTitle: string;
  topics: StoredDocumentTopic[];
  stale: boolean;
  forbiddenDependencies: {
    analyzeMaterial: () => never;
    readStudyAnalysisCache: () => never;
    discoverDocumentTopics: () => never;
  };
}): TopicBoundaryState {
  if (args.stale) {
    return {
      status: "unavailable",
      reason: "stale",
      recoveryTo: `/app/materials/${args.documentId}/topics`,
    };
  }
  if (args.topics.length === 0) {
    return {
      status: "unavailable",
      reason: "missing",
      recoveryTo: `/app/materials/${args.documentId}/topics`,
    };
  }
  return {
    status: "ready",
    documentTitle: args.documentTitle,
    topics: toStudyTopicViewModel(args.topics),
  };
}

function prioritizeTopicsByReinforcement(
  topics: PersistedTopicViewModel[],
  reinforcementTitles: string[],
) {
  if (reinforcementTitles.length === 0) return topics;
  const reinforced = new Set(reinforcementTitles.map((title) => title.toLowerCase()));
  return [...topics].sort((a, b) => {
    const aReinforced = reinforced.has(a.title.toLowerCase()) ? 1 : 0;
    const bReinforced = reinforced.has(b.title.toLowerCase()) ? 1 : 0;
    return bReinforced - aReinforced;
  });
}

test("persisted document topics become ordered visible study topics without synthetic StudyAnalysis fields", () => {
  const viewModel = toStudyTopicViewModel([topic(3), topic(1), topic(2)]);

  assert.deepEqual(viewModel, [
    { id: "topic-01", title: "Topic 01", context: "Grounded context for topic 1." },
    { id: "topic-02", title: "Topic 02", context: "Grounded context for topic 2." },
    { id: "topic-03", title: "Topic 03", context: "Grounded context for topic 3." },
  ]);
  assert.deepEqual(
    viewModel.map((mappedTopic) => Object.keys(mappedTopic).sort()),
    [
      ["context", "id", "title"],
      ["context", "id", "title"],
      ["context", "id", "title"],
    ],
  );
  assert.equal(document.title, "Operating Systems Notes");
  assert.equal("subject" in viewModel[0]!, false);
  assert.equal("mastery" in viewModel[0]!, false);
  assert.equal("difficulty" in viewModel[0]!, false);
  assert.equal("parent" in viewModel[0]!, false);
});

test("canonical topic collection stays complete while Knowledge Map receives only the first six positions", () => {
  for (const count of [3, 6, 12]) {
    const canonical = toStudyTopicViewModel(
      Array.from({ length: count }, (_, index) => topic(count - index)),
    );
    const visibleMapTopics = toKnowledgeMapTopics(canonical);

    assert.equal(canonical.length, count);
    assert.deepEqual(
      canonical.map((mappedTopic) => mappedTopic.id),
      Array.from({ length: count }, (_, index) => `topic-${String(index + 1).padStart(2, "0")}`),
    );
    assert.equal(visibleMapTopics.length, Math.min(6, count));
    assert.deepEqual(
      visibleMapTopics.map((mappedTopic) => mappedTopic.id),
      canonical.slice(0, 6).map((mappedTopic) => mappedTopic.id),
    );
  }
});

test("missing or stale persisted topics route to explicit Topics recovery without heuristic fallback", () => {
  const forbiddenCalls: string[] = [];
  const forbiddenDependencies = {
    analyzeMaterial: () => {
      forbiddenCalls.push("analyzeMaterial");
      throw new Error("unexpected analyzeMaterial call");
    },
    readStudyAnalysisCache: () => {
      forbiddenCalls.push("readStudyAnalysisCache");
      throw new Error("unexpected nexa:analysis read");
    },
    discoverDocumentTopics: () => {
      forbiddenCalls.push("discoverDocumentTopics");
      throw new Error("unexpected discovery call");
    },
  };

  assert.deepEqual(
    resolveTopicBoundary({
      documentId: document.id,
      documentTitle: document.title,
      topics: [],
      stale: false,
      forbiddenDependencies,
    }),
    {
      status: "unavailable",
      reason: "missing",
      recoveryTo: `/app/materials/${document.id}/topics`,
    },
  );
  assert.deepEqual(
    resolveTopicBoundary({
      documentId: document.id,
      documentTitle: document.title,
      topics: [topic(1), topic(2), topic(3)],
      stale: true,
      forbiddenDependencies,
    }),
    {
      status: "unavailable",
      reason: "stale",
      recoveryTo: `/app/materials/${document.id}/topics`,
    },
  );
  assert.deepEqual(forbiddenCalls, []);
});

test("reinforcement ordering remains title-based and preserves unmatched topic order", () => {
  const canonical = toStudyTopicViewModel([topic(1), topic(2), topic(3), topic(4), topic(5)]);
  const prioritized = prioritizeTopicsByReinforcement(canonical, ["topic 04", "Topic 02"]);

  assert.deepEqual(
    prioritized.map((mappedTopic) => mappedTopic.id),
    ["topic-02", "topic-04", "topic-01", "topic-03", "topic-05"],
  );
});
