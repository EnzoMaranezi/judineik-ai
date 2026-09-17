import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  TOPIC_DISCOVERY_OUTPUT_FORMAT,
  TOPIC_DISCOVERY_SYSTEM_PROMPT,
} from "./document-topics.prompt.ts";
import { PRACTICE_QUESTION_SYSTEM_PROMPT, QUESTION_SYSTEM_PROMPT } from "./questions.prompt.ts";
import { DOCUMENT_SUMMARY_SYSTEM_PROMPT, SUMMARY_SYSTEM_PROMPT } from "./summary.prompt.ts";

const topicFunctions = readFileSync(
  new URL("./document-topics.functions.ts", import.meta.url),
  "utf8",
);
const questionFunctions = readFileSync(
  new URL("./questions.functions.ts", import.meta.url),
  "utf8",
);
const summaryFunctions = readFileSync(new URL("./summaries.functions.ts", import.meta.url), "utf8");
const gateway = readFileSync(new URL("./ai-gateway.server.ts", import.meta.url), "utf8");
const compatibilityScript = readFileSync(
  new URL("../../scripts/nvidia-nim-compat-test.mjs", import.meta.url),
  "utf8",
);

test("production and compatibility paths use the reviewed prompts for every provider attempt", () => {
  assert.match(topicFunctions, /system: TOPIC_DISCOVERY_SYSTEM_PROMPT/u);
  assert.match(questionFunctions, /system: QUESTION_SYSTEM_PROMPT/u);
  assert.match(questionFunctions, /system: PRACTICE_QUESTION_SYSTEM_PROMPT/u);
  assert.match(summaryFunctions, /system: topic \? SUMMARY_SYSTEM_PROMPT : DOCUMENT_SUMMARY_SYSTEM_PROMPT/u);
  assert.match(compatibilityScript, /from "\.\.\/src\/lib\/questions\.prompt\.ts"/u);
  assert.match(compatibilityScript, /from "\.\.\/src\/lib\/summary\.prompt\.ts"/u);
  assert.match(gateway, /runAiProviderChain\([\s\S]*system: messages\.system/u);
  assert.match(gateway, /runAiProviderChain\([\s\S]*prompt: messages\.prompt/u);
});

test("topic discovery separates exact coverage from instructional topic evidence", () => {
  assert.match(TOPIC_DISCOVERY_SYSTEM_PROMPT, /segmentIds for complete source coverage/u);
  assert.match(TOPIC_DISCOVERY_SYSTEM_PROMPT, /coreSegmentIds for the instructional evidence/u);
  assert.match(
    TOPIC_DISCOVERY_SYSTEM_PROMPT,
    /Put those attached non-instructional tokens in segmentIds but NOT in coreSegmentIds/u,
  );
  assert.match(
    TOPIC_DISCOVERY_SYSTEM_PROMPT,
    /Never use bibliography, metadata, or documentary details merely to reach 3 topics/u,
  );
  assert.match(TOPIC_DISCOVERY_OUTPUT_FORMAT, /"coreSegmentIds"/u);
  assert.match(TOPIC_DISCOVERY_OUTPUT_FORMAT, /non-empty subset/u);
});

test("question contracts reject documentary recall while preserving contextual relevance", () => {
  for (const prompt of [QUESTION_SYSTEM_PROMPT, PRACTICE_QUESTION_SYSTEM_PROMPT]) {
    assert.match(prompt, /must test meaningful academic understanding/u);
    assert.match(
      prompt,
      /filename, file extension, posting location, platform, publisher, edition/u,
    );
    assert.match(
      prompt,
      /unless that information is itself explicitly taught as part of the subject/u,
    );
    assert.match(
      prompt,
      /programming language[\s\S]*remains valid when the source teaches its concepts/u,
    );
    assert.match(prompt, /duplicate or near-duplicate questions/u);
  }
});

test("summary contract is study-oriented, source-grounded, and does not invent missing code analysis", () => {
  assert.match(DOCUMENT_SUMMARY_SYSTEM_PROMPT, /source-grounded academic study summary/u);
  assert.match(DOCUMENT_SUMMARY_SYSTEM_PROMPT, /Use only the supplied material/u);
  assert.match(DOCUMENT_SUMMARY_SYSTEM_PROMPT, /filenames, citations, publishers, platforms/u);
  assert.match(SUMMARY_SYSTEM_PROMPT, /study-oriented rather than an inventory/u);
  assert.match(SUMMARY_SYSTEM_PROMPT, /Every substantive statement must be directly supported/u);
  assert.match(SUMMARY_SYSTEM_PROMPT, /General correctness is not sufficient evidence/u);
  assert.match(
    SUMMARY_SYSTEM_PROMPT,
    /mentions code[\s\S]*does not supply its contents, do not analyze or reconstruct it/u,
  );
  assert.match(SUMMARY_SYSTEM_PROMPT, /briefly in Limitations/u);
  assert.match(SUMMARY_SYSTEM_PROMPT, /unstated textbook knowledge/u);
});
