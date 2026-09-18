import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const processingRoute = readFileSync(new URL("../routes/app.processing.tsx", import.meta.url), "utf8");
const aiService = readFileSync(new URL("../services/aiService.ts", import.meta.url), "utf8");
const i18nSource = readFileSync(new URL("./i18n.tsx", import.meta.url), "utf8");

test("Processing shows only localized stages backed by the real study-analysis flow", () => {
  assert.match(processingRoute, /"processing\.stage\.preparing"/);
  assert.match(processingRoute, /"processing\.stage\.analyzing"/);
  assert.match(processingRoute, /"processing\.stage\.finalizing"/);
  assert.match(processingRoute, /await analyzeMaterial\(input\)/);
  assert.doesNotMatch(processingRoute, /Generating questions|processing\.stage\.questions/);
  assert.equal(i18nSource.match(/"processing\.stage\.preparing"/g)?.length, 2);
  assert.equal(i18nSource.match(/"processing\.stage\.analyzing"/g)?.length, 2);
  assert.equal(i18nSource.match(/"processing\.stage\.finalizing"/g)?.length, 2);
});

test("a successful Processing flow stores the analysis and opens document Summary", () => {
  assert.match(processingRoute, /storageService\.setAnalysis\(analysis\)/);
  assert.match(
    processingRoute,
    /navigate\(\{ to: "\/app\/summary\/\$documentId", params: \{ documentId: input\.documentId \} \}\)/,
  );
});

test("Processing does not wait on artificial route or analysis timers before navigating", () => {
  assert.doesNotMatch(processingRoute, /setTimeout|setInterval/);
  assert.match(
    processingRoute,
    /navigate\(\{ to: "\/app\/summary\/\$documentId", params: \{ documentId: input\.documentId \} \}\)/,
  );
  assert.doesNotMatch(aiService, /export async function analyzeMaterial[\s\S]*?await delay\(600\)/);
});
