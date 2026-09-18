import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildFlashcardReviewOverview,
  type FlashcardOverviewCardRow,
  type FlashcardOverviewSetRow,
} from "./flashcards.overview.ts";

const functionsSource = readFileSync(
  new URL("./flashcards.overview.functions.ts", import.meta.url),
  "utf8",
);
const overviewSource = readFileSync(new URL("../routes/app.index.tsx", import.meta.url), "utf8");
const flashcardMigration = readFileSync(
  new URL("../../supabase/migrations/0004_flashcards.sql", import.meta.url),
  "utf8",
);
const schedulingMigration = readFileSync(
  new URL("../../supabase/migrations/0005_flashcard_spaced_repetition.sql", import.meta.url),
  "utf8",
);

const NOW = new Date("2026-08-24T12:00:00.000Z");

const sets: FlashcardOverviewSetRow[] = [
  { id: "pt-a", documentId: "doc-a", documentTitle: "Algoritmos", topicId: null, topicTitle: null, locale: "pt-BR" },
  { id: "pt-b", documentId: "doc-b", documentTitle: "Estruturas", topicId: null, topicTitle: null, locale: "pt-BR" },
  { id: "en-a", documentId: "doc-a", documentTitle: "Algorithms", topicId: null, topicTitle: null, locale: "en" },
  { id: "legacy-a", documentId: "doc-a", documentTitle: "Legacy", topicId: null, topicTitle: null, locale: "und" },
];

function card(flashcardSetId: string, dueAt: string): FlashcardOverviewCardRow {
  return { flashcardSetId, dueAt };
}

test("PT-BR counts only due cards from PT-BR decks", () => {
  const overview = buildFlashcardReviewOverview({
    locale: "pt-BR",
    sets,
    cards: [
      card("pt-a", "2026-08-24T11:00:00.000Z"),
      card("en-a", "2026-08-24T10:00:00.000Z"),
      card("legacy-a", "2026-08-24T09:00:00.000Z"),
    ],
    now: NOW,
  });

  assert.equal(overview.totalDue, 1);
  assert.equal(overview.dueByScope[0]?.documentTitle, "Algoritmos");
});

test("English counts only due cards from English decks", () => {
  const overview = buildFlashcardReviewOverview({
    locale: "en",
    sets,
    cards: [
      card("pt-a", "2026-08-24T11:00:00.000Z"),
      card("en-a", "2026-08-24T10:00:00.000Z"),
      card("legacy-a", "2026-08-24T09:00:00.000Z"),
    ],
    now: NOW,
  });

  assert.equal(overview.totalDue, 1);
  assert.equal(overview.dueByScope[0]?.documentTitle, "Algorithms");
});

test("multiple due documents are ordered by count, oldest overdue, then document id", () => {
  const overview = buildFlashcardReviewOverview({
    locale: "pt-BR",
    sets,
    cards: [
      card("pt-a", "2026-08-24T10:00:00.000Z"),
      card("pt-a", "2026-08-24T11:00:00.000Z"),
      card("pt-b", "2026-08-24T08:00:00.000Z"),
      card("pt-b", "2026-08-24T09:00:00.000Z"),
    ],
    now: NOW,
  });

  assert.equal(overview.totalDue, 4);
  assert.deepEqual(
    overview.dueByScope.map((scope) => scope.documentId),
    ["doc-b", "doc-a"],
  );
  assert.equal(overview.dueByScope[0]?.oldestDueAt, "2026-08-24T08:00:00.000Z");
});

test("a card due exactly now is included and overdue cards remain due", () => {
  const overview = buildFlashcardReviewOverview({
    locale: "pt-BR",
    sets,
    cards: [card("pt-a", NOW.toISOString()), card("pt-a", "2026-08-01T00:00:00.000Z")],
    now: NOW,
  });

  assert.equal(overview.totalDue, 2);
});

test("no due cards returns the earliest future review for the active locale", () => {
  const overview = buildFlashcardReviewOverview({
    locale: "pt-BR",
    sets,
    cards: [
      card("pt-a", "2026-08-26T12:00:00.000Z"),
      card("pt-b", "2026-08-25T14:30:00.000Z"),
      card("en-a", "2026-08-24T13:00:00.000Z"),
    ],
    now: NOW,
  });

  assert.equal(overview.hasDecks, true);
  assert.equal(overview.totalDue, 0);
  assert.equal(overview.nextDueAt, "2026-08-25T14:30:00.000Z");
});

test("no active-locale decks is distinct from a deck with no due cards", () => {
  const overview = buildFlashcardReviewOverview({
    locale: "en",
    sets: sets.filter((set) => set.locale !== "en"),
    cards: [card("pt-a", NOW.toISOString())],
    now: NOW,
  });

  assert.deepEqual(overview, {
    locale: "en",
    hasDecks: false,
    totalDue: 0,
    dueByScope: [],
    nextDueAt: null,
  });
});

test("server query is authenticated, locale-scoped, indexed, and owner-isolated by RLS", () => {
  assert.match(functionsSource, /middleware\(\[requireSupabaseAuth\]\)/);
  assert.match(functionsSource, /getAiLocaleContext\(claims\)/);
  assert.doesNotMatch(functionsSource, /auth\.getUser\(\)/);
  assert.match(functionsSource, /eq\("locale", locale\)/);
  assert.match(functionsSource, /\.in\(\s*"flashcard_set_id"/);
  assert.doesNotMatch(functionsSource, /inputValidator|userId|user_id/);
  assert.match(
    flashcardMigration,
    /flashcard_sets FOR SELECT TO authenticated[\s\S]*auth\.uid\(\) = user_id/,
  );
  assert.match(
    flashcardMigration,
    /flashcards FOR SELECT TO authenticated[\s\S]*flashcard_sets\.user_id = auth\.uid\(\)/,
  );
  assert.match(
    schedulingMigration,
    /flashcards_set_due_position_idx[\s\S]*flashcard_set_id, due_at, position/,
  );
});

test("document and topic decks are counted separately and preserve topic metadata", () => {
  const overview = buildFlashcardReviewOverview({
    locale: "pt-BR",
    sets: [
      sets[0]!,
      {
        id: "pt-topic-a",
        documentId: "doc-a",
        documentTitle: "Algoritmos",
        topicId: "topic-a",
        topicTitle: "Ordenacao",
        locale: "pt-BR",
      },
    ],
    cards: [
      card("pt-a", "2026-08-24T11:00:00.000Z"),
      card("pt-topic-a", "2026-08-24T10:00:00.000Z"),
    ],
    now: NOW,
  });

  assert.equal(overview.totalDue, 2);
  assert.equal(overview.dueByScope.length, 2);
  assert.equal(overview.dueByScope[0]?.topicId, "topic-a");
  assert.equal(overview.dueByScope[0]?.topicTitle, "Ordenacao");
  assert.equal(overview.dueByScope[1]?.topicId, null);
});

test("same topic in another locale is excluded from the active locale", () => {
  const overview = buildFlashcardReviewOverview({
    locale: "pt-BR",
    sets: [
      {
        id: "pt-topic-a",
        documentId: "doc-a",
        documentTitle: "Algoritmos",
        topicId: "topic-a",
        topicTitle: "Ordenacao",
        locale: "pt-BR",
      },
      {
        id: "en-topic-a",
        documentId: "doc-a",
        documentTitle: "Algorithms",
        topicId: "topic-a",
        topicTitle: "Sorting",
        locale: "en",
      },
    ],
    cards: [
      card("pt-topic-a", "2026-08-24T11:00:00.000Z"),
      card("en-topic-a", "2026-08-24T10:00:00.000Z"),
    ],
    now: NOW,
  });

  assert.equal(overview.totalDue, 1);
  assert.equal(overview.dueByScope[0]?.flashcardSetId, "pt-topic-a");
});

test("Overview refreshes on locale changes and Review now targets only document routes", () => {
  assert.match(overviewSource, /getFlashcardReviewOverview\(\)[\s\S]*\[locale\]/);
  assert.match(overviewSource, /to="\/app\/flashcards\/\$documentId"/);
  assert.match(overviewSource, /params=\{\{ documentId: primary\.documentId \}\}/);
  assert.doesNotMatch(overviewSource, /to="\/app\/materials\/\$documentId\/topics/);
  assert.match(overviewSource, /dueByScope\.filter\(\(scope\) => scope\.topicId === null\)/);
  assert.match(overviewSource, /documentReviews\.reduce\(\(total, scope\) => total \+ scope\.dueCount, 0\)/);
});

test("Overview due retrieval has no AI provider or quota side effects", () => {
  assert.doesNotMatch(
    functionsSource,
    /generateAiText|generateText|reserveAiGeneration|finishAiGeneration|runReservedAiGeneration|OPENROUTER|NVIDIA/,
  );
  assert.doesNotMatch(overviewSource, /generateDocumentFlashcards|reviewFlashcard\s*\(/);
});
