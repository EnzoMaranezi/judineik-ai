import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, FileText, AlertCircle } from "lucide-react";
import { AppCard, AppLabel, LinkButton, Skeleton } from "@/components/app/ui";
import { DocumentSummaryPanel } from "@/components/app/DocumentSummary";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/app/summary/$documentId")({
  head: () => ({
    meta: [
      { title: "Summary — Judineik AI Workspace" },
      {
        name: "description",
        content: "Read the AI-generated summary built from your uploaded material.",
      },
      { property: "og:title", content: "Summary — Judineik AI Workspace" },
      {
        property: "og:description",
        content: "Read the AI-generated summary for your material.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SummaryView,
});

type DocMeta = { id: string; title: string };

function SummaryView() {
  const { documentId } = Route.useParams();
  const { t } = useI18n();
  const [doc, setDoc] = useState<DocMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    supabase
      .from("documents")
      .select("id, title")
      .eq("id", documentId)
      .maybeSingle()
      .then(({ data, error: queryError }) => {
        if (cancelled) return;
        setLoading(false);
        if (queryError) {
          setError(queryError.message);
          return;
        }
        // RLS scopes this to the owner; a missing row means deleted or not owned.
        if (!data) {
          setError(t("questions.materialMissing"));
          return;
        }
        setDoc({ id: data.id, title: data.title });
      });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  return (
    <div className="mx-auto max-w-[860px] space-y-8">
      <div>
        <Link
          to="/app/materials"
          className="inline-flex items-center gap-2 font-mono text-[11px] text-muted-foreground transition-colors hover:text-lime"
        >
          <ArrowLeft className="size-3" aria-hidden /> {t("common.backToMaterials")}
        </Link>
        <AppLabel>{t("summary.materialSummary")}</AppLabel>
        <h1 className="display-sm mt-3 break-words">{t("summary.heading")}</h1>
      </div>

      {loading ? (
        <AppCard className="space-y-4">
          <Skeleton className="w-1/3" />
          <Skeleton className="w-2/3" />
          <Skeleton className="w-1/2" />
        </AppCard>
      ) : error ? (
        <AppCard className="border-destructive/30">
          <div className="flex items-start gap-3 text-sm">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
            <div>
              <p>{error}</p>
              <LinkButton to="/app/materials" variant="ghost" className="mt-5">
                <span aria-hidden>←</span> {t("common.backToMaterials")}
              </LinkButton>
            </div>
          </div>
        </AppCard>
      ) : doc ? (
        <div className="space-y-5">
          <AppCard>
            <div className="flex items-start gap-3">
              <FileText className="mt-1 size-4 text-lime" aria-hidden />
              <div className="min-w-0">
                <AppLabel>{t("summary.source")}</AppLabel>
                <p className="mt-3 break-words text-lg" title={doc.title}>
                  {doc.title}
                </p>
              </div>
            </div>
          </AppCard>

          {/* DocumentSummaryPanel fetches the SAVED summary via getDocumentSummary
              (no AI call). It only invokes the existing generate flow when the user
              explicitly clicks "Generate summary". */}
          <DocumentSummaryPanel documentId={doc.id} documentTitle={doc.title} />

          <Link
            to="/app/questions/$documentId"
            params={{ documentId: doc.id }}
            className="inline-flex items-center gap-1 text-sm text-lime transition-opacity hover:opacity-80"
          >
            {t("summary.studyQuestions")} <span aria-hidden>→</span>
          </Link>
        </div>
      ) : null}
    </div>
  );
}
