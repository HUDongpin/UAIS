#!/usr/bin/env node

// One-use build wrapper for the isolated P2 staging evidence run. The Vercel
// build-command field is capped at 256 characters, so the fail-closed identity
// checks and the source/restore migration sequence live here instead of in a shell
// string. No secret value is printed or added to an argument list.

import postgres from "postgres";
import {
  areBothStagingMigrationLedgersReady,
  assessCoreMigrationLedgerParity,
  readCoreMigrationManifest,
} from "./core-migration-ledger-parity.mjs";
import {
  createP2StagingMigrationChildEnv,
  createP2StagingRuntimeChildEnv,
  runRedactedP2StagingChild,
} from "./p2-staging-build-child.mjs";

const expectedStagingProjectId = "prj_dcWZvGLSYNtSWN3lnTyfZPyWKgQL";
const productionNeonProjectId = "late-sunset-59152574";
const guardOnly = process.argv.includes("--guard-only");
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
} else if (!isPostgresDatabaseUrl(sourceDatabaseUrl)) {
  blockedReasons.push("dedicated-source-staging-database-url-invalid");
}
if (!restoreDatabaseUrl) {
  blockedReasons.push("dedicated-restore-staging-database-url-missing");
} else if (!isPostgresDatabaseUrl(restoreDatabaseUrl)) {
  blockedReasons.push("dedicated-restore-staging-database-url-invalid");
}
if (!sourceNeonProjectId) blockedReasons.push("source-neon-project-id-missing");
if (!restoreNeonProjectId) blockedReasons.push("restore-neon-project-id-missing");
if (sourceNeonProjectId === productionNeonProjectId) {
  blockedReasons.push("production-neon-project-id-rejected");
}
if (restoreNeonProjectId === productionNeonProjectId) {
  blockedReasons.push("production-restore-neon-project-id-rejected");
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

if (guardOnly) {
  const expectedMigrationLedger = await readCoreMigrationManifest();
  const [sourceMigrationLedger, restoreMigrationLedger] = await Promise.all([
    inspectMigrationLedger(sourceDatabaseUrl, expectedMigrationLedger),
    inspectMigrationLedger(restoreDatabaseUrl, expectedMigrationLedger),
  ]);
  const migrationLedgerReady = areBothStagingMigrationLedgersReady(
    sourceMigrationLedger,
    restoreMigrationLedger,
  );
  process.stdout.write(
    `${JSON.stringify({
      target: "p2-isolated-staging-database-guard",
      status: migrationLedgerReady ? "PASS" : "BLOCKED_ENV",
      source: {
        guard: "PASS",
        migrationLedger: sourceMigrationLedger.ready ? "PASS" : "BLOCKED_ENV",
        appliedMigrationCount: sourceMigrationLedger.appliedMigrationCount,
        expectedMigrationCount: sourceMigrationLedger.expectedMigrationCount,
        exactVersionChecksumParity:
          sourceMigrationLedger.exactVersionChecksumParity,
      },
      restore: {
        guard: "PASS",
        migrationLedger: restoreMigrationLedger.ready ? "PASS" : "BLOCKED_ENV",
        appliedMigrationCount: restoreMigrationLedger.appliedMigrationCount,
        expectedMigrationCount: restoreMigrationLedger.expectedMigrationCount,
        exactVersionChecksumParity:
          restoreMigrationLedger.exactVersionChecksumParity,
      },
      blockedReasons: migrationLedgerReady
        ? []
        : ["source-or-restore-migration-ledger-required"],
      valuesRedacted: true,
      preflightOnly: true,
      restoreExecutionProven: false,
      pitrProven: false,
      safety: {
        readOnly: true,
        urlsOmitted: true,
        identifiersOmitted: true,
        noMutationPerformed: true,
        migrationsRun: false,
        buildRun: false,
      },
    })}\n`,
  );
  process.exit(migrationLedgerReady ? 0 : 2);
}

const sourceEnv = createP2StagingMigrationChildEnv({
  baseEnv: process.env,
  databaseUrl: sourceDatabaseUrl,
  requiredGuard: "isolated-p2-staging-source",
});
const restoreEnv = createP2StagingMigrationChildEnv({
  baseEnv: process.env,
  databaseUrl: restoreDatabaseUrl,
  requiredGuard: "isolated-p2-staging-restore",
});
const runtimeEnv = createP2StagingRuntimeChildEnv(process.env);

runNode(["scripts/apply-core-migrations.mjs"], sourceEnv);
runNode(["scripts/apply-core-migrations.mjs"], restoreEnv);
runNode(["node_modules/next/dist/bin/next", "build"], runtimeEnv);

function runNode(args, env) {
  const result = runRedactedP2StagingChild({ args, env });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function assertDatabaseGuard(databaseUrl, environment) {
  let sql;
  try {
    sql = postgres(databaseUrl, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
    });
    const rows = await sql`
      SELECT
        environment,
        current_setting('session_replication_role') AS session_replication_role
      FROM public.uais_environment_guard
      WHERE environment = ${environment} AND enabled = true
      LIMIT 1
    `;
    return (
      rows.length === 1 &&
      rows[0]?.environment === environment &&
      rows[0]?.session_replication_role === "origin"
    );
  } catch {
    return false;
  } finally {
    await sql?.end({ timeout: 5 }).catch(() => undefined);
  }
}

async function inspectMigrationLedger(databaseUrl, expectedMigrationLedger) {
  let sql;
  try {
    sql = postgres(databaseUrl, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
    });
    const ledgerRows = await sql`
      SELECT version, checksum
      FROM public.uais_schema_migrations
      ORDER BY version
    `;
    return assessCoreMigrationLedgerParity({
      expected: expectedMigrationLedger,
      actual: ledgerRows,
    });
  } catch {
    return {
      ready: false,
      appliedMigrationCount: null,
      expectedMigrationCount: expectedMigrationLedger.length,
      exactVersionChecksumParity: false,
    };
  } finally {
    await sql?.end({ timeout: 5 }).catch(() => undefined);
  }
}

function isPostgresDatabaseUrl(value) {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "postgres:" || parsed.protocol === "postgresql:") &&
      /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(parsed.hostname) &&
      parsed.username.length > 0 &&
      parsed.password.length > 0 &&
      parsed.pathname.length > 1
    );
  } catch {
    return false;
  }
}
