import type { RecommendedSession } from "@/types/study";
import type { StoredDocumentTopic } from "./document-topics.functions";

export type StudyTopic = {
  id: string;
  title: string;
  context: string;
};

export type TopicSourceState = "ready" | "unavailable" | "insufficient" | "too_large";
export type TopicUnavailableReason = "missing" | "stale" | TopicSourceState;

export type StudyTopicsState =
  | {
      status: "ready";
      documentId: string;
      documentTitle: string;
      topics: StudyTopic[];
    }
  | {
      status: "unavailable";
      documentId: string;
      reason: TopicUnavailableReason;
    };

export function toStudyTopics(topics: StoredDocumentTopic[]): StudyTopic[] {
  return [...topics]
    .sort((a, b) => a.position - b.position)
    .map((topic) => ({
      id: topic.id,
      title: topic.title,
      context: topic.description,
    }));
}

export function getKnowledgeMapTopics(topics: StudyTopic[]): StudyTopic[] {
  return topics.slice(0, 6);
}

export function resolveStudyTopicsState({
  documentId,
  documentTitle,
  topics,
  sourceState,
}: {
  documentId: string;
  documentTitle: string;
  topics: StoredDocumentTopic[];
  sourceState: TopicSourceState;
}): StudyTopicsState {
  if (topics.length > 0) {
    return {
      status: "ready",
      documentId,
      documentTitle,
      topics: toStudyTopics(topics),
    };
  }

  return {
    status: "unavailable",
    documentId,
    reason: sourceState === "ready" ? "missing" : sourceState,
  };
}

export function resolveStaleStudyTopicsState(documentId: string): StudyTopicsState {
  return {
    status: "unavailable",
    documentId,
    reason: "stale",
  };
}

export function prioritizeTopicsByReinforcement(
  topics: StudyTopic[],
  reinforcementTitles: string[],
): StudyTopic[] {
  if (reinforcementTitles.length === 0) return topics;
  const reinforced = new Set(reinforcementTitles.map((title) => title.toLowerCase()));
  return [...topics].sort((a, b) => {
    const aReinforced = reinforced.has(a.title.toLowerCase()) ? 1 : 0;
    const bReinforced = reinforced.has(b.title.toLowerCase()) ? 1 : 0;
    return bReinforced - aReinforced;
  });
}

export function buildTopicSessionStructure(
  topics: StudyTopic[],
  areas: { title: string }[],
  t: (key: string, vars?: Record<string, string | number>) => string,
): RecommendedSession {
  const warmupTopics = topics.slice(0, 2).map((topic) => topic.title).join(", ");
  const reviewTopics = topics.slice(-2).map((topic) => topic.title).join(", ");
  const practiceDetail =
    areas.length > 0
      ? `${t("plan.practiceDetail")}; ${areas.map((area) => area.title).join(", ")}`
      : t("plan.practiceDetail");

  return {
    minutes: 0,
    blocks: [
      {
        index: "01",
        title: t("plan.blocks.warmup"),
        detail: warmupTopics || t("plan.currentConcepts"),
        minutes: 0,
      },
      {
        index: "02",
        title: t("plan.blocks.core"),
        detail: `${topics.length} ${t("plan.blocks.core").toLowerCase()}`,
        minutes: 0,
      },
      {
        index: "03",
        title: t("plan.blocks.practice"),
        detail: practiceDetail,
        minutes: 0,
      },
      {
        index: "04",
        title: t("plan.blocks.review"),
        detail: reviewTopics ? `${t("plan.reviewDetail")}: ${reviewTopics}` : t("plan.reviewDetail"),
        minutes: 0,
      },
    ],
  };
}
