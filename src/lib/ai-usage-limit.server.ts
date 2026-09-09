import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  AI_DAILY_LIMIT_REACHED,
  AI_GENERATION_IN_PROGRESS,
  AI_NETWORK_LIMIT_REACHED,
} from "@/lib/ai-errors";
import type { PersistedContentLocale } from "@/lib/i18n";
import {
  createAiQuotaAuthorization,
  createAiQuotaFinalizationAuthorization,
} from "@/lib/ai-quota-authorization.server";

export type AiGenerationKind =
  | "summary"
  | "questions"
  | "practice_questions"
  | "flashcards"
  | "topic_discovery";

export interface AiGenerationReservation {
  id: string;
  usedCount: number;
  limitCount: number;
  ipDigest: string;
  keyVersion: number;
  usageDate: string;
}

export const AI_GENERATION_RESERVATION_EXPIRED = "AI_GENERATION_RESERVATION_EXPIRED";

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "";
}

function hasDailyLimitCode(error: unknown) {
  return errorMessage(error).includes(AI_DAILY_LIMIT_REACHED);
}

function hasNetworkLimitCode(error: unknown) {
  return errorMessage(error).includes(AI_NETWORK_LIMIT_REACHED);
}

export function isAiDailyLimitError(error: unknown) {
  return error instanceof Error && error.message === AI_DAILY_LIMIT_REACHED;
}

export function isAiNetworkLimitError(error: unknown) {
  return error instanceof Error && error.message === AI_NETWORK_LIMIT_REACHED;
}

export function isAiGenerationInProgressError(error: unknown) {
  return errorMessage(error).includes(AI_GENERATION_IN_PROGRESS);
}

export async function reserveAiGeneration(
  supabase: SupabaseClient<Database>,
  kind: AiGenerationKind,
  documentId: string,
  locale: PersistedContentLocale,
  userId: string,
  topicId: string | null = null,
): Promise<AiGenerationReservation> {
  const quotaAuthorization = createAiQuotaAuthorization({
    userId,
    kind,
    documentId,
    locale,
    topicId,
  });
  const { data, error } = await supabase.rpc("reserve_ai_generation", {
    p_kind: kind,
    p_document_id: documentId,
    p_locale: locale,
    p_topic_id: topicId,
    p_action_id: quotaAuthorization.actionId,
    p_ip_digest: quotaAuthorization.ipDigest,
    p_key_version: quotaAuthorization.keyVersion,
    p_usage_date: quotaAuthorization.usageDate,
    p_issued_at: quotaAuthorization.issuedAt,
    p_authorization: quotaAuthorization.authorization,
  });

  if (error) {
    if (hasDailyLimitCode(error)) throw new Error(AI_DAILY_LIMIT_REACHED);
    if (hasNetworkLimitCode(error)) throw new Error(AI_NETWORK_LIMIT_REACHED);
    throw new Error(error.message);
  }

  const row = data?.[0];
  if (!row) throw new Error("AI generation quota could not be reserved.");

  return {
    id: row.reservation_id,
    usedCount: row.used_count,
    limitCount: row.limit_count,
    ipDigest: quotaAuthorization.ipDigest,
    keyVersion: quotaAuthorization.keyVersion,
    usageDate: quotaAuthorization.usageDate,
  };
}

export async function finishAiGeneration(
  supabase: SupabaseClient<Database>,
  userId: string,
  reservation: AiGenerationReservation,
  status: "succeeded" | "failed",
) {
  const finalization = createAiQuotaFinalizationAuthorization({
    userId,
    reservationId: reservation.id,
    status,
    ipDigest: reservation.ipDigest,
    keyVersion: reservation.keyVersion,
    usageDate: reservation.usageDate,
  });
  const { data, error } = await supabase.rpc("finish_ai_generation", {
    p_reservation_id: reservation.id,
    p_status: status,
    p_ip_digest: reservation.ipDigest,
    p_key_version: reservation.keyVersion,
    p_usage_date: reservation.usageDate,
    p_issued_at: finalization.issuedAt,
    p_authorization: finalization.authorization,
  });

  if (error) throw new Error(error.message);
  if (data === "expired") throw new Error(AI_GENERATION_RESERVATION_EXPIRED);
}
