import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Trash2, FileText, AlertCircle, Pencil, Check, X } from "lucide-react";
import { AppCard, AppLabel, EmptyState, LinkButton, Skeleton } from "@/components/app/ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  deleteDocument,
  listDocuments,
  renameDocument,
  type StoredDocument,
} from "@/services/documentService";
import { useI18n } from "@/lib/i18n";
import { formatAbsoluteDate } from "@/lib/dates";
import { userErrorKey } from "@/lib/user-errors";

export const Route = createFileRoute("/app/materials")({
  head: () => ({
    meta: [
      { title: "Materials — Judineik AI Workspace" },
      { name: "description", content: "Every material your study assistant has read and organized." },
      { property: "og:title", content: "Materials — Judineik AI Workspace" },
      { property: "og:description", content: "Your academic material library." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Materials,
});

function Materials() {
  const { locale, t } = useI18n();
  const [documents, setDocuments] = useState<StoredDocument[] | null>(null);
  const [target, setTarget] = useState<StoredDocument | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void listDocuments()
      .then(setDocuments)
      .catch((e: unknown) => {
        setDocuments([]);
        console.error("Loading materials failed", e);
        setError(t(userErrorKey(e, "errors.load")));
      });
  }, []);

  async function confirmDelete() {
    if (!target) return;
    const doc = target;
    setDeletingId(doc.id);
    setError(null);
    setNotice(null);
    try {
      await deleteDocument(doc.id);
      setDocuments((prev) => (prev ?? []).filter((d) => d.id !== doc.id));
      setNotice(t("materials.deleted", { title: doc.title }));
      setTarget(null);
    } catch (e) {
      console.error("Deleting material failed", e);
      setError(t(userErrorKey(e, "errors.delete")));
      setTarget(null);
    } finally {
      setDeletingId(null);
    }
  }

  async function saveRename(doc: StoredDocument) {
    if (renamingId) return;
    setError(null);
    setNotice(null);
    setRenamingId(doc.id);
    try {
      const renamed = await renameDocument(doc.id, renameDraft);
      setDocuments((prev) => (prev ?? []).map((item) => (item.id === renamed.id ? renamed : item)));
      setEditingId(null);
      setRenameDraft("");
      setNotice(t("materials.renamed", { title: renamed.title }));
    } catch (e) {
      console.error("Renaming material failed", e);
      setError(t(userErrorKey(e, "errors.save")));
    } finally {
      setRenamingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <AppLabel>{t("materials.label")}</AppLabel>
          <h1 className="display-sm mt-3">{t("materials.title")}</h1>
        </div>
        <LinkButton to="/app/material">+ {t("common.addMaterial")}</LinkButton>
      </header>

      {error ? (
        <div className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{error}</p>
        </div>
      ) : null}
      {notice ? (
        <p className="font-mono text-[11px] text-muted-foreground" role="status">
          {notice}
        </p>
      ) : null}

      <section className="space-y-4">
        <AppLabel>{t("materials.uploaded")}</AppLabel>
        {documents === null ? (
          <div className="space-y-4">
            {[0, 1].map((i) => (
              <AppCard key={i} className="space-y-4">
                <Skeleton className="w-1/4" />
                <Skeleton className="w-2/3" />
              </AppCard>
            ))}
          </div>
        ) : documents.length === 0 ? (
          <EmptyState
            title={t("materials.noneTitle")}
            body={t("materials.noneBody")}
            actionLabel={t("common.addMaterial")}
            actionTo="/app/material"
          />
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {documents.map((doc) => (
              <li key={doc.id}>
                <AppCard className="h-full">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <FileText className="size-4 text-lime" aria-hidden />
                      {editingId === doc.id ? (
                        <div className="mt-3 flex items-center gap-2">
                          <input
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            className="min-w-0 flex-1 rounded-xl border border-border bg-surface-2/60 px-3 py-2 text-sm outline-none focus:border-lime/40"
                            aria-label={t("materials.renameAria", { title: doc.title })}
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => {
                              void saveRename(doc);
                            }}
                            disabled={renamingId === doc.id}
                            aria-label={t("materials.saveRenameAria")}
                            className="rounded-full border border-border p-2 text-muted-foreground transition-colors hover:border-lime/40 hover:text-lime disabled:opacity-50"
                          >
                            <Check className="size-4" aria-hidden />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(null);
                              setRenameDraft("");
                            }}
                            disabled={renamingId === doc.id}
                            aria-label={t("materials.cancelRenameAria")}
                            className="rounded-full border border-border p-2 text-muted-foreground transition-colors hover:border-lime/40 hover:text-foreground disabled:opacity-50"
                          >
                            <X className="size-4" aria-hidden />
                          </button>
                        </div>
                      ) : (
                        <div className="mt-3 flex items-start gap-2">
                          <p className="min-w-0 break-words text-lg" title={doc.title}>
                            {doc.title}
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(doc.id);
                              setRenameDraft(doc.title);
                              setError(null);
                              setNotice(null);
                            }}
                            aria-label={t("materials.renameAria", { title: doc.title })}
                            className="mt-1 shrink-0 rounded-full border border-border p-1.5 text-muted-foreground transition-colors hover:border-lime/40 hover:text-lime"
                          >
                            <Pencil className="size-3.5" aria-hidden />
                          </button>
                        </div>
                      )}
                      <p className="mt-3 font-mono text-[11px] text-muted-foreground">
                        {formatAbsoluteDate(doc.createdAt, locale)} · {doc.status}
                        {doc.hasSummary ? ` · ${t("materials.summaryReady")}` : ""}
                      </p>
                      <div className="mt-4 flex flex-wrap items-center gap-4">
                        <Link
                          to="/app/summary/$documentId"
                          params={{ documentId: doc.id }}
                          className="inline-flex items-center gap-1 text-sm text-lime transition-opacity hover:opacity-80"
                        >
                          {doc.hasSummary ? t("materials.viewSummary") : t("materials.generateSummary")}{" "}
                          <span aria-hidden>→</span>
                        </Link>
                        <Link
                          to="/app/questions/$documentId"
                          params={{ documentId: doc.id }}
                          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-lime"
                        >
                          {t("materials.studyQuestions")} <span aria-hidden>→</span>
                        </Link>
                        <Link to="/app/flashcards/$documentId" params={{ documentId: doc.id }} className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-lime">
                          {t("materials.flashcards")} <span aria-hidden>→</span>
                        </Link>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setTarget(doc)}
                      disabled={deletingId === doc.id}
                      aria-label={t("materials.deleteAria", { title: doc.title })}
                      className="shrink-0 rounded-full border border-border p-2 text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive disabled:opacity-50"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>
                  {deletingId === doc.id ? (
                    <p className="mt-4 font-mono text-[11px] text-muted-foreground">{t("materials.deleting")}</p>
                  ) : null}
                </AppCard>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AlertDialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("materials.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("materials.deleteDescription", { title: target?.title ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingId !== null}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              disabled={deletingId !== null}
            >
              {deletingId ? t("materials.deleting") : t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
