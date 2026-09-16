import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import {
  MARKDOWN_QUESTION_FORMAT,
  PRACTICE_QUESTION_SYSTEM_PROMPT,
  QUESTION_SYSTEM_PROMPT,
} from "../src/lib/questions.prompt.ts";
import { parseMarkdownQuestions } from "../src/lib/questions.parser.ts";
import { normalizeSummaryHeadings, parseMarkdownSummary } from "../src/lib/summary.parser.ts";
import { MARKDOWN_SUMMARY_FORMAT, SUMMARY_SYSTEM_PROMPT } from "../src/lib/summary.prompt.ts";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

loadDotEnv();

const BASE_URL = process.env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1";
const API_KEY_ENV = "NVIDIA_API_KEY";
const MAX_INPUT_CHARS = 60_000;
const requestTimeoutArgument = process.argv
  .slice(2)
  .find((argument) => argument.startsWith("--request-timeout-ms="));
const REQUEST_TIMEOUT_MS = Number(
  requestTimeoutArgument?.split("=")[1] ?? process.env.NVIDIA_REQUEST_TIMEOUT_MS ?? 45_000,
);

const PORTUGUESE_MATERIAL = `Sistemas operacionais organizam os recursos de hardware e oferecem abstrações para programas de usuário. Um processo representa um programa em execução, com espaço de endereçamento, registradores, arquivos abertos e estado de execução. Threads são fluxos de execução dentro de um mesmo processo e compartilham recursos como memória e descritores.

O escalonamento de CPU decide qual processo ou thread deve executar em determinado momento. Algoritmos como First-Come, First-Served, Shortest Job First, Round Robin e escalonamento por prioridades equilibram critérios como tempo de resposta, throughput, justiça e uso da CPU. Em sistemas interativos, o Round Robin usa fatias de tempo para alternar rapidamente entre tarefas.

A concorrência aparece quando múltiplas tarefas avançam no mesmo intervalo de tempo. Quando essas tarefas acessam dados compartilhados, podem ocorrer condições de corrida. Para evitar inconsistências, sistemas operacionais oferecem mecanismos de sincronização como mutexes, semáforos e monitores. A exclusão mútua garante que apenas uma thread acesse uma seção crítica por vez.

Deadlocks podem ocorrer quando processos ficam bloqueados esperando recursos uns dos outros. As quatro condições clássicas são exclusão mútua, posse e espera, ausência de preempção e espera circular. Estratégias de prevenção, evitação e detecção procuram reduzir ou resolver esse problema.

A memória virtual permite que processos usem um espaço de endereçamento lógico maior e isolado. Paginação divide a memória em páginas e quadros, enquanto a tabela de páginas traduz endereços virtuais para endereços físicos. Quando uma página necessária não está na memória, ocorre uma falta de página e o sistema operacional precisa carregá-la do armazenamento.`;

const ENGLISH_MATERIAL = `Database transactions group operations into a logical unit of work. The ACID properties describe transaction guarantees: atomicity means all operations commit or none do, consistency means committed data respects defined constraints, isolation controls how concurrent transactions observe each other, and durability means committed changes survive failures.

Isolation levels define which concurrency anomalies are allowed. Read committed prevents dirty reads but can still allow non-repeatable reads. Repeatable read avoids some changes becoming visible during the transaction, while serializable aims to make concurrent execution equivalent to a serial order.

Indexes improve lookup performance by maintaining additional data structures over one or more columns. A B-tree index supports equality and range queries efficiently, but indexes also add write overhead because inserts, updates, and deletes must maintain the index structure. Query planners choose execution strategies based on estimated costs, table statistics, predicates, and available indexes.`;

function loadDotEnv() {
  // This script runs directly with Node, outside Vite's environment loading.
  // Anchor local env files to the project so its launch directory is irrelevant.
  const inheritedKeys = new Set(Object.keys(process.env));

  for (const filename of [".env", ".env.local"]) {
    const envPath = resolve(PROJECT_ROOT, filename);
    if (!existsSync(envPath)) continue;

    for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (inheritedKeys.has(key)) continue;
      process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
    }
  }
}

function cleanMarkdown(value) {
  return value
    .replace(/^```(?:markdown|md)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function buildGenerationMessages({ system, prompt, outputFormat, languageInstruction }) {
  const languageContract = `OUTPUT LANGUAGE REQUIREMENT:
${languageInstruction}
This applies to every user-facing generated field. Do not switch generated content to the source material's language when it differs from this requirement. Preserve only format labels and headings explicitly marked as fixed parser tokens.`;

  return {
    system: `${system}\n\n${languageContract}`,
    prompt: [prompt, languageContract, outputFormat].filter(Boolean).join("\n\n"),
  };
}

function validateParsedQuestions(output) {
  if (!output || !Array.isArray(output.questions) || output.questions.length !== 5) {
    return { ok: false, reason: "Expected exactly 5 questions." };
  }

  for (const [index, question] of output.questions.entries()) {
    if (!question.question || typeof question.question !== "string") {
      return { ok: false, reason: `Question ${index + 1} has no prompt.` };
    }
    if (
      !Array.isArray(question.options) ||
      question.options.length !== 4 ||
      question.options.some(Boolean) === false
    ) {
      return { ok: false, reason: `Question ${index + 1} does not have 4 options.` };
    }
    if (
      !Number.isInteger(question.correctIndex) ||
      question.correctIndex < 0 ||
      question.correctIndex > 3
    ) {
      return { ok: false, reason: `Question ${index + 1} has invalid correctIndex.` };
    }
    if (!question.explanation || typeof question.explanation !== "string") {
      return { ok: false, reason: `Question ${index + 1} has no explanation.` };
    }
  }

  return { ok: true, reason: "Parsed into the current NEXA question shape." };
}

function collectRateLimitHeaders(headers) {
  const values = {};
  for (const [key, value] of headers.entries()) {
    const lower = key.toLowerCase();
    if (lower.includes("rate") || lower === "retry-after" || lower.startsWith("x-ratelimit")) {
      values[key] = value;
    }
  }
  return values;
}

async function requestJson(path, init) {
  const startedAt = performance.now();
  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      ok: false,
      status: null,
      contentType: "",
      bodyText: "",
      json: null,
      latencyMs: Math.round(performance.now() - startedAt),
      rateLimitHeaders: {},
      transportError: error instanceof Error ? error.message : String(error),
    };
  }
  const latencyMs = Math.round(performance.now() - startedAt);
  const contentType = response.headers.get("content-type") ?? "";
  const bodyText = await response.text();
  const rateLimitHeaders = collectRateLimitHeaders(response.headers);

  let json = null;
  try {
    json = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    // Keep bodyText available for compatibility diagnosis.
  }

  return {
    ok: response.ok,
    status: response.status,
    contentType,
    bodyText,
    json,
    latencyMs,
    rateLimitHeaders,
  };
}

async function listModels(apiKey) {
  return requestJson("/models", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
}

function modelId(model) {
  return typeof model === "string" ? model : model?.id;
}

function selectModel(models) {
  if (process.env.NVIDIA_MODEL) return process.env.NVIDIA_MODEL;

  const ids = models.map(modelId).filter(Boolean);
  const preferences = [
    /^openai\/gpt-oss-20b$/i,
    /^nvidia\/llama-3\.3-nemotron-super-49b/i,
    /^nvidia\/llama-3\.1-nemotron-70b-instruct/i,
    /^meta\/llama-3\.1-70b-instruct/i,
    /^qwen\/.*instruct/i,
  ];

  for (const pattern of preferences) {
    const match = ids.find((id) => pattern.test(id));
    if (match) return match;
  }

  const fallback = ids.find(
    (id) =>
      /(?:instruct|chat)/i.test(id) &&
      !/(?:embed|rerank|guard|moderation|classif|safety)/i.test(id),
  );
  return fallback ?? "openai/gpt-oss-20b";
}

async function chatCompletion(
  apiKey,
  model,
  { label, system, prompt, maxTokens, reasoningEffort },
) {
  const response = await requestJson("/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      max_tokens: maxTokens,
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      stream: false,
    }),
  });

  const choice = response.json?.choices?.[0];
  const message = choice?.message;
  const content = typeof message?.content === "string" ? message.content : "";
  const numericUsage = response.json?.usage && typeof response.json.usage === "object"
    ? Object.fromEntries(
        Object.entries(response.json.usage).filter(([, value]) =>
          typeof value === "number" || (value !== null && typeof value === "object"),
        ),
      )
    : null;
  return {
    label,
    ...response,
    model: response.json?.model ?? model,
    content,
    finishReason: choice?.finish_reason ?? null,
    reasoningCharacters:
      typeof message?.reasoning_content === "string"
        ? message.reasoning_content.length
        : 0,
    responseStructure: {
      topLevelKeys: response.json && typeof response.json === "object"
        ? Object.keys(response.json).sort()
        : [],
      choiceKeys: choice && typeof choice === "object" ? Object.keys(choice).sort() : [],
      messageKeys: message && typeof message === "object" ? Object.keys(message).sort() : [],
      contentType: Array.isArray(message?.content) ? "array" : typeof message?.content,
      hasReasoning: Object.hasOwn(message ?? {}, "reasoning"),
      hasReasoningContent: Object.hasOwn(message ?? {}, "reasoning_content"),
    },
    usage: numericUsage,
  };
}

function printResult(result, extra = {}) {
  const bodySummary = result.ok
    ? `content chars=${result.content.length}`
    : result.bodyText.slice(0, 1_000) || result.transportError || "Empty response body";

  console.log(
    JSON.stringify(
      {
        test: result.label,
        ok: result.ok,
        status: result.status,
        contentType: result.contentType,
        latencyMs: result.latencyMs,
        model: result.model,
        finishReason: result.finishReason,
        reasoningCharacters: result.reasoningCharacters,
        responseStructure: result.responseStructure,
        usage: result.usage,
        rateLimitHeaders: result.rateLimitHeaders,
        bodySummary,
        ...extra,
      },
      null,
      2,
    ),
  );
}

function includesAllSections(markdown, sections) {
  return sections.every((section) => new RegExp(`^##\\s+${section}\\s*$`, "im").test(markdown));
}

function validateParsedSummary(markdown) {
  const parsed = parseMarkdownSummary(markdown, "Benchmark document");
  const requiredHeadings = [
    "Key concepts",
    "Explanations",
    "Definitions",
    "Relationships",
    "Final review",
    "Limitations",
  ];
  const headingPresence = Object.fromEntries(
    requiredHeadings.map((heading) => [
      heading,
      new RegExp(`^##\\s+${heading}\\s*$`, "im").test(markdown),
    ]),
  );
  const rawFormatCompliant = includesAllSections(markdown, requiredHeadings);
  const normalizedFormatCompliant = includesAllSections(
    normalizeSummaryHeadings(markdown),
    requiredHeadings,
  );

  return {
    rawFormatCompliant,
    normalizedFormatCompliant,
    rawHeadingLines: markdown.match(/^#{1,6}\s+.+$/gm) ?? [],
    headingPresence,
    parsedFieldCounts: {
      keyConcepts: parsed.keyConcepts.length,
      explanations: parsed.explanations.length,
      definitions: parsed.definitions.length,
      relationships: parsed.relationships.length,
      reviewCharacters: parsed.review.length,
    },
  };
}

const apiKey = process.env[API_KEY_ENV];
if (!apiKey) {
  console.error(
    `${API_KEY_ENV} is not configured. Add it to your local environment or .env to run this local-only test.`,
  );
  process.exit(1);
}

const modelsResponse = await listModels(apiKey);
if (!modelsResponse.ok) {
  console.error(
    JSON.stringify(
      {
        test: "models",
        ok: false,
        status: modelsResponse.status,
        contentType: modelsResponse.contentType,
        latencyMs: modelsResponse.latencyMs,
        rateLimitHeaders: modelsResponse.rateLimitHeaders,
        bodySummary: modelsResponse.bodyText.slice(0, 1_000),
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const models = Array.isArray(modelsResponse.json?.data) ? modelsResponse.json.data : [];
const scriptArgs = process.argv.slice(2);
const compatibleModelIds = models
  .map(modelId)
  .filter(
    (id) =>
      typeof id === "string" &&
      /(?:instruct|chat)/i.test(id) &&
      !/(?:embed|rerank|guard|moderation|classif|safety|vision|vl|image)/i.test(id),
  )
  .sort();
if (scriptArgs.includes("--list-only")) {
  console.log(
    JSON.stringify(
      {
        test: "models",
        ok: true,
        status: modelsResponse.status,
        discoveredModels: models.length,
        allModelIds: models.map(modelId).filter(Boolean).sort(),
        compatibleModelIds,
        rateLimitHeaders: modelsResponse.rateLimitHeaders,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
const selectedModel =
  scriptArgs.find((argument) => !argument.startsWith("--")) ?? selectModel(models);
const summaryLocale = scriptArgs.includes("--summary-locale=en") ? "en" : "pt-BR";
const topicSummaryOnly = scriptArgs.includes("--topic-summary-only");
const summaryOnly = scriptArgs.includes("--summary-only") || topicSummaryOnly;
const topicMaxTokensArgument = scriptArgs.find((argument) =>
  argument.startsWith("--topic-max-tokens="),
);
const topicMaxTokens = Number(topicMaxTokensArgument?.split("=")[1] ?? 2_500);
console.log(
  JSON.stringify(
    {
      test: "models",
      ok: true,
      status: modelsResponse.status,
      contentType: modelsResponse.contentType,
      latencyMs: modelsResponse.latencyMs,
      discoveredModels: models.length,
      selectedModel,
      rateLimitHeaders: modelsResponse.rateLimitHeaders,
    },
    null,
    2,
  ),
);

const ptLanguageInstruction =
  "Write all user-facing generated content in Brazilian Portuguese (pt-BR). Preserve source terminology when the material uses specific technical terms.";
const enLanguageInstruction =
  "Write all user-facing generated content in English. Preserve source terminology when the material uses specific technical terms.";
const summaryUsesEnglish = summaryLocale === "en";
const summaryLanguageInstruction = summaryUsesEnglish
  ? enLanguageInstruction
  : ptLanguageInstruction;
const summaryTitle = summaryUsesEnglish
  ? "Database transaction fundamentals"
  : "Conceitos básicos de sistemas operacionais";
const summaryMaterial = summaryUsesEnglish
  ? topicSummaryOnly
    ? ENGLISH_MATERIAL.split("\n\n")[0]
    : ENGLISH_MATERIAL
  : topicSummaryOnly
    ? PORTUGUESE_MATERIAL.split("\n\n")[1]
    : PORTUGUESE_MATERIAL;
const summaryTask = topicSummaryOnly
  ? `Document title: ${summaryTitle}
Topic title: ${summaryUsesEnglish ? "Transaction guarantees and isolation" : "Escalonamento e concorrência"}

TOPIC-FOCUSED MODE:
Summarize ONLY the topic excerpt below. Do not expand into other sections of the document or add related background that is absent from this excerpt.

TOPIC EXCERPT (the only allowed source):
"""
${summaryMaterial.slice(0, MAX_INPUT_CHARS)}
"""

Produce the structured study summary for this topic.`
  : `Document title: ${summaryTitle}

MATERIAL (the only allowed source):
"""
${summaryMaterial.slice(0, MAX_INPUT_CHARS)}
"""

Produce the structured study summary.`;

const summaryMessages = buildGenerationMessages({
  system: SUMMARY_SYSTEM_PROMPT,
  prompt: summaryTask,
  outputFormat: MARKDOWN_SUMMARY_FORMAT,
  languageInstruction: summaryLanguageInstruction,
});
const summaryResult = await chatCompletion(apiKey, selectedModel, {
  label: `${topicSummaryOnly ? "topic-summary" : "summary"}-${summaryLocale}`,
  system: summaryMessages.system,
  maxTokens: topicSummaryOnly ? topicMaxTokens : 1_600,
  reasoningEffort: topicSummaryOnly ? "low" : undefined,
  prompt: summaryMessages.prompt,
});
const summaryValidation = validateParsedSummary(summaryResult.content);
printResult(summaryResult, {
  followedLanguage: summaryUsesEnglish
    ? /transaction|database|isolation|durability|index/i.test(summaryResult.content)
    : /processo|sistema|memória|escalonamento|explic/i.test(summaryResult.content),
  unrelatedContentAbsent: topicSummaryOnly
    ? summaryUsesEnglish
      ? !/B-tree|query planner|table statistics/i.test(summaryResult.content)
      : !/memória virtual|paginação|deadlock|falta de página/i.test(summaryResult.content)
    : undefined,
    rawHeadingContract: summaryValidation.rawFormatCompliant,
    parserCompatible: summaryValidation.normalizedFormatCompliant,
    rawHeadingLines: summaryValidation.rawHeadingLines,
    headingPresence: summaryValidation.headingPresence,
  parsedFieldCounts: summaryValidation.parsedFieldCounts,
});

if (!summaryOnly) {
  const questionMessages = buildGenerationMessages({
    system: QUESTION_SYSTEM_PROMPT,
    prompt: `Document title: Conceitos básicos de sistemas operacionais

MATERIAL (the only allowed source):
"""
${PORTUGUESE_MATERIAL.slice(0, MAX_INPUT_CHARS)}
"""

Produce exactly 5 multiple-choice questions.`,
    outputFormat: MARKDOWN_QUESTION_FORMAT,
    languageInstruction: ptLanguageInstruction,
  });
  const questionResult = await chatCompletion(apiKey, selectedModel, {
    label: "questions-pt-BR",
    system: questionMessages.system,
    maxTokens: 2_200,
    prompt: questionMessages.prompt,
  });
  const parsedQuestions = parseMarkdownQuestions(questionResult.content);
  const questionValidation = validateParsedQuestions(parsedQuestions);
  printResult(questionResult, {
    followedLanguage: /qual|processo|sistema|correta|explic/i.test(questionResult.content),
    parserCompatible: questionValidation.ok,
    parserResult: questionValidation.reason,
    parsedQuestionCount: parsedQuestions.questions.length,
    firstQuestion: parsedQuestions.questions[0] ?? null,
  });

  const practiceMessages = buildGenerationMessages({
    system: PRACTICE_QUESTION_SYSTEM_PROMPT,
    prompt: `Document title: Conceitos básicos de sistemas operacionais

MATERIAL (the only allowed source):
"""
${PORTUGUESE_MATERIAL.slice(0, MAX_INPUT_CHARS)}
"""

MISSED QUESTIONS (content to reinforce, not to copy):
1. Missed question: O que representa um processo em um sistema operacional?
   Correct answer: Um programa em execução com estado e recursos associados.

QUESTIONS ALREADY ASKED (must not be repeated or paraphrased):
- O que representa um processo em um sistema operacional?

Produce exactly 5 NEW multiple-choice questions covering the missed concepts.`,
    outputFormat: MARKDOWN_QUESTION_FORMAT,
    languageInstruction: ptLanguageInstruction,
  });
  const practiceResult = await chatCompletion(apiKey, selectedModel, {
    label: "practice-pt-BR",
    system: practiceMessages.system,
    maxTokens: 2_200,
    prompt: practiceMessages.prompt,
  });
  const parsedPracticeQuestions = parseMarkdownQuestions(practiceResult.content);
  const practiceValidation = validateParsedQuestions(parsedPracticeQuestions);
  printResult(practiceResult, {
    followedLanguage: /qual|processo|sistema|correta|explic/i.test(practiceResult.content),
    parserCompatible: practiceValidation.ok,
    parserResult: practiceValidation.reason,
    parsedQuestionCount: parsedPracticeQuestions.questions.length,
  });

  const englishMessages = buildGenerationMessages({
    system: QUESTION_SYSTEM_PROMPT,
    prompt: `Document title: Database transaction fundamentals

MATERIAL (the only allowed source):
"""
${ENGLISH_MATERIAL.slice(0, MAX_INPUT_CHARS)}
"""

Produce exactly 5 multiple-choice questions.`,
    outputFormat: MARKDOWN_QUESTION_FORMAT,
    languageInstruction: enLanguageInstruction,
  });
  const englishResult = await chatCompletion(apiKey, selectedModel, {
    label: "questions-en",
    system: englishMessages.system,
    maxTokens: 2_200,
    prompt: englishMessages.prompt,
  });
  const parsedEnglishQuestions = parseMarkdownQuestions(englishResult.content);
  const englishValidation = validateParsedQuestions(parsedEnglishQuestions);
  printResult(englishResult, {
    followedLanguage: /transaction|database|isolation|correct|explanation/i.test(
      englishResult.content,
    ),
    parserCompatible: englishValidation.ok,
    parserResult: englishValidation.reason,
    parsedQuestionCount: parsedEnglishQuestions.questions.length,
  });
}
