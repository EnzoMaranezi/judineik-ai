import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, FileText } from "lucide-react";
import { AppCard, AppLabel, EmptyState, ErrorState, Skeleton } from "@/components/app/ui";
import { QuestionSessionResult } from "@/components/app/QuestionSessionResult";
import { SessionScopeLabel } from "@/components/app/SessionScopeLabel";
import { getStudySession } from "@/lib/progress.functions";
import { relativeDay } from "@/lib/dates";
import { useI18n } from "@/lib/i18n";
import { userErrorKey } from "@/lib/user-errors";

export const Route = createFileRoute("/app/sessions/$sessionId")({
  head: () => ({
    meta: [
      { title: "Session result — Judineik AI Workspace" },
      { name: "description", content: "Review a completed question session answer by answer." },
      { property: "og:title", content: "Session result — Judineik AI Workspace" },
      { property: "og:description", content: "Review your recorded session answers." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SessionDetail,
});

function SessionDetail() {
  const { sessionId } = Route.useParams();
  const { locale, t } = useI18n();
  const fetchSession = useServerFn(getStudySession);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["study-session", sessionId],
    queryFn: () => fetchSession({ data: { sessionId } }),
  });
  useEffect(() => {
    if (error) console.error("Loading session replay failed", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-[900px] space-y-8">
      <Link
        to="/app/sessions"
        className="inline-flex items-center gap-2 font-mono text-xs text-muted-foreground hover:text-lime"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {t("sessions.title")}
      </Link>

      {isLoading ? (
        <AppCard className="space-y-4">
          <Skeleton className="w-1/3" />
          <Skeleton className="w-1/2" />
          <Skeleton className="w-2/3" />
        </AppCard>
      ) : error ? (
        <ErrorState
          body={t(userErrorKey(error, "errors.load"))}
          onRetry={() => void refetch()}
        />
      ) : !data ? (
        <EmptyState
          title={t("sessions.notFoundTitle")}
          body={t("sessions.notFoundBody")}
          actionLabel={t("sessions.back")}
          actionTo="/app/sessions"
        />
      ) : (
        <AppCard>
          <AppLabel>{t("sessions.completed")}</AppLabel>
          <h1 className="mt-4 flex items-center gap-2 text-2xl tracking-tight">
            <FileText className="h-5 w-5 text-muted-foreground" aria-hidden />
            {data.documentTitle ?? t("progress.materialDeleted")}
          </h1>
          <SessionScopeLabel session={data} />
          <p className="mt-3 font-mono text-[11px] text-muted-foreground">
            {relativeDay(data.completedAt, locale)} · {data.totalQuestions} {t("overview.questions")} ·{" "}
            {data.correctAnswers} {t("results.correct").toLowerCase()} · {data.incorrectAnswers}{" "}
            {t("results.incorrect").toLowerCase()}
          </p>

          {data.documentExists ? (
            <div className="mt-6 flex flex-wrap gap-3">
              {data.hasSummary ? (
                <Link
                  to="/app/summary/$documentId"
                  params={{ documentId: data.documentId }}
                  className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 font-mono text-xs text-muted-foreground transition-colors hover:border-lime/40 hover:text-foreground"
                >
                  {t("materials.viewSummary")} <span aria-hidden>→</span>
                </Link>
              ) : null}
              {!data.topicScopeId ? (
                <Link
                  to="/app/questions/$documentId"
                  params={{ documentId: data.documentId }}
                  className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 font-mono text-xs text-muted-foreground transition-colors hover:border-lime/40 hover:text-foreground"
                >
                  {t("results.newSession")} <span aria-hidden>→</span>
                </Link>
              ) : null}
            </div>
          ) : (
            <p className="mt-6 font-mono text-[11px] text-muted-foreground">
              {t("sessions.sourceDeleted")}
            </p>
          )}

          {data.questions.length > 0 ? (
            <QuestionSessionResult
              documentId={data.documentId}
              {...(data.topicId ? { topicId: data.topicId } : {})}
              questions={data.questions}
              answers={data.answers}
              heading={t("results.recorded")}
            />
          ) : (
            <div className="mt-8 border-t border-border pt-8">
              <p className="font-mono text-5xl tracking-tight text-lime">{data.accuracy}%</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {t("results.correctOf", { correct: data.correctAnswers, total: data.totalQuestions })}
              </p>
              <p className="mt-4 text-sm text-muted-foreground">
                {t("sessions.questionsUnavailable")}
              </p>
            </div>
          )}
        </AppCard>
      )}
    </div>
  );
}
