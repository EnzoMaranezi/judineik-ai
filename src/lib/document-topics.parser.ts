import { z } from "zod";
import { evaluateTopicSourceEligibility, NEW_TOPIC_MIN_SOURCE_CHARACTERS } from "./topic-source-eligibility.ts";
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

const parserErrorCategories = {
  MALFORMED_TOPIC_OUTPUT: "json",
  INVALID_TOPIC_OUTPUT: "schema",
  DUPLICATE_TOPIC_TITLE: "duplicates",
  DUPLICATE_TOPIC_SEGMENT: "assignment",
  DUPLICATE_TOPIC_CORE_SEGMENT: "core_segments",
  INVALID_TOPIC_CORE_SEGMENT: "core_segments",
  UNKNOWN_TOPIC_SEGMENT: "assignment",
  OVERLAPPING_DOCUMENT_TOPICS: "assignment",
  INVALID_TOPIC_SOURCE_RANGE: "ranges",
  OVERLAPPING_TOPIC_SOURCE_RANGE: "ranges",
  TOPIC_SOURCE_TOO_SHORT: "grounding",
  INSUFFICIENT_TOPIC_COVERAGE: "coverage",
  TOPIC_SOURCE_TOO_BROAD: "grounding",
  UNKNOWN_TOPIC_PARSER_ERROR: "internal",
} as const;

type ParserErrorCode = keyof typeof parserErrorCategories;
type TopicDiagnosticMetadata = {
  topicIndex?: number;
  topicSegmentCount?: number;
  topicSourceCharacters?: number;
  minimumSourceCharacters?: number;
  schemaField?: "topic_count" | "title" | "description" | "segmentIds" | "coreSegmentIds" | "structure";
};

export type TopicDiscoveryParserDiagnostic = TopicDiagnosticMetadata & {
  errorCode: ParserErrorCode;
  category: (typeof parserErrorCategories)[ParserErrorCode];
  proposedTopicCount?: number;
  totalSegmentCount: number;
  assignedSegmentCount: number;
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
  onFailure?: (diagnostic: TopicDiscoveryParserDiagnostic) => void,
) {
  const assignedSegmentIds = new Set<string>();
  let proposedTopicCount: number | undefined;
  // Only fixed codes and explicitly constructed structural metadata reach the callback.
  const reportFailure = (errorCode: ParserErrorCode, metadata: TopicDiagnosticMetadata = {}) => {
    onFailure?.({
      errorCode,
      category: parserErrorCategories[errorCode],
      totalSegmentCount: segments.length,
      assignedSegmentCount: assignedSegmentIds.size,
      ...(proposedTopicCount === undefined ? {} : { proposedTopicCount }),
      ...metadata,
    });
  };
  function reject(errorCode: ParserErrorCode, metadata: TopicDiagnosticMetadata = {}): never {
    reportFailure(errorCode, metadata);
    throw new Error(errorCode);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(output));
  } catch (error) {
    reportFailure("MALFORMED_TOPIC_OUTPUT");
    if (error instanceof Error && error.message === "MALFORMED_TOPIC_OUTPUT") throw error;
    throw new Error("MALFORMED_TOPIC_OUTPUT");
  }

  if (parsed && typeof parsed === "object" && "topics" in parsed && Array.isArray(parsed.topics)) {
    proposedTopicCount = parsed.topics.length;
  }
  const result = rawResponseSchema.safeParse(parsed);
  if (!result.success) {
    const path = result.error.issues[0]?.path ?? [];
    const field = path[2];
    const schemaField = path.length === 1 && path[0] === "topics" && proposedTopicCount !== undefined
      ? "topic_count"
      : field === "title" || field === "description" || field === "segmentIds" || field === "coreSegmentIds"
        ? field
        : "structure";
    reject("INVALID_TOPIC_OUTPUT", {
      schemaField,
      ...(typeof path[1] === "number" ? { topicIndex: path[1] } : {}),
    });
  }

  const segmentsById = new Map(segments.map((segment) => [segment.id, segment]));
  const segmentOrder = new Map(segments.map((segment, index) => [segment.id, index]));
  const titles: string[] = [];
  const topics = result.data.topics.map((topic, topicIndex) => {
    const metadata = { topicIndex, topicSegmentCount: topic.segmentIds.length };
    if (titles.some((title) => areNearDuplicateTitles(title, topic.title))) {
      reject("DUPLICATE_TOPIC_TITLE", metadata);
    }
    titles.push(topic.title);

    const uniqueIds = new Set(topic.segmentIds);
    if (uniqueIds.size !== topic.segmentIds.length) reject("DUPLICATE_TOPIC_SEGMENT", metadata);
    const uniqueCoreIds = new Set(topic.coreSegmentIds);
    if (uniqueCoreIds.size !== topic.coreSegmentIds.length) {
      reject("DUPLICATE_TOPIC_CORE_SEGMENT", metadata);
    }
    if (topic.coreSegmentIds.some((token) => !uniqueIds.has(token))) {
      reject("INVALID_TOPIC_CORE_SEGMENT", metadata);
    }
    const topicSegments = topic.segmentIds.map((token) => {
      const id = token.slice("SEG:".length);
      const segment = segmentsById.get(id);
      if (!segment) reject("UNKNOWN_TOPIC_SEGMENT", metadata);
      if (assignedSegmentIds.has(id)) reject("OVERLAPPING_DOCUMENT_TOPICS", metadata);
      assignedSegmentIds.add(id);
      return segment;
    });
    topicSegments.sort(
      (left, right) => (segmentOrder.get(left.id) ?? 0) - (segmentOrder.get(right.id) ?? 0),
    );
    let sourceRanges: TopicSourceRange[];
    let groundedSource: string;
    try {
      sourceRanges = normalizeTopicSourceRanges(
        source,
        topicSegments.map(({ start, end }) => ({ start, end })),
      );
      groundedSource = reconstructTopicSource(source, sourceRanges);
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      reportFailure(
        code === "INVALID_TOPIC_SOURCE_RANGE" || code === "OVERLAPPING_TOPIC_SOURCE_RANGE"
          ? code : "UNKNOWN_TOPIC_PARSER_ERROR",
        metadata,
      );
      throw error;
    }
    const eligibility = evaluateTopicSourceEligibility(groundedSource);
    if (!eligibility.meetsNewTopicMinimum) reject("TOPIC_SOURCE_TOO_SHORT", {
      ...metadata,
      topicSourceCharacters: eligibility.sourceCharacters,
      minimumSourceCharacters: NEW_TOPIC_MIN_SOURCE_CHARACTERS,
    });
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

  if (assignedSegmentIds.size !== segments.length) reject("INSUFFICIENT_TOPIC_COVERAGE");
  const totalGroundedLength = topics.reduce((total, topic) => total + topic.groundedLength, 0);
  if (
    totalGroundedLength >= 1000 &&
    topics.some((topic) => topic.groundedLength / totalGroundedLength > 0.85)
  ) {
    reject("TOPIC_SOURCE_TOO_BROAD");
  }

  return topics
    .sort((left, right) => left.firstSegment - right.firstSegment)
    .map(({ groundedLength: _groundedLength, firstSegment: _firstSegment, ...topic }, index) => ({
      ...topic,
      position: index + 1,
    })) satisfies DiscoveredDocumentTopic[];
}
