import { describe, expect, it } from "vitest";
import {
  isSameTeachingActorId,
  teachingActorOwnsCourse,
} from "@/lib/server/teaching-actor-id";

describe("teaching actor id comparison", () => {
  it("treats trimmed login identifiers as the same actor without regard to case", () => {
    expect(isSameTeachingActorId("phoebe", "Phoebe")).toBe(true);
    expect(isSameTeachingActorId("  phoebe  ", "PHOEBE")).toBe(true);
    expect(isSameTeachingActorId("phoebe", "teacher-kang")).toBe(false);
    expect(isSameTeachingActorId("", "phoebe")).toBe(false);
    expect(isSameTeachingActorId("phoebe", "   ")).toBe(false);
  });

  it("authorizes snapshot ownership when the course id matches and the actor is the owner", () => {
    expect(
      teachingActorOwnsCourse({
        ownerTeacherId: "Phoebe",
        actorId: "phoebe",
        courseId: "teacher-research-methods",
        candidateCourseId: "teacher-research-methods",
      }),
    ).toBe(true);
    expect(
      teachingActorOwnsCourse({
        ownerTeacherId: "phoebe",
        actorId: "phoebe",
        courseId: "teacher-research-methods",
        candidateCourseId: "teacher-math-pedagogy",
      }),
    ).toBe(false);
    expect(
      teachingActorOwnsCourse({
        ownerTeacherId: "teacher-kang",
        actorId: "phoebe",
        courseId: "teacher-research-methods",
        candidateCourseId: "teacher-research-methods",
      }),
    ).toBe(false);
  });
});
