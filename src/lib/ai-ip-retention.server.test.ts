import assert from "node:assert/strict";
import test from "node:test";
import {
  handleAiIpRetentionCron,
  isAuthorizedAiIpRetentionCron,
} from "./ai-ip-retention.server.ts";

const secret = "a".repeat(32);
const env = {
  AI_RETENTION_CRON_SECRET: secret,
  CRON_SECRET: secret,
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
};

function cronRequest(value?: string, usePreviewHeader = false) {
  return new Request("https://nexa.example/api/ai-ip-retention", {
    headers:
      value === undefined
        ? {}
        : usePreviewHeader
          ? { "x-ai-retention-cron-secret": value }
          : { authorization: `Bearer ${value}` },
  });
}

test("retention cron rejects missing and invalid authorization without cleanup", async () => {
  let calls = 0;
  const cleanup = async () => {
    calls += 1;
  };

  for (const request of [cronRequest(), cronRequest("wrong")]) {
    const response = await handleAiIpRetentionCron(request, { env, cleanup });
    assert.equal(response.status, 401);
  }

  assert.equal(calls, 0);
});

test("retention cron fails closed when the Vercel and endpoint secrets do not match", async () => {
  const response = await handleAiIpRetentionCron(cronRequest(secret), {
    env: { ...env, CRON_SECRET: "b".repeat(32) },
    cleanup: async () => assert.fail("cleanup must not run"),
    logError: () => undefined,
  });

  assert.equal(response.status, 503);
});

test("retention cron executes the fixed cleanup with valid authorization", async () => {
  let calls = 0;
  const response = await handleAiIpRetentionCron(cronRequest(secret), {
    env,
    cleanup: async () => {
      calls += 1;
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(calls, 1);
});

test("retention cron accepts the alternate header needed by protected Preview deployments", async () => {
  let calls = 0;
  const response = await handleAiIpRetentionCron(cronRequest(secret, true), {
    env,
    cleanup: async () => {
      calls += 1;
    },
  });

  assert.equal(response.status, 200);
  assert.equal(calls, 1);
});

test("retention cleanup remains safe when invoked repeatedly", async () => {
  let calls = 0;
  const cleanup = async () => {
    calls += 1;
  };

  for (let index = 0; index < 2; index += 1) {
    const response = await handleAiIpRetentionCron(cronRequest(secret), { env, cleanup });
    assert.equal(response.status, 200);
  }

  assert.equal(calls, 2);
});

test("authorization comparison accepts only the complete bearer value", () => {
  assert.equal(isAuthorizedAiIpRetentionCron(cronRequest(secret), secret), true);
  assert.equal(isAuthorizedAiIpRetentionCron(cronRequest(`${secret}suffix`), secret), false);
});
