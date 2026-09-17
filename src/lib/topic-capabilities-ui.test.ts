import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const detail = read("../routes/app.materials_.$documentId.topics_.$topicId.tsx");
const questions = read("../components/app/DocumentQuestions.tsx");
const flashcards = read("../components/app/DocumentFlashcards.tsx");

test("topic detail forwards trusted capabilities without introducing generation on load", () => {
  assert.match(detail, /canGenerate=\{state\.capabilities\.questions\}/);
  assert.match(detail, /canGenerate=\{state\.capabilities\.flashcards\}/);
  assert.doesNotMatch(detail, /generateDocument|reserveAiGeneration|generateAiText/);
  assert.match(detail, /TOPIC_SUMMARY_SOURCE_INVALID/);
  assert.match(detail, /TOPIC_SUMMARY_SOURCE_UNAVAILABLE/);
});

test("topic panels explain disabled generation without disabling saved-content reads", () => {
  for (const [panel, feature] of [[questions, "questions"], [flashcards, "flashcards"]] as const) {
    assert.match(panel, /canGenerate = true/);
    assert.match(panel, new RegExp(`t\\("topics\\.${feature}GenerationUnavailable"\\)`));
    assert.match(panel, /disabled=\{!canGenerate \|\|/);
    assert.match(panel, /generationDisabled=\{!canGenerate\}/);
    assert.match(panel, /if \(!canGenerate\) return;/);
    assert.match(panel, /getDocument(?:Questions|Flashcards)\(\{ data: \{ documentId, topicId \} \}\)/);
  }
  assert.match(questions, /if \(!canGenerate \|\| !questionSetId/);
  assert.match(flashcards, /canGenerate \? "flashcards\.readyLabel" : "flashcards\.panel"/);
});

test("locale alternatives and completed results keep view actions separate from generation", () => {
  const languageState = read("../components/app/GeneratedContentLanguageState.tsx");
  const result = read("../components/app/QuestionSessionResult.tsx");
  assert.match(languageState, /disabled=\{generating \|\| generationDisabled\}/);
  assert.match(languageState, /<GhostButton key=\{variant\.locale\} onClick=\{\(\) => onOpen\(variant\.locale\)\}>/);
  assert.match(result, /onClick=\{onNewSession\} disabled=\{generationDisabled\}/);
  assert.match(result, /disabled=\{practising \|\| generationDisabled\}/);
});

test("generation limitation copy exists in EN and PT-BR without internal thresholds", () => {
  const i18n = read("./i18n.tsx");
  for (const feature of ["questions", "flashcards"]) {
    const messages = Array.from(i18n.matchAll(new RegExp(`"topics\\.${feature}GenerationUnavailable": "([^"]+)"`, "g")), (match) => match[1]);
    assert.equal(messages.length, 2);
    assert.match(messages[0]!, /not have enough source content/);
    assert.match(messages[1]!, /não possui conteúdo suficiente/);
    for (const message of messages) {
      assert.doesNotMatch(message!, /80|200|RPC|parser|legacy|ranges/i);
    }
  }
});
