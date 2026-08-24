import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getUaisCoreDatabasePool,
  resetUaisCoreDatabasePoolForTesting,
} from "@/lib/db/core-database";
import { createUaisLearningLoopPostgresReadStore } from "@/lib/learning-loop/postgres-read-store";
import { createUaisLearningLoopPostgresStore } from "@/lib/learning-loop/postgres-store";
import { authorizeLiveDatabaseTestFile } from "../scripts/run-db-tests.mjs";

const authorization = await authorizeLiveDatabaseTestFile({
  env: process.env,
  lane: "legacy",
  testFile: "tests/learning-loop-postgres-integration.test.ts",
});
if (authorization.exitCode !== 0) {
  throw new Error(`UAIS_DB_TEST ${JSON.stringify(authorization.report)}`);
}
const databaseUrl = authorization.databaseUrl ?? "";

describe("P1 closed learning loop on real Postgres", () => {
  const env = { UAIS_CORE_DATABASE_URL: databaseUrl };
  const suffix = randomUUID().replace(/-/g, "");
  const teacherAccount = `p1.teacher.${suffix}`;
  const studentAccount = `p1.student.${suffix}`;
  const courseId = `p1-course-${suffix}`;
  const classId = `p1-class-${suffix}`;
  const lessonKey = `p1-lesson-${suffix}`;
  const tracePrefix = `p1-db-${suffix}`;
  const draft = {
    lessonKey,
    targetClassId: classId,
    title: { "zh-CN": "证据论证", "en-US": "Evidence argument" },
    instructions: { "zh-CN": "提交结构化论证。", "en-US": "Submit a structured argument." },
    checkpoint: {
      kind: "short-answer" as const,
      prompt: { "zh-CN": "什么是证据？", "en-US": "What is evidence?" },
      explanation: { "zh-CN": "证据支持主张。", "en-US": "Evidence supports a claim." },
    },
    rubric: [
      { id: "claim", label: { "zh-CN": "主张", "en-US": "Claim" } },
      { id: "evidence", label: { "zh-CN": "证据", "en-US": "Evidence" } },
      { id: "reasoning", label: { "zh-CN": "推理", "en-US": "Reasoning" } },
    ],
    aiPolicy: "teacher-requested-draft" as const,
    revisionPolicy: "teacher-requested" as const,
    status: "draft" as const,
    version: 1 as const,
  };
  const judgments = {
    claim: "met" as const,
    evidence: "partly-met" as const,
    reasoning: "needs-revision" as const,
  };
  let activityId = "";
  let submissionId = "";
  let guardApproved = false;

  beforeAll(async () => {
    const guardSql = postgres(databaseUrl!, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
    });
    try {
      const rows = await guardSql`
        SELECT environment
        FROM uais_environment_guard
        WHERE environment = 'isolated-uais-db-test' AND enabled = true
        LIMIT 1
      `;
      if (rows.length !== 1) {
        throw new Error(
          "isolated-uais-db-test guard row required before migrations or writes",
        );
      }
      guardApproved = true;
    } finally {
      await guardSql.end({ timeout: 5 });
    }
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    await promisify(execFile)(process.execPath, ["scripts/apply-core-migrations.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, UAIS_CORE_DATABASE_URL: databaseUrl } as NodeJS.ProcessEnv,
    });
    const client = getUaisCoreDatabasePool({ env });
    await client.sql`
      INSERT INTO uais_users (account, role, display_name, department, status)
      VALUES
        (${teacherAccount}, 'teacher', 'P1 Integration Teacher', 'Integration', 'active'),
        (${studentAccount}, 'student', 'P1 Integration Student', 'Integration', 'active')
    `;
  }, 180_000);

  afterAll(async () => {
    if (!guardApproved) return;
    const client = getUaisCoreDatabasePool({ env });
    await client.sql`DELETE FROM uais_courses WHERE slug = ${courseId}`;
    await client.sql`
      DELETE FROM uais_audit_log
      WHERE trace_id LIKE ${`${tracePrefix}%`}
    `;
    await client.sql`
      DELETE FROM uais_users WHERE account IN (${teacherAccount}, ${studentAccount})
    `;
    await resetUaisCoreDatabasePoolForTesting();
  }, 60_000);

  it("migrates through 0009 and completes V1 feedback, V2 revision and teacher acceptance atomically", async () => {
    const command = createUaisLearningLoopPostgresStore({ env });
    const read = createUaisLearningLoopPostgresReadStore({ env });
    const created = await command.createActivity({
      teacherAccount,
      course: { externalId: courseId, title: "P1 Integration Course" },
      class: { externalId: classId, name: "P1 Integration Class" },
      lesson: {
        key: lessonKey,
        position: 1,
        title: { "zh-CN": "第一单元", "en-US": "Unit one" },
        manifestRef: `manifest-${suffix}`,
      },
      draft,
      idempotencyKey: `create-${suffix}`,
      traceId: `${tracePrefix}-create`,
    });
    activityId = created.resourceId;
    await command.updateActivity({
      teacherAccount,
      activityId,
      expectedEditRevision: 1,
      operation: "publish",
      idempotencyKey: `publish-${suffix}`,
      traceId: `${tracePrefix}-publish`,
    });
    await command.recordFormativeAttempt({
      studentAccount,
      activityId,
      classExternalId: classId,
      response: { kind: "short-answer", text: "可检查的证据" },
      idempotencyKey: `checkpoint-${suffix}`,
      traceId: `${tracePrefix}-checkpoint`,
    });

    const concurrentDrafts = await Promise.allSettled([
      command.saveSubmissionDraft({ studentAccount, activityId, classExternalId: classId, contentText: "设备 A 的 V1 正文", expectedDraftRevision: 0, traceId: `${tracePrefix}-draft-a` }),
      command.saveSubmissionDraft({ studentAccount, activityId, classExternalId: classId, contentText: "设备 B 的 V1 正文", expectedDraftRevision: 0, traceId: `${tracePrefix}-draft-b` }),
    ]);
    expect(concurrentDrafts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrentDrafts.filter((result) => result.status === "rejected")).toHaveLength(1);
    const draftReceipt = concurrentDrafts.find((result) => result.status === "fulfilled");
    expect(draftReceipt?.status).toBe("fulfilled");
    if (!draftReceipt || draftReceipt.status !== "fulfilled") throw new Error("draft receipt required");
    submissionId = draftReceipt.value.resourceId;

    const submittedV1 = await command.submitSubmission({
      studentAccount,
      activityId,
      classExternalId: classId,
      expectedDraftRevision: draftReceipt.value.revision,
      idempotencyKey: `submit-v1-${suffix}`,
      traceId: `${tracePrefix}-submit-v1`,
    });
    const replayedV1 = await command.submitSubmission({
      studentAccount,
      activityId,
      classExternalId: classId,
      expectedDraftRevision: draftReceipt.value.revision,
      idempotencyKey: `submit-v1-${suffix}`,
      traceId: `${tracePrefix}-submit-v1-replay`,
    });
    expect(replayedV1.resourceId).toBe(submittedV1.resourceId);
    expect(replayedV1.eventId).toBe(submittedV1.eventId);

    const detailV1 = await read.readTeacherSubmission({ teacherAccount, submissionId });
    await expect(command.decideSubmission({
      teacherAccount,
      submissionId,
      expectedSubmissionVersionId: detailV1.currentVersionId,
      decision: "accept",
      feedbackText: "无效量规应使事务回滚。",
      rubricJudgments: {},
      origin: "teacher",
      idempotencyKey: `invalid-decision-${suffix}`,
      traceId: `${tracePrefix}-invalid-decision`,
    })).rejects.toThrow();
    const afterRollback = await read.readTeacherSubmission({ teacherAccount, submissionId });
    expect(afterRollback.state).toBe("submitted");
    expect(afterRollback.feedback).toHaveLength(0);

    await command.decideSubmission({
      teacherAccount,
      submissionId,
      expectedSubmissionVersionId: detailV1.currentVersionId,
      decision: "request-revision",
      feedbackText: "请补充证据与推理。",
      rubricJudgments: judgments,
      origin: "teacher",
      idempotencyKey: `revision-v1-${suffix}`,
      traceId: `${tracePrefix}-revision-v1`,
    });
    const draftV2 = await command.saveSubmissionDraft({
      studentAccount,
      activityId,
      classExternalId: classId,
      contentText: "V2 已补充证据与推理。",
      expectedDraftRevision: 0,
      traceId: `${tracePrefix}-draft-v2`,
    });
    await command.submitSubmission({
      studentAccount,
      activityId,
      classExternalId: classId,
      expectedDraftRevision: draftV2.revision,
      idempotencyKey: `submit-v2-${suffix}`,
      traceId: `${tracePrefix}-submit-v2`,
    });
    const detailV2 = await read.readTeacherSubmission({ teacherAccount, submissionId });
    expect(detailV2.currentVersionNo).toBe(2);
    expect(detailV2.versions).toHaveLength(2);
    await command.decideSubmission({
      teacherAccount,
      submissionId,
      expectedSubmissionVersionId: detailV2.currentVersionId,
      decision: "accept",
      feedbackText: "修订已达到要求。",
      rubricJudgments: { claim: "met", evidence: "met", reasoning: "met" },
      origin: "teacher",
      idempotencyKey: `accept-v2-${suffix}`,
      traceId: `${tracePrefix}-accept-v2`,
    });

    const studentUnit = await read.readStudentUnit({ studentAccount, courseExternalId: courseId, classExternalId: classId, lessonKey });
    expect(studentUnit.completion).toEqual({ completed: true, basis: "teacher-accepted-current-version" });
    expect(studentUnit.submission).toMatchObject({ state: "accepted", currentVersionNo: 2 });
    expect(studentUnit.feedback).toHaveLength(2);
    const dashboard = await read.readStudentDashboard({ studentAccount, scopes: [{ courseId, courseTitle: "P1 Integration Course", classId }] });
    expect(dashboard.nextAction).toMatchObject({ type: "course-complete" });

    const client = getUaisCoreDatabasePool({ env });
    const evidenceRows = await client.sql`
      SELECT
        (SELECT count(*)::integer FROM uais_submission_versions WHERE submission_id = ${submissionId}) AS versions,
        (SELECT count(*)::integer FROM uais_feedback WHERE submission_id = ${submissionId} AND status IN ('released', 'superseded')) AS released_feedback,
        (SELECT count(*)::integer FROM uais_learning_events WHERE submission_id = ${submissionId}) AS events,
        (SELECT count(*)::integer FROM uais_xapi_outbox o JOIN uais_learning_events e ON e.id = o.learning_event_id WHERE e.submission_id = ${submissionId}) AS outbox_rows
    `;
    expect(evidenceRows[0]).toMatchObject({ versions: 2, released_feedback: 2 });
    expect(Number((evidenceRows[0] as { events: number }).events)).toBeGreaterThanOrEqual(4);
    expect((evidenceRows[0] as { outbox_rows: number }).outbox_rows).toBe((evidenceRows[0] as { events: number }).events);
    const serializedEvents = await client.sql`
      SELECT context::text AS context FROM uais_learning_events WHERE submission_id = ${submissionId}
    `;
    expect(JSON.stringify(serializedEvents)).not.toContain("V2 已补充证据与推理");
    expect(JSON.stringify(serializedEvents)).not.toContain("修订已达到要求");
  // This full V1 -> revision -> V2 -> acceptance loop spans many independent
  // managed-Postgres transactions. Keep the timeout scoped to this real-DB
  // test; HTTP latency remains governed by the separate P2 load thresholds.
  }, 180_000);
});
