import type { XapiStatement } from "@/lib/learning-records/lrs-client";

export type LearnerTimelineSummary = {
  target: "learner-timeline";
  actorRef: string;
  eventCount: number;
  latestTimestamp: string | null;
  completedCount: number;
  masteredCompetencies: string[];
  rawResponsesOmitted: true;
};

export type TeacherClassInsightsSummary = {
  target: "teacher-class-insights";
  classActivityRef: string | null;
  learnerCount: number;
  eventCount: number;
  completionRate: number;
  competencyMastery: Array<{
    competencyRef: string;
    masteredCount: number;
    evidenceCount: number;
  }>;
  recommendedActions: string[];
  rawResponsesOmitted: true;
};

export function summarizeLearnerTimeline(
  statements: XapiStatement[],
): LearnerTimelineSummary {
  const sorted = [...statements].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp),
  );
  const latest = sorted.at(-1);
  const masteredCompetencies = new Set<string>();

  for (const statement of statements) {
    if (!isMasteredStatement(statement)) continue;
    for (const competencyRef of readCompetencyRefs(statement)) {
      masteredCompetencies.add(readLastPathSegment(competencyRef));
    }
  }

  return {
    target: "learner-timeline",
    actorRef: readActorRef(statements[0]) ?? "unknown",
    eventCount: statements.length,
    latestTimestamp: latest?.timestamp ?? null,
    completedCount: statements.filter((statement) => statement.result?.completion).length,
    masteredCompetencies: [...masteredCompetencies].sort(),
    rawResponsesOmitted: true,
  };
}

export function summarizeTeacherClassInsights(
  statements: XapiStatement[],
): TeacherClassInsightsSummary {
  const learners = new Set<string>();
  const competencyEvidence = new Map<
    string,
    {
      masteredCount: number;
      evidenceCount: number;
    }
  >();

  for (const statement of statements) {
    const actorRef = readActorRef(statement);
    if (actorRef) {
      learners.add(actorRef);
    }
    for (const competencyRef of readCompetencyRefs(statement)) {
      const current = competencyEvidence.get(competencyRef) ?? {
        masteredCount: 0,
        evidenceCount: 0,
      };
      current.evidenceCount += 1;
      if (isMasteredStatement(statement)) {
        current.masteredCount += 1;
      }
      competencyEvidence.set(competencyRef, current);
    }
  }

  const completedCount = statements.filter((statement) => statement.result?.completion).length;
  const completionRate =
    statements.length === 0 ? 0 : Number((completedCount / statements.length).toFixed(2));
  const competencyMastery = [...competencyEvidence.entries()]
    .map(([competencyRef, value]) => ({
      competencyRef,
      masteredCount: value.masteredCount,
      evidenceCount: value.evidenceCount,
    }))
    .sort((left, right) => left.competencyRef.localeCompare(right.competencyRef));

  return {
    target: "teacher-class-insights",
    classActivityRef: readClassActivityRef(statements),
    learnerCount: learners.size,
    eventCount: statements.length,
    completionRate,
    competencyMastery,
    recommendedActions: createRecommendedActions({
      completionRate,
      competencyMastery,
    }),
    rawResponsesOmitted: true,
  };
}

function createRecommendedActions(input: {
  completionRate: number;
  competencyMastery: TeacherClassInsightsSummary["competencyMastery"];
}) {
  if (
    input.completionRate >= 0.8 &&
    input.competencyMastery.some((item) => item.masteredCount > 0)
  ) {
    return [
      "Use the mastered competency as peer-explanation evidence before the next task.",
    ];
  }
  if (input.competencyMastery.some((item) => item.evidenceCount > item.masteredCount)) {
    return ["Schedule a short reteach activity for the weakest competency cluster."];
  }
  return ["Collect more targeted evidence before changing the teaching plan."];
}

function readActorRef(statement: XapiStatement | undefined) {
  return statement?.actor.account?.name;
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

function readCompetencyRefs(statement: XapiStatement) {
  return statement.context?.contextActivities?.category?.map((item) => item.id) ?? [];
}

function isMasteredStatement(statement: XapiStatement) {
  return statement.verb.id.endsWith("/mastered");
}

function readLastPathSegment(value: string) {
  const [lastSegment] = value.split("/").reverse();
  return lastSegment ?? value;
}
