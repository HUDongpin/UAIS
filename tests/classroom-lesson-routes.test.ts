import { describe, expect, it, vi } from "vitest";
import {
  createTeacherLessonsHandler,
  createStudentLessonsHandler,
} from "@/lib/classroom-lessons/route-handlers";

describe("classroom lesson route boundaries", () => {
  it("uses the routed Host for same-origin writes when Next uses an internal request URL", async () => {
    const importPackage=vi.fn(async()=>({lessonKey:"lesson-1"}));
    const teacherAccess=async()=>({status:"authorized" as const,teacherAccount:"t",course:{externalId:"c",title:"课程"},classes:[],reasonCode:"teacher-dual-session-course-owner" as const});
    const handler=createTeacherLessonsHandler("import",{teacherAccess,store:(()=>({importPackage})) as unknown as typeof import("@/lib/classroom-lessons/store").createClassroomLessonStore});
    const context={params:Promise.resolve({courseId:"c"})};
    const accepted=await handler(new Request("http://localhost:49391/api",{method:"POST",headers:{host:"127.0.0.1:49391",origin:"http://127.0.0.1:49391","content-type":"application/json"},body:JSON.stringify({source:"blank"})}),context);
    expect(accepted.status).toBe(201);
    const rejected=await handler(new Request("http://localhost:49391/api",{method:"POST",headers:{host:"127.0.0.1:49391",origin:"https://unrelated.example","content-type":"application/json"},body:"{}"}),context);
    expect(rejected.status).toBe(403);expect(importPackage).toHaveBeenCalledTimes(1);
  });
  it("denies a student before accessing teacher drafts", async () => {
    const store = vi.fn();
    const handler = createTeacherLessonsHandler("list", {
      teacherAccess: async () => ({
        status: "denied",
        reasonCode: "teacher-app-session-required",
      }),
      store,
    });
    expect(
      (
        await handler(
          new Request("http://localhost/api/teaching/courses/c/lessons"),
          { params: Promise.resolve({ courseId: "c" }) },
        )
      ).status,
    ).toBe(401);
    expect(store).not.toHaveBeenCalled();
  });
  it("rejects publication to an unowned class before invoking the transaction", async () => {
    const store = vi.fn();
    const handler = createTeacherLessonsHandler("publish", {
      teacherAccess: async () => ({
        status: "authorized",
        teacherAccount: "t",
        course: { externalId: "c", title: "课程" },
        classes: [{ externalId: "class-a", name: "A" }],
        reasonCode: "teacher-dual-session-course-owner",
      }),
      store,
    });
    const response = await handler(
      new Request("http://localhost/api", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "publish-1",
        },
        body: JSON.stringify({
          expectedRevision: 1,
          targetClassIds: ["class-b"],
          taskIds: [],
        }),
      }),
      { params: Promise.resolve({ courseId: "c", lessonKey: "lesson-1" }) },
    );
    expect(response.status).toBe(403);
    expect(store).not.toHaveBeenCalled();
  });
  it("does not read student materials for an unapproved class", async () => {
    const store = vi.fn();
    const handler = createStudentLessonsHandler("read", {
      studentAccess: async () => ({
        status: "authorized",
        studentAccount: "s",
        reasonCode: "student-approved-memberships",
        scopes: [{ courseId: "c", courseTitle: "C", classId: "approved" }],
      }),
      store,
    });
    const response = await handler(
      new Request("http://localhost/api?classId=other"),
      { params: Promise.resolve({ courseId: "c", lessonKey: "lesson-1" }) },
    );
    expect(response.status).toBe(403);
    expect(store).not.toHaveBeenCalled();
  });
});
