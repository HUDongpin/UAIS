import { describe, expect, it } from "vitest";
import {
  createTeachingCourseManagementDelegatedAuthorization,
  isTeachingCourseManagementActorAuthorized,
  runWithTeachingCourseManagementDelegatedAuthorization,
} from "@/lib/server/teaching-course-management-authorization";

const actorId = "teacher-collaborator";
const courseId = "teacher-research-methods";

describe("teaching course management delegated authorization", () => {
  it("binds a verified collaborator decision to one actor, course, capability, and revision", () => {
    const authorization = createTeachingCourseManagementDelegatedAuthorization({
      actorId,
      courseId,
      decision: {
        authorized: true,
        reasonCode: "collaborator-exact-scope",
        capability: "course.content.write",
        grantId: "00000000-0000-4000-8000-000000000121",
        revision: 7,
      },
    });

    expect(
      isTeachingCourseManagementActorAuthorized({
        ownerTeacherId: "teacher-owner",
        actorId,
        courseId,
        requiredCapability: "course.content.write",
        authorization,
      }),
    ).toBe(true);
    expect(authorization).toEqual({
      authorizationClass: "server-verified-course-collaborator-capability",
      actorId,
      courseId,
      capability: "course.content.write",
      grantId: "00000000-0000-4000-8000-000000000121",
      grantRevision: 7,
    });
    expect(Object.isFrozen(authorization)).toBe(true);
  });

  it("continues to authorize the canonical owner without a delegated token", () => {
    expect(
      isTeachingCourseManagementActorAuthorized({
        ownerTeacherId: "teacher-owner",
        actorId: "teacher-owner",
        courseId,
        requiredCapability: "course.settings.manage",
      }),
    ).toBe(true);
  });

  it.each([
    ["actor", { actorId: "teacher-other" }],
    ["course", { courseId: "teacher-other-course" }],
    ["capability", { requiredCapability: "course.export" }],
  ] as const)("rejects a token reused for another %s", (_label, override) => {
    const authorization = createTeachingCourseManagementDelegatedAuthorization({
      actorId,
      courseId,
      decision: {
        authorized: true,
        reasonCode: "collaborator-exact-scope",
        capability: "course.content.write",
        grantId: "00000000-0000-4000-8000-000000000122",
        revision: 2,
      },
    });

    expect(
      isTeachingCourseManagementActorAuthorized({
        ownerTeacherId: "teacher-owner",
        actorId,
        courseId,
        requiredCapability: "course.content.write",
        authorization,
        ...override,
      }),
    ).toBe(false);
  });

  it("rejects a structurally identical object that was not issued in this server runtime", () => {
    const authorization = createTeachingCourseManagementDelegatedAuthorization({
      actorId,
      courseId,
      decision: {
        authorized: true,
        reasonCode: "collaborator-exact-scope",
        capability: "course.read",
        grantId: "00000000-0000-4000-8000-000000000123",
        revision: 1,
      },
    });
    const forged = { ...authorization };

    expect(
      isTeachingCourseManagementActorAuthorized({
        ownerTeacherId: "teacher-owner",
        actorId,
        courseId,
        requiredCapability: "course.read",
        authorization: forged,
      }),
    ).toBe(false);
  });

  it("refuses to mint a delegated token from an owner decision", () => {
    expect(() =>
      createTeachingCourseManagementDelegatedAuthorization({
        actorId,
        courseId,
        decision: {
          authorized: true,
          reasonCode: "course-owner-implicit",
          capability: "course.read",
        },
      }),
    ).toThrow("collaborator-exact-scope-required");
  });

  it("carries the exact token only through the active asynchronous server operation", async () => {
    const authorization = createTeachingCourseManagementDelegatedAuthorization({
      actorId,
      courseId,
      decision: {
        authorized: true,
        reasonCode: "collaborator-exact-scope",
        capability: "course.grading.manage",
        grantId: "00000000-0000-4000-8000-000000000124",
        revision: 4,
      },
    });
    const check = () =>
      isTeachingCourseManagementActorAuthorized({
        ownerTeacherId: "teacher-owner",
        actorId,
        courseId,
        requiredCapability: "course.grading.manage",
      });

    expect(check()).toBe(false);
    await runWithTeachingCourseManagementDelegatedAuthorization(
      authorization,
      async () => {
        await Promise.resolve();
        expect(check()).toBe(true);
      },
    );
    expect(check()).toBe(false);
  });
});
