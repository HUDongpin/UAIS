import { LearningLoopValidationError } from "@/lib/learning-loop/domain";
import { LearningLoopStoreError } from "@/lib/learning-loop/postgres-store";

export function readLearningLoopTraceId(request: Request) {
  const candidate = request.headers.get("x-uais-trace-id")?.trim();
  return candidate && /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(candidate)
    ? candidate
    : `trace-learning-loop-${crypto.randomUUID()}`;
}

export async function readLearningLoopJsonBody(
  request: Request,
  maxBytes = 100_000,
) {
  const text = await request.text();
  if (!text.trim()) throw new LearningLoopStoreError(400, "request-body-required");
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new LearningLoopStoreError(413, "request-body-too-large");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new LearningLoopStoreError(400, "request-body-invalid-json");
  }
}

export function readLearningLoopRecord(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new LearningLoopStoreError(400, "request-body-invalid");
  }
  return value as Record<string, unknown>;
}

export function readLearningLoopRevision(
  value: unknown,
  reasonCode: string,
  minimum = 0,
) {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < minimum) {
    throw new LearningLoopStoreError(400, reasonCode);
  }
  return revision;
}

export function readLearningLoopIdempotencyKey(request: Request) {
  const value = request.headers.get("idempotency-key")?.trim();
  if (!value || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) {
    throw new LearningLoopStoreError(400, "idempotency-key-required");
  }
  return value;
}

export function createLearningLoopAccessDeniedResponse(
  reasonCode: string,
  traceId: string,
) {
  return createLearningLoopJsonResponse(
    reasonCode === "student-session-required" || reasonCode.endsWith("session-required")
      ? 401
      : 403,
    traceId,
    { status: "denied", reasonCode, traceId },
  );
}

export function createLearningLoopErrorResponse(
  error: unknown,
  traceId: string,
  fallbackReasonCode: string,
) {
  if (error instanceof LearningLoopValidationError) {
    return createLearningLoopJsonResponse(400, traceId, {
      status: "invalid",
      reasonCode: error.code,
      traceId,
    });
  }
  if (error instanceof LearningLoopStoreError) {
    return createLearningLoopJsonResponse(error.status, traceId, {
      status: error.status === 409 ? "conflict" : "failed",
      reasonCode: error.reasonCode,
      ...(error.details ?? {}),
      traceId,
    });
  }
  return createLearningLoopJsonResponse(500, traceId, {
    status: "failed",
    reasonCode: fallbackReasonCode,
    traceId,
  });
}

export function createLearningLoopJsonResponse(
  status: number,
  traceId: string,
  body: unknown,
) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-uais-trace-id": traceId,
    },
  });
}
