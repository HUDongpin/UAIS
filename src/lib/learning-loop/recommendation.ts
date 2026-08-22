import type { LearningSubmissionState } from "@/lib/learning-loop/domain";

export type LearningUnitEvidence = {
  lessonKey: string;
  position: number;
  checkpointAttempted: boolean;
  submissionState?: LearningSubmissionState;
};

export type NextLearningAction =
  | { type: "revise-submission"; lessonKey: string; reasonCode: "revision-requested" }
  | { type: "await-teacher-review"; lessonKey: string; reasonCode: "teacher-review-pending" }
  | { type: "complete-checkpoint"; lessonKey: string; reasonCode: "checkpoint-not-attempted" }
  | {
      type: "continue-draft" | "start-submission";
      lessonKey: string;
      reasonCode: "submission-draft-exists" | "submission-not-started";
    }
  | { type: "open-next-lesson"; lessonKey: string; reasonCode: "previous-unit-accepted" }
  | { type: "course-complete"; reasonCode: "all-required-units-accepted" }
  | { type: "collect-more-evidence"; reasonCode: "no-published-learning-units" | "evidence-inconsistent" };

export function recommendNextLearningAction(input: {
  units: LearningUnitEvidence[];
}): NextLearningAction {
  if (input.units.length === 0) {
    return { type: "collect-more-evidence", reasonCode: "no-published-learning-units" };
  }
  const units = [...input.units].sort((a, b) => a.position - b.position);
  if (
    units.some(
      (unit, index) =>
        !unit.lessonKey ||
        !Number.isInteger(unit.position) ||
        unit.position <= 0 ||
        (index > 0 && units[index - 1]?.position === unit.position),
    )
  ) {
    return { type: "collect-more-evidence", reasonCode: "evidence-inconsistent" };
  }

  const revision = units.find((unit) => unit.submissionState === "revision_requested");
  if (revision) {
    return {
      type: "revise-submission",
      lessonKey: revision.lessonKey,
      reasonCode: "revision-requested",
    };
  }
  const awaiting = units.find(
    (unit) => unit.submissionState === "submitted" || unit.submissionState === "resubmitted",
  );
  if (awaiting) {
    return {
      type: "await-teacher-review",
      lessonKey: awaiting.lessonKey,
      reasonCode: "teacher-review-pending",
    };
  }
  const checkpoint = units.find((unit) => !unit.checkpointAttempted);
  if (checkpoint) {
    return {
      type: "complete-checkpoint",
      lessonKey: checkpoint.lessonKey,
      reasonCode: "checkpoint-not-attempted",
    };
  }
  const unfinished = units.find((unit) => unit.submissionState !== "accepted");
  if (unfinished) {
    if (unfinished.submissionState === "draft") {
      return {
        type: "continue-draft",
        lessonKey: unfinished.lessonKey,
        reasonCode: "submission-draft-exists",
      };
    }
    if (!unfinished.submissionState) {
      return {
        type: "start-submission",
        lessonKey: unfinished.lessonKey,
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
      lessonKey: nextAfterAccepted.lessonKey,
      reasonCode: "previous-unit-accepted",
    };
  }
  return { type: "course-complete", reasonCode: "all-required-units-accepted" };
}
