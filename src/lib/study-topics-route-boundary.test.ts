import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const planRoute = readFileSync(new URL("../routes/app.plan.tsx", import.meta.url), "utf8");
const sessionRoute = readFileSync(new URL("../routes/app.session.tsx", import.meta.url), "utf8");

test("Plan reads persisted topics and no longer depends on local StudyAnalysis", () => {
  assert.match(planRoute, /getDocumentTopics\(\{ data: \{ documentId \} \}\)/);
  assert.match(planRoute, /resolveStudyTopicsState/);
  assert.match(planRoute, /to="\/app\/materials\/\$documentId\/topics"/);
  assert.doesNotMatch(planRoute, /getStudyAnalysisForDocument/);
  assert.doesNotMatch(planRoute, /storageService/);
  assert.doesNotMatch(planRoute, /getAnalysis/);
  assert.doesNotMatch(planRoute, /nexa:analysis/);
  assert.doesNotMatch(planRoute, /discoverDocumentTopics/);
});

test("Session reads persisted topics and no longer depends on local StudyAnalysis", () => {
  assert.match(sessionRoute, /getDocumentTopics\(\{ data: \{ documentId \} \}\)/);
  assert.match(sessionRoute, /resolveStudyTopicsState/);
  assert.match(sessionRoute, /prioritizeTopicsByReinforcement/);
  assert.match(sessionRoute, /to="\/app\/materials\/\$documentId\/topics"/);
  assert.doesNotMatch(sessionRoute, /getStudyAnalysisForDocument/);
  assert.doesNotMatch(sessionRoute, /storageService/);
  assert.doesNotMatch(sessionRoute, /getAnalysis/);
  assert.doesNotMatch(sessionRoute, /nexa:analysis/);
  assert.doesNotMatch(sessionRoute, /discoverDocumentTopics/);
});
