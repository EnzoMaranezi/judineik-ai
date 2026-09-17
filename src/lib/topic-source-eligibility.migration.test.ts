import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { countTopicSourceCharacters } from "./topic-source-eligibility.ts";

const historical = readFileSync(new URL("../../supabase/migrations/0007_document_topics.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const migration = readFileSync(new URL("../../supabase/migrations/0014_topic_source_eligibility.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const removed = [0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008,
  0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff];

function rpc(sql: string): string {
  return sql.match(/CREATE (?:OR REPLACE )?FUNCTION public\.create_document_topics\([\s\S]*?\n\$\$;/)![0];
}

test("0014 preserves the entire write-once RPC except canonical first-insert measurement", () => {
  const expected = rpc(historical)
    .replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION")
    .replace("  v_topic_grounded_chars integer;", "  v_topic_grounded_chars integer;\n  v_topic_canonical_chars integer;")
    .replace("    v_topic_grounded_chars := 0;", "    v_topic_grounded_chars := 0;\n    v_topic_canonical_chars := 0;")
    .replace("      v_seen_ranges := v_seen_ranges || jsonb_build_array(",
      "      v_topic_canonical_chars := v_topic_canonical_chars\n        + public.count_topic_source_characters(\n          substring(v_source_text FROM v_start + 1 FOR v_end - v_start)\n        );\n      v_seen_ranges := v_seen_ranges || jsonb_build_array(")
    .replace("    IF v_topic_grounded_chars < 80 THEN",
      "    -- Saved sets keep their original integrity contract; only first inserts require 200.\n    IF (v_reuse_existing AND v_topic_grounded_chars < 80)\n      OR (NOT v_reuse_existing AND v_topic_canonical_chars < 200) THEN");
  assert.equal(rpc(migration), expected);
  assert.ok(migration.indexOf("TOPIC_SOURCE_TOO_SHORT") < migration.indexOf("INSERT INTO public.document_topics"));
  assert.doesNotMatch(migration, /\b(?:DELETE FROM|UPDATE public|ALTER TABLE|DROP FUNCTION)\b/);
});

test("SQL helper explicitly removes exactly ECMAScript whitespace without normalization", () => {
  const literal = migration.match(/U&'([^']+)'/)![1]!;
  const codePoints = Array.from(literal.matchAll(/\\([0-9A-F]{4})/g), (match) => parseInt(match[1]!, 16));
  assert.deepEqual(codePoints, removed);
  for (const point of removed) assert.equal(countTopicSourceCharacters(String.fromCodePoint(point)), 0);
  for (const point of [0x0085, 0x180e, 0x200b]) assert.equal(countTopicSourceCharacters(String.fromCodePoint(point)), 1);
  assert.equal(countTopicSourceCharacters("\u{1f4d8}e\u0301\u00e9 + x=2;"), 9);
  assert.match(migration, /LANGUAGE sql\nIMMUTABLE\nSTRICT\nSECURITY INVOKER\nSET search_path = pg_catalog/);
  assert.match(migration, /char_length\(translate\(/);
});

test("helper is private and callable RPC privileges retain the existing contract", () => {
  for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
    assert.ok(migration.includes(`REVOKE ALL ON FUNCTION public.count_topic_source_characters(text) FROM ${role};`));
  }
  const grants = historical.slice(historical.indexOf("REVOKE ALL ON FUNCTION public.create_document_topics("));
  assert.ok(migration.endsWith(grants));
  assert.doesNotMatch(migration, /GRANT .*count_topic_source_characters/);
});
