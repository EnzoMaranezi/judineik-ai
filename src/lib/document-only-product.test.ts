import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { isNotFound, notFound } from "@tanstack/react-router";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

for (const route of [
  "app.plan.tsx",
  "app.session.tsx",
  "app.materials_.$documentId.topics.tsx",
  "app.materials_.$documentId.topics_.$topicId.tsx",
]) {
  test(`${route} rejects direct navigation before mounting topic UI`, () => {
    const exports: { Route?: { beforeLoad: () => void } } = {};
    let calls = 0;
    const output = ts.transpileModule(read(`../routes/${route}`), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    runInNewContext(output, {
      exports,
      require: (name: string) => name === "@tanstack/react-router"
        ? { createFileRoute: () => (options: unknown) => options, notFound }
        : new Proxy({}, { get: () => () => { calls++; throw new Error("Unexpected dependency call"); } }),
    });
    assert.ok(exports.Route);
    assert.throws(() => exports.Route!.beforeLoad(), isNotFound);
    assert.equal(calls, 0, "No topic reads, discovery or generation before recovery");
  });
}

test("retained product surfaces contain no topic or plan navigation", () => {
  for (const file of [
    "../components/app/AppShell.tsx",
    "../components/app/QuestionSessionResult.tsx",
    "../routes/app.materials.tsx",
    "../routes/app.index.tsx",
    "../routes/app.processing.tsx",
    "../routes/app.sessions.$sessionId.tsx",
  ]) {
    assert.doesNotMatch(read(file), /(?:to=|to: )"\/app\/(?:plan|session"|materials\/\$documentId\/topics)/);
  }
  const materials = read("../routes/app.materials.tsx");
  for (const feature of ["summary", "questions", "flashcards"]) {
    assert.ok(materials.includes(`to="/app/${feature}/$documentId"`));
  }
});

test("landing no longer mounts topic maps or study planning promotions", () => {
  const landing = read("../routes/index.tsx");
  assert.doesNotMatch(landing, /<(?:KnowledgeGraph|Intelligence|DailyBriefing|Personalization)\b/);
  assert.doesNotMatch(read("../components/FeatureBento.tsx"), /landing\.knowledgeMap/);
  assert.doesNotMatch(read("../data/site.ts"), /#intelligence/);
});
