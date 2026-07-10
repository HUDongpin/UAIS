import { createHash } from "node:crypto";
import type { XapiStatement } from "@/lib/learning-records/lrs-client";

export const LEARNER_PROFILE_RULES_VERSION = "xapi-profile-v1";

export type LearnerLessonProfile = {
  lessonId: string;
  eventCount: number;
  viewedCount: number;
  answeredCount: number;
  attemptedCount: number;
  completed: boolean;
  bestScore: number | null;
  averageScore: number | null;
  weakEvidenceCount: number;
  latestTimestamp: string;
  competencyIds: string[];
};

export type LearnerProfile = {
  target: "learner-profile";
  status: "ready" | "empty";
  learner: {
    fingerprint: string;
    valueRedacted: true;
    displayNameOmitted: true;
  };
  courseId: string | null;
  classActivityRef: string | null;
  eventCount: number;
  latestTimestamp: string | null;
  generatedAt: string;
  rulesVersion: typeof LEARNER_PROFILE_RULES_VERSION;
  progress: {
    activeLessonCount: number;
    completedLessonCount: number;
    completionRate: number;
    averageScore: number | null;
  };
  completedLessonIds: string[];
  masteredCompetencyIds: string[];
  weakCompetencyIds: string[];
  lessons: LearnerLessonProfile[];
  redaction: {
    rawResponsesOmitted: true;
    learnerDisplayNameOmitted: true;
    localFilesOmitted: true;
  };
};

export type LearnerProfileInput = {
  statements: XapiStatement[];
  courseId?: string;
  generatedAt?: string;
};

type LessonAccumulator = {
  lessonId: string;
  eventCount: number;
  viewedCount: number;
  answeredCount: number;
  attemptedCount: number;
  completed: boolean;
  scores: number[];
  weakEvidenceCount: number;
  latestTimestamp: string;
  competencyIds: Set<string>;
};

const weakScoreThreshold = 0.7;

export function createLearnerProfileFromXapiStatements(
  input: LearnerProfileInput,
): LearnerProfile {
  const statements = input.statements
    .filter((statement) => {
      const courseId = readCourseId(statement);
      return !input.courseId || courseId === input.courseId;
    })
    .sort(compareStatements);
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const learnerRef = readActorRef(statements[0]);
  const lessonById = new Map<string, LessonAccumulator>();
  const masteredCompetencyIds = new Set<string>();
  const allScores: number[] = [];

  for (const statement of statements) {
    for (const competencyId of readCompetencyIds(statement)) {
      if (isMasteredStatement(statement)) {
        masteredCompetencyIds.add(competencyId);
      }
    }

    const lessonId = readLessonId(statement);
    if (!lessonId) {
      continue;
    }

    const accumulator = getLessonAccumulator(lessonById, lessonId, statement.timestamp);
    const eventType = readEventType(statement);
    const score = readScaledScore(statement);
    accumulator.eventCount += 1;
    accumulator.latestTimestamp = maxTimestamp(accumulator.latestTimestamp, statement.timestamp);

    if (eventType === "lesson.viewed") {
      accumulator.viewedCount += 1;
    }
    if (eventType === "question.answered") {
      accumulator.answeredCount += 1;
    }
    if (eventType === "activity.attempted") {
      accumulator.attemptedCount += 1;
    }
    if (isCompletionStatement(statement)) {
      accumulator.completed = true;
    }
    if (score !== null) {
      accumulator.scores.push(score);
      allScores.push(score);
    }
    if (isWeakEvidence(statement, score)) {
      accumulator.weakEvidenceCount += 1;
    }
    for (const competencyId of readCompetencyIds(statement)) {
      accumulator.competencyIds.add(competencyId);
    }
  }

  const lessons = [...lessonById.values()].map(createLessonProfile).sort((left, right) =>
    left.lessonId.localeCompare(right.lessonId),
  );
  const weakCompetencyIds = new Set<string>();

  for (const lesson of lessons) {
    if (lesson.weakEvidenceCount === 0) continue;
    for (const competencyId of lesson.competencyIds) {
      weakCompetencyIds.add(competencyId);
    }
  }

  return {
    target: "learner-profile",
    status: statements.length === 0 ? "empty" : "ready",
    learner: {
      fingerprint: fingerprintValue(learnerRef ?? "unknown-learner"),
      valueRedacted: true,
      displayNameOmitted: true,
    },
    courseId: input.courseId ?? readCourseId(statements[0]) ?? null,
    classActivityRef: readClassActivityRef(statements),
    eventCount: statements.length,
    latestTimestamp: statements.at(-1)?.timestamp ?? null,
    generatedAt,
    rulesVersion: LEARNER_PROFILE_RULES_VERSION,
    progress: {
      activeLessonCount: lessons.length,
      completedLessonCount: lessons.filter((lesson) => lesson.completed).length,
      completionRate: createRate(
        lessons.filter((lesson) => lesson.completed).length,
        lessons.length,
      ),
      averageScore: average(allScores),
    },
    completedLessonIds: lessons
      .filter((lesson) => lesson.completed)
      .map((lesson) => lesson.lessonId),
    masteredCompetencyIds: [...masteredCompetencyIds].sort(),
    weakCompetencyIds: [...weakCompetencyIds].sort(),
    lessons,
    redaction: {
      rawResponsesOmitted: true,
      learnerDisplayNameOmitted: true,
      localFilesOmitted: true,
    },
  };
}

function getLessonAccumulator(
  lessonById: Map<string, LessonAccumulator>,
  lessonId: string,
  timestamp: string,
) {
  const current = lessonById.get(lessonId);
  if (current) {
    return current;
  }

  const next: LessonAccumulator = {
    lessonId,
    eventCount: 0,
    viewedCount: 0,
    answeredCount: 0,
    attemptedCount: 0,
    completed: false,
    scores: [],
    weakEvidenceCount: 0,
    latestTimestamp: timestamp,
    competencyIds: new Set(),
  };
  lessonById.set(lessonId, next);
  return next;
}

function createLessonProfile(accumulator: LessonAccumulator): LearnerLessonProfile {
  return {
    lessonId: accumulator.lessonId,
    eventCount: accumulator.eventCount,
    viewedCount: accumulator.viewedCount,
    answeredCount: accumulator.answeredCount,
    attemptedCount: accumulator.attemptedCount,
    completed: accumulator.completed,
    bestScore: accumulator.scores.length > 0 ? round(Math.max(...accumulator.scores)) : null,
    averageScore: average(accumulator.scores),
    weakEvidenceCount: accumulator.weakEvidenceCount,
    latestTimestamp: accumulator.latestTimestamp,
    competencyIds: [...accumulator.competencyIds].sort(),
  };
}

function compareStatements(left: XapiStatement, right: XapiStatement) {
  return left.timestamp.localeCompare(right.timestamp);
}

function readActorRef(statement: XapiStatement | undefined) {
  return statement?.actor.account?.name ?? statement?.actor.name;
}

function readEventType(statement: XapiStatement) {
  const value = statement.context?.extensions?.["https://uais.top/xapi/extensions/event-type"];
  return typeof value === "string" ? value : undefined;
}

function readCourseId(statement: XapiStatement | undefined) {
  const value = statement?.context?.extensions?.["https://uais.top/xapi/extensions/course-id"];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return readActivitySegment(statement, "courses");
}

function readLessonId(statement: XapiStatement) {
  const value = statement.context?.extensions?.["https://uais.top/xapi/extensions/lesson-id"];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return readActivitySegment(statement, "lessons") ?? readLessonIdFromActivity(statement.object.id);
}

function readActivitySegment(statement: XapiStatement | undefined, segment: string) {
  const refs = [
    statement?.object.id,
    ...(statement?.context?.contextActivities?.grouping?.map((item) => item.id) ?? []),
  ].filter((value): value is string => Boolean(value));

  for (const ref of refs) {
    const parts = ref.split("/");
    const segmentIndex = parts.findIndex((part) => part === segment);
    if (segmentIndex >= 0 && parts[segmentIndex + 1]) {
      return decodeURIComponent(parts[segmentIndex + 1]);
    }
  }
  return undefined;
}

function readLessonIdFromActivity(activityId: string) {
  const parts = activityId.split("/").filter(Boolean);
  const last = parts.at(-1);
  if (!last) return undefined;
  return decodeURIComponent(last);
}

function readClassActivityRef(statements: XapiStatement[]) {
  for (const statement of statements) {
    const classRef = statement.context?.contextActivities?.parent?.[0]?.id;
    if (classRef) {
      return classRef;
    }
  }
  return null;
}

function readCompetencyIds(statement: XapiStatement) {
  return (
    statement.context?.contextActivities?.category
      ?.map((item) => decodeURIComponent(item.id.split("/").at(-1) ?? item.id))
      .filter(Boolean) ?? []
  );
}

function readScaledScore(statement: XapiStatement) {
  const score = statement.result?.score;
  if (typeof score?.scaled === "number") {
    return score.scaled;
  }
  if (
    typeof score?.raw === "number" &&
    typeof score.max === "number" &&
    score.max > 0
  ) {
    return score.raw / score.max;
  }
  return null;
}

function isCompletionStatement(statement: XapiStatement) {
  return statement.result?.completion === true || statement.verb.id.endsWith("/completed");
}

function isMasteredStatement(statement: XapiStatement) {
  return statement.verb.id.endsWith("/mastered");
}

function isWeakEvidence(statement: XapiStatement, score: number | null) {
  if (score !== null && score < weakScoreThreshold) {
    return true;
  }
  return statement.result?.success === false;
}

function createRate(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : round(numerator / denominator);
}

function average(values: number[]) {
  if (values.length === 0) {
    return null;
  }
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function round(value: number) {
  return Number(value.toFixed(2));
}

function maxTimestamp(left: string, right: string) {
  return left.localeCompare(right) >= 0 ? left : right;
}

function fingerprintValue(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
