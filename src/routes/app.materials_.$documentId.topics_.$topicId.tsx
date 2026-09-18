import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { AppCard, AppLabel, ErrorState, Skeleton } from "@/components/app/ui";
import { DocumentSummaryPanel } from "@/components/app/DocumentSummary";
import { DocumentQuestionsPanel } from "@/components/app/DocumentQuestions";
import { DocumentFlashcardsPanel } from "@/components/app/DocumentFlashcards";
import {
  getDocumentTopic,
  STALE_TOPIC_SOURCE,
  TOPIC_DOCUMENT_NOT_FOUND,
  TOPIC_NOT_FOUND,
  type StoredDocumentTopic,
} from "@/lib/document-topics.functions";
import { useI18n } from "@/lib/i18n";
import { TOPIC_SUMMARY_SOURCE_INVALID, TOPIC_SUMMARY_SOURCE_UNAVAILABLE } from "@/lib/topic-summary-source";

export const Route = createFileRoute("/app/materials_/$documentId/topics_/$topicId")({
  beforeLoad: () => { throw notFound(); },
  component: DocumentTopicDetailPage,
});

function DocumentTopicDetailPage() {
  const { documentId, topicId } = Route.useParams();
  const { t } = useI18n();
  const [state, setState] = useState<{
    document: { id: string; title: string };
    topic: StoredDocumentTopic;
    capabilities: { summary: boolean; questions: boolean; flashcards: boolean };
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getDocumentTopic({ data: { documentId, topicId } })
      .then((result) => {
        if (!cancelled) setState(result);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        const message = cause instanceof Error ? cause.message : "";
        if (message.includes(STALE_TOPIC_SOURCE)) setError(t("topics.stale"));
        else if (message.includes(TOPIC_DOCUMENT_NOT_FOUND)) setError(t("topics.documentMissing"));
        else if (message.includes(TOPIC_NOT_FOUND)) setError(t("topics.topicMissing"));
        else if (message.includes(TOPIC_SUMMARY_SOURCE_INVALID)) setError(t("topics.summarySourceInvalid"));
        else if (message.includes(TOPIC_SUMMARY_SOURCE_UNAVAILABLE)) setError(t("topics.summarySourceUnavailable"));
        else setError(t("topics.genericError"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, topicId]);

  return (
    <div className="mx-auto max-w-[820px] space-y-8">
      <header>
        <Link
          to="/app/materials/$documentId/topics"
          params={{ documentId }}
          className="inline-flex items-center gap-2 font-mono text-[11px] text-muted-foreground transition-colors hover:text-lime"
        >
          <ArrowLeft className="size-3" aria-hidden />
          {t("topics.backToTopics")}
        </Link>
        <AppLabel>{t("topics.detailLabel")}</AppLabel>
      </header>

      {loading ? (
        <AppCard className="space-y-4">
          <Skeleton className="w-1/4" />
          <Skeleton className="w-2/3" />
          <Skeleton className="w-full" />
        </AppCard>
      ) : error ? (
        <ErrorState body={error} />
      ) : state ? (
        <>
          <AppCard>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <AppLabel>{state.document.title}</AppLabel>
              <span className="inline-flex items-center gap-2 font-mono text-[11px] text-lime">
                <CheckCircle2 className="size-3.5" aria-hidden />
                {t("topics.grounded")}
              </span>
            </div>
            <h1 className="display-sm mt-5">{state.topic.title}</h1>
            <p className="mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {state.topic.description}
            </p>
          </AppCard>
          <DocumentSummaryPanel
            documentId={state.document.id}
            documentTitle={state.topic.title}
            topicId={state.topic.id}
          />
          <DocumentQuestionsPanel documentId={state.document.id} topicId={state.topic.id} canGenerate={state.capabilities.questions} />
          <DocumentFlashcardsPanel documentId={state.document.id} topicId={state.topic.id} canGenerate={state.capabilities.flashcards} />
        </>
      ) : null}
    </div>
  );
}
