import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (process.platform === "win32") {
  const require = createRequire(import.meta.url);
  const os = require("node:os");
  try {
    os.userInfo();
  } catch {
    os.userInfo = () => ({ uid: -1, gid: -1, username: "windows", homedir: tmpdir(), shell: null });
    syncBuiltinESMExports();
  }
}

const { default: EmbeddedPostgres } = await import("embedded-postgres");

const fixtureSql = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE SCHEMA storage;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text,
  phone text,
  encrypted_password text,
  raw_user_meta_data jsonb,
  email_change text,
  phone_change text
);
CREATE TABLE auth.sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE
AS $$ SELECT jsonb_build_object('session_id', nullif(current_setting('request.jwt.claim.session_id', true), '')) $$;
CREATE FUNCTION storage.foldername(p_name text) RETURNS text[] LANGUAGE sql IMMUTABLE
AS $$ SELECT string_to_array(p_name, '/') $$;

CREATE TABLE public.documents (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'Synthetic material'
);
CREATE TABLE public.document_topics (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE
);
CREATE TABLE public.summaries (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE
);
CREATE TABLE public.question_sets (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE
);
CREATE TABLE public.question_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  question_set_id uuid REFERENCES public.question_sets(id) ON DELETE SET NULL
);
CREATE TABLE public.flashcard_sets (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  topic_id uuid REFERENCES public.document_topics(id) ON DELETE CASCADE
);
CREATE TABLE public.flashcards (
  id uuid PRIMARY KEY,
  flashcard_set_id uuid NOT NULL REFERENCES public.flashcard_sets(id) ON DELETE CASCADE,
  due_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.flashcard_reviews (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  flashcard_id uuid NOT NULL REFERENCES public.flashcards(id) ON DELETE CASCADE
);
CREATE TABLE public.ai_generation_events (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL,
  reserved_until timestamptz NOT NULL
);
CREATE TABLE public.ai_ip_generation_events (
  reservation_id uuid PRIMARY KEY,
  status text NOT NULL
);

CREATE TABLE storage.objects (
  id uuid PRIMARY KEY,
  bucket_id text NOT NULL,
  name text NOT NULL
);

GRANT USAGE ON SCHEMA public, auth, storage TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public, storage TO authenticated, service_role;

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flashcard_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flashcards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flashcard_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE POLICY own_documents ON public.documents TO authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
CREATE POLICY own_topics ON public.document_topics TO authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
CREATE POLICY own_summaries ON public.summaries TO authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
CREATE POLICY own_sets ON public.question_sets TO authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
CREATE POLICY own_sessions ON public.question_sessions TO authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
CREATE POLICY own_flashcard_sets ON public.flashcard_sets TO authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
CREATE POLICY own_flashcards ON public.flashcards TO authenticated
USING (EXISTS (SELECT 1 FROM public.flashcard_sets s WHERE s.id=flashcard_set_id AND s.user_id=auth.uid()));
CREATE POLICY own_reviews ON public.flashcard_reviews TO authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
CREATE POLICY own_storage ON storage.objects TO authenticated
USING ((storage.foldername(name))[1]=auth.uid()::text)
WITH CHECK ((storage.foldername(name))[1]=auth.uid()::text);

CREATE FUNCTION public.persist_summary_fixture(p_document_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_id uuid:=gen_random_uuid();
BEGIN INSERT INTO public.summaries(id,user_id,document_id) VALUES(v_id,auth.uid(),p_document_id); RETURN v_id; END $$;
CREATE FUNCTION public.reserve_fixture() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_id uuid:=gen_random_uuid();
BEGIN INSERT INTO public.ai_generation_events(id,user_id,status,reserved_until)
VALUES(v_id,auth.uid(),'reserved',clock_timestamp()+interval '30 minutes'); RETURN v_id; END $$;
CREATE FUNCTION public.finish_fixture(p_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
UPDATE public.ai_generation_events SET status='succeeded' WHERE id=p_id AND user_id=auth.uid() $$;
GRANT EXECUTE ON FUNCTION public.persist_summary_fixture(uuid), public.reserve_fixture(), public.finish_fixture(uuid) TO authenticated;
`;

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  assert.equal(typeof address, "object");
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

async function asUser(client, identity, sql, values = []) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [identity.userId]);
    await client.query("SELECT set_config('request.jwt.claim.session_id',$1,true)", [identity.sessionId]);
    const result = await client.query(sql, values);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function withJwtClaims(client, identity, sql, values = []) {
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [identity.userId]);
    await client.query("SELECT set_config('request.jwt.claim.session_id',$1,true)", [identity.sessionId]);
    const result = await client.query(sql, values);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function identity(client, age = "0 minutes") {
  const userId = randomUUID();
  const sessionId = randomUUID();
  const documentId = randomUUID();
  await client.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,'synthetic@example.invalid','{}')", [userId]);
  await client.query("INSERT INTO auth.sessions(id,user_id,created_at) VALUES($1,$2,clock_timestamp()-$3::interval)", [sessionId, userId, age]);
  await client.query("INSERT INTO public.documents(id,user_id) VALUES($1,$2)", [documentId, userId]);
  return { userId, sessionId, documentId };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => String(error?.message).includes(code));
}

async function seedTree(client, owner) {
  const topicId = randomUUID();
  const summaryId = randomUUID();
  const questionSetId = randomUUID();
  const sessionId = randomUUID();
  const flashcardSetId = randomUUID();
  const flashcardId = randomUUID();
  const reviewId = randomUUID();
  const reservationId = randomUUID();
  await client.query("INSERT INTO public.document_topics VALUES($1,$2,$3)", [topicId, owner.userId, owner.documentId]);
  await client.query("INSERT INTO public.summaries VALUES($1,$2,$3)", [summaryId, owner.userId, owner.documentId]);
  await client.query("INSERT INTO public.question_sets VALUES($1,$2,$3)", [questionSetId, owner.userId, owner.documentId]);
  await client.query("INSERT INTO public.question_sessions VALUES($1,$2,$3,$4)", [sessionId, owner.userId, owner.documentId, questionSetId]);
  await client.query("INSERT INTO public.flashcard_sets VALUES($1,$2,$3,$4)", [flashcardSetId, owner.userId, owner.documentId, topicId]);
  await client.query("INSERT INTO public.flashcards(id,flashcard_set_id) VALUES($1,$2)", [flashcardId, flashcardSetId]);
  await client.query("INSERT INTO public.flashcard_reviews VALUES($1,$2,$3)", [reviewId, owner.userId, flashcardId]);
  await client.query("INSERT INTO public.ai_generation_events VALUES($1,$2,'reserved',clock_timestamp()+interval '30 minutes')", [reservationId, owner.userId]);
  await client.query("INSERT INTO public.ai_ip_generation_events VALUES($1,'reserved')", [reservationId]);
  return { reservationId };
}

async function main() {
  const port = await freePort();
  const databaseDir = await mkdtemp(join(tmpdir(), "nexa-account-deletion-postgres-"));
  const postgres = new EmbeddedPostgres({
    databaseDir,
    port,
    user: "postgres",
    password: "synthetic-account-deletion-test",
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });
  let client;
  try {
    await postgres.initialise();
    console.log("ok - isolated PostgreSQL cluster initialized");
    await postgres.start();
    console.log("ok - isolated PostgreSQL cluster started");
    client = postgres.getPgClient("postgres", "127.0.0.1");
    await client.connect();
    console.log("ok - PostgreSQL test client connected");
    await client.query(fixtureSql);
    console.log("ok - account-deletion fixture installed");
    const migration = await readFile(new URL("../supabase/migrations/0013_account_deletion.sql", import.meta.url), "utf8");
    await client.query(migration);
    console.log("ok - migration 0013 applied to isolated PostgreSQL");

    const recent = await identity(client);
    assert.equal((await asUser(client, recent, "SELECT public.begin_account_deletion() AS status")).rows[0].status, "pending");
    assert.equal((await asUser(client, recent, "SELECT public.begin_account_deletion() AS status")).rows[0].status, "pending");
    assert.equal((await asUser(client, recent, "SELECT public.is_account_active($1) AS active", [recent.userId])).rows[0].active, false);

    const old = await identity(client, "11 minutes");
    await expectCode(asUser(client, old, "SELECT public.begin_account_deletion()"), "ACCOUNT_REAUTHENTICATION_REQUIRED");

    assert.equal((await asUser(client, recent, "SELECT count(*)::int AS count FROM public.documents")).rows[0].count, 0);
    await expectCode(
      asUser(client, recent, "INSERT INTO public.documents(id,user_id) VALUES($1,$2)", [randomUUID(), recent.userId]),
      "ACCOUNT_DELETION_IN_PROGRESS",
    );
    await expectCode(
      asUser(client, recent, "SELECT public.persist_summary_fixture($1)", [recent.documentId]),
      "ACCOUNT_DELETION_IN_PROGRESS",
    );
    await expectCode(asUser(client, recent, "SELECT public.reserve_fixture()"), "ACCOUNT_DELETION_IN_PROGRESS");
    await expectCode(
      withJwtClaims(client, recent, "UPDATE auth.users SET raw_user_meta_data='{\"locale\":\"pt-BR\"}' WHERE id=$1", [recent.userId]),
      "ACCOUNT_DELETION_IN_PROGRESS",
    );

    const active = await identity(client);
    const activeReservation = (await asUser(client, active, "SELECT public.reserve_fixture() AS id")).rows[0].id;
    await asUser(client, active, "SELECT public.begin_account_deletion()");
    await asUser(client, active, "SELECT public.finish_fixture($1)", [activeReservation]);
    assert.equal((await client.query("SELECT status FROM public.ai_generation_events WHERE id=$1", [activeReservation])).rows[0].status, "succeeded");

    const unaffected = await identity(client);
    assert.equal((await asUser(client, unaffected, "SELECT public.is_account_active($1) AS active", [unaffected.userId])).rows[0].active, true);
    await asUser(client, unaffected, "INSERT INTO public.documents(id,user_id) VALUES($1,$2)", [randomUUID(), unaffected.userId]);

    await expectCode(
      asUser(client, unaffected, "SELECT * FROM public.account_deletion_requests"),
      "permission denied",
    );
    await expectCode(
      client.query("INSERT INTO public.documents(id,user_id) VALUES($1,$2)", [randomUUID(), randomUUID()]),
      "documents_user_id_fkey",
    );

    const cascade = await identity(client);
    const tree = await seedTree(client, cascade);
    await asUser(client, cascade, "SELECT public.begin_account_deletion()");
    await client.query("DELETE FROM auth.users WHERE id=$1", [cascade.userId]);
    const remaining = await client.query(`SELECT
      (SELECT count(*)::int FROM public.documents WHERE user_id=$1) AS documents,
      (SELECT count(*)::int FROM public.document_topics WHERE user_id=$1) AS topics,
      (SELECT count(*)::int FROM public.summaries WHERE user_id=$1) AS summaries,
      (SELECT count(*)::int FROM public.question_sets WHERE user_id=$1) AS question_sets,
      (SELECT count(*)::int FROM public.question_sessions WHERE user_id=$1) AS sessions,
      (SELECT count(*)::int FROM public.flashcard_sets WHERE user_id=$1) AS flashcard_sets,
      (SELECT count(*)::int FROM public.flashcard_reviews WHERE user_id=$1) AS reviews,
      (SELECT count(*)::int FROM public.ai_generation_events WHERE user_id=$1) AS account_events,
      (SELECT count(*)::int FROM public.account_deletion_requests WHERE user_id=$1) AS deletion_requests,
      (SELECT count(*)::int FROM public.ai_ip_generation_events WHERE reservation_id=$2) AS ip_events`,
      [cascade.userId, tree.reservationId]);
    assert.deepEqual(remaining.rows[0], {
      documents: 0,
      topics: 0,
      summaries: 0,
      question_sets: 0,
      sessions: 0,
      flashcard_sets: 0,
      reviews: 0,
      account_events: 0,
      deletion_requests: 0,
      ip_events: 1,
    });

    const catalog = await client.query(`SELECT
      has_table_privilege('authenticated','public.account_deletion_requests','SELECT') AS authenticated_select,
      has_function_privilege('anon','public.begin_account_deletion()','EXECUTE') AS anon_begin,
      has_function_privilege('authenticated','public.begin_account_deletion()','EXECUTE') AS authenticated_begin,
      (SELECT count(*)::int FROM pg_policies WHERE policyname LIKE 'Account must be active%') AS active_policies`);
    assert.deepEqual(catalog.rows[0], {
      authenticated_select: false,
      anon_begin: false,
      authenticated_begin: true,
      active_policies: 9,
    });

    console.log("ok - recent reauthentication, idempotent marker, and stale-session rejection");
    console.log("ok - account-active RLS, RPC triggers, profile blocking, and finalization exception");
    console.log("ok - full Auth cascade removes personal rows and preserves IP events");
    console.log("ok - user isolation, privileges, and documents FK");
    console.log("4 PostgreSQL account-deletion checks passed on an isolated local cluster.");
  } catch (error) {
    console.error(error);
    throw error;
  } finally {
    if (client) await client.end().catch(() => {});
    await Promise.race([
      postgres.stop().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }
}

try {
  await main();
} catch {
  process.exitCode = 1;
} finally {
  // embedded-postgres can retain a stale child-process handle after taskkill on Windows.
  if (process.platform === "win32") process.exit(process.exitCode ?? 0);
}
