import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/0011_ai_ip_rate_limits.sql", import.meta.url),
  "utf8",
);

test("creates a private IP event table without account, document or raw-IP columns", () => {
  assert.match(migration, /CREATE TABLE public\.ai_ip_generation_events[\s\S]*reservation_id uuid PRIMARY KEY/);
  assert.match(migration, /ip_digest bytea NOT NULL CHECK \(octet_length\(ip_digest\) = 32\)/);
  const table = migration.match(/CREATE TABLE public\.ai_ip_generation_events \(([\s\S]*?)\n\);/)?.[1] ?? "";
  assert.doesNotMatch(table, /user_id|document_id|ip_address|raw_ip/);
  for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
    assert.match(migration, new RegExp(`REVOKE ALL ON TABLE public\\.ai_ip_generation_events FROM ${role}`));
  }
  assert.match(migration, /ALTER TABLE public\.ai_ip_generation_events ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /GRANT (?:SELECT|INSERT|UPDATE|DELETE|ALL) ON TABLE public\.ai_ip_generation_events/);
});

test("removes unsigned overloads and grants only the signed RPC signatures", () => {
  assert.match(migration, /DROP FUNCTION IF EXISTS public\.reserve_ai_generation\(text, uuid, text, uuid\)/);
  assert.match(migration, /DROP FUNCTION IF EXISTS public\.finish_ai_generation\(uuid, text\)/);
  assert.match(migration, /CREATE FUNCTION public\.reserve_ai_generation\([\s\S]*p_action_id uuid[\s\S]*p_authorization text/);
  assert.match(migration, /CREATE FUNCTION public\.finish_ai_generation\([\s\S]*p_authorization text/);
  assert.match(migration, /p_usage_date date/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.reserve_ai_generation\([^)]+\) FROM PUBLIC/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.finish_ai_generation\([^)]+\) FROM anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.reserve_ai_generation\([^)]+\) TO authenticated/);
});

test("validates signed short-lived authorization and document/topic ownership before reservation", () => {
  assert.match(migration, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(migration, /p_issued_at < v_now_epoch - 300[\s\S]*p_issued_at > v_now_epoch \+ 30/);
  assert.match(migration, /FROM vault\.decrypted_secrets[\s\S]*name = 'AI_QUOTA_RPC_SIGNING_SECRET'/);
  assert.match(migration, /extensions\.hmac\([\s\S]*convert_to\(v_signing_secret, 'UTF8'\)[\s\S]*'sha256'/);
  assert.match(migration, /public\.ai_quota_secure_equals/);
  const ownership = migration.indexOf("FROM public.documents");
  const locks = migration.indexOf("'ai-ip:'");
  const insert = migration.indexOf("INSERT INTO public.ai_generation_events");
  assert.ok(ownership > 0 && ownership < locks && locks < insert);
  assert.match(migration, /FROM public\.document_topics[\s\S]*document_id = p_document_id[\s\S]*user_id = v_user_id/);
});

test("serializes IP, account and scope in a fixed order and enforces exact limits", () => {
  const ipLock = migration.indexOf("'ai-ip:'");
  const accountLock = migration.indexOf("hashtext(v_user_id::text), hashtext(v_usage_date::text)");
  const scopeLock = migration.indexOf("COALESCE(p_topic_id::text, 'document')");
  assert.ok(ipLock > 0 && ipLock < accountLock && accountLock < scopeLock);
  assert.match(migration, /v_account_limit integer := 20/);
  assert.match(migration, /v_ip_limit integer := 100/);
  assert.match(migration, /IF v_account_used >= v_account_limit THEN[\s\S]*AI_DAILY_LIMIT_REACHED/);
  assert.match(migration, /IF v_ip_used >= v_ip_limit THEN[\s\S]*AI_NETWORK_LIMIT_REACHED/);
  assert.match(migration, /account_event\.status = 'succeeded'[\s\S]*account_event\.status = 'reserved' AND account_event\.reserved_until > v_now/);

  const accountLimit = Number(migration.match(/v_account_limit integer := (\d+)/)?.[1]);
  const ipLimit = Number(migration.match(/v_ip_limit integer := (\d+)/)?.[1]);
  const canReserve = (accountUsed: number, ipUsed: number) =>
    accountUsed < accountLimit && ipUsed < ipLimit;
  assert.equal(canReserve(19, 99), true, "the 20th account action and 100th network action fit");
  assert.equal(canReserve(20, 20), false, "the 21st account action is rejected even on another IP");
  assert.equal(canReserve(1, 100), false, "the 101st aggregate network action is rejected across accounts");
  assert.equal(canReserve(19, 0), true, "the same account may use a different IP without bypassing its account total");
});

test("uses one shared reservation and atomic paired finalization semantics", () => {
  assert.match(migration, /v_reservation_id := gen_random_uuid\(\)/);
  assert.match(migration, /INSERT INTO public\.ai_generation_events[\s\S]*v_reservation_id[\s\S]*INSERT INTO public\.ai_ip_generation_events[\s\S]*v_reservation_id/);
  assert.match(migration, /FOR UPDATE OF account_event, ip_event/);
  assert.match(migration, /IF v_account_status = p_status AND v_ip_status = p_status THEN[\s\S]*RETURN/);
  assert.match(migration, /IF v_account_status <> 'reserved' OR v_ip_status <> 'reserved' THEN[\s\S]*AI_GENERATION_FINALIZATION_CONFLICT/);
  assert.match(migration, /UPDATE public\.ai_generation_events[\s\S]*UPDATE public\.ai_ip_generation_events/);
  assert.match(migration, /v_account_reserved_until <= v_now[\s\S]*status = 'expired'[\s\S]*RETURN 'expired'/);
});

test("keeps UTC boundaries, expired reservations and independent retention semantics explicit", () => {
  assert.match(migration, /transaction_timestamp\(\) AT TIME ZONE 'UTC'/);
  assert.match(migration, /p_usage_date IS DISTINCT FROM v_usage_date/);
  assert.match(migration, /clock_timestamp\(\)[\s\S]*p_usage_date IS DISTINCT FROM \(\(v_now AT TIME ZONE 'UTC'\)::date\)/);
  assert.match(migration, /reserved_until > v_now/);
  assert.match(migration, /CREATE FUNCTION public\.cleanup_ai_ip_generation_events\(\)/);
  assert.match(migration, /created_at < v_now - interval '7 days'[\s\S]*usage_date < v_usage_date/);
  const reserveBody = migration.slice(migration.indexOf("CREATE FUNCTION public.reserve_ai_generation"), migration.indexOf("CREATE FUNCTION public.finish_ai_generation"));
  assert.doesNotMatch(reserveBody, /DELETE FROM public\.ai_ip_generation_events/);
  assert.match(migration, /now \+ interval '30 minutes'/);
});

test("qualifies replay identifiers that collide with output-column names", () => {
  assert.match(migration, /WHERE ip_event\.reservation_id = v_existing\.id/);
  assert.doesNotMatch(migration, /WHERE reservation_id = v_existing\.id/);
});
