import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  AI_PROVIDERS_UNAVAILABLE,
  runAiProviderChain,
  type AiProviderAttempt,
} from "@/lib/ai-provider-chain";
import {
  aiProviderConfigurationPresence,
  resolveAiProviderConfiguration,
  type AiProviderConfiguration,
} from "@/lib/ai-provider-config";
import { buildAiGenerationMessages } from "@/lib/ai-generation-messages";
import { getUserLocale, languageInstruction, type Locale } from "@/lib/i18n";

const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const AI_SDK_MAX_RETRIES = 0;

type AiGenerationRequest = {
  system: string;
  prompt: string;
  outputFormat?: string;
  languageInstruction: string;
  languageInstructionPlacement?: "system-and-prompt" | "prompt-only";
  languageInstructionFormat?: "contract" | "instruction-only";
  maxOutputTokens?: number;
  reasoningEffort?: "low" | "medium" | "high";
};

type AiTextGeneration = {
  text: string;
  provider: AiProviderAttempt["provider"];
  model: string;
};

function providerForAttempt(attempt: AiProviderAttempt, config: AiProviderConfiguration) {
  const apiKey = attempt.provider === "nvidia" ? config.nvidiaApiKey : config.openRouterApiKey;
  if (!apiKey) return null;

  return createOpenAICompatible({
    name: attempt.provider,
    baseURL: attempt.provider === "nvidia" ? NVIDIA_BASE_URL : OPENROUTER_BASE_URL,
    headers: { Authorization: `Bearer ${apiKey}` },
    supportsStructuredOutputs: false,
  });
}

function safeRuntimeMetadata(value: string | undefined, maxLength = 96) {
  return value && value.length <= maxLength && /^[A-Za-z0-9._/-]+$/.test(value) ? value : undefined;
}

function logUnavailableProviderConfiguration(config: AiProviderConfiguration) {
  const vercelEnvironment = safeRuntimeMetadata(process.env["VERCEL_ENV"]);
  const vercelRegion = safeRuntimeMetadata(process.env["VERCEL_REGION"]);
  const commitSha = safeRuntimeMetadata(process.env["VERCEL_GIT_COMMIT_SHA"], 64);

  console.error(
    "[ai-gateway-config]",
    JSON.stringify({
      event: "no_provider_attempts",
      ...aiProviderConfigurationPresence(config),
      ...(vercelEnvironment ? { vercelEnvironment } : {}),
      ...(vercelRegion ? { vercelRegion } : {}),
      ...(commitSha ? { commitSha } : {}),
    }),
  );
}

function logProviderAttempt(
  event: Parameters<NonNullable<Parameters<typeof runAiProviderChain>[0]["onAttempt"]>>[0],
) {
  console.info(
    "[ai-gateway]",
    JSON.stringify({
      provider: event.provider,
      model: event.model,
      attempt: event.attempt,
      latencyMs: event.latencyMs,
      timeoutMs: event.timeoutMs,
      outcome: event.outcome,
      category: event.category,
      ...(event.statusCode === undefined ? {} : { statusCode: event.statusCode }),
      ...(event.errorName === undefined ? {} : { errorName: event.errorName }),
      ...(event.providerCode === undefined ? {} : { providerCode: event.providerCode }),
      ...(event.requestId === undefined ? {} : { requestId: event.requestId }),
      ...(event.retryAfterMs === undefined ? {} : { retryAfterMs: event.retryAfterMs }),
      ...(event.retryable === undefined ? {} : { retryable: event.retryable }),
    }),
  );
}

export async function generateAiText({
  system,
  prompt,
  outputFormat,
  languageInstruction: outputLanguageInstruction,
  languageInstructionPlacement,
  languageInstructionFormat,
  maxOutputTokens,
  reasoningEffort,
}: AiGenerationRequest): Promise<AiTextGeneration> {
  // Read server env per request. Edge-style runtimes may inject it only when handling the request.
  const providerConfig = resolveAiProviderConfiguration(process.env);
  const attempts = providerConfig.attempts;
  if (attempts.length === 0) {
    logUnavailableProviderConfiguration(providerConfig);
    throw new Error(AI_PROVIDERS_UNAVAILABLE);
  }
  const messages = buildAiGenerationMessages({
    system,
    prompt,
    outputFormat,
    languageInstruction: outputLanguageInstruction,
    languageInstructionPlacement,
    languageInstructionFormat,
  });

  try {
    return await runAiProviderChain({
      attempts,
      generate: async (attempt, context) => {
        const provider = providerForAttempt(attempt, providerConfig);
        if (!provider) throw new Error("Provider is not configured.");

        const result = await generateText({
          model: provider(attempt.model),
          system: messages.system,
          prompt: messages.prompt,
          maxRetries: AI_SDK_MAX_RETRIES,
          abortSignal: context.abortSignal,
          timeout: context.timeoutMs,
          ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
          ...(attempt.provider === "nvidia" && reasoningEffort
            ? { providerOptions: { nvidia: { reasoningEffort } } }
            : {}),
        });
        return { text: result.text, provider: attempt.provider, model: attempt.model };
      },
      onAttempt: logProviderAttempt,
    });
  } catch (error) {
    throw new Error("AI_PROVIDER_REQUEST_FAILED");
  }
}

export function normalizeAiError(error: unknown, fallback: string): Error {
  const message = error instanceof Error ? error.message : "";
  if (message === AI_PROVIDERS_UNAVAILABLE) return new Error(AI_PROVIDERS_UNAVAILABLE);
  if (message === "AI_PROVIDER_REQUEST_FAILED") return new Error(fallback);
  if (/402/.test(message)) {
    return new Error("AI credits are exhausted for this workspace. Add credits and try again.");
  }
  if (/429/.test(message)) {
    return new Error("The AI service is rate limited right now. Please try again in a moment.");
  }
  return new Error(message || fallback);
}

/** Locale comes from claims already verified by requireSupabaseAuth. */
export function getAiLocaleContext(claims: { user_metadata?: unknown }): {
  locale: Locale;
  languageInstruction: string;
} {
  const locale = getUserLocale(claims.user_metadata as Record<string, unknown> | undefined);
  return { locale, languageInstruction: languageInstruction(locale) };
}
