function normalizeMathInText(text: string) {
  return text
    .replace(/\\\[([\s\S]*?)\\\]/g, (match, expression: string) => {
      const trimmed = expression.trim();
      return trimmed ? `\n$$\n${trimmed}\n$$\n` : match;
    })
    .replace(/\\\(([\s\S]*?)\\\)/g, (match, expression: string) => {
      const trimmed = expression.trim();
      return trimmed ? `$${trimmed}$` : match;
    });
}

function normalizeOutsideInlineCode(text: string) {
  let output = "";
  let cursor = 0;

  while (cursor < text.length) {
    const opening = text.indexOf("`", cursor);
    if (opening === -1) return output + normalizeMathInText(text.slice(cursor));

    output += normalizeMathInText(text.slice(cursor, opening));
    let delimiterEnd = opening;
    while (text[delimiterEnd] === "`") delimiterEnd += 1;
    const delimiter = text.slice(opening, delimiterEnd);
    const closing = text.indexOf(delimiter, delimiterEnd);

    if (closing === -1) return output + text.slice(opening);

    output += text.slice(opening, closing + delimiter.length);
    cursor = closing + delimiter.length;
  }

  return output;
}

function fenceStart(line: string) {
  return /^(?: {0,3})(`{3,}|~{3,})/.exec(line)?.[1] ?? null;
}

function closesFence(line: string, delimiter: string) {
  const marker = delimiter[0]!;
  return new RegExp(`^(?: {0,3})${marker}{${delimiter.length},}[ \\t]*\\r?\\n?$`).test(line);
}

/**
 * Converts AI-produced LaTex delimiters only in prose. Inline and fenced code
 * remain literal so Markdown code examples are never interpreted as math.
 */
export function normalizeSummaryMathDelimiters(markdown: string) {
  let output = "";
  let prose = "";
  let activeFence: string | null = null;
  const lines = markdown.match(/.*(?:\r?\n|$)/g) ?? [];

  const flushProse = () => {
    output += normalizeOutsideInlineCode(prose);
    prose = "";
  };

  for (const line of lines) {
    if (line === "") continue;

    if (activeFence) {
      output += line;
      if (closesFence(line, activeFence)) activeFence = null;
      continue;
    }

    const openingFence = fenceStart(line);
    if (openingFence) {
      flushProse();
      output += line;
      activeFence = openingFence;
      continue;
    }

    prose += line;
  }

  flushProse();
  return output;
}
