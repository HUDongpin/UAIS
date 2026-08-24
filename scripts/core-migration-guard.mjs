import {
  UAIS_PRODUCTION_VERCEL_PROJECT_ID,
  UAIS_STAGING_VERCEL_PROJECT_ID,
} from "./vercel-project-identity.mjs";

export const CORE_MIGRATION_REQUIRED_GUARD_ENV_NAME =
  "UAIS_CORE_DATABASE_REQUIRED_GUARD";
export const CORE_MIGRATION_STAGING_SOURCE_GUARD =
  "isolated-p2-staging-source";
export const CORE_MIGRATION_STAGING_RESTORE_GUARD =
  "isolated-p2-staging-restore";
export const CORE_MIGRATION_DB_TEST_GUARD = "isolated-uais-db-test";
export const CORE_MIGRATION_P1_LOAD_TEST_GUARD =
  "isolated-p1-load-test";

const approvedGuardNames = new Set([
  CORE_MIGRATION_STAGING_SOURCE_GUARD,
  CORE_MIGRATION_STAGING_RESTORE_GUARD,
  CORE_MIGRATION_DB_TEST_GUARD,
  CORE_MIGRATION_P1_LOAD_TEST_GUARD,
]);

export class CoreMigrationGuardError extends Error {
  constructor(reason) {
    super(`Blocked core migration target: ${reason}.`);
    this.name = "CoreMigrationGuardError";
    this.reason = reason;
  }
}

export function resolveCoreMigrationGuardContract({ env, deployMode }) {
  const projectId = readValue(env.VERCEL_PROJECT_ID);
  const vercelEnv = readValue(env.VERCEL_ENV).toLowerCase();
  const requiredGuard = readValue(env[CORE_MIGRATION_REQUIRED_GUARD_ENV_NAME]);

  if (requiredGuard && !approvedGuardNames.has(requiredGuard)) {
    return blocked("unsupported-database-guard-contract");
  }

  if (projectId === UAIS_PRODUCTION_VERCEL_PROJECT_ID) {
    if (requiredGuard) return blocked("production-migration-guard-contract-rejected");
    return approved(undefined);
  }

  if (projectId === UAIS_STAGING_VERCEL_PROJECT_ID) {
    if (
      env.UAIS_DEPLOYMENT_ENV !== "staging" ||
      env.UAIS_LEARNING_CHATROOM_GROUPS_MODE !== "on"
    ) {
      return blocked("isolated-staging-runtime-contract-required");
    }
    if (!requiredGuard) {
      return blocked("isolated-staging-migration-guard-required");
    }
    if (
      requiredGuard !== CORE_MIGRATION_STAGING_SOURCE_GUARD &&
      requiredGuard !== CORE_MIGRATION_STAGING_RESTORE_GUARD
    ) {
      return blocked("isolated-staging-database-guard-mismatch");
    }
    if (deployMode && requiredGuard !== CORE_MIGRATION_STAGING_SOURCE_GUARD) {
      return blocked("isolated-staging-deploy-source-guard-required");
    }
    return approved(requiredGuard);
  }

  if (requiredGuard === CORE_MIGRATION_STAGING_SOURCE_GUARD ||
      requiredGuard === CORE_MIGRATION_STAGING_RESTORE_GUARD) {
    return blocked("isolated-staging-project-id-required");
  }

  if (deployMode && vercelEnv === "production") {
    return blocked("recognized-vercel-project-id-required");
  }

  return approved(requiredGuard || undefined);
}

export async function assertCoreMigrationDatabaseGuard({
  client,
  requiredGuard,
}) {
  if (!requiredGuard) return;

  const rows = await client`
    SELECT
      environment,
      current_setting('session_replication_role') AS session_replication_role
    FROM public.uais_environment_guard
    WHERE environment = ${requiredGuard}
      AND enabled = true
    LIMIT 1
  `;
  if (
    rows.length !== 1 ||
    rows[0]?.environment !== requiredGuard ||
    rows[0]?.session_replication_role !== "origin"
  ) {
    throw new CoreMigrationGuardError("required-database-guard-not-approved");
  }
}

function approved(requiredGuard) {
  return { approved: true, requiredGuard };
}

function blocked(blockedReason) {
  return { approved: false, blockedReason };
}

function readValue(value) {
  return typeof value === "string" ? value.trim() : "";
}
