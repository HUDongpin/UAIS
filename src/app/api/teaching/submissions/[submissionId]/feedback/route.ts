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

type PutDeps = {
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
  saveFeedbackDraft?: (input: {
    teacherAccount: string;
    submissionId: string;
    expectedSubmissionVersionId: string;
    expectedFeedbackRevision: number;
    feedbackText: string;
    rubricJudgments: unknown;
    origin: "teacher" | "ai-assisted";
    aiTraceRef?: string;
    idempotencyKey: string;
    traceId: string;
  }) => Promise<LearningLoopPersistedReceipt>;
  readTeacherSubmission?: (input: {
    teacherAccount: string;
    submissionId: string;
  }) => Promise<Record<string, unknown>>;
};

export const PUT = Object.assign(createTeacherFeedbackPutHandler(), {
  createForTesting: createTeacherFeedbackPutHandler,
});

function createTeacherFeedbackPutHandler(deps: PutDeps = {}) {
  const env = deps.env ?? process.env;
  return async function PUT(request: Request, context: RouteContext) {
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
      const feedbackText = readRequiredString(body.feedbackText, "feedback-text-invalid", true);
      const origin = readOrigin(body.origin);
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
      assertCurrentVersion(expectedSubmissionVersionId, scope.currentVersionId);
      const commandStore = deps.saveFeedbackDraft
        ? undefined
        : createUaisLearningLoopPostgresStore({ env });
      const receipt = await (
        deps.saveFeedbackDraft ?? commandStore!.saveFeedbackDraft
      )({
        teacherAccount: access.teacherAccount,
        submissionId,
        expectedSubmissionVersionId,
        expectedFeedbackRevision,
        feedbackText,
        rubricJudgments: body.rubricJudgments,
        origin,
        ...(typeof body.aiTraceRef === "string"
          ? { aiTraceRef: body.aiTraceRef }
          : {}),
        idempotencyKey,
        traceId,
      });
      const readStore = deps.readTeacherSubmission
        ? undefined
        : createUaisLearningLoopPostgresReadStore({ env });
      const submission = await (
        deps.readTeacherSubmission ?? readStore!.readTeacherSubmission
      )({ teacherAccount: access.teacherAccount, submissionId });
      return createLearningLoopJsonResponse(200, traceId, {
        status: "persisted",
        receipt,
        submission,
        traceId,
      });
    } catch (error) {
      return createLearningLoopErrorResponse(
        error,
        traceId,
        "teacher-feedback-draft-save-failed",
      );
    }
  };
}

function readRequiredString(value: unknown, reasonCode: string, allowEmpty = false) {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new LearningLoopStoreError(400, reasonCode);
  }
  return value;
}

function readOrigin(value: unknown): "teacher" | "ai-assisted" {
  if (value === "teacher" || value === "ai-assisted") return value;
  throw new LearningLoopStoreError(400, "feedback-origin-invalid");
}

function assertCurrentVersion(expected: string, current: string) {
  if (expected !== current) {
    throw new LearningLoopStoreError(409, "stale-submission-version", {
      latestSubmissionVersionId: current,
      recoveryAction: "reload-submission",
    });
  }
}
