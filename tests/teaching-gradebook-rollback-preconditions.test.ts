import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createTeachingGradebookReleaseRollbackPostHandler } from "@/app/api/teaching/gradebook-updates/[objectId]/rollback/handler";
import { storeUaisTeacherAiOwnershipRecord } from "@/lib/server/teacher-ai-ownership-store";
import { createUaisTeacherAuthSessionCookieHeader } from "@/lib/server/teacher-auth-session";
import { executeTeachingOperationAction, readTeachingOperationDatabase, releaseTeachingGradebookUpdate, rollbackTeachingGradebookRelease } from "@/lib/server/teaching-operations-store";

it.each([
  ["pending-release", ["course-a"], 409, 0],
  ["release-rolled-back", ["course-a"], 409, 0],
  ["released", ["course-a"], 200, 1],
  ["released", ["other-course"], 403, 0],
] as const)("checks %s and ownership %j before provider effects", async (state, ownedCourses, status, calls) => {
  const dataDir = await mkdtemp(join(tmpdir(), "uais-rollback-provider-order-"));
  const secret = "synthetic-rollback-session-signing-secret";
  const fetch = vi.fn(async () => Response.json({ status: "release-rolled-back", rollbackId: "synthetic-provider-rollback" }));
  try {
    await executeTeachingOperationAction({
      dataDir, operationId: "grading", actionSlot: "primary", courseId: "course-a",
      actorId: "teacher-a", now: new Date("2026-06-22T10:15:00.000Z"),
    });
    const mutation = {
      dataDir, actorId: "teacher-a", objectId: "gradebook-update-course-a",
      audit: {
        traceId: "trace-synthetic-gradebook-state", actorRole: "teacher" as const,
        authMode: "signed-teacher-session" as const,
        requestSource: { userAgent: "Synthetic rollback state test", ipAddress: "redacted" as const },
      },
    };
    if (state !== "pending-release") await releaseTeachingGradebookUpdate(mutation);
    if (state === "release-rolled-back") await rollbackTeachingGradebookRelease(mutation);
    await storeUaisTeacherAiOwnershipRecord({
      baseDir: join(dataDir, "ownership"), ownership: { teacherId: "teacher-a", courseIds: [...ownedCourses] },
    });
    const before = await readTeachingOperationDatabase({ dataDir });
    const handler = createTeachingGradebookReleaseRollbackPostHandler({
      env: {
        UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: join(dataDir, "ownership"),
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: secret,
        UAIS_GRADEBOOK_RELEASE_PROVIDER: "external",
        UAIS_GRADEBOOK_RELEASE_PROVIDER_URL: "https://gradebook.example.test/operations",
        UAIS_GRADEBOOK_RELEASE_PROVIDER_TOKEN: "synthetic-gradebook-provider-token-with-32-chars",
      },
      now: new Date("2026-06-22T11:00:00.000Z"), fetch,
    });
    const response = await handler(new Request("https://example.test/api/teaching/gradebook-updates/gradebook-update-course-a/rollback", {
      method: "POST", headers: { cookie: createUaisTeacherAuthSessionCookieHeader({ secret, claims: {
        sessionId: "synthetic-rollback-session", actorId: "teacher-a", role: "teacher",
        authenticatedAt: "2026-06-22T10:00:00.000Z", expiresAt: "2026-06-22T12:00:00.000Z",
      } }) },
    }), { params: Promise.resolve({ objectId: "gradebook-update-course-a" }) });
    expect(response.status).toBe(status);
    expect(fetch).toHaveBeenCalledTimes(calls);
    const after = await readTeachingOperationDatabase({ dataDir });
    if (status !== 200) expect(after).toEqual(before);
    else expect(after.domainProjections).toContainEqual(expect.objectContaining({
      objectId: "gradebook-update-course-a", updateStatus: "release-rolled-back",
      providerRollbackId: "synthetic-provider-rollback",
    }));
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
