import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const gateway = readFileSync(new URL("./ai-gateway.server.ts", import.meta.url), "utf8");

test("the production gateway has a bounded provider budget and no hidden SDK retries", () => {
  assert.match(gateway, /const NVIDIA_PROVIDER_TIMEOUT_MS = 60_000/);
  assert.match(gateway, /const OPENROUTER_PROVIDER_TIMEOUT_MS = 45_000/);
  assert.match(gateway, /const AI_SDK_MAX_RETRIES = 0/);
  assert.match(gateway, /maxRetries: AI_SDK_MAX_RETRIES/);
  assert.match(gateway, /abortSignal: context\.abortSignal/);
  assert.match(gateway, /timeout: context\.timeoutMs/);
});

test("each configured provider attempt receives its intended deadline", () => {
  const nvidiaDeadlines = gateway.match(/timeoutMs: NVIDIA_PROVIDER_TIMEOUT_MS/g) ?? [];
  assert.equal(nvidiaDeadlines.length, 2);
  assert.match(gateway, /label: "openrouter-fallback",[\s\S]*?timeoutMs: OPENROUTER_PROVIDER_TIMEOUT_MS/);
});
