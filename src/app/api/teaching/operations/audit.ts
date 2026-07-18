import { randomUUID } from "node:crypto";
import type { TeachingOperationAuditRequestSource } from "@/lib/server/teaching-operations-store";
import type { TeachingOperationAuthenticatedTeacher } from "./route-utils";

// Audit-input builders for the teaching-operations route (Phase 3 decomposition):
// trace-id/idempotency-key extraction, audit request-source classification, and
// referer/header sanitization. Self-contained pure helpers.

export function createTeachingOperationAuditInput(input: {
  traceId: string;
  request: Request;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
}) {
  return {
    traceId: input.traceId,
    actorRole: input.authenticatedTeacher.role,
    authMode: "signed-teacher-session" as const,
    authSession: {
      sessionId: input.authenticatedTeacher.sessionId,
      authenticatedAt: input.authenticatedTeacher.authenticatedAt,
      expiresAt: input.authenticatedTeacher.expiresAt,
    },
    requestSource: readAuditRequestSource(input.request),
  };
}

export function readSafeTraceId(request: Request) {
  const headerTraceId = request.headers.get("x-uais-trace-id")?.trim();
  if (headerTraceId && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(headerTraceId)) {
    return headerTraceId;
  }
  return `trace-${randomUUID()}`;
}

export function readAuditRequestSource(request: Request): TeachingOperationAuditRequestSource {
  const originClass = classifyRequestOrigin(request.headers.get("origin"));
  const refererPath = sanitizeRefererPath(request.headers.get("referer"));
  return {
    userAgent: sanitizeRequestSourceHeader(request.headers.get("user-agent")) ?? "unknown",
    ipAddress: "redacted",
    ...(originClass ? { originClass } : {}),
    ...(refererPath ? { refererPath } : {}),
  };
}

export function classifyRequestOrigin(value: string | null): TeachingOperationAuditRequestSource["originClass"] | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }
  try {
    const url = new URL(normalized);
    if (isLocalAuditHost(url.hostname)) {
      return "local-loopback";
    }
    if (url.protocol === "https:") {
      return "remote-https";
    }
    return "non-https";
  } catch {
    return "unknown";
  }
}

export function sanitizeRefererPath(value: string | null) {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }
  try {
    const { pathname } = new URL(normalized);
    return sanitizeRequestSourceHeader(pathname) ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function isLocalAuditHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function readIdempotencyKey(input: {
  request: Request;
  body: Record<string, unknown>;
}) {
  const bodyValue =
    typeof input.body.idempotencyKey === "string" ? input.body.idempotencyKey : undefined;
  const headerValue = input.request.headers.get("x-uais-idempotency-key") ?? undefined;
  const normalized = (bodyValue ?? headerValue)?.trim();
  return normalized || undefined;
}

export function sanitizeRequestSourceHeader(value: string | null) {
  const normalized = value?.trim().slice(0, 160);
  if (!normalized) {
    return undefined;
  }
  if (/\/Users\/|secret|api[_-]?key|token/i.test(normalized)) {
    return "redacted";
  }
  return normalized;
}
