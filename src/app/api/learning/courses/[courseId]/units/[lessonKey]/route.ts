import { createUaisLearningLoopPostgresReadStore } from "@/lib/learning-loop/postgres-read-store";
import { LearningLoopStoreError } from "@/lib/learning-loop/postgres-store";
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
    classId?: string;
  }) => Promise<LearningLoopStudentAccess>;
  readStudentUnit?: (input: {
    studentAccount: string;
    courseExternalId: string;
    classExternalId: string;
    lessonKey: string;
    activityId?: string;
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
      const query = new URL(request.url).searchParams;
      const requestedActivityId = query.get("activityId");
      const activityId = requestedActivityId?.trim();
      if (requestedActivityId !== null && (!activityId ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(activityId))) {
        throw new LearningLoopStoreError(400, "learning-activity-id-invalid");
      }
      const requestedClassId = query.get("classId");
      const classId = requestedClassId?.trim();
      if (requestedClassId !== null && (!classId || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(classId))) {
        throw new LearningLoopStoreError(400, "learning-class-id-invalid");
      }
      const access = await (deps.authorize ?? authorizeLearningLoopStudentCourse)({
        request,
        env,
        now: deps.now,
        fetch: deps.fetch,
        courseId,
        ...(classId ? { classId } : {}),
      });
      if (access.status === "denied") {
        return createLearningLoopAccessDeniedResponse(access.reasonCode, traceId);
      }
      if (classId && access.classId !== classId) {
        return createLearningLoopAccessDeniedResponse("student-activity-membership-required", traceId);
      }
      const store = deps.readStudentUnit
        ? undefined
        : createUaisLearningLoopPostgresReadStore({ env });
      const result = await (deps.readStudentUnit ?? store!.readStudentUnit)({
        studentAccount: access.studentAccount,
        courseExternalId: courseId,
        classExternalId: access.classId,
        lessonKey,
        ...(activityId ? { activityId } : {}),
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
