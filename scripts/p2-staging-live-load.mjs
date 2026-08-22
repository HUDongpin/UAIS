#!/usr/bin/env node

// Isolated staging-only P2 executor.
//
// This is intentionally separate from p2-load-test.mjs. That file is the fast,
// deterministic refusal/plan gate used by the default suite; this file is the
// explicit external executor and is safe only inside the independently-bound
// `uais-staging` Vercel project. It creates tagged fixtures, drives the real
// deployed HTTP routes, performs a non-overwriting restore into a second Neon
// target, and proves both targets contain zero tagged test data at handoff.
//
// Run through `tsx`, because the fixture setup deliberately reuses the same
// TypeScript store functions as the deployed route handlers:
//   ./node_modules/.bin/tsx scripts/p2-staging-live-load.mjs

// Secrets are generated or read in memory and are never written to stdout.
// Every emitted object is an aggregate/control-plane record only.

import { createHash, randomBytes } from "node:crypto";
import postgres from "postgres";
import { hashAccountPassword } from "./lib/uais-account-provisioning.mjs";
import coreDatabaseModule from "../src/lib/db/core-database.ts";
import migrationsModule from "../src/lib/db/migrations.ts";
import teachingCourseStoreModule from "../src/lib/server/teaching-course-management-store.ts";
import teachingCoursePostgresModule from "../src/lib/server/teaching-course-management-postgres-store.ts";
import teachingCourseIdModule from "../src/lib/teaching-course-id.ts";
import accountPasswordModule from "../src/lib/server/uais-app-password-hash.ts";

const { resetUaisCoreDatabasePoolForTesting } = coreDatabaseModule;
const { UAIS_CORE_DATABASE_MIGRATION_VERSIONS } = migrationsModule;
const {
  approveTeachingClassMembership,
  createTeachingClassRecord,
  createTeachingCourseRecord,
  joinTeachingClassByInviteCode,
} = teachingCourseStoreModule;
const { createUaisTeachingCourseManagementPostgresRepository } =
  teachingCoursePostgresModule;
const { createProvisionalTeachingCourseId } = teachingCourseIdModule;
const { verifyUaisAccountPassword } = accountPasswordModule;

const expectedStagingProjectId = "prj_dcWZvGLSYNtSWN3lnTyfZPyWKgQL";
const productionProjectId = "prj_MZIjawDPTU4tj4yuTBsd9hyLxHXA";
const productionNeonProjectId = "late-sunset-59152574";
const productionHostnames = new Set(["uais.top", "www.uais.top", "uais.vercel.app"]);
const requiredStagingHostname = "staging.uais.top";
const expectedUserCount = 200;
const expectedGroupCount = 40;
const expectedGroupSize = 5;
const expectedLoadDurationSeconds = 600;
const expectedHealthSamples = 15;
const healthIntervalMs = 60_000;
const chatRoundIntervalMs = 60_000;
// Every invite claim updates the same course-management snapshot. Drive that
// shared consistency boundary serially; parallelism here only creates
// avoidable optimistic-write retries and does not model independent cohorts.
// The subsequent group-chat phase still exercises 200 users across 40 groups
// with bounded concurrency against independent room snapshots.
const joinConcurrency = 1;
const loginConcurrency = 16;
const groupConcurrency = 10;
const maximumLogicalAttempts = 3;
const minimumSuccessRate = 0.99;
const maximumServerErrorRate = 0.005;
const maximumP95Milliseconds = 2_000;
const dryRun = process.argv.includes("--dry-run");
const healthOnly = process.argv.includes("--health-only");

// Defined before the first top-level await. A class declaration at the bottom
// remains in its temporal-dead-zone while module evaluation is paused by an
// earlier await, so an early fixture/preflight failure could not be reported or
// cleaned up and surfaced as a ReferenceError instead of its bounded code.
class P2ExecutionError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const baseUrlValue = process.env.P2_LOAD_BASE_URL?.trim() ?? "";
const allowlist = new Set(
  (process.env.P2_LOAD_ALLOWLIST ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);
const runId = process.env.P2_LOAD_RUN_ID?.trim() ?? "";
const manualPassword = process.env.P2_MANUAL_TEST_PASSWORD?.trim() ?? "";
const sourceDatabaseUrl =
  process.env.UAIS_P2_STAGING_DATABASE_URL?.trim() ?? "";
const restoreDatabaseUrl =
  process.env.UAIS_P2_STAGING_RESTORE_DATABASE_URL?.trim() ?? "";
const sourceNeonProjectId = process.env.NEON_PROJECT_ID?.trim() ?? "";
const restoreNeonProjectId = process.env.RESTORE_NEON_PROJECT_ID?.trim() ?? "";
const blockedReasons = healthOnly
  ? validateHealthExecutionBoundary()
  : validateExecutionBoundary();

if (dryRun || blockedReasons.length > 0) {
  emit({
    target: "p2-isolated-staging-live-executor",
    status: blockedReasons.length === 0 ? "PASS" : "BLOCKED_ENV",
    mode: "dry-run",
    phase: healthOnly ? "health-only" : "load-and-restore",
    blockedReasons,
    plan: {
      healthOnly,
      users: expectedUserCount,
      groups: expectedGroupCount,
      usersPerGroup: expectedGroupSize,
      durationSeconds: expectedLoadDurationSeconds,
      healthSamples: expectedHealthSamples,
      healthIntervalSeconds: healthIntervalMs / 1_000,
      sourceCleanupRequired: true,
      restoreTargetCleanupRequired: true,
    },
    safety: createSafetyRecord(false),
  });
  process.exit(blockedReasons.length === 0 ? 0 : 2);
}

const baseUrl = new URL(baseUrlValue).origin;

if (healthOnly) {
  const healthStartedAt = Date.now();
  const healthAbortController = new AbortController();
  const health = summarizeHealth(
    await observeHealth(healthAbortController.signal),
  );
  emit({
    target: "p2-isolated-staging-live-executor",
    status: health.status,
    mode: "execute",
    phase: "health-only",
    health,
    blockedReasons: [],
    elapsedSeconds: Math.round((Date.now() - healthStartedAt) / 1_000),
    safety: createSafetyRecord(true),
  });
  process.exit(health.status === "PASS" ? 0 : 1);
}

const sourceSql = createSql(sourceDatabaseUrl);
const restoreSql = createSql(restoreDatabaseUrl);
const databaseGuardReasons = await validateDatabaseGuards(sourceSql, restoreSql);
if (databaseGuardReasons.length > 0) {
  emit({
    target: "p2-isolated-staging-live-executor",
    status: "BLOCKED_ENV",
    mode: "execute",
    blockedReasons: databaseGuardReasons,
    requiredDatabaseGuards: [
      "isolated-p2-staging-source",
      "isolated-p2-staging-restore",
    ],
    safety: createSafetyRecord(true),
  });
  await Promise.all([
    sourceSql.end({ timeout: 5 }).catch(() => undefined),
    restoreSql.end({ timeout: 5 }).catch(() => undefined),
  ]);
  process.exit(2);
}

const loadPassword = `${randomBytes(32).toString("base64url")}Aa9!`;
const loadPrefix = `${runId}-`;
const manualPrefix = `${runId}-manual-`;
const loadTeacherAccount = `${loadPrefix}teacher`;
const loadStudentAccounts = Array.from(
  { length: expectedUserCount },
  (_unused, index) => `${loadPrefix}student-${String(index + 1).padStart(3, "0")}`,
);
const manualStudentAccount = `${manualPrefix}student`;
const manualTeacherAccount = `${manualPrefix}teacher`;
const isolatedSourceEnv = {
  ...process.env,
  UAIS_CORE_DATABASE_URL: sourceDatabaseUrl,
  DATABASE_URL: "",
  POSTGRES_URL: "",
  RESTORE_DATABASE_URL: "",
  RESTORE_POSTGRES_URL: "",
};
const fixtureNow = new Date("2026-08-22T06:30:00.000Z");
const loadCourseId = createProvisionalTeachingCourseId({
  actorId: loadTeacherAccount,
  courseName: "P2 Quality Pilot",
  now: fixtureNow,
});
const manualCourseId = createProvisionalTeachingCourseId({
  actorId: manualTeacherAccount,
  courseName: "P2 Manual Accessibility",
  now: fixtureNow,
});
const healthAbortController = new AbortController();
const healthPromise = observeHealth(healthAbortController.signal);
const executionStartedAt = Date.now();

const report = {
  target: "p2-isolated-staging-live-executor",
  status: "FAIL",
  mode: "execute",
  runId,
  candidate: {
    baseUrl,
    vercelProjectFingerprint: fingerprint(process.env.VERCEL_PROJECT_ID ?? ""),
    sourceNeonFingerprint: fingerprint(sourceNeonProjectId),
    restoreNeonFingerprint: fingerprint(restoreNeonProjectId),
    migrationVersions: [...UAIS_CORE_DATABASE_MIGRATION_VERSIONS],
  },
  scenarioA: undefined,
  scenarioB: undefined,
  health: undefined,
  restore: undefined,
  cleanup: undefined,
  failureCode: undefined,
  safety: createSafetyRecord(true),
};

let loadClassId = "";
let loadCoreCourseSlug = "";
let restoreCompleted = false;
let sourceLoadCleanup;
let sourceManualCleanup;
let restoreLoadCleanup;
let currentStage = "initial-tagged-cleanup";

try {
  await cleanupTaggedData(sourceSql, {
    accountPrefixes: [loadPrefix, manualPrefix],
    courseIds: [loadCourseId, manualCourseId],
    coreCourseSlugs: [`${runId}-core`],
    textMarkers: [runId, manualPrefix],
  });
  await cleanupTaggedData(restoreSql, {
    accountPrefixes: [loadPrefix],
    courseIds: [loadCourseId],
    coreCourseSlugs: [`${runId}-core`],
    textMarkers: [runId],
  });

  currentStage = "course-fixture-seed";
  const repository = createUaisTeachingCourseManagementPostgresRepository({
    env: isolatedSourceEnv,
  });
  const loadFixture = await createCourseFixture({
    repository,
    actorId: loadTeacherAccount,
    courseId: loadCourseId,
    name: "P2 Quality Pilot",
  });
  loadClassId = loadFixture.classItem.classId;
  const manualFixture = await createCourseFixture({
    repository,
    actorId: manualTeacherAccount,
    courseId: manualCourseId,
    name: "P2 Manual Accessibility Journey",
  });
  currentStage = "manual-membership-join";
  const manualMembership = await joinTeachingClassByInviteCode({
    dataDir: "/tmp/uais-p2-staging-fixture",
    repository,
    join: {
      invitationCode: manualFixture.classItem.invitationCode,
      studentId: manualStudentAccount,
      studentDisplayName: "P2 Manual Student",
    },
  });
  currentStage = "manual-membership-approve";
  await approveTeachingClassMembership({
    dataDir: "/tmp/uais-p2-staging-fixture",
    repository,
    actorId: manualTeacherAccount,
    classId: manualFixture.classItem.classId,
    membershipId: manualMembership.membership.membershipId,
  });
  currentStage = "account-seed";
  const seeded = await seedAccounts();
  emitProgress("accounts-seeded", { count: expectedUserCount + 3 });
  currentStage = "core-relationship-fixture";
  const coreFixture = await seedCoreRelationshipFixture(seeded.userIdsByAccount);
  loadCoreCourseSlug = coreFixture.courseSlug;

  emitProgress("fixtures-ready", {
    loadUsers: expectedUserCount,
    manualAccounts: {
      student: manualStudentAccount,
      teacher: manualTeacherAccount,
    },
    manualCourseId,
    valueRedacted: true,
  });

  currentStage = "teacher-login";
  const teacherLogin = await loginAccount(loadTeacherAccount, loadPassword);
  if (!teacherLogin.ok || teacherLogin.role !== "teacher" || !teacherLogin.teacherBridgeIssued) {
    throw new P2ExecutionError("teacher-login-or-signed-bridge-failed");
  }

  currentStage = "student-login";
  const studentLogins = await mapLimit(
    loadStudentAccounts,
    loginConcurrency,
    async (account, index) => ({
      index,
      account,
      ...(await loginAccount(account, loadPassword)),
    }),
  );
  if (studentLogins.some((login) => !login.ok || login.role !== "student")) {
    throw new P2ExecutionError("one-or-more-student-logins-failed");
  }
  const sessionByAccount = new Map(
    studentLogins.map((login) => [login.account, login]),
  );

  currentStage = "invite-join";
  const joins = await mapLimit(
    studentLogins,
    joinConcurrency,
    async (login, index) =>
      requestWithRetries({
        id: `join-${index + 1}`,
        expectedStatus: 201,
        run: () =>
          fetch(`${baseUrl}/api/teaching/invite-codes/${loadFixture.classItem.invitationCode}/join`, {
            method: "POST",
            headers: {
              accept: "application/json",
              cookie: login.cookie,
              "x-uais-trace-id": `${runId}-join-${index + 1}`,
            },
            signal: AbortSignal.timeout(20_000),
          }),
      }),
  );
  const joinMetrics = summarizeMetrics(joins);
  report.scenarioA = {
    status: metricsPass(joinMetrics) ? "PASS" : "FAIL",
    users: expectedUserCount,
    concurrency: joinConcurrency,
    maximumAttempts: maximumLogicalAttempts,
    ...joinMetrics,
  };
  if (!metricsPass(joinMetrics)) {
    throw new P2ExecutionError("invite-join-threshold-failed");
  }

  currentStage = "bulk-membership-approval";
  const approval = await fetchJson(`${baseUrl}/api/teaching/classes/${loadClassId}/memberships/approve`, {
    method: "POST",
    headers: {
      accept: "application/json",
      cookie: teacherLogin.cookie,
      "x-uais-trace-id": `${runId}-approve-all`,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (approval.status !== 200 || approval.body?.approvedCount !== expectedUserCount) {
    throw new P2ExecutionError("bulk-membership-approval-failed");
  }

  currentStage = "group-auto-split";
  const autoSplit = await fetchJson(
    `${baseUrl}/api/teaching/courses/${loadCourseId}/groups/auto-split`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        cookie: teacherLogin.cookie,
        "x-uais-trace-id": `${runId}-auto-split`,
      },
      body: JSON.stringify({ classId: loadClassId, groupSize: expectedGroupSize }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const groups = Array.isArray(autoSplit.body?.groups) ? autoSplit.body.groups : [];
  if (
    autoSplit.status !== 201 ||
    groups.length !== expectedGroupCount ||
    groups.some(
      (group) => !Array.isArray(group?.members) || group.members.length !== expectedGroupSize,
    )
  ) {
    throw new P2ExecutionError("group-auto-split-shape-failed");
  }

  currentStage = "ten-minute-group-chat";
  const chatStartedAt = Date.now();
  const chatResults = [];
  const expectedMessageIdsByGroup = new Map();
  for (let round = 0; round < expectedLoadDurationSeconds / 60; round += 1) {
    await waitUntil(chatStartedAt + round * chatRoundIntervalMs);
    const roundResults = await mapLimit(groups, groupConcurrency, async (group, groupIndex) => {
      const expectedIds = expectedMessageIdsByGroup.get(group.groupId) ?? new Set();
      expectedMessageIdsByGroup.set(group.groupId, expectedIds);
      const results = [];
      for (let memberIndex = 0; memberIndex < group.members.length; memberIndex += 1) {
        const member = group.members[memberIndex];
        const login = sessionByAccount.get(member.studentId);
        if (!login) {
          throw new P2ExecutionError("group-member-session-missing");
        }
        const messageId = `${runId}-r${String(round + 1).padStart(2, "0")}-g${String(
          groupIndex + 1,
        ).padStart(2, "0")}-m${memberIndex + 1}`;
        expectedIds.add(messageId);
        results.push(
          await requestWithRetries({
            id: messageId,
            expectedStatus: 200,
            validateBody: (body) => body?.transcript?.status === "persisted",
            run: () =>
              fetch(`${baseUrl}/api/learning/chatroom`, {
                method: "POST",
                headers: {
                  accept: "application/json",
                  "content-type": "application/json",
                  cookie: login.cookie,
                  "x-uais-trace-id": `${runId}-chat-${round + 1}-${groupIndex + 1}-${
                    memberIndex + 1
                  }`,
                },
                body: JSON.stringify({
                  locale: "zh-CN",
                  courseId: loadCourseId,
                  classId: loadClassId,
                  groupId: group.groupId,
                  messages: [
                    {
                      id: messageId,
                      role: "student",
                      content: `P2 bounded group load ${round + 1}-${memberIndex + 1}`,
                    },
                  ],
                }),
                signal: AbortSignal.timeout(20_000),
              }),
          }),
        );
      }
      return results;
    });
    chatResults.push(...roundResults.flat());
    emitProgress("group-load-round-complete", {
      round: round + 1,
      rounds: expectedLoadDurationSeconds / 60,
      cumulativeRequests: chatResults.length,
    });
  }
  await waitUntil(chatStartedAt + expectedLoadDurationSeconds * 1_000);

  currentStage = "group-isolation-readback";
  const isolationChecks = await mapLimit(groups, groupConcurrency, async (group) => {
    const firstMember = group.members[0];
    const login = sessionByAccount.get(firstMember.studentId);
    const expectedIds = expectedMessageIdsByGroup.get(group.groupId) ?? new Set();
    if (!login) {
      return { ok: false, status: 0, latencyMs: 0 };
    }
    const url = new URL("/api/learning/chatroom", baseUrl);
    url.searchParams.set("courseId", loadCourseId);
    url.searchParams.set("classId", loadClassId);
    url.searchParams.set("groupId", group.groupId);
    const started = performance.now();
    const response = await fetchJson(url.href, {
      headers: {
        accept: "application/json",
        cookie: login.cookie,
        "x-uais-trace-id": `${runId}-history-${group.groupId}`,
      },
      signal: AbortSignal.timeout(20_000),
    });
    const latencyMs = performance.now() - started;
    const messages = Array.isArray(response.body?.messages) ? response.body.messages : [];
    const actualIds = messages.map((message) => message?.id).filter(Boolean);
    const uniqueIds = new Set(actualIds);
    const ok =
      response.status === 200 &&
      actualIds.length === expectedIds.size &&
      uniqueIds.size === actualIds.length &&
      actualIds.every((id) => expectedIds.has(id));
    return { ok, status: response.status, latencyMs };
  });

  const chatMetrics = summarizeMetrics(chatResults);
  const isolationMetrics = summarizeMetrics(
    isolationChecks.map((check) => ({
      ok: check.ok,
      status: check.status,
      latencyMs: check.latencyMs,
      attempts: 1,
    })),
  );
  const chatPass = metricsPass(chatMetrics) && isolationMetrics.successCount === groups.length;
  report.scenarioB = {
    status: chatPass ? "PASS" : "FAIL",
    users: expectedUserCount,
    groups: groups.length,
    usersPerGroup: expectedGroupSize,
    durationSeconds: Math.round((Date.now() - chatStartedAt) / 1_000),
    providerMode: "deterministic-no-agent-fast-path",
    rounds: expectedLoadDurationSeconds / 60,
    expectedMessages: expectedUserCount * (expectedLoadDurationSeconds / 60),
    ...chatMetrics,
    isolation: isolationMetrics,
    duplicateWrites: isolationMetrics.successCount === groups.length ? 0 : "unverified",
    crossGroupMessages: isolationMetrics.successCount === groups.length ? 0 : "unverified",
  };
  if (!chatPass) {
    throw new P2ExecutionError("group-chat-threshold-or-isolation-failed");
  }

  currentStage = "source-post-load-verification";
  const sourceSnapshot = await inspectSourceLoadState();
  if (
    sourceSnapshot.memberships !== expectedUserCount ||
    sourceSnapshot.approvedMemberships !== expectedUserCount ||
    sourceSnapshot.groups !== expectedGroupCount ||
    sourceSnapshot.groupMembers !== expectedUserCount ||
    sourceSnapshot.transcriptMessages !== expectedUserCount * (expectedLoadDurationSeconds / 60)
  ) {
    throw new P2ExecutionError("source-post-load-relationship-verification-failed");
  }

  currentStage = "tagged-backup-capture";
  const backupTakenAt = Date.now();
  const backup = await captureTaggedBackup();
  sourceLoadCleanup = await cleanupTaggedData(sourceSql, {
    accountPrefixes: [loadPrefix],
    courseIds: [loadCourseId],
    coreCourseSlugs: [loadCoreCourseSlug],
    textMarkers: [runId],
  });
  assertZeroResidual(sourceLoadCleanup, "source-load-cleanup-nonzero");

  currentStage = "restore-to-distinct-target";
  const recoveryStartedAt = performance.now();
  await restoreTaggedBackup(backup);
  const restored = await verifyRestoredBackup(backup, loadPassword);
  const recoveryDurationMs = Math.round(performance.now() - recoveryStartedAt);
  if (!restored.ok) {
    throw new P2ExecutionError("restore-verification-failed");
  }
  restoreCompleted = true;
  report.restore = {
    status: "PASS",
    strategy: "tagged-logical-snapshot-to-distinct-neon-target",
    sourceNeonFingerprint: fingerprint(sourceNeonProjectId),
    targetNeonFingerprint: fingerprint(restoreNeonProjectId),
    sourceAndTargetDistinct: sourceNeonProjectId !== restoreNeonProjectId,
    backupTakenAt: new Date(backupTakenAt).toISOString(),
    recoveryDurationMs,
    rpoSeconds: 0,
    lostRecordCount: 0,
    restoredCounts: restored.counts,
    loginHashVerification: "PASS",
    relationships: "PASS",
    groupIsolation: "PASS",
    migrations: "PASS",
    operator: "S22",
  };

  restoreLoadCleanup = await cleanupTaggedData(restoreSql, {
    accountPrefixes: [loadPrefix],
    courseIds: [loadCourseId],
    coreCourseSlugs: [loadCoreCourseSlug],
    textMarkers: [runId],
  });
  assertZeroResidual(restoreLoadCleanup, "restore-target-cleanup-nonzero");

  currentStage = "fifteen-minute-health-observation";
  const health = await healthPromise;
  report.health = summarizeHealth(health);
  if (report.health.status !== "PASS") {
    throw new P2ExecutionError("health-observation-failed");
  }

  currentStage = "manual-fixture-cleanup";
  sourceManualCleanup = await cleanupTaggedData(sourceSql, {
    accountPrefixes: [manualPrefix],
    courseIds: [manualCourseId],
    coreCourseSlugs: [],
    textMarkers: [manualPrefix],
  });
  assertZeroResidual(sourceManualCleanup, "manual-fixture-cleanup-nonzero");

  report.cleanup = {
    status: "PASS",
    sourceLoad: sourceLoadCleanup,
    sourceManual: sourceManualCleanup,
    restoreTargetLoad: restoreLoadCleanup,
    residualTaggedRows: 0,
  };
  report.status = "PASS";
} catch (error) {
  healthAbortController.abort();
  await healthPromise.catch(() => []);
  report.failureCode =
    error instanceof P2ExecutionError ? error.code : "unexpected-staging-executor-failure";
  report.failureDiagnostic = {
    stage: currentStage,
    kind: error instanceof Error ? error.constructor.name : typeof error,
    storeStatus:
      error && typeof error === "object" && typeof error.status === "number"
        ? error.status
        : "unavailable",
    storeReasonCode:
      error && typeof error === "object" && typeof error.reasonCode === "string"
        ? error.reasonCode.slice(0, 48)
        : "unavailable",
    knownStoreFailure: classifyKnownStoreFailure(error),
    code:
      error && typeof error === "object" && typeof error.code === "string"
        ? error.code.slice(0, 40)
        : "unavailable",
    sqlOperation:
      error && typeof error === "object" && typeof error.query === "string"
        ? classifySqlOperation(error.query)
        : "unavailable",
    messageOmitted: true,
  };
  await bestEffortCleanup();
  report.cleanup = {
    status:
      [sourceLoadCleanup, sourceManualCleanup, restoreLoadCleanup].every(
        (entry) => entry && entry.residualTaggedRows === 0,
      )
        ? "PASS"
        : "FAIL",
    sourceLoad: sourceLoadCleanup,
    sourceManual: sourceManualCleanup,
    restoreTargetLoad: restoreLoadCleanup,
  };
} finally {
  await resetUaisCoreDatabasePoolForTesting().catch(() => undefined);
  await Promise.all([
    sourceSql.end({ timeout: 5 }).catch(() => undefined),
    restoreSql.end({ timeout: 5 }).catch(() => undefined),
  ]);
  report.elapsedSeconds = Math.round((Date.now() - executionStartedAt) / 1_000);
  report.restoreCompleted = restoreCompleted;
  emit(report);
  process.exitCode = report.status === "PASS" ? 0 : 1;
}

async function seedAccounts() {
  const accountRows = [
    {
      account: loadTeacherAccount,
      password: loadPassword,
      role: "teacher",
      displayName: "P2 Load Teacher",
      department: `P2 staging ${runId}`,
    },
    ...loadStudentAccounts.map((account, index) => ({
      account,
      password: loadPassword,
      role: "student",
      displayName: `P2 Load Student ${String(index + 1).padStart(3, "0")}`,
      department: `P2 staging ${runId}`,
    })),
    {
      account: manualTeacherAccount,
      password: manualPassword,
      role: "teacher",
      displayName: "P2 Manual Teacher",
      department: "P2 staging manual accessibility",
    },
    {
      account: manualStudentAccount,
      password: manualPassword,
      role: "student",
      displayName: "P2 Manual Student",
      department: "P2 staging manual accessibility",
    },
  ];
  currentStage = "account-password-hashing";
  const hashedRows = await mapLimit(accountRows, 8, async (row) => ({
    account: row.account,
    password_hash: await hashAccountPassword(row.password),
    role: row.role,
    display_name: row.displayName,
    department: row.department,
    status: "active",
  }));
  currentStage = "account-bulk-insert";
  // Postgres.js' object-list helper inherits the runtime's module identity.
  // Under Vercel's `node --import tsx` build process the helper receives the
  // array across an ESM/CJS interop boundary and rejects it as a non-query
  // value. One parameterized INSERT per row inside ONE transaction avoids that
  // encoder boundary, retains all-or-nothing setup, and is bounded at 203 rows.
  const inserted = [];
  await sourceSql.begin(async (sql) => {
    for (const row of hashedRows) {
      const rows = await sql`
        INSERT INTO uais_users (
          account, password_hash, role, display_name, department, status
        )
        VALUES (
          ${row.account}::text,
          ${row.password_hash}::text,
          ${row.role}::text,
          ${row.display_name}::text,
          ${row.department}::text,
          ${row.status}::text
        )
        ON CONFLICT (account) DO NOTHING
        RETURNING id, account
      `;
      inserted.push(...rows);
    }
  });
  if (inserted.length !== accountRows.length) {
    throw new P2ExecutionError("fixture-account-seed-count-mismatch");
  }
  return {
    userIdsByAccount: new Map(inserted.map((row) => [row.account, row.id])),
  };
}

async function createCourseFixture({ repository, actorId, courseId, name }) {
  currentStage = actorId === loadTeacherAccount ? "load-course-create" : "manual-course-create";
  const { course } = await createTeachingCourseRecord({
    dataDir: "/tmp/uais-p2-staging-fixture",
    repository,
    actorId,
    draft: {
      courseId,
      name,
      instructor: "P2 Staging Teacher",
      unit: "UAIS isolated staging",
      department: "P2 Quality",
      semester: "2026 Fall",
      description: `Tagged isolated staging fixture ${courseId}`,
    },
  });
  currentStage = actorId === loadTeacherAccount ? "load-class-create" : "manual-class-create";
  const { classItem } = await createTeachingClassRecord({
    dataDir: "/tmp/uais-p2-staging-fixture",
    repository,
    actorId,
    courseId: course.courseId,
    draft: { className: `${course.courseId}-class` },
  });
  return { course, classItem };
}

async function seedCoreRelationshipFixture(userIdsByAccount) {
  const teacherId = userIdsByAccount.get(loadTeacherAccount);
  if (!teacherId) {
    throw new P2ExecutionError("core-fixture-teacher-id-missing");
  }
  const courseSlug = `${runId}-core`;
  currentStage = "core-course-insert";
  const [course] = await sourceSql`
    INSERT INTO uais_courses (slug, title, description, teacher_id, status)
    VALUES (
      ${courseSlug},
      ${`P2 recovery ${runId}`},
      ${`Tagged recovery fixture ${runId}`},
      ${teacherId},
      'published'
    )
    RETURNING id
  `;
  currentStage = "core-class-insert";
  const [classItem] = await sourceSql`
    INSERT INTO uais_classes (course_id, teacher_id, name, status)
    VALUES (${course.id}, ${teacherId}, ${`P2 class ${runId}`}, 'open')
    RETURNING id
  `;
  currentStage = "core-enrollment-insert";
  await sourceSql`
    INSERT INTO uais_enrollments (user_id, course_id, class_id, state, progress)
    SELECT id, ${course.id}, ${classItem.id}, 'active', 25.00
    FROM uais_users
    WHERE account LIKE ${`${loadPrefix}student-%`}
  `;
  currentStage = "core-learning-event-insert";
  await sourceSql`
    INSERT INTO uais_learning_events (
      user_id, course_id, class_id, verb, object_id, context, occurred_at
    )
    SELECT
      id,
      ${course.id},
      ${classItem.id},
      'experienced',
      ${`${runId}-lesson`},
      jsonb_build_object('runId', ${runId}::text),
      now()
    FROM uais_users
    WHERE account LIKE ${`${loadPrefix}student-%`}
  `;
  currentStage = "core-learner-profile-insert";
  await sourceSql`
    INSERT INTO uais_learner_profiles (user_id, course_id, mastery, preferences)
    SELECT
      id,
      ${course.id},
      jsonb_build_object('p2', 0.25, 'runId', ${runId}::text),
      jsonb_build_object('locale', 'zh-CN')
    FROM uais_users
    WHERE account LIKE ${`${loadPrefix}student-%`}
  `;
  return { courseSlug, courseId: course.id, classId: classItem.id };
}

async function loginAccount(account, password) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}/api/auth/app-session`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ account, password }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => undefined);
  const cookie = readCookieHeader(response);
  return {
    ok: response.status === 200 && Boolean(cookie),
    status: response.status,
    role: body?.appSession?.actor?.role,
    teacherBridgeIssued: body?.verifiedTeacherAuthBridge?.status === "issued",
    cookie,
    latencyMs: performance.now() - started,
  };
}

async function requestWithRetries({ id, expectedStatus, run, validateBody }) {
  const logicalStarted = performance.now();
  let lastStatus = 0;
  for (let attempt = 1; attempt <= maximumLogicalAttempts; attempt += 1) {
    try {
      const response = await run();
      lastStatus = response.status;
      const body = await response.json().catch(() => undefined);
      const validBody = validateBody ? validateBody(body) : true;
      if (response.status === expectedStatus && validBody) {
        return {
          id,
          ok: true,
          status: response.status,
          attempts: attempt,
          latencyMs: performance.now() - logicalStarted,
        };
      }
      if (!isRetryableStatus(response.status) || attempt === maximumLogicalAttempts) {
        return {
          id,
          ok: false,
          status: response.status,
          attempts: attempt,
          latencyMs: performance.now() - logicalStarted,
        };
      }
    } catch {
      lastStatus = 0;
      if (attempt === maximumLogicalAttempts) {
        return {
          id,
          ok: false,
          status: 0,
          attempts: attempt,
          latencyMs: performance.now() - logicalStarted,
        };
      }
    }
    await delay(100 * attempt);
  }
  return {
    id,
    ok: false,
    status: lastStatus,
    attempts: maximumLogicalAttempts,
    latencyMs: performance.now() - logicalStarted,
  };
}

async function inspectSourceLoadState() {
  const [courseRow] = await sourceSql`
    SELECT database
    FROM uais_teaching_course_management_snapshots
    WHERE snapshot_key = ${loadCourseId}
  `;
  const database = courseRow?.database ?? {};
  const memberships = Array.isArray(database.memberships) ? database.memberships : [];
  const groups = Array.isArray(database.learningGroups) ? database.learningGroups : [];
  const transcriptRows = await sourceSql`
    SELECT database
    FROM uais_learning_chatroom_transcript_snapshots
    WHERE database::text LIKE ${`%${runId}%`}
  `;
  return {
    memberships: memberships.length,
    approvedMemberships: memberships.filter(
      (membership) => membership.membershipStatus === "approved",
    ).length,
    groups: groups.length,
    groupMembers: groups.reduce(
      (total, group) => total + (Array.isArray(group.members) ? group.members.length : 0),
      0,
    ),
    transcriptMessages: countTranscriptMessages(transcriptRows),
  };
}

async function captureTaggedBackup() {
  const users = await sourceSql`
    SELECT id, account, password_hash, role, display_name, department, status,
      created_at, updated_at
    FROM uais_users
    WHERE account LIKE ${`${loadPrefix}%`}
    ORDER BY account
  `;
  const courses = await sourceSql`
    SELECT id, slug, title, description, teacher_id, status, created_at, updated_at
    FROM uais_courses
    WHERE slug = ${loadCoreCourseSlug}
  `;
  const courseIds = courses.map((row) => row.id);
  const classes = courseIds.length
    ? await sourceSql`
        SELECT id, course_id, teacher_id, name, status, created_at, updated_at
        FROM uais_classes
        WHERE course_id = ANY(${courseIds}::uuid[])
      `
    : [];
  const enrollments = courseIds.length
    ? await sourceSql`
        SELECT id, user_id, course_id, class_id, state, progress, created_at, updated_at
        FROM uais_enrollments
        WHERE course_id = ANY(${courseIds}::uuid[])
      `
    : [];
  const events = courseIds.length
    ? await sourceSql`
        SELECT id, user_id, course_id, class_id, verb, object_id, context,
          occurred_at, created_at
        FROM uais_learning_events
        WHERE course_id = ANY(${courseIds}::uuid[])
      `
    : [];
  const profiles = courseIds.length
    ? await sourceSql`
        SELECT user_id, course_id, mastery, preferences, updated_at
        FROM uais_learner_profiles
        WHERE course_id = ANY(${courseIds}::uuid[])
      `
    : [];
  const courseSnapshots = await sourceSql`
    SELECT snapshot_key, database, revision, updated_at
    FROM uais_teaching_course_management_snapshots
    WHERE snapshot_key = ${loadCourseId}
  `;
  const inviteClaims = await sourceSql`
    SELECT invite_code, course_id, class_id, claimed_at
    FROM uais_teaching_class_invite_code_claims
    WHERE course_id = ${loadCourseId}
  `;
  const transcripts = await sourceSql`
    SELECT snapshot_key, database, revision, updated_at
    FROM uais_learning_chatroom_transcript_snapshots
    WHERE database::text LIKE ${`%${runId}%`}
    ORDER BY snapshot_key
  `;
  return {
    users,
    courses,
    classes,
    enrollments,
    events,
    profiles,
    courseSnapshots,
    inviteClaims,
    transcripts,
  };
}

async function restoreTaggedBackup(backup) {
  await restoreSql.begin(async (sql) => {
    for (const row of backup.users) {
      await sql`
        INSERT INTO uais_users (
          id, account, password_hash, role, display_name, department, status,
          created_at, updated_at
        )
        VALUES (
          ${row.id}, ${row.account}, ${row.password_hash}, ${row.role},
          ${row.display_name}, ${row.department}, ${row.status},
          ${row.created_at}, ${row.updated_at}
        )
      `;
    }
    for (const row of backup.courses) {
      await sql`
        INSERT INTO uais_courses (
          id, slug, title, description, teacher_id, status, created_at, updated_at
        )
        VALUES (
          ${row.id}, ${row.slug}, ${row.title}, ${row.description},
          ${row.teacher_id}, ${row.status}, ${row.created_at}, ${row.updated_at}
        )
      `;
    }
    for (const row of backup.classes) {
      await sql`
        INSERT INTO uais_classes (
          id, course_id, teacher_id, name, status, created_at, updated_at
        )
        VALUES (
          ${row.id}, ${row.course_id}, ${row.teacher_id}, ${row.name},
          ${row.status}, ${row.created_at}, ${row.updated_at}
        )
      `;
    }
    for (const row of backup.enrollments) {
      await sql`
        INSERT INTO uais_enrollments (
          id, user_id, course_id, class_id, state, progress, created_at, updated_at
        )
        VALUES (
          ${row.id}, ${row.user_id}, ${row.course_id}, ${row.class_id},
          ${row.state}, ${row.progress}, ${row.created_at}, ${row.updated_at}
        )
      `;
    }
    for (const row of backup.events) {
      await sql`
        INSERT INTO uais_learning_events (
          id, user_id, course_id, class_id, verb, object_id, context,
          occurred_at, created_at
        )
        VALUES (
          ${row.id}, ${row.user_id}, ${row.course_id}, ${row.class_id},
          ${row.verb}, ${row.object_id}, ${JSON.stringify(row.context)}::text::jsonb,
          ${row.occurred_at}, ${row.created_at}
        )
      `;
    }
    for (const row of backup.profiles) {
      await sql`
        INSERT INTO uais_learner_profiles (
          user_id, course_id, mastery, preferences, updated_at
        )
        VALUES (
          ${row.user_id}, ${row.course_id},
          ${JSON.stringify(row.mastery)}::text::jsonb,
          ${JSON.stringify(row.preferences)}::text::jsonb,
          ${row.updated_at}
        )
      `;
    }
    for (const row of backup.courseSnapshots) {
      await sql`
        INSERT INTO uais_teaching_course_management_snapshots (
          snapshot_key, database, revision, updated_at
        )
        VALUES (
          ${row.snapshot_key}, ${JSON.stringify(row.database)}::text::jsonb,
          ${row.revision}, ${row.updated_at}
        )
      `;
    }
    for (const row of backup.inviteClaims) {
      await sql`
        INSERT INTO uais_teaching_class_invite_code_claims (
          invite_code, course_id, class_id, claimed_at
        )
        VALUES (
          ${row.invite_code}, ${row.course_id}, ${row.class_id}, ${row.claimed_at}
        )
      `;
    }
    for (const row of backup.transcripts) {
      await sql`
        INSERT INTO uais_learning_chatroom_transcript_snapshots (
          snapshot_key, database, revision, updated_at
        )
        VALUES (
          ${row.snapshot_key}, ${JSON.stringify(row.database)}::text::jsonb,
          ${row.revision}, ${row.updated_at}
        )
      `;
    }
  });
}

async function verifyRestoredBackup(backup, plaintextPassword) {
  const [migrationRows, schemaRows, userRows, courseRows, enrollmentRows, eventRows, profileRows,
    snapshotRows, claimRows, transcriptRows] = await Promise.all([
    restoreSql`SELECT version FROM uais_schema_migrations ORDER BY version`,
    restoreSql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'uais_langgraph'`,
    restoreSql`
      SELECT account, password_hash
      FROM uais_users
      WHERE account LIKE ${`${loadPrefix}%`}
      ORDER BY account
    `,
    restoreSql`SELECT id FROM uais_courses WHERE slug = ${loadCoreCourseSlug}`,
    restoreSql`
      SELECT count(*)::int AS count
      FROM uais_enrollments e
      JOIN uais_courses c ON c.id = e.course_id
      WHERE c.slug = ${loadCoreCourseSlug}
    `,
    restoreSql`
      SELECT count(*)::int AS count
      FROM uais_learning_events e
      JOIN uais_courses c ON c.id = e.course_id
      WHERE c.slug = ${loadCoreCourseSlug}
    `,
    restoreSql`
      SELECT count(*)::int AS count
      FROM uais_learner_profiles p
      JOIN uais_courses c ON c.id = p.course_id
      WHERE c.slug = ${loadCoreCourseSlug}
    `,
    restoreSql`
      SELECT database
      FROM uais_teaching_course_management_snapshots
      WHERE snapshot_key = ${loadCourseId}
    `,
    restoreSql`
      SELECT count(*)::int AS count
      FROM uais_teaching_class_invite_code_claims
      WHERE course_id = ${loadCourseId}
    `,
    restoreSql`
      SELECT database
      FROM uais_learning_chatroom_transcript_snapshots
      WHERE database::text LIKE ${`%${runId}%`}
    `,
  ]);
  const expectedMigrationVersions = [...UAIS_CORE_DATABASE_MIGRATION_VERSIONS];
  const actualMigrationVersions = migrationRows.map((row) => row.version);
  const database = snapshotRows[0]?.database ?? {};
  const memberships = Array.isArray(database.memberships) ? database.memberships : [];
  const groups = Array.isArray(database.learningGroups) ? database.learningGroups : [];
  const firstUser = userRows[0];
  const lastUser = userRows.at(-1);
  const hashesVerify =
    firstUser &&
    lastUser &&
    (await verifyUaisAccountPassword({
      plaintext: plaintextPassword,
      encoded: firstUser.password_hash,
    })) &&
    (await verifyUaisAccountPassword({
      plaintext: plaintextPassword,
      encoded: lastUser.password_hash,
    }));
  const transcriptMessages = countTranscriptMessages(transcriptRows);
  const counts = {
    users: userRows.length,
    coreCourses: courseRows.length,
    enrollments: enrollmentRows[0]?.count ?? 0,
    learningEvents: eventRows[0]?.count ?? 0,
    learnerProfiles: profileRows[0]?.count ?? 0,
    courseSnapshots: snapshotRows.length,
    inviteClaims: claimRows[0]?.count ?? 0,
    memberships: memberships.length,
    groups: groups.length,
    groupMembers: groups.reduce(
      (total, group) => total + (Array.isArray(group.members) ? group.members.length : 0),
      0,
    ),
    transcriptRows: transcriptRows.length,
    transcriptMessages,
  };
  const expectedCounts = {
    users: backup.users.length,
    coreCourses: backup.courses.length,
    enrollments: backup.enrollments.length,
    learningEvents: backup.events.length,
    learnerProfiles: backup.profiles.length,
    courseSnapshots: backup.courseSnapshots.length,
    inviteClaims: backup.inviteClaims.length,
    memberships: expectedUserCount,
    groups: expectedGroupCount,
    groupMembers: expectedUserCount,
    transcriptRows: backup.transcripts.length,
    transcriptMessages: expectedUserCount * (expectedLoadDurationSeconds / 60),
  };
  return {
    ok:
      JSON.stringify(actualMigrationVersions) === JSON.stringify(expectedMigrationVersions) &&
      schemaRows.length === 1 &&
      Boolean(hashesVerify) &&
      JSON.stringify(counts) === JSON.stringify(expectedCounts),
    counts,
  };
}

async function cleanupTaggedData(sql, targets) {
  for (const courseId of targets.courseIds) {
    if (!courseId) continue;
    await sql`DELETE FROM uais_teaching_class_invite_code_claims WHERE course_id = ${courseId}`;
    await sql`DELETE FROM uais_teaching_course_management_snapshots WHERE snapshot_key = ${courseId}`;
    await sql`DELETE FROM uais_teaching_course_management_snapshots_retired WHERE snapshot_key = ${courseId}`;
  }
  for (const marker of targets.textMarkers) {
    if (!marker) continue;
    const pattern = `%${marker}%`;
    await sql`DELETE FROM uais_learning_chatroom_transcript_snapshots WHERE database::text LIKE ${pattern}`;
    await sql`DELETE FROM uais_learning_chatroom_transcript_snapshots_retired WHERE database::text LIKE ${pattern}`;
    await sql`DELETE FROM uais_learning_chatroom_share_snapshots WHERE database::text LIKE ${pattern}`;
    await sql`DELETE FROM uais_teaching_operations_snapshots WHERE database::text LIKE ${pattern}`;
  }
  for (const slug of targets.coreCourseSlugs) {
    if (!slug) continue;
    await sql`DELETE FROM uais_courses WHERE slug = ${slug}`;
  }
  for (const prefix of targets.accountPrefixes) {
    if (!prefix) continue;
    await sql`DELETE FROM uais_app_login_failures WHERE account_key LIKE ${`${prefix}%`}`;
    await sql`DELETE FROM uais_users WHERE account LIKE ${`${prefix}%`}`;
  }
  return inspectResidualData(sql, targets);
}

async function inspectResidualData(sql, targets) {
  let residualTaggedRows = 0;
  const counts = {
    users: 0,
    loginFailures: 0,
    coreCourses: 0,
    courseSnapshots: 0,
    inviteClaims: 0,
    transcriptSnapshots: 0,
    retiredTranscriptSnapshots: 0,
    shareSnapshots: 0,
    operationSnapshots: 0,
  };
  for (const prefix of targets.accountPrefixes) {
    if (!prefix) continue;
    const [users, failures] = await Promise.all([
      sql`SELECT count(*)::int AS count FROM uais_users WHERE account LIKE ${`${prefix}%`}`,
      sql`SELECT count(*)::int AS count FROM uais_app_login_failures WHERE account_key LIKE ${`${prefix}%`}`,
    ]);
    counts.users += users[0]?.count ?? 0;
    counts.loginFailures += failures[0]?.count ?? 0;
  }
  for (const slug of targets.coreCourseSlugs) {
    if (!slug) continue;
    const rows = await sql`SELECT count(*)::int AS count FROM uais_courses WHERE slug = ${slug}`;
    counts.coreCourses += rows[0]?.count ?? 0;
  }
  for (const courseId of targets.courseIds) {
    if (!courseId) continue;
    const [snapshots, claims] = await Promise.all([
      sql`
        SELECT count(*)::int AS count
        FROM uais_teaching_course_management_snapshots
        WHERE snapshot_key = ${courseId}
      `,
      sql`
        SELECT count(*)::int AS count
        FROM uais_teaching_class_invite_code_claims
        WHERE course_id = ${courseId}
      `,
    ]);
    counts.courseSnapshots += snapshots[0]?.count ?? 0;
    counts.inviteClaims += claims[0]?.count ?? 0;
  }
  for (const marker of targets.textMarkers) {
    if (!marker) continue;
    const pattern = `%${marker}%`;
    const [transcripts, retired, shares, operations] = await Promise.all([
      sql`
        SELECT count(*)::int AS count
        FROM uais_learning_chatroom_transcript_snapshots
        WHERE database::text LIKE ${pattern}
      `,
      sql`
        SELECT count(*)::int AS count
        FROM uais_learning_chatroom_transcript_snapshots_retired
        WHERE database::text LIKE ${pattern}
      `,
      sql`
        SELECT count(*)::int AS count
        FROM uais_learning_chatroom_share_snapshots
        WHERE database::text LIKE ${pattern}
      `,
      sql`
        SELECT count(*)::int AS count
        FROM uais_teaching_operations_snapshots
        WHERE database::text LIKE ${pattern}
      `,
    ]);
    counts.transcriptSnapshots += transcripts[0]?.count ?? 0;
    counts.retiredTranscriptSnapshots += retired[0]?.count ?? 0;
    counts.shareSnapshots += shares[0]?.count ?? 0;
    counts.operationSnapshots += operations[0]?.count ?? 0;
  }
  residualTaggedRows = Object.values(counts).reduce((total, count) => total + count, 0);
  return { ...counts, residualTaggedRows };
}

async function observeHealth(signal) {
  const samples = [];
  for (let index = 1; index <= expectedHealthSamples; index += 1) {
    await delay(healthIntervalMs, signal);
    if (signal.aborted) break;
    const started = performance.now();
    try {
      const response = await fetch(`${baseUrl}/healthz`, {
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
      });
      const body = await response.json().catch(() => undefined);
      samples.push({
        sample: index,
        status: response.status,
        latencyMs: Math.round(performance.now() - started),
        requestId: response.headers.get("x-vercel-id") ?? "missing",
        checksOk:
          body?.status === "ok" &&
          body?.checks?.app === "ok" &&
          body?.checks?.database === "ok" &&
          body?.checks?.migrations === "ok",
      });
    } catch {
      samples.push({
        sample: index,
        status: 0,
        latencyMs: Math.round(performance.now() - started),
        requestId: "missing",
        checksOk: false,
      });
    }
  }
  return samples;
}

function summarizeHealth(samples) {
  const latencies = samples.map((sample) => sample.latencyMs);
  return {
    status:
      samples.length === expectedHealthSamples &&
      samples.every((sample) => sample.status === 200 && sample.checksOk)
        ? "PASS"
        : "FAIL",
    cadenceSeconds: healthIntervalMs / 1_000,
    sampleCount: samples.length,
    successCount: samples.filter((sample) => sample.status === 200 && sample.checksOk).length,
    p95Milliseconds: percentile(latencies, 0.95),
    samples,
  };
}

async function bestEffortCleanup() {
  sourceLoadCleanup ??= await cleanupTaggedData(sourceSql, {
    accountPrefixes: [loadPrefix],
    courseIds: [loadCourseId],
    coreCourseSlugs: [loadCoreCourseSlug || `${runId}-core`],
    textMarkers: [runId],
  }).catch(() => undefined);
  sourceManualCleanup ??= await cleanupTaggedData(sourceSql, {
    accountPrefixes: [manualPrefix],
    courseIds: [manualCourseId],
    coreCourseSlugs: [],
    textMarkers: [manualPrefix],
  }).catch(() => undefined);
  restoreLoadCleanup ??= await cleanupTaggedData(restoreSql, {
    accountPrefixes: [loadPrefix],
    courseIds: [loadCourseId],
    coreCourseSlugs: [loadCoreCourseSlug || `${runId}-core`],
    textMarkers: [runId],
  }).catch(() => undefined);
}

function validateExecutionBoundary() {
  const reasons = validateHealthExecutionBoundary();
  if (process.env.P2_LOAD_CLEANUP_CONFIRM !== "run-id-cleanup") {
    reasons.push("missing-P2_LOAD_CLEANUP_CONFIRM");
  }
  if (process.env.UAIS_LEARNING_CHATROOM_GROUPS_MODE !== "on") {
    reasons.push("staging-groups-mode-not-on");
  }
  if (!sourceDatabaseUrl) {
    reasons.push("dedicated-source-staging-database-url-missing");
  }
  if (!restoreDatabaseUrl) {
    reasons.push("dedicated-restore-staging-database-url-missing");
  }
  if (sourceDatabaseUrl && sourceDatabaseUrl === restoreDatabaseUrl) {
    reasons.push("source-and-restore-database-must-differ");
  }
  if (!sourceNeonProjectId) reasons.push("source-neon-project-id-missing");
  if (!restoreNeonProjectId) reasons.push("restore-neon-project-id-missing");
  if (sourceNeonProjectId === productionNeonProjectId) {
    reasons.splice(0, reasons.length, "production-neon-project-id-rejected");
  }
  if (sourceNeonProjectId && sourceNeonProjectId === restoreNeonProjectId) {
    reasons.push("source-and-restore-neon-project-must-differ");
  }
  if (manualPassword.length < 32) reasons.push("manual-test-password-missing-or-weak");
  if (!/^p2-[a-z0-9-]{8,23}$/.test(runId)) reasons.push("invalid-P2_LOAD_RUN_ID");
  return [...new Set(reasons)];
}

function validateHealthExecutionBoundary() {
  const reasons = [];
  let hostname = "";
  try {
    const url = new URL(baseUrlValue);
    hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:") reasons.push("staging-target-must-use-https");
  } catch {
    reasons.push("invalid-P2_LOAD_BASE_URL");
  }
  if (!baseUrlValue) reasons.push("missing-P2_LOAD_BASE_URL");
  if (process.env.P2_LOAD_CONFIRM !== "staging") reasons.push("missing-P2_LOAD_CONFIRM");
  if (!allowlist.has(requiredStagingHostname) || !allowlist.has(hostname)) {
    reasons.push("hostname-not-allowlisted");
  }
  if (
    productionHostnames.has(hostname) ||
    (hostname.endsWith(".uais.top") && hostname !== requiredStagingHostname)
  ) {
    reasons.splice(0, reasons.length, "production-hostname-rejected");
  }
  if (hostname && hostname !== requiredStagingHostname) reasons.push("canonical-staging-host-required");
  if (process.env.UAIS_DEPLOYMENT_ENV !== "staging") reasons.push("staging-deployment-marker-missing");
  if (process.env.VERCEL_PROJECT_ID !== expectedStagingProjectId) {
    reasons.push("isolated-staging-project-id-mismatch");
  }
  if (process.env.VERCEL_PROJECT_ID === productionProjectId) {
    reasons.splice(0, reasons.length, "production-project-id-rejected");
  }
  return [...new Set(reasons)];
}

async function validateDatabaseGuards(source, restore) {
  const reasons = [];
  if (!(await hasDatabaseGuard(source, "isolated-p2-staging-source"))) {
    reasons.push("source-database-internal-guard-required");
  }
  if (!(await hasDatabaseGuard(restore, "isolated-p2-staging-restore"))) {
    reasons.push("restore-database-internal-guard-required");
  }
  return reasons;
}

async function hasDatabaseGuard(sql, environment) {
  try {
    const rows = await sql`
      SELECT environment
      FROM uais_environment_guard
      WHERE environment = ${environment} AND enabled = true
      LIMIT 1
    `;
    return rows.length === 1;
  } catch {
    return false;
  }
}

function summarizeMetrics(results) {
  const total = results.length;
  const successCount = results.filter((result) => result.ok).length;
  const serverErrorCount = results.filter(
    (result) => result.status >= 500 && result.status <= 599,
  ).length;
  const latencies = results.map((result) => result.latencyMs);
  return {
    requestCount: total,
    successCount,
    failureCount: total - successCount,
    successRate: total ? roundRate(successCount / total) : 0,
    serverErrorCount,
    serverErrorRate: total ? roundRate(serverErrorCount / total) : 0,
    retryCount: results.reduce((totalRetries, result) => totalRetries + result.attempts - 1, 0),
    p95Milliseconds: percentile(latencies, 0.95),
    maximumMilliseconds: latencies.length ? Math.round(Math.max(...latencies)) : 0,
  };
}

function metricsPass(metrics) {
  return (
    metrics.successRate >= minimumSuccessRate &&
    metrics.serverErrorRate <= maximumServerErrorRate &&
    metrics.p95Milliseconds <= maximumP95Milliseconds
  );
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => undefined);
  return { status: response.status, body, headers: response.headers };
}

function readCookieHeader(response) {
  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
  return setCookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

async function mapLimit(values, limit, run) {
  const results = new Array(values.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= values.length) return;
        results[index] = await run(values[index], index);
      }
    }),
  );
  return results;
}

function countTranscriptMessages(rows) {
  return rows.reduce((total, row) => {
    const transcripts = Array.isArray(row.database?.transcripts)
      ? row.database.transcripts
      : [];
    return (
      total +
      transcripts.reduce(
        (roomTotal, transcript) =>
          roomTotal + (Array.isArray(transcript?.messages) ? transcript.messages.length : 0),
        0,
      )
    );
  }, 0);
}

function createSql(url) {
  return postgres(url, {
    max: 10,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 30,
    max_lifetime: 1_800,
  });
}

function createSafetyRecord(networkUsed) {
  return {
    networkUsed,
    isolatedStagingProjectRequired: true,
    productionProjectRejected: true,
    productionHostnamesRejected: true,
    productionNeonProjectRejected: true,
    distinctRestoreTargetRequired: true,
    explicitStagingConfirmationRequired: true,
    cleanupByRunIdRequired: true,
    fixtureCredentialsOmitted: true,
    liveProviderUsed: false,
    productionFeatureFlagsModified: false,
  };
}

function assertZeroResidual(result, code) {
  if (!result || result.residualTaggedRows !== 0) {
    throw new P2ExecutionError(code);
  }
}

function percentile(values, quantile) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1);
  return Math.round(sorted[index]);
}

function roundRate(value) {
  return Number(value.toFixed(6));
}

function fingerprint(value) {
  return value ? createHash("sha256").update(value).digest("hex").slice(0, 12) : "missing";
}

function isRetryableStatus(status) {
  return status === 409 || status === 429 || (status >= 500 && status <= 599);
}

function classifySqlOperation(query) {
  const normalized = query.toLowerCase();
  if (normalized.includes("insert into uais_users")) {
    return "account-fixture-insert";
  }
  if (normalized.includes("insert into uais_teaching_course_management_snapshots")) {
    return "course-snapshot-upsert";
  }
  if (
    normalized.includes("delete from uais_teaching_class_invite_code_claims")
  ) {
    return "invite-claim-reconcile-delete";
  }
  if (
    normalized.includes("insert into uais_teaching_class_invite_code_claims")
  ) {
    return "invite-claim-reconcile-upsert";
  }
  if (normalized.includes("select revision") && normalized.includes("for update")) {
    return "course-snapshot-lock-read";
  }
  if (normalized.includes("select database") && normalized.includes("snapshot_key")) {
    return "course-snapshot-read";
  }
  return "other-redacted-sql";
}

function classifyKnownStoreFailure(error) {
  const message = error instanceof Error ? error.message : "";
  const knownFailures = new Map([
    ["Teaching course was not found.", "course-not-found"],
    ["Teaching course ownership is required.", "course-ownership-required"],
    ["Teaching class already exists.", "class-already-exists"],
    ["Teaching class invite code capacity is exhausted.", "invite-code-capacity-exhausted"],
    ["Teaching class invite code already exists.", "invite-code-conflict"],
    [
      "Postgres teaching course management snapshot changed; retry required.",
      "postgres-snapshot-contention",
    ],
    [
      "Teaching course management snapshot changed; retry required.",
      "snapshot-contention-exhausted",
    ],
  ]);
  const knownFailure = knownFailures.get(message);
  if (knownFailure) return knownFailure;

  const invalidLabel = /^Invalid ([a-z ]+)\.$/.exec(message)?.[1] ?? "";
  return invalidLabel
    ? `invalid-${invalidLabel.replaceAll(" ", "-")}`
    : message === "Teaching course management path escapes the configured data directory."
      ? "configured-data-directory-path-escape"
      : "unclassified-message-omitted";
}

async function waitUntil(timestamp) {
  const remaining = timestamp - Date.now();
  if (remaining > 0) await delay(remaining);
}

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new P2ExecutionError("operation-aborted"));
      return;
    }
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(new P2ExecutionError("operation-aborted"));
      },
      { once: true },
    );
  });
}

function emitProgress(phase, fields) {
  emit({
    target: "p2-isolated-staging-live-executor-progress",
    phase,
    ...fields,
  });
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
