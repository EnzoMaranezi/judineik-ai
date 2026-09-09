import { createHmac, randomUUID } from "node:crypto";
import { getRequest } from "@tanstack/react-start/server";
import type { AiGenerationKind } from "./ai-usage-limit.server.ts";
import type { PersistedContentLocale } from "./i18n.tsx";
import { trustedClientIpFromHeaders } from "./ai-client-ip.ts";

export const AI_QUOTA_CONFIGURATION_UNAVAILABLE = "AI_QUOTA_CONFIGURATION_UNAVAILABLE";
export const AI_TRUSTED_IP_UNAVAILABLE = "AI_TRUSTED_IP_UNAVAILABLE";
export const AI_QUOTA_AUTHORIZATION_VERSION = 1;

type GenerationScope = {
  userId: string;
  kind: AiGenerationKind;
  documentId: string;
  locale: PersistedContentLocale;
  topicId: string | null;
};

export type AiQuotaAuthorization = {
  actionId: string;
  ipDigest: string;
  keyVersion: number;
  issuedAt: number;
  authorization: string;
};

export function requireQuotaSecret(value: string | undefined): string {
  if (!value || Buffer.byteLength(value, "utf8") < 32) {
    throw new Error(AI_QUOTA_CONFIGURATION_UNAVAILABLE);
  }
  return value;
}

function requiredSecret(name: "AI_IP_HMAC_SECRET" | "AI_QUOTA_RPC_SIGNING_SECRET"): string {
  return requireQuotaSecret(process.env[name]);
}

export function hmacSha256Hex(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

export function reservationAuthorizationPayload(
  scope: GenerationScope,
  authorization: Omit<AiQuotaAuthorization, "authorization">,
): string {
  return [
    "reserve",
    authorization.keyVersion,
    scope.userId,
    scope.kind,
    scope.documentId,
    scope.topicId ?? "-",
    scope.locale,
    authorization.actionId,
    authorization.ipDigest,
    authorization.issuedAt,
  ].join("\n");
}

export function finalizationAuthorizationPayload({
  userId,
  reservationId,
  status,
  ipDigest,
  keyVersion,
  issuedAt,
}: {
  userId: string;
  reservationId: string;
  status: "succeeded" | "failed";
  ipDigest: string;
  keyVersion: number;
  issuedAt: number;
}): string {
  return ["finish", keyVersion, userId, reservationId, status, ipDigest, issuedAt].join("\n");
}

export function createAiQuotaAuthorization(scope: GenerationScope): AiQuotaAuthorization {
  const request = getRequest();
  const clientIp = request?.headers ? trustedClientIpFromHeaders(request.headers) : null;
  if (!clientIp) throw new Error(AI_TRUSTED_IP_UNAVAILABLE);

  const ipDigest = hmacSha256Hex(
    requiredSecret("AI_IP_HMAC_SECRET"),
    `nexa-ai-ip-v${AI_QUOTA_AUTHORIZATION_VERSION}\n${clientIp.family}\n${clientIp.address}`,
  );
  const unsigned = {
    actionId: randomUUID(),
    ipDigest,
    keyVersion: AI_QUOTA_AUTHORIZATION_VERSION,
    issuedAt: Math.floor(Date.now() / 1000),
  };
  return {
    ...unsigned,
    authorization: hmacSha256Hex(
      requiredSecret("AI_QUOTA_RPC_SIGNING_SECRET"),
      reservationAuthorizationPayload(scope, unsigned),
    ),
  };
}

export function createAiQuotaFinalizationAuthorization({
  userId,
  reservationId,
  status,
  ipDigest,
  keyVersion,
}: {
  userId: string;
  reservationId: string;
  status: "succeeded" | "failed";
  ipDigest: string;
  keyVersion: number;
}) {
  const issuedAt = Math.floor(Date.now() / 1000);
  return {
    issuedAt,
    authorization: hmacSha256Hex(
      requiredSecret("AI_QUOTA_RPC_SIGNING_SECRET"),
      finalizationAuthorizationPayload({
        userId,
        reservationId,
        status,
        ipDigest,
        keyVersion,
        issuedAt,
      }),
    ),
  };
}
