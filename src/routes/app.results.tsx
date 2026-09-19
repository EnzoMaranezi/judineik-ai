import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AppCard,
  AppLabel,
  EmptyState,
  ErrorState,
  ProgressBar,
  Skeleton,
} from "@/components/app/ui";
import { getProgressOverview } from "@/lib/progress.functions";
import { SessionScopeLabel } from "@/components/app/SessionScopeLabel";
import { relativeDay } from "@/lib/dates";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/app/results")({
  head: () => ({
    meta: [
      { title: "Progress — Judineik AI Workspace" },
      {
        name: "description",
        content: "Real accuracy, questions answered and study activity across your materials.",
      },
      { property: "og:title", content: "Progress — Judineik AI Workspace" },
      { property: "og:description", content: "Your real learning progress in Judineik AI." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Progress,
});

function Progress() {
  const { locale, t } = useI18n();
  const fetchOverview = useServerFn(getProgressOverview);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["progress-overview"],
    queryFn: () => fetchOverview(),
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1100px] space-y-4">
        {[0, 1, 2].map((i) => (
          <AppCard key={i} className="space-y-4">
            <Skeleton className="w-1/3" />
            <Skeleton className="w-1/2" />
          </AppCard>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-[1100px]">
        <ErrorState
          body={t("progress.loadError")}
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  if (!data || data.totalSessions === 0) {
    return (
      <div className="mx-auto max-w-[1100px] space-y-8">
        <header>
          <AppLabel>{t("progress.learning")}</AppLabel>
          <h1 className="display-sm mt-4">{t("progress.title")}</h1>
        </header>
        <EmptyState
          title={t("progress.noTitle")}
          body={t("progress.noBody")}
          actionLabel={t("common.goToMaterials")}
          actionTo="/app/materials"
        />
      </div>
    );
  }

  const stats = [
    { label: t("overview.overallAccuracy"), value: `${data.overallAccuracy}%` },
    { label: t("progress.studySessions"), value: data.totalSessions },
    { label: t("progress.questionsAnswered"), value: data.totalQuestions },
    { label: t("progress.correctAnswers"), value: data.totalCorrect },
    { label: t("overview.materialsStudied"), value: data.materialsStudied },
  ];

  return (
    <div className="mx-auto max-w-[1100px] space-y-8">
      <header>
        <AppLabel>{t("progress.learning")}</AppLabel>
        <h1 className="display-sm mt-4">
          {t("overview.overallAccuracy")} {data.overallAccuracy}%
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {t("progress.correctOutOf", { correct: data.totalCorrect, total: data.totalQuestions })}
        </p>
        <ProgressBar value={data.overallAccuracy} className="mt-6" label={t("overview.overallAccuracy")} />
      </header>

      <section aria-labelledby="stats-heading" className="space-y-4">
        <h2 id="stats-heading" className="label-mono">
          {t("progress.summary")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {stats.map((s) => (
            <div key={s.label} className="rounded-xl border border-border bg-surface-2/40 px-4 py-5">
              <p className="label-mono">{s.label}</p>
              <p className="mt-2 font-mono text-2xl">{s.value}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <AppCard>
          <AppLabel>{t("progress.recentActivity")}</AppLabel>
          <ul className="mt-6 space-y-4">
            {data.recent.map((s) => (
              <li key={s.id}>
                <Link
                  to="/app/sessions/$sessionId"
                  params={{ sessionId: s.id }}
                  className="flex items-center justify-between gap-4 text-sm hover:text-lime"
                >
                  <span className="min-w-0">
                    <span className="block truncate">{s.documentTitle ?? t("progress.materialDeleted")}</span>
                    <SessionScopeLabel session={s} />
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                    {s.accuracy}% · {relativeDay(s.completedAt, locale)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Link
            to="/app/sessions"
            className="mt-7 inline-block font-mono text-xs text-muted-foreground hover:text-lime"
          >
            {t("progress.allSessions")} →
          </Link>
        </AppCard>

        <AppCard>
          <AppLabel>{t("progress.accuracyByMaterial")}</AppLabel>
          <div className="mt-6 space-y-5">
            {data.perMaterial.map((m) => (
              <div key={m.documentId}>
                <div className="mb-2 flex justify-between gap-4 font-mono text-[11px] text-muted-foreground">
                  <span className="truncate">{m.documentTitle ?? t("progress.materialDeleted")}</span>
                  <span className="shrink-0">
                    {t("overview.sessionCount", { count: m.sessions, plural: m.sessions === 1 ? "" : "s" })} · {m.accuracy}%
                  </span>
                </div>
                <ProgressBar
                  value={m.accuracy}
                  label={m.documentTitle ?? t("progress.deletedMaterial")}
                />
              </div>
            ))}
          </div>
        </AppCard>
      </div>
    </div>
  );
}
