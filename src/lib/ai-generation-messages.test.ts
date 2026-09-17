import assert from "node:assert/strict";
import test from "node:test";
import { buildAiGenerationMessages } from "./ai-generation-messages.ts";

const summaryFormat = `## Key concepts
## Explanations`;

test("puts the pt-BR language contract in the provider system and prompt messages", () => {
  const languageInstruction =
    "Write all user-facing generated content in Brazilian Portuguese (pt-BR).";
  const messages = buildAiGenerationMessages({
    system: "System prompt",
    prompt: "Produce the summary.",
    outputFormat: summaryFormat,
    languageInstruction,
  });

  assert.match(messages.system, /Brazilian Portuguese \(pt-BR\)/);
  assert.match(messages.prompt, /Brazilian Portuguese \(pt-BR\)/);
  assert.ok(messages.prompt.indexOf(languageInstruction) < messages.prompt.indexOf(summaryFormat));
  assert.match(messages.prompt, /## Key concepts/);
});

test("keeps the English contract and fixed parser tokens intact", () => {
  const languageInstruction = "Write all user-facing generated content in English.";
  const messages = buildAiGenerationMessages({
    system: "System prompt",
    prompt: "Produce the questions.",
    outputFormat: "Question: question text\nCorrect: A\nExplanation: explanation",
    languageInstruction,
  });

  assert.match(messages.system, /in English/);
  assert.match(messages.prompt, /in English/);
  assert.match(messages.prompt, /Question: question text/);
  assert.match(messages.prompt, /Correct: A/);
  assert.match(messages.prompt, /Explanation: explanation/);
});

test("can keep the direct language instruction only in the prompt for compact document prompts", () => {
  const languageInstruction = "Write all user-facing generated content in English.";
  const messages = buildAiGenerationMessages({
    system: "Compact system prompt",
    prompt: "Produce the summary.",
    outputFormat: summaryFormat,
    languageInstruction,
    languageInstructionPlacement: "prompt-only",
    languageInstructionFormat: "instruction-only",
  });

  assert.equal(messages.system, "Compact system prompt");
  assert.match(messages.prompt, /in English/);
  assert.doesNotMatch(messages.prompt, /OUTPUT LANGUAGE REQUIREMENT/);
  assert.match(messages.prompt, /## Key concepts/);
});
