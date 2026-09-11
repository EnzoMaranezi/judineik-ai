export const AI_PROVIDERS_UNAVAILABLE = "AI_PROVIDERS_UNAVAILABLE";
export const AI_PROVIDER_ATTEMPT_TIMEOUT = "AI_PROVIDER_ATTEMPT_TIMEOUT";
export const AI_PROVIDER_CHAIN_BUDGET_MS = 180_000;

export type AiProviderAttempt = {
  provider: "nvidia" | "openrouter";
  model: string;
  label: string;
  timeoutMs?: number;
};

export type AiProviderAttemptContext = {
  abortSignal: AbortSignal;
  timeoutMs: number;
};

export type AiProviderAttemptLog = {
  attempt: number;
  provider: AiProviderAttempt["provider"];
  model: string;
  latencyMs: number;
  outcome: "started" | "success" | "failure";
  category: "started" | "success" | "transient" | "non_retryable" | "not_configured";
};

function attemptTimeoutError() {
  return new Error(AI_PROVIDER_ATTEMPT_TIMEOUT);
}

async function runProviderAttempt<T>({
  attempt,
  timeoutMs,
  generate,
}: {
  attempt: AiProviderAttempt;
  timeoutMs: number;
  generate: (attempt: AiProviderAttempt, context: AiProviderAttemptContext) => Promise<T>;
}): Promise<T> {
  const controller = new AbortController();
  let rejectTimeout: ((error: Error) => void) | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    rejectTimeout = reject;
  });
  const timer = globalThis.setTimeout(() => {
    const error = attemptTimeoutError();
    controller.abort(error);
    rejectTimeout?.(error);
  }, timeoutMs);

  try {
    return await Promise.race([
      generate(attempt, { abortSignal: controller.signal, timeoutMs }),
      timeoutPromise,
    ]);
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export function isEligibleProviderFallback(error: unknown) {
  const details = typeof error === "object" && error !== null ? error : undefined;
  const statusCode =
    details && "statusCode" in details && typeof details.statusCode === "number"
      ? details.statusCode
      : details && "status" in details && typeof details.status === "number"
        ? details.status
        : undefined;

  if (
    statusCode !== undefined &&
    (statusCode === 404 ||
      statusCode === 410 ||
      statusCode === 408 ||
      statusCode === 409 ||
      statusCode === 425 ||
      statusCode === 429 ||
      statusCode >= 500)
  ) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error ?? "");
  return /(?:model|provider).*(?:unavailable|not available|not found|no longer available|end of life|deprecated|gone)|no available provider|capacity|overload|temporar(?:y|ily)|timeout|timed out|abort(?:ed)?|connection|connect|socket|econnreset|econnrefused|fetch failed|free model/i.test(
    message,
  );
}

export async function runAiProviderChain<T>({
  attempts,
  generate,
  onAttempt,
  totalTimeoutMs = AI_PROVIDER_CHAIN_BUDGET_MS,
}: {
  attempts: AiProviderAttempt[];
  generate: (attempt: AiProviderAttempt, context: AiProviderAttemptContext) => Promise<T>;
  onAttempt?: (event: AiProviderAttemptLog) => void;
  totalTimeoutMs?: number;
}): Promise<T> {
  const chainStartedAt = Date.now();

  for (const [index, attempt] of attempts.entries()) {
    const remainingMs = totalTimeoutMs - (Date.now() - chainStartedAt);
    if (remainingMs <= 0) break;

    const timeoutMs = Math.min(attempt.timeoutMs ?? remainingMs, remainingMs);
    const startedAt = Date.now();
    onAttempt?.({
      attempt: index + 1,
      provider: attempt.provider,
      model: attempt.model,
      latencyMs: 0,
      outcome: "started",
      category: "started",
    });

    try {
      const result = await runProviderAttempt({ attempt, timeoutMs, generate });
      onAttempt?.({
        attempt: index + 1,
        provider: attempt.provider,
        model: attempt.model,
        latencyMs: Date.now() - startedAt,
        outcome: "success",
        category: "success",
      });
      return result;
    } catch (error) {
      const eligibleForFallback = isEligibleProviderFallback(error);
      onAttempt?.({
        attempt: index + 1,
        provider: attempt.provider,
        model: attempt.model,
        latencyMs: Date.now() - startedAt,
        outcome: "failure",
        category: eligibleForFallback ? "transient" : "non_retryable",
      });
      if (!eligibleForFallback) throw error;
    }
  }

  throw new Error(AI_PROVIDERS_UNAVAILABLE);
}
