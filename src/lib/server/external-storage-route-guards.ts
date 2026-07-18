import type { UaisAiActorRole } from "@/lib/server/ai-access-control";
import { HttpError } from "./external-storage-http-error";

// Request/response guards, validators, and merge/format helpers for the
// external-storage route service (Phase 3 decomposition). Pure functions that
// throw HttpError(400) on invalid input; no filesystem or service-config
// dependencies, so the service's handler and normalizer clusters can share them
// without importing the ~4.1k-line service module.

export function jsonResponse(status: number, body: unknown) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
    },
  });
}

export function createErrorResponse(error: unknown) {
  const status = error instanceof HttpError ? error.status : 500;
  return jsonResponse(status, {
    error:
      error instanceof HttpError
        ? error.message
        : "External storage service request failed.",
    redaction: createRedaction(),
  });
}

export function createRedaction() {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  } as const;
}

export function mergeIdList(left: string[] = [], right: string[] = []) {
  return Array.from(new Set([...left, ...right]));
}

export function mergeById<T extends Record<K, string>, K extends keyof T>(
  left: T[] = [],
  right: T[] = [],
  key: K,
) {
  const merged = new Map<string, T>();
  for (const item of [...left, ...right]) {
    const previous = merged.get(item[key]);
    merged.set(item[key], {
      ...(previous ?? {}),
      ...item,
    });
  }
  return Array.from(merged.values());
}

export function arrayOrEmpty(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export function uniqueSafeIds(value: unknown, label: string) {
  return Array.from(new Set(arrayOrEmpty(value).map((entry) => requireSafeId(entry, label))));
}

export function requireRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new HttpError(400, `${label} must be an object.`);
  }
}

export function requireSafeId(value: unknown, label: string) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new HttpError(400, `Invalid ${label}.`);
  }
  return value;
}

export function requireSafeRole(value: unknown): UaisAiActorRole {
  if (value !== "teacher" && value !== "admin") {
    throw new HttpError(400, "Invalid actor role.");
  }
  return value;
}

export function requireTeachingOperationActionSlot(value: unknown): "primary" | "secondary" {
  if (value !== "primary" && value !== "secondary") {
    throw new HttpError(400, "Invalid teaching operation action slot.");
  }
  return value;
}

export function requireAlertSeverity(value: unknown): "high" {
  if (value !== "high") {
    throw new HttpError(400, "Invalid teaching operation alert severity.");
  }
  return value;
}

export function requireTeachingOperationAlertReason(
  value: unknown,
): "missing-course-context" {
  if (value !== "missing-course-context") {
    throw new HttpError(400, "Invalid teaching operation alert reason.");
  }
  return value;
}

export function requireNonNegativeInteger(value: unknown, label: string) {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new HttpError(400, `Invalid ${label}.`);
  }
  return Number(value);
}

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function requireIsoDate(value: unknown, label: string) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new HttpError(400, `${label} must be an ISO date.`);
  }
  return new Date(Date.parse(value)).toISOString();
}

export function formatTimestampId(value: string) {
  const iso = requireIsoDate(value, "timestamp");
  return iso
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "")
    .replace("T", "-");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
