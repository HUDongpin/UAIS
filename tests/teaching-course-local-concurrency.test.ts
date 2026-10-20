import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  approveTeachingClassMembership,
  createTeachingClassRecord,
  createTeachingCourseRecord,
  joinTeachingClassByInviteCode,
  readTeachingCourseManagementDatabase,
  saveTeachingCourseExportManifestRecord,
  saveTeachingCourseSettingsRecord,
} from "@/lib/server/teaching-course-management-store";
import {
  readTeachingCourseManagementSnapshot,
  writeTeachingCourseManagementSnapshot,
} from "@/lib/server/teaching-course-management-io";

const fixtures: string[] = [];
const now = new Date("2026-06-22T10:00:00.000Z");
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "uais-course-local-cas-"));
  fixtures.push(dataDir);
  return dataDir;
}
function createCourse(dataDir: string, name: string) {
  return createTeachingCourseRecord({
    dataDir, actorId: "teacher-a", now,
    draft: { name, instructor: "Fixture teacher", unit: "Fixture", department: "Fixture", semester: "2026" },
  });
}

describe("local course snapshot compare and replace", () => {
  it("retains both courses and audit records after concurrent successful creates", async () => {
    const dataDir = await fixture();
    const results = await Promise.all([createCourse(dataDir, "Course A"), createCourse(dataDir, "Course B")]);
    const database = await readTeachingCourseManagementDatabase({ dataDir });
    expect(database.courses.map((course) => course.courseId).sort())
      .toEqual(results.map((result) => result.course.courseId).sort());
    expect(database.auditEvents).toHaveLength(2);
  });

  it("retains both classes and distinct invite codes after concurrent creates", async () => {
    const dataDir = await fixture();
    const { course } = await createCourse(dataDir, "Course A");
    const classes = await Promise.all(["A", "B"].map((name) => createTeachingClassRecord({
      dataDir, actorId: "teacher-a", courseId: course.courseId, draft: { className: `Class ${name}` }, now,
    })));
    const database = await readTeachingCourseManagementDatabase({ dataDir });
    expect(database.classes.map((item) => item.classId).sort())
      .toEqual(classes.map(({ classItem }) => classItem.classId).sort());
    expect(new Set(database.classes.map((item) => item.invitationCode)).size).toBe(2);
  });

  it("retains concurrent joins and approvals with accurate class and course totals", async () => {
    const dataDir = await fixture();
    const { course } = await createCourse(dataDir, "Course A");
    const { classItem } = await createTeachingClassRecord({
      dataDir, actorId: "teacher-a", courseId: course.courseId, draft: { className: "Class A" }, now,
    });
    const joins = await Promise.all(["student-a", "student-b"].map((studentId) => joinTeachingClassByInviteCode({
      dataDir, now, join: { invitationCode: classItem.invitationCode, studentId, studentDisplayName: studentId },
    })));
    await Promise.all(joins.map(({ membership }) => approveTeachingClassMembership({
      dataDir, actorId: "teacher-a", classId: classItem.classId, membershipId: membership.membershipId, now,
    })));
    const database = await readTeachingCourseManagementDatabase({ dataDir });
    expect(database.memberships).toHaveLength(2);
    expect(database.memberships.every((member) => member.membershipStatus === "approved")).toBe(true);
    expect(database.classes[0].students).toBe(2);
    expect(database.courses[0].students).toBe(2);
  });

  it.each(["same", "different"] as const)("keeps simultaneous settings and export writes for %s courses", async (scope) => {
    const dataDir = await fixture();
    const first = (await createCourse(dataDir, "Course A")).course;
    const second = scope === "same" ? first : (await createCourse(dataDir, "Course B")).course;
    await Promise.all([
      saveTeachingCourseSettingsRecord({
        dataDir, actorId: "teacher-a", courseId: first.courseId, operationRecordId: "settings-operation", now,
        settingsPatch: { courseName: "Edited Course A" },
      }),
      saveTeachingCourseExportManifestRecord({
        dataDir, actorId: "teacher-a", courseId: second.courseId, operationRecordId: "export-operation", now,
        teachingOperationManifestId: "synthetic-export-manifest",
      }),
    ]);
    const database = await readTeachingCourseManagementDatabase({ dataDir });
    expect(database.courses.find((course) => course.courseId === first.courseId)?.courseName).toBe("Edited Course A");
    expect(database.exportManifests).toContainEqual(expect.objectContaining({
      courseId: second.courseId, teachingOperationManifestId: "synthetic-export-manifest",
    }));
    expect(database.courseSettings).toContainEqual(expect.objectContaining({ courseId: first.courseId }));
  });

  it("rejects an absent-snapshot revision after another writer creates data, then releases the lock", async () => {
    const dataDir = await fixture();
    const absent = await readTeachingCourseManagementSnapshot({ dataDir });
    expect(absent.revision).toBe("local-snapshot-absent");
    await createCourse(dataDir, "Course A");
    const before = await readTeachingCourseManagementDatabase({ dataDir });
    await expect(writeTeachingCourseManagementSnapshot({
      dataDir, database: absent.database, expectedRevision: absent.revision,
    })).rejects.toMatchObject({ status: 409, reasonCode: "snapshot-contention" });
    expect(await readTeachingCourseManagementDatabase({ dataDir })).toEqual(before);
    expect(await readdir(dataDir)).not.toContain(".teaching-course-management-write-lock");
    await createCourse(dataDir, "Course B");
    expect((await readTeachingCourseManagementDatabase({ dataDir })).courses).toHaveLength(2);
  });

  it("lets only one writer replace a shared revision", async () => {
    const dataDir = await fixture();
    const snapshot = await readTeachingCourseManagementSnapshot({ dataDir });
    const updates = ["2026-06-22T11:00:00.000Z", "2026-06-22T12:00:00.000Z"];
    const results = await Promise.allSettled(updates.map((updatedAt) => writeTeachingCourseManagementSnapshot({
      dataDir, expectedRevision: snapshot.revision, database: { ...snapshot.database, updatedAt },
    })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((result) => result.status === "rejected");
    expect(refused?.status === "rejected" ? refused.reason : undefined)
      .toMatchObject({ status: 409, reasonCode: "snapshot-contention" });
  });

  it("cleans the lock after an invalid on-disk snapshot fails the guarded read", async () => {
    const dataDir = await fixture();
    const snapshot = await readTeachingCourseManagementSnapshot({ dataDir });
    const path = join(dataDir, "teaching-course-management.json");
    await writeFile(path, "synthetic invalid JSON");
    await expect(writeTeachingCourseManagementSnapshot({
      dataDir, database: snapshot.database, expectedRevision: snapshot.revision,
    })).rejects.toBeInstanceOf(SyntaxError);
    expect(await readdir(dataDir)).not.toContain(".teaching-course-management-write-lock");
    await writeFile(path, JSON.stringify(snapshot.database));
    await createCourse(dataDir, "Course A");
    expect((await readTeachingCourseManagementDatabase({ dataDir })).courses).toHaveLength(1);
  });
});
