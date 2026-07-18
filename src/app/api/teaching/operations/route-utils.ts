import { TeachingCourseManagementStoreError } from "@/lib/server/teaching-course-management-store";
import {
  TeachingOperationStoreError,
  type TeachingOperationActionSlot,
} from "@/lib/server/teaching-operations-store";

// Pure leaf utilities for the teaching-operations route handler (Phase 3
// decomposition): record guard, redaction, JSON responses, production-runtime
// check, and action-slot validation. No route-internal dependencies, so feature
// clusters can import these without a cycle.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createRedaction() {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  } as const;
}

export function jsonResponse(status: number, body: unknown, traceId?: string) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      ...(traceId ? { "x-uais-trace-id": traceId } : {}),
    },
  });
}

export function normalizeActionSlot(value: unknown): TeachingOperationActionSlot {
  if (value === "primary" || value === "secondary") {
    return value;
  }
  throw new TeachingOperationStoreError(400, "Unsupported teaching operation action.");
}

export function normalizeTeachingOperationRouteError(error: unknown) {
  if (error instanceof TeachingCourseManagementStoreError) {
    return {
      status: error.status,
      message: error.message,
      ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}),
    };
  }
  if (error instanceof TeachingOperationStoreError) {
    return {
      status: error.status,
      message: error.message,
    };
  }
  return {
    status: 500,
    message: "Teaching operation backend request failed.",
  };
}
