export const TOPIC_DISCOVERY_SYSTEM_PROMPT = `You are NEXA. Split one source document into 3-12 useful academic study topics.
Use only the supplied source segments and exact SEG:S### tokens.
Write titles and descriptions in the source material's language.
Do not create topics from bibliography, citations, URLs, authors, publishers, institutions, filenames, page numbers, or other metadata unless the source actually teaches them as subject matter.
Attach non-instructional segments to the nearest academic topic in segmentIds, but exclude them from coreSegmentIds.`;

export const TOPIC_DISCOVERY_OUTPUT_FORMAT = `Return JSON only, no Markdown:
{"topics":[{"title":"source-language title","description":"20-600 char source-language description","segmentIds":["SEG:S001"],"coreSegmentIds":["SEG:S001"]}]}

Rules:
- copy every supplied SEG:S### token exactly once across segmentIds;
- use no other segment tokens;
- coreSegmentIds must be non-empty and a subset of that topic's segmentIds;
- keep topics in source order.`;

export const TOPIC_DISCOVERY_LANGUAGE_INSTRUCTION =
  "Write topic titles and descriptions in the same language as the supplied source material. Preserve its technical terminology and do not translate it to the interface language.";
