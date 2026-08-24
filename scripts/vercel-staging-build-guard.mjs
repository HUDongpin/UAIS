#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { CORE_MIGRATION_STAGING_SOURCE_GUARD } from "./core-migration-guard.mjs";
import { computeUaisStagingCandidateContentSha } from "./p2-staging-candidate-content.mjs";
import {
  UAIS_PRODUCTION_VERCEL_PROJECT_ID,
  UAIS_STAGING_VERCEL_PROJECT_ID,
} from "./vercel-project-identity.mjs";

// Vercel calls the production target of the separate `uais-staging` project
// `production`. Both identities are therefore required: VERCEL_ENV proves the
// deployment target while VERCEL_PROJECT_ID proves it is not the real UAIS
// production project.
const expectedStagingProjectId = UAIS_STAGING_VERCEL_PROJECT_ID;
const productionProjectId = UAIS_PRODUCTION_VERCEL_PROJECT_ID;
// This provider identity is intentionally independent of the connection URL.
// A dedicated URL cannot authorize itself, and the known production Neon
// identity is never accepted as the staging attestation.
const productionDatabaseIdentity = "late-sunset-59152574";
export const UAIS_STAGING_CONFIG_ATTESTATION =
  "isolated-staging-with-hourly-expiry-v1";
const genericDatabaseEnvNames = [
  "UAIS_CORE_DATABASE_URL",
  "DATABASE_URL",
  "POSTGRES_URL",
];

export async function runGuardedVercelStagingBuild({
  env = process.env,
  commandRunner = runCommand,
  inspectTarget = inspectStagingDatabaseTarget,
  computeContentSha = computeUaisStagingCandidateContentSha,
  cwd = process.cwd(),
  nodeExecutable = process.execPath,
} = {}) {
  const blockedReasons = [];

  if (env.VERCEL_ENV !== "production") {
    blockedReasons.push("vercel-production-scope-required");
  }
  if (env.VERCEL_PROJECT_ID === productionProjectId) {
    blockedReasons.push("production-project-id-rejected");
  } else if (env.VERCEL_PROJECT_ID !== expectedStagingProjectId) {
    blockedReasons.push("isolated-staging-project-id-mismatch");
  }
  if (env.UAIS_DEPLOYMENT_ENV !== "staging") {
    blockedReasons.push("staging-deployment-marker-required");
  }
  if (env.UAIS_LEARNING_CHATROOM_GROUPS_MODE !== "on") {
    blockedReasons.push("staging-groups-mode-required");
  }
  if (env.UAIS_STAGING_CONFIG_ATTESTATION !== UAIS_STAGING_CONFIG_ATTESTATION) {
    blockedReasons.push("staging-config-with-hourly-expiry-required");
  }
  if (env.UAIS_STAGING_INP_RUM_ENABLED !== "yes") {
    blockedReasons.push("staging-inp-rum-opt-in-required");
  }

  const dedicatedDatabaseUrl = readValue(env.UAIS_P2_STAGING_DATABASE_URL);
  if (!dedicatedDatabaseUrl) {
    blockedReasons.push("dedicated-staging-database-url-required");
  } else if (!isPostgresUrl(dedicatedDatabaseUrl)) {
    blockedReasons.push("dedicated-staging-database-url-invalid");
  }

  for (const name of genericDatabaseEnvNames) {
    if (readValue(env[name])) {
      blockedReasons.push(`generic-database-url-rejected:${name}`);
    }
  }

  const stagingDatabaseIdentity = readValue(env.NEON_PROJECT_ID);
  if (!stagingDatabaseIdentity) {
    blockedReasons.push("staging-database-identity-required");
  } else if (stagingDatabaseIdentity === productionDatabaseIdentity) {
    blockedReasons.push("production-database-identity-rejected");
  }

  const candidateGitSha = readValue(env.P2_CANDIDATE_GIT_SHA);
  const deployedGitSha = readValue(env.VERCEL_GIT_COMMIT_SHA);
  if (!gitShaPattern.test(candidateGitSha)) {
    blockedReasons.push("candidate-git-sha-invalid");
  }
  if (!gitShaPattern.test(deployedGitSha)) {
    blockedReasons.push("deployment-git-sha-invalid");
  } else if (candidateGitSha && candidateGitSha !== deployedGitSha) {
    blockedReasons.push("candidate-git-sha-mismatch");
  }

  const deploymentHost = readValue(env.VERCEL_URL);
  if (!immutableDeploymentHostPattern.test(deploymentHost)) {
    blockedReasons.push("immutable-deployment-host-invalid");
  }

  const candidateContentSha = readValue(env.P2_CANDIDATE_CONTENT_SHA);
  if (!digestPattern.test(candidateContentSha)) {
    blockedReasons.push("candidate-content-sha-invalid");
  } else {
    try {
      if (computeContentSha(cwd) !== candidateContentSha) {
        blockedReasons.push("candidate-content-sha-mismatch");
      }
    } catch {
      blockedReasons.push("candidate-content-sha-unverifiable");
    }
  }

  if (!isCandidateBoundCohort(readValue(env.UAIS_STAGING_INP_COHORT_ID), candidateGitSha)) {
    blockedReasons.push("cohort-id-not-candidate-bound");
  }
  if (!isStrongSecret(env.UAIS_STAGING_INP_HMAC_SECRET)) {
    blockedReasons.push("hmac-secret-missing-or-weak");
  }
  if (!keyVersionPattern.test(readValue(env.UAIS_STAGING_INP_HMAC_KEY_VERSION))) {
    blockedReasons.push("hmac-key-version-missing-or-invalid");
  }
  if (!isStrongSecret(env.UAIS_APP_SESSION_SIGNING_SECRET)) {
    blockedReasons.push("session-secret-missing-or-weak");
  }
  if (!hasStrictOperatorAccountHashList(env.UAIS_STAGING_INP_OPERATOR_ACCOUNT_HASHES)) {
    blockedReasons.push("approved-operator-allowlist-missing");
  }
  if (!isStrongSecret(env.CRON_SECRET)) {
    blockedReasons.push("cron-secret-missing-or-weak");
  }
  if (!isStrongSecret(env.P2_VERCEL_PROTECTION_BYPASS_SECRET)) {
    blockedReasons.push("protection-bypass-secret-missing-or-weak");
  }
  if (!hasDistinctStagingSecrets(env)) {
    blockedReasons.push("staging-secret-reuse-rejected");
  }

  if (blockedReasons.length > 0) {
    return {
      exitCode: 2,
      report: {
        target: "uais-isolated-staging-build",
        status: "BLOCKED_ENV",
        blockedReasons,
        valuesRedacted: true,
      },
    };
  }

  let targetInspection;
  try {
    targetInspection = await inspectTarget({ databaseUrl: dedicatedDatabaseUrl });
  } catch {
    targetInspection = { approved: false };
  }
  if (targetInspection?.approved !== true) {
    return {
      exitCode: 2,
      report: {
        target: "uais-isolated-staging-build",
        status: "BLOCKED_TARGET",
        blockedReasons: ["isolated-staging-database-guard-required"],
        requiredGuard: {
          table: "public.uais_environment_guard",
          environment: "isolated-p2-staging-source",
          enabled: true,
          sessionReplicationRole: "origin",
        },
        valuesRedacted: true,
      },
    };
  }

  // The dedicated URL is never placed in an argument or report. The existing
  // strict migration runner accepts UAIS_CORE_DATABASE_URL, so expose that
  // alias only to this one child and remove it again for the Next build.
  const buildEnv = withoutGenericDatabaseAliases(env);
  const migrationEnv = {
    ...selectMigrationEnvironment(buildEnv),
    UAIS_CORE_DATABASE_URL: dedicatedDatabaseUrl,
    UAIS_CORE_DATABASE_REQUIRED_GUARD:
      CORE_MIGRATION_STAGING_SOURCE_GUARD,
  };

  const migrationResult = invokeCommand(commandRunner, {
    label: "core-migrations",
    command: nodeExecutable,
    args: ["scripts/apply-core-migrations.mjs"],
    cwd,
    env: migrationEnv,
    redactValues: [dedicatedDatabaseUrl],
  });
  if (migrationResult.status !== 0) {
    return failedCommandResult("core-migrations-failed");
  }

  const buildResult = invokeCommand(commandRunner, {
    label: "next-build",
    command: nodeExecutable,
    args: ["node_modules/next/dist/bin/next", "build"],
    cwd,
    env: buildEnv,
    redactValues: readStagingRedactionValues(buildEnv),
  });
  if (buildResult.status !== 0) {
    return failedCommandResult("next-build-failed");
  }

  return {
    exitCode: 0,
    report: {
      target: "uais-isolated-staging-build",
      status: "PASS",
      blockedReasons: [],
      migrations: "applied",
      build: "completed",
      valuesRedacted: true,
    },
  };
}

export async function inspectStagingDatabaseTarget({
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
      WHERE environment = 'isolated-p2-staging-source'
        AND enabled = true
      LIMIT 1
    `;
    return {
      approved:
        rows.length === 1 &&
        rows[0]?.environment === "isolated-p2-staging-source" &&
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

function runCommand({ command, args, cwd, env, redactValues = [] }) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  writeRedactedChildOutput(process.stdout, result.stdout, redactValues);
  writeRedactedChildOutput(process.stderr, result.stderr, redactValues);
  return result;
}

function invokeCommand(commandRunner, invocation) {
  try {
    return commandRunner(invocation) ?? { status: null };
  } catch {
    return { status: null };
  }
}

function failedCommandResult(reason) {
  return {
    exitCode: 1,
    report: {
      target: "uais-isolated-staging-build",
      status: "FAIL",
      blockedReasons: [reason],
      valuesRedacted: true,
    },
  };
}

function withoutGenericDatabaseAliases(env) {
  const isolatedEnv = { ...env };
  for (const name of Object.keys(isolatedEnv)) {
    if (
      genericDatabaseEnvNames.includes(name) ||
      name === "UAIS_CORE_DATABASE_REQUIRED_GUARD" ||
      name === "UAIS_P2_STAGING_RESTORE_DATABASE_URL" ||
      name === "RESTORE_NEON_PROJECT_ID" ||
      name === "RESTORE_DATABASE_URL" ||
      name === "RESTORE_POSTGRES_URL" ||
      name.startsWith("UAIS_DB_TEST_") ||
      name.startsWith("UAIS_P1_LOAD_TEST_") ||
      name.startsWith("UAIS_LIVE_DB_TEST_")
    ) {
      delete isolatedEnv[name];
    }
  }
  return isolatedEnv;
}

function selectMigrationEnvironment(env) {
  const allowedNames = [
    "PATH",
    "NODE_PATH",
    "NODE_OPTIONS",
    "NODE_ENV",
    "TZ",
    "CI",
    "LANG",
    "LC_ALL",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "VERCEL_ENV",
    "VERCEL_PROJECT_ID",
    "UAIS_DEPLOYMENT_ENV",
    "UAIS_LEARNING_CHATROOM_GROUPS_MODE",
  ];
  return Object.fromEntries(
    allowedNames.flatMap((name) =>
      typeof env[name] === "string" ? [[name, env[name]]] : [],
    ),
  );
}

const secretLikeEnvNamePattern =
  /(?:^|_)(?:API_?KEY|ACCESS_KEY(?:_ID)?|TOKEN|SECRET|PASSWORD|USERNAME|CREDENTIALS?|PRIVATE_KEY|SIGNING_KEY|DSN|DATABASE_URL|POSTGRES_URL|NONCE|ACCOUNT_HASH(?:ES)?|FINGERPRINT)(?:$|_)/i;

export function readStagingRedactionValues(env) {
  const values = Object.entries(env).flatMap(([name, rawValue]) => {
    const value = readValue(rawValue);
    if (!value) return [];
    if (secretLikeEnvNamePattern.test(name)) return [value];
    if (isCredentialBearingUrl(name, value)) return [value];
    return [];
  });
  return [...new Set(values)].sort((left, right) => right.length - left.length);
}

function writeRedactedChildOutput(stream, value, redactValues) {
  if (typeof value !== "string" || value.length === 0) return;
  stream.write(redactStagingChildOutput(value, redactValues));
}

export function redactStagingChildOutput(value, redactValues) {
  let redacted = value.replace(
    /postgres(?:ql)?:\/\/[^\s"']+/gi,
    "[REDACTED_POSTGRES_DSN]",
  );
  for (const secret of redactValues) {
    redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted;
}

function isCredentialBearingUrl(name, value) {
  if (!/(?:^|_)(?:URL|ENDPOINT)$/i.test(name)) return false;
  try {
    const parsed = new URL(value);
    return Boolean(parsed.username || parsed.password || parsed.search);
  } catch {
    return false;
  }
}

function readValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isPostgresUrl(value) {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "postgres:" || parsed.protocol === "postgresql:") &&
      parsed.hostname.length > 0
    );
  } catch {
    return false;
  }
}

const digestPattern = /^[0-9a-f]{64}$/;
const gitShaPattern = /^[0-9a-f]{40}$/;
const immutableDeploymentHostPattern =
  /^uais-staging-[a-z0-9-]+\.vercel\.app$/;
const keyVersionPattern = /^[a-z0-9][a-z0-9._-]{0,31}$/;

function isCandidateBoundCohort(value, candidateGitSha) {
  const match = /^p2-inp-([0-9a-f]{40})-[a-z0-9][a-z0-9-]{0,15}$/.exec(
    value,
  );
  return gitShaPattern.test(candidateGitSha) && match?.[1] === candidateGitSha;
}

function isStrongSecret(value) {
  return readValue(value).length >= 32;
}

function hasStrictOperatorAccountHashList(value) {
  const tokens = readValue(value)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return (
    tokens.length >= 3 &&
    tokens.length <= 20 &&
    tokens.every((item) => digestPattern.test(item)) &&
    new Set(tokens).size === tokens.length
  );
}

function hasDistinctStagingSecrets(env) {
  const secrets = [
    env.UAIS_STAGING_INP_HMAC_SECRET,
    env.UAIS_APP_SESSION_SIGNING_SECRET,
    env.CRON_SECRET,
    env.P2_VERCEL_PROTECTION_BYPASS_SECRET,
  ]
    .map(readValue)
    .filter(Boolean);
  return new Set(secrets).size === secrets.length;
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  const result = await runGuardedVercelStagingBuild();
  process.stdout.write(`${JSON.stringify(result.report)}\n`);
  process.exitCode = result.exitCode;
}
