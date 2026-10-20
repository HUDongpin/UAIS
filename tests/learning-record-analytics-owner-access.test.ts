import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLearningRecordAnalyticsGetHandler } from "@/app/api/learning-records/analytics/handler";
import {
  approveTeachingClassMembership,
  createTeachingClassRecord,
  createTeachingCourseRecord,
  joinTeachingClassByInviteCode,
  setTeachingClassMembershipStatus,
} from "@/lib/server/teaching-course-management-store";
import { createUaisAppSessionCookie } from "@/lib/server/uais-app-session";

const owner = "FixtureTeacher";
const studentId = "fixture-student";

describe("teacher analytics owner access", () => {
  let dataDir: string;
  let courseId: string;
  let classId: string;
  let membershipId: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "uais-analytics-owner-"));
    const { course } = await createTeachingCourseRecord({
      dataDir,
      actorId: owner,
      draft: { name: "Analytics fixture", instructor: "Fixture Teacher", unit: "Fixture", department: "Fixture", semester: "2026 Fall" },
    });
    courseId = course.courseId;
    const { classItem } = await createTeachingClassRecord({
      dataDir, actorId: owner, courseId, draft: { className: "Fixture class" },
    });
    classId = classItem.classId;
    const { membership } = await joinTeachingClassByInviteCode({
      dataDir,
      join: { invitationCode: classItem.invitationCode, studentId, studentDisplayName: "Fixture Student" },
    });
    membershipId = membership.membershipId;
    await approveTeachingClassMembership({ dataDir, actorId: owner, classId, membershipId });
  });

  afterEach(async () => { await rm(dataDir, { recursive: true, force: true }); });

  async function query(scope: string, account = owner.toLowerCase(), requestedCourseId = courseId) {
    const env = {
      UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
      UAIS_APP_SESSION_SIGNING_SECRET: "synthetic-analytics-owner-test-secret",
    };
    const cookie = createUaisAppSessionCookie({
      account, role: "teacher", displayName: "Fixture Teacher", department: "Fixture",
    }, { env });
    const getStatements = vi.fn(async () => ({
      statements: [], more: "",
      redaction: { endpoint: "fingerprinted" as const, credentials: "omitted" as const, rawStatements: "summarized" as const },
    }));
    const handler = createLearningRecordAnalyticsGetHandler({ env, getStatements });
    const params = new URLSearchParams({ scope, courseId: requestedCourseId, classId, actorId: studentId });
    const response = await handler(new Request(`https://uais.test/api/learning-records/analytics?${params}`, { headers: { cookie } }));
    return { response, getStatements };
  }

  it.each(["teacher-class-insights", "learner-profile"])(
    "reads %s for a class owned by the same differently cased account",
    async (scope) => {
      const { response, getStatements } = await query(scope);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ access: { reasonCode: "teacher-class-scope-authorized" } });
      expect(getStatements).toHaveBeenCalledOnce();
    },
  );

  it.each(["teacher-class-insights", "learner-profile"])(
    "denies %s to a different teacher before reading records",
    async (scope) => {
      const { response, getStatements } = await query(scope, "different-teacher");
      expect(response.status).toBe(403);
      expect(getStatements).not.toHaveBeenCalled();
    },
  );

  it("still requires the requested class to belong to the exact course", async () => {
    const { response, getStatements } = await query("teacher-class-insights", owner.toLowerCase(), "other-course");
    expect(response.status).toBe(403);
    expect(getStatements).not.toHaveBeenCalled();
  });

  it("still denies a learner profile after the learner's membership is removed", async () => {
    await setTeachingClassMembershipStatus({ dataDir, actorId: owner, classId, membershipId, membershipStatus: "removed" });
    const { response, getStatements } = await query("learner-profile");
    expect(response.status).toBe(403);
    expect(getStatements).not.toHaveBeenCalled();
  });
});
