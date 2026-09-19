import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const footer = readFileSync(new URL("./Footer.tsx", import.meta.url), "utf8");
const i18n = readFileSync(new URL("../lib/i18n.tsx", import.meta.url), "utf8");

test("footer includes localized developer attribution and safe social links", () => {
  assert.match(i18n, /"landing\.builtBy": "Built by Enzo Maranezi"/);
  assert.match(i18n, /"landing\.builtBy": "Desenvolvido por Enzo Maranezi"/);
  assert.match(footer, /href="https:\/\/github\.com\/EnzoMaranezi"/);
  assert.match(footer, /href="https:\/\/www\.linkedin\.com\/in\/enzo-maranezi"/);
  assert.match(footer, /target="_blank"/);
  assert.match(footer, /rel="noopener noreferrer"/);
});
