import { randomUUID, timingSafeEqual } from "node:crypto";
import { createUaisTeachingCourseManagementRepository } from "@/lib/server/teaching-course-management-external-store";
import {
  assertTeachingCourseManagementLocalJsonRuntimeAllowed,
  recordTeachingCollaborationInviteEmailDeliveryCallback,
  resolveTeachingCourseManagementDataDir,
  type TeachingCourseManagementAuditRequestSource,
  TeachingCourseManagementStoreError,
} from "@/lib/server/teaching-course-management-store";

export const dynamic = "force-dynamic";

type TeachingCollaborationInviteEmailDeliveryCallbackPostHandlerDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
};

type CollaborationInviteEmailDeliveryCallbackBody = {
  eventType: "collaboration-invite-email.delivery-status";
  courseId: string;
  operationRecordId: string;
  outboxId: string;
  deliveryId: string;
  providerStatus: "bounced";
  occurredAt?: string;
  failureReason: string;
};

export const POST = createTeachingCollaborationInviteEmailDeliveryCallbackPostHandler();

export function createTeachingCollaborationInviteEmailDeliveryCallbackPostHandler(
  deps: TeachingCollaborationInviteEmailDeliveryCallbackPostHandlerDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function POST(request: Request) {
    const traceId = readSafeTraceId(request);
    try {
      const callbackToken = readCallbackToken(env);
      if (!hasMatchingBearerToken(request, callbackToken)) {
        return jsonResponse(401, {
          error: "UAIS collaboration invite email callback authentication is required.",
          traceId,
          access: {
            status: "denied",
            reasonCode: "provider-callback-token-required",
            responsibleSession: "S12",
            redaction: createRedaction(),
          },
          redaction: createRedaction(),
        }, traceId);
      }

      const body = await readCallbackBody(request);
      const occurredAt = readCallbackOccurredAt(body, deps.now);
      const courseManagementRepository = createUaisTeachingCourseManagementRepository({
        env,
        fetch: deps.fetch,
      });
      if (!courseManagementRepository) {
        assertTeachingCourseManagementLocalJsonRuntimeAllowed(env);
      }

      const { receipt } = await recordTeachingCollaborationInviteEmailDeliveryCallback({
        dataDir: resolveTeachingCourseManagementDataDir(env.UAIS_TEACHING_COURSES_DATA_DIR),
        repository: courseManagementRepository,
        courseId: body.courseId,
        operationRecordId: body.operationRecordId,
        outboxId: body.outboxId,
        providerDeliveryId: body.deliveryId,
        providerStatus: body.providerStatus,
        failureReason: body.failureReason,
        audit: {
          requestSource: readAuditRequestSource(request),
        },
        traceId,
        now: occurredAt,
      });

      return jsonResponse(200, {
        traceId,
        collaborationInviteEmailDeliveryCallbackReceipt: {
          ...receipt,
          deliveryStatus: "failed",
          providerStatus: "smtp-provider-bounced",
          deliveryId: body.deliveryId,
          outboxId: body.outboxId,
          failureReason: body.failureReason,
          redaction: createRedaction(),
        },
        redaction: createRedaction(),
      }, traceId);
    } catch (error) {
      return createErrorResponse(error, traceId);
    }
  };
}

function readCallbackToken(env: Record<string, string | undefined>) {
  const token = env.UAIS_COLLABORATION_INVITE_EMAIL_CALLBACK_TOKEN?.trim();
  if (!token || token.length < 32) {
    throw new TeachingCourseManagementStoreError(
      503,
      "Collaboration invite email callback token is not configured.",
    );
  }
  return token;
}

function hasMatchingBearerToken(request: Request, expectedToken: string) {
  const authorization = request.headers.get("authorization")?.trim();
  const match = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
  const token = match?.[1]?.trim();
  if (!token) {
    return false;
  }
  const actualBytes = Buffer.from(token);
  const expectedBytes = Buffer.from(expectedToken);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

function readAuditRequestSource(request: Request): TeachingCourseManagementAuditRequestSource {
  return {
    userAgent: sanitizeRequestSourceHeader(request.headers.get("user-agent")) ?? "unknown",
    ipAddress: "redacted",
  };
}

function sanitizeRequestSourceHeader(value: string | null) {
  const normalized = value?.trim().replace(/\s+/g, " ").slice(0, 160);
  if (!normalized) {
    return undefined;
  }
  if (/\/Users\/|secret|api[_-]?key|token/i.test(normalized)) {
    return "redacted";
  }
  return normalized;
}

async function readCallbackBody(
  request: Request,
): Promise<CollaborationInviteEmailDeliveryCallbackBody> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new TeachingCourseManagementStoreError(400, "Callback JSON body is required.");
  }
  if (!isRecord(value)) {
    throw new TeachingCourseManagementStoreError(400, "Callback JSON body is invalid.");
  }
  if (
    value.eventType !== "collaboration-invite-email.delivery-status" ||
    value.providerStatus !== "bounced"
  ) {
    throw new TeachingCourseManagementStoreError(
      400,
      "Collaboration invite email delivery callback status is invalid.",
    );
  }
  return {
    eventType: "collaboration-invite-email.delivery-status",
    courseId: readSafeBodyId(value.courseId, "course id"),
    operationRecordId: readSafeBodyId(value.operationRecordId, "operation record id"),
    outboxId: readSafeBodyId(value.outboxId, "outbox id"),
    deliveryId: readSafeBodyId(value.deliveryId, "delivery id"),
    providerStatus: "bounced",
    ...(typeof value.occurredAt === "string" ? { occurredAt: value.occurredAt } : {}),
    failureReason: readSafeBodyId(value.failureReason, "failure reason"),
  };
}

function readCallbackOccurredAt(
  body: CollaborationInviteEmailDeliveryCallbackBody,
  fallback?: Date,
) {
  if (!body.occurredAt) {
    return fallback;
  }
  const occurredAt = new Date(body.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new TeachingCourseManagementStoreError(400, "Callback occurredAt is invalid.");
  }
  return occurredAt;
}

function readSafeBodyId(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 160 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)
  ) {
    throw new TeachingCourseManagementStoreError(400, `Invalid callback ${label}.`);
  }
  return value;
}

function readSafeTraceId(request: Request) {
  const headerTraceId = request.headers.get("x-uais-trace-id")?.trim();
  if (headerTraceId && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(headerTraceId)) {
    return headerTraceId;
  }
  return `trace-${randomUUID()}`;
}

function createErrorResponse(error: unknown, traceId: string) {
  if (error instanceof TeachingCourseManagementStoreError) {
    return jsonResponse(error.status, {
      error: error.message,
      traceId,
      redaction: createRedaction(),
    }, traceId);
  }

  return jsonResponse(500, {
    error: "Teaching collaboration invite email delivery callback failed.",
    traceId,
    redaction: createRedaction(),
  }, traceId);
}

function jsonResponse(status: number, body: unknown, traceId: string) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-uais-trace-id": traceId,
    },
  });
}

function createRedaction() {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
