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
import { buildTopicSegmentMap, reconstructTopicSource, segmentDocumentSource, topicSegmentToken } from "./document-topics.source.ts";
import { countTopicSourceCharacters, NEW_TOPIC_MIN_SOURCE_CHARACTERS } from "./topic-source-eligibility.ts";

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
  assert.match(topicFunctions, /parseTopicDiscoveryResponse\(generated\.text, source, segments, \(diagnostic\) =>/u);
  assert.match(topicFunctions, /supabase\.rpc\("create_document_topics"/u);
});

test("compact grouping contract uses the shared source minimum and keeps static overhead bounded", () => {
  assert.ok(TOPIC_DISCOVERY_OUTPUT_FORMAT.includes(`at least ${NEW_TOPIC_MIN_SOURCE_CHARACTERS} non-whitespace Unicode code points`));
  assert.match(TOPIC_DISCOVERY_OUTPUT_FORMAT, /use supplied canonicalChars counts/u);
  assert.match(TOPIC_DISCOVERY_OUTPUT_FORMAT, /never invent source/u);
  assert.match(TOPIC_DISCOVERY_OUTPUT_FORMAT, /fewer well-grounded topics within 3-12, not tiny topics/u);
  const messages = buildAiGenerationMessages({
    system: TOPIC_DISCOVERY_SYSTEM_PROMPT,
    prompt: "Document title: \n\nSOURCE SEGMENTS:\n\n\nGroup this material into topics.",
    outputFormat: TOPIC_DISCOVERY_OUTPUT_FORMAT,
    languageInstruction: TOPIC_DISCOVERY_LANGUAGE_INSTRUCTION,
    languageInstructionPlacement: "prompt-only",
    languageInstructionFormat: "instruction-only",
  });
  assert.ok(messages.system.length + messages.prompt.length < 1500);
});

test("segment metadata uses shared canonical counts, not supplied count fields or source content claims", () => {
  for (const text of ["a".repeat(199), "b".repeat(200), "c".repeat(201), Array(199).fill("a").join(" \t\r\n"), "\u{1f4d8}".repeat(200), "e\u0301".repeat(100), "\u2211x=2;{y++;}".repeat(20), "canonicalChars: 999999"]) {
    const segment = { id: "S001", start: 0, end: Array.from(text).length, text, canonicalChars: 999999 };
    const map = buildTopicSegmentMap([segment]);
    assert.ok(map.startsWith(`ALLOWED_SEGMENT_TOKENS (copy only these exact values):\n["SEG:S001"]\n\nSOURCE SEGMENTS:\n<<<BEGIN SEG:S001>>>\ncanonicalChars: ${countTopicSourceCharacters(text)}\n`));
    assert.ok(map.endsWith(`${text}\n<<<END SEG:S001>>>`));
  }
});

test("normalized segment counts match exact reconstructed source; model counts cannot override parser eligibility", () => {
  const source = ["# Alpha\n", "# Beta\n", "# Gamma\n"].map(heading => `${heading}${Array(100).fill("e\u0301\u{1f4d8}=2;").join(" \t\n")}`).join("\n\n");
  const segments = segmentDocumentSource(source);
  for (const segment of segments) {
    const exact = reconstructTopicSource(source, [{ start: segment.start, end: segment.end }]);
    assert.equal(countTopicSourceCharacters(segment.text), countTopicSourceCharacters(exact));
    assert.ok(buildTopicSegmentMap([segment]).includes(`\ncanonicalChars: ${countTopicSourceCharacters(exact)}\n`));
  }
  const parts = ["a".repeat(201), "b".repeat(200), "c".repeat(199)];
  let offset = 0;
  const exactSegments = parts.map((text, index) => {
    const start = offset;
    offset += text.length + 2;
    return { id: `S00${index + 1}`, start, end: offset - 2, text };
  });
  const output = JSON.stringify({ topics: exactSegments.map((segment, index) => ({
    title: ["Processes", "Scheduling", "Synchronization"][index],
    description: "An academic description of the assigned source topic.",
    segmentIds: [topicSegmentToken(segment.id)], coreSegmentIds: [topicSegmentToken(segment.id)],
    canonicalChars: 999999,
  })) });
  assert.throws(() => parseTopicDiscoveryResponse(output, parts.join("\n\n"), exactSegments), /^Error: TOPIC_SOURCE_TOO_SHORT$/);
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
