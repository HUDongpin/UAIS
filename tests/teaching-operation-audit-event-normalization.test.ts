import { describe, expect, it } from "vitest";
import {
  isPersistedTeachingOperationAuditEventWithoutCourseId,
  normalizeTeachingOperationAuditEvent,
} from "@/lib/server/external-storage-serialization";

const persistedAuditEvent = {
  auditId: "audit-course-settings-save-course-settings-20260915",
  traceId: "trace-audit-typecheck-001",
  eventType: "teaching-operation.persisted",
  actorId: "phoebe",
  actorRole: "teacher",
  authMode: "signed-teacher-session",
  operationId: "course-settings",
  actionSlot: "primary",
  actionId: "save-course-settings",
  courseId: "teacher-course-uais-qa-test-owned-20260915-140423",
  requestSource: {
    userAgent: "vitest audit-event typecheck",
    ipAddress: "redacted",
  },
  createdAt: "2026-09-15T11:05:00.000Z",
  redaction: {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  },
};

const signedAuthSession = {
  sessionId: "teacher-phoebe-session",
  authenticatedAt: "2026-09-15T10:30:00.000Z",
  expiresAt: "2026-09-15T12:00:00.000Z",
};

describe("normalizeTeachingOperationAuditEvent authSession round-trip", () => {
  it("keeps persisted operation fields and signed authSession together", () => {
    const event = normalizeTeachingOperationAuditEvent({
      ...persistedAuditEvent,
      authSession: signedAuthSession,
    });

    expect(event.eventType).toBe("teaching-operation.persisted");
    expect(event).toEqual(
      expect.objectContaining({
        operationId: "course-settings",
        actionSlot: "primary",
        actionId: "save-course-settings",
        authSession: signedAuthSession,
      }),
    );
    expect(isPersistedTeachingOperationAuditEventWithoutCourseId(event)).toBe(false);
  });

  it("omits authSession when the source event has none", () => {
    const event = normalizeTeachingOperationAuditEvent(persistedAuditEvent);

    expect(event.eventType).toBe("teaching-operation.persisted");
    expect("authSession" in event).toBe(false);
    expect(event).toEqual(
      expect.objectContaining({
        operationId: "course-settings",
        actionSlot: "primary",
        actionId: "save-course-settings",
      }),
    );
  });

  it("still round-trips authSession on gradebook release events", () => {
    const event = normalizeTeachingOperationAuditEvent({
      auditId: "audit-gradebook-release-20260915",
      traceId: "trace-audit-typecheck-gradebook",
      eventType: "teaching-gradebook-update.released",
      actorId: "phoebe",
      actorRole: "teacher",
      authMode: "signed-teacher-session",
      authSession: signedAuthSession,
      courseId: "teacher-course-uais-qa-test-owned-20260915-140423",
      gradebookUpdateId: "gradebook-update-20260915",
      requestSource: persistedAuditEvent.requestSource,
      createdAt: persistedAuditEvent.createdAt,
      redaction: persistedAuditEvent.redaction,
    });

    expect(event.eventType).toBe("teaching-gradebook-update.released");
    expect(event.authSession).toEqual(signedAuthSession);
    expect(isPersistedTeachingOperationAuditEventWithoutCourseId(event)).toBe(false);
  });

  it("selects persisted events that omit courseId for missing-context alerts", () => {
    const event = normalizeTeachingOperationAuditEvent({
      auditId: persistedAuditEvent.auditId,
      traceId: persistedAuditEvent.traceId,
      eventType: persistedAuditEvent.eventType,
      actorId: persistedAuditEvent.actorId,
      actorRole: persistedAuditEvent.actorRole,
      authMode: persistedAuditEvent.authMode,
      operationId: persistedAuditEvent.operationId,
      actionSlot: persistedAuditEvent.actionSlot,
      actionId: persistedAuditEvent.actionId,
      requestSource: persistedAuditEvent.requestSource,
      createdAt: persistedAuditEvent.createdAt,
      redaction: persistedAuditEvent.redaction,
    });

    expect(event.eventType).toBe("teaching-operation.persisted");
    expect(event).toEqual(
      expect.objectContaining({
        operationId: "course-settings",
        actionSlot: "primary",
        actionId: "save-course-settings",
      }),
    );
    expect("courseId" in event).toBe(false);
    expect(isPersistedTeachingOperationAuditEventWithoutCourseId(event)).toBe(true);
  });
});
