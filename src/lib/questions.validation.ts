type QuestionLike = { question: string };

function normalizedQuestion(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("und")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function questionTokens(value: string) {
  return new Set(normalizedQuestion(value).split(/\s+/u).filter(Boolean));
}

export function areNearDuplicateQuestions(left: string, right: string) {
  const normalizedLeft = normalizedQuestion(left);
  const normalizedRight = normalizedQuestion(right);
  if (normalizedLeft === normalizedRight) return true;

  const leftTokens = questionTokens(left);
  const rightTokens = questionTokens(right);
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union > 0 && intersection / union >= 0.8;
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
