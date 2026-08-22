import { describe, expect, it, vi } from "vitest";
import {
  authorizeLearningLoopStudentDashboard,
  authorizeLearningLoopTeacherCourse,
} from "@/lib/server/learning-loop-access";
import { createUaisAppSessionCookie } from "@/lib/server/uais-app-session";
import { createUaisTeacherAuthSessionCookieHeader } from "@/lib/server/teacher-auth-session";

const env = {
  UAIS_APP_SESSION_SIGNING_SECRET: "test-app-session-secret-at-least-32-characters",
  UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET:
    "test-teacher-session-secret-at-least-32-characters",
};
const now = new Date("2026-08-20T18:00:00.000Z");

function cookies(actorId = "teacher-1", includeTeacherSession = true) {
  const app = createUaisAppSessionCookie(
    {
      account: "teacher-1",
      role: "teacher",
      displayName: "Teacher One",
      department: "Education",
    },
    { env, now, ttlSeconds: 3600 },
  );
  if (!includeTeacherSession) return app;
  const teacher = createUaisTeacherAuthSessionCookieHeader({
    secret: env.UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET,
    claims: {
      sessionId: "teacher-write-session-1",
      actorId,
      role: "teacher",
      authenticatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 3600_000).toISOString(),
    },
  });
  return `${app}; ${teacher}`;
}

describe("P1 learning-loop teacher access", () => {
  it("requires matching app and teacher-write sessions plus course ownership", async () => {
    const readCourseScope = vi.fn(async () => ({
      course: { externalId: "course-1", title: "Course one" },
      classes: [{ externalId: "class-1", name: "Class one" }],
      lesson: {
        key: "lesson-1",
        position: 1,
        title: { "zh-CN": "第一讲", "en-US": "Lesson one" },
        manifestRef: "manifest-1",
      },
    }));
    const request = new Request("http://localhost/api/teaching/courses/course-1/activities", {
      headers: { cookie: cookies() },
    });

    await expect(
      authorizeLearningLoopTeacherCourse({
        request,
        env,
        now,
        courseId: "course-1",
        lessonKey: "lesson-1",
        readCourseScope,
      }),
    ).resolves.toMatchObject({
      status: "authorized",
      teacherAccount: "teacher-1",
      course: { externalId: "course-1" },
      lesson: { key: "lesson-1" },
    });
    expect(readCourseScope).toHaveBeenCalledWith(
      expect.objectContaining({ teacherAccount: "teacher-1", courseId: "course-1" }),
    );
  });

  it("fails before course lookup when either write session is missing or identities differ", async () => {
    const readCourseScope = vi.fn();
    const appOnly = await authorizeLearningLoopTeacherCourse({
      request: new Request("http://localhost", { headers: { cookie: cookies("teacher-1", false) } }),
      env,
      now,
      courseId: "course-1",
      readCourseScope,
    });
    const mismatch = await authorizeLearningLoopTeacherCourse({
      request: new Request("http://localhost", { headers: { cookie: cookies("teacher-2") } }),
      env,
      now,
      courseId: "course-1",
      readCourseScope,
    });

    expect(appOnly).toMatchObject({ status: "denied", reasonCode: "teacher-write-session-required" });
    expect(mismatch).toMatchObject({ status: "denied", reasonCode: "teacher-session-identity-mismatch" });
    expect(readCourseScope).not.toHaveBeenCalled();
  });
});

describe("P1 learning-loop student dashboard access", () => {
  it("derives course/class scopes only from approved snapshot memberships", async () => {
    const studentCookie = createUaisAppSessionCookie(
      {
        account: "student-1",
        role: "student",
        displayName: "Student One",
        department: "Education",
      },
      { env, now, ttlSeconds: 3600 },
    );
    const readDashboardScopes = vi.fn(async () => [
      { courseId: "course-1", courseTitle: "Course one", classId: "class-1" },
    ]);

    await expect(
      authorizeLearningLoopStudentDashboard({
        request: new Request("http://localhost/api/learning/dashboard", {
          headers: { cookie: studentCookie },
        }),
        env,
        now,
        readDashboardScopes,
      }),
    ).resolves.toEqual({
      status: "authorized",
      reasonCode: "student-approved-memberships",
      studentAccount: "student-1",
      scopes: [
        { courseId: "course-1", courseTitle: "Course one", classId: "class-1" },
      ],
    });
    expect(readDashboardScopes).toHaveBeenCalledWith({ studentAccount: "student-1" });
  });
});
