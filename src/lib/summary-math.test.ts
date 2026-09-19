import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { normalizeSummaryMathDelimiters } from "./summary-math.ts";

function renderSummaryMarkdown(content: string) {
  return renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      { remarkPlugins: [remarkMath], rehypePlugins: [rehypeKatex] },
      normalizeSummaryMathDelimiters(content),
    ),
  );
}

test("renders AI inline \\( ... \\) notation as KaTeX", () => {
  const rendered = renderSummaryMarkdown("The sample size is \\(n\\).");

  assert.match(rendered, /class="katex"/u);
  assert.doesNotMatch(rendered, /\\\(n\\\)/u);
});

test("renders AI display \\[ ... \\] notation as a KaTeX display block", () => {
  const rendered = renderSummaryMarkdown("\\[P(X=k)=\\binom{n}{k}p^k(1-p)^{n-k}\\]");

  assert.match(rendered, /class="katex-display"/u);
  assert.doesNotMatch(rendered, /\\\[P\(X=k\)/u);
});

test("preserves ordinary Markdown rendering without enabling raw HTML", () => {
  const rendered = renderSummaryMarkdown("## Review\n\n**Important** and [source](https://example.com).\n\n<img src=x>");

  assert.match(rendered, /<h2>Review<\/h2>/u);
  assert.match(rendered, /<strong>Important<\/strong>/u);
  assert.match(rendered, /href="https:\/\/example\.com"/u);
  assert.match(rendered, /&lt;img src=x&gt;/u);
});

test("does not normalize LaTeX-looking inline or fenced code", () => {
  const savedSummary = ["Use \`\\(n\\)\` literally.", "", "\`\`\`tex", "\\[P(X=k)\\]", "\`\`\`"].join("\n");
  const normalized = normalizeSummaryMathDelimiters(savedSummary);
  const rendered = renderSummaryMarkdown(savedSummary);

  assert.equal(normalized, savedSummary);
  assert.match(rendered, /<code>\\\(n\\\)<\/code>/u);
  assert.match(rendered, /<code class="language-tex">\\\[P\(X=k\)\\\]\n<\/code>/u);
  assert.doesNotMatch(rendered, /class="katex"/u);
});

test("normalizes existing saved Summary text only at the render boundary", () => {
  const savedSummary = "For \\(\\lambda\\), review \\[P(X=k)\\].";
  const normalized = normalizeSummaryMathDelimiters(savedSummary);

  assert.equal(savedSummary, "For \\(\\lambda\\), review \\[P(X=k)\\].");
  assert.match(normalized, /\$\\lambda\$/u);
  assert.match(normalized, /\$\$\nP\(X=k\)\n\$\$/u);
});
