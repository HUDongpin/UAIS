import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTeachingClassMembershipBulkApprovePostHandler } from "@/app/api/teaching/classes/[classId]/memberships/approve/handler";
import { createTeachingClassMembershipPatchHandler } from "@/app/api/teaching/classes/[classId]/memberships/[membershipId]/handler";
import { createTeachingInviteCodeJoinPostHandler } from "@/app/api/teaching/invite-codes/[code]/join/handler";
import { createAiRequestRateLimiter } from "@/lib/server/ai-request-rate-limit";
import { createUaisAppSessionCookie } from "@/lib/server/uais-app-session";
import { createUaisTeacherAuthSessionCookieHeader } from "@/lib/server/teacher-auth-session";
import {
  createTeachingClassRecord,
  createTeachingCourseRecord,
  joinTeachingClassByInviteCode,
  publishTeachingClassInviteCode,
  readTeachingCourseManagementDatabase,
  saveTeachingStudentGroupSuggestionRecord,
  saveTeachingStudentRosterSyncRecord,
} from "@/lib/server/teaching-course-management-store";

// Enrolment at 200 students (PKG-5 server): bulk approval, the membership
// lifecycle a wrong-class join needs to be recoverable, invite-code policy
// enforcement, the join throttle, and the roster receipt's honesty.
//
// House harness: DI handler factories, signed test cookies, mkdtemp fixtures,
// injected clocks, no real env and no sleeps.

const teacherAuthSecret = "test-membership-lifecycle-session-signing-secret";
const appSessionSecret = "test-membership-lifecycle-app-session-signing-secret";
const ownerTeacherId = "teacher-kang";

const seedNow = new Date("2026-08-16T01:00:00.000Z");
const joinNow = new Date("2026-08-16T02:00:00.000Z");
const approveNow = new Date("2026-08-16T03:00:00.000Z");

function createTeacherCookie(actorId = ownerTeacherId) {
  return createUaisTeacherAuthSessionCookieHeader({
    secret: teacherAuthSecret,
    claims: {
      sessionId: `${actorId}-membership-lifecycle-session`,
      actorId,
      role: "teacher",
      authenticatedAt: "2026-08-16T00:00:00.000Z",
      expiresAt: "2026-08-16T12:00:00.000Z",
    },
  });
}

function createStudentCookie(account: string, displayName = account) {
  return createUaisAppSessionCookie(
    {
      account,
      department: "学生账号",
      displayName,
      role: "student",
    },
    {
      secret: appSessionSecret,
      sessionId: `${account}-membership-lifecycle-session`,
      now: seedNow,
    },
  );
}

function createMembershipEnv(dataDir: string) {
  return {
    UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
    UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
  };
}

function expectNoCredentialValues(value: unknown, dataDir: string) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(dataDir);
  expect(serialized).not.toContain("/Users/");
  expect(serialized).not.toContain(teacherAuthSecret);
  expect(serialized).not.toContain(appSessionSecret);
}

async function seedClassFixture(input: {
  dataDir: string;
  students?: Array<{ studentId: string; displayName: string }>;
}) {
  const { course } = await createTeachingCourseRecord({
    dataDir: input.dataDir,
    actorId: ownerTeacherId,
    draft: {
      name: "University Research Methods",
      instructor: "Kang Xia",
      unit: "Guangzhou University 404",
      department: "Experimental Teaching Center",
      semester: "2026 Spring",
    },
    now: seedNow,
  });
  const { classItem } = await createTeachingClassRecord({
    dataDir: input.dataDir,
    actorId: ownerTeacherId,
    courseId: course.courseId,
    draft: { className: "Research Methods Class 1" },
    now: seedNow,
  });
  for (const student of input.students ?? []) {
    await joinTeachingClassByInviteCode({
      dataDir: input.dataDir,
      join: {
        invitationCode: classItem.invitationCode,
        studentId: student.studentId,
        studentDisplayName: student.displayName,
      },
      now: joinNow,
    });
  }
  return { course, classItem };
}

function bulkApproveRequest(input: {
  classId: string;
  cookie?: string;
  body?: unknown;
  traceId?: string;
}) {
  return [
    new Request(
      `https://www.uais.top/api/teaching/classes/${input.classId}/memberships/approve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(input.cookie ? { cookie: input.cookie } : {}),
          ...(input.traceId ? { "x-uais-trace-id": input.traceId } : {}),
        },
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      },
    ),
    { params: Promise.resolve({ classId: input.classId }) },
  ] as const;
}

function membershipPatchRequest(input: {
  classId: string;
  membershipId: string;
  cookie?: string;
  body: unknown;
}) {
  return [
    new Request(
      `https://www.uais.top/api/teaching/classes/${input.classId}/memberships/${input.membershipId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          ...(input.cookie ? { cookie: input.cookie } : {}),
        },
        body: JSON.stringify(input.body),
      },
    ),
    {
      params: Promise.resolve({
        classId: input.classId,
        membershipId: input.membershipId,
      }),
    },
  ] as const;
}

function joinRequest(input: { code: string; cookie?: string }) {
  return [
    new Request(`https://www.uais.top/api/teaching/invite-codes/${input.code}/join`, {
      method: "POST",
      headers: input.cookie ? { cookie: input.cookie } : {},
    }),
    { params: Promise.resolve({ code: input.code }) },
  ] as const;
}

async function withDataDir(name: string, run: (dataDir: string) => Promise<void>) {
  const dataDir = await mkdtemp(join(tmpdir(), `uais-membership-${name}-`));
  try {
    await run(dataDir);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}

describe("teaching class membership lifecycle API", () => {
  it("approves every pending membership of a class in one write and one audit event", async () => {
    await withDataDir("bulk-approve", async (dataDir) => {
      const env = createMembershipEnv(dataDir);
      const { course, classItem } = await seedClassFixture({
        dataDir,
        students: [
          { studentId: "student-lin", displayName: "林若晨" },
          { studentId: "student-zhao", displayName: "赵一鸣" },
          { studentId: "student-wu", displayName: "吴敏" },
        ],
      });
      const bulkApprove = createTeachingClassMembershipBulkApprovePostHandler({
        env,
        now: approveNow,
      });

      // One student is already approved, so the batch is a mixed one: the
      // already-approved row must be reported, not re-stamped.
      const firstResponse = await bulkApprove(
        ...bulkApproveRequest({
          classId: classItem.classId,
          cookie: createTeacherCookie(),
          body: { membershipIds: [`membership-${classItem.classId}-student-lin`] },
        }),
      );
      expect(firstResponse.status).toBe(200);

      const response = await bulkApprove(
        ...bulkApproveRequest({
          classId: classItem.classId,
          cookie: createTeacherCookie(),
          traceId: "trace-bulk-approve-1",
        }),
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(response.headers.get("x-uais-trace-id")).toBe("trace-bulk-approve-1");
      expect(body.approvedCount).toBe(2);
      expect(body.approvedMembershipIds.sort()).toEqual([
        `membership-${classItem.classId}-student-wu`,
        `membership-${classItem.classId}-student-zhao`,
      ]);
      // The empty body means "everyone still waiting", so the already-approved
      // student is simply not in this batch.
      expect(body.alreadyApprovedMembershipIds).toEqual([]);
      expect(body.ineligibleMembershipIds).toEqual([]);
      expect(body.classItem.students).toBe(3);
      expect(body.course.students).toBe(3);
      expect(body.receipt).toMatchObject({
        action: "approve-class-memberships",
        actorId: ownerTeacherId,
        courseId: course.courseId,
        classId: classItem.classId,
        traceId: "trace-bulk-approve-1",
        status: "persisted",
      });
      expectNoCredentialValues(body, dataDir);

      const database = await readTeachingCourseManagementDatabase({ dataDir });
      expect(
        database.memberships.every(
          (membership) => membership.membershipStatus === "approved",
        ),
      ).toBe(true);
      expect(
        database.auditEvents.filter((event) => event.action === "approve-class-memberships"),
      ).toEqual([
        expect.objectContaining({ affectedRecordCount: 1 }),
        expect.objectContaining({
          action: "approve-class-memberships",
          actorId: ownerTeacherId,
          courseId: course.courseId,
          classId: classItem.classId,
          traceId: "trace-bulk-approve-1",
          affectedRecordCount: 2,
        }),
      ]);

      // Re-running the same batch changes nothing and must not burn a revision a
      // concurrent join is waiting on.
      const repeated = await bulkApprove(
        ...bulkApproveRequest({
          classId: classItem.classId,
          cookie: createTeacherCookie(),
          body: {
            membershipIds: [
              `membership-${classItem.classId}-student-lin`,
              `membership-${classItem.classId}-student-zhao`,
            ],
          },
        }),
      );
      const repeatedBody = await repeated.json();
      expect(repeated.status, JSON.stringify(repeatedBody)).toBe(200);
      expect(repeatedBody.approvedCount).toBe(0);
      expect(repeatedBody.alreadyApprovedMembershipIds).toHaveLength(2);

      const afterRepeat = await readTeachingCourseManagementDatabase({ dataDir });
      expect(
        afterRepeat.auditEvents.filter((event) => event.action === "approve-class-memberships"),
      ).toHaveLength(2);
    });
  });

  it("refuses a bulk approval naming a membership outside the class", async () => {
    await withDataDir("bulk-approve-unknown", async (dataDir) => {
      const env = createMembershipEnv(dataDir);
      const { classItem } = await seedClassFixture({
        dataDir,
        students: [{ studentId: "student-lin", displayName: "林若晨" }],
      });
      const bulkApprove = createTeachingClassMembershipBulkApprovePostHandler({
        env,
        now: approveNow,
      });

      const response = await bulkApprove(
        ...bulkApproveRequest({
          classId: classItem.classId,
          cookie: createTeacherCookie(),
          body: { membershipIds: [`membership-${classItem.classId}-student-stranger`] },
        }),
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(404);
      expect(body.error).toBe("Teaching class membership was not found.");

      const database = await readTeachingCourseManagementDatabase({ dataDir });
      expect(database.memberships[0].membershipStatus).toBe("pending-teacher-review");
    });
  });

  it("denies bulk approval to a foreign teacher and to a student session", async () => {
    await withDataDir("bulk-approve-denied", async (dataDir) => {
      const env = createMembershipEnv(dataDir);
      const { classItem } = await seedClassFixture({
        dataDir,
        students: [{ studentId: "student-lin", displayName: "林若晨" }],
      });
      const bulkApprove = createTeachingClassMembershipBulkApprovePostHandler({
        env,
        now: approveNow,
      });

      const studentResponse = await bulkApprove(
        ...bulkApproveRequest({
          classId: classItem.classId,
          cookie: createStudentCookie("student-lin"),
        }),
      );
      const studentBody = await studentResponse.json();
      expect(studentResponse.status, JSON.stringify(studentBody)).toBe(403);
      expect(studentBody.access.reasonCode).toBe("teacher-role-required");

      const foreignResponse = await bulkApprove(
        ...bulkApproveRequest({
          classId: classItem.classId,
          cookie: createTeacherCookie("teacher-other"),
        }),
      );
      const foreignBody = await foreignResponse.json();
      expect(foreignResponse.status, JSON.stringify(foreignBody)).toBe(403);
      expect(foreignBody.access.reasonCode).toBe("teacher-course-ownership-required");
      expectNoCredentialValues(foreignBody, dataDir);

      const anonymousResponse = await bulkApprove(
        ...bulkApproveRequest({ classId: classItem.classId }),
      );
      expect(anonymousResponse.status).toBe(401);

      const database = await readTeachingCourseManagementDatabase({ dataDir });
      expect(database.memberships[0].membershipStatus).toBe("pending-teacher-review");
    });
  });

  it("lets a rejected student join again as a fresh pending request", async () => {
    await withDataDir("reject-rejoin", async (dataDir) => {
      const env = createMembershipEnv(dataDir);
      const { classItem } = await seedClassFixture({
        dataDir,
        students: [{ studentId: "student-lin", displayName: "林若晨" }],
      });
      const patchMembership = createTeachingClassMembershipPatchHandler({
        env,
        now: approveNow,
      });
      const postJoin = createTeachingInviteCodeJoinPostHandler({
        env,
        now: new Date("2026-08-16T04:00:00.000Z"),
      });
      const membershipId = `membership-${classItem.classId}-student-lin`;

      const rejected = await patchMembership(
        ...membershipPatchRequest({
          classId: classItem.classId,
          membershipId,
          cookie: createTeacherCookie(),
          body: { membershipStatus: "rejected" },
        }),
      );
      const rejectedBody = await rejected.json();
      expect(rejected.status, JSON.stringify(rejectedBody)).toBe(200);
      expect(rejectedBody.membership).toMatchObject({
        membershipStatus: "rejected",
        statusChangedAt: approveNow.toISOString(),
        statusChangedByTeacherId: ownerTeacherId,
      });
      expect(rejectedBody.releasedGroupIds).toEqual([]);

      // Rejecting twice is the same answer, and writes nothing further.
      const repeated = await patchMembership(
        ...membershipPatchRequest({
          classId: classItem.classId,
          membershipId,
          cookie: createTeacherCookie(),
          body: { membershipStatus: "rejected" },
        }),
      );
      expect(repeated.status).toBe(200);

      const response = await postJoin(
        ...joinRequest({
          code: classItem.invitationCode,
          cookie: createStudentCookie("student-lin", "林若晨"),
        }),
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(201);
      expect(body.membership).toMatchObject({
        membershipId,
        membershipStatus: "pending-teacher-review",
        joinedAt: "2026-08-16T04:00:00.000Z",
      });
      // A fresh request keeps none of the closed one's stamps.
      expect(body.membership.statusChangedAt).toBeUndefined();
      expect(body.membership.statusChangedByTeacherId).toBeUndefined();
      expectNoCredentialValues(body, dataDir);

      const database = await readTeachingCourseManagementDatabase({ dataDir });
      // One row per student per class, not a second row under the same id.
      expect(database.memberships).toHaveLength(1);
      expect(
        database.auditEvents.filter((event) => event.action === "reject-class-membership"),
      ).toHaveLength(1);
    });
  });

  it("refuses a membership transition that skips the state it must come from", async () => {
    await withDataDir("transition", async (dataDir) => {
      const env = createMembershipEnv(dataDir);
      const { classItem } = await seedClassFixture({
        dataDir,
        students: [{ studentId: "student-lin", displayName: "林若晨" }],
      });
      const patchMembership = createTeachingClassMembershipPatchHandler({
        env,
        now: approveNow,
      });
      const membershipId = `membership-${classItem.classId}-student-lin`;

      // "removed" is for an approved student; this one is still waiting.
      const response = await patchMembership(
        ...membershipPatchRequest({
          classId: classItem.classId,
          membershipId,
          cookie: createTeacherCookie(),
          body: { membershipStatus: "removed" },
        }),
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(409);
      expect(body.reasonCode).toBe("membership-transition-not-allowed");

      const invalid = await patchMembership(
        ...membershipPatchRequest({
          classId: classItem.classId,
          membershipId,
          cookie: createTeacherCookie(),
          body: { membershipStatus: "approved" },
        }),
      );
      expect(invalid.status).toBe(400);

      const database = await readTeachingCourseManagementDatabase({ dataDir });
      expect(database.memberships[0].membershipStatus).toBe("pending-teacher-review");
    });
  });

  it("refuses joins on a disabled, expired or full invite code with distinct reason codes", async () => {
    await withDataDir("invite-policy", async (dataDir) => {
      const env = createMembershipEnv(dataDir);
      const { course, classItem } = await seedClassFixture({ dataDir });
      const postJoin = createTeachingInviteCodeJoinPostHandler({ env, now: joinNow });

      await publishTeachingClassInviteCode({
        dataDir,
        actorId: ownerTeacherId,
        courseId: course.courseId,
        classId: classItem.classId,
        invitationCode: classItem.invitationCode,
        invitePolicy: { disabled: true },
        now: seedNow,
      });
      const disabled = await postJoin(
        ...joinRequest({
          code: classItem.invitationCode,
          cookie: createStudentCookie("student-lin"),
        }),
      );
      const disabledBody = await disabled.json();
      expect(disabled.status, JSON.stringify(disabledBody)).toBe(403);
      expect(disabledBody.reasonCode).toBe("invite-code-disabled");

      await publishTeachingClassInviteCode({
        dataDir,
        actorId: ownerTeacherId,
        courseId: course.courseId,
        classId: classItem.classId,
        invitationCode: classItem.invitationCode,
        invitePolicy: { disabled: false, expiresAt: "2026-08-16T01:30:00.000Z" },
        now: seedNow,
      });
      const expired = await postJoin(
        ...joinRequest({
          code: classItem.invitationCode,
          cookie: createStudentCookie("student-lin"),
        }),
      );
      const expiredBody = await expired.json();
      expect(expired.status, JSON.stringify(expiredBody)).toBe(403);
      expect(expiredBody.reasonCode).toBe("invite-code-expired");

      await publishTeachingClassInviteCode({
        dataDir,
        actorId: ownerTeacherId,
        courseId: course.courseId,
        classId: classItem.classId,
        invitationCode: classItem.invitationCode,
        invitePolicy: { expiresAt: null, maxJoins: 1 },
        now: seedNow,
      });
      const firstJoin = await postJoin(
        ...joinRequest({
          code: classItem.invitationCode,
          cookie: createStudentCookie("student-lin"),
        }),
      );
      expect(firstJoin.status).toBe(201);
      const full = await postJoin(
        ...joinRequest({
          code: classItem.invitationCode,
          cookie: createStudentCookie("student-zhao"),
        }),
      );
      const fullBody = await full.json();
      expect(full.status, JSON.stringify(fullBody)).toBe(403);
      expect(fullBody.reasonCode).toBe("invite-code-capacity-reached");
      expectNoCredentialValues(fullBody, dataDir);

      // The seat the limit counts is a LIVE one: rejecting the first student
      // gives the next one their place back.
      const patchMembership = createTeachingClassMembershipPatchHandler({
        env,
        now: approveNow,
      });
      const rejected = await patchMembership(
        ...membershipPatchRequest({
          classId: classItem.classId,
          membershipId: `membership-${classItem.classId}-student-lin`,
          cookie: createTeacherCookie(),
          body: { membershipStatus: "rejected" },
        }),
      );
      expect(rejected.status).toBe(200);
      const afterRejection = await postJoin(
        ...joinRequest({
          code: classItem.invitationCode,
          cookie: createStudentCookie("student-zhao"),
        }),
      );
      expect(afterRejection.status).toBe(201);

      const database = await readTeachingCourseManagementDatabase({ dataDir });
      expect(database.classes[0]).toMatchObject({ inviteMaxJoins: 1 });
      expect(database.classes[0].inviteDisabled).toBeUndefined();
      expect(database.classes[0].inviteExpiresAt).toBeUndefined();
    });
  });

  it("keeps a legacy class with no invite policy joinable", async () => {
    await withDataDir("invite-legacy", async (dataDir) => {
      const env = createMembershipEnv(dataDir);
      const { classItem } = await seedClassFixture({ dataDir });
      const postJoin = createTeachingInviteCodeJoinPostHandler({ env, now: joinNow });

      const response = await postJoin(
        ...joinRequest({
          code: classItem.invitationCode,
          cookie: createStudentCookie("student-lin"),
        }),
      );

      expect(response.status).toBe(201);
      // Codes are eight digits and no longer sequential, so nothing about one
      // class's code predicts another's.
      expect(classItem.invitationCode).toMatch(/^\d{8}$/);
    });
  });

  it("throttles invite-code joins per student with a retry-after", async () => {
    await withDataDir("invite-rate-limit", async (dataDir) => {
      const env = createMembershipEnv(dataDir);
      const { classItem } = await seedClassFixture({ dataDir });
      const postJoin = createTeachingInviteCodeJoinPostHandler({
        env,
        now: joinNow,
        rateLimiter: createAiRequestRateLimiter({
          config: {
            mode: "enforce",
            windows: [{ id: "per-minute", limit: 1, windowMs: 60000 }],
          },
        }),
      });

      const allowed = await postJoin(
        ...joinRequest({
          code: classItem.invitationCode,
          cookie: createStudentCookie("student-lin"),
        }),
      );
      expect(allowed.status).toBe(201);

      const throttled = await postJoin(
        ...joinRequest({
          code: "99999999",
          cookie: createStudentCookie("student-lin"),
        }),
      );
      const throttledBody = await throttled.json();
      expect(throttled.status, JSON.stringify(throttledBody)).toBe(429);
      expect(throttledBody.reasonCode).toBe("invite-join-rate-limited");
      expect(throttledBody.retryAfterSeconds).toBeGreaterThan(0);
      expect(throttled.headers.get("retry-after")).toBe(
        String(throttledBody.retryAfterSeconds),
      );
      expectNoCredentialValues(throttledBody, dataDir);

      // The budget is per actor, so one student's loop cannot lock another out.
      const otherStudent = await postJoin(
        ...joinRequest({
          code: classItem.invitationCode,
          cookie: createStudentCookie("student-zhao"),
        }),
      );
      expect(otherStudent.status).toBe(201);
    });
  });

  it("reports the roster sync as the local recount it performs", async () => {
    await withDataDir("roster-honesty", async (dataDir) => {
      const { course, classItem } = await seedClassFixture({
        dataDir,
        students: [
          { studentId: "student-lin", displayName: "林若晨" },
          { studentId: "student-zhao", displayName: "赵一鸣" },
        ],
      });
      const bulkApprove = createTeachingClassMembershipBulkApprovePostHandler({
        env: createMembershipEnv(dataDir),
        now: approveNow,
      });
      await bulkApprove(
        ...bulkApproveRequest({
          classId: classItem.classId,
          cookie: createTeacherCookie(),
          body: { membershipIds: [`membership-${classItem.classId}-student-lin`] },
        }),
      );

      const { studentRoster } = await saveTeachingStudentRosterSyncRecord({
        dataDir,
        actorId: ownerTeacherId,
        courseId: course.courseId,
        operationRecordId: "roster-record-membership-lifecycle",
        now: new Date("2026-08-16T05:00:00.000Z"),
      });

      // The receipt says what happened: a recount of the memberships already in
      // this snapshot. It no longer claims an SIS import, invite-code ingestion
      // or a withdrawals feed, none of which exist.
      expect(studentRoster).toMatchObject({
        syncStatus: "local-recount",
        sourceSystems: ["local-class-memberships", "local-class-records"],
        approvedStudentCount: 1,
        pendingTeacherReviewCount: 1,
        classCount: 1,
      });
      expect(studentRoster).not.toHaveProperty("providerStatus");
    });
  });

  it("carries real member partitions on a group suggestion receipt", async () => {
    await withDataDir("suggestion-partitions", async (dataDir) => {
      const { course, classItem } = await seedClassFixture({
        dataDir,
        students: Array.from({ length: 5 }, (_unused, index) => ({
          studentId: `student-${String(index + 1).padStart(2, "0")}`,
          displayName: `学生${index + 1}`,
        })),
      });
      const bulkApprove = createTeachingClassMembershipBulkApprovePostHandler({
        env: createMembershipEnv(dataDir),
        now: approveNow,
      });
      await bulkApprove(
        ...bulkApproveRequest({
          classId: classItem.classId,
          cookie: createTeacherCookie(),
        }),
      );

      const { studentGroupSuggestion } = await saveTeachingStudentGroupSuggestionRecord({
        dataDir,
        actorId: ownerTeacherId,
        courseId: course.courseId,
        operationRecordId: "suggestion-record-membership-lifecycle",
        now: new Date("2026-08-16T05:00:00.000Z"),
      });

      // Five approved, ungrouped students at the suggestion's size of four is
      // 4 + 1, and the remainder folds rather than proposing a group of one.
      expect(studentGroupSuggestion.ungroupedStudentCount).toBe(5);
      expect(
        studentGroupSuggestion.suggestedGroups.map((group) => [
          group.groupName,
          group.members.map((member) => member.studentId),
        ]),
      ).toEqual([
        [
          "第1组",
          ["student-01", "student-02", "student-03", "student-04", "student-05"],
        ],
      ]);
      expect(studentGroupSuggestion.sourceSignals).toEqual([
        "approved-class-memberships",
        "existing-learning-groups",
      ]);
    });
  });
});
