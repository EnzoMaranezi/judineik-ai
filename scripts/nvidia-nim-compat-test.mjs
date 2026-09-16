import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

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

const SYSTEM_SUMMARY_PROMPT = `You are NEXA, an academic study agent.
You write structured study summaries based EXCLUSIVELY on the material provided by the user.
Rules:
- Never use outside/general knowledge. Never invent facts, numbers, names or examples.
- Mirror the actual organisation and terminology of the material. Follow the output language requirement for user-facing content.
- If the material is incomplete or too short to cover something, state that limitation in the "limitations" field instead of filling the gap.
- Be concise: this is a revision aid, not a rewrite of the document.
- The required Markdown headings are serialization tokens. Always use these exact English lines: "## Key concepts", "## Explanations", "## Definitions", "## Relationships", "## Final review", and "## Limitations".
- CRITICAL SERIALIZATION OVERRIDE: treat those six heading lines as code literals, not prose. Copy them byte-for-byte and never translate, rename, pluralize, or alter them. Only their contents use the requested output language.`;

const MARKDOWN_SUMMARY_FORMAT = `The following Markdown headings are a machine-readable serialization contract.
Copy these six section-heading lines character-for-character: "## Key concepts", "## Explanations", "## Definitions", "## Relationships", "## Final review", and "## Limitations".
They are fixed parser tokens, not user-facing text. Never translate, rename, pluralize, reorder, or omit them, regardless of the requested output language.
For example, even in pt-BR, "## Conceitos-chave", "## Explicação", "## Definições", "## Relacionamentos", "## Revisão final", and "## Limitações" are invalid.
Only the H1 title text and the content beneath the six fixed section headings should use the requested output language.
Before returning, verify that all six canonical English heading lines are present exactly as written. Even for pt-BR, outputting "## Conceitos-chave" or any translated heading is invalid.

Return markdown using exactly these sections:
# localized title
## Key concepts
- concept
## Explanations
### heading
body
## Definitions
- term: definition
## Relationships
- relationship
## Final review
short review paragraph
## Limitations
limitation or "None"`;

const SYSTEM_QUESTION_PROMPT = `You are NEXA, an academic study agent.
You write multiple-choice study questions based EXCLUSIVELY on the material provided by the user.
Rules:
- Never use outside/general knowledge. Never invent facts, numbers, names or examples.
- Every question and every option must be answerable/verifiable from the material alone.
- Follow the output language requirement for every user-facing field. Preserve source terminology when it is technically necessary.
- Produce exactly 5 questions, each with exactly 4 options, exactly one correct option, and a concise explanation of why the correct option is correct.`;

const MARKDOWN_QUESTION_FORMAT = `Return markdown using exactly this format:
## Question 1
Question: question text
A. option text
B. option text
C. option text
D. option text
Correct: A
Explanation: concise explanation

Repeat for each question.
The labels "Question:", "Correct:", and "Explanation:" are fixed parser tokens and must remain literal English. Only their values use the requested output language.`;

const PRACTICE_SYSTEM_PROMPT = `You are NEXA, an academic study agent.
You write NEW multiple-choice practice questions that reinforce concepts a student got wrong.
Rules:
- Use EXCLUSIVELY the material provided. Never use outside knowledge or invent facts.
- Every question must be answerable from the material alone.
- Follow the output language requirement for every user-facing field. Preserve source terminology when it is technically necessary.
- Each question has exactly 4 options, exactly one correct option, and a concise explanation.
- Do not reuse or paraphrase the missed questions.`;

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

function stripMarkdown(value) {
  return value
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function normalizeSummaryHeadings(markdown) {
  const aliases = [
    [/^##\s*(?:Key concepts|Conceitos[- ]?chave)\s*$/i, "## Key concepts"],
    [/^##\s*(?:Explanations|Explica(?:ç(?:ão|ões)|c(?:ao|oes)))\s*$/i, "## Explanations"],
    [/^##\s*(?:Definitions|Defini(?:ç(?:ão|ões)|c(?:ao|oes)))\s*$/i, "## Definitions"],
    [/^##\s*(?:Relationships|Relacionamentos)\s*$/i, "## Relationships"],
    [/^##\s*(?:Final review|Revis(?:ão|ao) final)\s*$/i, "## Final review"],
    [/^##\s*(?:Limitations|Limita(?:ç(?:ão|ões)|c(?:ao|oes)))\s*$/i, "## Limitations"],
  ];

  return markdown
    .split(/\r?\n/)
    .map((line) => aliases.find(([pattern]) => pattern.test(line.trim()))?.[1] ?? line)
    .join("\n");
}

function section(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex(
    (line) => line.trim().toLowerCase() === `## ${heading.toLowerCase()}`,
  );
  if (start === -1) return "";

  const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line.trim()));
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join("\n")
    .trim();
}

function bulletItems(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").trim())
    .filter(Boolean)
    .map(stripMarkdown);
}

function paragraph(value) {
  return stripMarkdown(
    value
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").trim())
      .filter(Boolean)
      .join("\n"),
  );
}

function parseExplanationSection(value) {
  const lines = value.split(/\r?\n/);
  const items = [];
  let current = null;

  for (const line of lines) {
    const heading = /^###\s+(.+?)\s*$/.exec(line.trim())?.[1];
    if (heading) {
      if (current)
        items.push({ heading: current.heading, body: paragraph(current.body.join("\n")) });
      current = { heading: stripMarkdown(heading), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }

  if (current) items.push({ heading: current.heading, body: paragraph(current.body.join("\n")) });
  if (items.length > 0) return items.filter((item) => item.heading && item.body).slice(0, 8);

  return bulletItems(value)
    .map((item) => {
      const [heading, ...body] = item.split(":");
      return { heading: heading?.trim() ?? "", body: body.join(":").trim() };
    })
    .filter((item) => item.heading && item.body)
    .slice(0, 8);
}

function parseDefinitionSection(value) {
  return bulletItems(value)
    .map((item) => {
      const [term, ...definition] = item.split(":");
      return { term: term?.trim() ?? "", definition: definition.join(":").trim() };
    })
    .filter((item) => item.term && item.definition)
    .slice(0, 10);
}

function parseMarkdownSummary(markdown, fallbackTitle) {
  const content = cleanMarkdown(normalizeSummaryHeadings(markdown));
  const title = stripMarkdown(/^#\s+(.+?)\s*$/m.exec(content)?.[1] ?? fallbackTitle);
  const limitations = paragraph(section(content, "Limitations"));

  return {
    title,
    keyConcepts: bulletItems(section(content, "Key concepts")).slice(0, 10),
    explanations: parseExplanationSection(section(content, "Explanations")),
    definitions: parseDefinitionSection(section(content, "Definitions")),
    relationships: bulletItems(section(content, "Relationships")).slice(0, 8),
    review: paragraph(section(content, "Final review")) || paragraph(content),
    limitations: limitations && !/^none$/i.test(limitations) ? limitations : null,
  };
}

function normalizeQuestionLine(line) {
  return stripMarkdown(line)
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[-*]\s+/, "")
    .trim();
}

function parseCorrectIndex(value) {
  const token = stripMarkdown(value).trim().toUpperCase();
  const letter = /^[A-D]/.exec(token)?.[0];
  return letter ? letter.charCodeAt(0) - 65 : -1;
}

function parseMarkdownQuestions(markdown) {
  const questionLabelPattern = String.raw`(?:Question|Pergunta|Questão|Questao|Q)`;
  const blocks = cleanMarkdown(markdown)
    .split(
      new RegExp(
        String.raw`(?=^\s*(?:#{1,6}\s*)?(?:\*\*)?\s*${questionLabelPattern}\s+\d+\b|^\s*\d+[.)]\s+)`,
        "gim",
      ),
    )
    .map((block) => block.trim())
    .filter(Boolean);

  const questions = blocks.map((block) => {
    const lines = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    let question = "";
    const options = [];
    let correctIndex = -1;
    let explanation = "";
    let awaitingQuestionText = false;

    for (const line of lines) {
      const normalizedLine = normalizeQuestionLine(line);
      const optionLine = /^([A-D])\s*[.)-]\s*(.+)$/i.exec(normalizedLine);
      const correctLine = /^(?:Correct|Correta|Resposta correta|Resposta)\s*:\s*(.+)$/i.exec(
        normalizedLine,
      )?.[1];
      const explanationLine = /^(?:Explanation|Explicação|Explicacao)\s*:\s*(.+)$/i.exec(
        normalizedLine,
      )?.[1];
      const labelledQuestionLine = new RegExp(
        String.raw`^${questionLabelPattern}\s*(?:\d+)?\s*[:.)-]?\s*(.*)$`,
        "i",
      ).exec(normalizedLine)?.[1];
      const numbered = /^\d+[.)]\s+(.+)$/i.exec(normalizedLine)?.[1];

      if (labelledQuestionLine !== undefined) {
        const prompt = stripMarkdown(labelledQuestionLine);
        if (prompt) {
          question = prompt;
          awaitingQuestionText = false;
        } else {
          awaitingQuestionText = !question;
        }
      } else if (!question && numbered) {
        question = stripMarkdown(numbered);
        awaitingQuestionText = false;
      } else if (optionLine) {
        const optionIndex = optionLine[1].toUpperCase().charCodeAt(0) - 65;
        options[optionIndex] = stripMarkdown(optionLine[2]);
        awaitingQuestionText = false;
      } else if (correctLine) {
        correctIndex = parseCorrectIndex(correctLine);
        awaitingQuestionText = false;
      } else if (explanationLine) {
        explanation = stripMarkdown(explanationLine);
        awaitingQuestionText = false;
      } else if (awaitingQuestionText && !question) {
        question = stripMarkdown(normalizedLine);
        awaitingQuestionText = false;
      } else if (explanation) {
        explanation = `${explanation} ${stripMarkdown(line)}`.trim();
      }
    }

    return { question, options, correctIndex, explanation };
  });

  return { questions };
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
  system: SYSTEM_SUMMARY_PROMPT,
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
    system: SYSTEM_QUESTION_PROMPT,
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
    system: PRACTICE_SYSTEM_PROMPT,
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
    system: SYSTEM_QUESTION_PROMPT,
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
