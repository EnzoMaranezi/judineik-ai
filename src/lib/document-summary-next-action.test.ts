import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const materialRoute = readFileSync(new URL("../routes/app.material.tsx", import.meta.url), "utf8");
const i18n = readFileSync(new URL("./i18n.tsx", import.meta.url), "utf8");

test("the post-summary CTA opens document Questions for the processed material", () => {
  const postSummary = materialRoute.slice(materialRoute.indexOf("{processed && ("));

  assert.match(
    postSummary,
    /<DocumentSummaryPanel[\s\S]*?to: "\/app\/questions\/\$documentId",[\s\S]*?params: \{ documentId: processed\.id \}/u,
  );
  assert.doesNotMatch(postSummary, /to: "\/app\/processing"/u);
  assert.match(i18n, /"material\.continueStudy": "Practice with questions"/u);
  assert.match(i18n, /"material\.continueStudy": "Praticar com questões"/u);
});
