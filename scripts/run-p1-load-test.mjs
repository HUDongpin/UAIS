#!/usr/bin/env node

import { spawnSync } from "node:child_process";
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

  let testResult;
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
  } finally {
    capability.cleanup();
  }

  const laneResult = validateVitestLaneResult({
    lane: loadLane,
    runnerResult: testResult,
  });
  if (!laneResult.approved) {
    return failedP1LoadTestResult(laneResult.reason);
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
      valuesRedacted: true,
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

function failedP1LoadTestResult(reason) {
  return {
    exitCode: 1,
    report: {
      target,
      status: "FAIL",
      blockedReasons: [reason],
      selectedEnvName: databaseEnvName,
      valuesRedacted: true,
    },
  };
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  const result = await runGuardedP1LoadTest();
  const stream = result.exitCode === 0 ? process.stdout : process.stderr;
  stream.write(`${JSON.stringify(result.report)}\n`);
  process.exitCode = result.exitCode;
}
