import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createTeachingOperationBackupRestorePostHandler } from "@/app/api/teaching/operations/backups/[backupId]/restore/handler";
import * as ownershipStore from "@/lib/server/teacher-ai-ownership-store";
import { createUaisTeacherAuthSessionCookieHeader } from "@/lib/server/teacher-auth-session";
import {
  executeTeachingOperationAction,
  readTeachingOperationDatabase,
  restoreTeachingOperationDatabaseBackup,
} from "@/lib/server/teaching-operations-store";

const backupId = "teaching-operations-backup-20260622-105500";
const teacherAuthSecret = "test-restore-scope-session-signing-secret";
const now = new Date("2026-06-22T11:15:00.000Z");
const audit = {
  traceId: "trace-restore-course-scope",
  actorRole: "teacher" as const,
  authMode: "signed-teacher-session" as const,
  requestSource: { userAgent: "Synthetic restore regression", ipAddress: "redacted" as const },
};

async function seedBackup(dataDir: string) {
  for (const [operationId, timestamp] of [
    ["course-settings", "2026-06-22T10:50:00.000Z"],
    ["content", "2026-06-22T10:55:00.000Z"],
  ] as const) {
    await executeTeachingOperationAction({
      dataDir,
      operationId,
      actionSlot: "primary",
      courseId: "course-a",
      sourceAction: "manage",
      actorId: "teacher-a",
      now: new Date(timestamp),
    });
  }
}

async function addCourseB(dataDir: string) {
  await executeTeachingOperationAction({
    dataDir,
    operationId: "course-settings",
    actionSlot: "primary",
    courseId: "course-b",
    sourceAction: "manage",
    actorId: "teacher-b",
    now: new Date("2026-06-22T11:00:00.000Z"),
  });
}

function restoreRequest(actorId = "teacher-a") {
  return new Request(`https://example.test/api/teaching/operations/backups/${backupId}/restore`, {
    method: "POST",
    headers: {
      cookie: createUaisTeacherAuthSessionCookieHeader({
        secret: teacherAuthSecret,
        claims: {
          sessionId: "teacher-restore-scope-session",
          actorId,
          role: "teacher",
          authenticatedAt: "2026-06-22T10:40:00.000Z",
          expiresAt: "2026-06-22T12:00:00.000Z",
        },
      }),
      "x-uais-trace-id": audit.traceId,
    },
  });
}

async function createRestore(dataDir: string, courseIds: string[]) {
  const ownershipDir = join(dataDir, "ownership");
  await ownershipStore.storeUaisTeacherAiOwnershipRecord({
    baseDir: ownershipDir,
    ownership: { teacherId: "teacher-a", courseIds },
  });
  return createTeachingOperationBackupRestorePostHandler({
    env: {
      UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
      UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    },
    now,
  });
}

describe("shared teaching-operation backup restore scope", () => {
  it("denies a teacher whose backup predates another teacher's course and preserves all data", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-restore-scope-denied-"));
    try {
      await seedBackup(dataDir);
      await addCourseB(dataDir);
      const restore = await createRestore(dataDir, ["course-a"]);
      const before = await readTeachingOperationDatabase({ dataDir });

      const response = await restore(restoreRequest(), { params: Promise.resolve({ backupId }) });

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ reasonCode: "course-scope-denied" });
      expect(await readTeachingOperationDatabase({ dataDir })).toEqual(before);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("allows the owner of every affected course and audits courses removed by restoring", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-restore-scope-allowed-"));
    try {
      await seedBackup(dataDir);
      await addCourseB(dataDir);
      const restore = await createRestore(dataDir, ["course-a", "course-b"]);

      const response = await restore(restoreRequest(), { params: Promise.resolve({ backupId }) });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        receipt: { impactedCourseIds: ["course-a", "course-b"], status: "persisted" },
      });
      const database = await readTeachingOperationDatabase({ dataDir });
      expect(database.records).toHaveLength(1);
      expect(database.records[0].courseId).toBe("course-a");
      expect(database.auditEvents).toContainEqual(expect.objectContaining({
        eventType: "teaching-operations-backup.restored",
        impactedCourseIds: ["course-a", "course-b"],
      }));
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("checks the current scope after an earlier writer releases the local write lock", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-restore-scope-queued-"));
    let releaseWriter: () => void = () => undefined;
    const writerGate = new Promise<void>((resolve) => { releaseWriter = resolve; });
    let writerStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => { writerStarted = resolve; });
    try {
      await seedBackup(dataDir);
      const writer = executeTeachingOperationAction({
        dataDir,
        operationId: "invite-code",
        actionSlot: "primary",
        courseId: "course-b",
        actorId: "teacher-b",
        now: new Date("2026-06-22T11:00:00.000Z"),
        allocateInviteCode: async () => {
          writerStarted();
          await writerGate;
          return "73914682";
        },
      });
      await started;
      const result = restoreTeachingOperationDatabaseBackup({
        dataDir, backupId, actorId: "teacher-a", audit, now,
        authorizedCourseIds: ["course-a"],
      }).then(
        () => ({ status: 200 }),
        (error: { status: number; reasonCode?: string }) => ({
          status: error.status, reasonCode: error.reasonCode,
        }),
      );
      releaseWriter();
      await writer;
      const before = await readTeachingOperationDatabase({ dataDir });

      expect(await result).toEqual({ status: 403, reasonCode: "course-scope-denied" });
      expect(await readTeachingOperationDatabase({ dataDir })).toEqual(before);
      expect(before.inviteCodes.some((invite) => invite.courseId === "course-b")).toBe(true);
    } finally {
      releaseWriter();
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("protects another course represented only by a previous restore audit event", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-restore-scope-audit-"));
    try {
      await seedBackup(dataDir);
      await addCourseB(dataDir);
      const authorizedRestore = await createRestore(dataDir, ["course-a", "course-b"]);
      expect((await authorizedRestore(restoreRequest(), {
        params: Promise.resolve({ backupId }),
      })).status).toBe(200);
      const before = await readTeachingOperationDatabase({ dataDir });
      expect(before.records.every((record) => record.courseId === "course-a")).toBe(true);
      const onlyCourseARestore = await createRestore(dataDir, ["course-a"]);

      const response = await onlyCourseARestore(restoreRequest(), {
        params: Promise.resolve({ backupId }),
      });

      expect(response.status).toBe(403);
      expect(await readTeachingOperationDatabase({ dataDir })).toEqual(before);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("compares a canonical ownership principal using the existing account identity rules", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-restore-scope-owner-case-"));
    const ownership = vi.spyOn(ownershipStore, "createUaisTeacherAiOwnershipAdapter")
      .mockReturnValue(async () => ({ teacherId: "Teacher-A", courseIds: ["course-a"] }));
    try {
      await seedBackup(dataDir);
      const restore = await createRestore(dataDir, ["course-a"]);
      const response = await restore(restoreRequest(), { params: Promise.resolve({ backupId }) });
      expect(response.status).toBe(200);
    } finally {
      ownership.mockRestore();
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
