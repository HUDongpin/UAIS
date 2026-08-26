#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CORE_MIGRATION_P1_LOAD_TEST_GUARD } from "./core-migration-guard.mjs";
import {
  LIVE_DB_TEST_CAPABILITY_ENV,
  P1_LOAD_LIVE_DB_TEST_FILE,
} from "./live-db-test-contract.mjs";
import {
  authorizeP1LoadTestTarget,
  mintLiveDatabaseTestCapability,
  validateVitestLaneResult,
} from "./run-db-tests.mjs";

const target = "uais-p1-200-student-load-lane";
const databaseEnvName = "UAIS_P1_LOAD_TEST_DATABASE_URL";
const diagnosticFileEnvName = "UAIS_P1_LOAD_DIAGNOSTIC_FILE";
const diagnosticTarget = "uais-p1-200-student-load-diagnostic";
const diagnosticPoolMax = 40;
const diagnosticSampleIntervalMs = 100;
const diagnosticPhaseSchemas = new Map([
  ["task-read", { operationCount: 200, concurrency: 50 }],
  ["checkpoint", { operationCount: 200, concurrency: 40 }],
  ["autosave", { operationCount: 600, concurrency: 40 }],
  ["submit", { operationCount: 200, concurrency: 50 }],
  ["teacher-decision", { operationCount: 20, concurrency: 20 }],
]);
const diagnosticPhaseIds = [...diagnosticPhaseSchemas.keys()];
const diagnosticOperationSampleLimit = 600;
const diagnosticWaitCategories = [
  "lock",
  "io",
  "lwlock",
  "client",
  "ipc",
  "timeout",
  "activity",
  "extension",
  "bufferPin",
  "none",
  "other",
];
const loadLane = {
  id: "p1-load",
  testFiles: [P1_LOAD_LIVE_DB_TEST_FILE],
  expectedTests: 1,
};

export async function runGuardedP1LoadTest({
  env = process.env,
  inspectTarget,
  childRunner = runChild,
  cwd = process.cwd(),
  nodeExecutable = process.execPath,
} = {}) {
  const authorization = await authorizeP1LoadTestTarget({
    env,
    ...(inspectTarget ? { inspectTarget } : {}),
  });
  if (authorization.exitCode !== 0) return authorization;
  const databaseUrl = authorization.databaseUrl;

  const isolatedEnv = selectP1LoadTestEnvironment(env);
  isolatedEnv.UAIS_CORE_DATABASE_URL = databaseUrl;
  isolatedEnv.UAIS_CORE_DATABASE_REQUIRED_GUARD =
    CORE_MIGRATION_P1_LOAD_TEST_GUARD;

  const migrationResult = safelyRunChild(childRunner, {
    phase: "migration",
    command: nodeExecutable,
    args: ["scripts/apply-core-migrations.mjs"],
    cwd,
    env: isolatedEnv,
  });
  if (migrationResult.status !== 0) {
    return failedP1LoadTestResult("migration-process-failed");
  }

  const capability = mintLiveDatabaseTestCapability(loadLane.id);
  const testEnv = { ...isolatedEnv };
  testEnv[LIVE_DB_TEST_CAPABILITY_ENV.file] = capability.file;
  testEnv[LIVE_DB_TEST_CAPABILITY_ENV.token] = capability.token;
  testEnv[LIVE_DB_TEST_CAPABILITY_ENV.lane] = loadLane.id;
  const diagnosticCapability = createP1LoadDiagnosticCapability();
  testEnv[diagnosticFileEnvName] = diagnosticCapability.file;

  let testResult;
  let diagnostics;
  try {
    testResult = safelyRunChild(childRunner, {
      phase: "test",
      command: nodeExecutable,
      args: [
        "node_modules/vitest/vitest.mjs",
        "run",
        "--environment",
        "node",
        "--no-file-parallelism",
        "--silent",
        "--reporter=json",
        P1_LOAD_LIVE_DB_TEST_FILE,
      ],
      cwd,
      env: testEnv,
    });
    diagnostics = diagnosticCapability.read();
  } finally {
    capability.cleanup();
    diagnosticCapability.cleanup();
  }

  const laneResult = validateVitestLaneResult({
    lane: loadLane,
    runnerResult: testResult,
  });
  if (!laneResult.approved) {
    return failedP1LoadTestResult(laneResult.reason, {
      testResult,
      diagnostics,
    });
  }
  if (diagnostics?.status !== "CAPTURED") {
    return failedP1LoadTestResult(
      diagnostics?.status === "INVALID"
        ? "p1-load-diagnostic-receipt-invalid"
        : "p1-load-diagnostic-receipt-missing",
      { diagnostics, includeDiagnosticStatus: true },
    );
  }

  return {
    exitCode: 0,
    report: {
      target,
      status: "PASS",
      blockedReasons: [],
      selectedEnvName: databaseEnvName,
      databaseGuard: {
        table: "public.uais_environment_guard",
        environment: CORE_MIGRATION_P1_LOAD_TEST_GUARD,
        enabled: true,
        sessionReplicationRole: "origin",
      },
      studentCount: 200,
      autosaveWindowSeconds: 300,
      submitWindowSeconds: 30,
      decisionCount: 20,
      lane: laneResult.summary,
      diagnostics,
      valuesRedacted: true,
    },
  };
}

function createP1LoadDiagnosticCapability() {
  // This private mode-0600 capability file is intentionally unsigned. Its
  // nested diagnostic schema remains v1; the separate external receipt v4
  // envelope is responsible for HMAC authentication.
  const directory = mkdtempSync(join(tmpdir(), "uais-p1-load-diagnostic-"));
  chmodSync(directory, 0o700);
  const file = join(directory, "receipt.json");
  return {
    file,
    read() {
      if (!existsSync(file)) {
        return { status: "MISSING", valuesRedacted: true };
      }
      try {
        const sanitized = sanitizeP1LoadDiagnostics(
          JSON.parse(readFileSync(file, "utf8")),
        );
        return sanitized
          ? { status: "CAPTURED", ...sanitized }
          : { status: "INVALID", valuesRedacted: true };
      } catch {
        return { status: "INVALID", valuesRedacted: true };
      }
    },
    cleanup() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function safelyRunChild(childRunner, input) {
  try {
    return childRunner(input) ?? {
      status: null,
      stdout: "",
      stderr: "",
    };
  } catch {
    return { status: null, stdout: "", stderr: "" };
  }
}

function runChild({ command, args, cwd, env }) {
  return spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function selectP1LoadTestEnvironment(env) {
  const allowedNames = [
    "PATH",
    "NODE_PATH",
    "NODE_OPTIONS",
    "NODE_ENV",
    "TZ",
    "CI",
    "LANG",
    "LC_ALL",
    "TERM",
    "NO_COLOR",
    "FORCE_COLOR",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "TMPDIR",
    "TMP",
    "TEMP",
    databaseEnvName,
    "UAIS_DB_TEST_NEON_PROJECT_ID",
    "UAIS_DB_TEST_DSN_FINGERPRINT",
    "UAIS_DB_TEST_DSN_FINGERPRINT_NONCE",
    "UAIS_DB_TEST_LIVE_MUTATION_CONFIRMATION",
  ];
  return Object.fromEntries(
    allowedNames.flatMap((name) =>
      typeof env[name] === "string" ? [[name, env[name]]] : [],
    ),
  );
}

function failedP1LoadTestResult(reason, evidence = {}) {
  const process = summarizeTestProcess(evidence.testResult);
  const diagnostics = evidence.diagnostics;
  return {
    exitCode: 1,
    report: {
      target,
      status: "FAIL",
      blockedReasons: [reason],
      selectedEnvName: databaseEnvName,
      ...(process ? { process } : {}),
      ...(diagnostics &&
      (diagnostics.status === "CAPTURED" ||
        evidence.includeDiagnosticStatus === true ||
        evidence.testResult?.status !== 0)
        ? { diagnostics }
        : {}),
      valuesRedacted: true,
    },
  };
}

function summarizeTestProcess(runnerResult) {
  if (!runnerResult || runnerResult.status === 0) return null;
  const vitest = readVitestCounts(runnerResult.stdout);
  return {
    status: Number.isInteger(runnerResult.status) ? runnerResult.status : null,
    signal:
      typeof runnerResult.signal === "string" &&
      /^[A-Z][A-Z0-9]+$/.test(runnerResult.signal)
        ? runnerResult.signal
        : null,
    timedOut:
      runnerResult?.error?.code === "ETIMEDOUT" ||
      runnerResult?.timedOut === true,
    ...(vitest ? { vitest } : {}),
  };
}

function readVitestCounts(stdout) {
  let result;
  try {
    result = JSON.parse(typeof stdout === "string" ? stdout.trim() : "");
  } catch {
    return null;
  }
  const totalTests = readInteger(result.numTotalTests, 10_000);
  const passedTests = readInteger(result.numPassedTests, 10_000);
  const failedTests = readInteger(result.numFailedTests, 10_000);
  const pendingTests = readInteger(result.numPendingTests, 10_000);
  if ([totalTests, passedTests, failedTests, pendingTests].includes(null)) {
    return null;
  }
  const testResults = Array.isArray(result.testResults)
    ? result.testResults
    : [];
  return {
    totalTests,
    passedTests,
    failedTests,
    pendingTests,
    failedFileCount: testResults.filter(
      (testResult) => testResult?.status === "failed",
    ).length,
  };
}

export function createP1LoadPhaseObserver({ poolMax }) {
  if (!Number.isInteger(poolMax) || poolMax <= 0 || poolMax > 1_000) {
    throw new TypeError("A bounded positive P1 pool maximum is required");
  }

  const observation = {
    sampleCount: 0,
    observerErrorCount: 0,
    connectionPeak: 0,
    busyPeak: 0,
    estimatedQueuePeak: 0,
    queuePresenceSamples: 0,
    saturationSamples: 0,
    transactionAgesMs: [],
    queryAgesMs: [],
    waitSampleCounts: Object.fromEntries(
      diagnosticWaitCategories.map((category) => [category, 0]),
    ),
  };

  return {
    record({ activeOperationCount, sessions }) {
      const boundedSessions = Array.isArray(sessions)
        ? sessions.slice(0, 1_000)
        : [];
      const activeSessions = boundedSessions.filter(
        (session) => session?.state === "active",
      );
      const activeOperations = readMetricInteger(activeOperationCount);
      const estimatedQueue = Math.max(
        0,
        activeOperations - activeSessions.length,
      );

      observation.sampleCount += 1;
      observation.connectionPeak = Math.max(
        observation.connectionPeak,
        boundedSessions.length,
      );
      observation.busyPeak = Math.max(
        observation.busyPeak,
        activeSessions.length,
      );
      observation.estimatedQueuePeak = Math.max(
        observation.estimatedQueuePeak,
        estimatedQueue,
      );
      if (estimatedQueue > 0) observation.queuePresenceSamples += 1;
      if (activeSessions.length >= poolMax) {
        observation.saturationSamples += 1;
      }

      for (const session of boundedSessions) {
        if (isNonNegativeFiniteNumber(session?.transactionAgeMs)) {
          observation.transactionAgesMs.push(
            roundMetric(session.transactionAgeMs),
          );
        }
      }

      const waitCategories = new Set();
      for (const session of activeSessions) {
        if (isNonNegativeFiniteNumber(session?.queryAgeMs)) {
          observation.queryAgesMs.push(roundMetric(session.queryAgeMs));
        }
        waitCategories.add(readDiagnosticWaitCategory(session?.waitEventType));
      }
      for (const category of waitCategories) {
        observation.waitSampleCounts[category] += 1;
      }
    },
    recordError() {
      observation.observerErrorCount += 1;
    },
    snapshot() {
      return {
        ...observation,
        transactionAgesMs: [...observation.transactionAgesMs],
        queryAgesMs: [...observation.queryAgesMs],
        waitSampleCounts: { ...observation.waitSampleCounts },
      };
    },
  };
}

function readDiagnosticWaitCategory(waitEventType) {
  if (waitEventType === null || waitEventType === undefined) return "none";
  const normalized = String(waitEventType).toLowerCase();
  const category = diagnosticWaitCategories.find(
    (candidate) => candidate.toLowerCase() === normalized,
  );
  return category ?? "other";
}

function isNonNegativeFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function diffP1LoadQueryStats(before, after) {
  const unavailable = { available: false, calls: 0, totalExecMs: 0 };
  if (before?.available !== true || after?.available !== true) {
    return unavailable;
  }

  const beforeCalls = readInteger(before.calls, 1_000_000_000);
  const afterCalls = readInteger(after.calls, 1_000_000_000);
  const beforeExecMs = readNumber(before.totalExecMs, 1_000_000_000);
  const afterExecMs = readNumber(after.totalExecMs, 1_000_000_000);
  if (
    [beforeCalls, afterCalls, beforeExecMs, afterExecMs].includes(null) ||
    afterCalls < beforeCalls ||
    afterExecMs < beforeExecMs
  ) {
    return unavailable;
  }

  return {
    available: true,
    calls: afterCalls - beforeCalls,
    totalExecMs: roundMetric(afterExecMs - beforeExecMs),
  };
}

export function buildP1LoadPhaseDiagnostics({
  id,
  operationDurations,
  operationCount,
  concurrency,
  sampleIntervalMs,
  observation,
  queryStats,
}) {
  if (!diagnosticPhaseIds.includes(id)) {
    throw new TypeError("A recognized P1 diagnostic phase is required");
  }
  const durations = readMetricArray(operationDurations);
  const transactionAges = readMetricArray(observation?.transactionAgesMs);
  const queryAges = readMetricArray(observation?.queryAgesMs);
  const interval = readMetric(sampleIntervalMs);
  const calls = readMetricInteger(queryStats?.calls);
  const totalExecMs = readMetric(queryStats?.totalExecMs);
  const waitSampleMs = Object.fromEntries(
    diagnosticWaitCategories.map((category) => [
      category,
      roundMetric(
        readMetric(observation?.waitSampleCounts?.[category]) * interval,
      ),
    ]),
  );
  return {
    id,
    operationCount: readMetricInteger(operationCount),
    concurrency: readMetricInteger(concurrency),
    operationMs: summarizeMetricArray(durations),
    operationSamplesMs: durations.slice(0, diagnosticOperationSampleLimit),
    pool: {
      sampleCount: readMetricInteger(observation?.sampleCount),
      observerErrorCount: readMetricInteger(
        observation?.observerErrorCount,
      ),
      connectionPeak: readMetric(observation?.connectionPeak),
      busyPeak: readMetric(observation?.busyPeak),
      estimatedQueuePeak: readMetric(observation?.estimatedQueuePeak),
      queuePresenceMs: roundMetric(
        readMetric(observation?.queuePresenceSamples) * interval,
      ),
      saturationMs: roundMetric(
        readMetric(observation?.saturationSamples) * interval,
      ),
    },
    transaction: {
      sampleCount: transactionAges.length,
      ageP50Ms: percentile(transactionAges, 0.5),
      ageP95Ms: percentile(transactionAges, 0.95),
      ageMaxMs: maximum(transactionAges),
    },
    query: {
      statsAvailable: queryStats?.available === true,
      calls,
      totalExecMs: roundMetric(totalExecMs),
      meanExecMs: calls > 0 ? roundMetric(totalExecMs / calls) : 0,
      ageP95Ms: percentile(queryAges, 0.95),
      ageMaxMs: maximum(queryAges),
    },
    waitSampleMs,
  };
}

export function writeP1LoadDiagnosticReceipt({ file, receipt }) {
  if (typeof file !== "string" || file.length === 0) {
    throw new TypeError("P1 diagnostic receipt path is required");
  }
  const sanitized = sanitizeP1LoadDiagnostics(receipt);
  if (!sanitized) {
    throw new TypeError("P1 diagnostic receipt is invalid");
  }
  writeFileSync(file, JSON.stringify(sanitized), {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

function summarizeMetricArray(values) {
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: maximum(values),
  };
}

function percentile(values, percentileValue) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(
    0,
    Math.ceil(sorted.length * percentileValue) - 1,
  );
  return roundMetric(sorted[index] ?? 0);
}

function maximum(values) {
  return roundMetric(values.length > 0 ? Math.max(...values) : 0);
}

function readMetricArray(value) {
  return Array.isArray(value) ? value.map(readMetric) : [];
}

function readMetricInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function readMetric(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function roundMetric(value) {
  return Math.round(value * 100) / 100;
}

function sanitizeP1LoadDiagnostics(value) {
  if (
    !value ||
    typeof value !== "object" ||
    value.version !== 1 ||
    value.target !== diagnosticTarget ||
    value.mode !== "diagnostic-only" ||
    value.studentCount !== 200 ||
    value.valuesRedacted !== true
  ) {
    return null;
  }
  const poolMax = readInteger(value.poolMax, 1_000);
  const sampleIntervalMs = readNumber(value.sampleIntervalMs, 10_000);
  const autosaveWindowMs = readNumber(value.autosaveWindowMs, 3_600_000);
  const submitWindowMs = readNumber(value.submitWindowMs, 3_600_000);
  const duplicateVersionCount = readInteger(
    value.duplicateVersionCount,
    1_000_000,
  );
  const counts = sanitizeDiagnosticCounts(value.counts);
  const phases = sanitizeDiagnosticPhases(value.phases);
  if (
    poolMax !== diagnosticPoolMax ||
    sampleIntervalMs !== diagnosticSampleIntervalMs ||
    autosaveWindowMs === null ||
    submitWindowMs === null ||
    duplicateVersionCount === null ||
    !counts ||
    !phases
  ) {
    return null;
  }
  return {
    version: 1,
    target: diagnosticTarget,
    mode: "diagnostic-only",
    studentCount: 200,
    poolMax,
    sampleIntervalMs,
    autosaveWindowMs,
    submitWindowMs,
    counts,
    duplicateVersionCount,
    phases,
    valuesRedacted: true,
  };
}

function sanitizeDiagnosticCounts(value) {
  if (!value || typeof value !== "object") return null;
  const keys = [
    "attempts",
    "submissions",
    "versions",
    "accepted",
    "awaiting",
    "events",
    "outboxRows",
    "profiles",
  ];
  const entries = keys.map((key) => [key, readInteger(value[key], 1_000_000)]);
  return entries.some(([, entry]) => entry === null)
    ? null
    : Object.fromEntries(entries);
}

function sanitizeDiagnosticPhases(value) {
  if (!Array.isArray(value) || value.length !== diagnosticPhaseIds.length) {
    return null;
  }
  const byId = new Map(value.map((phase) => [phase?.id, phase]));
  if (byId.size !== diagnosticPhaseIds.length) return null;
  const phases = diagnosticPhaseIds.map((id) =>
    sanitizeDiagnosticPhase(id, byId.get(id)),
  );
  return phases.some((phase) => !phase) ? null : phases;
}

function sanitizeDiagnosticPhase(id, value) {
  if (!value || typeof value !== "object" || value.id !== id) return null;
  const expectedSchema = diagnosticPhaseSchemas.get(id);
  if (!expectedSchema) return null;
  const operationCount = readInteger(value.operationCount, 100_000);
  const concurrency = readInteger(value.concurrency, 10_000);
  const operationMs = sanitizeTiming(value.operationMs);
  const operationSamplesMs = sanitizeOperationSamples(
    value.operationSamplesMs,
    expectedSchema.operationCount,
  );
  const pool = sanitizePoolDiagnostics(value.pool);
  const transaction = sanitizeTransactionDiagnostics(value.transaction);
  const query = sanitizeQueryDiagnostics(value.query);
  const waitSampleMs = sanitizeWaitDiagnostics(value.waitSampleMs);
  if (
    operationCount !== expectedSchema.operationCount ||
    concurrency !== expectedSchema.concurrency ||
    !operationMs ||
    !operationSamplesMs ||
    !pool ||
    !transaction ||
    !query ||
    !waitSampleMs
  ) {
    return null;
  }
  const recomputedOperationMs = summarizeMetricArray(operationSamplesMs);
  if (!timingsEqual(operationMs, recomputedOperationMs)) return null;
  return {
    id,
    operationCount,
    concurrency,
    operationMs: recomputedOperationMs,
    operationSamplesMs,
    pool,
    transaction,
    query,
    waitSampleMs,
  };
}

function sanitizeOperationSamples(value, expectedCount) {
  if (!Array.isArray(value) || value.length !== expectedCount) return null;
  const samples = value.map((sample) => readNumber(sample, 3_600_000));
  return samples.includes(null) ? null : samples;
}

function timingsEqual(left, right) {
  return (
    left.p50 === right.p50 &&
    left.p95 === right.p95 &&
    left.max === right.max
  );
}

function sanitizeTiming(value) {
  if (!value || typeof value !== "object") return null;
  const p50 = readNumber(value.p50, 3_600_000);
  const p95 = readNumber(value.p95, 3_600_000);
  const max = readNumber(value.max, 3_600_000);
  return p50 === null || p95 === null || max === null
    ? null
    : { p50, p95, max };
}

function sanitizePoolDiagnostics(value) {
  if (!value || typeof value !== "object") return null;
  const keys = [
    "sampleCount",
    "observerErrorCount",
    "connectionPeak",
    "busyPeak",
    "estimatedQueuePeak",
    "queuePresenceMs",
    "saturationMs",
  ];
  const entries = keys.map((key) => [key, readNumber(value[key], 1_000_000_000)]);
  return entries.some(([, entry]) => entry === null)
    ? null
    : Object.fromEntries(entries);
}

function sanitizeTransactionDiagnostics(value) {
  if (!value || typeof value !== "object") return null;
  const sampleCount = readInteger(value.sampleCount, 100_000_000);
  const ageP50Ms = readNumber(value.ageP50Ms, 3_600_000);
  const ageP95Ms = readNumber(value.ageP95Ms, 3_600_000);
  const ageMaxMs = readNumber(value.ageMaxMs, 3_600_000);
  return [sampleCount, ageP50Ms, ageP95Ms, ageMaxMs].includes(null)
    ? null
    : { sampleCount, ageP50Ms, ageP95Ms, ageMaxMs };
}

function sanitizeQueryDiagnostics(value) {
  if (!value || typeof value !== "object") return null;
  if (typeof value.statsAvailable !== "boolean") return null;
  const calls = readInteger(value.calls, 1_000_000_000);
  const totalExecMs = readNumber(value.totalExecMs, 1_000_000_000);
  const meanExecMs = readNumber(value.meanExecMs, 3_600_000);
  const ageP95Ms = readNumber(value.ageP95Ms, 3_600_000);
  const ageMaxMs = readNumber(value.ageMaxMs, 3_600_000);
  return [calls, totalExecMs, meanExecMs, ageP95Ms, ageMaxMs].includes(null)
    ? null
    : {
        statsAvailable: value.statsAvailable,
        calls,
        totalExecMs,
        meanExecMs,
        ageP95Ms,
        ageMaxMs,
      };
}

function sanitizeWaitDiagnostics(value) {
  if (!value || typeof value !== "object") return null;
  const entries = diagnosticWaitCategories.map((key) => [
    key,
    readNumber(value[key], 1_000_000_000),
  ]);
  return entries.some(([, entry]) => entry === null)
    ? null
    : Object.fromEntries(entries);
}

function readInteger(value, maximum) {
  return Number.isInteger(value) && value >= 0 && value <= maximum
    ? value
    : null;
}

function readNumber(value, maximum) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= maximum
    ? Math.round(value * 100) / 100
    : null;
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  const result = await runGuardedP1LoadTest();
  const stream = result.exitCode === 0 ? process.stdout : process.stderr;
  stream.write(`${JSON.stringify(result.report)}\n`);
  process.exitCode = result.exitCode;
}
