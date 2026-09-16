function cleanMarkdown(value: string) {
  return value
    .replace(/^```(?:markdown|md)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function stripMarkdown(value: string) {
  return value
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function parseCorrectIndex(value: string) {
  const token = stripMarkdown(value).trim().toUpperCase();
  const letter = /^[A-D]/.exec(token)?.[0];
  return letter ? letter.charCodeAt(0) - 65 : -1;
}

const QUESTION_LABEL_PATTERN = String.raw`(?:Question|Pergunta|Questão|Questao|Q)`;

function normalizeQuestionLine(line: string) {
  return stripMarkdown(line)
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[-*]\s+/, "")
    .trim();
}

export function parseMarkdownQuestions(markdown: string): unknown {
  const blocks = cleanMarkdown(markdown)
    .split(
      new RegExp(
        String.raw`(?=^\s*(?:#{1,6}\s*)?(?:\*\*)?\s*${QUESTION_LABEL_PATTERN}\s+\d+\b|^\s*\d+[.)]\s+)`,
        "gim",
      ),
    )
    .map((block) => block.trim())
    .filter(Boolean);

  const questions = blocks.map((block) => {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    let question = "";
    const options: string[] = [];
    let correctIndex = -1;
    let explanation = "";
    let awaitingQuestionText = false;

    for (const line of lines) {
      const normalizedLine = normalizeQuestionLine(line);
      const optionLine = /^([A-D])\s*[.)-]\s*(.+)$/i.exec(normalizedLine);
      const correctLine = /^(?:Correct|Correta|Resposta correta|Resposta)\s*:\s*(.+)$/i.exec(
        normalizedLine,
      )?.[1];
      const explanationLine =
        /^(?:Explanation|Explicação|Explicacao)\s*:\s*(.+)$/i.exec(normalizedLine)?.[1];
      const labelledQuestionLine = new RegExp(
        String.raw`^${QUESTION_LABEL_PATTERN}\s*(?:\d+)?\s*[:.)-]?\s*(.*)$`,
        "i",
      ).exec(normalizedLine)?.[1];
      const numbered = /^\d+[.)]\s+(.+)$/i.exec(normalizedLine)?.[1];

      if (labelledQuestionLine !== undefined) {
        const prompt = stripMarkdown(labelledQuestionLine);
        if (prompt) {
          question = prompt;
          awaitingQuestionText = false;
        } else {
          awaitingQuestionText = !question;
        }
      } else if (!question && numbered) {
        question = stripMarkdown(numbered);
        awaitingQuestionText = false;
      } else if (optionLine) {
        const optionIndex = optionLine[1]!.toUpperCase().charCodeAt(0) - 65;
        options[optionIndex] = stripMarkdown(optionLine[2]!);
        awaitingQuestionText = false;
      } else if (correctLine) {
        correctIndex = parseCorrectIndex(correctLine);
        awaitingQuestionText = false;
      } else if (explanationLine) {
        explanation = stripMarkdown(explanationLine);
        awaitingQuestionText = false;
      } else if (awaitingQuestionText && !question) {
        question = stripMarkdown(normalizedLine);
        awaitingQuestionText = false;
      } else if (explanation) {
        explanation = `${explanation} ${stripMarkdown(line)}`.trim();
      }
    }

    return { question, options, correctIndex, explanation };
  });

  return { questions };
}
