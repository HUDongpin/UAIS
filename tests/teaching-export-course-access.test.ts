import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTeachingOperationExportGetHandler } from "@/app/api/teaching/operations/export/[manifestId]/handler";
import type { ReadTeachingCourseCapability } from "@/app/api/teaching/operations/course-access";
import { authorizeTeachingCourseCapability } from "@/lib/server/teaching-course-collaborator-access";
import type { TeachingCourseCollaboratorGrant } from "@/lib/server/teaching-course-collaborator-types";
import { createUaisTeacherAuthSessionCookieHeader } from "@/lib/server/teacher-auth-session";
import { executeTeachingOperationAction } from "@/lib/server/teaching-operations-store";

const now = new Date("2026-09-30T10:00:00.000Z");
const courseId = "course-export-review";
const teacherId = "teacher-collaborator";
const principalId = "22222222-2222-4222-8222-222222222222";
const ownerId = "11111111-1111-4111-8111-111111111111";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function activeGrant(): TeachingCourseCollaboratorGrant {
  return {
    grantId: "33333333-3333-4333-8333-333333333333",
    courseId,
    recipientUserId: principalId,
    grantedByUserId: ownerId,
    role: "co-instructor",
    scopes: ["course.read", "course.export"],
    status: "active",
    revision: 1,
    grantedAt: "2026-09-29T10:00:00.000Z",
  };
}

function capabilityReader(readGrant: () => TeachingCourseCollaboratorGrant) {
  return vi.fn<ReadTeachingCourseCapability>(async (input) =>
    authorizeTeachingCourseCapability({
      principal: {
        userId: principalId,
        account: input.principalAccount,
        role: "teacher",
        status: "active",
      },
      course: { courseId: input.courseId, ownerUserId: ownerId },
      capability: input.capability,
      grant: readGrant(),
      now,
    }),
  );
}

async function fixture(input: {
  readTeachingCourseCapability?: ReadTeachingCourseCapability;
  readManagedCourseOwnership?: () => Promise<boolean>;
  getTeachingOperationCourseOwnership?: () => Promise<{ teacherId: string; courseIds: string[] }>;
} = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "uais-export-acl-review-"));
  temporaryDirectories.push(dataDir);
  const receipt = await executeTeachingOperationAction({
    dataDir,
    operationId: "data-export",
    actionSlot: "primary",
    courseId,
    actorId: teacherId,
    now,
  });
  const artifact = receipt.artifacts.find((item) => item.kind === "export-file");
  if (artifact?.kind !== "export-file") throw new Error("Missing fixture export");
  const secret = "synthetic-export-access-test-secret";
  const cookie = createUaisTeacherAuthSessionCookieHeader({
    secret,
    claims: {
      sessionId: "export-access-test-session",
      actorId: teacherId,
      role: "teacher",
      authenticatedAt: "2026-09-30T09:00:00.000Z",
      expiresAt: "2026-09-30T11:00:00.000Z",
    },
  });
  const deps = {
    env: {
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: secret,
      UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
      UAIS_TEACHING_COURSES_DATA_DIR: join(dataDir, "courses"),
      UAIS_TEACHER_AI_OWNERSHIP_DIR: join(dataDir, "ownership"),
    },
    now,
    getTeachingOperationCourseOwnership: async () => ({ teacherId, courseIds: [] }),
    ...input,
  };
  const handler = createTeachingOperationExportGetHandler(deps);
  return {
    artifact,
    download: () => handler(
      new Request(`https://uais.test${artifact.downloadUrl}`, { headers: { cookie } }),
      { params: Promise.resolve({ manifestId: artifact.manifestId }) },
    ),
  };
}

describe("teaching export download course access", () => {
  it("lets a co-instructor download with the exact course.export capability", async () => {
    const readTeachingCourseCapability = capabilityReader(activeGrant);
    const { download, artifact } = await fixture({ readTeachingCourseCapability });
    const response = await download();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ manifestId: artifact.manifestId, courseId });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(readTeachingCourseCapability).toHaveBeenCalledWith({
      principalAccount: teacherId, courseId, capability: "course.export",
    });
  });

  it("rechecks the grant on download after it is revoked", async () => {
    let grant = activeGrant();
    const { download } = await fixture({ readTeachingCourseCapability: capabilityReader(() => grant) });
    expect((await download()).status).toBe(200);
    grant = { ...grant, status: "revoked", revision: 2 };

    const response = await download();
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ access: { reasonCode: "collaborator-grant-revoked" } });
  });

  it.each([
    ["another course", { courseId: "other-course" }, "collaborator-grant-mismatch"],
    ["only course.read", { scopes: ["course.read"] }, "collaborator-scope-required"],
    ["an expired grant", { expiresAt: "2026-09-30T09:30:00.000Z" }, "collaborator-grant-expired"],
  ] as const)("denies an export using %s", async (_label, override, reasonCode) => {
    const grant: TeachingCourseCollaboratorGrant = {
      ...activeGrant(),
      ...override,
      scopes: "scopes" in override ? [...override.scopes] : activeGrant().scopes,
    };
    const { download } = await fixture({ readTeachingCourseCapability: capabilityReader(() => grant) });
    const response = await download();
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ access: { reasonCode } });
  });

  it("fails closed when the capability store is unavailable", async () => {
    const { download } = await fixture({ readTeachingCourseCapability: async () => { throw new Error("private-db-endpoint"); } });
    const response = await download();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ access: { reasonCode: "teacher-course-capability-check-failed" } });
    expect(JSON.stringify(body)).not.toContain("private-db-endpoint");
  });

  it("allows the canonical managed owner without a derived AI ownership grant", async () => {
    const readTeachingCourseCapability = vi.fn<ReadTeachingCourseCapability>();
    const { download } = await fixture({ readManagedCourseOwnership: async () => true, readTeachingCourseCapability });
    expect((await download()).status).toBe(200);
    expect(readTeachingCourseCapability).not.toHaveBeenCalled();
  });

  it("fails closed on canonical ownership lookup failure before trying grants", async () => {
    const readTeachingCourseCapability = capabilityReader(activeGrant);
    const { download } = await fixture({
      readManagedCourseOwnership: async () => { throw new Error("private-owner-endpoint"); },
      readTeachingCourseCapability,
    });
    const response = await download();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ access: { reasonCode: "teacher-course-ownership-check-failed" } });
    expect(JSON.stringify(body)).not.toContain("private-owner-endpoint");
    expect(readTeachingCourseCapability).not.toHaveBeenCalled();
  });
});
