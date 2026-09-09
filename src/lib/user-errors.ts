export type UserErrorFallback =
  | "errors.load"
  | "errors.save"
  | "errors.generate"
  | "errors.delete"
  | "errors.upload"
  | "errors.extract";

const codeKeys = {
  AI_DAILY_LIMIT_REACHED: "ai.limitReached",
  AI_NETWORK_LIMIT_REACHED: "ai.networkLimitReached",
  AI_PROVIDERS_UNAVAILABLE: "ai.providersUnavailable",
  AI_GENERATION_IN_PROGRESS: "errors.generationInProgress",
  AUTH_VERIFICATION_UNAVAILABLE: "errors.authUnavailable",
  AUTH_REQUIRED: "errors.sessionUnavailable",
  STALE_TOPIC_SOURCE: "topics.stale",
  TOPIC_NOT_FOUND: "topics.topicMissing",
  DOCUMENT_NOT_FOUND: "errors.resourceMissing",
  QUESTION_SET_NOT_FOUND: "errors.resourceMissing",
  FLASHCARD_NOT_FOUND: "errors.resourceMissing",
  TOPIC_SOURCE_UNAVAILABLE: "errors.insufficientSource",
  TOPIC_QUESTION_SOURCE_INSUFFICIENT: "topics.questionsSourceInsufficient",
  INVALID_TOPIC_SOURCE_RANGE: "topics.summarySourceInvalid",
  FLASHCARD_NOT_DUE: "flashcards.notDue",
  SERVER_OPERATION_TIMEOUT: "errors.unavailable",
} as const;

// Compatibility with product states that existing services still throw as text.
const messageKeys = {
  "Document not found.": "errors.resourceMissing",
  "This material no longer exists.": "errors.resourceMissing",
  "This material could not be found. It may have been deleted.": "errors.resourceMissing",
  "This material is still being processed. Try again in a moment.": "errors.unavailable",
  "This material does not have enough readable extracted text to build a study plan yet.": "errors.insufficientSource",
  "This material does not have enough processed text to build a study plan yet.": "errors.insufficientSource",
  "Previous question set not found.": "errors.resourceMissing",
  "The original question set for this practice session could not be found.": "errors.resourceMissing",
  "You need to be signed in to upload material. Please sign in and try again.": "errors.sessionUnavailable",
  "You need to be signed in to add material. Please sign in and try again.": "errors.sessionUnavailable",
  "Material title can't be empty.": "errors.titleRequired",
  "Paste your notes before analyzing material.": "errors.notesRequired",
  "No incorrect answers to practise.": "errors.noMistakes",
  "The language of this legacy question set was not recorded. Generate a current-language question set before practising mistakes.": "errors.practiceLanguageRequired",
  "We couldn't read any text in this PDF. It may be a scanned image — try a text-based PDF.": "errors.unreadablePdf",
  "Failed to fetch": "errors.unavailable",
  "fetch failed": "errors.unavailable",
  "The AI service is rate limited right now. Please try again in a moment.": "errors.unavailable",
  "AI credits are exhausted for this workspace. Add credits and try again.": "errors.unavailable",
  "NetworkError when attempting to fetch resource.": "errors.unavailable",
} as const;

type KnownKey = (typeof codeKeys)[keyof typeof codeKeys] | (typeof messageKeys)[keyof typeof messageKeys];
export type UserErrorKey = UserErrorFallback | KnownKey;

/** Pure presentation mapping: never returns backend text or changes the original error. */
export function userErrorKey(error: unknown, fallback: UserErrorFallback = "errors.load"): UserErrorKey {
  const shape = error && typeof error === "object" ? error as { code?: unknown; message?: unknown } : null;
  const values = [shape?.code, typeof error === "string" ? error : shape?.message]
    .filter((value): value is string => typeof value === "string");

  for (const value of values) {
    for (const token of value.split(/[^A-Za-z0-9_]+/)) {
      if (Object.hasOwn(codeKeys, token)) return codeKeys[token as keyof typeof codeKeys];
    }
    if (Object.hasOwn(messageKeys, value)) return messageKeys[value as keyof typeof messageKeys];
    if (value.startsWith("Unauthorized:")) return "errors.sessionUnavailable";
    if (value.startsWith("This document has no readable extracted text yet.")) return "errors.insufficientSource";
    if (/^(Summary|Question|Practice question|Flashcard) generation is already in progress\./.test(value)) {
      return "errors.generationInProgress";
    }
  }
  return fallback;
}
