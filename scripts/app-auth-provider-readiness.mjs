#!/usr/bin/env node

import { readFileSync } from "node:fs";

// Matches minimumUaisAppSessionSecretLength in src/lib/server/uais-app-session.ts
// and minimumTeacherAuthSecretLength in src/lib/server/teacher-auth-provider-contract.ts.
// This script graded `weak` here long before the runtime refused it; a deployed
// runtime now refuses the same values, so a deployment that skipped this gate no
// longer signs sessions with a key this script would have blocked.
const minimumProductionSecretLength = 32;

// Mirrors resolveUaisAppAuthProviderContract in
// src/lib/server/uais-app-auth-provider.ts. `database-accounts` authenticates
// against the uais_users rows on the core database the deployment already has,
// so it reads neither UAIS_APP_AUTH_PROVIDER_URL nor _TOKEN;
// `trusted-account-provider` calls an external account service and needs both.
// Both are production-capable selectors, and this script must not demand one
// selector's environment from the other - which is what made a correct
// `database-accounts` deployment fail readiness on two variables it never reads.
const acceptedAppAuthProviderModes = ["trusted-account-provider", "database-accounts"];

// Same order and names as scripts/apply-core-migrations.mjs and
// scripts/seed-uais-accounts.mjs, so "which URL did it use" has one answer
// across the chain.
const coreDatabaseUrlEnvNames = ["UAIS_CORE_DATABASE_URL", "DATABASE_URL", "POSTGRES_URL"];

// Required for EVERY production-capable selector: the session cookie is signed
// the same way whichever provider verified the password.
const commonRequiredAppAuthEnvNames = [
  "UAIS_APP_SESSION_SIGNING_SECRET",
  "UAIS_APP_AUTH_PROVIDER",
];
const appAuthProviderRequiredEnvNames = {
  "trusted-account-provider": [
    "UAIS_APP_AUTH_PROVIDER_URL",
    "UAIS_APP_AUTH_PROVIDER_TOKEN",
  ],
  "database-accounts": ["UAIS_CORE_DATABASE_URL"],
};
const appSessionCookiePair = [
  {
    name: "uais_app_session",
    purpose: "signed-app-session-claims",
  },
  {
    name: "uais_app_session_signature",
    purpose: "hmac-sha256-signature",
  },
];
const appAuthProviderReadinessResultKeys = [
  "appAuthProviderModeTrusted",
  "appAuthProviderEndpointRemoteHttps",
  "appAuthSessionCookieContract",
  "appAuthProviderVercelEnvSync",
  "trustedAccountProviderContract",
  "appAuthReadinessSafety",
];

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.live && options.approved !== true) {
    throw new Error("App auth provider readiness requires explicit owner approval.");
  }

  const env = {
    ...process.env,
    ...readEnvFile(options.envFile),
  };
  const mode = options.live ? "live" : "dry-run";
  const providerMode = normalizeAppAuthProvider(
    options.provider || env.UAIS_APP_AUTH_PROVIDER,
  );
  const endpoint = options.providerUrl || env.UAIS_APP_AUTH_PROVIDER_URL;
  const accessToken = options.providerToken || env.UAIS_APP_AUTH_PROVIDER_TOKEN;
  const vercelEnvSync = readJsonEvidence(options.vercelEnvSync);
  const coreDatabaseUrl = readCoreDatabaseUrl(env);
  // Never read from an argument. A DSN passed on the command line lands in
  // shell history and in the process table, where the rest of this script's
  // redaction cannot reach it.
  const rosterSeeding =
    providerMode === "database-accounts"
      ? await readAccountRosterSeeding({
          databaseUrl: coreDatabaseUrl,
          // A dry-run must stay hermetic: it is run in CI and on laptops that
          // may have an unrelated DATABASE_URL exported, and opening a
          // connection there would be a surprise, not a check. Live mode
          // already requires --approved, so that is where the probe belongs.
          probe: mode === "live" || options.rosterProbe,
        })
      : undefined;
  const plan = buildAppAuthProviderReadinessPlan({
    mode,
    environment: options.environment,
    appAuthProviderMode: providerMode,
    sessionSecret: options.sessionSecret || env.UAIS_APP_SESSION_SIGNING_SECRET,
    endpoint,
    accessToken,
    coreDatabaseUrl,
    rosterSeeding,
    productionDemoAuthFlag: env.UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH,
    releaseRunId: normalizeReleaseRunId(options.releaseRunId),
    vercelEnvSync,
  });

  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  if (mode === "live" && plan.status === "blocked") {
    process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "App auth provider readiness failed."}\n`,
  );
  process.exitCode = 1;
}

function buildAppAuthProviderReadinessPlan({
  mode,
  environment,
  appAuthProviderMode,
  sessionSecret,
  endpoint,
  accessToken,
  coreDatabaseUrl,
  rosterSeeding,
  productionDemoAuthFlag,
  releaseRunId,
  vercelEnvSync,
}) {
  const endpointSecurity = classifyEndpointSecurity(endpoint);
  const demoAuthFlag = classifyProductionDemoAuthFlag(productionDemoAuthFlag);
  const appSessionCookieContract = {
    signingSecretStrength: classifySecretStrength(sessionSecret),
    httpOnly: "required",
    sameSite: "lax",
    secureInProduction: true,
    maxAgeBounded: true,
    cookiePair: appSessionCookiePair.map((cookie) => ({
      ...cookie,
      httpOnly: true,
      sameSite: "Lax",
      secure: "required-in-production",
      path: "/",
      maxAge: "bounded-by-session-ttl",
      priority: "High",
      valueRedacted: true,
    })),
    valueRedacted: true,
  };
  const trustedAccountProviderContract =
    appAuthProviderMode === "trusted-account-provider"
      ? {
          providerKind: "trusted-account-provider",
          endpoint: hasValue(endpoint) ? "configured" : "missing",
          bearerCredential: hasValue(accessToken) ? "configured" : "missing",
          accessTokenStrength: classifySecretStrength(accessToken),
          requestMethod: "POST",
          responseUserShape: ["account", "role", "displayName", "department"],
          valueRedacted: true,
        }
      : undefined;
  // The first-party selector's whole contract is "the account rows and the
  // login route live in the same deployment", so its readiness is the database
  // URL plus a roster that actually has someone in it. There is no endpoint and
  // no second credential to classify.
  const databaseAccountProviderContract =
    appAuthProviderMode === "database-accounts"
      ? {
          providerKind: "database-accounts",
          source: "uais-core-database",
          accountTable: "uais_users",
          coreDatabase: coreDatabaseUrl ? "configured" : "missing",
          externalProviderRequired: false,
          ...(rosterSeeding ? { rosterSeeding } : {}),
          valueRedacted: true,
        }
      : undefined;
  const vercelEnvSyncEvidence = evaluateVercelEnvSyncEvidence({
    evidence: vercelEnvSync,
    appAuthProviderMode,
    releaseRunId,
    required: mode === "live" && environment === "production",
  });

  const blockedReasons = [
    ...(mode === "live" && environment !== "production" && environment !== "local-production"
      ? ["app-auth-provider-readiness-not-production"]
      : []),
    ...(mode === "live" && environment === "production" && !releaseRunId
      ? ["app-auth-provider-release-run-id-missing"]
      : []),
    ...readProductionDemoAuthBlockedReasons({ environment, demoAuthFlag }),
    ...readVercelEnvSyncBlockedReasons(vercelEnvSyncEvidence),
    ...readProviderBlockedReasons({
      appAuthProviderMode,
      environment,
      endpointSecurity,
      trustedAccountProviderContract,
      databaseAccountProviderContract,
      rosterSeedingRequired: mode === "live",
    }),
    ...readSessionCookieBlockedReasons(appSessionCookieContract),
    ...(mode === "dry-run" ? ["app-auth-provider-live-readiness-not-run"] : []),
  ];
  const warnings = readAppAuthProviderWarnings({ appAuthProviderMode, rosterSeeding });
  const safety = {
    valuesRedacted: true,
    secretsOmitted: true,
    passwordsOmitted: true,
    providerUrlsOmitted: true,
    responseBodiesOmitted: true,
    localPrivatePathsOmitted: true,
    liveRequiresApproval: true,
    remoteMutationRequiresApproval: true,
    cookieValuesOmitted: true,
    ...(environment === "local-production" ? { productionGateEligible: false } : {}),
    ...(mode === "live" ? { providerNetworkCallPerformed: false } : {}),
  };
  const results = buildAppAuthProviderReadinessResults({
    appAuthProviderMode,
    endpointSecurity,
    appSessionCookieContract,
    trustedAccountProviderContract,
    databaseAccountProviderContract,
    vercelEnvSyncEvidence,
    safety,
  });

  return {
    target: "app-auth-provider-readiness",
    mode,
    environment,
    // Reports whether the app auth PROVIDER was called, which is what the
    // redaction contract is about. The optional roster probe is a query against
    // the deployment's own database and is reported separately, under
    // databaseAccountProviderContract.rosterSeeding.
    network: "disabled",
    status: blockedReasons.length === 0 ? "ready" : "blocked",
    ...(releaseRunId ? { releaseRunId } : {}),
    responsibleSession: "S12/S19/S22",
    appAuthProviderMode,
    endpointSecurity,
    productionDemoAuthFlag: demoAuthFlag,
    appSessionCookieContract,
    ...(trustedAccountProviderContract ? { trustedAccountProviderContract } : {}),
    ...(databaseAccountProviderContract ? { databaseAccountProviderContract } : {}),
    ...(vercelEnvSyncEvidence ? { vercelEnvSyncEvidence } : {}),
    results,
    blockedReasons,
    ...(warnings.length > 0 ? { warnings } : {}),
    safety,
  };
}

// The key NAMES are a cross-script contract (enterprise-live-evidence-audit and
// the release gate both pin them), so they keep the trusted-provider wording
// even though they now carry two selectors. What each one MEANS is per selector:
// the database provider has no endpoint to be remote-https and no bearer
// credential to classify, because the account lookup never leaves the
// deployment - so those two keys are satisfied by construction there, and the
// provider-specific key proves the database contract instead.
function buildAppAuthProviderReadinessResults({
  appAuthProviderMode,
  endpointSecurity,
  appSessionCookieContract,
  trustedAccountProviderContract,
  databaseAccountProviderContract,
  vercelEnvSyncEvidence,
  safety,
}) {
  const databaseAccounts = appAuthProviderMode === "database-accounts";
  return {
    [appAuthProviderReadinessResultKeys[0]]: resultStatus(
      acceptedAppAuthProviderModes.includes(appAuthProviderMode),
    ),
    [appAuthProviderReadinessResultKeys[1]]: resultStatus(
      databaseAccounts || endpointSecurity === "remote-https",
    ),
    [appAuthProviderReadinessResultKeys[2]]: resultStatus(
      isAppSessionCookieContractProved(appSessionCookieContract),
    ),
    [appAuthProviderReadinessResultKeys[3]]: resultStatus(
      vercelEnvSyncEvidence?.status === "matched" &&
        vercelEnvSyncEvidence.applyPreflight === "proved" &&
        vercelEnvSyncEvidence.releaseRunIdStatus === "matched" &&
        vercelEnvSyncEvidence.requiredAppAuthEnvStatus === "present",
    ),
    [appAuthProviderReadinessResultKeys[4]]: resultStatus(
      databaseAccounts
        ? isDatabaseAccountProviderContractProved(databaseAccountProviderContract)
        : isTrustedAccountProviderContractProved(trustedAccountProviderContract),
    ),
    [appAuthProviderReadinessResultKeys[5]]: resultStatus(
      isAppAuthReadinessSafetyProved(safety),
    ),
  };
}

function resultStatus(proved) {
  return proved ? "passed" : "blocked";
}

function isAppSessionCookieContractProved(contract) {
  return contract?.signingSecretStrength === "sufficient" &&
    Array.isArray(contract.cookiePair) &&
    contract.cookiePair.length === appSessionCookiePair.length &&
    contract.cookiePair.every((cookie, index) =>
      cookie.name === appSessionCookiePair[index].name &&
      cookie.purpose === appSessionCookiePair[index].purpose &&
      cookie.httpOnly === true &&
      cookie.sameSite === "Lax" &&
      cookie.secure === "required-in-production" &&
      cookie.path === "/" &&
      cookie.maxAge === "bounded-by-session-ttl" &&
      cookie.priority === "High" &&
      cookie.valueRedacted === true
    ) &&
    contract.valueRedacted === true;
}

function isTrustedAccountProviderContractProved(contract) {
  const responseUserShape = Array.isArray(contract?.responseUserShape)
    ? contract.responseUserShape
    : [];
  return contract?.providerKind === "trusted-account-provider" &&
    contract.endpoint === "configured" &&
    contract.bearerCredential === "configured" &&
    contract.accessTokenStrength === "sufficient" &&
    contract.requestMethod === "POST" &&
    ["account", "role", "displayName", "department"].every((field) =>
      responseUserShape.includes(field)
    ) &&
    contract.valueRedacted === true;
}

function isDatabaseAccountProviderContractProved(contract) {
  return contract?.providerKind === "database-accounts" &&
    contract.source === "uais-core-database" &&
    contract.accountTable === "uais_users" &&
    contract.coreDatabase === "configured" &&
    contract.externalProviderRequired === false &&
    // A seeded roster is part of the contract, not a nicety: flipping the
    // selector on against an empty uais_users passes every other check in the
    // chain and fails every single login.
    contract.rosterSeeding?.status === "seeded" &&
    contract.valueRedacted === true;
}

function isAppAuthReadinessSafetyProved(safety) {
  return safety?.valuesRedacted === true &&
    safety.secretsOmitted === true &&
    safety.passwordsOmitted === true &&
    safety.providerUrlsOmitted === true &&
    safety.responseBodiesOmitted === true &&
    safety.localPrivatePathsOmitted === true &&
    safety.liveRequiresApproval === true &&
    safety.remoteMutationRequiresApproval === true &&
    safety.cookieValuesOmitted === true &&
    safety.providerNetworkCallPerformed === false;
}

function evaluateVercelEnvSyncEvidence({
  evidence,
  appAuthProviderMode,
  releaseRunId,
  required,
}) {
  if (evidence === undefined) {
    return required
      ? {
          target: "missing",
          status: "missing",
          valueRedacted: true,
          releaseRunIdStatus: "missing",
        }
      : undefined;
  }
  if (!isRecord(evidence)) {
    return {
      target: "missing",
      status: "invalid",
      valueRedacted: true,
      releaseRunIdStatus: "missing",
    };
  }

  const target = typeof evidence.target === "string" ? evidence.target : "missing";
  const summary = {
    target,
    valueRedacted: true,
  };
  if (target !== "vercel-env-sync") {
    return {
      ...summary,
      status: "invalid-target",
      applyPreflight: "missing",
      releaseRunIdStatus: "missing",
    };
  }
  if (
    evidence.mode !== "apply" ||
    evidence.projectReadinessEvidenceStatus !== "ready" ||
    !hasProductionAndPreviewTargets(evidence.targets) ||
    !hasRedactedApplySummary(evidence)
  ) {
    return {
      ...summary,
      status: "not-applied",
      applyPreflight: "missing",
      releaseRunIdStatus: "missing",
    };
  }
  if (!hasPassedApplyPreflight(evidence)) {
    return {
      ...summary,
      status: "apply-preflight-missing",
      applyPreflight: "missing",
      releaseRunIdStatus: "missing",
    };
  }
  if (releaseRunId && evidence.releaseRunId !== releaseRunId) {
    return {
      ...summary,
      status: "release-run-id-mismatch",
      applyPreflight: "proved",
      releaseRunIdStatus: "mismatched",
    };
  }
  if (evidence.appAuthProviderMode !== appAuthProviderMode) {
    return {
      ...summary,
      status: "app-auth-provider-selector-mismatch",
      applyPreflight: "proved",
      releaseRunIdStatus: releaseRunId ? "matched" : "missing",
    };
  }

  const missingAppAuthEnvNames = readMissingAppAuthEnvNames(evidence, appAuthProviderMode);
  if (missingAppAuthEnvNames.length > 0) {
    return {
      ...summary,
      status: "app-auth-env-missing",
      applyPreflight: "proved",
      releaseRunIdStatus: releaseRunId ? "matched" : "missing",
      requiredAppAuthEnvStatus: "missing",
      missingAppAuthEnvNames,
    };
  }

  return {
    ...summary,
    status: "matched",
    applyPreflight: "proved",
    releaseRunIdStatus: releaseRunId ? "matched" : "missing",
    requiredAppAuthEnvStatus: "present",
  };
}

function readRequiredAppAuthEnvNames(appAuthProviderMode) {
  return [
    ...commonRequiredAppAuthEnvNames,
    ...(appAuthProviderRequiredEnvNames[appAuthProviderMode] ?? []),
  ];
}

function readMissingAppAuthEnvNames(evidence, appAuthProviderMode) {
  const entryNames = new Set();
  if (Array.isArray(evidence.entries)) {
    for (const entry of evidence.entries) {
      if (isRecord(entry) && typeof entry.name === "string") {
        entryNames.add(entry.name);
      }
      if (isRecord(entry) && typeof entry.key === "string") {
        entryNames.add(entry.key);
      }
    }
  }
  const envStatus = isRecord(evidence.envStatus) ? evidence.envStatus : {};
  const requiredEnv = isRecord(evidence.requiredEnv) ? evidence.requiredEnv : {};
  return readRequiredAppAuthEnvNames(appAuthProviderMode).filter((name) => {
    if (entryNames.has(name)) {
      return false;
    }
    if (envStatus[name] === "present" || requiredEnv[name] === "present") {
      return false;
    }
    return true;
  });
}

function readVercelEnvSyncBlockedReasons(evidenceStatus) {
  if (!evidenceStatus || evidenceStatus.status === "matched") {
    return [];
  }
  if (evidenceStatus.status === "app-auth-provider-selector-mismatch") {
    return ["vercel-env-sync-app-auth-provider-selector-mismatch"];
  }
  if (evidenceStatus.status === "apply-preflight-missing") {
    return ["vercel-env-sync-apply-preflight-not-proven"];
  }
  if (evidenceStatus.status === "release-run-id-mismatch") {
    return ["vercel-env-sync-release-run-id-mismatch"];
  }
  if (evidenceStatus.status === "app-auth-env-missing") {
    return ["vercel-env-sync-app-auth-env-missing"];
  }
  return [`vercel-env-sync-evidence-${evidenceStatus.status}`];
}

function readProviderBlockedReasons({
  appAuthProviderMode,
  environment,
  endpointSecurity,
  trustedAccountProviderContract,
  databaseAccountProviderContract,
  rosterSeedingRequired,
}) {
  if (appAuthProviderMode === "local-demo") {
    return environment === "production"
      ? ["app-auth-provider-local-demo-not-production"]
      : [];
  }
  if (appAuthProviderMode === "database-accounts") {
    return readDatabaseAccountProviderBlockedReasons({
      databaseAccountProviderContract,
      rosterSeedingRequired,
    });
  }
  if (appAuthProviderMode !== "trusted-account-provider") {
    return ["app-auth-provider-selector-not-proven"];
  }

  return [
    ...(environment === "production" && endpointSecurity !== "remote-https"
      ? ["app-auth-provider-endpoint-not-remote-https"]
      : []),
    ...(trustedAccountProviderContract?.endpoint === "configured"
      ? []
      : ["app-auth-provider-endpoint-missing"]),
    ...(trustedAccountProviderContract?.bearerCredential === "configured"
      ? []
      : ["app-auth-provider-token-missing"]),
    ...(trustedAccountProviderContract?.accessTokenStrength === "sufficient"
      ? []
      : ["app-auth-provider-token-not-sufficient"]),
  ];
}

function readDatabaseAccountProviderBlockedReasons({
  databaseAccountProviderContract,
  rosterSeedingRequired,
}) {
  const rosterStatus = databaseAccountProviderContract?.rosterSeeding?.status;
  return [
    ...(databaseAccountProviderContract?.coreDatabase === "configured"
      ? []
      : ["app-auth-database-accounts-core-database-missing"]),
    ...(rosterStatus === "empty" ? ["app-auth-database-accounts-roster-empty"] : []),
    // Unverified is a warning in a dry-run, which is already blocked for not
    // having been run live. A live run that could not read the roster has not
    // proved the thing it exists to prove.
    ...(rosterSeedingRequired && rosterStatus !== "seeded" && rosterStatus !== "empty"
      ? ["app-auth-database-accounts-roster-unverified"]
      : []),
  ];
}

// The one flag in the surface that can put the repo's public demo credentials
// on the live site. Nothing in the release chain refused it before, and it is
// set on production today.
function readProductionDemoAuthBlockedReasons({ environment, demoAuthFlag }) {
  return environment === "production" && demoAuthFlag.status === "set"
    ? ["app-auth-production-demo-auth-flag-set"]
    : [];
}

function classifyProductionDemoAuthFlag(value) {
  return {
    // The value is a mode name, not a secret, but only its presence is reported
    // so the shape of this report never depends on what was written there.
    status: hasValue(value) ? "set" : "unset",
    requiredForProduction: "unset",
    valueRedacted: true,
  };
}

function readAppAuthProviderWarnings({ appAuthProviderMode, rosterSeeding }) {
  if (appAuthProviderMode !== "database-accounts") {
    return [];
  }
  return rosterSeeding?.status === "unverified" ? ["unverified: roster seeding"] : [];
}

function readSessionCookieBlockedReasons(appSessionCookieContract) {
  return appSessionCookieContract.signingSecretStrength === "sufficient"
    ? []
    : ["app-auth-session-signing-secret-not-sufficient"];
}

function readCoreDatabaseUrl(env) {
  for (const name of coreDatabaseUrlEnvNames) {
    const value = env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

// Counts what the login route would actually accept. The predicate mirrors
// findUaisAppAccountByIdentifier in src/lib/server/uais-app-account-store.ts:
// `status = 'active'` is the disable switch and `password_hash IS NOT NULL`
// excludes the 'invited' rows a roster import leaves behind - a table full of
// those looks seeded and cannot log anyone in.
//
// Reports counts only. No account, address, name or hash is read, so the result
// is safe to paste into a release report.
async function readAccountRosterSeeding({ databaseUrl, probe }) {
  if (!databaseUrl) {
    return {
      status: "unverified",
      reason: "core-database-url-missing",
      valueRedacted: true,
    };
  }
  if (!probe) {
    return {
      status: "unverified",
      reason: "roster-probe-not-requested",
      valueRedacted: true,
    };
  }

  let sql;
  try {
    const { default: postgres } = await import("postgres");
    sql = postgres(databaseUrl, { max: 1, prepare: false });
    const [row] = await sql`
      SELECT
        count(*) FILTER (
          WHERE status = 'active' AND password_hash IS NOT NULL
        ) AS active_accounts,
        count(*) FILTER (
          WHERE status = 'active' AND password_hash IS NOT NULL AND role = 'teacher'
        ) AS active_teachers
      FROM uais_users
    `;
    const activeAccounts = Number(row?.active_accounts ?? 0);
    const activeTeachers = Number(row?.active_teachers ?? 0);
    return {
      // A cohort with no teacher can sign in and then 401 on every write, so
      // both counts have to be non-zero before this reads as seeded.
      status: activeAccounts > 0 && activeTeachers > 0 ? "seeded" : "empty",
      activeAccounts,
      activeTeachers,
      accountTable: "uais_users",
      valueRedacted: true,
    };
  } catch {
    // The failure mode is reportable; the DSN and the driver's message are not.
    return {
      status: "unverified",
      reason: "core-database-unreachable",
      valueRedacted: true,
    };
  } finally {
    await sql?.end({ timeout: 5 }).catch(() => {});
  }
}

function normalizeAppAuthProvider(value) {
  if (!hasValue(value)) {
    return "local-demo";
  }
  const provider = value.trim();
  if (provider === "local-demo" || acceptedAppAuthProviderModes.includes(provider)) {
    return provider;
  }
  return "unsupported";
}

function classifySecretStrength(value) {
  if (!hasValue(value)) {
    return "missing";
  }
  return value.trim().length >= minimumProductionSecretLength ? "sufficient" : "weak";
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
  if (
    octets.length === 4 &&
    octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
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

function hasProductionAndPreviewTargets(targets) {
  return (
    Array.isArray(targets) &&
    targets.includes("production") &&
    targets.includes("preview")
  );
}

function hasRedactedApplySummary(evidence) {
  const summary = evidence.applySummary;
  const appliedByTarget = summary?.appliedByTarget;
  return (
    isRecord(summary) &&
    summary.status === "applied" &&
    Number.isInteger(summary.appliedActions) &&
    summary.appliedActions > 0 &&
    isRecord(appliedByTarget) &&
    Number.isInteger(appliedByTarget.production) &&
    appliedByTarget.production > 0 &&
    Number.isInteger(appliedByTarget.preview) &&
    appliedByTarget.preview > 0 &&
    Number.isInteger(summary.localOnlyEntriesSkipped) &&
    summary.localOnlyEntriesSkipped >= 0 &&
    summary.valuesRedacted === true &&
    (summary.cliOutputOmitted === true || summary.apiOutputOmitted === true)
  );
}

function hasPassedApplyPreflight(evidence) {
  const preflight = evidence.applyPreflight;
  return (
    isRecord(preflight) &&
    preflight.status === "passed" &&
    Array.isArray(preflight.blockedReasons) &&
    preflight.blockedReasons.length === 0 &&
    preflight.valuesRedacted === true &&
    preflight.cliSafeToInvoke === true
  );
}

function parseArgs(args) {
  const options = {
    live: false,
    approved: false,
    environment: "unspecified",
    envFile: undefined,
    provider: undefined,
    providerUrl: undefined,
    providerToken: undefined,
    sessionSecret: undefined,
    releaseRunId: undefined,
    vercelEnvSync: undefined,
    rosterProbe: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      options.live = false;
    } else if (arg === "--live") {
      options.live = true;
    } else if (arg === "--approved") {
      options.approved = true;
    } else if (arg === "--roster-probe") {
      options.rosterProbe = true;
    } else if (arg === "--environment") {
      options.environment = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--env-file") {
      options.envFile = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--provider") {
      options.provider = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--provider-url") {
      options.providerUrl = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--provider-token") {
      options.providerToken = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--session-secret") {
      options.sessionSecret = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--release-run-id") {
      options.releaseRunId = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--vercel-env-sync") {
      options.vercelEnvSync = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node -- scripts/app-auth-provider-readiness.mjs [--dry-run] [--live --approved] [--environment production|preview|local-production|unspecified] [--env-file PATH] [--vercel-env-sync PATH] [--roster-probe]",
          "",
          "Checks redacted UAIS app auth provider readiness without printing secrets, provider URLs, passwords, cookie values, or local private paths.",
          "UAIS_APP_AUTH_PROVIDER=database-accounts needs UAIS_CORE_DATABASE_URL and a seeded uais_users roster; trusted-account-provider needs the provider URL and token instead.",
          "--roster-probe counts active uais_users rows in a dry-run; a live run always probes. Counts only - no account, address or hash is read.",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function readJsonEvidence(path) {
  if (!hasValue(path)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { status: "invalid" };
  }
}

function readEnvFile(path) {
  if (!hasValue(path)) {
    return {};
  }
  const entries = {};
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (key) {
      entries[key] = stripOptionalQuotes(value);
    }
  }
  return entries;
}

function stripOptionalQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function readArgValue(args, index, name) {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function normalizeReleaseRunId(value) {
  if (!hasValue(value)) {
    return undefined;
  }
  const releaseRunId = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(releaseRunId)) {
    throw new Error("--release-run-id must be a non-secret release identifier.");
  }
  return releaseRunId;
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
