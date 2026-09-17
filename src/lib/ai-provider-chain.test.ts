import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_PROVIDER_CHAIN_BUDGET_MS,
  AI_PROVIDER_CHAIN_EXHAUSTED,
  AI_PROVIDER_ATTEMPT_TIMEOUT,
  classifyProviderError,
  runAiProviderChain,
  type AiProviderAttempt,
} from "./ai-provider-chain.ts";

const attempts: AiProviderAttempt[] = [
  { provider: "nvidia", model: "openai/gpt-oss-20b", label: "nvidia-primary" },
  { provider: "openrouter", model: "configured-model", label: "openrouter-fallback" },
];

function providerError(statusCode: number, message = "provider unavailable") {
  const error = Object.assign(new Error(message), { statusCode });
  return error;
}

test("classifies ordinary timeout messages and HTTP 408 as eligible timeouts", () => {
  const errors = [
    new Error("Request timed out"),
    new Error("Request timeout"),
    new Error("  REQUEST TIMED OUT.  "),
    new Error("Operation timed out after 30 seconds"),
    new Error("Connection timeout after 1000ms"),
    new Error("Timeout"),
    providerError(408, "HTTP failure"),
    Object.assign(new Error("HTTP failure"), { status: 408 }),
  ];

  for (const error of errors) {
    const classified = classifyProviderError(error);
    assert.equal(classified.category, "timeout", error.message);
    assert.equal(classified.eligibleForFallback, true, error.message);
  }
});

test("unrecognized errors and mentions of timing configuration remain unknown", () => {
  for (const message of [
    "Unexpected provider failure",
    "Invalid timeout configuration",
    "Request timeout must be configured",
    "Response took longer than expected",
  ]) {
    const classified = classifyProviderError(new Error(message));
    assert.equal(classified.category, "unknown", message);
    assert.equal(classified.eligibleForFallback, false, message);
  }
});

test("ordinary primary timeout messages trigger the configured secondary provider", async () => {
  for (const message of ["Request timed out", "Request timeout"]) {
    const called: string[] = [];
    const categories: string[] = [];
    const result = await runAiProviderChain({
      attempts,
      generate: async (attempt) => {
        called.push(attempt.label);
        if (attempt.provider === "nvidia") throw new Error(message);
        return "secondary output";
      },
      onAttempt: (event) => {
        if (event.outcome === "failure") categories.push(event.category);
      },
    });

    assert.equal(result, "secondary output");
    assert.deepEqual(called, ["nvidia-primary", "openrouter-fallback"]);
    assert.deepEqual(categories, ["timeout"]);
  }
});

test("uses NVIDIA primary without fallback", async () => {
  const called: string[] = [];
  const result = await runAiProviderChain({
    attempts,
    generate: async (attempt) => {
      called.push(attempt.label);
      return "primary output";
    },
  });

  assert.equal(result, "primary output");
  assert.deepEqual(called, ["nvidia-primary"]);
});

test("uses OpenRouter after a transient NVIDIA failure", async () => {
  const called: string[] = [];
  const result = await runAiProviderChain({
    attempts,
    generate: async (attempt) => {
      called.push(attempt.label);
      if (attempt.provider === "nvidia") throw providerError(503);
      return "openrouter fallback output";
    },
  });

  assert.equal(result, "openrouter fallback output");
  assert.deepEqual(called, ["nvidia-primary", "openrouter-fallback"]);
});

test("uses OpenRouter when the NVIDIA model is not found", async () => {
  const called: string[] = [];
  const result = await runAiProviderChain({
    attempts,
    generate: async (attempt) => {
      called.push(attempt.label);
      if (attempt.provider === "nvidia") throw providerError(404, "Not Found");
      return "openrouter fallback output";
    },
  });

  assert.equal(result, "openrouter fallback output");
  assert.deepEqual(called, ["nvidia-primary", "openrouter-fallback"]);
});

test("uses OpenRouter when the NVIDIA model has reached end of life", async () => {
  const called: string[] = [];
  const result = await runAiProviderChain({
    attempts,
    generate: async (attempt) => {
      called.push(attempt.label);
      if (attempt.label === "nvidia-primary") {
        throw providerError(410, "Model reached end of life and is no longer available");
      }
      return "openrouter fallback output";
    },
  });

  assert.equal(result, "openrouter fallback output");
  assert.deepEqual(called, ["nvidia-primary", "openrouter-fallback"]);
});

test("uses OpenRouter after NVIDIA is rate limited", async () => {
  const called: string[] = [];
  const result = await runAiProviderChain({
    attempts,
    generate: async (attempt) => {
      called.push(attempt.label);
      if (attempt.provider === "nvidia") throw providerError(429, "rate limited");
      return "openrouter output";
    },
  });

  assert.equal(result, "openrouter output");
  assert.deepEqual(called, ["nvidia-primary", "openrouter-fallback"]);
});

test("reports provider-chain exhaustion after all configured providers fail", async () => {
  await assert.rejects(
    runAiProviderChain({
      attempts,
      generate: async () => {
        throw providerError(503);
      },
    }),
    new Error(AI_PROVIDER_CHAIN_EXHAUSTED),
  );
});

test("does not fallback after a non-retryable provider error", async () => {
  const called: string[] = [];
  await assert.rejects(
    runAiProviderChain({
      attempts,
      generate: async (attempt) => {
        called.push(attempt.label);
        throw providerError(400, "invalid request");
      },
    }),
    /invalid request/,
  );
  assert.deepEqual(called, ["nvidia-primary"]);
});

test("falls back after provider-specific authentication, credit, and access failures", async () => {
  for (const statusCode of [401, 402, 403]) {
    const called: string[] = [];
    const result = await runAiProviderChain({
      attempts,
      generate: async (attempt) => {
        called.push(attempt.label);
        if (attempt.provider === "nvidia") throw providerError(statusCode);
        return "fallback output";
      },
    });

    assert.equal(result, "fallback output");
    assert.deepEqual(called, ["nvidia-primary", "openrouter-fallback"]);
  }
});

test("classifies provider failures with safe diagnostics only", () => {
  const classified = classifyProviderError(
    Object.assign(new Error("sensitive provider text"), {
      name: "AI_APICallError",
      statusCode: 429,
      isRetryable: true,
      responseBody: "private document content",
      responseHeaders: {
        "retry-after": "2",
        "x-request-id": "request_123",
        authorization: "Bearer secret",
      },
      data: { error: { code: "rate_limit_exceeded", message: "private content" } },
    }),
  );

  assert.deepEqual(classified, {
    category: "rate_limited",
    eligibleForFallback: true,
    statusCode: 429,
    errorName: "AI_APICallError",
    providerCode: "rate_limit_exceeded",
    requestId: "request_123",
    retryAfterMs: 2_000,
    retryable: true,
  });
  assert.equal("responseBody" in classified, false);
  assert.equal("message" in classified, false);
  assert.equal(AI_PROVIDER_CHAIN_BUDGET_MS, 120_000);
});

test("does not invoke fallback after a provider has returned text that later fails parsing", async () => {
  const called: string[] = [];
  const text = await runAiProviderChain({
    attempts,
    generate: async (attempt) => {
      called.push(attempt.label);
      return "malformed markdown";
    },
  });

  assert.throws(() => {
    if (text === "malformed markdown") throw new Error("parser failure");
  }, /parser failure/);
  assert.deepEqual(called, ["nvidia-primary"]);
});

test("a slow provider can still succeed within its explicit deadline", async () => {
  const result = await runAiProviderChain({
    attempts: [{ ...attempts[0]!, timeoutMs: 100 }],
    generate: async () => {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 10));
      return "slow success";
    },
    totalTimeoutMs: 150,
  });

  assert.equal(result, "slow success");
});

test("aborts a provider that never responds and falls back", async () => {
  let primaryAborted = false;
  let timeoutError: unknown;
  const called: string[] = [];
  const result = await runAiProviderChain({
    attempts: [
      { ...attempts[0]!, timeoutMs: 10 },
      { ...attempts[1]!, timeoutMs: 100 },
    ],
    generate: async (attempt, context) => {
      called.push(attempt.label);
      if (attempt.provider === "nvidia") {
        return new Promise<string>((_resolve, reject) => {
          context.abortSignal.addEventListener(
            "abort",
            () => {
              primaryAborted = true;
              timeoutError = context.abortSignal.reason;
              reject(context.abortSignal.reason);
            },
            { once: true },
          );
        });
      }
      return "fallback success";
    },
    totalTimeoutMs: 150,
  });

  assert.equal(result, "fallback success");
  assert.equal(primaryAborted, true);
  assert.ok(timeoutError instanceof Error);
  assert.equal(timeoutError.name, "AiProviderAttemptTimeoutError");
  assert.equal(timeoutError.message, AI_PROVIDER_ATTEMPT_TIMEOUT);
  assert.equal(classifyProviderError(timeoutError).category, "timeout");
  assert.equal(classifyProviderError(timeoutError).eligibleForFallback, true);
  assert.deepEqual(called, ["nvidia-primary", "openrouter-fallback"]);
});

test("falls through a timed-out NVIDIA request to OpenRouter", async () => {
  const called: string[] = [];
  const result = await runAiProviderChain({
    attempts: attempts.map((attempt) => ({ ...attempt, timeoutMs: 10 })),
    generate: async (attempt) => {
      called.push(attempt.label);
      if (attempt.provider === "nvidia") return new Promise<string>(() => undefined);
      return "openrouter success";
    },
    totalTimeoutMs: 100,
  });

  assert.equal(result, "openrouter success");
  assert.deepEqual(called, ["nvidia-primary", "openrouter-fallback"]);
});

test("stops at the global provider budget", async () => {
  const called: string[] = [];
  await assert.rejects(
    runAiProviderChain({
      attempts: attempts.map((attempt) => ({ ...attempt, timeoutMs: 40 })),
      generate: async (attempt) => {
        called.push(attempt.label);
        return new Promise<string>(() => undefined);
      },
      totalTimeoutMs: 25,
    }),
    new Error(AI_PROVIDER_CHAIN_EXHAUSTED),
  );

  assert.deepEqual(called, ["nvidia-primary"]);
});

test("logs provider start before a hung request and its bounded timeout", async () => {
  const events: Array<{ outcome: string; category: string }> = [];
  await assert.rejects(
    runAiProviderChain({
      attempts: [{ ...attempts[0]!, timeoutMs: 10 }],
      generate: async () => new Promise<string>(() => undefined),
      onAttempt: (event) => events.push(event),
      totalTimeoutMs: 20,
    }),
    new Error(AI_PROVIDER_CHAIN_EXHAUSTED),
  );

  assert.deepEqual(
    events.map(({ outcome, category }) => ({ outcome, category })),
    [
      { outcome: "started", category: "started" },
      { outcome: "failure", category: "timeout" },
    ],
  );
  assert.equal(AI_PROVIDER_ATTEMPT_TIMEOUT.includes("TIMEOUT"), true);
});
