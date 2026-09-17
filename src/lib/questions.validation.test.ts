import assert from "node:assert/strict";
import test from "node:test";
import {
  areNearDuplicateQuestions,
  assertDistinctGeneratedQuestions,
} from "./questions.validation.ts";

test("rejects normalized duplicates and the supported Portuguese opener variation", () => {
  assert.equal(
    areNearDuplicateQuestions(
      "Qual é o papel da função inversa no método?",
      "Qual o papel da função inversa no método!",
    ),
    true,
  );
  assert.throws(
    () =>
      assertDistinctGeneratedQuestions([
        { question: "Como a função inversa participa do método da transformada inversa?" },
        { question: "Como a função inversa participa do método da transformada inversa" },
      ]),
    /DUPLICATE_GENERATED_QUESTION/u,
  );
});

for (const [label, left, right] of [
  ["exact text", "What is TCP?", "What is TCP?"],
  ["case, spacing and punctuation", "What is TCP?", "  WHAT   is TCP!! "],
  ["Unicode combining marks", "Qual é a função?", "Qual e\u0301 a func\u0327a\u0303o!"],
] as const) {
  test(`rejects duplicate ${label}`, () => {
    assert.equal(areNearDuplicateQuestions(left, right), true);
    assert.throws(
      () => assertDistinctGeneratedQuestions([{ question: left }, { question: right }]),
      /DUPLICATE_GENERATED_QUESTION/u,
    );
  });
}

for (const [label, left, right] of [
  ["opposite verbs", "Which cache operation preserves data after a session ends?", "Which cache operation deletes data after a session ends?"],
  ["different concepts", "Which sorting algorithm has O(n log n) average complexity?", "Which searching algorithm has O(log n) complexity?"],
  ["unrelated questions", "What is the purpose of a cache?", "How does authentication verify a user?"],
  ["negation", "Which operation preserves data after a session ends?", "Which operation does not preserve data after a session ends?"],
  ["Portuguese negation", "Qual o processo que preserva os dados?", "Qual é o processo que não preserva os dados?"],
  ["numbers", "Which operation retains data for 20 days?", "Which operation retains data for 21 days?"],
  ["content order", "Does the client authenticate the server?", "Does the server authenticate the client?"],
  ["noninitial opener words", "When is qual e o used?", "When is qual o used?"],
] as const) {
  test(`preserves distinct questions with ${label}`, () => {
    assert.equal(areNearDuplicateQuestions(left, right), false);
    const questions = [{ question: left }, { question: right }];
    assert.equal(assertDistinctGeneratedQuestions(questions), questions);
  });
}

test("allows distinct academically relevant programming-language questions", () => {
  const questions = [
    { question: "Como ponteiros em C permitem acessar endereços de memória?" },
    { question: "Qual efeito a alocação dinâmica tem sobre o ciclo de vida dos dados?" },
  ];
  assert.equal(assertDistinctGeneratedQuestions(questions), questions);
});
