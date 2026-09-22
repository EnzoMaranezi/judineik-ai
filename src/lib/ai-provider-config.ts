import type { AiProviderAttempt } from "./ai-provider-chain.ts";

export const NVIDIA_PRIMARY_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";
export const NVIDIA_PRIMARY_TIMEOUT_MS = 60_000;
export const OPENROUTER_PROVIDER_TIMEOUT_MS = 60_000;

export type AiProviderEnvironment = {
  NVIDIA_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
};

export type AiProviderConfiguration = {
  nvidiaApiKey?: string;
  openRouterApiKey?: string;
  openRouterModel?: string;
  attempts: AiProviderAttempt[];
};

function configuredValue(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function resolveAiProviderConfiguration(
  env: AiProviderEnvironment,
): AiProviderConfiguration {
  const nvidiaApiKey = configuredValue(env.NVIDIA_API_KEY);
  const openRouterApiKey = configuredValue(env.OPENROUTER_API_KEY);
  const openRouterModel = configuredValue(env.OPENROUTER_MODEL);
  const attempts: AiProviderAttempt[] = [];

  if (nvidiaApiKey) {
    attempts.push({
      provider: "nvidia",
      model: NVIDIA_PRIMARY_MODEL,
      label: "nvidia-primary",
      timeoutMs: NVIDIA_PRIMARY_TIMEOUT_MS,
    });
  }

  if (openRouterApiKey && openRouterModel) {
    attempts.push({
      provider: "openrouter",
      model: openRouterModel,
      label: "openrouter-fallback",
      timeoutMs: OPENROUTER_PROVIDER_TIMEOUT_MS,
    });
  }

  return {
    ...(nvidiaApiKey ? { nvidiaApiKey } : {}),
    ...(openRouterApiKey ? { openRouterApiKey } : {}),
    ...(openRouterModel ? { openRouterModel } : {}),
    attempts,
  };
}

export function aiProviderConfigurationPresence(config: AiProviderConfiguration) {
  return {
    hasNvidiaApiKey: Boolean(config.nvidiaApiKey),
    hasOpenRouterApiKey: Boolean(config.openRouterApiKey),
    hasOpenRouterModel: Boolean(config.openRouterModel),
    attemptCount: config.attempts.length,
  };
}
