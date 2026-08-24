#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  sep as pathSeparator,
} from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { CORE_MIGRATION_DB_TEST_GUARD } from "./core-migration-guard.mjs";
import {
  LEGACY_LIVE_DB_TEST_FILES,
  LIVE_DB_TEST_CAPABILITY_ENV,
  LIVE_DB_TEST_FILES,
  LIVE_DB_TEST_FILES_BY_LANE,
  STAGING_INP_LIVE_DB_TEST_FILE,
} from "./live-db-test-contract.mjs";

const target = "uais-postgres-integration-lane";
const databaseEnvName = "UAIS_DB_TEST_DATABASE_URL";
const p1LoadTarget = "uais-p1-200-student-load-lane";
const p1LoadDatabaseEnvName = "UAIS_P1_LOAD_TEST_DATABASE_URL";
const productionNeonProjectId = "late-sunset-59152574";
const genericDatabaseEnvNames = [
  "UAIS_CORE_DATABASE_URL",
  "DATABASE_URL",
  "POSTGRES_URL",
];

export const LIVE_MUTATION_CONFIRMATION =
  "I_CONFIRM_UAIS_DB_TEST_MUTATES_ONLY_AN_ISOLATED_NON_PRODUCTION_DATABASE";

const legacyTestFiles = LEGACY_LIVE_DB_TEST_FILES;
const stagingInpTestFiles = [STAGING_INP_LIVE_DB_TEST_FILE];
const testLanes = [
  {
    id: "legacy",
    testFiles: legacyTestFiles,
    expectedTests: 21,
    useCoreDatabaseAlias: true,
  },
  {
    id: "staging-inp",
    testFiles: stagingInpTestFiles,
    expectedTests: 2,
    useCoreDatabaseAlias: false,
  },
];

export async function authorizeDatabaseTestTarget({
  env = process.env,
  inspectTarget = inspectDatabaseTarget,
} = {}) {
  const validation = validateDatabaseTestEnvironment(env);
  if (validation.result) return validation.result;

  let inspection;
  try {
    inspection = await inspectTarget({ databaseUrl: validation.databaseUrl });
  } catch {
    inspection = { approved: false };
  }
  if (inspection?.approved !== true) {
    return blockedTargetResult("isolated-db-test-guards-required");
  }

  return {
    exitCode: 0,
    databaseUrl: validation.databaseUrl,
    report: {
      target,
      status: "CONFIGURED",
      blockedReasons: [],
      selectedEnvName: databaseEnvName,
      valuesRedacted: true,
    },
  };
}

export async function authorizeP1LoadTestTarget({
  env = process.env,
  inspectTarget = inspectP1LoadDatabaseTarget,
} = {}) {
  const validation = validateDatabaseTestEnvironment(env, {
    selectedDatabaseEnvName: p1LoadDatabaseEnvName,
    rejectedDatabaseEnvNames: [databaseEnvName, ...genericDatabaseEnvNames],
    reportTarget: p1LoadTarget,
    useLegacyGenericAliasReport: false,
    missingDatabaseReason: "dedicated-load-test-database-url-required",
  });
  if (validation.result) return validation.result;

  let inspection;
  try {
    inspection = await inspectTarget({ databaseUrl: validation.databaseUrl });
  } catch {
    inspection = { approved: false };
  }
  if (inspection?.approved !== true) {
    return {
      exitCode: 2,
      report: {
        target: p1LoadTarget,
        status: "BLOCKED_TARGET",
        blockedReasons: ["isolated-p1-load-test-guard-required"],
        requiredGuard: {
          table: "public.uais_environment_guard",
          environment: "isolated-p1-load-test",
          enabled: true,
          sessionReplicationRole: "origin",
        },
        valuesRedacted: true,
      },
    };
  }

  return {
    exitCode: 0,
    databaseUrl: validation.databaseUrl,
    report: {
      target: p1LoadTarget,
      status: "CONFIGURED",
      blockedReasons: [],
      selectedEnvName: p1LoadDatabaseEnvName,
      valuesRedacted: true,
    },
  };
}

export async function authorizeLiveDatabaseTestFile({
  env = process.env,
  lane,
  testFile,
  inspectTarget,
  now = Date.now(),
} = {}) {
  const capability = validateLiveDatabaseTestCapability({
    env,
    lane,
    testFile,
    now,
  });
  if (!capability.approved) {
    return blockedLiveDatabaseTestFileResult(capability.reason);
  }

  const selectedDatabaseUrl = readValue(
    env[lane === "p1-load" ? p1LoadDatabaseEnvName : databaseEnvName],
  );
  if (
    (lane === "legacy" || lane === "p1-load") &&
    readValue(env.UAIS_CORE_DATABASE_URL) !== selectedDatabaseUrl
  ) {
    return blockedLiveDatabaseTestFileResult(
      "controlled-core-database-alias-mismatch",
    );
  }

  const forbiddenAliases =
    lane === "legacy"
      ? ["DATABASE_URL", "POSTGRES_URL"]
      : lane === "p1-load"
        ? [databaseEnvName, "DATABASE_URL", "POSTGRES_URL"]
        : genericDatabaseEnvNames;
  const populatedForbiddenAliases = forbiddenAliases.filter((name) =>
    readValue(env[name]),
  );
  if (populatedForbiddenAliases.length > 0) {
    return blockedLiveDatabaseTestFileResult(
      `generic-database-url-rejected:${populatedForbiddenAliases[0]}`,
    );
  }

  const guardEnv = { ...env };
  for (const name of genericDatabaseEnvNames) delete guardEnv[name];
  const selectedInspector =
    inspectTarget ?? resolveLiveDatabaseTestInspector(lane);
  const authorization =
    lane === "p1-load"
      ? await authorizeP1LoadTestTarget({
          env: guardEnv,
          inspectTarget: selectedInspector,
        })
      : await authorizeDatabaseTestTarget({
          env: guardEnv,
          inspectTarget: selectedInspector,
        });
  if (authorization.exitCode !== 0) {
    return {
      ...authorization,
      report: { ...authorization.report, status: "BLOCKED_ENV" },
    };
  }
  return authorization;
}

export function resolveLiveDatabaseTestInspector(lane) {
  if (lane === "p1-load") return inspectP1LoadDatabaseTarget;
  if (lane === "legacy" || lane === "staging-inp") {
    return inspectDatabaseTarget;
  }
  throw new TypeError("A recognized live-DB test lane is required");
}

export function validateLiveDatabaseTestCapability({
  env,
  lane,
  testFile,
  now = Date.now(),
}) {
  const allowedFiles = LIVE_DB_TEST_FILES_BY_LANE[lane];
  if (!allowedFiles?.includes(testFile)) {
    return { approved: false, reason: "dedicated-runner-lane-file-rejected" };
  }

  const capabilityLane = readValue(env[LIVE_DB_TEST_CAPABILITY_ENV.lane]);
  const capabilityFile = readValue(env[LIVE_DB_TEST_CAPABILITY_ENV.file]);
  const capabilityToken = readValue(env[LIVE_DB_TEST_CAPABILITY_ENV.token]);
  if (
    capabilityLane !== lane ||
    !capabilityFile ||
    !/^[A-Za-z0-9_-]{43}$/.test(capabilityToken)
  ) {
    return { approved: false, reason: "dedicated-runner-capability-required" };
  }

  try {
    const resolvedCapabilityFile = realpathSync(capabilityFile);
    const capabilityDirectory = dirname(resolvedCapabilityFile);
    const expectedTempRoot = realpathSync(tmpdir());
    const relativeCapabilityDirectory = relative(
      expectedTempRoot,
      capabilityDirectory,
    );
    if (
      !relativeCapabilityDirectory ||
      relativeCapabilityDirectory === ".." ||
      relativeCapabilityDirectory.startsWith(`..${pathSeparator}`) ||
      isAbsolute(relativeCapabilityDirectory) ||
      !basename(capabilityDirectory).startsWith("uais-db-test-capability-") ||
      basename(resolvedCapabilityFile) !== "capability.json"
    ) {
      return { approved: false, reason: "dedicated-runner-capability-invalid" };
    }
    const metadata = statSync(resolvedCapabilityFile);
    const directoryMetadata = statSync(capabilityDirectory);
    if (
      !metadata.isFile() ||
      !directoryMetadata.isDirectory() ||
      (metadata.mode & 0o077) !== 0 ||
      (directoryMetadata.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" &&
        (metadata.uid !== process.getuid() ||
          directoryMetadata.uid !== process.getuid()))
    ) {
      return { approved: false, reason: "dedicated-runner-capability-invalid" };
    }
    const receipt = JSON.parse(readFileSync(resolvedCapabilityFile, "utf8"));
    const expiresAt = Number(receipt?.expiresAt);
    const expectedTokenHash = createHash("sha256")
      .update("uais-live-db-test-capability-v1\0")
      .update(capabilityToken)
      .digest("hex");
    if (
      receipt?.version !== 1 ||
      receipt?.lane !== lane ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= now ||
      expiresAt > now + 3_600_000 ||
      !constantTimeEqual(readValue(receipt?.tokenHash), expectedTokenHash)
    ) {
      return { approved: false, reason: "dedicated-runner-capability-invalid" };
    }
  } catch {
    return { approved: false, reason: "dedicated-runner-capability-invalid" };
  }
  return { approved: true };
}

function blockedLiveDatabaseTestFileResult(reason) {
  return {
    exitCode: 2,
    report: {
      target: "uais-live-db-test-file",
      status: "BLOCKED_ENV",
      blockedReasons: [reason],
      valuesRedacted: true,
    },
  };
}

export async function runGuardedDatabaseTests({
  env = process.env,
  inspectTarget = inspectDatabaseTarget,
  testRunner = runTests,
  cwd = process.cwd(),
  nodeExecutable = process.execPath,
} = {}) {
  const authorization = await authorizeDatabaseTestTarget({
    env,
    inspectTarget,
  });
  if (authorization.exitCode !== 0) return authorization;
  const databaseUrl = authorization.databaseUrl;

  const dedicatedEnv = selectDatabaseTestEnvironment(env);
  for (const name of genericDatabaseEnvNames) delete dedicatedEnv[name];
  const lanes = [];

  for (const lane of testLanes) {
    const childEnv = { ...dedicatedEnv };
    if (lane.useCoreDatabaseAlias) {
      childEnv.UAIS_CORE_DATABASE_URL = databaseUrl;
      childEnv.UAIS_CORE_DATABASE_REQUIRED_GUARD =
        CORE_MIGRATION_DB_TEST_GUARD;
    } else {
      delete childEnv.UAIS_CORE_DATABASE_REQUIRED_GUARD;
    }

    const capability = mintLiveDatabaseTestCapability(lane.id);
    childEnv[LIVE_DB_TEST_CAPABILITY_ENV.file] = capability.file;
    childEnv[LIVE_DB_TEST_CAPABILITY_ENV.token] = capability.token;
    childEnv[LIVE_DB_TEST_CAPABILITY_ENV.lane] = lane.id;

    let runnerResult;
    try {
      runnerResult =
        testRunner({
          lane: lane.id,
          command: nodeExecutable,
          args: [
            "node_modules/vitest/vitest.mjs",
            "run",
            "--no-file-parallelism",
            "--silent",
            "--reporter=json",
            ...lane.testFiles,
          ],
          cwd,
          env: childEnv,
        }) ?? { status: null, stdout: "", stderr: "" };
    } catch {
      runnerResult = { status: null, stdout: "", stderr: "" };
    } finally {
      capability.cleanup();
    }

    const laneResult = validateVitestLaneResult({ lane, runnerResult });
    if (!laneResult.approved) {
      return failedDatabaseTestResult(laneResult.reason, lanes);
    }
    lanes.push(laneResult.summary);
  }

  return {
    exitCode: 0,
    report: {
      target,
      status: "PASS",
      blockedReasons: [],
      selectedEnvName: databaseEnvName,
      lanes,
      valuesRedacted: true,
    },
  };
}

export function mintLiveDatabaseTestCapability(lane) {
  if (!LIVE_DB_TEST_FILES_BY_LANE[lane]) {
    throw new TypeError("A recognized live-DB test lane is required");
  }
  const directory = mkdtempSync(
    join(tmpdir(), "uais-db-test-capability-"),
  );
  const file = join(directory, "capability.json");
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256")
    .update("uais-live-db-test-capability-v1\0")
    .update(token)
    .digest("hex");
  writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      lane,
      tokenHash,
      expiresAt: Date.now() + 30 * 60 * 1000,
    }),
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  return {
    file,
    token,
    cleanup() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

export function validateVitestLaneResult({ lane, runnerResult }) {
  if (runnerResult.status !== 0) {
    return {
      approved: false,
      reason: `${lane.id}-test-process-failed`,
    };
  }

  let result;
  try {
    result = JSON.parse(readValue(runnerResult.stdout));
  } catch {
    return {
      approved: false,
      reason: `${lane.id}-vitest-json-invalid`,
    };
  }

  const pendingTests = readNonNegativeInteger(result.numPendingTests);
  const todoTests = readNonNegativeInteger(result.numTodoTests);
  if (pendingTests < 0 || todoTests < 0) {
    return {
      approved: false,
      reason: `${lane.id}-vitest-json-invalid`,
    };
  }
  const skippedTests = pendingTests + todoTests;
  if (skippedTests > 0) {
    return {
      approved: false,
      reason: `${lane.id}-live-tests-skipped`,
    };
  }

  const totalTests = readNonNegativeInteger(result.numTotalTests);
  const passedTests = readNonNegativeInteger(result.numPassedTests);
  const failedTests = readNonNegativeInteger(result.numFailedTests);
  if (
    result.success !== true ||
    totalTests !== lane.expectedTests ||
    passedTests !== lane.expectedTests ||
    failedTests !== 0
  ) {
    return {
      approved: false,
      reason: `${lane.id}-test-count-mismatch`,
    };
  }

  const testResults = Array.isArray(result.testResults)
    ? result.testResults
    : [];
  if (testResults.some((testResult) => testResult?.status !== "passed")) {
    return {
      approved: false,
      reason: `${lane.id}-test-files-failed`,
    };
  }
  const observedFiles = testResults
    .map((testResult) => normalizeTestFileName(testResult?.name))
    .filter(Boolean)
    .sort();
  const expectedFiles = [...lane.testFiles].sort();
  if (
    observedFiles.length !== expectedFiles.length ||
    observedFiles.some((file, index) => file !== expectedFiles[index])
  ) {
    return {
      approved: false,
      reason: `${lane.id}-test-files-mismatch`,
    };
  }

  const assertionResults = testResults.flatMap((testResult) =>
    Array.isArray(testResult?.assertionResults)
      ? testResult.assertionResults
      : [],
  );
  if (
    assertionResults.length !== lane.expectedTests ||
    assertionResults.some((assertion) => assertion?.status !== "passed")
  ) {
    return {
      approved: false,
      reason: `${lane.id}-assertion-results-mismatch`,
    };
  }

  return {
    approved: true,
    summary: {
      id: lane.id,
      testFiles: lane.testFiles,
      expectedTests: lane.expectedTests,
      passedTests,
      skippedTests,
    },
  };
}

function normalizeTestFileName(value) {
  if (typeof value !== "string") return "";
  const normalized = value.replaceAll("\\", "/");
  return LIVE_DB_TEST_FILES.find((testFile) =>
    normalized === testFile || normalized.endsWith(`/${testFile}`),
  ) ?? "";
}

function readNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : -1;
}

function failedDatabaseTestResult(reason, completedLanes) {
  return {
    exitCode: 1,
    report: {
      target,
      status: "FAIL",
      blockedReasons: [reason],
      selectedEnvName: databaseEnvName,
      completedLanes,
      valuesRedacted: true,
    },
  };
}

function validateDatabaseTestEnvironment(
  env,
  {
    selectedDatabaseEnvName = databaseEnvName,
    rejectedDatabaseEnvNames = genericDatabaseEnvNames,
    reportTarget = target,
    useLegacyGenericAliasReport = true,
    missingDatabaseReason = "dedicated-db-test-database-url-required",
  } = {},
) {
  const blockedReasons = [];
  const databaseUrl = readValue(env[selectedDatabaseEnvName]);
  const populatedGenericDatabaseEnvNames = rejectedDatabaseEnvNames.filter(
    (name) => readValue(env[name]),
  );

  if (!databaseUrl) {
    blockedReasons.push(missingDatabaseReason);
  } else if (!isPostgresUrl(databaseUrl)) {
    blockedReasons.push("dedicated-db-test-database-url-invalid");
  }
  for (const name of populatedGenericDatabaseEnvNames) {
    blockedReasons.push(`generic-database-url-rejected:${name}`);
  }
  if (
    env.UAIS_DB_TEST_LIVE_MUTATION_CONFIRMATION !==
    LIVE_MUTATION_CONFIRMATION
  ) {
    blockedReasons.push("live-mutation-confirmation-required");
  }

  const neonProjectId = readValue(env.UAIS_DB_TEST_NEON_PROJECT_ID);
  if (!neonProjectId) {
    blockedReasons.push("non-production-neon-project-id-required");
  } else if (neonProjectId === productionNeonProjectId) {
    blockedReasons.push("production-neon-project-id-rejected");
  }
  const fingerprintNonce = readValue(
    env.UAIS_DB_TEST_DSN_FINGERPRINT_NONCE,
  );
  if (!fingerprintNonce) {
    blockedReasons.push("dsn-fingerprint-nonce-required");
  } else if (fingerprintNonce.length < 32) {
    blockedReasons.push("dsn-fingerprint-nonce-invalid");
  }
  const expectedFingerprint = readValue(env.UAIS_DB_TEST_DSN_FINGERPRINT);
  if (!expectedFingerprint) {
    blockedReasons.push("dsn-fingerprint-required");
  } else if (
    databaseUrl &&
    isPostgresUrl(databaseUrl) &&
    neonProjectId &&
    neonProjectId !== productionNeonProjectId &&
    fingerprintNonce.length >= 32
  ) {
    let actualFingerprint;
    try {
      actualFingerprint = createDbTestDsnFingerprint({
        databaseUrl,
        neonProjectId,
        nonce: fingerprintNonce,
      });
    } catch {
      blockedReasons.push("dsn-fingerprint-normalization-failed");
    }
    if (
      actualFingerprint &&
      !constantTimeEqual(expectedFingerprint, actualFingerprint)
    ) {
      blockedReasons.push("dsn-fingerprint-mismatch");
    }
  }

  if (blockedReasons.length > 0) {
    if (
      useLegacyGenericAliasReport &&
      !databaseUrl &&
      populatedGenericDatabaseEnvNames.length > 0
    ) {
      return { result: legacyGenericAliasBlockedResult() };
    }
    return {
      result: blockedEnvironmentResult(blockedReasons, {
        acceptedEnvName: selectedDatabaseEnvName,
        reportTarget,
      }),
    };
  }
  return { databaseUrl };
}

export async function inspectDatabaseTarget({
  databaseUrl,
  createClient = createGuardClient,
}) {
  const sql = createClient(databaseUrl);
  try {
    const rows = await sql`
      SELECT
        environment,
        current_setting('session_replication_role') AS session_replication_role
      FROM public.uais_environment_guard
      WHERE environment IN (
        'isolated-uais-db-test',
        'isolated-p2-staging-source'
      )
        AND enabled = true
    `;
    const environments = new Set(rows.map((row) => row.environment));
    return {
      approved:
        rows.length === 2 &&
        environments.has("isolated-uais-db-test") &&
        environments.has("isolated-p2-staging-source") &&
        rows.every((row) => row.session_replication_role === "origin"),
    };
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

export async function inspectP1LoadDatabaseTarget({
  databaseUrl,
  createClient = createGuardClient,
}) {
  const sql = createClient(databaseUrl);
  try {
    const rows = await sql`
      SELECT
        environment,
        current_setting('session_replication_role') AS session_replication_role
      FROM public.uais_environment_guard
      WHERE environment = 'isolated-p1-load-test'
        AND enabled = true
      LIMIT 1
    `;
    return {
      approved:
        rows.length === 1 &&
        rows[0]?.environment === "isolated-p1-load-test" &&
        rows[0]?.session_replication_role === "origin",
    };
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

function createGuardClient(databaseUrl) {
  return postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
  });
}

function runTests({ command, args, cwd, env }) {
  return spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function selectDatabaseTestEnvironment(env) {
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

function blockedEnvironmentResult(
  blockedReasons,
  { acceptedEnvName = databaseEnvName, reportTarget = target } = {},
) {
  return {
    exitCode: 2,
    report: {
      target: reportTarget,
      status: "BLOCKED_ENV",
      blockedReasons,
      acceptedDatabaseEnvName: acceptedEnvName,
      valuesRedacted: true,
    },
  };
}

function legacyGenericAliasBlockedResult() {
  return {
    exitCode: 2,
    report: {
      target,
      status: "launch-critical-skipped",
      reasonCode: "dedicated-db-test-database-url-required",
      acceptedEnvName: databaseEnvName,
      valueRedacted: true,
    },
  };
}

function blockedTargetResult(reason) {
  return {
    exitCode: 2,
    report: {
      target,
      status: "BLOCKED_TARGET",
      blockedReasons: [reason],
      requiredGuards: [
        {
          table: "public.uais_environment_guard",
          environment: "isolated-uais-db-test",
          enabled: true,
          sessionReplicationRole: "origin",
        },
        {
          table: "public.uais_environment_guard",
          environment: "isolated-p2-staging-source",
          enabled: true,
          sessionReplicationRole: "origin",
        },
      ],
      valuesRedacted: true,
    },
  };
}

function readValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isPostgresUrl(value) {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "postgres:" || parsed.protocol === "postgresql:") &&
      parsed.hostname.length > 0 &&
      parsed.pathname.length > 1
    );
  } catch {
    return false;
  }
}

export function createDbTestDsnFingerprint({
  databaseUrl,
  neonProjectId,
  nonce,
}) {
  const parsed = new URL(databaseUrl);
  if (!isPostgresUrl(databaseUrl)) {
    throw new TypeError("A PostgreSQL target URL is required");
  }

  const normalizedTarget = JSON.stringify({
    protocol: "postgresql:",
    hostname: parsed.hostname.toLowerCase(),
    port: parsed.port || "5432",
    database: decodeURIComponent(parsed.pathname.slice(1)).normalize("NFC"),
    username: decodeURIComponent(parsed.username).normalize("NFC"),
  });
  return `sha256:${createHash("sha256")
    .update("uais-db-test-target-v1\0")
    .update(readValue(neonProjectId))
    .update("\0")
    .update(normalizedTarget)
    .update("\0")
    .update(readValue(nonce))
    .digest("hex")}`;
}

function constantTimeEqual(actual, expected) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  const result = await runGuardedDatabaseTests();
  const stream = result.exitCode === 0 ? process.stdout : process.stderr;
  stream.write(`${JSON.stringify(result.report)}\n`);
  process.exitCode = result.exitCode;
}
