import {
  LearningLoopStoreError,
  createUaisLearningLoopPostgresStore,
  type LearningLoopPersistedReceipt,
} from "@/lib/learning-loop/postgres-store";
import {
  createLearningLoopAccessDeniedResponse,
  createLearningLoopErrorResponse,
  createLearningLoopJsonResponse,
  readLearningLoopJsonBody,
  readLearningLoopRecord,
  readLearningLoopRevision,
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

type PutDeps = {
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
  saveSubmissionDraft?: (input: {
    studentAccount: string;
    activityId: string;
    classExternalId: string;
    contentText: string;
    expectedDraftRevision: number;
    traceId: string;
  }) => Promise<LearningLoopPersistedReceipt>;
};

export const PUT = Object.assign(createSubmissionDraftPutHandler(), {
  createForTesting: createSubmissionDraftPutHandler,
});

function createSubmissionDraftPutHandler(deps: PutDeps = {}) {
  const env = deps.env ?? process.env;
  return async function PUT(request: Request, context: RouteContext) {
    const traceId = readLearningLoopTraceId(request);
    try {
      const { activityId } = await context.params;
      const body = readLearningLoopRecord(await readLearningLoopJsonBody(request));
      if (typeof body.contentText !== "string") {
        throw new LearningLoopStoreError(400, "submission-content-required");
      }
      const expectedDraftRevision = readLearningLoopRevision(
        body.expectedDraftRevision,
        "submission-draft-revision-required",
      );
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
      const store = deps.saveSubmissionDraft
        ? undefined
        : createUaisLearningLoopPostgresStore({ env });
      const receipt = await (
        deps.saveSubmissionDraft ?? store!.saveSubmissionDraft
      )({
        studentAccount: access.studentAccount,
        activityId,
        classExternalId: access.classId,
        contentText: body.contentText,
        expectedDraftRevision,
        traceId,
      });
      return createLearningLoopJsonResponse(200, traceId, receipt);
    } catch (error) {
      return createLearningLoopErrorResponse(
        error,
        traceId,
        "submission-draft-persistence-failed",
      );
    }
  };
}
