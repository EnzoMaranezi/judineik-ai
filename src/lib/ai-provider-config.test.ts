import assert from "node:assert/strict";
import test from "node:test";
import {
  aiProviderConfigurationPresence,
  resolveAiProviderConfiguration,
} from "./ai-provider-config.ts";

test("configures the complete provider chain in the intended order", () => {
  const config = resolveAiProviderConfiguration({
    NVIDIA_API_KEY: "nvidia-key",
    OPENROUTER_API_KEY: "openrouter-key",
    OPENROUTER_MODEL: "configured-openrouter-model",
  });

  assert.deepEqual(
    config.attempts.map(({ provider, model, label }) => ({ provider, model, label })),
    [
      { provider: "nvidia", model: "openai/gpt-oss-20b", label: "nvidia-primary" },
      { provider: "nvidia", model: "openai/gpt-oss-120b", label: "nvidia-fallback" },
      {
        provider: "openrouter",
        model: "configured-openrouter-model",
        label: "openrouter-fallback",
      },
    ],
  );
});

test("configures NVIDIA without OpenRouter", () => {
  const config = resolveAiProviderConfiguration({ NVIDIA_API_KEY: "nvidia-key" });

  assert.deepEqual(
    config.attempts.map(({ label }) => label),
    ["nvidia-primary", "nvidia-fallback"],
  );
});

test("configures OpenRouter without NVIDIA", () => {
  const config = resolveAiProviderConfiguration({
    OPENROUTER_API_KEY: "openrouter-key",
    OPENROUTER_MODEL: "configured-openrouter-model",
  });

  assert.deepEqual(
    config.attempts.map(({ label }) => label),
    ["openrouter-fallback"],
  );
});

test("returns no attempts when no provider is configured", () => {
  const config = resolveAiProviderConfiguration({});

  assert.deepEqual(config.attempts, []);
  assert.deepEqual(aiProviderConfigurationPresence(config), {
    hasNvidiaApiKey: false,
    hasOpenRouterApiKey: false,
    hasOpenRouterModel: false,
    attemptCount: 0,
  });
});

test("does not configure OpenRouter without an explicit model", () => {
  const config = resolveAiProviderConfiguration({ OPENROUTER_API_KEY: "openrouter-key" });

  assert.deepEqual(config.attempts, []);
  assert.deepEqual(aiProviderConfigurationPresence(config), {
    hasNvidiaApiKey: false,
    hasOpenRouterApiKey: true,
    hasOpenRouterModel: false,
    attemptCount: 0,
  });
});

test("reads a fresh environment snapshot for each request", () => {
  const env: Record<string, string | undefined> = {};
  assert.equal(resolveAiProviderConfiguration(env).attempts.length, 0);

  env["NVIDIA_API_KEY"] = "nvidia-key";
  assert.equal(resolveAiProviderConfiguration(env).attempts.length, 2);

  delete env["NVIDIA_API_KEY"];
  env["OPENROUTER_API_KEY"] = "openrouter-key";
  env["OPENROUTER_MODEL"] = "configured-openrouter-model";
  assert.equal(resolveAiProviderConfiguration(env).attempts.length, 1);
});

test("treats whitespace-only provider settings as missing", () => {
  const config = resolveAiProviderConfiguration({
    NVIDIA_API_KEY: "   ",
    OPENROUTER_API_KEY: "\t",
    OPENROUTER_MODEL: "\n",
  });

  assert.deepEqual(config.attempts, []);
});
