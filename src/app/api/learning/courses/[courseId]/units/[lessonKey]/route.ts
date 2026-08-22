import { createUaisLearningLoopPostgresReadStore } from "@/lib/learning-loop/postgres-read-store";
import { authorizeLearningLoopStudentCourse } from "@/lib/server/learning-loop-access";
import {
  createLearningLoopAccessDeniedResponse,
  createLearningLoopErrorResponse,
  createLearningLoopJsonResponse,
  readLearningLoopTraceId,
} from "@/lib/server/learning-loop-route-http";
import type { LearningLoopStudentAccess } from "@/lib/server/learning-loop-student-route";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ courseId: string; lessonKey: string }>;
};

type GetDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
  authorize?: (input: {
    request: Request;
    env: Record<string, string | undefined>;
    now?: Date;
    fetch?: typeof fetch;
    courseId: string;
  }) => Promise<LearningLoopStudentAccess>;
  readStudentUnit?: (input: {
    studentAccount: string;
    courseExternalId: string;
    classExternalId: string;
    lessonKey: string;
  }) => Promise<Record<string, unknown>>;
};

export const GET = Object.assign(createLearningUnitGetHandler(), {
  createForTesting: createLearningUnitGetHandler,
});

function createLearningUnitGetHandler(deps: GetDeps = {}) {
  const env = deps.env ?? process.env;
  return async function GET(request: Request, context: RouteContext) {
    const traceId = readLearningLoopTraceId(request);
    try {
      const { courseId, lessonKey } = await context.params;
      const access = await (deps.authorize ?? authorizeLearningLoopStudentCourse)({
        request,
        env,
        now: deps.now,
        fetch: deps.fetch,
        courseId,
      });
      if (access.status === "denied") {
        return createLearningLoopAccessDeniedResponse(access.reasonCode, traceId);
      }
      const store = deps.readStudentUnit
        ? undefined
        : createUaisLearningLoopPostgresReadStore({ env });
      const result = await (deps.readStudentUnit ?? store!.readStudentUnit)({
        studentAccount: access.studentAccount,
        courseExternalId: courseId,
        classExternalId: access.classId,
        lessonKey,
      });
      return createLearningLoopJsonResponse(200, traceId, { ...result, traceId });
    } catch (error) {
      return createLearningLoopErrorResponse(
        error,
        traceId,
        "learning-unit-read-failed",
      );
    }
  };
}
