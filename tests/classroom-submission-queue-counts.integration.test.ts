// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { createUaisLearningLoopPostgresReadStore } from "@/lib/learning-loop/postgres-read-store";
import type { LearningSubmissionState } from "@/lib/learning-loop/domain";

const databaseUrl = process.env.UAIS_CLASSROOM_TEST_DATABASE_URL;
const approved = databaseUrl && ["127.0.0.1", "localhost"].includes(new URL(databaseUrl).hostname)
  && /^\/uais_classroom_[a-z_]+$/.test(new URL(databaseUrl).pathname);

describe.skipIf(!approved)("activity queue counts on disposable classroom Postgres", () => {
  let sql: ReturnType<typeof postgres>;
  let store: ReturnType<typeof createUaisLearningLoopPostgresReadStore>;
  const key = `queue-counts-${randomUUID().slice(0, 8)}`;
  const users: string[] = [];
  let courseId: string;
  let teacherId: string;
  let activityId: string;
  let otherActivityId: string;
  let guardVerified = false;
  const members: Record<string, string>[] = [];

  beforeAll(async () => {
    sql = postgres(databaseUrl!, { max: 2, onnotice: () => {} });
    expect(await sql`SELECT environment FROM uais_environment_guard WHERE environment='isolated-uais-db-test' AND enabled`).toHaveLength(1);
    guardVerified = true;
    store = createUaisLearningLoopPostgresReadStore({ env: { UAIS_CORE_DATABASE_URL: databaseUrl! }, createDatabase: () => ({ pooled: true, sql }) });
    const [teacher] = await sql`INSERT INTO uais_users(account,role,display_name,status) VALUES (${key},'teacher','Queue teacher','active') RETURNING id`;
    teacherId = teacher.id; users.push(teacherId);
    const [course] = await sql`INSERT INTO uais_courses(slug,title,teacher_id,status) VALUES (${key},'Queue counts',${teacherId},'published') RETURNING id`;
    courseId = course.id;
    await sql`INSERT INTO uais_classes(course_id,teacher_id,name,external_key) VALUES (${courseId},${teacherId},'Target class',${key})`;
    const [lesson] = await sql`INSERT INTO uais_lessons(course_id,title,position,external_key,status) VALUES (${courseId},'Lesson',1,${key},'published') RETURNING id`;
    const activities = await sql`INSERT INTO uais_assessments(lesson_id,type,title,activity_key,status,target_class_external_id) VALUES (${lesson.id},'assignment','Target',${key},'published',${key}),(${lesson.id},'assignment','Other',${`${key}-other`},'published',${key}) RETURNING id`;
    activityId = activities[0].id; otherActivityId = activities[1].id;
  });
  afterAll(async () => {
    if (guardVerified) {
      await sql`DELETE FROM uais_teaching_course_management_snapshots WHERE snapshot_key=${key}`;
      if (courseId) await sql`DELETE FROM uais_courses WHERE id=${courseId}`;
      for (const id of users) await sql`DELETE FROM uais_users WHERE id=${id}`;
    }
    await sql?.end();
  });

  async function student(name: string, options: { membership?: string; classId?: string; course?: string; status?: string } = {}) {
    const account = `${key}-${name}`;
    const [user] = await sql`INSERT INTO uais_users(account,role,display_name,status) VALUES (${account},'student',${name},${options.status ?? "active"}) RETURNING id`;
    users.push(user.id);
    members.push({ studentId: account, courseId: options.course ?? key, classId: options.classId ?? key, membershipStatus: options.membership ?? "approved" });
    return user.id as string;
  }
  async function submission(userId: string, state: LearningSubmissionState, version = 1, activity = activityId) {
    const [row] = await sql`INSERT INTO uais_submissions(assessment_id,user_id,state,class_external_id,current_version_no) VALUES (${activity},${userId},${state === "accepted" ? "submitted" : state},${key},${version}) RETURNING id`;
    const [current] = await sql`INSERT INTO uais_submission_versions(submission_id,version_no,status,content_text,content_hash,submitted_at) VALUES (${row.id},${version},${state === "draft" ? "draft" : "sealed"},'Evidence',${"a".repeat(64)},${state === "draft" ? null : new Date()}) RETURNING id`;
    if (state === "accepted") await sql`UPDATE uais_submissions SET state='accepted',accepted_version_id=${current.id} WHERE id=${row.id}`;
    return { id: row.id as string, versionId: current.id as string };
  }
  async function feedback(submission: { id: string; versionId: string }, status: string, revision = false, released = true) {
    await sql`INSERT INTO uais_feedback(submission_id,submission_version_id,teacher_user_id,origin,status,feedback_text,requires_revision,released_at) VALUES (${submission.id},${submission.versionId},${teacherId},'teacher',${status},'Teacher feedback',${revision},${released ? new Date() : null})`;
  }

  it("counts approved active students, drafts and released feedback independently of page/state filters", async () => {
    await student("not-started");
    await submission(await student("first-draft"), "draft");
    const submitted = await submission(await student("submitted"), "submitted");
    await feedback(submitted, "draft", false, false);
    const resubmitted = await submission(await student("resubmitted"), "resubmitted", 2);
    await feedback(resubmitted, "superseded");
    const revision = await submission(await student("revision"), "revision_requested");
    await feedback(revision, "released", true);
    const accepted = await submission(await student("accepted"), "accepted");
    await feedback(accepted, "released");
    await feedback(accepted, "released"); // Two feedback records still mean one student.
    const revising = await submission(await student("revising"), "draft", 2);
    const [previous] = await sql`INSERT INTO uais_submission_versions(submission_id,version_no,status,content_text,content_hash,submitted_at) VALUES (${revising.id},1,'sealed','Original',${"b".repeat(64)},now()) RETURNING id`;
    await feedback({ id: revising.id, versionId: previous.id }, "released", true);
    await submission(await student("other-activity"), "accepted", 1, otherActivityId);
    await submission(await student("pending", { membership: "pending-teacher-review" }), "submitted");
    await submission(await student("removed", { membership: "removed" }), "accepted");
    await submission(await student("other-class", { classId: `${key}-other` }), "submitted");
    await submission(await student("other-course", { course: `${key}-other` }), "submitted");
    await submission(await student("disabled", { status: "disabled" }), "submitted");
    const notActivated = await student("not-activated");
    await sql`INSERT INTO uais_classroom_account_onboarding(user_id,provisioned_by,course_key,class_key) VALUES (${notActivated},${key},${key},${key})`;
    members.push({ ...members[0] }); // Duplicate membership must not double count.
    await sql`INSERT INTO uais_teaching_course_management_snapshots(snapshot_key,database,revision) VALUES (${key},${sql.json({ memberships: members })},'test')`;
    const expected = { totalStudents: 8, notSubmitted: 4, submitted: 4, awaitingReview: 2, revisionRequested: 2, feedbackReleased: 4 };
    const first = await store.listActivitySubmissions({ teacherAccount: key, activityId, classExternalId: key, limit: 1 });
    expect(first).toMatchObject({ counts: expected });
    expect(first.submissions).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    const next = await store.listActivitySubmissions({ teacherAccount: key, activityId, classExternalId: key, limit: 1, cursor: first.nextCursor! });
    expect(next).toMatchObject({ counts: expected });
    const filtered = await store.listActivitySubmissions({ teacherAccount: key, activityId, classExternalId: key, state: "draft", limit: 1 });
    expect(filtered).toMatchObject({ counts: expected });
    expect(filtered.submissions[0].state).toBe("draft");
    const other = await store.listActivitySubmissions({ teacherAccount: key, activityId: otherActivityId, classExternalId: key });
    expect(other).toMatchObject({ counts: { totalStudents: 8, notSubmitted: 7, submitted: 1, feedbackReleased: 0 } });
  });
});
