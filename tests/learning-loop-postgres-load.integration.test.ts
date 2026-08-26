import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUaisLearningLoopPostgresReadStore } from "@/lib/learning-loop/postgres-read-store";
import {
  createUaisLearningLoopPostgresStore,
  type LearningLoopPostgresClientFactory,
} from "@/lib/learning-loop/postgres-store";
import { authorizeLiveDatabaseTestFile } from "../scripts/run-db-tests.mjs";
import {
  buildP1LoadPhaseDiagnostics,
  createP1LoadPhaseObserver,
  diffP1LoadQueryStats,
  writeP1LoadDiagnosticReceipt,
} from "../scripts/run-p1-load-test.mjs";

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
const LOAD_POOL_MAX = 40;
const DIAGNOSTIC_SAMPLE_INTERVAL_MS = 100;
const diagnosticFile = process.env.UAIS_P1_LOAD_DIAGNOSTIC_FILE ?? "";

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
  const loadApplicationName = `uais-p1-load-${suffix.slice(0, 16)}`;
  const loadSql = postgres(loadDatabaseUrl, {
    max: LOAD_POOL_MAX,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 30,
    connection: { application_name: loadApplicationName },
  });
  const observerSql = postgres(loadDatabaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 30,
    connection: {
      application_name: `uais-p1-observer-${suffix.slice(0, 12)}`,
    },
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
      await Promise.all([
        observerSql.end({ timeout: 5 }),
        loadSql.end({ timeout: 5 }),
      ]);
    }
  }, 120_000);

  async function runObservedP1Phase({
    id,
    operationCount,
    concurrency,
    run,
  }: {
    id: string;
    operationCount: number;
    concurrency: number;
    run: (
      trackOperation: (operation: () => Promise<void>) => Promise<void>,
    ) => Promise<number[]>;
  }) {
    const observer = createP1LoadPhaseObserver({ poolMax: LOAD_POOL_MAX });
    const queryStatsBefore = await readP1LoadQueryStats();
    let phaseComplete = false;
    let activeOperationCount = 0;
    const sampling = (async () => {
      while (!phaseComplete) {
        const sampleStartedAt = Date.now();
        try {
          observer.record({
            activeOperationCount,
            sessions: await readP1LoadSessions(),
          });
        } catch {
          observer.recordError();
        }
        if (!phaseComplete) {
          await waitForRemaining(
            DIAGNOSTIC_SAMPLE_INTERVAL_MS -
              (Date.now() - sampleStartedAt),
          );
        }
      }
    })();

    let operationDurations: number[];
    try {
      operationDurations = await run(async (operation) => {
        activeOperationCount += 1;
        try {
          await operation();
        } finally {
          activeOperationCount -= 1;
        }
      });
    } finally {
      phaseComplete = true;
      await sampling;
    }

    const queryStatsAfter = await readP1LoadQueryStats();
    return {
      operationDurations,
      diagnostics: buildP1LoadPhaseDiagnostics({
        id,
        operationDurations,
        operationCount,
        concurrency,
        sampleIntervalMs: DIAGNOSTIC_SAMPLE_INTERVAL_MS,
        observation: observer.snapshot(),
        queryStats: diffP1LoadQueryStats(
          queryStatsBefore,
          queryStatsAfter,
        ),
      }),
    };
  }

  async function readP1LoadSessions() {
    const rows = await observerSql`
      SELECT
        state,
        wait_event_type,
        CASE
          WHEN xact_start IS NULL THEN NULL
          ELSE GREATEST(
            0,
            EXTRACT(EPOCH FROM (clock_timestamp() - xact_start)) * 1000
          )::double precision
        END AS transaction_age_ms,
        CASE
          WHEN state <> 'active' OR query_start IS NULL THEN NULL
          ELSE GREATEST(
            0,
            EXTRACT(EPOCH FROM (clock_timestamp() - query_start)) * 1000
          )::double precision
        END AS query_age_ms
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND application_name = ${loadApplicationName}
    `;
    return rows.map((row) => ({
      state: row.state,
      waitEventType: row.wait_event_type,
      transactionAgeMs: row.transaction_age_ms,
      queryAgeMs: row.query_age_ms,
    }));
  }

  async function readP1LoadQueryStats() {
    try {
      const rows = await observerSql`
        SELECT
          COALESCE(sum(calls), 0)::bigint AS calls,
          COALESCE(sum(total_exec_time), 0)::double precision AS total_exec_ms
        FROM pg_stat_statements
        WHERE dbid = (
          SELECT oid FROM pg_database WHERE datname = current_database()
        )
          AND userid = (
            SELECT usesysid FROM pg_user WHERE usename = current_user
          )
          AND query NOT ILIKE '%pg_stat_statements%'
          AND query NOT ILIKE '%pg_stat_activity%'
      `;
      const calls = Number(rows[0]?.calls);
      const totalExecMs = Number(rows[0]?.total_exec_ms);
      if (
        !Number.isSafeInteger(calls) ||
        calls < 0 ||
        !Number.isFinite(totalExecMs) ||
        totalExecMs < 0
      ) {
        return { available: false, calls: 0, totalExecMs: 0 };
      }
      return { available: true, calls, totalExecMs };
    } catch {
      return { available: false, calls: 0, totalExecMs: 0 };
    }
  }

  it("conserves all 200 submissions through reads, sustained autosave, burst submit and 20 decisions", async () => {
    const taskReadPhase = await runObservedP1Phase({
      id: "task-read",
      operationCount: STUDENT_COUNT,
      concurrency: 50,
      run: (trackOperation) =>
        parallelTimed(studentAccounts, 50, (studentAccount) =>
          trackOperation(async () => {
            const unit = await read.readStudentUnit({
              studentAccount,
              courseExternalId: courseId,
              classExternalId: classId,
              lessonKey,
            });
            expect(unit.activity.id).toBe(activityId);
          }),
        ),
    });
    const readDurations = taskReadPhase.operationDurations;

    const checkpointPhase = await runObservedP1Phase({
      id: "checkpoint",
      operationCount: STUDENT_COUNT,
      concurrency: 40,
      run: (trackOperation) =>
        parallelTimed(studentAccounts, 40, (studentAccount, index) =>
          trackOperation(() =>
            command.recordFormativeAttempt({
              studentAccount,
              activityId,
              classExternalId: classId,
              response: {
                kind: "short-answer",
                text: `Evidence response ${index + 1}`,
              },
              idempotencyKey: `checkpoint-${index + 1}-${suffix}`,
              traceId: `${tracePrefix}-checkpoint-${index + 1}`,
            }),
          ),
        ),
    });
    const checkpointDurations = checkpointPhase.operationDurations;

    const draftRevisions = new Map<string, number>();
    let autosaveWindowMs = 0;
    const autosavePhase = await runObservedP1Phase({
      id: "autosave",
      operationCount: STUDENT_COUNT * 3,
      concurrency: 40,
      run: async (trackOperation) => {
        const autosaveStartedAt = Date.now();
        const durations: number[] = [];
        for (let round = 1; round <= 3; round += 1) {
          if (round > 1) {
            const targetElapsed = Math.round(
              ((round - 1) * AUTOSAVE_WINDOW_MS) / 2,
            );
            await waitForRemaining(
              targetElapsed - (Date.now() - autosaveStartedAt),
            );
          }
          durations.push(
            ...(await parallelTimed(
              studentAccounts,
              40,
              (studentAccount, index) =>
                trackOperation(async () => {
                  const receipt = await command.saveSubmissionDraft({
                    studentAccount,
                    activityId,
                    classExternalId: classId,
                    contentText: `Student ${index + 1} structured response, autosave round ${round}.`,
                    expectedDraftRevision:
                      draftRevisions.get(studentAccount) ?? 0,
                    traceId: `${tracePrefix}-draft-${round}-${index + 1}`,
                  });
                  draftRevisions.set(studentAccount, receipt.revision);
                }),
            )),
          );
        }
        autosaveWindowMs = Date.now() - autosaveStartedAt;
        return durations;
      },
    });
    const autosaveDurations = autosavePhase.operationDurations;

    const submissionReceipts = new Map<string, string>();
    let submitWindowMs = 0;
    const submitPhase = await runObservedP1Phase({
      id: "submit",
      operationCount: STUDENT_COUNT,
      concurrency: 50,
      run: async (trackOperation) => {
        const submitStartedAt = Date.now();
        const durations = await parallelTimed(
          studentAccounts,
          50,
          (studentAccount, index) =>
            trackOperation(async () => {
              const receipt = await command.submitSubmission({
                studentAccount,
                activityId,
                classExternalId: classId,
                expectedDraftRevision:
                  draftRevisions.get(studentAccount) ?? 0,
                idempotencyKey: `submit-${index + 1}-${suffix}`,
                traceId: `${tracePrefix}-submit-${index + 1}`,
              });
              submissionReceipts.set(studentAccount, receipt.resourceId);
            }),
        );
        submitWindowMs = Date.now() - submitStartedAt;
        return durations;
      },
    });
    const submitDurations = submitPhase.operationDurations;

    const teacherDecisionPhase = await runObservedP1Phase({
      id: "teacher-decision",
      operationCount: DECISION_COUNT,
      concurrency: DECISION_COUNT,
      run: (trackOperation) =>
        parallelTimed(
          studentAccounts.slice(0, DECISION_COUNT),
          DECISION_COUNT,
          (studentAccount, index) =>
            trackOperation(async () => {
              const submissionId = submissionReceipts.get(studentAccount);
              if (!submissionId) {
                throw new Error("submission receipt required");
              }
              const detail = await read.readTeacherSubmission({
                teacherAccount,
                submissionId,
              });
              await command.decideSubmission({
                teacherAccount,
                submissionId,
                expectedSubmissionVersionId: detail.currentVersionId,
                decision: "accept",
                feedbackText:
                  "The teacher verified this formative evidence.",
                rubricJudgments: {
                  claim: "met",
                  evidence: "met",
                  reasoning: "met",
                },
                origin: "teacher",
                idempotencyKey: `accept-${index + 1}-${suffix}`,
                traceId: `${tracePrefix}-accept-${index + 1}`,
              });
            }),
        ),
    });
    const decisionDurations = teacherDecisionPhase.operationDurations;

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
    const duplicateVersions = await loadSql`
      SELECT submission_id, version_no, count(*)::integer AS count
      FROM uais_submission_versions v
      JOIN uais_submissions s ON s.id = v.submission_id
      WHERE s.assessment_id = ${activityId}
      GROUP BY submission_id, version_no
      HAVING count(*) > 1
    `;
    const counts = {
      attempts: Number(evidence[0]?.attempts),
      submissions: Number(evidence[0]?.submissions),
      versions: Number(evidence[0]?.versions),
      accepted: Number(evidence[0]?.accepted),
      awaiting: Number(evidence[0]?.awaiting),
      events: Number(evidence[0]?.events),
      outboxRows: Number(evidence[0]?.outbox_rows),
      profiles: Number(evidence[0]?.profiles),
    };
    writeP1LoadDiagnosticReceipt({
      file: diagnosticFile,
      receipt: {
        version: 1,
        target: "uais-p1-200-student-load-diagnostic",
        mode: "diagnostic-only",
        studentCount: STUDENT_COUNT,
        poolMax: LOAD_POOL_MAX,
        sampleIntervalMs: DIAGNOSTIC_SAMPLE_INTERVAL_MS,
        autosaveWindowMs,
        submitWindowMs,
        counts,
        duplicateVersionCount: duplicateVersions.length,
        phases: [
          taskReadPhase.diagnostics,
          checkpointPhase.diagnostics,
          autosavePhase.diagnostics,
          submitPhase.diagnostics,
          teacherDecisionPhase.diagnostics,
        ],
        valuesRedacted: true,
      },
    });

    expect(autosaveWindowMs).toBeGreaterThanOrEqual(AUTOSAVE_WINDOW_MS);
    expect(submitWindowMs).toBeLessThanOrEqual(SUBMIT_WINDOW_MS);
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
    expect(duplicateVersions).toHaveLength(0);
    expect(percentile95(checkpointDurations)).toBeLessThanOrEqual(CORE_WRITE_P95_MS);
    expect(percentile95(autosaveDurations)).toBeLessThanOrEqual(CORE_WRITE_P95_MS);
    expect(percentile95(submitDurations)).toBeLessThanOrEqual(CORE_WRITE_P95_MS);
    expect(percentile95(decisionDurations)).toBeLessThanOrEqual(CORE_WRITE_P95_MS);

    console.log(JSON.stringify({
      target: "uais-p1-200-student-load-lane",
      status: "passed",
      studentCount: STUDENT_COUNT,
      counts,
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
