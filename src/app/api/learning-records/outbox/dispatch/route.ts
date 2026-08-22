import {
  dispatchLearningOutboxBatch,
  isLearningOutboxSecretAuthorized,
  type LearningOutboxDispatchStore,
} from "@/lib/learning-loop/outbox-worker";
import {
  LearningLoopStoreError,
  createUaisLearningLoopPostgresStore,
} from "@/lib/learning-loop/postgres-store";

export const dynamic = "force-dynamic";

type DispatchResult = Awaited<ReturnType<typeof dispatchLearningOutboxBatch>>;

type LearningOutboxDispatchPostHandlerDeps = {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  now?: () => Date;
  createWorkerId?: () => string;
  createStore?: () => LearningOutboxDispatchStore;
  dispatch?: (input: {
    env: Record<string, string | undefined>;
    workerId: string;
    store: LearningOutboxDispatchStore;
    fetch?: typeof fetch;
    limit: number;
    now?: () => Date;
  }) => Promise<DispatchResult>;
};

export const POST = Object.assign(createLearningOutboxDispatchPostHandler(), {
  createForTesting: createLearningOutboxDispatchPostHandler,
});

function createLearningOutboxDispatchPostHandler(
  deps: LearningOutboxDispatchPostHandlerDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function POST(request: Request) {
    const traceId = readSafeTraceId(request);
    const configuredSecret = env.UAIS_LEARNING_RECORD_OUTBOX_SECRET?.trim();
    if (!configuredSecret || configuredSecret.length < 32) {
      return createJsonResponse(503, traceId, {
        target: "learning-xapi-outbox",
        status: "blocked",
        reasonCode: "outbox-secret-not-configured",
        traceId,
        valueRedacted: true,
      });
    }

    const presentedSecret = readBearerToken(request);
    if (!isLearningOutboxSecretAuthorized(presentedSecret, configuredSecret)) {
      return createJsonResponse(401, traceId, {
        target: "learning-xapi-outbox",
        status: "denied",
        reasonCode: "outbox-secret-required",
        traceId,
        valueRedacted: true,
      });
    }

    try {
      const store =
        deps.createStore?.() ?? createUaisLearningLoopPostgresStore({ env });
      const dispatch = deps.dispatch ?? dispatchLearningOutboxBatch;
      const result = await dispatch({
        env,
        workerId: deps.createWorkerId?.() ?? `learning-outbox-${crypto.randomUUID()}`,
        store,
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
        limit: readBatchLimit(request),
        ...(deps.now ? { now: deps.now } : {}),
      });
      return createJsonResponse(result.status === "blocked" ? 503 : 200, traceId, {
        ...result,
        traceId,
      });
    } catch (error) {
      if (error instanceof LearningLoopStoreError) {
        return createJsonResponse(error.status, traceId, {
          target: "learning-xapi-outbox",
          status: "failed",
          reasonCode: error.reasonCode,
          traceId,
          valueRedacted: true,
        });
      }
      return createJsonResponse(500, traceId, {
        target: "learning-xapi-outbox",
        status: "failed",
        reasonCode: "outbox-dispatch-failed",
        traceId,
        valueRedacted: true,
      });
    }
  };
}

function readBearerToken(request: Request) {
  const match = /^Bearer\s+([^\s]+)$/i.exec(
    request.headers.get("authorization")?.trim() ?? "",
  );
  return match?.[1];
}

function readBatchLimit(request: Request) {
  const value = Number(new URL(request.url).searchParams.get("limit") ?? "25");
  return Number.isInteger(value) ? Math.max(1, Math.min(100, value)) : 25;
}

function readSafeTraceId(request: Request) {
  const candidate = request.headers.get("x-uais-trace-id")?.trim();
  return candidate && /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(candidate)
    ? candidate
    : `trace-learning-outbox-${crypto.randomUUID()}`;
}

function createJsonResponse(status: number, traceId: string, body: unknown) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-uais-trace-id": traceId,
    },
  });
}
