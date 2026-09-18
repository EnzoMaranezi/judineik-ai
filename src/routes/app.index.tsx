import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Sparkles, ListChecks, Brain, FileText, RotateCcw } from "lucide-react";
import {
  AppCard,
  AppLabel,
  EmptyState,
  ErrorState,
  LinkButton,
  ProgressBar,
  Skeleton,
  StatCard,
} from "@/components/app/ui";
import { getProgressOverview, type ProgressOverview } from "@/lib/progress.functions";
import { runOverviewLoad, type OverviewLoadState } from "@/lib/overview-load-state";
import { getFlashcardReviewOverview } from "@/lib/flashcards.overview.functions";
import type { FlashcardReviewOverview } from "@/lib/flashcards.overview";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { formatAbsoluteDate } from "@/lib/dates";
import { listDocuments, type StoredDocument } from "@/services/documentService";

export const Route = createFileRoute("/app/")({
  head: () => ({
    meta: [
      { title: "Overview — NEXA Workspace" },
      { name: "description", content: "Today's study, AI recommendations and knowledge overview." },
      { property: "og:title", content: "Overview — NEXA Workspace" },
      { property: "og:description", content: "Today's study and knowledge overview." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Dashboard,
});

/** Deterministic recommendation derived only from stored sessions/materials. */
function buildRecommendation(
  overview: ProgressOverview | null,
  documents: StoredDocument[] | null,
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
): { text: string; detail: string; documentId?: string | undefined } | null {
  if (!overview || !documents) return null;

  if (documents.length === 0) {
    return {
      text: t("overview.recommendFirstText"),
      detail: t("overview.recommendFirstDetail"),
    };
  }

  const weakest = [...overview.perMaterial].sort((a, b) => a.accuracy - b.accuracy)[0];
  if (weakest && weakest.accuracy < 90) {
    return {
      text: t("overview.recommendWeakText", {
        title: weakest.documentTitle ?? t("overview.yourMaterial"),
        accuracy: weakest.accuracy,
      }),
      detail: t("overview.recommendWeakDetail", {
        correct: weakest.totalCorrect,
        total: weakest.totalQuestions,
      }),
      documentId: weakest.documentId,
    };
  }

  const unstudied = documents.find((d) => !overview.perMaterial.some((m) => m.documentId === d.id));
  if (unstudied) {
    return {
      text: t("overview.recommendUntestedText", { title: unstudied.title }),
      detail: t("overview.recommendUntestedDetail"),
      documentId: unstudied.id,
    };
  }

  if (overview.totalSessions === 0) {
    return {
      text: t("overview.recommendNoSessionsText"),
      detail: t("overview.recommendNoSessionsDetail"),
    };
  }

  return {
    text: t("overview.recommendAccuracyText", { accuracy: overview.overallAccuracy }),
    detail: t("overview.recommendAccuracyDetail"),
    documentId: overview.perMaterial[0]?.documentId,
  };
}

function Dashboard() {
  const { locale, t } = useI18n();
  const [documents, setDocuments] = useState<StoredDocument[] | null>(null);
  const [overviewLoadState, setOverviewLoadState] = useState<OverviewLoadState<ProgressOverview>>({
    status: "loading",
    data: null,
  });
  const overviewRequestInFlight = useRef(false);
  const [flashcardOverview, setFlashcardOverview] = useState<FlashcardReviewOverview | null>(null);
  const [flashcardOverviewLoaded, setFlashcardOverviewLoaded] = useState(false);

  function loadOverview() {
    void runOverviewLoad({
      request: () => getProgressOverview(),
      setState: setOverviewLoadState,
      inFlight: overviewRequestInFlight,
      onFailure: (error) => console.error("[Overview] Failed to load progress overview.", error),
    });
  }

  useEffect(() => {
    void listDocuments()
      .then(setDocuments)
      .catch(() => setDocuments([]));
    loadOverview();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setFlashcardOverview(null);
    setFlashcardOverviewLoaded(false);

    void getFlashcardReviewOverview()
      .then((result) => {
        if (!cancelled) setFlashcardOverview(result);
      })
      .catch(() => {
        if (!cancelled) setFlashcardOverview(null);
      })
      .finally(() => {
        if (!cancelled) setFlashcardOverviewLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [locale]);

  const overview = overviewLoadState.status === "success" ? overviewLoadState.data : null;
  const overviewFailed = overviewLoadState.status === "error";
  const activeSession = overview?.activeSession?.topicScopeId ? null : overview?.activeSession ?? null;
  const lastSession = overview?.recent[0] ?? null;
  const todaySession = activeSession ?? lastSession;
  const recommendation = buildRecommendation(overview, documents, t);
  const documentReviews = flashcardOverview?.dueByScope.filter((scope) => scope.topicId === null) ?? [];
  const documentReviewsDue = documentReviews.reduce((total, scope) => total + scope.dueCount, 0);

  return (
    <div className="mx-auto max-w-[1200px] space-y-8">
      <header>
        <h1 className="display-sm">{t("overview.greeting")}</h1>
        <p className="mt-4 text-sm text-muted-foreground">{t("overview.ready")}</p>
      </header>

      {overviewFailed ? (
        <ErrorState body={t("overview.loadError")} onRetry={loadOverview} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <AppCard className="lg:col-span-2">
            <AppLabel>{t("overview.todaysStudy")}</AppLabel>

            {todaySession ? (
              <>
                <p className="mt-5 font-mono text-xs text-muted-foreground">
                  {todaySession.completedAt
                    ? formatAbsoluteDate(todaySession.completedAt, locale)
                    : t("overview.inProgress")}
                </p>
                <h2 className="mt-2 break-words text-2xl tracking-tight md:text-3xl">
                  {todaySession.documentTitle ?? t("overview.yourMaterial")}
                </h2>
                <ul className="mt-7 flex flex-wrap gap-x-8 gap-y-3 font-mono text-xs text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <ListChecks className="h-3.5 w-3.5" aria-hidden /> {todaySession.totalQuestions}{" "}
                    {t("overview.questions")}
                  </li>
                  <li className="flex items-center gap-2">
                    <Brain className="h-3.5 w-3.5" aria-hidden /> {todaySession.accuracy}%{" "}
                    {t("overview.accuracy")}
                  </li>
                  <li className="flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5" aria-hidden />{" "}
                    {activeSession ? todaySession.correctAnswers : todaySession.incorrectAnswers}{" "}
                    {activeSession ? t("overview.answered") : t("overview.toReview")}
                  </li>
                </ul>
                {activeSession ? (
                  <Link
                    to="/app/questions/$documentId"
                    params={{ documentId: todaySession.documentId }}
                    className="mt-8 inline-flex items-center gap-2 rounded-full bg-lime px-5 py-2.5 text-sm text-background transition-opacity hover:opacity-90"
                  >
                    {t("overview.continueSession")} <span aria-hidden>→</span>
                  </Link>
                ) : (
                  <Link
                    to="/app/sessions/$sessionId"
                    params={{ sessionId: todaySession.id }}
                    className="mt-8 inline-flex items-center gap-2 rounded-full bg-lime px-5 py-2.5 text-sm text-background transition-opacity hover:opacity-90"
                  >
                    {t("overview.viewLastSession")} <span aria-hidden>→</span>
                  </Link>
                )}
              </>
            ) : documents && documents.length > 0 ? (
              <>
                <p className="mt-5 font-mono text-xs text-muted-foreground">
                  {t("overview.noSessions")}
                </p>
                <h2 className="mt-2 break-words text-2xl tracking-tight md:text-3xl">
                  {documents[0]?.title}
                </h2>
                <p className="mt-4 text-sm text-muted-foreground">{t("overview.startFirst")}</p>
                <Link
                  to="/app/questions/$documentId"
                  params={{ documentId: documents[0]!.id }}
                  className="mt-8 inline-flex items-center gap-2 rounded-full bg-lime px-5 py-2.5 text-sm text-background transition-opacity hover:opacity-90"
                >
                  {t("overview.startStudying")} <span aria-hidden>→</span>
                </Link>
              </>
            ) : (
              <>
                <p className="mt-5 text-sm text-muted-foreground">{t("overview.nothing")}</p>
                <LinkButton to="/app/material" className="mt-8">
                  {t("common.addMaterial")} <span aria-hidden>→</span>
                </LinkButton>
              </>
            )}
          </AppCard>

          <AppCard className="border-lime/20">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-lime" aria-hidden />
              <AppLabel>{t("overview.aiRecommendation")}</AppLabel>
            </div>

            {recommendation === null ? (
              <div className="mt-5 space-y-4">
                <Skeleton className="w-3/4" />
                <Skeleton className="w-1/2" />
              </div>
            ) : (
              <>
                <p className="mt-5 break-words text-lg leading-snug">{recommendation.text}</p>
                <p className="mt-4 text-sm text-muted-foreground">{recommendation.detail}</p>
                {recommendation.documentId ? (
                  <Link
                    to="/app/questions/$documentId"
                    params={{ documentId: recommendation.documentId }}
                    className="mt-8 inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm transition-colors hover:border-lime hover:text-lime"
                  >
                    {t("overview.reviewNow")} <span aria-hidden>→</span>
                  </Link>
                ) : (
                  <LinkButton to="/app/materials" variant="ghost" className="mt-8">
                    {t("overview.openMaterials")} <span aria-hidden>→</span>
                  </LinkButton>
                )}
              </>
            )}
          </AppCard>
        </div>
      )}

      <section aria-labelledby="flashcard-review-heading">
        <AppCard className="border-lime/20">
          <div className="flex items-center gap-2">
            <RotateCcw className="h-3.5 w-3.5 text-lime" aria-hidden />
            <p id="flashcard-review-heading" className="label-mono">
              {t("overview.flashcardsLabel")}
            </p>
          </div>

          {!flashcardOverviewLoaded ? (
            <div className="mt-5 space-y-4">
              <Skeleton className="w-1/3" />
              <Skeleton className="w-1/2" />
            </div>
          ) : flashcardOverview === null ? (
            <p className="mt-5 text-sm text-muted-foreground">
              {t("overview.flashcardsUnavailable")}
            </p>
          ) : documentReviewsDue > 0 ? (
            (() => {
              const primary = documentReviews[0]!;
              return (
                <div className="mt-5 flex flex-col justify-between gap-6 md:flex-row md:items-end">
                  <div>
                    <h2 className="text-2xl tracking-tight md:text-3xl">
                      {t(
                        documentReviewsDue === 1
                          ? "overview.flashcardDueCount"
                          : "overview.flashcardsDueCount",
                        { count: documentReviewsDue },
                      )}
                    </h2>
                    <p className="mt-3 text-sm text-muted-foreground">
                      {t(
                        "overview.flashcardsDueMaterial",
                        { title: primary.documentTitle },
                      )}
                    </p>
                  </div>
                    <Link
                      to="/app/flashcards/$documentId"
                      params={{ documentId: primary.documentId }}
                      className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-lime px-6 py-3 text-sm font-medium text-background transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[var(--glow-lime)]"
                    >
                      {t("overview.reviewFlashcardsNow")} <span aria-hidden>→</span>
                    </Link>
                </div>
              );
            })()
          ) : (
            <div className="mt-5 flex flex-col justify-between gap-6 md:flex-row md:items-end">
              <div>
                <h2 className="text-2xl tracking-tight md:text-3xl">
                  {t("overview.flashcardsNoDocumentReviews")}
                </h2>
                <p className="mt-3 text-sm text-muted-foreground">
                  {t("overview.flashcardsOpenMaterial")}
                </p>
              </div>
              <LinkButton to="/app/materials" variant="ghost" className="shrink-0">
                {t("overview.openMaterials")} <span aria-hidden>→</span>
              </LinkButton>
            </div>
          )}
        </AppCard>
      </section>

      {!overviewFailed && (
        <section aria-labelledby="overview-heading" className="space-y-4">
          <h2 id="overview-heading" className="label-mono">
            {t("overview.knowledge")}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {overview === null ? (
              [0, 1, 2].map((i) => (
                <AppCard key={i} className="space-y-4">
                  <Skeleton className="w-1/2" />
                  <Skeleton className="w-1/3" />
                </AppCard>
              ))
            ) : (
              <>
                <StatCard label={t("overview.overallAccuracy")} value={overview.overallAccuracy} />
                <StatCard
                  label={t("overview.materialsStudied")}
                  value={
                    overview.materialsTotal > 0
                      ? Math.round((overview.materialsStudied / overview.materialsTotal) * 100)
                      : 0
                  }
                />
                <AppCard>
                  <AppLabel>{t("overview.sessionsCompleted")}</AppLabel>
                  <p className="mt-4 font-mono text-4xl tracking-tight">{overview.totalSessions}</p>
                  <p className="mt-5 font-mono text-[11px] text-muted-foreground">
                    {t("overview.questionsCorrect", {
                      correct: overview.totalCorrect,
                      total: overview.totalQuestions,
                    })}
                  </p>
                </AppCard>
              </>
            )}
          </div>
        </section>
      )}

      <section aria-labelledby="recent-heading" className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 id="recent-heading" className="label-mono">
            {t("overview.recent")}
          </h2>
          <Link
            to="/app/materials"
            className="font-mono text-xs text-muted-foreground hover:text-lime"
          >
            {t("common.viewAll")} →
          </Link>
        </div>

        {documents === null ? (
          <div className="grid gap-4 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <AppCard key={i} className="space-y-4">
                <Skeleton className="w-1/2" />
                <Skeleton className="w-3/4" />
                <Skeleton className="w-1/3" />
              </AppCard>
            ))}
          </div>
        ) : documents.length === 0 ? (
          <EmptyState
            title={t("overview.emptyTitle")}
            body={t("overview.emptyBody")}
            actionLabel={t("common.addMaterial")}
            actionTo="/app/material"
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {documents.slice(0, 3).map((doc) => {
              const perf = overview?.perMaterial.find((m) => m.documentId === doc.id);
              return (
                <AppCard key={doc.id}>
                  <AppLabel>{formatAbsoluteDate(doc.createdAt, locale)}</AppLabel>
                  <p className="mt-3 break-words text-base" title={doc.title}>
                    {doc.title}
                  </p>
                  <p className="mt-6 font-mono text-[11px] text-muted-foreground">
                    {doc.hasSummary ? t("materials.summaryReady") : t("overview.noSummary")}
                    {perf
                      ? ` · ${t("overview.sessionCount", {
                          count: perf.sessions,
                          plural: perf.sessions === 1 ? "" : "s",
                        })}`
                      : ""}
                  </p>
                  <ProgressBar
                    value={perf?.accuracy ?? 0}
                    className="mt-3"
                    label={`${doc.title} ${t("overview.accuracy")}`}
                  />
                </AppCard>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
