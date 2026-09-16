import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTeachingOperationAuditGetHandler } from "@/app/api/teaching/operations/audit/handler";
import { expandOwnedCourseIdsWithManagedOwnership } from "@/lib/server/teacher-managed-course-ownership";
import { createUaisTeacherAuthSessionCookieHeader } from "@/lib/server/teacher-auth-session";
import { executeTeachingOperationAction, loadTeachingOperationDatabase } from "@/lib/server/teaching-operations-store";

const ownedCourseId = "teacher-course-uais-qa-test-owned-20260915-140423";
const otherOwnedCourseId = "teacher-research-methods";
const unownedCourseId = "other-teacher-course";

function expectNoLocalOrSecretValues(value: unknown, dataDir: string) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(dataDir);
  expect(serialized).not.toContain("/Users/");
  expect(serialized).not.toContain("secret-credential-value");
}

describe("teaching operation audit snapshot ownership readback", () => {
  it("unions snapshot-owned course ids onto the AI-ownership grant list", async () => {
    await expect(
      expandOwnedCourseIdsWithManagedOwnership({
        actorId: "phoebe",
        ownedCourseIds: [otherOwnedCourseId],
        candidateCourseIds: [ownedCourseId, unownedCourseId, otherOwnedCourseId],
        readManagedCourseOwnership: async ({ actorId, courseId }) =>
          actorId === "phoebe" && courseId === ownedCourseId,
      }),
    ).resolves.toEqual([ownedCourseId, otherOwnedCourseId]);
  });

  it("does not add candidate course ids when snapshot ownership is absent", async () => {
    await expect(
      expandOwnedCourseIdsWithManagedOwnership({
        actorId: "phoebe",
        ownedCourseIds: [otherOwnedCourseId],
        candidateCourseIds: [ownedCourseId],
        readManagedCourseOwnership: async () => false,
      }),
    ).resolves.toEqual([otherOwnedCourseId]);
  });

  it("returns the owned-course settings audit after AI ownership omits the snapshot course", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-audit-snapshot-owned-readback-"),
    );
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-snapshot-audit-readback-session",
        actorId: "phoebe",
        role: "teacher",
        authenticatedAt: "2026-09-15T14:04:00.000Z",
        expiresAt: "2026-09-15T15:04:00.000Z",
      },
    });
    const getAudit = createTeachingOperationAuditGetHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      getTeachingOperationCourseOwnership: async () => ({
        teacherId: "phoebe",
        courseIds: [otherOwnedCourseId],
      }),
      readManagedCourseOwnership: async ({ actorId, courseId }) =>
        actorId === "phoebe" && courseId === ownedCourseId,
      now: new Date("2026-09-15T14:10:00.000Z"),
    });

    try {
      const ownedReceipt = await executeTeachingOperationAction({
        dataDir,
        operationId: "course-settings",
        actionSlot: "primary",
        courseId: ownedCourseId,
        sourceAction: "inline-teaching-workspace",
        actorId: "phoebe",
        courseSettingsPatch: {
          description: "Owned course description",
        },
        audit: {
          traceId: "trace-owned-course-settings-save",
          actorRole: "teacher",
          authMode: "signed-teacher-session",
          requestSource: {
            userAgent: "UAIS owned-course settings save",
            ipAddress: "redacted",
          },
        },
        now: new Date("2026-09-15T14:08:00.000Z"),
      });
      await executeTeachingOperationAction({
        dataDir,
        operationId: "content",
        actionSlot: "primary",
        courseId: unownedCourseId,
        sourceAction: "inline-teaching-workspace",
        actorId: "phoebe",
        audit: {
          traceId: "trace-unowned-course-settings-save",
          actorRole: "teacher",
          authMode: "signed-teacher-session",
          requestSource: {
            userAgent: "UAIS owned-course settings save",
            ipAddress: "redacted",
          },
        },
        now: new Date("2026-09-15T14:09:00.000Z"),
      });

      const response = await getAudit(
        new Request("https://www.uais.top/api/teaching/operations/audit", {
          method: "GET",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-owned-course-settings-audit-readback",
            "user-agent": "UAIS owned-course settings audit",
          },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual(
        expect.objectContaining({
          actorId: "phoebe",
          courseIds: [ownedCourseId, otherOwnedCourseId],
          recordCount: 1,
          auditEventCount: 1,
          domainProjectionCount: 1,
        }),
      );
      expect(body.records).toEqual([
        expect.objectContaining({
          recordId: ownedReceipt.receiptId,
          courseId: ownedCourseId,
          operationId: "course-settings",
          actionSlot: "primary",
        }),
      ]);
      expect(body.auditEvents).toEqual([
        expect.objectContaining({
          traceId: "trace-owned-course-settings-save",
          courseId: ownedCourseId,
          actorId: "phoebe",
        }),
      ]);
      expect(body.domainProjections).toEqual([
        expect.objectContaining({
          objectType: "course-settings",
          courseId: ownedCourseId,
          operationRecordId: ownedReceipt.receiptId,
          status: "saved",
          description: "Owned course description",
        }),
      ]);
      expect(JSON.stringify(body)).not.toContain(unownedCourseId);
      expect(JSON.stringify(body)).not.toContain("trace-unowned-course-settings-save");
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps AI-ownership-only audit scoped when snapshot ownership is false", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-audit-snapshot-denied-readback-"),
    );
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-snapshot-denied-audit-session",
        actorId: "phoebe",
        role: "teacher",
        authenticatedAt: "2026-09-15T14:04:00.000Z",
        expiresAt: "2026-09-15T15:04:00.000Z",
      },
    });
    const getAudit = createTeachingOperationAuditGetHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      getTeachingOperationCourseOwnership: async () => ({
        teacherId: "phoebe",
        courseIds: [otherOwnedCourseId],
      }),
      readManagedCourseOwnership: async () => false,
      now: new Date("2026-09-15T14:10:00.000Z"),
    });

    try {
      await executeTeachingOperationAction({
        dataDir,
        operationId: "course-settings",
        actionSlot: "primary",
        courseId: ownedCourseId,
        actorId: "phoebe",
        audit: {
          traceId: "trace-snapshot-denied-course-settings",
          actorRole: "teacher",
          authMode: "signed-teacher-session",
          requestSource: {
            userAgent: "UAIS snapshot denial",
            ipAddress: "redacted",
          },
        },
        now: new Date("2026-09-15T14:08:00.000Z"),
      });

      const response = await getAudit(
        new Request("https://www.uais.top/api/teaching/operations/audit", {
          method: "GET",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-snapshot-denied-audit-readback",
          },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.courseIds).toEqual([otherOwnedCourseId]);
      expect(body.records).toEqual([]);
      expect(body.auditEvents).toEqual([]);
      expect(JSON.stringify(body)).not.toContain(ownedCourseId);
      expect(JSON.stringify(body)).not.toContain("trace-snapshot-denied-course-settings");
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed when snapshot ownership lookup throws during audit readback", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-audit-snapshot-throw-readback-"),
    );
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-snapshot-throw-audit-session",
        actorId: "phoebe",
        role: "teacher",
        authenticatedAt: "2026-09-15T14:04:00.000Z",
        expiresAt: "2026-09-15T15:04:00.000Z",
      },
    });
    const getAudit = createTeachingOperationAuditGetHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      getTeachingOperationCourseOwnership: async () => ({
        teacherId: "phoebe",
        courseIds: [otherOwnedCourseId],
      }),
      readManagedCourseOwnership: async () => {
        throw new Error("snapshot transport failed");
      },
      now: new Date("2026-09-15T14:10:00.000Z"),
    });

    try {
      await executeTeachingOperationAction({
        dataDir,
        operationId: "course-settings",
        actionSlot: "primary",
        courseId: ownedCourseId,
        actorId: "phoebe",
        audit: {
          traceId: "trace-snapshot-throw-course-settings",
          actorRole: "teacher",
          authMode: "signed-teacher-session",
          requestSource: {
            userAgent: "UAIS snapshot throw",
            ipAddress: "redacted",
          },
        },
        now: new Date("2026-09-15T14:08:00.000Z"),
      });

      const response = await getAudit(
        new Request("https://www.uais.top/api/teaching/operations/audit", {
          method: "GET",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-snapshot-throw-audit-readback",
          },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teaching operation audit course ownership check failed.",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "teacher-course-ownership-check-failed",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain("trace-snapshot-throw-course-settings");
      expect(JSON.stringify(body)).not.toContain("snapshot transport failed");
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("reads the managed snapshot instead of an empty local JSON file during audit GET", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-audit-snapshot-not-empty-file-"),
    );
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-snapshot-not-file-session",
        actorId: "phoebe",
        role: "teacher",
        authenticatedAt: "2026-09-15T14:04:00.000Z",
        expiresAt: "2026-09-15T15:04:00.000Z",
      },
    });
    const snapshotReceipt = await executeTeachingOperationAction({
      dataDir,
      operationId: "course-settings",
      actionSlot: "primary",
      courseId: ownedCourseId,
      sourceAction: "inline-teaching-workspace",
      actorId: "phoebe",
      courseSettingsPatch: {
        description: "UAIS-QA-READBACK-OK-20260915",
      },
      audit: {
        traceId: "trace-snapshot-not-file-course-settings",
        actorRole: "teacher",
        authMode: "signed-teacher-session",
        authSession: {
          sessionId: "teacher-snapshot-not-file-session",
          authenticatedAt: "2026-09-15T14:04:00.000Z",
          expiresAt: "2026-09-15T15:04:00.000Z",
        },
        requestSource: {
          userAgent: "UAIS snapshot not file",
          ipAddress: "redacted",
        },
      },
      now: new Date("2026-09-15T14:08:00.000Z"),
    });
    const snapshot = await loadTeachingOperationDatabase({ dataDir });
    await rm(join(dataDir, "teaching-operations.json"), { force: true });

    const getAudit = createTeachingOperationAuditGetHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_TEACHING_OPERATIONS_SNAPSHOT_BACKEND: "postgres",
      },
      getTeachingOperationCourseOwnership: async () => ({
        teacherId: "phoebe",
        courseIds: [otherOwnedCourseId],
      }),
      readManagedCourseOwnership: async ({ actorId, courseId }) =>
        actorId === "phoebe" && courseId === ownedCourseId,
      readSnapshotTeachingOperationDatabase: async () => snapshot,
      now: new Date("2026-09-15T14:10:00.000Z"),
    });

    try {
      const response = await getAudit(
        new Request("https://www.uais.top/api/teaching/operations/audit", {
          method: "GET",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-snapshot-not-file-audit-readback",
          },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.auditEvents).toEqual([
        expect.objectContaining({
          traceId: "trace-snapshot-not-file-course-settings",
          courseId: ownedCourseId,
          authSession: expect.objectContaining({
            sessionId: "teacher-snapshot-not-file-session",
          }),
        }),
      ]);
      expect(body.records).toEqual([
        expect.objectContaining({
          recordId: snapshotReceipt.receiptId,
          courseId: ownedCourseId,
        }),
      ]);
      expect(body.domainProjections).toEqual([
        expect.objectContaining({
          objectType: "course-settings",
          description: "UAIS-QA-READBACK-OK-20260915",
        }),
      ]);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("authorizes an owned requested course even when the audit source has no events yet", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-audit-empty-source-owned-course-"),
    );
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-empty-source-owned-session",
        actorId: "phoebe",
        role: "teacher",
        authenticatedAt: "2026-09-15T14:04:00.000Z",
        expiresAt: "2026-09-15T15:04:00.000Z",
      },
    });
    const getAudit = createTeachingOperationAuditGetHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      getTeachingOperationCourseOwnership: async () => ({
        teacherId: "phoebe",
        courseIds: [],
      }),
      readManagedCourseOwnership: async ({ actorId, courseId }) =>
        actorId === "phoebe" && courseId === ownedCourseId,
      now: new Date("2026-09-15T14:10:00.000Z"),
    });

    try {
      const response = await getAudit(
        new Request("https://www.uais.top/api/teaching/operations/audit", {
          method: "GET",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-empty-source-owned-course-audit",
            "x-uais-course-id": ownedCourseId,
          },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual(
        expect.objectContaining({
          actorId: "phoebe",
          courseIds: [ownedCourseId],
          recordCount: 0,
          auditEventCount: 0,
          domainProjectionCount: 0,
        }),
      );
      expect(body.records).toEqual([]);
      expect(body.auditEvents).toEqual([]);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("does not add a requested course id that the snapshot owner check rejects", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-audit-requested-unowned-course-"),
    );
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-requested-unowned-session",
        actorId: "phoebe",
        role: "teacher",
        authenticatedAt: "2026-09-15T14:04:00.000Z",
        expiresAt: "2026-09-15T15:04:00.000Z",
      },
    });
    const getAudit = createTeachingOperationAuditGetHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      getTeachingOperationCourseOwnership: async () => ({
        teacherId: "phoebe",
        courseIds: [otherOwnedCourseId],
      }),
      readManagedCourseOwnership: async () => false,
      now: new Date("2026-09-15T14:10:00.000Z"),
    });

    try {
      const response = await getAudit(
        new Request("https://www.uais.top/api/teaching/operations/audit", {
          method: "GET",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-requested-unowned-course-audit",
            "x-uais-course-id": ownedCourseId,
          },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.courseIds).toEqual([otherOwnedCourseId]);
      expect(JSON.stringify(body)).not.toContain(ownedCourseId);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
