import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createTeachingOperationRecordRollbackPostHandler } from "@/app/api/teaching/operations/records/[recordId]/rollback/handler";
import * as ownershipStore from "@/lib/server/teacher-ai-ownership-store";
import * as managedStore from "@/lib/server/teaching-operations-postgres-store";
import { createUaisTeacherAuthSessionCookieHeader } from "@/lib/server/teacher-auth-session";
import { executeTeachingOperationAction, readTeachingOperationDatabase } from "@/lib/server/teaching-operations-store";

it.each([
  ["managed-only", 200],
  ["local-shadow-only", 404],
  ["managed-unavailable", 500],
  ["other-course-owner", 403],
] as const)("keeps record rollback on configured storage: %s", async (scenario, status) => {
  const dataDir = await mkdtemp(join(tmpdir(), "uais-record-rollback-managed-"));
  const secret = "synthetic-record-rollback-session-secret";
  const ownership = vi.spyOn(ownershipStore, "createUaisTeacherAiOwnershipAdapter")
    .mockReturnValue(async () => ({ teacherId: "teacher-a", courseIds: scenario === "other-course-owner" ? ["other-course"] : ["course-a"] }));
  let repositorySpy: ReturnType<typeof vi.spyOn> | undefined;
  try {
    const seeded = await executeTeachingOperationAction({
      dataDir, operationId: "course-settings", actionSlot: "primary", courseId: "course-a",
      actorId: "teacher-a", now: new Date("2026-06-22T10:15:00.000Z"),
    });
    let database = await readTeachingOperationDatabase({ dataDir });
    const localBefore = structuredClone(database);
    if (scenario === "local-shadow-only") database = {
      ...database, records: [], auditEvents: [], domainProjections: [],
      outbox: [], inviteCodes: [], exportManifests: [],
    };
    const repository = {
      read: vi.fn(async () => {
        if (scenario === "managed-unavailable") throw new Error("Synthetic managed read failure");
        return { database: structuredClone(database), revision: "rev-1" };
      }),
      write: vi.fn(async (input: managedStore.TeachingOperationRepositorySnapshot & { expectedRevision?: string }) => {
        expect(input.expectedRevision).toBe("rev-1");
        database = structuredClone(input.database);
      }),
    };
    repositorySpy = vi.spyOn(managedStore, "createUaisTeachingOperationPostgresRepository")
      .mockReturnValue(repository);
    const handler = createTeachingOperationRecordRollbackPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: scenario === "managed-only" ? join(dataDir, "empty-local-target") : dataDir,
        UAIS_TEACHING_OPERATIONS_SNAPSHOT_BACKEND: "managed",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: secret,
      },
      now: new Date("2026-06-22T11:00:00.000Z"),
    });
    const response = await handler(new Request("https://example.test/api/teaching/operations/records/record/rollback", {
      method: "POST", body: JSON.stringify({ action: "rollback-teaching-operation-record", rollbackReason: "teacher-correction" }),
      headers: { cookie: createUaisTeacherAuthSessionCookieHeader({ secret, claims: {
        sessionId: "synthetic-record-rollback-session", actorId: "teacher-a", role: "teacher",
        authenticatedAt: "2026-06-22T10:00:00.000Z", expiresAt: "2026-06-22T12:00:00.000Z",
      } }) },
    }), { params: Promise.resolve({ recordId: seeded.receiptId }) });
    expect(response.status).toBe(status);
    expect(repository.write).toHaveBeenCalledTimes(status === 200 ? 1 : 0);
    if (status === 200) expect(database.domainProjections).toContainEqual(expect.objectContaining({
      objectType: "operation-rollback", targetRecordId: seeded.receiptId,
    }));
    expect(await readTeachingOperationDatabase({ dataDir })).toEqual(localBefore);
  } finally {
    ownership.mockRestore();
    repositorySpy?.mockRestore();
    await rm(dataDir, { recursive: true, force: true });
  }
});
