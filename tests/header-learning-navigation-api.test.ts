import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { GET } from "@/app/api/learning/courses/[courseId]/units/[lessonKey]/route";
import { authorizeLearningLoopStudentCourse } from "@/lib/server/learning-loop-access";
import { authorizeLearningLoopStudentActivity } from "@/lib/server/learning-loop-student-route";
import { createUaisAppSessionCookie } from "@/lib/server/uais-app-session";

const activityId = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-10-20T08:00:00.000Z");
const access = {
  status: "authorized", reasonCode: "student-course-membership-approved",
  studentAccount: "student-header", courseId: "course-header", classId: "class-b",
} as const;
const context = { params: Promise.resolve({ courseId: "course-header", lessonKey: "lesson-b" }) };
const baseUrl = "http://localhost/api/learning/courses/course-header/units/lesson-b";

it("passes validated task and class selectors through the authorized unit read", async () => {
  const authorize = vi.fn(async () => access);
  const readStudentUnit = vi.fn(async () => ({ unit: { courseId: "course-header", classId: "class-b" }, activity: { id: activityId } }));
  const response = await GET.createForTesting({ env: {}, authorize, readStudentUnit })(
    new Request(`${baseUrl}?activityId=${activityId}&classId=class-b`), context,
  );
  expect(response.status).toBe(200);
  expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ courseId: "course-header", classId: "class-b" }));
  expect(readStudentUnit).toHaveBeenCalledWith({
    studentAccount: "student-header", courseExternalId: "course-header", classExternalId: "class-b",
    lessonKey: "lesson-b", activityId,
  });
});

it("preserves the existing unit read contract when no selector is supplied", async () => {
  const authorize = vi.fn(async () => access);
  const readStudentUnit = vi.fn(async () => ({ activity: { id: activityId } }));
  const response = await GET.createForTesting({ env: {}, authorize, readStudentUnit })(new Request(baseUrl), context);
  expect(response.status).toBe(200);
  expect(readStudentUnit).toHaveBeenCalledWith({
    studentAccount: "student-header", courseExternalId: "course-header",
    classExternalId: "class-b", lessonKey: "lesson-b",
  });
  expect(authorize).toHaveBeenCalledWith(expect.not.objectContaining({ classId: expect.anything() }));
});

it.each(["activityId=invalid", "activityId=", "classId=..%2Fprivate", "classId="])(
  "rejects invalid selectors before a unit read: %s", async (query) => {
    const readStudentUnit = vi.fn();
    const response = await GET.createForTesting({ env: {}, authorize: async () => access, readStudentUnit })(
      new Request(`${baseUrl}?${query}`), context,
    );
    expect(response.status).toBe(400);
    expect(readStudentUnit).not.toHaveBeenCalled();
  },
);

it("fails closed when the authorized class differs from the requested class", async () => {
  const readStudentUnit = vi.fn();
  const response = await GET.createForTesting({
    env: {}, authorize: async () => ({ ...access, classId: "class-a" }), readStudentUnit,
  })(new Request(`${baseUrl}?activityId=${activityId}&classId=class-b`), context);
  expect(response.status).toBe(403);
  expect(readStudentUnit).not.toHaveBeenCalled();
});

it("authorizes task actions against the server-read activity class", async () => {
  const authorize = vi.fn(async () => access);
  const result = await authorizeLearningLoopStudentActivity({
    request: new Request("http://localhost/api/learning/activities/task/submission"),
    env: {}, activityId, authorize,
    readActivityScope: async () => ({ courseId: "course-header", classId: "class-b", lessonKey: "lesson-b" }),
  });
  expect(result.access.status).toBe("authorized");
  expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ courseId: "course-header", classId: "class-b" }));
});

it("selects only the requested student's approved class and preserves no-selector behavior", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "uais-header-learning-scope-"));
  const redaction = { secrets: "omitted", localFiles: "omitted", assets: "ids-only" };
  const record = {
    courseId: "course-header", ownerTeacherId: "teacher-header",
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
    storagePolicy: "local-json-teaching-course-management",
    storageWritePolicy: "atomic-json-file-replace", responsibleSession: "S12", redaction,
  };
  const classes = ["class-a", "class-b", "class-pending", "class-foreign"];
  const env = {
    UAIS_APP_SESSION_SIGNING_SECRET: "header-navigation-synthetic-session-secret",
    UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
  };
  const cookie = createUaisAppSessionCookie(
    { account: "student-header", role: "student", displayName: "Student", department: "QA" },
    { env, now, ttlSeconds: 3600 },
  );
  try {
    await writeFile(join(dataDir, "teaching-course-management.json"), JSON.stringify({
      schemaVersion: "uais-teaching-course-management-v1", updatedAt: now.toISOString(),
      courses: [{ ...record, courseName: "Header course", instructor: "Teacher", unit: "QA", department: "QA", semester: "2026", status: "draft", students: 1 }],
      classes: classes.map(classId => ({
        ...record, classId, className: classId, students: 1, semester: "2026",
        invitationCode: "12345678", joinUrl: "/courses?invite=12345678",
      })),
      memberships: classes.map(classId => ({
        courseId: record.courseId, classId, membershipId: `membership-${classId}`,
        invitationCode: "12345678", studentId: classId === "class-foreign" ? "other-student" : "student-header",
        studentDisplayName: "Student", membershipStatus: classId === "class-pending" ? "pending-teacher-review" : "approved",
        joinedAt: now.toISOString(), approvedAt: now.toISOString(), approvedByTeacherId: "teacher-header",
        storagePolicy: record.storagePolicy, storageWritePolicy: record.storageWritePolicy,
        responsibleSession: "S12", redaction,
      })),
      auditEvents: [],
    }));
    const request = new Request(baseUrl, { headers: { cookie } });
    await expect(authorizeLearningLoopStudentCourse({ request, env, now, courseId: "course-header", classId: "class-b" }))
      .resolves.toMatchObject({ status: "authorized", classId: "class-b" });
    await expect(authorizeLearningLoopStudentCourse({ request, env, now, courseId: "course-header" }))
      .resolves.toMatchObject({ status: "authorized", classId: "class-a" });
    for (const classId of ["class-pending", "class-foreign", "missing-class"]) {
      await expect(authorizeLearningLoopStudentCourse({ request, env, now, courseId: "course-header", classId }))
        .resolves.toMatchObject({ status: "denied" });
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
