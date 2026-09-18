import { countTopicSourceCharacters } from "./topic-source-eligibility.ts";

export type TopicSourceRange = {
  start: number;
  end: number;
};

export type TopicSourceSegment = TopicSourceRange & {
  id: string;
  text: string;
};

const MAX_SEGMENT_CHARS = 900;
const MIN_SPLIT_CHARS = 220;

function trimRange(points: string[], start: number, end: number): TopicSourceRange | null {
  while (start < end && /\s/u.test(points[start] ?? "")) start += 1;
  while (end > start && /\s/u.test(points[end - 1] ?? "")) end -= 1;
  return end > start ? { start, end } : null;
}

function isHeading(text: string) {
  const value = text.trim();
  if (!value || value.length > 140) return false;
  return (
    /^#{1,6}\s+\S/u.test(value) ||
    /^\d+(?:\.\d+)*(?:[.)])?\s+\p{L}/u.test(value) ||
    /^[\p{Lu}\d][\p{Lu}\p{M}\d\s:()\-–—]{3,}$/u.test(value) ||
    (/[:：]$/u.test(value) && value.split(/\s+/u).length <= 12)
  );
}

function lineRanges(points: string[]) {
  const lines: Array<TopicSourceRange & { text: string }> = [];
  let start = 0;
  for (let index = 0; index <= points.length; index += 1) {
    if (index !== points.length && points[index] !== "\n") continue;
    let end = index;
    if (end > start && points[end - 1] === "\r") end -= 1;
    lines.push({ start, end, text: points.slice(start, end).join("") });
    start = index + 1;
  }
  return lines;
}

function naturalBlocks(points: string[]) {
  const blocks: Array<TopicSourceRange & { heading: boolean }> = [];
  let current: (TopicSourceRange & { heading: boolean }) | null = null;

  const flush = () => {
    if (current) blocks.push(current);
    current = null;
  };

  for (const line of lineRanges(points)) {
    const trimmed = trimRange(points, line.start, line.end);
    if (!trimmed) {
      flush();
      continue;
    }

    const heading = isHeading(line.text);
    if (heading) flush();
    if (!current) {
      current = { ...trimmed, heading };
    } else {
      current.end = trimmed.end;
    }
  }
  flush();
  return blocks;
}

function findSplit(points: string[], start: number, target: number, end: number) {
  const minimum = Math.min(target, start + MIN_SPLIT_CHARS);
  for (let index = target; index >= minimum; index -= 1) {
    const previous = points[index - 1] ?? "";
    const current = points[index] ?? "";
    if ((/[.!?;:]|\n/u.test(previous) && /\s/u.test(current)) || previous === "\n") return index;
  }
  for (let index = target; index < Math.min(end, target + 100); index += 1) {
    if (/\s/u.test(points[index] ?? "")) return index;
  }
  return target;
}

function splitRange(points: string[], range: TopicSourceRange, maxChars = MAX_SEGMENT_CHARS) {
  const result: TopicSourceRange[] = [];
  let start = range.start;
  while (range.end - start > maxChars) {
    const split = findSplit(points, start, start + maxChars, range.end);
    const trimmed = trimRange(points, start, split);
    if (trimmed) result.push(trimmed);
    start = split;
  }
  const finalRange = trimRange(points, start, range.end);
  if (finalRange) result.push(finalRange);
  return result;
}

function coalesceBlocks(
  points: string[],
  blocks: Array<TopicSourceRange & { heading: boolean }>,
) {
  const combined: TopicSourceRange[] = [];
  let current: TopicSourceRange | null = null;

  const flush = () => {
    if (current) combined.push(current);
    current = null;
  };

  for (const block of blocks) {
    if (block.heading) flush();
    if (!current) {
      current = { start: block.start, end: block.end };
      continue;
    }
    if (block.end - current.start <= MAX_SEGMENT_CHARS) {
      current.end = block.end;
    } else {
      flush();
      current = { start: block.start, end: block.end };
    }
  }
  flush();
  return combined.flatMap((range) => splitRange(points, range));
}

function ensureMinimumSegments(points: string[], ranges: TopicSourceRange[]) {
  const result = [...ranges];
  while (result.length < 3) {
    let largestIndex = -1;
    let largestLength = 0;
    result.forEach((range, index) => {
      const length = range.end - range.start;
      if (length > largestLength && length >= MIN_SPLIT_CHARS * 2) {
        largestIndex = index;
        largestLength = length;
      }
    });
    if (largestIndex < 0) break;
    const largest = result[largestIndex];
    if (!largest) break;
    const split = findSplit(
      points,
      largest.start,
      largest.start + Math.floor((largest.end - largest.start) / 2),
      largest.end,
    );
    const left = trimRange(points, largest.start, split);
    const right = trimRange(points, split, largest.end);
    if (!left || !right) break;
    result.splice(largestIndex, 1, left, right);
  }
  return result;
}

export function segmentDocumentSource(source: string): TopicSourceSegment[] {
  const points = Array.from(source);
  const ranges = ensureMinimumSegments(points, coalesceBlocks(points, naturalBlocks(points)));
  return ranges.map((range, index) => ({
    id: `S${String(index + 1).padStart(3, "0")}`,
    ...range,
    text: points.slice(range.start, range.end).join("").replace(/\s+/gu, " ").trim(),
  }));
}

export function normalizeTopicSourceRanges(source: string, ranges: TopicSourceRange[]) {
  const sourceLength = Array.from(source).length;
  const sorted = [...ranges].sort((left, right) => left.start - right.start || left.end - right.end);
  const normalized: TopicSourceRange[] = [];

  for (const range of sorted) {
    if (
      !Number.isInteger(range.start) ||
      !Number.isInteger(range.end) ||
      range.start < 0 ||
      range.end <= range.start ||
      range.end > sourceLength
    ) {
      throw new Error("INVALID_TOPIC_SOURCE_RANGE");
    }
    const previous = normalized.at(-1);
    if (!previous) {
      normalized.push({ ...range });
      continue;
    }
    if (range.start === previous.start && range.end === previous.end) continue;
    if (range.start < previous.end) throw new Error("OVERLAPPING_TOPIC_SOURCE_RANGE");
    if (range.start === previous.end) {
      previous.end = range.end;
      continue;
    }
    normalized.push({ ...range });
  }
  return normalized;
}

export function reconstructTopicSource(source: string, ranges: TopicSourceRange[]) {
  const points = Array.from(source);
  return normalizeTopicSourceRanges(source, ranges)
    .map((range) => points.slice(range.start, range.end).join(""))
    .join("\n\n");
}

export async function hashTopicSource(source: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isTopicSourceHashCurrent(source: string, expectedHash: string) {
  return hashTopicSource(source).then((hash) => hash === expectedHash);
}

export function topicSegmentToken(segmentId: string) {
  if (!/^S\d{3}$/u.test(segmentId)) throw new Error("INVALID_TOPIC_SEGMENT_ID");
  return `SEG:${segmentId}`;
}

export function buildTopicSegmentMap(segments: TopicSourceSegment[]) {
  const tokens = segments.map((segment) => topicSegmentToken(segment.id));
  const sourceSegments = segments
    .map((segment, index) => {
      const token = tokens[index];
      return `<<<BEGIN ${token}>>>\ncanonicalChars: ${countTopicSourceCharacters(segment.text)}\n${segment.text}\n<<<END ${token}>>>`;
    })
    .join("\n\n");
  return `ALLOWED_SEGMENT_TOKENS (copy only these exact values):\n${JSON.stringify(tokens)}\n\nSOURCE SEGMENTS:\n${sourceSegments}`;
}
