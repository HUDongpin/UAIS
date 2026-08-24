import { spawnSync } from "node:child_process";
import { env, exit, execPath } from "node:process";
import postgres from "postgres";

const selectedEnvName = "UAIS_DB_TEST_DATABASE_URL";
const databaseUrl = env[selectedEnvName]?.trim();

if (!databaseUrl) {
  console.error(JSON.stringify({
    target: "uais-postgres-integration-lane",
    status: "launch-critical-skipped",
    reasonCode: "dedicated-db-test-database-url-required",
    acceptedEnvName: selectedEnvName,
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
    WHERE environment = 'isolated-uais-db-test' AND enabled = true
    LIMIT 1
  `;
  if (rows.length !== 1) {
    throw new Error("isolated-uais-db-test guard row required");
  }
} catch {
  console.error(JSON.stringify({
    target: "uais-postgres-integration-lane",
    status: "blocked",
    reasonCode: "isolated-db-test-guard-required",
    requiredGuard: {
      table: "uais_environment_guard",
      environment: "isolated-uais-db-test",
      enabled: true,
    },
    valueRedacted: true,
  }));
  await guardSql.end({ timeout: 5 });
  exit(2);
}
await guardSql.end({ timeout: 5 });

const testFiles = [
  "tests/teaching-course-management-postgres-integration.test.ts",
  "tests/teacher-ai-ownership-postgres-integration.test.ts",
  "tests/learning-chatroom-postgres-integration.test.ts",
  "tests/uais-app-account-postgres-integration.test.ts",
  "tests/teaching-course-management-cutover-integration.test.ts",
  "tests/teaching-operations-cutover-integration.test.ts",
  "tests/learning-loop-postgres-integration.test.ts",
];

console.log(JSON.stringify({
  target: "uais-postgres-integration-lane",
  status: "configured",
  selectedEnvName,
  testFiles,
  valueRedacted: true,
}));

const isolatedEnv = {
  ...env,
  UAIS_CORE_DATABASE_URL: databaseUrl,
  DATABASE_URL: "",
  POSTGRES_URL: "",
};

const result = spawnSync(
  execPath,
  ["node_modules/vitest/vitest.mjs", "run", "--no-file-parallelism", ...testFiles],
  { stdio: "inherit", env: isolatedEnv },
);
exit(result.status ?? 1);
