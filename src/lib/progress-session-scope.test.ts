import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildProgressOverview, mapSession, type ProgressSessionRow } from "./progress-overview.ts";

const server = readFileSync(new URL("./progress.functions.ts", import.meta.url), "utf8");
const replay = readFileSync(new URL("../routes/app.sessions.$sessionId.tsx", import.meta.url), "utf8");
const label = readFileSync(new URL("../components/app/SessionScopeLabel.tsx", import.meta.url), "utf8");
const i18n = readFileSync(new URL("./i18n.tsx", import.meta.url), "utf8");

function session(kind: string, topicId: string | null): ProgressSessionRow {
  return {
    id: `session-${kind}-${topicId ?? "document"}`,
    document_id: "document-1",
    documents: { title: "Operating systems" },
    total_questions: 5,
    correct_answers: 4,
    accuracy: 80,
    completed_at: "2026-09-02T12:00:00Z",
    question_sets: {
      kind,
      topic_id: topicId,
      topic_scope_id: topicId,
      document_topics: topicId ? { id: topicId, title: "Sincronização" } : null,
    },
  };
}

for (const kind of ["standard", "practice"]) {
  for (const topicId of [null, "topic-1"]) {
    test(`history identifies a ${topicId ? "topic" : "document"} ${kind} session`, () => {
      const mapped = mapSession(session(kind, topicId));
      assert.equal(mapped.kind, kind);
      assert.equal(mapped.topicId, topicId);
      assert.equal(mapped.topicScopeId, topicId);
      assert.equal(mapped.topicTitle, topicId ? "Sincronização" : null);
      assert.equal(mapped.documentId, "document-1");
      assert.equal(mapped.accuracy, 80);
    });
  }
}

test("deleted topics retain historical scope and practice type without a navigation target", () => {
  for (const kind of ["standard", "practice"]) {
    const row = session(kind, "deleted-topic");
    row.question_sets!.topic_id = null;
    row.question_sets!.document_topics = null;
    const mapped = mapSession(row);
    assert.equal(mapped.topicScopeId, "deleted-topic");
    assert.equal(mapped.topicId, null);
    assert.equal(mapped.topicTitle, null);
    assert.equal(mapped.kind, kind);
    assert.equal(mapped.id, row.id);
  }
});

test("unavailable or mismatched topic metadata cannot supply a title or broken topic link", () => {
  const row = session("practice", "topic-1");
  row.question_sets!.document_topics = null;
  assert.equal(mapSession(row).topicId, null);
  row.question_sets!.document_topics = { id: "other-topic", title: "Unrelated" };
  assert.equal(mapSession(row).topicTitle, null);
  assert.equal(mapSession(row).topicId, null);
  assert.equal(mapSession(row).topicScopeId, "topic-1");
});

test("legacy and missing question sets remain readable without invented practice metadata", () => {
  const legacy = session("legacy", null);
  assert.equal(mapSession(legacy).kind, "legacy");
  const { question_sets: _set, ...oldRow } = legacy;
  for (const row of [oldRow, { ...oldRow, question_sets: null }]) {
    const mapped = mapSession(row);
    assert.equal(mapped.kind, "legacy");
    assert.equal(mapped.topicScopeId, null);
    assert.equal(mapped.id, oldRow.id);
    assert.equal(mapped.correctAnswers, 4);
  }
});

test("scope metadata leaves parent-document aggregates and session counts unchanged", () => {
  const rows = [
    session("standard", null), session("standard", "topic-1"),
    session("practice", null), session("practice", "topic-1"),
  ];
  const activeRow = { ...session("practice", "topic-2"), completed_at: null };
  const enriched = buildProgressOverview({ completedRows: rows, activeRow, materialsTotal: 1 });
  const original = buildProgressOverview({
    completedRows: rows.map(({ question_sets: _set, ...row }) => row),
    activeRow: null,
    materialsTotal: 1,
  });
  assert.deepEqual(enriched.perMaterial, original.perMaterial);
  assert.equal(enriched.totalSessions, 4);
  assert.equal(enriched.totalQuestions, 20);
  assert.equal(enriched.totalCorrect, 16);
  assert.equal(enriched.overallAccuracy, original.overallAccuracy);
  assert.equal(enriched.materialsStudied, 1);
  assert.equal(enriched.activeSession?.topicScopeId, "topic-2");
});

test("deleted-topic replay loads the original set and answers without requiring a live topic", () => {
  const handler = server.slice(server.indexOf("export const getStudySession"));
  assert.match(handler, /\.eq\("id", row\.question_set_id\)/);
  assert.match(handler, /answers: \(row\.answers/);
  assert.doesNotMatch(handler, /!inner|\.eq\("topic_id"|\.eq\("kind"|\.eq\("locale"/);
  assert.doesNotMatch(replay, /to="\/app\/materials\/\$documentId\/topics/);
  assert.match(replay, /!data\.topicScopeId \? \(/);
  assert.match(replay, /questions=\{data\.questions\}[\s\S]*answers=\{data\.answers\}/);
});

test("all history queries stay authenticated and joined metadata uses owner-only RLS", () => {
  assert.equal((server.match(/\.middleware\(\[requireSupabaseAuth\]\)/g) ?? []).length, 3);
  assert.equal((server.match(/\.eq\("user_id", context\.userId\)/g) ?? []).length, 5);
  assert.equal((server.match(/question_sets\(kind, topic_id, topic_scope_id, document_topics\(id, title\)\)/g) ?? []).length, 4);
  assert.doesNotMatch(server, /userId: z\.|service_role|supabaseAdmin|!inner/);
  const policies = readFileSync(new URL("../../supabase/migrations/0006_multilingual_generated_content.sql", import.meta.url), "utf8");
  const topics = readFileSync(new URL("../../supabase/migrations/0007_document_topics.sql", import.meta.url), "utf8");
  assert.match(policies, /ON public\.question_sets FOR SELECT TO authenticated\s+USING \(auth.uid\(\) = user_id\)/);
  assert.match(policies, /ON public\.question_sessions\s+FOR ALL\s+TO authenticated\s+USING \(auth.uid\(\) = user_id\)/);
  assert.match(topics, /ON public\.document_topics FOR SELECT TO authenticated\s+USING \(user_id = auth.uid\(\)\)/);
  assert.match(server, /\.eq\("document_id", row\.document_id\)/);
});

test("Progress, history, and replay share compact localized scope labels", () => {
  for (const route of ["app.results.tsx", "app.sessions.index.tsx", "app.sessions.$sessionId.tsx"]) {
    assert.match(readFileSync(new URL(`../routes/${route}`, import.meta.url), "utf8"), /<SessionScopeLabel session=/);
  }
  assert.match(label, /session\.topicScopeId/);
  assert.match(label, /title: session\.topicTitle/);
  assert.match(label, /session\.kind === "practice"[\s\S]*t\("results.practiceMistakes"\)/);
  for (const key of ["sessions.topic", "sessions.deletedTopic", "sessions.openTopic"]) {
    assert.equal(i18n.split(`"${key}":`).length - 1, 2);
  }
});
