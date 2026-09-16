import type { StudySummary } from "./summary.schema";

function cleanMarkdown(value: string) {
  return value
    .replace(/^```(?:markdown|md)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function stripMarkdown(value: string) {
  return value
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

export function normalizeSummaryHeadings(markdown: string) {
  const aliases: Array<[RegExp, string]> = [
    [/^##\s*(?:Key concepts|Conceitos[- ]?chave)\s*$/i, "## Key concepts"],
    [/^##\s*(?:Explanations|Explica(?:ç(?:ão|ões)|c(?:ao|oes)))\s*$/i, "## Explanations"],
    [/^##\s*(?:Definitions|Defini(?:ç(?:ão|ões)|c(?:ao|oes)))\s*$/i, "## Definitions"],
    [/^##\s*(?:Relationships|Relacionamentos)\s*$/i, "## Relationships"],
    [/^##\s*(?:Final review|Revis(?:ão|ao) final)\s*$/i, "## Final review"],
    [/^##\s*(?:Limitations|Limita(?:ç(?:ão|ões)|c(?:ao|oes)))\s*$/i, "## Limitations"],
  ];

  return markdown
    .split(/\r?\n/)
    .map((line) => aliases.find(([pattern]) => pattern.test(line.trim()))?.[1] ?? line)
    .join("\n");
}

function section(markdown: string, heading: string) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex(
    (line) => line.trim().toLowerCase() === `## ${heading.toLowerCase()}`,
  );
  if (start === -1) return "";

  const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line.trim()));
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join("\n")
    .trim();
}

function bulletItems(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").trim())
    .filter(Boolean)
    .map(stripMarkdown);
}

function paragraph(value: string) {
  return stripMarkdown(
    value
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").trim())
      .filter(Boolean)
      .join("\n"),
  );
}

function parseExplanationSection(value: string): StudySummary["explanations"] {
  const lines = value.split(/\r?\n/);
  const items: StudySummary["explanations"] = [];
  let current: { heading: string; body: string[] } | null = null;

  for (const line of lines) {
    const heading = /^###\s+(.+?)\s*$/.exec(line.trim())?.[1];
    if (heading) {
      if (current)
        items.push({ heading: current.heading, body: paragraph(current.body.join("\n")) });
      current = { heading: stripMarkdown(heading), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }

  if (current) items.push({ heading: current.heading, body: paragraph(current.body.join("\n")) });

  if (items.length > 0) {
    return items.filter((item) => item.heading && item.body).slice(0, 8);
  }

  return bulletItems(value)
    .map((item) => {
      const [heading, ...body] = item.split(":");
      return { heading: heading?.trim() ?? "", body: body.join(":").trim() };
    })
    .filter((item) => item.heading && item.body)
    .slice(0, 8);
}

function parseDefinitionSection(value: string): StudySummary["definitions"] {
  return bulletItems(value)
    .map((item) => {
      const [term, ...definition] = item.split(":");
      return { term: term?.trim() ?? "", definition: definition.join(":").trim() };
    })
    .filter((item) => item.term && item.definition)
    .slice(0, 10);
}

export function parseMarkdownSummary(markdown: string, fallbackTitle: string): StudySummary {
  const content = cleanMarkdown(normalizeSummaryHeadings(markdown));
  const title = stripMarkdown(/^#\s+(.+?)\s*$/m.exec(content)?.[1] ?? fallbackTitle);
  const limitations = paragraph(section(content, "Limitations"));

  return {
    title,
    keyConcepts: bulletItems(section(content, "Key concepts")).slice(0, 10),
    explanations: parseExplanationSection(section(content, "Explanations")),
    definitions: parseDefinitionSection(section(content, "Definitions")),
    relationships: bulletItems(section(content, "Relationships")).slice(0, 8),
    review: paragraph(section(content, "Final review")) || paragraph(content),
    limitations: limitations && !/^none$/i.test(limitations) ? limitations : null,
  };
}
