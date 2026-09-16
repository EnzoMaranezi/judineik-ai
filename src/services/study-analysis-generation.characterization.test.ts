import assert from "node:assert/strict";
import test from "node:test";
import { analyzeMaterial, USE_MOCK_AI } from "./aiService.ts";
import type { PendingInput } from "./storageService.ts";

const academicFixture: PendingInput = {
  kind: "notes",
  name: "operating_systems-notes.pdf",
  documentId: "characterization-document",
  text: [
    "Kernel scheduling coordinates processes and threads during execution.",
    "Kernel scheduling coordinates processes and threads during execution.",
    "Mutex synchronization prevents deadlock between processes and threads.",
    "Mutex synchronization prevents deadlock between processes and threads.",
    "Memory page management supports kernel scheduling and process isolation.",
    "Memory page management supports kernel scheduling and process isolation.",
    "System calls coordinate scheduling decisions and process coordination.",
    "System calls coordinate scheduling decisions and process coordination.",
    "Bibliography reference publisher author reference publisher author academic press reference publisher author reference publisher author academic press.",
  ].join(" "),
};

test("analyzeMaterial uses the current local heuristic to derive metadata and rank at most six concepts", async () => {
  const analysis = await analyzeMaterial(academicFixture);

  assert.equal(USE_MOCK_AI, true);
  assert.equal(analysis.id, "characterization-document");
  assert.equal(analysis.documentId, "characterization-document");
  assert.equal(analysis.title, "Operating Systems Notes");
  assert.equal(analysis.chapter, "Operating Systems Notes");
  assert.equal(analysis.subject, "Operating Systems");
  assert.equal(analysis.summary, academicFixture.text!.slice(0, 360));

  // This is the current ranked output, including the six-concept cap.
  assert.deepEqual(
    analysis.concepts.map(({ id, title, context }) => ({ id, title, context })),
    [
      {
        id: "scheduling",
        title: "Scheduling",
        context: "Operating Systems Notes Kernel scheduling coordinates processes and threads during execution.",
      },
      {
        id: "processes-and-threads",
        title: "Processes And Threads",
        context: "Operating Systems Notes Kernel scheduling coordinates processes and threads during execution.",
      },
      {
        id: "kernel-scheduling",
        title: "Kernel Scheduling",
        context: "Operating Systems Notes Kernel scheduling coordinates processes and threads during execution.",
      },
      {
        id: "reference-publisher-author",
        title: "Reference Publisher Author",
        context: "Bibliography reference publisher author reference publisher author academic press reference publisher author reference publisher author academic press.",
      },
      {
        id: "kernel-scheduling-coordinates-processes",
        title: "Kernel Scheduling Coordinates Processes",
        context: "Operating Systems Notes Kernel scheduling coordinates processes and threads during execution.",
      },
      {
        id: "mutex-synchronization-prevents-deadlock",
        title: "Mutex Synchronization Prevents Deadlock",
        context: "Mutex synchronization prevents deadlock between processes and threads.",
      },
    ],
  );
  assert.equal(analysis.concepts.length, 6);
});

test("analyzeMaterial assigns synthetic concept fields from the ranked position", async () => {
  const analysis = await analyzeMaterial(academicFixture);
  const [first, ...remaining] = analysis.concepts;

  assert.deepEqual(
    analysis.concepts.map(({ difficulty, mastery }) => ({ difficulty, mastery })),
    [
      { difficulty: "easy", mastery: 82 },
      { difficulty: "easy", mastery: 75 },
      { difficulty: "medium", mastery: 68 },
      { difficulty: "medium", mastery: 61 },
      { difficulty: "hard", mastery: 54 },
      { difficulty: "hard", mastery: 47 },
    ],
  );
  assert.equal(first?.parent, undefined);
  assert.ok(first);
  assert.deepEqual(remaining.map((concept) => concept.parent), Array(5).fill(first.id));
});

test("analyzeMaterial completes deterministically without provider configuration and includes bibliography-like phrases when ranked", async () => {
  const first = await analyzeMaterial(academicFixture);
  const second = await analyzeMaterial(academicFixture);

  assert.deepEqual(first.concepts, second.concepts);
  assert.ok(first.concepts.some((concept) => concept.id === "reference-publisher-author"));
});
