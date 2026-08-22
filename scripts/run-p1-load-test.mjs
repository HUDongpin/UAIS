import { spawnSync } from "node:child_process";
import { env, exit, execPath } from "node:process";
import postgres from "postgres";

const databaseUrl = env.UAIS_P1_LOAD_TEST_DATABASE_URL?.trim();

if (!databaseUrl) {
  console.error(JSON.stringify({
    target: "uais-p1-200-student-load-lane",
    status: "launch-critical-skipped",
    reasonCode: "dedicated-load-test-database-url-required",
    acceptedEnvName: "UAIS_P1_LOAD_TEST_DATABASE_URL",
    valueRedacted: true,
  }));
  exit(2);
}

const guardSql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  connect_timeout: 10,
});

try {
  const rows = await guardSql`
    SELECT environment
    FROM uais_environment_guard
    WHERE environment = 'isolated-p1-load-test' AND enabled = true
    LIMIT 1
  `;
  if (rows.length !== 1) {
    throw new Error("isolated-p1-load-test guard row required");
  }
} catch {
  console.error(JSON.stringify({
    target: "uais-p1-200-student-load-lane",
    status: "blocked",
    reasonCode: "isolated-load-database-guard-required",
    requiredGuard: {
      table: "uais_environment_guard",
      environment: "isolated-p1-load-test",
      enabled: true,
    },
    valueRedacted: true,
  }));
  await guardSql.end({ timeout: 5 });
  exit(2);
}
await guardSql.end({ timeout: 5 });

const isolatedEnv = {
  ...env,
  UAIS_CORE_DATABASE_URL: databaseUrl,
  UAIS_P1_LOAD_TEST_DATABASE_URL: databaseUrl,
  DATABASE_URL: "",
  POSTGRES_URL: "",
};

console.log(JSON.stringify({
  target: "uais-p1-200-student-load-lane",
  status: "configured",
  studentCount: 200,
  autosaveWindowSeconds: 300,
  submitWindowSeconds: 30,
  decisionCount: 20,
  selectedEnvName: "UAIS_P1_LOAD_TEST_DATABASE_URL",
  databaseGuard: "isolated-p1-load-test",
  valueRedacted: true,
}));

const migration = spawnSync(
  execPath,
  ["scripts/apply-core-migrations.mjs"],
  { stdio: "inherit", env: isolatedEnv },
);
if ((migration.status ?? 1) !== 0) {
  exit(migration.status ?? 1);
}

const test = spawnSync(
  execPath,
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "--environment",
    "node",
    "--no-file-parallelism",
    "tests/learning-loop-postgres-load.integration.test.ts",
  ],
  { stdio: "inherit", env: isolatedEnv },
);
exit(test.status ?? 1);
