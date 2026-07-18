import { resolve } from "node:path";
import { TeachingCourseManagementStoreError } from "./teaching-course-management-error";
import type {
  TeachingCourseManagementAuditRequestSource,
  TeachingCourseManagementAuditStoragePolicy,
  TeachingCourseManagementRecordStoragePolicy,
  TeachingCourseManagementRedaction,
  TeachingCourseManagementStorageWritePolicy,
} from "@/lib/server/teaching-course-management-types";

// Pure guards, small policy/audit normalizers, and the redaction helper for the
// teaching-course-management store (Phase 3 decomposition). Cycle-free: runtime deps
// are node:path + the extracted error module; the store types are a type-only import.

export function ensureWithinBase(baseDir: string, filePath: string) {
  const normalizedBase = resolve(baseDir);
  const normalizedPath = resolve(filePath);
  if (normalizedPath !== normalizedBase && !normalizedPath.startsWith(`${normalizedBase}/`)) {
    throw new TeachingCourseManagementStoreError(
      400,
      "Teaching course management path escapes the configured data directory.",
    );
  }
}

export function requireSafeId(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 160 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)
  ) {
    throw new TeachingCourseManagementStoreError(400, `Invalid ${label}.`);
  }
  return value;
}

export function requireTrimmedString(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TeachingCourseManagementStoreError(400, `Invalid ${label}.`);
  }
  return value.trim().slice(0, maxLength);
}

export function requireNonnegativeInteger(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TeachingCourseManagementStoreError(500, `Invalid ${label}.`);
  }
  return value;
}

export function optionalTrimmedString(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : undefined;
}

export function requireIsoDate(value: unknown, label: string) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new TeachingCourseManagementStoreError(500, `Invalid ${label}.`);
  }
  return value;
}

export function normalizeAuditRequestSource(
  value: unknown,
): TeachingCourseManagementAuditRequestSource {
  if (!isRecord(value)) {
    return {
      userAgent: "unknown",
      ipAddress: "redacted",
    };
  }

  return {
    userAgent: sanitizeAuditSourceText(value.userAgent),
    ipAddress: "redacted",
  };
}

export function sanitizeAuditSourceText(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return "unknown";
  }
  const normalized = value.trim().slice(0, 160);
  if (/\/Users\/|secret|api[_-]?key|token/i.test(normalized)) {
    return "redacted";
  }
  return normalized;
}

export function requireInviteCode(value: unknown, status = 500) {
  if (typeof value !== "string" || !/^\d{8}$/.test(value)) {
    throw new TeachingCourseManagementStoreError(status, "Invite code is invalid.");
  }
  return value;
}

export function requireSafeUrlPath(value: unknown, label: string) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    throw new TeachingCourseManagementStoreError(500, `Invalid ${label}.`);
  }
  return value;
}

export function normalizeRecordStoragePolicy(
  value: unknown,
): TeachingCourseManagementRecordStoragePolicy {
  if (
    value === "external-redacted-teaching-course-management-snapshot" ||
    value === "postgres-teaching-course-management-snapshot"
  ) {
    return value;
  }
  return "local-json-teaching-course-management";
}

export function normalizeAuditStoragePolicy(
  value: unknown,
): TeachingCourseManagementAuditStoragePolicy {
  if (
    value === "external-redacted-teaching-course-management-audit-log" ||
    value === "postgres-teaching-course-management-audit-log"
  ) {
    return value;
  }
  return "local-json-teaching-course-management-audit-log";
}

export function normalizeStorageWritePolicy(
  value: unknown,
): TeachingCourseManagementStorageWritePolicy {
  if (
    value === "external-optimistic-snapshot-replace" ||
    value === "postgres-transactional-snapshot-replace"
  ) {
    return value;
  }
  return "atomic-json-file-replace";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createRedaction(): TeachingCourseManagementRedaction {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };
}
