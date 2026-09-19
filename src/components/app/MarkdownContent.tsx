import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { normalizeSummaryMathDelimiters } from "@/lib/summary-math";

interface Props {
  children: string;
  className?: string;
  inline?: boolean;
}

const inlineComponents: Components = {
  p: ({ children }) => <>{children}</>,
  h1: ({ children }) => <>{children}</>,
  h2: ({ children }) => <>{children}</>,
  h3: ({ children }) => <>{children}</>,
  h4: ({ children }) => <>{children}</>,
  h5: ({ children }) => <>{children}</>,
  h6: ({ children }) => <>{children}</>,
};

/** Renders persisted generated text with safe CommonMark and KaTeX math support. */
export function MarkdownContent({ children, className, inline = false }: Props) {
  const markdown = normalizeSummaryMathDelimiters(children);
  const rendered = (
    <ReactMarkdown
      remarkPlugins={[remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={inline ? inlineComponents : undefined}
    >
      {markdown}
    </ReactMarkdown>
  );
  const containerClass = "markdown-content " + (className ?? "");

  return inline ? <span className={containerClass}>{rendered}</span> : <div className={containerClass}>{rendered}</div>;
}
