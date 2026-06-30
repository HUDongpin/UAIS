import {
  createLearningRecordQueue,
  type LearningRecordQueueResult,
} from "@/lib/learning-records/lrs-recorder";
import type {
  LearningRecordActor,
  LearningRecordEventInput,
} from "@/lib/learning-records/xapi-events";
import {
  authorizeLearningPptPlaybackAccess,
} from "@/lib/server/learning-ppt-playback-access";
import { getUaisAppSessionUserFromCookieString } from "@/lib/server/uais-app-session";

export const dynamic = "force-dynamic";

type LearningRecordEventAccess =
  | {
      status: "authorized";
      reasonCode: "learner-course-membership-approved";
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
  now?: () => string;
  authorizeLearnerEvent?: (input: {
    request: Request;
    actorId: string;
    event: LearningRecordEventInput;
  }) => Promise<LearningRecordEventAccess> | LearningRecordEventAccess;
  enqueue?: (item: {
    actor: LearningRecordActor;
    event: LearningRecordEventInput;
    idempotencyKey: string;
  }) => LearningRecordQueueResult;
};

export const POST = createLearningRecordEventPostHandler();

export function createLearningRecordEventPostHandler(
  deps: LearningRecordEventPostHandlerDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function POST(request: Request) {
    const body = await parseRequestBody(request);
    if (!body) {
      return createEventJsonResponse(400, {
        target: "learning-record-event",
        status: "denied",
        access: createDeniedAccess("learning-event-invalid"),
        redaction: createRedaction(),
      });
    }

    const user = getUaisAppSessionUserFromCookieString(request.headers.get("cookie"), {
      env,
    });
    if (!user || user.role !== "student") {
      return createEventJsonResponse(401, {
        target: "learning-record-event",
        status: "denied",
        access: createDeniedAccess("learner-session-required"),
        redaction: createRedaction(),
      });
    }

    if (body.actorId !== user.account) {
      return createEventJsonResponse(403, {
        target: "learning-record-event",
        status: "denied",
        access: createDeniedAccess("learner-self-scope-required"),
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
        redaction: createRedaction(),
      });
    }

    const enqueue = deps.enqueue ?? createDefaultEnqueue({ env, fetch: deps.fetch, now: deps.now });
    const queueResult = enqueue({
      actor: {
        id: body.actorId,
        role: "learner",
        displayName: user.displayName,
      },
      event: body.event,
      idempotencyKey: body.idempotencyKey ?? createIdempotencyKey(body.actorId, body.event),
    });

    return createEventJsonResponse(queueResult.status === "blocked" ? 424 : 202, {
      target: "learning-record-event",
      status: queueResult.status,
      access,
      queue: queueResult,
      redaction: createRedaction(),
    });
  };
}

async function defaultAuthorizeLearnerEvent(input: {
  request: Request;
  actorId: string;
  event: LearningRecordEventInput;
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}): Promise<LearningRecordEventAccess> {
  const access = await authorizeLearningPptPlaybackAccess({
    request: input.request,
    env: input.env,
    fetch: input.fetch,
    courseId: input.event.context.courseId,
  });
  if (access.status === "authorized") {
    return {
      status: "authorized",
      reasonCode: "learner-course-membership-approved",
      responsibleSession: "S12",
    };
  }
  return createDeniedAccess("learner-course-membership-required");
}

function createDefaultEnqueue(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  now?: () => string;
}) {
  const queue = createLearningRecordQueue(input);
  return (item: {
    actor: LearningRecordActor;
    event: LearningRecordEventInput;
    idempotencyKey: string;
  }) => {
    const result = queue.enqueue(item);
    void queue.flush().catch(() => undefined);
    return result;
  };
}

async function parseRequestBody(request: Request) {
  const body = (await request.json().catch(() => undefined)) as
    | {
        actorId?: unknown;
        event?: unknown;
        idempotencyKey?: unknown;
      }
    | undefined;
  if (
    !body ||
    typeof body.actorId !== "string" ||
    !isLearningRecordEventInput(body.event)
  ) {
    return undefined;
  }
  return {
    actorId: body.actorId.trim(),
    event: body.event,
    idempotencyKey:
      typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()
        ? body.idempotencyKey.trim()
        : undefined,
  };
}

function isLearningRecordEventInput(value: unknown): value is LearningRecordEventInput {
  if (!isRecord(value) || !isRecord(value.object) || !isRecord(value.context)) {
    return false;
  }
  return (
    typeof value.type === "string" &&
    typeof value.object.id === "string" &&
    typeof value.object.name === "string" &&
    typeof value.context.courseId === "string"
  );
}

function createIdempotencyKey(actorId: string, event: LearningRecordEventInput) {
  return [actorId, event.type, event.context.courseId, event.object.id].join(":");
}

function createDeniedAccess(
  reasonCode: Extract<LearningRecordEventAccess, { status: "denied" }>["reasonCode"],
): Extract<LearningRecordEventAccess, { status: "denied" }> {
  return {
    status: "denied",
    reasonCode,
    responsibleSession: "S12",
  };
}

function createEventJsonResponse(status: number, body: unknown) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
    },
  });
}

function createRedaction() {
  return {
    credentials: "omitted",
    rawStatement: "omitted",
    localFiles: "omitted",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
