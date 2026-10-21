import type { LearningSubmissionState } from "@/lib/learning-loop/domain";

export type LearningUnitEvidence = {
  lessonKey: string;
  activityId?: string;
  position: number;
  checkpointAttempted: boolean;
  submissionState?: LearningSubmissionState;
};

export type NextLearningAction =
  | ({ lessonKey: string; activityId?: string } & (
    | { type: "revise-submission"; reasonCode: "revision-requested" }
    | { type: "await-teacher-review"; reasonCode: "teacher-review-pending" }
    | { type: "complete-checkpoint"; reasonCode: "checkpoint-not-attempted" }
    | {
      type: "continue-draft" | "start-submission";
      reasonCode: "submission-draft-exists" | "submission-not-started";
    }
    | { type: "open-next-lesson"; reasonCode: "previous-unit-accepted" }
  ))
  | { type: "course-complete"; reasonCode: "all-required-units-accepted" }
  | { type: "collect-more-evidence"; reasonCode: "no-published-learning-units" | "evidence-inconsistent" };

export function recommendNextLearningAction(input: {
  units: LearningUnitEvidence[];
}): NextLearningAction {
  if (input.units.length === 0) {
    return { type: "collect-more-evidence", reasonCode: "no-published-learning-units" };
  }
  const units = [...input.units].sort((a, b) =>
    a.position - b.position || (a.activityId ?? "").localeCompare(b.activityId ?? ""),
  );
  const activityIds = new Set<string>();
  if (
    units.some(
      (unit, index) => {
        const previous = units[index - 1];
        if (
          !unit.lessonKey ||
          !Number.isInteger(unit.position) ||
          unit.position <= 0 ||
          (unit.activityId !== undefined && !unit.activityId.trim()) ||
          (unit.activityId && activityIds.has(unit.activityId)) ||
          (previous?.position === unit.position && (
            previous.lessonKey !== unit.lessonKey ||
            !previous.activityId || !unit.activityId
          ))
        ) {
          return true;
        }
        if (unit.activityId) activityIds.add(unit.activityId);
        return false;
      },
    )
  ) {
    return { type: "collect-more-evidence", reasonCode: "evidence-inconsistent" };
  }

  const revision = units.find((unit) => unit.submissionState === "revision_requested");
  if (revision) {
    return {
      type: "revise-submission",
      ...learningActionTarget(revision),
      reasonCode: "revision-requested",
    };
  }
  const awaiting = units.find(
    (unit) => unit.submissionState === "submitted" || unit.submissionState === "resubmitted",
  );
  if (awaiting) {
    return {
      type: "await-teacher-review",
      ...learningActionTarget(awaiting),
      reasonCode: "teacher-review-pending",
    };
  }
  const checkpoint = units.find((unit) => !unit.checkpointAttempted);
  if (checkpoint) {
    return {
      type: "complete-checkpoint",
      ...learningActionTarget(checkpoint),
      reasonCode: "checkpoint-not-attempted",
    };
  }
  const unfinished = units.find((unit) => unit.submissionState !== "accepted");
  if (unfinished) {
    if (unfinished.submissionState === "draft") {
      return {
        type: "continue-draft",
        ...learningActionTarget(unfinished),
        reasonCode: "submission-draft-exists",
      };
    }
    if (!unfinished.submissionState) {
      return {
        type: "start-submission",
        ...learningActionTarget(unfinished),
        reasonCode: "submission-not-started",
      };
    }
    return { type: "collect-more-evidence", reasonCode: "evidence-inconsistent" };
  }

  const nextAfterAccepted = units.find((unit, index) => {
    const previous = units[index - 1];
    return Boolean(previous?.submissionState === "accepted" && unit.submissionState !== "accepted");
  });
  if (nextAfterAccepted) {
    return {
      type: "open-next-lesson",
      ...learningActionTarget(nextAfterAccepted),
      reasonCode: "previous-unit-accepted",
    };
  }
  return { type: "course-complete", reasonCode: "all-required-units-accepted" };
}

function learningActionTarget(unit: LearningUnitEvidence) {
  return {
    lessonKey: unit.lessonKey,
    ...(unit.activityId ? { activityId: unit.activityId } : {}),
  };
}
