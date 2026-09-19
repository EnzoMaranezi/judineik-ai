import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { normalizeSummaryMathDelimiters } from "./summary-math.ts";

function renderFlashcardContent(content: string) {
  return renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      { remarkPlugins: [remarkMath], rehypePlugins: [rehypeKatex] },
      normalizeSummaryMathDelimiters(content),
    ),
  );
}

test("renders persisted LaTeX on flashcard fronts and backs", () => {
  const front = renderFlashcardContent("Calculate \\(\\frac{10!}{k!(10-k)!}\\).");
  const back = renderFlashcardContent("\\[P(X=k)=\\binom{10}{k}p^k(1-p)^{10-k}\\]");

  assert.match(front, /class="katex"/u);
  assert.match(back, /class="katex-display"/u);
  assert.doesNotMatch(front, /\\\(/u);
  assert.doesNotMatch(back, /\\\[/u);
});

test("preserves Markdown and code literals in existing persisted flashcard text", () => {
  const cardFront = "Use **notation** " + String.fromCharCode(96) + "\\(n\\)" + String.fromCharCode(96) + " literally.";
  const rendered = renderFlashcardContent(cardFront);

  assert.equal(cardFront, "Use **notation** " + String.fromCharCode(96) + "\\(n\\)" + String.fromCharCode(96) + " literally.");
  assert.match(rendered, /<strong>notation<\/strong>/u);
  assert.match(rendered, /<code>\\\(n\\\)<\/code>/u);
  assert.doesNotMatch(rendered, /class="katex"/u);
});

test("Flashcards reuses the shared renderer without changing flip or rating interactions", async () => {
  const source = await readFile(new URL("../components/app/DocumentFlashcards.tsx", import.meta.url), "utf8");

  assert.match(source, /import \{ MarkdownContent \} from "@\/components\/app\/MarkdownContent";/u);
  assert.match(source, /<MarkdownContent inline className="inline-block w-full max-w-2xl text-xl leading-relaxed">\{revealed \? reviewCard\.back : reviewCard\.front\}<\/MarkdownContent>/u);
  assert.match(source, /<MarkdownContent inline className="inline-block w-full max-w-2xl text-xl leading-relaxed">\{revealed \? browseCard\.back : browseCard\.front\}<\/MarkdownContent>/u);
  assert.match(source, /onClick=\{\(\) => setRevealed\(\(value\) => !value\)\}/u);
  assert.match(source, /onClick=\{\(\) => void rate\(rating\)\}/u);
});
