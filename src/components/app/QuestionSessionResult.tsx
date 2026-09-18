import { useState } from "react";
import { motion } from "motion/react";
import { Check, X, ChevronDown } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { AppLabel, GhostButton, ProgressBar } from "@/components/app/ui";
import {
  classifyPerformance,
  performanceBandTranslationKeys,
  type SessionAnswer,
  type StudyQuestion,
} from "@/lib/questions.schema";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface Props {
  documentId: string;
  topicId?: string;
  questions: StudyQuestion[];
  answers: SessionAnswer[];
  saving?: boolean;
  saveError?: string | null;
  onNewSession?: () => void;
  onPracticeMistakes?: () => void;
  practising?: boolean;
  heading?: string;
  generationDisabled?: boolean;
}

function getQuestionPrompt(question: StudyQuestion) {
  const legacy = question as StudyQuestion & {
    prompt?: unknown;
    text?: unknown;
    enunciation?: unknown;
    statement?: unknown;
  };
  const value =
    question.question ||
    legacy.prompt ||
    legacy.text ||
    legacy.enunciation ||
    legacy.statement;
  return typeof value === "string" ? value.trim() : "";
}

/** Post-session performance screen: accuracy, classification and per-question review. */
export function QuestionSessionResult({
  documentId,
  questions,
  answers,
  saving = false,
  saveError = null,
  onNewSession,
  onPracticeMistakes,
  practising = false,
  heading,
  generationDisabled = false,
}: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState<number | null>(null);

  const total = questions.length;
  const correct = answers.filter((a) => a.correct).length;
  const incorrect = answers.length - correct;
  const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
  const band = classifyPerformance(accuracy);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="mt-8 space-y-8 border-t border-border pt-8"
    >
      <div>
        <AppLabel>{heading ?? t("results.sessionResult")}</AppLabel>
        <p className="mt-5 font-mono text-5xl tracking-tight text-lime">{accuracy}%</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("results.correctOf", { correct, total })}
        </p>
        <p className="mt-4 text-lg">{t(performanceBandTranslationKeys[band])}</p>
        <ProgressBar value={accuracy} className="mt-6" label={t("results.sessionAccuracy")} />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: t("results.questions"), value: total },
          { label: t("results.correct"), value: correct },
          { label: t("results.incorrect"), value: incorrect },
          { label: t("results.accuracy"), value: `${accuracy}%` },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-surface-2/40 px-4 py-4">
            <p className="label-mono">{s.label}</p>
            <p className="mt-2 font-mono text-2xl">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <AppLabel>{t("results.review")}</AppLabel>
        <ul className="mt-4 space-y-2">
          {questions.map((q, i) => {
            const answer = answers.find((a) => a.questionIndex === i);
            const isOpen = open === i;
            return (
              <li key={i} className="rounded-xl border border-border">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm"
                >
                  {answer?.correct ? (
                    <Check className="size-4 shrink-0 text-lime" aria-hidden />
                  ) : answer ? (
                    <X className="size-4 shrink-0 text-destructive" aria-hidden />
                  ) : (
                    <span className="size-4 shrink-0 text-muted-foreground" aria-hidden>
                      –
                    </span>
                  )}
                  <span className="flex-1">{t("questions.questionCounter", { current: i + 1, total })}</span>
                  <span
                    className={cn(
                      "font-mono text-[11px]",
                      answer?.correct
                        ? "text-lime"
                        : answer
                          ? "text-destructive"
                          : "text-muted-foreground",
                    )}
                  >
                    {answer
                      ? answer.correct
                        ? t("results.correct")
                        : t("results.incorrect")
                      : t("results.notAnswered")}
                  </span>
                  <ChevronDown
                    className={cn("size-4 transition-transform", isOpen && "rotate-180")}
                    aria-hidden
                  />
                </button>

                {isOpen ? (
                  <div className="space-y-4 border-t border-border px-4 py-5 text-sm">
                    <p className="leading-relaxed">{getQuestionPrompt(q)}</p>
                    {answer ? (
                      <>
                        <div>
                          <p className="label-mono">{t("results.yourAnswer")}</p>
                          <p
                            className={cn(
                              "mt-2",
                              answer.correct ? "text-lime" : "text-destructive",
                            )}
                          >
                            {String.fromCharCode(65 + answer.selectedIndex)}.{" "}
                            {q.options[answer.selectedIndex]}
                          </p>
                        </div>
                        <div>
                          <p className="label-mono">{t("results.correctAnswer")}</p>
                          <p className="mt-2 text-lime">
                            {String.fromCharCode(65 + q.correctIndex)}. {q.options[q.correctIndex]}
                          </p>
                        </div>
                        <div>
                          <p className="label-mono">{t("results.explanation")}</p>
                          <p className="mt-2 leading-relaxed text-muted-foreground">
                            {q.explanation}
                          </p>
                        </div>
                      </>
                    ) : (
                      <p className="text-muted-foreground">
                        {t("results.answerToReview")}
                      </p>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      {saving ? (
        <p className="font-mono text-xs text-muted-foreground" aria-live="polite">
          {t("results.saving")}
        </p>
      ) : null}
      {saveError ? (
        <p className="font-mono text-xs text-destructive" role="alert">
          {saveError}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3 border-t border-border pt-6">
          <Link
            to="/app/summary/$documentId"
            params={{ documentId }}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-border px-6 py-3 text-sm transition-colors hover:border-lime/40 hover:bg-surface-2"
          >
            {t("common.reviewMaterial")} <span aria-hidden>→</span>
          </Link>
        {onNewSession ? (
          <GhostButton onClick={onNewSession} disabled={generationDisabled}>
            {t("results.newSession")} <span aria-hidden>→</span>
          </GhostButton>
        ) : null}
        {onPracticeMistakes && incorrect > 0 ? (
          <GhostButton onClick={onPracticeMistakes} disabled={practising || generationDisabled}>
            {practising ? t("results.preparingPractice") : t("results.practiceMistakes")}{" "}
            <span aria-hidden>→</span>
          </GhostButton>
        ) : null}
      </div>
    </motion.div>
  );
}
