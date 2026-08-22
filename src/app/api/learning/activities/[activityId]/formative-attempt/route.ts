import {
  createUaisLearningLoopPostgresStore,
  type LearningLoopPersistedReceipt,
} from "@/lib/learning-loop/postgres-store";
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
  authorizeLearningLoopStudentActivity,
  type LearningLoopActivityScope,
  type LearningLoopStudentAccess,
} from "@/lib/server/learning-loop-student-route";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ activityId: string }>;
};

type PostDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
  readActivityScope?: (input: {
    activityId: string;
  }) => Promise<LearningLoopActivityScope>;
  authorize?: (input: {
    request: Request;
    env: Record<string, string | undefined>;
    now?: Date;
    fetch?: typeof fetch;
    courseId: string;
  }) => Promise<LearningLoopStudentAccess>;
  recordFormativeAttempt?: (input: {
    studentAccount: string;
    activityId: string;
    classExternalId: string;
    response: unknown;
    idempotencyKey: string;
    traceId: string;
  }) => Promise<LearningLoopPersistedReceipt>;
};

export const POST = Object.assign(createFormativeAttemptPostHandler(), {
  createForTesting: createFormativeAttemptPostHandler,
});

function createFormativeAttemptPostHandler(deps: PostDeps = {}) {
  const env = deps.env ?? process.env;
  return async function POST(request: Request, context: RouteContext) {
    const traceId = readLearningLoopTraceId(request);
    try {
      const { activityId } = await context.params;
      const body = readLearningLoopRecord(await readLearningLoopJsonBody(request));
      const idempotencyKey = readLearningLoopIdempotencyKey(request);
      const { access } = await authorizeLearningLoopStudentActivity({
        request,
        env,
        now: deps.now,
        fetch: deps.fetch,
        activityId,
        readActivityScope: deps.readActivityScope,
        authorize: deps.authorize,
      });
      if (access.status === "denied") {
        return createLearningLoopAccessDeniedResponse(access.reasonCode, traceId);
      }
      const store = deps.recordFormativeAttempt
        ? undefined
        : createUaisLearningLoopPostgresStore({ env });
      const receipt = await (
        deps.recordFormativeAttempt ?? store!.recordFormativeAttempt
      )({
        studentAccount: access.studentAccount,
        activityId,
        classExternalId: access.classId,
        response: body.response,
        idempotencyKey,
        traceId,
      });
      return createLearningLoopJsonResponse(200, traceId, receipt);
    } catch (error) {
      return createLearningLoopErrorResponse(
        error,
        traceId,
        "formative-attempt-persistence-failed",
      );
    }
  };
}
