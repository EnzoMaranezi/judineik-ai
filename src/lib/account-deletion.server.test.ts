import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ACCOUNT_DELETION_UNAVAILABLE,
  assertTrustedAccountDeletionRequest,
  clearAccountStorage,
  executeAccountDeletion,
  listAccountStorageObjects,
  type AccountDeletionDependencies,
  type StorageEntry,
} from "./account-deletion.ts";

function storageFromPages(pages: Map<string, StorageEntry[][]>) {
  const removed: string[][] = [];
  return {
    removed,
    adapter: {
      list: async (prefix: string, { offset }: { limit: number; offset: number }) => {
        const page = offset / 100;
        return pages.get(prefix)?.[page] ?? [];
      },
      remove: async (paths: string[]) => {
        removed.push(paths);
      },
    },
  };
}

test("account deletion accepts only same-origin POST requests", () => {
  assert.doesNotThrow(() => assertTrustedAccountDeletionRequest(new Request("https://nexa.test/action", {
    method: "POST",
    headers: { origin: "https://nexa.test", "sec-fetch-site": "same-origin" },
  })));
  assert.throws(
    () => assertTrustedAccountDeletionRequest(new Request("https://nexa.test/action", { method: "GET" })),
    new RegExp(ACCOUNT_DELETION_UNAVAILABLE),
  );
  assert.throws(
    () => assertTrustedAccountDeletionRequest(new Request("https://nexa.test/action", {
      method: "POST",
      headers: { origin: "https://attacker.test", "sec-fetch-site": "cross-site" },
    })),
    new RegExp(ACCOUNT_DELETION_UNAVAILABLE),
  );
});

test("Storage traversal paginates and includes nested objects", async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: `id-${index}`, name: `file-${index}` }));
  const { adapter } = storageFromPages(new Map([
    ["user-a", [firstPage, [{ id: null, name: "nested" }]]],
    ["user-a/nested", [[{ id: "nested-id", name: "file.pdf" }]]],
  ]));

  const paths = await listAccountStorageObjects(adapter, "user-a");
  assert.equal(paths.length, 101);
  assert.ok(paths.includes("user-a/nested/file.pdf"));
});

test("Storage cleanup detects an object appearing after the first empty listing", async () => {
  let calls = 0;
  const removed: string[] = [];
  await clearAccountStorage({
    list: async () => {
      calls += 1;
      if (calls === 2) return [{ id: "late-object", name: "late.pdf" }];
      return [];
    },
    remove: async (paths) => {
      removed.push(...paths);
    },
  }, "user-a");

  assert.deepEqual(removed, ["user-a/late.pdf"]);
  assert.ok(calls >= 4);
});

function deletionDependencies(overrides: Partial<AccountDeletionDependencies> = {}) {
  const statuses: string[] = [];
  let deleteCalls = 0;
  const dependencies: AccountDeletionDependencies = {
    begin: async () => "pending",
    storage: { list: async () => [], remove: async () => undefined },
    updateStatus: async (status) => { statuses.push(status); },
    deleteAuthUser: async () => { deleteCalls += 1; return "deleted"; },
    ...overrides,
  };
  return { dependencies, statuses, deleteCalls: () => deleteCalls };
}

test("empty Storage advances persisted stages and deletes Auth", async () => {
  const state = deletionDependencies();
  assert.deepEqual(await executeAccountDeletion("user-a", state.dependencies), { deleted: true });
  assert.deepEqual(state.statuses, ["storage_cleared", "auth_deleting"]);
  assert.equal(state.deleteCalls(), 1);
});

test("partial Storage failure is retryable from pending", async () => {
  let fail = true;
  let files = ["user-a/a.pdf"];
  const state = deletionDependencies({
    storage: {
      list: async () => files.map((path) => ({ id: path, name: path.split("/").at(-1)! })),
      remove: async () => {
        if (fail) {
          fail = false;
          throw new Error("synthetic storage failure");
        }
        files = [];
      },
    },
  });

  await assert.rejects(executeAccountDeletion("user-a", state.dependencies), /synthetic storage failure/);
  assert.deepEqual(state.statuses, []);
  assert.deepEqual(await executeAccountDeletion("user-a", state.dependencies), { deleted: true });
});

test("Auth failure leaves an idempotently resumable auth_deleting stage", async () => {
  let first = true;
  const state = deletionDependencies({
    deleteAuthUser: async () => {
      if (first) {
        first = false;
        throw new Error("synthetic auth failure");
      }
      return "already_missing";
    },
  });

  await assert.rejects(executeAccountDeletion("user-a", state.dependencies), /synthetic auth failure/);
  assert.deepEqual(state.statuses, ["storage_cleared", "auth_deleting"]);
  assert.deepEqual(await executeAccountDeletion("user-a", state.dependencies), { deleted: true });
});

test("two simultaneous deletion workers converge on idempotent external operations", async () => {
  const files = new Set(["user-a/file.pdf"]);
  let authExists = true;
  const statuses: string[] = [];
  const dependencies: AccountDeletionDependencies = {
    begin: async () => "pending",
    storage: {
      list: async () => [...files].map((path) => ({ id: path, name: path.split("/").at(-1)! })),
      remove: async (paths) => { for (const path of paths) files.delete(path); },
    },
    updateStatus: async (status) => { statuses.push(status); },
    deleteAuthUser: async () => {
      if (!authExists) return "already_missing";
      authExists = false;
      return "deleted";
    },
  };

  const results = await Promise.all([
    executeAccountDeletion("user-a", dependencies),
    executeAccountDeletion("user-a", dependencies),
  ]);
  assert.deepEqual(results, [{ deleted: true }, { deleted: true }]);
  assert.equal(files.size, 0);
  assert.equal(authExists, false);
});

test("server contract accepts no browser user_id and keeps service role server-only", async () => {
  const source = await readFile(new URL("./account-deletion.server.ts", import.meta.url), "utf8");
  assert.match(source, /createServerFn\(\{ method: "POST" \}\)/);
  assert.doesNotMatch(source, /\.validator\(|data\.userId|p_user_id/);
  assert.match(source, /process\.env\["SUPABASE_SERVICE_ROLE_KEY"\]/);
  assert.doesNotMatch(source, /VITE_SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /status === "storage_cleared"[\s\S]*\.in\("status", \["pending", "storage_cleared"\]\)/);
});
