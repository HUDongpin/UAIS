import {
  learningSubmissionStates,
  type LearningSubmissionState,
} from "@/lib/learning-loop/domain";
import { LearningLoopStoreError } from "@/lib/learning-loop/postgres-store";
import { createUaisLearningLoopPostgresReadStore } from "@/lib/learning-loop/postgres-read-store";
import type { LearningLoopTeacherCourseAccess } from "@/lib/server/learning-loop-access";
import {
  createLearningLoopAccessDeniedResponse,
  createLearningLoopErrorResponse,
  createLearningLoopJsonResponse,
  readLearningLoopTraceId,
} from "@/lib/server/learning-loop-route-http";
import {
  authorizeLearningLoopTeacherActivity,
  type LearningLoopTeacherActivityScope,
} from "@/lib/server/learning-loop-teacher-route";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ activityId: string }>;
};

type GetDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
  readActivityScope?: (input: {
    activityId: string;
  }) => Promise<LearningLoopTeacherActivityScope>;
  authorize?: (input: {
    request: Request;
    env: Record<string, string | undefined>;
    now?: Date;
    fetch?: typeof fetch;
    courseId: string;
    lessonKey?: string;
  }) => Promise<LearningLoopTeacherCourseAccess>;
  listActivitySubmissions?: (input: {
    teacherAccount: string;
    activityId: string;
    classExternalId?: string;
    state?: LearningSubmissionState;
    cursor?: string;
    limit?: number;
  }) => Promise<Record<string, unknown>>;
};

export const GET = Object.assign(createActivitySubmissionsGetHandler(), {
  createForTesting: createActivitySubmissionsGetHandler,
});

function createActivitySubmissionsGetHandler(deps: GetDeps = {}) {
  const env = deps.env ?? process.env;
  return async function GET(request: Request, context: RouteContext) {
    const traceId = readLearningLoopTraceId(request);
    try {
      const { activityId } = await context.params;
      const url = new URL(request.url);
      const state = readOptionalState(url.searchParams.get("state"));
      const cursor = url.searchParams.get("cursor")?.trim() || undefined;
      const limit = readLimit(url.searchParams.get("limit"));
      const { access, scope } = await authorizeLearningLoopTeacherActivity({
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
      const requestedClass = url.searchParams.get("class")?.trim();
      if (requestedClass && requestedClass !== scope.classId) {
        return createLearningLoopAccessDeniedResponse(
          "teacher-target-class-required",
          traceId,
        );
      }
      const store = deps.listActivitySubmissions
        ? undefined
        : createUaisLearningLoopPostgresReadStore({ env });
      const result = await (
        deps.listActivitySubmissions ?? store!.listActivitySubmissions
      )({
        teacherAccount: access.teacherAccount,
        activityId,
        classExternalId: scope.classId,
        ...(state ? { state } : {}),
        ...(cursor ? { cursor } : {}),
        limit,
      });
      return createLearningLoopJsonResponse(200, traceId, { ...result, traceId });
    } catch (error) {
      return createLearningLoopErrorResponse(
        error,
        traceId,
        "teacher-submission-queue-read-failed",
      );
    }
  };
}

function readOptionalState(value: string | null) {
  if (!value) return undefined;
  if (learningSubmissionStates.includes(value as LearningSubmissionState)) {
    return value as LearningSubmissionState;
  }
  throw new LearningLoopStoreError(400, "submission-state-filter-invalid");
}

function readLimit(value: string | null) {
  if (!value) return 25;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new LearningLoopStoreError(400, "submission-page-limit-invalid");
  }
  return limit;
}
