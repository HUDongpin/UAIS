import { describe, expect, it } from "vitest";
import { resolveTeachingOperationCollaboratorCapability } from "@/lib/server/teaching-operation-collaborator-policy";

describe("teaching operation collaborator policy", () => {
  it.each([
    ["course-settings", "primary", "course.settings.manage"],
    ["course-settings", "secondary", "course.read"],
    ["agents", "primary", "course.settings.manage"],
    ["agents", "secondary", "course.settings.manage"],
    ["knowledge-base", "primary", "course.content.write"],
    ["knowledge-base", "secondary", "course.content.write"],
    ["content", "primary", "course.content.write"],
    ["content", "secondary", "course.content.write"],
    ["students", "primary", "course.students.manage"],
    ["students", "secondary", "course.students.manage"],
    ["data-export", "primary", "course.export"],
    ["data-export", "secondary", "course.export"],
    ["dashboard", "primary", "course.read"],
    ["dashboard", "secondary", "course.settings.manage"],
    ["quiz-board", "primary", "course.read"],
    ["quiz-board", "secondary", "course.grading.manage"],
    ["grading", "primary", "course.grading.manage"],
    ["grading", "secondary", "course.grading.manage"],
    ["invite-code", "primary", "course.students.manage"],
    ["invite-code", "secondary", "course.students.manage"],
  ] as const)(
    "maps %s/%s to the least privileged persisted capability",
    (operationId, actionSlot, capability) => {
      expect(
        resolveTeachingOperationCollaboratorCapability({
          operationId,
          actionSlot,
        }),
      ).toBe(capability);
    },
  );

  it.each(["primary", "secondary"] as const)(
    "keeps admins/%s owner-only",
    (actionSlot) => {
      expect(
        resolveTeachingOperationCollaboratorCapability({
          operationId: "admins",
          actionSlot,
        }),
      ).toBeUndefined();
    },
  );

  it("fails closed for unknown operation and action identifiers", () => {
    expect(
      resolveTeachingOperationCollaboratorCapability({
        operationId: "unknown-operation",
        actionSlot: "primary",
      }),
    ).toBeUndefined();
    expect(
      resolveTeachingOperationCollaboratorCapability({
        operationId: "content",
        actionSlot: "unknown-action",
      }),
    ).toBeUndefined();
  });
});
