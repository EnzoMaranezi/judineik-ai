import assert from "node:assert/strict";
import test from "node:test";
import { parseTopicDiscoveryResponse, type TopicDiscoveryParserDiagnostic } from "./document-topics.parser.ts";

function fixture(length = 199) {
  const parts = ["a".repeat(201), "b".repeat(200), "c".repeat(length)];
  const source = parts.join("\n\n");
  let offset = 0;
  const segments = parts.map((part, index) => {
    const start = offset;
    offset += part.length + 2;
    return { id: `S00${index + 1}`, start, end: offset - 2, text: "PRIVATE_SEGMENT_CONTENT" };
  });
  const topics = segments.map((segment, index) => ({
    title: ["PRIVATE_PROCESS_TITLE", "PRIVATE_SCHEDULING_TITLE", "PRIVATE_MUTEX_TITLE"][index],
    description: "PRIVATE_DESCRIPTION: instructional details not to be logged.",
    segmentIds: [`SEG:${segment.id}`],
    coreSegmentIds: [`SEG:${segment.id}`],
  }));
  return { source, segments, topics };
}

test("short-source diagnostics contain only the exact safe numeric payload", () => {
  const { source, segments, topics } = fixture();
  const output = JSON.stringify({ topics, unexpectedPrivateField: "PRIVATE_PROVIDER_RESPONSE" });
  const diagnostics: TopicDiscoveryParserDiagnostic[] = [];
  assert.throws(() => parseTopicDiscoveryResponse(output, source, segments, d => diagnostics.push(d)),
    /^Error: TOPIC_SOURCE_TOO_SHORT$/);
  assert.deepEqual(diagnostics, [{
    errorCode: "TOPIC_SOURCE_TOO_SHORT", category: "grounding",
    totalSegmentCount: 3, assignedSegmentCount: 3, proposedTopicCount: 3,
    topicIndex: 2, topicSegmentCount: 1, topicSourceCharacters: 199, minimumSourceCharacters: 200,
  }]);
  const serialized = JSON.stringify(diagnostics);
  for (const privateValue of [source, output, "PRIVATE_PROVIDER_RESPONSE", segments[0]!.text,
    ...topics.flatMap(topic => [topic.title!, topic.description])]) {
    assert.ok(!serialized.includes(privateValue));
  }
});

test("malformed JSON, invalid count and invalid core schema emit fixed diagnostics, not Zod/provider text", () => {
  const { source, segments, topics } = fixture(200);
  const cases = [
    { output: "PRIVATE_MALFORMED_RESPONSE", expected: {
      errorCode: "MALFORMED_TOPIC_OUTPUT", category: "json", totalSegmentCount: 3, assignedSegmentCount: 0,
    } },
    { output: JSON.stringify({ topics: topics.slice(0, 2) }), expected: {
      errorCode: "INVALID_TOPIC_OUTPUT", category: "schema", totalSegmentCount: 3,
      assignedSegmentCount: 0, proposedTopicCount: 2, schemaField: "topic_count",
    } },
    { output: JSON.stringify({ topics: topics.map((topic, index) => index === 1
      ? { ...topic, coreSegmentIds: ["PRIVATE_INVALID_TOKEN"] } : topic) }), expected: {
      errorCode: "INVALID_TOPIC_OUTPUT", category: "schema", totalSegmentCount: 3,
      assignedSegmentCount: 0, proposedTopicCount: 3, schemaField: "coreSegmentIds", topicIndex: 1,
    } },
  ];
  for (const { output, expected } of cases) {
    const diagnostics: TopicDiscoveryParserDiagnostic[] = [];
    assert.throws(() => parseTopicDiscoveryResponse(output, source, segments, d => diagnostics.push(d)),
      new RegExp(`^Error: ${expected.errorCode}$`));
    assert.deepEqual(diagnostics, [expected]);
    assert.doesNotMatch(JSON.stringify(diagnostics), /PRIVATE/);
  }
});

test("overlap and range failures keep their existing errors and emit exactly one structural event", () => {
  const { source, segments, topics } = fixture(200);
  topics[1]!.segmentIds.push("SEG:S001");
  const overlap: TopicDiscoveryParserDiagnostic[] = [];
  assert.throws(() => parseTopicDiscoveryResponse(JSON.stringify({ topics }), source, segments,
    d => overlap.push(d)), /^Error: OVERLAPPING_DOCUMENT_TOPICS$/);
  assert.deepEqual(overlap, [{
    errorCode: "OVERLAPPING_DOCUMENT_TOPICS", category: "assignment", totalSegmentCount: 3,
    assignedSegmentCount: 2, proposedTopicCount: 3, topicIndex: 1, topicSegmentCount: 2,
  }]);
  topics[1]!.segmentIds.pop();
  segments[0]!.end = source.length + 1;
  const ranges: TopicDiscoveryParserDiagnostic[] = [];
  assert.throws(() => parseTopicDiscoveryResponse(JSON.stringify({ topics }), source, segments,
    d => ranges.push(d)), /^Error: INVALID_TOPIC_SOURCE_RANGE$/);
  assert.deepEqual(ranges, [{
    errorCode: "INVALID_TOPIC_SOURCE_RANGE", category: "ranges", totalSegmentCount: 3,
    assignedSegmentCount: 1, proposedTopicCount: 3, topicIndex: 0, topicSegmentCount: 1,
  }]);
});

test("valid parser output is identical with diagnostics enabled and emits nothing", () => {
  const { source, segments, topics } = fixture(200);
  const output = JSON.stringify({ topics });
  const diagnostics: TopicDiscoveryParserDiagnostic[] = [];
  assert.deepEqual(parseTopicDiscoveryResponse(output, source, segments, d => diagnostics.push(d)),
    parseTopicDiscoveryResponse(output, source, segments));
  assert.deepEqual(diagnostics, []);
});
