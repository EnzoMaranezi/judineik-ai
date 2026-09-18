import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, FileText } from "lucide-react";
import { AppCard, AppLabel, ErrorState, PrimaryButton, Skeleton } from "@/components/app/ui";
import {
  AI_DAILY_LIMIT_REACHED,
  AI_GENERATION_IN_PROGRESS,
  AI_NETWORK_LIMIT_REACHED,
  AI_PROVIDERS_UNAVAILABLE,
} from "@/lib/ai-errors";
import {
  discoverDocumentTopics,
  getDocumentTopics,
  STALE_TOPIC_SOURCE,
  TOPIC_DOCUMENT_NOT_FOUND,
  TOPIC_OUTPUT_INVALID,
  TOPIC_PERSISTENCE_FAILED,
  waitForDocumentTopics,
  type StoredDocumentTopic,
} from "@/lib/document-topics.functions";
import { useI18n } from "@/lib/i18n";
import { AiGenerationProgress } from "@/components/app/AiGenerationProgress";

export const Route = createFileRoute("/app/materials_/$documentId/topics")({
  beforeLoad: () => { throw notFound(); },
  component: DocumentTopicsPage,
});

type TopicsState = {
  document: { id: string; title: string };
  sourceState: "ready" | "unavailable" | "insufficient" | "too_large";
  topics: StoredDocumentTopic[];
};

function localizedError(error: unknown, t: (key: string) => string) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes(TOPIC_DOCUMENT_NOT_FOUND)) return t("topics.documentMissing");
  if (message.includes(STALE_TOPIC_SOURCE)) return t("topics.stale");
  if (message.includes(TOPIC_OUTPUT_INVALID)) return t("topics.invalidOutput");
  if (message.includes(TOPIC_PERSISTENCE_FAILED)) return t("topics.persistenceError");
  if (message.includes(AI_DAILY_LIMIT_REACHED)) return t("ai.limitReached");
  if (message.includes(AI_NETWORK_LIMIT_REACHED)) return t("ai.networkLimitReached");
  if (message.includes(AI_PROVIDERS_UNAVAILABLE)) return t("ai.providersUnavailable");
  if (message.includes(AI_GENERATION_IN_PROGRESS)) return t("topics.inProgress");
  return t("topics.genericError");
}

function DocumentTopicsPage() {
  const { documentId } = Route.useParams();
  const { t } = useI18n();
  const [state, setState] = useState<TopicsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    void getDocumentTopics({ data: { documentId } })
      .then(setState)
      .catch((cause: unknown) => setError(localizedError(cause, t)))
      .finally(() => setLoading(false));
  };

  useEffect(load, [documentId]);

  async function analyze() {
    if (generating) return;
    setGenerating(true);
    setError(null);
    try {
      const result = await discoverDocumentTopics({ data: { documentId } });
      setState({ document: result.document, sourceState: result.sourceState, topics: result.topics });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      if (message.includes(AI_GENERATION_IN_PROGRESS)) {
        setWaiting(true);
        try {
          const result = await waitForDocumentTopics({ data: { documentId } });
          setState({ document: result.document, sourceState: result.sourceState, topics: result.topics });
        } catch (waitCause) {
          setError(localizedError(waitCause, t));
        } finally {
          setWaiting(false);
        }
      } else {
        setError(localizedError(cause, t));
      }
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="mx-auto max-w-[900px] space-y-8">
      <header>
        <Link
          to="/app/materials"
          className="inline-flex items-center gap-2 font-mono text-[11px] text-muted-foreground transition-colors hover:text-lime"
        >
          <ArrowLeft className="size-3" aria-hidden />
          {t("common.backToMaterials")}
        </Link>
        <AppLabel>{t("topics.label")}</AppLabel>
        <h1 className="display-sm mt-3">{t("topics.title")}</h1>
      </header>

      {loading ? (
        <AppCard className="space-y-4">
          <Skeleton className="w-1/3" />
          <Skeleton className="w-2/3" />
          <Skeleton className="w-full" />
        </AppCard>
      ) : error && !state ? (
        <ErrorState body={error} onRetry={load} />
      ) : state ? (
        <>
          <AppCard>
            <FileText className="size-4 text-lime" aria-hidden />
            <AppLabel>{t("summary.source")}</AppLabel>
            <p className="mt-3 text-lg">{state.document.title}</p>
          </AppCard>

          {error ? <ErrorState body={error} /> : null}

          {state.topics.length > 0 ? (
            <section className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <AppLabel>{t("topics.saved")}</AppLabel>
                  <p className="mt-2 text-sm text-muted-foreground">{t("topics.cached")}</p>
                </div>
                <p className="inline-flex items-center gap-2 font-mono text-[11px] text-lime">
                  <CheckCircle2 className="size-3.5" aria-hidden />
                  {t("topics.grounded")}
                </p>
              </div>
              <ol className="space-y-3">
                {state.topics.map((topic) => (
                  <li key={topic.id}>
                    <Link
                      to="/app/materials/$documentId/topics/$topicId"
                      params={{ documentId, topicId: topic.id }}
                      className="group block"
                    >
                      <AppCard className="transition-colors group-hover:border-lime/35 group-hover:bg-surface-2/70">
                        <div className="flex items-start gap-4">
                          <span className="font-mono text-xs text-lime">
                            {String(topic.position).padStart(2, "0")}
                          </span>
                          <div className="min-w-0 flex-1">
                            <h2 className="text-lg">{topic.title}</h2>
                            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                              {topic.description}
                            </p>
                          </div>
                          <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-lime" aria-hidden />
                        </div>
                      </AppCard>
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          ) : state.sourceState === "ready" ? (
            <AppCard className="border-dashed text-center">
              <BookOpen className="mx-auto size-5 text-lime" aria-hidden />
              <AppLabel>{t("topics.notAnalyzed")}</AppLabel>
              <p className="mx-auto mt-4 max-w-md text-sm text-muted-foreground">
                {waiting ? t("topics.waiting") : t("topics.aiCost")}
              </p>
              <PrimaryButton className="mt-6" onClick={() => void analyze()} disabled={generating}>
                {generating ? t("topics.analyzing") : t("topics.analyze")}
                <span aria-hidden>→</span>
              </PrimaryButton>
              {generating ? <AiGenerationProgress type="topics" waiting={waiting} className="text-left" /> : null}
            </AppCard>
          ) : (
            <AppCard className="border-dashed">
              <AppLabel>
                {state.sourceState === "unavailable"
                  ? t("topics.noText")
                  : state.sourceState === "too_large"
                    ? t("topics.tooLarge")
                    : t("topics.insufficient")}
              </AppLabel>
              <p className="mt-4 text-sm text-muted-foreground">
                {state.sourceState === "unavailable"
                  ? t("topics.noTextBody")
                  : state.sourceState === "too_large"
                    ? t("topics.tooLargeBody")
                    : t("topics.insufficientBody")}
              </p>
            </AppCard>
          )}
        </>
      ) : null}
    </div>
  );
}
