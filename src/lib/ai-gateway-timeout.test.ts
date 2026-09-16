import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const gateway = readFileSync(new URL("./ai-gateway.server.ts", import.meta.url), "utf8");
const providerConfig = readFileSync(new URL("./ai-provider-config.ts", import.meta.url), "utf8");

test("the production gateway has a bounded provider budget and no hidden SDK retries", () => {
  assert.match(providerConfig, /const NVIDIA_PRIMARY_TIMEOUT_MS = 45_000/);
  assert.match(providerConfig, /const OPENROUTER_PROVIDER_TIMEOUT_MS = 60_000/);
  assert.match(gateway, /const AI_SDK_MAX_RETRIES = 0/);
  assert.match(gateway, /maxRetries: AI_SDK_MAX_RETRIES/);
  assert.match(gateway, /abortSignal: context\.abortSignal/);
  assert.match(gateway, /timeout: context\.timeoutMs/);
});

test("each configured provider attempt receives its intended deadline", () => {
  assert.match(
    providerConfig,
    /label: "nvidia-primary",[\s\S]*?timeoutMs: NVIDIA_PRIMARY_TIMEOUT_MS/,
  );
  assert.match(
    providerConfig,
    /label: "openrouter-fallback",[\s\S]*?timeoutMs: OPENROUTER_PROVIDER_TIMEOUT_MS/,
  );
  assert.doesNotMatch(providerConfig, /gpt-oss-120b|nvidia-fallback/);
});

test("safe logs include diagnostics but never provider bodies or messages", () => {
  assert.match(gateway, /statusCode: event\.statusCode/);
  assert.match(gateway, /providerCode: event\.providerCode/);
  assert.match(gateway, /requestId: event\.requestId/);
  assert.doesNotMatch(gateway, /responseBody: event\./);
  assert.doesNotMatch(gateway, /message: event\./);
});

test("provider configuration failures have safe deployment diagnostics", () => {
  assert.match(gateway, /event: "no_provider_attempts"/);
  assert.match(gateway, /aiProviderConfigurationPresence\(config\)/);
  assert.match(gateway, /VERCEL_ENV/);
  assert.match(gateway, /VERCEL_REGION/);
  assert.match(gateway, /VERCEL_GIT_COMMIT_SHA/);
  assert.doesNotMatch(gateway, /nvidiaApiKey: config\./);
  assert.doesNotMatch(gateway, /openRouterApiKey: config\./);
});

test("provider request failures are not surfaced as missing provider configuration", () => {
  assert.match(gateway, /if \(attempts\.length === 0\)[\s\S]*AI_PROVIDERS_UNAVAILABLE/);
  assert.match(gateway, /catch \(error\) \{\s*throw new Error\("AI_PROVIDER_REQUEST_FAILED"\)/);
  assert.doesNotMatch(gateway, /catch \(error\)[\s\S]*error\.message === AI_PROVIDERS_UNAVAILABLE/);
});
