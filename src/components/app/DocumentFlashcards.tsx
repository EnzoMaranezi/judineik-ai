import { useEffect, useEffectEvent, useState } from "react";
import { AlertCircle, Eye, RotateCcw, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { AppCard, AppLabel, GhostButton, PrimaryButton, Skeleton } from "@/components/app/ui";
import { generateDocumentFlashcards, getDocumentFlashcardReviewQueue, getDocumentFlashcards, reviewFlashcard } from "@/lib/flashcards.functions";
import type { FlashcardRating, StoredFlashcard } from "@/lib/flashcards.schema";
import { aiErrorMessage } from "@/lib/ai-errors";
import { useI18n } from "@/lib/i18n";
import type { PersistedContentLocale } from "@/lib/i18n";
import { GeneratedContentLanguageState } from "@/components/app/GeneratedContentLanguageState";
import { AiGenerationProgress } from "@/components/app/AiGenerationProgress";
import { MarkdownContent } from "@/components/app/MarkdownContent";

type FlashcardMode = "review" | "browse";

export function DocumentFlashcardsPanel({ documentId, topicId, canGenerate = true }: { documentId: string; topicId?: string; canGenerate?: boolean }) {
  const { locale, t } = useI18n();
  const [cards, setCards] = useState<StoredFlashcard[] | null>(null);
  const [flashcardSetId, setFlashcardSetId] = useState<string | null>(null);
  const [currentAvailable, setCurrentAvailable] = useState(false);
  const [alternatives, setAlternatives] = useState<Array<{
    id: string;
    locale: PersistedContentLocale;
    cards: StoredFlashcard[];
  }>>([]);
  const [dueCards, setDueCards] = useState<StoredFlashcard[]>([]);
  const [nextDueAt, setNextDueAt] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [savingReview, setSavingReview] = useState(false);
  const [reviewedThisSession, setReviewedThisSession] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<FlashcardMode>("review");
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [complete, setComplete] = useState(false);
  const refreshReviewQueueFromEffect = useEffectEvent(() => {
    void refreshReviewQueue().catch(() => undefined);
  });

  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    setError(null);
    setNotice(null);
    setReviewedThisSession(false);
    setCards(null);
    setFlashcardSetId(null);
    setCurrentAvailable(false);
    setAlternatives([]);
    setDueCards([]);
    setNextDueAt(null);
    setMode("review");
    setIndex(0);
    setRevealed(false);
    setComplete(false);
    getDocumentFlashcards({ data: { documentId, topicId } }).then(async (availability) => {
      const deck = availability.current;
      const queue = deck
        ? await getDocumentFlashcardReviewQueue({
            data: { documentId, flashcardSetId: deck.id, topicId },
          })
        : null;
      if (!cancelled) {
        setCards(deck?.cards ?? null);
        setFlashcardSetId(deck?.id ?? null);
        setCurrentAvailable(Boolean(deck));
        setAlternatives(availability.alternatives);
        setDueCards(queue?.dueCards ?? []);
        setNextDueAt(queue?.nextDueAt ?? null);
      }
    }).catch((cause: unknown) => {
      if (!cancelled) setError(flashcardTopicError(cause, t, t("flashcards.errorLoad")));
    }).finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [documentId, locale, topicId]);

  useEffect(() => {
    if (!cards || dueCards.length > 0 || !nextDueAt) return;
    const delay = Math.min(Math.max(new Date(nextDueAt).getTime() - Date.now() + 250, 0), 2_147_483_647);
    const timer = window.setTimeout(() => {
      refreshReviewQueueFromEffect();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [cards, documentId, dueCards.length, nextDueAt, refreshReviewQueueFromEffect]);

  async function refreshReviewQueue(setId = flashcardSetId) {
    if (!setId) {
      setDueCards([]);
      setNextDueAt(null);
      return;
    }
    const queue = await getDocumentFlashcardReviewQueue({ data: { documentId, flashcardSetId: setId, topicId } });
    setDueCards(queue?.dueCards ?? []);
    setNextDueAt(queue?.nextDueAt ?? null);
  }

  async function generate() {
    if (!canGenerate) return;
    setGenerating(true); setError(null);
    try {
      const deck = await generateDocumentFlashcards({ data: { documentId, topicId } });
      setCards(deck.cards);
      setFlashcardSetId(deck.id);
      setCurrentAvailable(true);
      await refreshReviewQueue(deck.id);
      setMode("review"); setIndex(0); setRevealed(false); setComplete(false); setReviewedThisSession(false);
    }
    catch (cause) {
      console.error("Flashcard generation failed", cause);
      const topicError = flashcardTopicError(cause, t, "");
      setError(topicError || aiErrorMessage(cause, t, t("flashcards.errorGenerate")));
    }
    finally { setGenerating(false); }
  }

  async function rate(rating: FlashcardRating) {
    const currentCard = dueCards[0];
    if (!currentCard || savingReview) return;
    setSavingReview(true); setError(null); setNotice(null);
    try {
      const result = await reviewFlashcard({ data: { flashcardId: currentCard.id, rating } });
      setDueCards((current) => current.filter((card) => card.id !== currentCard.id));
      setNextDueAt((current) => !current || new Date(result.nextDueAt).getTime() < new Date(current).getTime() ? result.nextDueAt : current);
      setRevealed(false);
      setReviewedThisSession(true);
      setNotice(t("flashcards.reviewSaved"));
      await refreshReviewQueue().catch(() => undefined);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      if (message.includes("FLASHCARD_NOT_DUE")) {
        await refreshReviewQueue().catch(() => undefined);
        setRevealed(false);
        setError(t("flashcards.notDue"));
      } else {
        setError(t("flashcards.errorReview"));
      }
    } finally {
      setSavingReview(false);
    }
  }

  function switchMode(nextMode: FlashcardMode) {
    setMode(nextMode); setIndex(0); setRevealed(false); setComplete(false); setError(null); setNotice(null);
    if (nextMode === "review") void refreshReviewQueue().catch(() => undefined);
  }

  function move(direction: -1 | 1) {
    if (!cards) return;
    if (direction === 1 && index === cards.length - 1) { setComplete(true); return; }
    setIndex((value) => Math.max(0, Math.min(cards.length - 1, value + direction))); setRevealed(false);
  }
  function restart() { setIndex(0); setRevealed(false); setComplete(false); }
  const reviewCard = dueCards[0];
  const browseCard = cards?.[index];
  const formattedNextReview = nextDueAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(nextDueAt))
    : null;
  const ratingButtons: Array<{ rating: FlashcardRating; label: string }> = [
    { rating: "again", label: t("flashcards.ratingAgain") },
    { rating: "hard", label: t("flashcards.ratingHard") },
    { rating: "good", label: t("flashcards.ratingGood") },
    { rating: "easy", label: t("flashcards.ratingEasy") },
  ];

  return <div id="flashcards"><AppCard>
    <AppLabel>{cards ? t("flashcards.savedLabel") : t(canGenerate ? "flashcards.readyLabel" : "flashcards.panel")}</AppLabel>
    <p className="mt-4 text-sm text-muted-foreground">{checking ? t("flashcards.checking") : cards ? t("flashcards.saved") : t(canGenerate ? "flashcards.ready" : "topics.flashcardsGenerationUnavailable")}</p>
    {!canGenerate && (checking || cards) ? <p className="mt-4 text-sm text-muted-foreground">{t("topics.flashcardsGenerationUnavailable")}</p> : null}
    {!checking && !error && !cards && alternatives.length === 0 ? <PrimaryButton className="mt-6" onClick={() => void generate()} disabled={!canGenerate || generating}>
      {generating ? t("flashcards.generating") : t("flashcards.generate")} <Sparkles className="size-4" aria-hidden />
    </PrimaryButton> : null}
    {!checking && !currentAvailable && alternatives.length > 0 ? <GeneratedContentLanguageState
      currentLocale={locale}
      variants={alternatives}
      generating={generating}
      generationDisabled={!canGenerate}
      onGenerate={() => void generate()}
      onOpen={(variantLocale) => {
        const variant = alternatives.find((item) => item.locale === variantLocale);
        if (!variant) return;
        setCards(variant.cards);
        setFlashcardSetId(variant.id);
        setMode("review"); setIndex(0); setRevealed(false); setComplete(false); setReviewedThisSession(false);
        void refreshReviewQueue(variant.id).catch(() => undefined);
      }}
    /> : null}
    {generating ? <AiGenerationProgress type="flashcards" /> : null}
    {error ? <p role="alert" className="mt-5 flex gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm"><AlertCircle className="size-4 shrink-0 text-destructive" />{error}</p> : null}
    {notice ? <p role="status" className="mt-5 font-mono text-xs text-lime">{notice}</p> : null}
    {checking ? <div className="mt-6 space-y-3"><Skeleton className="w-1/3" /><Skeleton className="w-full" /></div> : null}
    {cards ? <div className="mt-6 flex flex-wrap gap-3 border-t border-border pt-6">
      {mode === "review" ? <PrimaryButton disabled>{t("flashcards.reviewMode")}</PrimaryButton> : <GhostButton onClick={() => switchMode("review")}>{t("flashcards.reviewMode")}</GhostButton>}
      {mode === "browse" ? <PrimaryButton disabled>{t("flashcards.browseDeck")}</PrimaryButton> : <GhostButton onClick={() => switchMode("browse")}>{t("flashcards.browseDeck")}</GhostButton>}
    </div> : null}
    {mode === "review" && reviewCard ? <div className="mt-8 border-t border-border pt-8">
      <div className="flex justify-between font-mono text-[11px] text-muted-foreground"><span>{t("flashcards.cardsDue", { count: dueCards.length })}</span><span>{revealed ? t("flashcards.answer") : t("flashcards.front")}</span></div>
      <motion.button key={`${reviewCard.id}-${revealed}`} type="button" onClick={() => setRevealed((value) => !value)} className="mt-5 flex min-h-64 w-full flex-col items-center justify-center rounded-2xl border border-border bg-surface-2/60 p-8 text-center transition-colors hover:border-lime/40" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <MarkdownContent inline className="inline-block w-full max-w-2xl text-xl leading-relaxed">{revealed ? reviewCard.back : reviewCard.front}</MarkdownContent>
        <span className="mt-8 inline-flex items-center gap-2 font-mono text-[11px] text-muted-foreground"><Eye className="size-3" />{revealed ? t("flashcards.hideAnswer") : t("flashcards.reveal")}</span>
      </motion.button>
      {revealed ? <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">{ratingButtons.map(({ rating, label }) =>
        <GhostButton key={rating} onClick={() => void rate(rating)} disabled={savingReview}>{label}</GhostButton>)}</div> : null}
      {savingReview ? <p className="mt-4 font-mono text-xs text-muted-foreground" aria-live="polite">{t("flashcards.savingReview")}</p> : null}
    </div> : null}
    {cards && mode === "review" && !reviewCard ? <div className="mt-8 border-t border-border pt-8"><AppLabel>{t(reviewedThisSession ? "flashcards.reviewComplete" : "flashcards.noDue")}</AppLabel><p className="mt-3 text-sm text-muted-foreground">{t(reviewedThisSession ? "flashcards.reviewCompleteBody" : "flashcards.noDueBody")}</p>{formattedNextReview ? <p className="mt-3 font-mono text-xs text-muted-foreground">{t("flashcards.nextReview", { date: formattedNextReview })}</p> : null}<GhostButton className="mt-6" onClick={() => switchMode("browse")}>{t("flashcards.browseDeck")}</GhostButton></div> : null}
    {cards && mode === "browse" && browseCard && !complete ? <div className="mt-8 border-t border-border pt-8">
      <p className="mb-5 text-sm text-muted-foreground">{t("flashcards.browseBody")}</p>
      <div className="flex justify-between font-mono text-[11px] text-muted-foreground"><span>{t("flashcards.counter", { current: index + 1, total: cards.length })}</span><span>{revealed ? t("flashcards.answer") : t("flashcards.front")}</span></div>
      <motion.button key={`browse-${browseCard.id}-${revealed}`} type="button" onClick={() => setRevealed((value) => !value)} className="mt-5 flex min-h-64 w-full flex-col items-center justify-center rounded-2xl border border-border bg-surface-2/60 p-8 text-center transition-colors hover:border-lime/40" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <MarkdownContent inline className="inline-block w-full max-w-2xl text-xl leading-relaxed">{revealed ? browseCard.back : browseCard.front}</MarkdownContent>
        <span className="mt-8 inline-flex items-center gap-2 font-mono text-[11px] text-muted-foreground"><Eye className="size-3" />{revealed ? t("flashcards.hideAnswer") : t("flashcards.reveal")}</span>
      </motion.button>
      <div className="mt-6 flex flex-wrap gap-3"><GhostButton onClick={() => move(-1)} disabled={index === 0}>{t("flashcards.previous")}</GhostButton><PrimaryButton onClick={() => move(1)}>{index === cards.length - 1 ? t("flashcards.finish") : t("flashcards.next")}</PrimaryButton></div>
    </div> : null}
    {cards && mode === "browse" && complete ? <div className="mt-8 border-t border-border pt-8"><AppLabel>{t("flashcards.complete")}</AppLabel><p className="mt-3 text-sm text-muted-foreground">{t("flashcards.completeBody")}</p><PrimaryButton className="mt-6" onClick={restart}><RotateCcw className="size-4" />{t("flashcards.restart")}</PrimaryButton></div> : null}
  </AppCard></div>;
}

function flashcardTopicError(
  cause: unknown,
  t: (key: string) => string,
  fallback: string,
) {
  const message = cause instanceof Error ? cause.message : "";
  if (message.includes("STALE_TOPIC_SOURCE")) return t("flashcards.topicStale");
  if (message.includes("TOPIC_NOT_FOUND")) return t("flashcards.topicMissing");
  if (message.includes("INVALID_TOPIC_SOURCE_RANGE")) return t("flashcards.topicInvalidSource");
  if (message.includes("TOPIC_SOURCE_UNAVAILABLE")) return t("flashcards.topicInsufficient");
  return fallback;
}
