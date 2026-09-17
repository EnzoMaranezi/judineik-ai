export const AI_PROVIDERS_UNAVAILABLE = "AI_PROVIDERS_UNAVAILABLE";
export const AI_PROVIDER_CHAIN_EXHAUSTED = "AI_PROVIDER_CHAIN_EXHAUSTED";
export const AI_PROVIDER_ATTEMPT_TIMEOUT = "AI_PROVIDER_ATTEMPT_TIMEOUT";
export const AI_PROVIDER_CHAIN_BUDGET_MS = 120_000;

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
  timeoutMs: number;
  outcome: "started" | "success" | "failure";
  category:
    | "started"
    | "success"
    | "timeout"
    | "rate_limited"
    | "model_unavailable"
    | "provider_unavailable"
    | "authentication"
    | "payment_required"
    | "forbidden"
    | "network"
    | "invalid_request"
    | "not_configured"
    | "unknown";
  statusCode?: number;
  errorName?: string;
  providerCode?: string;
  requestId?: string;
  retryAfterMs?: number;
  retryable?: boolean;
};

function attemptTimeoutError() {
  const error = new Error(AI_PROVIDER_ATTEMPT_TIMEOUT);
  error.name = "AiProviderAttemptTimeoutError";
  return error;
}

type ProviderFailureCategory = Exclude<AiProviderAttemptLog["category"], "started" | "success">;

type ProviderFailureClassification = {
  category: ProviderFailureCategory;
  eligibleForFallback: boolean;
  statusCode?: number;
  errorName?: string;
  providerCode?: string;
  requestId?: string;
  retryAfterMs?: number;
  retryable?: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function safeToken(value: unknown, maxLength = 96): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    /^[A-Za-z0-9._:/-]+$/.test(value)
    ? value
    : undefined;
}

function numericStatus(details: Record<string, unknown> | undefined) {
  if (typeof details?.["statusCode"] === "number") return details["statusCode"];
  if (typeof details?.["status"] === "number") return details["status"];
  return undefined;
}

function responseHeaders(details: Record<string, unknown> | undefined) {
  const headers = asRecord(details?.["responseHeaders"]);
  if (!headers) return undefined;
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
}

function parseRetryAfterMs(headers: Record<string, unknown> | undefined) {
  const milliseconds = Number(headers?.["retry-after-ms"]);
  if (Number.isFinite(milliseconds) && milliseconds >= 0) return Math.round(milliseconds);

  const seconds = Number(headers?.["retry-after"]);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1_000) : undefined;
}

function diagnosticFields(error: unknown) {
  const details = asRecord(error);
  const cause = asRecord(details?.["cause"]);
  const source =
    numericStatus(details) === undefined && numericStatus(cause) !== undefined ? cause : details;
  const headers = responseHeaders(source);
  const data = asRecord(source?.["data"]);
  const providerError = asRecord(data?.["error"]);
  const requestId = [
    headers?.["x-request-id"],
    headers?.["request-id"],
    headers?.["x-nvidia-request-id"],
    headers?.["x-openrouter-generation-id"],
    headers?.["cf-ray"],
  ]
    .map((value) => safeToken(value))
    .find(Boolean);
  const statusCode = numericStatus(source);
  const errorName = safeToken(source?.["name"]);
  const providerCode = safeToken(providerError?.["code"] ?? source?.["code"]);
  const retryAfterMs = parseRetryAfterMs(headers);
  const retryable =
    typeof source?.["isRetryable"] === "boolean" ? source["isRetryable"] : undefined;

  return {
    ...(statusCode === undefined ? {} : { statusCode }),
    ...(errorName === undefined ? {} : { errorName }),
    ...(providerCode === undefined ? {} : { providerCode }),
    ...(requestId === undefined ? {} : { requestId }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    ...(retryable === undefined ? {} : { retryable }),
  };
}

export function classifyProviderError(error: unknown): ProviderFailureClassification {
  const diagnostics = diagnosticFields(error);
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();
  const statusCode = diagnostics.statusCode;

  let category: ProviderFailureCategory;
  let eligibleForFallback: boolean;

  if (
    message === AI_PROVIDER_ATTEMPT_TIMEOUT ||
    statusCode === 408 ||
    (statusCode === undefined &&
      /^(?:(?:request|operation|connection|provider)\s+)?(?:timeout|timed\s+out)(?:\s+after\s+\d+(?:\.\d+)?\s*(?:ms|milliseconds?|s|seconds?))?[.!]?$/.test(
        normalized.trim(),
      ))
  ) {
    category = "timeout";
    eligibleForFallback = true;
  } else if (statusCode === 429) {
    category = "rate_limited";
    eligibleForFallback = true;
  } else if (
    statusCode === 404 ||
    statusCode === 410 ||
    /(?:model|provider).*(?:not found|no longer available|end of life|deprecated|gone)/i.test(
      message,
    )
  ) {
    category = "model_unavailable";
    eligibleForFallback = true;
  } else if (statusCode === 401) {
    category = "authentication";
    eligibleForFallback = true;
  } else if (statusCode === 402) {
    category = "payment_required";
    eligibleForFallback = true;
  } else if (statusCode === 403) {
    category = "forbidden";
    eligibleForFallback = true;
  } else if (
    statusCode === 409 ||
    statusCode === 425 ||
    (statusCode !== undefined && statusCode >= 500) ||
    diagnostics.retryable === true ||
    /no available provider|capacity|overload|temporar(?:y|ily)|free model/i.test(message)
  ) {
    category = "provider_unavailable";
    eligibleForFallback = true;
  } else if (
    /abort(?:ed)?|connection|connect|socket|econnreset|econnrefused|etimedout|fetch failed|failed to fetch/i.test(
      message,
    )
  ) {
    category = "network";
    eligibleForFallback = true;
  } else if (/provider is not configured/i.test(message)) {
    category = "not_configured";
    eligibleForFallback = true;
  } else if (
    statusCode === 400 ||
    statusCode === 413 ||
    statusCode === 422 ||
    normalized.includes("invalid request")
  ) {
    category = "invalid_request";
    eligibleForFallback = false;
  } else {
    category = "unknown";
    eligibleForFallback = false;
  }

  return { category, eligibleForFallback, ...diagnostics };
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
  return classifyProviderError(error).eligibleForFallback;
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
      timeoutMs,
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
        timeoutMs,
        outcome: "success",
        category: "success",
      });
      return result;
    } catch (error) {
      const classification = classifyProviderError(error);
      onAttempt?.({
        attempt: index + 1,
        provider: attempt.provider,
        model: attempt.model,
        latencyMs: Date.now() - startedAt,
        timeoutMs,
        outcome: "failure",
        ...classification,
      });
      if (!classification.eligibleForFallback) throw error;
    }
  }

  throw new Error(AI_PROVIDER_CHAIN_EXHAUSTED);
}
