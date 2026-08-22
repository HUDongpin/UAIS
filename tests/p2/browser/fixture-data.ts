import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const P2_FIXTURE_DATA_DIR = resolve(
  process.cwd(),
  ".tmp",
  "p2-playwright-data",
);

export const P2_FIXTURE_IDENTITIES = {
  studentA: {
    account: "p2-student-a",
    displayName: "P2 Student A",
    role: "student",
  },
  studentB: {
    account: "p2-student-b",
    displayName: "P2 Student B",
    role: "student",
  },
  teacherA: {
    account: "p2-teacher-a",
    displayName: "P2 Teacher A",
    role: "teacher",
  },
} as const;

const fixtureTimestamp = "2026-08-22T00:00:00.000Z";
const storagePolicy = "local-json-teaching-course-management";
const storageWritePolicy = "atomic-json-file-replace";
const redaction = {
  secrets: "omitted",
  localFiles: "omitted",
  assets: "ids-only",
};
const recordEnvelope = {
  storagePolicy,
  storageWritePolicy,
  responsibleSession: "S12",
  redaction,
};

export function createP2TeachingFixtureDatabase() {
  const courseDefinitions = [
    {
      courseId: "elementary-math-research",
      classId: "elementary-math-research-class-1",
      invitationCode: "55395057",
      courseName: "P2 演示课件播放课程",
      className: "P2 演示课件一班",
    },
    {
      courseId: "p2-quality-pilot",
      classId: "p2-quality-pilot-class-1",
      invitationCode: "24082201",
      courseName: "P2 Quality Pilot",
      className: "P2 Quality Pilot Class 1",
    },
  ];
  const students = [P2_FIXTURE_IDENTITIES.studentA, P2_FIXTURE_IDENTITIES.studentB];

  return {
    schemaVersion: "uais-teaching-course-management-v1",
    updatedAt: fixtureTimestamp,
    courses: courseDefinitions.map((course) => ({
      courseId: course.courseId,
      ownerTeacherId: P2_FIXTURE_IDENTITIES.teacherA.account,
      courseName: course.courseName,
      instructor: P2_FIXTURE_IDENTITIES.teacherA.displayName,
      unit: "UAIS P2 staging-only fixture",
      department: "Quality Assurance",
      semester: "2026 P2",
      status: "draft",
      students: students.length,
      createdAt: fixtureTimestamp,
      updatedAt: fixtureTimestamp,
      ...recordEnvelope,
    })),
    classes: courseDefinitions.map((course) => ({
      classId: course.classId,
      courseId: course.courseId,
      ownerTeacherId: P2_FIXTURE_IDENTITIES.teacherA.account,
      className: course.className,
      students: students.length,
      semester: "2026 P2",
      invitationCode: course.invitationCode,
      joinUrl: `/courses?invite=${course.invitationCode}`,
      createdAt: fixtureTimestamp,
      updatedAt: fixtureTimestamp,
      ...recordEnvelope,
    })),
    memberships: courseDefinitions.flatMap((course) =>
      students.map((student) => ({
        membershipId: `membership-${course.classId}-${student.account}`,
        courseId: course.courseId,
        classId: course.classId,
        invitationCode: course.invitationCode,
        studentId: student.account,
        studentDisplayName: student.displayName,
        membershipStatus: "approved",
        approvedAt: fixtureTimestamp,
        approvedByTeacherId: P2_FIXTURE_IDENTITIES.teacherA.account,
        joinedAt: fixtureTimestamp,
        ...recordEnvelope,
      })),
    ),
    learningGroups: [P2_FIXTURE_IDENTITIES.studentA, P2_FIXTURE_IDENTITIES.studentB].map(
      (student, index) => ({
        groupId: `p2-group-${index === 0 ? "a" : "b"}`,
        courseId: "elementary-math-research",
        classId: "elementary-math-research-class-1",
        ownerTeacherId: P2_FIXTURE_IDENTITIES.teacherA.account,
        groupName: `P2 Group ${index === 0 ? "A" : "B"}`,
        members: [
          {
            studentId: student.account,
            studentDisplayName: student.displayName,
            addedAt: fixtureTimestamp,
          },
        ],
        createdAt: fixtureTimestamp,
        updatedAt: fixtureTimestamp,
        ...recordEnvelope,
      }),
    ),
    auditEvents: [],
  };
}

export async function resetP2FixtureData() {
  await rm(P2_FIXTURE_DATA_DIR, { recursive: true, force: true });
  await mkdir(P2_FIXTURE_DATA_DIR, { recursive: true });
  const targetPath = join(
    P2_FIXTURE_DATA_DIR,
    "teaching-course-management.json",
  );
  const temporaryPath = join(
    P2_FIXTURE_DATA_DIR,
    `.p2-fixture-${randomUUID()}.tmp`,
  );
  await writeFile(
    temporaryPath,
    `${JSON.stringify(createP2TeachingFixtureDatabase(), null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  await rename(temporaryPath, targetPath);
}

export async function removeP2FixtureData() {
  await rm(P2_FIXTURE_DATA_DIR, { recursive: true, force: true });
}
