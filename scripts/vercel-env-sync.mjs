#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const deploymentEnvDefinitions = [
  {
    name: "UAIS_LIVE_AI_APPROVAL_TOKEN",
    provider: "uais",
    roles: [],
    valueType: "secret",
  },
  {
    name: "UAIS_AI_ACCESS_SIGNING_SECRET",
    provider: "uais",
    roles: [],
    valueType: "secret",
  },
  {
    name: "UAIS_APP_SESSION_SIGNING_SECRET",
    provider: "uais",
    roles: ["app-auth"],
    valueType: "secret",
  },
  {
    name: "UAIS_APP_AUTH_PROVIDER",
    provider: "uais",
    roles: ["app-auth"],
    valueType: "auth-provider",
  },
  {
    name: "UAIS_APP_AUTH_PROVIDER_URL",
    provider: "uais",
    roles: ["app-auth"],
    valueType: "base-url",
  },
  {
    name: "UAIS_APP_AUTH_PROVIDER_TOKEN",
    provider: "uais",
    roles: ["app-auth"],
    valueType: "secret",
  },
  // Carries credentials, so it is classified as a secret rather than a base
  // URL. It backs three things at once: the `database-accounts` login lookup,
  // the `database-account-cookie` teacher role check, and the Postgres stores -
  // and it is needed in the BUILD environment too, because vercel-build applies
  // the migrations from there.
  {
    name: "UAIS_CORE_DATABASE_URL",
    provider: "uais",
    roles: ["app-auth", "core-database"],
    valueType: "secret",
  },
  {
    name: "UAIS_TEACHER_AUTH_PROVIDER",
    provider: "uais",
    roles: [],
    valueType: "auth-provider",
  },
  {
    name: "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
    provider: "uais",
    roles: [],
    valueType: "secret",
  },
  {
    name: "UAIS_TEACHER_AUTH_ISSUER_SECRET",
    provider: "uais",
    roles: [],
    valueType: "secret",
  },
  {
    name: "UAIS_TEACHER_AUTH_OIDC_ISSUER",
    provider: "uais",
    roles: [],
    valueType: "base-url",
  },
  {
    name: "UAIS_TEACHER_AUTH_OIDC_AUDIENCE",
    provider: "uais",
    roles: [],
    valueType: "auth-provider",
  },
  {
    name: "UAIS_TEACHER_AUTH_OIDC_JWKS_URL",
    provider: "uais",
    roles: [],
    valueType: "base-url",
  },
  {
    name: "UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM",
    provider: "uais",
    roles: [],
    valueType: "auth-provider",
  },
  {
    name: "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
    provider: "uais",
    roles: [],
    valueType: "storage-backend",
  },
  {
    name: "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND",
    provider: "uais",
    roles: [],
    valueType: "storage-backend",
  },
  {
    name: "UAIS_TEACHING_OPERATIONS_BACKEND",
    provider: "uais",
    roles: [],
    valueType: "storage-backend",
  },
  {
    name: "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
    provider: "uais",
    roles: [],
    valueType: "storage-backend",
  },
  {
    name: "UAIS_TEACHING_COURSE_ASSETS_BACKEND",
    provider: "uais",
    roles: [],
    valueType: "storage-backend",
  },
  {
    name: "UAIS_EXTERNAL_STORAGE_BASE_URL",
    provider: "uais",
    roles: [],
    valueType: "base-url",
  },
  {
    name: "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
    provider: "uais",
    roles: [],
    valueType: "secret",
  },
  {
    name: "UAIS_EXTERNAL_STORAGE_SERVICE_MODE",
    provider: "uais",
    roles: [],
    valueType: "service-mode",
  },
  {
    name: "UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR",
    provider: "uais",
    roles: [],
    valueType: "storage-path",
  },
  {
    name: "UAIS_EXTERNAL_STORAGE_DATA_DIR",
    provider: "uais",
    roles: [],
    valueType: "storage-path",
  },
  {
    name: "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS",
    provider: "uais",
    roles: [],
    valueType: "database-adapter-proof",
  },
  {
    name: "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS",
    provider: "uais",
    roles: [],
    valueType: "database-adapter-proof",
  },
  {
    name: "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY",
    provider: "uais",
    roles: [],
    valueType: "database-adapter-proof",
  },
  {
    name: "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL",
    provider: "uais",
    roles: [],
    valueType: "database-adapter-proof",
  },
  {
    name: "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER",
    provider: "uais",
    roles: ["ordinary-teaching"],
    valueType: "auth-provider",
  },
  {
    name: "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_URL",
    provider: "uais",
    roles: ["ordinary-teaching"],
    valueType: "base-url",
  },
  {
    name: "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN",
    provider: "uais",
    roles: ["ordinary-teaching"],
    valueType: "secret",
  },
  {
    name: "UAIS_COLLABORATION_INVITE_EMAIL_CALLBACK_TOKEN",
    provider: "uais",
    roles: ["ordinary-teaching"],
    valueType: "secret",
  },
  {
    name: "UAIS_STUDENT_ROSTER_SYNC_PROVIDER",
    provider: "uais",
    roles: ["ordinary-teaching"],
    valueType: "auth-provider",
  },
  {
    name: "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_URL",
    provider: "uais",
    roles: ["ordinary-teaching"],
    valueType: "base-url",
  },
  {
    name: "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_TOKEN",
    provider: "uais",
    roles: ["ordinary-teaching"],
    valueType: "secret",
  },
  {
    name: "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER",
    provider: "uais",
    roles: ["ordinary-teaching"],
    valueType: "auth-provider",
  },
  {
    name: "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_URL",
    provider: "uais",
    roles: ["ordinary-teaching"],
    valueType: "base-url",
  },
  {
    name: "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_TOKEN",
    provider: "uais",
    roles: ["ordinary-teaching"],
    valueType: "secret",
  },
  {
    name: "UAIS_GRADEBOOK_RELEASE_PROVIDER",
    provider: "uais",
    roles: ["ordinary-teaching"],
    valueType: "auth-provider",
  },
  {
    name: "UAIS_GRADEBOOK_RELEASE_PROVIDER_URL",
    provider: "uais",
    roles: ["ordinary-teaching"],
    valueType: "base-url",
  },
  {
    name: "UAIS_GRADEBOOK_RELEASE_PROVIDER_TOKEN",
    provider: "uais",
    roles: ["ordinary-teaching"],
    valueType: "secret",
  },
  {
    name: "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER",
    provider: "uais",
    roles: ["ordinary-teaching"],
    valueType: "auth-provider",
  },
  {
    name: "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_URL",
    provider: "uais",
    roles: ["ordinary-teaching"],
    valueType: "base-url",
  },
  {
    name: "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_TOKEN",
    provider: "uais",
    roles: ["ordinary-teaching"],
    valueType: "secret",
  },
  {
    name: "UAIS_COURSE_EXPORT_PROVIDER",
    provider: "uais",
    roles: ["ordinary-teaching"],
    valueType: "auth-provider",
  },
  {
    name: "UAIS_COURSE_EXPORT_PROVIDER_URL",
    provider: "uais",
    roles: ["ordinary-teaching"],
    valueType: "base-url",
  },
  {
    name: "UAIS_COURSE_EXPORT_PROVIDER_TOKEN",
    provider: "uais",
    roles: ["ordinary-teaching"],
    valueType: "secret",
  },
  {
    name: "UAIS_GRADING_FEEDBACK_PROVIDER",
    provider: "uais",
    roles: ["ordinary-teaching"],
    valueType: "auth-provider",
  },
  {
    name: "UAIS_GRADING_FEEDBACK_PROVIDER_URL",
    provider: "uais",
    roles: ["ordinary-teaching"],
    valueType: "base-url",
  },
  {
    name: "UAIS_GRADING_FEEDBACK_PROVIDER_TOKEN",
    provider: "uais",
    roles: ["ordinary-teaching"],
    valueType: "secret",
  },
  {
    name: "DEEPSEEK_API_KEY",
    provider: "deepseek",
    roles: ["text-reasoning"],
    valueType: "secret",
  },
  {
    name: "DEEPSEEK_BASE_URL",
    provider: "deepseek",
    roles: ["text-reasoning"],
    valueType: "base-url",
    defaultValue: "https://api.deepseek.com",
  },
  {
    name: "DEEPSEEK_MODEL",
    provider: "deepseek",
    roles: ["text-reasoning"],
    valueType: "model",
    defaultValue: "deepseek-v4-flash",
  },
  {
    name: "DASHSCOPE_API_KEY",
    provider: "qwen",
    roles: ["multimodal", "image-generation", "voice-clone", "ppt-narration"],
    valueType: "secret",
  },
  {
    name: "DASHSCOPE_BASE_URL",
    provider: "qwen",
    roles: ["multimodal", "image-generation", "voice-clone", "ppt-narration"],
    valueType: "base-url",
    defaultValue: "https://dashscope.aliyuncs.com",
  },
  {
    name: "QWEN_MULTIMODAL_MODEL",
    provider: "qwen",
    roles: ["multimodal"],
    valueType: "model",
    defaultValue: "qwen3.5-omni-plus",
  },
  {
    name: "QWEN_IMAGE_MODEL",
    provider: "qwen",
    roles: ["image-generation"],
    valueType: "model",
    defaultValue: "qwen-image-2.0",
  },
  {
    name: "QWEN_TTS_MODEL",
    provider: "qwen",
    roles: ["voice-clone", "ppt-narration"],
    valueType: "model",
    defaultValue: "qwen3-tts-vc-realtime-2026-01-15",
  },
];

const localOnlyEnvDefinitions = [
  {
    name: "UAIS_TEACHER_AUTH_OIDC_SMOKE_BEARER_TOKEN",
    provider: "uais",
    reason: "approved-live-route-smoke-only",
  },
  {
    name: "UAIS_TEACHER_AUTH_OIDC_SMOKE_TEACHER_ID",
    provider: "uais",
    reason: "approved-live-route-smoke-only",
  },
];

const minimumProductionSecretLength = 32;
const coreDatabaseUrlEnvNames = ["UAIS_CORE_DATABASE_URL", "DATABASE_URL", "POSTGRES_URL"];

// Signed or verified on every request whichever selectors are chosen.
const coreProductionSecretStrengthNames = [
  "UAIS_LIVE_AI_APPROVAL_TOKEN",
  "UAIS_AI_ACCESS_SIGNING_SECRET",
  "UAIS_APP_SESSION_SIGNING_SECRET",
  "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
];
const appAuthProviderProductionSecretStrengthNames = {
  "trusted-account-provider": ["UAIS_APP_AUTH_PROVIDER_TOKEN"],
  // The database selector's credential IS the database URL, which is graded as
  // a connection string rather than by length.
  "database-accounts": [],
};
const externalStorageProductionSecretStrengthNames = [
  "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
];

// Each enterprise integration carries its own token, and a token is only worth
// grading once its integration has been selected. Requiring all seven of a
// deployment that runs none of them is how a correct plan collected thirty
// failures for services it never calls.
const enterpriseProviderSecretStrengthNames = [
  {
    selector: "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER",
    names: [
      "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN",
      "UAIS_COLLABORATION_INVITE_EMAIL_CALLBACK_TOKEN",
    ],
  },
  {
    selector: "UAIS_STUDENT_ROSTER_SYNC_PROVIDER",
    names: ["UAIS_STUDENT_ROSTER_SYNC_PROVIDER_TOKEN"],
  },
  {
    selector: "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER",
    names: ["UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_TOKEN"],
  },
  {
    selector: "UAIS_GRADEBOOK_RELEASE_PROVIDER",
    names: ["UAIS_GRADEBOOK_RELEASE_PROVIDER_TOKEN"],
  },
  {
    selector: "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER",
    names: ["UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_TOKEN"],
  },
  {
    selector: "UAIS_COURSE_EXPORT_PROVIDER",
    names: ["UAIS_COURSE_EXPORT_PROVIDER_TOKEN"],
  },
  {
    selector: "UAIS_GRADING_FEEDBACK_PROVIDER",
    names: ["UAIS_GRADING_FEEDBACK_PROVIDER_TOKEN"],
  },
];
const teacherAuthScopedProductionSecretStrengthNames = [
  "UAIS_LIVE_AI_APPROVAL_TOKEN",
  "UAIS_AI_ACCESS_SIGNING_SECRET",
  "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
];
const externalStorageScopedProductionSecretStrengthNames = [
  "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
];

const authProviderProductionSecretStrengthNames = {
  "trusted-cookie-issuer": ["UAIS_TEACHER_AUTH_ISSUER_SECRET"],
  "oidc-jwks": [],
  // The session signing secret is already in every scoped list above, and it is
  // the only secret this selector reads.
  "database-account-cookie": [],
};

// Mirrors the two provider contracts in src/lib/server/. Both selectors in each
// map are production-capable; a plan must require the SELECTED one's variables
// and not the other's.
const acceptedTeacherAuthProviderModes = [
  "trusted-cookie-issuer",
  "oidc-jwks",
  "database-account-cookie",
];
const acceptedAppAuthProviderModes = ["trusted-account-provider", "database-accounts"];
const appAuthProviderRequiredEnvNames = {
  "trusted-account-provider": [
    "UAIS_APP_AUTH_PROVIDER_URL",
    "UAIS_APP_AUTH_PROVIDER_TOKEN",
  ],
  "database-accounts": ["UAIS_CORE_DATABASE_URL"],
};
const commonRequiredAppAuthEnvNames = [
  "UAIS_APP_SESSION_SIGNING_SECRET",
  "UAIS_APP_AUTH_PROVIDER",
];
const defaultDeploymentScope = "full";

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Vercel env sync failed."}\n`);
  process.exitCode = 1;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.apply && options.approved !== true) {
    throw new Error("Vercel env sync apply requires explicit owner approval.");
  }
  if (options.apply && !hasValue(options.releaseRunId)) {
    throw new Error("Vercel env sync apply requires --release-run-id.");
  }

  const env = {
    ...process.env,
    ...readEnvFile(options.envFile),
  };
  let projectReadinessEvidenceStatus = "not-required-for-dry-run";
  if (options.apply) {
    assertLinkedProject();
    projectReadinessEvidenceStatus = assertReadyVercelProjectReadiness(options.vercelProjectReadiness);
  } else if (options.vercelProjectReadiness) {
    projectReadinessEvidenceStatus = readVercelProjectReadinessStatus(options.vercelProjectReadiness);
  }
  const plan = buildVercelEnvSyncPlan({
    env,
    project: options.project,
    mode: options.apply ? "apply" : "dry-run",
    projectReadinessEvidenceStatus,
    releaseRunId: options.releaseRunId,
    deploymentScope: options.deploymentScope,
  });

  const applyPreflight = options.apply ? readVercelEnvApplyPreflight(plan) : undefined;
  if (applyPreflight?.status === "blocked") {
    process.stdout.write(`${JSON.stringify({ ...plan, applyPreflight }, null, 2)}\n`);
    process.exitCode = 1;
  } else {
    const applySummary = options.apply ? await applyVercelEnvSync({ plan, env, options }) : undefined;
    const outputPlan = applySummary
      ? { ...plan, status: "applied", blockedReasons: [] }
      : plan;

    process.stdout.write(
      `${JSON.stringify({ ...outputPlan, ...(applyPreflight ? { applyPreflight } : {}), ...(applySummary ? { applySummary } : {}) }, null, 2)}\n`,
    );
  }
}

function buildVercelEnvSyncPlan({
  env,
  project,
  mode,
  projectReadinessEvidenceStatus,
  releaseRunId,
  deploymentScope,
}) {
  const authProviderMode = readTeacherAuthProviderMode(env.UAIS_TEACHER_AUTH_PROVIDER);
  const appAuthProviderMode = readAppAuthProviderMode(env.UAIS_APP_AUTH_PROVIDER);
  const selectedDeploymentDefinitions = selectDeploymentEnvDefinitions({
    deploymentScope,
    authProviderMode,
  });
  const oidcEndpointSecurity =
    authProviderMode === "oidc-jwks"
      ? {
          issuer: classifyEndpointSecurity(env.UAIS_TEACHER_AUTH_OIDC_ISSUER),
          jwks: classifyEndpointSecurity(env.UAIS_TEACHER_AUTH_OIDC_JWKS_URL),
        }
      : undefined;
  const externalStorageEndpoint = describeExternalStorageEndpoint(
    env.UAIS_EXTERNAL_STORAGE_BASE_URL,
  );
  const externalStorageServiceFingerprint = createExternalStorageServiceFingerprint(
    env.UAIS_EXTERNAL_STORAGE_BASE_URL,
  );
  const externalStorageDatabaseAdapterProof = describeExternalStorageDatabaseAdapterProof(env);
  const entries = selectedDeploymentDefinitions.map((definition) => {
    const redactedDefinition = { ...definition };
    delete redactedDefinition.defaultValue;
    return {
      ...redactedDefinition,
      status: hasValue(env[definition.name]) ? "present" : "missing",
      requiredForSelectedAuthProvider: isRequiredForSelectedAuthProvider(
        definition.name,
        authProviderMode,
      ),
      serverOnly: true,
      actions: ["set-production", "set-preview"],
    };
  });
  const localOnlyEntries = localOnlyEnvDefinitions.map((definition) => ({
    ...definition,
    status: hasValue(env[definition.name]) ? "present" : "missing",
    localOnly: true,
    deploymentAction: "ignored",
  }));
  const basePlan = {
    target: "vercel-env-sync",
    mode,
    project: project ?? "linked-vercel-project",
    responsibleSession: "S19",
    ...(deploymentScope !== defaultDeploymentScope ? { deploymentScope } : {}),
    ...(releaseRunId ? { releaseRunId } : {}),
    authProviderMode,
    appAuthProviderMode,
    storageBackendMode: readStorageBackendMode(env),
    productionDemoAuthFlag: describeProductionDemoAuthFlag(
      env.UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH,
    ),
    ...(oidcEndpointSecurity ? { oidcEndpointSecurity } : {}),
    externalStorageEndpoint,
    externalStorageServiceFingerprint,
    externalStorageDatabaseAdapterProof,
    secretStrength: describeProductionSecretStrength(env, authProviderMode, deploymentScope),
    projectReadinessEvidenceStatus,
    targets: ["production", "preview"],
    entries,
    localOnlyEntries,
    safety: {
      valuesRedacted: true,
      applyRequiresApproval: true,
      applyRequiresLinkedProject: true,
      applyRequiresProjectReadiness: true,
      localOnlySmokeEnvNotSynced: true,
    },
  };
  const blockedReasons = readVercelEnvSyncBlockedReasons(basePlan);
  const status = blockedReasons.length === 0 ? "ready" : "blocked";
  return {
    ...basePlan,
    localSourceSummary: summarizeLocalSource({ ...basePlan, status }),
    status,
    blockedReasons,
  };
}

function summarizeLocalSource(plan) {
  const presentEntries = plan.entries.filter((entry) => entry.status === "present");
  const missingEntries = plan.entries.filter((entry) => entry.status !== "present");
  const requiredAuthEntries = plan.entries.filter(
    (entry) => entry.requiredForSelectedAuthProvider === true,
  );
  const presentRequiredAuthEntries = requiredAuthEntries.filter(
    (entry) => entry.status === "present",
  );
  const missingRequiredAuthEntries = requiredAuthEntries.filter(
    (entry) => entry.status !== "present",
  );
  const secretChecks = plan.secretStrength.checks;
  const sufficientSecrets = secretChecks.filter((check) => check.status === "sufficient");
  const weakSecrets = secretChecks.filter((check) => check.status === "weak");
  const missingSecrets = secretChecks.filter((check) => check.status === "missing");
  const presentLocalOnlyEntries = plan.localOnlyEntries.filter(
    (entry) => entry.status === "present",
  );
  const ignoredLocalOnlyEntries = plan.localOnlyEntries.filter(
    (entry) => entry.deploymentAction === "ignored",
  );

  return {
    status: plan.status,
    valuesRedacted: true,
    ...(plan.deploymentScope !== defaultDeploymentScope
      ? { deploymentScope: plan.deploymentScope }
      : {}),
    deploymentEntries: {
      total: plan.entries.length,
      present: presentEntries.length,
      missing: missingEntries.length,
      missingNames: missingEntries.map((entry) => entry.name),
    },
    selectedAuthProvider: {
      mode: plan.authProviderMode,
      requiredPresent: presentRequiredAuthEntries.length,
      requiredMissing: missingRequiredAuthEntries.length,
      missingRequiredNames: missingRequiredAuthEntries.map((entry) => entry.name),
    },
    productionSecretStrength: {
      minimumLength: plan.secretStrength.minimumLength,
      sufficient: sufficientSecrets.length,
      weak: weakSecrets.length,
      missing: missingSecrets.length,
      weakNames: weakSecrets.map((check) => check.name),
      missingNames: missingSecrets.map((check) => check.name),
    },
    externalStorage: {
      endpointClass:
        plan.deploymentScope === "teacher-auth"
          ? "not-required-for-scope"
          : plan.externalStorageEndpoint.endpointClass,
      fingerprintStatus:
        plan.deploymentScope === "teacher-auth"
          ? "not-required-for-scope"
          : plan.externalStorageServiceFingerprint.status,
    },
    externalStorageDatabaseAdapterProof:
      plan.deploymentScope === "teacher-auth"
        ? {
            status: "not-required-for-scope",
            providerClass: "not-required-for-scope",
            migrationStatus: "not-required-for-scope",
            backupPolicy: "not-required-for-scope",
            concurrencyControl: "not-required-for-scope",
            valuesRedacted: true,
          }
        : plan.externalStorageDatabaseAdapterProof,
    localOnlyEntries: {
      total: plan.localOnlyEntries.length,
      present: presentLocalOnlyEntries.length,
      ignored: ignoredLocalOnlyEntries.length,
    },
  };
}

function describeProductionSecretStrength(env, authProviderMode, deploymentScope) {
  const commonRequiredNames = readScopedProductionSecretStrengthNames(
    deploymentScope,
    env,
  );
  const requiredNames = [
    ...new Set([
      ...commonRequiredNames,
      ...(deploymentScope === "external-storage"
        ? []
        : (authProviderProductionSecretStrengthNames[authProviderMode] ?? [])),
    ]),
  ];
  return {
    minimumLength: minimumProductionSecretLength,
    valuesRedacted: true,
    checks: requiredNames.map((name) => ({
      name,
      status: classifySecretStrength(env[name]),
      valueRedacted: true,
    })),
  };
}

function readScopedProductionSecretStrengthNames(deploymentScope, env) {
  if (deploymentScope === "teacher-auth") {
    return teacherAuthScopedProductionSecretStrengthNames;
  }
  if (deploymentScope === "external-storage") {
    return externalStorageScopedProductionSecretStrengthNames;
  }
  return [
    ...coreProductionSecretStrengthNames,
    ...(appAuthProviderProductionSecretStrengthNames[
      readAppAuthProviderMode(env.UAIS_APP_AUTH_PROVIDER)
    ] ?? []),
    ...(readStorageBackendMode(env) === "external"
      ? externalStorageProductionSecretStrengthNames
      : []),
    ...enterpriseProviderSecretStrengthNames.flatMap((integration) =>
      hasValue(env[integration.selector]) ? integration.names : [],
    ),
  ];
}

// Mirrors checkStorageBackend in scripts/chatroom-production-readiness.mjs and
// the runtime default: a production deployment with a core database URL and no
// explicit selector is already durable on Postgres, so external-storage
// placement is a choice rather than the only durable option.
function readStorageBackendMode(env) {
  const selector = env.UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND?.trim().toLowerCase() ?? "";
  const coreDatabaseConfigured = coreDatabaseUrlEnvNames.some((name) =>
    hasValue(env[name]),
  );
  if (selector === "external") {
    return "external";
  }
  if (selector === "postgres" || selector === "managed") {
    // The selector alone is not a durable posture. The store it selects reads
    // the core database url and answers 503 without one, so grading this
    // "core-database" waved an apply through with no durable store at all -
    // checkStorageBackend in chatroom-production-readiness.mjs, which this
    // mirrors, has always blocked that case on missing-UAIS_CORE_DATABASE_URL.
    // Answer with what is actually configured, and let the durable-storage gate
    // name it.
    return coreDatabaseConfigured ? "core-database" : "local-json";
  }
  if (coreDatabaseConfigured) {
    // Unset selector plus a database is the runtime's own default, and it wins
    // over a placed external endpoint because that is what the app would do.
    return "core-database";
  }
  if (hasValue(env.UAIS_EXTERNAL_STORAGE_BASE_URL)) {
    // No selector and no database, but an endpoint was deliberately placed:
    // the plan is an external-storage plan and has to prove that endpoint.
    return "external";
  }
  // Neither a durable selector nor a database: production refuses local JSON.
  return "local-json";
}

function selectDeploymentEnvDefinitions({ deploymentScope, authProviderMode }) {
  if (deploymentScope === "full") {
    return deploymentEnvDefinitions;
  }
  if (deploymentScope === "external-storage") {
    const names = new Set([
      "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
      "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND",
      "UAIS_TEACHING_OPERATIONS_BACKEND",
      "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
      "UAIS_TEACHING_COURSE_ASSETS_BACKEND",
      "UAIS_EXTERNAL_STORAGE_BASE_URL",
      "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
      "UAIS_EXTERNAL_STORAGE_SERVICE_MODE",
      "UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR",
      "UAIS_EXTERNAL_STORAGE_DATA_DIR",
      "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS",
      "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS",
      "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY",
      "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL",
    ]);
    return deploymentEnvDefinitions.filter((definition) => names.has(definition.name));
  }
  const names = new Set([
    "UAIS_LIVE_AI_APPROVAL_TOKEN",
    "UAIS_AI_ACCESS_SIGNING_SECRET",
    "UAIS_TEACHER_AUTH_PROVIDER",
    "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
  ]);
  if (authProviderMode === "trusted-cookie-issuer") {
    names.add("UAIS_TEACHER_AUTH_ISSUER_SECRET");
  }
  if (authProviderMode === "oidc-jwks") {
    names.add("UAIS_TEACHER_AUTH_OIDC_ISSUER");
    names.add("UAIS_TEACHER_AUTH_OIDC_AUDIENCE");
    names.add("UAIS_TEACHER_AUTH_OIDC_JWKS_URL");
    names.add("UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM");
  }
  return deploymentEnvDefinitions.filter((definition) => names.has(definition.name));
}

function classifySecretStrength(value) {
  if (!hasValue(value)) {
    return "missing";
  }
  return value.trim().length >= minimumProductionSecretLength ? "sufficient" : "weak";
}

function readTeacherAuthProviderMode(value) {
  if (!hasValue(value)) {
    return "missing";
  }
  const provider = value.trim();
  return acceptedTeacherAuthProviderModes.includes(provider) ? provider : "unsupported";
}

function readAppAuthProviderMode(value) {
  if (!hasValue(value)) {
    return "missing";
  }
  const provider = value.trim();
  return acceptedAppAuthProviderModes.includes(provider) ? provider : "unsupported";
}

// The one flag that can serve the repo's public demo credentials as real logins
// on the deployed site. An apply targets production, so it must never carry it.
function describeProductionDemoAuthFlag(value) {
  return {
    status: hasValue(value) ? "set" : "unset",
    requiredForProduction: "unset",
    valueRedacted: true,
  };
}

function describeExternalStorageEndpoint(value) {
  const endpointClass = classifyEndpointSecurity(value);
  return {
    status: endpointClass === "missing" ? "missing" : "present",
    endpointClass,
    valueRedacted: true,
  };
}

function createExternalStorageServiceFingerprint(value) {
  if (!hasValue(value)) {
    return {
      status: "missing",
      source: "origin",
      valueRedacted: true,
    };
  }
  try {
    const endpoint = new URL(value);
    return {
      status: "present",
      value: `sha256:${createHash("sha256").update(endpoint.origin).digest("hex").slice(0, 16)}`,
      source: "origin",
      valueRedacted: true,
    };
  } catch {
    return {
      status: "invalid",
      source: "origin",
      valueRedacted: true,
    };
  }
}

function describeExternalStorageDatabaseAdapterProof(env) {
  const providerClass = readExpectedAdapterProofValue(
    env.UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS,
    "managed-database",
  );
  const migrationStatus = readExpectedAdapterProofValue(
    env.UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS,
    "up-to-date",
  );
  const backupPolicy = readExpectedAdapterProofValue(
    env.UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY,
    "point-in-time-restore",
  );
  const concurrencyControl = readExpectedAdapterProofValue(
    env.UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL,
    "transactional",
  );
  const status =
    providerClass === "managed-database" &&
    migrationStatus === "up-to-date" &&
    backupPolicy === "point-in-time-restore" &&
    concurrencyControl === "transactional"
      ? "ready"
      : "blocked";
  return {
    status,
    providerClass,
    migrationStatus,
    backupPolicy,
    concurrencyControl,
    valuesRedacted: true,
  };
}

function readExpectedAdapterProofValue(value, expected) {
  return hasValue(value) && value.trim() === expected ? expected : "missing";
}

function classifyEndpointSecurity(value) {
  if (!hasValue(value)) {
    return "missing";
  }
  try {
    const endpoint = new URL(value);
    const hostClass = classifyEndpointHost(endpoint.hostname);
    if (hostClass !== "remote") {
      return hostClass;
    }
    return endpoint.protocol === "https:" ? "remote-https" : "insecure-http";
  } catch {
    return "invalid";
  }
}

function classifyEndpointHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host === "0.0.0.0") {
    return "local-loopback";
  }
  const octets = host.split(".").map((part) => Number(part));
  if (octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    if (octets[0] === 127) {
      return "local-loopback";
    }
    if (
      octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 169 && octets[1] === 254)
    ) {
      return "private-network";
    }
  }
  return "remote";
}

function isRequiredForSelectedAuthProvider(name, authProviderMode) {
  if (
    name === "UAIS_TEACHER_AUTH_PROVIDER" ||
    name === "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET"
  ) {
    return true;
  }
  if (name === "UAIS_TEACHER_AUTH_ISSUER_SECRET") {
    return authProviderMode === "trusted-cookie-issuer";
  }
  if (
    name === "UAIS_TEACHER_AUTH_OIDC_ISSUER" ||
    name === "UAIS_TEACHER_AUTH_OIDC_AUDIENCE" ||
    name === "UAIS_TEACHER_AUTH_OIDC_JWKS_URL" ||
    name === "UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM"
  ) {
    return authProviderMode === "oidc-jwks";
  }
  return false;
}

function readVercelEnvApplyPreflight(plan) {
  const blockedReasons = dedupeBlockedReasons([
    // Applies to every scope: an apply writes to the production target, and no
    // scope of it is allowed to carry the demo-auth escape hatch.
    ...readApplyProductionDemoAuthBlockedReasons(plan),
    ...(plan.deploymentScope === "external-storage"
      ? []
      : readApplyAuthProviderBlockedReasons(plan.authProviderMode)),
    ...(plan.deploymentScope === "external-storage"
      ? []
      : readApplyRequiredAuthEnvBlockedReasons(plan.entries)),
    ...(plan.deploymentScope !== "external-storage" && plan.deploymentScope !== "teacher-auth"
      ? readApplyAppAuthProviderBlockedReasons(plan)
      : []),
    ...readApplySecretStrengthBlockedReasons(plan.secretStrength),
    ...(plan.deploymentScope === "teacher-auth"
      ? []
      : readApplyExternalStorageBlockedReasons(plan)),
    ...(plan.deploymentScope === "external-storage"
      ? []
      : readApplyOidcEndpointBlockedReasons(plan)),
  ]);
  if (blockedReasons.length > 0) {
    return {
      status: "blocked",
      blockedReasons,
      valuesRedacted: true,
      cliNotInvoked: true,
    };
  }
  return {
    status: "passed",
    blockedReasons: [],
    valuesRedacted: true,
    cliSafeToInvoke: true,
  };
}

function readVercelEnvSyncBlockedReasons(plan) {
  return readVercelEnvApplyPreflight(plan).blockedReasons;
}

function readApplyAuthProviderBlockedReasons(authProviderMode) {
  return acceptedTeacherAuthProviderModes.includes(authProviderMode)
    ? []
    : ["vercel-env-apply-auth-provider-not-proven"];
}

function readApplyProductionDemoAuthBlockedReasons(plan) {
  return plan.productionDemoAuthFlag?.status === "set"
    ? ["vercel-env-apply-production-demo-auth-flag-set"]
    : [];
}

function readApplyRequiredAuthEnvBlockedReasons(entries) {
  return entries.some(
    (entry) => entry.requiredForSelectedAuthProvider === true && entry.status !== "present",
  )
    ? ["vercel-env-apply-required-auth-env-missing"]
    : [];
}

function readApplyAppAuthProviderBlockedReasons(plan) {
  // Follows the SELECTED selector. Demanding the trusted provider's endpoint
  // and token unconditionally is what made a correct `database-accounts` plan
  // unappliable on two variables the login route never reads.
  const requiredNames = [
    ...commonRequiredAppAuthEnvNames,
    ...(appAuthProviderRequiredEnvNames[plan.appAuthProviderMode] ?? []),
  ];
  const presentNames = new Set(
    plan.entries
      .filter((entry) => entry.status === "present")
      .map((entry) => entry.name),
  );
  return [
    ...(acceptedAppAuthProviderModes.includes(plan.appAuthProviderMode)
      ? []
      : ["vercel-env-apply-app-auth-provider-not-proven"]),
    ...(requiredNames.every((name) => presentNames.has(name))
      ? []
      : ["vercel-env-apply-app-auth-provider-env-missing"]),
  ];
}

function readApplySecretStrengthBlockedReasons(secretStrength) {
  return secretStrength.checks.some((check) => check.status !== "sufficient")
    ? ["vercel-env-apply-secret-strength-not-sufficient"]
    : [];
}

function readApplyExternalStorageBlockedReasons(plan) {
  const blockedReasons = [];
  // The external-storage service is one of two durable options, not a
  // precondition of shipping. A plan that keeps its data on the core database
  // has nothing here to prove; a plan with neither has no durable store at all,
  // which is the failure worth naming.
  if (plan.storageBackendMode === "core-database") {
    return blockedReasons;
  }
  if (plan.storageBackendMode === "local-json") {
    return ["vercel-env-apply-durable-storage-not-configured"];
  }
  if (plan.externalStorageEndpoint.endpointClass !== "remote-https") {
    blockedReasons.push("vercel-env-apply-external-storage-not-remote-https");
  }
  if (plan.externalStorageServiceFingerprint.status !== "present") {
    blockedReasons.push("vercel-env-apply-external-storage-fingerprint-not-proven");
  }
  if (plan.externalStorageDatabaseAdapterProof.status !== "ready") {
    blockedReasons.push(
      "vercel-env-apply-external-storage-database-adapter-proof-not-ready",
    );
  }
  return blockedReasons;
}

function readApplyOidcEndpointBlockedReasons(plan) {
  if (plan.authProviderMode !== "oidc-jwks") {
    return [];
  }
  return plan.oidcEndpointSecurity?.issuer === "remote-https" &&
    plan.oidcEndpointSecurity?.jwks === "remote-https"
    ? []
    : ["vercel-env-apply-oidc-endpoints-not-remote-https"];
}

function dedupeBlockedReasons(blockedReasons) {
  return [...new Set(blockedReasons)];
}

async function applyVercelEnvSync({ plan, env, options }) {
  if (options.applyMethod === "rest") {
    return applyVercelEnvSyncWithRestApi({
      plan,
      env,
      apiBaseUrl: options.vercelApiBaseUrl,
    });
  }
  return applyVercelEnvSyncWithCli({ plan, env });
}

function applyVercelEnvSyncWithCli({ plan, env }) {
  const vercelCommand = resolveVercelCommand(process.cwd());
  const appliedByTarget = Object.fromEntries(plan.targets.map((target) => [target, 0]));
  let appliedEntries = 0;
  let appliedActions = 0;
  for (const entry of plan.entries) {
    const value = env[entry.name];
    if (!hasValue(value)) {
      continue;
    }

    appliedEntries += 1;
    for (const target of plan.targets) {
      const result = spawnSync(vercelCommand, ["env", "add", entry.name, target, "--yes", "--force"], {
        input: value,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      if (result.status !== 0) {
        throw new Error(`Vercel env add failed for ${entry.name} in ${target}.`);
      }
      if (!hasVercelEnvAddConfirmation(result.stdout, entry.name)) {
        throw new Error(`Vercel env add did not confirm success for ${entry.name} in ${target}.`);
      }
      appliedByTarget[target] += 1;
      appliedActions += 1;
    }
  }
  return {
    status: "applied",
    appliedEntries,
    appliedActions,
    appliedByTarget,
    localOnlyEntriesSkipped: plan.localOnlyEntries.length,
    valuesRedacted: true,
    cliOutputOmitted: true,
  };
}

async function applyVercelEnvSyncWithRestApi({ plan, env, apiBaseUrl }) {
  const projectLink = readVercelProjectLink(process.cwd());
  const token = readVercelApiToken();
  const appliedByTarget = Object.fromEntries(plan.targets.map((target) => [target, 0]));
  let appliedEntries = 0;
  let appliedActions = 0;
  for (const entry of plan.entries) {
    const value = env[entry.name];
    if (!hasValue(value)) {
      continue;
    }

    appliedEntries += 1;
    for (const target of plan.targets) {
      await upsertVercelEnvRecord({
        apiBaseUrl,
        projectLink,
        token,
        entry,
        value,
        target,
      });
      appliedByTarget[target] += 1;
      appliedActions += 1;
    }
  }

  return {
    status: "applied",
    appliedEntries,
    appliedActions,
    appliedByTarget,
    localOnlyEntriesSkipped: plan.localOnlyEntries.length,
    valuesRedacted: true,
    apiOutputOmitted: true,
  };
}

function hasVercelEnvAddConfirmation(stdout, envName) {
  const output = typeof stdout === "string" ? stdout : "";
  return (
    /\b(?:Added|Overrode) Environment Variable\b/.test(output) &&
    output.includes(envName)
  );
}

async function upsertVercelEnvRecord({
  apiBaseUrl,
  projectLink,
  token,
  entry,
  value,
  target,
}) {
  const url = new URL(
    `/v10/projects/${encodeURIComponent(projectLink.projectId)}/env`,
    apiBaseUrl,
  );
  url.searchParams.set("upsert", "true");
  if (projectLink.orgId.startsWith("team_")) {
    url.searchParams.set("teamId", projectLink.orgId);
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      type: readVercelEnvRecordType(),
      key: entry.name,
      value,
      target: [target],
    }),
  });
  if (!response.ok) {
    const errorCode = await readSafeVercelRestErrorCode(response);
    throw new Error(
      `Vercel env REST upsert failed for ${entry.name} in ${target} with status ${response.status} and error code ${errorCode}.`,
    );
  }
}

async function readSafeVercelRestErrorCode(response) {
  try {
    const body = await response.json();
    const code = body?.error?.code;
    return typeof code === "string" && /^[A-Za-z0-9._:-]{1,80}$/.test(code)
      ? code
      : "unknown";
  } catch {
    return "unknown";
  }
}

function readVercelEnvRecordType() {
  return "sensitive";
}

function resolveVercelCommand(projectDir) {
  const localBin = join(projectDir, "node_modules", ".bin", process.platform === "win32" ? "vercel.cmd" : "vercel");
  return existsSync(localBin) ? localBin : "vercel";
}

function readVercelProjectLink(projectDir) {
  const envProjectId = process.env.VERCEL_PROJECT_ID;
  const envOrgId = process.env.VERCEL_ORG_ID;
  if (hasValue(envProjectId) && hasValue(envOrgId)) {
    return {
      projectId: envProjectId.trim(),
      orgId: envOrgId.trim(),
    };
  }

  const projectJsonPath = join(projectDir, ".vercel", "project.json");
  if (existsSync(projectJsonPath)) {
    const parsed = readJsonFile(projectJsonPath);
    if (hasValue(parsed?.projectId) && hasValue(parsed?.orgId)) {
      return {
        projectId: parsed.projectId.trim(),
        orgId: parsed.orgId.trim(),
      };
    }
  }

  const repoJsonPath = join(projectDir, ".vercel", "repo.json");
  if (existsSync(repoJsonPath)) {
    const parsed = readJsonFile(repoJsonPath);
    const project = Array.isArray(parsed?.projects) ? parsed.projects[0] : undefined;
    if (hasValue(project?.projectId) && hasValue(parsed?.orgId)) {
      return {
        projectId: project.projectId.trim(),
        orgId: parsed.orgId.trim(),
      };
    }
  }

  throw new Error("Vercel REST env sync requires a linked project id and org id.");
}

function readVercelApiToken() {
  if (hasValue(process.env.VERCEL_TOKEN)) {
    return process.env.VERCEL_TOKEN.trim();
  }

  for (const authFile of readVercelAuthFileCandidates()) {
    if (!existsSync(authFile)) {
      continue;
    }
    const parsed = readJsonFile(authFile);
    if (hasValue(parsed?.token)) {
      return parsed.token.trim();
    }
  }

  throw new Error("Vercel REST env sync requires VERCEL_TOKEN or local Vercel CLI auth.");
}

function readVercelAuthFileCandidates() {
  const home = homedir();
  return [
    join(home, ".vercel", "auth.json"),
    join(home, ".config", "vercel", "auth.json"),
    join(home, "Library", "Application Support", "com.vercel.cli", "auth.json"),
  ];
}

function readJsonFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function parseArgs(args) {
  const options = {
    apply: false,
    approved: false,
    envFile: undefined,
    project: undefined,
    vercelProjectReadiness: undefined,
    releaseRunId: undefined,
    deploymentScope: defaultDeploymentScope,
    applyMethod: "cli",
    vercelApiBaseUrl: "https://api.vercel.com",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      options.apply = false;
    } else if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--approved") {
      options.approved = true;
    } else if (arg === "--env-file") {
      const envFile = args[index + 1];
      if (!envFile) {
        throw new Error("--env-file requires a path.");
      }
      options.envFile = envFile;
      index += 1;
    } else if (arg === "--project") {
      const project = args[index + 1];
      if (!project) {
        throw new Error("--project requires a project name.");
      }
      options.project = project;
      index += 1;
    } else if (arg === "--vercel-project-readiness") {
      const vercelProjectReadiness = args[index + 1];
      if (!vercelProjectReadiness) {
        throw new Error("--vercel-project-readiness requires a path.");
      }
      options.vercelProjectReadiness = vercelProjectReadiness;
      index += 1;
    } else if (arg === "--release-run-id") {
      const releaseRunId = args[index + 1];
      if (!releaseRunId) {
        throw new Error("--release-run-id requires a value.");
      }
      options.releaseRunId = normalizeReleaseRunId(releaseRunId);
      index += 1;
    } else if (arg === "--scope") {
      const deploymentScope = args[index + 1];
      if (!deploymentScope) {
        throw new Error("--scope requires a value.");
      }
      options.deploymentScope = normalizeDeploymentScope(deploymentScope);
      index += 1;
    } else if (arg === "--apply-method") {
      const applyMethod = args[index + 1];
      if (!applyMethod) {
        throw new Error("--apply-method requires a value.");
      }
      options.applyMethod = normalizeApplyMethod(applyMethod);
      index += 1;
    } else if (arg === "--vercel-api-base-url") {
      const vercelApiBaseUrl = args[index + 1];
      if (!vercelApiBaseUrl) {
        throw new Error("--vercel-api-base-url requires a URL.");
      }
      options.vercelApiBaseUrl = normalizeVercelApiBaseUrl(vercelApiBaseUrl);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node -- scripts/vercel-env-sync.mjs [--dry-run] [--apply --approved] [--apply-method cli|rest] [--project NAME] [--scope full|teacher-auth|external-storage] [--env-file PATH] [--vercel-project-readiness PATH] [--release-run-id ID]",
          "",
          "Outputs or applies a redacted UAIS Vercel env sync plan. Values are never printed.",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function normalizeApplyMethod(value) {
  const method = value.trim();
  if (method === "cli" || method === "rest") {
    return method;
  }
  throw new Error("--apply-method must be cli or rest.");
}

function normalizeVercelApiBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("--vercel-api-base-url must be HTTPS unless targeting localhost test server.");
  }
  return url.toString();
}

function normalizeDeploymentScope(value) {
  const scope = value.trim();
  if (scope === "full" || scope === "teacher-auth" || scope === "external-storage") {
    return scope;
  }
  throw new Error("--scope must be full, teacher-auth, or external-storage.");
}

function normalizeReleaseRunId(value) {
  const releaseRunId = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(releaseRunId)) {
    throw new Error("--release-run-id must be a non-secret release identifier.");
  }
  return releaseRunId;
}

function assertLinkedProject() {
  const hasProjectEnv = hasValue(process.env.VERCEL_PROJECT_ID) && hasValue(process.env.VERCEL_ORG_ID);
  const hasProjectFile = existsSync(".vercel/project.json") || existsSync(".vercel/repo.json");
  if (!hasProjectEnv && !hasProjectFile) {
    throw new Error("Vercel env sync apply requires a linked Vercel project.");
  }
}

function assertReadyVercelProjectReadiness(vercelProjectReadiness) {
  if (!vercelProjectReadiness) {
    throw new Error("Vercel env sync apply requires ready Vercel project-readiness evidence.");
  }

  const status = readVercelProjectReadinessStatus(vercelProjectReadiness);
  if (status !== "ready") {
    throw new Error("Vercel env sync apply requires ready Vercel project-readiness evidence.");
  }
  return "ready";
}

function readVercelProjectReadinessStatus(vercelProjectReadiness) {
  let evidence;
  try {
    evidence = JSON.parse(readFileSync(vercelProjectReadiness, "utf8"));
  } catch {
    return "invalid";
  }
  const requiredChecks = [
    "s22-vercel-cli",
    "s22-vercel-auth",
    "s22-vercel-team-scope",
    "s22-vercel-project-candidate",
    "s22-vercel-project-link",
    "s22-vercelignore-upload-hygiene",
  ];
  const presentChecks = new Set(
    (Array.isArray(evidence.checks) ? evidence.checks : [])
      .filter((check) => typeof check === "object" && check !== null && check.status === "present")
      .map((check) => check.id)
      .filter((id) => typeof id === "string"),
  );
  const allChecksPresent = requiredChecks.every((checkId) => presentChecks.has(checkId));
  if (
    evidence?.target !== "vercel-project-readiness" ||
    evidence?.status !== "ready" ||
    allChecksPresent !== true
  ) {
    return "blocked";
  }
  return "ready";
}

function readEnvFile(envFile) {
  if (!envFile) {
    return {};
  }

  const parsed = {};
  const content = readFileSync(envFile, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (key) {
      parsed[key] = stripQuotes(value);
    }
  }

  return parsed;
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function hasValue(value) {
  return typeof value === "string" && value.trim() !== "";
}
