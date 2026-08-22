import { createHash } from "node:crypto";
import type { LearningRecordEventInput } from "@/lib/learning-records/xapi-events";
import {
  LearningLoopStoreError,
  createUaisLearningLoopPostgresStore,
  type LearningLoopPersistedReceipt,
} from "@/lib/learning-loop/postgres-store";
import { authorizeLearningPptPlaybackAccess } from "@/lib/server/learning-ppt-playback-access";
import { getUaisAppSessionUserFromCookieString } from "@/lib/server/uais-app-session";

export const dynamic = "force-dynamic";

const browserLearningEventTypes = new Set<LearningRecordEventInput["type"]>([
  "course.viewed",
  "lesson.viewed",
  "activity.attempted",
  "question.answered",
  "course.completed",
  "ai.feedback.requested",
  "collaboration.contributed",
]);
const maxExplicitIdempotencyKeyLength = 1024;
const maxObjectIdLength = 500;
const maxObjectNameLength = 200;
const maxInteractionTypeLength = 80;
const maxDurationLength = 80;
const maxLocaleLength = 20;
const maxCompetencyIds = 20;
const maxCompetencyIdLength = 120;

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
        | "learning-event-origin-invalid"
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
    if (!hasValidSameOrigin(request)) {
      return createEventJsonResponse(403, {
        target: "learning-record-event",
        status: "denied",
        access: createDeniedAccess("learning-event-origin-invalid"),
        traceId,
        redaction: createRedaction(),
      });
    }
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
        idempotencyKey: createIdempotencyKey(body.actorId, event, body.idempotencyKey),
        traceId,
      });
      return createEventJsonResponse(200, {
        target: "learning-record-event",
        ...receipt,
        access: createPublicAuthorizedAccess(access),
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
  if (
    access.status === "authorized" &&
    access.reasonCode === "student-course-membership-approved"
  ) {
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
  let idempotencyKey: string | undefined;
  if (Object.hasOwn(body, "idempotencyKey")) {
    if (
      typeof body.idempotencyKey !== "string" ||
      body.idempotencyKey.length > maxExplicitIdempotencyKeyLength
    ) {
      return undefined;
    }
    idempotencyKey = body.idempotencyKey.trim();
    if (!idempotencyKey) return undefined;
  }
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
      id: event.object.id.trim(),
      name: event.object.name.trim(),
      ...(event.object.type ? { type: event.object.type } : {}),
      ...(event.object.interactionType
        ? { interactionType: event.object.interactionType }
        : {}),
    },
    ...(result && Object.keys(result).length > 0 ? { result } : {}),
    context: {
      courseId: event.context.courseId.trim(),
      classId: authorizedClassId,
      ...(event.context.lessonId ? { lessonId: event.context.lessonId.trim() } : {}),
      ...(event.context.locale ? { locale: event.context.locale } : {}),
      ...(event.context.competencyIds
        ? {
            competencyIds: [...event.context.competencyIds],
          }
        : {}),
    },
  };
}

function isLearningRecordEventInput(value: unknown): value is LearningRecordEventInput {
  if (!isRecord(value) || !isRecord(value.object) || !isRecord(value.context)) return false;
  return (
    isBrowserLearningEventType(value.type) &&
    typeof value.object.id === "string" &&
    value.object.id.length <= maxObjectIdLength &&
    Boolean(value.object.id.trim()) &&
    typeof value.object.name === "string" &&
    value.object.name.length <= maxObjectNameLength &&
    Boolean(value.object.name.trim()) &&
    isOptionalString(value.object.type) &&
    isOptionalString(value.object.interactionType, maxInteractionTypeLength) &&
    typeof value.context.courseId === "string" &&
    Boolean(value.context.courseId.trim()) &&
    isOptionalString(value.context.lessonId) &&
    isOptionalString(value.context.locale, maxLocaleLength) &&
    isOptionalStringArray(
      value.context.competencyIds,
      maxCompetencyIds,
      maxCompetencyIdLength,
    ) &&
    isOptionalLearningEventResult(value.result)
  );
}

function isOptionalLearningEventResult(value: unknown) {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  return (
    (value.success === undefined || typeof value.success === "boolean") &&
    (value.completion === undefined || typeof value.completion === "boolean") &&
    isOptionalString(value.duration, maxDurationLength)
  );
}

function isOptionalString(value: unknown, maxLength?: number) {
  return (
    value === undefined ||
    (typeof value === "string" &&
      (maxLength === undefined || value.length <= maxLength))
  );
}

function isOptionalStringArray(
  value: unknown,
  maxItems: number,
  maxItemLength: number,
) {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= maxItems &&
      value.every(
        (item) => typeof item === "string" && item.length <= maxItemLength,
      ))
  );
}

function isBrowserLearningEventType(
  value: unknown,
): value is LearningRecordEventInput["type"] {
  return (
    typeof value === "string" &&
    browserLearningEventTypes.has(value as LearningRecordEventInput["type"])
  );
}

function createIdempotencyKey(
  actorId: string,
  event: LearningRecordEventInput,
  explicitKey?: string,
) {
  const identity =
    explicitKey === undefined
      ? { source: "normalized-event", actorId, event }
      : { source: "explicit", actorId, key: explicitKey };
  const digest = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
  return `learning-event:${digest}`;
}

function hasValidSameOrigin(request: Request) {
  const serializedOrigin = request.headers.get("origin");
  const host = request.headers.get("host");
  const protocol = readRequestProtocol(request);
  if (
    !serializedOrigin ||
    !host ||
    !protocol ||
    host.length > 259 ||
    !/^(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(?::[0-9]{1,5})?$/.test(host)
  ) {
    return false;
  }

  try {
    const origin = new URL(serializedOrigin);
    const expectedOrigin = new URL(`${protocol}//${host}`).origin;
    return serializedOrigin === origin.origin && origin.origin === expectedOrigin;
  } catch {
    return false;
  }
}

function readRequestProtocol(request: Request): "http:" | "https:" | undefined {
  const forwardedProtocol = request.headers.get("x-forwarded-proto");
  if (forwardedProtocol !== null) {
    const normalized = forwardedProtocol.trim().toLowerCase();
    if (normalized === "http" || normalized === "https") {
      return `${normalized}:`;
    }
    return undefined;
  }

  try {
    const protocol = new URL(request.url).protocol;
    return protocol === "http:" || protocol === "https:" ? protocol : undefined;
  } catch {
    return undefined;
  }
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

function createPublicAuthorizedAccess(
  access: Extract<LearningRecordEventAccess, { status: "authorized" }>,
) {
  return {
    status: access.status,
    reasonCode: access.reasonCode,
    classId: access.classId,
    responsibleSession: access.responsibleSession,
  };
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
