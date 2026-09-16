import type { Concept, Question, StudyAnalysis } from "@/types/study";
import type { PendingInput } from "@/services/storageService";

/**
 * Single entry point for all AI work.
 *
 * While USE_MOCK_AI is true these functions return realistic structured data.
 * When a real endpoint exists, only the `false` branch of each function needs
 * to change — components already consume the typed contract below.
 */
export const USE_MOCK_AI = true;

const STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "because",
  "been",
  "between",
  "chapter",
  "from",
  "have",
  "into",
  "material",
  "more",
  "only",
  "other",
  "that",
  "their",
  "there",
  "these",
  "this",
  "through",
  "with",
  "your",
  "a",
  "ao",
  "aos",
  "as",
  "cada",
  "com",
  "como",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "em",
  "entre",
  "essa",
  "esse",
  "esta",
  "este",
  "isso",
  "mais",
  "mas",
  "na",
  "nas",
  "no",
  "nos",
  "o",
  "os",
  "ou",
  "para",
  "pela",
  "pelo",
  "por",
  "que",
  "são",
  "se",
  "sem",
  "ser",
  "sua",
  "suas",
  "seu",
  "seus",
  "sao",
  "também",
  "tambem",
  "um",
  "uma",
]);

const CONNECTOR_WORDS = new Set(["de", "da", "das", "do", "dos", "e", "of", "and"]);

const GENERIC_SINGLE_TERMS = new Set([
  "atividade",
  "atividades",
  "cada",
  "contexto",
  "execução",
  "execucao",
  "forma",
  "função",
  "funcao",
  "informação",
  "informacao",
  "material",
  "operacoes",
  "operações",
  "parte",
  "sistema",
  "tarefas",
  "tempo",
  "tipo",
  "uso",
]);

const DOMAIN_TERMS = new Set([
  "algoritmo",
  "algoritmos",
  "bloqueio",
  "cpu",
  "deadlock",
  "escalonamento",
  "exclusão",
  "exclusao",
  "interrupção",
  "interrupcao",
  "kernel",
  "memória",
  "memoria",
  "mutex",
  "paralelismo",
  "process",
  "processo",
  "processos",
  "scheduling",
  "semáforo",
  "semaforo",
  "sincronização",
  "sincronizacao",
  "sistema",
  "sistemas",
  "thread",
  "threads",
]);

function titleFromInput(input: PendingInput) {
  const raw = input.name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();
  if (!raw) return "Uploaded material";
  return raw.replace(/\b\w/g, (c) => c.toUpperCase());
}

function guessSubject(text: string, fallback: string) {
  const t = text.toLowerCase();
  if (/tcp|network|congestion|packet|router/.test(t)) return "Computer Networks";
  if (/integral|derivative|newton|calculus|matrix/.test(t)) return "Calculus";
  if (/gradient|classifier|neural|dataset|regression/.test(t)) return "Machine Learning";
  if (/complexity|sorting|graph traversal|algorithm/.test(t)) return "Algorithms";
  if (/kernel|process|scheduler|memory page/.test(t)) return "Operating Systems";
  return fallback;
}

function normalizeToken(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .map((word) => {
      if (/^[A-Z0-9]{2,}$/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function sentenceSummary(sentence: string, concept: string) {
  const cleaned = sentence.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 180) return cleaned;
  const index = cleaned.toLowerCase().indexOf(concept.toLowerCase());
  const start = Math.max(0, index - 70);
  const end = Math.min(cleaned.length, index + concept.length + 90);
  return `${start > 0 ? "..." : ""}${cleaned.slice(start, end).trim()}${end < cleaned.length ? "..." : ""}`;
}

function isMeaningfulToken(token: string) {
  const normalized = normalizeToken(token);
  return token.length >= 3 && !STOP_WORDS.has(normalized);
}

function isUsefulPhrase(tokens: string[]) {
  const normalized = tokens.map(normalizeToken);
  const meaningful = normalized.filter((token) => !STOP_WORDS.has(token) && !CONNECTOR_WORDS.has(token));
  if (meaningful.length === 0) return false;
  if (CONNECTOR_WORDS.has(normalized[0]!) || CONNECTOR_WORDS.has(normalized[normalized.length - 1]!)) {
    return false;
  }
  if (tokens.length === 1) {
    const [only] = meaningful;
    return Boolean(only && DOMAIN_TERMS.has(only) && !GENERIC_SINGLE_TERMS.has(only));
  }
  if (meaningful.every((token) => GENERIC_SINGLE_TERMS.has(token))) return false;
  return meaningful.some((token) => DOMAIN_TERMS.has(token)) || meaningful.length >= 2;
}

function extractConcepts(text: string): StudyAnalysis["concepts"] {
  const candidates = new Map<
    string,
    { phrase: string; count: number; context: string; score: number }
  >();
  const sentences = text
    .split(/(?<=[.!?;:])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 30);

  for (const sentence of sentences) {
    const tokens = sentence
      .replace(/[()[\]{}]/g, " ")
      .split(/\s+/)
      .map((token) => token.replace(/^[^A-Za-zÀ-ÿ0-9]+|[^A-Za-zÀ-ÿ0-9]+$/g, ""))
      .filter(Boolean);

    for (let start = 0; start < tokens.length; start += 1) {
      for (let size = 1; size <= 4 && start + size <= tokens.length; size += 1) {
        const phraseTokens = tokens.slice(start, start + size);
        if (!phraseTokens.every((token) => isMeaningfulToken(token) || CONNECTOR_WORDS.has(normalizeToken(token)))) {
          continue;
        }
        if (!isUsefulPhrase(phraseTokens)) continue;

        const phrase = phraseTokens.join(" ");
        const key = phraseTokens.map(normalizeToken).join(" ");
        const meaningfulCount = phraseTokens.filter((token) => !STOP_WORDS.has(normalizeToken(token))).length;
        const domainBoost = phraseTokens.some((token) => DOMAIN_TERMS.has(normalizeToken(token))) ? 4 : 0;
        const score = meaningfulCount + domainBoost + Math.min(size, 3);
        const current = candidates.get(key);
        candidates.set(key, {
          phrase,
          count: (current?.count ?? 0) + 1,
          context: current?.context ?? sentenceSummary(sentence, phrase),
          score: (current?.score ?? 0) + score,
        });
      }
    }
  }

  const ranked = [...candidates.entries()]
    .filter(([, candidate]) => candidate.count > 1 || candidate.score >= 7)
    .sort((a, b) => b[1].score - a[1].score || b[1].count - a[1].count)
    .filter(([key], index, list) => {
      const words = key.split(" ");
      return !list
        .slice(0, index)
        .some(([other]) => other.includes(key) || words.every((word) => other.includes(word)));
    })
    .slice(0, 6)
    .map(([key, candidate], index, list) => {
      const difficulty: Concept["difficulty"] = index < 2 ? "easy" : index < 4 ? "medium" : "hard";
      return {
        id: key.replace(/[^a-z0-9]+/g, "-"),
        title: titleCase(candidate.phrase),
        context: candidate.context,
        difficulty,
        mastery: Math.max(42, 82 - index * 7),
        ...(index > 0 ? { parent: list[0]![0].replace(/[^a-z0-9]+/g, "-") } : {}),
      };
    });

  return ranked;
}

export async function analyzeMaterial(input: PendingInput): Promise<StudyAnalysis> {
  if (!USE_MOCK_AI) {
    throw new Error("Real AI mode is not configured yet.");
  }

  const title = titleFromInput(input);
  const sourceText = input.text?.trim() ?? "";
  if (sourceText.length < 200) {
    throw new Error("This material does not have enough processed text to build a study plan yet.");
  }

  const concepts = extractConcepts(`${title} ${sourceText}`);
  if (concepts.length === 0) {
    throw new Error("No study concepts could be identified from this material yet.");
  }

  const subject = guessSubject(`${input.name} ${sourceText}`, title);
  const questions = concepts.slice(0, Math.min(5, concepts.length)).map<Question>((concept, index) => ({
    id: `q-${concept.id}`,
    kind: "open",
    question: `Explain the role of ${concept.title} in this material.`,
    answer: concept.title,
    explanation: `${concept.title} was identified directly from the uploaded material.`,
    difficulty: concept.difficulty,
    concept: concept.title,
  }));

  return {
    id: input.documentId ?? `analysis-${Date.now()}`,
    documentId: input.documentId,
    title,
    subject,
    chapter: title,
    createdAt: Date.now(),
    summary: sourceText.slice(0, 360),
    concepts,
    weakAreas: [],
    questions,
    flashcards: concepts.slice(0, 3).map((concept) => ({
      id: `f-${concept.id}`,
      front: concept.title,
      back: `Review how ${concept.title} is used in this material.`,
    })),
    recommendedSession: {
      minutes: Math.max(10, Math.min(24, concepts.length * 3)),
      blocks: [
        { index: "01", title: "Warm up", detail: concepts.slice(0, 2).map((concept) => concept.title).join(", "), minutes: Math.max(2, Math.min(4, concepts.length)) },
        { index: "02", title: "Core concepts", detail: `${concepts.length} concepts from this material`, minutes: Math.max(4, concepts.length) },
        { index: "03", title: "First session", detail: "Generate questions before weak areas are known", minutes: 4 },
        { index: "04", title: "Quick review", detail: concepts.slice(-2).map((concept) => concept.title).join(", "), minutes: 2 },
      ],
    },
  };
}
