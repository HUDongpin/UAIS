import { describe, expect, it } from "vitest";

import {
  createTeachingClassRecord,
  createTeachingCourseRecord,
  joinTeachingClassByInviteCode,
  TeachingCourseManagementStoreError,
  type TeachingCourseManagementDatabase,
  type TeachingCourseManagementRepository,
} from "@/lib/server/teaching-course-management-store";
import { normalizeTeachingCourseManagementDatabase } from "@/lib/server/teaching-course-management-database-normalizer";
import { createProvisionalTeachingCourseId } from "@/lib/teaching-course-id";

function createRepository() {
  let database: TeachingCourseManagementDatabase = {
    schemaVersion: "uais-teaching-course-management-v1",
    updatedAt: "1970-01-01T00:00:00.000Z",
    courses: [],
    classes: [],
    memberships: [],
    auditEvents: [],
  };
  let revision = 0;

  const repository: TeachingCourseManagementRepository = {
    storage: {
      recordStoragePolicy: "postgres-teaching-course-management-snapshot",
      auditStoragePolicy: "postgres-teaching-course-management-audit-log",
      storageWritePolicy: "postgres-transactional-snapshot-replace",
    },
    async read() {
      return {
        database: structuredClone(database),
        revision: `revision-${revision}`,
      };
    },
    async write(input) {
      if (input.expectedRevision !== `revision-${revision}`) {
        throw new TeachingCourseManagementStoreError(
          409,
          "Test repository revision mismatch.",
        );
      }
      database = normalizeTeachingCourseManagementDatabase(
        JSON.parse(JSON.stringify(input.database)),
      );
      revision += 1;
    },
  };

  return repository;
}

async function createClassFixture(runId: string) {
  const repository = createRepository();
  const teacherId = `${runId}-teacher`;
  const courseId = createProvisionalTeachingCourseId({
    actorId: teacherId,
    courseName: `P2 load ${runId}`,
    now: new Date("2026-08-29T02:14:30.000Z"),
  });
  const { course } = await createTeachingCourseRecord({
    repository,
    actorId: teacherId,
    draft: {
      courseId,
      name: "P2 Load Only Quality Pilot",
      instructor: "P2 Staging Teacher",
      unit: "UAIS isolated staging",
      department: "P2 Quality",
      semester: "2026 Fall",
      description: `Tagged load-only fixture ${runId}`,
    },
  });
  const { classItem } = await createTeachingClassRecord({
    repository,
    actorId: teacherId,
    courseId: course.courseId,
    draft: { className: `${runId}-class` },
  });
  return { classItem, repository };
}

describe("teaching membership id boundary", () => {
  it("joins a student when the legacy concatenated membership id exceeds 160 characters", async () => {
    const runId = "p2-20260829021430-fddbf8a0";
    const { classItem, repository } = await createClassFixture(runId);
    const studentId = `${runId}-student-001`;
    const legacyId = `membership-${classItem.classId}-${studentId}`;

    expect(legacyId).toHaveLength(164);

    const first = await joinTeachingClassByInviteCode({
      repository,
      join: {
        invitationCode: classItem.invitationCode,
        studentId,
        studentDisplayName: "P2 Load Student 001",
      },
      traceId: `${runId}-join-1`,
    });
    const repeated = await joinTeachingClassByInviteCode({
      repository,
      join: {
        invitationCode: classItem.invitationCode,
        studentId,
        studentDisplayName: "P2 Load Student 001",
      },
      traceId: `${runId}-join-repeat`,
    });

    expect(first.membership.membershipId).toMatch(
      /^membership-sha256-[0-9a-f]{64}$/,
    );
    expect(first.membership.membershipId).toBe(
      "membership-sha256-2531d79413417607000c6e800baa2a7df788b726794b4529e4ee7b06302f5b79",
    );
    expect(first.membership.membershipId.length).toBeLessThanOrEqual(160);
    expect(repeated.membership.membershipId).toBe(
      first.membership.membershipId,
    );
  });

  it("preserves exactly 160 characters and hashes the first overflowing length", async () => {
    const runId = "p2-20260829021430-fddbf8a0";
    const { classItem, repository } = await createClassFixture(runId);
    const atLimitStudentId = "s".repeat(34);
    const overLimitStudentId = "t".repeat(35);
    const atLimitLegacyId = `membership-${classItem.classId}-${atLimitStudentId}`;
    const overLimitLegacyId = `membership-${classItem.classId}-${overLimitStudentId}`;

    expect(classItem.classId).toHaveLength(114);
    expect(atLimitLegacyId).toHaveLength(160);
    expect(overLimitLegacyId).toHaveLength(161);

    const atLimit = await joinTeachingClassByInviteCode({
      repository,
      join: {
        invitationCode: classItem.invitationCode,
        studentId: atLimitStudentId,
        studentDisplayName: "Boundary Student 160",
      },
    });
    const overLimit = await joinTeachingClassByInviteCode({
      repository,
      join: {
        invitationCode: classItem.invitationCode,
        studentId: overLimitStudentId,
        studentDisplayName: "Boundary Student 161",
      },
    });

    expect(atLimit.membership.membershipId).toBe(atLimitLegacyId);
    expect(overLimit.membership.membershipId).toMatch(
      /^membership-sha256-[0-9a-f]{64}$/,
    );
  });

  it("preserves the established readable id for a short class and student pair", async () => {
    const repository = createRepository();
    const { course } = await createTeachingCourseRecord({
      repository,
      actorId: "teacher-kang",
      draft: {
        courseId: createProvisionalTeachingCourseId({
          actorId: "teacher-kang",
          courseName: "Short course",
          now: new Date("2026-08-29T02:14:30.000Z"),
        }),
        name: "Short course",
        instructor: "Teacher Kang",
        unit: "UAIS",
        department: "Teaching",
        semester: "2026 Fall",
      },
    });
    const { classItem } = await createTeachingClassRecord({
      repository,
      actorId: "teacher-kang",
      courseId: course.courseId,
      draft: { className: "Class 1" },
    });
    const joined = await joinTeachingClassByInviteCode({
      repository,
      join: {
        invitationCode: classItem.invitationCode,
        studentId: "Peter",
        studentDisplayName: "Peter",
      },
    });

    expect(joined.membership.membershipId).toBe(
      `membership-${classItem.classId}-Peter`,
    );
  });

  it("does not collapse distinct long student pairs onto one bounded id", async () => {
    const runId = "p2-20260829021430-fddbf8a0";
    const { classItem, repository } = await createClassFixture(runId);
    const ids = await Promise.all(
      ["001", "002"].map(async (suffix) => {
        const joined = await joinTeachingClassByInviteCode({
          repository,
          join: {
            invitationCode: classItem.invitationCode,
            studentId: `${runId}-student-${suffix}`,
            studentDisplayName: `P2 Load Student ${suffix}`,
          },
        });
        return joined.membership.membershipId;
      }),
    );

    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id) => id.length <= 160)).toBe(true);
  });

  it("creates 200 distinct bounded ids for the exact P2 student cohort shape", async () => {
    const runId = "p2-20260829021430-fddbf8a0";
    const { classItem, repository } = await createClassFixture(runId);
    const membershipIds = [];

    for (let index = 1; index <= 200; index += 1) {
      const suffix = String(index).padStart(3, "0");
      const joined = await joinTeachingClassByInviteCode({
        repository,
        join: {
          invitationCode: classItem.invitationCode,
          studentId: `${runId}-student-${suffix}`,
          studentDisplayName: `P2 Load Student ${suffix}`,
        },
      });
      membershipIds.push(joined.membership.membershipId);
    }

    expect(membershipIds).toHaveLength(200);
    expect(new Set(membershipIds).size).toBe(200);
    expect(
      membershipIds.every((id) =>
        /^membership-sha256-[0-9a-f]{64}$/.test(id),
      ),
    ).toBe(true);
  });
});
