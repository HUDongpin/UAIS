import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEACHING_OPERATION_IDS } from "@/components/teaching/teaching-operation-data";
import {
  createTeachingOperationActionPostHandler,
} from "@/app/api/teaching/operations/route";
import {
  createTeachingOperationAuditGetHandler,
} from "@/app/api/teaching/operations/audit/route";
import {
  createTeachingOperationExportGetHandler,
} from "@/app/api/teaching/operations/export/[manifestId]/route";
import {
  createTeachingOperationBackupRestorePostHandler,
} from "@/app/api/teaching/operations/backups/[backupId]/restore/route";
import {
  createTeachingOperationRecordRollbackPostHandler,
} from "@/app/api/teaching/operations/records/[recordId]/rollback/route";
import {
  createTeachingGradebookReleasePostHandler,
} from "@/app/api/teaching/gradebook-updates/[objectId]/release/route";
import {
  createTeachingGradebookReleaseRollbackPostHandler,
} from "@/app/api/teaching/gradebook-updates/[objectId]/rollback/route";
import {
  createTeachingInviteCodeJoinPostHandler,
} from "@/app/api/teaching/invite-codes/[code]/join/route";
import {
  createTeachingCourseClassPostHandler,
} from "@/app/api/teaching/courses/[courseId]/classes/route";
import { createUaisAppSessionCookie } from "@/lib/server/uais-app-session";
import {
  executeTeachingOperationAction,
  readTeachingOperationDatabase,
} from "@/lib/server/teaching-operations-store";
import { createUaisTeachingCourseManagementRepository } from "@/lib/server/teaching-course-management-external-store";
import {
  approveTeachingClassMembership,
  createTeachingClassRecord,
  createTeachingCourseRecord,
  joinTeachingClassByInviteCode,
  readTeachingCourseManagementDatabase,
} from "@/lib/server/teaching-course-management-store";
import { storeUaisTeacherAiOwnershipRecord } from "@/lib/server/teacher-ai-ownership-store";
import { createUaisTeacherAuthSessionCookieHeader } from "@/lib/server/teacher-auth-session";

const productionTeacherAuthIssuerSecret =
  "test-teacher-auth-issuer-secret-strong-fixture";

function createReadyProductionDatabaseAdapter() {
  return {
    status: "ready",
    providerClass: "managed-database",
    migrationStatus: "up-to-date",
    backupPolicy: "point-in-time-restore",
    concurrencyControl: "transactional",
    valueRedacted: true,
  };
}

function productionTeacherAuthProviderEnv(sessionSigningSecret: string) {
  return {
    UAIS_TEACHER_AUTH_PROVIDER: "trusted-cookie-issuer",
    UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: sessionSigningSecret,
    UAIS_TEACHER_AUTH_ISSUER_SECRET: productionTeacherAuthIssuerSecret,
  };
}

function expectNoLocalOrSecretValues(value: unknown, dataDir: string) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(dataDir);
  expect(serialized).not.toContain("/Users/");
  expect(serialized).not.toContain("secret-credential-value");
}

describe("teaching operation backend persistence", () => {
  it("persists all 22 teaching operation button actions into the server database", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-operations-db-"));

    try {
      for (const operationId of TEACHING_OPERATION_IDS) {
        for (const actionSlot of ["primary", "secondary"] as const) {
          const receipt = await executeTeachingOperationAction({
            dataDir,
            operationId,
            actionSlot,
            courseId: "teacher-research-methods",
            sourceAction: "manage",
            actorId: "teacher-kang",
            now: new Date("2026-06-22T08:00:00.000Z"),
          });

          expect(receipt).toEqual(
            expect.objectContaining({
              operationId,
              actionSlot,
              actorId: "teacher-kang",
              status: "persisted",
              storagePolicy: "local-json-teaching-operation-database",
              storageWritePolicy: "atomic-json-file-replace",
              responsibleSession: "S12",
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "ids-only",
              },
            }),
          );
          expectNoLocalOrSecretValues(receipt, dataDir);
        }
      }

      const database = await readTeachingOperationDatabase({ dataDir });
      expect(database.records).toHaveLength(TEACHING_OPERATION_IDS.length * 2);
      expect(database.records.map((record) => `${record.operationId}:${record.actionSlot}`)).toEqual(
        TEACHING_OPERATION_IDS.flatMap((operationId) => [
          `${operationId}:primary`,
          `${operationId}:secondary`,
        ]),
      );
      expect(database.inviteCodes.at(-1)).toEqual(
        expect.objectContaining({
          operationId: "invite-code",
          code: "55395058",
          status: "published",
        }),
      );
      expect(database.outbox.some((item) => item.channel === "collaboration-invite")).toBe(true);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed at the store layer in production instead of writing direct calls to local JSON storage", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-store-production-local-"));

    try {
      await expect(
        executeTeachingOperationAction({
          dataDir,
          env: {
            NODE_ENV: "production",
          },
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          sourceAction: "manage",
          actorId: "teacher-kang",
          now: new Date("2026-06-22T08:00:00.000Z"),
        }),
      ).rejects.toMatchObject({
        status: 503,
        message: "Production teaching operation persistence requires external storage.",
      });

      const database = await readTeachingOperationDatabase({ dataDir });
      expect(database.records).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expect(database.domainProjections).toHaveLength(0);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("treats UAIS_DEPLOYMENT_ENV production as a store-level external persistence requirement", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-store-deployment-production-"));

    try {
      await expect(
        executeTeachingOperationAction({
          dataDir,
          env: {
            UAIS_DEPLOYMENT_ENV: "production",
          },
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          sourceAction: "manage",
          actorId: "teacher-kang",
          now: new Date("2026-06-22T08:00:00.000Z"),
        }),
      ).rejects.toMatchObject({
        status: 503,
        message: "Production teaching operation persistence requires external storage.",
      });

      const database = await readTeachingOperationDatabase({ dataDir });
      expect(database.records).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expect(database.domainProjections).toHaveLength(0);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects core teaching operation writes without an explicit signed actor identity", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-operations-no-actor-"));

    try {
      await expect(
        executeTeachingOperationAction({
          dataDir,
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          sourceAction: "manage",
          now: new Date("2026-06-22T08:05:00.000Z"),
        }),
      ).rejects.toMatchObject({
        status: 401,
        message: "Signed teacher actor identity is required.",
      });

      const database = await readTeachingOperationDatabase({ dataDir });
      expect(database.records).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expect(database.domainProjections).toHaveLength(0);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("creates a redacted pre-replace backup snapshot before overwriting the local teaching operations database", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-operations-backup-"));

    try {
      await executeTeachingOperationAction({
        dataDir,
        operationId: "course-settings",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        sourceAction: "manage",
        actorId: "teacher-kang",
        now: new Date("2026-06-22T10:50:00.000Z"),
      });

      await executeTeachingOperationAction({
        dataDir,
        operationId: "content",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        sourceAction: "manage",
        actorId: "teacher-kang",
        now: new Date("2026-06-22T10:55:00.000Z"),
      });

      const backupFiles = await readdir(join(dataDir, "backups"));
      expect(backupFiles).toEqual(["teaching-operations-backup-20260622-105500.json"]);

      const backup = JSON.parse(
        await readFile(join(dataDir, "backups", backupFiles[0]), "utf8"),
      );
      expect(backup).toEqual(
        expect.objectContaining({
          schemaVersion: "uais-teaching-operations-backup-v1",
          createdAt: "2026-06-22T10:55:00.000Z",
          sourceFile: "teaching-operations.json",
          reason: "before-atomic-replace",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
          database: expect.objectContaining({
            schemaVersion: "uais-teaching-operations-v1",
            updatedAt: "2026-06-22T10:50:00.000Z",
            records: [
              expect.objectContaining({
                operationId: "course-settings",
                actionSlot: "primary",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
              }),
            ],
          }),
        }),
      );
      expect(backup.database.records).toHaveLength(1);
      expectNoLocalOrSecretValues(backup, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("preserves concurrent local teaching operation writes without overwriting records", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-operations-concurrent-"));

    try {
      await Promise.all([
        executeTeachingOperationAction({
          dataDir,
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          sourceAction: "manage",
          actorId: "teacher-kang",
          now: new Date("2026-06-22T11:00:00.000Z"),
        }),
        executeTeachingOperationAction({
          dataDir,
          operationId: "content",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          sourceAction: "manage",
          actorId: "teacher-kang",
          now: new Date("2026-06-22T11:00:01.000Z"),
        }),
      ]);

      const database = await readTeachingOperationDatabase({ dataDir });
      expect(
        database.records.map((record) => `${record.operationId}:${record.actionSlot}`).sort(),
      ).toEqual(["content:primary", "course-settings:primary"]);
      expect(database.records).toHaveLength(2);
      expect(database.domainProjections).toHaveLength(2);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("lets the owning teacher restore a local teaching operation backup with audit evidence", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-operations-restore-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const backupId = "teaching-operations-backup-20260622-105500";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-restore-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:40:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const restoreBackup = createTeachingOperationBackupRestorePostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:15:00.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T10:40:00.000Z",
      });
      await executeTeachingOperationAction({
        dataDir,
        operationId: "course-settings",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        sourceAction: "manage",
        actorId: "teacher-kang",
        now: new Date("2026-06-22T10:50:00.000Z"),
      });
      await executeTeachingOperationAction({
        dataDir,
        operationId: "content",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        sourceAction: "manage",
        actorId: "teacher-kang",
        now: new Date("2026-06-22T10:55:00.000Z"),
      });
      expect((await readTeachingOperationDatabase({ dataDir })).records).toHaveLength(2);

      const response = await restoreBackup(
        new Request(
          `https://www.uais.top/api/teaching/operations/backups/${backupId}/restore`,
          {
            method: "POST",
            headers: {
              cookie,
              "x-uais-trace-id": "trace-teaching-restore-001",
              "user-agent": "UAIS restore drill",
            },
          },
        ),
        {
          params: Promise.resolve({
            backupId,
          }),
        },
      );
      const body = await response.json();
      const restoredDatabase = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(200);
      expect(response.headers.get("x-uais-trace-id")).toBe("trace-teaching-restore-001");
      expect(body.receipt).toEqual(
        expect.objectContaining({
          action: "restore-teaching-operations-backup",
          backupId,
          actorId: "teacher-kang",
          impactedCourseIds: ["teacher-research-methods"],
          traceId: "trace-teaching-restore-001",
          status: "persisted",
          storagePolicy: "local-json-teaching-operation-database",
          storageWritePolicy: "atomic-json-file-replace",
          responsibleSession: "S12",
          createdAt: "2026-06-22T11:15:00.000Z",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      );
      expect(restoredDatabase.updatedAt).toBe("2026-06-22T11:15:00.000Z");
      expect(restoredDatabase.records).toHaveLength(1);
      expect(restoredDatabase.records[0]).toEqual(
        expect.objectContaining({
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
        }),
      );
      expect(restoredDatabase.auditEvents).toContainEqual(
        expect.objectContaining({
          eventType: "teaching-operations-backup.restored",
          backupId,
          traceId: "trace-teaching-restore-001",
          actorId: "teacher-kang",
          impactedCourseIds: ["teacher-research-methods"],
        }),
      );
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(restoredDatabase, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects mixed student app-session and teacher-auth cookies before restoring local backups", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-operations-restore-mixed-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const appSessionSecret = "test-app-session-signing-secret";
    const backupId = "teaching-operations-backup-20260622-105500";
    const studentCookie = createUaisAppSessionCookie(
      {
        account: "Peter",
        department: "学生账号",
        displayName: "Peter",
        role: "student",
      },
      {
        secret: appSessionSecret,
        sessionId: "student-restore-mixed-session",
        now: new Date("2026-06-22T11:15:00.000Z"),
      },
    );
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-restore-mixed-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:40:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const restoreBackup = createTeachingOperationBackupRestorePostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
      },
      now: new Date("2026-06-22T11:15:00.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T10:40:00.000Z",
      });
      await executeTeachingOperationAction({
        dataDir,
        operationId: "course-settings",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        sourceAction: "manage",
        actorId: "teacher-kang",
        now: new Date("2026-06-22T10:50:00.000Z"),
      });
      await executeTeachingOperationAction({
        dataDir,
        operationId: "content",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        sourceAction: "manage",
        actorId: "teacher-kang",
        now: new Date("2026-06-22T10:55:00.000Z"),
      });

      const response = await restoreBackup(
        new Request(
          `https://www.uais.top/api/teaching/operations/backups/${backupId}/restore`,
          {
            method: "POST",
            headers: {
              cookie: `${studentCookie}; ${teacherCookie}`,
              "x-uais-trace-id": "trace-mixed-student-restore-denied",
              "user-agent": "UAIS mixed restore role denial test",
            },
          },
        ),
        {
          params: Promise.resolve({
            backupId,
          }),
        },
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(403);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-mixed-student-restore-denied",
      );
      expect(body.traceId).toBe("trace-mixed-student-restore-denied");
      expect(body.access).toEqual(
        expect.objectContaining({
          status: "denied",
          reasonCode: "teacher-role-required",
          responsibleSession: "S12",
        }),
      );
      expect(database.records).toHaveLength(2);
      expect(
        database.auditEvents.some(
          (event) => event.eventType === "teaching-operations-backup.restored",
        ),
      ).toBe(false);
      expect(JSON.stringify(body)).not.toContain(backupId);
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed backup restore actor ids before restore writes", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-operations-restore-unsafe-actor-id-"),
    );
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const backupId = "teaching-operations-backup-20260622-105500";
    const unsafeActorId = "/Users/example/secret-token-restore-teacher";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-restore-unsafe-actor-session",
        actorId: unsafeActorId,
        role: "teacher",
        authenticatedAt: "2026-06-22T10:40:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const restoreBackup = createTeachingOperationBackupRestorePostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:16:00.000Z"),
    });

    try {
      await executeTeachingOperationAction({
        dataDir,
        operationId: "course-settings",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        sourceAction: "manage",
        actorId: "teacher-kang",
        now: new Date("2026-06-22T10:50:00.000Z"),
      });
      await executeTeachingOperationAction({
        dataDir,
        operationId: "content",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        sourceAction: "manage",
        actorId: "teacher-kang",
        now: new Date("2026-06-22T10:55:00.000Z"),
      });

      const response = await restoreBackup(
        new Request(
          `https://www.uais.top/api/teaching/operations/backups/${backupId}/restore`,
          {
            method: "POST",
            headers: {
              cookie,
              "x-uais-trace-id": "trace-restore-unsafe-actor-id",
              "user-agent": "UAIS restore unsafe actor test",
            },
          },
        ),
        {
          params: Promise.resolve({
            backupId,
          }),
        },
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe("trace-restore-unsafe-actor-id");
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-restore-unsafe-actor-id",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain("/Users/example/secret-token-restore-teacher");
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(database.records).toHaveLength(2);
      expect(database.auditEvents).not.toContainEqual(
        expect.objectContaining({
          eventType: "teaching-operations-backup.restored",
        }),
      );
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed student account ids before backup restore role checks", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-operations-restore-unsafe-student-id-"),
    );
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const appSessionSecret = "test-app-session-signing-secret";
    const unsafeStudentId = "/Users/example/secret-token-restore-student";
    const backupId = "teaching-operations-backup-20260622-105500";
    const studentCookie = createUaisAppSessionCookie(
      {
        account: unsafeStudentId,
        department: "学生账号",
        displayName: "Unsafe Student",
        role: "student",
      },
      {
        secret: appSessionSecret,
        sessionId: "unsafe-student-backup-restore-session",
        now: new Date("2026-06-22T11:16:00.000Z"),
      },
    );
    const restoreBackup = createTeachingOperationBackupRestorePostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
      },
      now: new Date("2026-06-22T11:16:00.000Z"),
    });

    try {
      const response = await restoreBackup(
        new Request(
          `https://www.uais.top/api/teaching/operations/backups/${backupId}/restore`,
          {
            method: "POST",
            headers: {
              cookie: studentCookie,
              "x-uais-trace-id": "trace-restore-unsafe-student-id",
              "user-agent": "UAIS restore unsafe student test",
            },
          },
        ),
        {
          params: Promise.resolve({
            backupId,
          }),
        },
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe("trace-restore-unsafe-student-id");
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-restore-unsafe-student-id",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain(unsafeStudentId);
      expect(JSON.stringify(body)).not.toContain(backupId);
      expect(await readdir(dataDir)).toEqual([]);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed backup restore session ids before restore writes", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-operations-restore-unsafe-session-id-"),
    );
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const backupId = "teaching-operations-backup-20260622-105500";
    const unsafeSessionId = "/Users/example/secret-token-restore-session";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: unsafeSessionId,
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:40:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const restoreBackup = createTeachingOperationBackupRestorePostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:16:30.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T10:40:00.000Z",
      });
      await executeTeachingOperationAction({
        dataDir,
        operationId: "course-settings",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        sourceAction: "manage",
        actorId: "teacher-kang",
        now: new Date("2026-06-22T10:50:00.000Z"),
      });
      await executeTeachingOperationAction({
        dataDir,
        operationId: "content",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        sourceAction: "manage",
        actorId: "teacher-kang",
        now: new Date("2026-06-22T10:55:00.000Z"),
      });

      const response = await restoreBackup(
        new Request(
          `https://www.uais.top/api/teaching/operations/backups/${backupId}/restore`,
          {
            method: "POST",
            headers: {
              cookie,
              "x-uais-trace-id": "trace-restore-unsafe-session-id",
              "user-agent": "UAIS restore unsafe session test",
            },
          },
        ),
        {
          params: Promise.resolve({
            backupId,
          }),
        },
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe("trace-restore-unsafe-session-id");
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-restore-unsafe-session-id",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain("/Users/example/secret-token-restore-session");
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(database.records).toHaveLength(2);
      expect(database.auditEvents).not.toContainEqual(
        expect.objectContaining({
          eventType: "teaching-operations-backup.restored",
        }),
      );
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed instead of restoring a local backup when external teaching operations storage is selected", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-operations-restore-external-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const backupId = "teaching-operations-backup-20260622-105500";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-restore-external-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:40:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const restoreBackup = createTeachingOperationBackupRestorePostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:15:00.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T10:40:00.000Z",
      });
      await executeTeachingOperationAction({
        dataDir,
        operationId: "course-settings",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        sourceAction: "manage",
        actorId: "teacher-kang",
        now: new Date("2026-06-22T10:50:00.000Z"),
      });
      await executeTeachingOperationAction({
        dataDir,
        operationId: "content",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        sourceAction: "manage",
        actorId: "teacher-kang",
        now: new Date("2026-06-22T10:55:00.000Z"),
      });

      const response = await restoreBackup(
        new Request(
          `https://www.uais.top/api/teaching/operations/backups/${backupId}/restore`,
          {
            method: "POST",
            headers: {
              cookie,
              "x-uais-trace-id": "trace-teaching-restore-external-001",
            },
          },
        ),
        {
          params: Promise.resolve({
            backupId,
          }),
        },
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(409);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-teaching-restore-external-001",
      );
      expect(body.error).toBe(
        "Teaching operation backup restore is only available for local JSON fallback storage.",
      );
      expect(body.traceId).toBe("trace-teaching-restore-external-001");
      expect(body.restorePlan).toEqual({
        status: "external-restore-drill-required",
        action: "verify-teaching-operation-backup-restore",
        backupId,
        route:
          "/api/external-storage/teaching-operations/teacher-kang/backups/teaching-operations-backup-20260622-105500/restore-drill",
        storagePolicy: "external-redacted-teaching-operation-restore-drill",
        storageWritePolicy: "external-append-only-restore-drill-log",
        responsibleSession: "S12",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      });
      expect(database.records).toHaveLength(2);
      expect(database.auditEvents).not.toContainEqual(
        expect.objectContaining({
          eventType: "teaching-operations-backup.restored",
        }),
      );
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe backup restore ids before external restore planning", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-operations-restore-unsafe-id-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const unsafeBackupId = "/Users/example/secret-token-teaching-operations-backup";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-restore-unsafe-backup-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-28T01:20:00.000Z",
        expiresAt: "2026-06-28T02:20:00.000Z",
      },
    });
    const restoreBackup = createTeachingOperationBackupRestorePostHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
      },
      now: new Date("2026-06-28T01:25:00.000Z"),
    });

    try {
      const response = await restoreBackup(
        new Request(
          `https://www.uais.top/api/teaching/operations/backups/${encodeURIComponent(
            unsafeBackupId,
          )}/restore`,
          {
            method: "POST",
            headers: {
              cookie,
              "x-uais-trace-id": "trace-unsafe-backup-restore-id",
              "user-agent": "UAIS unsafe backup restore id test",
            },
          },
        ),
        {
          params: Promise.resolve({
            backupId: unsafeBackupId,
          }),
        },
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teaching operation backup id is invalid.",
          traceId: "trace-unsafe-backup-restore-id",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      );
      expect(body.restorePlan).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain(unsafeBackupId);
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(await readdir(dataDir)).toEqual([]);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("returns trace closure when a backup restore target is missing", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-operations-restore-missing-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-restore-missing-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:15:00.000Z",
        expiresAt: "2026-06-22T12:15:00.000Z",
      },
    });
    const restoreBackup = createTeachingOperationBackupRestorePostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:20:00.000Z"),
    });

    try {
      const response = await restoreBackup(
        new Request(
          "https://www.uais.top/api/teaching/operations/backups/teaching-operations-backup-missing/restore",
          {
            method: "POST",
            headers: {
              cookie,
              "x-uais-trace-id": "trace-teaching-restore-missing-001",
            },
          },
        ),
        {
          params: Promise.resolve({
            backupId: "teaching-operations-backup-missing",
          }),
        },
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(404);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-teaching-restore-missing-001",
      );
      expect(body.traceId).toBe("trace-teaching-restore-missing-001");
      expect(body.error).toBe("Teaching operation backup was not found.");
      expect(database.records).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("blocks production teaching operation backup restore before restore planning when teacher auth provider is not production-ready", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-restore-auth-provider-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const backupId = "backup-auth-provider-blocked";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-operation-restore-auth-provider-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:10:00.000Z",
        expiresAt: "2026-06-22T12:10:00.000Z",
      },
    });
    const restoreBackup = createTeachingOperationBackupRestorePostHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:15:00.000Z"),
    });

    try {
      const response = await restoreBackup(
        new Request(
          `https://www.uais.top/api/teaching/operations/backups/${backupId}/restore`,
          {
            method: "POST",
            headers: {
              cookie,
              "x-uais-trace-id": "trace-production-restore-auth-provider-not-ready",
              "user-agent": "UAIS production restore auth provider not ready",
            },
          },
        ),
        {
          params: Promise.resolve({
            backupId,
          }),
        },
      );
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-production-restore-auth-provider-not-ready",
      );
      expect(body.error).toBe("UAIS teacher auth provider is not production-ready.");
      expect(body.traceId).toBe("trace-production-restore-auth-provider-not-ready");
      expect(body.access).toEqual(
        expect.objectContaining({
          status: "denied",
          reasonCode: "teacher-auth-provider-not-production-ready",
          responsibleSession: "S12",
        }),
      );
      expect(body.authProviderContract).toEqual(
        expect.objectContaining({
          providerKind: "missing",
          productionStatus: "blocked",
          blockedReason: "missing-UAIS_TEACHER_AUTH_PROVIDER",
          redaction: {
            values: "omitted",
            cookies: "omitted",
          },
        }),
      );
      expect(body.restorePlan).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain(backupId);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("lets the owning teacher roll back one teaching operation record with audit evidence", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-operation-rollback-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-operation-rollback-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:20:00.000Z",
        expiresAt: "2026-06-22T12:20:00.000Z",
      },
    });
    const rollbackOperation = createTeachingOperationRecordRollbackPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:25:00.000Z"),
    });
    const getAudit = createTeachingOperationAuditGetHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:26:00.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T11:20:00.000Z",
      });
      const receipt = await executeTeachingOperationAction({
        dataDir,
        operationId: "course-settings",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        sourceAction: "manage",
        actorId: "teacher-kang",
        now: new Date("2026-06-22T11:21:00.000Z"),
      });

      const response = await rollbackOperation(
        new Request(
          `https://www.uais.top/api/teaching/operations/records/${receipt.receiptId}/rollback`,
          {
            method: "POST",
            headers: {
              cookie,
              "content-type": "application/json",
              "x-uais-trace-id": "trace-teaching-operation-rollback-001",
              "user-agent": "UAIS operation rollback drill",
            },
            body: JSON.stringify({
              action: "rollback-teaching-operation-record",
              rollbackReason: "teacher-control-plane-test",
            }),
          },
        ),
        {
          params: Promise.resolve({
            recordId: receipt.receiptId,
          }),
        },
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(200);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-teaching-operation-rollback-001",
      );
      expect(body.traceId).toBe("trace-teaching-operation-rollback-001");
      expect(body.receipt).toEqual(
        expect.objectContaining({
          action: "rollback-teaching-operation-record",
          actorId: "teacher-kang",
          courseId: "teacher-research-methods",
          targetRecordId: receipt.receiptId,
          traceId: "trace-teaching-operation-rollback-001",
          rollbackReason: "teacher-control-plane-test",
          status: "persisted",
          storagePolicy: "local-json-teaching-operation-database",
          storageWritePolicy: "atomic-json-file-replace",
          responsibleSession: "S12",
          createdAt: "2026-06-22T11:25:00.000Z",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      );
      expect(database.records).toHaveLength(1);
      expect(database.auditEvents).toContainEqual(
        expect.objectContaining({
          eventType: "teaching-operation.rolled-back",
          targetRecordId: receipt.receiptId,
          operationId: "course-settings",
          actionSlot: "primary",
          actionId: "save-course-settings",
          courseId: "teacher-research-methods",
          traceId: "trace-teaching-operation-rollback-001",
          actorId: "teacher-kang",
          rollbackReason: "teacher-control-plane-test",
        }),
      );
      expect(database.domainProjections).toContainEqual(
        expect.objectContaining({
          objectType: "operation-rollback",
          objectId: `operation-rollback-${receipt.receiptId}`,
          courseId: "teacher-research-methods",
          targetRecordId: receipt.receiptId,
          rollbackStatus: "rolled-back",
          rollbackReason: "teacher-control-plane-test",
          rolledBackBy: "teacher-kang",
          rolledBackAt: "2026-06-22T11:25:00.000Z",
        }),
      );
      const auditReadbackResponse = await getAudit(
        new Request("https://www.uais.top/api/teaching/operations/audit", {
          method: "GET",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-teaching-operation-rollback-audit-readback",
            "user-agent": "vitest teaching operation rollback audit readback",
          },
        }),
      );
      const auditReadbackBody = await auditReadbackResponse.json();

      expect(auditReadbackResponse.status).toBe(200);
      expect(auditReadbackBody).toEqual(
        expect.objectContaining({
          traceId: "trace-teaching-operation-rollback-audit-readback",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          rollbackRecordCount: 1,
        }),
      );
      expect(auditReadbackBody.rollbackRecords).toEqual([
        expect.objectContaining({
          rollbackId: `operation-rollback-${receipt.receiptId}`,
          action: "rollback-teaching-operation-record",
          teacherId: "teacher-kang",
          targetRecordId: receipt.receiptId,
          courseId: "teacher-research-methods",
          targetOperationId: "course-settings",
          targetActionSlot: "primary",
          targetActionId: "save-course-settings",
          rollbackReason: "teacher-control-plane-test",
          status: "persisted",
          rolledBackAt: "2026-06-22T11:25:00.000Z",
          storagePolicy: "domain-projection-teaching-operation-rollback",
          storageWritePolicy: "read-only-local-json-file",
          responsibleSession: "S12",
        }),
      ]);
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
      expectNoLocalOrSecretValues(auditReadbackBody, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects mixed student app-session and teacher-auth cookies before rolling back operation records", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-operation-rollback-mixed-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const appSessionSecret = "test-app-session-signing-secret";
    const studentCookie = createUaisAppSessionCookie(
      {
        account: "Peter",
        department: "学生账号",
        displayName: "Peter",
        role: "student",
      },
      {
        secret: appSessionSecret,
        sessionId: "student-operation-rollback-mixed-session",
        now: new Date("2026-06-22T11:25:00.000Z"),
      },
    );
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-operation-rollback-mixed-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:20:00.000Z",
        expiresAt: "2026-06-22T12:20:00.000Z",
      },
    });
    const rollbackOperation = createTeachingOperationRecordRollbackPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
      },
      now: new Date("2026-06-22T11:25:00.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T11:20:00.000Z",
      });
      const receipt = await executeTeachingOperationAction({
        dataDir,
        operationId: "course-settings",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        sourceAction: "manage",
        actorId: "teacher-kang",
        now: new Date("2026-06-22T11:21:00.000Z"),
      });

      const response = await rollbackOperation(
        new Request(
          `https://www.uais.top/api/teaching/operations/records/${receipt.receiptId}/rollback`,
          {
            method: "POST",
            headers: {
              cookie: `${studentCookie}; ${teacherCookie}`,
              "content-type": "application/json",
              "x-uais-trace-id": "trace-mixed-student-operation-rollback-denied",
              "user-agent": "UAIS mixed operation rollback role denial test",
            },
            body: JSON.stringify({
              action: "rollback-teaching-operation-record",
              rollbackReason: "student-role-denial-should-not-rollback",
            }),
          },
        ),
        {
          params: Promise.resolve({
            recordId: receipt.receiptId,
          }),
        },
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(403);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-mixed-student-operation-rollback-denied",
      );
      expect(body.traceId).toBe("trace-mixed-student-operation-rollback-denied");
      expect(body.access).toEqual(
        expect.objectContaining({
          status: "denied",
          reasonCode: "teacher-role-required",
          responsibleSession: "S12",
        }),
      );
      expect(database.records).toHaveLength(1);
      expect(database.records[0]).toEqual(
        expect.objectContaining({ recordId: receipt.receiptId }),
      );
      expect(JSON.stringify(database)).not.toContain(
        "student-role-denial-should-not-rollback",
      );
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed rollback actor ids before rollback writes", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-operation-rollback-unsafe-actor-id-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const unsafeActorId = "/Users/example/secret-token-rollback-teacher";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-operation-rollback-unsafe-actor-session",
        actorId: unsafeActorId,
        role: "teacher",
        authenticatedAt: "2026-06-22T11:20:00.000Z",
        expiresAt: "2026-06-22T12:20:00.000Z",
      },
    });
    const rollbackOperation = createTeachingOperationRecordRollbackPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:28:00.000Z"),
    });

    try {
      const receipt = await executeTeachingOperationAction({
        dataDir,
        operationId: "course-settings",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        sourceAction: "manage",
        actorId: "teacher-kang",
        now: new Date("2026-06-22T11:21:00.000Z"),
      });

      const response = await rollbackOperation(
        new Request(
          `https://www.uais.top/api/teaching/operations/records/${receipt.receiptId}/rollback`,
          {
            method: "POST",
            headers: {
              cookie,
              "content-type": "application/json",
              "x-uais-trace-id": "trace-rollback-unsafe-actor-id",
              "user-agent": "UAIS operation rollback unsafe actor test",
            },
            body: JSON.stringify({
              action: "rollback-teaching-operation-record",
              rollbackReason: "unsafe-actor-should-not-rollback",
            }),
          },
        ),
        {
          params: Promise.resolve({
            recordId: receipt.receiptId,
          }),
        },
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe("trace-rollback-unsafe-actor-id");
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-rollback-unsafe-actor-id",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain("/Users/example/secret-token-rollback-teacher");
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(database.records).toHaveLength(1);
      expect(
        database.auditEvents.filter((event) => event.eventType === "teaching-operation.rolled-back"),
      ).toHaveLength(0);
      expect(
        database.domainProjections.filter((projection) => projection.objectType === "operation-rollback"),
      ).toHaveLength(0);
      expect(JSON.stringify(database)).not.toContain("unsafe-actor-should-not-rollback");
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed student account ids before operation rollback role checks", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-operation-rollback-unsafe-student-id-"),
    );
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const appSessionSecret = "test-app-session-signing-secret";
    const unsafeStudentId = "/Users/example/secret-token-rollback-student";
    const recordId = "teaching-operation-record-20260622-112100-course-settings-primary";
    const studentCookie = createUaisAppSessionCookie(
      {
        account: unsafeStudentId,
        department: "学生账号",
        displayName: "Unsafe Student",
        role: "student",
      },
      {
        secret: appSessionSecret,
        sessionId: "unsafe-student-operation-rollback-session",
        now: new Date("2026-06-22T11:28:00.000Z"),
      },
    );
    const rollbackOperation = createTeachingOperationRecordRollbackPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
      },
      now: new Date("2026-06-22T11:28:00.000Z"),
    });

    try {
      const response = await rollbackOperation(
        new Request(
          `https://www.uais.top/api/teaching/operations/records/${recordId}/rollback`,
          {
            method: "POST",
            headers: {
              cookie: studentCookie,
              "content-type": "application/json",
              "x-uais-trace-id": "trace-rollback-unsafe-student-id",
              "user-agent": "UAIS operation rollback unsafe student test",
            },
            body: "{",
          },
        ),
        {
          params: Promise.resolve({
            recordId,
          }),
        },
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe("trace-rollback-unsafe-student-id");
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-rollback-unsafe-student-id",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain(unsafeStudentId);
      expect(JSON.stringify(body)).not.toContain("Request body must be JSON.");
      expect(JSON.stringify(body)).not.toContain(recordId);
      expect(await readdir(dataDir)).toEqual([]);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed rollback session ids before rollback writes", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-operation-rollback-unsafe-session-id-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const unsafeSessionId = "/Users/example/secret-token-rollback-session";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: unsafeSessionId,
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:20:00.000Z",
        expiresAt: "2026-06-22T12:20:00.000Z",
      },
    });
    const rollbackOperation = createTeachingOperationRecordRollbackPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:28:30.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T11:20:00.000Z",
      });
      const receipt = await executeTeachingOperationAction({
        dataDir,
        operationId: "course-settings",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        sourceAction: "manage",
        actorId: "teacher-kang",
        now: new Date("2026-06-22T11:21:00.000Z"),
      });

      const response = await rollbackOperation(
        new Request(
          `https://www.uais.top/api/teaching/operations/records/${receipt.receiptId}/rollback`,
          {
            method: "POST",
            headers: {
              cookie,
              "content-type": "application/json",
              "x-uais-trace-id": "trace-rollback-unsafe-session-id",
              "user-agent": "UAIS operation rollback unsafe session test",
            },
            body: JSON.stringify({
              action: "rollback-teaching-operation-record",
              rollbackReason: "unsafe-session-should-not-rollback",
            }),
          },
        ),
        {
          params: Promise.resolve({
            recordId: receipt.receiptId,
          }),
        },
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe("trace-rollback-unsafe-session-id");
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-rollback-unsafe-session-id",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain("/Users/example/secret-token-rollback-session");
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(database.records).toHaveLength(1);
      expect(
        database.auditEvents.filter((event) => event.eventType === "teaching-operation.rolled-back"),
      ).toHaveLength(0);
      expect(
        database.domainProjections.filter((projection) => projection.objectType === "operation-rollback"),
      ).toHaveLength(0);
      expect(JSON.stringify(database)).not.toContain("unsafe-session-should-not-rollback");
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("uses the external teaching operations backend for signed record rollback", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-operation-rollback-external-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const targetRecordId =
      "course-settings-save-course-settings-20260622-110500-abcd1234";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-operation-rollback-external-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:20:00.000Z",
        expiresAt: "2026-06-22T12:20:00.000Z",
      },
    });
    const externalRequests: Array<{
      method: string;
      url: string;
      authorization: string | null;
      body: unknown;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const method = init?.method ?? "GET";
      const requestBody =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      externalRequests.push({
        method,
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        body: requestBody,
      });

      if (
        method === "GET" &&
        String(url) === "https://external-storage.example.test/teaching-operations/teacher-kang/audit"
      ) {
        return new Response(
          JSON.stringify({
            teacherId: "teacher-kang",
            eventType: "teaching-operation-audit",
            storagePolicy: "external-redacted-teaching-operation-audit-log",
            storageWritePolicy: "external-append-only-audit-log",
            recordCount: 1,
            auditEventCount: 0,
            domainProjectionCount: 0,
            records: [
              {
                recordId: targetRecordId,
                operationId: "course-settings",
                actionSlot: "primary",
                actionId: "save-course-settings",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                status: "persisted",
                createdAt: "2026-06-22T11:10:00.000Z",
                storagePolicy: "external-redacted-teaching-operation-append",
                storageWritePolicy: "external-append-only-operation-log",
                artifacts: [],
                responsibleSession: "S12",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
              },
            ],
            auditEvents: [],
            domainProjections: [],
            rollbacks: [],
            responsibleSession: "S12",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response(
        JSON.stringify({
          teacherId: "teacher-kang",
          rollbackId: `teaching-operation-rollback-${targetRecordId}`,
          targetRecordId,
          courseId: "teacher-research-methods",
          status: "persisted",
          storagePolicy: "external-redacted-teaching-operation-rollback",
          storageWritePolicy: "external-append-only-rollback-log",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };
    const rollbackOperation = createTeachingOperationRecordRollbackPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN:
          "test-external-storage-access-token-with-32-chars",
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T11:25:00.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T11:20:00.000Z",
      });

      const response = await rollbackOperation(
        new Request(
          `https://www.uais.top/api/teaching/operations/records/${targetRecordId}/rollback`,
          {
            method: "POST",
            headers: {
              cookie,
              "content-type": "application/json",
              "x-uais-trace-id": "trace-external-teaching-operation-rollback-001",
              "user-agent": "UAIS external operation rollback drill",
            },
            body: JSON.stringify({
              action: "rollback-teaching-operation-record",
              courseId: "teacher-research-methods",
              rollbackReason: "teacher-control-plane-test",
            }),
          },
        ),
        {
          params: Promise.resolve({
            recordId: targetRecordId,
          }),
        },
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(200);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-external-teaching-operation-rollback-001",
      );
      expect(body.traceId).toBe("trace-external-teaching-operation-rollback-001");
      expect(body.receipt).toEqual(
        expect.objectContaining({
          action: "rollback-teaching-operation-record",
          actorId: "teacher-kang",
          courseId: "teacher-research-methods",
          targetRecordId,
          traceId: "trace-external-teaching-operation-rollback-001",
          rollbackReason: "teacher-control-plane-test",
          status: "persisted",
          storagePolicy: "external-redacted-teaching-operation-rollback",
          storageWritePolicy: "external-append-only-rollback-log",
          externalRollback: expect.objectContaining({
            teacherId: "teacher-kang",
            targetRecordId,
            courseId: "teacher-research-methods",
            status: "persisted",
            storagePolicy: "external-redacted-teaching-operation-rollback",
            storageWritePolicy: "external-append-only-rollback-log",
            responsibleSession: "S12",
          }),
          responsibleSession: "S12",
          createdAt: "2026-06-22T11:25:00.000Z",
        }),
      );
      expect(externalRequests).toEqual([
        expect.objectContaining({
          method: "GET",
          url: "https://external-storage.example.test/teaching-operations/teacher-kang/audit",
          authorization: "Bearer test-external-storage-access-token-with-32-chars",
        }),
        expect.objectContaining({
          method: "POST",
          url: `https://external-storage.example.test/teaching-operations/teacher-kang/records/${targetRecordId}/rollback`,
          authorization: "Bearer test-external-storage-access-token-with-32-chars",
          body: expect.objectContaining({
            action: "rollback-teaching-operation-record",
            courseId: "teacher-research-methods",
            rollbackReason: "teacher-control-plane-test",
            traceId: "trace-external-teaching-operation-rollback-001",
            requestedAt: "2026-06-22T11:25:00.000Z",
            requestSource: expect.objectContaining({
              userAgent: "UAIS external operation rollback drill",
              ipAddress: "redacted",
            }),
          }),
        }),
      ]);
      expect(database.records).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed when external teaching operation rollback acknowledgement is not persisted", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-operation-rollback-external-ack-invalid-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const targetRecordId =
      "course-settings-save-course-settings-20260622-rollback-invalid-ack";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-operation-rollback-external-invalid-ack-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:30:00.000Z",
        expiresAt: "2026-06-22T12:30:00.000Z",
      },
    });
    const externalRequests: Array<{
      method: string;
      url: string;
      authorization: string | null;
      body: unknown;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const method = init?.method ?? "GET";
      const requestBody =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      externalRequests.push({
        method,
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        body: requestBody,
      });

      if (
        method === "GET" &&
        String(url) === "https://external-storage.example.test/teaching-operations/teacher-kang/audit"
      ) {
        return new Response(
          JSON.stringify({
            teacherId: "teacher-kang",
            eventType: "teaching-operation-audit",
            storagePolicy: "external-redacted-teaching-operation-audit-log",
            storageWritePolicy: "external-append-only-audit-log",
            recordCount: 1,
            auditEventCount: 0,
            domainProjectionCount: 0,
            records: [
              {
                recordId: targetRecordId,
                operationId: "course-settings",
                actionSlot: "primary",
                actionId: "save-course-settings",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                status: "persisted",
                createdAt: "2026-06-22T11:10:00.000Z",
                storagePolicy: "external-redacted-teaching-operation-append",
                storageWritePolicy: "external-append-only-operation-log",
                artifacts: [],
                responsibleSession: "S12",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
              },
            ],
            auditEvents: [],
            domainProjections: [],
            rollbacks: [],
            responsibleSession: "S12",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response(
        JSON.stringify({
          teacherId: "teacher-kang",
          rollbackId: `teaching-operation-rollback-${targetRecordId}`,
          targetRecordId,
          courseId: "teacher-research-methods",
          status: "queued",
          storagePolicy: "local-json-teaching-operation-database",
          storageWritePolicy: "atomic-json-file-replace",
          responsibleSession: "S10",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };
    const rollbackOperation = createTeachingOperationRecordRollbackPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN:
          "test-external-storage-access-token-with-32-chars",
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T11:35:00.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T11:31:00.000Z",
      });

      const response = await rollbackOperation(
        new Request(
          `https://www.uais.top/api/teaching/operations/records/${targetRecordId}/rollback`,
          {
            method: "POST",
            headers: {
              cookie,
              "content-type": "application/json",
              "x-uais-trace-id": "trace-external-teaching-operation-rollback-invalid-ack",
              "user-agent": "UAIS external operation rollback invalid acknowledgement",
            },
            body: JSON.stringify({
              action: "rollback-teaching-operation-record",
              courseId: "teacher-research-methods",
              rollbackReason: "teacher-control-plane-test",
            }),
          },
        ),
        {
          params: Promise.resolve({
            recordId: targetRecordId,
          }),
        },
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(502);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-external-teaching-operation-rollback-invalid-ack",
      );
      expect(body).toEqual(
        expect.objectContaining({
          traceId: "trace-external-teaching-operation-rollback-invalid-ack",
          error: "External teaching operation rollback acknowledgement is invalid.",
        }),
      );
      expect(body.receipt).toBeUndefined();
      expect(externalRequests).toEqual([
        expect.objectContaining({
          method: "GET",
          url: "https://external-storage.example.test/teaching-operations/teacher-kang/audit",
          authorization: "Bearer test-external-storage-access-token-with-32-chars",
        }),
        expect.objectContaining({
          method: "POST",
          url: `https://external-storage.example.test/teaching-operations/teacher-kang/records/${targetRecordId}/rollback`,
          authorization: "Bearer test-external-storage-access-token-with-32-chars",
        }),
      ]);
      expect(JSON.stringify(body)).not.toContain(`teaching-operation-rollback-${targetRecordId}`);
      expect(database.records).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed in production when external teaching operation rollback acknowledgement lacks managed database adapter evidence", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-operation-rollback-external-db-proof-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const targetRecordId =
      "course-settings-save-course-settings-20260622-rollback-missing-db-proof";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-operation-rollback-external-db-proof-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:40:00.000Z",
        expiresAt: "2026-06-22T12:40:00.000Z",
      },
    });
    const externalRequests: Array<{
      method: string;
      url: string;
      authorization: string | null;
      body?: unknown;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const method = init?.method ?? "GET";
      const requestBody =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      externalRequests.push({
        method,
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        ...(requestBody ? { body: requestBody } : {}),
      });

      if (
        method === "GET" &&
        String(url) === "https://external-storage.example.test/teacher-ai-ownership/teacher-kang"
      ) {
        return Response.json({
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        });
      }

      if (
        method === "GET" &&
        String(url) === "https://external-storage.example.test/teaching-operations/teacher-kang/audit"
      ) {
        return Response.json({
          teacherId: "teacher-kang",
          eventType: "teaching-operation-audit",
          storagePolicy: "external-redacted-teaching-operation-audit-log",
          storageWritePolicy: "external-append-only-audit-log",
          recordCount: 1,
          auditEventCount: 0,
          domainProjectionCount: 0,
          records: [
            {
              recordId: targetRecordId,
              operationId: "course-settings",
              actionSlot: "primary",
              actionId: "save-course-settings",
              actorId: "teacher-kang",
              courseId: "teacher-research-methods",
              status: "persisted",
              createdAt: "2026-06-22T11:10:00.000Z",
              storagePolicy: "external-redacted-teaching-operation-append",
              storageWritePolicy: "external-append-only-operation-log",
              artifacts: [],
              responsibleSession: "S12",
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "ids-only",
              },
            },
          ],
          auditEvents: [],
          domainProjections: [],
          rollbacks: [],
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      return Response.json({
        teacherId: "teacher-kang",
        rollbackId: `teaching-operation-rollback-${targetRecordId}`,
        targetRecordId,
        courseId: "teacher-research-methods",
        status: "persisted",
        storagePolicy: "external-redacted-teaching-operation-rollback",
        storageWritePolicy: "external-append-only-rollback-log",
        responsibleSession: "S12",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      });
    };
    const rollbackOperation = createTeachingOperationRecordRollbackPostHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "external",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T11:45:00.000Z"),
    });

    try {
      const response = await rollbackOperation(
        new Request(
          `https://www.uais.top/api/teaching/operations/records/${targetRecordId}/rollback`,
          {
            method: "POST",
            headers: {
              cookie,
              "content-type": "application/json",
              "x-uais-trace-id": "trace-external-teaching-operation-rollback-missing-db-proof",
              "user-agent": "UAIS external operation rollback missing db proof",
            },
            body: JSON.stringify({
              action: "rollback-teaching-operation-record",
              courseId: "teacher-research-methods",
              rollbackReason: "teacher-control-plane-test",
            }),
          },
        ),
        {
          params: Promise.resolve({
            recordId: targetRecordId,
          }),
        },
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(502);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-external-teaching-operation-rollback-missing-db-proof",
      );
      expect(body).toEqual(
        expect.objectContaining({
          traceId: "trace-external-teaching-operation-rollback-missing-db-proof",
          error:
            "External teaching operation rollback acknowledgement is missing production database adapter evidence.",
        }),
      );
      expect(body.receipt).toBeUndefined();
      expect(externalRequests).toEqual([
        expect.objectContaining({
          method: "GET",
          url: "https://external-storage.example.test/teacher-ai-ownership/teacher-kang",
          authorization: `Bearer ${externalToken}`,
        }),
        expect.objectContaining({
          method: "GET",
          url: "https://external-storage.example.test/teaching-operations/teacher-kang/audit",
          authorization: `Bearer ${externalToken}`,
        }),
        expect.objectContaining({
          method: "POST",
          url: `https://external-storage.example.test/teaching-operations/teacher-kang/records/${targetRecordId}/rollback`,
          authorization: `Bearer ${externalToken}`,
        }),
      ]);
      expect(JSON.stringify(body)).not.toContain(`teaching-operation-rollback-${targetRecordId}`);
      expect(database.records).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("blocks production teaching operation record rollback before ownership or external rollback when teacher auth provider is not production-ready", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-operation-rollback-auth-provider-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const targetRecordId =
      "course-settings-save-course-settings-20260622-auth-provider";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-operation-rollback-auth-provider-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:20:00.000Z",
        expiresAt: "2026-06-22T12:20:00.000Z",
      },
    });
    const externalRequests: Array<{
      method: string;
      url: string;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const method = init?.method ?? "GET";
      externalRequests.push({
        method,
        url: String(url),
      });

      if (
        method === "GET" &&
        String(url) === "https://external-storage.example.test/teacher-ai-ownership/teacher-kang"
      ) {
        return Response.json({
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        });
      }

      if (
        method === "GET" &&
        String(url) === "https://external-storage.example.test/teaching-operations/teacher-kang/audit"
      ) {
        return Response.json({
          teacherId: "teacher-kang",
          eventType: "teaching-operation-audit",
          storagePolicy: "external-redacted-teaching-operation-audit-log",
          storageWritePolicy: "external-append-only-audit-log",
          recordCount: 1,
          auditEventCount: 0,
          domainProjectionCount: 0,
          records: [
            {
              recordId: targetRecordId,
              operationId: "course-settings",
              actionSlot: "primary",
              actionId: "save-course-settings",
              actorId: "teacher-kang",
              courseId: "teacher-research-methods",
              status: "persisted",
              createdAt: "2026-06-22T11:10:00.000Z",
              storagePolicy: "external-redacted-teaching-operation-append",
              storageWritePolicy: "external-append-only-operation-log",
              artifacts: [],
              responsibleSession: "S12",
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "ids-only",
              },
            },
          ],
          auditEvents: [],
          domainProjections: [],
          rollbacks: [],
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      return Response.json({
        teacherId: "teacher-kang",
        rollbackId: `teaching-operation-rollback-${targetRecordId}`,
        targetRecordId,
        courseId: "teacher-research-methods",
        status: "persisted",
        storagePolicy: "external-redacted-teaching-operation-rollback",
        storageWritePolicy: "external-append-only-rollback-log",
        responsibleSession: "S12",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      });
    };
    const rollbackOperation = createTeachingOperationRecordRollbackPostHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "external",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T11:25:00.000Z"),
    });

    try {
      const response = await rollbackOperation(
        new Request(
          `https://www.uais.top/api/teaching/operations/records/${targetRecordId}/rollback`,
          {
            method: "POST",
            headers: {
              cookie,
              "content-type": "application/json",
              "x-uais-trace-id": "trace-production-rollback-auth-provider-not-ready",
              "user-agent": "UAIS production rollback auth provider not ready",
            },
            body: JSON.stringify({
              action: "rollback-teaching-operation-record",
              courseId: "teacher-research-methods",
              rollbackReason: "teacher-control-plane-test",
            }),
          },
        ),
        {
          params: Promise.resolve({
            recordId: targetRecordId,
          }),
        },
      );
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-production-rollback-auth-provider-not-ready",
      );
      expect(body.error).toBe("UAIS teacher auth provider is not production-ready.");
      expect(body.traceId).toBe("trace-production-rollback-auth-provider-not-ready");
      expect(body.access).toEqual(
        expect.objectContaining({
          status: "denied",
          reasonCode: "teacher-auth-provider-not-production-ready",
          responsibleSession: "S12",
        }),
      );
      expect(body.authProviderContract).toEqual(
        expect.objectContaining({
          providerKind: "missing",
          productionStatus: "blocked",
          blockedReason: "missing-UAIS_TEACHER_AUTH_PROVIDER",
          redaction: {
            values: "omitted",
            cookies: "omitted",
          },
        }),
      );
      expect(externalRequests).toEqual([]);
      expect(JSON.stringify(body)).not.toContain(externalToken);
      expect(JSON.stringify(body)).not.toContain(targetRecordId);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("denies external record rollback when the target record is outside the owned course scope", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-operation-rollback-external-scope-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const targetRecordId =
      "content-publish-course-content-20260622-111000-othercourse";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-operation-rollback-external-scope-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:20:00.000Z",
        expiresAt: "2026-06-22T12:20:00.000Z",
      },
    });
    const externalRequests: Array<{
      method: string;
      url: string;
      authorization: string | null;
      body?: unknown;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const method = init?.method ?? "GET";
      const requestBody =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      externalRequests.push({
        method,
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        ...(requestBody ? { body: requestBody } : {}),
      });

      if (
        method === "GET" &&
        String(url) === "https://external-storage.example.test/teaching-operations/teacher-kang/audit"
      ) {
        return new Response(
          JSON.stringify({
            teacherId: "teacher-kang",
            eventType: "teaching-operation-audit",
            storagePolicy: "external-redacted-teaching-operation-audit-log",
            storageWritePolicy: "external-append-only-audit-log",
            recordCount: 1,
            auditEventCount: 0,
            domainProjectionCount: 0,
            records: [
              {
                recordId: targetRecordId,
                operationId: "content",
                actionSlot: "primary",
                actionId: "publish-course-content",
                actorId: "teacher-kang",
                courseId: "teacher-unowned-course",
                status: "persisted",
                createdAt: "2026-06-22T11:10:00.000Z",
                storagePolicy: "external-redacted-teaching-operation-append",
                storageWritePolicy: "external-append-only-operation-log",
                artifacts: [],
                responsibleSession: "S12",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
              },
            ],
            auditEvents: [],
            domainProjections: [],
            rollbacks: [],
            responsibleSession: "S12",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response(
        JSON.stringify({
          teacherId: "teacher-kang",
          rollbackId: `teaching-operation-rollback-${targetRecordId}`,
          targetRecordId,
          courseId: "teacher-research-methods",
          status: "persisted",
          storagePolicy: "external-redacted-teaching-operation-rollback",
          storageWritePolicy: "external-append-only-rollback-log",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };
    const rollbackOperation = createTeachingOperationRecordRollbackPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN:
          "test-external-storage-access-token-with-32-chars",
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T11:25:00.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T11:20:00.000Z",
      });

      const response = await rollbackOperation(
        new Request(
          `https://www.uais.top/api/teaching/operations/records/${targetRecordId}/rollback`,
          {
            method: "POST",
            headers: {
              cookie,
              "content-type": "application/json",
              "x-uais-trace-id": "trace-external-teaching-operation-rollback-scope-denied",
              "user-agent": "UAIS external operation rollback scope test",
            },
            body: JSON.stringify({
              action: "rollback-teaching-operation-record",
              courseId: "teacher-research-methods",
              rollbackReason: "teacher-control-plane-test",
            }),
          },
        ),
        {
          params: Promise.resolve({
            recordId: targetRecordId,
          }),
        },
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-external-teaching-operation-rollback-scope-denied",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teaching operation course ownership is required.",
          traceId: "trace-external-teaching-operation-rollback-scope-denied",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "course-scope-denied",
            resource: {
              courseId: "teacher-unowned-course",
            },
          }),
        }),
      );
      expect(externalRequests).toEqual([
        {
          method: "GET",
          url: "https://external-storage.example.test/teaching-operations/teacher-kang/audit",
          authorization: "Bearer test-external-storage-access-token-with-32-chars",
        },
      ]);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("returns trace closure when rollback target records are missing", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-operation-rollback-missing-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-operation-rollback-missing-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:20:00.000Z",
        expiresAt: "2026-06-22T12:20:00.000Z",
      },
    });
    const rollbackOperation = createTeachingOperationRecordRollbackPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:25:00.000Z"),
    });

    try {
      const response = await rollbackOperation(
        new Request(
          "https://www.uais.top/api/teaching/operations/records/missing-record/rollback",
          {
            method: "POST",
            headers: {
              cookie,
              "content-type": "application/json",
              "x-uais-trace-id": "trace-teaching-operation-rollback-missing",
              "user-agent": "UAIS operation rollback missing record test",
            },
            body: JSON.stringify({
              action: "rollback-teaching-operation-record",
              rollbackReason: "teacher-control-plane-test",
            }),
          },
        ),
        {
          params: Promise.resolve({
            recordId: "missing-record",
          }),
        },
      );
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-teaching-operation-rollback-missing",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "Teaching operation record was not found.",
          traceId: "trace-teaching-operation-rollback-missing",
        }),
      );
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("requires signed teacher course ownership before serving export manifests", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-export-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const appSessionSecret = "test-app-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-export-manifest-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T09:10:00.000Z",
        expiresAt: "2026-06-22T10:10:00.000Z",
      },
    });
    const studentCookie = createUaisAppSessionCookie(
      {
        account: "Peter",
        department: "学生账号",
        displayName: "Peter",
        role: "student",
      },
      {
        secret: appSessionSecret,
        sessionId: "student-export-manifest-session",
        now: new Date("2026-06-22T09:16:00.000Z"),
      },
    );
    const manifestId = "export-manifest-teacher-kang-20260622-091500";
    const manifestUrl = `https://www.uais.top/api/teaching/operations/export/${manifestId}`;

    try {
      const receipt = await executeTeachingOperationAction({
        dataDir,
        operationId: "data-export",
        actionSlot: "primary",
        courseId: "teacher-math-pedagogy",
        actorId: "teacher-kang",
        now: new Date("2026-06-22T09:15:00.000Z"),
      });
      const exportArtifact = receipt.artifacts.find((artifact) => artifact.kind === "export-file");

      expect(exportArtifact).toEqual(
        expect.objectContaining({
          manifestId,
          downloadUrl: `/api/teaching/operations/export/${manifestId}`,
        }),
      );

      const exportFiles = await readdir(join(dataDir, "exports"));
      expect(exportFiles).toEqual([`${manifestId}.json`]);

      const persistedFile = JSON.parse(
        await readFile(join(dataDir, "exports", exportFiles[0]), "utf8"),
      );
      expect(persistedFile).toEqual(
        expect.objectContaining({
          manifestId,
          courseId: "teacher-math-pedagogy",
          redactionScope: {
            studentPrivateNotes: "excluded",
            credentials: "excluded",
            localPaths: "excluded",
          },
        }),
      );

      const getExport = createTeachingOperationExportGetHandler({
        env: {
          UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
          UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
          UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
          UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
        },
        now: new Date("2026-06-22T09:16:00.000Z"),
      });
      const unauthenticatedResponse = await getExport(
        new Request(manifestUrl, {
          headers: {
            "x-uais-trace-id": "trace-export-manifest-unauthenticated",
          },
        }),
        {
          params: Promise.resolve({
            manifestId,
          }),
        },
      );
      const unauthenticatedBody = await unauthenticatedResponse.json();

      expect(unauthenticatedResponse.status).toBe(401);
      expect(unauthenticatedResponse.headers.get("x-uais-trace-id")).toBe(
        "trace-export-manifest-unauthenticated",
      );
      expect(unauthenticatedBody).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-export-manifest-unauthenticated",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
          }),
        }),
      );

      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T09:12:00.000Z",
      });
      const outOfScopeResponse = await getExport(
        new Request(manifestUrl, {
          headers: {
            cookie,
            "x-uais-trace-id": "trace-export-manifest-scope-denied",
          },
        }),
        {
          params: Promise.resolve({
            manifestId,
          }),
        },
      );
      const outOfScopeBody = await outOfScopeResponse.json();

      expect(outOfScopeResponse.status).toBe(403);
      expect(outOfScopeBody).toEqual(
        expect.objectContaining({
          error: "UAIS teaching operation export course ownership is required.",
          traceId: "trace-export-manifest-scope-denied",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "course-scope-denied",
            resource: {
              courseId: "teacher-math-pedagogy",
            },
          }),
        }),
      );

      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-math-pedagogy"],
        },
        updatedAt: "2026-06-22T09:14:00.000Z",
      });
      const mixedSessionResponse = await getExport(
        new Request(manifestUrl, {
          headers: {
            cookie: `${studentCookie}; ${cookie}`,
            "x-uais-trace-id": "trace-export-manifest-mixed-student-denied",
          },
        }),
        {
          params: Promise.resolve({
            manifestId,
          }),
        },
      );
      const mixedSessionBody = await mixedSessionResponse.json();

      expect(mixedSessionResponse.status).toBe(403);
      expect(mixedSessionResponse.headers.get("x-uais-trace-id")).toBe(
        "trace-export-manifest-mixed-student-denied",
      );
      expect(mixedSessionBody.traceId).toBe("trace-export-manifest-mixed-student-denied");
      expect(mixedSessionBody.access).toEqual(
        expect.objectContaining({
          status: "denied",
          reasonCode: "teacher-role-required",
          responsibleSession: "S12",
        }),
      );
      expect(JSON.stringify(mixedSessionBody)).not.toContain(manifestId);
      expect(JSON.stringify(mixedSessionBody)).not.toContain("teacher-math-pedagogy");

      const response = await getExport(
        new Request(manifestUrl, {
          headers: {
            cookie,
            "x-uais-trace-id": "trace-export-manifest-owned",
          },
        }),
        {
          params: Promise.resolve({
            manifestId,
          }),
        },
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(response.headers.get("x-uais-trace-id")).toBe("trace-export-manifest-owned");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-disposition")).toContain(
        `${manifestId}.json`,
      );
      expect(body.manifestId).toBe(manifestId);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed when export manifest ownership check fails", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-export-ownership-failure-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-export-ownership-failure-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T09:10:00.000Z",
        expiresAt: "2026-06-22T10:10:00.000Z",
      },
    });
    const manifestId = "export-manifest-teacher-kang-20260622-091700";
    const manifestUrl = `https://www.uais.top/api/teaching/operations/export/${manifestId}`;

    try {
      await executeTeachingOperationAction({
        dataDir,
        operationId: "data-export",
        actionSlot: "primary",
        courseId: "teacher-export-secret-course",
        actorId: "teacher-kang",
        now: new Date("2026-06-22T09:17:00.000Z"),
      });
      const getExport = createTeachingOperationExportGetHandler({
        env: {
          UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
          UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        },
        getTeachingOperationCourseOwnership: async () => {
          throw new Error("export ownership backend secret-token unavailable");
        },
        now: new Date("2026-06-22T09:18:00.000Z"),
      });

      const response = await getExport(
        new Request(manifestUrl, {
          headers: {
            cookie,
            "x-uais-trace-id": "trace-export-ownership-check-failed",
          },
        }),
        {
          params: Promise.resolve({
            manifestId,
          }),
        },
      );
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-export-ownership-check-failed",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teaching operation export course ownership check failed.",
          traceId: "trace-export-ownership-check-failed",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "teacher-course-ownership-check-failed",
            actor: { actorId: "teacher-kang", role: "teacher" },
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(JSON.stringify(body)).not.toContain("teacher-export-secret-course");
      expect(JSON.stringify(body)).not.toContain(manifestId);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed export manifest actor ids before ownership checks", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-export-unsafe-actor-id-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const unsafeActorId = "/Users/example/secret-token-export-teacher";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-export-unsafe-actor-session",
        actorId: unsafeActorId,
        role: "teacher",
        authenticatedAt: "2026-06-22T09:18:00.000Z",
        expiresAt: "2026-06-22T10:18:00.000Z",
      },
    });
    const manifestId = "export-manifest-teacher-kang-20260622-091900";
    const manifestUrl = `https://www.uais.top/api/teaching/operations/export/${manifestId}`;
    let ownershipCheckCount = 0;

    try {
      await executeTeachingOperationAction({
        dataDir,
        operationId: "data-export",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        actorId: "teacher-kang",
        now: new Date("2026-06-22T09:19:00.000Z"),
      });
      const getExport = createTeachingOperationExportGetHandler({
        env: {
          UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
          UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        },
        getTeachingOperationCourseOwnership: async () => {
          ownershipCheckCount += 1;
          return {
            teacherId: unsafeActorId,
            courseIds: ["teacher-research-methods"],
          };
        },
        now: new Date("2026-06-22T09:20:00.000Z"),
      });

      const response = await getExport(
        new Request(manifestUrl, {
          headers: {
            cookie,
            "x-uais-trace-id": "trace-export-unsafe-actor-id",
          },
        }),
        {
          params: Promise.resolve({
            manifestId,
          }),
        },
      );
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe("trace-export-unsafe-actor-id");
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-export-unsafe-actor-id",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain("/Users/example/secret-token-export-teacher");
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(ownershipCheckCount).toBe(0);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed student account ids before export manifest role checks", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-export-unsafe-student-id-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const appSessionSecret = "test-app-session-signing-secret";
    const unsafeStudentId = "/Users/example/secret-token-export-student";
    const manifestId = "export-manifest-teacher-kang-20260622-092000";
    const manifestUrl = `https://www.uais.top/api/teaching/operations/export/${manifestId}`;
    const studentCookie = createUaisAppSessionCookie(
      {
        account: unsafeStudentId,
        department: "学生账号",
        displayName: "Unsafe Student",
        role: "student",
      },
      {
        secret: appSessionSecret,
        sessionId: "unsafe-student-export-manifest-session",
        now: new Date("2026-06-22T09:20:00.000Z"),
      },
    );
    let ownershipCheckCount = 0;

    try {
      const getExport = createTeachingOperationExportGetHandler({
        env: {
          UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
          UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
          UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
        },
        getTeachingOperationCourseOwnership: async () => {
          ownershipCheckCount += 1;
          return {
            teacherId: "teacher-kang",
            courseIds: ["teacher-research-methods"],
          };
        },
        now: new Date("2026-06-22T09:20:00.000Z"),
      });

      const response = await getExport(
        new Request(manifestUrl, {
          headers: {
            cookie: studentCookie,
            "x-uais-trace-id": "trace-export-unsafe-student-id",
          },
        }),
        {
          params: Promise.resolve({
            manifestId,
          }),
        },
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe("trace-export-unsafe-student-id");
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-export-unsafe-student-id",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain(unsafeStudentId);
      expect(JSON.stringify(body)).not.toContain(manifestId);
      expect(ownershipCheckCount).toBe(0);
      expect(await readdir(dataDir)).toEqual([]);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed export manifest session ids before ownership checks", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-export-unsafe-session-id-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const unsafeSessionId = "/Users/example/secret-token-export-session";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: unsafeSessionId,
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T09:18:00.000Z",
        expiresAt: "2026-06-22T10:18:00.000Z",
      },
    });
    const manifestId = "export-manifest-teacher-kang-20260622-092100";
    const manifestUrl = `https://www.uais.top/api/teaching/operations/export/${manifestId}`;
    let ownershipCheckCount = 0;

    try {
      await executeTeachingOperationAction({
        dataDir,
        operationId: "data-export",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        actorId: "teacher-kang",
        now: new Date("2026-06-22T09:21:00.000Z"),
      });
      const getExport = createTeachingOperationExportGetHandler({
        env: {
          UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
          UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        },
        getTeachingOperationCourseOwnership: async () => {
          ownershipCheckCount += 1;
          return {
            teacherId: "teacher-kang",
            courseIds: ["teacher-research-methods"],
          };
        },
        now: new Date("2026-06-22T09:22:00.000Z"),
      });

      const response = await getExport(
        new Request(manifestUrl, {
          headers: {
            cookie,
            "x-uais-trace-id": "trace-export-unsafe-session-id",
          },
        }),
        {
          params: Promise.resolve({
            manifestId,
          }),
        },
      );
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe("trace-export-unsafe-session-id");
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-export-unsafe-session-id",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain("/Users/example/secret-token-export-session");
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(ownershipCheckCount).toBe(0);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("serves export manifests from external course management storage when local export files are absent", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-export-external-read-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const manifestId = "export-manifest-teacher-kang-external-readback";
    const courseId = "teacher-external-export-course";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-external-export-manifest-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T09:10:00.000Z",
        expiresAt: "2026-06-22T10:10:00.000Z",
      },
    });
    const externalRequests: Array<{
      method: string;
      url: string;
      authorization: string | null;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      externalRequests.push({
        method: init?.method ?? "GET",
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
      });

      return Response.json({
        revision: "external-export-manifest-revision-1",
        database: {
          schemaVersion: "uais-teaching-course-management-v1",
          updatedAt: "2026-06-22T09:15:00.000Z",
          courses: [
            {
              courseId,
              ownerTeacherId: "teacher-kang",
              courseName: "External Export Course",
              instructor: "康霞",
              unit: "广州大学（404）",
              department: "实验教学中心",
              semester: "2026 春季",
              status: "draft",
              students: 8,
              createdAt: "2026-06-22T09:00:00.000Z",
              updatedAt: "2026-06-22T09:15:00.000Z",
              storagePolicy: "external-redacted-teaching-course-management-snapshot",
              storageWritePolicy: "external-optimistic-snapshot-replace",
              responsibleSession: "S12",
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "ids-only",
              },
            },
          ],
          classes: [],
          memberships: [],
          exportManifests: [
            {
              exportManifestId: `export-manifest-${courseId}`,
              courseId,
              ownerTeacherId: "teacher-kang",
              createdBy: "teacher-kang",
              exportStatus: "generated",
              operationRecordId: "external-export-operation-record",
              sourceAction: "external-export-readback-test",
              teachingOperationManifestId: manifestId,
              downloadRoute: `/api/teaching/operations/export/${manifestId}`,
              datasetScopes: ["learning-records", "chat-threads", "grades", "activities"],
              formats: ["json", "csv"],
              exportPolicy: "redacted-teacher-export-manifest",
              createdAt: "2026-06-22T09:15:00.000Z",
              storagePolicy: "external-redacted-teaching-course-management-snapshot",
              storageWritePolicy: "external-optimistic-snapshot-replace",
              responsibleSession: "S12",
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "ids-only",
              },
            },
          ],
          auditEvents: [],
        },
      });
    };
    const getExport = createTeachingOperationExportGetHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN:
          "test-external-storage-access-token-with-32-chars",
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T09:16:00.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [courseId],
        },
        updatedAt: "2026-06-22T09:14:00.000Z",
      });

      const response = await getExport(
        new Request(`https://www.uais.top/api/teaching/operations/export/${manifestId}`, {
          headers: {
            cookie,
            "x-uais-trace-id": "trace-external-export-manifest-readback",
          },
        }),
        {
          params: Promise.resolve({
            manifestId,
          }),
        },
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-external-export-manifest-readback",
      );
      expect(response.headers.get("content-disposition")).toContain(`${manifestId}.json`);
      expect(body).toEqual(
        expect.objectContaining({
          manifestId,
          operationId: "data-export",
          courseId,
          actorId: "teacher-kang",
          createdAt: "2026-06-22T09:15:00.000Z",
          datasets: ["learning-records", "chat-threads", "grades", "activities"],
          formats: ["json", "csv"],
          redactionScope: {
            studentPrivateNotes: "excluded",
            credentials: "excluded",
            localPaths: "excluded",
          },
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      );
      expect(externalRequests).toEqual([
        {
          method: "GET",
          url: "https://external-storage.example.test/teaching-course-management/database",
          authorization: "Bearer test-external-storage-access-token-with-32-chars",
        },
      ]);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("blocks production teaching operation export manifests before external readback or ownership when teacher auth provider is not production-ready", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-export-auth-provider-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const manifestId = "export-manifest-teacher-kang-auth-provider-blocked";
    const courseId = "teacher-export-auth-provider-course";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-export-auth-provider-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T09:18:00.000Z",
        expiresAt: "2026-06-22T10:18:00.000Z",
      },
    });
    let externalReadCount = 0;
    let ownershipCheckCount = 0;
    const fetchImpl: typeof fetch = async () => {
      externalReadCount += 1;
      return Response.json({
        revision: "external-export-auth-provider-revision-1",
        database: {
          schemaVersion: "uais-teaching-course-management-v1",
          updatedAt: "2026-06-22T09:18:00.000Z",
          courses: [],
          classes: [],
          memberships: [],
          exportManifests: [
            {
              exportManifestId: `export-manifest-${courseId}`,
              courseId,
              ownerTeacherId: "teacher-kang",
              createdBy: "teacher-kang",
              exportStatus: "generated",
              operationRecordId: "external-export-auth-provider-record",
              sourceAction: "external-export-auth-provider-test",
              teachingOperationManifestId: manifestId,
              downloadRoute: `/api/teaching/operations/export/${manifestId}`,
              datasetScopes: ["learning-records"],
              formats: ["json"],
              exportPolicy: "redacted-teacher-export-manifest",
              createdAt: "2026-06-22T09:18:00.000Z",
              storagePolicy: "external-redacted-teaching-course-management-snapshot",
              storageWritePolicy: "external-optimistic-snapshot-replace",
              responsibleSession: "S12",
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "ids-only",
              },
            },
          ],
          auditEvents: [],
        },
      });
    };
    const getExport = createTeachingOperationExportGetHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      fetch: fetchImpl,
      getTeachingOperationCourseOwnership: async () => {
        ownershipCheckCount += 1;
        return {
          teacherId: "teacher-kang",
          courseIds: [courseId],
        };
      },
      now: new Date("2026-06-22T09:19:00.000Z"),
    });

    try {
      const response = await getExport(
        new Request(`https://www.uais.top/api/teaching/operations/export/${manifestId}`, {
          headers: {
            cookie,
            "x-uais-trace-id": "trace-production-export-auth-provider-not-ready",
            "user-agent": "UAIS production export auth provider not ready",
          },
        }),
        {
          params: Promise.resolve({
            manifestId,
          }),
        },
      );
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-production-export-auth-provider-not-ready",
      );
      expect(body.error).toBe("UAIS teacher auth provider is not production-ready.");
      expect(body.traceId).toBe("trace-production-export-auth-provider-not-ready");
      expect(body.access).toEqual(
        expect.objectContaining({
          status: "denied",
          reasonCode: "teacher-auth-provider-not-production-ready",
          responsibleSession: "S12",
        }),
      );
      expect(body.authProviderContract).toEqual(
        expect.objectContaining({
          providerKind: "missing",
          productionStatus: "blocked",
          blockedReason: "missing-UAIS_TEACHER_AUTH_PROVIDER",
          redaction: {
            values: "omitted",
            cookies: "omitted",
          },
        }),
      );
      expect(externalReadCount).toBe(0);
      expect(ownershipCheckCount).toBe(0);
      expect(JSON.stringify(body)).not.toContain(externalToken);
      expect(JSON.stringify(body)).not.toContain(manifestId);
      expect(JSON.stringify(body)).not.toContain(courseId);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe export manifest ids before external readback", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-export-unsafe-manifest-id-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const unsafeManifestId = "/Users/example/secret-token-export-manifest";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-export-unsafe-manifest-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-28T01:30:00.000Z",
        expiresAt: "2026-06-28T02:30:00.000Z",
      },
    });
    const externalRequests: Array<{ method?: string; url: string }> = [];
    let ownershipCheckCount = 0;
    const getExport = createTeachingOperationExportGetHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      fetch: async (url, init) => {
        externalRequests.push({
          method: init?.method,
          url: String(url),
        });
        return Response.json({
          revision: "rev-unsafe-export-manifest",
          productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
          database: {
            schemaVersion: "uais-teaching-course-management-v1",
            updatedAt: "2026-06-28T01:30:00.000Z",
            courses: [],
            classes: [],
            memberships: [],
            exportManifests: [],
            auditEvents: [],
          },
        });
      },
      getTeachingOperationCourseOwnership: async () => {
        ownershipCheckCount += 1;
        return {
          teacherId: "teacher-kang",
          courseIds: ["teacher-export-unsafe-manifest-course"],
        };
      },
      now: new Date("2026-06-28T01:35:00.000Z"),
    });

    try {
      const response = await getExport(
        new Request(
          `https://www.uais.top/api/teaching/operations/export/${encodeURIComponent(
            unsafeManifestId,
          )}`,
          {
            headers: {
              cookie,
              "x-uais-trace-id": "trace-unsafe-export-manifest-id",
              "user-agent": "UAIS unsafe export manifest id test",
            },
          },
        ),
        {
          params: Promise.resolve({
            manifestId: unsafeManifestId,
          }),
        },
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teaching operation export manifest id is invalid.",
          traceId: "trace-unsafe-export-manifest-id",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      );
      expect(externalRequests).toEqual([]);
      expect(ownershipCheckCount).toBe(0);
      expect(JSON.stringify(body)).not.toContain(unsafeManifestId);
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(JSON.stringify(body)).not.toContain(externalToken);
      expect(await readdir(dataDir)).toEqual([]);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("ignores stale local export manifests when the external teaching operations backend is selected", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-export-external-precedence-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const externalCourseId = "teacher-external-export-authoritative-course";
    const staleLocalCourseId = "teacher-stale-local-export-course";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-external-export-precedence-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T09:20:00.000Z",
        expiresAt: "2026-06-22T10:20:00.000Z",
      },
    });
    const externalRequests: Array<{
      method: string;
      url: string;
      authorization: string | null;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      externalRequests.push({
        method: init?.method ?? "GET",
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
      });

      return Response.json({
        revision: "external-export-manifest-precedence-revision-1",
        database: {
          schemaVersion: "uais-teaching-course-management-v1",
          updatedAt: "2026-06-22T09:26:00.000Z",
          courses: [
            {
              courseId: externalCourseId,
              ownerTeacherId: "teacher-kang",
              courseName: "Authoritative External Export Course",
              instructor: "康霞",
              unit: "广州大学（404）",
              department: "实验教学中心",
              semester: "2026 春季",
              status: "draft",
              students: 12,
              createdAt: "2026-06-22T09:20:00.000Z",
              updatedAt: "2026-06-22T09:26:00.000Z",
              storagePolicy: "external-redacted-teaching-course-management-snapshot",
              storageWritePolicy: "external-optimistic-snapshot-replace",
              responsibleSession: "S12",
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "ids-only",
              },
            },
          ],
          classes: [],
          memberships: [],
          exportManifests: [
            {
              exportManifestId: `export-manifest-${externalCourseId}`,
              courseId: externalCourseId,
              ownerTeacherId: "teacher-kang",
              createdBy: "teacher-kang",
              exportStatus: "generated",
              operationRecordId: "external-export-operation-record-precedence",
              sourceAction: "external-export-precedence-test",
              teachingOperationManifestId: "placeholder-replaced-below",
              downloadRoute: "/placeholder-replaced-below",
              datasetScopes: ["learning-records", "chat-threads", "grades", "activities"],
              formats: ["json", "csv"],
              exportPolicy: "redacted-teacher-export-manifest",
              createdAt: "2026-06-22T09:26:00.000Z",
              storagePolicy: "external-redacted-teaching-course-management-snapshot",
              storageWritePolicy: "external-optimistic-snapshot-replace",
              responsibleSession: "S12",
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "ids-only",
              },
            },
          ],
          auditEvents: [],
        },
      });
    };

    try {
      const receipt = await executeTeachingOperationAction({
        dataDir,
        operationId: "data-export",
        actionSlot: "primary",
        courseId: staleLocalCourseId,
        actorId: "teacher-kang",
        now: new Date("2026-06-22T09:25:00.000Z"),
      });
      const manifestId = receipt.artifacts.find(
        (artifact) => artifact.kind === "export-file",
      )?.manifestId;
      expect(manifestId).toBe("export-manifest-teacher-kang-20260622-092500");

      const authoritativeFetch: typeof fetch = async (url, init) => {
        const response = await fetchImpl(url, init);
        const body = await response.json();
        body.database.exportManifests[0].teachingOperationManifestId = manifestId;
        body.database.exportManifests[0].downloadRoute =
          `/api/teaching/operations/export/${manifestId}`;
        return Response.json(body, { status: response.status });
      };
      const getExport = createTeachingOperationExportGetHandler({
        env: {
          UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
          UAIS_TEACHING_OPERATIONS_BACKEND: "external",
          UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
          UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
          UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
          UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
          UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN:
            "test-external-storage-access-token-with-32-chars",
        },
        fetch: authoritativeFetch,
        now: new Date("2026-06-22T09:27:00.000Z"),
      });

      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [externalCourseId],
        },
        updatedAt: "2026-06-22T09:26:00.000Z",
      });

      const response = await getExport(
        new Request(`https://www.uais.top/api/teaching/operations/export/${manifestId}`, {
          headers: {
            cookie,
            "x-uais-trace-id": "trace-external-export-manifest-precedence",
          },
        }),
        {
          params: Promise.resolve({
            manifestId: manifestId ?? "",
          }),
        },
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual(
        expect.objectContaining({
          manifestId,
          courseId: externalCourseId,
          actorId: "teacher-kang",
          createdAt: "2026-06-22T09:26:00.000Z",
        }),
      );
      expect(JSON.stringify(body)).not.toContain(staleLocalCourseId);
      expect(externalRequests).toEqual([
        {
          method: "GET",
          url: "https://external-storage.example.test/teaching-course-management/database",
          authorization: "Bearer test-external-storage-access-token-with-32-chars",
        },
      ]);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("projects course settings saves into a course settings domain object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-domain-course-settings-"));

    try {
      const receipt = await executeTeachingOperationAction({
        dataDir,
        operationId: "course-settings",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        actorId: "teacher-kang",
        sourceAction: "manage",
        now: new Date("2026-06-22T09:30:00.000Z"),
      });
      const database = await readTeachingOperationDatabase({ dataDir });
      const domainProjections = (
        database as unknown as {
          domainProjections?: Array<Record<string, unknown>>;
        }
      ).domainProjections;

      expect(receipt.artifacts).toContainEqual(
        expect.objectContaining({
          kind: "domain-object",
          objectType: "course-settings",
          objectId: "course-settings-teacher-research-methods",
        }),
      );
      expect(domainProjections).toEqual([
        expect.objectContaining({
          objectId: "course-settings-teacher-research-methods",
          objectType: "course-settings",
          courseId: "teacher-research-methods",
          updatedBy: "teacher-kang",
          status: "saved",
          operationRecordId: receipt.receiptId,
          sourceAction: "manage",
          storagePolicy: "domain-projection-teaching-course-settings",
          updatedAt: "2026-06-22T09:30:00.000Z",
        }),
      ]);
      expectNoLocalOrSecretValues(domainProjections, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("projects student previews into a student preview session domain object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-domain-student-preview-"));

    try {
      const receipt = await executeTeachingOperationAction({
        dataDir,
        operationId: "course-settings",
        actionSlot: "secondary",
        courseId: "teacher-research-methods",
        actorId: "teacher-kang",
        sourceAction: "manage",
        now: new Date("2026-06-22T09:52:00.000Z"),
      });
      const database = await readTeachingOperationDatabase({ dataDir });
      const domainProjections = (
        database as unknown as {
          domainProjections?: Array<Record<string, unknown>>;
        }
      ).domainProjections;

      expect(receipt.artifacts).toContainEqual(
        expect.objectContaining({
          kind: "domain-object",
          objectType: "student-preview-session",
          objectId: "student-preview-session-teacher-research-methods",
        }),
      );
      expect(domainProjections).toEqual([
        expect.objectContaining({
          objectId: "student-preview-session-teacher-research-methods",
          objectType: "student-preview-session",
          courseId: "teacher-research-methods",
          previewedBy: "teacher-kang",
          previewStatus: "generated",
          operationRecordId: receipt.receiptId,
          sourceAction: "manage",
          previewId: "student-preview-20260622-095200",
          previewUrl: "/learning?teacherPreview=1&course=teacher-research-methods",
          previewScope: "teacher-course-preview",
          previewPolicy: "teacher-visible-preview-only",
          generatedAt: "2026-06-22T09:52:00.000Z",
          storagePolicy: "domain-projection-teaching-student-preview-session",
        }),
      ]);
      expectNoLocalOrSecretValues(domainProjections, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("projects agent plan saves into an agent plan domain object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-domain-agent-plan-"));

    try {
      const receipt = await executeTeachingOperationAction({
        dataDir,
        operationId: "agents",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        actorId: "teacher-kang",
        sourceAction: "manage",
        now: new Date("2026-06-22T09:35:00.000Z"),
      });
      const database = await readTeachingOperationDatabase({ dataDir });
      const domainProjections = (
        database as unknown as {
          domainProjections?: Array<Record<string, unknown>>;
        }
      ).domainProjections;

      expect(receipt.artifacts).toContainEqual(
        expect.objectContaining({
          kind: "domain-object",
          objectType: "agent-plan",
          objectId: "agent-plan-teacher-research-methods",
        }),
      );
      expect(domainProjections).toEqual([
        expect.objectContaining({
          objectId: "agent-plan-teacher-research-methods",
          objectType: "agent-plan",
          courseId: "teacher-research-methods",
          savedBy: "teacher-kang",
          planStatus: "saved",
          operationRecordId: receipt.receiptId,
          sourceAction: "manage",
          enabledAgents: ["research-assistant", "math-coach", "writing-mentor"],
          governancePolicy: "teacher-reviewed-agent-plan",
          savedAt: "2026-06-22T09:35:00.000Z",
          storagePolicy: "domain-projection-teaching-agent-plan",
        }),
      ]);
      expectNoLocalOrSecretValues(domainProjections, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("projects permission preflights into a permission preflight domain object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-domain-permission-preflight-"));

    try {
      const receipt = await executeTeachingOperationAction({
        dataDir,
        operationId: "agents",
        actionSlot: "secondary",
        courseId: "teacher-research-methods",
        actorId: "teacher-kang",
        sourceAction: "manage",
        now: new Date("2026-06-22T09:52:30.000Z"),
      });
      const database = await readTeachingOperationDatabase({ dataDir });
      const domainProjections = (
        database as unknown as {
          domainProjections?: Array<Record<string, unknown>>;
        }
      ).domainProjections;

      expect(receipt.artifacts).toContainEqual(
        expect.objectContaining({
          kind: "domain-object",
          objectType: "permission-preflight",
          objectId: "permission-preflight-teacher-research-methods",
        }),
      );
      expect(domainProjections).toEqual([
        expect.objectContaining({
          objectId: "permission-preflight-teacher-research-methods",
          objectType: "permission-preflight",
          courseId: "teacher-research-methods",
          checkedBy: "teacher-kang",
          preflightStatus: "passed",
          operationRecordId: receipt.receiptId,
          sourceAction: "manage",
          checkedPermissions: ["course-bindings", "agent-roles", "student-access"],
          preflightPolicy: "teacher-agent-permission-gate",
          checkedAt: "2026-06-22T09:52:30.000Z",
          storagePolicy: "domain-projection-teaching-permission-preflight",
        }),
      ]);
      expectNoLocalOrSecretValues(domainProjections, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("projects dashboard refreshes into a dashboard state domain object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-domain-dashboard-state-"));

    try {
      const receipt = await executeTeachingOperationAction({
        dataDir,
        operationId: "dashboard",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        actorId: "teacher-kang",
        sourceAction: "manage",
        now: new Date("2026-06-22T09:40:00.000Z"),
      });
      const database = await readTeachingOperationDatabase({ dataDir });
      const domainProjections = (
        database as unknown as {
          domainProjections?: Array<Record<string, unknown>>;
        }
      ).domainProjections;

      expect(receipt.artifacts).toContainEqual(
        expect.objectContaining({
          kind: "domain-object",
          objectType: "dashboard-state",
          objectId: "dashboard-state-teacher-research-methods",
        }),
      );
      expect(domainProjections).toEqual([
        expect.objectContaining({
          objectId: "dashboard-state-teacher-research-methods",
          objectType: "dashboard-state",
          courseId: "teacher-research-methods",
          refreshedBy: "teacher-kang",
          refreshStatus: "refreshed",
          operationRecordId: receipt.receiptId,
          sourceAction: "manage",
          visibleMetrics: ["engagement", "progress", "assessment-quality"],
          refreshPolicy: "teacher-visible-course-dashboard",
          refreshedAt: "2026-06-22T09:40:00.000Z",
          storagePolicy: "domain-projection-teaching-dashboard-state",
        }),
      ]);
      expectNoLocalOrSecretValues(domainProjections, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("projects admin setting saves into an admin settings domain object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-domain-admin-settings-"));

    try {
      const receipt = await executeTeachingOperationAction({
        dataDir,
        operationId: "admins",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        actorId: "teacher-kang",
        sourceAction: "manage",
        now: new Date("2026-06-22T09:42:00.000Z"),
      });
      const database = await readTeachingOperationDatabase({ dataDir });
      const domainProjections = (
        database as unknown as {
          domainProjections?: Array<Record<string, unknown>>;
        }
      ).domainProjections;

      expect(receipt.artifacts).toContainEqual(
        expect.objectContaining({
          kind: "domain-object",
          objectType: "admin-settings",
          objectId: "admin-settings-teacher-research-methods",
        }),
      );
      expect(domainProjections).toEqual([
        expect.objectContaining({
          objectId: "admin-settings-teacher-research-methods",
          objectType: "admin-settings",
          courseId: "teacher-research-methods",
          savedBy: "teacher-kang",
          settingsStatus: "saved",
          operationRecordId: receipt.receiptId,
          sourceAction: "manage",
          adminScopes: ["course-collaborators", "permission-boundary", "audit-routing"],
          governancePolicy: "teacher-controlled-admin-settings",
          savedAt: "2026-06-22T09:42:00.000Z",
          storagePolicy: "domain-projection-teaching-admin-settings",
        }),
      ]);
      expectNoLocalOrSecretValues(domainProjections, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("projects quiz board refreshes into a quiz board state domain object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-domain-quiz-board-state-"));

    try {
      const receipt = await executeTeachingOperationAction({
        dataDir,
        operationId: "quiz-board",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        actorId: "teacher-kang",
        sourceAction: "manage",
        now: new Date("2026-06-22T09:44:00.000Z"),
      });
      const database = await readTeachingOperationDatabase({ dataDir });
      const domainProjections = (
        database as unknown as {
          domainProjections?: Array<Record<string, unknown>>;
        }
      ).domainProjections;

      expect(receipt.artifacts).toContainEqual(
        expect.objectContaining({
          kind: "domain-object",
          objectType: "quiz-board-state",
          objectId: "quiz-board-state-teacher-research-methods",
        }),
      );
      expect(domainProjections).toEqual([
        expect.objectContaining({
          objectId: "quiz-board-state-teacher-research-methods",
          objectType: "quiz-board-state",
          courseId: "teacher-research-methods",
          refreshedBy: "teacher-kang",
          refreshStatus: "refreshed",
          operationRecordId: receipt.receiptId,
          sourceAction: "manage",
          visibleMetrics: ["completion-rate", "item-quality", "misconception-clusters"],
          reviewPolicy: "teacher-visible-quiz-quality-board",
          refreshedAt: "2026-06-22T09:44:00.000Z",
          storagePolicy: "domain-projection-teaching-quiz-board-state",
        }),
      ]);
      expectNoLocalOrSecretValues(domainProjections, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("projects resource placeholders into a resource review item domain object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-domain-resource-review-"));

    try {
      const receipt = await executeTeachingOperationAction({
        dataDir,
        operationId: "knowledge-base",
        actionSlot: "secondary",
        courseId: "teacher-research-methods",
        actorId: "teacher-kang",
        sourceAction: "manage",
        now: new Date("2026-06-22T09:46:00.000Z"),
      });
      const database = await readTeachingOperationDatabase({ dataDir });
      const domainProjections = (
        database as unknown as {
          domainProjections?: Array<Record<string, unknown>>;
        }
      ).domainProjections;

      expect(receipt.artifacts).toContainEqual(
        expect.objectContaining({
          kind: "domain-object",
          objectType: "resource-review-item",
          objectId: "resource-review-item-teacher-research-methods",
        }),
      );
      expect(domainProjections).toEqual([
        expect.objectContaining({
          objectId: "resource-review-item-teacher-research-methods",
          objectType: "resource-review-item",
          courseId: "teacher-research-methods",
          queuedBy: "teacher-kang",
          reviewStatus: "pending-teacher-review",
          operationRecordId: receipt.receiptId,
          sourceAction: "manage",
          resourceSource: "teacher-placeholder",
          reviewPolicy: "teacher-review-before-knowledge-index",
          queuedAt: "2026-06-22T09:46:00.000Z",
          storagePolicy: "domain-projection-teaching-resource-review-item",
        }),
      ]);
      expectNoLocalOrSecretValues(domainProjections, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("projects generated unit drafts into a unit draft domain object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-domain-unit-draft-"));

    try {
      const receipt = await executeTeachingOperationAction({
        dataDir,
        operationId: "content",
        actionSlot: "secondary",
        courseId: "teacher-research-methods",
        actorId: "teacher-kang",
        sourceAction: "manage",
        now: new Date("2026-06-22T09:48:00.000Z"),
      });
      const database = await readTeachingOperationDatabase({ dataDir });
      const domainProjections = (
        database as unknown as {
          domainProjections?: Array<Record<string, unknown>>;
        }
      ).domainProjections;

      expect(receipt.artifacts).toContainEqual(
        expect.objectContaining({
          kind: "domain-object",
          objectType: "unit-draft",
          objectId: "unit-draft-teacher-research-methods",
        }),
      );
      expect(domainProjections).toEqual([
        expect.objectContaining({
          objectId: "unit-draft-teacher-research-methods",
          objectType: "unit-draft",
          courseId: "teacher-research-methods",
          generatedBy: "teacher-kang",
          draftStatus: "ready-for-teacher-review",
          operationRecordId: receipt.receiptId,
          sourceAction: "manage",
          artifactId: "unit-draft-20260622-094800",
          reviewPolicy: "teacher-review-before-course-publish",
          generatedAt: "2026-06-22T09:48:00.000Z",
          storagePolicy: "domain-projection-teaching-unit-draft",
        }),
      ]);
      expectNoLocalOrSecretValues(domainProjections, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("projects generated group suggestions into a group suggestions domain object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-domain-group-suggestions-"));

    try {
      const receipt = await executeTeachingOperationAction({
        dataDir,
        operationId: "students",
        actionSlot: "secondary",
        courseId: "teacher-research-methods",
        actorId: "teacher-kang",
        sourceAction: "manage",
        now: new Date("2026-06-22T09:49:00.000Z"),
      });
      const database = await readTeachingOperationDatabase({ dataDir });
      const domainProjections = (
        database as unknown as {
          domainProjections?: Array<Record<string, unknown>>;
        }
      ).domainProjections;

      expect(receipt.artifacts).toContainEqual(
        expect.objectContaining({
          kind: "domain-object",
          objectType: "group-suggestions",
          objectId: "group-suggestions-teacher-research-methods",
        }),
      );
      expect(domainProjections).toEqual([
        expect.objectContaining({
          objectId: "group-suggestions-teacher-research-methods",
          objectType: "group-suggestions",
          courseId: "teacher-research-methods",
          generatedBy: "teacher-kang",
          suggestionStatus: "ready-for-teacher-review",
          operationRecordId: receipt.receiptId,
          sourceAction: "manage",
          artifactId: "group-suggestions-20260622-094900",
          groupingBasis: ["participation", "progress", "collaboration-balance"],
          reviewPolicy: "teacher-review-before-group-assignment",
          generatedAt: "2026-06-22T09:49:00.000Z",
          storagePolicy: "domain-projection-teaching-group-suggestions",
        }),
      ]);
      expectNoLocalOrSecretValues(domainProjections, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("projects generated AI feedback into a grading feedback draft domain object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-domain-ai-feedback-"));

    try {
      const receipt = await executeTeachingOperationAction({
        dataDir,
        operationId: "grading",
        actionSlot: "secondary",
        courseId: "teacher-research-methods",
        actorId: "teacher-kang",
        sourceAction: "manage",
        now: new Date("2026-06-22T09:49:30.000Z"),
      });
      const database = await readTeachingOperationDatabase({ dataDir });
      const domainProjections = (
        database as unknown as {
          domainProjections?: Array<Record<string, unknown>>;
        }
      ).domainProjections;

      expect(receipt.artifacts).toContainEqual(
        expect.objectContaining({
          kind: "domain-object",
          objectType: "ai-feedback-draft",
          objectId: "ai-feedback-draft-teacher-research-methods",
        }),
      );
      expect(domainProjections).toEqual([
        expect.objectContaining({
          objectId: "ai-feedback-draft-teacher-research-methods",
          objectType: "ai-feedback-draft",
          courseId: "teacher-research-methods",
          generatedBy: "teacher-kang",
          feedbackStatus: "ready-for-teacher-review",
          operationRecordId: receipt.receiptId,
          sourceAction: "manage",
          artifactId: "ai-feedback-20260622-094930",
          feedbackScope: "grading-review-queue",
          reviewPolicy: "teacher-review-before-student-release",
          generatedAt: "2026-06-22T09:49:30.000Z",
          storagePolicy: "domain-projection-teaching-ai-feedback-draft",
        }),
      ]);
      expectNoLocalOrSecretValues(domainProjections, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("projects locked dashboard snapshots into a dashboard snapshot domain object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-domain-dashboard-snapshot-"));

    try {
      const receipt = await executeTeachingOperationAction({
        dataDir,
        operationId: "dashboard",
        actionSlot: "secondary",
        courseId: "teacher-research-methods",
        actorId: "teacher-kang",
        sourceAction: "manage",
        now: new Date("2026-06-22T09:50:00.000Z"),
      });
      const database = await readTeachingOperationDatabase({ dataDir });
      const domainProjections = (
        database as unknown as {
          domainProjections?: Array<Record<string, unknown>>;
        }
      ).domainProjections;

      expect(receipt.artifacts).toContainEqual(
        expect.objectContaining({
          kind: "domain-object",
          objectType: "dashboard-snapshot",
          objectId: "dashboard-snapshot-teacher-research-methods",
        }),
      );
      expect(domainProjections).toEqual([
        expect.objectContaining({
          objectId: "dashboard-snapshot-teacher-research-methods",
          objectType: "dashboard-snapshot",
          courseId: "teacher-research-methods",
          lockedBy: "teacher-kang",
          snapshotStatus: "locked",
          operationRecordId: receipt.receiptId,
          sourceAction: "manage",
          snapshotId: "daily-snapshot-20260622-095000",
          snapshotScope: "daily-course-dashboard",
          retentionPolicy: "teacher-locked-dashboard-snapshot",
          lockedAt: "2026-06-22T09:50:00.000Z",
          storagePolicy: "domain-projection-teaching-dashboard-snapshot",
        }),
      ]);
      expectNoLocalOrSecretValues(domainProjections, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("projects low-quality quiz item flags into a quiz item review domain object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-domain-quiz-item-review-"));

    try {
      const receipt = await executeTeachingOperationAction({
        dataDir,
        operationId: "quiz-board",
        actionSlot: "secondary",
        courseId: "teacher-research-methods",
        actorId: "teacher-kang",
        sourceAction: "manage",
        now: new Date("2026-06-22T09:50:30.000Z"),
      });
      const database = await readTeachingOperationDatabase({ dataDir });
      const domainProjections = (
        database as unknown as {
          domainProjections?: Array<Record<string, unknown>>;
        }
      ).domainProjections;

      expect(receipt.artifacts).toContainEqual(
        expect.objectContaining({
          kind: "domain-object",
          objectType: "quiz-item-review",
          objectId: "quiz-item-review-teacher-research-methods",
        }),
      );
      expect(domainProjections).toEqual([
        expect.objectContaining({
          objectId: "quiz-item-review-teacher-research-methods",
          objectType: "quiz-item-review",
          courseId: "teacher-research-methods",
          flaggedBy: "teacher-kang",
          reviewStatus: "flagged-for-review",
          operationRecordId: receipt.receiptId,
          sourceAction: "manage",
          flaggedSignals: ["low-discrimination", "high-error-rate", "teacher-review-needed"],
          reviewPolicy: "teacher-review-before-quiz-reuse",
          flaggedAt: "2026-06-22T09:50:30.000Z",
          storagePolicy: "domain-projection-teaching-quiz-item-review",
        }),
      ]);
      expectNoLocalOrSecretValues(domainProjections, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("projects export manifests into an export manifest domain object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-domain-export-manifest-"));

    try {
      const receipt = await executeTeachingOperationAction({
        dataDir,
        operationId: "data-export",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        actorId: "teacher-kang",
        sourceAction: "manage",
        now: new Date("2026-06-22T09:51:00.000Z"),
      });
      const database = await readTeachingOperationDatabase({ dataDir });
      const domainProjections = (
        database as unknown as {
          domainProjections?: Array<Record<string, unknown>>;
        }
      ).domainProjections;

      expect(receipt.artifacts).toContainEqual(
        expect.objectContaining({
          kind: "domain-object",
          objectType: "export-manifest",
          objectId: "export-manifest-teacher-research-methods",
        }),
      );
      expect(domainProjections).toEqual([
        expect.objectContaining({
          objectId: "export-manifest-teacher-research-methods",
          objectType: "export-manifest",
          courseId: "teacher-research-methods",
          createdBy: "teacher-kang",
          exportStatus: "generated",
          operationRecordId: receipt.receiptId,
          sourceAction: "manage",
          manifestId: "export-manifest-teacher-kang-20260622-095100",
          datasetScopes: ["learning-records", "chat-threads", "grades", "activities"],
          exportPolicy: "redacted-teacher-export-manifest",
          createdAt: "2026-06-22T09:51:00.000Z",
          storagePolicy: "domain-projection-teaching-export-manifest",
        }),
      ]);
      expectNoLocalOrSecretValues(domainProjections, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("projects redaction scope checks into a redaction validation domain object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-domain-redaction-validation-"));

    try {
      const receipt = await executeTeachingOperationAction({
        dataDir,
        operationId: "data-export",
        actionSlot: "secondary",
        courseId: "teacher-research-methods",
        actorId: "teacher-kang",
        sourceAction: "manage",
        now: new Date("2026-06-22T09:51:30.000Z"),
      });
      const database = await readTeachingOperationDatabase({ dataDir });
      const domainProjections = (
        database as unknown as {
          domainProjections?: Array<Record<string, unknown>>;
        }
      ).domainProjections;

      expect(receipt.artifacts).toContainEqual(
        expect.objectContaining({
          kind: "domain-object",
          objectType: "redaction-validation",
          objectId: "redaction-validation-teacher-research-methods",
        }),
      );
      expect(domainProjections).toEqual([
        expect.objectContaining({
          objectId: "redaction-validation-teacher-research-methods",
          objectType: "redaction-validation",
          courseId: "teacher-research-methods",
          validatedBy: "teacher-kang",
          validationStatus: "passed",
          operationRecordId: receipt.receiptId,
          sourceAction: "manage",
          checkedScopes: ["student-private-notes", "credentials", "local-paths"],
          validationPolicy: "exclude-private-and-secret-fields",
          validatedAt: "2026-06-22T09:51:30.000Z",
          storagePolicy: "domain-projection-teaching-redaction-validation",
        }),
      ]);
      expectNoLocalOrSecretValues(domainProjections, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("projects roster sync operations into a student roster domain object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-domain-roster-"));

    try {
      const receipt = await executeTeachingOperationAction({
        dataDir,
        operationId: "students",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        actorId: "teacher-kang",
        sourceAction: "manage",
        now: new Date("2026-06-22T09:45:00.000Z"),
      });
      const database = await readTeachingOperationDatabase({ dataDir });
      const domainProjections = (
        database as unknown as {
          domainProjections?: Array<Record<string, unknown>>;
        }
      ).domainProjections;

      expect(receipt.artifacts).toContainEqual(
        expect.objectContaining({
          kind: "domain-object",
          objectType: "student-roster",
          objectId: "student-roster-teacher-research-methods",
        }),
      );
      expect(domainProjections).toContainEqual(
        expect.objectContaining({
          objectId: "student-roster-teacher-research-methods",
          objectType: "student-roster",
          courseId: "teacher-research-methods",
          syncedBy: "teacher-kang",
          syncStatus: "synced",
          operationRecordId: receipt.receiptId,
          sourceAction: "manage",
          sourceSystems: ["sis-roster", "invite-code-joins", "withdrawals"],
          pendingTeacherReviewCount: 3,
          storagePolicy: "domain-projection-teaching-student-roster",
          syncedAt: "2026-06-22T09:45:00.000Z",
        }),
      );
      expectNoLocalOrSecretValues(domainProjections, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("projects generated invite codes into an invite code draft domain object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-domain-invite-code-draft-"));

    try {
      const receipt = await executeTeachingOperationAction({
        dataDir,
        operationId: "invite-code",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        actorId: "teacher-kang",
        sourceAction: "manage",
        now: new Date("2026-06-22T09:52:45.000Z"),
      });
      const database = await readTeachingOperationDatabase({ dataDir });
      const domainProjections = (
        database as unknown as {
          domainProjections?: Array<Record<string, unknown>>;
        }
      ).domainProjections;

      expect(receipt.artifacts).toContainEqual(
        expect.objectContaining({
          kind: "domain-object",
          objectType: "invite-code-draft",
          objectId: "invite-code-draft-teacher-research-methods-55395058",
        }),
      );
      expect(domainProjections).toEqual([
        expect.objectContaining({
          objectId: "invite-code-draft-teacher-research-methods-55395058",
          objectType: "invite-code-draft",
          courseId: "teacher-research-methods",
          inviteCode: "55395058",
          joinUrl: "/courses?invite=55395058",
          generatedBy: "teacher-kang",
          draftStatus: "generated",
          operationRecordId: receipt.receiptId,
          sourceAction: "manage",
          invitePolicy: "teacher-review-before-publication",
          generatedAt: "2026-06-22T09:52:45.000Z",
          storagePolicy: "domain-projection-teaching-invite-code-draft",
        }),
      ]);
      expectNoLocalOrSecretValues(domainProjections, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("projects published invite codes into an enrollment access domain object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-domain-invite-"));

    try {
      await executeTeachingOperationAction({
        dataDir,
        operationId: "invite-code",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        actorId: "teacher-kang",
        sourceAction: "invite-workspace",
        now: new Date("2026-06-22T09:50:00.000Z"),
      });
      const receipt = await executeTeachingOperationAction({
        dataDir,
        operationId: "invite-code",
        actionSlot: "secondary",
        courseId: "teacher-research-methods",
        actorId: "teacher-kang",
        sourceAction: "invite-workspace",
        now: new Date("2026-06-22T09:55:00.000Z"),
      });
      const database = await readTeachingOperationDatabase({ dataDir });
      const domainProjections = (
        database as unknown as {
          domainProjections?: Array<Record<string, unknown>>;
        }
      ).domainProjections;

      expect(receipt.artifacts).toContainEqual(
        expect.objectContaining({
          kind: "domain-object",
          objectType: "enrollment-access",
          objectId: "enrollment-access-teacher-research-methods-55395058",
        }),
      );
      expect(domainProjections).toContainEqual(
        expect.objectContaining({
          objectId: "enrollment-access-teacher-research-methods-55395058",
          objectType: "enrollment-access",
          courseId: "teacher-research-methods",
          inviteCode: "55395058",
          joinUrl: "/courses?invite=55395058",
          publishedBy: "teacher-kang",
          publicationStatus: "published",
          operationRecordId: receipt.receiptId,
          sourceAction: "invite-workspace",
          enrollmentPolicy: "teacher-confirmed-course-scope",
          storagePolicy: "domain-projection-teaching-enrollment-access",
          publishedAt: "2026-06-22T09:55:00.000Z",
        }),
      );
      expectNoLocalOrSecretValues(domainProjections, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("projects knowledge, content, and grading actions into domain objects", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-domain-core-actions-"));
    const scenarios = [
      {
        operationId: "knowledge-base",
        actionSlot: "primary",
        now: "2026-06-22T10:05:00.000Z",
        artifact: {
          kind: "domain-object",
          objectType: "knowledge-index",
          objectId: "knowledge-index-teacher-research-methods",
        },
        projection: {
          objectId: "knowledge-index-teacher-research-methods",
          objectType: "knowledge-index",
          courseId: "teacher-research-methods",
          syncedBy: "teacher-kang",
          syncStatus: "synced",
          sourceAction: "manage",
          sourceSystems: ["course-files", "teacher-resources", "agent-grounding-index"],
          storagePolicy: "domain-projection-teaching-knowledge-index",
          syncedAt: "2026-06-22T10:05:00.000Z",
        },
      },
      {
        operationId: "content",
        actionSlot: "primary",
        now: "2026-06-22T10:10:00.000Z",
        artifact: {
          kind: "domain-object",
          objectType: "course-content",
          objectId: "course-content-teacher-research-methods",
        },
        projection: {
          objectId: "course-content-teacher-research-methods",
          objectType: "course-content",
          courseId: "teacher-research-methods",
          publishedBy: "teacher-kang",
          publicationStatus: "published",
          sourceAction: "manage",
          releaseScope: "course-visible-content",
          storagePolicy: "domain-projection-teaching-course-content",
          publishedAt: "2026-06-22T10:10:00.000Z",
        },
      },
      {
        operationId: "grading",
        actionSlot: "primary",
        now: "2026-06-22T10:15:00.000Z",
        artifact: {
          kind: "domain-object",
          objectType: "grading-queue",
          objectId: "grading-queue-teacher-research-methods",
        },
        projection: {
          objectId: "grading-queue-teacher-research-methods",
          objectType: "grading-queue",
          courseId: "teacher-research-methods",
          savedBy: "teacher-kang",
          queueStatus: "saved",
          sourceAction: "manage",
          reviewPolicy: "teacher-review-before-release",
          storagePolicy: "domain-projection-teaching-grading-queue",
          savedAt: "2026-06-22T10:15:00.000Z",
        },
      },
    ] as const;

    try {
      const receipts = [];
      for (const scenario of scenarios) {
        const receipt = await executeTeachingOperationAction({
          dataDir,
          operationId: scenario.operationId,
          actionSlot: scenario.actionSlot,
          courseId: "teacher-research-methods",
          actorId: "teacher-kang",
          sourceAction: "manage",
          now: new Date(scenario.now),
        });
        receipts.push(receipt);
        expect(receipt.artifacts).toContainEqual(expect.objectContaining(scenario.artifact));
      }

      const database = await readTeachingOperationDatabase({ dataDir });
      const domainProjections = (
        database as unknown as {
          domainProjections?: Array<Record<string, unknown>>;
        }
      ).domainProjections;

      for (const [index, scenario] of scenarios.entries()) {
        expect(domainProjections).toContainEqual(
          expect.objectContaining({
            ...scenario.projection,
            operationRecordId: receipts[index].receiptId,
          }),
        );
      }
      expectNoLocalOrSecretValues(domainProjections, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("projects grading review saves into a gradebook update domain object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-domain-gradebook-"));

    try {
      const receipt = await executeTeachingOperationAction({
        dataDir,
        operationId: "grading",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        actorId: "teacher-kang",
        sourceAction: "manage",
        now: new Date("2026-06-22T10:18:00.000Z"),
      });
      const database = await readTeachingOperationDatabase({ dataDir });
      const domainProjections = (
        database as unknown as {
          domainProjections?: Array<Record<string, unknown>>;
        }
      ).domainProjections;

      expect(receipt.artifacts).toContainEqual(
        expect.objectContaining({
          kind: "domain-object",
          objectType: "gradebook-update",
          objectId: "gradebook-update-teacher-research-methods",
        }),
      );
      expect(domainProjections).toContainEqual(
        expect.objectContaining({
          objectId: "gradebook-update-teacher-research-methods",
          objectType: "gradebook-update",
          courseId: "teacher-research-methods",
          updatedBy: "teacher-kang",
          updateStatus: "pending-release",
          sourceAction: "manage",
          releasePolicy: "teacher-confirmed-grade-release",
          storagePolicy: "domain-projection-teaching-gradebook-update",
          updatedAt: "2026-06-22T10:18:00.000Z",
          operationRecordId: receipt.receiptId,
        }),
      );
      expectNoLocalOrSecretValues(domainProjections, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("projects collaboration invites into an email notification domain object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-domain-email-"));

    try {
      const receipt = await executeTeachingOperationAction({
        dataDir,
        operationId: "admins",
        actionSlot: "secondary",
        courseId: "teacher-research-methods",
        actorId: "teacher-kang",
        sourceAction: "manage",
        now: new Date("2026-06-22T10:22:00.000Z"),
      });
      const database = await readTeachingOperationDatabase({ dataDir });
      const domainProjections = (
        database as unknown as {
          domainProjections?: Array<Record<string, unknown>>;
        }
      ).domainProjections;

      expect(receipt.artifacts).toContainEqual(
        expect.objectContaining({
          kind: "domain-object",
          objectType: "email-notification",
          objectId: "email-notification-teacher-research-methods-collaboration-invite",
        }),
      );
      expect(domainProjections).toContainEqual(
        expect.objectContaining({
          objectId: "email-notification-teacher-research-methods-collaboration-invite",
          objectType: "email-notification",
          courseId: "teacher-research-methods",
          queuedBy: "teacher-kang",
          notificationStatus: "queued",
          deliveryChannel: "collaboration-invite-email",
          outboxId: "collaboration-invite-teacher-kang-20260622-102200",
          sourceAction: "manage",
          deliveryPolicy: "server-outbox-before-smtp-provider",
          storagePolicy: "domain-projection-teaching-email-notification",
          queuedAt: "2026-06-22T10:22:00.000Z",
          operationRecordId: receipt.receiptId,
        }),
      );
      expectNoLocalOrSecretValues(domainProjections, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("lets the owning teacher release a pending gradebook update with audit and notification records", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-gradebook-release-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const gradebookUpdateId = "gradebook-update-teacher-research-methods";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-gradebook-release-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:00:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const postRelease = createTeachingGradebookReleasePostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T10:30:00.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T10:00:00.000Z",
      });
      await executeTeachingOperationAction({
        dataDir,
        operationId: "grading",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        actorId: "teacher-kang",
        sourceAction: "manage",
        now: new Date("2026-06-22T10:18:00.000Z"),
      });

      const response = await postRelease(
        new Request(
          `https://www.uais.top/api/teaching/gradebook-updates/${gradebookUpdateId}/release`,
          {
            method: "POST",
            headers: {
              cookie,
              "x-uais-trace-id": "trace-gradebook-release-1",
              "user-agent": "UAIS release test",
            },
          },
        ),
        {
          params: Promise.resolve({
            objectId: gradebookUpdateId,
          }),
        },
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(response.headers.get("x-uais-trace-id")).toBe("trace-gradebook-release-1");
      expect(body.traceId).toBe("trace-gradebook-release-1");
      expect(body.gradebookUpdate).toMatchObject({
        objectId: gradebookUpdateId,
        objectType: "gradebook-update",
        courseId: "teacher-research-methods",
        updateStatus: "released",
        releasedBy: "teacher-kang",
        releasedAt: "2026-06-22T10:30:00.000Z",
      });
      expect(body.notification).toMatchObject({
        objectId: "grade-release-notification-teacher-research-methods",
        objectType: "grade-release-notification",
        courseId: "teacher-research-methods",
        gradebookUpdateId,
        queuedBy: "teacher-kang",
        notificationStatus: "queued",
        deliveryChannel: "student-grade-release-notification",
        queuedAt: "2026-06-22T10:30:00.000Z",
      });
      expect(body.receipt).toMatchObject({
        action: "release-gradebook-update",
        actorId: "teacher-kang",
        courseId: "teacher-research-methods",
        gradebookUpdateId,
        traceId: "trace-gradebook-release-1",
        status: "persisted",
        responsibleSession: "S12",
      });
      expect(database.domainProjections).toContainEqual(
        expect.objectContaining(body.gradebookUpdate),
      );
      expect(database.domainProjections).toContainEqual(
        expect.objectContaining(body.notification),
      );
      expect(database.auditEvents).toContainEqual(
        expect.objectContaining({
          eventType: "teaching-gradebook-update.released",
          actorId: "teacher-kang",
          courseId: "teacher-research-methods",
          gradebookUpdateId,
          traceId: "trace-gradebook-release-1",
        }),
      );
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed gradebook release actor ids before release writes", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-gradebook-release-unsafe-actor-id-"),
    );
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const gradebookUpdateId = "gradebook-update-teacher-research-methods";
    const unsafeActorId = "/Users/example/secret-token-gradebook-release-teacher";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-gradebook-release-unsafe-actor-session",
        actorId: unsafeActorId,
        role: "teacher",
        authenticatedAt: "2026-06-22T10:00:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const postRelease = createTeachingGradebookReleasePostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T10:31:00.000Z"),
    });

    try {
      await executeTeachingOperationAction({
        dataDir,
        operationId: "grading",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        actorId: "teacher-kang",
        sourceAction: "manage",
        now: new Date("2026-06-22T10:18:00.000Z"),
      });

      const response = await postRelease(
        new Request(
          `https://www.uais.top/api/teaching/gradebook-updates/${gradebookUpdateId}/release`,
          {
            method: "POST",
            headers: {
              cookie,
              "x-uais-trace-id": "trace-gradebook-release-unsafe-actor-id",
              "user-agent": "UAIS gradebook release unsafe actor test",
            },
          },
        ),
        {
          params: Promise.resolve({
            objectId: gradebookUpdateId,
          }),
        },
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-gradebook-release-unsafe-actor-id",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-gradebook-release-unsafe-actor-id",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain(
        "/Users/example/secret-token-gradebook-release-teacher",
      );
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(database.domainProjections).toContainEqual(
        expect.objectContaining({
          objectId: gradebookUpdateId,
          updateStatus: "pending-release",
        }),
      );
      expect(database.domainProjections).not.toContainEqual(
        expect.objectContaining({
          objectId: gradebookUpdateId,
          updateStatus: "released",
        }),
      );
      expect(database.auditEvents).not.toContainEqual(
        expect.objectContaining({
          eventType: "teaching-gradebook-update.released",
        }),
      );
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed gradebook release session ids before release writes", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-gradebook-release-unsafe-session-id-"),
    );
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const gradebookUpdateId = "gradebook-update-teacher-research-methods";
    const unsafeSessionId = "/Users/example/secret-token-gradebook-release-session";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: unsafeSessionId,
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:00:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const postRelease = createTeachingGradebookReleasePostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T10:31:30.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T10:00:00.000Z",
      });
      await executeTeachingOperationAction({
        dataDir,
        operationId: "grading",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        actorId: "teacher-kang",
        sourceAction: "manage",
        now: new Date("2026-06-22T10:18:00.000Z"),
      });

      const response = await postRelease(
        new Request(
          `https://www.uais.top/api/teaching/gradebook-updates/${gradebookUpdateId}/release`,
          {
            method: "POST",
            headers: {
              cookie,
              "x-uais-trace-id": "trace-gradebook-release-unsafe-session-id",
              "user-agent": "UAIS gradebook release unsafe session test",
            },
          },
        ),
        {
          params: Promise.resolve({
            objectId: gradebookUpdateId,
          }),
        },
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-gradebook-release-unsafe-session-id",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-gradebook-release-unsafe-session-id",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain(
        "/Users/example/secret-token-gradebook-release-session",
      );
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(database.domainProjections).toContainEqual(
        expect.objectContaining({
          objectId: gradebookUpdateId,
          updateStatus: "pending-release",
        }),
      );
      expect(database.domainProjections).not.toContainEqual(
        expect.objectContaining({
          objectId: gradebookUpdateId,
          updateStatus: "released",
        }),
      );
      expect(database.auditEvents).not.toContainEqual(
        expect.objectContaining({
          eventType: "teaching-gradebook-update.released",
        }),
      );
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("syncs gradebook releases through a configured external gradebook provider before persisting release state", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-gradebook-provider-release-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const gradebookUpdateId = "gradebook-update-teacher-research-methods";
    const gradebookProviderToken = "secret-gradebook-provider-token-32";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-gradebook-provider-release-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:00:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const providerRequests: Array<{
      url: string;
      authorization: string | null;
      method?: string;
      body?: unknown;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const requestBody =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      providerRequests.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        method: init?.method ?? "GET",
        ...(requestBody ? { body: requestBody } : {}),
      });
      return Response.json({
        status: "released",
        releaseId: "gradebook-provider-release-20260622",
        provider: "external-gradebook",
      });
    };
    const postRelease = createTeachingGradebookReleasePostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_GRADEBOOK_RELEASE_PROVIDER: "external",
        UAIS_GRADEBOOK_RELEASE_PROVIDER_URL:
          "https://gradebook-provider.example.test/releases",
        UAIS_GRADEBOOK_RELEASE_PROVIDER_TOKEN: gradebookProviderToken,
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T10:30:00.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T10:00:00.000Z",
      });
      await executeTeachingOperationAction({
        dataDir,
        operationId: "grading",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        actorId: "teacher-kang",
        sourceAction: "manage",
        now: new Date("2026-06-22T10:18:00.000Z"),
      });

      const response = await postRelease(
        new Request(
          `https://www.uais.top/api/teaching/gradebook-updates/${gradebookUpdateId}/release`,
          {
            method: "POST",
            headers: {
              cookie,
              "x-uais-trace-id": "trace-gradebook-provider-release",
              "user-agent": "UAIS gradebook provider release test",
            },
          },
        ),
        {
          params: Promise.resolve({
            objectId: gradebookUpdateId,
          }),
        },
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(providerRequests).toEqual([
        expect.objectContaining({
          url: "https://gradebook-provider.example.test/releases",
          authorization: `Bearer ${gradebookProviderToken}`,
          method: "POST",
          body: expect.objectContaining({
            action: "release-gradebook-update",
            actorId: "teacher-kang",
            courseId: "teacher-research-methods",
            gradebookUpdateId,
            traceId: "trace-gradebook-provider-release",
            releasePolicy: "teacher-confirmed-grade-release",
            gradebookUpdate: expect.objectContaining({
              objectId: gradebookUpdateId,
              objectType: "gradebook-update",
              updateStatus: "pending-release",
            }),
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        }),
      ]);
      expect(body.gradebookUpdate).toMatchObject({
        objectId: gradebookUpdateId,
        objectType: "gradebook-update",
        courseId: "teacher-research-methods",
        updateStatus: "released",
        providerStatus: "gradebook-provider-released",
        providerReleaseId: "gradebook-provider-release-20260622",
        providerReleasedAt: "2026-06-22T10:30:00.000Z",
      });
      expect(body.receipt).toMatchObject({
        action: "release-gradebook-update",
        actorId: "teacher-kang",
        courseId: "teacher-research-methods",
        gradebookUpdateId,
        traceId: "trace-gradebook-provider-release",
        status: "persisted",
        providerStatus: "gradebook-provider-released",
        providerReleaseId: "gradebook-provider-release-20260622",
      });
      expect(database.domainProjections).toContainEqual(
        expect.objectContaining({
          objectId: gradebookUpdateId,
          providerStatus: "gradebook-provider-released",
          providerReleaseId: "gradebook-provider-release-20260622",
        }),
      );
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
      expect(JSON.stringify(body)).not.toContain(gradebookProviderToken);
      expect(JSON.stringify(body)).not.toContain("gradebook-provider.example.test");
      expect(JSON.stringify(database)).not.toContain(gradebookProviderToken);
      expect(JSON.stringify(database)).not.toContain("gradebook-provider.example.test");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("syncs gradebook release rollbacks through a configured external gradebook provider before persisting rollback state", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-gradebook-provider-rollback-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const gradebookUpdateId = "gradebook-update-teacher-research-methods";
    const gradebookProviderToken = "secret-gradebook-provider-token-32";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-gradebook-provider-rollback-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:00:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const providerRequests: Array<{
      url: string;
      authorization: string | null;
      method?: string;
      body?: unknown;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const requestBody =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      providerRequests.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        method: init?.method ?? "GET",
        ...(requestBody ? { body: requestBody } : {}),
      });
      if (requestBody?.action === "rollback-gradebook-release") {
        return Response.json({
          status: "release-rolled-back",
          rollbackId: "gradebook-provider-rollback-20260622",
          provider: "external-gradebook",
        });
      }
      return Response.json({
        status: "released",
        releaseId: "gradebook-provider-release-before-rollback",
        provider: "external-gradebook",
      });
    };
    const providerEnv = {
      UAIS_GRADEBOOK_RELEASE_PROVIDER: "external",
      UAIS_GRADEBOOK_RELEASE_PROVIDER_URL:
        "https://gradebook-provider.example.test/releases",
      UAIS_GRADEBOOK_RELEASE_PROVIDER_TOKEN: gradebookProviderToken,
    };
    const releaseGradebook = createTeachingGradebookReleasePostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        ...providerEnv,
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T10:30:00.000Z"),
    });
    const rollbackRelease = createTeachingGradebookReleaseRollbackPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        ...providerEnv,
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T10:45:00.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T10:00:00.000Z",
      });
      await executeTeachingOperationAction({
        dataDir,
        operationId: "grading",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        actorId: "teacher-kang",
        sourceAction: "manage",
        now: new Date("2026-06-22T10:18:00.000Z"),
      });

      const releaseResponse = await releaseGradebook(
        new Request(
          `https://www.uais.top/api/teaching/gradebook-updates/${gradebookUpdateId}/release`,
          {
            method: "POST",
            headers: {
              cookie,
              "x-uais-trace-id": "trace-gradebook-provider-release-before-rollback",
              "user-agent": "UAIS gradebook provider rollback setup",
            },
          },
        ),
        {
          params: Promise.resolve({
            objectId: gradebookUpdateId,
          }),
        },
      );
      expect(releaseResponse.status).toBe(200);

      const rollbackResponse = await rollbackRelease(
        new Request(
          `https://www.uais.top/api/teaching/gradebook-updates/${gradebookUpdateId}/rollback`,
          {
            method: "POST",
            headers: {
              cookie,
              "x-uais-trace-id": "trace-gradebook-provider-rollback",
              "user-agent": "UAIS gradebook provider rollback test",
            },
          },
        ),
        {
          params: Promise.resolve({
            objectId: gradebookUpdateId,
          }),
        },
      );
      const body = await rollbackResponse.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(rollbackResponse.status, JSON.stringify(body)).toBe(200);
      expect(providerRequests).toEqual([
        expect.objectContaining({
          url: "https://gradebook-provider.example.test/releases",
          authorization: `Bearer ${gradebookProviderToken}`,
          method: "POST",
          body: expect.objectContaining({
            action: "release-gradebook-update",
            traceId: "trace-gradebook-provider-release-before-rollback",
          }),
        }),
        expect.objectContaining({
          url: "https://gradebook-provider.example.test/releases",
          authorization: `Bearer ${gradebookProviderToken}`,
          method: "POST",
          body: expect.objectContaining({
            action: "rollback-gradebook-release",
            actorId: "teacher-kang",
            courseId: "teacher-research-methods",
            gradebookUpdateId,
            providerReleaseId: "gradebook-provider-release-before-rollback",
            traceId: "trace-gradebook-provider-rollback",
            rollbackPolicy: "teacher-confirmed-grade-release-rollback",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        }),
      ]);
      expect(body.gradebookUpdate).toMatchObject({
        objectId: gradebookUpdateId,
        updateStatus: "release-rolled-back",
        providerRollbackStatus: "gradebook-provider-release-rolled-back",
        providerRollbackId: "gradebook-provider-rollback-20260622",
        providerRolledBackAt: "2026-06-22T10:45:00.000Z",
      });
      expect(body.receipt).toMatchObject({
        action: "rollback-gradebook-release",
        traceId: "trace-gradebook-provider-rollback",
        providerRollbackStatus: "gradebook-provider-release-rolled-back",
        providerRollbackId: "gradebook-provider-rollback-20260622",
        providerRolledBackAt: "2026-06-22T10:45:00.000Z",
      });
      expect(database.domainProjections).toContainEqual(
        expect.objectContaining({
          objectId: gradebookUpdateId,
          providerRollbackStatus: "gradebook-provider-release-rolled-back",
          providerRollbackId: "gradebook-provider-rollback-20260622",
        }),
      );
      expect(JSON.stringify(body)).not.toContain(gradebookProviderToken);
      expect(JSON.stringify(body)).not.toContain("gradebook-provider.example.test");
      expect(JSON.stringify(database)).not.toContain(gradebookProviderToken);
      expect(JSON.stringify(database)).not.toContain("gradebook-provider.example.test");
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed for production gradebook release when external teaching operations storage is not selected", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-gradebook-release-prod-block-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const gradebookUpdateId = "gradebook-update-teacher-research-methods";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-gradebook-release-production-block-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:00:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const postRelease = createTeachingGradebookReleasePostHandler({
      env: {
        NODE_ENV: "production",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
      },
      now: new Date("2026-06-22T10:30:00.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T10:00:00.000Z",
      });
      await executeTeachingOperationAction({
        dataDir,
        operationId: "grading",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        actorId: "teacher-kang",
        sourceAction: "manage",
        now: new Date("2026-06-22T10:18:00.000Z"),
      });

      const response = await postRelease(
        new Request(
          `https://www.uais.top/api/teaching/gradebook-updates/${gradebookUpdateId}/release`,
          {
            method: "POST",
            headers: {
              cookie,
              "x-uais-trace-id": "trace-gradebook-release-production-block",
              "user-agent": "UAIS production gradebook release block test",
            },
          },
        ),
        {
          params: Promise.resolve({
            objectId: gradebookUpdateId,
          }),
        },
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(503);
      expect(body).toEqual(
        expect.objectContaining({
          error: "Production teaching gradebook release requires external teaching operations storage.",
          traceId: "trace-gradebook-release-production-block",
        }),
      );
      expect(database.domainProjections).toContainEqual(
        expect.objectContaining({
          objectId: gradebookUpdateId,
          updateStatus: "pending-release",
        }),
      );
      expect(database.domainProjections).not.toContainEqual(
        expect.objectContaining({
          objectId: gradebookUpdateId,
          updateStatus: "released",
        }),
      );
      expect(database.auditEvents).not.toContainEqual(
        expect.objectContaining({
          eventType: "teaching-gradebook-update.released",
        }),
      );
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("blocks production gradebook release before external audit or ownership when teacher auth provider is not production-ready", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-gradebook-release-auth-provider-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const gradebookUpdateId = "gradebook-update-teacher-research-methods";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const externalRequests: string[] = [];
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-gradebook-release-auth-provider-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:00:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const postRelease = createTeachingGradebookReleasePostHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      fetch: async (url) => {
        externalRequests.push(String(url));
        return Response.json({ error: "unexpected external gradebook release request" }, { status: 500 });
      },
      now: new Date("2026-06-22T10:30:00.000Z"),
    });

    try {
      const response = await postRelease(
        new Request(
          `https://www.uais.top/api/teaching/gradebook-updates/${gradebookUpdateId}/release`,
          {
            method: "POST",
            headers: {
              cookie,
              "x-uais-trace-id": "trace-gradebook-release-auth-provider-not-ready",
              "user-agent": "UAIS production gradebook release auth provider not ready",
            },
          },
        ),
        {
          params: Promise.resolve({
            objectId: gradebookUpdateId,
          }),
        },
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(503);
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher auth provider is not production-ready.",
          traceId: "trace-gradebook-release-auth-provider-not-ready",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "teacher-auth-provider-not-production-ready",
            responsibleSession: "S12",
          }),
          authProviderContract: expect.objectContaining({
            productionStatus: "blocked",
            blockedReason: "missing-UAIS_TEACHER_AUTH_PROVIDER",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(externalRequests).toEqual([]);
      expect(await readdir(dataDir)).toEqual([]);
      expect(JSON.stringify(body)).not.toContain(externalToken);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed for production gradebook release when the external gradebook provider is not configured", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-gradebook-provider-prod-block-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const gradebookUpdateId = "gradebook-update-teacher-research-methods";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const pendingGradebookUpdate = {
      objectId: gradebookUpdateId,
      objectType: "gradebook-update",
      courseId: "teacher-research-methods",
      updatedBy: "teacher-kang",
      updateStatus: "pending-release",
      operationRecordId: "grading-save-review-queue-provider-prod-block",
      sourceAction: "route-smoke-gradebook-release",
      releasePolicy: "teacher-confirmed-grade-release",
      updatedAt: "2026-06-22T10:18:00.000Z",
      storagePolicy: "domain-projection-teaching-gradebook-update",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    };
    const externalRequests: Array<{
      url: string;
      method?: string;
      body?: unknown;
    }> = [];
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-gradebook-release-provider-prod-block-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:00:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const fetchImpl: typeof fetch = async (url, init) => {
      const requestBody =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      const method = init?.method ?? "GET";
      externalRequests.push({
        url: String(url),
        method,
        ...(requestBody ? { body: requestBody } : {}),
      });

      if (String(url) === "https://external-storage.example.test/teacher-ai-ownership/teacher-kang") {
        return Response.json({
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        });
      }
      if (String(url) === "https://external-storage.example.test/teaching-operations/teacher-kang/audit") {
        return Response.json({
          teacherId: "teacher-kang",
          records: [],
          auditEvents: [],
          domainProjections: [pendingGradebookUpdate],
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      return Response.json({ error: "unexpected external write" }, { status: 500 });
    };
    const postRelease = createTeachingGradebookReleasePostHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "external",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T10:30:00.000Z"),
    });

    try {
      const response = await postRelease(
        new Request(
          `https://www.uais.top/api/teaching/gradebook-updates/${gradebookUpdateId}/release`,
          {
            method: "POST",
            headers: {
              cookie,
              "x-uais-trace-id": "trace-gradebook-release-provider-prod-block",
              "user-agent": "UAIS production gradebook release provider block test",
            },
          },
        ),
        {
          params: Promise.resolve({
            objectId: gradebookUpdateId,
          }),
        },
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status, JSON.stringify(body)).toBe(503);
      expect(body).toEqual(
        expect.objectContaining({
          error: "Gradebook release provider is not configured.",
          traceId: "trace-gradebook-release-provider-prod-block",
        }),
      );
      expect(externalRequests).toEqual([
        expect.objectContaining({
          url: "https://external-storage.example.test/teaching-operations/teacher-kang/audit",
          method: "GET",
        }),
        expect.objectContaining({
          url: "https://external-storage.example.test/teacher-ai-ownership/teacher-kang",
          method: "GET",
        }),
      ]);
      expect(database.records).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expect(database.domainProjections).toHaveLength(0);
      expect(JSON.stringify(body)).not.toContain(externalToken);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed for production gradebook release before provider mutation when the provider URL is not remote HTTPS", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-gradebook-provider-url-block-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const gradebookUpdateId = "gradebook-update-teacher-research-methods";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const providerToken = "test-gradebook-provider-token-with-32-chars";
    const pendingGradebookUpdate = {
      objectId: gradebookUpdateId,
      objectType: "gradebook-update",
      courseId: "teacher-research-methods",
      updatedBy: "teacher-kang",
      updateStatus: "pending-release",
      operationRecordId: "grading-save-review-queue-provider-url-block",
      sourceAction: "route-smoke-gradebook-release",
      releasePolicy: "teacher-confirmed-grade-release",
      updatedAt: "2026-06-22T10:18:00.000Z",
      storagePolicy: "domain-projection-teaching-gradebook-update",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    };
    const externalRequests: Array<{
      url: string;
      method?: string;
      body?: unknown;
    }> = [];
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-gradebook-release-provider-url-block-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:00:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const fetchImpl: typeof fetch = async (url, init) => {
      const requestBody =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      const method = init?.method ?? "GET";
      externalRequests.push({
        url: String(url),
        method,
        ...(requestBody ? { body: requestBody } : {}),
      });

      if (String(url) === "https://external-storage.example.test/teacher-ai-ownership/teacher-kang") {
        return Response.json({
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        });
      }
      if (String(url) === "https://external-storage.example.test/teaching-operations/teacher-kang/audit") {
        return Response.json({
          teacherId: "teacher-kang",
          records: [],
          auditEvents: [],
          domainProjections: [pendingGradebookUpdate],
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      return Response.json({ error: "unexpected external gradebook release provider write" }, { status: 500 });
    };
    const postRelease = createTeachingGradebookReleasePostHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "external",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
        UAIS_GRADEBOOK_RELEASE_PROVIDER: "external",
        UAIS_GRADEBOOK_RELEASE_PROVIDER_URL: "http://127.0.0.1:4300/gradebook-release",
        UAIS_GRADEBOOK_RELEASE_PROVIDER_TOKEN: providerToken,
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T10:30:00.000Z"),
    });

    try {
      const response = await postRelease(
        new Request(
          `https://www.uais.top/api/teaching/gradebook-updates/${gradebookUpdateId}/release`,
          {
            method: "POST",
            headers: {
              cookie,
              "x-uais-trace-id": "trace-gradebook-release-provider-url-block",
              "user-agent": "UAIS production gradebook release provider URL block test",
            },
          },
        ),
        {
          params: Promise.resolve({
            objectId: gradebookUpdateId,
          }),
        },
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status, JSON.stringify(body)).toBe(503);
      expect(body).toEqual(
        expect.objectContaining({
          error: "Gradebook release provider URL is invalid.",
          traceId: "trace-gradebook-release-provider-url-block",
        }),
      );
      expect(externalRequests).toEqual([
        expect.objectContaining({
          url: "https://external-storage.example.test/teaching-operations/teacher-kang/audit",
          method: "GET",
        }),
        expect.objectContaining({
          url: "https://external-storage.example.test/teacher-ai-ownership/teacher-kang",
          method: "GET",
        }),
      ]);
      expect(database.records).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expect(database.domainProjections).toHaveLength(0);
      expect(JSON.stringify(body)).not.toContain("127.0.0.1");
      expect(JSON.stringify(body)).not.toContain(externalToken);
      expect(JSON.stringify(body)).not.toContain(providerToken);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe gradebook release object ids before external audit reads", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-gradebook-release-unsafe-id-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const unsafeObjectId = "/Users/example/secret-token-gradebook-release-object";
    const externalRequests: Array<{ method?: string; url: string }> = [];
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-gradebook-release-unsafe-object-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-28T01:00:00.000Z",
        expiresAt: "2026-06-28T02:00:00.000Z",
      },
    });
    const postRelease = createTeachingGradebookReleasePostHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      fetch: async (url, init) => {
        externalRequests.push({
          method: init?.method,
          url: String(url),
        });
        return Response.json({
          teacherId: "teacher-kang",
          eventType: "teaching-operation-audit",
          storagePolicy: "external-redacted-teaching-operation-audit-log",
          storageWritePolicy: "external-append-only-audit-log",
          recordCount: 0,
          operationRecordCount: 0,
          auditEventCount: 0,
          domainProjectionCount: 0,
          records: [],
          events: [],
          domainProjections: [],
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      },
      now: new Date("2026-06-28T01:05:00.000Z"),
    });

    try {
      const response = await postRelease(
        new Request(
          `https://www.uais.top/api/teaching/gradebook-updates/${encodeURIComponent(
            unsafeObjectId,
          )}/release`,
          {
            method: "POST",
            headers: {
              cookie,
              "x-uais-trace-id": "trace-unsafe-gradebook-release-object",
              "user-agent": "UAIS unsafe gradebook release object test",
            },
          },
        ),
        {
          params: Promise.resolve({
            objectId: unsafeObjectId,
          }),
        },
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teaching gradebook update id is invalid.",
          traceId: "trace-unsafe-gradebook-release-object",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      );
      expect(JSON.stringify(body)).not.toContain(unsafeObjectId);
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(JSON.stringify(body)).not.toContain(externalToken);
      expect(externalRequests).toEqual([]);
      expect(await readdir(dataDir)).toEqual([]);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects signed-student gradebook release before touching teaching-operation storage", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-gradebook-release-student-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const appSessionSecret = "test-app-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const gradebookUpdateId = "gradebook-update-teacher-research-methods";
    const studentCookie = createUaisAppSessionCookie(
      {
        account: "Peter",
        department: "学生账号",
        displayName: "Peter",
        role: "student",
      },
      {
        secret: appSessionSecret,
        sessionId: "student-gradebook-release-session",
        now: new Date("2026-06-22T10:45:00.000Z"),
      },
    );
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-mixed-gradebook-release-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:45:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const externalRequests: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      externalRequests.push(String(url));
      return new Response("{}", { status: 500 });
    };
    const postRelease = createTeachingGradebookReleasePostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T10:45:00.000Z"),
    });

    try {
      for (const [cookie, traceId] of [
        [studentCookie, "trace-student-gradebook-release-denied-001"],
        [
          `${studentCookie}; ${teacherCookie}`,
          "trace-mixed-student-gradebook-release-denied-001",
        ],
      ] as const) {
        const response = await postRelease(
          new Request(
            `https://www.uais.top/api/teaching/gradebook-updates/${gradebookUpdateId}/release`,
            {
              method: "POST",
              headers: {
                cookie,
                "x-uais-trace-id": traceId,
                "user-agent": "UAIS student gradebook release test",
              },
            },
          ),
          {
            params: Promise.resolve({
              objectId: gradebookUpdateId,
            }),
          },
        );
        const body = await response.json();

        expect(response.status).toBe(403);
        expect(response.headers.get("x-uais-trace-id")).toBe(traceId);
        expect(body.traceId).toBe(traceId);
        expect(body.access).toEqual(
          expect.objectContaining({
            status: "denied",
            reasonCode: "teacher-role-required",
            responsibleSession: "S12",
          }),
        );
        expect(JSON.stringify(body)).not.toContain(externalToken);
        expectNoLocalOrSecretValues(body, dataDir);
      }
      expect(externalRequests).toEqual([]);
      expect(await readdir(dataDir)).toEqual([]);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed student account ids before gradebook release role checks", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-gradebook-release-unsafe-student-id-"),
    );
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const appSessionSecret = "test-app-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const unsafeStudentId = "/Users/example/secret-token-gradebook-release-student";
    const gradebookUpdateId = "gradebook-update-teacher-research-methods";
    const studentCookie = createUaisAppSessionCookie(
      {
        account: unsafeStudentId,
        department: "学生账号",
        displayName: "Unsafe Student",
        role: "student",
      },
      {
        secret: appSessionSecret,
        sessionId: "unsafe-student-gradebook-release-session",
        now: new Date("2026-06-22T10:45:00.000Z"),
      },
    );
    const externalRequests: string[] = [];
    const postRelease = createTeachingGradebookReleasePostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      fetch: async (url) => {
        externalRequests.push(String(url));
        return new Response("{}", { status: 500 });
      },
      now: new Date("2026-06-22T10:45:00.000Z"),
    });

    try {
      const response = await postRelease(
        new Request(
          `https://www.uais.top/api/teaching/gradebook-updates/${gradebookUpdateId}/release`,
          {
            method: "POST",
            headers: {
              cookie: studentCookie,
              "x-uais-trace-id": "trace-unsafe-student-gradebook-release-denied",
              "user-agent": "UAIS unsafe student gradebook release test",
            },
          },
        ),
        {
          params: Promise.resolve({
            objectId: gradebookUpdateId,
          }),
        },
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-unsafe-student-gradebook-release-denied",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-unsafe-student-gradebook-release-denied",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain(unsafeStudentId);
      expect(JSON.stringify(body)).not.toContain(externalToken);
      expectNoLocalOrSecretValues(body, dataDir);
      expect(externalRequests).toEqual([]);
      expect(await readdir(dataDir)).toEqual([]);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("lets the owning teacher roll back a released gradebook update with audit and notification records", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-gradebook-rollback-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const gradebookUpdateId = "gradebook-update-teacher-research-methods";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-gradebook-rollback-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:00:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const releaseGradebook = createTeachingGradebookReleasePostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T10:30:00.000Z"),
    });
    const rollbackRelease = createTeachingGradebookReleaseRollbackPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T10:45:00.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T10:00:00.000Z",
      });
      await executeTeachingOperationAction({
        dataDir,
        operationId: "grading",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        actorId: "teacher-kang",
        sourceAction: "manage",
        now: new Date("2026-06-22T10:18:00.000Z"),
      });
      await releaseGradebook(
        new Request(
          `https://www.uais.top/api/teaching/gradebook-updates/${gradebookUpdateId}/release`,
          {
            method: "POST",
            headers: {
              cookie,
              "x-uais-trace-id": "trace-gradebook-release-before-rollback",
              "user-agent": "UAIS rollback test",
            },
          },
        ),
        {
          params: Promise.resolve({
            objectId: gradebookUpdateId,
          }),
        },
      );

      const response = await rollbackRelease(
        new Request(
          `https://www.uais.top/api/teaching/gradebook-updates/${gradebookUpdateId}/rollback`,
          {
            method: "POST",
            headers: {
              cookie,
              "x-uais-trace-id": "trace-gradebook-rollback-1",
              "user-agent": "UAIS rollback test",
            },
          },
        ),
        {
          params: Promise.resolve({
            objectId: gradebookUpdateId,
          }),
        },
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(response.headers.get("x-uais-trace-id")).toBe("trace-gradebook-rollback-1");
      expect(body.traceId).toBe("trace-gradebook-rollback-1");
      expect(body.gradebookUpdate).toMatchObject({
        objectId: gradebookUpdateId,
        objectType: "gradebook-update",
        courseId: "teacher-research-methods",
        updateStatus: "release-rolled-back",
        releaseRolledBackBy: "teacher-kang",
        releaseRolledBackAt: "2026-06-22T10:45:00.000Z",
        releasedAt: "2026-06-22T10:30:00.000Z",
      });
      expect(body.notification).toMatchObject({
        objectId: "grade-release-rollback-notification-teacher-research-methods",
        objectType: "grade-release-rollback-notification",
        courseId: "teacher-research-methods",
        gradebookUpdateId,
        queuedBy: "teacher-kang",
        notificationStatus: "queued",
        deliveryChannel: "student-grade-release-rollback-notification",
        queuedAt: "2026-06-22T10:45:00.000Z",
      });
      expect(body.receipt).toMatchObject({
        action: "rollback-gradebook-release",
        actorId: "teacher-kang",
        courseId: "teacher-research-methods",
        gradebookUpdateId,
        traceId: "trace-gradebook-rollback-1",
        status: "persisted",
        responsibleSession: "S12",
      });
      expect(database.domainProjections).toContainEqual(
        expect.objectContaining(body.gradebookUpdate),
      );
      expect(database.domainProjections).toContainEqual(
        expect.objectContaining(body.notification),
      );
      expect(database.auditEvents).toContainEqual(
        expect.objectContaining({
          eventType: "teaching-gradebook-update.release-rolled-back",
          actorId: "teacher-kang",
          courseId: "teacher-research-methods",
          gradebookUpdateId,
          traceId: "trace-gradebook-rollback-1",
        }),
      );
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed gradebook rollback actor ids before rollback writes", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-gradebook-rollback-unsafe-actor-id-"),
    );
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const gradebookUpdateId = "gradebook-update-teacher-research-methods";
    const safeCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-gradebook-rollback-setup-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:00:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const unsafeActorId = "/Users/example/secret-token-gradebook-rollback-teacher";
    const unsafeCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-gradebook-rollback-unsafe-actor-session",
        actorId: unsafeActorId,
        role: "teacher",
        authenticatedAt: "2026-06-22T10:00:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const releaseGradebook = createTeachingGradebookReleasePostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T10:30:00.000Z"),
    });
    const rollbackRelease = createTeachingGradebookReleaseRollbackPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T10:46:00.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T10:00:00.000Z",
      });
      await executeTeachingOperationAction({
        dataDir,
        operationId: "grading",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        actorId: "teacher-kang",
        sourceAction: "manage",
        now: new Date("2026-06-22T10:18:00.000Z"),
      });
      const releaseResponse = await releaseGradebook(
        new Request(
          `https://www.uais.top/api/teaching/gradebook-updates/${gradebookUpdateId}/release`,
          {
            method: "POST",
            headers: {
              cookie: safeCookie,
              "x-uais-trace-id": "trace-gradebook-release-before-unsafe-rollback-actor",
              "user-agent": "UAIS unsafe rollback actor setup",
            },
          },
        ),
        {
          params: Promise.resolve({
            objectId: gradebookUpdateId,
          }),
        },
      );
      expect(releaseResponse.status).toBe(200);

      const response = await rollbackRelease(
        new Request(
          `https://www.uais.top/api/teaching/gradebook-updates/${gradebookUpdateId}/rollback`,
          {
            method: "POST",
            headers: {
              cookie: unsafeCookie,
              "x-uais-trace-id": "trace-gradebook-rollback-unsafe-actor-id",
              "user-agent": "UAIS gradebook rollback unsafe actor test",
            },
          },
        ),
        {
          params: Promise.resolve({
            objectId: gradebookUpdateId,
          }),
        },
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-gradebook-rollback-unsafe-actor-id",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-gradebook-rollback-unsafe-actor-id",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain(
        "/Users/example/secret-token-gradebook-rollback-teacher",
      );
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(database.domainProjections).toContainEqual(
        expect.objectContaining({
          objectId: gradebookUpdateId,
          updateStatus: "released",
        }),
      );
      expect(database.domainProjections).not.toContainEqual(
        expect.objectContaining({
          objectId: gradebookUpdateId,
          updateStatus: "release-rolled-back",
        }),
      );
      expect(database.auditEvents).not.toContainEqual(
        expect.objectContaining({
          eventType: "teaching-gradebook-update.release-rolled-back",
        }),
      );
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed gradebook rollback session ids before rollback writes", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-gradebook-rollback-unsafe-session-id-"),
    );
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const gradebookUpdateId = "gradebook-update-teacher-research-methods";
    const safeCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-gradebook-rollback-setup-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:00:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const unsafeSessionId = "/Users/example/secret-token-gradebook-rollback-session";
    const unsafeCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: unsafeSessionId,
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:00:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const releaseGradebook = createTeachingGradebookReleasePostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T10:30:00.000Z"),
    });
    const rollbackRelease = createTeachingGradebookReleaseRollbackPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T10:46:30.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T10:00:00.000Z",
      });
      await executeTeachingOperationAction({
        dataDir,
        operationId: "grading",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        actorId: "teacher-kang",
        sourceAction: "manage",
        now: new Date("2026-06-22T10:18:00.000Z"),
      });
      const releaseResponse = await releaseGradebook(
        new Request(
          `https://www.uais.top/api/teaching/gradebook-updates/${gradebookUpdateId}/release`,
          {
            method: "POST",
            headers: {
              cookie: safeCookie,
              "x-uais-trace-id": "trace-gradebook-release-before-unsafe-rollback-session",
              "user-agent": "UAIS unsafe rollback session setup",
            },
          },
        ),
        {
          params: Promise.resolve({
            objectId: gradebookUpdateId,
          }),
        },
      );
      expect(releaseResponse.status).toBe(200);

      const response = await rollbackRelease(
        new Request(
          `https://www.uais.top/api/teaching/gradebook-updates/${gradebookUpdateId}/rollback`,
          {
            method: "POST",
            headers: {
              cookie: unsafeCookie,
              "x-uais-trace-id": "trace-gradebook-rollback-unsafe-session-id",
              "user-agent": "UAIS gradebook rollback unsafe session test",
            },
          },
        ),
        {
          params: Promise.resolve({
            objectId: gradebookUpdateId,
          }),
        },
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-gradebook-rollback-unsafe-session-id",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-gradebook-rollback-unsafe-session-id",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain(
        "/Users/example/secret-token-gradebook-rollback-session",
      );
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(database.domainProjections).toContainEqual(
        expect.objectContaining({
          objectId: gradebookUpdateId,
          updateStatus: "released",
        }),
      );
      expect(database.domainProjections).not.toContainEqual(
        expect.objectContaining({
          objectId: gradebookUpdateId,
          updateStatus: "release-rolled-back",
        }),
      );
      expect(database.auditEvents).not.toContainEqual(
        expect.objectContaining({
          eventType: "teaching-gradebook-update.release-rolled-back",
        }),
      );
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed for production gradebook release rollback when external teaching operations storage is not selected", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-gradebook-rollback-prod-block-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const gradebookUpdateId = "gradebook-update-teacher-research-methods";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-gradebook-rollback-production-block-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:00:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const releaseGradebook = createTeachingGradebookReleasePostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T10:30:00.000Z"),
    });
    const rollbackRelease = createTeachingGradebookReleaseRollbackPostHandler({
      env: {
        NODE_ENV: "production",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
      },
      now: new Date("2026-06-22T10:45:00.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T10:00:00.000Z",
      });
      await executeTeachingOperationAction({
        dataDir,
        operationId: "grading",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        actorId: "teacher-kang",
        sourceAction: "manage",
        now: new Date("2026-06-22T10:18:00.000Z"),
      });
      await releaseGradebook(
        new Request(
          `https://www.uais.top/api/teaching/gradebook-updates/${gradebookUpdateId}/release`,
          {
            method: "POST",
            headers: {
              cookie,
              "x-uais-trace-id": "trace-gradebook-release-before-production-rollback-block",
              "user-agent": "UAIS production rollback block setup",
            },
          },
        ),
        {
          params: Promise.resolve({
            objectId: gradebookUpdateId,
          }),
        },
      );

      const response = await rollbackRelease(
        new Request(
          `https://www.uais.top/api/teaching/gradebook-updates/${gradebookUpdateId}/rollback`,
          {
            method: "POST",
            headers: {
              cookie,
              "x-uais-trace-id": "trace-gradebook-rollback-production-block",
              "user-agent": "UAIS production gradebook rollback block test",
            },
          },
        ),
        {
          params: Promise.resolve({
            objectId: gradebookUpdateId,
          }),
        },
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(503);
      expect(body).toEqual(
        expect.objectContaining({
          error:
            "Production teaching gradebook release rollback requires external teaching operations storage.",
          traceId: "trace-gradebook-rollback-production-block",
        }),
      );
      expect(database.domainProjections).toContainEqual(
        expect.objectContaining({
          objectId: gradebookUpdateId,
          updateStatus: "released",
        }),
      );
      expect(database.domainProjections).not.toContainEqual(
        expect.objectContaining({
          objectId: gradebookUpdateId,
          updateStatus: "release-rolled-back",
        }),
      );
      expect(database.auditEvents).not.toContainEqual(
        expect.objectContaining({
          eventType: "teaching-gradebook-update.release-rolled-back",
        }),
      );
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("blocks production gradebook release rollback before external audit or ownership when teacher auth provider is not production-ready", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-gradebook-rollback-auth-provider-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const gradebookUpdateId = "gradebook-update-teacher-research-methods";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const externalRequests: string[] = [];
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-gradebook-rollback-auth-provider-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:00:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const postRollback = createTeachingGradebookReleaseRollbackPostHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      fetch: async (url) => {
        externalRequests.push(String(url));
        return Response.json({ error: "unexpected external gradebook rollback request" }, { status: 500 });
      },
      now: new Date("2026-06-22T10:45:00.000Z"),
    });

    try {
      const response = await postRollback(
        new Request(
          `https://www.uais.top/api/teaching/gradebook-updates/${gradebookUpdateId}/rollback`,
          {
            method: "POST",
            headers: {
              cookie,
              "x-uais-trace-id": "trace-gradebook-rollback-auth-provider-not-ready",
              "user-agent": "UAIS production gradebook rollback auth provider not ready",
            },
          },
        ),
        {
          params: Promise.resolve({
            objectId: gradebookUpdateId,
          }),
        },
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(503);
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher auth provider is not production-ready.",
          traceId: "trace-gradebook-rollback-auth-provider-not-ready",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "teacher-auth-provider-not-production-ready",
            responsibleSession: "S12",
          }),
          authProviderContract: expect.objectContaining({
            productionStatus: "blocked",
            blockedReason: "missing-UAIS_TEACHER_AUTH_PROVIDER",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(externalRequests).toEqual([]);
      expect(await readdir(dataDir)).toEqual([]);
      expect(JSON.stringify(body)).not.toContain(externalToken);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed for production gradebook release rollback when the external gradebook provider is not configured", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-gradebook-rollback-provider-block-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const gradebookUpdateId = "gradebook-update-teacher-research-methods";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const releasedGradebookUpdate = {
      objectId: gradebookUpdateId,
      objectType: "gradebook-update",
      courseId: "teacher-research-methods",
      updatedBy: "teacher-kang",
      updateStatus: "released",
      operationRecordId: "grading-save-review-queue-rollback-provider-block",
      sourceAction: "route-smoke-gradebook-release",
      releasePolicy: "teacher-confirmed-grade-release",
      updatedAt: "2026-06-22T10:18:00.000Z",
      releasedBy: "teacher-kang",
      releasedAt: "2026-06-22T10:30:00.000Z",
      providerStatus: "gradebook-provider-released",
      providerReleaseId: "gradebook-provider-release-for-rollback-block",
      providerReleasedAt: "2026-06-22T10:30:00.000Z",
      storagePolicy: "domain-projection-teaching-gradebook-update",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    };
    const externalRequests: Array<{
      url: string;
      method?: string;
      body?: unknown;
    }> = [];
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-gradebook-rollback-provider-prod-block-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:00:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const fetchImpl: typeof fetch = async (url, init) => {
      const requestBody =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      const method = init?.method ?? "GET";
      externalRequests.push({
        url: String(url),
        method,
        ...(requestBody ? { body: requestBody } : {}),
      });

      if (String(url) === "https://external-storage.example.test/teacher-ai-ownership/teacher-kang") {
        return Response.json({
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        });
      }
      if (String(url) === "https://external-storage.example.test/teaching-operations/teacher-kang/audit") {
        return Response.json({
          teacherId: "teacher-kang",
          records: [],
          auditEvents: [],
          domainProjections: [releasedGradebookUpdate],
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      return Response.json({ error: "unexpected external rollback write" }, { status: 500 });
    };
    const postRollback = createTeachingGradebookReleaseRollbackPostHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "external",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T10:45:00.000Z"),
    });

    try {
      const response = await postRollback(
        new Request(
          `https://www.uais.top/api/teaching/gradebook-updates/${gradebookUpdateId}/rollback`,
          {
            method: "POST",
            headers: {
              cookie,
              "x-uais-trace-id": "trace-gradebook-rollback-provider-prod-block",
              "user-agent": "UAIS production gradebook rollback provider block test",
            },
          },
        ),
        {
          params: Promise.resolve({
            objectId: gradebookUpdateId,
          }),
        },
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status, JSON.stringify(body)).toBe(503);
      expect(body).toEqual(
        expect.objectContaining({
          error: "Gradebook release rollback provider is not configured.",
          traceId: "trace-gradebook-rollback-provider-prod-block",
        }),
      );
      expect(externalRequests).toEqual([
        expect.objectContaining({
          url: "https://external-storage.example.test/teaching-operations/teacher-kang/audit",
          method: "GET",
        }),
        expect.objectContaining({
          url: "https://external-storage.example.test/teacher-ai-ownership/teacher-kang",
          method: "GET",
        }),
      ]);
      expect(database.records).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expect(database.domainProjections).toHaveLength(0);
      expect(JSON.stringify(body)).not.toContain(externalToken);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed for production gradebook release rollback before provider mutation when the provider URL is not remote HTTPS", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-gradebook-rollback-provider-url-block-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const gradebookUpdateId = "gradebook-update-teacher-research-methods";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const providerToken = "test-gradebook-provider-token-with-32-chars";
    const releasedGradebookUpdate = {
      objectId: gradebookUpdateId,
      objectType: "gradebook-update",
      courseId: "teacher-research-methods",
      updatedBy: "teacher-kang",
      updateStatus: "released",
      operationRecordId: "grading-save-review-queue-rollback-provider-url-block",
      sourceAction: "route-smoke-gradebook-release",
      releasePolicy: "teacher-confirmed-grade-release",
      updatedAt: "2026-06-22T10:18:00.000Z",
      releasedBy: "teacher-kang",
      releasedAt: "2026-06-22T10:30:00.000Z",
      providerStatus: "gradebook-provider-released",
      providerReleaseId: "gradebook-provider-release-for-rollback-url-block",
      providerReleasedAt: "2026-06-22T10:30:00.000Z",
      storagePolicy: "domain-projection-teaching-gradebook-update",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    };
    const externalRequests: Array<{
      url: string;
      method?: string;
      body?: unknown;
    }> = [];
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-gradebook-rollback-provider-url-block-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:00:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const fetchImpl: typeof fetch = async (url, init) => {
      const requestBody =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      const method = init?.method ?? "GET";
      externalRequests.push({
        url: String(url),
        method,
        ...(requestBody ? { body: requestBody } : {}),
      });

      if (String(url) === "https://external-storage.example.test/teacher-ai-ownership/teacher-kang") {
        return Response.json({
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        });
      }
      if (String(url) === "https://external-storage.example.test/teaching-operations/teacher-kang/audit") {
        return Response.json({
          teacherId: "teacher-kang",
          records: [],
          auditEvents: [],
          domainProjections: [releasedGradebookUpdate],
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      return Response.json({ error: "unexpected external gradebook rollback provider write" }, { status: 500 });
    };
    const postRollback = createTeachingGradebookReleaseRollbackPostHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "external",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
        UAIS_GRADEBOOK_RELEASE_PROVIDER: "external",
        UAIS_GRADEBOOK_RELEASE_PROVIDER_URL: "http://127.0.0.1:4300/gradebook-release-rollback",
        UAIS_GRADEBOOK_RELEASE_PROVIDER_TOKEN: providerToken,
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T10:45:00.000Z"),
    });

    try {
      const response = await postRollback(
        new Request(
          `https://www.uais.top/api/teaching/gradebook-updates/${gradebookUpdateId}/rollback`,
          {
            method: "POST",
            headers: {
              cookie,
              "x-uais-trace-id": "trace-gradebook-rollback-provider-url-block",
              "user-agent": "UAIS production gradebook rollback provider URL block test",
            },
          },
        ),
        {
          params: Promise.resolve({
            objectId: gradebookUpdateId,
          }),
        },
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status, JSON.stringify(body)).toBe(503);
      expect(body).toEqual(
        expect.objectContaining({
          error: "Gradebook release rollback provider URL is invalid.",
          traceId: "trace-gradebook-rollback-provider-url-block",
        }),
      );
      expect(externalRequests).toEqual([
        expect.objectContaining({
          url: "https://external-storage.example.test/teaching-operations/teacher-kang/audit",
          method: "GET",
        }),
        expect.objectContaining({
          url: "https://external-storage.example.test/teacher-ai-ownership/teacher-kang",
          method: "GET",
        }),
      ]);
      expect(database.records).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expect(database.domainProjections).toHaveLength(0);
      expect(JSON.stringify(body)).not.toContain("127.0.0.1");
      expect(JSON.stringify(body)).not.toContain(externalToken);
      expect(JSON.stringify(body)).not.toContain(providerToken);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe gradebook rollback object ids before external audit reads", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-gradebook-rollback-unsafe-id-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const unsafeObjectId = "/Users/example/secret-token-gradebook-rollback-object";
    const externalRequests: Array<{ method?: string; url: string }> = [];
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-gradebook-rollback-unsafe-object-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-28T01:10:00.000Z",
        expiresAt: "2026-06-28T02:10:00.000Z",
      },
    });
    const postRollback = createTeachingGradebookReleaseRollbackPostHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      fetch: async (url, init) => {
        externalRequests.push({
          method: init?.method,
          url: String(url),
        });
        return Response.json({
          teacherId: "teacher-kang",
          eventType: "teaching-operation-audit",
          storagePolicy: "external-redacted-teaching-operation-audit-log",
          storageWritePolicy: "external-append-only-audit-log",
          recordCount: 0,
          operationRecordCount: 0,
          auditEventCount: 0,
          domainProjectionCount: 0,
          records: [],
          events: [],
          domainProjections: [],
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      },
      now: new Date("2026-06-28T01:15:00.000Z"),
    });

    try {
      const response = await postRollback(
        new Request(
          `https://www.uais.top/api/teaching/gradebook-updates/${encodeURIComponent(
            unsafeObjectId,
          )}/rollback`,
          {
            method: "POST",
            headers: {
              cookie,
              "x-uais-trace-id": "trace-unsafe-gradebook-rollback-object",
              "user-agent": "UAIS unsafe gradebook rollback object test",
            },
          },
        ),
        {
          params: Promise.resolve({
            objectId: unsafeObjectId,
          }),
        },
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teaching gradebook update id is invalid.",
          traceId: "trace-unsafe-gradebook-rollback-object",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      );
      expect(JSON.stringify(body)).not.toContain(unsafeObjectId);
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(JSON.stringify(body)).not.toContain(externalToken);
      expect(externalRequests).toEqual([]);
      expect(await readdir(dataDir)).toEqual([]);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects signed-student gradebook release rollback before touching teaching-operation storage", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-gradebook-rollback-student-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const appSessionSecret = "test-app-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const gradebookUpdateId = "gradebook-update-teacher-research-methods";
    const studentCookie = createUaisAppSessionCookie(
      {
        account: "Peter",
        department: "学生账号",
        displayName: "Peter",
        role: "student",
      },
      {
        secret: appSessionSecret,
        sessionId: "student-gradebook-rollback-session",
        now: new Date("2026-06-22T10:45:00.000Z"),
      },
    );
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-mixed-gradebook-rollback-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:45:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const externalRequests: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      externalRequests.push(String(url));
      return new Response("{}", { status: 500 });
    };
    const postRollback = createTeachingGradebookReleaseRollbackPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T10:45:00.000Z"),
    });

    try {
      for (const [cookie, traceId] of [
        [studentCookie, "trace-student-gradebook-rollback-denied-001"],
        [
          `${studentCookie}; ${teacherCookie}`,
          "trace-mixed-student-gradebook-rollback-denied-001",
        ],
      ] as const) {
        const response = await postRollback(
          new Request(
            `https://www.uais.top/api/teaching/gradebook-updates/${gradebookUpdateId}/rollback`,
            {
              method: "POST",
              headers: {
                cookie,
                "x-uais-trace-id": traceId,
                "user-agent": "UAIS student gradebook rollback test",
              },
            },
          ),
          {
            params: Promise.resolve({
              objectId: gradebookUpdateId,
            }),
          },
        );
        const body = await response.json();

        expect(response.status).toBe(403);
        expect(response.headers.get("x-uais-trace-id")).toBe(traceId);
        expect(body.traceId).toBe(traceId);
        expect(body.access).toEqual(
          expect.objectContaining({
            status: "denied",
            reasonCode: "teacher-role-required",
            responsibleSession: "S12",
          }),
        );
        expect(JSON.stringify(body)).not.toContain(externalToken);
        expectNoLocalOrSecretValues(body, dataDir);
      }
      expect(externalRequests).toEqual([]);
      expect(await readdir(dataDir)).toEqual([]);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed student account ids before gradebook rollback role checks", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-gradebook-rollback-unsafe-student-id-"),
    );
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const appSessionSecret = "test-app-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const unsafeStudentId = "/Users/example/secret-token-gradebook-rollback-student";
    const gradebookUpdateId = "gradebook-update-teacher-research-methods";
    const studentCookie = createUaisAppSessionCookie(
      {
        account: unsafeStudentId,
        department: "学生账号",
        displayName: "Unsafe Student",
        role: "student",
      },
      {
        secret: appSessionSecret,
        sessionId: "unsafe-student-gradebook-rollback-session",
        now: new Date("2026-06-22T10:45:00.000Z"),
      },
    );
    const externalRequests: string[] = [];
    const postRollback = createTeachingGradebookReleaseRollbackPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      fetch: async (url) => {
        externalRequests.push(String(url));
        return new Response("{}", { status: 500 });
      },
      now: new Date("2026-06-22T10:45:00.000Z"),
    });

    try {
      const response = await postRollback(
        new Request(
          `https://www.uais.top/api/teaching/gradebook-updates/${gradebookUpdateId}/rollback`,
          {
            method: "POST",
            headers: {
              cookie: studentCookie,
              "x-uais-trace-id": "trace-unsafe-student-gradebook-rollback-denied",
              "user-agent": "UAIS unsafe student gradebook rollback test",
            },
          },
        ),
        {
          params: Promise.resolve({
            objectId: gradebookUpdateId,
          }),
        },
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-unsafe-student-gradebook-rollback-denied",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-unsafe-student-gradebook-rollback-denied",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain(unsafeStudentId);
      expect(JSON.stringify(body)).not.toContain(externalToken);
      expectNoLocalOrSecretValues(body, dataDir);
      expect(externalRequests).toEqual([]);
      expect(await readdir(dataDir)).toEqual([]);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("uses external teaching operations storage for gradebook release and rollback without local JSON writes", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-gradebook-external-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const gradebookUpdateId = "gradebook-update-teacher-research-methods";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-gradebook-external-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:00:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const pendingGradebookUpdate = {
      objectId: gradebookUpdateId,
      objectType: "gradebook-update",
      courseId: "teacher-research-methods",
      updatedBy: "teacher-kang",
      updateStatus: "pending-release",
      operationRecordId: "grading-save-review-queue-external-seed",
      sourceAction: "route-smoke-gradebook-release",
      releasePolicy: "teacher-confirmed-grade-release",
      updatedAt: "2026-06-22T10:18:00.000Z",
      storagePolicy: "domain-projection-teaching-gradebook-update",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    };
    const externalAppends: unknown[] = [];
    const externalRequests: Array<{
      url: string;
      authorization: string | null;
      method?: string;
      body?: unknown;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const method = init?.method ?? "GET";
      const requestBody =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      externalRequests.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        method,
        ...(requestBody ? { body: requestBody } : {}),
      });

      if (method === "GET") {
        const appendedRecords = externalAppends
          .map((append) =>
            typeof append === "object" && append !== null && "record" in append
              ? (append as { record?: unknown }).record
              : undefined,
          )
          .filter(Boolean);
        const appendedAuditEvents = externalAppends
          .map((append) =>
            typeof append === "object" && append !== null && "auditEvent" in append
              ? (append as { auditEvent?: unknown }).auditEvent
              : undefined,
          )
          .filter(Boolean);
        const appendedDomainProjections = appendedRecords.flatMap((record) =>
          typeof record === "object" &&
          record !== null &&
          "domainProjections" in record &&
          Array.isArray((record as { domainProjections?: unknown[] }).domainProjections)
            ? (record as { domainProjections: unknown[] }).domainProjections
            : [],
        );

        return Response.json({
          teacherId: "teacher-kang",
          eventType: "teaching-operation-audit",
          storagePolicy: "external-redacted-teaching-operation-audit-log",
          storageWritePolicy: "external-append-only-audit-log",
          recordCount: 1 + appendedRecords.length,
          operationRecordCount: 1 + appendedRecords.length,
          auditEventCount: 1 + appendedAuditEvents.length,
          domainProjectionCount: 1 + appendedDomainProjections.length,
          records: [
            {
              recordId: "grading-save-review-queue-external-seed",
              operationId: "grading",
              actionSlot: "primary",
              actionId: "save-review-queue",
              actorId: "teacher-kang",
              courseId: "teacher-research-methods",
              createdAt: "2026-06-22T10:18:00.000Z",
              status: "persisted",
              storagePolicy: "external-redacted-teaching-operation-append",
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "ids-only",
              },
              artifacts: [],
            },
            ...appendedRecords,
          ],
          events: [
            {
              auditId: "audit-grading-save-review-queue-external-seed",
              traceId: "trace-gradebook-external-seed",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              actorRole: "teacher",
              authMode: "signed-teacher-session",
              operationId: "grading",
              actionSlot: "primary",
              actionId: "save-review-queue",
              courseId: "teacher-research-methods",
              requestSource: {
                userAgent: "vitest external gradebook",
                ipAddress: "redacted",
              },
              createdAt: "2026-06-22T10:18:00.000Z",
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "ids-only",
              },
            },
            ...appendedAuditEvents,
          ],
          domainProjections: [pendingGradebookUpdate, ...appendedDomainProjections],
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      externalAppends.push(requestBody);
      return Response.json({
        teacherId: "teacher-kang",
        receiptId:
          typeof requestBody?.record?.recordId === "string"
            ? requestBody.record.recordId
            : "external-gradebook-record",
        status: "persisted",
        appendSequence: externalAppends.length,
        storagePolicy: "external-redacted-teaching-operation-append",
        storageWritePolicy: "external-append-only-operation-log",
        responsibleSession: "S12",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      });
    };
    const env = {
      UAIS_TEACHING_OPERATIONS_BACKEND: "external",
      UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
      UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
      UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
    };
    const postRelease = createTeachingGradebookReleasePostHandler({
      env,
      fetch: fetchImpl,
      now: new Date("2026-06-22T10:30:00.000Z"),
    });
    const postRollback = createTeachingGradebookReleaseRollbackPostHandler({
      env,
      fetch: fetchImpl,
      now: new Date("2026-06-22T10:45:00.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T10:00:00.000Z",
      });

      const releaseResponse = await postRelease(
        new Request(
          `https://www.uais.top/api/teaching/gradebook-updates/${gradebookUpdateId}/release`,
          {
            method: "POST",
            headers: {
              cookie,
              "x-uais-trace-id": "trace-gradebook-external-release",
              "user-agent": "UAIS external gradebook release test",
            },
          },
        ),
        {
          params: Promise.resolve({ objectId: gradebookUpdateId }),
        },
      );
      const releaseBody = await releaseResponse.json();

      const rollbackResponse = await postRollback(
        new Request(
          `https://www.uais.top/api/teaching/gradebook-updates/${gradebookUpdateId}/rollback`,
          {
            method: "POST",
            headers: {
              cookie,
              "x-uais-trace-id": "trace-gradebook-external-rollback",
              "user-agent": "UAIS external gradebook rollback test",
            },
          },
        ),
        {
          params: Promise.resolve({ objectId: gradebookUpdateId }),
        },
      );
      const rollbackBody = await rollbackResponse.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(releaseResponse.status, JSON.stringify(releaseBody)).toBe(200);
      expect(releaseResponse.headers.get("x-uais-trace-id")).toBe(
        "trace-gradebook-external-release",
      );
      expect(releaseBody.gradebookUpdate).toMatchObject({
        objectId: gradebookUpdateId,
        courseId: "teacher-research-methods",
        updateStatus: "released",
        releasedBy: "teacher-kang",
      });
      expect(releaseBody.receipt).toMatchObject({
        action: "release-gradebook-update",
        actorId: "teacher-kang",
        courseId: "teacher-research-methods",
        gradebookUpdateId,
        traceId: "trace-gradebook-external-release",
        status: "persisted",
        storagePolicy: "external-redacted-teaching-operation-append",
        storageWritePolicy: "external-append-only-operation-log",
      });

      expect(rollbackResponse.status, JSON.stringify(rollbackBody)).toBe(200);
      expect(rollbackResponse.headers.get("x-uais-trace-id")).toBe(
        "trace-gradebook-external-rollback",
      );
      expect(rollbackBody.gradebookUpdate).toMatchObject({
        objectId: gradebookUpdateId,
        courseId: "teacher-research-methods",
        updateStatus: "release-rolled-back",
        releaseRolledBackBy: "teacher-kang",
      });
      expect(rollbackBody.receipt).toMatchObject({
        action: "rollback-gradebook-release",
        actorId: "teacher-kang",
        courseId: "teacher-research-methods",
        gradebookUpdateId,
        traceId: "trace-gradebook-external-rollback",
        status: "persisted",
        storagePolicy: "external-redacted-teaching-operation-append",
        storageWritePolicy: "external-append-only-operation-log",
      });

      expect(externalRequests).toEqual([
        expect.objectContaining({
          url: "https://external-storage.example.test/teaching-operations/teacher-kang/audit",
          authorization: `Bearer ${externalToken}`,
          method: "GET",
        }),
        expect.objectContaining({
          url: "https://external-storage.example.test/teaching-operations/teacher-kang/append",
          authorization: `Bearer ${externalToken}`,
          method: "POST",
          body: expect.objectContaining({
            action: "append-teaching-operation",
            record: expect.objectContaining({
              actorId: "teacher-kang",
              courseId: "teacher-research-methods",
              status: "persisted",
              storagePolicy: "external-redacted-teaching-operation-append",
              domainProjections: expect.arrayContaining([
                expect.objectContaining({
                  objectId: gradebookUpdateId,
                  updateStatus: "released",
                }),
                expect.objectContaining({
                  objectType: "grade-release-notification",
                  gradebookUpdateId,
                }),
              ]),
            }),
            auditEvent: expect.objectContaining({
              traceId: "trace-gradebook-external-release",
              eventType: "teaching-gradebook-update.released",
              courseId: "teacher-research-methods",
            }),
          }),
        }),
        expect.objectContaining({
          url: "https://external-storage.example.test/teaching-operations/teacher-kang/audit",
          authorization: `Bearer ${externalToken}`,
          method: "GET",
        }),
        expect.objectContaining({
          url: "https://external-storage.example.test/teaching-operations/teacher-kang/append",
          authorization: `Bearer ${externalToken}`,
          method: "POST",
          body: expect.objectContaining({
            action: "append-teaching-operation",
            record: expect.objectContaining({
              actorId: "teacher-kang",
              courseId: "teacher-research-methods",
              status: "persisted",
              storagePolicy: "external-redacted-teaching-operation-append",
              domainProjections: expect.arrayContaining([
                expect.objectContaining({
                  objectId: gradebookUpdateId,
                  updateStatus: "release-rolled-back",
                }),
                expect.objectContaining({
                  objectType: "grade-release-rollback-notification",
                  gradebookUpdateId,
                }),
              ]),
            }),
            auditEvent: expect.objectContaining({
              traceId: "trace-gradebook-external-rollback",
              eventType: "teaching-gradebook-update.release-rolled-back",
              courseId: "teacher-research-methods",
            }),
          }),
        }),
      ]);
      expect(database.records).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expect(database.domainProjections).toHaveLength(0);
      expectNoLocalOrSecretValues(releaseBody, dataDir);
      expectNoLocalOrSecretValues(rollbackBody, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("exposes a POST route that writes one operation and rejects invalid operations safely", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-auth-session-cookie-id",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:00:00.000Z",
        expiresAt: "2026-06-22T11:30:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T10:30:00.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T10:00:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({
            operationId: "admins",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
          }),
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.receipt).toEqual(
        expect.objectContaining({
          operationId: "admins",
          actionSlot: "secondary",
          actionId: "send-collaboration-invite",
          status: "persisted",
        }),
      );
      expect(body.receipt.artifacts).toContainEqual(
        expect.objectContaining({
          kind: "outbox",
          channel: "collaboration-invite",
          deliveryStatus: "sent-to-local-outbox",
        }),
      );

      const databasePath = join(dataDir, "teaching-operations.json");
      expect((await stat(databasePath)).isFile()).toBe(true);

      const invalidResponse = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
            "x-uais-trace-id": "trace-invalid-operation-001",
          },
          body: JSON.stringify({
            operationId: "../secret",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
          }),
        }),
      );
      const invalid = await invalidResponse.json();

      expect(invalidResponse.status).toBe(400);
      expect(invalidResponse.headers.get("x-uais-trace-id")).toBe(
        "trace-invalid-operation-001",
      );
      expect(invalid.traceId).toBe("trace-invalid-operation-001");
      expect(invalid.error).toBe("Unsupported teaching operation.");
      expectNoLocalOrSecretValues(invalid, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("requires a signed teacher auth session before writing an operation", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-auth-"));
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: "test-teacher-auth-session-signing-secret",
      },
      now: new Date("2026-06-22T10:45:00.000Z"),
    });

    try {
      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-auth-denied-001",
          },
          body: JSON.stringify({
            operationId: "course-settings",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            actorId: "teacher-kang",
            sourceAction: "manage",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe("trace-auth-denied-001");
      expect(body.traceId).toBe("trace-auth-denied-001");
      expect(body.access).toEqual(
        expect.objectContaining({
          status: "denied",
          reasonCode: "authenticated-session-required",
          responsibleSession: "S12",
        }),
      );
      expect(database.records).toHaveLength(0);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("requires teacher authentication before parsing an operation request body", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-auth-before-body-"));
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: "test-teacher-auth-session-signing-secret",
      },
      now: new Date("2026-06-22T10:45:00.000Z"),
    });

    try {
      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-auth-before-body-001",
          },
          body: "{",
        }),
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe("trace-auth-before-body-001");
      expect(body.traceId).toBe("trace-auth-before-body-001");
      expect(body.error).toBe("UAIS teacher authentication is required.");
      expect(body.access).toEqual(
        expect.objectContaining({
          status: "denied",
          reasonCode: "authenticated-session-required",
          responsibleSession: "S12",
        }),
      );
      expect(JSON.stringify(body)).not.toContain("Request body must be JSON.");
      expect(database.records).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expect(database.domainProjections).toHaveLength(0);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects signed-student operation writes as role denials before writing records", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-student-role-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const appSessionSecret = "test-app-session-signing-secret";
    const studentCookie = createUaisAppSessionCookie(
      {
        account: "Peter",
        department: "学生账号",
        displayName: "Peter",
        role: "student",
      },
      {
        secret: appSessionSecret,
        sessionId: "student-operation-write-session",
        now: new Date("2026-06-22T10:45:00.000Z"),
      },
    );
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
      },
      now: new Date("2026-06-22T10:45:00.000Z"),
    });

    try {
      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: studentCookie,
            "x-uais-trace-id": "trace-student-operation-denied-001",
          },
          body: JSON.stringify({
            operationId: "course-settings",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(403);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-student-operation-denied-001",
      );
      expect(body.traceId).toBe("trace-student-operation-denied-001");
      expect(body.access).toEqual(
        expect.objectContaining({
          status: "denied",
          reasonCode: "teacher-role-required",
          responsibleSession: "S12",
        }),
      );
      expect(database.records).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expect(database.domainProjections).toHaveLength(0);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed student account ids before operation role checks", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-unsafe-student-id-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const appSessionSecret = "test-app-session-signing-secret";
    const unsafeStudentId = "/Users/example/secret-token-operation-student";
    const studentCookie = createUaisAppSessionCookie(
      {
        account: unsafeStudentId,
        department: "学生账号",
        displayName: "Unsafe Student",
        role: "student",
      },
      {
        secret: appSessionSecret,
        sessionId: "unsafe-student-operation-write-session",
        now: new Date("2026-06-22T10:45:00.000Z"),
      },
    );
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
      },
      now: new Date("2026-06-22T10:45:00.000Z"),
    });

    try {
      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: studentCookie,
            "x-uais-trace-id": "trace-unsafe-student-operation-denied",
          },
          body: "{",
        }),
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status, JSON.stringify(body)).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-unsafe-student-operation-denied",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-unsafe-student-operation-denied",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain(unsafeStudentId);
      expect(JSON.stringify(body)).not.toContain("Request body must be JSON.");
      expect(database.records).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expect(database.domainProjections).toHaveLength(0);
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed student session ids before operation role checks", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-route-unsafe-student-session-id-"),
    );
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const appSessionSecret = "test-app-session-signing-secret";
    const unsafeSessionId = "/Users/example/secret-token-operation-student-session";
    const studentCookie = createUaisAppSessionCookie(
      {
        account: "Peter",
        department: "学生账号",
        displayName: "Peter",
        role: "student",
      },
      {
        secret: appSessionSecret,
        sessionId: unsafeSessionId,
        now: new Date("2026-06-22T10:45:00.000Z"),
      },
    );
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
      },
      now: new Date("2026-06-22T10:45:00.000Z"),
    });

    try {
      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: studentCookie,
            "x-uais-trace-id": "trace-unsafe-student-session-operation-denied",
          },
          body: "{",
        }),
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status, JSON.stringify(body)).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-unsafe-student-session-operation-denied",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-unsafe-student-session-operation-denied",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain(unsafeSessionId);
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(JSON.stringify(body)).not.toContain("Request body must be JSON.");
      expect(database.records).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expect(database.domainProjections).toHaveLength(0);
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects mixed student app-session and teacher-auth cookies before writing records", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-mixed-student-teacher-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const appSessionSecret = "test-app-session-signing-secret";
    const studentCookie = createUaisAppSessionCookie(
      {
        account: "Peter",
        department: "学生账号",
        displayName: "Peter",
        role: "student",
      },
      {
        secret: appSessionSecret,
        sessionId: "student-mixed-operation-write-session",
        now: new Date("2026-06-22T10:45:00.000Z"),
      },
    );
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-mixed-operation-write-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:45:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
      },
      now: new Date("2026-06-22T10:50:00.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T10:45:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: `${studentCookie}; ${teacherCookie}`,
            "x-uais-trace-id": "trace-mixed-student-teacher-denied-001",
          },
          body: JSON.stringify({
            operationId: "course-settings",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(403);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-mixed-student-teacher-denied-001",
      );
      expect(body.traceId).toBe("trace-mixed-student-teacher-denied-001");
      expect(body.access).toEqual(
        expect.objectContaining({
          status: "denied",
          reasonCode: "teacher-role-required",
          responsibleSession: "S12",
        }),
      );
      expect(database.records).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expect(database.domainProjections).toHaveLength(0);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects signed-student audit readback as role denials before exposing records", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-audit-student-role-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const appSessionSecret = "test-app-session-signing-secret";
    const studentCookie = createUaisAppSessionCookie(
      {
        account: "Peter",
        department: "学生账号",
        displayName: "Peter",
        role: "student",
      },
      {
        secret: appSessionSecret,
        sessionId: "student-operation-audit-session",
        now: new Date("2026-06-22T10:45:00.000Z"),
      },
    );
    const getAudit = createTeachingOperationAuditGetHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
      },
      now: new Date("2026-06-22T10:45:00.000Z"),
    });

    try {
      await executeTeachingOperationAction({
        dataDir,
        operationId: "course-settings",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        sourceAction: "inline-teaching-workspace",
        actorId: "teacher-kang",
        audit: {
          traceId: "trace-audit-record-should-not-leak",
          actorRole: "teacher",
          authMode: "signed-teacher-session",
          requestSource: {
            userAgent: "UAIS audit role denial test",
            ipAddress: "redacted",
          },
        },
        now: new Date("2026-06-22T11:05:00.000Z"),
      });

      const response = await getAudit(
        new Request("https://www.uais.top/api/teaching/operations/audit", {
          method: "GET",
          headers: {
            cookie: studentCookie,
            "x-uais-trace-id": "trace-student-audit-denied-001",
          },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-student-audit-denied-001",
      );
      expect(body.traceId).toBe("trace-student-audit-denied-001");
      expect(body.access).toEqual(
        expect.objectContaining({
          status: "denied",
          reasonCode: "teacher-role-required",
          responsibleSession: "S12",
        }),
      );
      expect(JSON.stringify(body)).not.toContain("teacher-research-methods");
      expect(JSON.stringify(body)).not.toContain("trace-audit-record-should-not-leak");
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed student account ids before audit readback role checks", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-audit-unsafe-student-id-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const appSessionSecret = "test-app-session-signing-secret";
    const unsafeStudentId = "/Users/example/secret-token-audit-student";
    const studentCookie = createUaisAppSessionCookie(
      {
        account: unsafeStudentId,
        department: "学生账号",
        displayName: "Unsafe Student",
        role: "student",
      },
      {
        secret: appSessionSecret,
        sessionId: "unsafe-student-operation-audit-session",
        now: new Date("2026-06-22T10:45:00.000Z"),
      },
    );
    const getAudit = createTeachingOperationAuditGetHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
      },
      now: new Date("2026-06-22T10:45:00.000Z"),
    });

    try {
      await executeTeachingOperationAction({
        dataDir,
        operationId: "course-settings",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        sourceAction: "inline-teaching-workspace",
        actorId: "teacher-kang",
        audit: {
          traceId: "trace-unsafe-audit-record-should-not-leak",
          actorRole: "teacher",
          authMode: "signed-teacher-session",
          requestSource: {
            userAgent: "UAIS unsafe audit role denial test",
            ipAddress: "redacted",
          },
        },
        now: new Date("2026-06-22T11:05:00.000Z"),
      });

      const response = await getAudit(
        new Request("https://www.uais.top/api/teaching/operations/audit", {
          method: "GET",
          headers: {
            cookie: studentCookie,
            "x-uais-trace-id": "trace-unsafe-student-audit-denied",
          },
        }),
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-unsafe-student-audit-denied",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-unsafe-student-audit-denied",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain(unsafeStudentId);
      expect(JSON.stringify(body)).not.toContain("teacher-research-methods");
      expect(JSON.stringify(body)).not.toContain("trace-unsafe-audit-record-should-not-leak");
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed student session ids before audit readback role checks", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-audit-unsafe-student-session-id-"),
    );
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const appSessionSecret = "test-app-session-signing-secret";
    const unsafeSessionId = "/Users/example/secret-token-audit-student-session";
    const studentCookie = createUaisAppSessionCookie(
      {
        account: "Peter",
        department: "学生账号",
        displayName: "Peter",
        role: "student",
      },
      {
        secret: appSessionSecret,
        sessionId: unsafeSessionId,
        now: new Date("2026-06-22T10:45:00.000Z"),
      },
    );
    const getAudit = createTeachingOperationAuditGetHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
      },
      now: new Date("2026-06-22T10:45:00.000Z"),
    });

    try {
      await executeTeachingOperationAction({
        dataDir,
        operationId: "course-settings",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        sourceAction: "inline-teaching-workspace",
        actorId: "teacher-kang",
        audit: {
          traceId: "trace-unsafe-session-audit-record-should-not-leak",
          actorRole: "teacher",
          authMode: "signed-teacher-session",
          requestSource: {
            userAgent: "UAIS unsafe audit session role denial test",
            ipAddress: "redacted",
          },
        },
        now: new Date("2026-06-22T11:05:00.000Z"),
      });

      const response = await getAudit(
        new Request("https://www.uais.top/api/teaching/operations/audit", {
          method: "GET",
          headers: {
            cookie: studentCookie,
            "x-uais-trace-id": "trace-unsafe-student-session-audit-denied",
          },
        }),
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-unsafe-student-session-audit-denied",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-unsafe-student-session-audit-denied",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain(unsafeSessionId);
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(JSON.stringify(body)).not.toContain("teacher-research-methods");
      expect(JSON.stringify(body)).not.toContain(
        "trace-unsafe-session-audit-record-should-not-leak",
      );
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects mixed student app-session and teacher-auth cookies before audit readback", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-audit-mixed-student-teacher-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const appSessionSecret = "test-app-session-signing-secret";
    const studentCookie = createUaisAppSessionCookie(
      {
        account: "Peter",
        department: "学生账号",
        displayName: "Peter",
        role: "student",
      },
      {
        secret: appSessionSecret,
        sessionId: "student-mixed-operation-audit-session",
        now: new Date("2026-06-22T10:45:00.000Z"),
      },
    );
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-mixed-operation-audit-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:45:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const getAudit = createTeachingOperationAuditGetHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
      },
      now: new Date("2026-06-22T10:50:00.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T10:45:00.000Z",
      });
      await executeTeachingOperationAction({
        dataDir,
        operationId: "course-settings",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        sourceAction: "inline-teaching-workspace",
        actorId: "teacher-kang",
        audit: {
          traceId: "trace-mixed-audit-record-should-not-leak",
          actorRole: "teacher",
          authMode: "signed-teacher-session",
          requestSource: {
            userAgent: "UAIS mixed audit role denial test",
            ipAddress: "redacted",
          },
        },
        now: new Date("2026-06-22T11:05:00.000Z"),
      });

      const response = await getAudit(
        new Request("https://www.uais.top/api/teaching/operations/audit", {
          method: "GET",
          headers: {
            cookie: `${studentCookie}; ${teacherCookie}`,
            "x-uais-trace-id": "trace-mixed-student-audit-denied-001",
          },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-mixed-student-audit-denied-001",
      );
      expect(body.traceId).toBe("trace-mixed-student-audit-denied-001");
      expect(body.access).toEqual(
        expect.objectContaining({
          status: "denied",
          reasonCode: "teacher-role-required",
          responsibleSession: "S12",
        }),
      );
      expect(JSON.stringify(body)).not.toContain("teacher-research-methods");
      expect(JSON.stringify(body)).not.toContain("trace-mixed-audit-record-should-not-leak");
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed when audit readback course ownership check fails", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-audit-ownership-failure-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-audit-ownership-failure-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:45:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const getAudit = createTeachingOperationAuditGetHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      getTeachingOperationCourseOwnership: async () => {
        throw new Error("audit ownership backend secret-token unavailable");
      },
      now: new Date("2026-06-22T11:12:00.000Z"),
    });

    try {
      await executeTeachingOperationAction({
        dataDir,
        operationId: "course-settings",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        sourceAction: "inline-teaching-workspace",
        actorId: "teacher-kang",
        audit: {
          traceId: "trace-audit-record-should-not-leak-on-ownership-failure",
          actorRole: "teacher",
          authMode: "signed-teacher-session",
          requestSource: {
            userAgent: "UAIS audit ownership failure regression",
            ipAddress: "redacted",
          },
        },
        now: new Date("2026-06-22T11:05:00.000Z"),
      });

      const response = await getAudit(
        new Request("https://www.uais.top/api/teaching/operations/audit", {
          method: "GET",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-audit-ownership-check-failed",
          },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-audit-ownership-check-failed",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teaching operation audit course ownership check failed.",
          traceId: "trace-audit-ownership-check-failed",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "teacher-course-ownership-check-failed",
            actor: { actorId: "teacher-kang", role: "teacher" },
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(JSON.stringify(body)).not.toContain("teacher-research-methods");
      expect(JSON.stringify(body)).not.toContain(
        "trace-audit-record-should-not-leak-on-ownership-failure",
      );
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed audit readback actor ids before ownership checks", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-audit-unsafe-actor-id-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const unsafeActorId = "/Users/example/secret-token-audit-teacher";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-audit-unsafe-actor-session",
        actorId: unsafeActorId,
        role: "teacher",
        authenticatedAt: "2026-06-22T10:45:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    let ownershipCheckCount = 0;
    const getAudit = createTeachingOperationAuditGetHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      getTeachingOperationCourseOwnership: async () => {
        ownershipCheckCount += 1;
        return {
          teacherId: unsafeActorId,
          courseIds: ["teacher-research-methods"],
        };
      },
      now: new Date("2026-06-22T11:13:00.000Z"),
    });

    try {
      const response = await getAudit(
        new Request("https://www.uais.top/api/teaching/operations/audit", {
          method: "GET",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-audit-unsafe-actor-id",
          },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe("trace-audit-unsafe-actor-id");
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-audit-unsafe-actor-id",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain("/Users/example/secret-token-audit-teacher");
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(ownershipCheckCount).toBe(0);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed audit readback session ids before ownership checks", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-audit-unsafe-session-id-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const unsafeSessionId = "/Users/example/secret-token-audit-session";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: unsafeSessionId,
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:45:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    let ownershipCheckCount = 0;
    const getAudit = createTeachingOperationAuditGetHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      getTeachingOperationCourseOwnership: async () => {
        ownershipCheckCount += 1;
        return {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        };
      },
      now: new Date("2026-06-22T11:13:30.000Z"),
    });

    try {
      const response = await getAudit(
        new Request("https://www.uais.top/api/teaching/operations/audit", {
          method: "GET",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-audit-unsafe-session-id",
          },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe("trace-audit-unsafe-session-id");
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-audit-unsafe-session-id",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain("/Users/example/secret-token-audit-session");
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(ownershipCheckCount).toBe(0);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("lets the owning teacher read a redacted teaching operation audit scoped to owned courses", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-operation-audit-readback-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-operation-audit-readback-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:40:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const getAudit = createTeachingOperationAuditGetHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:20:00.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T10:40:00.000Z",
      });
      const ownedReceipt = await executeTeachingOperationAction({
        dataDir,
        operationId: "course-settings",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        sourceAction: "inline-teaching-workspace",
        actorId: "teacher-kang",
        audit: {
          traceId: "trace-owned-teaching-operation-001",
          actorRole: "teacher",
          authMode: "signed-teacher-session",
          requestSource: {
            userAgent: "UAIS audit readback test",
            ipAddress: "redacted",
          },
        },
        now: new Date("2026-06-22T11:05:00.000Z"),
      });
      await executeTeachingOperationAction({
        dataDir,
        operationId: "content",
        actionSlot: "primary",
        courseId: "other-teacher-course",
        sourceAction: "inline-teaching-workspace",
        actorId: "teacher-kang",
        audit: {
          traceId: "trace-unowned-teaching-operation-001",
          actorRole: "teacher",
          authMode: "signed-teacher-session",
          requestSource: {
            userAgent: "UAIS audit readback test",
            ipAddress: "redacted",
          },
        },
        now: new Date("2026-06-22T11:06:00.000Z"),
      });

      const response = await getAudit(
        new Request("https://www.uais.top/api/teaching/operations/audit", {
          method: "GET",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-teaching-operation-audit-readback",
            "user-agent": "UAIS audit readback",
          },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-teaching-operation-audit-readback",
      );
      expect(body).toEqual(
        expect.objectContaining({
          traceId: "trace-teaching-operation-audit-readback",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          storagePolicy: "local-json-teaching-operation-audit-log",
          storageWritePolicy: "read-only-local-json-file",
          responsibleSession: "S12",
        }),
      );
      expect(body.records).toEqual([
        expect.objectContaining({
          recordId: ownedReceipt.receiptId,
          courseId: "teacher-research-methods",
          operationId: "course-settings",
        }),
      ]);
      expect(body.auditEvents).toEqual([
        expect.objectContaining({
          traceId: "trace-owned-teaching-operation-001",
          courseId: "teacher-research-methods",
          actorId: "teacher-kang",
          requestSource: {
            userAgent: "UAIS audit readback test",
            ipAddress: "redacted",
          },
        }),
      ]);
      expect(body.domainProjections).toEqual([
        expect.objectContaining({
          objectId: "course-settings-teacher-research-methods",
          objectType: "course-settings",
          courseId: "teacher-research-methods",
          operationRecordId: ownedReceipt.receiptId,
        }),
      ]);
      expect(JSON.stringify(body)).not.toContain("other-teacher-course");
      expect(JSON.stringify(body)).not.toContain("trace-unowned-teaching-operation-001");
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("blocks production teaching operation audit readback before ownership or external audit when teacher auth provider is not production-ready", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-operation-audit-auth-provider-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-operation-audit-auth-provider-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:40:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    let ownershipCheckCount = 0;
    let externalAuditReadCount = 0;
    const getAudit = createTeachingOperationAuditGetHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      getTeachingOperationCourseOwnership: async () => {
        ownershipCheckCount += 1;
        return {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        };
      },
      readExternalTeachingOperationAudit: async () => {
        externalAuditReadCount += 1;
        return {
          events: [],
          records: [],
          domainProjections: [],
          rollbackRecords: [],
          storagePolicy: "external-redacted-teaching-operation-audit-log",
          storageWritePolicy: "external-append-only-audit-log",
        };
      },
      now: new Date("2026-06-22T11:24:00.000Z"),
    });

    try {
      const response = await getAudit(
        new Request("https://www.uais.top/api/teaching/operations/audit", {
          method: "GET",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-production-audit-auth-provider-not-ready",
            "user-agent": "UAIS production audit auth provider not ready",
          },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-production-audit-auth-provider-not-ready",
      );
      expect(body.error).toBe("UAIS teacher auth provider is not production-ready.");
      expect(body.traceId).toBe("trace-production-audit-auth-provider-not-ready");
      expect(body.access).toEqual(
        expect.objectContaining({
          status: "denied",
          reasonCode: "teacher-auth-provider-not-production-ready",
          responsibleSession: "S12",
        }),
      );
      expect(body.authProviderContract).toEqual(
        expect.objectContaining({
          providerKind: "missing",
          productionStatus: "blocked",
          blockedReason: "missing-UAIS_TEACHER_AUTH_PROVIDER",
          redaction: {
            values: "omitted",
            cookies: "omitted",
          },
        }),
      );
      expect(ownershipCheckCount).toBe(0);
      expect(externalAuditReadCount).toBe(0);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed for production teaching operation audit readback without external storage", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-operation-audit-production-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-operation-audit-production-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:40:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const getAudit = createTeachingOperationAuditGetHandler({
      env: {
        NODE_ENV: "production",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
      },
      getTeachingOperationCourseOwnership: async () => ({
        teacherId: "teacher-kang",
        courseIds: ["teacher-research-methods"],
      }),
      now: new Date("2026-06-22T11:25:00.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T10:40:00.000Z",
      });
      await executeTeachingOperationAction({
        dataDir,
        operationId: "course-settings",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        sourceAction: "inline-teaching-workspace",
        actorId: "teacher-kang",
        audit: {
          traceId: "trace-local-production-audit-should-not-leak",
          actorRole: "teacher",
          authMode: "signed-teacher-session",
          requestSource: {
            userAgent: "UAIS audit production test",
            ipAddress: "redacted",
          },
        },
        now: new Date("2026-06-22T11:05:00.000Z"),
      });

      const response = await getAudit(
        new Request("https://www.uais.top/api/teaching/operations/audit", {
          method: "GET",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-teaching-operation-audit-production",
            "user-agent": "UAIS production audit readback",
          },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-teaching-operation-audit-production",
      );
      expect(body.traceId).toBe("trace-teaching-operation-audit-production");
      expect(body.error).toBe(
        "Production teaching operation audit readback requires external storage.",
      );
      expect(JSON.stringify(body)).not.toContain("trace-local-production-audit-should-not-leak");
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("requires production database adapter evidence on production external audit readback", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-audit-db-evidence-missing-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-audit-db-evidence-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:30:00.000Z",
        expiresAt: "2026-06-22T12:30:00.000Z",
      },
    });
    const fetchImpl: typeof fetch = async () =>
      Response.json({
        teacherId: "teacher-kang",
        eventType: "teaching-operation-audit",
        storagePolicy: "external-redacted-teaching-operation-audit-log",
        storageWritePolicy: "external-append-only-audit-log",
        recordCount: 0,
        operationRecordCount: 0,
        domainProjectionCount: 0,
        rollbackRecordCount: 0,
        records: [],
        auditEvents: [],
        domainProjections: [],
        rollbackRecords: [],
        responsibleSession: "S12",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      });
    const getAudit = createTeachingOperationAuditGetHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      fetch: fetchImpl,
      getTeachingOperationCourseOwnership: async () => ({
        teacherId: "teacher-kang",
        courseIds: ["teacher-research-methods"],
      }),
      now: new Date("2026-06-22T11:35:00.000Z"),
    });

    try {
      const response = await getAudit(
        new Request("https://www.uais.top/api/teaching/operations/audit", {
          method: "GET",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-production-audit-db-evidence-missing",
            "user-agent": "UAIS production audit database evidence test",
          },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(502);
      expect(body).toEqual(
        expect.objectContaining({
          traceId: "trace-production-audit-db-evidence-missing",
          error:
            "External teaching operation audit readback is missing production database adapter evidence.",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      );
      expect(JSON.stringify(body)).not.toContain(externalToken);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("returns production database adapter evidence from production external audit readback", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-audit-db-evidence-ready-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const productionDatabaseAdapter = createReadyProductionDatabaseAdapter();
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-audit-db-evidence-ready-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:40:00.000Z",
        expiresAt: "2026-06-22T12:40:00.000Z",
      },
    });
    const fetchImpl: typeof fetch = async (url, init) => {
      expect(String(url)).toBe(
        "https://external-storage.example.test/teaching-operations/teacher-kang/audit",
      );
      expect(new Headers(init?.headers).get("authorization")).toBe(
        `Bearer ${externalToken}`,
      );
      return Response.json({
        teacherId: "teacher-kang",
        eventType: "teaching-operation-audit",
        storagePolicy: "external-redacted-teaching-operation-audit-log",
        storageWritePolicy: "external-append-only-audit-log",
        recordCount: 0,
        operationRecordCount: 0,
        domainProjectionCount: 0,
        rollbackRecordCount: 0,
        records: [],
        auditEvents: [],
        domainProjections: [],
        rollbackRecords: [],
        productionDatabaseAdapter,
        responsibleSession: "S12",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      });
    };
    const getAudit = createTeachingOperationAuditGetHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      fetch: fetchImpl,
      getTeachingOperationCourseOwnership: async () => ({
        teacherId: "teacher-kang",
        courseIds: ["teacher-research-methods"],
      }),
      now: new Date("2026-06-22T11:45:00.000Z"),
    });

    try {
      const response = await getAudit(
        new Request("https://www.uais.top/api/teaching/operations/audit", {
          method: "GET",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-production-audit-db-evidence-ready",
            "user-agent": "UAIS production audit database evidence ready",
          },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual(
        expect.objectContaining({
          traceId: "trace-production-audit-db-evidence-ready",
          actorId: "teacher-kang",
          storagePolicy: "external-redacted-teaching-operation-audit-log",
          storageWritePolicy: "external-append-only-audit-log",
          productionDatabaseAdapter,
          recordCount: 0,
          auditEventCount: 0,
          domainProjectionCount: 0,
          rollbackRecordCount: 0,
          responsibleSession: "S12",
        }),
      );
      expect(JSON.stringify(body)).not.toContain(externalToken);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("requires server-side course ownership before writing a teacher operation", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-ownership-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-auth-session-cookie-id",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:40:00.000Z",
        expiresAt: "2026-06-22T11:40:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: join(dataDir, "teacher-ai-ownership"),
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T10:50:00.000Z"),
    });

    try {
      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({
            operationId: "course-settings",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(403);
      expect(body.access).toEqual(
        expect.objectContaining({
          status: "denied",
          reasonCode: "teacher-course-ownership-required",
          actor: { actorId: "teacher-kang", role: "teacher" },
          resource: { courseId: "teacher-research-methods" },
          responsibleSession: "S12",
        }),
      );
      expect(database.records).toHaveLength(0);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("requires class course ownership before parsing class creation bodies", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-class-route-ownership-body-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir,
        actorId: "teacher-owner",
        draft: {
          name: "企业级班级归属校验课程",
          instructor: "康霞",
          unit: "广州大学（404）",
          department: "实验教学中心",
          semester: "2026 春季",
        },
        now: new Date("2026-06-29T09:00:00.000Z"),
      });
      const cookie = createUaisTeacherAuthSessionCookieHeader({
        secret: teacherAuthSecret,
        claims: {
          sessionId: "teacher-class-route-denied-session",
          actorId: "teacher-other",
          role: "teacher",
          authenticatedAt: "2026-06-29T09:05:00.000Z",
          expiresAt: "2026-06-29T10:05:00.000Z",
        },
      });
      const postClass = createTeachingCourseClassPostHandler({
        env: {
          UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
          UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        },
        now: new Date("2026-06-29T09:10:00.000Z"),
      });

      const response = await postClass(
        new Request(`https://www.uais.top/api/teaching/courses/${course.courseId}/classes`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
            "x-uais-trace-id": "trace-class-ownership-before-body",
          },
          body: "{",
        }),
        {
          params: Promise.resolve({
            courseId: course.courseId,
          }),
        },
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status).toBe(403);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-class-ownership-before-body",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teaching class course ownership is required.",
          traceId: "trace-class-ownership-before-body",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "teacher-course-ownership-required",
            actor: { actorId: "teacher-other", role: "teacher" },
            resource: { courseId: course.courseId },
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain("Class request body must be JSON.");
      expect(database.classes).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(1);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed when the teaching operation ownership check backend fails", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-ownership-failure-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-auth-session-ownership-failure",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:40:00.000Z",
        expiresAt: "2026-06-22T11:40:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      getTeachingOperationCourseOwnership: async () => {
        throw new Error("ownership backend secret-token unavailable");
      },
      now: new Date("2026-06-22T10:52:00.000Z"),
    });

    try {
      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
            "x-uais-trace-id": "trace-ownership-check-failed",
          },
          body: JSON.stringify({
            operationId: "course-settings",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(503);
      expect(response.headers.get("x-uais-trace-id")).toBe("trace-ownership-check-failed");
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teaching operation course ownership check failed.",
          traceId: "trace-ownership-check-failed",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "teacher-course-ownership-check-failed",
            actor: { actorId: "teacher-kang", role: "teacher" },
            resource: { courseId: "teacher-research-methods" },
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(database.records).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expect(database.domainProjections).toHaveLength(0);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe teaching operation course ids before ownership checks or writes", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-unsafe-course-id-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-auth-session-unsafe-course-id",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:40:00.000Z",
        expiresAt: "2026-06-22T11:40:00.000Z",
      },
    });
    let ownershipCheckCount = 0;
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      getTeachingOperationCourseOwnership: async () => {
        ownershipCheckCount += 1;
        return {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        };
      },
      now: new Date("2026-06-22T10:53:00.000Z"),
    });

    try {
      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
            "x-uais-trace-id": "trace-unsafe-course-id",
          },
          body: JSON.stringify({
            operationId: "course-settings",
            actionSlot: "primary",
            courseId: "/Users/example/secret-token-course",
            sourceAction: "manage",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(400);
      expect(response.headers.get("x-uais-trace-id")).toBe("trace-unsafe-course-id");
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teaching operation course id is invalid.",
          traceId: "trace-unsafe-course-id",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "course-id-invalid",
            actor: { actorId: "teacher-kang", role: "teacher" },
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain("/Users/example/secret-token-course");
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(ownershipCheckCount).toBe(0);
      expect(database.records).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expect(database.domainProjections).toHaveLength(0);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed teacher actor ids before ownership checks or writes", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-unsafe-actor-id-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const unsafeActorId = "/Users/example/secret-token-teacher";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-auth-session-unsafe-actor",
        actorId: unsafeActorId,
        role: "teacher",
        authenticatedAt: "2026-06-22T10:40:00.000Z",
        expiresAt: "2026-06-22T11:40:00.000Z",
      },
    });
    let ownershipCheckCount = 0;
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      getTeachingOperationCourseOwnership: async () => {
        ownershipCheckCount += 1;
        return {
          teacherId: unsafeActorId,
          courseIds: ["teacher-research-methods"],
        };
      },
      now: new Date("2026-06-22T10:54:00.000Z"),
    });

    try {
      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
            "x-uais-trace-id": "trace-unsafe-actor-id",
          },
          body: JSON.stringify({
            operationId: "course-settings",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe("trace-unsafe-actor-id");
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-unsafe-actor-id",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain("/Users/example/secret-token-teacher");
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(ownershipCheckCount).toBe(0);
      expect(database.records).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expect(database.domainProjections).toHaveLength(0);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed teacher session ids before ownership checks or writes", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-unsafe-session-id-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const unsafeSessionId = "/Users/example/secret-token-session";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: unsafeSessionId,
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:40:00.000Z",
        expiresAt: "2026-06-22T11:40:00.000Z",
      },
    });
    let ownershipCheckCount = 0;
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      getTeachingOperationCourseOwnership: async () => {
        ownershipCheckCount += 1;
        return {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        };
      },
      now: new Date("2026-06-22T10:54:30.000Z"),
    });

    try {
      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
            "x-uais-trace-id": "trace-unsafe-session-id",
          },
          body: JSON.stringify({
            operationId: "course-settings",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe("trace-unsafe-session-id");
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-unsafe-session-id",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain("/Users/example/secret-token-session");
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(ownershipCheckCount).toBe(0);
      expect(database.records).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expect(database.domainProjections).toHaveLength(0);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("persists authorized teacher operations with signed actor identity and audit trace metadata", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-authorized-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-auth-session-cookie-id",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:40:00.000Z",
        expiresAt: "2026-06-22T11:40:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T10:55:00.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T10:41:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
            "user-agent": "vitest teaching smoke",
            "x-uais-trace-id": "trace-teaching-ops-001",
            origin: "https://www.uais.top",
            referer: "https://www.uais.top/teaching?tab=course-settings&secret=should-not-leak",
          },
          body: JSON.stringify({
            operationId: "course-settings",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            actorId: "teacher-spoof",
            sourceAction: "manage",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(200);
      expect(response.headers.get("x-uais-trace-id")).toBe("trace-teaching-ops-001");
      expect(body.traceId).toBe("trace-teaching-ops-001");
      expect(body.receipt).toEqual(
        expect.objectContaining({
          actorId: "teacher-kang",
          courseId: "teacher-research-methods",
          audit: expect.objectContaining({
            traceId: "trace-teaching-ops-001",
            actor: { actorId: "teacher-kang", role: "teacher" },
            authSession: {
              sessionId: "teacher-auth-session-cookie-id",
              authenticatedAt: "2026-06-22T10:40:00.000Z",
              expiresAt: "2026-06-22T11:40:00.000Z",
            },
            authMode: "signed-teacher-session",
            requestSource: {
              userAgent: "vitest teaching smoke",
              ipAddress: "redacted",
              originClass: "remote-https",
              refererPath: "/teaching",
            },
          }),
        }),
      );
      expect(database.records).toHaveLength(1);
      expect(database.records[0]).toEqual(
        expect.objectContaining({
          actorId: "teacher-kang",
          courseId: "teacher-research-methods",
        }),
      );
      expect(database.auditEvents).toContainEqual(
        expect.objectContaining({
          traceId: "trace-teaching-ops-001",
          actorId: "teacher-kang",
          authSession: {
            sessionId: "teacher-auth-session-cookie-id",
            authenticatedAt: "2026-06-22T10:40:00.000Z",
            expiresAt: "2026-06-22T11:40:00.000Z",
          },
          courseId: "teacher-research-methods",
          eventType: "teaching-operation.persisted",
          requestSource: {
            userAgent: "vitest teaching smoke",
            ipAddress: "redacted",
            originClass: "remote-https",
            refererPath: "/teaching",
          },
        }),
      );
      expect(JSON.stringify(body)).not.toContain("teacher-spoof");
      expect(JSON.stringify(database)).not.toContain("teacher-spoof");
      expect(JSON.stringify(body)).not.toContain("secret=should-not-leak");
      expect(JSON.stringify(database)).not.toContain("secret=should-not-leak");
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("returns a domain persistence summary when operation buttons update course-management objects", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-domain-summary-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-domain-summary-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:00:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:10:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Domain Summary Course",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-domain-summary-course-create",
        now: new Date("2026-06-22T11:01:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T11:02:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
            "user-agent": "UAIS domain summary regression",
            "x-uais-trace-id": "trace-teaching-domain-summary",
          },
          body: JSON.stringify({
            operationId: "course-settings",
            actionSlot: "primary",
            courseId: course.courseId,
            sourceAction: "inline-teaching-workspace",
            courseSettingsPatch: {
              courseName: "Domain Summary Course Updated",
              semester: "2026 Summer",
            },
          }),
        }),
      );
      const body = await response.json();
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const operationDatabase = await readTeachingOperationDatabase({
        dataDir: operationsDataDir,
      });

      expect(response.status).toBe(200);
      expect(body.courseSettingsReceipt).toEqual(
        expect.objectContaining({
          action: "save-course-settings",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-teaching-domain-summary",
          status: "persisted",
        }),
      );
      expect(body.domainPersistenceSummary).toEqual(
        expect.objectContaining({
          status: "persisted",
          required: true,
          operationId: "course-settings",
          actionSlot: "primary",
          operationReceiptId: body.receipt.receiptId,
          courseId: course.courseId,
          expectedObjectTypes: ["course-settings"],
          persistedObjectTypes: ["course-settings"],
          missingObjectTypes: [],
          receiptCount: 1,
          storageWritePolicies: ["atomic-json-file-replace"],
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      );
      expect(courseDatabase.courseSettings).toEqual([
        expect.objectContaining({
          settingsId: `course-settings-${course.courseId}`,
          courseId: course.courseId,
          operationRecordId: body.receipt.receiptId,
          settingsStatus: "saved",
        }),
      ]);
      expect(operationDatabase.domainProjections).toEqual([
        expect.objectContaining({
          objectId: `course-settings-${course.courseId}`,
          objectType: "course-settings",
          courseId: course.courseId,
          operationRecordId: body.receipt.receiptId,
          appliedFields: ["courseName", "semester"],
          courseName: "Domain Summary Course Updated",
          semester: "2026 Summer",
        }),
      ]);
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(operationDatabase, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("deduplicates repeated signed operation POSTs with the same idempotency key", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-idempotency-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-idempotency-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:55:00.000Z",
        expiresAt: "2026-06-22T11:55:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:05:00.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T10:56:00.000Z",
      });

      const requestBody = {
        operationId: "course-settings",
        actionSlot: "primary",
        courseId: "teacher-research-methods",
        sourceAction: "manage",
        idempotencyKey: "teaching-course-settings-save-20260622-110500",
      };
      const firstResponse = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
            "x-uais-trace-id": "trace-teaching-idempotent-first",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const firstBody = await firstResponse.json();
      const secondResponse = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
            "x-uais-trace-id": "trace-teaching-idempotent-retry",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const secondBody = await secondResponse.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(firstResponse.status).toBe(200);
      expect(secondResponse.status).toBe(200);
      expect(firstBody.receipt).toEqual(
        expect.objectContaining({
          actorId: "teacher-kang",
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          idempotencyKey: "teaching-course-settings-save-20260622-110500",
          idempotencyStatus: "created",
        }),
      );
      expect(secondBody.receipt).toEqual(
        expect.objectContaining({
          receiptId: firstBody.receipt.receiptId,
          actorId: "teacher-kang",
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          idempotencyKey: "teaching-course-settings-save-20260622-110500",
          idempotencyStatus: "already-persisted",
          audit: expect.objectContaining({
            traceId: "trace-teaching-idempotent-first",
          }),
        }),
      );
      expect(database.records).toHaveLength(1);
      expect(database.auditEvents).toHaveLength(1);
      expect(database.domainProjections).toHaveLength(1);
      expect(database.records[0]).toEqual(
        expect.objectContaining({
          recordId: firstBody.receipt.receiptId,
          idempotencyKey: "teaching-course-settings-save-20260622-110500",
        }),
      );
      expect(JSON.stringify(database)).not.toContain("trace-teaching-idempotent-retry");
      expectNoLocalOrSecretValues(firstBody, dataDir);
      expectNoLocalOrSecretValues(secondBody, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects idempotency key reuse when a direct signed POST changes payload", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-idempotency-conflict-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-idempotency-conflict-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:05:00.000Z",
        expiresAt: "2026-06-22T12:05:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:10:00.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T11:06:00.000Z",
      });

      const firstResponse = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
            "x-uais-trace-id": "trace-teaching-idempotent-conflict-original",
          },
          body: JSON.stringify({
            operationId: "course-settings",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
            idempotencyKey: "teaching-course-settings-conflict-20260622",
          }),
        }),
      );
      const conflictResponse = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
            "x-uais-trace-id": "trace-teaching-idempotent-conflict-reuse",
          },
          body: JSON.stringify({
            operationId: "course-settings",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
            idempotencyKey: "teaching-course-settings-conflict-20260622",
          }),
        }),
      );
      const conflictBody = await conflictResponse.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(firstResponse.status).toBe(200);
      expect(conflictResponse.status).toBe(409);
      expect(conflictResponse.headers.get("x-uais-trace-id")).toBe(
        "trace-teaching-idempotent-conflict-reuse",
      );
      expect(conflictBody).toEqual(
        expect.objectContaining({
          error: "Teaching operation idempotency key already exists.",
          traceId: "trace-teaching-idempotent-conflict-reuse",
        }),
      );
      expect(database.records).toHaveLength(1);
      expect(database.auditEvents).toHaveLength(1);
      expect(database.domainProjections).toHaveLength(1);
      expect(database.records[0]).toEqual(
        expect.objectContaining({
          operationId: "course-settings",
          actionSlot: "primary",
          idempotencyKey: "teaching-course-settings-conflict-20260622",
        }),
      );
      expect(JSON.stringify(database)).not.toContain(
        "trace-teaching-idempotent-conflict-reuse",
      );
      expectNoLocalOrSecretValues(conflictBody, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("writes generated invite-code drafts into the course management invite draft object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-invite-draft-domain-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-invite-draft-domain-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:00:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:28:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Invite Draft Course",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-invite-draft-course",
        now: new Date("2026-06-22T11:20:00.000Z"),
      });
      const { classItem } = await createTeachingClassRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        courseId: course.courseId,
        draft: {
          className: "Enterprise Invite Draft Class 1",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-invite-draft-class",
        now: new Date("2026-06-22T11:21:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T11:22:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "user-agent": "vitest invite draft audit source",
            "x-uais-trace-id": "trace-generate-invite-draft-domain-object",
          },
          body: JSON.stringify({
            operationId: "invite-code",
            actionSlot: "primary",
            courseId: course.courseId,
            targetClassId: classItem.classId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "invite-draft-domain-object-20260622",
          }),
        }),
      );
      const body = await response.json();
      const generatedInvite = body.receipt?.artifacts?.find(
        (artifact: { kind?: string; code?: string; status?: string }) =>
          artifact.kind === "invite-code" && artifact.status === "generated",
      );
      const generatedInviteCode =
        typeof generatedInvite?.code === "string" ? generatedInvite.code : "";
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const inviteCodeDrafts = (
        courseDatabase as unknown as {
          inviteCodeDrafts?: Array<Record<string, unknown>>;
        }
      ).inviteCodeDrafts;
      const savedCourse = courseDatabase.courses.find(
        (candidate) => candidate.courseId === course.courseId,
      );

      expect(response.status).toBe(200);
      expect(savedCourse).toEqual(
        expect.objectContaining({
          courseId: course.courseId,
          updatedAt: "2026-06-22T11:28:00.000Z",
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
        }),
      );
      expect(generatedInvite).toEqual(
        expect.objectContaining({
          code: expect.stringMatching(/^\d{8}$/),
          status: "generated",
          joinUrl: expect.stringMatching(/^\/courses\?invite=\d{8}$/),
        }),
      );
      expect(body.inviteCodeDraftReceipt).toEqual(
        expect.objectContaining({
          action: "generate-class-invite-code-draft",
          actorId: "teacher-kang",
          courseId: course.courseId,
          classId: classItem.classId,
          traceId: "trace-generate-invite-draft-domain-object",
          status: "persisted",
        }),
      );
      expect(inviteCodeDrafts).toEqual([
        expect.objectContaining({
          inviteCodeDraftId: `invite-code-draft-${course.courseId}-${generatedInviteCode}`,
          courseId: course.courseId,
          classId: classItem.classId,
          ownerTeacherId: "teacher-kang",
          generatedBy: "teacher-kang",
          draftStatus: "generated",
          operationRecordId: body.receipt.receiptId,
          sourceAction: "inline-teaching-workspace",
          inviteCode: generatedInviteCode,
          joinUrl: `/courses?invite=${generatedInviteCode}`,
          invitePolicy: "teacher-review-before-publication",
          generatedAt: "2026-06-22T11:28:00.000Z",
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      ]);
      expect(courseDatabase.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "generate-class-invite-code-draft",
          actorId: "teacher-kang",
          courseId: course.courseId,
          classId: classItem.classId,
          traceId: "trace-generate-invite-draft-domain-object",
          requestSource: {
            userAgent: "vitest invite draft audit source",
            ipAddress: "redacted",
          },
        }),
      );
      expectNoLocalOrSecretValues(inviteCodeDrafts, dataDir);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps invite-code draft persistence idempotent on signed operation retries", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-invite-draft-idempotent-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-invite-draft-idempotent-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:00:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const env = {
      UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
      UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
      UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    };

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Invite Draft Idempotent",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-invite-draft-idempotent-course",
        now: new Date("2026-06-22T11:20:00.000Z"),
      });
      const { classItem } = await createTeachingClassRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        courseId: course.courseId,
        draft: {
          className: "Enterprise Invite Draft Idempotent Class 1",
          semester: "2026 Spring",
        },
        traceId: "trace-create-invite-draft-idempotent-class",
        now: new Date("2026-06-22T11:21:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T11:22:00.000Z",
      });

      const requestBody = {
        operationId: "invite-code",
        actionSlot: "primary",
        courseId: course.courseId,
        targetClassId: classItem.classId,
        sourceAction: "inline-teaching-workspace",
        idempotencyKey: "invite-draft-idempotent-20260622",
      };
      const firstPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T11:28:00.000Z"),
      });
      const secondPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T11:43:00.000Z"),
      });

      const firstResponse = await firstPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-invite-draft-idempotent-first",
            "user-agent": "UAIS invite draft idempotent first",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const firstBody = await firstResponse.json();
      const generatedInvite = firstBody.receipt?.artifacts?.find(
        (artifact: { kind?: string; code?: string; status?: string }) =>
          artifact.kind === "invite-code" && artifact.status === "generated",
      );
      const generatedInviteCode =
        typeof generatedInvite?.code === "string" ? generatedInvite.code : "";
      const secondResponse = await secondPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-invite-draft-idempotent-retry",
            "user-agent": "UAIS invite draft idempotent retry",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const secondBody = await secondResponse.json();
      const operationDatabase = await readTeachingOperationDatabase({
        dataDir: operationsDataDir,
      });
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const savedCourse = courseDatabase.courses.find(
        (candidate) => candidate.courseId === course.courseId,
      );
      const savedClass = courseDatabase.classes.find(
        (candidate) => candidate.classId === classItem.classId,
      );
      const inviteCodeDrafts = (
        courseDatabase as unknown as {
          inviteCodeDrafts?: Array<Record<string, unknown>>;
        }
      ).inviteCodeDrafts;

      expect(firstResponse.status, JSON.stringify(firstBody)).toBe(200);
      expect(secondResponse.status, JSON.stringify(secondBody)).toBe(200);
      expect(generatedInviteCode).toEqual(expect.stringMatching(/^\d{8}$/));
      expect(firstBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "created",
          receiptId: secondBody.receipt.receiptId,
        }),
      );
      expect(secondBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "already-persisted",
          receiptId: firstBody.receipt.receiptId,
        }),
      );
      expect(savedCourse).toEqual(
        expect.objectContaining({
          courseId: course.courseId,
          updatedAt: "2026-06-22T11:28:00.000Z",
        }),
      );
      expect(savedClass).toEqual(
        expect.objectContaining({
          classId: classItem.classId,
          updatedAt: "2026-06-22T11:28:00.000Z",
        }),
      );
      expect(inviteCodeDrafts).toEqual([
        expect.objectContaining({
          inviteCodeDraftId: `invite-code-draft-${course.courseId}-${generatedInviteCode}`,
          operationRecordId: firstBody.receipt.receiptId,
          draftStatus: "generated",
          inviteCode: generatedInviteCode,
          joinUrl: `/courses?invite=${generatedInviteCode}`,
          generatedAt: "2026-06-22T11:28:00.000Z",
        }),
      ]);
      expect(secondBody.inviteCodeDraftReceipt).toEqual(
        expect.objectContaining({
          action: "generate-class-invite-code-draft",
          courseId: course.courseId,
          classId: classItem.classId,
          createdAt: "2026-06-22T11:28:00.000Z",
        }),
      );
      expect(operationDatabase.records).toHaveLength(1);
      expect(operationDatabase.auditEvents).toHaveLength(1);
      expect(
        courseDatabase.auditEvents.filter(
          (event) => event.action === "generate-class-invite-code-draft",
        ),
      ).toEqual([
        expect.objectContaining({
          traceId: "trace-invite-draft-idempotent-first",
          createdAt: "2026-06-22T11:28:00.000Z",
        }),
      ]);
      expect(JSON.stringify(courseDatabase)).not.toContain("trace-invite-draft-idempotent-retry");
      expect(JSON.stringify(courseDatabase)).not.toContain("UAIS invite draft idempotent retry");
      expectNoLocalOrSecretValues(inviteCodeDrafts, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(firstBody, dataDir);
      expectNoLocalOrSecretValues(secondBody, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("publishes invite-code operations into the class join entry so students can join", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-invite-class-link-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const appSessionSecret = "test-app-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-invite-class-link-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:15:00.000Z",
        expiresAt: "2026-06-22T12:15:00.000Z",
      },
    });
    const studentCookie = createUaisAppSessionCookie(
      {
        account: "Peter",
        department: "学生账号",
        displayName: "Peter",
        role: "student",
      },
      {
        secret: appSessionSecret,
        sessionId: "student-invite-class-link-session",
        now: new Date("2026-06-22T11:35:00.000Z"),
      },
    );
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:30:00.000Z"),
    });
    const publishOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:35:00.000Z"),
    });
    const joinByInvite = createTeachingInviteCodeJoinPostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
      },
      now: new Date("2026-06-22T11:40:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Invite Course",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-invite-course",
        now: new Date("2026-06-22T11:18:00.000Z"),
      });
      const { classItem } = await createTeachingClassRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        courseId: course.courseId,
        draft: {
          className: "Enterprise Invite Class 1",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-invite-class",
        now: new Date("2026-06-22T11:19:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T11:20:00.000Z",
      });

      for (const idempotencyKey of [
        "invite-generate-enterprise-class-link-1",
        "invite-generate-enterprise-class-link-2",
      ]) {
        const generateResponse = await postOperation(
          new Request("https://www.uais.top/api/teaching/operations", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie: teacherCookie,
            },
            body: JSON.stringify({
              operationId: "invite-code",
              actionSlot: "primary",
              courseId: course.courseId,
              targetClassId: classItem.classId,
              sourceAction: "inline-teaching-workspace",
              idempotencyKey,
            }),
          }),
        );
        expect(generateResponse.status).toBe(200);
      }

      const publishResponse = await publishOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "user-agent": "vitest invite publish audit source",
            "x-uais-trace-id": "trace-publish-enterprise-class-invite",
          },
          body: JSON.stringify({
            operationId: "invite-code",
            actionSlot: "secondary",
            courseId: course.courseId,
            targetClassId: classItem.classId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "invite-publish-enterprise-class-link",
          }),
        }),
      );
      const publishBody = await publishResponse.json();
      const publishedInvite = publishBody.receipt?.artifacts?.find(
        (artifact: { kind?: string; code?: string; status?: string }) =>
          artifact.kind === "invite-code" && artifact.status === "published",
      );
      const publishedInviteCode =
        typeof publishedInvite?.code === "string" ? publishedInvite.code : "";
      expect(publishResponse.status).toBe(200);
      expect(publishedInvite).toEqual(
        expect.objectContaining({
          code: expect.stringMatching(/^\d{8}$/),
          status: "published",
        }),
      );
      expect(publishedInviteCode).not.toBe(classItem.invitationCode);
      expect(publishBody.classInvitePublicationReceipt).toEqual(
        expect.objectContaining({
          action: "publish-class-invite-code",
          actorId: "teacher-kang",
          courseId: course.courseId,
          classId: classItem.classId,
          traceId: "trace-publish-enterprise-class-invite",
          status: "persisted",
        }),
      );

      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const savedCourse = courseDatabase.courses.find(
        (candidate) => candidate.courseId === course.courseId,
      );
      expect(savedCourse).toEqual(
        expect.objectContaining({
          courseId: course.courseId,
          updatedAt: "2026-06-22T11:35:00.000Z",
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
        }),
      );
      expect(courseDatabase.classes).toContainEqual(
        expect.objectContaining({
          classId: classItem.classId,
          invitationCode: publishedInviteCode,
          joinUrl: `/courses?invite=${publishedInviteCode}`,
        }),
      );
      expect(courseDatabase.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "publish-class-invite-code",
          actorId: "teacher-kang",
          courseId: course.courseId,
          classId: classItem.classId,
          traceId: "trace-publish-enterprise-class-invite",
          requestSource: {
            userAgent: "vitest invite publish audit source",
            ipAddress: "redacted",
          },
        }),
      );

      const joinResponse = await joinByInvite(
        new Request(`https://www.uais.top/api/teaching/invite-codes/${publishedInviteCode}/join`, {
          method: "POST",
          headers: {
            cookie: studentCookie,
            "x-uais-trace-id": "trace-student-joins-published-enterprise-invite",
          },
        }),
        {
          params: Promise.resolve({ code: publishedInviteCode }),
        },
      );
      const joinBody = await joinResponse.json();
      expect(joinResponse.status).toBe(201);
      expect(joinBody.membership).toEqual(
        expect.objectContaining({
          courseId: course.courseId,
          classId: classItem.classId,
          invitationCode: publishedInviteCode,
          studentId: "Peter",
          membershipStatus: "pending-teacher-review",
        }),
      );
      const joinedDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      expect(joinedDatabase.courses).toContainEqual(
        expect.objectContaining({
          courseId: course.courseId,
          students: 0,
          updatedAt: "2026-06-22T11:40:00.000Z",
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
        }),
      );
      expect(joinedDatabase.classes).toContainEqual(
        expect.objectContaining({
          classId: classItem.classId,
          students: 0,
          invitationCode: publishedInviteCode,
          updatedAt: "2026-06-22T11:40:00.000Z",
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
        }),
      );
      expectNoLocalOrSecretValues(publishBody, dataDir);
      expectNoLocalOrSecretValues(joinBody, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects mixed teacher-auth and student app-session cookies before invite-code joins", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-invite-join-mixed-auth-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const appSessionSecret = "test-app-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-invite-join-mixed-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:35:00.000Z",
        expiresAt: "2026-06-22T12:35:00.000Z",
      },
    });
    const studentCookie = createUaisAppSessionCookie(
      {
        account: "Peter",
        department: "学生账号",
        displayName: "Peter",
        role: "student",
      },
      {
        secret: appSessionSecret,
        sessionId: "student-invite-join-mixed-session",
        now: new Date("2026-06-22T11:35:00.000Z"),
      },
    );
    const joinByInvite = createTeachingInviteCodeJoinPostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:40:00.000Z"),
    });

    try {
      const response = await joinByInvite(
        new Request("https://www.uais.top/api/teaching/invite-codes/66334455/join", {
          method: "POST",
          headers: {
            cookie: `${studentCookie}; ${teacherCookie}`,
            "x-uais-trace-id": "trace-invite-join-mixed-auth-denied",
            "user-agent": "UAIS invite mixed auth denial test",
          },
        }),
        {
          params: Promise.resolve({ code: "66334455" }),
        },
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status).toBe(403);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-invite-join-mixed-auth-denied",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS student role is required.",
          traceId: "trace-invite-join-mixed-auth-denied",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "student-role-required",
            actor: {
              actorId: "teacher-kang",
              role: "teacher",
            },
            responsibleSession: "S12",
          }),
        }),
      );
      expect(database.memberships).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed student session ids before invite-code joins", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-invite-join-unsafe-session-id-"),
    );
    const appSessionSecret = "test-app-session-signing-secret";
    const unsafeSessionId = "/Users/example/secret-token-invite-join-session";
    const studentCookie = createUaisAppSessionCookie(
      {
        account: "Peter",
        department: "学生账号",
        displayName: "Peter",
        role: "student",
      },
      {
        secret: appSessionSecret,
        sessionId: unsafeSessionId,
        now: new Date("2026-06-22T11:35:00.000Z"),
      },
    );
    const joinByInvite = createTeachingInviteCodeJoinPostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
      },
      now: new Date("2026-06-22T11:40:00.000Z"),
    });

    try {
      const response = await joinByInvite(
        new Request("https://www.uais.top/api/teaching/invite-codes/66334455/join", {
          method: "POST",
          headers: {
            cookie: studentCookie,
            "x-uais-trace-id": "trace-invite-join-unsafe-session-id",
            "user-agent": "UAIS invite unsafe student session test",
          },
        }),
        {
          params: Promise.resolve({ code: "66334455" }),
        },
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-invite-join-unsafe-session-id",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS student authentication is required.",
          traceId: "trace-invite-join-unsafe-session-id",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "student-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain(unsafeSessionId);
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(database.memberships).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed student display names before invite-code joins", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-invite-join-unsafe-display-name-"),
    );
    const appSessionSecret = "test-app-session-signing-secret";
    const unsafeDisplayName = "/Users/example/secret-token-invite-student";
    const studentCookie = createUaisAppSessionCookie(
      {
        account: "Peter",
        department: "学生账号",
        displayName: unsafeDisplayName,
        role: "student",
      },
      {
        secret: appSessionSecret,
        sessionId: "student-invite-join-safe-session",
        now: new Date("2026-06-22T11:35:00.000Z"),
      },
    );
    const joinByInvite = createTeachingInviteCodeJoinPostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
      },
      now: new Date("2026-06-22T11:40:00.000Z"),
    });

    try {
      const response = await joinByInvite(
        new Request("https://www.uais.top/api/teaching/invite-codes/66334455/join", {
          method: "POST",
          headers: {
            cookie: studentCookie,
            "x-uais-trace-id": "trace-invite-join-unsafe-display-name",
            "user-agent": "UAIS invite unsafe student display name test",
          },
        }),
        {
          params: Promise.resolve({ code: "66334455" }),
        },
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-invite-join-unsafe-display-name",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS student authentication is required.",
          traceId: "trace-invite-join-unsafe-display-name",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "student-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain(unsafeDisplayName);
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(database.memberships).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps invite-code publication idempotent on signed operation retries", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-invite-publish-idempotent-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-invite-publish-idempotent-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:15:00.000Z",
        expiresAt: "2026-06-22T12:20:00.000Z",
      },
    });
    const env = {
      UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
      UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
      UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    };

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Invite Publish Idempotent",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-invite-publish-idempotent-course",
        now: new Date("2026-06-22T11:18:00.000Z"),
      });
      const { classItem } = await createTeachingClassRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        courseId: course.courseId,
        draft: {
          className: "Enterprise Invite Publish Idempotent Class 1",
          semester: "2026 Spring",
        },
        traceId: "trace-create-invite-publish-idempotent-class",
        now: new Date("2026-06-22T11:19:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T11:20:00.000Z",
      });

      const requestBody = {
        operationId: "invite-code",
        actionSlot: "secondary",
        courseId: course.courseId,
        targetClassId: classItem.classId,
        sourceAction: "inline-teaching-workspace",
        idempotencyKey: "invite-publish-idempotent-20260622",
      };
      const firstPublishOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T11:35:00.000Z"),
      });
      const secondPublishOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T11:50:00.000Z"),
      });

      const firstResponse = await firstPublishOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-invite-publish-idempotent-first",
            "user-agent": "UAIS invite publish idempotent first",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const firstBody = await firstResponse.json();
      const publishedInvite = firstBody.receipt?.artifacts?.find(
        (artifact: { kind?: string; code?: string; status?: string }) =>
          artifact.kind === "invite-code" && artifact.status === "published",
      );
      const publishedInviteCode =
        typeof publishedInvite?.code === "string" ? publishedInvite.code : "";
      const secondResponse = await secondPublishOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-invite-publish-idempotent-retry",
            "user-agent": "UAIS invite publish idempotent retry",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const secondBody = await secondResponse.json();
      const operationDatabase = await readTeachingOperationDatabase({
        dataDir: operationsDataDir,
      });
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const savedCourse = courseDatabase.courses.find(
        (candidate) => candidate.courseId === course.courseId,
      );
      const savedClass = courseDatabase.classes.find(
        (candidate) => candidate.classId === classItem.classId,
      );

      expect(firstResponse.status, JSON.stringify(firstBody)).toBe(200);
      expect(secondResponse.status, JSON.stringify(secondBody)).toBe(200);
      expect(publishedInviteCode).toEqual(expect.stringMatching(/^\d{8}$/));
      expect(firstBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "created",
          receiptId: secondBody.receipt.receiptId,
        }),
      );
      expect(secondBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "already-persisted",
          receiptId: firstBody.receipt.receiptId,
        }),
      );
      expect(savedCourse).toEqual(
        expect.objectContaining({
          courseId: course.courseId,
          updatedAt: "2026-06-22T11:35:00.000Z",
        }),
      );
      expect(savedClass).toEqual(
        expect.objectContaining({
          classId: classItem.classId,
          invitationCode: publishedInviteCode,
          joinUrl: `/courses?invite=${publishedInviteCode}`,
          updatedAt: "2026-06-22T11:35:00.000Z",
        }),
      );
      expect(secondBody.classInvitePublicationReceipt).toEqual(
        expect.objectContaining({
          action: "publish-class-invite-code",
          courseId: course.courseId,
          classId: classItem.classId,
          createdAt: "2026-06-22T11:35:00.000Z",
        }),
      );
      expect(operationDatabase.records).toHaveLength(1);
      expect(operationDatabase.auditEvents).toHaveLength(1);
      expect(
        courseDatabase.auditEvents.filter((event) => event.action === "publish-class-invite-code"),
      ).toEqual([
        expect.objectContaining({
          traceId: "trace-invite-publish-idempotent-first",
          createdAt: "2026-06-22T11:35:00.000Z",
        }),
      ]);
      expect(JSON.stringify(courseDatabase)).not.toContain("trace-invite-publish-idempotent-retry");
      expect(JSON.stringify(courseDatabase)).not.toContain("UAIS invite publish idempotent retry");
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(firstBody, dataDir);
      expectNoLocalOrSecretValues(secondBody, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("writes course-settings operations into the course management settings object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-course-settings-domain-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-course-settings-domain-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:30:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T12:10:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Course Settings",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-course-settings-course",
        now: new Date("2026-06-22T12:02:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:03:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-save-course-settings-domain-object",
            "user-agent": "UAIS course settings domain audit source test",
          },
          body: JSON.stringify({
            operationId: "course-settings",
            actionSlot: "primary",
            courseId: course.courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "course-settings-domain-object-20260622",
          }),
        }),
      );
      const body = await response.json();
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const courseSettings = (
        courseDatabase as unknown as {
          courseSettings?: Array<Record<string, unknown>>;
        }
      ).courseSettings;
      const savedCourse = courseDatabase.courses.find(
        (candidate) => candidate.courseId === course.courseId,
      );

      expect(response.status).toBe(200);
      expect(savedCourse).toEqual(
        expect.objectContaining({
          courseId: course.courseId,
          updatedAt: "2026-06-22T12:10:00.000Z",
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
        }),
      );
      expect(courseSettings).toEqual([
        expect.objectContaining({
          settingsId: `course-settings-${course.courseId}`,
          courseId: course.courseId,
          ownerTeacherId: "teacher-kang",
          updatedBy: "teacher-kang",
          settingsStatus: "saved",
          operationRecordId: body.receipt.receiptId,
          sourceAction: "inline-teaching-workspace",
          updatedAt: "2026-06-22T12:10:00.000Z",
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      ]);
      expect(courseDatabase.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "save-course-settings",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-save-course-settings-domain-object",
          requestSource: {
            userAgent: "UAIS course settings domain audit source test",
            ipAddress: "redacted",
          },
        }),
      );
      expectNoLocalOrSecretValues(courseSettings, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps course-settings domain persistence idempotent on signed operation retries", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-course-settings-domain-idempotent-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-course-settings-domain-idempotent-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:30:00.000Z",
      },
    });
    const env = {
      UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
      UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
      UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    };

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Course Settings Idempotent",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
          description: "Original persisted course description",
        },
        traceId: "trace-create-course-settings-idempotent-course",
        now: new Date("2026-06-22T12:02:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:03:00.000Z",
      });

      const requestBody = {
        operationId: "course-settings",
        actionSlot: "primary",
        courseId: course.courseId,
        sourceAction: "inline-teaching-workspace",
        idempotencyKey: "course-settings-domain-idempotent-20260622",
        courseSettingsPatch: {
          courseName: "Enterprise Course Settings Idempotent Applied",
          semester: "2026 Fall",
          description: "Updated persisted course description",
        },
      };
      const firstPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T12:10:00.000Z"),
      });
      const secondPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T12:25:00.000Z"),
      });

      const firstResponse = await firstPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-course-settings-domain-idempotent-first",
            "user-agent": "UAIS course settings idempotent first",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const firstBody = await firstResponse.json();
      const secondResponse = await secondPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-course-settings-domain-idempotent-retry",
            "user-agent": "UAIS course settings idempotent retry",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const secondBody = await secondResponse.json();
      const operationDatabase = await readTeachingOperationDatabase({
        dataDir: operationsDataDir,
      });
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const savedCourse = courseDatabase.courses.find(
        (candidate) => candidate.courseId === course.courseId,
      );
      const courseSettings = (
        courseDatabase as unknown as {
          courseSettings?: Array<Record<string, unknown>>;
        }
      ).courseSettings;

      expect(firstResponse.status, JSON.stringify(firstBody)).toBe(200);
      expect(secondResponse.status, JSON.stringify(secondBody)).toBe(200);
      expect(firstBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "created",
          receiptId: secondBody.receipt.receiptId,
        }),
      );
      expect(secondBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "already-persisted",
          receiptId: firstBody.receipt.receiptId,
        }),
      );
      expect(savedCourse).toEqual(
        expect.objectContaining({
          courseId: course.courseId,
          courseName: "Enterprise Course Settings Idempotent Applied",
          semester: "2026 Fall",
          description: "Updated persisted course description",
          updatedAt: "2026-06-22T12:10:00.000Z",
        }),
      );
      expect(courseSettings).toEqual([
        expect.objectContaining({
          settingsId: `course-settings-${course.courseId}`,
          operationRecordId: firstBody.receipt.receiptId,
          updatedAt: "2026-06-22T12:10:00.000Z",
          appliedFields: ["courseName", "semester", "description"],
        }),
      ]);
      expect(secondBody.courseSettingsReceipt).toEqual(
        expect.objectContaining({
          action: "save-course-settings",
          courseId: course.courseId,
          createdAt: "2026-06-22T12:10:00.000Z",
        }),
      );
      expect(operationDatabase.records).toHaveLength(1);
      expect(operationDatabase.auditEvents).toHaveLength(1);
      expect(
        courseDatabase.auditEvents.filter((event) => event.action === "save-course-settings"),
      ).toEqual([
        expect.objectContaining({
          traceId: "trace-course-settings-domain-idempotent-first",
          createdAt: "2026-06-22T12:10:00.000Z",
        }),
      ]);
      expect(JSON.stringify(courseDatabase)).not.toContain(
        "trace-course-settings-domain-idempotent-retry",
      );
      expect(JSON.stringify(courseDatabase)).not.toContain(
        "UAIS course settings idempotent retry",
      );
      expectNoLocalOrSecretValues(courseSettings, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(firstBody, dataDir);
      expectNoLocalOrSecretValues(secondBody, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("applies course-settings patches to the persisted course record", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-course-settings-patch-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-course-settings-patch-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:30:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T12:20:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Course Settings",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
          description: "Original persisted course description",
        },
        traceId: "trace-create-course-settings-patch-course",
        now: new Date("2026-06-22T12:02:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:03:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-apply-course-settings-patch",
            "user-agent": "UAIS course settings patch test",
          },
          body: JSON.stringify({
            operationId: "course-settings",
            actionSlot: "primary",
            courseId: course.courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "course-settings-patch-20260622",
            courseSettingsPatch: {
              courseName: "Enterprise Course Settings Applied",
              semester: "2026 Fall",
              description: "Updated persisted course description",
            },
          }),
        }),
      );
      const body = await response.json();
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const savedCourse = courseDatabase.courses.find(
        (candidate) => candidate.courseId === course.courseId,
      );
      const courseSettings = (
        courseDatabase as unknown as {
          courseSettings?: Array<Record<string, unknown>>;
        }
      ).courseSettings;

      expect(response.status).toBe(200);
      expect(savedCourse).toEqual(
        expect.objectContaining({
          courseId: course.courseId,
          courseName: "Enterprise Course Settings Applied",
          semester: "2026 Fall",
          description: "Updated persisted course description",
          updatedAt: "2026-06-22T12:20:00.000Z",
        }),
      );
      expect(courseSettings).toEqual([
        expect.objectContaining({
          settingsId: `course-settings-${course.courseId}`,
          appliedFields: ["courseName", "semester", "description"],
          courseName: "Enterprise Course Settings Applied",
          semester: "2026 Fall",
          description: "Updated persisted course description",
          operationRecordId: body.receipt.receiptId,
          sourceAction: "inline-teaching-workspace",
        }),
      ]);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("preflights production course management storage before appending the operation ledger", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-course-mgmt-preflight-"));
    const operationsDataDir = join(dataDir, "operations");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const courseId = "teacher-course-management-preflight-course-20260622-121500";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-course-management-preflight-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:05:00.000Z",
        expiresAt: "2026-06-22T13:05:00.000Z",
      },
    });
    const appendedOperations: string[] = [];
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
      },
      getTeachingOperationCourseOwnership: async () => ({
        teacherId: "teacher-kang",
        courseIds: [courseId],
      }),
      appendExternalTeachingOperation: async ({ record }) => {
        appendedOperations.push(record.recordId);
        return {
          teacherId: record.actorId,
          receiptId: record.recordId,
          status: "persisted",
          storagePolicy: "external-redacted-teaching-operation-append",
          storageWritePolicy: "external-append-only-operation-log",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
      now: new Date("2026-06-22T12:15:00.000Z"),
    });

    try {
      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-production-course-management-preflight",
          },
          body: JSON.stringify({
            operationId: "course-settings",
            actionSlot: "primary",
            courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "course-settings-course-management-preflight",
          }),
        }),
      );
      const body = await response.json();
      const operationDatabase = await readTeachingOperationDatabase({
        dataDir: operationsDataDir,
      });

      expect(response.status).toBe(503);
      expect(body.error).toBe(
        "Production teaching course management persistence requires external storage.",
      );
      expect(body.receipt).toBeUndefined();
      expect(body.partialFailure).toBeUndefined();
      expect(appendedOperations).toEqual([]);
      expect(operationDatabase.records).toHaveLength(0);
      expect(operationDatabase.auditEvents).toHaveLength(0);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("returns partial-failure recovery context when course settings domain persistence fails after operation persistence", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-course-domain-partial-"));
    const operationsDataDir = join(dataDir, "operations");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const courseId = "teacher-course-external-settings-course-20260622-121000";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-settings-domain-partial-failure-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:30:00.000Z",
      },
    });
    const persistedCourse = {
      courseId,
      ownerTeacherId: "teacher-kang",
      courseName: "External Settings Course",
      instructor: "Kang Xia",
      unit: "Guangzhou University 404",
      department: "Experimental Teaching Center",
      semester: "2026 Spring",
      status: "draft",
      students: 0,
      createdAt: "2026-06-22T12:00:00.000Z",
      updatedAt: "2026-06-22T12:00:00.000Z",
      storagePolicy: "external-redacted-teaching-course-management-snapshot",
      storageWritePolicy: "external-optimistic-snapshot-replace",
      responsibleSession: "S12",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    };
    const courseManagementRequests: Array<{
      method: string;
      url: string;
      authorization: string | null;
      body?: unknown;
    }> = [];
    const appendedOperations: Array<{ recordId: string; operationId: string; courseId?: string }> =
      [];
    const rollbackRequests: Array<{
      teacherId: string;
      targetRecordId: string;
      courseId: string;
      rollbackReason: string;
      traceId: string;
      requestedAt: string;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const pathname = new URL(String(url)).pathname;
      if (pathname !== "/uais/teaching-course-management/database") {
        return Response.json({ error: "unexpected external request" }, { status: 404 });
      }

      const rawBody = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      courseManagementRequests.push({
        method: init?.method ?? "GET",
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        ...(rawBody ? { body: rawBody } : {}),
      });

      if (init?.method === "GET") {
        return Response.json({
          database: {
            schemaVersion: "uais-teaching-course-management-v1",
            updatedAt: "2026-06-22T12:00:00.000Z",
            courses: [persistedCourse],
            classes: [],
            memberships: [],
            auditEvents: [],
          },
          revision: "rev-0",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      if (init?.method === "PUT") {
        return Response.json(
          { error: "Teaching course management persistence unavailable." },
          { status: 502 },
        );
      }

      return Response.json({ error: "unexpected external request" }, { status: 404 });
    };
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      fetch: fetchImpl,
      getTeachingOperationCourseOwnership: async () => ({
        teacherId: "teacher-kang",
        courseIds: [courseId],
      }),
      appendExternalTeachingOperation: async ({ record }) => {
        appendedOperations.push({
          recordId: record.recordId,
          operationId: record.operationId,
          ...(record.courseId ? { courseId: record.courseId } : {}),
        });
        return {
          teacherId: record.actorId,
          receiptId: record.recordId,
          status: "persisted",
          storagePolicy: "external-redacted-teaching-operation-append",
          storageWritePolicy: "external-append-only-operation-log",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
      rollbackExternalTeachingOperation: async (input) => {
        rollbackRequests.push({
          teacherId: input.teacherId,
          targetRecordId: input.targetRecordId,
          courseId: input.courseId,
          rollbackReason: input.rollbackReason,
          traceId: input.traceId,
          requestedAt: input.requestedAt,
        });
        return {
          teacherId: input.teacherId,
          rollbackId: `teaching-operation-rollback-${input.targetRecordId}`,
          targetRecordId: input.targetRecordId,
          courseId: input.courseId,
          status: "persisted",
          storagePolicy: "external-redacted-teaching-operation-rollback",
          storageWritePolicy: "external-append-only-rollback-log",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
      now: new Date("2026-06-22T12:10:00.000Z"),
    });

    try {
      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-production-course-settings-domain-partial-failure",
          },
          body: JSON.stringify({
            operationId: "course-settings",
            actionSlot: "primary",
            courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "course-settings-domain-partial-failure",
          }),
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(502);
      expect(body.error).toBe("External teaching course management persistence failed.");
      expect(appendedOperations).toHaveLength(1);
      expect(body.receipt).toEqual(
        expect.objectContaining({
          receiptId: appendedOperations[0]?.recordId,
          operationId: "course-settings",
          actionSlot: "primary",
          courseId,
          status: "persisted",
        }),
      );
      expect(body.partialFailure).toEqual(
        expect.objectContaining({
          status: "operation-persisted-course-management-domain-object-failed",
          failedStep: "course-management-domain-object",
          operationReceiptId: appendedOperations[0]?.recordId,
          operationId: "course-settings",
          actionSlot: "primary",
          courseId,
          rollbackRoute: `/api/teaching/operations/records/${appendedOperations[0]?.recordId}/rollback`,
          responsibleSession: "S12",
          compensation: expect.objectContaining({
            status: "rolled-back",
            action: "rollback-teaching-operation-record",
            rollbackReason: "course-management-domain-object-failed",
            receipt: expect.objectContaining({
              receiptId: `teaching-operation-rollback-${appendedOperations[0]?.recordId}`,
              action: "rollback-teaching-operation-record",
              actorId: "teacher-kang",
              courseId,
              targetRecordId: appendedOperations[0]?.recordId,
              traceId: "trace-production-course-settings-domain-partial-failure",
              rollbackReason: "course-management-domain-object-failed",
              status: "persisted",
              storagePolicy: "external-redacted-teaching-operation-rollback",
              storageWritePolicy: "external-append-only-rollback-log",
              responsibleSession: "S12",
            }),
          }),
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      );
      expect(rollbackRequests).toEqual([
        expect.objectContaining({
          teacherId: "teacher-kang",
          targetRecordId: appendedOperations[0]?.recordId,
          courseId,
          rollbackReason: "course-management-domain-object-failed",
          traceId: "trace-production-course-settings-domain-partial-failure",
          requestedAt: "2026-06-22T12:10:00.000Z",
        }),
      ]);
      expect(courseManagementRequests.map((request) => request.method)).toEqual(["GET", "PUT"]);
      expectNoLocalOrSecretValues(body, dataDir);
      expect(JSON.stringify(body)).not.toContain(externalToken);
      expect(JSON.stringify(body)).not.toContain("external-storage.example.test");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed when production course-management readback lacks a snapshot revision", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-course-revision-"));
    const operationsDataDir = join(dataDir, "operations");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const courseId = "teacher-course-external-revision-course-20260627-121000";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-settings-missing-revision-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-27T12:00:00.000Z",
        expiresAt: "2026-06-27T13:30:00.000Z",
      },
    });
    const persistedCourse = {
      courseId,
      ownerTeacherId: "teacher-kang",
      courseName: "External Revision Course",
      instructor: "Kang Xia",
      unit: "Guangzhou University 404",
      department: "Experimental Teaching Center",
      semester: "2026 Spring",
      status: "draft",
      students: 0,
      createdAt: "2026-06-27T12:00:00.000Z",
      updatedAt: "2026-06-27T12:00:00.000Z",
      storagePolicy: "external-redacted-teaching-course-management-snapshot",
      storageWritePolicy: "external-optimistic-snapshot-replace",
      responsibleSession: "S12",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    };
    const courseManagementRequests: Array<{
      method: string;
      url: string;
      authorization: string | null;
      body?: unknown;
    }> = [];
    const appendedOperations: Array<{ recordId: string; courseId?: string }> = [];
    const rollbackRequests: Array<{
      teacherId: string;
      targetRecordId: string;
      courseId: string;
      rollbackReason: string;
      traceId: string;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const pathname = new URL(String(url)).pathname;
      if (pathname !== "/uais/teaching-course-management/database") {
        return Response.json({ error: "unexpected external request" }, { status: 404 });
      }

      const rawBody = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      courseManagementRequests.push({
        method: init?.method ?? "GET",
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        ...(rawBody ? { body: rawBody } : {}),
      });

      if (init?.method === "GET") {
        return Response.json({
          database: {
            schemaVersion: "uais-teaching-course-management-v1",
            updatedAt: "2026-06-27T12:00:00.000Z",
            courses: [persistedCourse],
            classes: [],
            memberships: [],
            auditEvents: [],
          },
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      if (init?.method === "PUT") {
        return Response.json({
          status: "persisted",
          revision: "rev-after-blind-write",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          storageWritePolicy: "external-optimistic-snapshot-replace",
          productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      return Response.json({ error: "unexpected external request" }, { status: 404 });
    };
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      fetch: fetchImpl,
      getTeachingOperationCourseOwnership: async () => ({
        teacherId: "teacher-kang",
        courseIds: [courseId],
      }),
      appendExternalTeachingOperation: async ({ record }) => {
        appendedOperations.push({
          recordId: record.recordId,
          ...(record.courseId ? { courseId: record.courseId } : {}),
        });
        return {
          teacherId: record.actorId,
          receiptId: record.recordId,
          status: "persisted",
          storagePolicy: "external-redacted-teaching-operation-append",
          storageWritePolicy: "external-append-only-operation-log",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
      rollbackExternalTeachingOperation: async (input) => {
        rollbackRequests.push({
          teacherId: input.teacherId,
          targetRecordId: input.targetRecordId,
          courseId: input.courseId,
          rollbackReason: input.rollbackReason,
          traceId: input.traceId,
        });
        return {
          teacherId: input.teacherId,
          rollbackId: `teaching-operation-rollback-${input.targetRecordId}`,
          targetRecordId: input.targetRecordId,
          courseId: input.courseId,
          status: "persisted",
          storagePolicy: "external-redacted-teaching-operation-rollback",
          storageWritePolicy: "external-append-only-rollback-log",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
      now: new Date("2026-06-27T12:10:00.000Z"),
    });

    try {
      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-production-course-management-missing-revision",
          },
          body: JSON.stringify({
            operationId: "course-settings",
            actionSlot: "primary",
            courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "course-settings-missing-revision",
          }),
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(502);
      expect(body.error).toBe(
        "External teaching course management read acknowledgement is missing snapshot revision.",
      );
      expect(appendedOperations).toHaveLength(1);
      expect(body.partialFailure).toEqual(
        expect.objectContaining({
          status: "operation-persisted-course-management-domain-object-failed",
          failedStep: "course-management-domain-object",
          operationReceiptId: appendedOperations[0]?.recordId,
          courseId,
          compensation: expect.objectContaining({
            status: "rolled-back",
            action: "rollback-teaching-operation-record",
            rollbackReason: "course-management-domain-object-failed",
          }),
        }),
      );
      expect(rollbackRequests).toEqual([
        expect.objectContaining({
          teacherId: "teacher-kang",
          targetRecordId: appendedOperations[0]?.recordId,
          courseId,
          rollbackReason: "course-management-domain-object-failed",
          traceId: "trace-production-course-management-missing-revision",
        }),
      ]);
      expect(courseManagementRequests.map((request) => request.method)).toEqual(["GET"]);
      expectNoLocalOrSecretValues(body, dataDir);
      expect(JSON.stringify(body)).not.toContain(externalToken);
      expect(JSON.stringify(body)).not.toContain("external-storage.example.test");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed when production course-management write acknowledgement lacks a snapshot revision", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-course-write-revision-"));
    const operationsDataDir = join(dataDir, "operations");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const courseId = "teacher-course-external-write-revision-20260627-121500";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-settings-write-missing-revision-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-27T12:05:00.000Z",
        expiresAt: "2026-06-27T13:35:00.000Z",
      },
    });
    const persistedCourse = {
      courseId,
      ownerTeacherId: "teacher-kang",
      courseName: "External Write Revision Course",
      instructor: "Kang Xia",
      unit: "Guangzhou University 404",
      department: "Experimental Teaching Center",
      semester: "2026 Spring",
      status: "draft",
      students: 0,
      createdAt: "2026-06-27T12:05:00.000Z",
      updatedAt: "2026-06-27T12:05:00.000Z",
      storagePolicy: "external-redacted-teaching-course-management-snapshot",
      storageWritePolicy: "external-optimistic-snapshot-replace",
      responsibleSession: "S12",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    };
    const courseManagementRequests: Array<{
      method: string;
      url: string;
      authorization: string | null;
      body?: unknown;
    }> = [];
    const appendedOperations: Array<{ recordId: string; courseId?: string }> = [];
    const rollbackRequests: Array<{
      teacherId: string;
      targetRecordId: string;
      courseId: string;
      rollbackReason: string;
      traceId: string;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const pathname = new URL(String(url)).pathname;
      if (pathname !== "/uais/teaching-course-management/database") {
        return Response.json({ error: "unexpected external request" }, { status: 404 });
      }

      const rawBody = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      courseManagementRequests.push({
        method: init?.method ?? "GET",
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        ...(rawBody ? { body: rawBody } : {}),
      });

      if (init?.method === "GET") {
        return Response.json({
          database: {
            schemaVersion: "uais-teaching-course-management-v1",
            updatedAt: "2026-06-27T12:05:00.000Z",
            courses: [persistedCourse],
            classes: [],
            memberships: [],
            auditEvents: [],
          },
          revision: "rev-before-write",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      if (init?.method === "PUT") {
        return Response.json({
          status: "persisted",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          storageWritePolicy: "external-optimistic-snapshot-replace",
          productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      return Response.json({ error: "unexpected external request" }, { status: 404 });
    };
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      fetch: fetchImpl,
      getTeachingOperationCourseOwnership: async () => ({
        teacherId: "teacher-kang",
        courseIds: [courseId],
      }),
      appendExternalTeachingOperation: async ({ record }) => {
        appendedOperations.push({
          recordId: record.recordId,
          ...(record.courseId ? { courseId: record.courseId } : {}),
        });
        return {
          teacherId: record.actorId,
          receiptId: record.recordId,
          status: "persisted",
          storagePolicy: "external-redacted-teaching-operation-append",
          storageWritePolicy: "external-append-only-operation-log",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
      rollbackExternalTeachingOperation: async (input) => {
        rollbackRequests.push({
          teacherId: input.teacherId,
          targetRecordId: input.targetRecordId,
          courseId: input.courseId,
          rollbackReason: input.rollbackReason,
          traceId: input.traceId,
        });
        return {
          teacherId: input.teacherId,
          rollbackId: `teaching-operation-rollback-${input.targetRecordId}`,
          targetRecordId: input.targetRecordId,
          courseId: input.courseId,
          status: "persisted",
          storagePolicy: "external-redacted-teaching-operation-rollback",
          storageWritePolicy: "external-append-only-rollback-log",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
      now: new Date("2026-06-27T12:15:00.000Z"),
    });

    try {
      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-production-course-management-write-missing-revision",
          },
          body: JSON.stringify({
            operationId: "course-settings",
            actionSlot: "primary",
            courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "course-settings-write-missing-revision",
          }),
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(502);
      expect(body.error).toBe(
        "External teaching course management persistence acknowledgement is missing snapshot revision.",
      );
      expect(appendedOperations).toHaveLength(1);
      expect(body.partialFailure).toEqual(
        expect.objectContaining({
          status: "operation-persisted-course-management-domain-object-failed",
          failedStep: "course-management-domain-object",
          operationReceiptId: appendedOperations[0]?.recordId,
          courseId,
          compensation: expect.objectContaining({
            status: "rolled-back",
            action: "rollback-teaching-operation-record",
            rollbackReason: "course-management-domain-object-failed",
          }),
        }),
      );
      expect(rollbackRequests).toEqual([
        expect.objectContaining({
          teacherId: "teacher-kang",
          targetRecordId: appendedOperations[0]?.recordId,
          courseId,
          rollbackReason: "course-management-domain-object-failed",
          traceId: "trace-production-course-management-write-missing-revision",
        }),
      ]);
      expect(courseManagementRequests.map((request) => request.method)).toEqual(["GET", "PUT"]);
      expect(courseManagementRequests[1]?.body).toEqual(
        expect.objectContaining({
          expectedRevision: "rev-before-write",
        }),
      );
      expectNoLocalOrSecretValues(body, dataDir);
      expect(JSON.stringify(body)).not.toContain(externalToken);
      expect(JSON.stringify(body)).not.toContain("external-storage.example.test");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("writes student preview operations into the course management preview session object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-student-preview-domain-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-student-preview-domain-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:40:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T12:15:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Student Preview",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-student-preview-course",
        now: new Date("2026-06-22T12:07:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:08:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "user-agent": "UAIS student preview domain audit source test",
            "x-uais-trace-id": "trace-generate-student-preview-domain-object",
          },
          body: JSON.stringify({
            operationId: "course-settings",
            actionSlot: "secondary",
            courseId: course.courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "student-preview-domain-object-20260622",
          }),
        }),
      );
      const body = await response.json();
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const studentPreviewSessions = (
        courseDatabase as unknown as {
          studentPreviewSessions?: Array<Record<string, unknown>>;
        }
      ).studentPreviewSessions;

      expect(response.status).toBe(200);
      expect(body.studentPreviewSessionReceipt).toEqual(
        expect.objectContaining({
          action: "generate-student-preview-session",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-generate-student-preview-domain-object",
          status: "persisted",
        }),
      );
      expect(studentPreviewSessions).toEqual([
        expect.objectContaining({
          previewSessionId: `student-preview-session-${course.courseId}`,
          courseId: course.courseId,
          ownerTeacherId: "teacher-kang",
          previewedBy: "teacher-kang",
          previewStatus: "generated",
          operationRecordId: body.receipt.receiptId,
          sourceAction: "inline-teaching-workspace",
          previewId: "student-preview-20260622-121500",
          previewUrl: `/learning?teacherPreview=1&course=${course.courseId}`,
          previewScope: "teacher-course-preview",
          previewPolicy: "teacher-visible-preview-only",
          generatedAt: "2026-06-22T12:15:00.000Z",
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      ]);
      expect(courseDatabase.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "generate-student-preview-session",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-generate-student-preview-domain-object",
          requestSource: {
            userAgent: "UAIS student preview domain audit source test",
            ipAddress: "redacted",
          },
        }),
      );
      expectNoLocalOrSecretValues(studentPreviewSessions, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps student preview persistence idempotent on signed operation retries", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-route-student-preview-idempotent-"),
    );
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-student-preview-idempotent-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:40:00.000Z",
      },
    });
    const env = {
      UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
      UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
      UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    };

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Student Preview Idempotent",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-student-preview-idempotent-course",
        now: new Date("2026-06-22T12:07:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:08:00.000Z",
      });

      const requestBody = {
        operationId: "course-settings",
        actionSlot: "secondary",
        courseId: course.courseId,
        sourceAction: "inline-teaching-workspace",
        idempotencyKey: "student-preview-idempotent-20260622",
      };
      const firstPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T12:15:00.000Z"),
      });
      const secondPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T12:30:00.000Z"),
      });

      const firstResponse = await firstPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-student-preview-idempotent-first",
            "user-agent": "UAIS student preview idempotent first",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const firstBody = await firstResponse.json();
      const secondResponse = await secondPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-student-preview-idempotent-retry",
            "user-agent": "UAIS student preview idempotent retry",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const secondBody = await secondResponse.json();
      const operationDatabase = await readTeachingOperationDatabase({
        dataDir: operationsDataDir,
      });
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const savedCourse = courseDatabase.courses.find(
        (candidate) => candidate.courseId === course.courseId,
      );
      const studentPreviewSessions = (
        courseDatabase as unknown as {
          studentPreviewSessions?: Array<Record<string, unknown>>;
        }
      ).studentPreviewSessions;

      expect(firstResponse.status, JSON.stringify(firstBody)).toBe(200);
      expect(secondResponse.status, JSON.stringify(secondBody)).toBe(200);
      expect(firstBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "created",
          receiptId: secondBody.receipt.receiptId,
        }),
      );
      expect(secondBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "already-persisted",
          receiptId: firstBody.receipt.receiptId,
        }),
      );
      expect(savedCourse).toEqual(
        expect.objectContaining({
          courseId: course.courseId,
          updatedAt: "2026-06-22T12:15:00.000Z",
        }),
      );
      expect(studentPreviewSessions).toEqual([
        expect.objectContaining({
          previewSessionId: `student-preview-session-${course.courseId}`,
          operationRecordId: firstBody.receipt.receiptId,
          previewStatus: "generated",
          previewId: "student-preview-20260622-121500",
          previewUrl: `/learning?teacherPreview=1&course=${course.courseId}`,
          generatedAt: "2026-06-22T12:15:00.000Z",
        }),
      ]);
      expect(secondBody.studentPreviewSessionReceipt).toEqual(
        expect.objectContaining({
          action: "generate-student-preview-session",
          courseId: course.courseId,
          createdAt: "2026-06-22T12:15:00.000Z",
        }),
      );
      expect(operationDatabase.records).toHaveLength(1);
      expect(operationDatabase.auditEvents).toHaveLength(1);
      expect(
        courseDatabase.auditEvents.filter(
          (event) => event.action === "generate-student-preview-session",
        ),
      ).toEqual([
        expect.objectContaining({
          traceId: "trace-student-preview-idempotent-first",
          createdAt: "2026-06-22T12:15:00.000Z",
        }),
      ]);
      expect(JSON.stringify(courseDatabase)).not.toContain("trace-student-preview-idempotent-retry");
      expect(JSON.stringify(courseDatabase)).not.toContain(
        "UAIS student preview idempotent retry",
      );
      expectNoLocalOrSecretValues(studentPreviewSessions, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(firstBody, dataDir);
      expectNoLocalOrSecretValues(secondBody, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("writes student roster sync operations into the course management roster object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-student-roster-domain-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-student-roster-domain-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:30:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T12:20:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Student Roster",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-student-roster-course",
        now: new Date("2026-06-22T12:02:00.000Z"),
      });
      const { classItem } = await createTeachingClassRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        courseId: course.courseId,
        draft: {
          className: "Roster Sync Class",
        },
        traceId: "trace-create-enterprise-student-roster-class",
        now: new Date("2026-06-22T12:04:00.000Z"),
      });
      const firstJoin = await joinTeachingClassByInviteCode({
        dataDir: coursesDataDir,
        join: {
          invitationCode: classItem.invitationCode,
          studentId: "student-li",
          studentDisplayName: "Li Ming",
        },
        traceId: "trace-student-roster-first-join",
        now: new Date("2026-06-22T12:06:00.000Z"),
      });
      await joinTeachingClassByInviteCode({
        dataDir: coursesDataDir,
        join: {
          invitationCode: classItem.invitationCode,
          studentId: "student-chen",
          studentDisplayName: "Chen Yu",
        },
        traceId: "trace-student-roster-second-join",
        now: new Date("2026-06-22T12:07:00.000Z"),
      });
      await approveTeachingClassMembership({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        classId: classItem.classId,
        membershipId: firstJoin.membership.membershipId,
        traceId: "trace-student-roster-first-approve",
        now: new Date("2026-06-22T12:08:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:09:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-sync-student-roster-domain-object",
            "user-agent": "UAIS student roster domain audit source test",
          },
          body: JSON.stringify({
            operationId: "students",
            actionSlot: "primary",
            courseId: course.courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "student-roster-domain-object-20260622",
          }),
        }),
      );
      const body = await response.json();
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const studentRosters = (
        courseDatabase as unknown as {
          studentRosters?: Array<Record<string, unknown>>;
        }
      ).studentRosters;

      expect(response.status).toBe(200);
      expect(body.studentRosterSyncReceipt).toEqual(
        expect.objectContaining({
          action: "sync-student-roster",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-sync-student-roster-domain-object",
          status: "persisted",
        }),
      );
      expect(studentRosters).toEqual([
        expect.objectContaining({
          rosterId: `student-roster-${course.courseId}`,
          courseId: course.courseId,
          ownerTeacherId: "teacher-kang",
          syncedBy: "teacher-kang",
          syncStatus: "synced",
          operationRecordId: body.receipt.receiptId,
          sourceAction: "inline-teaching-workspace",
          approvedStudentCount: 1,
          pendingTeacherReviewCount: 1,
          classCount: 1,
          sourceSystems: ["sis-roster", "invite-code-joins", "withdrawals"],
          syncedAt: "2026-06-22T12:20:00.000Z",
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      ]);
      expect(courseDatabase.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "sync-student-roster",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-sync-student-roster-domain-object",
          requestSource: {
            userAgent: "UAIS student roster domain audit source test",
            ipAddress: "redacted",
          },
        }),
      );
      expectNoLocalOrSecretValues(studentRosters, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("syncs student roster operations through a configured SIS roster provider", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-student-roster-provider-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const studentRosterProviderToken = "secret-student-roster-provider-token-32";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-student-roster-provider-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:30:00.000Z",
      },
    });
    const providerRequests: Array<{
      url: string;
      authorization: string | null;
      body: Record<string, unknown>;
    }> = [];
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_STUDENT_ROSTER_SYNC_PROVIDER: "external",
        UAIS_STUDENT_ROSTER_SYNC_PROVIDER_URL:
          "https://sis.example.test/api/uais/student-roster-sync",
        UAIS_STUDENT_ROSTER_SYNC_PROVIDER_TOKEN: studentRosterProviderToken,
      },
      fetch: async (url, init) => {
        providerRequests.push({
          url: String(url),
          authorization: new Headers(init?.headers).get("authorization"),
          body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
        });
        return new Response(
          JSON.stringify({
            status: "synced",
            syncId: "sis-roster-sync-20260622",
            provider: "external-sis-roster",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
      now: new Date("2026-06-22T12:25:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Student Roster Provider",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-student-roster-provider-course",
        now: new Date("2026-06-22T12:02:00.000Z"),
      });
      const { classItem } = await createTeachingClassRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        courseId: course.courseId,
        draft: {
          className: "Roster Provider Class",
        },
        traceId: "trace-create-enterprise-student-roster-provider-class",
        now: new Date("2026-06-22T12:04:00.000Z"),
      });
      const firstJoin = await joinTeachingClassByInviteCode({
        dataDir: coursesDataDir,
        join: {
          invitationCode: classItem.invitationCode,
          studentId: "student-li",
          studentDisplayName: "Li Ming",
        },
        traceId: "trace-student-roster-provider-first-join",
        now: new Date("2026-06-22T12:06:00.000Z"),
      });
      await joinTeachingClassByInviteCode({
        dataDir: coursesDataDir,
        join: {
          invitationCode: classItem.invitationCode,
          studentId: "student-chen",
          studentDisplayName: "Chen Yu",
        },
        traceId: "trace-student-roster-provider-second-join",
        now: new Date("2026-06-22T12:07:00.000Z"),
      });
      await approveTeachingClassMembership({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        classId: classItem.classId,
        membershipId: firstJoin.membership.membershipId,
        traceId: "trace-student-roster-provider-first-approve",
        now: new Date("2026-06-22T12:08:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:09:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-sync-student-roster-provider",
            "user-agent": "UAIS student roster provider audit source test",
          },
          body: JSON.stringify({
            operationId: "students",
            actionSlot: "primary",
            courseId: course.courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "student-roster-provider-20260622",
          }),
        }),
      );
      const body = await response.json();
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const studentRosters = (
        courseDatabase as unknown as {
          studentRosters?: Array<Record<string, unknown>>;
        }
      ).studentRosters;

      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(providerRequests).toEqual([
        {
          url: "https://sis.example.test/api/uais/student-roster-sync",
          authorization: `Bearer ${studentRosterProviderToken}`,
          body: expect.objectContaining({
            action: "sync-student-roster",
            actorId: "teacher-kang",
            courseId: course.courseId,
            traceId: "trace-sync-student-roster-provider",
            operationRecordId: body.receipt.receiptId,
            rosterId: `student-roster-${course.courseId}`,
            approvedStudentCount: 1,
            pendingTeacherReviewCount: 1,
            classCount: 1,
            sourceSystems: ["sis-roster", "invite-code-joins", "withdrawals"],
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        },
      ]);
      expect(body.studentRosterProviderSyncReceipt).toEqual(
        expect.objectContaining({
          action: "sync-student-roster-provider",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-sync-student-roster-provider",
          status: "synced",
          providerStatus: "sis-provider-synced",
          providerSyncId: "sis-roster-sync-20260622",
          rosterId: `student-roster-${course.courseId}`,
        }),
      );
      expect(studentRosters).toEqual([
        expect.objectContaining({
          rosterId: `student-roster-${course.courseId}`,
          providerStatus: "sis-provider-synced",
          providerSyncId: "sis-roster-sync-20260622",
          providerSyncedAt: "2026-06-22T12:25:00.000Z",
        }),
      ]);
      expect(courseDatabase.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "sync-student-roster-provider",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-sync-student-roster-provider",
        }),
      );
      expect(JSON.stringify(body)).not.toContain(studentRosterProviderToken);
      expect(JSON.stringify(courseDatabase)).not.toContain(studentRosterProviderToken);
      expectNoLocalOrSecretValues(studentRosters, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("returns retryable partial-failure context when student roster provider sync fails after roster persistence", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-route-student-roster-provider-partial-failure-"),
    );
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const studentRosterProviderToken = "secret-student-roster-provider-token-32";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-student-roster-provider-partial-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:30:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_STUDENT_ROSTER_SYNC_PROVIDER: "external",
        UAIS_STUDENT_ROSTER_SYNC_PROVIDER_URL:
          "https://sis.example.test/api/uais/student-roster-sync",
        UAIS_STUDENT_ROSTER_SYNC_PROVIDER_TOKEN: studentRosterProviderToken,
      },
      fetch: async () =>
        Response.json(
          { error: "temporary SIS outage", provider: "external-sis-roster" },
          { status: 503 },
        ),
      now: new Date("2026-06-22T12:30:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Student Roster Provider Partial Failure",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-student-roster-provider-partial-course",
        now: new Date("2026-06-22T12:02:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:09:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-sync-student-roster-provider-partial-failure",
            "user-agent": "UAIS student roster provider partial failure test",
          },
          body: JSON.stringify({
            operationId: "students",
            actionSlot: "primary",
            courseId: course.courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "student-roster-provider-partial-failure-20260622",
          }),
        }),
      );
      const body = await response.json();
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const studentRosters = (
        courseDatabase as unknown as {
          studentRosters?: Array<Record<string, unknown>>;
        }
      ).studentRosters;

      expect(response.status, JSON.stringify(body)).toBe(502);
      expect(body.error).toBe("Student roster sync provider failed.");
      expect(body.studentRosterSyncReceipt).toEqual(
        expect.objectContaining({
          action: "sync-student-roster",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-sync-student-roster-provider-partial-failure",
        }),
      );
      expect(body.partialFailure).toEqual(
        expect.objectContaining({
          status: "operation-persisted-student-roster-provider-sync-failed",
          failedStep: "student-roster-provider-sync",
          operationReceiptId: body.receipt.receiptId,
          domainReceiptId: body.studentRosterSyncReceipt.receiptId,
          operationId: "students",
          actionSlot: "primary",
          courseId: course.courseId,
          providerStatus: "sis-provider-pending",
          recoveryAction: "retry-student-roster-sync-provider",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      );
      expect(studentRosters).toEqual([
        expect.objectContaining({
          rosterId: `student-roster-${course.courseId}`,
          operationRecordId: body.receipt.receiptId,
          syncStatus: "synced",
        }),
      ]);
      expect(studentRosters?.[0]).not.toHaveProperty("providerStatus");
      expect(JSON.stringify(body)).not.toContain(studentRosterProviderToken);
      expect(JSON.stringify(courseDatabase)).not.toContain(studentRosterProviderToken);
      expect(JSON.stringify(body)).not.toContain("sis.example.test");
      expectNoLocalOrSecretValues(studentRosters, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps student roster provider sync idempotent on signed operation retries", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-route-student-roster-provider-idempotent-"),
    );
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const studentRosterProviderToken = "secret-student-roster-provider-token-32";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-student-roster-provider-idempotent-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:30:00.000Z",
      },
    });
    const env = {
      UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
      UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
      UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      UAIS_STUDENT_ROSTER_SYNC_PROVIDER: "external",
      UAIS_STUDENT_ROSTER_SYNC_PROVIDER_URL:
        "https://sis.example.test/api/uais/student-roster-sync",
      UAIS_STUDENT_ROSTER_SYNC_PROVIDER_TOKEN: studentRosterProviderToken,
    };
    const providerRequests: Array<{
      url: string;
      authorization: string | null;
      body: Record<string, unknown>;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      providerRequests.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      });
      return new Response(
        JSON.stringify({
          status: "synced",
          syncId: `sis-roster-sync-${providerRequests.length}`,
          provider: "external-sis-roster",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Student Roster Provider Idempotent",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-student-roster-provider-idempotent-course",
        now: new Date("2026-06-22T12:02:00.000Z"),
      });
      const { classItem } = await createTeachingClassRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        courseId: course.courseId,
        draft: {
          className: "Roster Provider Idempotent Class",
        },
        traceId: "trace-create-enterprise-student-roster-provider-idempotent-class",
        now: new Date("2026-06-22T12:04:00.000Z"),
      });
      const firstJoin = await joinTeachingClassByInviteCode({
        dataDir: coursesDataDir,
        join: {
          invitationCode: classItem.invitationCode,
          studentId: "student-li",
          studentDisplayName: "Li Ming",
        },
        traceId: "trace-student-roster-provider-idempotent-first-join",
        now: new Date("2026-06-22T12:06:00.000Z"),
      });
      await approveTeachingClassMembership({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        classId: classItem.classId,
        membershipId: firstJoin.membership.membershipId,
        traceId: "trace-student-roster-provider-idempotent-first-approve",
        now: new Date("2026-06-22T12:08:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:09:00.000Z",
      });

      const requestBody = {
        operationId: "students",
        actionSlot: "primary",
        courseId: course.courseId,
        sourceAction: "inline-teaching-workspace",
        idempotencyKey: "student-roster-provider-idempotent-20260622",
      };
      const firstPostOperation = createTeachingOperationActionPostHandler({
        env,
        fetch: fetchImpl,
        now: new Date("2026-06-22T12:25:00.000Z"),
      });
      const secondPostOperation = createTeachingOperationActionPostHandler({
        env,
        fetch: fetchImpl,
        now: new Date("2026-06-22T12:45:00.000Z"),
      });

      const firstResponse = await firstPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-student-roster-provider-idempotent-first",
            "user-agent": "UAIS student roster provider idempotent first",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const firstBody = await firstResponse.json();
      const secondResponse = await secondPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-student-roster-provider-idempotent-retry",
            "user-agent": "UAIS student roster provider idempotent retry",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const secondBody = await secondResponse.json();
      const operationDatabase = await readTeachingOperationDatabase({
        dataDir: operationsDataDir,
      });
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const studentRosters = (
        courseDatabase as unknown as {
          studentRosters?: Array<Record<string, unknown>>;
        }
      ).studentRosters;

      expect(firstResponse.status, JSON.stringify(firstBody)).toBe(200);
      expect(secondResponse.status, JSON.stringify(secondBody)).toBe(200);
      expect(firstBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "created",
          receiptId: secondBody.receipt.receiptId,
        }),
      );
      expect(secondBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "already-persisted",
          receiptId: firstBody.receipt.receiptId,
        }),
      );
      expect(providerRequests).toEqual([
        {
          url: "https://sis.example.test/api/uais/student-roster-sync",
          authorization: `Bearer ${studentRosterProviderToken}`,
          body: expect.objectContaining({
            action: "sync-student-roster",
            actorId: "teacher-kang",
            courseId: course.courseId,
            traceId: "trace-student-roster-provider-idempotent-first",
            operationRecordId: firstBody.receipt.receiptId,
            rosterId: `student-roster-${course.courseId}`,
          }),
        },
      ]);
      expect(studentRosters).toEqual([
        expect.objectContaining({
          rosterId: `student-roster-${course.courseId}`,
          operationRecordId: firstBody.receipt.receiptId,
          providerStatus: "sis-provider-synced",
          providerSyncId: "sis-roster-sync-1",
          providerSyncedAt: "2026-06-22T12:25:00.000Z",
        }),
      ]);
      expect(operationDatabase.records).toHaveLength(1);
      expect(operationDatabase.auditEvents).toHaveLength(1);
      expect(
        courseDatabase.auditEvents.filter(
          (event) => event.action === "sync-student-roster-provider",
        ),
      ).toEqual([
        expect.objectContaining({
          traceId: "trace-student-roster-provider-idempotent-first",
          createdAt: "2026-06-22T12:25:00.000Z",
        }),
      ]);
      expect(JSON.stringify(courseDatabase)).not.toContain(
        "trace-student-roster-provider-idempotent-retry",
      );
      expect(JSON.stringify(courseDatabase)).not.toContain(
        "UAIS student roster provider idempotent retry",
      );
      expect(JSON.stringify(secondBody)).not.toContain(studentRosterProviderToken);
      expectNoLocalOrSecretValues(studentRosters, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(firstBody, dataDir);
      expectNoLocalOrSecretValues(secondBody, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps student roster sync persistence idempotent on signed operation retries", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-route-student-roster-idempotent-"),
    );
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-student-roster-idempotent-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:30:00.000Z",
      },
    });
    const env = {
      UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
      UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
      UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    };

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Student Roster Idempotent",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-student-roster-idempotent-course",
        now: new Date("2026-06-22T12:02:00.000Z"),
      });
      const { classItem } = await createTeachingClassRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        courseId: course.courseId,
        draft: {
          className: "Roster Idempotent Class",
        },
        traceId: "trace-create-enterprise-student-roster-idempotent-class",
        now: new Date("2026-06-22T12:04:00.000Z"),
      });
      const firstJoin = await joinTeachingClassByInviteCode({
        dataDir: coursesDataDir,
        join: {
          invitationCode: classItem.invitationCode,
          studentId: "student-li",
          studentDisplayName: "Li Ming",
        },
        traceId: "trace-student-roster-idempotent-first-join",
        now: new Date("2026-06-22T12:06:00.000Z"),
      });
      await joinTeachingClassByInviteCode({
        dataDir: coursesDataDir,
        join: {
          invitationCode: classItem.invitationCode,
          studentId: "student-chen",
          studentDisplayName: "Chen Yu",
        },
        traceId: "trace-student-roster-idempotent-second-join",
        now: new Date("2026-06-22T12:07:00.000Z"),
      });
      await approveTeachingClassMembership({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        classId: classItem.classId,
        membershipId: firstJoin.membership.membershipId,
        traceId: "trace-student-roster-idempotent-first-approve",
        now: new Date("2026-06-22T12:08:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:09:00.000Z",
      });

      const requestBody = {
        operationId: "students",
        actionSlot: "primary",
        courseId: course.courseId,
        sourceAction: "inline-teaching-workspace",
        idempotencyKey: "student-roster-idempotent-20260622",
      };
      const firstPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T12:20:00.000Z"),
      });
      const secondPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T12:35:00.000Z"),
      });

      const firstResponse = await firstPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-student-roster-idempotent-first",
            "user-agent": "UAIS student roster idempotent first",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const firstBody = await firstResponse.json();
      const secondResponse = await secondPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-student-roster-idempotent-retry",
            "user-agent": "UAIS student roster idempotent retry",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const secondBody = await secondResponse.json();
      const operationDatabase = await readTeachingOperationDatabase({
        dataDir: operationsDataDir,
      });
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const savedCourse = courseDatabase.courses.find(
        (candidate) => candidate.courseId === course.courseId,
      );
      const savedClass = courseDatabase.classes.find(
        (candidate) => candidate.classId === classItem.classId,
      );
      const studentRosters = (
        courseDatabase as unknown as {
          studentRosters?: Array<Record<string, unknown>>;
        }
      ).studentRosters;

      expect(firstResponse.status, JSON.stringify(firstBody)).toBe(200);
      expect(secondResponse.status, JSON.stringify(secondBody)).toBe(200);
      expect(firstBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "created",
          receiptId: secondBody.receipt.receiptId,
        }),
      );
      expect(secondBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "already-persisted",
          receiptId: firstBody.receipt.receiptId,
        }),
      );
      expect(savedCourse).toEqual(
        expect.objectContaining({
          courseId: course.courseId,
          students: 1,
          updatedAt: "2026-06-22T12:20:00.000Z",
        }),
      );
      expect(savedClass).toEqual(
        expect.objectContaining({
          classId: classItem.classId,
          students: 1,
          updatedAt: "2026-06-22T12:20:00.000Z",
        }),
      );
      expect(studentRosters).toEqual([
        expect.objectContaining({
          rosterId: `student-roster-${course.courseId}`,
          operationRecordId: firstBody.receipt.receiptId,
          approvedStudentCount: 1,
          pendingTeacherReviewCount: 1,
          classCount: 1,
          syncedAt: "2026-06-22T12:20:00.000Z",
        }),
      ]);
      expect(secondBody.studentRosterSyncReceipt).toEqual(
        expect.objectContaining({
          action: "sync-student-roster",
          courseId: course.courseId,
          createdAt: "2026-06-22T12:20:00.000Z",
        }),
      );
      expect(operationDatabase.records).toHaveLength(1);
      expect(operationDatabase.auditEvents).toHaveLength(1);
      expect(
        courseDatabase.auditEvents.filter((event) => event.action === "sync-student-roster"),
      ).toEqual([
        expect.objectContaining({
          traceId: "trace-student-roster-idempotent-first",
          createdAt: "2026-06-22T12:20:00.000Z",
        }),
      ]);
      expect(JSON.stringify(courseDatabase)).not.toContain(
        "trace-student-roster-idempotent-retry",
      );
      expect(JSON.stringify(courseDatabase)).not.toContain(
        "UAIS student roster idempotent retry",
      );
      expectNoLocalOrSecretValues(studentRosters, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(firstBody, dataDir);
      expectNoLocalOrSecretValues(secondBody, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps membership approval retries idempotent after the first teacher approval", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-membership-approve-idempotent-"));

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Membership Retry",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-membership-retry-course",
        now: new Date("2026-06-22T12:30:00.000Z"),
      });
      const { classItem } = await createTeachingClassRecord({
        dataDir,
        actorId: "teacher-kang",
        courseId: course.courseId,
        draft: {
          className: "Membership Retry Class",
        },
        traceId: "trace-create-enterprise-membership-retry-class",
        now: new Date("2026-06-22T12:31:00.000Z"),
      });
      const { membership } = await joinTeachingClassByInviteCode({
        dataDir,
        join: {
          invitationCode: classItem.invitationCode,
          studentId: "student-li",
          studentDisplayName: "Li Ming",
        },
        traceId: "trace-enterprise-membership-retry-join",
        now: new Date("2026-06-22T12:32:00.000Z"),
      });

      await approveTeachingClassMembership({
        dataDir,
        actorId: "teacher-kang",
        classId: classItem.classId,
        membershipId: membership.membershipId,
        traceId: "trace-enterprise-membership-first-approve",
        now: new Date("2026-06-22T12:33:00.000Z"),
      });
      const approvedDatabase = await readTeachingCourseManagementDatabase({ dataDir });

      const retry = await approveTeachingClassMembership({
        dataDir,
        actorId: "teacher-kang",
        classId: classItem.classId,
        membershipId: membership.membershipId,
        traceId: "trace-enterprise-membership-second-approve",
        now: new Date("2026-06-22T12:45:00.000Z"),
      });
      const retriedDatabase = await readTeachingCourseManagementDatabase({ dataDir });
      const approvalAuditEvents = retriedDatabase.auditEvents.filter(
        (event) => event.action === "approve-class-membership",
      );

      expect(retry.membership).toEqual(
        expect.objectContaining({
          membershipId: membership.membershipId,
          membershipStatus: "approved",
          approvedAt: "2026-06-22T12:33:00.000Z",
          approvedByTeacherId: "teacher-kang",
        }),
      );
      expect(retry.classItem).toEqual(
        expect.objectContaining({
          classId: classItem.classId,
          students: 1,
          updatedAt: "2026-06-22T12:33:00.000Z",
        }),
      );
      expect(retry.course).toEqual(
        expect.objectContaining({
          courseId: course.courseId,
          students: 1,
          updatedAt: "2026-06-22T12:33:00.000Z",
        }),
      );
      expect(retriedDatabase.classes).toEqual(approvedDatabase.classes);
      expect(retriedDatabase.courses).toEqual(approvedDatabase.courses);
      expect(approvalAuditEvents).toHaveLength(1);
      expect(approvalAuditEvents[0]).toEqual(
        expect.objectContaining({
          traceId: "trace-enterprise-membership-first-approve",
        }),
      );
      expectNoLocalOrSecretValues(retriedDatabase, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("writes generated group suggestions into the course management group suggestion object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-group-suggestion-domain-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-group-suggestion-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:10:00.000Z",
        expiresAt: "2026-06-22T13:10:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T12:15:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Group Suggestions",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-group-suggestion-course",
        now: new Date("2026-06-22T12:11:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:12:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "user-agent": "UAIS student group domain audit source test",
            "x-uais-trace-id": "trace-generate-group-suggestions-domain-object",
          },
          body: JSON.stringify({
            operationId: "students",
            actionSlot: "secondary",
            courseId: course.courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "group-suggestion-domain-object-20260622",
          }),
        }),
      );
      const body = await response.json();
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const studentGroupSuggestions = (
        courseDatabase as unknown as {
          studentGroupSuggestions?: Array<Record<string, unknown>>;
        }
      ).studentGroupSuggestions;

      expect(response.status).toBe(200);
      expect(body.studentGroupSuggestionReceipt).toEqual(
        expect.objectContaining({
          action: "generate-student-group-suggestions",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-generate-group-suggestions-domain-object",
          status: "persisted",
        }),
      );
      expect(studentGroupSuggestions).toEqual([
        expect.objectContaining({
          groupSuggestionId: `group-suggestion-${course.courseId}`,
          courseId: course.courseId,
          ownerTeacherId: "teacher-kang",
          generatedBy: "teacher-kang",
          suggestionStatus: "generated",
          operationRecordId: body.receipt.receiptId,
          sourceAction: "inline-teaching-workspace",
          suggestionScope: "teacher-editable-student-groups",
          sourceSignals: ["learning-progress", "participation-frequency", "role-preferences"],
          reviewPolicy: "teacher-review-before-group-assignment",
          generatedAt: "2026-06-22T12:15:00.000Z",
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      ]);
      expect(courseDatabase.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "generate-student-group-suggestions",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-generate-group-suggestions-domain-object",
          requestSource: {
            userAgent: "UAIS student group domain audit source test",
            ipAddress: "redacted",
          },
        }),
      );
      expectNoLocalOrSecretValues(studentGroupSuggestions, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps student group suggestion persistence idempotent on signed operation retries", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-route-group-suggestion-idempotent-"),
    );
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-group-suggestion-idempotent-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:10:00.000Z",
        expiresAt: "2026-06-22T13:40:00.000Z",
      },
    });
    const env = {
      UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
      UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
      UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    };

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Group Suggestions Idempotent",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-group-suggestion-idempotent-course",
        now: new Date("2026-06-22T12:11:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:12:00.000Z",
      });

      const requestBody = {
        operationId: "students",
        actionSlot: "secondary",
        courseId: course.courseId,
        sourceAction: "inline-teaching-workspace",
        idempotencyKey: "group-suggestion-idempotent-20260622",
      };
      const firstPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T12:15:00.000Z"),
      });
      const secondPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T12:30:00.000Z"),
      });

      const firstResponse = await firstPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-group-suggestion-idempotent-first",
            "user-agent": "UAIS group suggestion idempotent first",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const firstBody = await firstResponse.json();
      const secondResponse = await secondPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-group-suggestion-idempotent-retry",
            "user-agent": "UAIS group suggestion idempotent retry",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const secondBody = await secondResponse.json();
      const operationDatabase = await readTeachingOperationDatabase({
        dataDir: operationsDataDir,
      });
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const savedCourse = courseDatabase.courses.find(
        (candidate) => candidate.courseId === course.courseId,
      );
      const studentGroupSuggestions = (
        courseDatabase as unknown as {
          studentGroupSuggestions?: Array<Record<string, unknown>>;
        }
      ).studentGroupSuggestions;

      expect(firstResponse.status, JSON.stringify(firstBody)).toBe(200);
      expect(secondResponse.status, JSON.stringify(secondBody)).toBe(200);
      expect(firstBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "created",
          receiptId: secondBody.receipt.receiptId,
        }),
      );
      expect(secondBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "already-persisted",
          receiptId: firstBody.receipt.receiptId,
        }),
      );
      expect(savedCourse).toEqual(
        expect.objectContaining({
          courseId: course.courseId,
          updatedAt: "2026-06-22T12:15:00.000Z",
        }),
      );
      expect(studentGroupSuggestions).toEqual([
        expect.objectContaining({
          groupSuggestionId: `group-suggestion-${course.courseId}`,
          operationRecordId: firstBody.receipt.receiptId,
          suggestionStatus: "generated",
          suggestionScope: "teacher-editable-student-groups",
          sourceSignals: ["learning-progress", "participation-frequency", "role-preferences"],
          reviewPolicy: "teacher-review-before-group-assignment",
          generatedAt: "2026-06-22T12:15:00.000Z",
        }),
      ]);
      expect(secondBody.studentGroupSuggestionReceipt).toEqual(
        expect.objectContaining({
          action: "generate-student-group-suggestions",
          courseId: course.courseId,
          createdAt: "2026-06-22T12:15:00.000Z",
        }),
      );
      expect(operationDatabase.records).toHaveLength(1);
      expect(operationDatabase.auditEvents).toHaveLength(1);
      expect(
        courseDatabase.auditEvents.filter(
          (event) => event.action === "generate-student-group-suggestions",
        ),
      ).toEqual([
        expect.objectContaining({
          traceId: "trace-group-suggestion-idempotent-first",
          createdAt: "2026-06-22T12:15:00.000Z",
        }),
      ]);
      expect(JSON.stringify(courseDatabase)).not.toContain("trace-group-suggestion-idempotent-retry");
      expect(JSON.stringify(courseDatabase)).not.toContain(
        "UAIS group suggestion idempotent retry",
      );
      expectNoLocalOrSecretValues(studentGroupSuggestions, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(firstBody, dataDir);
      expectNoLocalOrSecretValues(secondBody, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("writes knowledge-base sync operations into the course management knowledge index object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-knowledge-index-domain-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-knowledge-index-domain-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:00:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T12:30:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Knowledge Index",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-knowledge-index-course",
        now: new Date("2026-06-22T12:22:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:23:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-sync-knowledge-index-domain-object",
            "user-agent": "UAIS knowledge index domain audit source test",
          },
          body: JSON.stringify({
            operationId: "knowledge-base",
            actionSlot: "primary",
            courseId: course.courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "knowledge-index-domain-object-20260622",
          }),
        }),
      );
      const body = await response.json();
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const knowledgeIndexes = (
        courseDatabase as unknown as {
          knowledgeIndexes?: Array<Record<string, unknown>>;
        }
      ).knowledgeIndexes;

      expect(response.status).toBe(200);
      expect(body.knowledgeIndexSyncReceipt).toEqual(
        expect.objectContaining({
          action: "sync-knowledge-index",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-sync-knowledge-index-domain-object",
          status: "persisted",
        }),
      );
      expect(knowledgeIndexes).toEqual([
        expect.objectContaining({
          indexId: `knowledge-index-${course.courseId}`,
          courseId: course.courseId,
          ownerTeacherId: "teacher-kang",
          syncedBy: "teacher-kang",
          syncStatus: "synced",
          operationRecordId: body.receipt.receiptId,
          sourceAction: "inline-teaching-workspace",
          sourceSystems: ["course-files", "teacher-resources", "agent-grounding-index"],
          syncedAt: "2026-06-22T12:30:00.000Z",
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      ]);
      expect(courseDatabase.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "sync-knowledge-index",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-sync-knowledge-index-domain-object",
          requestSource: {
            userAgent: "UAIS knowledge index domain audit source test",
            ipAddress: "redacted",
          },
        }),
      );
      expectNoLocalOrSecretValues(knowledgeIndexes, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps knowledge-base sync persistence idempotent on signed operation retries", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-route-knowledge-index-idempotent-"),
    );
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-knowledge-index-idempotent-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:10:00.000Z",
      },
    });
    const env = {
      UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
      UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
      UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    };

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Knowledge Index Idempotent",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-knowledge-index-idempotent-course",
        now: new Date("2026-06-22T12:22:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:23:00.000Z",
      });

      const requestBody = {
        operationId: "knowledge-base",
        actionSlot: "primary",
        courseId: course.courseId,
        sourceAction: "inline-teaching-workspace",
        idempotencyKey: "knowledge-index-idempotent-20260622",
      };
      const firstPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T12:30:00.000Z"),
      });
      const secondPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T12:45:00.000Z"),
      });

      const firstResponse = await firstPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-knowledge-index-idempotent-first",
            "user-agent": "UAIS knowledge index idempotent first",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const firstBody = await firstResponse.json();
      const secondResponse = await secondPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-knowledge-index-idempotent-retry",
            "user-agent": "UAIS knowledge index idempotent retry",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const secondBody = await secondResponse.json();
      const operationDatabase = await readTeachingOperationDatabase({
        dataDir: operationsDataDir,
      });
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const savedCourse = courseDatabase.courses.find(
        (candidate) => candidate.courseId === course.courseId,
      );
      const knowledgeIndexes = (
        courseDatabase as unknown as {
          knowledgeIndexes?: Array<Record<string, unknown>>;
        }
      ).knowledgeIndexes;

      expect(firstResponse.status, JSON.stringify(firstBody)).toBe(200);
      expect(secondResponse.status, JSON.stringify(secondBody)).toBe(200);
      expect(firstBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "created",
          receiptId: secondBody.receipt.receiptId,
        }),
      );
      expect(secondBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "already-persisted",
          receiptId: firstBody.receipt.receiptId,
        }),
      );
      expect(savedCourse).toEqual(
        expect.objectContaining({
          courseId: course.courseId,
          updatedAt: "2026-06-22T12:30:00.000Z",
        }),
      );
      expect(knowledgeIndexes).toEqual([
        expect.objectContaining({
          indexId: `knowledge-index-${course.courseId}`,
          operationRecordId: firstBody.receipt.receiptId,
          syncStatus: "synced",
          sourceSystems: ["course-files", "teacher-resources", "agent-grounding-index"],
          syncedAt: "2026-06-22T12:30:00.000Z",
        }),
      ]);
      expect(secondBody.knowledgeIndexSyncReceipt).toEqual(
        expect.objectContaining({
          action: "sync-knowledge-index",
          courseId: course.courseId,
          createdAt: "2026-06-22T12:30:00.000Z",
        }),
      );
      expect(operationDatabase.records).toHaveLength(1);
      expect(operationDatabase.auditEvents).toHaveLength(1);
      expect(
        courseDatabase.auditEvents.filter((event) => event.action === "sync-knowledge-index"),
      ).toEqual([
        expect.objectContaining({
          traceId: "trace-knowledge-index-idempotent-first",
          createdAt: "2026-06-22T12:30:00.000Z",
        }),
      ]);
      expect(JSON.stringify(courseDatabase)).not.toContain(
        "trace-knowledge-index-idempotent-retry",
      );
      expect(JSON.stringify(courseDatabase)).not.toContain(
        "UAIS knowledge index idempotent retry",
      );
      expectNoLocalOrSecretValues(knowledgeIndexes, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(firstBody, dataDir);
      expectNoLocalOrSecretValues(secondBody, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("syncs knowledge indexes through a configured external knowledge provider", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-knowledge-provider-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const knowledgeProviderToken = "secret-knowledge-provider-token-32";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-knowledge-provider-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:00:00.000Z",
      },
    });
    const providerRequests: Array<{
      url: string;
      authorization: string | null;
      method?: string;
      body?: unknown;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const requestBody =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      providerRequests.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        method: init?.method ?? "GET",
        ...(requestBody ? { body: requestBody } : {}),
      });
      return Response.json({
        status: "synced",
        syncId: "knowledge-provider-sync-20260622",
        provider: "external-knowledge-index",
      });
    };
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER: "external",
        UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_URL:
          "https://knowledge-provider.example.test/index/sync",
        UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_TOKEN: knowledgeProviderToken,
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T12:30:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Knowledge Provider",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-knowledge-provider-course",
        now: new Date("2026-06-22T12:22:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:23:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-knowledge-provider-sync",
            "user-agent": "UAIS knowledge provider sync test",
          },
          body: JSON.stringify({
            operationId: "knowledge-base",
            actionSlot: "primary",
            courseId: course.courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "knowledge-provider-sync-20260622",
          }),
        }),
      );
      const body = await response.json();
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const knowledgeIndexes = (
        courseDatabase as unknown as {
          knowledgeIndexes?: Array<Record<string, unknown>>;
        }
      ).knowledgeIndexes;

      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(providerRequests).toEqual([
        expect.objectContaining({
          url: "https://knowledge-provider.example.test/index/sync",
          authorization: `Bearer ${knowledgeProviderToken}`,
          method: "POST",
          body: expect.objectContaining({
            action: "sync-knowledge-index",
            actorId: "teacher-kang",
            courseId: course.courseId,
            traceId: "trace-knowledge-provider-sync",
            operationRecordId: body.receipt.receiptId,
            indexId: `knowledge-index-${course.courseId}`,
            syncStatus: "synced",
            sourceSystems: ["course-files", "teacher-resources", "agent-grounding-index"],
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        }),
      ]);
      expect(body.knowledgeIndexProviderSyncReceipt).toEqual(
        expect.objectContaining({
          action: "sync-knowledge-index-provider",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-knowledge-provider-sync",
          status: "synced",
          providerStatus: "knowledge-provider-synced",
          providerSyncId: "knowledge-provider-sync-20260622",
          indexId: `knowledge-index-${course.courseId}`,
        }),
      );
      expect(knowledgeIndexes).toEqual([
        expect.objectContaining({
          indexId: `knowledge-index-${course.courseId}`,
          courseId: course.courseId,
          operationRecordId: body.receipt.receiptId,
          syncStatus: "synced",
          providerStatus: "knowledge-provider-synced",
          providerSyncId: "knowledge-provider-sync-20260622",
          providerSyncedAt: "2026-06-22T12:30:00.000Z",
        }),
      ]);
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expect(JSON.stringify(body)).not.toContain(knowledgeProviderToken);
      expect(JSON.stringify(body)).not.toContain("knowledge-provider.example.test");
      expect(JSON.stringify(courseDatabase)).not.toContain(knowledgeProviderToken);
      expect(JSON.stringify(courseDatabase)).not.toContain("knowledge-provider.example.test");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("returns retryable partial-failure context when knowledge provider sync fails after index persistence", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-route-knowledge-provider-partial-failure-"),
    );
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const knowledgeProviderToken = "secret-knowledge-provider-token-32";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-knowledge-provider-partial-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:00:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER: "external",
        UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_URL:
          "https://knowledge-provider.example.test/index/sync",
        UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_TOKEN: knowledgeProviderToken,
      },
      fetch: async () =>
        Response.json(
          { error: "knowledge provider unavailable", provider: "external-knowledge-index" },
          { status: 503 },
        ),
      now: new Date("2026-06-22T12:35:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Knowledge Provider Partial Failure",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-knowledge-provider-partial-course",
        now: new Date("2026-06-22T12:22:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:23:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-knowledge-provider-partial-failure",
            "user-agent": "UAIS knowledge provider partial failure test",
          },
          body: JSON.stringify({
            operationId: "knowledge-base",
            actionSlot: "primary",
            courseId: course.courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "knowledge-provider-partial-failure-20260622",
          }),
        }),
      );
      const body = await response.json();
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const knowledgeIndexes = (
        courseDatabase as unknown as {
          knowledgeIndexes?: Array<Record<string, unknown>>;
        }
      ).knowledgeIndexes;

      expect(response.status, JSON.stringify(body)).toBe(502);
      expect(body.error).toBe("Knowledge index sync provider failed.");
      expect(body.knowledgeIndexSyncReceipt).toEqual(
        expect.objectContaining({
          action: "sync-knowledge-index",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-knowledge-provider-partial-failure",
        }),
      );
      expect(body.partialFailure).toEqual(
        expect.objectContaining({
          status: "operation-persisted-knowledge-index-provider-sync-failed",
          failedStep: "knowledge-index-provider-sync",
          operationReceiptId: body.receipt.receiptId,
          domainReceiptId: body.knowledgeIndexSyncReceipt.receiptId,
          operationId: "knowledge-base",
          actionSlot: "primary",
          courseId: course.courseId,
          providerStatus: "knowledge-provider-pending",
          recoveryAction: "retry-knowledge-index-sync-provider",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      );
      expect(knowledgeIndexes).toEqual([
        expect.objectContaining({
          indexId: `knowledge-index-${course.courseId}`,
          operationRecordId: body.receipt.receiptId,
          syncStatus: "synced",
        }),
      ]);
      expect(knowledgeIndexes?.[0]).not.toHaveProperty("providerStatus");
      expect(JSON.stringify(body)).not.toContain(knowledgeProviderToken);
      expect(JSON.stringify(courseDatabase)).not.toContain(knowledgeProviderToken);
      expect(JSON.stringify(body)).not.toContain("knowledge-provider.example.test");
      expectNoLocalOrSecretValues(knowledgeIndexes, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("writes resource placeholders into the course management resource review object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-resource-review-domain-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-resource-review-domain-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:05:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T12:35:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Resource Review",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-resource-review-course",
        now: new Date("2026-06-22T12:27:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:28:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "user-agent": "UAIS resource review domain audit source test",
            "x-uais-trace-id": "trace-queue-resource-review-domain-object",
          },
          body: JSON.stringify({
            operationId: "knowledge-base",
            actionSlot: "secondary",
            courseId: course.courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "resource-review-domain-object-20260622",
          }),
        }),
      );
      const body = await response.json();
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const resourceReviewItems = (
        courseDatabase as unknown as {
          resourceReviewItems?: Array<Record<string, unknown>>;
        }
      ).resourceReviewItems;

      expect(response.status).toBe(200);
      expect(body.resourceReviewItemReceipt).toEqual(
        expect.objectContaining({
          action: "queue-resource-review-item",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-queue-resource-review-domain-object",
          status: "persisted",
        }),
      );
      expect(resourceReviewItems).toEqual([
        expect.objectContaining({
          resourceReviewItemId: `resource-review-item-${course.courseId}`,
          courseId: course.courseId,
          ownerTeacherId: "teacher-kang",
          queuedBy: "teacher-kang",
          reviewStatus: "pending-teacher-review",
          operationRecordId: body.receipt.receiptId,
          sourceAction: "inline-teaching-workspace",
          resourceSource: "teacher-placeholder",
          reviewPolicy: "teacher-review-before-knowledge-index",
          queuedAt: "2026-06-22T12:35:00.000Z",
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      ]);
      expect(courseDatabase.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "queue-resource-review-item",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-queue-resource-review-domain-object",
          requestSource: {
            userAgent: "UAIS resource review domain audit source test",
            ipAddress: "redacted",
          },
        }),
      );
      expectNoLocalOrSecretValues(resourceReviewItems, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps resource review item persistence idempotent on signed operation retries", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-route-resource-review-idempotent-"),
    );
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-resource-review-idempotent-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:20:00.000Z",
      },
    });
    const env = {
      UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
      UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
      UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    };

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Resource Review Idempotent",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-resource-review-idempotent-course",
        now: new Date("2026-06-22T12:27:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:28:00.000Z",
      });

      const requestBody = {
        operationId: "knowledge-base",
        actionSlot: "secondary",
        courseId: course.courseId,
        sourceAction: "inline-teaching-workspace",
        idempotencyKey: "resource-review-idempotent-20260622",
      };
      const firstPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T12:35:00.000Z"),
      });
      const secondPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T12:50:00.000Z"),
      });

      const firstResponse = await firstPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-resource-review-idempotent-first",
            "user-agent": "UAIS resource review idempotent first",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const firstBody = await firstResponse.json();
      const secondResponse = await secondPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-resource-review-idempotent-retry",
            "user-agent": "UAIS resource review idempotent retry",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const secondBody = await secondResponse.json();
      const operationDatabase = await readTeachingOperationDatabase({
        dataDir: operationsDataDir,
      });
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const savedCourse = courseDatabase.courses.find(
        (candidate) => candidate.courseId === course.courseId,
      );
      const resourceReviewItems = (
        courseDatabase as unknown as {
          resourceReviewItems?: Array<Record<string, unknown>>;
        }
      ).resourceReviewItems;

      expect(firstResponse.status, JSON.stringify(firstBody)).toBe(200);
      expect(secondResponse.status, JSON.stringify(secondBody)).toBe(200);
      expect(firstBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "created",
          receiptId: secondBody.receipt.receiptId,
        }),
      );
      expect(secondBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "already-persisted",
          receiptId: firstBody.receipt.receiptId,
        }),
      );
      expect(savedCourse).toEqual(
        expect.objectContaining({
          courseId: course.courseId,
          updatedAt: "2026-06-22T12:35:00.000Z",
        }),
      );
      expect(resourceReviewItems).toEqual([
        expect.objectContaining({
          resourceReviewItemId: `resource-review-item-${course.courseId}`,
          operationRecordId: firstBody.receipt.receiptId,
          reviewStatus: "pending-teacher-review",
          resourceSource: "teacher-placeholder",
          reviewPolicy: "teacher-review-before-knowledge-index",
          queuedAt: "2026-06-22T12:35:00.000Z",
        }),
      ]);
      expect(secondBody.resourceReviewItemReceipt).toEqual(
        expect.objectContaining({
          action: "queue-resource-review-item",
          courseId: course.courseId,
          createdAt: "2026-06-22T12:35:00.000Z",
        }),
      );
      expect(operationDatabase.records).toHaveLength(1);
      expect(operationDatabase.auditEvents).toHaveLength(1);
      expect(
        courseDatabase.auditEvents.filter((event) => event.action === "queue-resource-review-item"),
      ).toEqual([
        expect.objectContaining({
          traceId: "trace-resource-review-idempotent-first",
          createdAt: "2026-06-22T12:35:00.000Z",
        }),
      ]);
      expect(JSON.stringify(courseDatabase)).not.toContain("trace-resource-review-idempotent-retry");
      expect(JSON.stringify(courseDatabase)).not.toContain(
        "UAIS resource review idempotent retry",
      );
      expectNoLocalOrSecretValues(resourceReviewItems, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(firstBody, dataDir);
      expectNoLocalOrSecretValues(secondBody, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("writes content publish operations into the course management content package object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-content-package-domain-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-content-package-domain-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:00:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T12:40:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Course Content",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-content-package-course",
        now: new Date("2026-06-22T12:32:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:33:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-publish-content-package-domain-object",
            "user-agent": "UAIS content publish domain audit source test",
          },
          body: JSON.stringify({
            operationId: "content",
            actionSlot: "primary",
            courseId: course.courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "content-package-domain-object-20260622",
          }),
        }),
      );
      const body = await response.json();
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const contentPackages = (
        courseDatabase as unknown as {
          contentPackages?: Array<Record<string, unknown>>;
        }
      ).contentPackages;

      expect(response.status).toBe(200);
      expect(body.courseContentPublishReceipt).toEqual(
        expect.objectContaining({
          action: "publish-course-content",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-publish-content-package-domain-object",
          status: "persisted",
        }),
      );
      expect(contentPackages).toEqual([
        expect.objectContaining({
          contentId: `course-content-${course.courseId}`,
          courseId: course.courseId,
          ownerTeacherId: "teacher-kang",
          publishedBy: "teacher-kang",
          publicationStatus: "published",
          operationRecordId: body.receipt.receiptId,
          sourceAction: "inline-teaching-workspace",
          releaseScope: "course-visible-content",
          publishedAt: "2026-06-22T12:40:00.000Z",
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      ]);
      expect(courseDatabase.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "publish-course-content",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-publish-content-package-domain-object",
          requestSource: {
            userAgent: "UAIS content publish domain audit source test",
            ipAddress: "redacted",
          },
        }),
      );
      expectNoLocalOrSecretValues(contentPackages, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps course content publish persistence idempotent on signed operation retries", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-route-content-publish-idempotent-"),
    );
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-content-publish-idempotent-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:30:00.000Z",
      },
    });
    const env = {
      UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
      UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
      UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    };

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Content Publish Idempotent",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-content-publish-idempotent-course",
        now: new Date("2026-06-22T12:32:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:33:00.000Z",
      });

      const requestBody = {
        operationId: "content",
        actionSlot: "primary",
        courseId: course.courseId,
        sourceAction: "inline-teaching-workspace",
        idempotencyKey: "content-publish-idempotent-20260622",
      };
      const firstPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T12:40:00.000Z"),
      });
      const secondPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T12:55:00.000Z"),
      });

      const firstResponse = await firstPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-content-publish-idempotent-first",
            "user-agent": "UAIS content publish idempotent first",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const firstBody = await firstResponse.json();
      const secondResponse = await secondPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-content-publish-idempotent-retry",
            "user-agent": "UAIS content publish idempotent retry",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const secondBody = await secondResponse.json();
      const operationDatabase = await readTeachingOperationDatabase({
        dataDir: operationsDataDir,
      });
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const savedCourse = courseDatabase.courses.find(
        (candidate) => candidate.courseId === course.courseId,
      );
      const contentPackages = (
        courseDatabase as unknown as {
          contentPackages?: Array<Record<string, unknown>>;
        }
      ).contentPackages;

      expect(firstResponse.status, JSON.stringify(firstBody)).toBe(200);
      expect(secondResponse.status, JSON.stringify(secondBody)).toBe(200);
      expect(firstBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "created",
          receiptId: secondBody.receipt.receiptId,
        }),
      );
      expect(secondBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "already-persisted",
          receiptId: firstBody.receipt.receiptId,
        }),
      );
      expect(savedCourse).toEqual(
        expect.objectContaining({
          courseId: course.courseId,
          updatedAt: "2026-06-22T12:40:00.000Z",
        }),
      );
      expect(contentPackages).toEqual([
        expect.objectContaining({
          contentId: `course-content-${course.courseId}`,
          courseId: course.courseId,
          operationRecordId: firstBody.receipt.receiptId,
          publicationStatus: "published",
          publishedAt: "2026-06-22T12:40:00.000Z",
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
        }),
      ]);
      expect(secondBody.courseContentPublishReceipt).toEqual(
        expect.objectContaining({
          action: "publish-course-content",
          courseId: course.courseId,
          createdAt: "2026-06-22T12:40:00.000Z",
        }),
      );
      expect(operationDatabase.records).toHaveLength(1);
      expect(operationDatabase.auditEvents).toHaveLength(1);
      expect(
        courseDatabase.auditEvents.filter((event) => event.action === "publish-course-content"),
      ).toEqual([
        expect.objectContaining({
          traceId: "trace-content-publish-idempotent-first",
          createdAt: "2026-06-22T12:40:00.000Z",
        }),
      ]);
      expect(JSON.stringify(courseDatabase)).not.toContain(
        "trace-content-publish-idempotent-retry",
      );
      expect(JSON.stringify(courseDatabase)).not.toContain(
        "UAIS content publish idempotent retry",
      );
      expectNoLocalOrSecretValues(contentPackages, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(firstBody, dataDir);
      expectNoLocalOrSecretValues(secondBody, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("publishes course content through a configured external content provider", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-content-provider-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const contentProviderToken = "secret-course-content-provider-token-32";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-content-provider-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:00:00.000Z",
      },
    });
    const providerRequests: Array<{
      url: string;
      authorization: string | null;
      method?: string;
      body?: unknown;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const requestBody =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      providerRequests.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        method: init?.method ?? "GET",
        ...(requestBody ? { body: requestBody } : {}),
      });
      return Response.json({
        status: "published",
        publishId: "content-provider-publish-20260622",
        provider: "external-content-lms",
      });
    };
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_COURSE_CONTENT_PUBLISH_PROVIDER: "external",
        UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_URL:
          "https://content-provider.example.test/course-content/publish",
        UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_TOKEN: contentProviderToken,
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T12:40:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Course Content Provider",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-content-provider-course",
        now: new Date("2026-06-22T12:32:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:33:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-course-content-provider-publish",
            "user-agent": "UAIS course content provider publish test",
          },
          body: JSON.stringify({
            operationId: "content",
            actionSlot: "primary",
            courseId: course.courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "course-content-provider-publish-20260622",
          }),
        }),
      );
      const body = await response.json();
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const contentPackages = (
        courseDatabase as unknown as {
          contentPackages?: Array<Record<string, unknown>>;
        }
      ).contentPackages;

      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(providerRequests).toEqual([
        expect.objectContaining({
          url: "https://content-provider.example.test/course-content/publish",
          authorization: `Bearer ${contentProviderToken}`,
          method: "POST",
          body: expect.objectContaining({
            action: "publish-course-content",
            actorId: "teacher-kang",
            courseId: course.courseId,
            traceId: "trace-course-content-provider-publish",
            operationRecordId: body.receipt.receiptId,
            contentId: `course-content-${course.courseId}`,
            releaseScope: "course-visible-content",
            publicationStatus: "published",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        }),
      ]);
      expect(body.courseContentProviderPublishReceipt).toEqual(
        expect.objectContaining({
          action: "publish-course-content-provider",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-course-content-provider-publish",
          status: "published",
          providerStatus: "content-provider-published",
          providerPublishId: "content-provider-publish-20260622",
          contentId: `course-content-${course.courseId}`,
        }),
      );
      expect(contentPackages).toEqual([
        expect.objectContaining({
          contentId: `course-content-${course.courseId}`,
          courseId: course.courseId,
          operationRecordId: body.receipt.receiptId,
          publicationStatus: "published",
          providerStatus: "content-provider-published",
          providerPublishId: "content-provider-publish-20260622",
          providerPublishedAt: "2026-06-22T12:40:00.000Z",
        }),
      ]);
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expect(JSON.stringify(body)).not.toContain(contentProviderToken);
      expect(JSON.stringify(body)).not.toContain("content-provider.example.test");
      expect(JSON.stringify(courseDatabase)).not.toContain(contentProviderToken);
      expect(JSON.stringify(courseDatabase)).not.toContain("content-provider.example.test");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("returns retryable partial-failure context when content provider publish fails after content persistence", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-route-content-provider-partial-failure-"),
    );
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const contentProviderToken = "secret-course-content-provider-token-32";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-content-provider-partial-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:00:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_COURSE_CONTENT_PUBLISH_PROVIDER: "external",
        UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_URL:
          "https://content-provider.example.test/course-content/publish",
        UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_TOKEN: contentProviderToken,
      },
      fetch: async () =>
        Response.json(
          { error: "content provider unavailable", provider: "external-content-lms" },
          { status: 503 },
        ),
      now: new Date("2026-06-22T12:42:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Content Provider Partial Failure",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-content-provider-partial-course",
        now: new Date("2026-06-22T12:32:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:33:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-course-content-provider-partial-failure",
            "user-agent": "UAIS content provider partial failure test",
          },
          body: JSON.stringify({
            operationId: "content",
            actionSlot: "primary",
            courseId: course.courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "course-content-provider-partial-failure-20260622",
          }),
        }),
      );
      const body = await response.json();
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const contentPackages = (
        courseDatabase as unknown as {
          contentPackages?: Array<Record<string, unknown>>;
        }
      ).contentPackages;

      expect(response.status, JSON.stringify(body)).toBe(502);
      expect(body.error).toBe("Course content publish provider failed.");
      expect(body.courseContentPublishReceipt).toEqual(
        expect.objectContaining({
          action: "publish-course-content",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-course-content-provider-partial-failure",
        }),
      );
      expect(body.partialFailure).toEqual(
        expect.objectContaining({
          status: "operation-persisted-course-content-provider-publish-failed",
          failedStep: "course-content-provider-publish",
          operationReceiptId: body.receipt.receiptId,
          domainReceiptId: body.courseContentPublishReceipt.receiptId,
          operationId: "content",
          actionSlot: "primary",
          courseId: course.courseId,
          providerStatus: "content-provider-pending",
          recoveryAction: "retry-course-content-publish-provider",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      );
      expect(contentPackages).toEqual([
        expect.objectContaining({
          contentId: `course-content-${course.courseId}`,
          operationRecordId: body.receipt.receiptId,
          publicationStatus: "published",
        }),
      ]);
      expect(contentPackages?.[0]).not.toHaveProperty("providerStatus");
      expect(JSON.stringify(body)).not.toContain(contentProviderToken);
      expect(JSON.stringify(courseDatabase)).not.toContain(contentProviderToken);
      expect(JSON.stringify(body)).not.toContain("content-provider.example.test");
      expectNoLocalOrSecretValues(contentPackages, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("writes generated unit drafts into the course management unit draft object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-unit-draft-domain-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-unit-draft-domain-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:00:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T12:45:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Unit Draft Course",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-unit-draft-course",
        now: new Date("2026-06-22T12:38:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:39:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "user-agent": "UAIS unit draft domain audit source test",
            "x-uais-trace-id": "trace-generate-unit-draft-domain-object",
          },
          body: JSON.stringify({
            operationId: "content",
            actionSlot: "secondary",
            courseId: course.courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "unit-draft-domain-object-20260622",
          }),
        }),
      );
      const body = await response.json();
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const courseUnitDrafts = (
        courseDatabase as unknown as {
          courseUnitDrafts?: Array<Record<string, unknown>>;
        }
      ).courseUnitDrafts;

      expect(response.status).toBe(200);
      expect(body.courseUnitDraftReceipt).toEqual(
        expect.objectContaining({
          action: "generate-course-unit-draft",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-generate-unit-draft-domain-object",
          status: "persisted",
        }),
      );
      expect(courseUnitDrafts).toEqual([
        expect.objectContaining({
          unitDraftId: `course-unit-draft-${course.courseId}`,
          courseId: course.courseId,
          ownerTeacherId: "teacher-kang",
          generatedBy: "teacher-kang",
          draftStatus: "generated",
          operationRecordId: body.receipt.receiptId,
          sourceAction: "inline-teaching-workspace",
          draftScope: "teacher-editable-unit-plan",
          sourceSystems: ["course-knowledge-index", "teaching-objectives", "quiz-bank"],
          reviewPolicy: "teacher-review-before-student-release",
          generatedAt: "2026-06-22T12:45:00.000Z",
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      ]);
      expect(courseDatabase.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "generate-course-unit-draft",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-generate-unit-draft-domain-object",
          requestSource: {
            userAgent: "UAIS unit draft domain audit source test",
            ipAddress: "redacted",
          },
        }),
      );
      expectNoLocalOrSecretValues(courseUnitDrafts, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps course unit draft persistence idempotent on signed operation retries", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-unit-draft-idempotent-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-unit-draft-idempotent-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:30:00.000Z",
      },
    });
    const env = {
      UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
      UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
      UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    };

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Unit Draft Idempotent",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-unit-draft-idempotent-course",
        now: new Date("2026-06-22T12:38:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:39:00.000Z",
      });

      const requestBody = {
        operationId: "content",
        actionSlot: "secondary",
        courseId: course.courseId,
        sourceAction: "inline-teaching-workspace",
        idempotencyKey: "unit-draft-idempotent-20260622",
      };
      const firstPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T12:45:00.000Z"),
      });
      const secondPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T13:00:00.000Z"),
      });

      const firstResponse = await firstPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-unit-draft-idempotent-first",
            "user-agent": "UAIS unit draft idempotent first",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const firstBody = await firstResponse.json();
      const secondResponse = await secondPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-unit-draft-idempotent-retry",
            "user-agent": "UAIS unit draft idempotent retry",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const secondBody = await secondResponse.json();
      const operationDatabase = await readTeachingOperationDatabase({
        dataDir: operationsDataDir,
      });
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const savedCourse = courseDatabase.courses.find(
        (candidate) => candidate.courseId === course.courseId,
      );
      const courseUnitDrafts = (
        courseDatabase as unknown as {
          courseUnitDrafts?: Array<Record<string, unknown>>;
        }
      ).courseUnitDrafts;

      expect(firstResponse.status, JSON.stringify(firstBody)).toBe(200);
      expect(secondResponse.status, JSON.stringify(secondBody)).toBe(200);
      expect(firstBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "created",
          receiptId: secondBody.receipt.receiptId,
        }),
      );
      expect(secondBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "already-persisted",
          receiptId: firstBody.receipt.receiptId,
        }),
      );
      expect(savedCourse).toEqual(
        expect.objectContaining({
          courseId: course.courseId,
          updatedAt: "2026-06-22T12:45:00.000Z",
        }),
      );
      expect(courseUnitDrafts).toEqual([
        expect.objectContaining({
          unitDraftId: `course-unit-draft-${course.courseId}`,
          operationRecordId: firstBody.receipt.receiptId,
          draftStatus: "generated",
          draftScope: "teacher-editable-unit-plan",
          sourceSystems: ["course-knowledge-index", "teaching-objectives", "quiz-bank"],
          reviewPolicy: "teacher-review-before-student-release",
          generatedAt: "2026-06-22T12:45:00.000Z",
        }),
      ]);
      expect(secondBody.courseUnitDraftReceipt).toEqual(
        expect.objectContaining({
          action: "generate-course-unit-draft",
          courseId: course.courseId,
          createdAt: "2026-06-22T12:45:00.000Z",
        }),
      );
      expect(operationDatabase.records).toHaveLength(1);
      expect(operationDatabase.auditEvents).toHaveLength(1);
      expect(
        courseDatabase.auditEvents.filter((event) => event.action === "generate-course-unit-draft"),
      ).toEqual([
        expect.objectContaining({
          traceId: "trace-unit-draft-idempotent-first",
          createdAt: "2026-06-22T12:45:00.000Z",
        }),
      ]);
      expect(JSON.stringify(courseDatabase)).not.toContain("trace-unit-draft-idempotent-retry");
      expect(JSON.stringify(courseDatabase)).not.toContain("UAIS unit draft idempotent retry");
      expectNoLocalOrSecretValues(courseUnitDrafts, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(firstBody, dataDir);
      expectNoLocalOrSecretValues(secondBody, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("writes dashboard refresh operations into the course management dashboard state object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-dashboard-state-domain-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-dashboard-state-domain-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:00:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T12:50:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Dashboard State",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-dashboard-state-course",
        now: new Date("2026-06-22T12:42:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:43:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-refresh-dashboard-state-domain-object",
            "user-agent": "UAIS dashboard refresh domain audit source test",
          },
          body: JSON.stringify({
            operationId: "dashboard",
            actionSlot: "primary",
            courseId: course.courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "dashboard-state-domain-object-20260622",
          }),
        }),
      );
      const body = await response.json();
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const dashboardStates = (
        courseDatabase as unknown as {
          dashboardStates?: Array<Record<string, unknown>>;
        }
      ).dashboardStates;

      expect(response.status).toBe(200);
      expect(body.dashboardRefreshReceipt).toEqual(
        expect.objectContaining({
          action: "refresh-dashboard",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-refresh-dashboard-state-domain-object",
          status: "persisted",
        }),
      );
      expect(dashboardStates).toEqual([
        expect.objectContaining({
          dashboardStateId: `dashboard-state-${course.courseId}`,
          courseId: course.courseId,
          ownerTeacherId: "teacher-kang",
          refreshedBy: "teacher-kang",
          refreshStatus: "refreshed",
          operationRecordId: body.receipt.receiptId,
          sourceAction: "inline-teaching-workspace",
          visibleMetrics: ["engagement", "progress", "assessment-quality"],
          refreshPolicy: "teacher-visible-course-dashboard",
          refreshedAt: "2026-06-22T12:50:00.000Z",
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      ]);
      expect(courseDatabase.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "refresh-dashboard",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-refresh-dashboard-state-domain-object",
          requestSource: {
            userAgent: "UAIS dashboard refresh domain audit source test",
            ipAddress: "redacted",
          },
        }),
      );
      expectNoLocalOrSecretValues(dashboardStates, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps dashboard refresh persistence idempotent on signed operation retries", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-route-dashboard-state-idempotent-"),
    );
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-dashboard-state-idempotent-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:30:00.000Z",
      },
    });
    const env = {
      UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
      UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
      UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    };

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Dashboard State Idempotent",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-dashboard-state-idempotent-course",
        now: new Date("2026-06-22T12:42:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:43:00.000Z",
      });

      const requestBody = {
        operationId: "dashboard",
        actionSlot: "primary",
        courseId: course.courseId,
        sourceAction: "inline-teaching-workspace",
        idempotencyKey: "dashboard-state-idempotent-20260622",
      };
      const firstPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T12:50:00.000Z"),
      });
      const secondPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T13:05:00.000Z"),
      });

      const firstResponse = await firstPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-dashboard-state-idempotent-first",
            "user-agent": "UAIS dashboard refresh idempotent first",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const firstBody = await firstResponse.json();
      const secondResponse = await secondPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-dashboard-state-idempotent-retry",
            "user-agent": "UAIS dashboard refresh idempotent retry",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const secondBody = await secondResponse.json();
      const operationDatabase = await readTeachingOperationDatabase({
        dataDir: operationsDataDir,
      });
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const savedCourse = courseDatabase.courses.find(
        (candidate) => candidate.courseId === course.courseId,
      );
      const dashboardStates = (
        courseDatabase as unknown as {
          dashboardStates?: Array<Record<string, unknown>>;
        }
      ).dashboardStates;

      expect(firstResponse.status, JSON.stringify(firstBody)).toBe(200);
      expect(secondResponse.status, JSON.stringify(secondBody)).toBe(200);
      expect(firstBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "created",
          receiptId: secondBody.receipt.receiptId,
        }),
      );
      expect(secondBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "already-persisted",
          receiptId: firstBody.receipt.receiptId,
        }),
      );
      expect(savedCourse).toEqual(
        expect.objectContaining({
          courseId: course.courseId,
          updatedAt: "2026-06-22T12:50:00.000Z",
        }),
      );
      expect(dashboardStates).toEqual([
        expect.objectContaining({
          dashboardStateId: `dashboard-state-${course.courseId}`,
          operationRecordId: firstBody.receipt.receiptId,
          refreshStatus: "refreshed",
          visibleMetrics: ["engagement", "progress", "assessment-quality"],
          refreshedAt: "2026-06-22T12:50:00.000Z",
        }),
      ]);
      expect(secondBody.dashboardRefreshReceipt).toEqual(
        expect.objectContaining({
          action: "refresh-dashboard",
          courseId: course.courseId,
          createdAt: "2026-06-22T12:50:00.000Z",
        }),
      );
      expect(operationDatabase.records).toHaveLength(1);
      expect(operationDatabase.auditEvents).toHaveLength(1);
      expect(
        courseDatabase.auditEvents.filter((event) => event.action === "refresh-dashboard"),
      ).toEqual([
        expect.objectContaining({
          traceId: "trace-dashboard-state-idempotent-first",
          createdAt: "2026-06-22T12:50:00.000Z",
        }),
      ]);
      expect(JSON.stringify(courseDatabase)).not.toContain(
        "trace-dashboard-state-idempotent-retry",
      );
      expect(JSON.stringify(courseDatabase)).not.toContain(
        "UAIS dashboard refresh idempotent retry",
      );
      expectNoLocalOrSecretValues(dashboardStates, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(firstBody, dataDir);
      expectNoLocalOrSecretValues(secondBody, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("writes dashboard snapshot operations into the course management dashboard snapshot object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-dashboard-snapshot-domain-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-dashboard-snapshot-domain-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:10:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T12:52:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Dashboard Snapshot",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-dashboard-snapshot-course",
        now: new Date("2026-06-22T12:44:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:45:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-lock-dashboard-snapshot-domain-object",
            "user-agent": "UAIS dashboard snapshot domain audit source test",
          },
          body: JSON.stringify({
            operationId: "dashboard",
            actionSlot: "secondary",
            courseId: course.courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "dashboard-snapshot-domain-object-20260622",
          }),
        }),
      );
      const body = await response.json();
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const dashboardSnapshots = (
        courseDatabase as unknown as {
          dashboardSnapshots?: Array<Record<string, unknown>>;
        }
      ).dashboardSnapshots;

      expect(response.status).toBe(200);
      expect(body.dashboardSnapshotReceipt).toEqual(
        expect.objectContaining({
          action: "lock-dashboard-snapshot",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-lock-dashboard-snapshot-domain-object",
          status: "persisted",
        }),
      );
      expect(dashboardSnapshots).toEqual([
        expect.objectContaining({
          dashboardSnapshotId: `dashboard-snapshot-${course.courseId}`,
          courseId: course.courseId,
          ownerTeacherId: "teacher-kang",
          lockedBy: "teacher-kang",
          snapshotStatus: "locked",
          operationRecordId: body.receipt.receiptId,
          sourceAction: "inline-teaching-workspace",
          teachingOperationSnapshotId: "daily-snapshot-20260622-125200",
          snapshotScope: "daily-course-dashboard",
          retentionPolicy: "teacher-locked-dashboard-snapshot",
          lockedAt: "2026-06-22T12:52:00.000Z",
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      ]);
      expect(courseDatabase.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "lock-dashboard-snapshot",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-lock-dashboard-snapshot-domain-object",
          requestSource: {
            userAgent: "UAIS dashboard snapshot domain audit source test",
            ipAddress: "redacted",
          },
        }),
      );
      expectNoLocalOrSecretValues(dashboardSnapshots, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps dashboard snapshot persistence idempotent on signed operation retries", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-route-dashboard-snapshot-idempotent-"),
    );
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-dashboard-snapshot-idempotent-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:30:00.000Z",
      },
    });
    const env = {
      UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
      UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
      UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    };

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Dashboard Snapshot Idempotent",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-dashboard-snapshot-idempotent-course",
        now: new Date("2026-06-22T12:44:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:45:00.000Z",
      });

      const requestBody = {
        operationId: "dashboard",
        actionSlot: "secondary",
        courseId: course.courseId,
        sourceAction: "inline-teaching-workspace",
        idempotencyKey: "dashboard-snapshot-idempotent-20260622",
      };
      const firstPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T12:52:00.000Z"),
      });
      const secondPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T13:07:00.000Z"),
      });

      const firstResponse = await firstPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-dashboard-snapshot-idempotent-first",
            "user-agent": "UAIS dashboard snapshot idempotent first",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const firstBody = await firstResponse.json();
      const secondResponse = await secondPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-dashboard-snapshot-idempotent-retry",
            "user-agent": "UAIS dashboard snapshot idempotent retry",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const secondBody = await secondResponse.json();
      const operationDatabase = await readTeachingOperationDatabase({
        dataDir: operationsDataDir,
      });
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const savedCourse = courseDatabase.courses.find(
        (candidate) => candidate.courseId === course.courseId,
      );
      const dashboardSnapshots = (
        courseDatabase as unknown as {
          dashboardSnapshots?: Array<Record<string, unknown>>;
        }
      ).dashboardSnapshots;

      expect(firstResponse.status, JSON.stringify(firstBody)).toBe(200);
      expect(secondResponse.status, JSON.stringify(secondBody)).toBe(200);
      expect(firstBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "created",
          receiptId: secondBody.receipt.receiptId,
        }),
      );
      expect(secondBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "already-persisted",
          receiptId: firstBody.receipt.receiptId,
        }),
      );
      expect(savedCourse).toEqual(
        expect.objectContaining({
          courseId: course.courseId,
          updatedAt: "2026-06-22T12:52:00.000Z",
        }),
      );
      expect(dashboardSnapshots).toEqual([
        expect.objectContaining({
          dashboardSnapshotId: `dashboard-snapshot-${course.courseId}`,
          operationRecordId: firstBody.receipt.receiptId,
          snapshotStatus: "locked",
          teachingOperationSnapshotId: "daily-snapshot-20260622-125200",
          snapshotScope: "daily-course-dashboard",
          retentionPolicy: "teacher-locked-dashboard-snapshot",
          lockedAt: "2026-06-22T12:52:00.000Z",
        }),
      ]);
      expect(secondBody.dashboardSnapshotReceipt).toEqual(
        expect.objectContaining({
          action: "lock-dashboard-snapshot",
          courseId: course.courseId,
          createdAt: "2026-06-22T12:52:00.000Z",
        }),
      );
      expect(operationDatabase.records).toHaveLength(1);
      expect(operationDatabase.auditEvents).toHaveLength(1);
      expect(
        courseDatabase.auditEvents.filter((event) => event.action === "lock-dashboard-snapshot"),
      ).toEqual([
        expect.objectContaining({
          traceId: "trace-dashboard-snapshot-idempotent-first",
          createdAt: "2026-06-22T12:52:00.000Z",
        }),
      ]);
      expect(JSON.stringify(courseDatabase)).not.toContain(
        "trace-dashboard-snapshot-idempotent-retry",
      );
      expect(JSON.stringify(courseDatabase)).not.toContain(
        "UAIS dashboard snapshot idempotent retry",
      );
      expectNoLocalOrSecretValues(dashboardSnapshots, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(firstBody, dataDir);
      expectNoLocalOrSecretValues(secondBody, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("writes admin setting operations into the course management admin settings object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-admin-settings-domain-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-admin-settings-domain-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:30:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T13:00:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Admin Settings",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-admin-settings-course",
        now: new Date("2026-06-22T12:52:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:53:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "user-agent": "UAIS admin settings domain audit source test",
            "x-uais-trace-id": "trace-save-admin-settings-domain-object",
          },
          body: JSON.stringify({
            operationId: "admins",
            actionSlot: "primary",
            courseId: course.courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "admin-settings-domain-object-20260622",
          }),
        }),
      );
      const body = await response.json();
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const adminSettings = (
        courseDatabase as unknown as {
          adminSettings?: Array<Record<string, unknown>>;
        }
      ).adminSettings;

      expect(response.status).toBe(200);
      expect(body.adminSettingsReceipt).toEqual(
        expect.objectContaining({
          action: "save-admin-settings",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-save-admin-settings-domain-object",
          status: "persisted",
        }),
      );
      expect(adminSettings).toEqual([
        expect.objectContaining({
          adminSettingsId: `admin-settings-${course.courseId}`,
          courseId: course.courseId,
          ownerTeacherId: "teacher-kang",
          savedBy: "teacher-kang",
          settingsStatus: "saved",
          operationRecordId: body.receipt.receiptId,
          sourceAction: "inline-teaching-workspace",
          adminScopes: ["course-collaborators", "permission-boundary", "audit-routing"],
          governancePolicy: "teacher-controlled-admin-settings",
          savedAt: "2026-06-22T13:00:00.000Z",
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      ]);
      expect(courseDatabase.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "save-admin-settings",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-save-admin-settings-domain-object",
          requestSource: {
            userAgent: "UAIS admin settings domain audit source test",
            ipAddress: "redacted",
          },
        }),
      );
      expectNoLocalOrSecretValues(adminSettings, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps admin settings persistence idempotent on signed operation retries", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-route-admin-settings-idempotent-"),
    );
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-admin-settings-idempotent-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:30:00.000Z",
      },
    });
    const env = {
      UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
      UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
      UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    };

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Admin Settings Idempotent",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-admin-settings-idempotent-course",
        now: new Date("2026-06-22T12:52:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:53:00.000Z",
      });

      const requestBody = {
        operationId: "admins",
        actionSlot: "primary",
        courseId: course.courseId,
        sourceAction: "inline-teaching-workspace",
        idempotencyKey: "admin-settings-idempotent-20260622",
      };
      const firstPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T13:00:00.000Z"),
      });
      const secondPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T13:15:00.000Z"),
      });

      const firstResponse = await firstPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-admin-settings-idempotent-first",
            "user-agent": "UAIS admin settings idempotent first",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const firstBody = await firstResponse.json();
      const secondResponse = await secondPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-admin-settings-idempotent-retry",
            "user-agent": "UAIS admin settings idempotent retry",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const secondBody = await secondResponse.json();
      const operationDatabase = await readTeachingOperationDatabase({
        dataDir: operationsDataDir,
      });
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const savedCourse = courseDatabase.courses.find(
        (candidate) => candidate.courseId === course.courseId,
      );
      const adminSettings = (
        courseDatabase as unknown as {
          adminSettings?: Array<Record<string, unknown>>;
        }
      ).adminSettings;

      expect(firstResponse.status, JSON.stringify(firstBody)).toBe(200);
      expect(secondResponse.status, JSON.stringify(secondBody)).toBe(200);
      expect(firstBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "created",
          receiptId: secondBody.receipt.receiptId,
        }),
      );
      expect(secondBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "already-persisted",
          receiptId: firstBody.receipt.receiptId,
        }),
      );
      expect(savedCourse).toEqual(
        expect.objectContaining({
          courseId: course.courseId,
          updatedAt: "2026-06-22T13:00:00.000Z",
        }),
      );
      expect(adminSettings).toEqual([
        expect.objectContaining({
          adminSettingsId: `admin-settings-${course.courseId}`,
          operationRecordId: firstBody.receipt.receiptId,
          settingsStatus: "saved",
          adminScopes: ["course-collaborators", "permission-boundary", "audit-routing"],
          savedAt: "2026-06-22T13:00:00.000Z",
        }),
      ]);
      expect(secondBody.adminSettingsReceipt).toEqual(
        expect.objectContaining({
          action: "save-admin-settings",
          courseId: course.courseId,
          createdAt: "2026-06-22T13:00:00.000Z",
        }),
      );
      expect(operationDatabase.records).toHaveLength(1);
      expect(operationDatabase.auditEvents).toHaveLength(1);
      expect(
        courseDatabase.auditEvents.filter((event) => event.action === "save-admin-settings"),
      ).toEqual([
        expect.objectContaining({
          traceId: "trace-admin-settings-idempotent-first",
          createdAt: "2026-06-22T13:00:00.000Z",
        }),
      ]);
      expect(JSON.stringify(courseDatabase)).not.toContain("trace-admin-settings-idempotent-retry");
      expect(JSON.stringify(courseDatabase)).not.toContain("UAIS admin settings idempotent retry");
      expectNoLocalOrSecretValues(adminSettings, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(firstBody, dataDir);
      expectNoLocalOrSecretValues(secondBody, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("writes agent setting operations into the course management agent settings object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-agent-settings-domain-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-agent-settings-domain-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:30:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T13:02:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Agent Settings",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-agent-settings-course",
        now: new Date("2026-06-22T12:54:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:55:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "user-agent": "UAIS agent settings domain audit source test",
            "x-uais-trace-id": "trace-save-agent-settings-domain-object",
          },
          body: JSON.stringify({
            operationId: "agents",
            actionSlot: "primary",
            courseId: course.courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "agent-settings-domain-object-20260622",
          }),
        }),
      );
      const body = await response.json();
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const agentSettings = (
        courseDatabase as unknown as {
          agentSettings?: Array<Record<string, unknown>>;
        }
      ).agentSettings;

      expect(response.status).toBe(200);
      expect(body.agentSettingsReceipt).toEqual(
        expect.objectContaining({
          action: "save-agent-settings",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-save-agent-settings-domain-object",
          status: "persisted",
        }),
      );
      expect(agentSettings).toEqual([
        expect.objectContaining({
          agentSettingsId: `agent-settings-${course.courseId}`,
          courseId: course.courseId,
          ownerTeacherId: "teacher-kang",
          savedBy: "teacher-kang",
          settingsStatus: "saved",
          operationRecordId: body.receipt.receiptId,
          sourceAction: "inline-teaching-workspace",
          agentScopes: ["research-agent", "method-agent", "writing-agent", "math-agent"],
          governancePolicy: "teacher-controlled-agent-settings",
          savedAt: "2026-06-22T13:02:00.000Z",
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      ]);
      expect(courseDatabase.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "save-agent-settings",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-save-agent-settings-domain-object",
          requestSource: {
            userAgent: "UAIS agent settings domain audit source test",
            ipAddress: "redacted",
          },
        }),
      );
      expectNoLocalOrSecretValues(agentSettings, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps agent settings persistence idempotent on signed operation retries", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-route-agent-settings-idempotent-"),
    );
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-agent-settings-idempotent-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:30:00.000Z",
      },
    });
    const env = {
      UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
      UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
      UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    };

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Agent Settings Idempotent",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-agent-settings-idempotent-course",
        now: new Date("2026-06-22T12:54:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:55:00.000Z",
      });

      const requestBody = {
        operationId: "agents",
        actionSlot: "primary",
        courseId: course.courseId,
        sourceAction: "inline-teaching-workspace",
        idempotencyKey: "agent-settings-idempotent-20260622",
      };
      const firstPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T13:02:00.000Z"),
      });
      const secondPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T13:17:00.000Z"),
      });

      const firstResponse = await firstPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-agent-settings-idempotent-first",
            "user-agent": "UAIS agent settings idempotent first",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const firstBody = await firstResponse.json();
      const secondResponse = await secondPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-agent-settings-idempotent-retry",
            "user-agent": "UAIS agent settings idempotent retry",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const secondBody = await secondResponse.json();
      const operationDatabase = await readTeachingOperationDatabase({
        dataDir: operationsDataDir,
      });
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const savedCourse = courseDatabase.courses.find(
        (candidate) => candidate.courseId === course.courseId,
      );
      const agentSettings = (
        courseDatabase as unknown as {
          agentSettings?: Array<Record<string, unknown>>;
        }
      ).agentSettings;

      expect(firstResponse.status, JSON.stringify(firstBody)).toBe(200);
      expect(secondResponse.status, JSON.stringify(secondBody)).toBe(200);
      expect(firstBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "created",
          receiptId: secondBody.receipt.receiptId,
        }),
      );
      expect(secondBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "already-persisted",
          receiptId: firstBody.receipt.receiptId,
        }),
      );
      expect(savedCourse).toEqual(
        expect.objectContaining({
          courseId: course.courseId,
          updatedAt: "2026-06-22T13:02:00.000Z",
        }),
      );
      expect(agentSettings).toEqual([
        expect.objectContaining({
          agentSettingsId: `agent-settings-${course.courseId}`,
          operationRecordId: firstBody.receipt.receiptId,
          settingsStatus: "saved",
          agentScopes: ["research-agent", "method-agent", "writing-agent", "math-agent"],
          savedAt: "2026-06-22T13:02:00.000Z",
        }),
      ]);
      expect(secondBody.agentSettingsReceipt).toEqual(
        expect.objectContaining({
          action: "save-agent-settings",
          courseId: course.courseId,
          createdAt: "2026-06-22T13:02:00.000Z",
        }),
      );
      expect(operationDatabase.records).toHaveLength(1);
      expect(operationDatabase.auditEvents).toHaveLength(1);
      expect(
        courseDatabase.auditEvents.filter((event) => event.action === "save-agent-settings"),
      ).toEqual([
        expect.objectContaining({
          traceId: "trace-agent-settings-idempotent-first",
          createdAt: "2026-06-22T13:02:00.000Z",
        }),
      ]);
      expect(JSON.stringify(courseDatabase)).not.toContain("trace-agent-settings-idempotent-retry");
      expect(JSON.stringify(courseDatabase)).not.toContain("UAIS agent settings idempotent retry");
      expectNoLocalOrSecretValues(agentSettings, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(firstBody, dataDir);
      expectNoLocalOrSecretValues(secondBody, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("writes agent permission preflight operations into the course management permission preflight object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-agent-preflight-domain-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-agent-preflight-domain-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:40:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T13:04:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Agent Permission Preflight",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-agent-preflight-course",
        now: new Date("2026-06-22T12:58:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:59:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "user-agent": "UAIS agent permission preflight domain audit source test",
            "x-uais-trace-id": "trace-run-agent-permission-preflight-domain-object",
          },
          body: JSON.stringify({
            operationId: "agents",
            actionSlot: "secondary",
            courseId: course.courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "agent-permission-preflight-domain-object-20260622",
          }),
        }),
      );
      const body = await response.json();
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const agentPermissionPreflights = (
        courseDatabase as unknown as {
          agentPermissionPreflights?: Array<Record<string, unknown>>;
        }
      ).agentPermissionPreflights;

      expect(response.status).toBe(200);
      expect(body.agentPermissionPreflightReceipt).toEqual(
        expect.objectContaining({
          action: "record-agent-permission-preflight",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-run-agent-permission-preflight-domain-object",
          status: "persisted",
        }),
      );
      expect(agentPermissionPreflights).toEqual([
        expect.objectContaining({
          preflightId: `agent-permission-preflight-${course.courseId}`,
          courseId: course.courseId,
          ownerTeacherId: "teacher-kang",
          checkedBy: "teacher-kang",
          preflightStatus: "passed",
          operationRecordId: body.receipt.receiptId,
          sourceAction: "inline-teaching-workspace",
          checkedPermissions: ["course-bindings", "agent-roles", "student-access"],
          preflightPolicy: "teacher-agent-permission-gate",
          checkedAt: "2026-06-22T13:04:00.000Z",
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      ]);
      expect(courseDatabase.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "record-agent-permission-preflight",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-run-agent-permission-preflight-domain-object",
          requestSource: {
            userAgent: "UAIS agent permission preflight domain audit source test",
            ipAddress: "redacted",
          },
        }),
      );
      expectNoLocalOrSecretValues(agentPermissionPreflights, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps agent permission preflight persistence idempotent on signed operation retries", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-route-agent-preflight-idempotent-"),
    );
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-agent-preflight-idempotent-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:40:00.000Z",
      },
    });
    const env = {
      UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
      UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
      UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    };

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Agent Preflight Idempotent",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-agent-preflight-idempotent-course",
        now: new Date("2026-06-22T12:58:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:59:00.000Z",
      });

      const requestBody = {
        operationId: "agents",
        actionSlot: "secondary",
        courseId: course.courseId,
        sourceAction: "inline-teaching-workspace",
        idempotencyKey: "agent-preflight-idempotent-20260622",
      };
      const firstPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T13:04:00.000Z"),
      });
      const secondPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T13:19:00.000Z"),
      });

      const firstResponse = await firstPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-agent-preflight-idempotent-first",
            "user-agent": "UAIS agent preflight idempotent first",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const firstBody = await firstResponse.json();
      const secondResponse = await secondPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-agent-preflight-idempotent-retry",
            "user-agent": "UAIS agent preflight idempotent retry",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const secondBody = await secondResponse.json();
      const operationDatabase = await readTeachingOperationDatabase({
        dataDir: operationsDataDir,
      });
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const savedCourse = courseDatabase.courses.find(
        (candidate) => candidate.courseId === course.courseId,
      );
      const agentPermissionPreflights = (
        courseDatabase as unknown as {
          agentPermissionPreflights?: Array<Record<string, unknown>>;
        }
      ).agentPermissionPreflights;

      expect(firstResponse.status, JSON.stringify(firstBody)).toBe(200);
      expect(secondResponse.status, JSON.stringify(secondBody)).toBe(200);
      expect(firstBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "created",
          receiptId: secondBody.receipt.receiptId,
        }),
      );
      expect(secondBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "already-persisted",
          receiptId: firstBody.receipt.receiptId,
        }),
      );
      expect(savedCourse).toEqual(
        expect.objectContaining({
          courseId: course.courseId,
          updatedAt: "2026-06-22T13:04:00.000Z",
        }),
      );
      expect(agentPermissionPreflights).toEqual([
        expect.objectContaining({
          preflightId: `agent-permission-preflight-${course.courseId}`,
          operationRecordId: firstBody.receipt.receiptId,
          preflightStatus: "passed",
          checkedPermissions: ["course-bindings", "agent-roles", "student-access"],
          checkedAt: "2026-06-22T13:04:00.000Z",
        }),
      ]);
      expect(secondBody.agentPermissionPreflightReceipt).toEqual(
        expect.objectContaining({
          action: "record-agent-permission-preflight",
          courseId: course.courseId,
          createdAt: "2026-06-22T13:04:00.000Z",
        }),
      );
      expect(operationDatabase.records).toHaveLength(1);
      expect(operationDatabase.auditEvents).toHaveLength(1);
      expect(
        courseDatabase.auditEvents.filter(
          (event) => event.action === "record-agent-permission-preflight",
        ),
      ).toEqual([
        expect.objectContaining({
          traceId: "trace-agent-preflight-idempotent-first",
          createdAt: "2026-06-22T13:04:00.000Z",
        }),
      ]);
      expect(JSON.stringify(courseDatabase)).not.toContain(
        "trace-agent-preflight-idempotent-retry",
      );
      expect(JSON.stringify(courseDatabase)).not.toContain(
        "UAIS agent preflight idempotent retry",
      );
      expectNoLocalOrSecretValues(agentPermissionPreflights, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(firstBody, dataDir);
      expectNoLocalOrSecretValues(secondBody, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("writes collaboration invite operations into the course management notification object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-admin-invite-domain-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-admin-invite-domain-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:40:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T13:05:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Collaboration Invite",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-admin-invite-course",
        now: new Date("2026-06-22T12:57:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:58:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-send-admin-invite-domain-object",
            "user-agent": "UAIS collaboration invite domain audit source test",
          },
          body: JSON.stringify({
            operationId: "admins",
            actionSlot: "secondary",
            courseId: course.courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "admin-invite-domain-object-20260622",
          }),
        }),
      );
      const body = await response.json();
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const collaborationInviteNotifications = (
        courseDatabase as unknown as {
          collaborationInviteNotifications?: Array<Record<string, unknown>>;
        }
      ).collaborationInviteNotifications;
      const outboxArtifact = body.receipt.artifacts.find(
        (artifact: { kind?: string; channel?: string }) =>
          artifact.kind === "outbox" && artifact.channel === "collaboration-invite",
      );

      expect(response.status).toBe(200);
      expect(body.collaborationInviteNotificationReceipt).toEqual(
        expect.objectContaining({
          action: "queue-collaboration-invite-notification",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-send-admin-invite-domain-object",
          status: "persisted",
        }),
      );
      expect(collaborationInviteNotifications).toEqual([
        expect.objectContaining({
          notificationId: `collaboration-invite-notification-${course.courseId}`,
          courseId: course.courseId,
          ownerTeacherId: "teacher-kang",
          queuedBy: "teacher-kang",
          notificationStatus: "queued-for-provider",
          operationRecordId: body.receipt.receiptId,
          sourceAction: "inline-teaching-workspace",
          outboxId: outboxArtifact.outboxId,
          deliveryChannel: "collaboration-invite-email",
          providerStatus: "smtp-provider-pending",
          deliveryPolicy: "server-outbox-before-smtp-provider",
          queuedAt: "2026-06-22T13:05:00.000Z",
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      ]);
      expect(courseDatabase.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "queue-collaboration-invite-notification",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-send-admin-invite-domain-object",
          requestSource: {
            userAgent: "UAIS collaboration invite domain audit source test",
            ipAddress: "redacted",
          },
        }),
      );
      expectNoLocalOrSecretValues(collaborationInviteNotifications, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("delivers collaboration invite notifications through a configured email provider", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-admin-email-provider-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const emailProviderToken = "secret-email-provider-token-with-32-chars";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-admin-email-provider-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T14:00:00.000Z",
      },
    });
    const providerRequests: Array<{
      url: string;
      authorization: string | null;
      body: Record<string, unknown>;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const rawBody = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      providerRequests.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        body: rawBody,
      });
      return new Response(
        JSON.stringify({
          status: "delivered",
          deliveryId: "email-delivery-collaboration-invite-20260622",
          provider: "external-email-gateway",
          acceptedAt: "2026-06-22T13:05:00.000Z",
          secret: "must-not-leak",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER: "external",
        UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_URL:
          "https://email.example.test/uais/collaboration-invite",
        UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN: emailProviderToken,
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T13:05:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Email Provider Invite",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-email-provider-course",
        now: new Date("2026-06-22T12:57:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:58:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "user-agent": "vitest collaboration invite delivery audit source",
            "x-uais-trace-id": "trace-send-admin-invite-email-provider",
          },
          body: JSON.stringify({
            operationId: "admins",
            actionSlot: "secondary",
            courseId: course.courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "admin-invite-email-provider-20260622",
          }),
        }),
      );
      const body = await response.json();
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const collaborationInviteNotifications = (
        courseDatabase as unknown as {
          collaborationInviteNotifications?: Array<Record<string, unknown>>;
        }
      ).collaborationInviteNotifications;
      const outboxArtifact = body.receipt.artifacts.find(
        (artifact: { kind?: string; channel?: string }) =>
          artifact.kind === "outbox" && artifact.channel === "collaboration-invite",
      );

      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(providerRequests).toEqual([
        {
          url: "https://email.example.test/uais/collaboration-invite",
          authorization: `Bearer ${emailProviderToken}`,
          body: expect.objectContaining({
            action: "deliver-collaboration-invite-email",
            actorId: "teacher-kang",
            courseId: course.courseId,
            traceId: "trace-send-admin-invite-email-provider",
            operationRecordId: body.receipt.receiptId,
            outboxId: outboxArtifact.outboxId,
            deliveryChannel: "collaboration-invite-email",
            templateId: "uais-collaboration-invite-v1",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        },
      ]);
      expect(body.collaborationInviteEmailDeliveryReceipt).toEqual(
        expect.objectContaining({
          action: "deliver-collaboration-invite-email",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-send-admin-invite-email-provider",
          status: "delivered",
          providerStatus: "smtp-provider-delivered",
          deliveryId: "email-delivery-collaboration-invite-20260622",
          outboxId: outboxArtifact.outboxId,
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      );
      expect(collaborationInviteNotifications).toEqual([
        expect.objectContaining({
          notificationId: `collaboration-invite-notification-${course.courseId}`,
          courseId: course.courseId,
          operationRecordId: body.receipt.receiptId,
          outboxId: outboxArtifact.outboxId,
          notificationStatus: "delivered-to-provider",
          providerStatus: "smtp-provider-delivered",
          providerDeliveryId: "email-delivery-collaboration-invite-20260622",
          deliveredAt: "2026-06-22T13:05:00.000Z",
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
        }),
      ]);
      expect(courseDatabase.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "deliver-collaboration-invite-email",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-send-admin-invite-email-provider",
          requestSource: {
            userAgent: "vitest collaboration invite delivery audit source",
            ipAddress: "redacted",
          },
        }),
      );
      expect(JSON.stringify(providerRequests)).not.toContain("must-not-leak");
      expect(JSON.stringify(body)).not.toContain(emailProviderToken);
      expect(JSON.stringify(body)).not.toContain("must-not-leak");
      expectNoLocalOrSecretValues(collaborationInviteNotifications, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps collaboration invite email delivery idempotent on signed operation retries", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-route-admin-email-idempotent-"),
    );
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const emailProviderToken = "secret-email-provider-token-with-32-chars";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-admin-email-idempotent-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T14:00:00.000Z",
      },
    });
    const env = {
      UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
      UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
      UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER: "external",
      UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_URL:
        "https://email.example.test/uais/collaboration-invite",
      UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN: emailProviderToken,
    };
    const providerRequests: Array<{
      url: string;
      authorization: string | null;
      body: Record<string, unknown>;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const rawBody = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      providerRequests.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        body: rawBody,
      });
      return new Response(
        JSON.stringify({
          status: "delivered",
          deliveryId: `email-delivery-collaboration-invite-${providerRequests.length}`,
          provider: "external-email-gateway",
          acceptedAt: "2026-06-22T13:05:00.000Z",
          secret: "must-not-leak",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Email Provider Idempotent Invite",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-email-idempotent-course",
        now: new Date("2026-06-22T12:57:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:58:00.000Z",
      });

      const requestBody = {
        operationId: "admins",
        actionSlot: "secondary",
        courseId: course.courseId,
        sourceAction: "inline-teaching-workspace",
        idempotencyKey: "admin-invite-email-idempotent-20260622",
      };
      const firstPostOperation = createTeachingOperationActionPostHandler({
        env,
        fetch: fetchImpl,
        now: new Date("2026-06-22T13:05:00.000Z"),
      });
      const secondPostOperation = createTeachingOperationActionPostHandler({
        env,
        fetch: fetchImpl,
        now: new Date("2026-06-22T13:15:00.000Z"),
      });

      const firstResponse = await firstPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-admin-invite-email-idempotent-first",
            "user-agent": "vitest collaboration invite idempotent first",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const firstBody = await firstResponse.json();
      const secondResponse = await secondPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-admin-invite-email-idempotent-retry",
            "user-agent": "vitest collaboration invite idempotent retry",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const secondBody = await secondResponse.json();
      const operationDatabase = await readTeachingOperationDatabase({
        dataDir: operationsDataDir,
      });
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const collaborationInviteNotifications = (
        courseDatabase as unknown as {
          collaborationInviteNotifications?: Array<Record<string, unknown>>;
        }
      ).collaborationInviteNotifications;
      const outboxArtifact = firstBody.receipt.artifacts.find(
        (artifact: { kind?: string; channel?: string }) =>
          artifact.kind === "outbox" && artifact.channel === "collaboration-invite",
      );

      expect(firstResponse.status, JSON.stringify(firstBody)).toBe(200);
      expect(secondResponse.status, JSON.stringify(secondBody)).toBe(200);
      expect(firstBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "created",
          receiptId: secondBody.receipt.receiptId,
        }),
      );
      expect(secondBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "already-persisted",
          receiptId: firstBody.receipt.receiptId,
        }),
      );
      expect(providerRequests).toEqual([
        {
          url: "https://email.example.test/uais/collaboration-invite",
          authorization: `Bearer ${emailProviderToken}`,
          body: expect.objectContaining({
            action: "deliver-collaboration-invite-email",
            actorId: "teacher-kang",
            courseId: course.courseId,
            traceId: "trace-admin-invite-email-idempotent-first",
            operationRecordId: firstBody.receipt.receiptId,
            outboxId: outboxArtifact.outboxId,
            deliveryChannel: "collaboration-invite-email",
            templateId: "uais-collaboration-invite-v1",
          }),
        },
      ]);
      expect(collaborationInviteNotifications).toEqual([
        expect.objectContaining({
          notificationId: `collaboration-invite-notification-${course.courseId}`,
          courseId: course.courseId,
          operationRecordId: firstBody.receipt.receiptId,
          outboxId: outboxArtifact.outboxId,
          notificationStatus: "delivered-to-provider",
          providerStatus: "smtp-provider-delivered",
          providerDeliveryId: "email-delivery-collaboration-invite-1",
          deliveredAt: "2026-06-22T13:05:00.000Z",
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
        }),
      ]);
      expect(operationDatabase.records).toHaveLength(1);
      expect(operationDatabase.auditEvents).toHaveLength(1);
      expect(
        courseDatabase.auditEvents.filter(
          (event) => event.action === "queue-collaboration-invite-notification",
        ),
      ).toEqual([
        expect.objectContaining({
          traceId: "trace-admin-invite-email-idempotent-first",
          createdAt: "2026-06-22T13:05:00.000Z",
        }),
      ]);
      expect(
        courseDatabase.auditEvents.filter(
          (event) => event.action === "deliver-collaboration-invite-email",
        ),
      ).toEqual([
        expect.objectContaining({
          traceId: "trace-admin-invite-email-idempotent-first",
          createdAt: "2026-06-22T13:05:00.000Z",
        }),
      ]);
      expect(JSON.stringify(courseDatabase)).not.toContain(
        "trace-admin-invite-email-idempotent-retry",
      );
      expect(JSON.stringify(courseDatabase)).not.toContain(
        "vitest collaboration invite idempotent retry",
      );
      expect(JSON.stringify(secondBody)).not.toContain(emailProviderToken);
      expect(JSON.stringify(secondBody)).not.toContain("must-not-leak");
      expectNoLocalOrSecretValues(collaborationInviteNotifications, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(firstBody, dataDir);
      expectNoLocalOrSecretValues(secondBody, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("returns partial-failure context when collaboration invite email delivery fails after outbox persistence", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-admin-email-partial-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const emailProviderToken = "secret-email-provider-token-with-32-chars";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-admin-email-provider-partial-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T14:00:00.000Z",
      },
    });
    const providerRequests: Array<{
      url: string;
      authorization: string | null;
      body: Record<string, unknown>;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const rawBody = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      providerRequests.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        body: rawBody,
      });
      return new Response(
        JSON.stringify({
          status: "rejected",
          provider: "external-email-gateway",
          secret: "must-not-leak",
        }),
        { status: 503, headers: { "content-type": "application/json" } },
      );
    };
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER: "external",
        UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_URL:
          "https://email.example.test/uais/collaboration-invite",
        UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN: emailProviderToken,
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T13:05:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Email Provider Partial Invite",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-email-provider-partial-course",
        now: new Date("2026-06-22T12:57:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:58:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-send-admin-invite-email-provider-partial",
          },
          body: JSON.stringify({
            operationId: "admins",
            actionSlot: "secondary",
            courseId: course.courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "admin-invite-email-provider-partial-20260622",
          }),
        }),
      );
      const body = await response.json();
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const collaborationInviteNotifications = (
        courseDatabase as unknown as {
          collaborationInviteNotifications?: Array<Record<string, unknown>>;
        }
      ).collaborationInviteNotifications;
      const outboxArtifact = body.receipt.artifacts.find(
        (artifact: { kind?: string; channel?: string }) =>
          artifact.kind === "outbox" && artifact.channel === "collaboration-invite",
      );

      expect(response.status, JSON.stringify(body)).toBe(502);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-send-admin-invite-email-provider-partial",
      );
      expect(providerRequests).toEqual([
        {
          url: "https://email.example.test/uais/collaboration-invite",
          authorization: `Bearer ${emailProviderToken}`,
          body: expect.objectContaining({
            action: "deliver-collaboration-invite-email",
            actorId: "teacher-kang",
            courseId: course.courseId,
            traceId: "trace-send-admin-invite-email-provider-partial",
            operationRecordId: body.receipt.receiptId,
            outboxId: outboxArtifact.outboxId,
            deliveryChannel: "collaboration-invite-email",
            templateId: "uais-collaboration-invite-v1",
          }),
        },
      ]);
      expect(body.error).toBe("Collaboration invite email provider delivery failed.");
      expect(body.receipt).toEqual(
        expect.objectContaining({
          operationId: "admins",
          actionSlot: "secondary",
          actorId: "teacher-kang",
          courseId: course.courseId,
          status: "persisted",
        }),
      );
      expect(body.collaborationInviteNotificationReceipt).toEqual(
        expect.objectContaining({
          action: "queue-collaboration-invite-notification",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-send-admin-invite-email-provider-partial",
          status: "persisted",
        }),
      );
      expect(body.partialFailure).toEqual(
        expect.objectContaining({
          status: "operation-persisted-collaboration-invite-email-delivery-failed",
          failedStep: "collaboration-invite-email-delivery",
          operationReceiptId: body.receipt.receiptId,
          notificationReceiptId: body.collaborationInviteNotificationReceipt.receiptId,
          operationId: "admins",
          actionSlot: "secondary",
          courseId: course.courseId,
          outboxId: outboxArtifact.outboxId,
          providerStatus: "smtp-provider-pending",
          recoveryAction: "retry-collaboration-invite-email-provider",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      );
      expect(collaborationInviteNotifications).toEqual([
        expect.objectContaining({
          notificationId: `collaboration-invite-notification-${course.courseId}`,
          courseId: course.courseId,
          operationRecordId: body.receipt.receiptId,
          outboxId: outboxArtifact.outboxId,
          notificationStatus: "queued-for-provider",
          providerStatus: "smtp-provider-pending",
          deliveryPolicy: "server-outbox-before-smtp-provider",
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
        }),
      ]);
      expect(courseDatabase.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "queue-collaboration-invite-notification",
          traceId: "trace-send-admin-invite-email-provider-partial",
        }),
      );
      expect(courseDatabase.auditEvents).not.toContainEqual(
        expect.objectContaining({
          action: "deliver-collaboration-invite-email",
          traceId: "trace-send-admin-invite-email-provider-partial",
        }),
      );
      expect(JSON.stringify(body)).not.toContain(emailProviderToken);
      expect(JSON.stringify(body)).not.toContain("must-not-leak");
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(collaborationInviteNotifications, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("records bounced collaboration invite email delivery callbacks", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-admin-email-callback-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const emailProviderToken = "secret-email-provider-token-with-32-chars";
    const callbackToken = "secret-email-callback-token-with-32-chars";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-admin-email-callback-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T14:00:00.000Z",
      },
    });
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          status: "delivered",
          deliveryId: "email-delivery-collaboration-invite-callback-20260622",
          provider: "external-email-gateway",
          secret: "must-not-leak",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER: "external",
        UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_URL:
          "https://email.example.test/uais/collaboration-invite",
        UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN: emailProviderToken,
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T13:05:00.000Z"),
    });
    const { createTeachingCollaborationInviteEmailDeliveryCallbackPostHandler } =
      await import(
        "@/app/api/teaching/operations/collaboration-invite-deliveries/route"
      );
    const postCallback = createTeachingCollaborationInviteEmailDeliveryCallbackPostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_COLLABORATION_INVITE_EMAIL_CALLBACK_TOKEN: callbackToken,
      },
      now: new Date("2026-06-22T13:09:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Email Callback Invite",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-email-callback-course",
        now: new Date("2026-06-22T12:57:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T12:58:00.000Z",
      });

      const operationResponse = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-send-admin-invite-email-callback",
          },
          body: JSON.stringify({
            operationId: "admins",
            actionSlot: "secondary",
            courseId: course.courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "admin-invite-email-callback-20260622",
          }),
        }),
      );
      const operationBody = await operationResponse.json();
      const outboxArtifact = operationBody.receipt.artifacts.find(
        (artifact: { kind?: string; channel?: string }) =>
          artifact.kind === "outbox" && artifact.channel === "collaboration-invite",
      );

      const callbackResponse = await postCallback(
        new Request(
          "https://www.uais.top/api/teaching/operations/collaboration-invite-deliveries",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${callbackToken}`,
              "user-agent": "vitest /Users/dongpinhu/secret-token callback audit source",
              "x-uais-trace-id": "trace-email-provider-bounce-callback",
            },
            body: JSON.stringify({
              eventType: "collaboration-invite-email.delivery-status",
              courseId: course.courseId,
              operationRecordId: operationBody.receipt.receiptId,
              outboxId: outboxArtifact.outboxId,
              deliveryId: "email-delivery-collaboration-invite-callback-20260622",
              providerStatus: "bounced",
              occurredAt: "2026-06-22T13:09:00.000Z",
              failureReason: "mailbox-unavailable",
              secret: "must-not-leak",
            }),
          },
        ),
      );
      const callbackBody = await callbackResponse.json();
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const collaborationInviteNotifications = (
        courseDatabase as unknown as {
          collaborationInviteNotifications?: Array<Record<string, unknown>>;
        }
      ).collaborationInviteNotifications;

      expect(callbackResponse.status, JSON.stringify(callbackBody)).toBe(200);
      expect(callbackBody.collaborationInviteEmailDeliveryCallbackReceipt).toEqual(
        expect.objectContaining({
          action: "record-collaboration-invite-email-delivery-callback",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-email-provider-bounce-callback",
          status: "persisted",
          deliveryStatus: "failed",
          providerStatus: "smtp-provider-bounced",
          deliveryId: "email-delivery-collaboration-invite-callback-20260622",
          outboxId: outboxArtifact.outboxId,
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      );
      expect(collaborationInviteNotifications).toEqual([
        expect.objectContaining({
          notificationId: `collaboration-invite-notification-${course.courseId}`,
          courseId: course.courseId,
          operationRecordId: operationBody.receipt.receiptId,
          outboxId: outboxArtifact.outboxId,
          notificationStatus: "delivery-failed",
          providerStatus: "smtp-provider-bounced",
          providerDeliveryId: "email-delivery-collaboration-invite-callback-20260622",
          deliveryFailureReason: "mailbox-unavailable",
          providerCallbackAt: "2026-06-22T13:09:00.000Z",
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
        }),
      ]);
      expect(courseDatabase.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "record-collaboration-invite-email-delivery-callback",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-email-provider-bounce-callback",
          requestSource: {
            userAgent: "redacted",
            ipAddress: "redacted",
          },
        }),
      );
      expect(JSON.stringify(callbackBody)).not.toContain(callbackToken);
      expect(JSON.stringify(callbackBody)).not.toContain("must-not-leak");
      expectNoLocalOrSecretValues(callbackBody, dataDir);
      expectNoLocalOrSecretValues(collaborationInviteNotifications, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("writes export operations into the course management export manifest object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-export-manifest-domain-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-export-manifest-domain-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:40:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T13:10:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Export Manifest",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-export-manifest-course",
        now: new Date("2026-06-22T13:02:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T13:03:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "user-agent": "UAIS export manifest audit source test",
            "x-uais-trace-id": "trace-create-export-manifest-domain-object",
          },
          body: JSON.stringify({
            operationId: "data-export",
            actionSlot: "primary",
            courseId: course.courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "export-manifest-domain-object-20260622",
          }),
        }),
      );
      const body = await response.json();
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const exportManifests = (
        courseDatabase as unknown as {
          exportManifests?: Array<Record<string, unknown>>;
        }
      ).exportManifests;

      expect(response.status).toBe(200);
      expect(body.courseExportManifestReceipt).toEqual(
        expect.objectContaining({
          action: "create-export-manifest",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-create-export-manifest-domain-object",
          status: "persisted",
        }),
      );
      expect(exportManifests).toEqual([
        expect.objectContaining({
          exportManifestId: `export-manifest-${course.courseId}`,
          courseId: course.courseId,
          ownerTeacherId: "teacher-kang",
          createdBy: "teacher-kang",
          exportStatus: "generated",
          operationRecordId: body.receipt.receiptId,
          sourceAction: "inline-teaching-workspace",
          teachingOperationManifestId: "export-manifest-teacher-kang-20260622-131000",
          downloadRoute: "/api/teaching/operations/export/export-manifest-teacher-kang-20260622-131000",
          datasetScopes: ["learning-records", "chat-threads", "grades", "activities"],
          formats: ["json", "csv"],
          exportPolicy: "redacted-teacher-export-manifest",
          createdAt: "2026-06-22T13:10:00.000Z",
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      ]);
      expect(courseDatabase.auditEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: "create-export-manifest",
            actorId: "teacher-kang",
            actorRole: "teacher",
            authMode: "signed-teacher-session",
            courseId: course.courseId,
            traceId: "trace-create-export-manifest-domain-object",
            requestSource: {
              userAgent: "UAIS export manifest audit source test",
              ipAddress: "redacted",
            },
            storagePolicy: "local-json-teaching-course-management-audit-log",
          }),
        ]),
      );
      expectNoLocalOrSecretValues(exportManifests, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps export manifest persistence idempotent on signed operation retries", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-route-export-manifest-idempotent-"),
    );
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-export-manifest-idempotent-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:50:00.000Z",
      },
    });
    const env = {
      UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
      UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
      UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    };

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Export Manifest Idempotent",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-export-manifest-idempotent-course",
        now: new Date("2026-06-22T13:02:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T13:03:00.000Z",
      });

      const requestBody = {
        operationId: "data-export",
        actionSlot: "primary",
        courseId: course.courseId,
        sourceAction: "inline-teaching-workspace",
        idempotencyKey: "export-manifest-idempotent-20260622",
      };
      const firstPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T13:10:00.000Z"),
      });
      const secondPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T13:25:00.000Z"),
      });

      const firstResponse = await firstPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-export-manifest-idempotent-first",
            "user-agent": "UAIS export manifest idempotent first",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const firstBody = await firstResponse.json();
      const secondResponse = await secondPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-export-manifest-idempotent-retry",
            "user-agent": "UAIS export manifest idempotent retry",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const secondBody = await secondResponse.json();
      const operationDatabase = await readTeachingOperationDatabase({
        dataDir: operationsDataDir,
      });
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const savedCourse = courseDatabase.courses.find(
        (candidate) => candidate.courseId === course.courseId,
      );
      const exportManifests = (
        courseDatabase as unknown as {
          exportManifests?: Array<Record<string, unknown>>;
        }
      ).exportManifests;

      expect(firstResponse.status, JSON.stringify(firstBody)).toBe(200);
      expect(secondResponse.status, JSON.stringify(secondBody)).toBe(200);
      expect(firstBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "created",
          receiptId: secondBody.receipt.receiptId,
        }),
      );
      expect(secondBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "already-persisted",
          receiptId: firstBody.receipt.receiptId,
        }),
      );
      expect(savedCourse).toEqual(
        expect.objectContaining({
          courseId: course.courseId,
          updatedAt: "2026-06-22T13:10:00.000Z",
        }),
      );
      expect(exportManifests).toEqual([
        expect.objectContaining({
          exportManifestId: `export-manifest-${course.courseId}`,
          operationRecordId: firstBody.receipt.receiptId,
          exportStatus: "generated",
          teachingOperationManifestId: "export-manifest-teacher-kang-20260622-131000",
          downloadRoute: "/api/teaching/operations/export/export-manifest-teacher-kang-20260622-131000",
          datasetScopes: ["learning-records", "chat-threads", "grades", "activities"],
          formats: ["json", "csv"],
          exportPolicy: "redacted-teacher-export-manifest",
          createdAt: "2026-06-22T13:10:00.000Z",
        }),
      ]);
      expect(secondBody.courseExportManifestReceipt).toEqual(
        expect.objectContaining({
          action: "create-export-manifest",
          courseId: course.courseId,
          createdAt: "2026-06-22T13:10:00.000Z",
        }),
      );
      expect(operationDatabase.records).toHaveLength(1);
      expect(operationDatabase.auditEvents).toHaveLength(1);
      expect(
        courseDatabase.auditEvents.filter((event) => event.action === "create-export-manifest"),
      ).toEqual([
        expect.objectContaining({
          traceId: "trace-export-manifest-idempotent-first",
          createdAt: "2026-06-22T13:10:00.000Z",
        }),
      ]);
      expect(JSON.stringify(courseDatabase)).not.toContain(
        "trace-export-manifest-idempotent-retry",
      );
      expect(JSON.stringify(courseDatabase)).not.toContain(
        "UAIS export manifest idempotent retry",
      );
      expectNoLocalOrSecretValues(exportManifests, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(firstBody, dataDir);
      expectNoLocalOrSecretValues(secondBody, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("exports course data through a configured external export provider", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-export-provider-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const exportProviderToken = "secret-export-provider-token-with-32-chars";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-export-provider-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:50:00.000Z",
      },
    });
    const providerRequests: Array<{
      url: string;
      authorization: string | null;
      method?: string;
      body?: unknown;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const requestBody = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      providerRequests.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        method: init?.method ?? "GET",
        ...(requestBody ? { body: requestBody } : {}),
      });
      return Response.json({
        status: "exported",
        exportId: "export-provider-run-20260622",
        provider: "external-export-service",
      });
    };
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_COURSE_EXPORT_PROVIDER: "external",
        UAIS_COURSE_EXPORT_PROVIDER_URL: "https://export-provider.example.test/exports",
        UAIS_COURSE_EXPORT_PROVIDER_TOKEN: exportProviderToken,
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T13:10:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Export Provider",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-export-provider-course",
        now: new Date("2026-06-22T13:02:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T13:03:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-course-export-provider",
            "user-agent": "UAIS course export provider test",
          },
          body: JSON.stringify({
            operationId: "data-export",
            actionSlot: "primary",
            courseId: course.courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "course-export-provider-20260622",
          }),
        }),
      );
      const body = await response.json();
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const exportManifests = (
        courseDatabase as unknown as {
          exportManifests?: Array<Record<string, unknown>>;
        }
      ).exportManifests;

      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(providerRequests).toEqual([
        expect.objectContaining({
          url: "https://export-provider.example.test/exports",
          authorization: `Bearer ${exportProviderToken}`,
          method: "POST",
          body: expect.objectContaining({
            action: "export-course-data",
            actorId: "teacher-kang",
            courseId: course.courseId,
            traceId: "trace-course-export-provider",
            operationRecordId: body.receipt.receiptId,
            exportManifestId: `export-manifest-${course.courseId}`,
            teachingOperationManifestId: "export-manifest-teacher-kang-20260622-131000",
            downloadRoute:
              "/api/teaching/operations/export/export-manifest-teacher-kang-20260622-131000",
            datasetScopes: ["learning-records", "chat-threads", "grades", "activities"],
            formats: ["json", "csv"],
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        }),
      ]);
      expect(body.courseExportProviderReceipt).toEqual(
        expect.objectContaining({
          action: "export-course-data-provider",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-course-export-provider",
          status: "exported",
          providerStatus: "export-provider-exported",
          providerExportId: "export-provider-run-20260622",
          exportManifestId: `export-manifest-${course.courseId}`,
          teachingOperationManifestId: "export-manifest-teacher-kang-20260622-131000",
        }),
      );
      expect(exportManifests).toEqual([
        expect.objectContaining({
          exportManifestId: `export-manifest-${course.courseId}`,
          courseId: course.courseId,
          operationRecordId: body.receipt.receiptId,
          exportStatus: "generated",
          providerStatus: "export-provider-exported",
          providerExportId: "export-provider-run-20260622",
          providerExportedAt: "2026-06-22T13:10:00.000Z",
        }),
      ]);
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expect(JSON.stringify(body)).not.toContain(exportProviderToken);
      expect(JSON.stringify(body)).not.toContain("export-provider.example.test");
      expect(JSON.stringify(courseDatabase)).not.toContain(exportProviderToken);
      expect(JSON.stringify(courseDatabase)).not.toContain("export-provider.example.test");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("returns retryable partial-failure context when export provider fails after manifest persistence", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-export-provider-failure-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const exportProviderToken = "secret-export-provider-token-with-32-chars";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-export-provider-failure-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:50:00.000Z",
      },
    });
    const providerRequests: Array<{
      url: string;
      authorization: string | null;
      method?: string;
      body?: unknown;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const requestBody = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      providerRequests.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        method: init?.method ?? "GET",
        ...(requestBody ? { body: requestBody } : {}),
      });
      return Response.json(
        {
          error: "export provider unavailable",
          provider: "external-export-service",
        },
        { status: 503 },
      );
    };
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_COURSE_EXPORT_PROVIDER: "external",
        UAIS_COURSE_EXPORT_PROVIDER_URL: "https://export-provider.example.test/exports",
        UAIS_COURSE_EXPORT_PROVIDER_TOKEN: exportProviderToken,
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T13:10:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Export Provider Failure",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-export-provider-failure-course",
        now: new Date("2026-06-22T13:02:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T13:03:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-course-export-provider-failure",
            "user-agent": "UAIS course export provider failure test",
          },
          body: JSON.stringify({
            operationId: "data-export",
            actionSlot: "primary",
            courseId: course.courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "course-export-provider-failure-20260622",
          }),
        }),
      );
      const body = await response.json();
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const exportManifests = (
        courseDatabase as unknown as {
          exportManifests?: Array<Record<string, unknown>>;
        }
      ).exportManifests;

      expect(response.status, JSON.stringify(body)).toBe(502);
      expect(providerRequests).toEqual([
        expect.objectContaining({
          url: "https://export-provider.example.test/exports",
          authorization: `Bearer ${exportProviderToken}`,
          method: "POST",
          body: expect.objectContaining({
            action: "export-course-data",
            actorId: "teacher-kang",
            courseId: course.courseId,
            traceId: "trace-course-export-provider-failure",
            operationRecordId: body.receipt.receiptId,
            exportManifestId: `export-manifest-${course.courseId}`,
          }),
        }),
      ]);
      expect(body.error).toBe("Course export provider failed.");
      expect(body.courseExportManifestReceipt).toEqual(
        expect.objectContaining({
          action: "create-export-manifest",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-course-export-provider-failure",
        }),
      );
      expect(body.partialFailure).toEqual(
        expect.objectContaining({
          status: "operation-persisted-course-export-provider-failed",
          failedStep: "course-export-provider",
          operationReceiptId: body.receipt.receiptId,
          domainReceiptId: body.courseExportManifestReceipt.receiptId,
          operationId: "data-export",
          actionSlot: "primary",
          courseId: course.courseId,
          providerStatus: "export-provider-pending",
          recoveryAction: "retry-course-export-provider",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      );
      expect(exportManifests).toEqual([
        expect.objectContaining({
          exportManifestId: `export-manifest-${course.courseId}`,
          courseId: course.courseId,
          operationRecordId: body.receipt.receiptId,
          exportStatus: "generated",
        }),
      ]);
      expect(exportManifests?.[0]).not.toHaveProperty("providerStatus");
      expect(exportManifests?.[0]).not.toHaveProperty("providerExportId");
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expect(JSON.stringify(body)).not.toContain(exportProviderToken);
      expect(JSON.stringify(body)).not.toContain("export-provider.example.test");
      expect(JSON.stringify(courseDatabase)).not.toContain(exportProviderToken);
      expect(JSON.stringify(courseDatabase)).not.toContain("export-provider.example.test");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("writes export redaction validations into the course management redaction validation object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-export-redaction-domain-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-export-redaction-domain-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T13:00:00.000Z",
        expiresAt: "2026-06-22T14:00:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T13:12:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Export Redaction Course",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-export-redaction-course",
        now: new Date("2026-06-22T13:06:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T13:07:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-validate-export-redaction-domain-object",
            "user-agent": "UAIS export redaction validation audit source test",
          },
          body: JSON.stringify({
            operationId: "data-export",
            actionSlot: "secondary",
            courseId: course.courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "export-redaction-validation-domain-object-20260622",
          }),
        }),
      );
      const body = await response.json();
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const exportRedactionValidations = (
        courseDatabase as unknown as {
          exportRedactionValidations?: Array<Record<string, unknown>>;
        }
      ).exportRedactionValidations;

      expect(response.status).toBe(200);
      expect(body.courseExportRedactionValidationReceipt).toEqual(
        expect.objectContaining({
          action: "validate-export-redaction-scope",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-validate-export-redaction-domain-object",
          status: "persisted",
        }),
      );
      expect(exportRedactionValidations).toEqual([
        expect.objectContaining({
          exportRedactionValidationId: `export-redaction-validation-${course.courseId}`,
          courseId: course.courseId,
          ownerTeacherId: "teacher-kang",
          validatedBy: "teacher-kang",
          validationStatus: "passed",
          operationRecordId: body.receipt.receiptId,
          sourceAction: "inline-teaching-workspace",
          checkedScopes: [
            "identity-fields",
            "ai-chat-transcripts",
            "voice-references",
            "local-file-paths",
          ],
          blockedSecretCount: 0,
          validationPolicy: "no-secrets-or-local-paths-before-export",
          validatedAt: "2026-06-22T13:12:00.000Z",
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      ]);
      expect(courseDatabase.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "validate-export-redaction-scope",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-validate-export-redaction-domain-object",
          requestSource: {
            userAgent: "UAIS export redaction validation audit source test",
            ipAddress: "redacted",
          },
        }),
      );
      expectNoLocalOrSecretValues(exportRedactionValidations, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps export redaction validation persistence idempotent on signed operation retries", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-route-export-redaction-idempotent-"),
    );
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-export-redaction-idempotent-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T13:00:00.000Z",
        expiresAt: "2026-06-22T14:00:00.000Z",
      },
    });
    const env = {
      UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
      UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
      UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    };

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Export Redaction Idempotent",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-export-redaction-idempotent-course",
        now: new Date("2026-06-22T13:06:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T13:07:00.000Z",
      });

      const requestBody = {
        operationId: "data-export",
        actionSlot: "secondary",
        courseId: course.courseId,
        sourceAction: "inline-teaching-workspace",
        idempotencyKey: "export-redaction-idempotent-20260622",
      };
      const firstPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T13:12:00.000Z"),
      });
      const secondPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T13:27:00.000Z"),
      });

      const firstResponse = await firstPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-export-redaction-idempotent-first",
            "user-agent": "UAIS export redaction idempotent first",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const firstBody = await firstResponse.json();
      const secondResponse = await secondPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-export-redaction-idempotent-retry",
            "user-agent": "UAIS export redaction idempotent retry",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const secondBody = await secondResponse.json();
      const operationDatabase = await readTeachingOperationDatabase({
        dataDir: operationsDataDir,
      });
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const savedCourse = courseDatabase.courses.find(
        (candidate) => candidate.courseId === course.courseId,
      );
      const exportRedactionValidations = (
        courseDatabase as unknown as {
          exportRedactionValidations?: Array<Record<string, unknown>>;
        }
      ).exportRedactionValidations;

      expect(firstResponse.status, JSON.stringify(firstBody)).toBe(200);
      expect(secondResponse.status, JSON.stringify(secondBody)).toBe(200);
      expect(firstBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "created",
          receiptId: secondBody.receipt.receiptId,
        }),
      );
      expect(secondBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "already-persisted",
          receiptId: firstBody.receipt.receiptId,
        }),
      );
      expect(savedCourse).toEqual(
        expect.objectContaining({
          courseId: course.courseId,
          updatedAt: "2026-06-22T13:12:00.000Z",
        }),
      );
      expect(exportRedactionValidations).toEqual([
        expect.objectContaining({
          exportRedactionValidationId: `export-redaction-validation-${course.courseId}`,
          operationRecordId: firstBody.receipt.receiptId,
          validationStatus: "passed",
          checkedScopes: [
            "identity-fields",
            "ai-chat-transcripts",
            "voice-references",
            "local-file-paths",
          ],
          blockedSecretCount: 0,
          validationPolicy: "no-secrets-or-local-paths-before-export",
          validatedAt: "2026-06-22T13:12:00.000Z",
        }),
      ]);
      expect(secondBody.courseExportRedactionValidationReceipt).toEqual(
        expect.objectContaining({
          action: "validate-export-redaction-scope",
          courseId: course.courseId,
          createdAt: "2026-06-22T13:12:00.000Z",
        }),
      );
      expect(operationDatabase.records).toHaveLength(1);
      expect(operationDatabase.auditEvents).toHaveLength(1);
      expect(
        courseDatabase.auditEvents.filter(
          (event) => event.action === "validate-export-redaction-scope",
        ),
      ).toEqual([
        expect.objectContaining({
          traceId: "trace-export-redaction-idempotent-first",
          createdAt: "2026-06-22T13:12:00.000Z",
        }),
      ]);
      expect(JSON.stringify(courseDatabase)).not.toContain(
        "trace-export-redaction-idempotent-retry",
      );
      expect(JSON.stringify(courseDatabase)).not.toContain(
        "UAIS export redaction idempotent retry",
      );
      expectNoLocalOrSecretValues(exportRedactionValidations, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(firstBody, dataDir);
      expectNoLocalOrSecretValues(secondBody, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("writes grading operations into the course management grading queue object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-grading-queue-domain-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-grading-queue-domain-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:50:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T13:20:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Grading Queue",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-grading-queue-course",
        now: new Date("2026-06-22T13:12:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T13:13:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-save-grading-queue-domain-object",
            "user-agent": "UAIS grading queue domain audit source test",
          },
          body: JSON.stringify({
            operationId: "grading",
            actionSlot: "primary",
            courseId: course.courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "grading-queue-domain-object-20260622",
          }),
        }),
      );
      const body = await response.json();
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const gradingQueues = (
        courseDatabase as unknown as {
          gradingQueues?: Array<Record<string, unknown>>;
        }
      ).gradingQueues;
      const gradebookUpdates = (
        courseDatabase as unknown as {
          gradebookUpdates?: Array<Record<string, unknown>>;
        }
      ).gradebookUpdates;

      expect(response.status).toBe(200);
      expect(body.gradingQueueReceipt).toEqual(
        expect.objectContaining({
          action: "save-grading-queue",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-save-grading-queue-domain-object",
          status: "persisted",
        }),
      );
      expect(body.domainPersistenceSummary).toEqual(
        expect.objectContaining({
          status: "persisted",
          required: true,
          operationId: "grading",
          actionSlot: "primary",
          operationReceiptId: body.receipt.receiptId,
          courseId: course.courseId,
          expectedObjectTypes: ["grading-queue", "gradebook-update"],
          persistedObjectTypes: ["grading-queue", "gradebook-update"],
          missingObjectTypes: [],
          persistedResponseKeys: [
            "gradingQueueReceipt",
            "gradingQueueReceipt.gradebookUpdate",
          ],
          receiptCount: 2,
        }),
      );
      expect(gradingQueues).toEqual([
        expect.objectContaining({
          gradingQueueId: `grading-queue-${course.courseId}`,
          courseId: course.courseId,
          ownerTeacherId: "teacher-kang",
          savedBy: "teacher-kang",
          queueStatus: "saved",
          operationRecordId: body.receipt.receiptId,
          sourceAction: "inline-teaching-workspace",
          gradebookUpdateId: `gradebook-update-${course.courseId}`,
          reviewPolicy: "teacher-review-before-release",
          releasePolicy: "teacher-confirmed-grade-release",
          savedAt: "2026-06-22T13:20:00.000Z",
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      ]);
      expect(gradebookUpdates).toEqual([
        expect.objectContaining({
          objectId: `gradebook-update-${course.courseId}`,
          objectType: "gradebook-update",
          courseId: course.courseId,
          updatedBy: "teacher-kang",
          updateStatus: "pending-release",
          operationRecordId: body.receipt.receiptId,
          sourceAction: "inline-teaching-workspace",
          releasePolicy: "teacher-confirmed-grade-release",
          updatedAt: "2026-06-22T13:20:00.000Z",
          storagePolicy: "domain-projection-teaching-gradebook-update",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      ]);
      expect(courseDatabase.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "save-grading-queue",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-save-grading-queue-domain-object",
          requestSource: {
            userAgent: "UAIS grading queue domain audit source test",
            ipAddress: "redacted",
          },
        }),
      );
      expectNoLocalOrSecretValues(gradingQueues, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps grading queue persistence idempotent on signed operation retries", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-route-grading-queue-idempotent-"),
    );
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-grading-queue-idempotent-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:50:00.000Z",
      },
    });
    const env = {
      UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
      UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
      UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    };

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Grading Queue Idempotent",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-grading-queue-idempotent-course",
        now: new Date("2026-06-22T13:12:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T13:13:00.000Z",
      });

      const requestBody = {
        operationId: "grading",
        actionSlot: "primary",
        courseId: course.courseId,
        sourceAction: "inline-teaching-workspace",
        idempotencyKey: "grading-queue-idempotent-20260622",
      };
      const firstPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T13:20:00.000Z"),
      });
      const secondPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T13:35:00.000Z"),
      });

      const firstResponse = await firstPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-grading-queue-idempotent-first",
            "user-agent": "UAIS grading queue idempotent first",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const firstBody = await firstResponse.json();
      const secondResponse = await secondPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-grading-queue-idempotent-retry",
            "user-agent": "UAIS grading queue idempotent retry",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const secondBody = await secondResponse.json();
      const operationDatabase = await readTeachingOperationDatabase({
        dataDir: operationsDataDir,
      });
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const savedCourse = courseDatabase.courses.find(
        (candidate) => candidate.courseId === course.courseId,
      );
      const gradingQueues = (
        courseDatabase as unknown as {
          gradingQueues?: Array<Record<string, unknown>>;
        }
      ).gradingQueues;

      expect(firstResponse.status, JSON.stringify(firstBody)).toBe(200);
      expect(secondResponse.status, JSON.stringify(secondBody)).toBe(200);
      expect(firstBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "created",
          receiptId: secondBody.receipt.receiptId,
        }),
      );
      expect(secondBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "already-persisted",
          receiptId: firstBody.receipt.receiptId,
        }),
      );
      expect(savedCourse).toEqual(
        expect.objectContaining({
          courseId: course.courseId,
          updatedAt: "2026-06-22T13:20:00.000Z",
        }),
      );
      expect(gradingQueues).toEqual([
        expect.objectContaining({
          gradingQueueId: `grading-queue-${course.courseId}`,
          operationRecordId: firstBody.receipt.receiptId,
          queueStatus: "saved",
          gradebookUpdateId: `gradebook-update-${course.courseId}`,
          reviewPolicy: "teacher-review-before-release",
          releasePolicy: "teacher-confirmed-grade-release",
          savedAt: "2026-06-22T13:20:00.000Z",
        }),
      ]);
      expect(secondBody.gradingQueueReceipt).toEqual(
        expect.objectContaining({
          action: "save-grading-queue",
          courseId: course.courseId,
          createdAt: "2026-06-22T13:20:00.000Z",
        }),
      );
      expect(operationDatabase.records).toHaveLength(1);
      expect(operationDatabase.auditEvents).toHaveLength(1);
      expect(
        courseDatabase.auditEvents.filter((event) => event.action === "save-grading-queue"),
      ).toEqual([
        expect.objectContaining({
          traceId: "trace-grading-queue-idempotent-first",
          createdAt: "2026-06-22T13:20:00.000Z",
        }),
      ]);
      expect(JSON.stringify(courseDatabase)).not.toContain("trace-grading-queue-idempotent-retry");
      expect(JSON.stringify(courseDatabase)).not.toContain("UAIS grading queue idempotent retry");
      expectNoLocalOrSecretValues(gradingQueues, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(firstBody, dataDir);
      expectNoLocalOrSecretValues(secondBody, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("writes generated AI feedback into the course management grading feedback draft object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-grading-feedback-domain-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-grading-feedback-domain-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:55:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T13:25:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Grading Feedback",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-grading-feedback-course",
        now: new Date("2026-06-22T13:16:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T13:17:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-generate-grading-feedback-domain-object",
            "user-agent": "UAIS grading feedback domain audit source test",
          },
          body: JSON.stringify({
            operationId: "grading",
            actionSlot: "secondary",
            courseId: course.courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "grading-feedback-domain-object-20260622",
          }),
        }),
      );
      const body = await response.json();
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const gradingFeedbackDrafts = (
        courseDatabase as unknown as {
          gradingFeedbackDrafts?: Array<Record<string, unknown>>;
        }
      ).gradingFeedbackDrafts;

      expect(response.status).toBe(200);
      expect(body.gradingFeedbackDraftReceipt).toEqual(
        expect.objectContaining({
          action: "generate-grading-feedback-draft",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-generate-grading-feedback-domain-object",
          status: "persisted",
        }),
      );
      expect(gradingFeedbackDrafts).toEqual([
        expect.objectContaining({
          gradingFeedbackDraftId: `grading-feedback-draft-${course.courseId}`,
          courseId: course.courseId,
          ownerTeacherId: "teacher-kang",
          generatedBy: "teacher-kang",
          feedbackStatus: "generated",
          operationRecordId: body.receipt.receiptId,
          sourceAction: "inline-teaching-workspace",
          teachingOperationFeedbackArtifactId: "ai-feedback-20260622-132500",
          feedbackScope: "grading-review-queue",
          reviewPolicy: "teacher-review-before-student-release",
          releasePolicy: "teacher-confirmed-feedback-release",
          generatedAt: "2026-06-22T13:25:00.000Z",
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      ]);
      expect(courseDatabase.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "generate-grading-feedback-draft",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-generate-grading-feedback-domain-object",
          requestSource: {
            userAgent: "UAIS grading feedback domain audit source test",
            ipAddress: "redacted",
          },
        }),
      );
      expectNoLocalOrSecretValues(gradingFeedbackDrafts, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps grading feedback draft persistence idempotent on signed operation retries", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-route-grading-feedback-idempotent-"),
    );
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-grading-feedback-idempotent-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:55:00.000Z",
      },
    });
    const env = {
      UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
      UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
      UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    };

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Grading Feedback Idempotent",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-grading-feedback-idempotent-course",
        now: new Date("2026-06-22T13:16:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T13:17:00.000Z",
      });

      const requestBody = {
        operationId: "grading",
        actionSlot: "secondary",
        courseId: course.courseId,
        sourceAction: "inline-teaching-workspace",
        idempotencyKey: "grading-feedback-idempotent-20260622",
      };
      const firstPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T13:25:00.000Z"),
      });
      const secondPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T13:40:00.000Z"),
      });

      const firstResponse = await firstPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-grading-feedback-idempotent-first",
            "user-agent": "UAIS grading feedback idempotent first",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const firstBody = await firstResponse.json();
      const secondResponse = await secondPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-grading-feedback-idempotent-retry",
            "user-agent": "UAIS grading feedback idempotent retry",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const secondBody = await secondResponse.json();
      const operationDatabase = await readTeachingOperationDatabase({
        dataDir: operationsDataDir,
      });
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const savedCourse = courseDatabase.courses.find(
        (candidate) => candidate.courseId === course.courseId,
      );
      const gradingFeedbackDrafts = (
        courseDatabase as unknown as {
          gradingFeedbackDrafts?: Array<Record<string, unknown>>;
        }
      ).gradingFeedbackDrafts;

      expect(firstResponse.status, JSON.stringify(firstBody)).toBe(200);
      expect(secondResponse.status, JSON.stringify(secondBody)).toBe(200);
      expect(firstBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "created",
          receiptId: secondBody.receipt.receiptId,
        }),
      );
      expect(secondBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "already-persisted",
          receiptId: firstBody.receipt.receiptId,
        }),
      );
      expect(savedCourse).toEqual(
        expect.objectContaining({
          courseId: course.courseId,
          updatedAt: "2026-06-22T13:25:00.000Z",
        }),
      );
      expect(gradingFeedbackDrafts).toEqual([
        expect.objectContaining({
          gradingFeedbackDraftId: `grading-feedback-draft-${course.courseId}`,
          operationRecordId: firstBody.receipt.receiptId,
          feedbackStatus: "generated",
          teachingOperationFeedbackArtifactId: "ai-feedback-20260622-132500",
          generatedAt: "2026-06-22T13:25:00.000Z",
        }),
      ]);
      expect(secondBody.gradingFeedbackDraftReceipt).toEqual(
        expect.objectContaining({
          action: "generate-grading-feedback-draft",
          courseId: course.courseId,
          createdAt: "2026-06-22T13:25:00.000Z",
        }),
      );
      expect(operationDatabase.records).toHaveLength(1);
      expect(operationDatabase.auditEvents).toHaveLength(1);
      expect(
        courseDatabase.auditEvents.filter(
          (event) => event.action === "generate-grading-feedback-draft",
        ),
      ).toEqual([
        expect.objectContaining({
          traceId: "trace-grading-feedback-idempotent-first",
          createdAt: "2026-06-22T13:25:00.000Z",
        }),
      ]);
      expect(JSON.stringify(courseDatabase)).not.toContain(
        "trace-grading-feedback-idempotent-retry",
      );
      expect(JSON.stringify(courseDatabase)).not.toContain(
        "UAIS grading feedback idempotent retry",
      );
      expectNoLocalOrSecretValues(gradingFeedbackDrafts, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(firstBody, dataDir);
      expectNoLocalOrSecretValues(secondBody, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("generates grading feedback through a configured external feedback provider", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-grading-feedback-provider-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const feedbackProviderToken = "secret-feedback-provider-token-with-32-chars";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-grading-feedback-provider-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:55:00.000Z",
      },
    });
    const providerRequests: Array<{
      url: string;
      authorization: string | null;
      method?: string;
      body?: unknown;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const requestBody = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      providerRequests.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        method: init?.method ?? "GET",
        ...(requestBody ? { body: requestBody } : {}),
      });
      return Response.json({
        status: "generated",
        feedbackId: "feedback-provider-draft-20260622",
        provider: "external-grading-feedback",
      });
    };
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_GRADING_FEEDBACK_PROVIDER: "external",
        UAIS_GRADING_FEEDBACK_PROVIDER_URL:
          "https://feedback-provider.example.test/grading-feedback",
        UAIS_GRADING_FEEDBACK_PROVIDER_TOKEN: feedbackProviderToken,
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T13:25:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Grading Feedback Provider",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-grading-feedback-provider-course",
        now: new Date("2026-06-22T13:16:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T13:17:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-grading-feedback-provider",
            "user-agent": "UAIS grading feedback provider test",
          },
          body: JSON.stringify({
            operationId: "grading",
            actionSlot: "secondary",
            courseId: course.courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "grading-feedback-provider-20260622",
          }),
        }),
      );
      const body = await response.json();
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const gradingFeedbackDrafts = (
        courseDatabase as unknown as {
          gradingFeedbackDrafts?: Array<Record<string, unknown>>;
        }
      ).gradingFeedbackDrafts;

      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(providerRequests).toEqual([
        expect.objectContaining({
          url: "https://feedback-provider.example.test/grading-feedback",
          authorization: `Bearer ${feedbackProviderToken}`,
          method: "POST",
          body: expect.objectContaining({
            action: "generate-grading-feedback",
            actorId: "teacher-kang",
            courseId: course.courseId,
            traceId: "trace-grading-feedback-provider",
            operationRecordId: body.receipt.receiptId,
            gradingFeedbackDraftId: `grading-feedback-draft-${course.courseId}`,
            teachingOperationFeedbackArtifactId: "ai-feedback-20260622-132500",
            feedbackScope: "grading-review-queue",
            reviewPolicy: "teacher-review-before-student-release",
            releasePolicy: "teacher-confirmed-feedback-release",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        }),
      ]);
      expect(body.gradingFeedbackProviderReceipt).toEqual(
        expect.objectContaining({
          action: "generate-grading-feedback-provider",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-grading-feedback-provider",
          status: "generated",
          providerStatus: "feedback-provider-generated",
          providerFeedbackId: "feedback-provider-draft-20260622",
          gradingFeedbackDraftId: `grading-feedback-draft-${course.courseId}`,
        }),
      );
      expect(gradingFeedbackDrafts).toEqual([
        expect.objectContaining({
          gradingFeedbackDraftId: `grading-feedback-draft-${course.courseId}`,
          courseId: course.courseId,
          operationRecordId: body.receipt.receiptId,
          feedbackStatus: "generated",
          providerStatus: "feedback-provider-generated",
          providerFeedbackId: "feedback-provider-draft-20260622",
          providerGeneratedAt: "2026-06-22T13:25:00.000Z",
        }),
      ]);
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expect(JSON.stringify(body)).not.toContain(feedbackProviderToken);
      expect(JSON.stringify(body)).not.toContain("feedback-provider.example.test");
      expect(JSON.stringify(courseDatabase)).not.toContain(feedbackProviderToken);
      expect(JSON.stringify(courseDatabase)).not.toContain("feedback-provider.example.test");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("returns retryable partial-failure context when grading feedback provider fails after draft persistence", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-route-grading-feedback-provider-failure-"),
    );
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const feedbackProviderToken = "secret-feedback-provider-token-with-32-chars";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-grading-feedback-provider-failure-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:55:00.000Z",
      },
    });
    const providerRequests: Array<{
      url: string;
      authorization: string | null;
      method?: string;
      body?: unknown;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const requestBody = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      providerRequests.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        method: init?.method ?? "GET",
        ...(requestBody ? { body: requestBody } : {}),
      });
      return Response.json(
        {
          error: "feedback provider unavailable",
          provider: "external-feedback-service",
        },
        { status: 503 },
      );
    };
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_GRADING_FEEDBACK_PROVIDER: "external",
        UAIS_GRADING_FEEDBACK_PROVIDER_URL:
          "https://feedback-provider.example.test/grading-feedback",
        UAIS_GRADING_FEEDBACK_PROVIDER_TOKEN: feedbackProviderToken,
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T13:25:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Grading Feedback Provider Failure",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-grading-feedback-provider-failure-course",
        now: new Date("2026-06-22T13:16:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T13:17:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-grading-feedback-provider-failure",
            "user-agent": "UAIS grading feedback provider failure test",
          },
          body: JSON.stringify({
            operationId: "grading",
            actionSlot: "secondary",
            courseId: course.courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "grading-feedback-provider-failure-20260622",
          }),
        }),
      );
      const body = await response.json();
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const gradingFeedbackDrafts = (
        courseDatabase as unknown as {
          gradingFeedbackDrafts?: Array<Record<string, unknown>>;
        }
      ).gradingFeedbackDrafts;

      expect(response.status, JSON.stringify(body)).toBe(502);
      expect(providerRequests).toEqual([
        expect.objectContaining({
          url: "https://feedback-provider.example.test/grading-feedback",
          authorization: `Bearer ${feedbackProviderToken}`,
          method: "POST",
          body: expect.objectContaining({
            action: "generate-grading-feedback",
            actorId: "teacher-kang",
            courseId: course.courseId,
            traceId: "trace-grading-feedback-provider-failure",
            operationRecordId: body.receipt.receiptId,
            gradingFeedbackDraftId: `grading-feedback-draft-${course.courseId}`,
          }),
        }),
      ]);
      expect(body.error).toBe("Grading feedback provider failed.");
      expect(body.gradingFeedbackDraftReceipt).toEqual(
        expect.objectContaining({
          action: "generate-grading-feedback-draft",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-grading-feedback-provider-failure",
        }),
      );
      expect(body.partialFailure).toEqual(
        expect.objectContaining({
          status: "operation-persisted-grading-feedback-provider-failed",
          failedStep: "grading-feedback-provider",
          operationReceiptId: body.receipt.receiptId,
          domainReceiptId: body.gradingFeedbackDraftReceipt.receiptId,
          operationId: "grading",
          actionSlot: "secondary",
          courseId: course.courseId,
          providerStatus: "feedback-provider-pending",
          recoveryAction: "retry-grading-feedback-provider",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      );
      expect(gradingFeedbackDrafts).toEqual([
        expect.objectContaining({
          gradingFeedbackDraftId: `grading-feedback-draft-${course.courseId}`,
          courseId: course.courseId,
          operationRecordId: body.receipt.receiptId,
          feedbackStatus: "generated",
        }),
      ]);
      expect(gradingFeedbackDrafts?.[0]).not.toHaveProperty("providerStatus");
      expect(gradingFeedbackDrafts?.[0]).not.toHaveProperty("providerFeedbackId");
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expect(JSON.stringify(body)).not.toContain(feedbackProviderToken);
      expect(JSON.stringify(body)).not.toContain("feedback-provider.example.test");
      expect(JSON.stringify(courseDatabase)).not.toContain(feedbackProviderToken);
      expect(JSON.stringify(courseDatabase)).not.toContain("feedback-provider.example.test");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("writes quiz-board operations into the course management quiz assessment object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-quiz-assessment-domain-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-quiz-assessment-domain-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T14:05:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T13:35:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Quiz Assessment",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-quiz-assessment-course",
        now: new Date("2026-06-22T13:27:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T13:28:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-refresh-quiz-assessment-domain-object",
            "user-agent": "UAIS quiz assessment domain audit source test",
          },
          body: JSON.stringify({
            operationId: "quiz-board",
            actionSlot: "primary",
            courseId: course.courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "quiz-assessment-domain-object-20260622",
          }),
        }),
      );
      const body = await response.json();
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const quizAssessments = (
        courseDatabase as unknown as {
          quizAssessments?: Array<Record<string, unknown>>;
        }
      ).quizAssessments;

      expect(response.status).toBe(200);
      expect(body.quizAssessmentReceipt).toEqual(
        expect.objectContaining({
          action: "refresh-quiz-assessment",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-refresh-quiz-assessment-domain-object",
          status: "persisted",
        }),
      );
      expect(quizAssessments).toEqual([
        expect.objectContaining({
          quizAssessmentId: `quiz-assessment-${course.courseId}`,
          courseId: course.courseId,
          ownerTeacherId: "teacher-kang",
          refreshedBy: "teacher-kang",
          assessmentStatus: "refreshed",
          operationRecordId: body.receipt.receiptId,
          sourceAction: "inline-teaching-workspace",
          quizBoardStateId: `quiz-board-state-${course.courseId}`,
          visibleMetrics: ["completion-rate", "item-quality", "misconception-clusters"],
          reviewPolicy: "teacher-visible-quiz-quality-board",
          reusePolicy: "teacher-review-before-quiz-reuse",
          refreshedAt: "2026-06-22T13:35:00.000Z",
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      ]);
      expect(courseDatabase.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "refresh-quiz-assessment",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-refresh-quiz-assessment-domain-object",
          requestSource: {
            userAgent: "UAIS quiz assessment domain audit source test",
            ipAddress: "redacted",
          },
        }),
      );
      expectNoLocalOrSecretValues(quizAssessments, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps quiz assessment persistence idempotent on signed operation retries", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-route-quiz-assessment-idempotent-"),
    );
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-quiz-assessment-idempotent-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T14:05:00.000Z",
      },
    });
    const env = {
      UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
      UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
      UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    };

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Quiz Assessment Idempotent",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-quiz-assessment-idempotent-course",
        now: new Date("2026-06-22T13:27:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T13:28:00.000Z",
      });

      const requestBody = {
        operationId: "quiz-board",
        actionSlot: "primary",
        courseId: course.courseId,
        sourceAction: "inline-teaching-workspace",
        idempotencyKey: "quiz-assessment-idempotent-20260622",
      };
      const firstPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T13:35:00.000Z"),
      });
      const secondPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T13:50:00.000Z"),
      });

      const firstResponse = await firstPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-quiz-assessment-idempotent-first",
            "user-agent": "UAIS quiz assessment idempotent first",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const firstBody = await firstResponse.json();
      const secondResponse = await secondPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-quiz-assessment-idempotent-retry",
            "user-agent": "UAIS quiz assessment idempotent retry",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const secondBody = await secondResponse.json();
      const operationDatabase = await readTeachingOperationDatabase({
        dataDir: operationsDataDir,
      });
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const savedCourse = courseDatabase.courses.find(
        (candidate) => candidate.courseId === course.courseId,
      );
      const quizAssessments = (
        courseDatabase as unknown as {
          quizAssessments?: Array<Record<string, unknown>>;
        }
      ).quizAssessments;

      expect(firstResponse.status, JSON.stringify(firstBody)).toBe(200);
      expect(secondResponse.status, JSON.stringify(secondBody)).toBe(200);
      expect(firstBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "created",
          receiptId: secondBody.receipt.receiptId,
        }),
      );
      expect(secondBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "already-persisted",
          receiptId: firstBody.receipt.receiptId,
        }),
      );
      expect(savedCourse).toEqual(
        expect.objectContaining({
          courseId: course.courseId,
          updatedAt: "2026-06-22T13:35:00.000Z",
        }),
      );
      expect(quizAssessments).toEqual([
        expect.objectContaining({
          quizAssessmentId: `quiz-assessment-${course.courseId}`,
          operationRecordId: firstBody.receipt.receiptId,
          assessmentStatus: "refreshed",
          quizBoardStateId: `quiz-board-state-${course.courseId}`,
          refreshedAt: "2026-06-22T13:35:00.000Z",
        }),
      ]);
      expect(secondBody.quizAssessmentReceipt).toEqual(
        expect.objectContaining({
          action: "refresh-quiz-assessment",
          courseId: course.courseId,
          createdAt: "2026-06-22T13:35:00.000Z",
        }),
      );
      expect(operationDatabase.records).toHaveLength(1);
      expect(operationDatabase.auditEvents).toHaveLength(1);
      expect(
        courseDatabase.auditEvents.filter((event) => event.action === "refresh-quiz-assessment"),
      ).toEqual([
        expect.objectContaining({
          traceId: "trace-quiz-assessment-idempotent-first",
          createdAt: "2026-06-22T13:35:00.000Z",
        }),
      ]);
      expect(JSON.stringify(courseDatabase)).not.toContain("trace-quiz-assessment-idempotent-retry");
      expect(JSON.stringify(courseDatabase)).not.toContain(
        "UAIS quiz assessment idempotent retry",
      );
      expectNoLocalOrSecretValues(quizAssessments, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(firstBody, dataDir);
      expectNoLocalOrSecretValues(secondBody, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("writes low-quality quiz item flags into the course management quiz item review object", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-quiz-item-review-domain-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-quiz-item-review-domain-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T14:10:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T13:40:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Quiz Item Review",
          instructor: "Kang Xia",
          unit: "Guangzhou University 405",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-quiz-item-review-course",
        now: new Date("2026-06-22T13:32:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T13:33:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "user-agent": "UAIS quiz item review domain audit source test",
            "x-uais-trace-id": "trace-flag-quiz-item-review-domain-object",
          },
          body: JSON.stringify({
            operationId: "quiz-board",
            actionSlot: "secondary",
            courseId: course.courseId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "quiz-item-review-domain-object-20260622",
          }),
        }),
      );
      const body = await response.json();
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const quizItemReviews = (
        courseDatabase as unknown as {
          quizItemReviews?: Array<Record<string, unknown>>;
        }
      ).quizItemReviews;

      expect(response.status).toBe(200);
      expect(body.quizItemReviewReceipt).toEqual(
        expect.objectContaining({
          action: "flag-quiz-item-review",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-flag-quiz-item-review-domain-object",
          status: "persisted",
        }),
      );
      expect(quizItemReviews).toEqual([
        expect.objectContaining({
          quizItemReviewId: `quiz-item-review-${course.courseId}`,
          courseId: course.courseId,
          ownerTeacherId: "teacher-kang",
          flaggedBy: "teacher-kang",
          reviewStatus: "flagged-for-review",
          operationRecordId: body.receipt.receiptId,
          sourceAction: "inline-teaching-workspace",
          flaggedSignals: ["low-discrimination", "high-error-rate", "teacher-review-needed"],
          reviewPolicy: "teacher-review-before-quiz-reuse",
          flaggedAt: "2026-06-22T13:40:00.000Z",
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      ]);
      expect(courseDatabase.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "flag-quiz-item-review",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-flag-quiz-item-review-domain-object",
          requestSource: {
            userAgent: "UAIS quiz item review domain audit source test",
            ipAddress: "redacted",
          },
        }),
      );
      expectNoLocalOrSecretValues(quizItemReviews, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps quiz item review persistence idempotent on signed operation retries", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-route-quiz-item-review-idempotent-"),
    );
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-quiz-item-review-idempotent-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T14:10:00.000Z",
      },
    });
    const env = {
      UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
      UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
      UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    };

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Quiz Item Review Idempotent",
          instructor: "Kang Xia",
          unit: "Guangzhou University 405",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-quiz-item-review-idempotent-course",
        now: new Date("2026-06-22T13:32:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T13:33:00.000Z",
      });

      const requestBody = {
        operationId: "quiz-board",
        actionSlot: "secondary",
        courseId: course.courseId,
        sourceAction: "inline-teaching-workspace",
        idempotencyKey: "quiz-item-review-idempotent-20260622",
      };
      const firstPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T13:40:00.000Z"),
      });
      const secondPostOperation = createTeachingOperationActionPostHandler({
        env,
        now: new Date("2026-06-22T13:55:00.000Z"),
      });

      const firstResponse = await firstPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-quiz-item-review-idempotent-first",
            "user-agent": "UAIS quiz item review idempotent first",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const firstBody = await firstResponse.json();
      const secondResponse = await secondPostOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-quiz-item-review-idempotent-retry",
            "user-agent": "UAIS quiz item review idempotent retry",
          },
          body: JSON.stringify(requestBody),
        }),
      );
      const secondBody = await secondResponse.json();
      const operationDatabase = await readTeachingOperationDatabase({
        dataDir: operationsDataDir,
      });
      const courseDatabase = await readTeachingCourseManagementDatabase({
        dataDir: coursesDataDir,
      });
      const savedCourse = courseDatabase.courses.find(
        (candidate) => candidate.courseId === course.courseId,
      );
      const quizItemReviews = (
        courseDatabase as unknown as {
          quizItemReviews?: Array<Record<string, unknown>>;
        }
      ).quizItemReviews;

      expect(firstResponse.status, JSON.stringify(firstBody)).toBe(200);
      expect(secondResponse.status, JSON.stringify(secondBody)).toBe(200);
      expect(firstBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "created",
          receiptId: secondBody.receipt.receiptId,
        }),
      );
      expect(secondBody.receipt).toEqual(
        expect.objectContaining({
          idempotencyStatus: "already-persisted",
          receiptId: firstBody.receipt.receiptId,
        }),
      );
      expect(savedCourse).toEqual(
        expect.objectContaining({
          courseId: course.courseId,
          updatedAt: "2026-06-22T13:40:00.000Z",
        }),
      );
      expect(quizItemReviews).toEqual([
        expect.objectContaining({
          quizItemReviewId: `quiz-item-review-${course.courseId}`,
          operationRecordId: firstBody.receipt.receiptId,
          reviewStatus: "flagged-for-review",
          flaggedSignals: ["low-discrimination", "high-error-rate", "teacher-review-needed"],
          flaggedAt: "2026-06-22T13:40:00.000Z",
        }),
      ]);
      expect(secondBody.quizItemReviewReceipt).toEqual(
        expect.objectContaining({
          action: "flag-quiz-item-review",
          courseId: course.courseId,
          createdAt: "2026-06-22T13:40:00.000Z",
        }),
      );
      expect(operationDatabase.records).toHaveLength(1);
      expect(operationDatabase.auditEvents).toHaveLength(1);
      expect(
        courseDatabase.auditEvents.filter((event) => event.action === "flag-quiz-item-review"),
      ).toEqual([
        expect.objectContaining({
          traceId: "trace-quiz-item-review-idempotent-first",
          createdAt: "2026-06-22T13:40:00.000Z",
        }),
      ]);
      expect(JSON.stringify(courseDatabase)).not.toContain(
        "trace-quiz-item-review-idempotent-retry",
      );
      expect(JSON.stringify(courseDatabase)).not.toContain(
        "UAIS quiz item review idempotent retry",
      );
      expectNoLocalOrSecretValues(quizItemReviews, dataDir);
      expectNoLocalOrSecretValues(courseDatabase, dataDir);
      expectNoLocalOrSecretValues(firstBody, dataDir);
      expectNoLocalOrSecretValues(secondBody, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("retries class invite publication after an external course-management snapshot conflict", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-invite-publish-retry-"));
    const operationsDataDir = join(dataDir, "operations");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const courseId = "teacher-course-external-invite-course-20260622-113000";
    const classId = `${courseId}-class-1`;
    const concurrentClassId = `${courseId}-class-2`;
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-invite-publish-retry-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:25:00.000Z",
        expiresAt: "2026-06-22T12:25:00.000Z",
      },
    });
    const persistedCourse = {
      courseId,
      ownerTeacherId: "teacher-kang",
      courseName: "External Invite Course",
      instructor: "Kang Xia",
      unit: "Guangzhou University 404",
      department: "Experimental Teaching Center",
      semester: "2026 Spring",
      status: "draft",
      students: 0,
      createdAt: "2026-06-22T11:30:00.000Z",
      updatedAt: "2026-06-22T11:30:00.000Z",
      storagePolicy: "external-redacted-teaching-course-management-snapshot",
      storageWritePolicy: "external-optimistic-snapshot-replace",
      responsibleSession: "S12",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    };
    const persistedClass = {
      classId,
      courseId,
      ownerTeacherId: "teacher-kang",
      className: "External Invite Class 1",
      students: 0,
      semester: "2026 Spring",
      invitationCode: "55395056",
      joinUrl: "/courses?invite=55395056",
      createdAt: "2026-06-22T11:31:00.000Z",
      updatedAt: "2026-06-22T11:31:00.000Z",
      storagePolicy: "external-redacted-teaching-course-management-snapshot",
      storageWritePolicy: "external-optimistic-snapshot-replace",
      responsibleSession: "S12",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    };
    const concurrentClass = {
      classId: concurrentClassId,
      courseId,
      ownerTeacherId: "teacher-kang",
      className: "Concurrent Invite Class",
      students: 0,
      semester: "2026 Spring",
      invitationCode: "55395058",
      joinUrl: "/courses?invite=55395058",
      createdAt: "2026-06-22T11:34:00.000Z",
      updatedAt: "2026-06-22T11:34:00.000Z",
      storagePolicy: "external-redacted-teaching-course-management-snapshot",
      storageWritePolicy: "external-optimistic-snapshot-replace",
      responsibleSession: "S12",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    };
    const courseManagementRequests: Array<{
      method: string;
      url: string;
      authorization: string | null;
      body?: unknown;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const pathname = new URL(String(url)).pathname;
      if (pathname !== "/uais/teaching-course-management/database") {
        return Response.json({ error: "unexpected external request" }, { status: 404 });
      }

      const rawBody = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      courseManagementRequests.push({
        method: init?.method ?? "GET",
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        ...(rawBody ? { body: rawBody } : {}),
      });
      const requestNumber = courseManagementRequests.length;

      if (init?.method === "GET") {
        return Response.json({
          database:
            requestNumber >= 4
              ? {
                  schemaVersion: "uais-teaching-course-management-v1",
                  updatedAt: "2026-06-22T11:34:00.000Z",
                  courses: [persistedCourse],
                  classes: [persistedClass, concurrentClass],
                  memberships: [],
                  auditEvents: [],
                }
              : {
                  schemaVersion: "uais-teaching-course-management-v1",
                  updatedAt: "2026-06-22T11:31:00.000Z",
                  courses: [persistedCourse],
                  classes: [persistedClass],
                  memberships: [],
                  auditEvents: [],
          },
          revision: requestNumber >= 4 ? "rev-1" : "rev-0",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      if (init?.method === "PUT") {
        if (requestNumber === 3) {
          return Response.json(
            { error: "Teaching course management snapshot revision mismatch." },
            { status: 409 },
          );
        }

        return Response.json({
          status: "persisted",
          revision: "rev-2",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          storageWritePolicy: "external-optimistic-snapshot-replace",
          productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      return Response.json({ error: "unexpected external request" }, { status: 404 });
    };
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      fetch: fetchImpl,
      getTeachingOperationCourseOwnership: async () => ({
        teacherId: "teacher-kang",
        courseIds: [courseId],
      }),
      appendExternalTeachingOperation: async ({ record }) => ({
        teacherId: record.actorId,
        receiptId: record.recordId,
        status: "persisted",
        storagePolicy: "external-redacted-teaching-operation-append",
        storageWritePolicy: "external-append-only-operation-log",
        responsibleSession: "S12",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      }),
      now: new Date("2026-06-22T11:35:00.000Z"),
    });

    try {
      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-production-invite-publish-revision-retry",
          },
          body: JSON.stringify({
            operationId: "invite-code",
            actionSlot: "secondary",
            courseId,
            targetClassId: classId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "invite-publish-revision-retry",
          }),
        }),
      );
      const body = await response.json();
      const publishedInvite = body.receipt?.artifacts?.find(
        (artifact: { kind?: string; code?: string; status?: string }) =>
          artifact.kind === "invite-code" && artifact.status === "published",
      );

      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(publishedInvite).toEqual(
        expect.objectContaining({
          code: "55395057",
          status: "published",
        }),
      );
      expect(body.classInvitePublicationReceipt).toEqual(
        expect.objectContaining({
          action: "publish-class-invite-code",
          actorId: "teacher-kang",
          courseId,
          classId,
          traceId: "trace-production-invite-publish-revision-retry",
          status: "persisted",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          storageWritePolicy: "external-optimistic-snapshot-replace",
        }),
      );
      expect(courseManagementRequests.map((request) => request.method)).toEqual([
        "GET",
        "GET",
        "PUT",
        "GET",
        "PUT",
      ]);
      expect(courseManagementRequests[2]?.body).toEqual(
        expect.objectContaining({
          expectedRevision: "rev-0",
        }),
      );
      expect(courseManagementRequests[4]?.body).toEqual(
        expect.objectContaining({
          expectedRevision: "rev-1",
          database: expect.objectContaining({
            classes: expect.arrayContaining([
              expect.objectContaining({
                classId,
                invitationCode: "55395057",
                joinUrl: "/courses?invite=55395057",
              }),
              expect.objectContaining({
                classId: concurrentClassId,
                invitationCode: "55395058",
              }),
            ]),
          }),
        }),
      );
      expectNoLocalOrSecretValues(body, dataDir);
      expect(JSON.stringify(body)).not.toContain(externalToken);
      expect(JSON.stringify(body)).not.toContain("external-storage.example.test");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("returns redacted external course-management write diagnostics without exposing storage credentials", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-external-diagnostics-"));
    const operationsDataDir = join(dataDir, "operations");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const studentRosterProviderToken = "secret-student-roster-provider-token-32";
    const courseId = "teacher-course-external-diagnostics-20260627";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-external-diagnostics-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-27T11:30:00.000Z",
        expiresAt: "2026-06-27T12:30:00.000Z",
      },
    });
    const persistedCourse = {
      courseId,
      ownerTeacherId: "teacher-kang",
      courseName: "External Diagnostics Course",
      instructor: "Kang Xia",
      unit: "Guangzhou University 404",
      department: "Experimental Teaching Center",
      semester: "2026 Spring",
      status: "draft",
      students: 0,
      createdAt: "2026-06-27T11:00:00.000Z",
      updatedAt: "2026-06-27T11:00:00.000Z",
      storagePolicy: "external-redacted-teaching-course-management-snapshot",
      storageWritePolicy: "external-optimistic-snapshot-replace",
      responsibleSession: "S12",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    };
    const fetchImpl: typeof fetch = async (url, init) => {
      const pathname = new URL(String(url)).pathname;
      if (pathname !== "/uais/teaching-course-management/database") {
        return Response.json({ error: "unexpected external request" }, { status: 404 });
      }
      if (init?.method === "GET") {
        return Response.json({
          database: {
            schemaVersion: "uais-teaching-course-management-v1",
            updatedAt: "2026-06-27T11:00:00.000Z",
            courses: [persistedCourse],
            classes: [],
            memberships: [],
            auditEvents: [],
          },
          revision: "rev-0",
          productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
        });
      }
      if (init?.method === "PUT") {
        return Response.json(
          {
            error: "Invalid teaching student roster sync record.",
          },
          { status: 400 },
        );
      }
      return Response.json({ error: "unexpected external request" }, { status: 404 });
    };
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
        UAIS_STUDENT_ROSTER_SYNC_PROVIDER: "external",
        UAIS_STUDENT_ROSTER_SYNC_PROVIDER_URL:
          "https://sis.example.test/api/uais/student-roster-sync",
        UAIS_STUDENT_ROSTER_SYNC_PROVIDER_TOKEN: studentRosterProviderToken,
      },
      fetch: fetchImpl,
      getTeachingOperationCourseOwnership: async () => ({
        teacherId: "teacher-kang",
        courseIds: [courseId],
      }),
      appendExternalTeachingOperation: async ({ record }) => ({
        teacherId: record.actorId,
        receiptId: record.recordId,
        status: "persisted",
        storagePolicy: "external-redacted-teaching-operation-append",
        storageWritePolicy: "external-append-only-operation-log",
        responsibleSession: "S12",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      }),
      now: new Date("2026-06-27T11:35:00.000Z"),
    });
    const courseManagementRepository = createUaisTeachingCourseManagementRepository({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      fetch: fetchImpl,
    });

    try {
      await expect(
        courseManagementRepository?.write({
          expectedRevision: "rev-0",
          database: {
            schemaVersion: "uais-teaching-course-management-v1",
            updatedAt: "2026-06-27T11:35:00.000Z",
            courses: [persistedCourse],
            classes: [],
            memberships: [],
            auditEvents: [],
          },
        }),
      ).rejects.toMatchObject({
        diagnostics: {
          externalTeachingCourseManagement: {
            status: "failed",
            upstreamStatus: 400,
            upstreamError: "Invalid teaching student roster sync record.",
            valueRedacted: true,
          },
        },
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-external-course-management-diagnostics",
          },
          body: JSON.stringify({
            operationId: "students",
            actionSlot: "primary",
            courseId,
            sourceAction: "route-diagnostics",
            idempotencyKey: "route-diagnostics-student-roster",
          }),
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(502);
      expect(body.error).toBe("External teaching course management persistence failed.");
      expect(body).toEqual(
        expect.objectContaining({
          diagnostics: expect.anything(),
        }),
      );
      expect(body.diagnostics).toEqual({
        externalTeachingCourseManagement: {
          status: "failed",
          upstreamStatus: 400,
          upstreamError: "Invalid teaching student roster sync record.",
          valueRedacted: true,
        },
      });
      expect(JSON.stringify(body)).not.toContain(externalToken);
      expect(JSON.stringify(body)).not.toContain(studentRosterProviderToken);
      expect(JSON.stringify(body)).not.toContain("external-storage.example.test");
      expect(JSON.stringify(body)).not.toContain("sis.example.test");
      expect(JSON.stringify(body)).not.toContain(dataDir);
      expect(JSON.stringify(body)).not.toContain("/Users/");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("returns partial-failure recovery context when class invite publication fails after operation persistence", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-invite-partial-failure-"));
    const operationsDataDir = join(dataDir, "operations");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const courseId = "teacher-course-external-invite-course-20260622-113000";
    const classId = `${courseId}-class-1`;
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-invite-partial-failure-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:45:00.000Z",
        expiresAt: "2026-06-22T12:45:00.000Z",
      },
    });
    const persistedCourse = {
      courseId,
      ownerTeacherId: "teacher-kang",
      courseName: "External Invite Course",
      instructor: "Kang Xia",
      unit: "Guangzhou University 404",
      department: "Experimental Teaching Center",
      semester: "2026 Spring",
      status: "draft",
      students: 0,
      createdAt: "2026-06-22T11:30:00.000Z",
      updatedAt: "2026-06-22T11:30:00.000Z",
      storagePolicy: "external-redacted-teaching-course-management-snapshot",
      storageWritePolicy: "external-optimistic-snapshot-replace",
      responsibleSession: "S12",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    };
    const persistedClass = {
      classId,
      courseId,
      ownerTeacherId: "teacher-kang",
      className: "External Invite Class 1",
      students: 0,
      semester: "2026 Spring",
      invitationCode: "55395056",
      joinUrl: "/courses?invite=55395056",
      createdAt: "2026-06-22T11:31:00.000Z",
      updatedAt: "2026-06-22T11:31:00.000Z",
      storagePolicy: "external-redacted-teaching-course-management-snapshot",
      storageWritePolicy: "external-optimistic-snapshot-replace",
      responsibleSession: "S12",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    };
    const courseManagementRequests: Array<{
      method: string;
      url: string;
      authorization: string | null;
      body?: unknown;
    }> = [];
    const appendedOperations: Array<{ recordId: string; operationId: string; courseId?: string }> =
      [];
    const rollbackRequests: Array<{
      teacherId: string;
      targetRecordId: string;
      courseId: string;
      rollbackReason: string;
      traceId: string;
      requestedAt: string;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const pathname = new URL(String(url)).pathname;
      if (pathname !== "/uais/teaching-course-management/database") {
        return Response.json({ error: "unexpected external request" }, { status: 404 });
      }

      const rawBody = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      courseManagementRequests.push({
        method: init?.method ?? "GET",
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        ...(rawBody ? { body: rawBody } : {}),
      });

      if (init?.method === "GET") {
        return Response.json({
          database: {
            schemaVersion: "uais-teaching-course-management-v1",
            updatedAt: "2026-06-22T11:31:00.000Z",
            courses: [persistedCourse],
            classes: [persistedClass],
            memberships: [],
            auditEvents: [],
          },
          revision: "rev-0",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      if (init?.method === "PUT") {
        return Response.json(
          { error: "Teaching course management persistence unavailable." },
          { status: 502 },
        );
      }

      return Response.json({ error: "unexpected external request" }, { status: 404 });
    };
    const routeDeps = {
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      fetch: fetchImpl,
      getTeachingOperationCourseOwnership: async () => ({
        teacherId: "teacher-kang",
        courseIds: [courseId],
      }),
      appendExternalTeachingOperation: async ({ record }) => {
        appendedOperations.push({
          recordId: record.recordId,
          operationId: record.operationId,
          ...(record.courseId ? { courseId: record.courseId } : {}),
        });
        return {
          teacherId: record.actorId,
          receiptId: record.recordId,
          status: "persisted",
          storagePolicy: "external-redacted-teaching-operation-append",
          storageWritePolicy: "external-append-only-operation-log",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
      rollbackExternalTeachingOperation: async (input) => {
        rollbackRequests.push({
          teacherId: input.teacherId,
          targetRecordId: input.targetRecordId,
          courseId: input.courseId,
          rollbackReason: input.rollbackReason,
          traceId: input.traceId,
          requestedAt: input.requestedAt,
        });
        return {
          teacherId: input.teacherId,
          rollbackId: `teaching-operation-rollback-${input.targetRecordId}`,
          targetRecordId: input.targetRecordId,
          courseId: input.courseId,
          status: "persisted",
          storagePolicy: "external-redacted-teaching-operation-rollback",
          storageWritePolicy: "external-append-only-rollback-log",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
      now: new Date("2026-06-22T11:50:00.000Z"),
    };
    const postOperation = createTeachingOperationActionPostHandler(routeDeps);

    try {
      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-production-invite-publish-partial-failure",
          },
          body: JSON.stringify({
            operationId: "invite-code",
            actionSlot: "secondary",
            courseId,
            targetClassId: classId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "invite-publish-partial-failure",
          }),
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(502);
      expect(body.error).toBe("External teaching course management persistence failed.");
      expect(appendedOperations).toHaveLength(1);
      expect(body.receipt).toEqual(
        expect.objectContaining({
          receiptId: appendedOperations[0]?.recordId,
          operationId: "invite-code",
          actionSlot: "secondary",
          courseId,
          status: "persisted",
        }),
      );
      expect(body.partialFailure).toEqual(
        expect.objectContaining({
          status: "operation-persisted-class-invite-publication-failed",
          failedStep: "class-invite-publication",
          operationReceiptId: appendedOperations[0]?.recordId,
          operationId: "invite-code",
          actionSlot: "secondary",
          courseId,
          targetClassId: classId,
          rollbackRoute: `/api/teaching/operations/records/${appendedOperations[0]?.recordId}/rollback`,
          responsibleSession: "S12",
          compensation: expect.objectContaining({
            status: "rolled-back",
            action: "rollback-teaching-operation-record",
            rollbackReason: "class-invite-publication-failed",
            receipt: expect.objectContaining({
              receiptId: `teaching-operation-rollback-${appendedOperations[0]?.recordId}`,
              action: "rollback-teaching-operation-record",
              actorId: "teacher-kang",
              courseId,
              targetRecordId: appendedOperations[0]?.recordId,
              traceId: "trace-production-invite-publish-partial-failure",
              rollbackReason: "class-invite-publication-failed",
              status: "persisted",
              storagePolicy: "external-redacted-teaching-operation-rollback",
              storageWritePolicy: "external-append-only-rollback-log",
              responsibleSession: "S12",
            }),
          }),
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      );
      expect(rollbackRequests).toEqual([
        expect.objectContaining({
          teacherId: "teacher-kang",
          targetRecordId: appendedOperations[0]?.recordId,
          courseId,
          rollbackReason: "class-invite-publication-failed",
          traceId: "trace-production-invite-publish-partial-failure",
          requestedAt: "2026-06-22T11:50:00.000Z",
        }),
      ]);
      expect(courseManagementRequests.map((request) => request.method)).toEqual([
        "GET",
        "GET",
        "PUT",
      ]);
      expectNoLocalOrSecretValues(body, dataDir);
      expect(JSON.stringify(body)).not.toContain(externalToken);
      expect(JSON.stringify(body)).not.toContain("external-storage.example.test");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("preflights invite-code class targets before writing the operation ledger", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-invite-preflight-"));
    const operationsDataDir = join(dataDir, "operations");
    const coursesDataDir = join(dataDir, "courses");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-invite-preflight-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:45:00.000Z",
        expiresAt: "2026-06-22T12:45:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_COURSES_DATA_DIR: coursesDataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:50:00.000Z"),
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir: coursesDataDir,
        actorId: "teacher-kang",
        draft: {
          name: "Enterprise Invite Preflight Course",
          instructor: "Kang Xia",
          unit: "Guangzhou University 404",
          department: "Experimental Teaching Center",
          semester: "2026 Spring",
        },
        traceId: "trace-create-enterprise-invite-preflight-course",
        now: new Date("2026-06-22T11:46:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T11:47:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-invite-preflight-missing-class",
          },
          body: JSON.stringify({
            operationId: "invite-code",
            actionSlot: "secondary",
            courseId: course.courseId,
            targetClassId: `${course.courseId}-missing-class`,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "invite-publish-missing-class-preflight",
          }),
        }),
      );
      const body = await response.json();
      const operationDatabase = await readTeachingOperationDatabase({
        dataDir: operationsDataDir,
      });

      expect(response.status).toBe(404);
      expect(body).toEqual(
        expect.objectContaining({
          error: "Teaching class was not found.",
          traceId: "trace-invite-preflight-missing-class",
        }),
      );
      expect(operationDatabase.records).toHaveLength(0);
      expect(operationDatabase.auditEvents).toHaveLength(0);
      expect(operationDatabase.domainProjections).toHaveLength(0);
      expect(operationDatabase.inviteCodes).toHaveLength(0);
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(operationDatabase, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe invite-code target class ids before external course-management reads or operation writes", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-unsafe-invite-class-"));
    const operationsDataDir = join(dataDir, "operations");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const courseId = "teacher-course-unsafe-invite-class-20260628";
    const unsafeTargetClassId = "/Users/example/secret-token-class";
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-unsafe-invite-class-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-28T00:45:00.000Z",
        expiresAt: "2026-06-28T01:45:00.000Z",
      },
    });
    const externalRequests: Array<{ method?: string; url: string }> = [];
    const appendedOperations: string[] = [];
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      fetch: async (url, init) => {
        externalRequests.push({
          method: init?.method,
          url: String(url),
        });
        return Response.json({
          database: {
            schemaVersion: "uais-teaching-course-management-v1",
            updatedAt: "2026-06-28T00:45:00.000Z",
            courses: [],
            classes: [],
            memberships: [],
            auditEvents: [],
          },
          revision: "rev-unsafe-class-preflight",
          productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
        });
      },
      getTeachingOperationCourseOwnership: async () => ({
        teacherId: "teacher-kang",
        courseIds: [courseId],
      }),
      appendExternalTeachingOperation: async ({ record }) => {
        appendedOperations.push(record.recordId);
        return {
          teacherId: record.actorId,
          receiptId: record.recordId,
          status: "persisted",
          storagePolicy: "external-redacted-teaching-operation-append",
          storageWritePolicy: "external-append-only-operation-log",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
      now: new Date("2026-06-28T00:50:00.000Z"),
    });

    try {
      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-unsafe-invite-target-class",
          },
          body: JSON.stringify({
            operationId: "invite-code",
            actionSlot: "secondary",
            courseId,
            targetClassId: unsafeTargetClassId,
            sourceAction: "inline-teaching-workspace",
            idempotencyKey: "unsafe-invite-target-class",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({
        dataDir: operationsDataDir,
      });

      expect(response.status).toBe(400);
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teaching operation target class id is invalid.",
          traceId: "trace-unsafe-invite-target-class",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      );
      expect(JSON.stringify(body)).not.toContain(unsafeTargetClassId);
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(externalRequests).toEqual([]);
      expect(appendedOperations).toEqual([]);
      expect(database.records).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expect(database.domainProjections).toHaveLength(0);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("blocks production teaching operations before ownership or writes when teacher auth provider is not production-ready", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-production-auth-provider-"));
    const operationsDataDir = join(dataDir, "operations");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const courseId = "teacher-research-methods";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-auth-session-provider-block",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:50:00.000Z",
        expiresAt: "2026-06-22T11:50:00.000Z",
      },
    });
    let ownershipCheckCount = 0;
    const appendedOperations: string[] = [];
    const externalRequests: Array<{ url: string; method?: string }> = [];
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      fetch: async (url, init) => {
        externalRequests.push({
          url: String(url),
          method: init?.method,
        });
        return Response.json(
          { error: "external request should not run before auth-provider guard" },
          { status: 502 },
        );
      },
      getTeachingOperationCourseOwnership: async () => {
        ownershipCheckCount += 1;
        return {
          teacherId: "teacher-kang",
          courseIds: [courseId],
        };
      },
      appendExternalTeachingOperation: async ({ record }) => {
        appendedOperations.push(record.recordId);
        return {
          teacherId: record.actorId,
          receiptId: record.recordId,
          status: "persisted",
          storagePolicy: "external-redacted-teaching-operation-append",
          storageWritePolicy: "external-append-only-operation-log",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
      now: new Date("2026-06-22T11:00:00.000Z"),
    });

    try {
      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
            "x-uais-trace-id": "trace-production-auth-provider-not-ready",
          },
          body: JSON.stringify({
            operationId: "course-settings",
            actionSlot: "primary",
            courseId,
            sourceAction: "manage",
            idempotencyKey: "production-auth-provider-not-ready",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir: operationsDataDir });

      expect(response.status).toBe(503);
      expect(body.error).toBe("UAIS teacher auth provider is not production-ready.");
      expect(body.traceId).toBe("trace-production-auth-provider-not-ready");
      expect(body.access).toEqual(
        expect.objectContaining({
          status: "denied",
          reasonCode: "teacher-auth-provider-not-production-ready",
          responsibleSession: "S12",
        }),
      );
      expect(body.authProviderContract).toEqual(
        expect.objectContaining({
          providerKind: "missing",
          productionStatus: "blocked",
          blockedReason: "missing-UAIS_TEACHER_AUTH_PROVIDER",
          redaction: {
            values: "omitted",
            cookies: "omitted",
          },
        }),
      );
      expect(body.receipt).toBeUndefined();
      expect(body.partialFailure).toBeUndefined();
      expect(ownershipCheckCount).toBe(0);
      expect(appendedOperations).toEqual([]);
      expect(externalRequests).toEqual([]);
      expect(database.records).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expect(database.domainProjections).toHaveLength(0);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed in production instead of writing signed teaching operations to local JSON storage", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-production-local-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-auth-session-cookie-id",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:58:00.000Z",
        expiresAt: "2026-06-22T11:58:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
      },
      getTeachingOperationCourseOwnership: async () => ({
        teacherId: "teacher-kang",
        courseIds: ["teacher-research-methods"],
      }),
      now: new Date("2026-06-22T11:00:00.000Z"),
    });

    try {
      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
            "x-uais-trace-id": "trace-production-local-storage-denied",
          },
          body: JSON.stringify({
            operationId: "course-settings",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(503);
      expect(body.error).toBe(
        "Production teaching operation persistence requires external storage.",
      );
      expect(database.records).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expect(database.domainProjections).toHaveLength(0);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("treats UAIS_DEPLOYMENT_ENV production as production before local teaching operation writes", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-deployment-env-production-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-auth-session-deployment-env-production",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:58:00.000Z",
        expiresAt: "2026-06-22T11:58:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_DEPLOYMENT_ENV: "production",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
      },
      getTeachingOperationCourseOwnership: async () => ({
        teacherId: "teacher-kang",
        courseIds: ["teacher-research-methods"],
      }),
      now: new Date("2026-06-22T11:00:00.000Z"),
    });

    try {
      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
            "x-uais-trace-id": "trace-deployment-env-production-local-storage-denied",
          },
          body: JSON.stringify({
            operationId: "course-settings",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(503);
      expect(body.error).toBe(
        "Production teaching operation persistence requires external storage.",
      );
      expect(body.traceId).toBe("trace-deployment-env-production-local-storage-denied");
      expect(database.records).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expect(database.domainProjections).toHaveLength(0);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it.each([
    {
      operationId: "students",
      actionSlot: "primary",
      expectedError: "Student roster sync provider is not configured.",
    },
    {
      operationId: "knowledge-base",
      actionSlot: "primary",
      expectedError: "Knowledge index sync provider is not configured.",
    },
    {
      operationId: "content",
      actionSlot: "primary",
      expectedError: "Course content publish provider is not configured.",
    },
    {
      operationId: "admins",
      actionSlot: "secondary",
      expectedError: "Collaboration invite email provider is not configured.",
    },
    {
      operationId: "data-export",
      actionSlot: "primary",
      expectedError: "Course export provider is not configured.",
    },
    {
      operationId: "grading",
      actionSlot: "secondary",
      expectedError: "Grading feedback provider is not configured.",
    },
  ] as const)(
    "fails closed in production before writes when $operationId:$actionSlot provider side effect is not configured",
    async ({ operationId, actionSlot, expectedError }) => {
      const dataDir = await mkdtemp(
        join(tmpdir(), `uais-teaching-route-production-provider-${operationId}-${actionSlot}-`),
      );
      const operationsDataDir = join(dataDir, "operations");
      const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
      const externalToken = "test-external-storage-access-token-with-32-chars";
      const courseId = "teacher-research-methods";
      const cookie = createUaisTeacherAuthSessionCookieHeader({
        secret: teacherAuthSecret,
        claims: {
          sessionId: `teacher-provider-preflight-${operationId}-${actionSlot}`,
          actorId: "teacher-kang",
          role: "teacher",
          authenticatedAt: "2026-06-22T10:58:00.000Z",
          expiresAt: "2026-06-22T11:58:00.000Z",
        },
      });
      const appendedOperations: string[] = [];
      const externalRequests: Array<{ url: string; method?: string }> = [];
      const postOperation = createTeachingOperationActionPostHandler({
        env: {
          UAIS_DEPLOYMENT_ENV: "production",
          UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
          UAIS_TEACHING_OPERATIONS_BACKEND: "external",
          UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
          UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test/uais",
          UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
          ...productionTeacherAuthProviderEnv(teacherAuthSecret),
        },
        fetch: async (url, init) => {
          externalRequests.push({
            url: String(url),
            method: init?.method,
          });
          return Response.json(
            { error: "external request should not run before provider preflight" },
            { status: 502 },
          );
        },
        getTeachingOperationCourseOwnership: async () => ({
          teacherId: "teacher-kang",
          courseIds: [courseId],
        }),
        appendExternalTeachingOperation: async ({ record }) => {
          appendedOperations.push(record.recordId);
          return {
            teacherId: record.actorId,
            receiptId: record.recordId,
            status: "persisted",
            storagePolicy: "external-redacted-teaching-operation-append",
            storageWritePolicy: "external-append-only-operation-log",
            responsibleSession: "S12",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
            appendSequence: 1,
            idempotencyStatus: "persisted",
            productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
          };
        },
        now: new Date("2026-06-22T11:10:00.000Z"),
      });

      try {
        const response = await postOperation(
          new Request("https://www.uais.top/api/teaching/operations", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie,
              "x-uais-trace-id": `trace-production-${operationId}-${actionSlot}-provider-missing`,
            },
            body: JSON.stringify({
              operationId,
              actionSlot,
              courseId,
              sourceAction: "inline-teaching-workspace",
              idempotencyKey: `production-${operationId}-${actionSlot}-provider-missing`,
            }),
          }),
        );
        const body = await response.json();
        const database = await readTeachingOperationDatabase({
          dataDir: operationsDataDir,
        });

        expect(response.status).toBe(503);
        expect(body.error).toBe(expectedError);
        expect(body.receipt).toBeUndefined();
        expect(body.domainPersistenceSummary).toBeUndefined();
        expect(body.partialFailure).toBeUndefined();
        expect(appendedOperations).toEqual([]);
        expect(externalRequests).toEqual([]);
        expect(database.records).toHaveLength(0);
        expect(database.auditEvents).toHaveLength(0);
        expect(database.domainProjections).toHaveLength(0);
        expect(JSON.stringify(body)).not.toContain(externalToken);
        expect(JSON.stringify(body)).not.toContain("external-storage.example.test");
        expectNoLocalOrSecretValues(body, dataDir);
      } finally {
        await rm(dataDir, { recursive: true, force: true });
      }
    },
  );

  it.each([
    {
      operationId: "students",
      actionSlot: "primary",
      providerEnv: {
        UAIS_STUDENT_ROSTER_SYNC_PROVIDER: "external",
        UAIS_STUDENT_ROSTER_SYNC_PROVIDER_URL: "http://127.0.0.1:4100/student-roster-sync",
        UAIS_STUDENT_ROSTER_SYNC_PROVIDER_TOKEN:
          "test-student-roster-provider-token-with-32-chars",
      },
      expectedError: "Student roster sync provider URL is invalid.",
    },
    {
      operationId: "knowledge-base",
      actionSlot: "primary",
      providerEnv: {
        UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER: "external",
        UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_URL: "http://127.0.0.1:4100/knowledge-index-sync",
        UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_TOKEN:
          "test-knowledge-index-provider-token-with-32-chars",
      },
      expectedError: "Knowledge index sync provider URL is invalid.",
    },
    {
      operationId: "content",
      actionSlot: "primary",
      providerEnv: {
        UAIS_COURSE_CONTENT_PUBLISH_PROVIDER: "external",
        UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_URL: "http://127.0.0.1:4100/content-publish",
        UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_TOKEN:
          "test-course-content-provider-token-with-32-chars",
      },
      expectedError: "Course content publish provider URL is invalid.",
    },
    {
      operationId: "admins",
      actionSlot: "secondary",
      providerEnv: {
        UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER: "external",
        UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_URL:
          "http://127.0.0.1:4100/collaboration-invite-email",
        UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN:
          "test-collaboration-email-provider-token-with-32-chars",
      },
      expectedError: "Collaboration invite email provider URL is invalid.",
    },
    {
      operationId: "data-export",
      actionSlot: "primary",
      providerEnv: {
        UAIS_COURSE_EXPORT_PROVIDER: "external",
        UAIS_COURSE_EXPORT_PROVIDER_URL: "http://127.0.0.1:4100/course-export",
        UAIS_COURSE_EXPORT_PROVIDER_TOKEN:
          "test-course-export-provider-token-with-32-chars",
      },
      expectedError: "Course export provider URL is invalid.",
    },
    {
      operationId: "grading",
      actionSlot: "secondary",
      providerEnv: {
        UAIS_GRADING_FEEDBACK_PROVIDER: "external",
        UAIS_GRADING_FEEDBACK_PROVIDER_URL: "http://127.0.0.1:4100/grading-feedback",
        UAIS_GRADING_FEEDBACK_PROVIDER_TOKEN:
          "test-grading-feedback-provider-token-with-32-chars",
      },
      expectedError: "Grading feedback provider URL is invalid.",
    },
  ] as const)(
    "fails closed in production before writes when $operationId:$actionSlot provider side effect URL is not remote HTTPS",
    async ({ operationId, actionSlot, providerEnv, expectedError }) => {
      const dataDir = await mkdtemp(
        join(tmpdir(), `uais-teaching-route-production-provider-url-${operationId}-${actionSlot}-`),
      );
      const operationsDataDir = join(dataDir, "operations");
      const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
      const externalToken = "test-external-storage-access-token-with-32-chars";
      const courseId = "teacher-research-methods";
      const cookie = createUaisTeacherAuthSessionCookieHeader({
        secret: teacherAuthSecret,
        claims: {
          sessionId: `teacher-provider-url-preflight-${operationId}-${actionSlot}`,
          actorId: "teacher-kang",
          role: "teacher",
          authenticatedAt: "2026-06-22T10:58:00.000Z",
          expiresAt: "2026-06-22T11:58:00.000Z",
        },
      });
      const appendedOperations: string[] = [];
      const externalRequests: Array<{ url: string; method?: string }> = [];
      const postOperation = createTeachingOperationActionPostHandler({
        env: {
          UAIS_DEPLOYMENT_ENV: "production",
          UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
          UAIS_TEACHING_OPERATIONS_BACKEND: "external",
          UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
          UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test/uais",
          UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
          ...providerEnv,
          ...productionTeacherAuthProviderEnv(teacherAuthSecret),
        },
        fetch: async (url, init) => {
          externalRequests.push({
            url: String(url),
            method: init?.method,
          });
          return Response.json(
            { error: "external request should not run before provider URL preflight" },
            { status: 502 },
          );
        },
        getTeachingOperationCourseOwnership: async () => ({
          teacherId: "teacher-kang",
          courseIds: [courseId],
        }),
        appendExternalTeachingOperation: async ({ record }) => {
          appendedOperations.push(record.recordId);
          return {
            teacherId: record.actorId,
            receiptId: record.recordId,
            status: "persisted",
            storagePolicy: "external-redacted-teaching-operation-append",
            storageWritePolicy: "external-append-only-operation-log",
            responsibleSession: "S12",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
            appendSequence: 1,
            idempotencyStatus: "persisted",
            productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
          };
        },
        now: new Date("2026-06-22T11:10:00.000Z"),
      });

      try {
        const response = await postOperation(
          new Request("https://www.uais.top/api/teaching/operations", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie,
              "x-uais-trace-id": `trace-production-${operationId}-${actionSlot}-provider-url-denied`,
            },
            body: JSON.stringify({
              operationId,
              actionSlot,
              courseId,
              sourceAction: "inline-teaching-workspace",
              idempotencyKey: `production-${operationId}-${actionSlot}-provider-url-denied`,
            }),
          }),
        );
        const body = await response.json();
        const database = await readTeachingOperationDatabase({
          dataDir: operationsDataDir,
        });

        expect(response.status).toBe(503);
        expect(body.error).toBe(expectedError);
        expect(body.receipt).toBeUndefined();
        expect(body.domainPersistenceSummary).toBeUndefined();
        expect(body.partialFailure).toBeUndefined();
        expect(appendedOperations).toEqual([]);
        expect(externalRequests).toEqual([]);
        expect(database.records).toHaveLength(0);
        expect(database.auditEvents).toHaveLength(0);
        expect(database.domainProjections).toHaveLength(0);
        expect(JSON.stringify(body)).not.toContain("127.0.0.1");
        expect(JSON.stringify(body)).not.toContain(externalToken);
        expect(JSON.stringify(body)).not.toContain("provider-token");
        expectNoLocalOrSecretValues(body, dataDir);
      } finally {
        await rm(dataDir, { recursive: true, force: true });
      }
    },
  );

  it("rejects production teaching operations before external writes when course ownership access would use local JSON", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-production-local-ownership-"));
    const operationsDataDir = join(dataDir, "operations");
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const courseId = "teacher-research-methods";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-auth-session-local-ownership-production",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:00:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const appendedOperations: string[] = [];
    const externalRequests: Array<{ url: string; method?: string }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      externalRequests.push({
        url: String(url),
        method: init?.method,
      });
      return Response.json(
        { error: "external persistence should not be reached before ownership guard" },
        { status: 502 },
      );
    };
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: operationsDataDir,
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      fetch: fetchImpl,
      appendExternalTeachingOperation: async ({ record }) => {
        appendedOperations.push(record.recordId);
        return {
          teacherId: record.actorId,
          receiptId: record.recordId,
          status: "persisted",
          storagePolicy: "external-redacted-teaching-operation-append",
          storageWritePolicy: "external-append-only-operation-log",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
      now: new Date("2026-06-22T11:05:00.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [courseId],
        },
        updatedAt: "2026-06-22T11:01:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
            "x-uais-trace-id": "trace-production-local-ownership-denied",
          },
          body: JSON.stringify({
            operationId: "course-settings",
            actionSlot: "primary",
            courseId,
            sourceAction: "manage",
            idempotencyKey: "production-local-ownership-denied",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({
        dataDir: operationsDataDir,
      });

      expect(response.status).toBe(503);
      expect(body.error).toBe(
        "Production teaching operation course ownership access requires external storage.",
      );
      expect(body.traceId).toBe("trace-production-local-ownership-denied");
      expect(body.receipt).toBeUndefined();
      expect(body.partialFailure).toBeUndefined();
      expect(appendedOperations).toEqual([]);
      expect(externalRequests).toEqual([]);
      expect(database.records).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expect(database.domainProjections).toHaveLength(0);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("uses the external teaching operations backend instead of local JSON when production storage is configured", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-external-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-auth-session-cookie-id",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:00:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const externalRequests: Array<{
      url: string;
      authorization: string | null;
      body: unknown;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const requestBody =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      externalRequests.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        body: requestBody,
      });

      return new Response(
        JSON.stringify({
          teacherId: "teacher-kang",
          receiptId: requestBody?.record?.recordId,
          status: "persisted",
          appendSequence: 1,
          storagePolicy: "external-redacted-teaching-operation-append",
          storageWritePolicy: "external-append-only-operation-log",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN:
          "test-external-storage-access-token-with-32-chars",
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T11:05:00.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T11:01:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
            "x-uais-trace-id": "trace-external-teaching-ops-001",
          },
          body: JSON.stringify({
            operationId: "course-settings",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(200);
      expect(body.receipt).toEqual(
        expect.objectContaining({
          actorId: "teacher-kang",
          courseId: "teacher-research-methods",
          status: "persisted",
          storagePolicy: "external-redacted-teaching-operation-append",
          storageWritePolicy: "external-append-only-operation-log",
          externalAppend: expect.objectContaining({
            teacherId: "teacher-kang",
            status: "persisted",
            appendSequence: 1,
            storagePolicy: "external-redacted-teaching-operation-append",
            storageWritePolicy: "external-append-only-operation-log",
            responsibleSession: "S12",
          }),
          audit: expect.objectContaining({
            traceId: "trace-external-teaching-ops-001",
            storagePolicy: "external-redacted-teaching-operation-audit-log",
          }),
        }),
      );
      expect(externalRequests).toEqual([
        expect.objectContaining({
          url: "https://external-storage.example.test/teaching-operations/teacher-kang/append",
          authorization: "Bearer test-external-storage-access-token-with-32-chars",
          body: expect.objectContaining({
            action: "append-teaching-operation",
            record: expect.objectContaining({
              actorId: "teacher-kang",
              courseId: "teacher-research-methods",
              operationId: "course-settings",
            }),
            auditEvent: expect.objectContaining({
              traceId: "trace-external-teaching-ops-001",
              authMode: "signed-teacher-session",
            }),
          }),
        }),
      ]);
      expect(database.records).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("reads external teaching operation records and domain projections through signed audit readback", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-external-audit-readback-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-auth-session-cookie-id",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:10:00.000Z",
        expiresAt: "2026-06-22T12:10:00.000Z",
      },
    });
    const externalRequests: Array<{
      url: string;
      authorization: string | null;
      method?: string;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      externalRequests.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        method: init?.method,
      });

      return new Response(
        JSON.stringify({
          teacherId: "teacher-kang",
          eventType: "teaching-operation-audit",
          storagePolicy: "external-redacted-teaching-operation-audit-log",
          storageWritePolicy: "external-append-only-audit-log",
          recordCount: 2,
          operationRecordCount: 2,
          domainProjectionCount: 2,
          rollbackRecordCount: 2,
          records: [
            {
              recordId: "course-settings-save-course-settings-20260622-110500-abcd1234",
              operationId: "course-settings",
              actionSlot: "primary",
              actionId: "save-course-settings",
              actorId: "teacher-kang",
              courseId: "teacher-research-methods",
              createdAt: "2026-06-22T11:05:00.000Z",
              status: "persisted",
              appendSequence: 1,
              storagePolicy: "external-redacted-teaching-operation-append",
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "ids-only",
              },
              artifacts: [
                {
                  kind: "domain-object",
                  objectType: "course-settings",
                  objectId: "course-settings-teacher-research-methods",
                },
              ],
            },
            {
              recordId: "content-publish-course-content-20260622-111000-other",
              operationId: "content",
              actionSlot: "primary",
              actionId: "publish-course-content",
              actorId: "teacher-kang",
              courseId: "other-teacher-course",
              createdAt: "2026-06-22T11:10:00.000Z",
              status: "persisted",
              storagePolicy: "external-redacted-teaching-operation-append",
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "ids-only",
              },
              artifacts: [],
            },
          ],
          events: [
            {
              auditId: "audit-course-settings-save-course-settings-20260622-110500",
              traceId: "trace-external-audit-readback-owned",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              actorRole: "teacher",
              authMode: "signed-teacher-session",
              operationId: "course-settings",
              actionSlot: "primary",
              actionId: "save-course-settings",
              courseId: "teacher-research-methods",
              requestSource: {
                userAgent: "vitest external audit readback",
                ipAddress: "redacted",
              },
              createdAt: "2026-06-22T11:05:00.000Z",
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "ids-only",
              },
            },
            {
              auditId: "audit-content-publish-course-content-20260622-111000",
              traceId: "trace-external-audit-readback-unowned",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              actorRole: "teacher",
              authMode: "signed-teacher-session",
              operationId: "content",
              actionSlot: "primary",
              actionId: "publish-course-content",
              courseId: "other-teacher-course",
              requestSource: {
                userAgent: "vitest external audit readback",
                ipAddress: "redacted",
              },
              createdAt: "2026-06-22T11:10:00.000Z",
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "ids-only",
              },
            },
          ],
          domainProjections: [
            {
              objectId: "course-settings-teacher-research-methods",
              objectType: "course-settings",
              courseId: "teacher-research-methods",
              updatedBy: "teacher-kang",
              status: "saved",
              operationRecordId:
                "course-settings-save-course-settings-20260622-110500-abcd1234",
              updatedAt: "2026-06-22T11:05:00.000Z",
              storagePolicy: "domain-projection-teaching-course-settings",
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "ids-only",
              },
            },
            {
              objectId: "course-content-other-teacher-course",
              objectType: "course-content",
              courseId: "other-teacher-course",
              publishedBy: "teacher-kang",
              publicationStatus: "published",
              operationRecordId: "content-publish-course-content-20260622-111000-other",
              releaseScope: "course-visible-content",
              publishedAt: "2026-06-22T11:10:00.000Z",
              storagePolicy: "domain-projection-teaching-course-content",
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "ids-only",
              },
            },
          ],
          rollbacks: [
            {
              rollbackId:
                "teaching-operation-rollback-course-settings-save-course-settings-20260622-110500-abcd1234",
              action: "rollback-teaching-operation-record",
              teacherId: "teacher-kang",
              targetRecordId:
                "course-settings-save-course-settings-20260622-110500-abcd1234",
              courseId: "teacher-research-methods",
              targetOperationId: "course-settings",
              targetActionSlot: "primary",
              targetActionId: "save-course-settings",
              rollbackReason: "route-smoke-rollback",
              status: "persisted",
              rolledBackAt: "2026-06-22T11:15:00.000Z",
              storagePolicy: "external-redacted-teaching-operation-rollback",
              storageWritePolicy: "external-append-only-rollback-log",
              responsibleSession: "S12",
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "ids-only",
              },
            },
            {
              rollbackId:
                "teaching-operation-rollback-content-publish-course-content-20260622-111000-other",
              action: "rollback-teaching-operation-record",
              teacherId: "teacher-kang",
              targetRecordId: "content-publish-course-content-20260622-111000-other",
              courseId: "other-teacher-course",
              targetOperationId: "content",
              targetActionSlot: "primary",
              targetActionId: "publish-course-content",
              rollbackReason: "route-smoke-rollback",
              status: "persisted",
              rolledBackAt: "2026-06-22T11:16:00.000Z",
              storagePolicy: "external-redacted-teaching-operation-rollback",
              storageWritePolicy: "external-append-only-rollback-log",
              responsibleSession: "S12",
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "ids-only",
              },
            },
          ],
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };
    const getAudit = createTeachingOperationAuditGetHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN:
          "test-external-storage-access-token-with-32-chars",
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T11:20:00.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T11:11:00.000Z",
      });

      const response = await getAudit(
        new Request("https://www.uais.top/api/teaching/operations/audit", {
          method: "GET",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-external-teaching-audit-route",
            "user-agent": "vitest teaching external audit route",
          },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(externalRequests).toEqual([
        {
          url: "https://external-storage.example.test/teaching-operations/teacher-kang/audit",
          authorization: "Bearer test-external-storage-access-token-with-32-chars",
          method: "GET",
        },
      ]);
      expect(body).toEqual(
        expect.objectContaining({
          traceId: "trace-external-teaching-audit-route",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          storagePolicy: "external-redacted-teaching-operation-audit-log",
          storageWritePolicy: "external-append-only-audit-log",
          responsibleSession: "S12",
          recordCount: 1,
          auditEventCount: 1,
          domainProjectionCount: 1,
          rollbackRecordCount: 1,
        }),
      );
      expect(body.records).toEqual([
        expect.objectContaining({
          recordId: "course-settings-save-course-settings-20260622-110500-abcd1234",
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          appendSequence: 1,
        }),
      ]);
      expect(body.auditEvents).toEqual([
        expect.objectContaining({
          traceId: "trace-external-audit-readback-owned",
          courseId: "teacher-research-methods",
          actorId: "teacher-kang",
        }),
      ]);
      expect(body.domainProjections).toEqual([
        expect.objectContaining({
          objectId: "course-settings-teacher-research-methods",
          objectType: "course-settings",
          courseId: "teacher-research-methods",
          operationRecordId:
            "course-settings-save-course-settings-20260622-110500-abcd1234",
          storagePolicy: "domain-projection-teaching-course-settings",
        }),
      ]);
      expect(body.rollbackRecords).toEqual([
        expect.objectContaining({
          rollbackId:
            "teaching-operation-rollback-course-settings-save-course-settings-20260622-110500-abcd1234",
          action: "rollback-teaching-operation-record",
          teacherId: "teacher-kang",
          targetRecordId:
            "course-settings-save-course-settings-20260622-110500-abcd1234",
          courseId: "teacher-research-methods",
          targetOperationId: "course-settings",
          targetActionSlot: "primary",
          targetActionId: "save-course-settings",
          rollbackReason: "route-smoke-rollback",
          status: "persisted",
          storagePolicy: "external-redacted-teaching-operation-rollback",
          storageWritePolicy: "external-append-only-rollback-log",
          responsibleSession: "S12",
        }),
      ]);
      expect(JSON.stringify(body)).not.toContain("other-teacher-course");
      expect(JSON.stringify(body)).not.toContain("trace-external-audit-readback-unowned");
      expect(JSON.stringify(body)).not.toContain(
        "teaching-operation-rollback-content-publish-course-content-20260622-111000-other",
      );
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed when external teaching operation audit records omit operation action identity", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-external-audit-malformed-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-auth-session-cookie-id",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:30:00.000Z",
        expiresAt: "2026-06-22T12:30:00.000Z",
      },
    });
    const externalRequests: Array<{
      url: string;
      authorization: string | null;
      method?: string;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      externalRequests.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        method: init?.method,
      });

      return new Response(
        JSON.stringify({
          teacherId: "teacher-kang",
          eventType: "teaching-operation-audit",
          storagePolicy: "external-redacted-teaching-operation-audit-log",
          storageWritePolicy: "external-append-only-audit-log",
          recordCount: 1,
          operationRecordCount: 1,
          domainProjectionCount: 0,
          rollbackRecordCount: 0,
          records: [
            {
              recordId: "malformed-audit-record-without-action-identity",
              actorId: "teacher-kang",
              courseId: "teacher-research-methods",
              createdAt: "2026-06-22T11:30:00.000Z",
              status: "persisted",
              storagePolicy: "external-redacted-teaching-operation-append",
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "ids-only",
              },
              artifacts: [],
            },
          ],
          auditEvents: [],
          domainProjections: [],
          rollbackRecords: [],
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };
    const getAudit = createTeachingOperationAuditGetHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN:
          "test-external-storage-access-token-with-32-chars",
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T11:35:00.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T11:31:00.000Z",
      });

      const response = await getAudit(
        new Request("https://www.uais.top/api/teaching/operations/audit", {
          method: "GET",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-external-teaching-audit-malformed-record",
            "user-agent": "vitest teaching external malformed audit route",
          },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(502);
      expect(body).toEqual(
        expect.objectContaining({
          traceId: "trace-external-teaching-audit-malformed-record",
          error: "External teaching operation audit readback response is invalid.",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      );
      expect(externalRequests).toEqual([
        {
          url: "https://external-storage.example.test/teaching-operations/teacher-kang/audit",
          authorization: "Bearer test-external-storage-access-token-with-32-chars",
          method: "GET",
        },
      ]);
      expect(JSON.stringify(body)).not.toContain(
        "malformed-audit-record-without-action-identity",
      );
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed when external teaching operation audit readback belongs to a different teacher", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-external-audit-teacher-mismatch-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-auth-session-cookie-id",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:40:00.000Z",
        expiresAt: "2026-06-22T12:40:00.000Z",
      },
    });
    const externalRequests: Array<{
      url: string;
      authorization: string | null;
      method?: string;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      externalRequests.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        method: init?.method,
      });

      return new Response(
        JSON.stringify({
          teacherId: "teacher-lee",
          eventType: "teaching-operation-audit",
          storagePolicy: "external-redacted-teaching-operation-audit-log",
          storageWritePolicy: "external-append-only-audit-log",
          recordCount: 1,
          operationRecordCount: 1,
          domainProjectionCount: 0,
          rollbackRecordCount: 0,
          records: [
            {
              recordId: "teacher-mismatched-audit-record",
              operationId: "course-settings",
              actionSlot: "primary",
              actionId: "save-course-settings",
              actorId: "teacher-lee",
              courseId: "teacher-research-methods",
              createdAt: "2026-06-22T11:40:00.000Z",
              status: "persisted",
              storagePolicy: "external-redacted-teaching-operation-append",
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "ids-only",
              },
              artifacts: [],
            },
          ],
          auditEvents: [
            {
              auditId: "audit-teacher-mismatched-audit-record",
              traceId: "trace-teacher-mismatched-audit-record",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-lee",
              actorRole: "teacher",
              authMode: "signed-teacher-session",
              operationId: "course-settings",
              actionSlot: "primary",
              actionId: "save-course-settings",
              courseId: "teacher-research-methods",
              requestSource: {
                userAgent: "vitest external audit teacher mismatch",
                ipAddress: "redacted",
              },
              createdAt: "2026-06-22T11:40:00.000Z",
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "ids-only",
              },
            },
          ],
          domainProjections: [],
          rollbackRecords: [],
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };
    const getAudit = createTeachingOperationAuditGetHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN:
          "test-external-storage-access-token-with-32-chars",
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T11:45:00.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T11:41:00.000Z",
      });

      const response = await getAudit(
        new Request("https://www.uais.top/api/teaching/operations/audit", {
          method: "GET",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-external-teaching-audit-teacher-mismatch",
            "user-agent": "vitest teaching external audit teacher mismatch",
          },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(502);
      expect(body).toEqual(
        expect.objectContaining({
          traceId: "trace-external-teaching-audit-teacher-mismatch",
          error: "External teaching operation audit readback response is invalid.",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      );
      expect(externalRequests).toEqual([
        {
          url: "https://external-storage.example.test/teaching-operations/teacher-kang/audit",
          authorization: "Bearer test-external-storage-access-token-with-32-chars",
          method: "GET",
        },
      ]);
      expect(JSON.stringify(body)).not.toContain("teacher-lee");
      expect(JSON.stringify(body)).not.toContain("teacher-mismatched-audit-record");
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("reads external teaching operation audit alerts through signed teacher access without leaking storage credentials", async () => {
    const alertsRouteModulePath = "@/app/api/teaching/operations/audit/alerts/route";
    const routeModule = await import(/* @vite-ignore */ alertsRouteModulePath).catch(
      () => undefined,
    );
    expect(routeModule?.createTeachingOperationAuditAlertsGetHandler).toBeTypeOf("function");

    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-external-alerts-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-auth-session-cookie-id",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:25:00.000Z",
        expiresAt: "2026-06-22T12:25:00.000Z",
      },
    });
    const externalRequests: Array<{
      url: string;
      authorization: string | null;
      method?: string;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      externalRequests.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        method: init?.method,
      });

      return new Response(
        JSON.stringify({
          teacherId: "teacher-kang",
          status: "attention-required",
          eventType: "teaching-operation-audit-alert-summary",
          storagePolicy: "external-redacted-teaching-operation-audit-alerts",
          sourceStoragePolicy: "external-redacted-teaching-operation-audit-log",
          alertPolicy: {
            policyId: "s12-teaching-operation-audit-alerts-v1",
            checks: ["missing-course-context"],
          },
          sourceRecordCount: 2,
          alertCount: 2,
          alerts: [
            {
              alertId: "missing-course-context-audit-owned",
              severity: "high",
              reason: "missing-course-context",
              auditId: "audit-owned",
              traceId: "trace-owned-alert",
              actorId: "teacher-kang",
              operationId: "admins",
              actionSlot: "secondary",
              actionId: "send-admin-email",
              createdAt: "2026-06-22T11:20:00.000Z",
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "ids-only",
              },
            },
          ],
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };
    const getAlerts = routeModule!.createTeachingOperationAuditAlertsGetHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T11:30:00.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T11:26:00.000Z",
      });

      const response = await getAlerts(
        new Request("https://www.uais.top/api/teaching/operations/audit/alerts", {
          method: "GET",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-external-teaching-alert-route",
            "user-agent": "vitest teaching external alert route",
          },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(externalRequests).toEqual([
        {
          url: "https://external-storage.example.test/teaching-operations/teacher-kang/audit/alerts",
          authorization: `Bearer ${externalToken}`,
          method: "GET",
        },
      ]);
      expect(body).toEqual(
        expect.objectContaining({
          traceId: "trace-external-teaching-alert-route",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          status: "attention-required",
          eventType: "teaching-operation-audit-alert-summary",
          storagePolicy: "external-redacted-teaching-operation-audit-alerts",
          alertCount: 1,
          notificationRoute: "/api/teaching/operations/audit/alerts/notifications",
          responsibleSession: "S12",
        }),
      );
      expect(body.alerts).toEqual([
        expect.objectContaining({
          alertId: "missing-course-context-audit-owned",
          severity: "high",
          reason: "missing-course-context",
          traceId: "trace-owned-alert",
          actorId: "teacher-kang",
        }),
      ]);
      expect(JSON.stringify(body)).not.toContain(externalToken);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("filters cross-teacher external teaching operation audit alerts before returning them", async () => {
    const alertsRouteModulePath = "@/app/api/teaching/operations/audit/alerts/route";
    const routeModule = await import(/* @vite-ignore */ alertsRouteModulePath).catch(
      () => undefined,
    );
    expect(routeModule?.createTeachingOperationAuditAlertsGetHandler).toBeTypeOf("function");

    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-external-alert-scope-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-alert-scope-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:25:00.000Z",
        expiresAt: "2026-06-22T12:25:00.000Z",
      },
    });
    const createAlert = (actorId: string) => ({
      alertId: `missing-course-context-audit-${actorId}`,
      severity: "high",
      reason: "missing-course-context",
      auditId: `audit-${actorId}`,
      traceId: `trace-alert-${actorId}`,
      actorId,
      operationId: "admins",
      actionSlot: "secondary",
      actionId: "send-admin-email",
      createdAt: "2026-06-22T11:20:00.000Z",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    });
    const externalAlerts = [
      createAlert("teacher-kang"),
      createAlert("teacher-other"),
    ];
    const fetchImpl: typeof fetch = async () =>
      Response.json({
        teacherId: "teacher-kang",
        status: "attention-required",
        eventType: "teaching-operation-audit-alert-summary",
        storagePolicy: "external-redacted-teaching-operation-audit-alerts",
        sourceStoragePolicy: "external-redacted-teaching-operation-audit-log",
        alertPolicy: {
          policyId: "s12-teaching-operation-audit-alerts-v1",
          checks: ["missing-course-context"],
        },
        sourceRecordCount: externalAlerts.length,
        alertCount: externalAlerts.length,
        alerts: externalAlerts,
        responsibleSession: "S12",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      });
    const getAlerts = routeModule!.createTeachingOperationAuditAlertsGetHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T11:30:00.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T11:26:00.000Z",
      });

      const response = await getAlerts(
        new Request("https://www.uais.top/api/teaching/operations/audit/alerts", {
          method: "GET",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-external-teaching-alert-scope-route",
          },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.alertCount).toBe(1);
      expect(body.alerts).toEqual([
        expect.objectContaining({
          alertId: "missing-course-context-audit-teacher-kang",
          actorId: "teacher-kang",
          traceId: "trace-alert-teacher-kang",
        }),
      ]);
      expect(JSON.stringify(body)).not.toContain("teacher-other");
      expect(JSON.stringify(body)).not.toContain(externalToken);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("blocks production teaching operation audit alert readback before ownership or external alerts when teacher auth provider is not production-ready", async () => {
    const alertsRouteModulePath = "@/app/api/teaching/operations/audit/alerts/route";
    const routeModule = await import(/* @vite-ignore */ alertsRouteModulePath).catch(
      () => undefined,
    );
    expect(routeModule?.createTeachingOperationAuditAlertsGetHandler).toBeTypeOf("function");

    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-alerts-auth-provider-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-operation-alerts-auth-provider-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:25:00.000Z",
        expiresAt: "2026-06-22T12:25:00.000Z",
      },
    });
    let ownershipCheckCount = 0;
    let externalAlertsReadCount = 0;
    const getAlerts = routeModule!.createTeachingOperationAuditAlertsGetHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      getTeachingOperationCourseOwnership: async () => {
        ownershipCheckCount += 1;
        return {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        };
      },
      readExternalTeachingOperationAuditAlerts: async () => {
        externalAlertsReadCount += 1;
        return {
          teacherId: "teacher-kang",
          status: "clear",
          eventType: "teaching-operation-audit-alert-summary",
          storagePolicy: "external-redacted-teaching-operation-audit-alerts",
          sourceStoragePolicy: "external-redacted-teaching-operation-audit-log",
          alertPolicy: {
            policyId: "s12-teaching-operation-audit-alerts-v1",
            checks: ["missing-course-context"],
          },
          sourceRecordCount: 0,
          alertCount: 0,
          alerts: [],
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
      now: new Date("2026-06-22T11:30:00.000Z"),
    });

    try {
      const response = await getAlerts(
        new Request("https://www.uais.top/api/teaching/operations/audit/alerts", {
          method: "GET",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-production-alerts-auth-provider-not-ready",
            "user-agent": "UAIS production audit alerts auth provider not ready",
          },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-production-alerts-auth-provider-not-ready",
      );
      expect(body.error).toBe("UAIS teacher auth provider is not production-ready.");
      expect(body.traceId).toBe("trace-production-alerts-auth-provider-not-ready");
      expect(body.access).toEqual(
        expect.objectContaining({
          status: "denied",
          reasonCode: "teacher-auth-provider-not-production-ready",
          responsibleSession: "S12",
        }),
      );
      expect(body.authProviderContract).toEqual(
        expect.objectContaining({
          providerKind: "missing",
          productionStatus: "blocked",
          blockedReason: "missing-UAIS_TEACHER_AUTH_PROVIDER",
          redaction: {
            values: "omitted",
            cookies: "omitted",
          },
        }),
      );
      expect(ownershipCheckCount).toBe(0);
      expect(externalAlertsReadCount).toBe(0);
      expect(JSON.stringify(body)).not.toContain(externalToken);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("requires production database adapter evidence on production audit alert readback", async () => {
    const alertsRouteModulePath = "@/app/api/teaching/operations/audit/alerts/route";
    const routeModule = await import(/* @vite-ignore */ alertsRouteModulePath).catch(
      () => undefined,
    );
    expect(routeModule?.createTeachingOperationAuditAlertsGetHandler).toBeTypeOf("function");

    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-alerts-db-evidence-missing-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-alerts-db-evidence-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:50:00.000Z",
        expiresAt: "2026-06-22T12:50:00.000Z",
      },
    });
    const getAlerts = routeModule!.createTeachingOperationAuditAlertsGetHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      fetch: async () =>
        Response.json({
          teacherId: "teacher-kang",
          status: "clear",
          eventType: "teaching-operation-audit-alert-summary",
          storagePolicy: "external-redacted-teaching-operation-audit-alerts",
          sourceStoragePolicy: "external-redacted-teaching-operation-audit-log",
          alertPolicy: {
            policyId: "s12-teaching-operation-audit-alerts-v1",
            checks: ["missing-course-context"],
          },
          sourceRecordCount: 0,
          alertCount: 0,
          alerts: [],
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      getTeachingOperationCourseOwnership: async () => ({
        teacherId: "teacher-kang",
        courseIds: ["teacher-research-methods"],
      }),
      now: new Date("2026-06-22T11:55:00.000Z"),
    });

    try {
      const response = await getAlerts(
        new Request("https://www.uais.top/api/teaching/operations/audit/alerts", {
          method: "GET",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-production-alerts-db-evidence-missing",
            "user-agent": "UAIS production alert database evidence missing",
          },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(502);
      expect(body).toEqual(
        expect.objectContaining({
          traceId: "trace-production-alerts-db-evidence-missing",
          error:
            "External teaching operation audit alert readback is missing production database adapter evidence.",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      );
      expect(JSON.stringify(body)).not.toContain(externalToken);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("returns production database adapter evidence from production audit alert readback", async () => {
    const alertsRouteModulePath = "@/app/api/teaching/operations/audit/alerts/route";
    const routeModule = await import(/* @vite-ignore */ alertsRouteModulePath).catch(
      () => undefined,
    );
    expect(routeModule?.createTeachingOperationAuditAlertsGetHandler).toBeTypeOf("function");

    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-alerts-db-evidence-ready-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const productionDatabaseAdapter = createReadyProductionDatabaseAdapter();
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-alerts-db-evidence-ready-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:55:00.000Z",
        expiresAt: "2026-06-22T12:55:00.000Z",
      },
    });
    const getAlerts = routeModule!.createTeachingOperationAuditAlertsGetHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      fetch: async () =>
        Response.json({
          teacherId: "teacher-kang",
          status: "clear",
          eventType: "teaching-operation-audit-alert-summary",
          storagePolicy: "external-redacted-teaching-operation-audit-alerts",
          sourceStoragePolicy: "external-redacted-teaching-operation-audit-log",
          alertPolicy: {
            policyId: "s12-teaching-operation-audit-alerts-v1",
            checks: ["missing-course-context"],
          },
          sourceRecordCount: 0,
          alertCount: 0,
          alerts: [],
          productionDatabaseAdapter,
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      getTeachingOperationCourseOwnership: async () => ({
        teacherId: "teacher-kang",
        courseIds: ["teacher-research-methods"],
      }),
      now: new Date("2026-06-22T12:00:00.000Z"),
    });

    try {
      const response = await getAlerts(
        new Request("https://www.uais.top/api/teaching/operations/audit/alerts", {
          method: "GET",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-production-alerts-db-evidence-ready",
            "user-agent": "UAIS production alert database evidence ready",
          },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual(
        expect.objectContaining({
          traceId: "trace-production-alerts-db-evidence-ready",
          actorId: "teacher-kang",
          status: "clear",
          productionDatabaseAdapter,
          notificationRoute: "/api/teaching/operations/audit/alerts/notifications",
          responsibleSession: "S12",
        }),
      );
      expect(JSON.stringify(body)).not.toContain(externalToken);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed audit alert actor ids before ownership or external alerts", async () => {
    const alertsRouteModulePath = "@/app/api/teaching/operations/audit/alerts/route";
    const routeModule = await import(/* @vite-ignore */ alertsRouteModulePath).catch(
      () => undefined,
    );
    expect(routeModule?.createTeachingOperationAuditAlertsGetHandler).toBeTypeOf("function");

    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-alerts-unsafe-actor-id-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const unsafeActorId = "/Users/example/secret-token-alert-teacher";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-operation-alerts-unsafe-actor-session",
        actorId: unsafeActorId,
        role: "teacher",
        authenticatedAt: "2026-06-22T11:25:00.000Z",
        expiresAt: "2026-06-22T12:25:00.000Z",
      },
    });
    let ownershipCheckCount = 0;
    let externalAlertsReadCount = 0;
    const getAlerts = routeModule!.createTeachingOperationAuditAlertsGetHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      getTeachingOperationCourseOwnership: async () => {
        ownershipCheckCount += 1;
        return {
          teacherId: unsafeActorId,
          courseIds: ["teacher-research-methods"],
        };
      },
      readExternalTeachingOperationAuditAlerts: async () => {
        externalAlertsReadCount += 1;
        return {
          teacherId: unsafeActorId,
          status: "clear",
          eventType: "teaching-operation-audit-alert-summary",
          storagePolicy: "external-redacted-teaching-operation-audit-alerts",
          sourceStoragePolicy: "external-redacted-teaching-operation-audit-log",
          alertPolicy: {
            policyId: "s12-teaching-operation-audit-alerts-v1",
            checks: ["missing-course-context"],
          },
          sourceRecordCount: 0,
          alertCount: 0,
          alerts: [],
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
      now: new Date("2026-06-22T11:30:00.000Z"),
    });

    try {
      const response = await getAlerts(
        new Request("https://www.uais.top/api/teaching/operations/audit/alerts", {
          method: "GET",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-alerts-unsafe-actor-id",
            "user-agent": "UAIS audit alerts unsafe actor test",
          },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-alerts-unsafe-actor-id",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-alerts-unsafe-actor-id",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(ownershipCheckCount).toBe(0);
      expect(externalAlertsReadCount).toBe(0);
      expect(JSON.stringify(body)).not.toContain(unsafeActorId);
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed audit alert session ids before ownership or external alerts", async () => {
    const alertsRouteModulePath = "@/app/api/teaching/operations/audit/alerts/route";
    const routeModule = await import(/* @vite-ignore */ alertsRouteModulePath).catch(
      () => undefined,
    );
    expect(routeModule?.createTeachingOperationAuditAlertsGetHandler).toBeTypeOf("function");

    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-alerts-unsafe-session-id-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const unsafeSessionId = "/Users/example/secret-token-alert-session";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: unsafeSessionId,
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:25:00.000Z",
        expiresAt: "2026-06-22T12:25:00.000Z",
      },
    });
    let ownershipCheckCount = 0;
    let externalAlertsReadCount = 0;
    const getAlerts = routeModule!.createTeachingOperationAuditAlertsGetHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      getTeachingOperationCourseOwnership: async () => {
        ownershipCheckCount += 1;
        return {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        };
      },
      readExternalTeachingOperationAuditAlerts: async () => {
        externalAlertsReadCount += 1;
        return {
          teacherId: "teacher-kang",
          status: "clear",
          eventType: "teaching-operation-audit-alert-summary",
          storagePolicy: "external-redacted-teaching-operation-audit-alerts",
          sourceStoragePolicy: "external-redacted-teaching-operation-audit-log",
          alertPolicy: {
            policyId: "s12-teaching-operation-audit-alerts-v1",
            checks: ["missing-course-context"],
          },
          sourceRecordCount: 0,
          alertCount: 0,
          alerts: [],
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
      now: new Date("2026-06-22T11:30:00.000Z"),
    });

    try {
      const response = await getAlerts(
        new Request("https://www.uais.top/api/teaching/operations/audit/alerts", {
          method: "GET",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-alerts-unsafe-session-id",
            "user-agent": "UAIS audit alerts unsafe session test",
          },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-alerts-unsafe-session-id",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-alerts-unsafe-session-id",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(ownershipCheckCount).toBe(0);
      expect(externalAlertsReadCount).toBe(0);
      expect(JSON.stringify(body)).not.toContain(unsafeSessionId);
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects signed-student audit alert reads before touching external audit storage", async () => {
    const alertsRouteModulePath = "@/app/api/teaching/operations/audit/alerts/route";
    const routeModule = await import(/* @vite-ignore */ alertsRouteModulePath).catch(
      () => undefined,
    );
    expect(routeModule?.createTeachingOperationAuditAlertsGetHandler).toBeTypeOf("function");

    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-alerts-student-role-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const appSessionSecret = "test-app-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const studentCookie = createUaisAppSessionCookie(
      {
        account: "Peter",
        department: "学生账号",
        displayName: "Peter",
        role: "student",
      },
      {
        secret: appSessionSecret,
        sessionId: "student-operation-alert-session",
        now: new Date("2026-06-22T11:30:00.000Z"),
      },
    );
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-mixed-operation-alert-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:30:00.000Z",
        expiresAt: "2026-06-22T12:30:00.000Z",
      },
    });
    const externalRequests: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      externalRequests.push(String(url));
      return new Response("{}", { status: 500 });
    };
    const getAlerts = routeModule!.createTeachingOperationAuditAlertsGetHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T11:30:00.000Z"),
    });

    try {
      for (const [cookie, traceId] of [
        [studentCookie, "trace-student-alert-denied-001"],
        [`${studentCookie}; ${teacherCookie}`, "trace-mixed-student-alert-denied-001"],
      ] as const) {
        const response = await getAlerts(
          new Request("https://www.uais.top/api/teaching/operations/audit/alerts", {
            method: "GET",
            headers: {
              cookie,
              "x-uais-trace-id": traceId,
            },
          }),
        );
        const body = await response.json();

        expect(response.status).toBe(403);
        expect(response.headers.get("x-uais-trace-id")).toBe(traceId);
        expect(body.traceId).toBe(traceId);
        expect(body.access).toEqual(
          expect.objectContaining({
            status: "denied",
            reasonCode: "teacher-role-required",
            responsibleSession: "S12",
          }),
        );
        expect(JSON.stringify(body)).not.toContain(externalToken);
        expectNoLocalOrSecretValues(body, dataDir);
      }
      expect(externalRequests).toEqual([]);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed student account ids before audit alert reads", async () => {
    const alertsRouteModulePath = "@/app/api/teaching/operations/audit/alerts/route";
    const routeModule = await import(/* @vite-ignore */ alertsRouteModulePath).catch(
      () => undefined,
    );
    expect(routeModule?.createTeachingOperationAuditAlertsGetHandler).toBeTypeOf("function");

    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-alerts-unsafe-student-id-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const appSessionSecret = "test-app-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const unsafeStudentId = "/Users/example/secret-token-alert-student";
    const studentCookie = createUaisAppSessionCookie(
      {
        account: unsafeStudentId,
        department: "学生账号",
        displayName: "Unsafe Student",
        role: "student",
      },
      {
        secret: appSessionSecret,
        sessionId: "unsafe-student-operation-alert-session",
        now: new Date("2026-06-22T11:30:00.000Z"),
      },
    );
    const externalRequests: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      externalRequests.push(String(url));
      return new Response("{}", { status: 500 });
    };
    const getAlerts = routeModule!.createTeachingOperationAuditAlertsGetHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T11:30:00.000Z"),
    });

    try {
      const response = await getAlerts(
        new Request("https://www.uais.top/api/teaching/operations/audit/alerts", {
          method: "GET",
          headers: {
            cookie: studentCookie,
            "x-uais-trace-id": "trace-unsafe-student-alert-denied",
          },
        }),
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-unsafe-student-alert-denied",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-unsafe-student-alert-denied",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain(unsafeStudentId);
      expect(JSON.stringify(body)).not.toContain(externalToken);
      expectNoLocalOrSecretValues(body, dataDir);
      expect(externalRequests).toEqual([]);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects signed-student audit alert notification access before touching external storage", async () => {
    const notificationsRouteModulePath =
      "@/app/api/teaching/operations/audit/alerts/notifications/route";
    const routeModule = await import(/* @vite-ignore */ notificationsRouteModulePath).catch(
      () => undefined,
    );
    expect(routeModule?.createTeachingOperationAuditAlertNotificationsPostHandler)
      .toBeTypeOf("function");
    expect(routeModule?.createTeachingOperationAuditAlertNotificationsGetHandler)
      .toBeTypeOf("function");

    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-alert-notifications-student-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const appSessionSecret = "test-app-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const studentCookie = createUaisAppSessionCookie(
      {
        account: "Peter",
        department: "学生账号",
        displayName: "Peter",
        role: "student",
      },
      {
        secret: appSessionSecret,
        sessionId: "student-operation-alert-notification-session",
        now: new Date("2026-06-22T11:40:00.000Z"),
      },
    );
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-mixed-operation-alert-notification-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:40:00.000Z",
        expiresAt: "2026-06-22T12:40:00.000Z",
      },
    });
    const externalRequests: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      externalRequests.push(String(url));
      return new Response("{}", { status: 500 });
    };
    const env = {
      UAIS_TEACHING_OPERATIONS_BACKEND: "external",
      UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
      UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
      UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
    };
    const postNotifications =
      routeModule!.createTeachingOperationAuditAlertNotificationsPostHandler({
        env,
        fetch: fetchImpl,
        now: new Date("2026-06-22T11:40:00.000Z"),
      });
    const getNotifications =
      routeModule!.createTeachingOperationAuditAlertNotificationsGetHandler({
        env,
        fetch: fetchImpl,
        now: new Date("2026-06-22T11:40:00.000Z"),
      });

    try {
      for (const [handler, method, cookie, traceId] of [
        [
          postNotifications,
          "POST",
          studentCookie,
          "trace-student-alert-notify-post-denied-001",
        ],
        [
          getNotifications,
          "GET",
          studentCookie,
          "trace-student-alert-notify-get-denied-001",
        ],
        [
          postNotifications,
          "POST",
          `${studentCookie}; ${teacherCookie}`,
          "trace-mixed-student-alert-notify-post-denied-001",
        ],
        [
          getNotifications,
          "GET",
          `${studentCookie}; ${teacherCookie}`,
          "trace-mixed-student-alert-notify-get-denied-001",
        ],
      ] as const) {
        const response = await handler(
          new Request(
            "https://www.uais.top/api/teaching/operations/audit/alerts/notifications",
            {
              method,
              headers: {
                cookie,
                "x-uais-trace-id": traceId,
              },
            },
          ),
        );
        const body = await response.json();

        expect(response.status).toBe(403);
        expect(response.headers.get("x-uais-trace-id")).toBe(traceId);
        expect(body.traceId).toBe(traceId);
        expect(body.access).toEqual(
          expect.objectContaining({
            status: "denied",
            reasonCode: "teacher-role-required",
            responsibleSession: "S12",
          }),
        );
        expect(JSON.stringify(body)).not.toContain(externalToken);
        expectNoLocalOrSecretValues(body, dataDir);
      }
      expect(externalRequests).toEqual([]);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed student account ids before audit alert notification access", async () => {
    const notificationsRouteModulePath =
      "@/app/api/teaching/operations/audit/alerts/notifications/route";
    const routeModule = await import(/* @vite-ignore */ notificationsRouteModulePath).catch(
      () => undefined,
    );
    expect(routeModule?.createTeachingOperationAuditAlertNotificationsPostHandler)
      .toBeTypeOf("function");
    expect(routeModule?.createTeachingOperationAuditAlertNotificationsGetHandler)
      .toBeTypeOf("function");

    const dataDir = await mkdtemp(join(tmpdir(), "uais-alert-notify-unsafe-student-id-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const appSessionSecret = "test-app-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const unsafeStudentId = "/Users/example/secret-token-alert-notify-student";
    const studentCookie = createUaisAppSessionCookie(
      {
        account: unsafeStudentId,
        department: "学生账号",
        displayName: "Unsafe Student",
        role: "student",
      },
      {
        secret: appSessionSecret,
        sessionId: "unsafe-student-alert-notification-session",
        now: new Date("2026-06-22T11:40:00.000Z"),
      },
    );
    const externalRequests: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      externalRequests.push(String(url));
      return new Response("{}", { status: 500 });
    };
    const env = {
      UAIS_TEACHING_OPERATIONS_BACKEND: "external",
      UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
      UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
      UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
    };
    const postNotifications =
      routeModule!.createTeachingOperationAuditAlertNotificationsPostHandler({
        env,
        fetch: fetchImpl,
        now: new Date("2026-06-22T11:40:00.000Z"),
      });
    const getNotifications =
      routeModule!.createTeachingOperationAuditAlertNotificationsGetHandler({
        env,
        fetch: fetchImpl,
        now: new Date("2026-06-22T11:40:00.000Z"),
      });

    try {
      for (const [handler, method, traceId] of [
        [postNotifications, "POST", "trace-unsafe-student-alert-notify-post-denied"],
        [getNotifications, "GET", "trace-unsafe-student-alert-notify-get-denied"],
      ] as const) {
        const response = await handler(
          new Request(
            "https://www.uais.top/api/teaching/operations/audit/alerts/notifications",
            {
              method,
              headers: {
                cookie: studentCookie,
                "x-uais-trace-id": traceId,
              },
            },
          ),
        );
        const body = await response.json();

        expect(response.status, JSON.stringify(body)).toBe(401);
        expect(response.headers.get("x-uais-trace-id")).toBe(traceId);
        expect(body).toEqual(
          expect.objectContaining({
            error: "UAIS teacher authentication is required.",
            traceId,
            access: expect.objectContaining({
              status: "denied",
              reasonCode: "authenticated-session-required",
              responsibleSession: "S12",
            }),
          }),
        );
        expect(JSON.stringify(body)).not.toContain(unsafeStudentId);
        expect(JSON.stringify(body)).not.toContain(externalToken);
        expectNoLocalOrSecretValues(body, dataDir);
      }
      expect(externalRequests).toEqual([]);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed audit alert notification actor ids before ownership or external notifications", async () => {
    const notificationsRouteModulePath =
      "@/app/api/teaching/operations/audit/alerts/notifications/route";
    const routeModule = await import(/* @vite-ignore */ notificationsRouteModulePath).catch(
      () => undefined,
    );
    expect(routeModule?.createTeachingOperationAuditAlertNotificationsPostHandler)
      .toBeTypeOf("function");
    expect(routeModule?.createTeachingOperationAuditAlertNotificationsGetHandler)
      .toBeTypeOf("function");

    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-alert-notify-unsafe-actor-id-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const unsafeActorId = "/Users/example/secret-token-alert-notify-teacher";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-operation-alert-notify-unsafe-actor-session",
        actorId: unsafeActorId,
        role: "teacher",
        authenticatedAt: "2026-06-22T11:40:00.000Z",
        expiresAt: "2026-06-22T12:40:00.000Z",
      },
    });
    let ownershipCheckCount = 0;
    let externalNotificationEnqueueCount = 0;
    let externalNotificationReadCount = 0;
    const env = {
      UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    };
    const deps = {
      env,
      getTeachingOperationCourseOwnership: async () => {
        ownershipCheckCount += 1;
        return {
          teacherId: unsafeActorId,
          courseIds: ["teacher-research-methods"],
        };
      },
      enqueueExternalTeachingOperationAuditAlertNotifications: async () => {
        externalNotificationEnqueueCount += 1;
        return {
          teacherId: unsafeActorId,
          status: "clear",
          eventType: "teaching-operation-audit-alert-notification-dispatch",
          deliveryChannel: "admin-outbox",
          storagePolicy:
            "external-redacted-teaching-operation-audit-alert-notification-outbox",
          storageWritePolicy: "external-append-only-notification-outbox",
          notificationCount: 0,
          notifications: [],
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
      readExternalTeachingOperationAuditAlertNotifications: async () => {
        externalNotificationReadCount += 1;
        return {
          teacherId: unsafeActorId,
          eventType: "teaching-operation-audit-alert-notification-outbox",
          deliveryChannel: "admin-outbox",
          storagePolicy:
            "external-redacted-teaching-operation-audit-alert-notification-outbox",
          recordCount: 0,
          notifications: [],
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
      now: new Date("2026-06-22T11:40:00.000Z"),
    };
    const postNotifications =
      routeModule!.createTeachingOperationAuditAlertNotificationsPostHandler(deps);
    const getNotifications =
      routeModule!.createTeachingOperationAuditAlertNotificationsGetHandler(deps);

    try {
      for (const [handler, method, traceId] of [
        [postNotifications, "POST", "trace-alert-notify-unsafe-actor-post"],
        [getNotifications, "GET", "trace-alert-notify-unsafe-actor-get"],
      ] as const) {
        const response = await handler(
          new Request(
            "https://www.uais.top/api/teaching/operations/audit/alerts/notifications",
            {
              method,
              headers: {
                cookie,
                "x-uais-trace-id": traceId,
                "user-agent": "UAIS audit alert notification unsafe actor test",
              },
            },
          ),
        );
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(response.headers.get("x-uais-trace-id")).toBe(traceId);
        expect(body).toEqual(
          expect.objectContaining({
            error: "UAIS teacher authentication is required.",
            traceId,
            access: expect.objectContaining({
              status: "denied",
              reasonCode: "authenticated-session-required",
              responsibleSession: "S12",
            }),
          }),
        );
        expect(JSON.stringify(body)).not.toContain(unsafeActorId);
        expect(JSON.stringify(body)).not.toContain("secret-token");
        expectNoLocalOrSecretValues(body, dataDir);
      }
      expect(ownershipCheckCount).toBe(0);
      expect(externalNotificationEnqueueCount).toBe(0);
      expect(externalNotificationReadCount).toBe(0);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed audit alert notification session ids before ownership or external notifications", async () => {
    const notificationsRouteModulePath =
      "@/app/api/teaching/operations/audit/alerts/notifications/route";
    const routeModule = await import(/* @vite-ignore */ notificationsRouteModulePath).catch(
      () => undefined,
    );
    expect(routeModule?.createTeachingOperationAuditAlertNotificationsPostHandler)
      .toBeTypeOf("function");
    expect(routeModule?.createTeachingOperationAuditAlertNotificationsGetHandler)
      .toBeTypeOf("function");

    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-alert-notify-unsafe-session-id-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const unsafeSessionId = "/Users/example/secret-token-alert-notify-session";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: unsafeSessionId,
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:40:00.000Z",
        expiresAt: "2026-06-22T12:40:00.000Z",
      },
    });
    let ownershipCheckCount = 0;
    let externalNotificationEnqueueCount = 0;
    let externalNotificationReadCount = 0;
    const env = {
      UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    };
    const deps = {
      env,
      getTeachingOperationCourseOwnership: async () => {
        ownershipCheckCount += 1;
        return {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        };
      },
      enqueueExternalTeachingOperationAuditAlertNotifications: async () => {
        externalNotificationEnqueueCount += 1;
        return {
          teacherId: "teacher-kang",
          status: "clear",
          eventType: "teaching-operation-audit-alert-notification-dispatch",
          deliveryChannel: "admin-outbox",
          storagePolicy:
            "external-redacted-teaching-operation-audit-alert-notification-outbox",
          storageWritePolicy: "external-append-only-notification-outbox",
          notificationCount: 0,
          notifications: [],
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
      readExternalTeachingOperationAuditAlertNotifications: async () => {
        externalNotificationReadCount += 1;
        return {
          teacherId: "teacher-kang",
          eventType: "teaching-operation-audit-alert-notification-outbox",
          deliveryChannel: "admin-outbox",
          storagePolicy:
            "external-redacted-teaching-operation-audit-alert-notification-outbox",
          recordCount: 0,
          notifications: [],
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
      now: new Date("2026-06-22T11:40:00.000Z"),
    };
    const postNotifications =
      routeModule!.createTeachingOperationAuditAlertNotificationsPostHandler(deps);
    const getNotifications =
      routeModule!.createTeachingOperationAuditAlertNotificationsGetHandler(deps);

    try {
      for (const [handler, method, traceId] of [
        [postNotifications, "POST", "trace-alert-notify-unsafe-session-post"],
        [getNotifications, "GET", "trace-alert-notify-unsafe-session-get"],
      ] as const) {
        const response = await handler(
          new Request(
            "https://www.uais.top/api/teaching/operations/audit/alerts/notifications",
            {
              method,
              headers: {
                cookie,
                "x-uais-trace-id": traceId,
                "user-agent": "UAIS audit alert notification unsafe session test",
              },
            },
          ),
        );
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(response.headers.get("x-uais-trace-id")).toBe(traceId);
        expect(body).toEqual(
          expect.objectContaining({
            error: "UAIS teacher authentication is required.",
            traceId,
            access: expect.objectContaining({
              status: "denied",
              reasonCode: "authenticated-session-required",
              responsibleSession: "S12",
            }),
          }),
        );
        expect(JSON.stringify(body)).not.toContain(unsafeSessionId);
        expect(JSON.stringify(body)).not.toContain("secret-token");
        expectNoLocalOrSecretValues(body, dataDir);
      }
      expect(ownershipCheckCount).toBe(0);
      expect(externalNotificationEnqueueCount).toBe(0);
      expect(externalNotificationReadCount).toBe(0);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("blocks production teaching operation audit alert notification access before ownership or external notification storage when teacher auth provider is not production-ready", async () => {
    const notificationsRouteModulePath =
      "@/app/api/teaching/operations/audit/alerts/notifications/route";
    const routeModule = await import(/* @vite-ignore */ notificationsRouteModulePath).catch(
      () => undefined,
    );
    expect(routeModule?.createTeachingOperationAuditAlertNotificationsPostHandler)
      .toBeTypeOf("function");
    expect(routeModule?.createTeachingOperationAuditAlertNotificationsGetHandler)
      .toBeTypeOf("function");

    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-alert-notify-auth-provider-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-operation-alert-notify-auth-provider-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:35:00.000Z",
        expiresAt: "2026-06-22T12:35:00.000Z",
      },
    });
    let ownershipCheckCount = 0;
    let externalNotificationEnqueueCount = 0;
    let externalNotificationReadCount = 0;
    const env = {
      NODE_ENV: "production",
      VERCEL_ENV: "production",
      UAIS_TEACHING_OPERATIONS_BACKEND: "external",
      UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test/uais",
      UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
    };
    const deps = {
      env,
      getTeachingOperationCourseOwnership: async () => {
        ownershipCheckCount += 1;
        return {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        };
      },
      enqueueExternalTeachingOperationAuditAlertNotifications: async () => {
        externalNotificationEnqueueCount += 1;
        return {
          teacherId: "teacher-kang",
          status: "clear",
          eventType: "teaching-operation-audit-alert-notification-dispatch",
          deliveryChannel: "admin-outbox",
          storagePolicy:
            "external-redacted-teaching-operation-audit-alert-notification-outbox",
          storageWritePolicy: "external-append-only-notification-outbox",
          notificationCount: 0,
          notifications: [],
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
      readExternalTeachingOperationAuditAlertNotifications: async () => {
        externalNotificationReadCount += 1;
        return {
          teacherId: "teacher-kang",
          eventType: "teaching-operation-audit-alert-notification-outbox",
          deliveryChannel: "admin-outbox",
          storagePolicy:
            "external-redacted-teaching-operation-audit-alert-notification-outbox",
          recordCount: 0,
          notifications: [],
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
      now: new Date("2026-06-22T11:40:00.000Z"),
    };
    const postNotifications =
      routeModule!.createTeachingOperationAuditAlertNotificationsPostHandler(deps);
    const getNotifications =
      routeModule!.createTeachingOperationAuditAlertNotificationsGetHandler(deps);

    try {
      for (const [handler, method, traceId] of [
        [
          postNotifications,
          "POST",
          "trace-production-alert-notify-post-auth-provider-not-ready",
        ],
        [
          getNotifications,
          "GET",
          "trace-production-alert-notify-get-auth-provider-not-ready",
        ],
      ] as const) {
        const response = await handler(
          new Request(
            "https://www.uais.top/api/teaching/operations/audit/alerts/notifications",
            {
              method,
              headers: {
                cookie,
                "x-uais-trace-id": traceId,
                "user-agent": "UAIS production audit alert notification auth provider not ready",
              },
            },
          ),
        );
        const body = await response.json();

        expect(response.status).toBe(503);
        expect(response.headers.get("x-uais-trace-id")).toBe(traceId);
        expect(body.error).toBe("UAIS teacher auth provider is not production-ready.");
        expect(body.traceId).toBe(traceId);
        expect(body.access).toEqual(
          expect.objectContaining({
            status: "denied",
            reasonCode: "teacher-auth-provider-not-production-ready",
            responsibleSession: "S12",
          }),
        );
        expect(body.authProviderContract).toEqual(
          expect.objectContaining({
            providerKind: "missing",
            productionStatus: "blocked",
            blockedReason: "missing-UAIS_TEACHER_AUTH_PROVIDER",
            redaction: {
              values: "omitted",
              cookies: "omitted",
            },
          }),
        );
        expect(JSON.stringify(body)).not.toContain(externalToken);
        expectNoLocalOrSecretValues(body, dataDir);
      }
      expect(ownershipCheckCount).toBe(0);
      expect(externalNotificationEnqueueCount).toBe(0);
      expect(externalNotificationReadCount).toBe(0);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("requires production database adapter evidence on production audit alert notification dispatch and readback", async () => {
    const notificationsRouteModulePath =
      "@/app/api/teaching/operations/audit/alerts/notifications/route";
    const routeModule = await import(/* @vite-ignore */ notificationsRouteModulePath).catch(
      () => undefined,
    );
    expect(routeModule?.createTeachingOperationAuditAlertNotificationsPostHandler)
      .toBeTypeOf("function");
    expect(routeModule?.createTeachingOperationAuditAlertNotificationsGetHandler)
      .toBeTypeOf("function");

    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-alert-notify-db-missing-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-alert-notify-db-missing-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:00:00.000Z",
        expiresAt: "2026-06-22T13:00:00.000Z",
      },
    });
    const fetchImpl: typeof fetch = async (_url, init) => {
      if (init?.method === "POST") {
        return Response.json({
          teacherId: "teacher-kang",
          status: "clear",
          eventType: "teaching-operation-audit-alert-notification-dispatch",
          deliveryChannel: "admin-outbox",
          storagePolicy:
            "external-redacted-teaching-operation-audit-alert-notification-outbox",
          storageWritePolicy: "external-append-only-notification-outbox",
          notificationCount: 0,
          notifications: [],
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }
      return Response.json({
        teacherId: "teacher-kang",
        eventType: "teaching-operation-audit-alert-notification-outbox",
        deliveryChannel: "admin-outbox",
        storagePolicy:
          "external-redacted-teaching-operation-audit-alert-notification-outbox",
        recordCount: 0,
        notifications: [],
        responsibleSession: "S12",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      });
    };
    const deps = {
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      fetch: fetchImpl,
      getTeachingOperationCourseOwnership: async () => ({
        teacherId: "teacher-kang",
        courseIds: ["teacher-research-methods"],
      }),
      now: new Date("2026-06-22T12:05:00.000Z"),
    };
    const postNotifications =
      routeModule!.createTeachingOperationAuditAlertNotificationsPostHandler(deps);
    const getNotifications =
      routeModule!.createTeachingOperationAuditAlertNotificationsGetHandler(deps);

    try {
      for (const [handler, method, traceId, expectedError] of [
        [
          postNotifications,
          "POST",
          "trace-production-alert-notify-dispatch-db-missing",
          "External teaching operation audit alert notification dispatch is missing production database adapter evidence.",
        ],
        [
          getNotifications,
          "GET",
          "trace-production-alert-notify-readback-db-missing",
          "External teaching operation audit alert notification readback is missing production database adapter evidence.",
        ],
      ] as const) {
        const response = await handler(
          new Request(
            "https://www.uais.top/api/teaching/operations/audit/alerts/notifications",
            {
              method,
              headers: {
                cookie,
                "x-uais-trace-id": traceId,
                "user-agent": "UAIS production alert notification database evidence missing",
              },
            },
          ),
        );
        const body = await response.json();

        expect(response.status).toBe(502);
        expect(body).toEqual(
          expect.objectContaining({
            traceId,
            error: expectedError,
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        );
        expect(JSON.stringify(body)).not.toContain(externalToken);
        expectNoLocalOrSecretValues(body, dataDir);
      }
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("returns production database adapter evidence from production audit alert notification dispatch and outbox", async () => {
    const notificationsRouteModulePath =
      "@/app/api/teaching/operations/audit/alerts/notifications/route";
    const routeModule = await import(/* @vite-ignore */ notificationsRouteModulePath).catch(
      () => undefined,
    );
    expect(routeModule?.createTeachingOperationAuditAlertNotificationsPostHandler)
      .toBeTypeOf("function");
    expect(routeModule?.createTeachingOperationAuditAlertNotificationsGetHandler)
      .toBeTypeOf("function");

    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-alert-notify-db-ready-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const productionDatabaseAdapter = createReadyProductionDatabaseAdapter();
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-alert-notify-db-ready-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T12:10:00.000Z",
        expiresAt: "2026-06-22T13:10:00.000Z",
      },
    });
    const fetchImpl: typeof fetch = async (_url, init) => {
      if (init?.method === "POST") {
        return Response.json({
          teacherId: "teacher-kang",
          status: "clear",
          eventType: "teaching-operation-audit-alert-notification-dispatch",
          deliveryChannel: "admin-outbox",
          storagePolicy:
            "external-redacted-teaching-operation-audit-alert-notification-outbox",
          storageWritePolicy: "external-append-only-notification-outbox",
          notificationCount: 0,
          notifications: [],
          productionDatabaseAdapter,
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }
      return Response.json({
        teacherId: "teacher-kang",
        eventType: "teaching-operation-audit-alert-notification-outbox",
        deliveryChannel: "admin-outbox",
        storagePolicy:
          "external-redacted-teaching-operation-audit-alert-notification-outbox",
        recordCount: 0,
        notifications: [],
        productionDatabaseAdapter,
        responsibleSession: "S12",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      });
    };
    const deps = {
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      fetch: fetchImpl,
      getTeachingOperationCourseOwnership: async () => ({
        teacherId: "teacher-kang",
        courseIds: ["teacher-research-methods"],
      }),
      now: new Date("2026-06-22T12:15:00.000Z"),
    };
    const postNotifications =
      routeModule!.createTeachingOperationAuditAlertNotificationsPostHandler(deps);
    const getNotifications =
      routeModule!.createTeachingOperationAuditAlertNotificationsGetHandler(deps);

    try {
      for (const [handler, method, traceId, eventType] of [
        [
          postNotifications,
          "POST",
          "trace-production-alert-notify-dispatch-db-ready",
          "teaching-operation-audit-alert-notification-dispatch",
        ],
        [
          getNotifications,
          "GET",
          "trace-production-alert-notify-readback-db-ready",
          "teaching-operation-audit-alert-notification-outbox",
        ],
      ] as const) {
        const response = await handler(
          new Request(
            "https://www.uais.top/api/teaching/operations/audit/alerts/notifications",
            {
              method,
              headers: {
                cookie,
                "x-uais-trace-id": traceId,
                "user-agent": "UAIS production alert notification database evidence ready",
              },
            },
          ),
        );
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body).toEqual(
          expect.objectContaining({
            traceId,
            actorId: "teacher-kang",
            eventType,
            productionDatabaseAdapter,
            responsibleSession: "S12",
          }),
        );
        expect(JSON.stringify(body)).not.toContain(externalToken);
        expectNoLocalOrSecretValues(body, dataDir);
      }
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("queues external teaching operation audit alert notifications through signed teacher access", async () => {
    const notificationsRouteModulePath =
      "@/app/api/teaching/operations/audit/alerts/notifications/route";
    const routeModule = await import(/* @vite-ignore */ notificationsRouteModulePath).catch(
      () => undefined,
    );
    expect(routeModule?.createTeachingOperationAuditAlertNotificationsPostHandler)
      .toBeTypeOf("function");

    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-alert-notifications-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-auth-session-cookie-id",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:35:00.000Z",
        expiresAt: "2026-06-22T12:35:00.000Z",
      },
    });
    const externalRequests: Array<{
      url: string;
      authorization: string | null;
      method?: string;
      body: unknown;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      externalRequests.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        method: init?.method,
        body,
      });

      return new Response(
        JSON.stringify({
          teacherId: "teacher-kang",
          status: "queued",
          eventType: "teaching-operation-audit-alert-notification-dispatch",
          deliveryChannel: "admin-outbox",
          storagePolicy:
            "external-redacted-teaching-operation-audit-alert-notification-outbox",
          storageWritePolicy: "external-append-only-notification-outbox",
          notificationCount: 1,
          notifications: [
            {
              notificationId: "alert-notification-missing-course-context-audit-owned",
              eventType: "teaching-operation-audit-alert-notification",
              deliveryChannel: "admin-outbox",
              deliveryStatus: "queued",
              teacherId: "teacher-kang",
              alertId: "missing-course-context-audit-owned",
              severity: "high",
              reason: "missing-course-context",
              auditId: "audit-owned",
              traceId: "trace-owned-alert",
              actorId: "teacher-kang",
              operationId: "admins",
              actionSlot: "secondary",
              actionId: "send-admin-email",
              requestedBy: "teacher-kang",
              requestedAt: "2026-06-22T11:40:00.000Z",
              queuedAt: "2026-06-22T11:40:00.000Z",
              storagePolicy:
                "external-redacted-teaching-operation-audit-alert-notification-outbox",
              responsibleSession: "S12",
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "ids-only",
              },
            },
          ],
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };
    const postNotifications =
      routeModule!.createTeachingOperationAuditAlertNotificationsPostHandler({
        env: {
          UAIS_TEACHING_OPERATIONS_BACKEND: "external",
          UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
          UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
          UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
          UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
          UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
        },
        fetch: fetchImpl,
        now: new Date("2026-06-22T11:40:00.000Z"),
      });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T11:36:00.000Z",
      });

      const response = await postNotifications(
        new Request(
          "https://www.uais.top/api/teaching/operations/audit/alerts/notifications",
          {
            method: "POST",
            headers: {
              cookie,
              "x-uais-trace-id": "trace-external-teaching-alert-notification-route",
              "user-agent": "vitest teaching external alert notification route",
            },
          },
        ),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(externalRequests).toEqual([
        {
          url: "https://external-storage.example.test/teaching-operations/teacher-kang/audit/alerts/notifications",
          authorization: `Bearer ${externalToken}`,
          method: "POST",
          body: {
            action: "enqueue-teaching-operation-audit-alert-notifications",
            requestedBy: "teacher-kang",
            requestedAt: "2026-06-22T11:40:00.000Z",
          },
        },
      ]);
      expect(body).toEqual(
        expect.objectContaining({
          traceId: "trace-external-teaching-alert-notification-route",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          status: "queued",
          eventType: "teaching-operation-audit-alert-notification-dispatch",
          deliveryChannel: "admin-outbox",
          storagePolicy:
            "external-redacted-teaching-operation-audit-alert-notification-outbox",
          notificationCount: 1,
          responsibleSession: "S12",
        }),
      );
      expect(body.notifications).toEqual([
        expect.objectContaining({
          notificationId: "alert-notification-missing-course-context-audit-owned",
          deliveryStatus: "queued",
          alertId: "missing-course-context-audit-owned",
          requestedBy: "teacher-kang",
        }),
      ]);
      expect(JSON.stringify(body)).not.toContain(externalToken);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("reads external teaching operation audit alert notification outbox through signed teacher access", async () => {
    const notificationsRouteModulePath =
      "@/app/api/teaching/operations/audit/alerts/notifications/route";
    const routeModule = await import(/* @vite-ignore */ notificationsRouteModulePath).catch(
      () => undefined,
    );
    expect(routeModule?.createTeachingOperationAuditAlertNotificationsGetHandler)
      .toBeTypeOf("function");

    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-alert-notification-read-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-auth-session-cookie-id",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:45:00.000Z",
        expiresAt: "2026-06-22T12:45:00.000Z",
      },
    });
    const externalRequests: Array<{
      url: string;
      authorization: string | null;
      method?: string;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      externalRequests.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        method: init?.method,
      });

      return new Response(
        JSON.stringify({
          teacherId: "teacher-kang",
          eventType: "teaching-operation-audit-alert-notification-outbox",
          deliveryChannel: "admin-outbox",
          storagePolicy:
            "external-redacted-teaching-operation-audit-alert-notification-outbox",
          recordCount: 1,
          notifications: [
            {
              notificationId: "alert-notification-missing-course-context-audit-owned",
              eventType: "teaching-operation-audit-alert-notification",
              deliveryChannel: "admin-outbox",
              deliveryStatus: "queued",
              teacherId: "teacher-kang",
              alertId: "missing-course-context-audit-owned",
              severity: "high",
              reason: "missing-course-context",
              auditId: "audit-owned",
              traceId: "trace-owned-alert",
              actorId: "teacher-kang",
              operationId: "admins",
              actionSlot: "secondary",
              actionId: "send-admin-email",
              requestedBy: "teacher-kang",
              requestedAt: "2026-06-22T11:40:00.000Z",
              queuedAt: "2026-06-22T11:40:00.000Z",
              storagePolicy:
                "external-redacted-teaching-operation-audit-alert-notification-outbox",
              responsibleSession: "S12",
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "ids-only",
              },
            },
          ],
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };
    const getNotifications =
      routeModule!.createTeachingOperationAuditAlertNotificationsGetHandler({
        env: {
          UAIS_TEACHING_OPERATIONS_BACKEND: "external",
          UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
          UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
          UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
          UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
          UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
        },
        fetch: fetchImpl,
        now: new Date("2026-06-22T11:50:00.000Z"),
      });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T11:46:00.000Z",
      });

      const response = await getNotifications(
        new Request(
          "https://www.uais.top/api/teaching/operations/audit/alerts/notifications",
          {
            method: "GET",
            headers: {
              cookie,
              "x-uais-trace-id": "trace-external-teaching-alert-notification-read-route",
              "user-agent": "vitest teaching external alert notification read route",
            },
          },
        ),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(externalRequests).toEqual([
        {
          url: "https://external-storage.example.test/teaching-operations/teacher-kang/audit/alerts/notifications",
          authorization: `Bearer ${externalToken}`,
          method: "GET",
        },
      ]);
      expect(body).toEqual(
        expect.objectContaining({
          traceId: "trace-external-teaching-alert-notification-read-route",
          actorId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
          eventType: "teaching-operation-audit-alert-notification-outbox",
          deliveryChannel: "admin-outbox",
          storagePolicy:
            "external-redacted-teaching-operation-audit-alert-notification-outbox",
          recordCount: 1,
          responsibleSession: "S12",
        }),
      );
      expect(body.notifications).toEqual([
        expect.objectContaining({
          notificationId: "alert-notification-missing-course-context-audit-owned",
          deliveryStatus: "queued",
          alertId: "missing-course-context-audit-owned",
        }),
      ]);
      expect(JSON.stringify(body)).not.toContain(externalToken);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("filters cross-teacher external teaching operation audit alert notifications before returning them", async () => {
    const notificationsRouteModulePath =
      "@/app/api/teaching/operations/audit/alerts/notifications/route";
    const routeModule = await import(/* @vite-ignore */ notificationsRouteModulePath).catch(
      () => undefined,
    );
    expect(routeModule?.createTeachingOperationAuditAlertNotificationsPostHandler)
      .toBeTypeOf("function");
    expect(routeModule?.createTeachingOperationAuditAlertNotificationsGetHandler)
      .toBeTypeOf("function");

    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-alert-notification-scope-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-alert-notification-scope-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:45:00.000Z",
        expiresAt: "2026-06-22T12:45:00.000Z",
      },
    });
    const createNotification = (
      teacherId: string,
      requestedBy = "s12-audit-monitor",
    ) => ({
      notificationId: `alert-notification-${teacherId}`,
      eventType: "teaching-operation-audit-alert-notification",
      deliveryChannel: "admin-outbox",
      deliveryStatus: "queued",
      teacherId,
      alertId: `missing-course-context-audit-${teacherId}`,
      severity: "high",
      reason: "missing-course-context",
      auditId: `audit-${teacherId}`,
      traceId: `trace-alert-${teacherId}`,
      actorId: teacherId,
      operationId: "admins",
      actionSlot: "secondary",
      actionId: "send-admin-email",
      requestedBy,
      requestedAt: "2026-06-22T11:40:00.000Z",
      queuedAt: "2026-06-22T11:40:00.000Z",
      storagePolicy:
        "external-redacted-teaching-operation-audit-alert-notification-outbox",
      responsibleSession: "S12",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    });
    const externalNotifications = [
      createNotification("teacher-kang"),
      createNotification("teacher-other"),
    ];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const method = init?.method ?? "GET";
      const base = {
        teacherId: "teacher-kang",
        deliveryChannel: "admin-outbox",
        storagePolicy:
          "external-redacted-teaching-operation-audit-alert-notification-outbox",
        notifications: externalNotifications,
        responsibleSession: "S12",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      };
      return Response.json(
        method === "POST"
          ? {
              ...base,
              status: "queued",
              eventType: "teaching-operation-audit-alert-notification-dispatch",
              storageWritePolicy: "external-append-only-notification-outbox",
              notificationCount: externalNotifications.length,
            }
          : {
              ...base,
              eventType: "teaching-operation-audit-alert-notification-outbox",
              recordCount: externalNotifications.length,
            },
      );
    };
    const env = {
      UAIS_TEACHING_OPERATIONS_BACKEND: "external",
      UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
      UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
      UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
    };
    const postNotifications =
      routeModule!.createTeachingOperationAuditAlertNotificationsPostHandler({
        env,
        fetch: fetchImpl,
        now: new Date("2026-06-22T11:50:00.000Z"),
      });
    const getNotifications =
      routeModule!.createTeachingOperationAuditAlertNotificationsGetHandler({
        env,
        fetch: fetchImpl,
        now: new Date("2026-06-22T11:50:00.000Z"),
      });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T11:46:00.000Z",
      });

      const postResponse = await postNotifications(
        new Request(
          "https://www.uais.top/api/teaching/operations/audit/alerts/notifications",
          {
            method: "POST",
            headers: {
              cookie,
              "x-uais-trace-id": "trace-external-teaching-alert-notification-scope-post",
            },
          },
        ),
      );
      const postBody = await postResponse.json();
      const getResponse = await getNotifications(
        new Request(
          "https://www.uais.top/api/teaching/operations/audit/alerts/notifications",
          {
            method: "GET",
            headers: {
              cookie,
              "x-uais-trace-id": "trace-external-teaching-alert-notification-scope-get",
            },
          },
        ),
      );
      const getBody = await getResponse.json();

      expect(postResponse.status).toBe(200);
      expect(postBody.notificationCount).toBe(1);
      expect(postBody.notifications).toEqual([
        expect.objectContaining({
          notificationId: "alert-notification-teacher-kang",
          teacherId: "teacher-kang",
          actorId: "teacher-kang",
          requestedBy: "s12-audit-monitor",
        }),
      ]);
      expect(JSON.stringify(postBody)).not.toContain("teacher-other");

      expect(getResponse.status).toBe(200);
      expect(getBody.recordCount).toBe(1);
      expect(getBody.notifications).toEqual([
        expect.objectContaining({
          notificationId: "alert-notification-teacher-kang",
          teacherId: "teacher-kang",
          actorId: "teacher-kang",
          requestedBy: "s12-audit-monitor",
        }),
      ]);
      expect(JSON.stringify(getBody)).not.toContain("teacher-other");
      expect(JSON.stringify(postBody)).not.toContain(externalToken);
      expect(JSON.stringify(getBody)).not.toContain(externalToken);
      expectNoLocalOrSecretValues(postBody, dataDir);
      expectNoLocalOrSecretValues(getBody, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed when the external teaching operation acknowledgement does not match the operation", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-external-ack-mismatch-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-auth-session-cookie-id",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:05:00.000Z",
        expiresAt: "2026-06-22T12:05:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      appendExternalTeachingOperation: async ({ record }) => ({
        teacherId: "teacher-other",
        receiptId: `external-${record.recordId}`,
        status: "persisted",
        storagePolicy: "external-redacted-teaching-operation-append",
        storageWritePolicy: "external-append-only-operation-log",
        responsibleSession: "S12",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      }),
      now: new Date("2026-06-22T11:07:00.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T11:06:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
            "x-uais-trace-id": "trace-external-ack-mismatch",
          },
          body: JSON.stringify({
            operationId: "course-settings",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(502);
      expect(body.error).toBe(
        "External teaching operation persistence acknowledgement is invalid.",
      );
      expect(database.records).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed when external teaching operation acknowledgement lacks append ledger sequence", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-external-ack-sequence-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-auth-session-cookie-id",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:08:00.000Z",
        expiresAt: "2026-06-22T12:08:00.000Z",
      },
    });
    const externalRequests: Array<{
      url: string;
      authorization?: string;
      body: Record<string, unknown>;
    }> = [];
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        record?: { recordId?: string };
      };
      externalRequests.push({
        url: String(input),
        authorization:
          typeof init?.headers === "object" && init.headers && "authorization" in init.headers
            ? String(init.headers.authorization)
            : undefined,
        body: body as Record<string, unknown>,
      });

      return Response.json({
        teacherId: "teacher-kang",
        receiptId: body.record?.recordId,
        status: "persisted",
        storagePolicy: "external-redacted-teaching-operation-append",
        storageWritePolicy: "external-append-only-operation-log",
        responsibleSession: "S12",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      });
    }) as typeof fetch;
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      fetch: fetchMock,
      getTeachingOperationCourseOwnership: async () => ({
        teacherId: "teacher-kang",
        courseIds: ["teacher-research-methods"],
      }),
      now: new Date("2026-06-22T11:08:30.000Z"),
    });

    try {
      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
            "x-uais-trace-id": "trace-external-ack-missing-sequence",
          },
          body: JSON.stringify({
            operationId: "course-settings",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
            idempotencyKey: "external-ack-missing-sequence",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(502);
      expect(body.error).toBe(
        "External teaching operation persistence acknowledgement is missing append ledger sequence.",
      );
      expect(externalRequests).toEqual([
        expect.objectContaining({
          url: "https://external-storage.example.test/teaching-operations/teacher-kang/append",
          authorization: `Bearer ${externalToken}`,
        }),
      ]);
      expect(database.records).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed when external teaching operation acknowledgement has invalid persistence semantics", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-external-ack-semantics-"));
    const courseManagementDir = join(dataDir, "course-management");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-auth-session-cookie-id",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:08:45.000Z",
        expiresAt: "2026-06-22T12:08:45.000Z",
      },
    });
    const externalRequests: Array<{
      url: string;
      authorization?: string;
      body: Record<string, unknown>;
    }> = [];
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        record?: { recordId?: string };
      };
      externalRequests.push({
        url: String(input),
        authorization:
          typeof init?.headers === "object" && init.headers && "authorization" in init.headers
            ? String(init.headers.authorization)
            : undefined,
        body: body as Record<string, unknown>,
      });

      return Response.json({
        teacherId: "teacher-kang",
        receiptId: body.record?.recordId,
        status: "queued",
        appendSequence: 1,
        storagePolicy: "local-json-teaching-operation-database",
        storageWritePolicy: "atomic-json-file-replace",
        responsibleSession: "S10",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      });
    }) as typeof fetch;
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHING_COURSE_MANAGEMENT_DATA_DIR: courseManagementDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      fetch: fetchMock,
      getTeachingOperationCourseOwnership: async () => ({
        teacherId: "teacher-kang",
        courseIds: ["teacher-research-methods"],
      }),
      now: new Date("2026-06-22T11:08:50.000Z"),
    });

    try {
      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
            "x-uais-trace-id": "trace-external-ack-invalid-semantics",
          },
          body: JSON.stringify({
            operationId: "course-settings",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
            idempotencyKey: "external-ack-invalid-semantics",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });
      const courseManagementDatabase = await readTeachingCourseManagementDatabase({
        dataDir: courseManagementDir,
      });

      expect(response.status).toBe(502);
      expect(body.error).toBe(
        "External teaching operation persistence acknowledgement is invalid.",
      );
      expect(body.receipt).toBeUndefined();
      expect(externalRequests).toEqual([
        expect.objectContaining({
          url: "https://external-storage.example.test/teaching-operations/teacher-kang/append",
          authorization: `Bearer ${externalToken}`,
        }),
      ]);
      expect(database.records).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expect(courseManagementDatabase.courses).toHaveLength(0);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed in production when external teaching operation acknowledgement lacks managed database adapter evidence", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-external-db-proof-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-auth-session-cookie-id",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:09:00.000Z",
        expiresAt: "2026-06-22T12:09:00.000Z",
      },
    });
    const externalToken = "test-external-storage-access-token-with-32-chars";
    const externalRequests: Array<{
      url: string;
      authorization: string | null;
      body?: Record<string, unknown>;
    }> = [];
    const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (
        url === "https://external-storage.example.test/teaching-course-management/database" &&
        init?.method === "GET"
      ) {
        externalRequests.push({
          url,
          authorization: new Headers(init.headers).get("authorization"),
        });
        return Response.json({
          revision: "course-management-revision-1",
          database: {
            schemaVersion: "uais-teaching-course-management-v1",
            updatedAt: "1970-01-01T00:00:00.000Z",
            courses: [],
            classes: [],
            memberships: [],
            auditEvents: [],
          },
        });
      }

      const body = JSON.parse(String(init?.body)) as {
        record?: { recordId?: string };
      };
      externalRequests.push({
        url,
        authorization: new Headers(init?.headers).get("authorization"),
        body: body as Record<string, unknown>,
      });

      if (
        url === "https://external-storage.example.test/teaching-course-management/database" &&
        init?.method === "PUT"
      ) {
        return Response.json({
          revision: "course-management-revision-2",
        });
      }

      return Response.json({
        teacherId: "teacher-kang",
        receiptId: body.record?.recordId,
        status: "persisted",
        appendSequence: 1,
        storagePolicy: "external-redacted-teaching-operation-append",
        storageWritePolicy: "external-append-only-operation-log",
        responsibleSession: "S12",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      });
    }) as typeof fetch;
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://external-storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalToken,
      },
      fetch: fetchMock,
      getTeachingOperationCourseOwnership: async () => ({
        teacherId: "teacher-kang",
        courseIds: ["teacher-research-methods"],
      }),
      now: new Date("2026-06-22T11:09:30.000Z"),
    });

    try {
      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
            "x-uais-trace-id": "trace-external-ack-missing-db-proof",
          },
          body: JSON.stringify({
            operationId: "course-settings",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
            idempotencyKey: "external-ack-missing-db-proof",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(502);
      expect(body.error).toBe(
        "External teaching operation persistence acknowledgement is missing production database adapter evidence.",
      );
      expect(body.receipt).toBeUndefined();
      expect(body.partialFailure).toBeUndefined();
      expect(externalRequests).toEqual([
        expect.objectContaining({
          url: "https://external-storage.example.test/teaching-operations/teacher-kang/append",
          authorization: `Bearer ${externalToken}`,
        }),
      ]);
      expect(database.records).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed without local writes when external teaching operations storage is selected but not ready", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-route-external-blocked-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-auth-session-cookie-id",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T11:10:00.000Z",
        expiresAt: "2026-06-22T12:10:00.000Z",
      },
    });
    const postOperation = createTeachingOperationActionPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_BACKEND: "external",
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:15:00.000Z"),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-research-methods"],
        },
        updatedAt: "2026-06-22T11:11:00.000Z",
      });

      const response = await postOperation(
        new Request("https://www.uais.top/api/teaching/operations", {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({
            operationId: "course-settings",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingOperationDatabase({ dataDir });

      expect(response.status).toBe(503);
      expect(body.error).toBe("Teaching operation storage backend is not ready.");
      expect(database.records).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
