import { z } from "zod";
import { evaluateTopicSourceEligibility } from "./topic-source-eligibility.ts";
import {
  normalizeTopicSourceRanges,
  reconstructTopicSource,
  type TopicSourceRange,
  type TopicSourceSegment,
} from "./document-topics.source.ts";

export type DiscoveredDocumentTopic = {
  title: string;
  description: string;
  sourceRanges: TopicSourceRange[];
  position: number;
};

const rawTopicSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(20).max(600),
  segmentIds: z
    .array(
      z
        .string()
        .trim()
        .regex(/^SEG:S\d{3}$/u),
    )
    .min(1),
  coreSegmentIds: z
    .array(
      z
        .string()
        .trim()
        .regex(/^SEG:S\d{3}$/u),
    )
    .min(1),
});

const rawResponseSchema = z.object({
  topics: z.array(rawTopicSchema).min(3).max(12),
});

function extractJsonObject(output: string) {
  const trimmed = output.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "")
    .trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("MALFORMED_TOPIC_OUTPUT");
  return unfenced.slice(start, end + 1);
}

function normalizedTitle(title: string) {
  return title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("und")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function titleTokens(title: string) {
  return new Set(normalizedTitle(title).split(/\s+/u).filter(Boolean));
}

function areNearDuplicateTitles(left: string, right: string) {
  const normalizedLeft = normalizedTitle(left);
  const normalizedRight = normalizedTitle(right);
  if (normalizedLeft === normalizedRight) return true;
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union > 0 && intersection / union >= 0.8;
}

export function parseTopicDiscoveryResponse(
  output: string,
  source: string,
  segments: TopicSourceSegment[],
) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(output));
  } catch (error) {
    if (error instanceof Error && error.message === "MALFORMED_TOPIC_OUTPUT") throw error;
    throw new Error("MALFORMED_TOPIC_OUTPUT");
  }

  const result = rawResponseSchema.safeParse(parsed);
  if (!result.success) throw new Error("INVALID_TOPIC_OUTPUT");

  const segmentsById = new Map(segments.map((segment) => [segment.id, segment]));
  const segmentOrder = new Map(segments.map((segment, index) => [segment.id, index]));
  const assignedSegmentIds = new Set<string>();
  const titles: string[] = [];
  const topics = result.data.topics.map((topic) => {
    if (titles.some((title) => areNearDuplicateTitles(title, topic.title))) {
      throw new Error("DUPLICATE_TOPIC_TITLE");
    }
    titles.push(topic.title);

    const uniqueIds = new Set(topic.segmentIds);
    if (uniqueIds.size !== topic.segmentIds.length) throw new Error("DUPLICATE_TOPIC_SEGMENT");
    const uniqueCoreIds = new Set(topic.coreSegmentIds);
    if (uniqueCoreIds.size !== topic.coreSegmentIds.length) {
      throw new Error("DUPLICATE_TOPIC_CORE_SEGMENT");
    }
    if (topic.coreSegmentIds.some((token) => !uniqueIds.has(token))) {
      throw new Error("INVALID_TOPIC_CORE_SEGMENT");
    }
    const topicSegments = topic.segmentIds.map((token) => {
      const id = token.slice("SEG:".length);
      const segment = segmentsById.get(id);
      if (!segment) throw new Error("UNKNOWN_TOPIC_SEGMENT");
      if (assignedSegmentIds.has(id)) throw new Error("OVERLAPPING_DOCUMENT_TOPICS");
      assignedSegmentIds.add(id);
      return segment;
    });
    topicSegments.sort(
      (left, right) => (segmentOrder.get(left.id) ?? 0) - (segmentOrder.get(right.id) ?? 0),
    );
    const sourceRanges = normalizeTopicSourceRanges(
      source,
      topicSegments.map(({ start, end }) => ({ start, end })),
    );
    const groundedSource = reconstructTopicSource(source, sourceRanges);
    const eligibility = evaluateTopicSourceEligibility(groundedSource);
    if (!eligibility.meetsNewTopicMinimum) throw new Error("TOPIC_SOURCE_TOO_SHORT");
    // Preserve existing broad-topic weighting; only new-topic eligibility changes here.
    const groundedLength = groundedSource.replace(/\s+/gu, "").length;
    return {
      title: topic.title,
      description: topic.description,
      sourceRanges,
      groundedLength,
      firstSegment: Math.min(...topicSegments.map((segment) => segmentOrder.get(segment.id) ?? 0)),
    };
  });

  if (assignedSegmentIds.size !== segments.length) throw new Error("INSUFFICIENT_TOPIC_COVERAGE");
  const totalGroundedLength = topics.reduce((total, topic) => total + topic.groundedLength, 0);
  if (
    totalGroundedLength >= 1000 &&
    topics.some((topic) => topic.groundedLength / totalGroundedLength > 0.85)
  ) {
    throw new Error("TOPIC_SOURCE_TOO_BROAD");
  }

  return topics
    .sort((left, right) => left.firstSegment - right.firstSegment)
    .map(({ groundedLength: _groundedLength, firstSegment: _firstSegment, ...topic }, index) => ({
      ...topic,
      position: index + 1,
    })) satisfies DiscoveredDocumentTopic[];
}
