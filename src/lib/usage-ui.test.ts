import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const settings = readFileSync(new URL("../routes/app.settings.tsx", import.meta.url), "utf8");
const copy = readFileSync(new URL("./i18n.tsx", import.meta.url), "utf8");
const beta = readFileSync(new URL("../components/Pricing.tsx", import.meta.url), "utf8");

test("Settings shows daily AI usage without plan labels or an upgrade control", () => {
  assert.match(settings, /getAiGenerationUsageToday\(\)/);
  assert.match(settings, /t\("settings\.aiUsage"\)/);
  assert.match(settings, /t\("settings\.aiGenerationsToday"\)/);
  assert.match(settings, /used: aiUsage\.used/);
  assert.match(settings, /limit: aiUsage\.limit/);
  assert.doesNotMatch(settings, /settings\.(plan|currentPlan|free|upgradeComingSoon)/);
  assert.match(copy, /"settings\.aiUsage": "AI usage"/);
  assert.match(copy, /"settings\.aiUsage": "Uso de IA"/);
});

test("beta access keeps the signup CTA without future pricing copy in either locale", () => {
  assert.match(beta, /id="beta"/);
  assert.match(beta, /onClick=\{onStart\}/);
  assert.match(beta, /t\("landing\.betaCta"\)/);
  assert.match(copy, /"Create an account to explore the current study experience\."/);
  assert.match(copy, /"Crie uma conta para explorar a experiência atual de estudos\."/);
  assert.doesNotMatch(copy, /upgradeComingSoon|Plans and pricing|Planos e preços/);
});
