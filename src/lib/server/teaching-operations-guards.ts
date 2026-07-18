import { TeachingOperationStoreError } from "./teaching-operations-error";

// Pure input-validation guards for the teaching-operations store, extracted
// (Phase 3 decomposition) from the ~4.9k-line store. Each throws
// TeachingOperationStoreError on invalid input and depends only on the error
// module, so this module has no import cycle with the store. Behavior is
// identical to the previous inline definitions.

const maxSafeIdLength = 120;

export function requireInviteCode(value: unknown) {
  if (typeof value !== "string" || !/^\d{8}$/.test(value)) {
    throw new TeachingOperationStoreError(500, "Invite code is invalid.");
  }
  return value;
}

export function requireSafeId(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maxSafeIdLength ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)
  ) {
    throw new TeachingOperationStoreError(400, `Invalid ${label}.`);
  }
  return value;
}

export function requireSafeUrlPath(value: unknown, label: string) {
  if (typeof value !== "string" || !value.startsWith("/") || value.includes("/Users/")) {
    throw new TeachingOperationStoreError(500, `Invalid ${label}.`);
  }
  return value;
}

export function requireIsoDate(value: unknown, label: string) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new TeachingOperationStoreError(500, `Invalid ${label}.`);
  }
  return value;
}

export function requireSafeAuditSourceText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    return "unknown";
  }
  const normalized = value.trim().slice(0, 160);
  if (/\/Users\/|secret|api[_-]?key|token/i.test(normalized)) {
    throw new TeachingOperationStoreError(400, `Invalid ${label}.`);
  }
  return normalized;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
