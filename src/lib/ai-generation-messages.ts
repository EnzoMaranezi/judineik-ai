export type AiGenerationMessagesInput = {
  system: string;
  prompt: string;
  outputFormat?: string | undefined;
  languageInstruction: string;
  languageInstructionPlacement?: "system-and-prompt" | "prompt-only" | undefined;
  languageInstructionFormat?: "contract" | "instruction-only" | undefined;
};

export function buildAiGenerationMessages({
  system,
  prompt,
  outputFormat,
  languageInstruction,
  languageInstructionPlacement = "system-and-prompt",
  languageInstructionFormat = "contract",
}: AiGenerationMessagesInput) {
  const languageContract = `OUTPUT LANGUAGE REQUIREMENT:
${languageInstruction}
This applies to every user-facing generated field. Do not switch generated content to the source material's language when it differs from this requirement. Preserve only format labels and headings explicitly marked as fixed parser tokens.`;
  const languageBlock =
    languageInstructionFormat === "contract" ? languageContract : languageInstruction;

  return {
    system:
      languageInstructionPlacement === "system-and-prompt"
        ? `${system}\n\n${languageBlock}`
        : system,
    prompt: [prompt, languageBlock, outputFormat].filter(Boolean).join("\n\n"),
  };
}
