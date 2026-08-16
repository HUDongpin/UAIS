import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLearningChatroomHistoryGetHandler } from "@/app/api/learning/chatroom/route";
import { createTeachingCourseGetHandler } from "@/app/api/teaching/courses/route";
import { createTeachingClassMembershipPatchHandler } from "@/app/api/teaching/classes/[classId]/memberships/[membershipId]/route";
import { createTeachingLearningGroupPostHandler } from "@/app/api/teaching/courses/[courseId]/groups/route";
import { createTeachingLearningGroupAutoSplitPostHandler } from "@/app/api/teaching/courses/[courseId]/groups/auto-split/route";
import {
  createTeachingLearningGroupDeleteHandler,
  createTeachingLearningGroupPatchHandler,
} from "@/app/api/teaching/courses/[courseId]/groups/[groupId]/route";
import { type UaisAppSessionUser } from "@/lib/auth/uais-app-session";
import { isLearningChatroomGroupsEnabled } from "@/lib/server/learning-chatroom-groups-flag";
import { createUaisAppSessionCookie } from "@/lib/server/uais-app-session";
import { createUaisTeacherAuthSessionCookieHeader } from "@/lib/server/teacher-auth-session";
import {
  approveTeachingClassMembership,
  createTeachingClassRecord,
  createTeachingCourseRecord,
  joinTeachingClassByInviteCode,
  normalizeTeachingCourseManagementDatabase,
  readTeachingCourseManagementDatabase,
  type TeachingCourseManagementDatabase,
} from "@/lib/server/teaching-course-management-store";

// Phase 1 learning-group acceptance suite (chatroom groups). House harness:
// DI handler factories, signed test cookies, mkdtemp fixtures, injected clocks,
// no real env and no sleeps. Every new response family is swept for credential
// and local-path values.

const teacherAuthSecret = "test-learning-group-session-signing-secret";
const appSessionSecret = "test-learning-group-app-session-signing-secret";
const ownerTeacherId = "teacher-kang";
const foreignTeacherId = "teacher-other";

const seedNow = new Date("2026-08-08T01:00:00.000Z");
const groupCreatedNow = new Date("2026-08-08T02:00:00.000Z");
const groupUpdatedNow = new Date("2026-08-08T03:00:00.000Z");

// The student-visible group projection is the whole point of the narrowing: a
// member's `studentId` is another student's account id and must never appear.
const studentVisibleGroupKeys = ["groupId", "courseId", "classId", "groupName", "members"].sort();
const studentVisibleGroupMemberKeys = ["displayName", "isSelf"].sort();

type SeedStudent = {
  studentId: string;
  displayName: string;
  approve?: boolean;
};

function createTeacherCookie(actorId = ownerTeacherId) {
  return createUaisTeacherAuthSessionCookieHeader({
    secret: teacherAuthSecret,
    claims: {
      sessionId: `${actorId}-learning-group-session`,
      actorId,
      role: "teacher",
      authenticatedAt: "2026-08-08T00:00:00.000Z",
      expiresAt: "2026-08-08T12:00:00.000Z",
    },
  });
}

function createAppSessionCookie(user: UaisAppSessionUser) {
  return createUaisAppSessionCookie(user, {
    secret: appSessionSecret,
    sessionId: `${user.account}-learning-group-session`,
    now: seedNow,
  });
}

function createStudentCookie(account: string, displayName = account) {
  return createAppSessionCookie({
    account,
    department: "学生账号",
    displayName,
    role: "student",
  });
}

function createAdminCookie(account = "Admin") {
  return createAppSessionCookie({
    account,
    department: "管理员账号",
    displayName: account,
    role: "admin",
  });
}

// Teacher group CRUD is flag-independent by design (plan D9: only the UI hides
// while groups ship dark), but the student projection and the reported feature
// state are not, so the suite's default env is a groups-on deployment. Flag-off
// behaviour is pinned explicitly in the feature-surface tests below. Passing
// `null` models a deployment that never set the variable at all.
function createLearningGroupEnv(dataDir: string, groupsMode: string | null = "on") {
  return {
    UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
    UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
    ...(groupsMode === null ? {} : { UAIS_LEARNING_CHATROOM_GROUPS_MODE: groupsMode }),
  };
}

function expectNoCredentialValues(value: unknown, dataDir: string) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(dataDir);
  expect(serialized).not.toContain("/Users/");
  expect(serialized).not.toContain(teacherAuthSecret);
  expect(serialized).not.toContain(appSessionSecret);
}

async function seedTeachingCourseFixture(input: {
  dataDir: string;
  teacherId?: string;
  courseName?: string;
  students?: SeedStudent[];
  now?: Date;
}) {
  const teacherId = input.teacherId ?? ownerTeacherId;
  const now = input.now ?? seedNow;
  const { course } = await createTeachingCourseRecord({
    dataDir: input.dataDir,
    actorId: teacherId,
    draft: {
      name: input.courseName ?? "University Research Methods",
      instructor: "Kang Xia",
      unit: "Guangzhou University 404",
      department: "Experimental Teaching Center",
      semester: "2026 Spring",
    },
    now,
  });
  const { classItem } = await createTeachingClassRecord({
    dataDir: input.dataDir,
    actorId: teacherId,
    courseId: course.courseId,
    draft: { className: `${course.courseId}-class-alpha` },
    now,
  });

  for (const student of input.students ?? []) {
    const { membership } = await joinTeachingClassByInviteCode({
      dataDir: input.dataDir,
      join: {
        invitationCode: classItem.invitationCode,
        studentId: student.studentId,
        studentDisplayName: student.displayName,
      },
      now,
    });
    if (student.approve !== false) {
      await approveTeachingClassMembership({
        dataDir: input.dataDir,
        actorId: teacherId,
        classId: classItem.classId,
        membershipId: membership.membershipId,
        now,
      });
    }
  }

  return { teacherId, course, classItem };
}

function postGroupRequest(input: {
  courseId: string;
  cookie?: string;
  body: unknown;
}) {
  return [
    new Request(`https://www.uais.top/api/teaching/courses/${input.courseId}/groups`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(input.cookie ? { cookie: input.cookie } : {}),
      },
      body: JSON.stringify(input.body),
    }),
    { params: Promise.resolve({ courseId: input.courseId }) },
  ] as const;
}

function patchGroupRequest(input: {
  courseId: string;
  groupId: string;
  cookie?: string;
  body: unknown;
}) {
  return [
    new Request(
      `https://www.uais.top/api/teaching/courses/${input.courseId}/groups/${input.groupId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          ...(input.cookie ? { cookie: input.cookie } : {}),
        },
        body: JSON.stringify(input.body),
      },
    ),
    { params: Promise.resolve({ courseId: input.courseId, groupId: input.groupId }) },
  ] as const;
}

function autoSplitRequest(input: {
  courseId: string;
  cookie?: string;
  body: unknown;
}) {
  return [
    new Request(
      `https://www.uais.top/api/teaching/courses/${input.courseId}/groups/auto-split`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(input.cookie ? { cookie: input.cookie } : {}),
        },
        body: JSON.stringify(input.body),
      },
    ),
    { params: Promise.resolve({ courseId: input.courseId }) },
  ] as const;
}

// Zero-padded so the candidate order the split reports is the order these were
// seeded in: every fixture student shares one `joinedAt`, so the tie-break is the
// student id.
function createSeedStudents(count: number): SeedStudent[] {
  return Array.from({ length: count }, (_unused, index) => ({
    studentId: `student-${String(index + 1).padStart(2, "0")}`,
    displayName: `学生${index + 1}`,
  }));
}

function deleteGroupRequest(input: {
  courseId: string;
  groupId: string;
  cookie?: string;
}) {
  return [
    new Request(
      `https://www.uais.top/api/teaching/courses/${input.courseId}/groups/${input.groupId}`,
      {
        method: "DELETE",
        headers: input.cookie ? { cookie: input.cookie } : {},
      },
    ),
    { params: Promise.resolve({ courseId: input.courseId, groupId: input.groupId }) },
  ] as const;
}

async function withDataDir(name: string, run: (dataDir: string) => Promise<void>) {
  const dataDir = await mkdtemp(join(tmpdir(), `uais-learning-group-${name}-`));
  try {
    await run(dataDir);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}

describe("teaching learning group API", () => {
  it("creates a group for approved members and persists a receipt plus audit event", async () => {
    await withDataDir("create", async (dataDir) => {
      const env = createLearningGroupEnv(dataDir);
      const { course, classItem } = await seedTeachingCourseFixture({
        dataDir,
        students: [
          { studentId: "student-lin", displayName: "林若晨" },
          { studentId: "student-zhao", displayName: "赵一鸣" },
        ],
      });
      const postGroup = createTeachingLearningGroupPostHandler({
        env,
        now: groupCreatedNow,
      });

      const response = await postGroup(
        ...postGroupRequest({
          courseId: course.courseId,
          cookie: createTeacherCookie(),
          body: {
            groupName: "Group 3",
            classId: classItem.classId,
            members: ["student-lin", { studentId: "student-zhao" }],
          },
        }),
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(201);
      expect(body.group).toEqual({
        groupId: "group-group-3-20260808-020000",
        courseId: course.courseId,
        classId: classItem.classId,
        ownerTeacherId: ownerTeacherId,
        groupName: "Group 3",
        members: [
          {
            studentId: "student-lin",
            studentDisplayName: "林若晨",
            addedAt: groupCreatedNow.toISOString(),
          },
          {
            studentId: "student-zhao",
            studentDisplayName: "赵一鸣",
            addedAt: groupCreatedNow.toISOString(),
          },
        ],
        createdAt: groupCreatedNow.toISOString(),
        updatedAt: groupCreatedNow.toISOString(),
        storagePolicy: "local-json-teaching-course-management",
        storageWritePolicy: "atomic-json-file-replace",
        responsibleSession: "S12",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      });
      expect(body.receipt).toEqual(
        expect.objectContaining({
          action: "create-learning-group",
          actorId: ownerTeacherId,
          courseId: course.courseId,
          classId: classItem.classId,
          status: "persisted",
          responsibleSession: "S12",
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
          createdAt: groupCreatedNow.toISOString(),
        }),
      );
      expectNoCredentialValues(body, dataDir);

      const database = await readTeachingCourseManagementDatabase({ dataDir });
      expect(database.learningGroups).toHaveLength(1);
      expect(database.updatedAt).toBe(groupCreatedNow.toISOString());
      expect(
        database.auditEvents.filter((event) => event.action === "create-learning-group"),
      ).toEqual([
        expect.objectContaining({
          action: "create-learning-group",
          actorId: ownerTeacherId,
          courseId: course.courseId,
          classId: classItem.classId,
          actorRole: "teacher",
          authMode: "signed-teacher-session",
          createdAt: groupCreatedNow.toISOString(),
        }),
      ]);
    });
  });

  it("creates a course-scoped group when no class id is supplied", async () => {
    await withDataDir("course-scoped", async (dataDir) => {
      const env = createLearningGroupEnv(dataDir);
      const { course } = await seedTeachingCourseFixture({
        dataDir,
        students: [
          { studentId: "student-lin", displayName: "林若晨" },
          { studentId: "student-zhao", displayName: "赵一鸣" },
        ],
      });
      const postGroup = createTeachingLearningGroupPostHandler({
        env,
        now: groupCreatedNow,
      });

      const response = await postGroup(
        ...postGroupRequest({
          courseId: course.courseId,
          cookie: createTeacherCookie(),
          body: { groupName: "无班级分组", members: ["student-lin", "student-zhao"] },
        }),
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(201);
      // A non-latin name still yields a safe, bounded id via the slug fallback.
      expect(body.group.groupId).toBe("group-learning-20260808-020000");
      expect(body.group.classId).toBeUndefined();
      expectNoCredentialValues(body, dataDir);
    });
  });

  it("truncates an over-long group name to the 120 character bound", async () => {
    await withDataDir("name-bound", async (dataDir) => {
      const env = createLearningGroupEnv(dataDir);
      const { course } = await seedTeachingCourseFixture({
        dataDir,
        students: [
          { studentId: "student-lin", displayName: "林若晨" },
          { studentId: "student-zhao", displayName: "赵一鸣" },
        ],
      });
      const postGroup = createTeachingLearningGroupPostHandler({
        env,
        now: groupCreatedNow,
      });

      const response = await postGroup(
        ...postGroupRequest({
          courseId: course.courseId,
          cookie: createTeacherCookie(),
          body: {
            groupName: "G".repeat(400),
            members: ["student-lin", "student-zhao"],
          },
        }),
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(201);
      expect(body.group.groupName).toHaveLength(120);
    });
  });

  it("replaces members and renames in one PATCH, keeping the original addedAt of retained members", async () => {
    await withDataDir("patch", async (dataDir) => {
      const env = createLearningGroupEnv(dataDir);
      const { course, classItem } = await seedTeachingCourseFixture({
        dataDir,
        students: [
          { studentId: "student-lin", displayName: "林若晨" },
          { studentId: "student-zhao", displayName: "赵一鸣" },
          { studentId: "student-wu", displayName: "吴思远" },
        ],
      });
      const postGroup = createTeachingLearningGroupPostHandler({
        env,
        now: groupCreatedNow,
      });
      const patchGroup = createTeachingLearningGroupPatchHandler({
        env,
        now: groupUpdatedNow,
      });

      const created = await (
        await postGroup(
          ...postGroupRequest({
            courseId: course.courseId,
            cookie: createTeacherCookie(),
            body: {
              groupName: "Group 3",
              classId: classItem.classId,
              members: ["student-lin", "student-zhao"],
            },
          }),
        )
      ).json();

      const response = await patchGroup(
        ...patchGroupRequest({
          courseId: course.courseId,
          groupId: created.group.groupId,
          cookie: createTeacherCookie(),
          body: {
            groupName: "Group 3 — Renamed",
            members: ["student-lin", "student-wu"],
          },
        }),
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body.group.groupName).toBe("Group 3 — Renamed");
      expect(body.group.updatedAt).toBe(groupUpdatedNow.toISOString());
      expect(body.group.createdAt).toBe(groupCreatedNow.toISOString());
      expect(body.group.members).toEqual([
        {
          studentId: "student-lin",
          studentDisplayName: "林若晨",
          // Retained members keep their original assignment stamp.
          addedAt: groupCreatedNow.toISOString(),
        },
        {
          studentId: "student-wu",
          studentDisplayName: "吴思远",
          addedAt: groupUpdatedNow.toISOString(),
        },
      ]);
      expect(body.receipts.map((receipt: { action: string }) => receipt.action)).toEqual([
        "update-learning-group-members",
        "rename-learning-group",
      ]);
      expect(body.receipt.action).toBe("rename-learning-group");
      expectNoCredentialValues(body, dataDir);

      const database = await readTeachingCourseManagementDatabase({ dataDir });
      expect(
        database.auditEvents.map((event) => event.action).filter((action) => action.includes("group")),
      ).toEqual([
        "create-learning-group",
        "update-learning-group-members",
        "rename-learning-group",
      ]);
    });
  });

  it("rejects a PATCH that carries neither a name nor a member list", async () => {
    await withDataDir("patch-empty", async (dataDir) => {
      const env = createLearningGroupEnv(dataDir);
      const { course } = await seedTeachingCourseFixture({
        dataDir,
        students: [
          { studentId: "student-lin", displayName: "林若晨" },
          { studentId: "student-zhao", displayName: "赵一鸣" },
        ],
      });
      const postGroup = createTeachingLearningGroupPostHandler({ env, now: groupCreatedNow });
      const patchGroup = createTeachingLearningGroupPatchHandler({ env, now: groupUpdatedNow });
      const created = await (
        await postGroup(
          ...postGroupRequest({
            courseId: course.courseId,
            cookie: createTeacherCookie(),
            body: { groupName: "Group 3", members: ["student-lin", "student-zhao"] },
          }),
        )
      ).json();

      const response = await patchGroup(
        ...patchGroupRequest({
          courseId: course.courseId,
          groupId: created.group.groupId,
          cookie: createTeacherCookie(),
          body: { note: "nothing to apply" },
        }),
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(body.error).toBe("Learning group update requires a name or a member list.");
    });
  });

  it("deletes a group, keeps the audit trail, and reports the deleted record", async () => {
    await withDataDir("delete", async (dataDir) => {
      const env = createLearningGroupEnv(dataDir);
      const { course } = await seedTeachingCourseFixture({
        dataDir,
        students: [
          { studentId: "student-lin", displayName: "林若晨" },
          { studentId: "student-zhao", displayName: "赵一鸣" },
        ],
      });
      const postGroup = createTeachingLearningGroupPostHandler({ env, now: groupCreatedNow });
      const deleteGroup = createTeachingLearningGroupDeleteHandler({
        env,
        now: groupUpdatedNow,
      });
      const created = await (
        await postGroup(
          ...postGroupRequest({
            courseId: course.courseId,
            cookie: createTeacherCookie(),
            body: { groupName: "Group 3", members: ["student-lin", "student-zhao"] },
          }),
        )
      ).json();

      const response = await deleteGroup(
        ...deleteGroupRequest({
          courseId: course.courseId,
          groupId: created.group.groupId,
          cookie: createTeacherCookie(),
        }),
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body.group.groupId).toBe(created.group.groupId);
      expect(body.receipt.action).toBe("delete-learning-group");
      expectNoCredentialValues(body, dataDir);

      const database = await readTeachingCourseManagementDatabase({ dataDir });
      expect(database.learningGroups).toEqual([]);
      expect(
        database.auditEvents.some((event) => event.action === "delete-learning-group"),
      ).toBe(true);

      const repeated = await deleteGroup(
        ...deleteGroupRequest({
          courseId: course.courseId,
          groupId: created.group.groupId,
          cookie: createTeacherCookie(),
        }),
      );
      const repeatedBody = await repeated.json();
      expect(repeated.status, JSON.stringify(repeatedBody)).toBe(404);
      expect(repeatedBody.error).toBe("Teaching learning group was not found.");
    });
  });

  it("refuses a member who already belongs to another group in the same course", async () => {
    await withDataDir("cross-group", async (dataDir) => {
      const env = createLearningGroupEnv(dataDir);
      const { course } = await seedTeachingCourseFixture({
        dataDir,
        students: [
          { studentId: "student-lin", displayName: "林若晨" },
          { studentId: "student-zhao", displayName: "赵一鸣" },
          { studentId: "student-wu", displayName: "吴敏" },
        ],
      });
      const postGroup = createTeachingLearningGroupPostHandler({ env, now: groupCreatedNow });
      const patchGroup = createTeachingLearningGroupPatchHandler({
        env,
        now: groupUpdatedNow,
      });
      const created = await (
        await postGroup(
          ...postGroupRequest({
            courseId: course.courseId,
            cookie: createTeacherCookie(),
            body: { groupName: "第1组", members: ["student-lin", "student-zhao"] },
          }),
        )
      ).json();

      const response = await postGroup(
        ...postGroupRequest({
          courseId: course.courseId,
          cookie: createTeacherCookie(),
          body: { groupName: "第2组", members: ["student-zhao", "student-wu"] },
        }),
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(400);
      // The teacher is told WHICH student and WHICH group, or the message is not
      // actionable on a 200-student roster.
      expect(body.validation).toEqual(
        expect.objectContaining({
          target: "teaching-learning-group",
          status: "invalid",
          reasonCode: "group-member-already-grouped",
          field: "members",
          memberIndex: 0,
          studentId: "student-zhao",
          conflictingGroupId: created.group.groupId,
          conflictingGroupName: "第1组",
        }),
      );
      expectNoCredentialValues(body, dataDir);

      // A member replacement on the SAME group is not a conflict with itself.
      const selfPatch = await patchGroup(
        ...patchGroupRequest({
          courseId: course.courseId,
          groupId: created.group.groupId,
          cookie: createTeacherCookie(),
          body: { members: ["student-lin", "student-zhao", "student-wu"] },
        }),
      );
      const selfPatchBody = await selfPatch.json();
      expect(selfPatch.status, JSON.stringify(selfPatchBody)).toBe(200);
      expect(selfPatchBody.group.members.map((member: { studentId: string }) => member.studentId))
        .toEqual(["student-lin", "student-zhao", "student-wu"]);

      const database = await readTeachingCourseManagementDatabase({ dataDir });
      expect(database.learningGroups).toHaveLength(1);
    });
  });

  it("auto-splits ungrouped approved students into deterministic 第N组 groups", async () => {
    await withDataDir("auto-split", async (dataDir) => {
      const env = createLearningGroupEnv(dataDir);
      const { course, classItem } = await seedTeachingCourseFixture({
        dataDir,
        students: createSeedStudents(9),
      });
      const autoSplit = createTeachingLearningGroupAutoSplitPostHandler({
        env,
        now: groupCreatedNow,
      });

      const response = await autoSplit(
        ...autoSplitRequest({
          courseId: course.courseId,
          cookie: createTeacherCookie(),
          body: { groupSize: 4, classId: classItem.classId },
        }),
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(201);
      // 9 students at 4 per group is 4 + 4 + 1, and a group of one is never left
      // standing: the remainder folds into the previous group.
      expect(
        body.groups.map((group: { groupName: string; members: unknown[] }) => [
          group.groupName,
          group.members.length,
        ]),
      ).toEqual([
        ["第1组", 4],
        ["第2组", 5],
      ]);
      expect(body.groupCount).toBe(2);
      expect(body.ungroupedStudentCount).toBe(0);
      expect(body.receipt.action).toBe("auto-split-learning-groups");
      expect(new Set(body.groups.map((group: { groupId: string }) => group.groupId)).size).toBe(2);
      expectNoCredentialValues(body, dataDir);

      const database = await readTeachingCourseManagementDatabase({ dataDir });
      expect(database.learningGroups).toHaveLength(2);
      expect(
        database.auditEvents.filter((event) => event.action === "auto-split-learning-groups"),
      ).toEqual([
        expect.objectContaining({
          action: "auto-split-learning-groups",
          courseId: course.courseId,
          classId: classItem.classId,
          // One event for the whole split, carrying the count rather than
          // pretending two separate teacher decisions happened.
          affectedRecordCount: 2,
        }),
      ]);

      // A second split continues the series instead of minting another 第1组, and
      // finds nobody left to group.
      const repeated = await autoSplit(
        ...autoSplitRequest({
          courseId: course.courseId,
          cookie: createTeacherCookie(),
          body: { groupSize: 4 },
        }),
      );
      const repeatedBody = await repeated.json();
      expect(repeated.status, JSON.stringify(repeatedBody)).toBe(400);
      expect(repeatedBody.validation).toEqual(
        expect.objectContaining({
          reasonCode: "auto-split-no-eligible-students",
          field: "members",
          eligibleStudentCount: 0,
        }),
      );
    });
  });

  it("auto-splits fewer ungrouped students than the group size into one group", async () => {
    await withDataDir("auto-split-small", async (dataDir) => {
      const env = createLearningGroupEnv(dataDir);
      const { course } = await seedTeachingCourseFixture({
        dataDir,
        students: createSeedStudents(3),
      });
      const autoSplit = createTeachingLearningGroupAutoSplitPostHandler({
        env,
        now: groupCreatedNow,
      });

      const response = await autoSplit(
        ...autoSplitRequest({
          courseId: course.courseId,
          cookie: createTeacherCookie(),
          body: { groupSize: 6 },
        }),
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(201);
      expect(body.groups).toHaveLength(1);
      expect(body.groups[0].groupName).toBe("第1组");
      expect(body.groups[0].members).toHaveLength(3);
      // A course-wide split records no class id, because it spans them.
      expect(body.groups[0].classId).toBeUndefined();
    });
  });

  it("keeps auto-split inside the 2..12 member bounds when the size is at the ceiling", async () => {
    await withDataDir("auto-split-ceiling", async (dataDir) => {
      const env = createLearningGroupEnv(dataDir);
      const { course } = await seedTeachingCourseFixture({
        dataDir,
        students: createSeedStudents(13),
      });
      const autoSplit = createTeachingLearningGroupAutoSplitPostHandler({
        env,
        now: groupCreatedNow,
      });

      const response = await autoSplit(
        ...autoSplitRequest({
          courseId: course.courseId,
          cookie: createTeacherCookie(),
          body: { groupSize: 12 },
        }),
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(201);
      // Folding 12 + 1 would break the ceiling, so the previous group lends a
      // member downwards instead: both groups stay inside 2..12.
      expect(body.groups.map((group: { members: unknown[] }) => group.members.length)).toEqual([
        11, 2,
      ]);

      const oversized = await autoSplit(
        ...autoSplitRequest({
          courseId: course.courseId,
          cookie: createTeacherCookie(),
          body: { groupSize: 13 },
        }),
      );
      const oversizedBody = await oversized.json();
      expect(oversized.status, JSON.stringify(oversizedBody)).toBe(400);
    });
  });

  it("frees a removed student's group seats in the write that closes the membership", async () => {
    await withDataDir("removed-frees-groups", async (dataDir) => {
      const env = createLearningGroupEnv(dataDir);
      const { course, classItem } = await seedTeachingCourseFixture({
        dataDir,
        students: [
          { studentId: "student-lin", displayName: "林若晨" },
          { studentId: "student-zhao", displayName: "赵一鸣" },
          { studentId: "student-wu", displayName: "吴敏" },
        ],
      });
      const postGroup = createTeachingLearningGroupPostHandler({ env, now: groupCreatedNow });
      const patchMembership = createTeachingClassMembershipPatchHandler({
        env,
        now: groupUpdatedNow,
      });
      const created = await (
        await postGroup(
          ...postGroupRequest({
            courseId: course.courseId,
            cookie: createTeacherCookie(),
            body: {
              groupName: "第1组",
              members: ["student-lin", "student-zhao", "student-wu"],
            },
          }),
        )
      ).json();

      const membershipId = `membership-${classItem.classId}-student-zhao`;
      const response = await patchMembership(
        new Request(
          `https://www.uais.top/api/teaching/classes/${classItem.classId}/memberships/${membershipId}`,
          {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
              cookie: createTeacherCookie(),
            },
            body: JSON.stringify({ membershipStatus: "removed" }),
          },
        ),
        {
          params: Promise.resolve({ classId: classItem.classId, membershipId }),
        },
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body.membership.membershipStatus).toBe("removed");
      expect(body.membership.statusChangedByTeacherId).toBe(ownerTeacherId);
      expect(body.releasedGroupIds).toEqual([created.group.groupId]);
      expect(body.classItem.students).toBe(2);
      expect(body.course.students).toBe(2);
      expectNoCredentialValues(body, dataDir);

      const database = await readTeachingCourseManagementDatabase({ dataDir });
      expect(
        database.learningGroups?.[0].members.map((member) => member.studentId),
      ).toEqual(["student-lin", "student-wu"]);
      expect(
        database.auditEvents.some((event) => event.action === "remove-class-membership"),
      ).toBe(true);
    });
  });

  it("denies a foreign teacher on create, update, and delete", async () => {
    await withDataDir("ownership", async (dataDir) => {
      const env = createLearningGroupEnv(dataDir);
      const { course } = await seedTeachingCourseFixture({
        dataDir,
        students: [
          { studentId: "student-lin", displayName: "林若晨" },
          { studentId: "student-zhao", displayName: "赵一鸣" },
        ],
      });
      const postGroup = createTeachingLearningGroupPostHandler({ env, now: groupCreatedNow });
      const patchGroup = createTeachingLearningGroupPatchHandler({ env, now: groupUpdatedNow });
      const deleteGroup = createTeachingLearningGroupDeleteHandler({
        env,
        now: groupUpdatedNow,
      });
      const created = await (
        await postGroup(
          ...postGroupRequest({
            courseId: course.courseId,
            cookie: createTeacherCookie(),
            body: { groupName: "Group 3", members: ["student-lin", "student-zhao"] },
          }),
        )
      ).json();

      const deniedCreate = await postGroup(
        ...postGroupRequest({
          courseId: course.courseId,
          cookie: createTeacherCookie(foreignTeacherId),
          body: { groupName: "Hijack", members: ["student-lin", "student-zhao"] },
        }),
      );
      const deniedCreateBody = await deniedCreate.json();
      expect(deniedCreate.status, JSON.stringify(deniedCreateBody)).toBe(403);
      expect(deniedCreateBody.access).toEqual(
        expect.objectContaining({
          status: "denied",
          reasonCode: "teacher-course-ownership-required",
          responsibleSession: "S12",
        }),
      );

      const deniedPatch = await patchGroup(
        ...patchGroupRequest({
          courseId: course.courseId,
          groupId: created.group.groupId,
          cookie: createTeacherCookie(foreignTeacherId),
          body: { groupName: "Hijack" },
        }),
      );
      expect(deniedPatch.status).toBe(403);

      const deniedDelete = await deleteGroup(
        ...deleteGroupRequest({
          courseId: course.courseId,
          groupId: created.group.groupId,
          cookie: createTeacherCookie(foreignTeacherId),
        }),
      );
      expect(deniedDelete.status).toBe(403);

      const database = await readTeachingCourseManagementDatabase({ dataDir });
      expect(database.learningGroups).toHaveLength(1);
      expect(database.learningGroups?.[0].groupName).toBe("Group 3");
    });
  });

  it("denies student and admin app sessions and unauthenticated callers", async () => {
    await withDataDir("roles", async (dataDir) => {
      const env = createLearningGroupEnv(dataDir);
      const { course } = await seedTeachingCourseFixture({
        dataDir,
        students: [
          { studentId: "student-lin", displayName: "林若晨" },
          { studentId: "student-zhao", displayName: "赵一鸣" },
        ],
      });
      const postGroup = createTeachingLearningGroupPostHandler({ env, now: groupCreatedNow });
      const body = { groupName: "Group 3", members: ["student-lin", "student-zhao"] };

      const studentResponse = await postGroup(
        ...postGroupRequest({
          courseId: course.courseId,
          cookie: createStudentCookie("student-lin", "林若晨"),
          body,
        }),
      );
      const studentBody = await studentResponse.json();
      expect(studentResponse.status, JSON.stringify(studentBody)).toBe(403);
      expect(studentBody.access.reasonCode).toBe("teacher-role-required");

      const adminResponse = await postGroup(
        ...postGroupRequest({
          courseId: course.courseId,
          cookie: createAdminCookie(),
          body,
        }),
      );
      const adminBody = await adminResponse.json();
      expect(adminResponse.status, JSON.stringify(adminBody)).toBe(403);
      expect(adminBody.access.reasonCode).toBe("teacher-role-required");

      const anonymousResponse = await postGroup(
        ...postGroupRequest({ courseId: course.courseId, body }),
      );
      const anonymousBody = await anonymousResponse.json();
      expect(anonymousResponse.status, JSON.stringify(anonymousBody)).toBe(401);
      expect(anonymousBody.access.reasonCode).toBe("authenticated-session-required");

      const database = await readTeachingCourseManagementDatabase({ dataDir });
      expect(database.learningGroups).toBeUndefined();
    });
  });

  it("rejects members without an approved membership in the course", async () => {
    await withDataDir("not-approved", async (dataDir) => {
      const env = createLearningGroupEnv(dataDir);
      const { course } = await seedTeachingCourseFixture({
        dataDir,
        students: [
          { studentId: "student-lin", displayName: "林若晨" },
          { studentId: "student-pending", displayName: "待审核同学", approve: false },
        ],
      });
      const postGroup = createTeachingLearningGroupPostHandler({ env, now: groupCreatedNow });

      const pendingResponse = await postGroup(
        ...postGroupRequest({
          courseId: course.courseId,
          cookie: createTeacherCookie(),
          body: { groupName: "Group 3", members: ["student-lin", "student-pending"] },
        }),
      );
      const pendingBody = await pendingResponse.json();
      expect(pendingResponse.status, JSON.stringify(pendingBody)).toBe(400);
      expect(pendingBody.validation).toEqual(
        expect.objectContaining({
          target: "teaching-learning-group",
          status: "invalid",
          reasonCode: "group-member-not-approved",
          field: "members",
          memberIndex: 1,
          responsibleSession: "S12",
        }),
      );

      const strangerResponse = await postGroup(
        ...postGroupRequest({
          courseId: course.courseId,
          cookie: createTeacherCookie(),
          body: { groupName: "Group 3", members: ["student-lin", "student-stranger"] },
        }),
      );
      const strangerBody = await strangerResponse.json();
      expect(strangerResponse.status, JSON.stringify(strangerBody)).toBe(400);
      expect(strangerBody.validation.reasonCode).toBe("group-member-not-approved");

      const database = await readTeachingCourseManagementDatabase({ dataDir });
      expect(database.learningGroups).toBeUndefined();
    });
  });

  it("rejects a member approved in a different class than the class-scoped group", async () => {
    await withDataDir("class-scope", async (dataDir) => {
      const env = createLearningGroupEnv(dataDir);
      const { course, classItem } = await seedTeachingCourseFixture({
        dataDir,
        students: [
          { studentId: "student-lin", displayName: "林若晨" },
          { studentId: "student-zhao", displayName: "赵一鸣" },
        ],
      });
      // A second class in the same course; its members are approved in the course
      // but not in `classItem`, so a class-scoped group must refuse them.
      const { classItem: otherClass } = await createTeachingClassRecord({
        dataDir,
        actorId: ownerTeacherId,
        courseId: course.courseId,
        draft: { className: `${course.courseId}-class-beta` },
        now: seedNow,
      });
      const { membership } = await joinTeachingClassByInviteCode({
        dataDir,
        join: {
          invitationCode: otherClass.invitationCode,
          studentId: "student-other-class",
          studentDisplayName: "另一班同学",
        },
        now: seedNow,
      });
      await approveTeachingClassMembership({
        dataDir,
        actorId: ownerTeacherId,
        classId: otherClass.classId,
        membershipId: membership.membershipId,
        now: seedNow,
      });
      const postGroup = createTeachingLearningGroupPostHandler({ env, now: groupCreatedNow });

      const denied = await postGroup(
        ...postGroupRequest({
          courseId: course.courseId,
          cookie: createTeacherCookie(),
          body: {
            groupName: "Group 3",
            classId: classItem.classId,
            members: ["student-lin", "student-other-class"],
          },
        }),
      );
      const deniedBody = await denied.json();
      expect(denied.status, JSON.stringify(deniedBody)).toBe(400);
      expect(deniedBody.validation.reasonCode).toBe("group-member-not-approved");

      // The same student is accepted by a course-scoped group.
      const allowed = await postGroup(
        ...postGroupRequest({
          courseId: course.courseId,
          cookie: createTeacherCookie(),
          body: {
            groupName: "Course Wide",
            members: ["student-lin", "student-other-class"],
          },
        }),
      );
      const allowedBody = await allowed.json();
      expect(allowed.status, JSON.stringify(allowedBody)).toBe(201);
      expect(allowedBody.group.members.map((member: { studentId: string }) => member.studentId)).toEqual([
        "student-lin",
        "student-other-class",
      ]);
    });
  });

  it("enforces the 2..12 member bounds and rejects duplicate members", async () => {
    await withDataDir("bounds", async (dataDir) => {
      const env = createLearningGroupEnv(dataDir);
      const students: SeedStudent[] = Array.from({ length: 13 }, (_, index) => ({
        studentId: `student-${index + 1}`,
        displayName: `学生 ${index + 1}`,
      }));
      const { course } = await seedTeachingCourseFixture({ dataDir, students });
      const postGroup = createTeachingLearningGroupPostHandler({ env, now: groupCreatedNow });

      const tooFew = await postGroup(
        ...postGroupRequest({
          courseId: course.courseId,
          cookie: createTeacherCookie(),
          body: { groupName: "Group 3", members: ["student-1"] },
        }),
      );
      const tooFewBody = await tooFew.json();
      expect(tooFew.status, JSON.stringify(tooFewBody)).toBe(400);
      expect(tooFewBody.validation).toEqual(
        expect.objectContaining({
          reasonCode: "group-members-below-minimum",
          field: "members",
          minMembers: 2,
        }),
      );

      const tooMany = await postGroup(
        ...postGroupRequest({
          courseId: course.courseId,
          cookie: createTeacherCookie(),
          body: {
            groupName: "Group 3",
            members: students.map((student) => student.studentId),
          },
        }),
      );
      const tooManyBody = await tooMany.json();
      expect(tooMany.status, JSON.stringify(tooManyBody)).toBe(400);
      expect(tooManyBody.validation).toEqual(
        expect.objectContaining({
          reasonCode: "group-members-above-maximum",
          field: "members",
          maxMembers: 12,
        }),
      );

      const duplicate = await postGroup(
        ...postGroupRequest({
          courseId: course.courseId,
          cookie: createTeacherCookie(),
          body: { groupName: "Group 3", members: ["student-1", "student-1"] },
        }),
      );
      const duplicateBody = await duplicate.json();
      expect(duplicate.status, JSON.stringify(duplicateBody)).toBe(400);
      expect(duplicateBody.validation).toEqual(
        expect.objectContaining({
          reasonCode: "group-member-duplicate",
          field: "members",
          memberIndex: 1,
        }),
      );

      const exactlyTwelve = await postGroup(
        ...postGroupRequest({
          courseId: course.courseId,
          cookie: createTeacherCookie(),
          body: {
            groupName: "Group 3",
            members: students.slice(0, 12).map((student) => student.studentId),
          },
        }),
      );
      const exactlyTwelveBody = await exactlyTwelve.json();
      expect(exactlyTwelve.status, JSON.stringify(exactlyTwelveBody)).toBe(201);
      expect(exactlyTwelveBody.group.members).toHaveLength(12);
    });
  });

  it("rejects malformed member ids and missing group names", async () => {
    await withDataDir("malformed", async (dataDir) => {
      const env = createLearningGroupEnv(dataDir);
      const { course } = await seedTeachingCourseFixture({
        dataDir,
        students: [
          { studentId: "student-lin", displayName: "林若晨" },
          { studentId: "student-zhao", displayName: "赵一鸣" },
        ],
      });
      const postGroup = createTeachingLearningGroupPostHandler({ env, now: groupCreatedNow });

      const badMember = await postGroup(
        ...postGroupRequest({
          courseId: course.courseId,
          cookie: createTeacherCookie(),
          body: {
            groupName: "Group 3",
            members: ["student-lin", "../../etc/passwd"],
          },
        }),
      );
      const badMemberBody = await badMember.json();
      expect(badMember.status, JSON.stringify(badMemberBody)).toBe(400);
      expect(badMemberBody.validation.reasonCode).toBe("group-member-invalid");

      const missingName = await postGroup(
        ...postGroupRequest({
          courseId: course.courseId,
          cookie: createTeacherCookie(),
          body: { members: ["student-lin", "student-zhao"] },
        }),
      );
      const missingNameBody = await missingName.json();
      expect(missingName.status, JSON.stringify(missingNameBody)).toBe(400);
      expect(missingNameBody.error).toBe("Learning group name is required.");
    });
  });

  it("returns full group records to the owning teacher only", async () => {
    await withDataDir("teacher-get", async (dataDir) => {
      const env = createLearningGroupEnv(dataDir);
      const { course } = await seedTeachingCourseFixture({
        dataDir,
        students: [
          { studentId: "student-lin", displayName: "林若晨" },
          { studentId: "student-zhao", displayName: "赵一鸣" },
        ],
      });
      const postGroup = createTeachingLearningGroupPostHandler({ env, now: groupCreatedNow });
      await postGroup(
        ...postGroupRequest({
          courseId: course.courseId,
          cookie: createTeacherCookie(),
          body: { groupName: "Group 3", members: ["student-lin", "student-zhao"] },
        }),
      );
      const getCourses = createTeachingCourseGetHandler({ env, now: groupUpdatedNow });

      const ownerResponse = await getCourses(
        new Request("https://www.uais.top/api/teaching/courses", {
          headers: { cookie: createTeacherCookie() },
        }),
      );
      const ownerBody = await ownerResponse.json();
      expect(ownerResponse.status, JSON.stringify(ownerBody)).toBe(200);
      expect(ownerBody.learningGroups).toHaveLength(1);
      expect(ownerBody.learningGroups[0]).toEqual(
        expect.objectContaining({
          groupName: "Group 3",
          ownerTeacherId,
          courseId: course.courseId,
        }),
      );
      expectNoCredentialValues(ownerBody, dataDir);

      const foreignResponse = await getCourses(
        new Request("https://www.uais.top/api/teaching/courses", {
          headers: { cookie: createTeacherCookie(foreignTeacherId) },
        }),
      );
      const foreignBody = await foreignResponse.json();
      expect(foreignResponse.status, JSON.stringify(foreignBody)).toBe(200);
      expect(foreignBody.learningGroups).toEqual([]);
    });
  });

  it("narrows the student group projection to the caller's own groups without student ids", async () => {
    await withDataDir("student-get", async (dataDir) => {
      const env = createLearningGroupEnv(dataDir);
      const { course } = await seedTeachingCourseFixture({
        dataDir,
        students: [
          { studentId: "student-lin", displayName: "林若晨" },
          { studentId: "student-zhao", displayName: "赵一鸣" },
          { studentId: "student-wu", displayName: "吴思远" },
          { studentId: "student-he", displayName: "何雨桐" },
        ],
      });
      const postGroup = createTeachingLearningGroupPostHandler({ env, now: groupCreatedNow });
      await postGroup(
        ...postGroupRequest({
          courseId: course.courseId,
          cookie: createTeacherCookie(),
          body: { groupName: "Group 3", members: ["student-lin", "student-zhao"] },
        }),
      );
      const otherGroup = createTeachingLearningGroupPostHandler({
        env,
        now: new Date("2026-08-08T02:30:00.000Z"),
      });
      await otherGroup(
        ...postGroupRequest({
          courseId: course.courseId,
          cookie: createTeacherCookie(),
          body: { groupName: "Group 4", members: ["student-wu", "student-he"] },
        }),
      );
      const getCourses = createTeachingCourseGetHandler({ env, now: seedNow });

      const response = await getCourses(
        new Request("https://www.uais.top/api/teaching/courses", {
          headers: { cookie: createStudentCookie("student-lin", "林若晨") },
        }),
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body.learningGroups).toHaveLength(1);
      const [group] = body.learningGroups as Array<Record<string, unknown>>;
      expect(Object.keys(group).sort()).toEqual(
        studentVisibleGroupKeys.filter((key) => key !== "classId"),
      );
      expect(group.groupName).toBe("Group 3");
      expect(group.members).toEqual([
        { displayName: "林若晨", isSelf: true },
        { displayName: "赵一鸣", isSelf: false },
      ]);
      for (const member of group.members as Array<Record<string, unknown>>) {
        expect(Object.keys(member).sort()).toEqual(studentVisibleGroupMemberKeys);
      }

      // The group projection itself carries NO student id at all — not a
      // co-member's and not the caller's own; identity travels as `isSelf`.
      const serializedGroups = JSON.stringify(body.learningGroups);
      for (const studentId of ["student-lin", "student-zhao", "student-wu", "student-he"]) {
        expect(serializedGroups).not.toContain(studentId);
      }
      // Across the whole payload: no other student's account id, no other group,
      // and no teacher actor id. (The caller's own id legitimately appears in the
      // pre-existing membership projection, which is the caller's own row.)
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain("Group 4");
      expect(serialized).not.toContain("student-zhao");
      expect(serialized).not.toContain("student-wu");
      expect(serialized).not.toContain("student-he");
      expect(serialized).not.toContain(ownerTeacherId);
      expectNoCredentialValues(body, dataDir);

      const nonMemberResponse = await getCourses(
        new Request("https://www.uais.top/api/teaching/courses", {
          headers: { cookie: createStudentCookie("student-outsider", "旁观者") },
        }),
      );
      const nonMemberBody = await nonMemberResponse.json();
      expect(nonMemberResponse.status, JSON.stringify(nonMemberBody)).toBe(200);
      expect(nonMemberBody.learningGroups).toEqual([]);
    });
  });

  it("tells a removed student their class is closed without leaving them a group room", async () => {
    await withDataDir("student-get-removed", async (dataDir) => {
      const env = createLearningGroupEnv(dataDir);
      const { course, classItem } = await seedTeachingCourseFixture({
        dataDir,
        students: [
          { studentId: "student-lin", displayName: "林若晨" },
          { studentId: "student-zhao", displayName: "赵一鸣" },
          { studentId: "student-wu", displayName: "吴思远" },
        ],
      });
      const postGroup = createTeachingLearningGroupPostHandler({ env, now: groupCreatedNow });
      await postGroup(
        ...postGroupRequest({
          courseId: course.courseId,
          cookie: createTeacherCookie(),
          body: {
            groupName: "第1组",
            members: ["student-lin", "student-zhao", "student-wu"],
          },
        }),
      );
      const patchMembership = createTeachingClassMembershipPatchHandler({
        env,
        now: groupUpdatedNow,
      });
      const membershipId = `membership-${classItem.classId}-student-lin`;
      await patchMembership(
        new Request(
          `https://www.uais.top/api/teaching/classes/${classItem.classId}/memberships/${membershipId}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json", cookie: createTeacherCookie() },
            body: JSON.stringify({ membershipStatus: "removed" }),
          },
        ),
        { params: Promise.resolve({ classId: classItem.classId, membershipId }) },
      );

      const getCourses = createTeachingCourseGetHandler({ env, now: seedNow });
      const response = await getCourses(
        new Request("https://www.uais.top/api/teaching/courses", {
          headers: { cookie: createStudentCookie("student-lin", "林若晨") },
        }),
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(200);
      // The row is reported. It used to be filtered out with the approved and
      // pending ones, so the class left the student's dashboard and plaza with
      // nothing anywhere saying why.
      expect(body.memberships).toEqual([
        expect.objectContaining({ membershipId, membershipStatus: "removed" }),
      ]);
      // Named, so the status note has something to name.
      expect(body.courses).toHaveLength(1);
      expect(body.classes).toHaveLength(1);
      // And nothing else. A closed membership widens the course/class NAME
      // projections and nothing derived from belonging: the group projection is
      // keyed to live memberships, so a removed student keeps no room. (The
      // removal already freed the seat; this pins the read side of it too.)
      expect(body.learningGroups).toEqual([]);
      expect(JSON.stringify(body)).not.toContain("第1组");
      expectNoCredentialValues(body, dataDir);
    });
  });

  it("projects the class id when a group is class scoped", async () => {
    await withDataDir("student-get-class", async (dataDir) => {
      const env = createLearningGroupEnv(dataDir);
      const { course, classItem } = await seedTeachingCourseFixture({
        dataDir,
        students: [
          { studentId: "student-lin", displayName: "林若晨" },
          { studentId: "student-zhao", displayName: "赵一鸣" },
        ],
      });
      const postGroup = createTeachingLearningGroupPostHandler({ env, now: groupCreatedNow });
      await postGroup(
        ...postGroupRequest({
          courseId: course.courseId,
          cookie: createTeacherCookie(),
          body: {
            groupName: "Group 3",
            classId: classItem.classId,
            members: ["student-lin", "student-zhao"],
          },
        }),
      );
      const getCourses = createTeachingCourseGetHandler({ env, now: seedNow });

      const response = await getCourses(
        new Request("https://www.uais.top/api/teaching/courses", {
          headers: { cookie: createStudentCookie("student-lin", "林若晨") },
        }),
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(Object.keys(body.learningGroups[0]).sort()).toEqual(studentVisibleGroupKeys);
      expect(body.learningGroups[0].classId).toBe(classItem.classId);
    });
  });

  it("reports the group feature state to both roles when groups are on", async () => {
    await withDataDir("features-on", async (dataDir) => {
      const env = createLearningGroupEnv(dataDir, "on");
      const { course } = await seedTeachingCourseFixture({
        dataDir,
        students: [
          { studentId: "student-lin", displayName: "林若晨" },
          { studentId: "student-zhao", displayName: "赵一鸣" },
        ],
      });
      const postGroup = createTeachingLearningGroupPostHandler({ env, now: groupCreatedNow });
      await postGroup(
        ...postGroupRequest({
          courseId: course.courseId,
          cookie: createTeacherCookie(),
          body: { groupName: "Group 3", members: ["student-lin", "student-zhao"] },
        }),
      );
      const getCourses = createTeachingCourseGetHandler({ env, now: seedNow });

      const teacherBody = await (
        await getCourses(
          new Request("https://www.uais.top/api/teaching/courses", {
            headers: { cookie: createTeacherCookie() },
          }),
        )
      ).json();
      const studentBody = await (
        await getCourses(
          new Request("https://www.uais.top/api/teaching/courses", {
            headers: { cookie: createStudentCookie("student-lin", "林若晨") },
          }),
        )
      ).json();

      // The feature field carries the decision, never the env value itself.
      expect(teacherBody.features).toEqual({ learningChatroomGroups: true });
      expect(studentBody.features).toEqual({ learningChatroomGroups: true });
      expect(teacherBody.learningGroups).toHaveLength(1);
      expect(studentBody.learningGroups).toHaveLength(1);
      expectNoCredentialValues(teacherBody, dataDir);
      expectNoCredentialValues(studentBody, dataDir);
    });
  });

  it("withholds the student group projection while groups ship dark", async () => {
    await withDataDir("features-off", async (dataDir) => {
      const seedEnv = createLearningGroupEnv(dataDir, "on");
      const { course } = await seedTeachingCourseFixture({
        dataDir,
        students: [
          { studentId: "student-lin", displayName: "林若晨" },
          { studentId: "student-zhao", displayName: "赵一鸣" },
        ],
      });
      const postGroup = createTeachingLearningGroupPostHandler({
        env: seedEnv,
        now: groupCreatedNow,
      });
      const createResponse = await postGroup(
        ...postGroupRequest({
          courseId: course.courseId,
          cookie: createTeacherCookie(),
          body: { groupName: "Group 3", members: ["student-lin", "student-zhao"] },
        }),
      );
      expect(createResponse.status).toBe(201);

      const darkEnv = createLearningGroupEnv(dataDir, "off");
      const getCourses = createTeachingCourseGetHandler({ env: darkEnv, now: seedNow });

      const studentResponse = await getCourses(
        new Request("https://www.uais.top/api/teaching/courses", {
          headers: { cookie: createStudentCookie("student-lin", "林若晨") },
        }),
      );
      const studentBody = await studentResponse.json();

      // Omitted, not emptied: the student dashboard falls back to its
      // placeholder collaboration card and the chatroom resolves no group room.
      expect(studentResponse.status, JSON.stringify(studentBody)).toBe(200);
      expect(studentBody.features).toEqual({ learningChatroomGroups: false });
      expect(Object.hasOwn(studentBody, "learningGroups")).toBe(false);
      expect(JSON.stringify(studentBody)).not.toContain("Group 3");
      // The rest of the student payload is untouched by the flag.
      expect(studentBody.courses).toHaveLength(1);
      expect(studentBody.memberships).toHaveLength(1);
      expectNoCredentialValues(studentBody, dataDir);

      // Teacher CRUD stays functional while the feature is dark — only the UI
      // hides — so the owning teacher still receives the full group records.
      const teacherResponse = await getCourses(
        new Request("https://www.uais.top/api/teaching/courses", {
          headers: { cookie: createTeacherCookie() },
        }),
      );
      const teacherBody = await teacherResponse.json();
      expect(teacherResponse.status, JSON.stringify(teacherBody)).toBe(200);
      expect(teacherBody.features).toEqual({ learningChatroomGroups: false });
      expect(teacherBody.learningGroups).toHaveLength(1);
      expect(teacherBody.learningGroups[0]).toEqual(
        expect.objectContaining({ groupName: "Group 3", ownerTeacherId }),
      );

      const renamed = await createTeachingLearningGroupPatchHandler({
        env: darkEnv,
        now: groupUpdatedNow,
      })(
        ...patchGroupRequest({
          courseId: course.courseId,
          groupId: teacherBody.learningGroups[0].groupId,
          cookie: createTeacherCookie(),
          body: { groupName: "Group 3 renamed" },
        }),
      );
      expect(renamed.status).toBe(200);
    });
  });

  it("reads the group flag exactly like the chatroom route", async () => {
    // Same env value strings, same answer on both routes: an explicit `on` after
    // trimming, case-insensitive, and nothing else. A deployment console typo
    // must not open the student surface on one route and close it on the other.
    const envValueCases: Array<{ value: string | null; enabled: boolean }> = [
      { value: "on", enabled: true },
      { value: "On", enabled: true },
      { value: "ON", enabled: true },
      { value: "  on  ", enabled: true },
      { value: "off", enabled: false },
      { value: "true", enabled: false },
      { value: "1", enabled: false },
      { value: "yes", enabled: false },
      { value: "onn", enabled: false },
      { value: "", enabled: false },
      { value: null, enabled: false },
    ];

    await withDataDir("flag-parity", async (dataDir) => {
      const { course } = await seedTeachingCourseFixture({
        dataDir,
        students: [{ studentId: "student-lin", displayName: "林若晨" }],
      });
      const chatroomCookie = createUaisAppSessionCookie(
        {
          account: "student-lin",
          department: "学生账号",
          displayName: "林若晨",
          role: "student",
        },
        {
          secret: appSessionSecret,
          sessionId: "student-lin-chatroom-flag-parity",
          // Far-future issue time: the chatroom handler validates the session
          // against the wall clock, so the suite must not expire mid-decade.
          now: new Date("2099-01-01T00:00:00.000Z"),
        },
      );

      for (const envValueCase of envValueCases) {
        const env = createLearningGroupEnv(dataDir, envValueCase.value);
        expect(isLearningChatroomGroupsEnabled(env), JSON.stringify(envValueCase)).toBe(
          envValueCase.enabled,
        );

        const coursesBody = await (
          await createTeachingCourseGetHandler({ env, now: seedNow })(
            new Request("https://www.uais.top/api/teaching/courses", {
              headers: { cookie: createTeacherCookie() },
            }),
          )
        ).json();
        expect(coursesBody.features, JSON.stringify(envValueCase)).toEqual({
          learningChatroomGroups: envValueCase.enabled,
        });

        const chatroomBody = await (
          await createLearningChatroomHistoryGetHandler({ env })(
            new Request(
              `https://www.uais.top/api/learning/chatroom?courseId=${course.courseId}&groupId=group-three`,
              { headers: { cookie: chatroomCookie } },
            ),
          )
        ).json();
        // `feature-not-enabled` is the chatroom route's flag-off denial; it is
        // raised before authorization, so its presence is a pure flag reading.
        expect(
          chatroomBody.access?.reasonCode === "feature-not-enabled",
          JSON.stringify({ envValueCase, access: chatroomBody.access }),
        ).toBe(!envValueCase.enabled);
      }
    });
  });

  it("round-trips a database with learning groups through the normalizer", () => {
    const database = {
      schemaVersion: "uais-teaching-course-management-v1",
      updatedAt: groupCreatedNow.toISOString(),
      courses: [],
      classes: [],
      memberships: [],
      learningGroups: [
        {
          groupId: "group-group-3-20260808-020000",
          courseId: "teacher-course-demo",
          classId: "teacher-course-demo-class-1",
          ownerTeacherId,
          groupName: "Group 3",
          members: [
            {
              studentId: "student-lin",
              studentDisplayName: "林若晨",
              addedAt: groupCreatedNow.toISOString(),
            },
            {
              studentId: "student-zhao",
              studentDisplayName: "赵一鸣",
              addedAt: groupCreatedNow.toISOString(),
            },
          ],
          createdAt: groupCreatedNow.toISOString(),
          updatedAt: groupCreatedNow.toISOString(),
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          storageWritePolicy: "external-optimistic-snapshot-replace",
          responsibleSession: "S12",
          redaction: { secrets: "omitted", localFiles: "omitted", assets: "ids-only" },
        },
      ],
      auditEvents: [
        {
          auditId: "audit-create-learning-group-20260808-020000",
          action: "create-learning-group",
          actorId: ownerTeacherId,
          courseId: "teacher-course-demo",
          classId: "teacher-course-demo-class-1",
          traceId: "trace-learning-group",
          actorRole: "teacher",
          authMode: "signed-teacher-session",
          createdAt: groupCreatedNow.toISOString(),
          requestSource: { userAgent: "vitest", ipAddress: "redacted" },
          storagePolicy: "external-redacted-teaching-course-management-audit-log",
          redaction: { secrets: "omitted", localFiles: "omitted", assets: "ids-only" },
        },
      ],
    };

    const normalized = normalizeTeachingCourseManagementDatabase(database);

    expect(normalized.learningGroups).toEqual(database.learningGroups);
    // The action guard must know the new actions, otherwise the audit event
    // silently normalizes back to "create-course".
    expect(normalized.auditEvents[0].action).toBe("create-learning-group");
    // Round-tripping the normalized value is stable.
    expect(normalizeTeachingCourseManagementDatabase(normalized)).toEqual(normalized);
  });

  it("keeps a database written before learning groups existed valid", () => {
    const legacyDatabase = {
      schemaVersion: "uais-teaching-course-management-v1",
      updatedAt: seedNow.toISOString(),
      courses: [],
      classes: [],
      memberships: [],
      auditEvents: [],
    };

    const normalized: TeachingCourseManagementDatabase =
      normalizeTeachingCourseManagementDatabase(legacyDatabase);

    expect(normalized.learningGroups).toBeUndefined();
    expect(Object.hasOwn(normalized, "learningGroups")).toBe(false);
    expect(normalized).toEqual(legacyDatabase);
  });

  it("rejects a stored learning group whose member shape is invalid", () => {
    expect(() =>
      normalizeTeachingCourseManagementDatabase({
        schemaVersion: "uais-teaching-course-management-v1",
        updatedAt: seedNow.toISOString(),
        courses: [],
        classes: [],
        memberships: [],
        learningGroups: [
          {
            groupId: "group-broken-20260808-020000",
            courseId: "teacher-course-demo",
            ownerTeacherId,
            groupName: "Broken",
            members: [{ studentId: "student-lin" }],
            createdAt: groupCreatedNow.toISOString(),
            updatedAt: groupCreatedNow.toISOString(),
          },
        ],
        auditEvents: [],
      }),
    ).toThrowError();
  });
});
