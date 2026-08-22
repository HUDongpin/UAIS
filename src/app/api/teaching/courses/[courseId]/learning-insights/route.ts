import { createUaisLearningLoopPostgresReadStore } from "@/lib/learning-loop/postgres-read-store";
import {
  authorizeLearningLoopTeacherCourse,
  type LearningLoopTeacherCourseAccess,
} from "@/lib/server/learning-loop-access";
import {
  createLearningLoopAccessDeniedResponse,
  createLearningLoopErrorResponse,
  createLearningLoopJsonResponse,
  readLearningLoopTraceId,
} from "@/lib/server/learning-loop-route-http";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ courseId: string }>;
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
  }) => Promise<LearningLoopTeacherCourseAccess>;
  readLearningInsights?: (input: {
    teacherAccount: string;
    courseExternalId: string;
    classExternalId?: string;
    approvedStudentCounts?: Record<string, number>;
  }) => Promise<Record<string, unknown>>;
};

export const GET = Object.assign(createLearningInsightsGetHandler(), {
  createForTesting: createLearningInsightsGetHandler,
});

function createLearningInsightsGetHandler(deps: GetDeps = {}) {
  const env = deps.env ?? process.env;
  return async function GET(request: Request, context: RouteContext) {
    const traceId = readLearningLoopTraceId(request);
    try {
      const { courseId } = await context.params;
      const access = await (deps.authorize ?? authorizeLearningLoopTeacherCourse)({
        request,
        env,
        now: deps.now,
        fetch: deps.fetch,
        courseId,
      });
      if (access.status === "denied") {
        return createLearningLoopAccessDeniedResponse(access.reasonCode, traceId);
      }
      const classExternalId = new URL(request.url).searchParams.get("class")?.trim();
      if (
        classExternalId &&
        !access.classes.some((item) => item.externalId === classExternalId)
      ) {
        return createLearningLoopAccessDeniedResponse(
          "teacher-target-class-required",
          traceId,
        );
      }
      const store = deps.readLearningInsights
        ? undefined
        : createUaisLearningLoopPostgresReadStore({ env });
      const approvedStudentCounts = Object.fromEntries(
        access.classes
          .filter(
            (item) =>
              (!classExternalId || item.externalId === classExternalId) &&
              typeof item.approvedStudentCount === "number",
          )
          .map((item) => [item.externalId, item.approvedStudentCount!]),
      );
      const result = await (
        deps.readLearningInsights ?? store!.readLearningInsights
      )({
        teacherAccount: access.teacherAccount,
        courseExternalId: courseId,
        ...(classExternalId ? { classExternalId } : {}),
        ...(Object.keys(approvedStudentCounts).length > 0
          ? { approvedStudentCounts }
          : {}),
      });
      return createLearningLoopJsonResponse(200, traceId, { ...result, traceId });
    } catch (error) {
      return createLearningLoopErrorResponse(
        error,
        traceId,
        "learning-insights-read-failed",
      );
    }
  };
}
