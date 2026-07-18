import { TeachingOperationStoreError } from "./teaching-operations-error";
import type {
  TeachingOperationActionSlot,
  TeachingOperationAuditRequestSource,
  TeachingOperationIdempotencyStatus,
  TeachingOperationProductionDatabaseAdapterEvidence,
  TeachingOperationRedaction,
} from "./teaching-operations-store";

// Pure input-validation guards and the redaction helper for the
// teaching-operations store, extracted (Phase 3 decomposition) from the ~4.9k-line
// store. They throw TeachingOperationStoreError on invalid input and depend only
// on the error module at runtime (the store types are a type-only import, so there
// is no runtime import cycle). Behavior is identical to the previous inline
// definitions.

const maxSafeIdLength = 120;

export function requireActionSlot(value: unknown): TeachingOperationActionSlot {
  if (value === "primary" || value === "secondary") {
    return value;
  }
  throw new TeachingOperationStoreError(500, "Teaching operation action slot is invalid.");
}

export function requireAuditOriginClass(
  value: string,
): TeachingOperationAuditRequestSource["originClass"] {
  if (
    value === "remote-https" ||
    value === "local-loopback" ||
    value === "non-https" ||
    value === "unknown"
  ) {
    return value;
  }
  return "unknown";
}

export function isTeachingOperationIdempotencyStatus(
  value: unknown,
): value is TeachingOperationIdempotencyStatus {
  return value === "created" || value === "already-persisted";
}

export function createRedaction(): TeachingOperationRedaction {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };
}

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

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function isTeachingOperationProductionRuntime(
  env: Record<string, string | undefined>,
) {
  return (
    env.VERCEL_ENV === "production" ||
    env.NODE_ENV === "production" ||
    env.UAIS_DEPLOYMENT_ENV === "production"
  );
}

export function isTeachingOperationProductionDatabaseAdapterEvidence(
  value: unknown,
): value is TeachingOperationProductionDatabaseAdapterEvidence {
  return (
    isRecord(value) &&
    value.status === "ready" &&
    value.providerClass === "managed-database" &&
    value.migrationStatus === "up-to-date" &&
    value.backupPolicy === "point-in-time-restore" &&
    value.concurrencyControl === "transactional" &&
    value.valueRedacted === true
  );
}
