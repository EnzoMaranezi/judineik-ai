import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { AlertCircle, Check, X, Sparkles } from "lucide-react";
import { AppCard, AppLabel, GhostButton, PrimaryButton, Skeleton } from "@/components/app/ui";
import {
  getActiveQuestionSession,
  generateDocumentQuestions,
  generatePracticeQuestions,
  getDocumentQuestions,
  getLatestQuestionSession,
  saveQuestionSession,
  saveQuestionSessionDraft,
} from "@/lib/questions.functions";
import type { SessionAnswer, StudyQuestion } from "@/lib/questions.schema";
import { QuestionSessionResult } from "@/components/app/QuestionSessionResult";
import { useI18n } from "@/lib/i18n";
import { aiErrorMessage } from "@/lib/ai-errors";
import { userErrorKey } from "@/lib/user-errors";
import { cn } from "@/lib/utils";
import { GeneratedContentLanguageState } from "@/components/app/GeneratedContentLanguageState";
import { AiGenerationProgress } from "@/components/app/AiGenerationProgress";
import type { PersistedContentLocale } from "@/lib/i18n";
import { MarkdownContent } from "@/components/app/MarkdownContent";

interface Props {
  documentId: string;
  topicId?: string;
  canGenerate?: boolean;
}

type AnswerState = { selected: number; correct: boolean };
type RestorableSession = {
  id: string;
  questionSetId: string;
  locale: PersistedContentLocale;
  questions: StudyQuestion[];
  startedAt: string;
  answers: SessionAnswer[];
};

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

/** Generates, stores and plays a 5-question multiple-choice set for one material. */
export function DocumentQuestionsPanel({ documentId, topicId, canGenerate = true }: Props) {
  const { locale, t } = useI18n();
  const [questions, setQuestions] = useState<StudyQuestion[] | null>(null);
  const [questionSetId, setQuestionSetId] = useState<string | null>(null);
  const [currentAvailable, setCurrentAvailable] = useState(false);
  const [alternatives, setAlternatives] = useState<Array<{
    id: string;
    locale: PersistedContentLocale;
    questions: StudyQuestion[];
  }>>([]);
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<number, AnswerState>>({});
  const [sessionAnswers, setSessionAnswers] = useState<SessionAnswer[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [restorableSession, setRestorableSession] = useState<RestorableSession | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [practising, setPractising] = useState(false);
  const [savedResult, setSavedResult] = useState<{
    answers: SessionAnswer[];
    accuracy: number;
  } | null>(null);
  const startedAtRef = useRef<string>(new Date().toISOString());
  const persistedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingExisting(true);
    setQuestions(null);
    setQuestionSetId(null);
    setCurrentAvailable(false);
    setAlternatives([]);
    setAnswers({});
    setSessionAnswers([]);
    setSavedResult(null);
    setActiveSessionId(null);
    setRestorableSession(null);
    setSelected(null);
    setIndex(0);
    setError(null);
    persistedRef.current = false;
    startedAtRef.current = new Date().toISOString();
    Promise.all([
      getActiveQuestionSession({ data: { documentId, topicId } }).catch(() => null),
      getDocumentQuestions({ data: { documentId, topicId } }),
      getLatestQuestionSession({ data: { documentId, topicId } }).catch(() => null),
    ])
      .then(([active, res, session]) => {
        if (cancelled) return;
        setAlternatives(res?.alternatives ?? []);
        let loadedQuestionSetId: string | null = null;
        setRestorableSession(active);
        if (active?.locale === locale) {
          const restoredAnswers: Record<number, AnswerState> = {};
          for (const answer of active.answers) {
            restoredAnswers[answer.questionIndex] = {
              selected: answer.selectedIndex,
              correct: answer.correct,
            };
          }
          setQuestions(active.questions);
          setQuestionSetId(active.questionSetId);
          loadedQuestionSetId = active.questionSetId;
          setCurrentAvailable(true);
          setActiveSessionId(active.id);
          setSessionAnswers(active.answers);
          setAnswers(restoredAnswers);
          setIndex(Math.min(active.answers.length, active.questions.length - 1));
          startedAtRef.current = active.startedAt;
        } else if (res?.current) {
          setQuestions(res.current.questions);
          setQuestionSetId(res.current.id);
          loadedQuestionSetId = res.current.id;
          setCurrentAvailable(true);
        }
        if (session && session.questionSetId === loadedQuestionSetId) {
          setSavedResult({ answers: session.answers, accuracy: session.accuracy });
        }
      })
      .catch((cause: unknown) => {
        console.error("Loading questions failed", cause);
        if (!cancelled) setError(questionErrorMessage(cause, t, Boolean(topicId), false, true));
      })
      .finally(() => {
        if (!cancelled) setLoadingExisting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, topicId, locale]);

  async function generate(regenerate = false) {
    if (!canGenerate) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await generateDocumentQuestions({ data: { documentId, topicId, regenerate } });
      setQuestions(res.questions);
      setQuestionSetId(res.id);
      setCurrentAvailable(true);
      setAnswers({});
      setSessionAnswers([]);
      setSavedResult(null);
      setSaveError(null);
      setActiveSessionId(null);
      persistedRef.current = false;
      startedAtRef.current = new Date().toISOString();
      setSelected(null);
      setIndex(0);
    } catch (err) {
      console.error("Question generation failed", err);
      setError(questionErrorMessage(err, t, Boolean(topicId), false));
    } finally {
      setGenerating(false);
    }
  }

  async function practiceMistakes(wrong: SessionAnswer[]) {
    if (!canGenerate || !questionSetId || wrong.length === 0) return;
    setPractising(true);
    setError(null);
    try {
      const res = await generatePracticeQuestions({
        data: {
          documentId,
          questionSetId,
          wrongIndexes: wrong.slice(0, 5).map((a) => a.questionIndex),
        },
      });
      setQuestions(res.questions);
      setQuestionSetId(res.id);
      setAnswers({});
      setSessionAnswers([]);
      setSavedResult(null);
      setSaveError(null);
      setActiveSessionId(null);
      persistedRef.current = false;
      startedAtRef.current = new Date().toISOString();
      setSelected(null);
      setIndex(0);
    } catch (err) {
      console.error("Practice generation failed", err);
      setError(questionErrorMessage(err, t, Boolean(topicId), true));
    } finally {
      setPractising(false);
    }
  }

  const current = questions?.[index];
  const currentPrompt = current ? getQuestionPrompt(current) : "";
  const answered = answers[index];
  const answeredCount = Object.keys(answers).length;
  const score = Object.values(answers).filter((a) => a.correct).length;
  const completed = questions ? answeredCount === questions.length : false;

  useEffect(() => {
    if (!completed || !questions || persistedRef.current) return;
    persistedRef.current = true;
    setSaving(true);
    setSaveError(null);
    saveQuestionSession({
      data: {
        ...(activeSessionId ? { sessionId: activeSessionId } : {}),
        documentId,
        ...(questionSetId ? { questionSetId } : {}),
        totalQuestions: questions.length,
        correctAnswers: sessionAnswers.filter((a) => a.correct).length,
        startedAt: startedAtRef.current,
        answers: sessionAnswers,
      },
    })
      .then((saved) => setActiveSessionId(saved.id))
      .catch((err: unknown) => {
        console.error("Saving question session failed", err);
        setSaveError(t(userErrorKey(err, "errors.save")));
      })
      .finally(() => setSaving(false));
  }, [activeSessionId, completed, questions, questionSetId, sessionAnswers, documentId]);

  useEffect(() => {
    if (!questions || !questionSetId || completed || sessionAnswers.length === 0) return;
    saveQuestionSessionDraft({
      data: {
        ...(activeSessionId ? { sessionId: activeSessionId } : {}),
        documentId,
        questionSetId,
        totalQuestions: questions.length,
        correctAnswers: sessionAnswers.filter((a) => a.correct).length,
        startedAt: startedAtRef.current,
        answers: sessionAnswers,
      },
    })
      .then((saved) => setActiveSessionId(saved.id))
      .catch(() => {});
  }, [activeSessionId, completed, documentId, questionSetId, questions, sessionAnswers]);

  function submit() {
    if (!current || answered || selected === null) return;
    const correct = selected === current.correctIndex;
    setAnswers((prev) => ({ ...prev, [index]: { selected, correct } }));
    setSessionAnswers((prev) => [
      ...prev.filter((a) => a.questionIndex !== index),
      {
        questionIndex: index,
        selectedIndex: selected,
        correctIndex: current.correctIndex,
        correct,
        answeredAt: new Date().toISOString(),
      },
    ]);
  }

  function goTo(next: number) {
    if (!questions || next < 0 || next >= questions.length) return;
    setIndex(next);
    setSelected(null);
  }


  return (
    <AppCard>
      <AppLabel>{t("questions.panel")}</AppLabel>
      <p className="mt-4 text-sm text-muted-foreground">
        {t(topicId ? "topics.questionsDescription" : "questions.description")}
      </p>
      {!canGenerate ? <p className="mt-4 text-sm text-muted-foreground">{t("topics.questionsGenerationUnavailable")}</p> : null}

      <div className="mt-6 flex flex-wrap gap-3">
        {!questions && alternatives.length === 0 && (
          <PrimaryButton onClick={() => void generate(false)} disabled={!canGenerate || generating || loadingExisting}>
            {generating ? t("questions.generating") : t("questions.generate")}{" "}
            <Sparkles className="h-4 w-4" aria-hidden />
          </PrimaryButton>
        )}
        {questions && (
          <GhostButton
            disabled={!canGenerate}
            onClick={() => {
              if (!generating) void generate(true);
            }}
          >
            {generating ? t("questions.generating") : t("questions.newSet")}
          </GhostButton>
        )}
      </div>

      {!loadingExisting && !currentAvailable && alternatives.length > 0 ? (
        <GeneratedContentLanguageState
          currentLocale={locale}
          variants={alternatives}
          generating={generating}
          generationDisabled={!canGenerate}
          onGenerate={() => void generate(false)}
          onOpen={(variantLocale) => {
            const variant = alternatives.find((item) => item.locale === variantLocale);
            if (!variant) return;
            if (restorableSession?.questionSetId === variant.id) {
              const restoredAnswers: Record<number, AnswerState> = {};
              for (const answer of restorableSession.answers) {
                restoredAnswers[answer.questionIndex] = {
                  selected: answer.selectedIndex,
                  correct: answer.correct,
                };
              }
              setQuestions(restorableSession.questions);
              setQuestionSetId(restorableSession.questionSetId);
              setActiveSessionId(restorableSession.id);
              setSessionAnswers(restorableSession.answers);
              setAnswers(restoredAnswers);
              setIndex(
                Math.min(
                  restorableSession.answers.length,
                  restorableSession.questions.length - 1,
                ),
              );
              startedAtRef.current = restorableSession.startedAt;
              return;
            }
            setQuestions(variant.questions);
            setQuestionSetId(variant.id);
            setAnswers({});
            setSessionAnswers([]);
            setSavedResult(null);
            setActiveSessionId(null);
            persistedRef.current = false;
            startedAtRef.current = new Date().toISOString();
            setSelected(null);
            setIndex(0);
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

      {loadingExisting && !questions ? (
        <div className="mt-6 space-y-3">
          <Skeleton className="w-1/3" />
          <Skeleton className="w-2/3" />
        </div>
      ) : null}

      {generating ? <AiGenerationProgress type="questions" /> : null}
      {practising ? <AiGenerationProgress type="practice" /> : null}

      {questions && current && !completed ? (
        <motion.div
          key={index}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mt-8 space-y-6 border-t border-border pt-8"
        >
          <div className="flex items-center justify-between font-mono text-[11px] text-muted-foreground">
            <span>
              {t("questions.questionCounter", { current: index + 1, total: questions.length })}
            </span>
            <span>
              {t("questions.score", { score, answered: answeredCount })}
            </span>
          </div>

          <MarkdownContent className="text-lg leading-relaxed">{currentPrompt}</MarkdownContent>

          <ul className="space-y-3">
            {current.options.map((option, i) => {
              const isCorrect = i === current.correctIndex;
              const isPicked = answered ? answered.selected === i : selected === i;
              return (
                <li key={i}>
                  <button
                    type="button"
                    disabled={!!answered}
                    onClick={() => setSelected(i)}
                    aria-pressed={isPicked}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors",
                      "border-border hover:border-lime/40 disabled:cursor-default",
                      isPicked && !answered && "border-lime/60 bg-surface-2",
                      answered && isCorrect && "border-lime/60 bg-lime/10",
                      answered && isPicked && !isCorrect && "border-destructive/50 bg-destructive/10",
                    )}
                  >
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {String.fromCharCode(65 + i)}
                    </span>
                    <MarkdownContent inline className="min-w-0 flex-1">{option}</MarkdownContent>
                    {answered && isCorrect ? (
                      <Check className="size-4 text-lime" aria-hidden />
                    ) : null}
                    {answered && isPicked && !isCorrect ? (
                      <X className="size-4 text-destructive" aria-hidden />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>

          {answered ? (
            <div className="space-y-3" aria-live="polite">
              <p className={cn("font-mono text-[11px]", answered.correct ? "text-lime" : "text-destructive")}>
                {answered.correct ? t("questions.correct") : t("questions.incorrect")}
              </p>
              <p className="text-sm leading-relaxed text-muted-foreground">{current.explanation}</p>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-6">
            {!answered ? (
              <PrimaryButton onClick={submit} disabled={selected === null}>
                {t("questions.submit")}
              </PrimaryButton>
            ) : index < questions.length - 1 ? (
              <PrimaryButton onClick={() => goTo(index + 1)}>{t("questions.next")}</PrimaryButton>
            ) : null}
            {index > 0 ? <GhostButton onClick={() => goTo(index - 1)}>{t("questions.previous")}</GhostButton> : null}
          </div>

        </motion.div>
      ) : null}

      {questions && completed ? (
        <QuestionSessionResult
          documentId={documentId}
          {...(topicId ? { topicId } : {})}
          questions={questions}
          answers={sessionAnswers}
          saving={saving}
          saveError={saveError}
          practising={practising}
          generationDisabled={!canGenerate}
          onPracticeMistakes={() => {
            void practiceMistakes(sessionAnswers.filter((a) => !a.correct));
          }}
          onNewSession={() => {
            if (!generating) void generate(true);
          }}
        />
      ) : questions && !completed && answeredCount === 0 && savedResult ? (
        <QuestionSessionResult
          documentId={documentId}
          {...(topicId ? { topicId } : {})}
          questions={questions}
          answers={savedResult.answers}
          heading={t("results.lastSession")}
          practising={practising}
          generationDisabled={!canGenerate}
          onPracticeMistakes={() => {
            void practiceMistakes(savedResult.answers.filter((a) => !a.correct));
          }}
          onNewSession={() => {
            if (!generating) void generate(true);
          }}
        />
      ) : null}

    </AppCard>
  );
}

function questionErrorMessage(
  error: unknown,
  t: (key: string) => string,
  topicScoped: boolean,
  practice: boolean,
  loading = false,
) {
  const message = error instanceof Error ? error.message : "";
  if (topicScoped) {
    if (message.includes("STALE_TOPIC_SOURCE")) return t("topics.questionsStale");
    if (message.includes("TOPIC_SOURCE_UNAVAILABLE")) return t("topics.questionsSourceUnavailable");
    if (message.includes("INVALID_TOPIC_SOURCE_RANGE")) return t("topics.questionsSourceInvalid");
    if (message.includes("TOPIC_QUESTION_SOURCE_INSUFFICIENT")) {
      return t("topics.questionsSourceInsufficient");
    }
    if (message.includes("TOPIC_NOT_FOUND")) return t("topics.topicMissing");
  }
  return aiErrorMessage(
    error,
    t,
    t(loading ? "errors.load" : practice ? "questions.errorPractice" : "questions.errorGenerate"),
  );
}
