import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const gateway = readFileSync(new URL("./ai-gateway.server.ts", import.meta.url), "utf8");

test("the production gateway has a bounded provider budget and no hidden SDK retries", () => {
  assert.match(gateway, /const NVIDIA_PRIMARY_TIMEOUT_MS = 30_000/);
  assert.match(gateway, /const NVIDIA_FALLBACK_TIMEOUT_MS = 45_000/);
  assert.match(gateway, /const OPENROUTER_PROVIDER_TIMEOUT_MS = 40_000/);
  assert.match(gateway, /const AI_SDK_MAX_RETRIES = 0/);
  assert.match(gateway, /maxRetries: AI_SDK_MAX_RETRIES/);
  assert.match(gateway, /abortSignal: context\.abortSignal/);
  assert.match(gateway, /timeout: context\.timeoutMs/);
});

test("each configured provider attempt receives its intended deadline", () => {
  assert.match(gateway, /label: "nvidia-primary",[\s\S]*?timeoutMs: NVIDIA_PRIMARY_TIMEOUT_MS/);
  assert.match(gateway, /label: "nvidia-fallback",[\s\S]*?timeoutMs: NVIDIA_FALLBACK_TIMEOUT_MS/);
  assert.match(
    gateway,
    /label: "openrouter-fallback",[\s\S]*?timeoutMs: OPENROUTER_PROVIDER_TIMEOUT_MS/,
  );
});

test("safe logs include diagnostics but never provider bodies or messages", () => {
  assert.match(gateway, /statusCode: event\.statusCode/);
  assert.match(gateway, /providerCode: event\.providerCode/);
  assert.match(gateway, /requestId: event\.requestId/);
  assert.doesNotMatch(gateway, /responseBody: event\./);
  assert.doesNotMatch(gateway, /message: event\./);
});
