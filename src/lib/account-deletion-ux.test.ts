import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clearNexaBrowserState } from "./account-deletion-browser-state.ts";

const settingsRoute = readFileSync(new URL("../routes/app.settings.tsx", import.meta.url), "utf8");
const appRoute = readFileSync(new URL("../routes/app.tsx", import.meta.url), "utf8");
const form = readFileSync(new URL("../components/app/AccountDeletionForm.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("./account-deletion-client.ts", import.meta.url), "utf8");
const i18n = readFileSync(new URL("./i18n.tsx", import.meta.url), "utf8");

class MemoryStorage {
  private readonly values = new Map<string, string>();

  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

test("Settings exposes a separate, localized destructive account deletion flow", () => {
  assert.match(settingsRoute, /settings\.deleteAccountDialogTitle/);
  assert.match(settingsRoute, /settings\.deleteAccountWarning/);
  assert.match(settingsRoute, /AccountDeletionForm/);
  assert.match(settingsRoute, /onEscapeKeyDown/);
  assert.match(settingsRoute, /disabled=\{deletionLocked\}/);
  assert.match(form, /autoComplete="current-password"/);
  assert.match(form, /disabled=\{busy \|\| !password\}/);
});

test("reauthentication creates a fresh password session and deletion uses only the protected endpoint", () => {
  assert.match(client, /supabase\.auth\.signInWithPassword\(\{ email, password \}\)/);
  assert.match(client, /fetch\("\/api\/account-deletion"/);
  assert.match(client, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.doesNotMatch(client, /userId:\s*userId|body:\s*JSON\.stringify/);
  assert.match(form, /ACCOUNT_DELETION_INVALID_PASSWORD/);
  assert.match(form, /ACCOUNT_REAUTHENTICATION_REQUIRED/);
});

test("pending account deletion replaces the normal workspace with a retry-only screen", () => {
  assert.match(appRoute, /is_account_active/);
  assert.match(appRoute, /accountDeletionPending/);
  assert.match(appRoute, /<AccountDeletionPending/);
  assert.match(form, /phase === "pending"/);
  assert.match(form, /settings\.deleteAccountRetry/);
});

test("successful account deletion clears only NEXA browser state before a landing-page replacement", () => {
  const priorWindow = globalThis.window;
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  localStorage.setItem("nexa:analysis", "discard");
  localStorage.setItem("another-app", "keep");
  sessionStorage.setItem("nexa:password-recovery-pending", "discard");
  sessionStorage.setItem("another-session", "keep");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage, sessionStorage },
  });

  try {
    clearNexaBrowserState();
    assert.equal(localStorage.getItem("nexa:analysis"), null);
    assert.equal(sessionStorage.getItem("nexa:password-recovery-pending"), null);
    assert.equal(localStorage.getItem("another-app"), "keep");
    assert.equal(sessionStorage.getItem("another-session"), "keep");
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: priorWindow });
  }

  assert.match(settingsRoute, /clearNexaBrowserState\(\)/);
  assert.match(settingsRoute, /window\.location\.replace\("\/"\)/);
});

test("account deletion copy is complete in English and Portuguese", () => {
  for (const key of [
    "settings.deleteAccount",
    "settings.deleteAccountDialogTitle",
    "settings.deleteAccountWrongPassword",
    "settings.deleteAccountPending",
    "settings.deleteAccountRetry",
  ]) {
    assert.equal((i18n.match(new RegExp(`"${key}"`, "g")) ?? []).length, 2, `${key} must have EN and PT-BR copy`);
  }
});
