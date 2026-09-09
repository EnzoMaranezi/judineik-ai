import { userErrorKey } from "./user-errors.ts";

export const AI_DAILY_LIMIT_REACHED = "AI_DAILY_LIMIT_REACHED";
export const AI_NETWORK_LIMIT_REACHED = "AI_NETWORK_LIMIT_REACHED";
export const AI_PROVIDERS_UNAVAILABLE = "AI_PROVIDERS_UNAVAILABLE";
export const AI_GENERATION_IN_PROGRESS = "AI_GENERATION_IN_PROGRESS";

export function aiErrorMessage(error: unknown, t: (key: string) => string, fallback: string) {
  const key = userErrorKey(error, "errors.generate");
  return key === "errors.generate" ? fallback : t(key);
}
