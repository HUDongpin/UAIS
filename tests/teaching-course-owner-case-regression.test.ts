import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTeachingCourseClassPostHandler } from "@/app/api/teaching/courses/[courseId]/classes/handler";
import { createTeachingLearningGroupPostHandler } from "@/app/api/teaching/courses/[courseId]/groups/handler";
import { createTeachingLearningGroupAutoSplitPostHandler } from "@/app/api/teaching/courses/[courseId]/groups/auto-split/handler";
import { createTeachingLearningGroupDeleteHandler, createTeachingLearningGroupPatchHandler } from "@/app/api/teaching/courses/[courseId]/groups/[groupId]/handler";
import { createUaisTeacherAuthSessionCookieHeader } from "@/lib/server/teacher-auth-session";
import {
  approveTeachingClassMembership,
  approveTeachingClassMemberships,
  bindTeachingCourseCoverAssetRecord,
  createTeachingClassRecord,
  createTeachingCourseRecord,
  createTeachingLearningGroupRecord,
  joinTeachingClassByInviteCode,
  readTeachingCourseManagementDatabase,
  saveTeachingAdminSettingsRecord,
  saveTeachingCollaborationInviteNotificationRecord,
  setTeachingClassMembershipStatus,
} from "@/lib/server/teaching-course-management-store";

const now = new Date("2026-09-20T01:00:00.000Z");
const owner = "FixtureTeacher";
const actorId = "fixtureteacher";
const secret = "synthetic-owner-case-teacher-session-secret";

describe("mixed-case canonical teacher ownership", () => {
  let dataDir: string;
  let courseId: string;
  let classId: string;
  let invitationCode: string;
  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "uais-owner-case-"));
    const { course } = await createTeachingCourseRecord({
      dataDir, actorId: owner, now,
      draft: { name: "Owner fixture", instructor: "Fixture", unit: "Fixture", department: "Fixture", semester: "2026 Fall" },
    });
    courseId = course.courseId;
    const { classItem } = await createTeachingClassRecord({
      dataDir, actorId: owner, courseId, now, draft: { className: "First class" },
    });
    classId = classItem.classId;
    invitationCode = classItem.invitationCode;
  });
  afterEach(async () => { await rm(dataDir, { recursive: true, force: true }); });

  function request(body: unknown, method = "POST", teacherId = actorId) {
    return new Request("http://localhost/api/teaching/fixture", {
      method,
      headers: {
        "content-type": "application/json",
        cookie: createUaisTeacherAuthSessionCookieHeader({
          secret,
          claims: { actorId: teacherId, role: "teacher", sessionId: "fixture-session", authenticatedAt: "2026-09-20T00:00:00.000Z", expiresAt: "2026-09-20T08:00:00.000Z" },
        }),
      },
      ...(method === "DELETE" ? {} : { body: JSON.stringify(body) }),
    });
  }
  function deps() {
    return { now, env: { UAIS_TEACHING_COURSES_DATA_DIR: dataDir, UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: secret } };
  }
  async function student(studentId: string) {
    return (await joinTeachingClassByInviteCode({
      dataDir, now, join: { invitationCode, studentId, studentDisplayName: studentId },
    })).membership;
  }
  async function approvedStudents() {
    for (const studentId of ["student-one", "student-two"]) {
      const membership = await student(studentId);
      await approveTeachingClassMembership({ dataDir, actorId: owner, classId, membershipId: membership.membershipId, now });
    }
  }

  it("creates classes through the route for the same teacher account", async () => {
    const handler = createTeachingCourseClassPostHandler(deps());
    const response = await handler(request({ className: "Second class" }), { params: Promise.resolve({ courseId }) });
    expect(response.status).toBe(201);
    expect((await response.json()).classItem.ownerTeacherId).toBe(actorId);
    const denied = await handler(request({ className: "Foreign class" }, "POST", "other-teacher"), { params: Promise.resolve({ courseId }) });
    expect(denied.status).toBe(403);
  });

  it("approves one or many memberships and removes the approved member", async () => {
    const first = await student("student-one");
    const second = await student("student-two");
    await expect(approveTeachingClassMembership({ dataDir, actorId, classId, membershipId: first.membershipId, now })).resolves.toMatchObject({ membership: { membershipStatus: "approved" } });
    await expect(approveTeachingClassMemberships({ dataDir, actorId, classId, now })).resolves.toMatchObject({ approvedMembershipIds: [second.membershipId] });
    await expect(setTeachingClassMembershipStatus({ dataDir, actorId, classId, membershipId: first.membershipId, membershipStatus: "removed", now })).resolves.toMatchObject({ membership: { membershipStatus: "removed" } });
  });

  it("binds covers, saves admin settings, and records collaboration invites", async () => {
    await expect(bindTeachingCourseCoverAssetRecord({ dataDir, actorId, courseId, coverAssetId: "cover-fixture", now })).resolves.toMatchObject({ course: { ownerTeacherId: owner } });
    await expect(saveTeachingAdminSettingsRecord({ dataDir, actorId, courseId, operationRecordId: "admin-fixture", now })).resolves.toHaveProperty("adminSettings");
    await expect(saveTeachingCollaborationInviteNotificationRecord({ dataDir, actorId, courseId, operationRecordId: "invite-fixture", outboxId: "outbox-fixture", now })).resolves.toHaveProperty("notification");
  });

  it("creates, updates, and deletes a class-scoped group through its routes", async () => {
    await approvedStudents();
    const members = [{ studentId: "student-one" }, { studentId: "student-two" }];
    const created = await createTeachingLearningGroupPostHandler(deps())(request({ groupName: "Fixture group", classId, members }), { params: Promise.resolve({ courseId }) });
    expect(created.status).toBe(201);
    const { group } = await created.json();
    expect(group.ownerTeacherId).toBe(actorId);
    const params = { params: Promise.resolve({ courseId, groupId: group.groupId }) };
    const patched = await createTeachingLearningGroupPatchHandler(deps())(request({ groupName: "Renamed group", members }, "PATCH", owner), params);
    expect(patched.status).toBe(200);
    const deleted = await createTeachingLearningGroupDeleteHandler(deps())(request(undefined, "DELETE"), params);
    expect(deleted.status).toBe(200);
    expect((await readTeachingCourseManagementDatabase({ dataDir })).learningGroups).toEqual([]);
  });

  it("auto-splits approved members through the route", async () => {
    await approvedStudents();
    const response = await createTeachingLearningGroupAutoSplitPostHandler(deps())(request({ classId, groupSize: 2 }), { params: Promise.resolve({ courseId }) });
    expect(response.status).toBe(201);
    expect((await response.json()).groups).toHaveLength(1);
  });

  it("still denies another teacher at the store ownership boundary", async () => {
    await expect(createTeachingLearningGroupRecord({ dataDir, actorId: "other-teacher", courseId, now, draft: { groupName: "Foreign group", classId, members: [{ studentId: "student-one" }, { studentId: "student-two" }] } })).rejects.toMatchObject({ status: 403 });
  });
});
