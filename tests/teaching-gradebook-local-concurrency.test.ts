import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  executeTeachingOperationAction,
  readTeachingOperationDatabase,
  releaseTeachingGradebookUpdate,
  rollbackTeachingGradebookRelease,
} from "@/lib/server/teaching-operations-store";

const audit = {
  traceId: "trace-concurrent-gradebook",
  actorRole: "teacher" as const,
  authMode: "signed-teacher-session" as const,
  requestSource: { userAgent: "Synthetic concurrency regression", ipAddress: "redacted" as const },
};

describe("local gradebook serialization", () => {
  it.each(["release", "rollback"] as const)("unblocks the next writer after a failed %s", async (operation) => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-gradebook-failed-write-"));
    try {
      await executeTeachingOperationAction({
        dataDir, operationId: "grading", actionSlot: "primary", courseId: "course-a",
        actorId: "teacher-a", now: new Date("2026-06-22T10:15:00.000Z"),
      });
      const input = { dataDir, actorId: "teacher-a", audit };
      const failure = operation === "release"
        ? releaseTeachingGradebookUpdate({ ...input, objectId: "missing-gradebook-update" })
        : rollbackTeachingGradebookRelease({ ...input, objectId: "gradebook-update-course-a" });
      await expect(failure).rejects.toMatchObject({ status: operation === "release" ? 404 : 409 });
      await executeTeachingOperationAction({
        dataDir, operationId: "course-settings", actionSlot: "primary", courseId: "course-b",
        actorId: "teacher-b", now: new Date("2026-06-22T10:30:00.000Z"),
      });
      expect((await readTeachingOperationDatabase({ dataDir })).records)
        .toContainEqual(expect.objectContaining({ courseId: "course-b" }));
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it.each(["released", "release-rolled-back"] as const)("preserves %s after a concurrent action", async (status) => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-gradebook-concurrency-"));
    let allowAction: () => void = () => undefined;
    const actionGate = new Promise<void>((resolve) => { allowAction = resolve; });
    let enteredAction: () => void = () => undefined;
    const actionEntered = new Promise<void>((resolve) => { enteredAction = resolve; });
    const gradebookInput = {
      dataDir, actorId: "teacher-a", objectId: "gradebook-update-course-a", audit,
      now: new Date("2026-06-22T10:25:00.000Z"),
    };
    try {
      await executeTeachingOperationAction({
        dataDir, operationId: "grading", actionSlot: "primary", courseId: "course-a",
        actorId: "teacher-a", now: new Date("2026-06-22T10:15:00.000Z"),
      });
      if (status === "release-rolled-back") await releaseTeachingGradebookUpdate(gradebookInput);
      const action = executeTeachingOperationAction({
        dataDir, operationId: "invite-code", actionSlot: "primary", courseId: "course-b",
        actorId: "teacher-b", now: new Date("2026-06-22T10:30:00.000Z"),
        allocateInviteCode: async () => {
          enteredAction();
          await actionGate;
          return "58291463";
        },
      });
      await actionEntered;
      const gradebookWrite = status === "released"
        ? releaseTeachingGradebookUpdate(gradebookInput)
        : rollbackTeachingGradebookRelease(gradebookInput);
      // A correctly queued write waits behind the allocator. The old unlocked
      // write completes here, then is overwritten when the allocator resumes.
      await Promise.race([gradebookWrite, new Promise((resolve) => setTimeout(resolve, 100))]);
      allowAction();
      await Promise.all([action, gradebookWrite]);
      const database = await readTeachingOperationDatabase({ dataDir });
      expect(database.domainProjections).toContainEqual(expect.objectContaining({
        objectId: "gradebook-update-course-a", updateStatus: status,
      }));
      expect(database.inviteCodes).toContainEqual(expect.objectContaining({ courseId: "course-b" }));
      expect(database.auditEvents).toContainEqual(expect.objectContaining({
        eventType: status === "released"
          ? "teaching-gradebook-update.released" : "teaching-gradebook-update.release-rolled-back",
      }));
    } finally {
      allowAction();
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
