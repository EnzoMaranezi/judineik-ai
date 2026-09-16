import assert from "node:assert/strict";
import test from "node:test";
import {
  areNearDuplicateQuestions,
  assertDistinctGeneratedQuestions,
} from "./questions.validation.ts";

test("rejects exact and near-duplicate generated questions", () => {
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

test("allows distinct academically relevant programming-language questions", () => {
  const questions = [
    { question: "Como ponteiros em C permitem acessar endereços de memória?" },
    { question: "Qual efeito a alocação dinâmica tem sobre o ciclo de vida dos dados?" },
  ];
  assert.equal(assertDistinctGeneratedQuestions(questions), questions);
});
