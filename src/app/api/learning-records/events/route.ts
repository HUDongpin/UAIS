import type { LearningRecordEventInput } from "@/lib/learning-records/xapi-events";
import {
  LearningLoopStoreError,
  createUaisLearningLoopPostgresStore,
  type LearningLoopPersistedReceipt,
} from "@/lib/learning-loop/postgres-store";
import { authorizeLearningPptPlaybackAccess } from "@/lib/server/learning-ppt-playback-access";
import { getUaisAppSessionUserFromCookieString } from "@/lib/server/uais-app-session";

export const dynamic = "force-dynamic";

type LearningRecordEventAccess =
  | {
      status: "authorized";
      reasonCode: "learner-course-membership-approved";
      classId: string;
      responsibleSession: "S12";
    }
  | {
      status: "denied";
      reasonCode:
        | "learner-session-required"
        | "learner-self-scope-required"
        | "learner-course-membership-required"
        | "learning-event-invalid";
      responsibleSession: "S12";
    };

type LearningRecordEventPostHandlerDeps = {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  now?: Date;
  authorizeLearnerEvent?: (input: {
    request: Request;
    actorId: string;
    event: LearningRecordEventInput;
  }) => Promise<LearningRecordEventAccess> | LearningRecordEventAccess;
  persist?: (input: {
    studentAccount: string;
    classExternalId: string;
    event: LearningRecordEventInput;
    idempotencyKey: string;
    traceId: string;
  }) => Promise<LearningLoopPersistedReceipt>;
};

export const POST = Object.assign(createLearningRecordEventPostHandler(), {
  createForTesting: createLearningRecordEventPostHandler,
});

function createLearningRecordEventPostHandler(
  deps: LearningRecordEventPostHandlerDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function POST(request: Request) {
    const traceId = readSafeTraceId(request);
    const body = await parseRequestBody(request);
    if (!body) {
      return createEventJsonResponse(400, {
        target: "learning-record-event",
        status: "denied",
        access: createDeniedAccess("learning-event-invalid"),
        traceId,
        redaction: createRedaction(),
      });
    }

    const user = getUaisAppSessionUserFromCookieString(request.headers.get("cookie"), {
      env,
      now: deps.now,
    });
    if (!user || user.role !== "student") {
      return createEventJsonResponse(401, {
        target: "learning-record-event",
        status: "denied",
        access: createDeniedAccess("learner-session-required"),
        traceId,
        redaction: createRedaction(),
      });
    }

    if (body.actorId !== user.account) {
      return createEventJsonResponse(403, {
        target: "learning-record-event",
        status: "denied",
        access: createDeniedAccess("learner-self-scope-required"),
        traceId,
        redaction: createRedaction(),
      });
    }

    const authorizeLearnerEvent =
      deps.authorizeLearnerEvent ??
      ((input: {
        request: Request;
        actorId: string;
        event: LearningRecordEventInput;
      }) =>
        defaultAuthorizeLearnerEvent({
          ...input,
          env,
          fetch: deps.fetch,
          now: deps.now,
        }));
    const access = await authorizeLearnerEvent({
      request,
      actorId: body.actorId,
      event: body.event,
    });
    if (access.status === "denied") {
      return createEventJsonResponse(403, {
        target: "learning-record-event",
        status: "denied",
        access,
        traceId,
        redaction: createRedaction(),
      });
    }

    const event = sanitizeLearningRecordEvent(body.event, access.classId);
    try {
      const persist =
        deps.persist ??
        createUaisLearningLoopPostgresStore({ env }).recordLearningEvent;
      const receipt = await persist({
        studentAccount: body.actorId,
        classExternalId: access.classId,
        event,
        idempotencyKey:
          body.idempotencyKey ?? createIdempotencyKey(body.actorId, event),
        traceId,
      });
      return createEventJsonResponse(200, {
        target: "learning-record-event",
        ...receipt,
        access,
        redaction: createRedaction(),
      });
    } catch (error) {
      if (error instanceof LearningLoopStoreError) {
        return createEventJsonResponse(error.status, {
          target: "learning-record-event",
          status: error.status === 409 ? "conflict" : "failed",
          reasonCode: error.reasonCode,
          ...(error.details ?? {}),
          traceId,
          redaction: createRedaction(),
        });
      }
      return createEventJsonResponse(500, {
        target: "learning-record-event",
        status: "failed",
        reasonCode: "learning-event-persistence-failed",
        traceId,
        redaction: createRedaction(),
      });
    }
  };
}

async function defaultAuthorizeLearnerEvent(input: {
  request: Request;
  actorId: string;
  event: LearningRecordEventInput;
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  now?: Date;
}): Promise<LearningRecordEventAccess> {
  const access = await authorizeLearningPptPlaybackAccess({
    request: input.request,
    env: input.env,
    fetch: input.fetch,
    now: input.now,
    courseId: input.event.context.courseId,
  });
  if (access.status === "authorized" && access.reasonCode === "student-course-membership-approved") {
    return {
      status: "authorized",
      reasonCode: "learner-course-membership-approved",
      classId: access.classId,
      responsibleSession: "S12",
    };
  }
  return createDeniedAccess("learner-course-membership-required");
}

async function parseRequestBody(request: Request) {
  const body = (await request.json().catch(() => undefined)) as
    | { actorId?: unknown; event?: unknown; idempotencyKey?: unknown }
    | undefined;
  if (!body || typeof body.actorId !== "string" || !isLearningRecordEventInput(body.event)) {
    return undefined;
  }
  const actorId = body.actorId.trim();
  if (!actorId) return undefined;
  const idempotencyKey =
    typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()
      ? body.idempotencyKey.trim()
      : undefined;
  return { actorId, event: body.event, idempotencyKey };
}

function sanitizeLearningRecordEvent(
  event: LearningRecordEventInput,
  authorizedClassId: string,
): LearningRecordEventInput {
  const result = event.result
    ? {
        ...(typeof event.result.success === "boolean"
          ? { success: event.result.success }
          : {}),
        ...(typeof event.result.completion === "boolean"
          ? { completion: event.result.completion }
          : {}),
        ...(typeof event.result.duration === "string" && event.result.duration.length <= 80
          ? { duration: event.result.duration }
          : {}),
      }
    : undefined;
  return {
    type: event.type,
    object: {
      id: event.object.id.trim().slice(0, 500),
      name: event.object.name.trim().slice(0, 200),
      ...(event.object.type ? { type: event.object.type } : {}),
      ...(event.object.interactionType
        ? { interactionType: event.object.interactionType.slice(0, 80) }
        : {}),
    },
    ...(result && Object.keys(result).length > 0 ? { result } : {}),
    context: {
      courseId: event.context.courseId.trim(),
      classId: authorizedClassId,
      ...(event.context.lessonId ? { lessonId: event.context.lessonId.trim() } : {}),
      ...(event.context.locale ? { locale: event.context.locale.slice(0, 20) } : {}),
      ...(event.context.competencyIds
        ? {
            competencyIds: event.context.competencyIds
              .filter((value) => typeof value === "string")
              .slice(0, 20)
              .map((value) => value.slice(0, 120)),
          }
        : {}),
    },
  };
}

function isLearningRecordEventInput(value: unknown): value is LearningRecordEventInput {
  if (!isRecord(value) || !isRecord(value.object) || !isRecord(value.context)) return false;
  return (
    typeof value.type === "string" &&
    typeof value.object.id === "string" &&
    Boolean(value.object.id.trim()) &&
    typeof value.object.name === "string" &&
    Boolean(value.object.name.trim()) &&
    typeof value.context.courseId === "string" &&
    Boolean(value.context.courseId.trim())
  );
}

function createIdempotencyKey(actorId: string, event: LearningRecordEventInput) {
  return [actorId, event.type, event.context.courseId, event.object.id].join(":").slice(0, 160);
}

function readSafeTraceId(request: Request) {
  const candidate = request.headers.get("x-uais-trace-id")?.trim();
  return candidate && /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(candidate)
    ? candidate
    : `trace-learning-event-${crypto.randomUUID()}`;
}

function createDeniedAccess(
  reasonCode: Extract<LearningRecordEventAccess, { status: "denied" }>["reasonCode"],
): Extract<LearningRecordEventAccess, { status: "denied" }> {
  return { status: "denied", reasonCode, responsibleSession: "S12" };
}

function createEventJsonResponse(status: number, body: unknown) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function createRedaction() {
  return {
    credentials: "omitted",
    rawStatement: "omitted",
    studentContent: "omitted",
    localFiles: "omitted",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
