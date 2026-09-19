import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Upload, FileText, AlertCircle } from "lucide-react";
import { AppCard, AppLabel, GhostButton, PrimaryButton } from "@/components/app/ui";
import { storageService } from "@/services/storageService";
import {
  ExtractionError,
  createTextDocument,
  extractDocument,
  uploadDocument,
} from "@/services/documentService";
import { DocumentSummaryPanel } from "@/components/app/DocumentSummary";
import { useI18n } from "@/lib/i18n";
import { userErrorKey } from "@/lib/user-errors";

export const Route = createFileRoute("/app/material")({
  head: () => ({
    meta: [
      { title: "Add material — Judineik AI Workspace" },
      {
        name: "description",
        content: "Upload a PDF or paste your notes — and your AI builds the session.",
      },
      { property: "og:title", content: "Add material — Judineik AI Workspace" },
      { property: "og:description", content: "Bring your material. We'll build the session." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AddMaterial,
});

const ACCEPTED = [".pdf"];
const MAX_BYTES = 20 * 1024 * 1024;

function formatSize(bytes: number) {
  return bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function AddMaterial() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const rawFileRef = useRef<File | null>(null);
  const [mode, setMode] = useState<"upload" | "notes">("upload");
  const [file, setFile] = useState<{ name: string; size: string; type: string } | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processed, setProcessed] = useState<{ id: string; title: string } | null>(null);

  function validate(f: File) {
    const ext = `.${f.name.split(".").pop()?.toLowerCase() ?? ""}`;
    if (!ACCEPTED.includes(ext)) {
      return t("material.unsupportedFile");
    }
    if (f.size === 0) return t("material.emptyFile");
    if (f.size > MAX_BYTES) return t("material.tooLarge");
    return null;
  }

  function handleFiles(files: FileList | null) {
    setError(null);
    const f = files?.[0];
    if (!f) {
      setError(t("material.noFile"));
      return;
    }
    const problem = validate(f);
    if (problem) {
      setError(problem);
      setFile(null);
      rawFileRef.current = null;
      return;
    }
    rawFileRef.current = f;
    setFile({
      name: f.name.toUpperCase(),
      size: formatSize(f.size),
      type: (f.name.split(".").pop() ?? "file").toUpperCase(),
    });
  }

  async function analyzeFile() {
    const raw = rawFileRef.current;
    if (!file || !raw || uploading) return;
    setError(null);
    setUploading(true);
    try {
      const uploaded = await uploadDocument(raw);
      await extractDocument(uploaded.id);
      setProcessed({ id: uploaded.id, title: uploaded.title });
      storageService.setPendingInput({
        kind: "file",
        name: file.name,
        sizeLabel: file.size,
        fileType: file.type,
        documentId: uploaded.id,
        filePath: uploaded.filePath ?? undefined,
      });
    } catch (err) {
      console.error("Material upload or extraction failed", err);
      setError(t(userErrorKey(err, err instanceof ExtractionError ? "errors.extract" : "errors.upload")));
    } finally {
      setUploading(false);
    }
  }

  async function analyzeNotes() {
    const text = notes.trim();
    if (!text || uploading) return;
    setError(null);
    setUploading(true);
    try {
      const created = await createTextDocument(text, t("material.pastedNotes"));
      storageService.setPendingInput({
        kind: "notes",
        name: created.title,
        documentId: created.id,
      });
      const navigationTarget = {
        to: "/app/processing" as const,
        search: { documentId: created.id },
      };
      navigate(navigationTarget);
    } catch (err) {
      console.error("Saving notes failed", err);
      setError(t(userErrorKey(err, "errors.save")));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mx-auto max-w-[880px] space-y-8">
      <header>
        <AppLabel>{t("material.addLabel")}</AppLabel>
        <h1 className="display-sm mt-4">
          {t("material.title")}
          <br />
          {t("material.subtitle")}
        </h1>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
          {t("material.description")}
        </p>
      </header>

      <AnimatePresence mode="wait">
        {mode === "upload" ? (
          <motion.div
            key="upload"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-5"
          >
            {!file ? (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  handleFiles(e.dataTransfer.files);
                }}
                className={`rounded-2xl border border-dashed p-10 text-center transition-colors md:p-16 ${
                  dragging ? "border-lime bg-surface-2/60" : "border-border bg-surface/40"
                }`}
              >
                <Upload className="mx-auto h-6 w-6 text-lime" aria-hidden />
                <p className="mt-6 text-lg">{t("material.drop")}</p>
                <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                  {t("material.pdfOnly")}
                </p>
                <input
                  ref={inputRef}
                  type="file"
                  accept={ACCEPTED.join(",")}
                  className="sr-only"
                  id="material-file"
                  onChange={(e) => handleFiles(e.target.files)}
                />
                <label
                  htmlFor="material-file"
                  className="mt-8 inline-flex cursor-pointer items-center justify-center rounded-full border border-border px-6 py-3 text-sm transition-colors hover:border-lime/40 hover:bg-surface-2"
                >
                  {t("material.browse")}
                </label>
              </div>
            ) : (
              <AppCard>
                <div className="flex items-start gap-4">
                  <FileText className="mt-1 h-5 w-5 text-lime" aria-hidden />
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm">{file.name}</p>
                    <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                      {file.type} · {file.size}
                    </p>
                    <p className="mt-4 text-sm text-lime">{t("material.ready")}</p>
                  </div>
                </div>
                <div className="mt-8 flex flex-wrap gap-3">
                  <PrimaryButton onClick={analyzeFile} disabled={uploading}>
                    {uploading ? t("material.uploading") : t("material.analyze")} <span aria-hidden>→</span>
                  </PrimaryButton>
                  <GhostButton
                    onClick={() => {
                      rawFileRef.current = null;
                      setFile(null);
                    }}
                  >
                    {t("material.chooseAnother")}
                  </GhostButton>
                </div>
              </AppCard>
            )}

            {processed && (
              <div className="space-y-5">
                <DocumentSummaryPanel documentId={processed.id} documentTitle={processed.title} />
                <PrimaryButton
                  onClick={() =>
                    navigate({
                      to: "/app/questions/$documentId",
                      params: { documentId: processed.id },
                    })
                  }
                >
                  {t("material.continueStudy")} <span aria-hidden>→</span>
                </PrimaryButton>
              </div>
            )}

            {error && (
              <motion.p
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                role="alert"
                className="flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-foreground"
              >
                <AlertCircle className="h-4 w-4 text-destructive" aria-hidden />
                {error}
              </motion.p>
            )}

            <button
              type="button"
              onClick={() => setMode("notes")}
              className="font-mono text-xs text-muted-foreground underline-offset-4 hover:text-lime hover:underline"
            >
              {t("material.pasteInstead")}
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="notes"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-5"
          >
            <AppCard>
              <label htmlFor="notes" className="text-lg">
                {t("material.pasteTitle")}
              </label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={12}
                placeholder={
                  t("material.pastePlaceholder")
                }
                className="mt-5 w-full resize-y rounded-xl border border-border bg-surface-2/60 p-4 text-sm leading-relaxed outline-none placeholder:text-muted-foreground focus:border-lime/40"
              />
              <p className="mt-3 text-right font-mono text-[11px] text-muted-foreground">
                {t("material.characters", { count: notes.length })}
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <PrimaryButton onClick={() => void analyzeNotes()} disabled={notes.trim().length === 0 || uploading}>
                  {uploading ? t("material.saving") : t("material.analyze")} <span aria-hidden>→</span>
                </PrimaryButton>
                <GhostButton onClick={() => setMode("upload")}>{t("material.uploadInstead")}</GhostButton>
              </div>
            </AppCard>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
