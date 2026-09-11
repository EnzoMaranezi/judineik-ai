import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const DATABASE_PASSWORD = "synthetic-postgres-test-only";
const SIGNING_SECRET = "synthetic-quota-signing-secret-at-least-32-bytes";
const KEY_VERSION = 1;

const fixtureSql = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE SCHEMA extensions;
CREATE SCHEMA vault;
CREATE SCHEMA cron;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;

CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

CREATE TABLE public.documents (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  extracted_text text
);

CREATE TABLE public.document_topics (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  source_hash text NOT NULL
);

CREATE TABLE public.ai_generation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_date date NOT NULL DEFAULT ((now() AT TIME ZONE 'UTC')::date),
  kind text NOT NULL CHECK (kind IN ('summary', 'questions', 'practice_questions', 'flashcards', 'topic_discovery')),
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  topic_id uuid REFERENCES public.document_topics(id) ON DELETE SET NULL,
  topic_scope_id uuid,
  locale text NOT NULL CHECK (locale IN ('und', 'en', 'pt-BR')),
  status text NOT NULL CONSTRAINT ai_generation_events_status_check
    CHECK (status IN ('reserved', 'succeeded', 'failed')),
  reserved_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX ai_generation_events_user_day_count_idx
ON public.ai_generation_events(user_id, usage_date, status, reserved_until);
CREATE INDEX ai_generation_events_generation_identity_idx
ON public.ai_generation_events(user_id, document_id, topic_scope_id, kind, locale, status, reserved_until);
ALTER TABLE public.ai_generation_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_generation_events FROM anon, authenticated;

CREATE TABLE vault.decrypted_secrets (
  name text NOT NULL,
  decrypted_secret text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO vault.decrypted_secrets(name, decrypted_secret)
VALUES ('AI_QUOTA_RPC_SIGNING_SECRET', '${SIGNING_SECRET}');

CREATE TABLE cron.job (jobid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, jobname text NOT NULL);
CREATE FUNCTION cron.schedule(p_jobname text, p_schedule text, p_command text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE v_jobid bigint;
BEGIN
  INSERT INTO cron.job(jobname) VALUES (p_jobname) RETURNING jobid INTO v_jobid;
  RETURN v_jobid;
END $$;
`;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(value) {
  return createHmac("sha256", SIGNING_SECRET).update(value).digest("hex");
}

function reservePayload(userId, input) {
  return [
    "reserve",
    input.keyVersion,
    userId,
    input.kind,
    input.documentId,
    input.topicId ?? "-",
    input.locale,
    input.actionId,
    input.ipDigest,
    input.usageDate,
    input.issuedAt,
  ].join("\n");
}

function finishPayload(userId, input) {
  return [
    "finish",
    input.keyVersion,
    userId,
    input.reservationId,
    input.status,
    input.ipDigest,
    input.usageDate,
    input.issuedAt,
  ].join("\n");
}

function signedReserve(userId, documentId, overrides = {}) {
  const now = Date.now();
  const input = {
    kind: "summary",
    documentId,
    locale: "pt-BR",
    topicId: null,
    actionId: randomUUID(),
    ipDigest: sha256("network-a"),
    keyVersion: KEY_VERSION,
    usageDate: new Date(now).toISOString().slice(0, 10),
    issuedAt: Math.floor(now / 1000),
    ...overrides,
  };
  return { ...input, authorization: hmac(reservePayload(userId, input)) };
}

function signedFinish(userId, reservation, status = "succeeded", overrides = {}) {
  const input = {
    reservationId: reservation.reservation_id,
    status,
    ipDigest: reservation.ipDigest,
    keyVersion: reservation.keyVersion,
    usageDate: reservation.usageDate,
    issuedAt: Math.floor(Date.now() / 1000),
    ...overrides,
  };
  return { ...input, authorization: hmac(finishPayload(userId, input)) };
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  assert.equal(typeof address, "object");
  const port = address.port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function asUser(client, userId, sql, values = []) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
    const result = await client.query(sql, values);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function reserve(client, userId, input) {
  const result = await asUser(
    client,
    userId,
    `SELECT * FROM public.reserve_ai_generation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      input.kind,
      input.documentId,
      input.locale,
      input.topicId,
      input.actionId,
      input.ipDigest,
      input.keyVersion,
      input.usageDate,
      input.issuedAt,
      input.authorization,
    ],
  );
  return { ...result.rows[0], ipDigest: input.ipDigest, keyVersion: input.keyVersion, usageDate: input.usageDate };
}

async function finish(client, userId, input) {
  const result = await asUser(
    client,
    userId,
    `SELECT public.finish_ai_generation($1,$2,$3,$4,$5,$6,$7) AS outcome`,
    [
      input.reservationId,
      input.status,
      input.ipDigest,
      input.keyVersion,
      input.usageDate,
      input.issuedAt,
      input.authorization,
    ],
  );
  return result.rows[0].outcome;
}

async function reset(client) {
  await client.query(`TRUNCATE public.ai_ip_generation_events, public.ai_generation_events,
    public.document_topics, public.documents, auth.users CASCADE`);
}

async function createIdentity(client) {
  const userId = randomUUID();
  const documentId = randomUUID();
  await client.query("INSERT INTO auth.users(id) VALUES ($1)", [userId]);
  await client.query(
    "INSERT INTO public.documents(id,user_id,extracted_text) VALUES ($1,$2,'Synthetic academic material')",
    [documentId, userId],
  );
  return { userId, documentId };
}

async function seedPair(client, { userId, documentId, ipDigest, usageDate, status = "succeeded", count = 1 }) {
  for (let index = 0; index < count; index += 1) {
    const id = randomUUID();
    const completedAt = status === "reserved" ? null : new Date();
    await client.query(
      `INSERT INTO public.ai_generation_events
       (id,user_id,usage_date,kind,document_id,locale,status,reserved_until,completed_at,action_id)
       VALUES ($1,$2,$3,'summary',$4,'pt-BR',$5,clock_timestamp()+interval '30 minutes',$6,$7)`,
      [id, userId, usageDate, documentId, status, completedAt, randomUUID()],
    );
    await client.query(
      `INSERT INTO public.ai_ip_generation_events
       (reservation_id,usage_date,ip_digest,key_version,status,reserved_until,completed_at)
       VALUES ($1,$2,decode($3,'hex'),1,$4,clock_timestamp()+interval '30 minutes',$5)`,
      [id, usageDate, ipDigest, status, completedAt],
    );
  }
}

async function expectError(promise, code) {
  await assert.rejects(promise, (error) => String(error?.message).includes(code));
}

const checks = [];
function check(name, callback) {
  checks.push({ name, callback });
}

check("first reservation, exact replay, changed signed parameters and concurrent replay", async ({ client, connect }) => {
  await reset(client);
  const identity = await createIdentity(client);
  const catalog = await client.query(`SELECT
    to_regprocedure('public.reserve_ai_generation(text,uuid,text,uuid)') IS NULL AS old_reserve_removed,
    to_regprocedure('public.finish_ai_generation(uuid,text)') IS NULL AS old_finish_removed,
    has_function_privilege('anon','public.reserve_ai_generation(text,uuid,text,uuid,uuid,text,integer,date,bigint,text)','EXECUTE') AS anon_reserve,
    has_function_privilege('authenticated','public.reserve_ai_generation(text,uuid,text,uuid,uuid,text,integer,date,bigint,text)','EXECUTE') AS authenticated_reserve`);
  assert.deepEqual(catalog.rows[0], {
    old_reserve_removed: true,
    old_finish_removed: true,
    anon_reserve: false,
    authenticated_reserve: true,
  });
  const input = signedReserve(identity.userId, identity.documentId);
  const first = await reserve(client, identity.userId, input);
  const replay = await reserve(client, identity.userId, input);
  assert.equal(replay.reservation_id, first.reservation_id);

  const changed = signedReserve(identity.userId, identity.documentId, {
    ...input,
    kind: "questions",
  });
  changed.authorization = hmac(reservePayload(identity.userId, changed));
  await expectError(reserve(client, identity.userId, changed), "AI_GENERATION_ACTION_REPLAY_REJECTED");

  await reset(client);
  const concurrentIdentity = await createIdentity(client);
  const concurrentInput = signedReserve(concurrentIdentity.userId, concurrentIdentity.documentId);
  const left = await connect();
  const right = await connect();
  try {
    const results = await Promise.all([
      reserve(left, concurrentIdentity.userId, concurrentInput),
      reserve(right, concurrentIdentity.userId, concurrentInput),
    ]);
    assert.equal(results[0].reservation_id, results[1].reservation_id);
    const count = await client.query("SELECT count(*)::int AS count FROM public.ai_generation_events");
    assert.equal(count.rows[0].count, 1);
  } finally {
    await left.end();
    await right.end();
  }
});

check("20th account action is allowed and 21st is blocked across IPs", async ({ client }) => {
  await reset(client);
  const identity = await createIdentity(client);
  const date = new Date().toISOString().slice(0, 10);
  await seedPair(client, { ...identity, ipDigest: sha256("account-limit-a"), usageDate: date, count: 19 });
  await reserve(client, identity.userId, signedReserve(identity.userId, identity.documentId, { ipDigest: sha256("account-limit-b") }));
  await expectError(
    reserve(client, identity.userId, signedReserve(identity.userId, identity.documentId, { kind: "questions", ipDigest: sha256("account-limit-c") })),
    "AI_DAILY_LIMIT_REACHED",
  );
});

check("100th network action is allowed and 101st is blocked across accounts", async ({ client }) => {
  await reset(client);
  const date = new Date().toISOString().slice(0, 10);
  const ipDigest = sha256("shared-network-limit");
  const identities = [];
  for (let index = 0; index < 6; index += 1) identities.push(await createIdentity(client));
  for (let index = 0; index < 5; index += 1) {
    await seedPair(client, { ...identities[index], ipDigest, usageDate: date, count: index === 4 ? 19 : 20 });
  }
  await reserve(client, identities[5].userId, signedReserve(identities[5].userId, identities[5].documentId, { ipDigest }));
  await expectError(
    reserve(client, identities[5].userId, signedReserve(identities[5].userId, identities[5].documentId, { kind: "questions", ipDigest })),
    "AI_NETWORK_LIMIT_REACHED",
  );
});

check("real concurrency admits only one final account slot and one final IP slot", async ({ client, connect }) => {
  await reset(client);
  const date = new Date().toISOString().slice(0, 10);
  const identity = await createIdentity(client);
  const accountIp = sha256("account-race");
  await seedPair(client, { ...identity, ipDigest: accountIp, usageDate: date, count: 19 });
  const clients = [await connect(), await connect()];
  try {
    const settled = await Promise.allSettled([
      reserve(clients[0], identity.userId, signedReserve(identity.userId, identity.documentId, { kind: "questions", ipDigest: accountIp })),
      reserve(clients[1], identity.userId, signedReserve(identity.userId, identity.documentId, { kind: "flashcards", ipDigest: accountIp })),
    ]);
    assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(settled.filter((result) => result.status === "rejected" && String(result.reason.message).includes("AI_DAILY_LIMIT_REACHED")).length, 1);
  } finally {
    await Promise.all(clients.map((connection) => connection.end()));
  }

  await reset(client);
  const ipDigest = sha256("ip-race");
  const identities = [];
  for (let index = 0; index < 7; index += 1) identities.push(await createIdentity(client));
  for (let index = 0; index < 5; index += 1) {
    await seedPair(client, { ...identities[index], ipDigest, usageDate: date, count: index === 4 ? 19 : 20 });
  }
  const ipClients = [await connect(), await connect()];
  try {
    const settled = await Promise.allSettled([
      reserve(ipClients[0], identities[5].userId, signedReserve(identities[5].userId, identities[5].documentId, { ipDigest })),
      reserve(ipClients[1], identities[6].userId, signedReserve(identities[6].userId, identities[6].documentId, { ipDigest })),
    ]);
    assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(settled.filter((result) => result.status === "rejected" && String(result.reason.message).includes("AI_NETWORK_LIMIT_REACHED")).length, 1);
  } finally {
    await Promise.all(ipClients.map((connection) => connection.end()));
  }
});

check("paired inserts and updates are transaction-atomic", async ({ client }) => {
  await reset(client);
  const identity = await createIdentity(client);
  const blockedDigest = sha256("blocked-insert");
  await client.query(`
    CREATE FUNCTION public.test_reject_ip_insert() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.ip_digest = decode('${blockedDigest}','hex') THEN RAISE EXCEPTION 'TEST_SECOND_INSERT_FAILURE'; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER test_reject_ip_insert BEFORE INSERT ON public.ai_ip_generation_events
    FOR EACH ROW EXECUTE FUNCTION public.test_reject_ip_insert();
  `);
  const input = signedReserve(identity.userId, identity.documentId, { ipDigest: blockedDigest });
  await expectError(reserve(client, identity.userId, input), "TEST_SECOND_INSERT_FAILURE");
  const rolledBack = await client.query("SELECT count(*)::int AS count FROM public.ai_generation_events WHERE action_id=$1", [input.actionId]);
  assert.equal(rolledBack.rows[0].count, 0);
  await client.query("DROP TRIGGER test_reject_ip_insert ON public.ai_ip_generation_events; DROP FUNCTION public.test_reject_ip_insert()");

  const reservation = await reserve(client, identity.userId, signedReserve(identity.userId, identity.documentId));
  await client.query(`
    CREATE FUNCTION public.test_reject_ip_update() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.reservation_id = '${reservation.reservation_id}'::uuid THEN RAISE EXCEPTION 'TEST_SECOND_UPDATE_FAILURE'; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER test_reject_ip_update BEFORE UPDATE ON public.ai_ip_generation_events
    FOR EACH ROW EXECUTE FUNCTION public.test_reject_ip_update();
  `);
  await expectError(finish(client, identity.userId, signedFinish(identity.userId, reservation)), "TEST_SECOND_UPDATE_FAILURE");
  const statuses = await client.query(
    `SELECT account_event.status AS account_status, ip_event.status AS ip_status
     FROM public.ai_generation_events account_event JOIN public.ai_ip_generation_events ip_event
     ON ip_event.reservation_id=account_event.id WHERE account_event.id=$1`,
    [reservation.reservation_id],
  );
  assert.deepEqual(statuses.rows[0], { account_status: "reserved", ip_status: "reserved" });
  await client.query("DROP TRIGGER test_reject_ip_update ON public.ai_ip_generation_events; DROP FUNCTION public.test_reject_ip_update()");
});

check("invalid and expired signatures fail closed", async ({ client }) => {
  await reset(client);
  const identity = await createIdentity(client);
  const invalid = signedReserve(identity.userId, identity.documentId);
  invalid.authorization = `${invalid.authorization.slice(0, -1)}${invalid.authorization.endsWith("0") ? "1" : "0"}`;
  await expectError(reserve(client, identity.userId, invalid), "INVALID_AI_QUOTA_AUTHORIZATION");

  const issuedAt = Math.floor(Date.now() / 1000) - 301;
  const expired = signedReserve(identity.userId, identity.documentId, { issuedAt });
  expired.authorization = hmac(reservePayload(identity.userId, expired));
  await expectError(reserve(client, identity.userId, expired), "INVALID_AI_QUOTA_AUTHORIZATION");

  const unsigned = signedReserve(identity.userId, identity.documentId);
  unsigned.authorization = "0".repeat(64);
  await expectError(reserve(client, identity.userId, unsigned), "INVALID_AI_QUOTA_AUTHORIZATION");

  const missingReservation = {
    reservation_id: randomUUID(),
    ipDigest: sha256("missing-reservation"),
    keyVersion: 1,
    usageDate: new Date().toISOString().slice(0, 10),
  };
  await expectError(
    finish(client, identity.userId, signedFinish(identity.userId, missingReservation)),
    "AI_GENERATION_RESERVATION_NOT_FOUND",
  );

  await client.query("DELETE FROM vault.decrypted_secrets WHERE name='AI_QUOTA_RPC_SIGNING_SECRET'");
  await expectError(
    reserve(client, identity.userId, signedReserve(identity.userId, identity.documentId)),
    "AI_QUOTA_CONFIGURATION_UNAVAILABLE",
  );
  await client.query(
    "INSERT INTO vault.decrypted_secrets(name,decrypted_secret) VALUES ('AI_QUOTA_RPC_SIGNING_SECRET',$1)",
    [SIGNING_SECRET],
  );
});

check("finish rechecks expiry after waiting for both reservation row locks", async ({ client, connect }) => {
  await reset(client);
  const identity = await createIdentity(client);
  const reservation = await reserve(client, identity.userId, signedReserve(identity.userId, identity.documentId));
  const expiresAt = new Date(Date.now() + 1_200);
  await client.query("UPDATE public.ai_generation_events SET reserved_until=$2 WHERE id=$1", [reservation.reservation_id, expiresAt]);
  await client.query("UPDATE public.ai_ip_generation_events SET reserved_until=$2 WHERE reservation_id=$1", [reservation.reservation_id, expiresAt]);

  const blocker = await connect();
  const finisher = await connect();
  let finishPromise;
  try {
    await blocker.query("BEGIN");
    await blocker.query(
      `SELECT account_event.id
       FROM public.ai_generation_events AS account_event
       JOIN public.ai_ip_generation_events AS ip_event
         ON ip_event.reservation_id = account_event.id
       WHERE account_event.id = $1
       FOR UPDATE OF account_event, ip_event`,
      [reservation.reservation_id],
    );

    const finisherPid = (await finisher.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    finishPromise = finish(finisher, identity.userId, signedFinish(identity.userId, reservation));

    let observedLockWait = false;
    const waitDeadline = Date.now() + 1_000;
    while (Date.now() < waitDeadline) {
      const activity = await client.query(
        "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",
        [finisherPid],
      );
      if (activity.rows[0]?.wait_event_type === "Lock") {
        observedLockWait = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(observedLockWait, true, "finish must be waiting on the held reservation row locks");

    const remaining = expiresAt.getTime() - Date.now();
    if (remaining >= 0) await new Promise((resolve) => setTimeout(resolve, remaining + 100));
    await blocker.query("COMMIT");

    assert.equal(await finishPromise, "expired");
    const statuses = await client.query(
      `SELECT account_event.status AS account_status, ip_event.status AS ip_status,
              account_event.completed_at >= account_event.reserved_until AS account_finished_after_expiry,
              ip_event.completed_at >= ip_event.reserved_until AS ip_finished_after_expiry,
              (SELECT count(*)::int FROM public.ai_generation_events
               WHERE status = 'succeeded' OR (status = 'reserved' AND reserved_until > clock_timestamp())) AS account_count,
              (SELECT count(*)::int FROM public.ai_ip_generation_events
               WHERE status = 'succeeded' OR (status = 'reserved' AND reserved_until > clock_timestamp())) AS ip_count
       FROM public.ai_generation_events AS account_event
       JOIN public.ai_ip_generation_events AS ip_event
         ON ip_event.reservation_id = account_event.id
       WHERE account_event.id = $1`,
      [reservation.reservation_id],
    );
    assert.deepEqual(statuses.rows[0], {
      account_status: "expired",
      ip_status: "expired",
      account_finished_after_expiry: true,
      ip_finished_after_expiry: true,
      account_count: 0,
      ip_count: 0,
    });
  } finally {
    await blocker.query("ROLLBACK").catch(() => {});
    if (finishPromise) await finishPromise.catch(() => {});
    await blocker.end();
    await finisher.end();
  }
});

check("expired reservation cannot become success after its account and IP slots are reused", async ({ client, connect }) => {
  await reset(client);
  const date = new Date().toISOString().slice(0, 10);
  const ipDigest = sha256("late-finalization-network");
  const identities = [];
  for (let index = 0; index < 6; index += 1) identities.push(await createIdentity(client));
  await seedPair(client, { ...identities[0], ipDigest, usageDate: date, count: 19 });
  for (let index = 1; index < 5; index += 1) {
    await seedPair(client, { ...identities[index], ipDigest, usageDate: date, count: 20 });
  }
  const old = await reserve(client, identities[0].userId, signedReserve(identities[0].userId, identities[0].documentId, { ipDigest }));
  const expiredAt = new Date(Date.now() - 1_000);
  await client.query("UPDATE public.ai_generation_events SET reserved_until=$2 WHERE id=$1", [old.reservation_id, expiredAt]);
  await client.query("UPDATE public.ai_ip_generation_events SET reserved_until=$2 WHERE reservation_id=$1", [old.reservation_id, expiredAt]);
  const finishInput = signedFinish(identities[0].userId, old);
  const left = await connect();
  const right = await connect();
  let replacement;
  let oldOutcome;
  try {
    [replacement, oldOutcome] = await Promise.all([
      reserve(left, identities[0].userId, signedReserve(identities[0].userId, identities[0].documentId, { kind: "questions", ipDigest })),
      finish(right, identities[0].userId, finishInput),
    ]);
    assert.equal(oldOutcome, "expired");
  } finally {
    await left.end();
    await right.end();
  }
  assert.ok(replacement);
  assert.equal(
    await finish(client, identities[0].userId, signedFinish(identities[0].userId, replacement)),
    "succeeded",
  );

  const totals = await client.query(
    `SELECT
      (SELECT count(*)::int FROM public.ai_generation_events a WHERE a.user_id=$1 AND a.usage_date=$2
       AND (a.status='succeeded' OR (a.status='reserved' AND a.reserved_until>clock_timestamp()))) AS account_count,
      (SELECT count(*)::int FROM public.ai_ip_generation_events i WHERE i.ip_digest=decode($3,'hex') AND i.usage_date=$2
       AND (i.status='succeeded' OR (i.status='reserved' AND i.reserved_until>clock_timestamp()))) AS ip_count,
      (SELECT status FROM public.ai_generation_events WHERE id=$4) AS old_status,
      (SELECT status FROM public.ai_generation_events WHERE id=$5) AS replacement_status`,
    [identities[0].userId, date, ipDigest, old.reservation_id, replacement.reservation_id],
  );
  assert.deepEqual(totals.rows[0], {
    account_count: 20,
    ip_count: 100,
    old_status: "expired",
    replacement_status: "succeeded",
  });
});

check("normal finalization is idempotent and conflicting final status is rejected", async ({ client, connect }) => {
  await reset(client);
  const identity = await createIdentity(client);
  const reservation = await reserve(client, identity.userId, signedReserve(identity.userId, identity.documentId));
  const input = signedFinish(identity.userId, reservation);
  const clients = [await connect(), await connect()];
  try {
    const outcomes = await Promise.all(clients.map((connection) => finish(connection, identity.userId, input)));
    assert.deepEqual(outcomes, ["succeeded", "succeeded"]);
  } finally {
    await Promise.all(clients.map((connection) => connection.end()));
  }
  await expectError(finish(client, identity.userId, signedFinish(identity.userId, reservation, "failed")), "AI_GENERATION_FINALIZATION_CONFLICT");

  const failedReservation = await reserve(
    client,
    identity.userId,
    signedReserve(identity.userId, identity.documentId, { kind: "questions" }),
  );
  assert.equal(
    await finish(client, identity.userId, signedFinish(identity.userId, failedReservation, "failed")),
    "failed",
  );
  const failedStatuses = await client.query(
    `SELECT account_event.status AS account_status, ip_event.status AS ip_status
     FROM public.ai_generation_events account_event JOIN public.ai_ip_generation_events ip_event
     ON ip_event.reservation_id=account_event.id WHERE account_event.id=$1`,
    [failedReservation.reservation_id],
  );
  assert.deepEqual(failedStatuses.rows[0], { account_status: "failed", ip_status: "failed" });
});

check("UTC day is signed, stale-day reserve/replay is rejected, and prior-day finalization remains valid", async ({ client }) => {
  await reset(client);
  const identity = await createIdentity(client);
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const stale = signedReserve(identity.userId, identity.documentId, { usageDate: yesterday });
  stale.authorization = hmac(reservePayload(identity.userId, stale));
  await expectError(reserve(client, identity.userId, stale), "INVALID_AI_QUOTA_AUTHORIZATION");

  const active = await reserve(client, identity.userId, signedReserve(identity.userId, identity.documentId, { usageDate: today }));
  const crossedReplay = signedReserve(identity.userId, identity.documentId, {
    actionId: randomUUID(),
    usageDate: yesterday,
  });
  crossedReplay.authorization = hmac(reservePayload(identity.userId, crossedReplay));
  await expectError(reserve(client, identity.userId, crossedReplay), "INVALID_AI_QUOTA_AUTHORIZATION");

  await client.query("UPDATE public.ai_generation_events SET usage_date=$2 WHERE id=$1", [active.reservation_id, yesterday]);
  await client.query("UPDATE public.ai_ip_generation_events SET usage_date=$2 WHERE reservation_id=$1", [active.reservation_id, yesterday]);
  active.usageDate = yesterday;
  assert.equal(await finish(client, identity.userId, signedFinish(identity.userId, active)), "succeeded");
  const stored = await client.query("SELECT usage_date::text,status FROM public.ai_generation_events WHERE id=$1", [active.reservation_id]);
  assert.deepEqual(stored.rows[0], { usage_date: yesterday, status: "succeeded" });
});

check("account deletion preserves aggregate IP events and retention is independent and safe", async ({ client }) => {
  await reset(client);
  const identity = await createIdentity(client);
  const date = new Date().toISOString().slice(0, 10);
  const ipDigest = sha256("retention-network");
  await seedPair(client, { ...identity, ipDigest, usageDate: date });
  await client.query("DELETE FROM auth.users WHERE id=$1", [identity.userId]);
  assert.equal((await client.query("SELECT count(*)::int AS count FROM public.ai_generation_events")).rows[0].count, 0);
  assert.equal((await client.query("SELECT count(*)::int AS count FROM public.ai_ip_generation_events")).rows[0].count, 1);

  const oldDate = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
  for (const [created, usage] of [
    ["10 days", oldDate],
    ["6 days", oldDate],
    ["10 days", date],
  ]) {
    await client.query(
      `INSERT INTO public.ai_ip_generation_events
       (reservation_id,usage_date,ip_digest,key_version,status,reserved_until,created_at,completed_at)
       VALUES (gen_random_uuid(),$1,decode($2,'hex'),1,'succeeded',clock_timestamp()-interval '1 day',clock_timestamp()-$3::interval,clock_timestamp())`,
      [usage, ipDigest, created],
    );
  }
  assert.equal((await client.query("SELECT public.cleanup_ai_ip_generation_events() AS count")).rows[0].count, 1);
  assert.equal((await client.query("SELECT count(*)::int AS count FROM public.ai_ip_generation_events")).rows[0].count, 3);
  await expectError(asUser(client, randomUUID(), "SELECT public.cleanup_ai_ip_generation_events()"), "permission denied");
});

async function main() {
  const port = await freePort();
  const databaseDir = await mkdtemp(join(tmpdir(), "nexa-ai-quota-postgres-"));
  const postgres = new EmbeddedPostgres({
    databaseDir,
    port,
    user: "postgres",
    password: DATABASE_PASSWORD,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });
  let client;
  const connect = async () => {
    const connection = postgres.getPgClient("postgres", "127.0.0.1");
    await connection.connect();
    return connection;
  };
  try {
    await postgres.initialise();
    await postgres.start();
    client = await connect();
    await client.query(fixtureSql);
    const migration = await readFile(new URL("../supabase/migrations/0011_ai_ip_rate_limits.sql", import.meta.url), "utf8");
    await client.query(migration);
    const retentionAutomation = await readFile(
      new URL("../supabase/migrations/0012_ai_ip_retention_automation.sql", import.meta.url),
      "utf8",
    );
    await client.query(retentionAutomation);
    const retentionPrivileges = await client.query(
      `SELECT has_function_privilege('service_role', 'public.cleanup_ai_ip_generation_events()', 'EXECUTE') AS can_cleanup,
              has_table_privilege('service_role', 'public.ai_ip_generation_events', 'DELETE') AS can_delete_ip_events`,
    );
    assert.deepEqual(retentionPrivileges.rows[0], { can_cleanup: true, can_delete_ip_events: false });
    const retentionJob = await readFile(new URL("../supabase/operations/schedule_ai_ip_quota_retention.sql", import.meta.url), "utf8");
    await client.query(retentionJob);
    await client.query(retentionJob);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM cron.job")).rows[0].count, 1);

    for (const { name, callback } of checks) {
      await callback({ client, connect });
      console.log(`ok - ${name}`);
    }
    console.log(`${checks.length} PostgreSQL quota checks passed on an isolated local cluster.`);
  } finally {
    if (client) await client.end().catch(() => {});
    await postgres.stop().catch(() => {});
  }
}

await main();
