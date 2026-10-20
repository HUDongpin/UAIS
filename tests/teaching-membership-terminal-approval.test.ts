import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTeachingClassMembershipApprovePostHandler } from "@/app/api/teaching/classes/[classId]/memberships/[membershipId]/approve/handler";
import { createUaisTeacherAuthSessionCookieHeader } from "@/lib/server/teacher-auth-session";
import {
  approveTeachingClassMembership,
  createTeachingClassRecord,
  createTeachingCourseRecord,
  joinTeachingClassByInviteCode,
  readTeachingCourseManagementDatabase,
  setTeachingClassMembershipStatus,
} from "@/lib/server/teaching-course-management-store";

describe("single membership approval lifecycle", () => {
  it.each(["rejected", "removed"] as const)(
    "refuses a stale approval for a %s membership after the student moves class",
    async (membershipStatus) => {
      const dataDir = await mkdtemp(join(tmpdir(), "uais-terminal-approval-"));
      try {
        const actorId = "teacher-fixture";
        const { course } = await createTeachingCourseRecord({
          dataDir,
          actorId,
          draft: {
            name: "Membership fixture",
            instructor: "Fixture Teacher",
            unit: "Fixture Unit",
            department: "Fixture Department",
            semester: "2026 Fall",
          },
        });
        const { classItem: firstClass } = await createTeachingClassRecord({
          dataDir, actorId, courseId: course.courseId, draft: { className: "First class" },
        });
        const { classItem: secondClass } = await createTeachingClassRecord({
          dataDir, actorId, courseId: course.courseId, draft: { className: "Second class" },
        });
        const joinClass = (invitationCode: string) => joinTeachingClassByInviteCode({
          dataDir,
          join: { invitationCode, studentId: "fixture-student", studentDisplayName: "Fixture Student" },
        });
        const { membership: first } = await joinClass(firstClass.invitationCode);
        const firstApproval = { dataDir, actorId, classId: firstClass.classId, membershipId: first.membershipId };
        if (membershipStatus === "removed") await approveTeachingClassMembership(firstApproval);
        await setTeachingClassMembershipStatus({ ...firstApproval, membershipStatus });
        const { membership: second } = await joinClass(secondClass.invitationCode);
        const secondApproval = { dataDir, actorId, classId: secondClass.classId, membershipId: second.membershipId };
        await approveTeachingClassMembership(secondApproval);
        const before = await readTeachingCourseManagementDatabase({ dataDir });

        await expect(approveTeachingClassMembership(firstApproval)).rejects.toMatchObject({
          status: 409,
          reasonCode: "membership-transition-not-allowed",
        });
        const now = new Date("2026-09-20T01:00:00.000Z");
        const secret = "synthetic-terminal-approval-teacher-secret";
        const response = await createTeachingClassMembershipApprovePostHandler({
          now,
          env: { UAIS_TEACHING_COURSES_DATA_DIR: dataDir, UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: secret },
        })(new Request("http://localhost/api/teaching/fixture/approve", {
          method: "POST",
          headers: {
            cookie: createUaisTeacherAuthSessionCookieHeader({
              secret,
              claims: { actorId, role: "teacher", sessionId: "fixture-session", authenticatedAt: "2026-09-20T00:00:00.000Z", expiresAt: "2026-09-20T08:00:00.000Z" },
            }),
          },
        }), { params: Promise.resolve({ classId: firstClass.classId, membershipId: first.membershipId }) });
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ reasonCode: "membership-transition-not-allowed" });
        expect(await readTeachingCourseManagementDatabase({ dataDir })).toEqual(before);
        // An approved membership remains safely idempotent.
        await expect(approveTeachingClassMembership(secondApproval)).resolves.toMatchObject({
          membership: { membershipStatus: "approved" },
        });
      } finally {
        await rm(dataDir, { recursive: true, force: true });
      }
    },
  );
});
