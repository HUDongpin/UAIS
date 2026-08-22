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
  decideSubmission?: (input: {
    teacherAccount: string;
    submissionId: string;
    expectedSubmissionVersionId: string;
    decision: "request-revision" | "accept";
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

export const POST = Object.assign(createTeacherSubmissionDecisionPostHandler(), {
  createForTesting: createTeacherSubmissionDecisionPostHandler,
});

function createTeacherSubmissionDecisionPostHandler(deps: PostDeps = {}) {
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
      const decision = readDecision(body.decision);
      const feedbackText = readRequiredString(
        body.feedbackText,
        "decision-feedback-required",
      );
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
      if (expectedSubmissionVersionId !== scope.currentVersionId) {
        throw new LearningLoopStoreError(409, "stale-submission-version", {
          latestSubmissionVersionId: scope.currentVersionId,
          recoveryAction: "reload-submission",
        });
      }
      const commandStore = deps.decideSubmission
        ? undefined
        : createUaisLearningLoopPostgresStore({ env });
      const receipt = await (
        deps.decideSubmission ?? commandStore!.decideSubmission
      )({
        teacherAccount: access.teacherAccount,
        submissionId,
        expectedSubmissionVersionId,
        decision,
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
        "teacher-submission-decision-failed",
      );
    }
  };
}

function readRequiredString(value: unknown, reasonCode: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new LearningLoopStoreError(400, reasonCode);
  }
  return value;
}

function readDecision(value: unknown): "request-revision" | "accept" {
  if (value === "request-revision" || value === "accept") return value;
  throw new LearningLoopStoreError(400, "submission-decision-invalid");
}

function readOrigin(value: unknown): "teacher" | "ai-assisted" {
  if (value === "teacher" || value === "ai-assisted") return value;
  throw new LearningLoopStoreError(400, "feedback-origin-invalid");
}
