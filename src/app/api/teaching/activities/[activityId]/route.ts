import { LearningLoopValidationError } from "@/lib/learning-loop/domain";
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
  params: Promise<{ activityId: string }>;
};

type ActivityOperation =
  | "save"
  | "publish"
  | "archive"
  | "adjust-due-date"
  | "create-version";

type ActivityScope = {
  courseId: string;
  classId: string;
  lessonKey: string;
};

type PatchDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
  readActivityScope?: (input: { activityId: string }) => Promise<ActivityScope>;
  authorize?: (input: {
    request: Request;
    env: Record<string, string | undefined>;
    now?: Date;
    fetch?: typeof fetch;
    courseId: string;
    lessonKey?: string;
  }) => Promise<LearningLoopTeacherCourseAccess>;
  updateActivity?: (input: {
    teacherAccount: string;
    activityId: string;
    expectedEditRevision: number;
    operation: ActivityOperation;
    draft?: unknown;
    dueAt?: string | null;
    idempotencyKey: string;
    traceId: string;
  }) => Promise<LearningLoopPersistedReceipt>;
  readActivity?: (input: {
    teacherAccount: string;
    activityId: string;
  }) => Promise<{ courseId: string; activity: Record<string, unknown> }>;
};

export const PATCH = Object.assign(createTeachingActivityPatchHandler(), {
  createForTesting: createTeachingActivityPatchHandler,
});

function createTeachingActivityPatchHandler(deps: PatchDeps = {}) {
  const env = deps.env ?? process.env;
  return async function PATCH(request: Request, context: RouteContext) {
    const traceId = readSafeTraceId(request);
    try {
      const { activityId } = await context.params;
      const body = readUpdateBody(await readJsonBody(request));
      const idempotencyKey = readIdempotencyKey(request);
      const readStore =
        deps.readActivityScope && deps.readActivity
          ? undefined
          : createUaisLearningLoopPostgresReadStore({ env });
      const readActivityScope = deps.readActivityScope ?? readStore!.readActivityScope;
      const scope = await readActivityScope({ activityId });
      const access = await (deps.authorize ?? authorizeLearningLoopTeacherCourse)({
        request,
        env,
        now: deps.now,
        fetch: deps.fetch,
        courseId: scope.courseId,
        lessonKey: scope.lessonKey,
      });
      if (access.status === "denied") {
        return createAccessDeniedResponse(access, traceId);
      }
      if (!access.classes.some((item) => item.externalId === scope.classId)) {
        return jsonResponse(403, traceId, {
          status: "denied",
          reasonCode: "teacher-target-class-required",
          traceId,
        });
      }
      const commandStore = deps.updateActivity
        ? undefined
        : createUaisLearningLoopPostgresStore({ env });
      const updateActivity = deps.updateActivity ?? commandStore!.updateActivity;
      const receipt = await updateActivity({
        teacherAccount: access.teacherAccount,
        activityId,
        expectedEditRevision: body.expectedEditRevision,
        operation: body.operation,
        ...(body.draft !== undefined ? { draft: body.draft } : {}),
        ...(body.hasDueAt ? { dueAt: body.dueAt } : {}),
        idempotencyKey,
        traceId,
      });
      const readActivity = deps.readActivity ?? readStore!.readActivity;
      const readback = await readActivity({
        teacherAccount: access.teacherAccount,
        activityId: receipt.resourceId,
      });
      if (readback.courseId !== scope.courseId) {
        throw new LearningLoopStoreError(409, "activity-readback-scope-mismatch");
      }
      return jsonResponse(200, traceId, {
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

function readUpdateBody(value: unknown) {
  const body = readRecord(value);
  const operation = readOperation(body.operation);
  const expectedEditRevision = Number(body.expectedEditRevision);
  if (!Number.isInteger(expectedEditRevision) || expectedEditRevision < 1) {
    throw new LearningLoopStoreError(400, "activity-edit-revision-required");
  }
  return {
    operation,
    expectedEditRevision,
    ...(Object.hasOwn(body, "draft") ? { draft: body.draft } : {}),
    hasDueAt: Object.hasOwn(body, "dueAt"),
    dueAt:
      body.dueAt === null || typeof body.dueAt === "string"
        ? body.dueAt
        : undefined,
  };
}

function readOperation(value: unknown): ActivityOperation {
  if (
    value === "save" ||
    value === "publish" ||
    value === "archive" ||
    value === "adjust-due-date" ||
    value === "create-version"
  ) {
    return value;
  }
  throw new LearningLoopStoreError(400, "activity-operation-invalid");
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
    reasonCode: "learning-activity-update-failed",
    traceId,
  });
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new LearningLoopStoreError(400, "request-body-invalid");
  }
  return value as Record<string, unknown>;
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
