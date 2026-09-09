import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_QUOTA_CONFIGURATION_UNAVAILABLE,
  finalizationAuthorizationPayload,
  hmacSha256Hex,
  requireQuotaSecret,
  reservationAuthorizationPayload,
  utcUsageDate,
} from "./ai-quota-authorization.server.ts";

const scope = {
  userId: "11111111-1111-4111-8111-111111111111",
  kind: "summary" as const,
  documentId: "22222222-2222-4222-8222-222222222222",
  locale: "pt-BR" as const,
  topicId: null,
};

test("reservation authorization binds user, scope, action, IP digest and timestamp", () => {
  const unsigned = {
    actionId: "33333333-3333-4333-8333-333333333333",
    ipDigest: "ab".repeat(32),
    keyVersion: 1,
    usageDate: "2027-01-15",
    issuedAt: 1_800_000_000,
  };
  const payload = reservationAuthorizationPayload(scope, unsigned);
  assert.equal(
    payload,
    ["reserve", "1", scope.userId, "summary", scope.documentId, "-", "pt-BR", unsigned.actionId, unsigned.ipDigest, "2027-01-15", "1800000000"].join("\n"),
  );
  assert.equal(hmacSha256Hex("secret", payload).length, 64);
  assert.notEqual(
    hmacSha256Hex("secret", payload),
    hmacSha256Hex("secret", payload.replace("pt-BR", "en")),
  );
  assert.notEqual(
    hmacSha256Hex("secret", payload),
    hmacSha256Hex("secret", payload.replace("2027-01-15", "2027-01-16")),
  );
});

test("finalization authorization binds the final status and reservation", () => {
  const common = {
    userId: scope.userId,
    reservationId: "44444444-4444-4444-8444-444444444444",
    ipDigest: "cd".repeat(32),
    keyVersion: 1,
    usageDate: "2027-01-15",
    issuedAt: 1_800_000_010,
  };
  const succeeded = finalizationAuthorizationPayload({ ...common, status: "succeeded" });
  const failed = finalizationAuthorizationPayload({ ...common, status: "failed" });
  assert.notEqual(hmacSha256Hex("secret", succeeded), hmacSha256Hex("secret", failed));
  assert.notEqual(
    hmacSha256Hex("secret", succeeded),
    hmacSha256Hex("secret", finalizationAuthorizationPayload({ ...common, status: "succeeded", usageDate: "2027-01-16" })),
  );
});

test("UTC usage date is deterministic at the day boundary", () => {
  assert.equal(utcUsageDate(Date.parse("2027-01-15T23:59:59.999Z")), "2027-01-15");
  assert.equal(utcUsageDate(Date.parse("2027-01-16T00:00:00.000Z")), "2027-01-16");
});

test("quota secrets fail closed when absent", () => {
  assert.throws(() => requireQuotaSecret(undefined), new RegExp(AI_QUOTA_CONFIGURATION_UNAVAILABLE));
  assert.throws(() => requireQuotaSecret(""), new RegExp(AI_QUOTA_CONFIGURATION_UNAVAILABLE));
  assert.throws(() => requireQuotaSecret("too-short"), new RegExp(AI_QUOTA_CONFIGURATION_UNAVAILABLE));
  const configured = "a-secure-test-secret-with-32-bytes";
  assert.equal(requireQuotaSecret(configured), configured);
});
