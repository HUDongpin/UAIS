import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("critical-flow regression matrix", () => {
  it("tracks the Week 3-4 advisory journeys in executable coverage", () => {
    const backendFlows = source("tests/critical-user-flows-backend.test.ts");
    const loginPageTests = source("tests/login-page.test.tsx");
    const plazaTests = source("tests/course-plaza-page.test.tsx");
    const learningTests = source("tests/learning-page.test.tsx");
    const chatActions = source("src/lib/chat-actions.ts");
    const teachingCourseApiTests = source("tests/teaching-course-management-api.test.ts");

    expect(backendFlows).toContain("login: issues signed app-session cookies");
    expect(loginPageTests).toContain("asks the server to issue the teacher app session");
    expect(loginPageTests).toContain("asks the server to issue the student app session");

    expect(backendFlows).toContain("enrol and teacher CRUD");
    expect(plazaTests).toContain("lets a signed-in student submit an invite-code join request");
    expect(teachingCourseApiTests).toContain(
      "lists only the signed student's invite-code memberships after teacher review",
    );

    expect(learningTests).toContain("shows the selected course workspace");
    expect(learningTests).toContain("keeps study tools behind the narration dock");
    expect(backendFlows).toContain(
      "learner evidence: records a playback progress event",
    );

    // Phase 5: the export/share mocks became the print-view route and a real
    // minted share record.
    expect(chatActions).toContain("createLearningChatroomExportUrl");
    expect(chatActions).toContain("requestLearningChatroomShareLink");

    expect(backendFlows).toContain("creates a course/class");
    expect(teachingCourseApiTests).toContain("createTeachingCoursePostHandler");
    expect(teachingCourseApiTests).toContain("createTeachingCourseClassPostHandler");
    expect(teachingCourseApiTests).toContain("createTeachingClassMembershipApprovePostHandler");
  });
});
