import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorizeLearningAiGuideCourseAccess } from "@/lib/server/learning-ai-guide-access";
import { authorizeLearningPptPlaybackAccess } from "@/lib/server/learning-ppt-playback-access";
import { createUaisAppSessionCookie } from "@/lib/server/uais-app-session";
import {
  approveTeachingClassMembership,
  createTeachingClassRecord,
  createTeachingCourseRecord,
  joinTeachingClassByInviteCode,
  setTeachingClassMembershipStatus,
} from "@/lib/server/teaching-course-management-store";

const owner = "FixtureTeacher";
const studentId = "fixture-student";
const now = new Date("2026-09-20T01:00:00.000Z");
const secret = "synthetic-learning-membership-app-secret";

describe("learning access after membership changes", () => {
  let dataDir: string;
  let courseId: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "uais-learning-membership-"));
    const { course } = await createTeachingCourseRecord({
      dataDir,
      actorId: owner,
      now,
      draft: { name: "Access fixture", instructor: "Fixture Teacher", unit: "Fixture", department: "Fixture", semester: "2026 Fall" },
    });
    courseId = course.courseId;
  });
  afterEach(async () => { await rm(dataDir, { recursive: true, force: true }); });

  async function joinClass(className: string, teacherId = owner) {
    const { classItem } = await createTeachingClassRecord({
      dataDir, actorId: teacherId, courseId, now, draft: { className },
    });
    const { membership } = await joinTeachingClassByInviteCode({
      dataDir, now,
      join: { invitationCode: classItem.invitationCode, studentId, studentDisplayName: "Fixture Student" },
    });
    return { dataDir, actorId: teacherId, classId: classItem.classId, membershipId: membership.membershipId, now };
  }

  async function readAccess() {
    const env = { UAIS_TEACHING_COURSES_DATA_DIR: dataDir, UAIS_APP_SESSION_SIGNING_SECRET: secret };
    const cookie = createUaisAppSessionCookie({ account: studentId, role: "student", displayName: "Fixture Student", department: "Fixture" }, { secret, now });
    const [playback, guide] = await Promise.all([
      authorizeLearningPptPlaybackAccess({
        request: new Request("http://localhost/api/learning/fixture", { headers: { cookie } }),
        env, courseId, now,
      }),
      authorizeLearningAiGuideCourseAccess({ appSession: { account: studentId, role: "student" }, env, courseId }),
    ]);
    return { playback, guide };
  }

  it.each(["rejected", "removed"] as const)(
    "uses the approved new class rather than a retained %s membership",
    async (membershipStatus) => {
      const first = await joinClass("First class");
      if (membershipStatus === "removed") await approveTeachingClassMembership(first);
      await setTeachingClassMembershipStatus({ ...first, membershipStatus });
      const second = await joinClass("Second class");
      expect(await readAccess()).toMatchObject({ playback: { status: "denied" }, guide: { status: "denied" } });

      await approveTeachingClassMembership(second);
      expect(await readAccess()).toMatchObject({
        playback: { status: "authorized", classId: second.classId, membershipId: second.membershipId },
        guide: { status: "authorized", membershipId: second.membershipId },
      });

      await setTeachingClassMembershipStatus({ ...second, membershipStatus: "removed" });
      expect(await readAccess()).toMatchObject({ playback: { status: "denied" }, guide: { status: "denied" } });
    },
  );

  it("authorizes a class created by its canonical owner's differently cased account", async () => {
    const membership = await joinClass("Mixed-case class", owner.toLowerCase());
    await approveTeachingClassMembership(membership);
    expect(await readAccess()).toMatchObject({
      playback: { status: "authorized", classId: membership.classId },
      guide: { status: "authorized" },
    });
  });
});
