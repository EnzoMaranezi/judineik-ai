type QuestionLike = { question: string };

function normalizedQuestion(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("und")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    // Only this supported grammatical opener may omit the copula.
    .replace(/^qual e o /u, "qual o ");
}

export function areNearDuplicateQuestions(left: string, right: string) {
  return normalizedQuestion(left) === normalizedQuestion(right);
}

export function assertDistinctGeneratedQuestions<T extends QuestionLike>(questions: T[]) {
  questions.forEach((question, index) => {
    if (
      questions
        .slice(0, index)
        .some((previousQuestion) =>
          areNearDuplicateQuestions(previousQuestion.question, question.question),
        )
    ) {
      throw new Error("DUPLICATE_GENERATED_QUESTION");
    }
  });
  return questions;
}
