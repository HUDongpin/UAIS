#!/usr/bin/env node

import { readFileSync } from "node:fs";

const minimumProductionSecretLength = 32;
const requiredAppAuthEnvNames = [
  "UAIS_APP_SESSION_SIGNING_SECRET",
  "UAIS_APP_AUTH_PROVIDER",
  "UAIS_APP_AUTH_PROVIDER_URL",
  "UAIS_APP_AUTH_PROVIDER_TOKEN",
];
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
  const plan = buildAppAuthProviderReadinessPlan({
    mode,
    environment: options.environment,
    appAuthProviderMode: providerMode,
    sessionSecret: options.sessionSecret || env.UAIS_APP_SESSION_SIGNING_SECRET,
    endpoint,
    accessToken,
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
  releaseRunId,
  vercelEnvSync,
}) {
  const endpointSecurity = classifyEndpointSecurity(endpoint);
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
    ...readVercelEnvSyncBlockedReasons(vercelEnvSyncEvidence),
    ...readProviderBlockedReasons({
      appAuthProviderMode,
      environment,
      endpointSecurity,
      trustedAccountProviderContract,
    }),
    ...readSessionCookieBlockedReasons(appSessionCookieContract),
    ...(mode === "dry-run" ? ["app-auth-provider-live-readiness-not-run"] : []),
  ];
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
    vercelEnvSyncEvidence,
    safety,
  });

  return {
    target: "app-auth-provider-readiness",
    mode,
    environment,
    network: "disabled",
    status: blockedReasons.length === 0 ? "ready" : "blocked",
    ...(releaseRunId ? { releaseRunId } : {}),
    responsibleSession: "S12/S19/S22",
    appAuthProviderMode,
    endpointSecurity,
    appSessionCookieContract,
    ...(trustedAccountProviderContract ? { trustedAccountProviderContract } : {}),
    ...(vercelEnvSyncEvidence ? { vercelEnvSyncEvidence } : {}),
    results,
    blockedReasons,
    safety,
  };
}

function buildAppAuthProviderReadinessResults({
  appAuthProviderMode,
  endpointSecurity,
  appSessionCookieContract,
  trustedAccountProviderContract,
  vercelEnvSyncEvidence,
  safety,
}) {
  return {
    [appAuthProviderReadinessResultKeys[0]]: resultStatus(
      appAuthProviderMode === "trusted-account-provider",
    ),
    [appAuthProviderReadinessResultKeys[1]]: resultStatus(endpointSecurity === "remote-https"),
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
      isTrustedAccountProviderContractProved(trustedAccountProviderContract),
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

  const missingAppAuthEnvNames = readMissingAppAuthEnvNames(evidence);
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

function readMissingAppAuthEnvNames(evidence) {
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
  return requiredAppAuthEnvNames.filter((name) => {
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
}) {
  if (appAuthProviderMode === "local-demo") {
    return environment === "production"
      ? ["app-auth-provider-local-demo-not-production"]
      : [];
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

function readSessionCookieBlockedReasons(appSessionCookieContract) {
  return appSessionCookieContract.signingSecretStrength === "sufficient"
    ? []
    : ["app-auth-session-signing-secret-not-sufficient"];
}

function normalizeAppAuthProvider(value) {
  if (!hasValue(value)) {
    return "local-demo";
  }
  const provider = value.trim();
  if (provider === "local-demo" || provider === "trusted-account-provider") {
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
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      options.live = false;
    } else if (arg === "--live") {
      options.live = true;
    } else if (arg === "--approved") {
      options.approved = true;
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
          "Usage: node -- scripts/app-auth-provider-readiness.mjs [--dry-run] [--live --approved] [--environment production|preview|local-production|unspecified] [--env-file PATH] [--vercel-env-sync PATH]",
          "",
          "Checks redacted UAIS app auth provider readiness without printing secrets, provider URLs, passwords, cookie values, or local private paths.",
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
