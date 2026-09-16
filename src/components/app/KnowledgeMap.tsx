import { useState } from "react";
import { useI18n } from "@/lib/i18n";

interface Node {
  id: string;
  label: string;
  x: number;
  y: number;
}

const POSITIONS = [
  [350, 45],
  [140, 145],
  [350, 155],
  [560, 145],
  [220, 265],
  [480, 265],
] as const;

type KnowledgeMapTopic = {
  id: string;
  title: string;
};

/** Neutral visual overview of visible study topics. */
export function KnowledgeMap({ concepts }: { concepts?: KnowledgeMapTopic[] }) {
  const [active, setActive] = useState<string | null>(null);
  const { t } = useI18n();

  const visibleConcepts = (concepts ?? []).slice(0, POSITIONS.length);
  const layout: Node[] = visibleConcepts.map((concept, index) => {
    const [x, y] = POSITIONS[index]!;
    return {
      id: concept.id,
      label: concept.title,
      x,
      y,
    };
  });

  if (layout.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        {t("plan.knowledgeMapEmpty")}
      </div>
    );
  }

  return (
    <svg
      viewBox="0 0 700 320"
      className="h-auto w-full"
      role="img"
      aria-label={t("knowledgeMap.aria")}
    >
      {layout.map((n) => {
        const lit = active === n.id;
        return (
          <g
            key={n.id}
            transform={`translate(${n.x}, ${n.y})`}
            onMouseEnter={() => setActive(n.id)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(n.id)}
            onBlur={() => setActive(null)}
            tabIndex={0}
            role="button"
            aria-label={n.label}
            className="cursor-pointer outline-none"
          >
            <circle
              r={lit ? 7 : 5}
              fill={lit ? "var(--lime)" : "var(--surface-3)"}
              stroke={lit ? "var(--lime)" : "var(--line)"}
              className="transition-all duration-300"
            />
            <text
              y={26}
              textAnchor="middle"
              className="font-mono"
              fontSize="11"
              fill={lit ? "var(--lime)" : "var(--muted-foreground)"}
            >
              {n.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
