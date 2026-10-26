import { expect, it } from "vitest";
import { createTeachingLearningGroupId } from "@/lib/server/teaching-course-management-group-handlers";

it("keeps different Chinese classroom group names distinct within the same second", () => {
  const now = new Date("2026-10-26T08:00:00.000Z");
  const a = createTeachingLearningGroupId("归纳讨论甲组", now);
  const b = createTeachingLearningGroupId("归纳讨论乙组", now);
  expect(a).not.toBe(b);
  expect(a).toMatch(/^[a-zA-Z0-9_-]+$/);
  expect(createTeachingLearningGroupId("归纳讨论甲组", now)).toBe(a);
});
