import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, FileText, AlertCircle } from "lucide-react";
import { AppCard, AppLabel, LinkButton, Skeleton } from "@/components/app/ui";
import { DocumentQuestionsPanel } from "@/components/app/DocumentQuestions";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/app/questions/$documentId")({
  head: () => ({
    meta: [
      { title: "Study questions — Judineik AI Workspace" },
      {
        name: "description",
        content: "Practise with multiple-choice questions generated from your uploaded material.",
      },
      { property: "og:title", content: "Study questions — Judineik AI Workspace" },
      {
        property: "og:description",
        content: "Multiple-choice questions generated from your material.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: QuestionsView,
});

function QuestionsView() {
  const { documentId } = Route.useParams();
  const { t } = useI18n();
  const [doc, setDoc] = useState<{ id: string; title: string; hasText: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    supabase
      .from("documents")
      .select("id, title, extracted_text")
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
        setDoc({
          id: data.id,
          title: data.title,
          hasText: (data.extracted_text ?? "").trim().length >= 200,
        });
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
        <AppLabel>{t("questions.panel")}</AppLabel>
        <h1 className="display-sm mt-3 break-words">{t("questions.title")}</h1>
      </div>

      {loading ? (
        <AppCard className="space-y-4">
          <Skeleton className="w-1/3" />
          <Skeleton className="w-2/3" />
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

          {doc.hasText ? (
            <DocumentQuestionsPanel documentId={doc.id} />
          ) : (
            <AppCard className="border-dashed">
              <AppLabel>{t("questions.noText")}</AppLabel>
              <p className="mt-4 text-sm text-muted-foreground">
                {t("questions.noTextBody")}
              </p>
            </AppCard>
          )}
        </div>
      ) : null}
    </div>
  );
}
