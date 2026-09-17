import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countTopicSourceCharacters } from "../src/lib/topic-source-eligibility.ts";

if (process.platform === "win32") {
  const os = createRequire(import.meta.url)("node:os");
  try { os.userInfo(); } catch {
    os.userInfo = () => ({ uid: -1, gid: -1, username: "windows", homedir: tmpdir(), shell: null });
    syncBuiltinESMExports();
  }
}
const { default: EmbeddedPostgres } = await import("embedded-postgres");
const historical = await readFile(new URL("../supabase/migrations/0007_document_topics.sql", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/0014_topic_source_eligibility.sql", import.meta.url), "utf8");
const deletion = await readFile(new URL("../supabase/migrations/0013_account_deletion.sql", import.meta.url), "utf8");
const removed = [9, 10, 11, 12, 13, 32, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002,
  0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff];

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function main() {
  const postgres = new EmbeddedPostgres({
    databaseDir: await mkdtemp(join(tmpdir(), "nexa-topic-source-postgres-")),
    port: await freePort(), user: "postgres", password: "synthetic-topic-test",
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    persistent: false, onLog: () => {}, onError: () => {},
  });
  let client;
  let checks = 0;
  async function check(name, run) {
    await run(); checks++;
    console.log(`ok - ${name}`);
  }
  try {
    await postgres.initialise();
    await postgres.start();
    client = postgres.getPgClient("postgres", "127.0.0.1");
    await client.connect();
    assert.equal((await client.query("SHOW server_encoding")).rows[0].server_encoding, "UTF8");
    // Only the real topics DDL/RPC and related 0013 guards are needed, not quota/Vault fixtures.
    await client.query(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE SCHEMA auth;
      CREATE SCHEMA extensions;
      CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      GRANT USAGE ON SCHEMA auth TO authenticated;
      CREATE TABLE public.documents(id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id), extracted_text text);
      CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS
        $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
      CREATE TABLE public.account_deletion_requests(user_id uuid PRIMARY KEY, status text);
    `);
    await client.query(historical.slice(0, historical.indexOf("ALTER TABLE public.ai_generation_events")));
    const rpcStart = historical.indexOf("CREATE FUNCTION public.create_document_topics(");
    await client.query(historical.slice(rpcStart, historical.indexOf("\n$$;", rpcStart) + 4));
    await client.query(historical.slice(historical.indexOf("REVOKE ALL ON FUNCTION public.create_document_topics(")));
    for (const name of ["is_account_active", "enforce_account_active_mutation"]) {
      const start = deletion.indexOf(`CREATE FUNCTION public.${name}(`);
      await client.query(deletion.slice(start, deletion.indexOf("\n$$;", start) + 4));
    }
    await client.query(`
      REVOKE ALL ON FUNCTION public.enforce_account_active_mutation() FROM PUBLIC;
      CREATE TRIGGER enforce_document_topics_account_active BEFORE INSERT OR UPDATE OR DELETE ON public.document_topics
        FOR EACH ROW EXECUTE FUNCTION public.enforce_account_active_mutation();
    `);
    const user = randomUUID();
    const other = randomUUID();
    await client.query("INSERT INTO auth.users VALUES ($1),($2)", [user, other]);

    async function fixture(parts) {
      const source = parts.join("");
      const document = randomUUID();
      await client.query("INSERT INTO public.documents VALUES ($1,$2,$3)", [document, user, source]);
      let offset = 0;
      const topics = parts.map((part, index) => {
        const start = offset;
        offset += Array.from(part).length;
        return { title: `Concept ${index + 1}`, description: "A grounded instructional concept from the source.",
          position: index + 1, source_ranges: [{ start, end: offset }] };
      });
      return { document, source, hash: createHash("sha256").update(source).digest("hex"), topics };
    }
    async function call(f, topics = f.topics, identity = user, hash = f.hash) {
      await client.query("BEGIN");
      try {
        await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [identity ?? ""]);
        await client.query("SET LOCAL ROLE authenticated");
        const result = await client.query("SELECT * FROM public.create_document_topics($1,$2,$3,$4::jsonb)",
          [f.document, hash, "synthetic-model", JSON.stringify(topics)]);
        await client.query("COMMIT");
        return result.rows;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    async function count(f) {
      return (await client.query("SELECT count(*)::int AS n FROM public.document_topics WHERE document_id=$1", [f.document])).rows[0].n;
    }
    async function reject(f, code, topics = f.topics, identity = user, hash = f.hash) {
      await assert.rejects(call(f, topics, identity, hash), (error) => error.message === code);
      assert.equal(await count(f), 0);
    }

    const legacy = await fixture(["a".repeat(80), "b".repeat(120), "c".repeat(199)]);
    const saved = await call(legacy);
    assert.equal(saved.length, 3);
    await client.query(migration);
    await check("legacy 80/120/199 cache remains write-once and unchanged after 0014", async () => {
      assert.deepEqual(await call(legacy, null), saved);
      assert.deepEqual(await call(legacy, [{ invalid: true }]), saved);
      const proposed = structuredClone(legacy.topics);
      proposed[0].source_ranges = [{ start: 0, end: 201 }];
      proposed[1].source_ranges = [{ start: 201, end: 401 }];
      proposed[2].source_ranges = [{ start: 401, end: 600 }];
      assert.deepEqual(await call(legacy, proposed), saved);
      assert.deepEqual((await client.query("SELECT * FROM public.document_topics WHERE document_id=$1 ORDER BY position", [legacy.document])).rows, saved);
    });
    await check("runtime JS/SQL parity for all 25 removed characters, retained characters and Unicode", async () => {
      const cases = [...removed.map((point) => `A${String.fromCodePoint(point)}B`),
        removed.map((point) => String.fromCodePoint(point)).join(""), "", "\u0085\u180e\u200b",
        "\u{1f4d8}", "e\u0301", "\u00e9", "a\u00e7\u00e3o", "if(x>=2){return x*x;} E=mc^2; 123!", "\ufeffA\u{1f4d8}\u00a0e\u0301"];
      for (const source of cases) {
        const result = await client.query("SELECT public.count_topic_source_characters($1) AS n", [source]);
        assert.equal(result.rows[0].n, countTopicSourceCharacters(source));
      }
      assert.equal((await client.query("SELECT public.count_topic_source_characters(NULL) AS n")).rows[0].n, null);
    });
    for (const n of [199, 200, 201]) await check(`first insertion: ${n} canonical characters`, async () => {
      const f = await fixture(["a".repeat(n), "b".repeat(n), "c".repeat(n)]);
      if (n < 200) await reject(f, "TOPIC_SOURCE_TOO_SHORT");
      else { assert.equal((await call(f)).length, 3); assert.equal(await count(f), 3); }
    });
    await check("first-insert 201/200/199 is rejected atomically with zero rows", async () => {
      const f = await fixture(["a".repeat(201), "b".repeat(200), "c".repeat(199)]);
      assert.equal(await count(f), 0);
      await reject(f, "TOPIC_SOURCE_TOO_SHORT");
    });
    await check("whitespace padding and UTF16 length cannot bypass the minimum", async () => {
      await reject(await fixture(["a \ufeff\u00a0".repeat(199), "b".repeat(200), "c".repeat(200)]), "TOPIC_SOURCE_TOO_SHORT");
      await reject(await fixture(["\u{1f4d8}".repeat(100), "b".repeat(200), "c".repeat(200)]), "TOPIC_SOURCE_TOO_SHORT");
      assert.equal((await call(await fixture(["\u{1f4d8}".repeat(200), "e\u0301".repeat(100), "\u00e9".repeat(200)]))).length, 3);
    });
    await check("validated disjoint ranges reconstruct exact source in order", async () => {
      const f = await fixture(["a".repeat(100) + " ".repeat(20) + "b".repeat(100), "c".repeat(200), "d".repeat(200)]);
      f.topics[0].source_ranges = [{ start: 0, end: 100 }, { start: 120, end: 220 }];
      const rows = await call(f);
      assert.deepEqual(rows[0].source_ranges, f.topics[0].source_ranges);
    });
    await check("auth, ownership, hash, ranges, count, title and overlap guards remain active", async () => {
      const f = await fixture(["a".repeat(200), "b".repeat(200), "c".repeat(200)]);
      await reject(f, "AUTH_REQUIRED", f.topics, null);
      await reject(f, "DOCUMENT_NOT_FOUND", f.topics, other);
      await reject(f, "STALE_TOPIC_SOURCE", f.topics, user, "0".repeat(64));
      await reject(f, "INVALID_TOPIC_SOURCE_HASH", f.topics, user, "bad");
      await reject(f, "INVALID_DOCUMENT_TOPICS", f.topics.slice(0, 2));
      const invalid = structuredClone(f.topics); invalid[0].source_ranges[0].end = 601;
      await reject(f, "INVALID_TOPIC_SOURCE_RANGE", invalid);
      const overlap = structuredClone(f.topics); overlap[1].source_ranges[0].start = 199;
      await reject(f, "OVERLAPPING_DOCUMENT_TOPICS", overlap);
      const duplicate = structuredClone(f.topics); duplicate[1].title = duplicate[0].title;
      await reject(f, "DUPLICATE_DOCUMENT_TOPIC", duplicate);
    });
    await check("original coverage and broad-topic weighting remain active", async () => {
      const f = await fixture(["a".repeat(400), "b".repeat(400), "c".repeat(400)]);
      f.topics.forEach((topic) => { topic.source_ranges[0].end = topic.source_ranges[0].start + 200; });
      await reject(f, "INSUFFICIENT_TOPIC_SOURCE_COVERAGE");
      await reject(await fixture(["a".repeat(3000), "b".repeat(200), "c".repeat(200)]), "TOPIC_SOURCE_TOO_BROAD");
    });
    await check("reused cache still validates saved ranges and original 80 minimum", async () => {
      await client.query("UPDATE public.document_topics SET source_ranges='[{\"start\":0,\"end\":79}]' WHERE document_id=$1 AND position=1", [legacy.document]);
      await assert.rejects(call(legacy), (error) => error.message === "TOPIC_SOURCE_TOO_SHORT");
      await client.query("UPDATE public.document_topics SET source_ranges=$2::jsonb WHERE document_id=$1 AND position=1", [legacy.document, JSON.stringify(saved[0].source_ranges)]);
      const withoutUpdateTime = (rows) => rows.map(({ updated_at, ...row }) => row);
      assert.deepEqual(withoutUpdateTime(await call(legacy)), withoutUpdateTime(saved));
    });
    await check("0013 mutation guard survives the function replacement", async () => {
      await client.query("INSERT INTO public.account_deletion_requests VALUES($1,'pending')", [user]);
      await reject(await fixture(["a".repeat(200), "b".repeat(200), "c".repeat(200)]), "ACCOUNT_DELETION_IN_PROGRESS");
      await client.query("DELETE FROM public.account_deletion_requests WHERE user_id=$1", [user]);
    });
    await check("helper privileges are private; RPC grants remain authenticated-only", async () => {
      for (const role of ["anon", "authenticated", "service_role"]) {
        assert.equal((await client.query("SELECT has_function_privilege($1,'public.count_topic_source_characters(text)','EXECUTE') AS allowed", [role])).rows[0].allowed, false);
      }
      for (const [role, expected] of [["anon", false], ["authenticated", true]]) {
        assert.equal((await client.query("SELECT has_function_privilege($1,'public.create_document_topics(uuid,text,text,jsonb)','EXECUTE') AS allowed", [role])).rows[0].allowed, expected);
      }
    });
    console.log(`${checks} PostgreSQL topic-source checks passed on an isolated local cluster.`);
  } finally {
    if (client) await client.end().catch(() => {});
    await Promise.race([postgres.stop().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  }
}
try { await main(); } catch (error) { console.error(error); process.exitCode = 1; }
finally {
  // embedded-postgres can retain stale child-process handles on Windows.
  if (process.platform === "win32") process.exit(process.exitCode ?? 0);
}
