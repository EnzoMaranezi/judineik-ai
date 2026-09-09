import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { userErrorKey, type UserErrorFallback } from "./user-errors.ts";
import { aiErrorMessage } from "./ai-errors.ts";

const i18nSource = readFileSync(new URL("./i18n.tsx", import.meta.url), "utf8");
const messages = new Map<string, string[]>();
for (const match of i18nSource.matchAll(/"((?:errors|ai|topics|flashcards)\.[^"]+)":\s*("(?:[^"\\]|\\.)*")/g)) {
  const values = messages.get(match[1]!) ?? [];
  values.push(JSON.parse(match[2]!) as string);
  messages.set(match[1]!, values);
}
function translate(key: string, locale: "en" | "pt-BR") {
  const values = messages.get(key);
  assert.equal(values?.length, 2, `Missing EN/PT-BR resource for ${key}`);
  return values![locale === "en" ? 0 : 1]!;
}

test("raw database and storage errors use the operation fallback without exposing diagnostics", () => {
  const databaseError = { code: "42501", message: "permission denied for table documents", details: "private detail" };
  const storageError = { name: "StorageApiError", message: "Bucket not found: private-storage", statusCode: "400" };
  assert.equal(userErrorKey(databaseError), "errors.load");
  assert.equal(userErrorKey(storageError, "errors.upload"), "errors.upload");
  assert.equal(databaseError.details, "private detail");
});

test("unknown errors of every supported shape map only to the selected semantic fallback", () => {
  const fallbacks: UserErrorFallback[] = ["errors.load", "errors.save", "errors.generate", "errors.delete", "errors.upload", "errors.extract"];
  for (const fallback of fallbacks) {
    for (const error of [new Error("provider response SECRET"), { message: "internal SQL SECRET" }, "SECRET", null, undefined, {}, 500, { code: "toString" }]) {
      assert.equal(userErrorKey(error, fallback), fallback);
      for (const locale of ["en", "pt-BR"] as const) {
        assert.doesNotMatch(translate(userErrorKey(error, fallback), locale), /SECRET|SQL|provider/i);
      }
    }
  }
});

test("quota, service availability and generation-in-progress states retain dedicated keys", () => {
  assert.equal(userErrorKey(new Error("AI_DAILY_LIMIT_REACHED")), "ai.limitReached");
  assert.equal(userErrorKey({ code: "AI_DAILY_LIMIT_REACHED", message: "private detail" }), "ai.limitReached");
  assert.equal(userErrorKey(new Error("AI_NETWORK_LIMIT_REACHED")), "ai.networkLimitReached");
  assert.equal(userErrorKey({ code: "P0001", message: "AI_GENERATION_IN_PROGRESS" }), "errors.generationInProgress");
  assert.equal(userErrorKey(new Error("Summary generation is already in progress. Please try again shortly.")), "errors.generationInProgress");
  assert.equal(userErrorKey("AI_PROVIDERS_UNAVAILABLE"), "ai.providersUnavailable");
  assert.equal(userErrorKey(new TypeError("Failed to fetch")), "errors.unavailable");
  assert.equal(userErrorKey("NOT_AI_DAILY_LIMIT_REACHED"), "errors.load");
});

test("stale source, insufficient content, and unavailable topics or resources stay specific", () => {
  const cases = [
    ["STALE_TOPIC_SOURCE", "topics.stale"],
    ["TOPIC_NOT_FOUND", "topics.topicMissing"],
    ["DOCUMENT_NOT_FOUND", "errors.resourceMissing"],
    ["QUESTION_SET_NOT_FOUND", "errors.resourceMissing"],
    ["TOPIC_SOURCE_UNAVAILABLE", "errors.insufficientSource"],
    ["TOPIC_QUESTION_SOURCE_INSUFFICIENT", "topics.questionsSourceInsufficient"],
    ["INVALID_TOPIC_SOURCE_RANGE", "topics.summarySourceInvalid"],
    ["Document not found.", "errors.resourceMissing"],
    ["This material no longer exists.", "errors.resourceMissing"],
    ["This material could not be found. It may have been deleted.", "errors.resourceMissing"],
    ["This material is still being processed. Try again in a moment.", "errors.unavailable"],
    ["This material does not have enough readable extracted text to build a study plan yet.", "errors.insufficientSource"],
    ["This material does not have enough processed text to build a study plan yet.", "errors.insufficientSource"],
    ["This document has no readable extracted text yet. Process the PDF before generating questions.", "errors.insufficientSource"],
  ];
  for (const [message, key] of cases) {
    assert.equal(userErrorKey(new Error(message)), key);
    assert.equal(userErrorKey({ code: "P0001", message }), key);
    for (const locale of ["en", "pt-BR"] as const) assert.ok(translate(key!, locale));
  }
});

test("authentication verification and missing sessions remain distinct recoverable states", () => {
  assert.equal(userErrorKey(new Error("AUTH_VERIFICATION_UNAVAILABLE")), "errors.authUnavailable");
  assert.equal(userErrorKey({ message: "AUTH_REQUIRED" }), "errors.sessionUnavailable");
  assert.equal(userErrorKey(new Error("Unauthorized: Invalid token")), "errors.sessionUnavailable");
});

test("material validation and review-specific states keep actionable messages", () => {
  assert.equal(userErrorKey(new Error("Material title can't be empty.")), "errors.titleRequired");
  assert.equal(userErrorKey(new Error("Paste your notes before analyzing material.")), "errors.notesRequired");
  assert.equal(userErrorKey(new Error("No incorrect answers to practise.")), "errors.noMistakes");
  assert.equal(userErrorKey("FLASHCARD_NOT_DUE"), "flashcards.notDue");
});

test("AI error rendering localizes known states and never renders unknown backend text", () => {
  for (const locale of ["en", "pt-BR"] as const) {
    const t = (key: string) => translate(key, locale);
    assert.equal(aiErrorMessage(new Error("private provider error"), t, t("errors.generate")), t("errors.generate"));
    assert.equal(aiErrorMessage({ code: "AI_DAILY_LIMIT_REACHED" }, t, t("errors.generate")), t("ai.limitReached"));
    assert.equal(aiErrorMessage({ code: "AI_NETWORK_LIMIT_REACHED" }, t, t("errors.generate")), t("ai.networkLimitReached"));
    assert.equal(aiErrorMessage(new Error("STALE_TOPIC_SOURCE"), t, t("errors.generate")), t("topics.stale"));
  }
});

test("all new fallback and product messages have distinct EN and PT-BR resources", () => {
  for (const key of messages.keys()) {
    if (!key.startsWith("errors.")) continue;
    assert.notEqual(translate(key, "en"), translate(key, "pt-BR"));
  }
  assert.equal(translate("errors.load", "en"), "We couldn't load this content. Please try again.");
  assert.equal(translate("errors.load", "pt-BR"), "Não foi possível carregar este conteúdo. Tente novamente.");
});
