import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUaisLearningLoopPostgresReadStore } from "@/lib/learning-loop/postgres-read-store";
import {
  createUaisLearningLoopPostgresStore,
  type LearningLoopPostgresClientFactory,
} from "@/lib/learning-loop/postgres-store";
import { authorizeLiveDatabaseTestFile } from "../scripts/run-db-tests.mjs";

const authorization = await authorizeLiveDatabaseTestFile({
  env: process.env,
  lane: "p1-load",
  testFile: "tests/learning-loop-postgres-load.integration.test.ts",
});
if (authorization.exitCode !== 0) {
  throw new Error(`UAIS_DB_TEST ${JSON.stringify(authorization.report)}`);
}
const loadDatabaseUrl = authorization.databaseUrl ?? "";
const STUDENT_COUNT = 200;
const AUTOSAVE_WINDOW_MS = 300_000;
const SUBMIT_WINDOW_MS = 30_000;
const DECISION_COUNT = 20;
const CORE_WRITE_P95_MS = 1_500;

describe("P1 isolated 200-student Postgres load lane", () => {
  const suffix = randomUUID().replace(/-/g, "");
  const teacherAccount = `p1.load.teacher.${suffix}`;
  const studentAccounts = Array.from(
    { length: STUDENT_COUNT },
    (_, index) => `p1.load.student.${String(index + 1).padStart(3, "0")}.${suffix}`,
  );
  const courseId = `p1-load-course-${suffix}`;
  const classId = `p1-load-class-${suffix}`;
  const lessonKey = `p1-load-lesson-${suffix}`;
  const tracePrefix = `p1-load-${suffix}`;
  const loadSql = postgres(loadDatabaseUrl, {
    max: 40,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 30,
  });
  const createDatabase = (() => ({
    pooled: true,
    sql: loadSql,
  })) as unknown as LearningLoopPostgresClientFactory;
  const env = { UAIS_CORE_DATABASE_URL: loadDatabaseUrl };
  const command = createUaisLearningLoopPostgresStore({ env, createDatabase });
  const read = createUaisLearningLoopPostgresReadStore({ env, createDatabase });
  let activityId = "";

  beforeAll(async () => {
    const guard = await loadSql`
      SELECT environment
      FROM uais_environment_guard
      WHERE environment = 'isolated-p1-load-test' AND enabled = true
      LIMIT 1
    `;
    if (guard.length !== 1) {
      throw new Error("isolated-p1-load-test guard row required before any load write");
    }
    await loadSql`
      INSERT INTO uais_users (account, role, display_name, department, status)
      SELECT account, role, display_name, department, 'active'
      FROM jsonb_to_recordset(${loadSql.json([
        {
          account: teacherAccount,
          role: "teacher",
          display_name: "P1 Load Teacher",
          department: "Isolated Load Test",
        },
        ...studentAccounts.map((account, index) => ({
          account,
          role: "student",
          display_name: `P1 Load Student ${index + 1}`,
          department: "Isolated Load Test",
        })),
      ])}::jsonb)
        AS input(account text, role text, display_name text, department text)
    `;
    const created = await command.createActivity({
      teacherAccount,
      course: { externalId: courseId, title: "P1 Isolated Load Course" },
      class: { externalId: classId, name: "P1 200 Student Load Class" },
      lesson: {
        key: lessonKey,
        position: 1,
        title: { "zh-CN": "负载验证单元", "en-US": "Load validation unit" },
        manifestRef: `isolated-load-manifest-${suffix}`,
      },
      draft: {
        lessonKey,
        targetClassId: classId,
        title: { "zh-CN": "结构化论证", "en-US": "Structured argument" },
        instructions: {
          "zh-CN": "提交主张、证据与推理。",
          "en-US": "Submit a claim, evidence, and reasoning.",
        },
        checkpoint: {
          kind: "short-answer",
          prompt: { "zh-CN": "什么是证据？", "en-US": "What is evidence?" },
          explanation: {
            "zh-CN": "证据支持可检查的主张。",
            "en-US": "Evidence supports a checkable claim.",
          },
        },
        rubric: [
          { id: "claim", label: { "zh-CN": "主张", "en-US": "Claim" } },
          { id: "evidence", label: { "zh-CN": "证据", "en-US": "Evidence" } },
          { id: "reasoning", label: { "zh-CN": "推理", "en-US": "Reasoning" } },
        ],
        aiPolicy: "teacher-requested-draft",
        revisionPolicy: "teacher-requested",
      },
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
  }, 180_000);

  afterAll(async () => {
    try {
      await loadSql`DELETE FROM uais_courses WHERE slug = ${courseId}`;
      await loadSql`DELETE FROM uais_audit_log WHERE trace_id LIKE ${`${tracePrefix}%`}`;
      await loadSql`DELETE FROM uais_users WHERE account = ${teacherAccount} OR account = ANY(${studentAccounts})`;
    } finally {
      await loadSql.end({ timeout: 5 });
    }
  }, 120_000);

  it("conserves all 200 submissions through reads, sustained autosave, burst submit and 20 decisions", async () => {
    const readDurations = await parallelTimed(studentAccounts, 50, async (studentAccount) => {
      const unit = await read.readStudentUnit({
        studentAccount,
        courseExternalId: courseId,
        classExternalId: classId,
        lessonKey,
      });
      expect(unit.activity.id).toBe(activityId);
    });

    const checkpointDurations = await parallelTimed(
      studentAccounts,
      40,
      async (studentAccount, index) => {
        await command.recordFormativeAttempt({
          studentAccount,
          activityId,
          classExternalId: classId,
          response: { kind: "short-answer", text: `Evidence response ${index + 1}` },
          idempotencyKey: `checkpoint-${index + 1}-${suffix}`,
          traceId: `${tracePrefix}-checkpoint-${index + 1}`,
        });
      },
    );

    const draftRevisions = new Map<string, number>();
    const autosaveStartedAt = Date.now();
    const autosaveDurations: number[] = [];
    for (let round = 1; round <= 3; round += 1) {
      if (round > 1) {
        const targetElapsed = Math.round(((round - 1) * AUTOSAVE_WINDOW_MS) / 2);
        await waitForRemaining(targetElapsed - (Date.now() - autosaveStartedAt));
      }
      autosaveDurations.push(
        ...(await parallelTimed(studentAccounts, 40, async (studentAccount, index) => {
          const receipt = await command.saveSubmissionDraft({
            studentAccount,
            activityId,
            classExternalId: classId,
            contentText: `Student ${index + 1} structured response, autosave round ${round}.`,
            expectedDraftRevision: draftRevisions.get(studentAccount) ?? 0,
            traceId: `${tracePrefix}-draft-${round}-${index + 1}`,
          });
          draftRevisions.set(studentAccount, receipt.revision);
        })),
      );
    }
    expect(Date.now() - autosaveStartedAt).toBeGreaterThanOrEqual(AUTOSAVE_WINDOW_MS);

    const submissionReceipts = new Map<string, string>();
    const submitStartedAt = Date.now();
    const submitDurations = await parallelTimed(studentAccounts, 50, async (studentAccount, index) => {
      const receipt = await command.submitSubmission({
        studentAccount,
        activityId,
        classExternalId: classId,
        expectedDraftRevision: draftRevisions.get(studentAccount) ?? 0,
        idempotencyKey: `submit-${index + 1}-${suffix}`,
        traceId: `${tracePrefix}-submit-${index + 1}`,
      });
      submissionReceipts.set(studentAccount, receipt.resourceId);
    });
    expect(Date.now() - submitStartedAt).toBeLessThanOrEqual(SUBMIT_WINDOW_MS);

    const decisionDurations = await parallelTimed(
      studentAccounts.slice(0, DECISION_COUNT),
      DECISION_COUNT,
      async (studentAccount, index) => {
        const submissionId = submissionReceipts.get(studentAccount);
        if (!submissionId) throw new Error("submission receipt required");
        const detail = await read.readTeacherSubmission({ teacherAccount, submissionId });
        await command.decideSubmission({
          teacherAccount,
          submissionId,
          expectedSubmissionVersionId: detail.currentVersionId,
          decision: "accept",
          feedbackText: "The teacher verified this formative evidence.",
          rubricJudgments: { claim: "met", evidence: "met", reasoning: "met" },
          origin: "teacher",
          idempotencyKey: `accept-${index + 1}-${suffix}`,
          traceId: `${tracePrefix}-accept-${index + 1}`,
        });
      },
    );

    const evidence = await loadSql`
      SELECT
        (SELECT count(*)::integer FROM uais_formative_attempts WHERE assessment_id = ${activityId}) AS attempts,
        (SELECT count(*)::integer FROM uais_submissions WHERE assessment_id = ${activityId}) AS submissions,
        (SELECT count(*)::integer FROM uais_submission_versions v JOIN uais_submissions s ON s.id = v.submission_id WHERE s.assessment_id = ${activityId}) AS versions,
        (SELECT count(*)::integer FROM uais_submissions WHERE assessment_id = ${activityId} AND state = 'accepted') AS accepted,
        (SELECT count(*)::integer FROM uais_submissions WHERE assessment_id = ${activityId} AND state = 'submitted') AS awaiting,
        (SELECT count(*)::integer FROM uais_learning_events WHERE assessment_id = ${activityId}) AS events,
        (SELECT count(*)::integer FROM uais_xapi_outbox o JOIN uais_learning_events e ON e.id = o.learning_event_id WHERE e.assessment_id = ${activityId}) AS outbox_rows,
        (SELECT count(DISTINCT user_id)::integer FROM uais_learner_profiles p JOIN uais_courses c ON c.id = p.course_id WHERE c.slug = ${courseId}) AS profiles
    `;
    expect(evidence[0]).toMatchObject({
      attempts: STUDENT_COUNT,
      submissions: STUDENT_COUNT,
      versions: STUDENT_COUNT,
      accepted: DECISION_COUNT,
      awaiting: STUDENT_COUNT - DECISION_COUNT,
      events: STUDENT_COUNT * 2 + DECISION_COUNT * 2,
      outbox_rows: STUDENT_COUNT * 2 + DECISION_COUNT * 2,
      profiles: STUDENT_COUNT,
    });

    const duplicateVersions = await loadSql`
      SELECT submission_id, version_no, count(*)::integer AS count
      FROM uais_submission_versions v
      JOIN uais_submissions s ON s.id = v.submission_id
      WHERE s.assessment_id = ${activityId}
      GROUP BY submission_id, version_no
      HAVING count(*) > 1
    `;
    expect(duplicateVersions).toHaveLength(0);
    expect(percentile95(checkpointDurations)).toBeLessThanOrEqual(CORE_WRITE_P95_MS);
    expect(percentile95(autosaveDurations)).toBeLessThanOrEqual(CORE_WRITE_P95_MS);
    expect(percentile95(submitDurations)).toBeLessThanOrEqual(CORE_WRITE_P95_MS);
    expect(percentile95(decisionDurations)).toBeLessThanOrEqual(CORE_WRITE_P95_MS);

    console.log(JSON.stringify({
      target: "uais-p1-200-student-load-lane",
      status: "passed",
      studentCount: STUDENT_COUNT,
      counts: evidence[0],
      p95Ms: {
        taskRead: percentile95(readDurations),
        checkpoint: percentile95(checkpointDurations),
        autosave: percentile95(autosaveDurations),
        submit: percentile95(submitDurations),
        teacherDecision: percentile95(decisionDurations),
      },
      valueRedacted: true,
    }));
  }, 720_000);
});

async function parallelTimed<T>(
  items: T[],
  concurrency: number,
  run: (item: T, index: number) => Promise<void>,
) {
  const durations = new Array<number>(items.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        const startedAt = performance.now();
        await run(items[index]!, index);
        durations[index] = performance.now() - startedAt;
      }
    }),
  );
  return durations;
}

function percentile95(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round((sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0) * 100) / 100;
}

async function waitForRemaining(milliseconds: number) {
  if (milliseconds <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
