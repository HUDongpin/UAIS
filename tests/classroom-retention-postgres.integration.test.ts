// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import * as retention from "@/lib/server/classroom-record-retention-store";

const target = process.env.UAIS_CLASSROOM_CHAT_TEST_DATABASE_URL;
describe.skipIf(!target)("classroom retention on isolated Postgres", () => {
  const configuredTarget = target ?? "postgres://unused@127.0.0.1:1/skipped";
  if (!["127.0.0.1", "localhost"].includes(new URL(configuredTarget).hostname))
    throw new Error("Only the explicit disposable local DB is allowed");
  const sql = postgres(configuredTarget, { max: 2 });
  const courseId = `retention-${randomUUID()}`;
  const snapshotOnlyCourseId = `${courseId}-snapshot-only`;
  const teacherAccount = `teacher-${randomUUID()}`;
  const studentAccount = `student-${randomUUID()}`;
  const actorIds: string[] = [];
  let coreCourseId: string;
  let feedbackId: string;
  let now = new Date("2026-01-01T12:00:00Z");
  const store = () => {
    expect(retention.createClassroomRecordRetentionStore).toBeTypeOf(
      "function",
    );
    return retention.createClassroomRecordRetentionStore({
      env: { UAIS_CORE_DATABASE_URL: configuredTarget },
      now: () => now,
      createDatabase: () => ({ pooled: true, sql }),
    });
  };
  beforeAll(async () => {
    expect(
      await sql`SELECT environment FROM uais_environment_guard WHERE environment='isolated-uais-db-test' AND enabled`,
    ).toHaveLength(1);
    const users =
      await sql`INSERT INTO uais_users(account, role, display_name, status) VALUES (${teacherAccount}, 'teacher', 'Retention teacher', 'active'), (${studentAccount}, 'student', 'Retention student', 'active') RETURNING id, account`;
    actorIds.push(...users.map((user) => user.id));
    const teacher = users.find((user) => user.account === teacherAccount)!.id;
    const student = users.find((user) => user.account === studentAccount)!.id;
    const [course] =
      await sql`INSERT INTO uais_courses(slug,title,teacher_id,status) VALUES (${courseId},'Retained course content',${teacher},'published') RETURNING id`;
    coreCourseId = course.id;
    await sql`INSERT INTO uais_teaching_course_management_snapshots(snapshot_key,database,revision,updated_at) VALUES (${courseId},${JSON.stringify(
      {
        courses: [{ courseId, ownerTeacherId: teacherAccount }],
        memberships: [],
        auditEvents: [
          {
            courseId,
            action: "publish-course-content",
            actorId: teacherAccount,
          },
          { courseId, action: "join-class-by-invite", actorId: studentAccount },
        ],
      },
    )}::text::jsonb,'owner-fixture',now())`;
    await sql`INSERT INTO uais_teaching_course_management_snapshots(snapshot_key,database,revision,updated_at) VALUES (${snapshotOnlyCourseId},${JSON.stringify({ courses: [{ courseId: snapshotOnlyCourseId, ownerTeacherId: teacherAccount }], memberships: [{ courseId: snapshotOnlyCourseId, studentId: studentAccount }] })}::text::jsonb,'owner-fixture',now())`;
    const [lesson] =
      await sql`INSERT INTO uais_lessons(course_id,title,position,status,external_key) VALUES (${coreCourseId},'Retained lesson',1,'published',${courseId}) RETURNING id`;
    const [activity] =
      await sql`INSERT INTO uais_assessments(lesson_id,type,title,status) VALUES (${lesson.id},'assignment','Evidence','published') RETURNING id`;
    const [submission] =
      await sql`INSERT INTO uais_submissions(assessment_id,user_id,state,current_version_no) VALUES (${activity.id},${student},'submitted',1) RETURNING id`;
    const [version] =
      await sql`INSERT INTO uais_submission_versions(submission_id,version_no,status,content_text,content_hash,draft_revision,submitted_at) VALUES (${submission.id},1,'sealed','Private classroom text',${"a".repeat(64)},1,now()) RETURNING id`;
    await sql`UPDATE uais_submissions SET accepted_version_id=${version.id},state='accepted' WHERE id=${submission.id}`;
    const [feedback] =
      await sql`INSERT INTO uais_feedback(submission_id,submission_version_id,teacher_user_id,origin,status,feedback_text,released_at) VALUES (${submission.id},${version.id},${teacher},'teacher','released','Private feedback',now()) RETURNING id`;
    feedbackId = feedback.id;
    await sql`INSERT INTO uais_submission_attachments(submission_version_id,client_attachment_id,position,mime,byte_length,width,height,sha256,content) VALUES (${version.id},${randomUUID()},1,'image/png',1,1,1,${"b".repeat(64)},${Buffer.from([1])})`;
    const copy = {
      schemaVersion: "uais-teaching-operations-v1",
      records: [
        {
          courseId,
          operationId: "grading",
          content: "Private old grading record",
        },
        {
          courseId,
          operationId: "content",
          content: "Preserve publication provenance",
        },
        { courseId: "unrelated-course", content: "Keep other course" },
      ],
    };
    await sql`INSERT INTO uais_teaching_operations_snapshots(snapshot_key,database,revision,updated_at) VALUES (${courseId},${JSON.stringify(copy)}::text::jsonb,'retention-fixture',now())`;
    await sql`INSERT INTO uais_teaching_course_management_snapshots_retired(snapshot_key,database,revision,updated_at) VALUES (${courseId},${JSON.stringify(
      {
        courses: [{ courseId, title: "Preserve this content" }],
        memberships: [
          { courseId, studentId: "private-student" },
          { courseId: "unrelated-course", studentId: "unrelated-student" },
        ],
        auditEvents: [
          {
            courseId,
            action: "publish-course-content",
            actorId: teacherAccount,
          },
          { courseId, action: "join-class-by-invite", actorId: studentAccount },
        ],
      },
    )}::text::jsonb,'retention-fixture',now())`;
    await sql`INSERT INTO uais_audit_log(actor_id,action,target_type,target_id,metadata) VALUES (${teacher},'publish-course-content','course',${courseId},${JSON.stringify({ courseId })}::text::jsonb)`;
  });
  afterAll(async () => {
    await sql`DELETE FROM uais_feedback WHERE id=${feedbackId ?? randomUUID()}`;
    if (coreCourseId) {
      await sql`UPDATE uais_submissions SET accepted_version_id=NULL,current_version_no=0 WHERE assessment_id IN (SELECT a.id FROM uais_assessments a JOIN uais_lessons l ON l.id=a.lesson_id WHERE l.course_id=${coreCourseId})`;
      await sql`DELETE FROM uais_courses WHERE id=${coreCourseId}`;
    }
    await sql`DELETE FROM uais_course_record_retention WHERE course_external_id=${courseId}`;
    await sql`DELETE FROM uais_course_record_retention WHERE course_external_id=${snapshotOnlyCourseId}`;
    await sql`DELETE FROM uais_teaching_course_management_snapshots WHERE snapshot_key IN (${courseId},${snapshotOnlyCourseId})`;
    await sql`DELETE FROM uais_audit_log WHERE target_id=${courseId}`;
    await sql`DELETE FROM uais_audit_log WHERE target_id=${snapshotOnlyCourseId}`;
    await sql`DELETE FROM uais_teaching_operations_snapshots WHERE snapshot_key=${courseId}`;
    await sql`DELETE FROM uais_teaching_course_management_snapshots_retired WHERE snapshot_key=${courseId}`;
    for (const id of actorIds) await sql`DELETE FROM uais_users WHERE id=${id}`;
    await sql.end();
  });
  it("requires the owner and refuses deletion before the 180-day period expires", async () => {
    const service = store();
    await expect(
      service.close({ courseId, teacherAccount: studentAccount }),
    ).rejects.toMatchObject({ status: 403 });
    const state = await service.close({ courseId, teacherAccount });
    expect(state.closedAt).toBe(now.toISOString());
    expect(state.purgeAfter).toBe("2026-06-30T12:00:00.000Z");
    expect(state.counts.submissions).toBe(1);
    expect(state.counts.images).toBe(1);
    await expect(
      service.purge({
        courseId,
        teacherAccount,
        confirmationDigest: state.confirmationDigest,
      }),
    ).rejects.toMatchObject({ reasonCode: "course-retention-not-expired" });
  });
  it("reads and closes a newly created owned course before a lesson creates its normalized projection", async () => {
    const service = store();
    const state = await service.read({
      courseId: snapshotOnlyCourseId,
      teacherAccount,
    });
    expect(state.counts.submissions).toBe(0);
    expect(state.counts.courseSnapshotRecords).toBe(1);
    expect(state.closedAt).toBeNull();
    const closed = await service.close({
      courseId: snapshotOnlyCourseId,
      teacherAccount,
    });
    expect(closed.closedAt).toBe(now.toISOString());
    expect(
      await sql`SELECT id FROM uais_courses WHERE slug=${snapshotOnlyCourseId}`,
    ).toHaveLength(0);
  });
  it("requires a fresh preview and removes private evidence while preserving accounts and lesson content", async () => {
    now = new Date("2026-07-01T12:00:00Z");
    const service = store();
    const preview = await service.read({ courseId, teacherAccount });
    expect(preview.eligibleForPurge).toBe(true);
    await sql`UPDATE uais_feedback SET feedback_text='Changed after preview', updated_at=now() + interval '1 second' WHERE id=${feedbackId}`;
    await expect(
      service.purge({
        courseId,
        teacherAccount,
        confirmationDigest: preview.confirmationDigest,
      }),
    ).rejects.toMatchObject({ reasonCode: "course-retention-preview-stale" });
    const fresh = await service.read({ courseId, teacherAccount });
    const purged = await service.purge({
      courseId,
      teacherAccount,
      confirmationDigest: fresh.confirmationDigest,
    });
    expect(purged.purgedAt).toBe(now.toISOString());
    expect(purged.counts.submissions).toBe(0);
    expect(purged.counts.images).toBe(0);
    expect(
      await sql`SELECT id FROM uais_users WHERE id=ANY(${actorIds})`,
    ).toHaveLength(2);
    expect(
      await sql`SELECT id FROM uais_lessons WHERE course_id=${coreCourseId}`,
    ).toHaveLength(1);
    const [legacy] =
      await sql`SELECT database FROM uais_teaching_operations_snapshots WHERE snapshot_key=${courseId}`;
    expect(legacy.database.records).toEqual([
      {
        courseId,
        operationId: "content",
        content: "Preserve publication provenance",
      },
      { courseId: "unrelated-course", content: "Keep other course" },
    ]);
    const [retired] =
      await sql`SELECT database FROM uais_teaching_course_management_snapshots_retired WHERE snapshot_key=${courseId}`;
    expect(retired.database.memberships).toEqual([
      { courseId: "unrelated-course", studentId: "unrelated-student" },
    ]);
    expect(retired.database.courses).toHaveLength(1);
    expect(retired.database.auditEvents).toEqual([
      { courseId, action: "publish-course-content", actorId: teacherAccount },
    ]);
    const [currentSnapshot] =
      await sql`SELECT database FROM uais_teaching_course_management_snapshots WHERE snapshot_key=${courseId}`;
    expect(currentSnapshot.database.auditEvents).toEqual([
      { courseId, action: "publish-course-content", actorId: teacherAccount },
    ]);
    expect(
      await sql`SELECT id FROM uais_audit_log WHERE target_id=${courseId} AND action='publish-course-content'`,
    ).toHaveLength(1);
    await expect(
      sql.begin((tx) =>
        retention.assertClassroomRecordWriteAllowed(tx, courseId, {
          allowClosed: true,
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "course-records-purged" });
  });
});
