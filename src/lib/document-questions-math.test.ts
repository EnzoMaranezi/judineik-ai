import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { normalizeSummaryMathDelimiters } from "./summary-math.ts";

function renderQuestionContent(content: string) {
  return renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      { remarkPlugins: [remarkMath], rehypePlugins: [rehypeKatex] },
      normalizeSummaryMathDelimiters(content),
    ),
  );
}

test("renders persisted question prompts and answer options with inline KaTeX", () => {
  const prompt = renderQuestionContent("For \\(n = 10\\), what does \\(p\\) represent?");
  const displayPrompt = renderQuestionContent("\\[P(X=k)=\\binom{n}{k}p^k(1-p)^{n-k}\\]");
  const binomialOption = renderQuestionContent("\\(\\binom{10}{k} p^k (1-p)^{10-k}\\)");
  const fractionOption = renderQuestionContent("\\(\\frac{10!}{k!(10-k)!}\\)");

  for (const rendered of [prompt, displayPrompt, binomialOption, fractionOption]) {
    assert.match(rendered, /class="katex"/u);
    assert.doesNotMatch(rendered, /\\\(/u);
  }
  assert.match(displayPrompt, /class="katex-display"/u);
});

test("preserves Markdown and code literals in existing persisted Question strings", () => {
  const savedOption = "Use **formula** " + String.fromCharCode(96) + "\\(n\\)" + String.fromCharCode(96) + " literally.";
  const rendered = renderQuestionContent(savedOption);

  assert.equal(savedOption, "Use **formula** " + String.fromCharCode(96) + "\\(n\\)" + String.fromCharCode(96) + " literally.");
  assert.match(rendered, /<strong>formula<\/strong>/u);
  assert.match(rendered, /<code>\\\(n\\\)<\/code>/u);
  assert.doesNotMatch(rendered, /class="katex"/u);
});

test("Questions uses the shared safe renderer without changing answer selection or scoring", async () => {
  const source = await readFile(new URL("../components/app/DocumentQuestions.tsx", import.meta.url), "utf8");

  assert.match(source, /import \{ MarkdownContent \} from "@\/components\/app\/MarkdownContent";/u);
  assert.match(source, /<MarkdownContent className="text-lg leading-relaxed">\{currentPrompt\}<\/MarkdownContent>/u);
  assert.match(source, /<MarkdownContent inline className="min-w-0 flex-1">\{option\}<\/MarkdownContent>/u);
  assert.match(source, /onClick=\{\(\) => setSelected\(i\)\}/u);
  assert.match(source, /const correct = selected === current\.correctIndex;/u);
});
