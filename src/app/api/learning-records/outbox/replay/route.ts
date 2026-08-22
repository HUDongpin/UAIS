import { isLearningOutboxSecretAuthorized } from "@/lib/learning-loop/outbox-worker";
import {
  LearningLoopStoreError,
  createUaisLearningLoopPostgresStore,
} from "@/lib/learning-loop/postgres-store";

export const dynamic = "force-dynamic";

type ReplayDeps = {
  env?: Record<string, string | undefined>;
  now?: () => Date;
  replayDead?: (input: { outboxId: string; replayedAt: string }) => Promise<void>;
};

export const POST = Object.assign(createLearningOutboxReplayPostHandler(), {
  createForTesting: createLearningOutboxReplayPostHandler,
});

function createLearningOutboxReplayPostHandler(deps: ReplayDeps = {}) {
  const env = deps.env ?? process.env;
  return async function POST(request: Request) {
    const traceId = readSafeTraceId(request);
    const configuredSecret = env.UAIS_LEARNING_RECORD_OUTBOX_SECRET?.trim();
    if (!configuredSecret || configuredSecret.length < 32) {
      return jsonResponse(503, traceId, {
        target: "learning-xapi-outbox-replay",
        status: "blocked",
        reasonCode: "outbox-secret-not-configured",
        traceId,
        valueRedacted: true,
      });
    }
    if (!isLearningOutboxSecretAuthorized(readBearerToken(request), configuredSecret)) {
      return jsonResponse(401, traceId, {
        target: "learning-xapi-outbox-replay",
        status: "denied",
        reasonCode: "outbox-secret-required",
        traceId,
        valueRedacted: true,
      });
    }
    try {
      const outboxId = await readOutboxId(request);
      const replayedAt = (deps.now ?? (() => new Date()))().toISOString();
      const store = deps.replayDead
        ? undefined
        : createUaisLearningLoopPostgresStore({ env });
      await (deps.replayDead ?? store!.replayDead)({ outboxId, replayedAt });
      return jsonResponse(200, traceId, {
        target: "learning-xapi-outbox-replay",
        status: "persisted",
        resourceId: outboxId,
        state: "pending",
        persistedAt: replayedAt,
        traceId,
        valueRedacted: true,
      });
    } catch (error) {
      if (error instanceof LearningLoopStoreError) {
        return jsonResponse(error.status, traceId, {
          target: "learning-xapi-outbox-replay",
          status: "failed",
          reasonCode: error.reasonCode,
          traceId,
          valueRedacted: true,
        });
      }
      return jsonResponse(500, traceId, {
        target: "learning-xapi-outbox-replay",
        status: "failed",
        reasonCode: "outbox-replay-failed",
        traceId,
        valueRedacted: true,
      });
    }
  };
}

async function readOutboxId(request: Request) {
  const text = await request.text();
  if (!text.trim() || Buffer.byteLength(text, "utf8") > 2_000) {
    throw new LearningLoopStoreError(400, "outbox-replay-body-invalid");
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new LearningLoopStoreError(400, "outbox-replay-body-invalid");
  }
  const outboxId =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>).outboxId
      : undefined;
  if (
    typeof outboxId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      outboxId,
    )
  ) {
    throw new LearningLoopStoreError(400, "outbox-id-invalid");
  }
  return outboxId;
}

function readBearerToken(request: Request) {
  return /^Bearer\s+([^\s]+)$/i.exec(
    request.headers.get("authorization")?.trim() ?? "",
  )?.[1];
}

function readSafeTraceId(request: Request) {
  const candidate = request.headers.get("x-uais-trace-id")?.trim();
  return candidate && /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(candidate)
    ? candidate
    : `trace-learning-outbox-replay-${crypto.randomUUID()}`;
}

function jsonResponse(status: number, traceId: string, body: unknown) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-uais-trace-id": traceId },
  });
}
