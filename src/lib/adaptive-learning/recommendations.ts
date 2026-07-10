import type { XapiStatement } from "@/lib/learning-records/lrs-client";

export const ADAPTIVE_RECOMMENDATION_RULES_VERSION = "deterministic-v1";

export type AdaptiveLesson = {
  id: string;
  courseId: string;
  position: number;
  title: string;
  competencyIds?: string[];
  masteryThreshold?: number;
};

export type AdaptiveLearningEvidence = {
  id: string;
  courseId: string;
  lessonId?: string;
  verb: "viewed" | "attempted" | "answered" | "completed" | "mastered" | "requested" | "interacted";
  timestamp: string;
  score?: number;
  success?: boolean;
  completion?: boolean;
  competencyIds?: string[];
};

export type AdaptiveRecommendationReason =
  | "no-course-lessons"
  | "start-course"
  | "reinforce-low-score"
  | "continue-sequence"
  | "course-complete";

export type AdaptiveRecommendation = {
  target: "adaptive-recommendation";
  status: "ready" | "blocked" | "complete";
  courseId: string;
  nextLessonId: string | null;
  reasonCode: AdaptiveRecommendationReason;
  rationale: string;
  sourceEventId: string | null;
  generatedAt: string;
  rulesVersion: typeof ADAPTIVE_RECOMMENDATION_RULES_VERSION;
  evidence: {
    consideredLessonCount: number;
    eventCount: number;
    latestEventId: string | null;
    completedLessonIds: string[];
    weakCompetencyIds: string[];
    rawResponsesOmitted: true;
    learnerIdentityOmitted: true;
  };
};

export type AdaptiveRecommendationInput = {
  courseId: string;
  lessons: AdaptiveLesson[];
  evidence: AdaptiveLearningEvidence[];
  generatedAt?: string;
};

type LessonState = {
  completed: boolean;
  latestEventId: string | null;
  lowScoreEvidence: AdaptiveLearningEvidence | null;
};

const defaultMasteryThreshold = 0.7;

export function recommendNextLesson(input: AdaptiveRecommendationInput): AdaptiveRecommendation {
  const lessons = input.lessons
    .filter((lesson) => lesson.courseId === input.courseId)
    .sort(compareLessons);
  const matchingEvidence = input.evidence
    .filter((event) => event.courseId === input.courseId)
    .sort(compareEvidence);
  const stateByLessonId = createLessonStateMap(lessons, matchingEvidence);
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const evidenceSummary = summarizeEvidence(lessons, matchingEvidence, stateByLessonId);

  if (lessons.length === 0) {
    return createRecommendation({
      courseId: input.courseId,
      status: "blocked",
      nextLessonId: null,
      reasonCode: "no-course-lessons",
      rationale: "No ordered lessons are available for this course.",
      sourceEventId: null,
      generatedAt,
      evidence: evidenceSummary,
    });
  }

  if (matchingEvidence.length === 0) {
    const firstLesson = lessons[0];
    return createRecommendation({
      courseId: input.courseId,
      status: "ready",
      nextLessonId: firstLesson.id,
      reasonCode: "start-course",
      rationale: `Start with the first ordered lesson: ${firstLesson.title}.`,
      sourceEventId: null,
      generatedAt,
      evidence: evidenceSummary,
    });
  }

  const reinforcementLesson = lessons.find((lesson) => {
    const state = stateByLessonId.get(lesson.id);
    return Boolean(state?.lowScoreEvidence && !state.completed);
  });

  if (reinforcementLesson) {
    const state = stateByLessonId.get(reinforcementLesson.id);
    return createRecommendation({
      courseId: input.courseId,
      status: "ready",
      nextLessonId: reinforcementLesson.id,
      reasonCode: "reinforce-low-score",
      rationale: `Revisit ${reinforcementLesson.title} before advancing because the latest score is below the deterministic mastery threshold.`,
      sourceEventId: state?.lowScoreEvidence?.id ?? null,
      generatedAt,
      evidence: evidenceSummary,
    });
  }

  const nextIncompleteLesson = lessons.find((lesson) => !stateByLessonId.get(lesson.id)?.completed);

  if (nextIncompleteLesson) {
    return createRecommendation({
      courseId: input.courseId,
      status: "ready",
      nextLessonId: nextIncompleteLesson.id,
      reasonCode: "continue-sequence",
      rationale: `Continue to the next incomplete ordered lesson: ${nextIncompleteLesson.title}.`,
      sourceEventId: stateByLessonId.get(nextIncompleteLesson.id)?.latestEventId ?? null,
      generatedAt,
      evidence: evidenceSummary,
    });
  }

  return createRecommendation({
    courseId: input.courseId,
    status: "complete",
    nextLessonId: null,
    reasonCode: "course-complete",
    rationale: "All ordered lessons with available evidence are complete.",
    sourceEventId: matchingEvidence.at(-1)?.id ?? null,
    generatedAt,
    evidence: evidenceSummary,
  });
}

export function createAdaptiveEvidenceFromXapiStatements(
  statements: XapiStatement[],
): AdaptiveLearningEvidence[] {
  return statements
    .map((statement): AdaptiveLearningEvidence | null => {
      const courseId =
        readStringExtension(statement, "course-id") ?? readActivitySegment(statement, "courses");
      if (!courseId) return null;
      const lessonId =
        readStringExtension(statement, "lesson-id") ??
        readLessonIdFromActivity(statement.object.id);
      const score = readStatementScore(statement);

      return {
        id: statement.id,
        courseId,
        ...(lessonId ? { lessonId } : {}),
        verb: normalizeEvidenceVerb(
          readStringExtension(statement, "event-type"),
          readLastPathSegment(statement.verb.id),
        ),
        timestamp: statement.timestamp,
        ...(score === undefined ? {} : { score }),
        ...(statement.result?.success === undefined ? {} : { success: statement.result.success }),
        ...(statement.result?.completion === undefined
          ? {}
          : { completion: statement.result.completion }),
        competencyIds: readCompetencyIds(statement),
      };
    })
    .filter((event): event is AdaptiveLearningEvidence => event !== null)
    .sort(compareEvidence);
}

function createLessonStateMap(lessons: AdaptiveLesson[], evidence: AdaptiveLearningEvidence[]) {
  const stateByLessonId = new Map<string, LessonState>();
  const lessonById = new Map(lessons.map((lesson) => [lesson.id, lesson]));

  for (const lesson of lessons) {
    stateByLessonId.set(lesson.id, {
      completed: false,
      latestEventId: null,
      lowScoreEvidence: null,
    });
  }

  for (const event of evidence) {
    if (!event.lessonId || !lessonById.has(event.lessonId)) continue;

    const lesson = lessonById.get(event.lessonId);
    const state = stateByLessonId.get(event.lessonId);
    if (!lesson || !state) continue;

    state.latestEventId = event.id;
    if (isCompletionEvidence(event)) {
      state.completed = true;
      state.lowScoreEvidence = null;
      continue;
    }

    if (isLowScoreEvidence(event, lesson)) {
      state.completed = false;
      state.lowScoreEvidence = event;
      continue;
    }

    if (isPassingEvidence(event, lesson)) {
      state.lowScoreEvidence = null;
    }
  }

  return stateByLessonId;
}

function summarizeEvidence(
  lessons: AdaptiveLesson[],
  evidence: AdaptiveLearningEvidence[],
  stateByLessonId: Map<string, LessonState>,
): AdaptiveRecommendation["evidence"] {
  const weakCompetencyIds = new Set<string>();

  for (const lesson of lessons) {
    const lowScoreEvidence = stateByLessonId.get(lesson.id)?.lowScoreEvidence;
    if (!lowScoreEvidence) continue;

    const competencyIds =
      lowScoreEvidence.competencyIds && lowScoreEvidence.competencyIds.length > 0
        ? lowScoreEvidence.competencyIds
        : lesson.competencyIds ?? [];

    for (const competencyId of competencyIds) {
      weakCompetencyIds.add(competencyId);
    }
  }

  return {
    consideredLessonCount: lessons.length,
    eventCount: evidence.length,
    latestEventId: evidence.at(-1)?.id ?? null,
    completedLessonIds: lessons
      .filter((lesson) => stateByLessonId.get(lesson.id)?.completed)
      .map((lesson) => lesson.id),
    weakCompetencyIds: [...weakCompetencyIds].sort(),
    rawResponsesOmitted: true,
    learnerIdentityOmitted: true,
  };
}

function createRecommendation(
  input: Omit<AdaptiveRecommendation, "target" | "rulesVersion">,
): AdaptiveRecommendation {
  return {
    target: "adaptive-recommendation",
    rulesVersion: ADAPTIVE_RECOMMENDATION_RULES_VERSION,
    ...input,
  };
}

function isCompletionEvidence(event: AdaptiveLearningEvidence) {
  return event.completion === true || event.verb === "completed";
}

function isLowScoreEvidence(event: AdaptiveLearningEvidence, lesson: AdaptiveLesson) {
  return event.score !== undefined && event.score < readMasteryThreshold(lesson);
}

function isPassingEvidence(event: AdaptiveLearningEvidence, lesson: AdaptiveLesson) {
  return (
    event.score !== undefined &&
    event.score >= readMasteryThreshold(lesson) &&
    event.success !== false
  );
}

function readMasteryThreshold(lesson: AdaptiveLesson) {
  return lesson.masteryThreshold ?? defaultMasteryThreshold;
}

function compareLessons(left: AdaptiveLesson, right: AdaptiveLesson) {
  return left.position - right.position || left.id.localeCompare(right.id);
}

function compareEvidence(left: AdaptiveLearningEvidence, right: AdaptiveLearningEvidence) {
  return left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id);
}

function readStringExtension(statement: XapiStatement, extensionName: "course-id" | "event-type" | "lesson-id") {
  const value = statement.context?.extensions?.[`https://uais.top/xapi/extensions/${extensionName}`];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readActivitySegment(statement: XapiStatement, segmentName: "courses") {
  const activities = [
    ...(statement.context?.contextActivities?.grouping ?? []),
    ...(statement.context?.contextActivities?.parent ?? []),
  ];
  const match = activities.find((activity) => activity.id.includes(`/activities/${segmentName}/`));
  if (!match) return null;
  return decodeURIComponent(readLastPathSegment(match.id));
}

function readLessonIdFromActivity(activityId: string) {
  const decoded = decodeURIComponent(activityId);
  const parts = decoded.split("/activities/").at(-1)?.split("/").filter(Boolean) ?? [];
  if (parts.length < 2) return null;
  return parts.at(-1) ?? null;
}

function normalizeEvidenceVerb(
  eventType: string | null,
  verbSegment: string,
): AdaptiveLearningEvidence["verb"] {
  const candidate = eventType?.split(".").at(-1) ?? verbSegment;
  if (
    candidate === "viewed" ||
    candidate === "attempted" ||
    candidate === "answered" ||
    candidate === "completed" ||
    candidate === "mastered" ||
    candidate === "requested" ||
    candidate === "interacted"
  ) {
    return candidate;
  }
  return "viewed";
}

function readStatementScore(statement: XapiStatement) {
  const score = statement.result?.score;
  if (!score) return undefined;
  if (typeof score.scaled === "number" && Number.isFinite(score.scaled)) {
    return clampScore(score.scaled);
  }
  if (
    typeof score.raw === "number" &&
    Number.isFinite(score.raw) &&
    typeof score.max === "number" &&
    Number.isFinite(score.max) &&
    score.max > 0
  ) {
    return clampScore(score.raw / score.max);
  }
  return undefined;
}

function readCompetencyIds(statement: XapiStatement) {
  return (statement.context?.contextActivities?.category ?? [])
    .map((activity) => decodeURIComponent(readLastPathSegment(activity.id)))
    .filter(Boolean)
    .sort();
}

function clampScore(value: number) {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

function readLastPathSegment(value: string) {
  return value.split("/").filter(Boolean).at(-1) ?? value;
}
