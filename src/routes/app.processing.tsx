import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Check, Loader2 } from "lucide-react";
import { AppLabel, ErrorState } from "@/components/app/ui";
import { analyzeMaterial } from "@/services/aiService";
import { storageService, type PendingInput } from "@/services/storageService";
import { loadProcessedDocumentInput } from "@/services/studyAnalysisService";
import { getGsap, prefersReducedMotion } from "@/animations/scroll";
import { useI18n } from "@/lib/i18n";
import { userErrorKey } from "@/lib/user-errors";

export const Route = createFileRoute("/app/processing")({
  validateSearch: (search: Record<string, unknown>) => ({
    documentId: typeof search["documentId"] === "string" ? search["documentId"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Understanding your material — NEXA" },
      { name: "description", content: "Preparing your material for document study." },
      { property: "og:title", content: "Understanding your material — NEXA" },
      { property: "og:description", content: "Preparing your material for document study." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Processing,
});

const STAGES = [
  "processing.stage.preparing",
  "processing.stage.analyzing",
  "processing.stage.finalizing",
] as const;

function Processing() {
  const { documentId } = Route.useSearch();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const graphRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (prefersReducedMotion() || !graphRef.current) return;
    const { gsap } = getGsap();
    const ctx = gsap.context(() => {
      gsap.from("[data-graph-node]", {
        scale: 0,
        opacity: 0,
        duration: 1.2,
        stagger: 0.12,
        ease: "power3.out",
      });
      gsap.from("[data-graph-edge]", {
        opacity: 0,
        duration: 1.6,
        stagger: 0.15,
        ease: "power2.out",
      });
    }, graphRef);
    return () => ctx.revert();
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const pendingInput = storageService.getPendingInput();
        const inputFromDocumentId: PendingInput | null = documentId
          ? { kind: "notes", name: t("material.pastedNotes"), documentId }
          : null;
        const inputContext =
          pendingInput?.documentId === documentId || !documentId ? pendingInput : inputFromDocumentId;
        if (!inputContext) {
          throw new Error("Add a material before studying.");
        }
        const input = inputContext.documentId
          ? await loadProcessedDocumentInput(inputContext.documentId)
          : inputContext;

        setStage(1);
        const analysis = await analyzeMaterial(input);
        if (cancelled) return;

        setStage(2);
        storageService.setAnalysis(analysis);
        storageService.addMaterial({
          id: analysis.id,
          name: analysis.title,
          subject: analysis.subject,
          chapter: analysis.chapter,
          concepts: analysis.concepts.length * 4 + 3,
          lastStudied: t("dates.justNow"),
          progress: 12,
          source: input.kind === "notes" ? "notes" : "upload",
        });
        storageService.clearProgress();

        if (!cancelled) {
          if (input.documentId) navigate({ to: "/app/summary/$documentId", params: { documentId: input.documentId } });
          else navigate({ to: "/app/materials" });
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Processing material failed", error);
          const key = userErrorKey(error);
          setError(t(key === "errors.load" ? "processing.error" : key));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [documentId, navigate, t]);

  if (error) {
    return (
      <div className="mx-auto max-w-lg py-20">
        <ErrorState body={error} onRetry={() => navigate({ to: "/app/material" })} />
      </div>
    );
  }

  return (
    <div className="relative mx-auto flex min-h-[70vh] max-w-[880px] flex-col justify-center">
      <svg
        ref={graphRef}
        viewBox="0 0 600 400"
        className="pointer-events-none absolute inset-0 h-full w-full opacity-25"
        aria-hidden
      >
        {[
          [300, 80, 160, 200],
          [300, 80, 300, 210],
          [300, 80, 450, 200],
          [160, 200, 110, 320],
          [450, 200, 500, 320],
          [300, 210, 340, 330],
        ].map(([x1, y1, x2, y2], i) => (
          <line
            key={i}
            data-graph-edge
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="var(--lime)"
            strokeWidth="0.7"
          />
        ))}
        {[
          [300, 80],
          [160, 200],
          [300, 210],
          [450, 200],
          [110, 320],
          [500, 320],
          [340, 330],
        ].map(([cx, cy], i) => (
          <circle key={i} data-graph-node cx={cx} cy={cy} r="4" fill="var(--lime)" />
        ))}
      </svg>

      <div className="relative">
        <AppLabel>{t("processing.label")}</AppLabel>
        <h1 className="display-sm mt-4">{t("processing.title")}</h1>
        <p className="mt-4 max-w-md text-sm text-muted-foreground">
          {t("processing.description")}
        </p>

        <ul className="mt-12 space-y-4" aria-live="polite">
          {STAGES.map((stageKey) => t(stageKey)).map((s, i) => {
            const state = i < stage ? "done" : i === stage ? "active" : "todo";
            return (
              <motion.li
                key={s}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: state === "todo" ? 0.4 : 1, x: 0 }}
                transition={{ duration: 0.4 }}
                className="flex items-center gap-3 font-mono text-sm"
              >
                {state === "done" ? (
                  <Check className="h-4 w-4 text-lime" aria-hidden />
                ) : state === "active" ? (
                  <Loader2 className="h-4 w-4 animate-spin text-lime" aria-hidden />
                ) : (
                  <span className="h-4 w-4 rounded-full border border-border" aria-hidden />
                )}
                <span className={state === "todo" ? "text-muted-foreground" : ""}>{s}</span>
              </motion.li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
