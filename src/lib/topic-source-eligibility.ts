export const TOPIC_SUMMARY_MIN_SOURCE_CHARACTERS = 80;
export const TOPIC_QUESTIONS_MIN_SOURCE_CHARACTERS = 200;
export const TOPIC_FLASHCARDS_MIN_SOURCE_CHARACTERS = 200;
export const NEW_TOPIC_MIN_SOURCE_CHARACTERS = 200;

/** Counts non-whitespace code points without normalization or quality inference. */
export function countTopicSourceCharacters(source: string): number {
  return Array.from(source.replace(/\s+/gu, "")).length;
}

/** Assumes source has already been reconstructed and integrity-verified. */
export function evaluateTopicSourceEligibility(source: string) {
  const sourceCharacters = countTopicSourceCharacters(source);
  return {
    sourceCharacters,
    meetsNewTopicMinimum: sourceCharacters >= NEW_TOPIC_MIN_SOURCE_CHARACTERS,
    summary: sourceCharacters >= TOPIC_SUMMARY_MIN_SOURCE_CHARACTERS,
    questions: sourceCharacters >= TOPIC_QUESTIONS_MIN_SOURCE_CHARACTERS,
    flashcards: sourceCharacters >= TOPIC_FLASHCARDS_MIN_SOURCE_CHARACTERS,
  };
}
