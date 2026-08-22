import {
  LearningLoopValidationError,
  normalizeLearningActivityDraft,
  type LearningActivityDraft,
} from "@/lib/learning-loop/domain";
import { createUaisLearningLoopPostgresReadStore } from "@/lib/learning-loop/postgres-read-store";
import {
  LearningLoopStoreError,
  createUaisLearningLoopPostgresStore,
  type LearningLoopPersistedReceipt,
} from "@/lib/learning-loop/postgres-store";
import {
  authorizeLearningLoopTeacherCourse,
  type LearningLoopTeacherCourseAccess,
} from "@/lib/server/learning-loop-access";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ courseId: string }>;
};

type AuthorizedAccess = Extract<LearningLoopTeacherCourseAccess, { status: "authorized" }>;

type CommonDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
  authorize?: (input: {
    request: Request;
    env: Record<string, string | undefined>;
    now?: Date;
    fetch?: typeof fetch;
    courseId: string;
    lessonKey?: string;
  }) => Promise<LearningLoopTeacherCourseAccess>;
};

type PostDeps = CommonDeps & {
  createActivity?: (input: {
    teacherAccount: string;
    course: { externalId: string; title: string };
    class: { externalId: string; name: string };
    lesson: NonNullable<AuthorizedAccess["lesson"]>;
    draft: LearningActivityDraft;
    idempotencyKey: string;
    traceId: string;
  }) => Promise<LearningLoopPersistedReceipt>;
  readActivity?: (input: {
    teacherAccount: string;
    activityId: string;
  }) => Promise<{ courseId: string; activity: Record<string, unknown> }>;
};

type GetDeps = CommonDeps & {
  listActivities?: (input: {
    teacherAccount: string;
    courseExternalId: string;
  }) => Promise<Record<string, unknown>>;
};

export const GET = Object.assign(createTeachingActivitiesGetHandler(), {
  createForTesting: createTeachingActivitiesGetHandler,
});
export const POST = Object.assign(createTeachingActivitiesPostHandler(), {
  createForTesting: createTeachingActivitiesPostHandler,
});

function createTeachingActivitiesPostHandler(deps: PostDeps = {}) {
  const env = deps.env ?? process.env;
  return async function POST(request: Request, context: RouteContext) {
    const traceId = readSafeTraceId(request);
    try {
      const { courseId } = await context.params;
      const body = await readJsonBody(request);
      const draft = normalizeLearningActivityDraft(body);
      const idempotencyKey = readIdempotencyKey(request);
      const access = await (deps.authorize ?? authorizeLearningLoopTeacherCourse)({
        request,
        env,
        now: deps.now,
        fetch: deps.fetch,
        courseId,
        lessonKey: draft.lessonKey,
      });
      if (access.status === "denied") return createAccessDeniedResponse(access, traceId);
      const targetClass = access.classes.find(
        (item) => item.externalId === draft.targetClassId,
      );
      if (!targetClass) {
        return jsonResponse(403, traceId, {
          status: "denied",
          reasonCode: "teacher-target-class-required",
          traceId,
        });
      }
      if (!access.lesson || access.lesson.key !== draft.lessonKey) {
        return jsonResponse(404, traceId, {
          status: "denied",
          reasonCode: "published-lesson-required",
          traceId,
        });
      }
      const commandStore = deps.createActivity
        ? undefined
        : createUaisLearningLoopPostgresStore({ env });
      const createActivity = deps.createActivity ?? commandStore!.createActivity;
      const receipt = await createActivity({
        teacherAccount: access.teacherAccount,
        course: access.course,
        class: targetClass,
        lesson: access.lesson,
        draft,
        idempotencyKey,
        traceId,
      });
      const readStore = deps.readActivity
        ? undefined
        : createUaisLearningLoopPostgresReadStore({ env });
      const readActivity = deps.readActivity ?? readStore!.readActivity;
      const readback = await readActivity({
        teacherAccount: access.teacherAccount,
        activityId: receipt.resourceId,
      });
      if (readback.courseId !== courseId) {
        throw new LearningLoopStoreError(409, "activity-readback-scope-mismatch");
      }
      return jsonResponse(201, traceId, {
        status: "persisted",
        receipt,
        activity: readback.activity,
        traceId,
      });
    } catch (error) {
      return createErrorResponse(error, traceId);
    }
  };
}

function createTeachingActivitiesGetHandler(deps: GetDeps = {}) {
  const env = deps.env ?? process.env;
  return async function GET(request: Request, context: RouteContext) {
    const traceId = readSafeTraceId(request);
    try {
      const { courseId } = await context.params;
      const access = await (deps.authorize ?? authorizeLearningLoopTeacherCourse)({
        request,
        env,
        now: deps.now,
        fetch: deps.fetch,
        courseId,
      });
      if (access.status === "denied") return createAccessDeniedResponse(access, traceId);
      const store = deps.listActivities
        ? undefined
        : createUaisLearningLoopPostgresReadStore({ env });
      const listActivities = deps.listActivities ?? store!.listActivities;
      const result = await listActivities({
        teacherAccount: access.teacherAccount,
        courseExternalId: courseId,
      });
      return jsonResponse(200, traceId, { ...result, traceId });
    } catch (error) {
      return createErrorResponse(error, traceId);
    }
  };
}

async function readJsonBody(request: Request) {
  const text = await request.text();
  if (!text.trim()) throw new LearningLoopStoreError(400, "request-body-required");
  if (Buffer.byteLength(text, "utf8") > 100_000) {
    throw new LearningLoopStoreError(413, "request-body-too-large");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new LearningLoopStoreError(400, "request-body-invalid-json");
  }
}

function readIdempotencyKey(request: Request) {
  const value = request.headers.get("idempotency-key")?.trim();
  if (!value || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) {
    throw new LearningLoopStoreError(400, "idempotency-key-required");
  }
  return value;
}

function createAccessDeniedResponse(
  access: Extract<LearningLoopTeacherCourseAccess, { status: "denied" }>,
  traceId: string,
) {
  const unauthenticated =
    access.reasonCode === "teacher-app-session-required" ||
    access.reasonCode === "teacher-write-session-required";
  return jsonResponse(unauthenticated ? 401 : 403, traceId, {
    status: "denied",
    reasonCode: access.reasonCode,
    traceId,
  });
}

function createErrorResponse(error: unknown, traceId: string) {
  if (error instanceof LearningLoopValidationError) {
    return jsonResponse(400, traceId, {
      status: "invalid",
      reasonCode: error.code,
      traceId,
    });
  }
  if (error instanceof LearningLoopStoreError) {
    return jsonResponse(error.status, traceId, {
      status: error.status === 409 ? "conflict" : "failed",
      reasonCode: error.reasonCode,
      ...(error.details ?? {}),
      traceId,
    });
  }
  return jsonResponse(500, traceId, {
    status: "failed",
    reasonCode: "learning-activity-request-failed",
    traceId,
  });
}

function readSafeTraceId(request: Request) {
  const candidate = request.headers.get("x-uais-trace-id")?.trim();
  return candidate && /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(candidate)
    ? candidate
    : `trace-learning-activity-${crypto.randomUUID()}`;
}

function jsonResponse(status: number, traceId: string, body: unknown) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-uais-trace-id": traceId,
    },
  });
}
