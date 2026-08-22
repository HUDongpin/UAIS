import { createUaisLearningLoopPostgresReadStore } from "@/lib/learning-loop/postgres-read-store";
import type { LearningLoopTeacherCourseAccess } from "@/lib/server/learning-loop-access";
import {
  createLearningLoopAccessDeniedResponse,
  createLearningLoopErrorResponse,
  createLearningLoopJsonResponse,
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

type GetDeps = {
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
};

export const GET = Object.assign(createTeacherSubmissionGetHandler(), {
  createForTesting: createTeacherSubmissionGetHandler,
});

function createTeacherSubmissionGetHandler(deps: GetDeps = {}) {
  const env = deps.env ?? process.env;
  return async function GET(request: Request, context: RouteContext) {
    const traceId = readLearningLoopTraceId(request);
    try {
      const { submissionId } = await context.params;
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
      const store = deps.readTeacherSubmission
        ? undefined
        : createUaisLearningLoopPostgresReadStore({ env });
      const submission = await (
        deps.readTeacherSubmission ?? store!.readTeacherSubmission
      )({ teacherAccount: access.teacherAccount, submissionId });
      if (
        submission.courseId !== scope.courseId ||
        submission.classId !== scope.classId ||
        submission.activityId !== scope.activityId
      ) {
        return createLearningLoopAccessDeniedResponse(
          "teacher-submission-scope-mismatch",
          traceId,
        );
      }
      return createLearningLoopJsonResponse(200, traceId, {
        submission,
        traceId,
      });
    } catch (error) {
      return createLearningLoopErrorResponse(
        error,
        traceId,
        "teacher-submission-read-failed",
      );
    }
  };
}
