import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildAiGenerationMessages } from "./ai-generation-messages.ts";
import { parseTopicDiscoveryResponse } from "./document-topics.parser.ts";
import {
  TOPIC_DISCOVERY_LANGUAGE_INSTRUCTION,
  TOPIC_DISCOVERY_OUTPUT_FORMAT,
  TOPIC_DISCOVERY_SYSTEM_PROMPT,
} from "./document-topics.prompt.ts";
import { segmentDocumentSource, topicSegmentToken } from "./document-topics.source.ts";

const topicFunctions = readFileSync(
  new URL("./document-topics.functions.ts", import.meta.url),
  "utf8",
);

function firstToken(tokens: string[]) {
  const token = tokens[0];
  assert.ok(token);
  return token;
}

test("topic discovery uses compact prompt text with one direct language instruction", () => {
  const messages = buildAiGenerationMessages({
    system: TOPIC_DISCOVERY_SYSTEM_PROMPT,
    prompt: "Document title: Example\n\nSOURCE SEGMENTS:\n...\n\nGroup this material into topics.",
    outputFormat: TOPIC_DISCOVERY_OUTPUT_FORMAT,
    languageInstruction: TOPIC_DISCOVERY_LANGUAGE_INSTRUCTION,
    languageInstructionPlacement: "prompt-only",
    languageInstructionFormat: "instruction-only",
  });

  assert.doesNotMatch(messages.system, /OUTPUT LANGUAGE REQUIREMENT/u);
  assert.doesNotMatch(messages.system, /Write topic titles and descriptions/u);
  assert.equal(
    (messages.prompt.match(/Write topic titles and descriptions/gu) ?? []).length,
    1,
  );
  assert.match(messages.system, /Split one source document into 3-12 useful academic study topics/u);
  assert.match(messages.system, /Attach non-instructional segments/u);
  assert.match(messages.prompt, /Return JSON only, no Markdown/u);
  assert.match(messages.prompt, /"segmentIds":\["SEG:S001"\]/u);
  assert.match(messages.prompt, /"coreSegmentIds":\["SEG:S001"\]/u);
});

test("topic discovery generation config is explicit without changing segmentation or persistence", () => {
  assert.match(topicFunctions, /MAX_SOURCE_CODE_POINTS = 100_000/u);
  assert.match(topicFunctions, /const TOPIC_DISCOVERY_MAX_OUTPUT_TOKENS = 3_000/u);
  assert.match(topicFunctions, /maxOutputTokens: TOPIC_DISCOVERY_MAX_OUTPUT_TOKENS/u);
  assert.match(topicFunctions, /reasoningEffort: "low" as const/u);
  assert.match(topicFunctions, /languageInstructionPlacement: "prompt-only"/u);
  assert.match(topicFunctions, /languageInstructionFormat: "instruction-only"/u);
  assert.match(topicFunctions, /const segments = validateDiscoverableSource\(source\)/u);
  assert.match(topicFunctions, /parseTopicDiscoveryResponse\(generated\.text, source, segments\)/u);
  assert.match(topicFunctions, /supabase\.rpc\("create_document_topics"/u);
});

test("compact topic JSON contract remains compatible with the existing parser", () => {
  const source = [
    "Processos mantêm estado, contexto e recursos durante a execução. ".repeat(12),
    "Escalonamento escolhe tarefas prontas e distribui tempo de CPU. ".repeat(12),
    "Mutexes e semáforos protegem recursos compartilhados entre tarefas. ".repeat(12),
  ].join("\n\n");
  const segments = segmentDocumentSource(source);
  const tokenGroups: [string[], string[], string[]] = [[], [], []];
  segments.forEach((segment, index) => {
    tokenGroups[Math.min(2, Math.floor((index * 3) / segments.length))]?.push(
      topicSegmentToken(segment.id),
    );
  });
  const output = JSON.stringify({
    topics: [
      {
        title: "Processos",
        description: "Estados, contextos e recursos associados à execução de processos.",
        segmentIds: tokenGroups[0],
        coreSegmentIds: [firstToken(tokenGroups[0])],
      },
      {
        title: "Escalonamento",
        description: "Seleção de tarefas prontas e distribuição do tempo de processamento.",
        segmentIds: tokenGroups[1],
        coreSegmentIds: [firstToken(tokenGroups[1])],
      },
      {
        title: "Sincronização",
        description: "Coordenação do acesso a recursos compartilhados com mutexes e semáforos.",
        segmentIds: tokenGroups[2],
        coreSegmentIds: [firstToken(tokenGroups[2])],
      },
    ],
  });

  const topics = parseTopicDiscoveryResponse(output, source, segments);

  assert.equal(topics.length, 3);
  assert.deepEqual(
    topics.map((topic) => topic.position),
    [1, 2, 3],
  );
});
