import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { AppCard, AppLabel, EmptyState, LinkButton, ProgressBar } from "@/components/app/ui";
import { KnowledgeMap } from "@/components/app/KnowledgeMap";
import { getDocumentTopics, STALE_TOPIC_SOURCE } from "@/lib/document-topics.functions";
import { getDocumentReinforcementAreas } from "@/lib/questions.functions";
import { useI18n } from "@/lib/i18n";
import {
  buildTopicSessionStructure,
  getKnowledgeMapTopics,
  resolveStaleStudyTopicsState,
  resolveStudyTopicsState,
  type StudyTopicsState,
  type TopicUnavailableReason,
} from "@/lib/study-topics-plan";

export const Route = createFileRoute("/app/plan")({
  validateSearch: (search: Record<string, unknown>) => ({
    documentId: typeof search["documentId"] === "string" ? search["documentId"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Your study plan — NEXA Workspace" },
      { name: "description", content: "An AI-generated session built from your own material." },
      { property: "og:title", content: "Your study plan — NEXA Workspace" },
      { property: "og:description", content: "Session structure, knowledge map and weak areas." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Plan,
});

function Plan() {
  const { documentId } = Route.useSearch();
  const { t } = useI18n();
  const [topicState, setTopicState] = useState<StudyTopicsState | null | undefined>(undefined);
  const [reinforcement, setReinforcement] = useState<{
    completedSessions: number;
    areas: { title: string; misses: number; total: number; reasonCode: "incorrectAnswer" }[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTopicState(undefined);
    setReinforcement(null);

    if (!documentId) {
      setTopicState(null);
      setReinforcement({ completedSessions: 0, areas: [] });
      return;
    }

    getDocumentTopics({ data: { documentId } })
      .then((result) => {
        if (!cancelled) {
          setTopicState(
            resolveStudyTopicsState({
              documentId,
              documentTitle: result.document.title,
              topics: result.topics,
              sourceState: result.sourceState,
            }),
          );
        }
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "";
        setTopicState(message.includes(STALE_TOPIC_SOURCE) ? resolveStaleStudyTopicsState(documentId) : null);
      });

    getDocumentReinforcementAreas({ data: { documentId } })
      .then((result) => {
        if (!cancelled) setReinforcement(result);
      })
      .catch(() => {
        if (!cancelled) setReinforcement({ completedSessions: 0, areas: [] });
      });

    return () => {
      cancelled = true;
    };
  }, [documentId]);

  if (topicState === undefined) return null;
  if (!topicState) {
    return (
      <EmptyState
        title={t("plan.noPlanTitle")}
        body={t("plan.noPlanBody")}
        actionLabel={t("common.addMaterial")}
        actionTo="/app/material"
      />
    );
  }
  if (topicState.status === "unavailable") {
    return <UnavailableTopicsState documentId={topicState.documentId} reason={topicState.reason} />;
  }

  const areas = reinforcement?.areas ?? [];
  const hasCompletedSessions = (reinforcement?.completedSessions ?? 0) > 0;
  const session = buildTopicSessionStructure(topicState.topics, areas, t);
  const mapTopics = getKnowledgeMapTopics(topicState.topics);

  return (
    <div className="mx-auto max-w-[1100px] space-y-8">
      <header>
        <AppLabel>{t("plan.title")}</AppLabel>
        <h1 className="display-sm mt-4">{topicState.documentTitle}</h1>
        <p className="mt-3 text-base text-muted-foreground">{t("topics.saved")}</p>
        <ul className="mt-6 flex flex-wrap gap-x-8 gap-y-2 font-mono text-xs text-muted-foreground">
          <li>{t("plan.conceptsIdentified", { count: topicState.topics.length })}</li>
          <li>{t("plan.areasNeed", { count: areas.length })}</li>
          <li className="text-lime">{t("plan.guidedReady")}</li>
        </ul>
      </header>

      <AppCard>
        <AppLabel>{t("plan.knowledgeMap")}</AppLabel>
        <p className="mt-3 text-sm text-muted-foreground">{t("plan.knowledgeMapDescription")}</p>
        <div className="mt-6 overflow-x-auto">
          <div className="min-w-[560px]">
            <KnowledgeMap concepts={mapTopics} />
          </div>
        </div>
      </AppCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <AppCard>
          <AppLabel>{t("plan.structure")}</AppLabel>
          <ul className="mt-6 divide-y divide-border border-y border-border">
            {session.blocks.map((b, i) => (
              <motion.li
                key={b.index}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.08, duration: 0.5 }}
                className="flex items-center justify-between gap-4 py-4"
              >
                <div className="flex items-baseline gap-4">
                  <span className="font-mono text-[11px] text-lime">{b.index}</span>
                  <div>
                    <p className="text-sm">{b.title}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">{b.detail}</p>
                  </div>
                </div>
              </motion.li>
            ))}
          </ul>
        </AppCard>

        <AppCard>
          <AppLabel>
            {hasCompletedSessions ? t("plan.areasCount", { count: areas.length }) : t("plan.areas")}
          </AppLabel>
          {!hasCompletedSessions ? (
            <div className="mt-6 rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
              {t("plan.firstSessionEmpty")}
            </div>
          ) : areas.length > 0 ? (
            <>
              <ul className="mt-6 space-y-6">
                {areas.map((area, i) => (
                  <li key={area.title}>
                    <div className="flex items-baseline gap-4">
                      <span className="font-mono text-[11px] text-lime">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="text-sm">{area.title}</p>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {t("plan.missedTimes", { count: area.misses, plural: area.misses === 1 ? "" : "s" })}
                          </span>
                        </div>
                        <ProgressBar
                          value={(area.misses / Math.max(1, area.total)) * 100}
                          className="mt-3"
                          label={area.title}
                        />
                        <p className="mt-2 text-xs text-muted-foreground">
                          {t(`plan.reinforcementReason.${area.reasonCode}`)}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              <Link
                to="/app/session"
                search={{ documentId: topicState.documentId }}
                className="mt-8 inline-flex items-center justify-center gap-2 rounded-full border border-border px-6 py-3 text-sm text-foreground transition-all duration-300 hover:-translate-y-0.5 hover:border-lime/40 hover:bg-surface-2"
              >
                {t("plan.focusWeak")} <span aria-hidden>→</span>
              </Link>
            </>
          ) : (
            <div className="mt-6 rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
              {t("plan.noIncorrect")}
            </div>
          )}
        </AppCard>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          to="/app/session"
          search={{ documentId: topicState.documentId }}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-lime px-6 py-3 text-sm font-medium text-background transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[var(--glow-lime)]"
        >
          {t("plan.startSession")} <span aria-hidden>→</span>
        </Link>
        <LinkButton to="/app/materials" variant="ghost">
          {t("common.reviewMaterial")}
        </LinkButton>
      </div>
    </div>
  );
}

function UnavailableTopicsState({
  documentId,
  reason,
}: {
  documentId: string;
  reason: TopicUnavailableReason;
}) {
  const { t } = useI18n();
  const title =
    reason === "stale"
      ? t("topics.stale")
      : reason === "unavailable"
        ? t("topics.noText")
        : reason === "too_large"
          ? t("topics.tooLarge")
          : reason === "insufficient"
            ? t("topics.insufficient")
            : t("topics.notAnalyzed");
  const body =
    reason === "unavailable"
      ? t("topics.noTextBody")
      : reason === "too_large"
        ? t("topics.tooLargeBody")
        : reason === "insufficient"
          ? t("topics.insufficientBody")
          : t("topics.aiCost");

  return (
    <div className="mx-auto max-w-[720px]">
      <AppCard className="flex flex-col items-center gap-4 border-dashed py-14 text-center">
        <AppLabel>{title}</AppLabel>
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground whitespace-pre-line">{body}</p>
        <Link
          to="/app/materials/$documentId/topics"
          params={{ documentId }}
          className="mt-2 inline-flex items-center justify-center gap-2 rounded-full bg-lime px-6 py-3 text-sm font-medium text-background transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[var(--glow-lime)]"
        >
          {t("topics.analyze")} <span aria-hidden>→</span>
        </Link>
      </AppCard>
    </div>
  );
}
