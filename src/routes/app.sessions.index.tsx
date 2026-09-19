import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { FileText } from "lucide-react";
import { AppCard, AppLabel, EmptyState, ErrorState, Skeleton } from "@/components/app/ui";
import { listStudySessions } from "@/lib/progress.functions";
import { SessionScopeLabel } from "@/components/app/SessionScopeLabel";
import { relativeDay } from "@/lib/dates";
import { useI18n } from "@/lib/i18n";
import { userErrorKey } from "@/lib/user-errors";

export const Route = createFileRoute("/app/sessions/")({
  head: () => ({
    meta: [
      { title: "Study Sessions — Judineik AI Workspace" },
      {
        name: "description",
        content: "Every question session you completed, with accuracy and material.",
      },
      { property: "og:title", content: "Study Sessions — Judineik AI Workspace" },
      { property: "og:description", content: "Your completed question sessions." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SessionsPage,
});

function SessionsPage() {
  const { locale, t } = useI18n();
  const fetchSessions = useServerFn(listStudySessions);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["study-sessions"],
    queryFn: () => fetchSessions(),
  });
  useEffect(() => {
    if (error) console.error("Loading study sessions failed", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-[1000px] space-y-8">
      <header>
        <AppLabel>{t("sessions.history")}</AppLabel>
        <h1 className="display-sm mt-4">{t("sessions.title")}</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {t("sessions.description")}
        </p>
      </header>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <AppCard key={i} className="space-y-4">
              <Skeleton className="w-1/3" />
              <Skeleton className="w-1/2" />
            </AppCard>
          ))}
        </div>
      ) : error ? (
        <ErrorState
          body={t(userErrorKey(error, "errors.load"))}
          onRetry={() => void refetch()}
        />
      ) : !data || data.length === 0 ? (
        <EmptyState
          title={t("sessions.emptyTitle")}
          body={t("sessions.emptyBody")}
          actionLabel={t("common.goToMaterials")}
          actionTo="/app/materials"
        />
      ) : (
        <ul className="space-y-3">
          {data.map((s) => (
            <li key={s.id}>
              <Link
                to="/app/sessions/$sessionId"
                params={{ sessionId: s.id }}
                className="block rounded-2xl border border-border bg-surface/60 p-5 transition-colors hover:border-lime/40"
              >
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-base">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      {s.documentTitle ?? t("progress.materialDeleted")}
                    </p>
                    <SessionScopeLabel session={s} />
                    <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                      {s.totalQuestions} {t("overview.questions")} · {s.correctAnswers}{" "}
                      {t("results.correct").toLowerCase()} · {s.incorrectAnswers}{" "}
                      {t("results.incorrect").toLowerCase()} · {relativeDay(s.completedAt, locale)}
                    </p>
                  </div>
                  <p className="font-mono text-2xl text-lime">{s.accuracy}%</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
