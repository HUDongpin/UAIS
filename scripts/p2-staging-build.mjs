#!/usr/bin/env node

// One-use build wrapper for the isolated P2 staging evidence run. The Vercel
// build-command field is capped at 256 characters, so the fail-closed identity
// checks and the source/restore migration sequence live here instead of in a shell
// string. No secret value is printed or added to an argument list.

import { spawnSync } from "node:child_process";
import postgres from "postgres";

const expectedStagingProjectId = "prj_dcWZvGLSYNtSWN3lnTyfZPyWKgQL";
const productionNeonProjectId = "late-sunset-59152574";
const sourceDatabaseUrl =
  process.env.UAIS_P2_STAGING_DATABASE_URL?.trim() ?? "";
const restoreDatabaseUrl =
  process.env.UAIS_P2_STAGING_RESTORE_DATABASE_URL?.trim() ?? "";
const sourceNeonProjectId = process.env.NEON_PROJECT_ID?.trim() ?? "";
const restoreNeonProjectId = process.env.RESTORE_NEON_PROJECT_ID?.trim() ?? "";

const blockedReasons = [];
if (process.env.VERCEL_PROJECT_ID !== expectedStagingProjectId) {
  blockedReasons.push("isolated-staging-project-id-mismatch");
}
if (process.env.UAIS_DEPLOYMENT_ENV !== "staging") {
  blockedReasons.push("staging-deployment-marker-missing");
}
if (process.env.UAIS_LEARNING_CHATROOM_GROUPS_MODE !== "on") {
  blockedReasons.push("staging-groups-mode-not-on");
}
if (!sourceDatabaseUrl) {
  blockedReasons.push("dedicated-source-staging-database-url-missing");
}
if (!restoreDatabaseUrl) {
  blockedReasons.push("dedicated-restore-staging-database-url-missing");
}
if (!sourceNeonProjectId) blockedReasons.push("source-neon-project-id-missing");
if (!restoreNeonProjectId) blockedReasons.push("restore-neon-project-id-missing");
if (sourceNeonProjectId === productionNeonProjectId) {
  blockedReasons.push("production-neon-project-id-rejected");
}
if (
  sourceDatabaseUrl === restoreDatabaseUrl ||
  sourceNeonProjectId === restoreNeonProjectId
) {
  blockedReasons.push("source-and-restore-target-must-differ");
}

if (blockedReasons.length > 0) {
  process.stdout.write(
    `${JSON.stringify({
      target: "p2-isolated-staging-build",
      status: "BLOCKED_ENV",
      blockedReasons,
      valuesRedacted: true,
    })}\n`,
  );
  process.exit(2);
}

const sourceGuardReady = await assertDatabaseGuard(
  sourceDatabaseUrl,
  "isolated-p2-staging-source",
);
const restoreGuardReady = await assertDatabaseGuard(
  restoreDatabaseUrl,
  "isolated-p2-staging-restore",
);
const databaseGuardReasons = [];
if (!sourceGuardReady) {
  databaseGuardReasons.push("source-database-internal-guard-required");
}
if (!restoreGuardReady) {
  databaseGuardReasons.push("restore-database-internal-guard-required");
}
if (databaseGuardReasons.length > 0) {
  process.stdout.write(
    `${JSON.stringify({
      target: "p2-isolated-staging-build",
      status: "BLOCKED_ENV",
      blockedReasons: databaseGuardReasons,
      requiredDatabaseGuards: [
        "isolated-p2-staging-source",
        "isolated-p2-staging-restore",
      ],
      valuesRedacted: true,
    })}\n`,
  );
  process.exit(2);
}

const sourceEnv = createDatabaseEnv(sourceDatabaseUrl);
const restoreEnv = createDatabaseEnv(restoreDatabaseUrl);

runNode(["scripts/apply-core-migrations.mjs"], sourceEnv);
runNode(["scripts/apply-core-migrations.mjs"], restoreEnv);
runNode(["node_modules/next/dist/bin/next", "build"], sourceEnv);

function runNode(args, env) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function createDatabaseEnv(databaseUrl) {
  return {
    ...process.env,
    UAIS_CORE_DATABASE_URL: databaseUrl,
    DATABASE_URL: "",
    POSTGRES_URL: "",
    RESTORE_DATABASE_URL: "",
    RESTORE_POSTGRES_URL: "",
  };
}

async function assertDatabaseGuard(databaseUrl, environment) {
  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
  });
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
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}
