import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildAiGenerationMessages } from "./ai-generation-messages.ts";
import { parseMarkdownQuestions } from "./questions.parser.ts";
import {
  MARKDOWN_QUESTION_FORMAT,
  PRACTICE_QUESTION_SYSTEM_PROMPT,
  QUESTION_SYSTEM_PROMPT,
} from "./questions.prompt.ts";
import { questionSetSchema } from "./questions.schema.ts";

const questionFunctions = readFileSync(
  new URL("./questions.functions.ts", import.meta.url),
  "utf8",
);

test("normal question generation uses compact prompt text with one direct language instruction", () => {
  const languageInstruction = "Write all user-facing generated content in English.";
  const messages = buildAiGenerationMessages({
    system: QUESTION_SYSTEM_PROMPT,
    prompt:
      'Document title: Example\n\nMATERIAL:\n"""\nSource text.\n"""\n\nCreate exactly 5 distinct multiple-choice questions. Each question must have 4 options, exactly one correct answer, and a concise source-grounded explanation.',
    outputFormat: MARKDOWN_QUESTION_FORMAT,
    languageInstruction,
    languageInstructionPlacement: "prompt-only",
    languageInstructionFormat: "instruction-only",
  });

  assert.doesNotMatch(messages.system, /OUTPUT LANGUAGE REQUIREMENT/u);
  assert.doesNotMatch(messages.system, /user-facing generated content in English/u);
  assert.equal(
    (messages.prompt.match(/user-facing generated content in English/gu) ?? []).length,
    1,
  );
  assert.match(messages.system, /Write multiple-choice study questions using only the supplied material/u);
  assert.match(messages.system, /Test meaningful academic understanding/u);
  assert.match(messages.prompt, /## Question 1/u);
  assert.match(messages.prompt, /Question: question text/u);
  assert.match(messages.prompt, /Correct: A/u);
  assert.match(messages.prompt, /Explanation: concise explanation/u);
});

test("normal question generation config is explicit and Practice remains separate", () => {
  assert.match(questionFunctions, /MAX_INPUT_CHARS = 60_000/u);
  assert.match(questionFunctions, /const QUESTION_GENERATION_MAX_OUTPUT_TOKENS = 2_000/u);
  assert.match(questionFunctions, /maxOutputTokens: QUESTION_GENERATION_MAX_OUTPUT_TOKENS/u);
  assert.match(questionFunctions, /reasoningEffort: "low" as const/u);
  assert.match(questionFunctions, /languageInstructionPlacement: "prompt-only"/u);
  assert.match(questionFunctions, /languageInstructionFormat: "instruction-only"/u);
  assert.match(questionFunctions, /system: QUESTION_SYSTEM_PROMPT/u);
  assert.match(questionFunctions, /system: PRACTICE_QUESTION_SYSTEM_PROMPT/u);
  assert.match(PRACTICE_QUESTION_SYSTEM_PROMPT, /MISSED QUESTIONS section/u);
  assert.match(PRACTICE_QUESTION_SYSTEM_PROMPT, /Vary the position of the correct option/u);
});

test("compact normal question Markdown contract still validates exactly five questions", () => {
  const output = `
## Question 1
Question: What does atomicity protect?
A. All-or-nothing changes
B. Partial writes only
C. Outside facts
D. Interface labels
Correct: A
Explanation: Atomicity keeps grouped changes together.

## Question 2
Question: Why do durable logs help recovery?
A. They remove every index
B. They preserve committed changes
C. They skip transactions
D. They translate prompts
Correct: B
Explanation: Durable logs provide information needed after failures.

## Question 3
Question: How does isolation reduce interference?
A. By deleting sessions
B. By ignoring conflicts
C. By controlling concurrent effects
D. By shortening titles
Correct: C
Explanation: Isolation manages how concurrent operations can affect one another.

## Question 4
Question: Which action confirms a transaction?
A. Rollback
B. Scan
C. Parse
D. Commit
Correct: D
Explanation: Commit records the successful transaction outcome.

## Question 5
Question: What does an index improve?
A. Lookup efficiency
B. Auth ownership
C. Color contrast
D. File naming
Correct: A
Explanation: Indexes help locate records more efficiently.
`;

  const parsed = parseMarkdownQuestions(output);
  const questions = questionSetSchema.parse(parsed).questions;

  assert.equal(questions.length, 5);
  assert.ok(questions.every((question) => question.options.length === 4));
  assert.deepEqual(
    questions.map((question) => question.correctIndex),
    [0, 1, 2, 3, 0],
  );
});
