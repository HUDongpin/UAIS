import { TeachingOperationStoreError } from "./teaching-operations-error";
import {
  isRecord,
  requireAuditOriginClass,
  requireIsoDate,
  requireSafeAuditSourceText,
  requireSafeId,
} from "./teaching-operations-guards";
import type {
  TeachingOperationAuditAuthSession,
  TeachingOperationAuditRequestSource,
  TeachingOperationCourseSettingsAppliedField,
  TeachingOperationCourseSettingsProjection,
} from "./teaching-operations-store";

// Audit-source/auth-session and course-settings input normalizers for the
// teaching-operations store (Phase 3 decomposition). They depend on the extracted
// error + guards modules at runtime and on store types via a type-only import, so
// there is no runtime import cycle. Behavior is identical to the previous inline
// definitions.

export function normalizeAuditRequestSource(value: unknown): TeachingOperationAuditRequestSource {
  if (!isRecord(value)) {
    return {
      userAgent: "unknown",
      ipAddress: "redacted",
    };
  }

  return {
    userAgent: requireSafeAuditSourceText(value.userAgent, "user agent"),
    ipAddress: "redacted",
    ...(typeof value.originClass === "string"
      ? { originClass: requireAuditOriginClass(value.originClass) }
      : {}),
    ...(typeof value.refererPath === "string"
      ? { refererPath: requireSafeAuditSourceText(value.refererPath, "referer path") }
      : {}),
  };
}

export function normalizeAuditAuthSession(value: unknown): TeachingOperationAuditAuthSession {
  if (!isRecord(value)) {
    throw new TeachingOperationStoreError(500, "Teaching operation audit auth session is invalid.");
  }

  return {
    sessionId: requireSafeId(value.sessionId, "auth session id"),
    authenticatedAt: requireIsoDate(value.authenticatedAt, "authenticatedAt"),
    expiresAt: requireIsoDate(value.expiresAt, "expiresAt"),
  };
}

export function normalizeCourseSettingsPatchProjectionSnapshot(value: unknown) {
  if (!isRecord(value)) {
    return {};
  }

  const snapshot: Partial<
    Pick<
      TeachingOperationCourseSettingsProjection,
      | "appliedFields"
      | "courseName"
      | "instructor"
      | "unit"
      | "department"
      | "semester"
      | "description"
    >
  > = {};
  const appliedFields: TeachingOperationCourseSettingsAppliedField[] = [];
  for (const field of [
    "courseName",
    "instructor",
    "unit",
    "department",
    "semester",
    "description",
  ] as const) {
    const text = normalizeCourseSettingsProjectionText(value[field]);
    if (!text) {
      continue;
    }
    snapshot[field] = text;
    appliedFields.push(field);
  }
  if (appliedFields.length > 0) {
    snapshot.appliedFields = appliedFields;
  }
  return snapshot;
}

function normalizeCourseSettingsProjectionText(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }
  const text = value.trim();
  if (!text) {
    return undefined;
  }
  return text.slice(0, 500);
}
