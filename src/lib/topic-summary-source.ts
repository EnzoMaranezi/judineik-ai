import {
  hashTopicSource,
  reconstructTopicSource,
  type TopicSourceRange,
} from "./document-topics.source.ts";
import { z } from "zod";
import { evaluateTopicSourceEligibility } from "./topic-source-eligibility.ts";

export const TOPIC_SUMMARY_SOURCE_UNAVAILABLE = "TOPIC_SOURCE_UNAVAILABLE";
export const TOPIC_SUMMARY_SOURCE_INVALID = "INVALID_TOPIC_SOURCE_RANGE";
export const STALE_TOPIC_SUMMARY_SOURCE = "STALE_TOPIC_SOURCE";

const topicSourceRangesSchema = z.array(
  z.object({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  }),
).min(1);

export function parseTopicSummarySourceRanges(value: unknown) {
  try {
    return topicSourceRangesSchema.parse(value);
  } catch {
    throw new Error(TOPIC_SUMMARY_SOURCE_INVALID);
  }
}

export async function reconstructVerifiedTopicSource({
  source,
  sourceRanges,
  sourceHash,
}: {
  source: string | null;
  sourceRanges: TopicSourceRange[];
  sourceHash: string;
}) {
  if (!source || !source.trim()) throw new Error(TOPIC_SUMMARY_SOURCE_UNAVAILABLE);
  if ((await hashTopicSource(source)) !== sourceHash) {
    throw new Error(STALE_TOPIC_SUMMARY_SOURCE);
  }

  let groundedSource: string;
  try {
    groundedSource = reconstructTopicSource(source, sourceRanges);
  } catch {
    throw new Error(TOPIC_SUMMARY_SOURCE_INVALID);
  }

  if (!evaluateTopicSourceEligibility(groundedSource).summary) {
    throw new Error(TOPIC_SUMMARY_SOURCE_UNAVAILABLE);
  }
  return groundedSource;
}
