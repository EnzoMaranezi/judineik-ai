import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/0012_ai_ip_retention_automation.sql", import.meta.url),
  "utf8",
);

test("retention automation grants only the fixed cleanup function to service_role", () => {
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.cleanup_ai_ip_generation_events\(\) TO service_role/,
  );
  assert.doesNotMatch(migration, /GRANT .* ON TABLE public\.ai_ip_generation_events/);
  assert.doesNotMatch(migration, /authenticated|anon|PUBLIC/);
});
