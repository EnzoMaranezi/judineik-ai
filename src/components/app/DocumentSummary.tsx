import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { AlertCircle, Sparkles } from "lucide-react";
import { AppCard, AppLabel, GhostButton, PrimaryButton } from "@/components/app/ui";
import { generateDocumentSummary, getDocumentSummary } from "@/lib/summaries.functions";
import { useI18n } from "@/lib/i18n";
import { aiErrorMessage } from "@/lib/ai-errors";
import type { StudySummary } from "@/lib/summary.schema";
import { GeneratedContentLanguageState } from "@/components/app/GeneratedContentLanguageState";
import { AiGenerationProgress } from "@/components/app/AiGenerationProgress";
import type { PersistedContentLocale } from "@/lib/i18n";
import { MarkdownContent } from "@/components/app/MarkdownContent";

interface Props {
  documentId: string;
  documentTitle: string;
  topicId?: string;
}

/** "Ready for analysis" card: generates and displays the AI study summary. */
export function DocumentSummaryPanel({ documentId, documentTitle, topicId }: Props) {
  const { locale, t } = useI18n();
  const [summary, setSummary] = useState<StudySummary | null>(null);
  const [currentAvailable, setCurrentAvailable] = useState(false);
  const [alternatives, setAlternatives] = useState<Array<{
    locale: PersistedContentLocale;
    summary: StudySummary;
  }>>([]);
  const [checking, setChecking] = useState(true);
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Loads the SAVED summary (no AI call). Generation is only ever user-triggered,
  // and only offered when this material has no stored summary yet.
  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    setSummary(null);
    setCurrentAvailable(false);
    setAlternatives([]);
    setLookupError(null);
    getDocumentSummary({ data: { documentId, topicId } })
      .then((res) => {
        if (cancelled) return;
        setAlternatives(res.alternatives);
        if (res.current) {
          setSummary(res.current.summary);
          setCurrentAvailable(true);
        }
      })
      .catch((cause: unknown) => {
        console.error("Loading summary failed", cause);
        if (!cancelled) setLookupError(summaryErrorMessage(cause, t, true, Boolean(topicId)));
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, topicId, locale, lookupAttempt]);

  async function generate(regenerate = false) {
    setLoading(true);
    setError(null);
    try {
      const res = await generateDocumentSummary({ data: { documentId, topicId, regenerate } });
      setSummary(res.summary);
      setCurrentAvailable(true);
    } catch (err) {
      console.error("Summary generation failed", err);
      setError(summaryErrorMessage(err, t, false, Boolean(topicId)));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppCard>
      <AppLabel>
        {topicId
          ? summary
            ? t("topics.summarySavedLabel")
            : t("topics.summaryReadyLabel")
          : summary
            ? t("summary.savedLabel")
            : t("summary.readyLabel")}
      </AppLabel>
      <p className="mt-4 truncate font-mono text-sm">{documentTitle}</p>
      <p className="mt-2 text-sm text-muted-foreground">
        {checking
          ? t(topicId ? "topics.summaryChecking" : "summary.checking")
          : summary
            ? t(topicId ? "topics.summarySaved" : "summary.saved")
            : t(topicId ? "topics.summaryReady" : "summary.ready")}
      </p>

      {!checking && !lookupError && (
        <div className="mt-6 flex flex-wrap gap-3">
          {!summary && alternatives.length === 0 ? (
            <PrimaryButton onClick={() => generate(false)} disabled={loading}>
              {loading
                ? t(topicId ? "topics.summaryGenerating" : "summary.generating")
                : t(topicId ? "topics.summaryGenerate" : "summary.generate")}{" "}
              <Sparkles className="h-4 w-4" aria-hidden />
            </PrimaryButton>
          ) : currentAvailable ? (
            <GhostButton
              onClick={() => {
                if (!loading) void generate(true);
              }}
              disabled={loading}
            >
              {loading
                ? t("summary.regenerating")
                : t(topicId ? "topics.summaryRegenerate" : "summary.regenerateShort")}
            </GhostButton>
          ) : null}
        </div>
      )}

      {!checking && lookupError ? (
        <div className="mt-6 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-4">
          <p role="alert" className="text-sm">{lookupError}</p>
          <GhostButton className="mt-4" onClick={() => setLookupAttempt((value) => value + 1)}>
            {t("common.retry")}
          </GhostButton>
        </div>
      ) : null}

      {!checking && !lookupError && !currentAvailable && alternatives.length > 0 ? (
        <GeneratedContentLanguageState
          currentLocale={locale}
          variants={alternatives}
          generating={loading}
          onGenerate={() => void generate(false)}
          onOpen={(variantLocale) => {
            const variant = alternatives.find((item) => item.locale === variantLocale);
            if (variant) setSummary(variant.summary);
          }}
        />
      ) : null}

      {error && (
        <p
          role="alert"
          className="mt-5 flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm"
        >
          <AlertCircle className="h-4 w-4 text-destructive" aria-hidden />
          {error}
        </p>
      )}

      {loading ? <AiGenerationProgress type="summary" /> : null}

      {summary && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mt-8 space-y-8 border-t border-border pt-8"
        >
          <h2 className="text-lg"><MarkdownContent inline>{summary.title}</MarkdownContent></h2>

          {summary.keyConcepts.length > 0 && (
            <section>
              <AppLabel>{t("summary.keyConcepts")}</AppLabel>
              <ul className="mt-3 flex flex-wrap gap-2">
                {summary.keyConcepts.map((c) => (
                  <li
                    key={c}
                    className="rounded-full border border-border px-3 py-1 font-mono text-[11px] text-muted-foreground"
                  >
                    <MarkdownContent inline>{c}</MarkdownContent>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {summary.explanations.length > 0 && (
            <section>
              <AppLabel>{t("summary.explanations")}</AppLabel>
              <div className="mt-3 space-y-4">
                {summary.explanations.map((e) => (
                  <div key={e.heading}>
                    <p className="text-sm text-lime"><MarkdownContent inline>{e.heading}</MarkdownContent></p>
                    <MarkdownContent className="mt-1 text-sm leading-relaxed text-muted-foreground">{e.body}</MarkdownContent>
                  </div>
                ))}
              </div>
            </section>
          )}

          {summary.definitions.length > 0 && (
            <section>
              <AppLabel>{t("summary.definitions")}</AppLabel>
              <dl className="mt-3 space-y-3">
                {summary.definitions.map((d) => (
                  <div key={d.term}>
                    <dt className="font-mono text-xs"><MarkdownContent inline>{d.term}</MarkdownContent></dt>
                    <dd className="mt-1 text-sm leading-relaxed text-muted-foreground"><MarkdownContent inline>{d.definition}</MarkdownContent></dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {summary.relationships.length > 0 && (
            <section>
              <AppLabel>{t("summary.relationships")}</AppLabel>
              <ul className="mt-3 space-y-2 text-sm leading-relaxed text-muted-foreground">
                {summary.relationships.map((r) => (
                  <li key={r}>— <MarkdownContent inline>{r}</MarkdownContent></li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <AppLabel>{t("summary.finalReview")}</AppLabel>
            <MarkdownContent className="mt-3 text-sm leading-relaxed">{summary.review}</MarkdownContent>
          </section>

          {summary.limitations && (
            <p className="font-mono text-[11px] text-muted-foreground">
              {t("summary.limitations")}: <MarkdownContent inline>{summary.limitations}</MarkdownContent>
            </p>
          )}
        </motion.div>
      )}
    </AppCard>
  );
}

function summaryErrorMessage(
  error: unknown,
  t: (key: string) => string,
  loading: boolean,
  topicScoped: boolean,
) {
  const message = error instanceof Error ? error.message : "";
  if (topicScoped) {
    if (message.includes("STALE_TOPIC_SOURCE")) return t("topics.stale");
    if (message.includes("TOPIC_SOURCE_UNAVAILABLE")) return t("topics.summarySourceUnavailable");
    if (message.includes("INVALID_TOPIC_SOURCE_RANGE")) return t("topics.summarySourceInvalid");
    if (message.includes("TOPIC_NOT_FOUND")) return t("topics.topicMissing");
  }
  return aiErrorMessage(
    error,
    t,
    t(
      loading
        ? topicScoped
          ? "topics.summaryLoadError"
          : "summary.loadError"
        : topicScoped
          ? "topics.summaryGenerateError"
          : "summary.errorGenerate",
    ),
  );
}
