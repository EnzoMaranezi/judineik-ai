import assert from "node:assert/strict";
import test from "node:test";
import { runReservedAiGeneration } from "./ai-generation-action.ts";
import { runAiProviderChain, type AiProviderAttempt } from "./ai-provider-chain.ts";

const attempts: AiProviderAttempt[] = [
  { provider: "nvidia", model: "primary", label: "nvidia-primary" },
  { provider: "nvidia", model: "fallback", label: "nvidia-fallback" },
  { provider: "openrouter", model: "configured", label: "openrouter-fallback" },
];

test("does not call a provider or finish a reservation when quota reservation fails", async () => {
  let generated = false;
  let finished = false;
  await assert.rejects(
    runReservedAiGeneration({
      reserve: async () => {
        throw new Error("AI_DAILY_LIMIT_REACHED");
      },
      generate: async () => {
        generated = true;
        return "output";
      },
      finish: async () => {
        finished = true;
      },
    }),
    /AI_DAILY_LIMIT_REACHED/,
  );
  assert.equal(generated, false);
  assert.equal(finished, false);
});

test("a network quota rejection also performs no provider call or finalization", async () => {
  let generated = false;
  let finished = false;
  await assert.rejects(
    runReservedAiGeneration({
      reserve: async () => {
        throw new Error("AI_NETWORK_LIMIT_REACHED");
      },
      generate: async () => {
        generated = true;
        return "output";
      },
      finish: async () => {
        finished = true;
      },
    }),
    /AI_NETWORK_LIMIT_REACHED/,
  );
  assert.equal(generated, false);
  assert.equal(finished, false);
});

test("uses one reservation when an EOL provider falls back successfully", async () => {
  let reservations = 0;
  const finished: string[] = [];
  const called: string[] = [];
  const result = await runReservedAiGeneration({
    reserve: async () => {
      reservations += 1;
      return "reservation";
    },
    generate: () =>
      runAiProviderChain({
        attempts,
        generate: async (attempt) => {
          called.push(attempt.label);
          if (attempt.label === "nvidia-primary") {
            throw Object.assign(new Error("model reached end of life"), { statusCode: 410 });
          }
          return "generated text";
        },
      }),
    finish: async (_reservation, status) => {
      finished.push(status);
    },
  });

  assert.equal(result, "generated text");
  assert.equal(reservations, 1);
  assert.deepEqual(called, ["nvidia-primary", "nvidia-fallback"]);
  assert.deepEqual(finished, ["succeeded"]);
});

test("counts a returned generation even when downstream parsing fails", async () => {
  const finished: string[] = [];
  const result = await runReservedAiGeneration({
    reserve: async () => "reservation",
    generate: async () => "malformed markdown",
    finish: async (_reservation, status) => {
      finished.push(status);
    },
  });

  assert.throws(() => {
    if (result === "malformed markdown") throw new Error("parser failure");
  }, /parser failure/);
  assert.deepEqual(finished, ["succeeded"]);
});

test("counts a returned generation when post-generation persistence fails", async () => {
  const finished: string[] = [];
  await assert.rejects(
    runReservedAiGeneration({
      reserve: async () => "reservation",
      generate: async () => "valid provider output",
      afterGenerate: async () => {
        throw new Error("persistence failure");
      },
      finish: async (_reservation, status) => {
        finished.push(status);
      },
    }),
    /persistence failure/,
  );
  assert.deepEqual(finished, ["succeeded"]);
});

test("releases a reservation when all providers fail before returning text", async () => {
  const finished: string[] = [];
  await assert.rejects(
    runReservedAiGeneration({
      reserve: async () => "reservation",
      generate: async () => {
        throw new Error("AI_PROVIDERS_UNAVAILABLE");
      },
      finish: async (_reservation, status) => {
        finished.push(status);
      },
    }),
    /AI_PROVIDERS_UNAVAILABLE/,
  );
  assert.deepEqual(finished, ["failed"]);
});

test("does not issue a conflicting second finalization when finalization itself fails", async () => {
  const finished: string[] = [];
  await assert.rejects(
    runReservedAiGeneration({
      reserve: async () => "reservation",
      generate: async () => "generated output",
      finish: async (_reservation, status) => {
        finished.push(status);
        throw new Error("AI_GENERATION_RESERVATION_EXPIRED");
      },
    }),
    /AI_GENERATION_RESERVATION_EXPIRED/,
  );
  assert.deepEqual(finished, ["succeeded"]);
});

test("a provider timeout aborts the request and finalizes the reservation as failed", async () => {
  const finished: string[] = [];
  let providerAborted = false;

  await assert.rejects(
    runReservedAiGeneration({
      reserve: async () => "reservation",
      generate: () =>
        runAiProviderChain({
          attempts: [{ provider: "nvidia", model: "primary", label: "primary", timeoutMs: 10 }],
          generate: async (_attempt, context) =>
            new Promise<string>((_resolve, reject) => {
              context.abortSignal.addEventListener(
                "abort",
                () => {
                  providerAborted = true;
                  reject(context.abortSignal.reason);
                },
                { once: true },
              );
            }),
          totalTimeoutMs: 20,
        }),
      finish: async (_reservation, status) => {
        finished.push(status);
      },
    }),
    /AI_PROVIDERS_UNAVAILABLE/,
  );

  assert.equal(providerAborted, true);
  assert.deepEqual(finished, ["failed"]);
});
