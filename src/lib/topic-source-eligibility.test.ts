import assert from "node:assert/strict";
import test from "node:test";
import {
  countTopicSourceCharacters,
  evaluateTopicSourceEligibility,
  NEW_TOPIC_MIN_SOURCE_CHARACTERS,
  TOPIC_FLASHCARDS_MIN_SOURCE_CHARACTERS,
  TOPIC_QUESTIONS_MIN_SOURCE_CHARACTERS,
  TOPIC_SUMMARY_MIN_SOURCE_CHARACTERS,
} from "./topic-source-eligibility.ts";

test("approved topic-source thresholds are independent capability constants", () => {
  assert.deepEqual([
    TOPIC_SUMMARY_MIN_SOURCE_CHARACTERS,
    TOPIC_QUESTIONS_MIN_SOURCE_CHARACTERS,
    TOPIC_FLASHCARDS_MIN_SOURCE_CHARACTERS,
    NEW_TOPIC_MIN_SOURCE_CHARACTERS,
  ], [80, 200, 200, 200]);
});

for (const length of [79, 80, 199, 200, 201]) {
  test(`canonical ${length}-character source capability boundary`, () => {
    assert.deepEqual(evaluateTopicSourceEligibility("a".repeat(length)), {
      sourceCharacters: length,
      meetsNewTopicMinimum: length >= 200,
      summary: length >= 80,
      questions: length >= 200,
      flashcards: length >= 200,
    });
  });
}

test("all ECMAScript whitespace is excluded, including internal repeated whitespace", () => {
  const whitespace = " \t\r\n\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";
  const source = whitespace.repeat(20) + Array(199).fill("a").join(whitespace) + whitespace.repeat(20);
  assert.deepEqual(evaluateTopicSourceEligibility(source), evaluateTopicSourceEligibility("a".repeat(199)));
  assert.equal(countTopicSourceCharacters(whitespace), 0);
  assert.deepEqual(evaluateTopicSourceEligibility(""), {
    sourceCharacters: 0, meetsNewTopicMinimum: false,
    summary: false, questions: false, flashcards: false,
  });
});

test("Unicode code points count once; accents and combining characters are not normalized", () => {
  const portuguese = "a\u00e7\u00e3o";
  assert.equal(countTopicSourceCharacters(portuguese), 4);
  assert.equal(countTopicSourceCharacters("e\u0301"), 2);
  const supplementary = "\u{1f4d8}";
  const mixed = `A${supplementary}\u00e9`;
  assert.equal(mixed.length, 4);
  assert.equal(countTopicSourceCharacters(mixed), 3);
  assert.notEqual(mixed.length, countTopicSourceCharacters(mixed));
  assert.equal(countTopicSourceCharacters(supplementary.repeat(200)), 200);
  assert.equal(evaluateTopicSourceEligibility(supplementary.repeat(199)).questions, false);
  assert.equal(countTopicSourceCharacters("\u200b"), 1);
});

test("formula, digits, punctuation and code syntax count without prose filtering", () => {
  const technical = "\u2211 x\u00b2 = 42;\nif (x >= 2) { y++; }";
  assert.equal(countTopicSourceCharacters(technical), 21);
  assert.equal(countTopicSourceCharacters("REFERENCES"), 10);
});
