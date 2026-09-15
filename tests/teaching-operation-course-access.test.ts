import { describe, expect, it, vi } from "vitest";
import {
  authorizeTeachingOperationCourseAccess,
  getTeachingOperationAccessDeniedError,
  getTeachingOperationAccessDeniedStatus,
} from "@/app/api/teaching/operations/course-access";
import { TeachingCourseCollaboratorStoreError } from "@/lib/server/teaching-course-collaborator-postgres-store";
import type { TeachingOperationAuthenticatedTeacher } from "@/app/api/teaching/operations/route-utils";

const catalogCourseId = "teacher-research-methods";

function teacher(
  actorId = "phoebe",
): TeachingOperationAuthenticatedTeacher {
  return {
    sessionId: "teacher-course-access-session",
    actorId,
    role: "teacher",
    authenticatedAt: "2026-09-14T00:00:00.000Z",
    expiresAt: "2026-09-14T01:00:00.000Z",
  };
}

function request() {
  return new Request("https://www.uais.top/api/teaching/operations", {
    method: "POST",
  });
}

describe("teaching operation course ownership access", () => {
  it("authorizes a snapshot owner even when AI ownership omits the course id", async () => {
    const readTeachingCourseCapability = vi.fn();
    const getTeachingOperationCourseOwnership = vi.fn(async () => ({
      teacherId: "phoebe",
      courseIds: ["some-other-ai-owned-course"],
    }));

    await expect(
      authorizeTeachingOperationCourseAccess({
        request: request(),
        authenticatedTeacher: teacher(),
        courseId: catalogCourseId,
        operationId: "course-settings",
        actionSlot: "primary",
        readManagedCourseOwnership: async ({ actorId, courseId }) =>
          actorId === "phoebe" && courseId === catalogCourseId,
        getTeachingOperationCourseOwnership,
        readTeachingCourseCapability,
      }),
    ).resolves.toMatchObject({
      status: "authorized",
      reasonCode: "course-owner-implicit",
      actor: { actorId: "phoebe", role: "teacher" },
      resource: { courseId: catalogCourseId },
    });
    expect(getTeachingOperationCourseOwnership).not.toHaveBeenCalled();
    expect(readTeachingCourseCapability).not.toHaveBeenCalled();
  });

  it("authorizes snapshot ownership when the stored ownerTeacherId differs only by case", async () => {
    await expect(
      authorizeTeachingOperationCourseAccess({
        request: request(),
        authenticatedTeacher: teacher("phoebe"),
        courseId: catalogCourseId,
        operationId: "course-settings",
        actionSlot: "primary",
        readManagedCourseOwnership: async ({ actorId }) =>
          actorId.toLowerCase() === "phoebe",
        getTeachingOperationCourseOwnership: async () => ({
          teacherId: "Phoebe",
          courseIds: [],
        }),
      }),
    ).resolves.toMatchObject({
      status: "authorized",
      reasonCode: "course-owner-implicit",
    });
  });

  it("denies catalog demo course ids that are not in the snapshot or AI ownership grants", async () => {
    const access = await authorizeTeachingOperationCourseAccess({
      request: request(),
      authenticatedTeacher: teacher(),
      courseId: catalogCourseId,
      operationId: "course-settings",
      actionSlot: "primary",
      readManagedCourseOwnership: async () => false,
      getTeachingOperationCourseOwnership: async () => ({
        teacherId: "phoebe",
        courseIds: [],
      }),
    });

    expect(access).toMatchObject({
      status: "denied",
      reasonCode: "course-scope-denied",
      resource: { courseId: catalogCourseId },
    });
    expect(getTeachingOperationAccessDeniedStatus("course-scope-denied")).toBe(403);
    expect(getTeachingOperationAccessDeniedError("course-scope-denied")).toBe(
      "UAIS teaching operation course ownership is required.",
    );
  });

  it("does not report a capability 503 when snapshot ownership lookup throws", async () => {
    const readTeachingCourseCapability = vi.fn(async () => {
      throw new Error("capability backend secret-token unavailable");
    });

    const access = await authorizeTeachingOperationCourseAccess({
      request: request(),
      authenticatedTeacher: teacher(),
      courseId: catalogCourseId,
      operationId: "data-export",
      actionSlot: "primary",
      readManagedCourseOwnership: async () => {
        throw new Error("snapshot transport failed");
      },
      getTeachingOperationCourseOwnership: async () => ({
        teacherId: "phoebe",
        courseIds: [],
      }),
      readTeachingCourseCapability,
    });

    expect(access).toMatchObject({
      status: "denied",
      reasonCode: "teacher-course-ownership-check-failed",
    });
    expect(
      getTeachingOperationAccessDeniedStatus("teacher-course-ownership-check-failed"),
    ).toBe(503);
    expect(
      getTeachingOperationAccessDeniedError("teacher-course-ownership-check-failed"),
    ).toBe("UAIS teaching operation course ownership check failed.");
    expect(readTeachingCourseCapability).not.toHaveBeenCalled();
  });

  it("maps collaborator store 4xx failures to the owner denial instead of a capability 503", async () => {
    const access = await authorizeTeachingOperationCourseAccess({
      request: request(),
      authenticatedTeacher: teacher(),
      courseId: catalogCourseId,
      operationId: "course-settings",
      actionSlot: "primary",
      readManagedCourseOwnership: async () => false,
      getTeachingOperationCourseOwnership: async () => ({
        teacherId: "phoebe",
        courseIds: [],
      }),
      readTeachingCourseCapability: async () => {
        throw new TeachingCourseCollaboratorStoreError(
          403,
          "canonical-course-required",
        );
      },
    });

    expect(access).toMatchObject({
      status: "denied",
      reasonCode: "course-scope-denied",
    });
    expect(getTeachingOperationAccessDeniedError("course-scope-denied")).not.toBe(
      "UAIS teaching operation course capability check failed.",
    );
  });

  it("still fails closed with capability-check-failed when the collaborator backend throws a 5xx", async () => {
    const access = await authorizeTeachingOperationCourseAccess({
      request: request(),
      authenticatedTeacher: teacher(),
      courseId: catalogCourseId,
      operationId: "course-settings",
      actionSlot: "primary",
      readManagedCourseOwnership: async () => false,
      getTeachingOperationCourseOwnership: async () => ({
        teacherId: "phoebe",
        courseIds: [],
      }),
      readTeachingCourseCapability: async () => {
        throw new TeachingCourseCollaboratorStoreError(
          503,
          "collaborator-store-unavailable",
        );
      },
    });

    expect(access).toMatchObject({
      status: "denied",
      reasonCode: "teacher-course-capability-check-failed",
    });
    expect(
      getTeachingOperationAccessDeniedStatus("teacher-course-capability-check-failed"),
    ).toBe(503);
    expect(
      getTeachingOperationAccessDeniedError("teacher-course-capability-check-failed"),
    ).toBe("UAIS teaching operation course capability check failed.");
  });
});
