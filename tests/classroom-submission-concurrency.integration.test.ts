// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import sharp from "sharp";
import { createSubmissionImageStore } from "@/lib/learning-loop/submission-image-store";
import { createUaisLearningLoopPostgresStore } from "@/lib/learning-loop/postgres-store";

const url = process.env.UAIS_CLASSROOM_ACCOUNTS_TEST_URL;
const approved = url && new URL(url).hostname === "127.0.0.1" && new URL(url).pathname === "/uais_classroom_accounts";
describe.skipIf(!approved)("classroom image transactions under real concurrent requests", () => {
  let sql: ReturnType<typeof postgres>;
  let images: ReturnType<typeof createSubmissionImageStore>;
  let commands: ReturnType<typeof createUaisLearningLoopPostgresStore>;
  const courseIds: string[] = [], userIds: string[] = [];
  let png: Buffer;
  beforeAll(async () => {
    sql = postgres(url!, { max: 12, onnotice: () => {} });
    const env = { UAIS_CORE_DATABASE_URL: url! }, createDatabase = () => ({ pooled: true, sql });
    images = createSubmissionImageStore({ env, createDatabase });
    commands = createUaisLearningLoopPostgresStore({ env, createDatabase });
    expect(await sql`SELECT environment FROM uais_environment_guard WHERE environment='isolated-uais-db-test' AND enabled`).toHaveLength(1);
    const [schema] = await sql`SELECT to_regclass('uais_lesson_versions') AS lessons`;
    if (!schema.lessons) await sql.unsafe(await readFile("migrations/0013_classroom_lessons.sql", "utf8"));
    await sql.unsafe(await readFile("migrations/0015_classroom_chat_retention.sql", "utf8"));
    await sql.unsafe(await readFile("migrations/0016_classroom_submission_images.sql", "utf8"));
    png = await sharp({ create: { width: 64, height: 48, channels: 3, background: "white" } }).png().toBuffer();
  });
  afterAll(async () => {
    for (const id of courseIds) await sql`DELETE FROM uais_courses WHERE id=${id}`;
    for (const id of userIds) await sql`DELETE FROM uais_users WHERE id=${id}`;
    await sql?.end();
  });
  async function fixture(count = 1) {
    const key = `image-race-${randomUUID().slice(0, 8)}`, teacher = `t-${key}`;
    const [teacherRow] = await sql`INSERT INTO uais_users(account,role,display_name,status) VALUES (${teacher},'teacher','Teacher','active') RETURNING id`; userIds.push(teacherRow.id);
    const [course] = await sql`INSERT INTO uais_courses(slug,title,teacher_id,status) VALUES (${key},'Concurrent images',${teacherRow.id},'published') RETURNING id`; courseIds.push(course.id);
    await sql`INSERT INTO uais_classes(course_id,teacher_id,name,external_key) VALUES (${course.id},${teacherRow.id},'Class',${key})`;
    const [lesson] = await sql`INSERT INTO uais_lessons(course_id,title,position,external_key,status) VALUES (${course.id},'Lesson',1,${key},'published') RETURNING id`;
    const rubric = ["reasoning", "evidence", "clarity"].map(id => ({ id, label: { "zh-CN": id, "en-US": id } }));
    const [activity] = await sql`INSERT INTO uais_assessments(lesson_id,type,title,activity_key,status,target_class_external_id,rubric) VALUES (${lesson.id},'assignment','Proof',${key},'published',${key},${sql.json(rubric)}) RETURNING id`;
    const students = [];
    for (let i = 0; i < count; i++) {
      const account = `s-${i}-${key}`;
      const [user] = await sql`INSERT INTO uais_users(account,role,display_name,status) VALUES (${account},'student','Student','active') RETURNING id`; userIds.push(user.id);
      await sql`INSERT INTO uais_formative_attempts(assessment_id,user_id,class_external_id,attempt_no,response_json,response_hash) VALUES (${activity.id},${user.id},${key},1,'{}',${"a".repeat(64)})`;
      students.push({ account, userId: user.id });
    }
    return { key, teacher, activityId: activity.id as string, students };
  }
  async function draft(f: Awaited<ReturnType<typeof fixture>>, index = 0) {
    const account = f.students[index].account;
    const saved = await commands.saveSubmissionDraft({ studentAccount: account, activityId: f.activityId, classExternalId: f.key, contentText: "", expectedDraftRevision: 0, expectedSubmissionVersionId: null, traceId: f.key });
    return { studentAccount: account, activityId: f.activityId, classExternalId: f.key, submissionVersionId: saved.submissionVersionId!, expectedDraftRevision: 1, bytes: png, mime: "image/png", submissionId: saved.resourceId };
  }
  it("serializes competing uploads and caps three distinct images even after retry", async () => {
    const f = await fixture(), base = await draft(f);
    const outcomes = await Promise.allSettled(Array.from({ length: 6 }, () => images.upload({ ...base, clientAttachmentId: randomUUID() })));
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(result => result.status === "rejected").every(result => result.status === "rejected" && result.reason.reasonCode === "stale-draft-revision")).toBe(true);
    const retry = async (id: string) => {
      for (let attempt = 0; attempt < 10; attempt++) {
        const [version] = await sql`SELECT draft_revision FROM uais_submission_versions WHERE id=${base.submissionVersionId}`;
        try { return await images.upload({ ...base, expectedDraftRevision: version.draft_revision, clientAttachmentId: id }); }
        catch (error) { if ((error as { reasonCode?: string }).reasonCode !== "stale-draft-revision") throw error; }
      }
      throw Error("retry-budget-exhausted");
    };
    const retries = await Promise.allSettled(Array.from({ length: 5 }, () => retry(randomUUID())));
    expect(retries.filter(result => result.status === "fulfilled")).toHaveLength(2);
    expect(retries.filter(result => result.status === "rejected").every(result => result.status === "rejected" && result.reason.reasonCode === "submission-image-count-limit")).toBe(true);
    const stored = await images.list(base.submissionVersionId);
    expect(stored).toHaveLength(3); expect(new Set(stored.map(item => item.id)).size).toBe(3);
  });
  it("replays duplicate upload requests with a single stable attachment and revision", async () => {
    const f = await fixture(), base = await draft(f), clientAttachmentId = randomUUID();
    const receipts = await Promise.all(Array.from({ length: 4 }, () => images.upload({ ...base, clientAttachmentId })));
    expect(new Set(receipts.map(item => item.attachment.id)).size).toBe(1);
    expect(receipts.every(item => item.revision === 2)).toBe(true);
    expect(await images.list(base.submissionVersionId)).toHaveLength(1);
  });
  it("preserves sealed hashes and images across revision, refusing stale and sealed mutations", async () => {
    const f = await fixture(), base = await draft(f);
    const image = await images.upload({ ...base, clientAttachmentId: randomUUID() });
    const sealed = await commands.submitSubmission({ ...base, expectedSubmissionVersionId: base.submissionVersionId, expectedDraftRevision: 2, idempotencyKey: randomUUID(), traceId: f.key });
    const [original] = await sql`SELECT content_hash,evidence_hash,status FROM uais_submission_versions WHERE id=${base.submissionVersionId}`;
    await expect(images.upload({ ...base, expectedDraftRevision: 2, clientAttachmentId: randomUUID() })).rejects.toMatchObject({ reasonCode: "submission-version-sealed" });
    await expect(images.remove({ ...base, expectedDraftRevision: 2, attachmentId: image.attachment.id })).rejects.toMatchObject({ reasonCode: "submission-version-sealed" });
    await commands.decideSubmission({ teacherAccount: f.teacher, submissionId: sealed.resourceId, expectedSubmissionVersionId: base.submissionVersionId, decision: "request-revision", feedbackText: "Please explain the new term.", rubricJudgments: { reasoning: "needs-revision", evidence: "met", clarity: "partly-met" }, origin: "teacher", idempotencyKey: randomUUID(), traceId: f.key });
    const revised = await commands.saveSubmissionDraft({ ...base, contentText: "The new term is 2k+1.", expectedDraftRevision: 0, expectedSubmissionVersionId: base.submissionVersionId, traceId: f.key });
    const copied = await images.list(revised.submissionVersionId!);
    expect(copied).toHaveLength(1); expect(copied[0].sha256).toBe(image.attachment.sha256); expect(copied[0].id).not.toBe(image.attachment.id);
    await images.remove({ ...base, submissionVersionId: revised.submissionVersionId!, expectedDraftRevision: 1, attachmentId: copied[0].id });
    expect(await images.list(base.submissionVersionId)).toHaveLength(1);
    expect((await sql`SELECT content_hash,evidence_hash,status FROM uais_submission_versions WHERE id=${base.submissionVersionId}`)[0]).toEqual(original);
  });
  it("commits thirty simultaneously started save/upload/seal journeys and reconciles every receipt", async () => {
    const f = await fixture(30);
    const durations: number[] = [];
    const timed = async <T>(run: () => Promise<T>) => { const start = performance.now(); const value = await run(); durations.push(performance.now() - start); return value; };
    const results = await Promise.all(f.students.map(async (_, index) => {
      const base = await timed(() => draft(f, index));
      const upload = await images.upload({ ...base, clientAttachmentId: randomUUID() });
      const input = { studentAccount: base.studentAccount, activityId: f.activityId, classExternalId: f.key, expectedSubmissionVersionId: base.submissionVersionId, expectedDraftRevision: upload.revision, idempotencyKey: randomUUID(), traceId: f.key };
      const receipt = await timed(() => commands.submitSubmission(input));
      expect(await commands.submitSubmission(input)).toEqual(receipt);
      return { ...receipt, confirmedVersionId: base.submissionVersionId };
    }));
    expect(new Set(results.map(result => result.resourceId)).size).toBe(30);
    const actual = await sql`SELECT s.id,s.state,v.id AS version_id,v.status,v.evidence_hash,(SELECT count(*)::integer FROM uais_submission_attachments i WHERE i.submission_version_id=v.id) AS images FROM uais_submissions s JOIN uais_submission_versions v ON v.submission_id=s.id WHERE s.assessment_id=${f.activityId}`;
    expect(actual).toHaveLength(30);
    for (const receipt of results) expect(actual.find(row => row.id === receipt.resourceId)).toMatchObject({ state: "submitted", status: "sealed", version_id: receipt.confirmedVersionId, images: 1 });
    expect(actual.every(row => /^[a-f0-9]{64}$/.test(row.evidence_hash))).toBe(true);
    const p95 = durations.sort((a,b) => a-b)[Math.ceil(durations.length * .95) - 1];
    console.info(`Isolated database only: 30 concurrent journeys, 60 save/seal calls, p95 ${Math.round(p95)}ms; no HTTP/browser/network latency included.`);
    expect(p95).toBeLessThan(2000);
  }, 30000);
  it("returns the same receipt for simultaneous duplicate seal requests", async () => {
    const f = await fixture(), base = await draft(f);
    await images.upload({ ...base, clientAttachmentId: randomUUID() });
    const input = { ...base, expectedSubmissionVersionId: base.submissionVersionId, expectedDraftRevision: 2, idempotencyKey: randomUUID(), traceId: f.key };
    const receipts = await Promise.all(Array.from({ length: 4 }, () => commands.submitSubmission(input)));
    expect(receipts.every(receipt => receipt.resourceId === receipts[0].resourceId)).toBe(true);
  });
});
