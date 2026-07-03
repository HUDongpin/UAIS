#!/usr/bin/env node

import { readFileSync } from "node:fs";

const provedEvidence = [
  "vercel-env-sync-evidence-with-app-auth-env-present",
  "app-auth-provider-readiness-production-live-ready",
  "same-release-run-id-bound-to-app-auth-readiness",
];

const requiredResultKeys = [
  "appAuthProviderModeTrusted",
  "appAuthProviderEndpointRemoteHttps",
  "appAuthSessionCookieContract",
  "appAuthProviderVercelEnvSync",
  "trustedAccountProviderContract",
  "appAuthReadinessSafety",
];

function main() {
  const args = parseArgs(process.argv.slice(2));
  const appAuthPreflight = readJsonArg(args, "app-auth-preflight");
  const appAuthVercelEnvSyncEvidenceGate = readJsonArg(
    args,
    "app-auth-vercel-env-sync-evidence-gate",
  );
  const appAuthProviderReadiness =
    typeof args["app-auth-provider-readiness"] === "string"
      ? readJsonArg(args, "app-auth-provider-readiness")
      : undefined;
  const report = buildReport({
    appAuthPreflight,
    appAuthVercelEnvSyncEvidenceGate,
    appAuthProviderReadiness,
  });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(report));
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function buildReport({
  appAuthPreflight,
  appAuthVercelEnvSyncEvidenceGate,
  appAuthProviderReadiness,
}) {
  const approvedProviderMode = readString(appAuthPreflight.approvedProviderMode, "");
  const approvedServerOnlyEnvSourceLabel = readString(
    appAuthPreflight.approvedServerOnlyEnvSourceLabel,
    "",
  );
  const approvedReleaseRunIdLabel = readString(appAuthPreflight.approvedReleaseRunIdLabel, "");
  const envSyncEvidenceAccepted =
    appAuthVercelEnvSyncEvidenceGate.summary?.appAuthReadinessMayProceed === true &&
    appAuthVercelEnvSyncEvidenceGate.summary?.applyEvidenceAccepted === true;
  const readinessEvidenceStatus = evaluateReadinessEvidence({
    evidence: appAuthProviderReadiness,
    approvedProviderMode,
    approvedReleaseRunIdLabel,
  });
  const readinessEvidenceAccepted = readinessEvidenceStatus.status === "live-ready";
  const releaseRunBound = readinessEvidenceStatus.releaseRunIdStatus === "matched";
  const appAuthProductionEvidenceCleared =
    envSyncEvidenceAccepted && readinessEvidenceAccepted && releaseRunBound;
  const status = appAuthProductionEvidenceCleared
    ? "app-auth-production-evidence-gate-cleared"
    : !envSyncEvidenceAccepted
      ? "app-auth-production-evidence-gate-waiting-for-env-sync-evidence"
    : "app-auth-production-evidence-gate-awaiting-readiness-evidence";
  const blockedReasons = buildBlockedReasons({
    envSyncEvidenceAccepted,
    readinessEvidenceStatus,
  });
  const upstreamEnvSyncEvidenceRequired = !envSyncEvidenceAccepted;
  const upstreamOperatorInputRequired =
    upstreamEnvSyncEvidenceRequired &&
    appAuthVercelEnvSyncEvidenceGate.summary?.operatorInputRequired === true;
  const upstreamBlockingEvidence = upstreamEnvSyncEvidenceRequired
    ? {
        id: "upstream-app-auth-vercel-env-sync-evidence-gate",
        label: "app-auth-vercel-env-sync-evidence-gate",
        reason:
          "App-auth production evidence must wait for accepted app-auth Vercel env-sync evidence before provider readiness evidence can be requested.",
        valuesForbidden: true,
        upstreamStatus: readString(appAuthVercelEnvSyncEvidenceGate.status, "unknown"),
        safeNextAction: readString(appAuthVercelEnvSyncEvidenceGate.safeNextAction, ""),
        upstreamBlockedReasons: readStringArray(appAuthVercelEnvSyncEvidenceGate.blockedReasons),
        upstreamOperatorInputRequired,
        upstreamMissingEvidence: readStringArray(
          appAuthVercelEnvSyncEvidenceGate.upstreamBlockingEvidence?.missingEvidence,
        ),
        upstreamOperatorInputPacket: readSafeOperatorInputPacket(
          appAuthVercelEnvSyncEvidenceGate.upstreamBlockingEvidence?.operatorInputPacket,
        ),
        upstreamSafeCommandTemplates: readSafeCommandTemplates(
          appAuthVercelEnvSyncEvidenceGate.upstreamBlockingEvidence?.safeCommandTemplates,
        ),
      }
    : null;

  return {
    target: "app-auth-production-evidence-gate",
    status,
    releaseReady: false,
    responsibleSession: "S19/S22",
    approvedProviderMode,
    approvedServerOnlyEnvSourceLabel,
    approvedReleaseRunIdLabel,
    summary: {
      ownerInputRequired: false,
      operatorInputRequired: upstreamOperatorInputRequired,
      blockingInputRequired: upstreamOperatorInputRequired,
      upstreamEnvSyncEvidenceRequired,
      envSyncEvidenceAccepted,
      readinessEvidenceProvided: appAuthProviderReadiness !== undefined,
      readinessEvidenceAccepted,
      releaseRunBound,
      appAuthProductionEvidenceCleared,
      releaseReady: false,
    },
    readinessEvidenceStatus,
    upstreamBlockingEvidence,
    provedEvidence: appAuthProductionEvidenceCleared ? provedEvidence : [],
    blockedReasons,
    safeNextAction: appAuthProductionEvidenceCleared
      ? "advance-teacher-auth-production-evidence-preflight"
      : envSyncEvidenceAccepted
        ? "produce-app-auth-provider-readiness-evidence"
        : readString(
            upstreamBlockingEvidence?.safeNextAction,
            "wait-for-app-auth-vercel-env-sync-evidence-before-readiness",
          ),
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      credentialValuesOmitted: true,
      cookieValuesOmitted: true,
      responseBodiesOmitted: true,
      envFileRead: false,
      vercelApiCalled: false,
      providerNetworkCallPerformed: false,
      noEnvApplyPerformed: true,
      noDeploymentMutationPerformed: true,
      noLiveSmokePerformed: true,
      noReleaseRunBindingPerformed: true,
    },
  };
}

function evaluateReadinessEvidence({ evidence, approvedProviderMode, approvedReleaseRunIdLabel }) {
  if (evidence === undefined) {
    return {
      target: "missing",
      status: "missing",
      mode: "missing",
      environment: "missing",
      releaseRunIdStatus: "missing",
      valueRedacted: true,
    };
  }
  const base = {
    target: readString(evidence.target, "missing"),
    mode: readString(evidence.mode, "missing"),
    environment: readString(evidence.environment, "missing"),
    releaseRunIdStatus: evidence.releaseRunId === approvedReleaseRunIdLabel ? "matched" : "missing",
    valueRedacted: true,
  };
  if (base.target !== "app-auth-provider-readiness") {
    return {
      ...base,
      status: "invalid-target",
    };
  }
  if (
    evidence.mode !== "live" ||
    evidence.environment !== "production" ||
    evidence.status !== "ready"
  ) {
    return {
      ...base,
      status: "not-live-ready",
    };
  }
  if (evidence.releaseRunId !== approvedReleaseRunIdLabel) {
    return {
      ...base,
      releaseRunIdStatus: "mismatched",
      status: "release-run-id-mismatch",
    };
  }
  if (evidence.appAuthProviderMode !== approvedProviderMode) {
    return {
      ...base,
      status: "provider-mode-mismatch",
    };
  }
  if (!hasPassedResults(evidence.results)) {
    return {
      ...base,
      status: "result-proof-missing",
    };
  }
  if (!hasReadinessSafety(evidence.safety)) {
    return {
      ...base,
      status: "redaction-safety-missing",
    };
  }
  return {
    ...base,
    status: "live-ready",
  };
}

function hasPassedResults(results) {
  if (!isRecord(results)) {
    return false;
  }
  return requiredResultKeys.every((key) => results[key] === "passed");
}

function hasReadinessSafety(safety) {
  return (
    isRecord(safety) &&
    safety.valuesRedacted === true &&
    safety.secretsOmitted === true &&
    safety.passwordsOmitted === true &&
    safety.providerUrlsOmitted === true &&
    safety.responseBodiesOmitted === true &&
    safety.localPrivatePathsOmitted === true &&
    safety.liveRequiresApproval === true &&
    safety.remoteMutationRequiresApproval === true &&
    safety.cookieValuesOmitted === true &&
    safety.providerNetworkCallPerformed === false
  );
}

function buildBlockedReasons({ envSyncEvidenceAccepted, readinessEvidenceStatus }) {
  const reasons = [];
  if (!envSyncEvidenceAccepted) {
    reasons.push("app-auth-vercel-env-sync-evidence-not-accepted");
    return reasons;
  }
  if (readinessEvidenceStatus.status === "missing") {
    reasons.push("app-auth-provider-readiness-evidence-missing");
  } else if (readinessEvidenceStatus.status !== "live-ready") {
    reasons.push(`app-auth-provider-readiness-${readinessEvidenceStatus.status}`);
  }
  return reasons;
}

function renderMarkdown(report) {
  const lines = [
    "# UAIS App Auth Production Evidence Gate",
    "",
    `Status: \`${report.status}\``,
    `Env source label: \`${report.approvedServerOnlyEnvSourceLabel}\``,
    `Provider mode: \`${report.approvedProviderMode}\``,
    `Operator input required: \`${report.summary.operatorInputRequired}\``,
    `Safe next action: \`${report.safeNextAction}\``,
    `Upstream env-sync evidence required: \`${report.summary.upstreamEnvSyncEvidenceRequired}\``,
    `App-auth evidence cleared: \`${report.summary.appAuthProductionEvidenceCleared}\``,
    `Release ready: \`${report.summary.releaseReady}\``,
    "",
    "## Readiness Evidence",
    "",
    `- Target: \`${report.readinessEvidenceStatus.target}\``,
    `- Status: \`${report.readinessEvidenceStatus.status}\``,
    `- Mode: \`${report.readinessEvidenceStatus.mode}\``,
    `- Environment: \`${report.readinessEvidenceStatus.environment}\``,
    `- Release run: \`${report.readinessEvidenceStatus.releaseRunIdStatus}\``,
    "",
    "## Upstream Blocking Evidence",
    "",
    ...(report.upstreamBlockingEvidence
      ? [
          `- \`${report.upstreamBlockingEvidence.id}\`: \`${report.upstreamBlockingEvidence.label}\``,
        ]
      : ["- `none-recorded`"]),
    ...(report.upstreamBlockingEvidence &&
    Object.keys(report.upstreamBlockingEvidence.upstreamSafeCommandTemplates ?? {}).length > 0
      ? [
          "",
          "## Upstream Safe Operator Command Templates",
          "",
          ...Object.entries(report.upstreamBlockingEvidence.upstreamSafeCommandTemplates).map(
            ([name, command]) => `- \`${name}\`: \`${command}\``,
          ),
        ]
      : []),
    "",
    "## Blocked Reasons",
    "",
    ...(report.blockedReasons.length > 0
      ? report.blockedReasons.map((reason) => `- \`${reason}\``)
      : ["- None"]),
  ];

  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function readJsonArg(args, key) {
  const path = args[key];
  if (typeof path !== "string" || path.length === 0) {
    throw new Error(`Missing required --${key}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function readStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function readSafeCommandTemplates(value) {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      ([name, command]) =>
        /^[A-Za-z0-9._:-]+$/.test(name) &&
        typeof command === "string" &&
        !/\/Users\/|https?:\/\/|(?:SECRET|TOKEN|KEY|PASSWORD|COOKIE|CREDENTIAL)\s*=/i.test(
          command,
        ),
    ),
  );
}

function readSafeOperatorInputPacket(value) {
  if (!isRecord(value)) {
    return {};
  }
  return {
    target: readString(value.target, "unknown"),
    status: readString(value.status, "unknown"),
    firstRequiredInputId: readString(value.firstRequiredInputId, null),
    approvedServerOnlyEnvSourceLabel: readString(value.approvedServerOnlyEnvSourceLabel, ""),
    acceptedInputModes: readStringArray(value.acceptedInputModes),
    requiredServerOnlyEnvNames: readStringArray(value.requiredServerOnlyEnvNames),
    nextSafeAction: readString(value.nextSafeAction, ""),
    nextSafeCommandTemplateKey: readString(value.nextSafeCommandTemplateKey, ""),
    ...(readString(value.preferredInputMode, "").length > 0
      ? { preferredInputMode: readString(value.preferredInputMode, "") }
      : {}),
    ...(readString(value.safeInputInstruction, "").length > 0
      ? { safeInputInstruction: readString(value.safeInputInstruction, "") }
      : {}),
    ...(value.approvedSourceLabelIsNotEvidence === true
      ? { approvedSourceLabelIsNotEvidence: true }
      : {}),
    valuesForbidden: value.valuesForbidden === true,
  };
}

main();
