// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import sharp from "sharp";
import { createSubmissionImageStore } from "@/lib/learning-loop/submission-image-store";
import { createUaisLearningLoopPostgresStore } from "@/lib/learning-loop/postgres-store";

const databaseUrl = process.env.UAIS_CLASSROOM_TEST_DATABASE_URL;
const approved = databaseUrl && ["127.0.0.1", "localhost"].includes(new URL(databaseUrl).hostname)
  && /^\/uais_classroom_[a-z_]+$/.test(new URL(databaseUrl).pathname);

describe.skipIf(!approved)("private submission images on disposable Postgres", () => {
  const env = { UAIS_CORE_DATABASE_URL: databaseUrl! };
  let sql: ReturnType<typeof postgres>;
  let images: ReturnType<typeof createSubmissionImageStore>;
  let commands: ReturnType<typeof createUaisLearningLoopPostgresStore>;
  let png: Buffer;
  const fixtureUsers: string[] = [];
  const fixtureCourses: string[] = [];
  beforeAll(async () => {
    sql = postgres(databaseUrl!, { max: 2 });
    const createDatabase = () => ({ pooled: true, sql });
    images = createSubmissionImageStore({ env, createDatabase });
    commands = createUaisLearningLoopPostgresStore({ env, createDatabase });
    const guards = await sql`SELECT environment FROM uais_environment_guard WHERE environment='isolated-uais-db-test' AND enabled`;
    expect(guards).toHaveLength(1);
    png = await sharp({ create: { width: 80, height: 60, channels: 3, background: "white" } }).png().toBuffer();
  });
  afterAll(async () => {
    for (const id of fixtureCourses) await sql`DELETE FROM uais_courses WHERE id=${id}`;
    for (const id of fixtureUsers) await sql`DELETE FROM uais_users WHERE id=${id}`;
    await sql.end();
  });

  async function fixture() {
    const key = `images-${randomUUID().slice(0, 8)}`;
    const teacher = `teacher-${key}`, student = `student-${key}`;
    const users = await sql`INSERT INTO uais_users(account,role,display_name,status) VALUES (${teacher},'teacher','Image teacher','active'),(${student},'student','Image student','active') RETURNING id,account`;
    fixtureUsers.push(...users.map(u => u.id));
    const teacherId = users.find(u => u.account === teacher)!.id;
    const studentId = users.find(u => u.account === student)!.id;
    const [course] = await sql`INSERT INTO uais_courses(slug,title,teacher_id,status) VALUES (${key},'Image lesson',${teacherId},'published') RETURNING id`;
    fixtureCourses.push(course.id);
    await sql`INSERT INTO uais_classes(course_id,teacher_id,name,external_key) VALUES (${course.id},${teacherId},'Pilot',${key})`;
    const [lesson] = await sql`INSERT INTO uais_lessons(course_id,title,position,external_key,status) VALUES (${course.id},'Proof',1,${key},'published') RETURNING id`;
    const activityId = randomUUID();
    await sql`INSERT INTO uais_assessments(id,lesson_id,type,title,activity_key,status,target_class_external_id) VALUES (${activityId},${lesson.id},'assignment','Proof',${activityId},'published',${key})`;
    await sql`INSERT INTO uais_formative_attempts(assessment_id,user_id,class_external_id,attempt_no,response_json,response_hash) VALUES (${activityId},${studentId},${key},1,'{}',${"a".repeat(64)})`;
    const saved = await commands.saveSubmissionDraft({ studentAccount: student, activityId, classExternalId: key, contentText: "", expectedDraftRevision: 0, expectedSubmissionVersionId: null, traceId: key });
    return { key, teacher, student, activityId, versionId: saved.submissionVersionId! };
  }

  it("uploads at most three images, replays a lost reply once, and never exposes bytes to another actor", async () => {
    const f = await fixture();
    const clientAttachmentId = randomUUID();
    const input = { studentAccount: f.student, activityId: f.activityId, classExternalId: f.key,
      submissionVersionId: f.versionId, expectedDraftRevision: 1, clientAttachmentId, bytes: png, mime: "image/png" };
    const first = await images.upload(input);
    expect(first.revision).toBe(2);
    expect((await images.upload(input)).attachment.id).toBe(first.attachment.id);
    expect((await images.read({ attachmentId: first.attachment.id, actorAccount: f.student, role: "student" })).bytes.length).toBeGreaterThan(0);
    expect((await images.read({ attachmentId: first.attachment.id, actorAccount: f.teacher, role: "teacher" })).attachment.id).toBe(first.attachment.id);
    await expect(images.read({ attachmentId: first.attachment.id, actorAccount: "someone-else", role: "student" })).rejects.toThrow("submission-image-not-found");
    const second = await images.upload({ ...input, clientAttachmentId: randomUUID(), expectedDraftRevision: 2 });
    const third = await images.upload({ ...input, clientAttachmentId: randomUUID(), expectedDraftRevision: 3 });
    expect(third.revision).toBe(4);
    await expect(images.upload({ ...input, clientAttachmentId: randomUUID(), expectedDraftRevision: 4 })).rejects.toThrow("submission-image-count-limit");
    await images.remove({ studentAccount: f.student, activityId: f.activityId, classExternalId: f.key, submissionVersionId: f.versionId, expectedDraftRevision: 4, attachmentId: second.attachment.id });
    expect((await images.list(f.versionId)).length).toBe(2);
  });

  it("seals image-only evidence, replays submission, and rejects subsequent image changes", async () => {
    const f = await fixture();
    const upload = await images.upload({ studentAccount: f.student, activityId: f.activityId, classExternalId: f.key,
      submissionVersionId: f.versionId, expectedDraftRevision: 1, clientAttachmentId: randomUUID(), bytes: png, mime: "image/png" });
    const submission = { studentAccount: f.student, activityId: f.activityId, classExternalId: f.key,
      expectedSubmissionVersionId: f.versionId, expectedDraftRevision: 2, idempotencyKey: `seal-${randomUUID()}`, traceId: f.key };
    const receipt = await commands.submitSubmission(submission);
    expect(receipt.state).toBe("submitted");
    expect(await commands.submitSubmission(submission)).toEqual(receipt);
    const [version] = await sql`SELECT status,evidence_hash FROM uais_submission_versions WHERE id=${f.versionId}`;
    expect(version.evidence_hash).toMatch(/^[a-f0-9]{64}$/);
    await expect(images.remove({ studentAccount: f.student, activityId: f.activityId, classExternalId: f.key,
      submissionVersionId: f.versionId, expectedDraftRevision: 2, attachmentId: upload.attachment.id })).rejects.toThrow("submission-version-sealed");
  });

  it("refuses an entirely empty sealed submission", async () => {
    const f = await fixture();
    await expect(commands.submitSubmission({ studentAccount: f.student, activityId: f.activityId, classExternalId: f.key,
      expectedSubmissionVersionId: f.versionId, expectedDraftRevision: 1, idempotencyKey: randomUUID(), traceId: f.key })).rejects.toThrow("submission-evidence-required");
  });
});
