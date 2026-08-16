import { after } from "next/server";
import {
  createLearningRecordQueue,
  getLearningRecordFlushFailures,
  recordLearningRecordFlushFailure,
  type LearningRecordFlushResult,
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
    scheduleLearningRecordFlush(queue);
    return result;
  };
}

function scheduleLearningRecordFlush(queue: {
  flush: () => Promise<LearningRecordFlushResult>;
}) {
  // Keep the async LRS write alive past the response so serverless runtimes do
  // not freeze the function before the flush completes; fall back to a detached
  // flush when `after` is unavailable (e.g. outside a request scope).
  try {
    after(async () => {
      await runLearningRecordFlush(queue);
    });
  } catch {
    void runLearningRecordFlush(queue);
  }
}

// The route answers 202 "queued" BEFORE this runs, so a statement lost here is
// lost after the client has already been told the write was accepted. The flush
// result used to be discarded entirely (`.catch(() => undefined)`), which made
// that loss invisible in every deployment log. It is now counted twice over: in
// the recorder's process-wide tally, which the admin smoke route reports, and
// in one server log line per lossy flush carrying the event counts.
//
// Out of scope by design (they need storage this route does not have): durable
// retry across instances, a dead-letter queue, and per-actor loss attribution.
async function runLearningRecordFlush(queue: {
  flush: () => Promise<LearningRecordFlushResult>;
}) {
  try {
    const result = await queue.flush();
    if (result.failed > 0) {
      const failures = getLearningRecordFlushFailures();
      console.error("[learning-record-events]", {
        phase: "flush",
        status: "statements-dropped",
        attempted: result.attempted,
        written: result.written,
        failed: result.failed,
        processFailedWrites: failures.failedWrites,
        lastFailure: failures.lastFailure,
        redaction: createRedaction(),
      });
    }
  } catch (error) {
    // `flush()` resolves for an unwritable statement, so reaching here means the
    // queue itself broke (a malformed event, a runtime fault): the whole batch
    // is gone and the count is unknown, which is worth exactly one loud line.
    recordLearningRecordFlushFailure(error);
    const failures = getLearningRecordFlushFailures();
    console.error("[learning-record-events]", {
      phase: "flush",
      status: "flush-failed",
      processFailedWrites: failures.failedWrites,
      lastFailure: failures.lastFailure,
      redaction: createRedaction(),
    });
  }
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
