import {
  createLearningFeedbackDraftGenerator,
  type LearningFeedbackGenerationInput,
} from "@/lib/learning-loop/ai-feedback";
import {
  LearningLoopStoreError,
  createUaisLearningLoopPostgresStore,
  type LearningLoopPersistedReceipt,
} from "@/lib/learning-loop/postgres-store";
import { createUaisLearningLoopPostgresReadStore } from "@/lib/learning-loop/postgres-read-store";
import type { LearningLoopTeacherCourseAccess } from "@/lib/server/learning-loop-access";
import {
  createLearningLoopAccessDeniedResponse,
  createLearningLoopErrorResponse,
  createLearningLoopJsonResponse,
  readLearningLoopIdempotencyKey,
  readLearningLoopJsonBody,
  readLearningLoopRecord,
  readLearningLoopRevision,
  readLearningLoopTraceId,
} from "@/lib/server/learning-loop-route-http";
import {
  authorizeLearningLoopTeacherSubmission,
  type LearningLoopTeacherSubmissionScope,
} from "@/lib/server/learning-loop-teacher-route";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ submissionId: string }>;
};

type GeneratedDraft = Awaited<
  ReturnType<ReturnType<typeof createLearningFeedbackDraftGenerator>["generate"]>
>;

type PostDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
  readSubmissionScope?: (input: {
    submissionId: string;
  }) => Promise<LearningLoopTeacherSubmissionScope>;
  authorize?: (input: {
    request: Request;
    env: Record<string, string | undefined>;
    now?: Date;
    fetch?: typeof fetch;
    courseId: string;
    lessonKey?: string;
  }) => Promise<LearningLoopTeacherCourseAccess>;
  readTeacherSubmission?: (input: {
    teacherAccount: string;
    submissionId: string;
  }) => Promise<Record<string, unknown>>;
  generate?: (input: LearningFeedbackGenerationInput) => Promise<GeneratedDraft>;
  reserveAiFeedbackRequest?: (input: {
    teacherAccount: string;
    submissionId: string;
    expectedSubmissionVersionId: string;
    expectedFeedbackRevision: number;
    idempotencyKey: string;
    traceId: string;
  }) => Promise<
    | { status: "reserved"; requestHash: string }
    | {
        status: "completed";
        requestHash: string;
        receipt: LearningLoopPersistedReceipt;
      }
  >;
  failAiFeedbackRequest?: (input: {
    teacherAccount: string;
    idempotencyKey: string;
    requestHash: string;
    errorCategory: string;
    traceId: string;
  }) => Promise<void>;
  saveFeedbackDraft?: (input: {
    teacherAccount: string;
    submissionId: string;
    expectedSubmissionVersionId: string;
    expectedFeedbackRevision: number;
    feedbackText: string;
    rubricJudgments: unknown;
    origin: "ai-assisted";
    aiTraceRef: string;
    aiRequest: { idempotencyKey: string; requestHash: string };
    traceId: string;
  }) => Promise<LearningLoopPersistedReceipt>;
};

export const POST = Object.assign(createAiFeedbackDraftPostHandler(), {
  createForTesting: createAiFeedbackDraftPostHandler,
});

function createAiFeedbackDraftPostHandler(deps: PostDeps = {}) {
  const env = deps.env ?? process.env;
  return async function POST(request: Request, context: RouteContext) {
    const traceId = readLearningLoopTraceId(request);
    try {
      const { submissionId } = await context.params;
      const body = readLearningLoopRecord(await readLearningLoopJsonBody(request));
      const expectedSubmissionVersionId = readRequiredString(
        body.expectedSubmissionVersionId,
        "submission-version-required",
      );
      const expectedFeedbackRevision = readLearningLoopRevision(
        body.expectedFeedbackRevision,
        "feedback-draft-revision-required",
      );
      const idempotencyKey = readLearningLoopIdempotencyKey(request);
      const { access, scope } = await authorizeLearningLoopTeacherSubmission({
        request,
        env,
        now: deps.now,
        fetch: deps.fetch,
        submissionId,
        readSubmissionScope: deps.readSubmissionScope,
        authorize: deps.authorize,
      });
      if (access.status === "denied") {
        return createLearningLoopAccessDeniedResponse(access.reasonCode, traceId);
      }
      if (expectedSubmissionVersionId !== scope.currentVersionId) {
        throw new LearningLoopStoreError(409, "stale-submission-version", {
          latestSubmissionVersionId: scope.currentVersionId,
          recoveryAction: "reload-submission",
        });
      }
      const readStore = deps.readTeacherSubmission
        ? undefined
        : createUaisLearningLoopPostgresReadStore({ env });
      const readTeacherSubmission =
        deps.readTeacherSubmission ?? readStore!.readTeacherSubmission;
      const submission = await readTeacherSubmission({
        teacherAccount: access.teacherAccount,
        submissionId,
      });
      const generationInput = createGenerationInput({
        submission,
        expectedSubmissionVersionId,
        traceId,
      });
      const commandStore =
        deps.reserveAiFeedbackRequest &&
        deps.failAiFeedbackRequest &&
        deps.saveFeedbackDraft
          ? undefined
          : createUaisLearningLoopPostgresStore({ env });
      const reservation = await (
        deps.reserveAiFeedbackRequest ?? commandStore!.reserveAiFeedbackRequest
      )({
        teacherAccount: access.teacherAccount,
        submissionId,
        expectedSubmissionVersionId,
        expectedFeedbackRevision,
        idempotencyKey,
        traceId,
      });
      if (reservation.status === "completed") {
        return createLearningLoopJsonResponse(200, traceId, {
          status: "persisted",
          receipt: reservation.receipt,
          submission,
          replayed: true,
          traceId,
        });
      }
      let phase = "provider-request-failed";
      try {
        const generate =
          deps.generate ??
          createLearningFeedbackDraftGenerator({ env, fetch: deps.fetch }).generate;
        const draft = await generate(generationInput);
        phase = "feedback-persistence-failed";
        const receipt = await (
          deps.saveFeedbackDraft ?? commandStore!.saveFeedbackDraft
        )({
          teacherAccount: access.teacherAccount,
          submissionId,
          expectedSubmissionVersionId,
          expectedFeedbackRevision,
          feedbackText: draft.feedbackText,
          rubricJudgments: draft.rubricJudgments,
          origin: "ai-assisted",
          aiTraceRef: draft.aiTraceRef,
          aiRequest: { idempotencyKey, requestHash: reservation.requestHash },
          traceId,
        });
        const readback = await readTeacherSubmission({
          teacherAccount: access.teacherAccount,
          submissionId,
        });
        return createLearningLoopJsonResponse(200, traceId, {
          status: "persisted",
          receipt,
          draft: {
            origin: draft.origin,
            rubricJudgments: draft.rubricJudgments,
            feedbackText: draft.feedbackText,
            provider: draft.provider,
            model: draft.model,
            ...(draft.usage ? { usage: draft.usage } : {}),
          },
          submission: readback,
          traceId,
        });
      } catch (error) {
        await (
          deps.failAiFeedbackRequest ?? commandStore!.failAiFeedbackRequest
        )({
          teacherAccount: access.teacherAccount,
          idempotencyKey,
          requestHash: reservation.requestHash,
          errorCategory: phase,
          traceId,
        }).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      return createLearningLoopErrorResponse(
        error,
        traceId,
        "ai-feedback-draft-generation-failed",
      );
    }
  };
}

function createGenerationInput(input: {
  submission: Record<string, unknown>;
  expectedSubmissionVersionId: string;
  traceId: string;
}): LearningFeedbackGenerationInput {
  const activity = readRecord(input.submission.activity);
  if (activity.aiPolicy !== "teacher-requested-draft") {
    throw new LearningLoopStoreError(409, "activity-ai-feedback-disabled");
  }
  const versions = readArray(input.submission.versions);
  const currentVersion = versions
    .map(readRecord)
    .find((item) => item.id === input.expectedSubmissionVersionId);
  if (!currentVersion || currentVersion.status === "draft") {
    throw new LearningLoopStoreError(409, "sealed-submission-version-required");
  }
  const feedback = readArray(input.submission.feedback)
    .map(readRecord)
    .filter(
      (item) =>
        (item.status === "released" || item.status === "superseded") &&
        item.submissionVersionId !== input.expectedSubmissionVersionId,
    );
  return {
    activity: {
      title: readRecord(activity.title),
      instructions: readRecord(activity.instructions),
      rubric: readArray(activity.rubric),
    },
    submission: {
      versionId: input.expectedSubmissionVersionId,
      contentText: readRequiredString(
        currentVersion.contentText,
        "submission-content-required",
      ),
    },
    previousReleasedFeedback: feedback
      .map((item) => (typeof item.feedbackText === "string" ? item.feedbackText : ""))
      .filter(Boolean)
      .slice(-1),
    traceId: input.traceId,
  };
}

function readRequiredString(value: unknown, reasonCode: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new LearningLoopStoreError(400, reasonCode);
  }
  return value;
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
