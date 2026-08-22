export const learningLoopLocales = ["zh-CN", "en-US"] as const;
export type LearningLoopLocale = (typeof learningLoopLocales)[number];
export type BilingualText = Record<LearningLoopLocale, string>;

export const rubricJudgmentStates = [
  "not-reviewed",
  "met",
  "partly-met",
  "needs-revision",
] as const;
export type RubricJudgmentState = (typeof rubricJudgmentStates)[number];

export const learningActivityStates = ["draft", "published", "archived"] as const;
export type LearningActivityState = (typeof learningActivityStates)[number];

export const learningSubmissionStates = [
  "draft",
  "submitted",
  "revision_requested",
  "resubmitted",
  "accepted",
] as const;
export type LearningSubmissionState = (typeof learningSubmissionStates)[number];

export type LearningRubricDimension = {
  id: string;
  label: BilingualText;
};

export type LearningFormativeCheckpoint =
  | {
      kind: "single-choice";
      prompt: BilingualText;
      options: Array<{ id: string; label: BilingualText }>;
      correctOptionId: string;
      explanation: BilingualText;
    }
  | {
      kind: "short-answer";
      prompt: BilingualText;
      explanation: BilingualText;
    };

export type LearningActivityDraft = {
  lessonKey: string;
  targetClassId: string;
  title: BilingualText;
  instructions: BilingualText;
  checkpoint: LearningFormativeCheckpoint;
  rubric: LearningRubricDimension[];
  dueAt?: string;
  aiPolicy: "teacher-requested-draft" | "disabled";
  revisionPolicy: "teacher-requested";
  status: "draft";
  version: 1;
};

export class LearningLoopValidationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "LearningLoopValidationError";
    this.code = code;
  }
}

export function normalizeLearningActivityDraft(value: unknown): LearningActivityDraft {
  const input = requireRecord(value, "activity-body-invalid");
  const rubricInput = input.rubric;
  if (!Array.isArray(rubricInput) || rubricInput.length < 3 || rubricInput.length > 5) {
    throw new LearningLoopValidationError("activity-rubric-count-invalid");
  }

  const rubric = rubricInput.map((entry, index) => {
    const dimension = requireRecord(entry, "activity-rubric-invalid");
    return {
      id: requireSafeId(dimension.id, `activity-rubric-${index + 1}-id-invalid`),
      label: requireBilingualText(
        dimension.label,
        `activity-rubric-${index + 1}-label-bilingual-required`,
      ),
    };
  });
  if (new Set(rubric.map((item) => item.id)).size !== rubric.length) {
    throw new LearningLoopValidationError("activity-rubric-id-duplicate");
  }

  return {
    lessonKey: requireSafeId(input.lessonKey, "activity-lesson-key-invalid"),
    targetClassId: requireSafeId(input.targetClassId, "activity-target-class-invalid"),
    title: requireBilingualText(input.title, "activity-title-bilingual-required"),
    instructions: requireBilingualText(
      input.instructions,
      "activity-instructions-bilingual-required",
    ),
    checkpoint: normalizeCheckpoint(input.checkpoint),
    rubric,
    ...(input.dueAt === undefined || input.dueAt === null || input.dueAt === ""
      ? {}
      : { dueAt: requireIsoTimestamp(input.dueAt, "activity-due-at-invalid") }),
    aiPolicy: normalizeAiPolicy(input.aiPolicy),
    revisionPolicy: normalizeRevisionPolicy(input.revisionPolicy),
    status: "draft",
    version: 1,
  };
}

export function normalizeSubmissionContent(value: unknown) {
  if (typeof value !== "string") {
    throw new LearningLoopValidationError("submission-content-required");
  }
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    throw new LearningLoopValidationError("submission-content-required");
  }
  if (Array.from(normalized).length > 20_000) {
    throw new LearningLoopValidationError("submission-content-too-long");
  }
  if (/<\/?[a-z][^>]*>/i.test(normalized)) {
    throw new LearningLoopValidationError("submission-content-html-forbidden");
  }
  if (/!\[[^\]]*\]\([^)]*\)/.test(normalized)) {
    throw new LearningLoopValidationError("submission-content-embed-forbidden");
  }
  if (/\u0000|[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)) {
    throw new LearningLoopValidationError("submission-content-control-character-forbidden");
  }
  return normalized;
}

const activityTransitions: Record<LearningActivityState, ReadonlySet<LearningActivityState>> = {
  draft: new Set(["published"]),
  published: new Set(["archived"]),
  archived: new Set(),
};

export function assertLearningActivityTransition(
  from: LearningActivityState,
  to: LearningActivityState,
) {
  if (!activityTransitions[from]?.has(to)) {
    throw new LearningLoopValidationError("activity-transition-invalid");
  }
}

export function assertSubmissionTransition(input: {
  from: LearningSubmissionState;
  to: LearningSubmissionState;
  versionNo: number;
  previousVersionNo?: number;
}) {
  const isFirstSubmit =
    input.from === "draft" && input.to === "submitted" && input.versionNo === 1;
  const isResubmit =
    input.from === "draft" && input.to === "resubmitted" && input.versionNo > 1;
  const isRevisionDecision =
    (input.from === "submitted" || input.from === "resubmitted") &&
    input.to === "revision_requested";
  const isAcceptDecision =
    (input.from === "submitted" || input.from === "resubmitted") && input.to === "accepted";
  const isNewRevisionDraft =
    input.from === "revision_requested" &&
    input.to === "draft" &&
    input.previousVersionNo !== undefined &&
    input.versionNo === input.previousVersionNo + 1;

  if (
    !isFirstSubmit &&
    !isResubmit &&
    !isRevisionDecision &&
    !isAcceptDecision &&
    !isNewRevisionDraft
  ) {
    throw new LearningLoopValidationError("submission-transition-invalid");
  }
}

export function assertSubmissionDecision(input: {
  decision: "request-revision" | "accept";
  feedbackText: unknown;
}) {
  if (typeof input.feedbackText !== "string" || !input.feedbackText.trim()) {
    throw new LearningLoopValidationError("decision-feedback-required");
  }
  return {
    decision: input.decision,
    feedbackText: input.feedbackText.trim(),
  };
}

export function normalizeRubricJudgments(
  value: unknown,
  rubricDimensionIds: string[],
): Record<string, RubricJudgmentState> {
  const judgments = requireRecord(value, "feedback-rubric-judgments-invalid");
  const expectedIds = rubricDimensionIds.map((id) =>
    requireSafeId(id, "feedback-rubric-dimension-id-invalid"),
  );
  if (
    new Set(expectedIds).size !== expectedIds.length ||
    Object.keys(judgments).length !== expectedIds.length ||
    Object.keys(judgments).some((id) => !expectedIds.includes(id))
  ) {
    throw new LearningLoopValidationError("feedback-rubric-dimensions-mismatch");
  }
  return Object.fromEntries(
    expectedIds.map((id) => {
      const judgment = judgments[id];
      if (!rubricJudgmentStates.includes(judgment as RubricJudgmentState)) {
        throw new LearningLoopValidationError("feedback-rubric-judgment-invalid");
      }
      return [id, judgment as RubricJudgmentState];
    }),
  );
}

function normalizeCheckpoint(value: unknown): LearningFormativeCheckpoint {
  const checkpoint = requireRecord(value, "activity-checkpoint-invalid");
  const prompt = requireBilingualText(
    checkpoint.prompt,
    "activity-checkpoint-prompt-bilingual-required",
  );
  const explanation = requireBilingualText(
    checkpoint.explanation,
    "activity-checkpoint-explanation-bilingual-required",
  );
  if (checkpoint.kind === "short-answer") {
    return { kind: "short-answer", prompt, explanation };
  }
  if (checkpoint.kind !== "single-choice") {
    throw new LearningLoopValidationError("activity-checkpoint-kind-invalid");
  }
  if (!Array.isArray(checkpoint.options) || checkpoint.options.length < 2 || checkpoint.options.length > 8) {
    throw new LearningLoopValidationError("activity-checkpoint-options-invalid");
  }
  const options = checkpoint.options.map((entry, index) => {
    const option = requireRecord(entry, "activity-checkpoint-option-invalid");
    return {
      id: requireSafeId(option.id, `activity-checkpoint-option-${index + 1}-id-invalid`),
      label: requireBilingualText(
        option.label,
        `activity-checkpoint-option-${index + 1}-label-bilingual-required`,
      ),
    };
  });
  if (new Set(options.map((option) => option.id)).size !== options.length) {
    throw new LearningLoopValidationError("activity-checkpoint-option-id-duplicate");
  }
  const correctOptionId = requireSafeId(
    checkpoint.correctOptionId,
    "activity-checkpoint-correct-option-invalid",
  );
  if (!options.some((option) => option.id === correctOptionId)) {
    throw new LearningLoopValidationError("activity-checkpoint-correct-option-missing");
  }
  return {
    kind: "single-choice",
    prompt,
    options,
    correctOptionId,
    explanation,
  };
}

function requireBilingualText(value: unknown, code: string): BilingualText {
  const input = requireRecord(value, code);
  const zh = typeof input["zh-CN"] === "string" ? input["zh-CN"].trim() : "";
  const en = typeof input["en-US"] === "string" ? input["en-US"].trim() : "";
  if (!zh || !en) {
    throw new LearningLoopValidationError(code);
  }
  return { "zh-CN": zh, "en-US": en };
}

function requireSafeId(value: unknown, code: string) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 160 ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
  ) {
    throw new LearningLoopValidationError(code);
  }
  return value;
}

function requireIsoTimestamp(value: unknown, code: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new LearningLoopValidationError(code);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new LearningLoopValidationError(code);
  }
  return new Date(timestamp).toISOString();
}

function normalizeAiPolicy(value: unknown): LearningActivityDraft["aiPolicy"] {
  if (value === "disabled" || value === "teacher-requested-draft") {
    return value;
  }
  throw new LearningLoopValidationError("activity-ai-policy-invalid");
}

function normalizeRevisionPolicy(value: unknown): LearningActivityDraft["revisionPolicy"] {
  if (value === "teacher-requested") {
    return value;
  }
  throw new LearningLoopValidationError("activity-revision-policy-invalid");
}

function requireRecord(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new LearningLoopValidationError(code);
  }
  return value as Record<string, unknown>;
}
