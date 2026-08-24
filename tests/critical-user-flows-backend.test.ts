import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createUaisAppSessionPostHandler } from "@/app/api/auth/app-session/handler";
import { POST as learningRecordEventPost } from "@/app/api/learning-records/events/route";
import { createTeachingClassMembershipApprovePostHandler } from "@/app/api/teaching/classes/[classId]/memberships/[membershipId]/approve/handler";
import { createTeachingCourseClassPostHandler } from "@/app/api/teaching/courses/[courseId]/classes/handler";
import { createTeachingCoursePostHandler } from "@/app/api/teaching/courses/handler";
import { createTeachingInviteCodeJoinPostHandler } from "@/app/api/teaching/invite-codes/[code]/join/handler";
import { type UaisAppSessionUser } from "@/lib/auth/uais-app-session";
import type { LearningRecordEventInput } from "@/lib/learning-records/xapi-events";
import { createUaisAppSessionCookie } from "@/lib/server/uais-app-session";
import { createUaisTeacherAuthSessionCookieHeader } from "@/lib/server/teacher-auth-session";

const createLearningRecordEventPostHandler =
  learningRecordEventPost.createForTesting;
const teacherAuthSecret = "test-critical-flow-teacher-session-secret";
const appSessionSecret = "test-critical-flow-app-session-secret";
const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
  secret: teacherAuthSecret,
  claims: {
    sessionId: "teacher-kang-critical-flow-session",
    actorId: "teacher-kang",
    role: "teacher",
    authenticatedAt: "2026-07-08T09:00:00.000Z",
    expiresAt: "2026-07-08T13:00:00.000Z",
  },
});
const studentUser: UaisAppSessionUser = {
  account: "Peter",
  department: "学生账号",
  displayName: "Peter",
  role: "student",
};
const courseId = "teacher-course-critical-flow-research-methods-20260708-090000";
const classId = `${courseId}-class-1`;
const membershipId = `membership-${classId}-Peter`;

describe("critical UAIS backend user flows", () => {
  it("login: issues signed app-session cookies and role-specific landing routes", async () => {
    const login = createUaisAppSessionPostHandler({
      env: {
        UAIS_APP_AUTH_PROVIDER: "local-demo",
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
      },
      now: new Date("2026-07-08T09:00:00.000Z"),
      createSessionId: () => "critical-flow-login-session",
    });

    const teacherResponse = await login(
      new Request("https://www.uais.top/api/auth/app-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          account: "Phoebe",
          password: "12345",
          from: "/teaching",
        }),
      }),
    );
    const teacherBody = await teacherResponse.json();
    const teacherSetCookie = teacherResponse.headers.getSetCookie().join("\n");

    expect(teacherResponse.status, JSON.stringify(teacherBody)).toBe(200);
    expect(teacherBody.redirectTarget).toBe("/teaching");
    expect(teacherBody.appSession.actor).toEqual({
      account: "Phoebe",
      role: "teacher",
    });
    expect(teacherSetCookie).toContain("uais_app_session=");
    expect(teacherSetCookie).toContain("uais_app_session_signature=");
    expect(teacherSetCookie).toContain("HttpOnly");
    expect(teacherSetCookie).toContain("SameSite=Lax");
    expect(JSON.stringify(teacherBody)).not.toContain("12345");

    const studentResponse = await login(
      new Request("https://www.uais.top/api/auth/app-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          account: "Peter",
          password: "12345",
          from: "/teaching",
        }),
      }),
    );
    const studentBody = await studentResponse.json();

    expect(studentResponse.status, JSON.stringify(studentBody)).toBe(200);
    expect(studentBody.redirectTarget).toBe("/student-dashboard");
    expect(studentBody.appSession.actor).toEqual({
      account: "Peter",
      role: "student",
    });
    expect(JSON.stringify(studentBody)).not.toContain("12345");
  });

  it("teacher login reaches course creation: a UI sign-in carries write authority end to end", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-critical-flow-bridge-"));
    const env = {
      NODE_ENV: "development",
      UAIS_APP_AUTH_PROVIDER: "local-demo",
      UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
    };
    const mergedOwnership: Array<{ teacherId: string; courseIds: string[] }> = [];
    const login = createUaisAppSessionPostHandler({
      env,
      now: new Date("2026-07-08T09:00:00.000Z"),
      createSessionId: () => "phoebe-critical-flow-session",
    });
    const postCourse = createTeachingCoursePostHandler({
      env,
      now: new Date("2026-07-08T09:00:00.000Z"),
      mergeTeacherAiOwnershipRecord: async (input) => {
        mergedOwnership.push({
          teacherId: input.ownership.teacherId,
          courseIds: input.ownership.courseIds ?? [],
        });
        return {
          teacherId: input.ownership.teacherId,
          status: "merged",
          storagePolicy: "external-redacted-teacher-ai-ownership-merge",
          storageWritePolicy: "external-atomic-merge",
          responsibleSession: "S12",
          updatedAt: "2026-07-08T09:00:00.000Z",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
    });

    try {
      const loginResponse = await login(
        new Request("https://www.uais.top/api/auth/app-session", {
          method: "POST",
          body: JSON.stringify({ account: "Phoebe", password: "12345" }),
        }),
      );
      expect(loginResponse.status).toBe(200);

      // Exactly what a browser would send back: every cookie the login set,
      // with no hand-built teacher credential anywhere in this test.
      const cookieHeader = loginResponse.headers
        .getSetCookie()
        .map((setCookie) => setCookie.split(";")[0]?.trim())
        .filter(Boolean)
        .join("; ");

      const courseResponse = await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: cookieHeader,
            "x-uais-trace-id": "trace-critical-login-bridge-course-create",
          },
          body: JSON.stringify({
            name: "Login Bridge Research Methods",
            instructor: "Phoebe",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
          }),
        }),
      );
      const courseBody = await courseResponse.json();

      expect(courseResponse.status, JSON.stringify(courseBody)).toBe(201);
      expect(courseBody.course.ownerTeacherId).toBe("Phoebe");
      // Ownership is merged under the same actor, so the follow-on operation
      // routes stop answering teacher-course-ownership-required.
      expect(mergedOwnership).toEqual([
        { teacherId: "Phoebe", courseIds: [courseBody.course.courseId] },
      ]);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("enrol and teacher CRUD: creates a course/class, accepts invite join, and approves membership", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-critical-flow-course-"));
    const env = {
      UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
    };
    const postCourse = createTeachingCoursePostHandler({
      env,
      now: new Date("2026-07-08T09:00:00.000Z"),
      mergeTeacherAiOwnershipRecord: async (input) => ({
        teacherId: input.ownership.teacherId,
        status: "merged",
        storagePolicy: "external-redacted-teacher-ai-ownership-merge",
        storageWritePolicy: "external-atomic-merge",
        responsibleSession: "S12",
        updatedAt: "2026-07-08T09:00:00.000Z",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      }),
    });
    const postClass = createTeachingCourseClassPostHandler({
      env,
      now: new Date("2026-07-08T09:05:00.000Z"),
    });
    const postJoin = createTeachingInviteCodeJoinPostHandler({
      env,
      now: new Date("2026-07-08T09:10:00.000Z"),
    });
    const postApprove = createTeachingClassMembershipApprovePostHandler({
      env,
      now: new Date("2026-07-08T09:15:00.000Z"),
    });

    try {
      const courseResponse = await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-critical-course-create",
          },
          body: JSON.stringify({
            name: "Critical Flow Research Methods",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
          }),
        }),
      );
      const courseBody = await courseResponse.json();

      expect(courseResponse.status, JSON.stringify(courseBody)).toBe(201);
      expect(courseBody.course).toEqual(
        expect.objectContaining({
          courseId,
          courseName: "Critical Flow Research Methods",
          ownerTeacherId: "teacher-kang",
        }),
      );
      expect(courseBody.receipt).toEqual(
        expect.objectContaining({
          action: "create-course",
          actorId: "teacher-kang",
          status: "persisted",
        }),
      );

      const classResponse = await postClass(
        new Request(`https://www.uais.top/api/teaching/courses/${courseId}/classes`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: teacherCookie,
            "x-uais-trace-id": "trace-critical-class-create",
          },
          body: JSON.stringify({
            className: "Critical Flow Class 1",
            semester: "2026 Spring",
          }),
        }),
        {
          params: Promise.resolve({ courseId }),
        },
      );
      const classBody = await classResponse.json();

      expect(classResponse.status, JSON.stringify(classBody)).toBe(201);
      expect(classBody.classItem).toEqual(
        expect.objectContaining({
          classId,
          courseId,
          invitationCode: expect.stringMatching(/^[0-9]{8}$/),
          ownerTeacherId: "teacher-kang",
        }),
      );
      const invitationCode = classBody.classItem.invitationCode as string;

      const joinResponse = await postJoin(
        new Request(`https://www.uais.top/api/teaching/invite-codes/${invitationCode}/join`, {
          method: "POST",
          headers: {
            cookie: createUaisAppSessionCookie(studentUser, {
              secret: appSessionSecret,
              now: new Date("2026-07-08T09:10:00.000Z"),
              sessionId: "critical-flow-student-session",
            }),
            "x-uais-trace-id": "trace-critical-student-join",
          },
        }),
        {
          params: Promise.resolve({ code: invitationCode }),
        },
      );
      const joinBody = await joinResponse.json();

      expect(joinResponse.status, JSON.stringify(joinBody)).toBe(201);
      expect(joinBody.membership).toEqual(
        expect.objectContaining({
          membershipId,
          courseId,
          classId,
          studentId: "Peter",
          membershipStatus: "pending-teacher-review",
        }),
      );

      const approveResponse = await postApprove(
        new Request(
          `https://www.uais.top/api/teaching/classes/${classId}/memberships/${membershipId}/approve`,
          {
            method: "POST",
            headers: {
              cookie: teacherCookie,
              "x-uais-trace-id": "trace-critical-membership-approve",
            },
          },
        ),
        {
          params: Promise.resolve({ classId, membershipId }),
        },
      );
      const approveBody = await approveResponse.json();

      expect(approveResponse.status, JSON.stringify(approveBody)).toBe(200);
      expect(approveBody.membership).toEqual(
        expect.objectContaining({
          membershipId,
          membershipStatus: "approved",
          approvedAt: "2026-07-08T09:15:00.000Z",
        }),
      );
      expect(JSON.stringify(approveBody)).not.toContain(dataDir);
      expect(JSON.stringify(approveBody)).not.toContain(appSessionSecret);
      expect(JSON.stringify(approveBody)).not.toContain(teacherAuthSecret);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("learner evidence: records a playback progress event for the signed student and rejects spoofed actors", async () => {
    const persisted: Array<{
      studentAccount: string;
      classExternalId: string;
      event: LearningRecordEventInput;
      idempotencyKey: string;
      traceId: string;
    }> = [];
    const postEvent = createLearningRecordEventPostHandler({
      env: { UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret },
      // Authorize deterministically so the journey does not depend on the live
      // PPT-playback membership fetch (covered separately). This test exercises
      // the route's own contract: the student-session gate, the self-scope
      // check, the authoritative persistence call, and the response status.
      authorizeLearnerEvent: () => ({
        status: "authorized",
        reasonCode: "learner-course-membership-approved",
        classId,
        responsibleSession: "S12",
      }),
      persist: async (item) => {
        persisted.push(item);
        return {
          status: "persisted",
          resourceId: "event-critical-flow-1",
          state: "persisted",
          revision: 1,
          eventId: "event-critical-flow-1",
          traceId: item.traceId,
          persistedAt: "2026-07-08T09:20:00.000Z",
        };
      },
    });

    // Mint at the current time (no fixed `now`): the events route verifies the
    // session's expiry against the real clock and is not given a `now` dep, so a
    // back-dated cookie would read as expired.
    const studentCookie = createUaisAppSessionCookie(studentUser, {
      secret: appSessionSecret,
      sessionId: "critical-flow-learner-evidence-session",
    });
    const lessonId = `${courseId}-lesson-1`;
    const playbackEvent: LearningRecordEventInput = {
      type: "lesson.viewed",
      object: { id: lessonId, name: "Research Methods Lesson 1" },
      result: { completion: true, duration: "PT12M" },
      context: { courseId, lessonId },
    };
    const recordRequest = (body: unknown, cookie?: string) =>
      new Request("https://www.uais.top/api/learning-records/events", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: "www.uais.top",
          origin: "https://www.uais.top",
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(body),
      });

    // 1) Happy path: success is returned only after the signed student's event
    // has reached the authoritative Postgres boundary.
    const acceptedResponse = await postEvent(
      recordRequest({ actorId: "Peter", event: playbackEvent }, studentCookie),
    );
    const acceptedBody = await acceptedResponse.json();
    expect(acceptedResponse.status, JSON.stringify(acceptedBody)).toBe(200);
    expect(acceptedBody.status).toBe("persisted");
    expect(acceptedBody.eventId).toBe("event-critical-flow-1");
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      studentAccount: "Peter",
      classExternalId: classId,
      idempotencyKey: expect.stringMatching(/^learning-event:[0-9a-f]{64}$/),
    });
    expect(persisted[0].event.type).toBe("lesson.viewed");
    expect(JSON.stringify(acceptedBody)).not.toContain(appSessionSecret);

    // 2) No signed session -> 401 (unauthenticated cannot record evidence).
    const anonymousResponse = await postEvent(
      recordRequest({ actorId: "Peter", event: playbackEvent }),
    );
    expect(anonymousResponse.status).toBe(401);

    // 3) Spoofed actor (session is Peter, body claims another learner) -> 403.
    const spoofedResponse = await postEvent(
      recordRequest({ actorId: "Mallory", event: playbackEvent }, studentCookie),
    );
    expect(spoofedResponse.status).toBe(403);

    // 4) Malformed event body -> 400.
    const invalidResponse = await postEvent(
      recordRequest({ actorId: "Peter", event: { type: "lesson.viewed" } }, studentCookie),
    );
    expect(invalidResponse.status).toBe(400);

    // Only the authorized happy-path event reached authoritative persistence.
    expect(persisted).toHaveLength(1);
  });
});
