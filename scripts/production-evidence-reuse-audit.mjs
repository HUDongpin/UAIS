#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { basename } from "node:path";

const defaultAppAuthEnvNames = [
  "UAIS_APP_SESSION_SIGNING_SECRET",
  "UAIS_APP_AUTH_PROVIDER",
  "UAIS_APP_AUTH_PROVIDER_URL",
  "UAIS_APP_AUTH_PROVIDER_TOKEN",
];

const readinessResultKeys = [
  "appAuthProviderModeTrusted",
  "appAuthProviderEndpointRemoteHttps",
  "appAuthSessionCookieContract",
  "appAuthProviderVercelEnvSync",
  "trustedAccountProviderContract",
  "appAuthReadinessSafety",
];

function main() {
  const args = parseArgs(process.argv.slice(2));
  const appAuthEnvSourceIntake = readJsonArg(args, "app-auth-env-source-intake");
  const appAuthPreflight = readJsonArg(args, "app-auth-preflight");
  const appAuthVercelEnvSyncEvidenceGate = readJsonArg(
    args,
    "app-auth-vercel-env-sync-evidence-gate",
  );
  const appAuthProductionEvidenceGate = readJsonArg(args, "app-auth-production-evidence-gate");
  const candidatePaths = readStringArray(args.candidate);
  const candidates = candidatePaths.map((filePath) => ({
    filePath,
    evidence: readJsonFile(filePath),
  }));
  const report = buildReport({
    appAuthEnvSourceIntake,
    appAuthPreflight,
    appAuthVercelEnvSyncEvidenceGate,
    appAuthProductionEvidenceGate,
    candidates,
  });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(report));
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function buildReport({
  appAuthEnvSourceIntake,
  appAuthPreflight,
  appAuthVercelEnvSyncEvidenceGate,
  appAuthProductionEvidenceGate,
  candidates,
}) {
  const approvedReleaseRunIdLabel = readString(
    appAuthPreflight.approvedReleaseRunIdLabel,
    readString(appAuthEnvSourceIntake.approvedReleaseRunIdLabel, ""),
  );
  const approvedProviderMode = readString(
    appAuthPreflight.approvedProviderMode,
    readString(appAuthEnvSourceIntake.approvedProviderMode, ""),
  );
  const requiredAppAuthEnvNames = readRequiredEnvNames(appAuthPreflight);
  const evaluatedCandidates = candidates.map(({ filePath, evidence }) =>
    evaluateCandidate({
      filePath,
      evidence,
      approvedReleaseRunIdLabel,
      approvedProviderMode,
      requiredAppAuthEnvNames,
    }),
  );
  const reusableCandidateCount = evaluatedCandidates.filter((candidate) => candidate.reusable).length;
  const rejectedCandidateCount = evaluatedCandidates.length - reusableCandidateCount;
  const currentFirstBlocker = readCurrentFirstBlocker({
    appAuthEnvSourceIntake,
    appAuthVercelEnvSyncEvidenceGate,
    appAuthProductionEvidenceGate,
  });
  const operatorInputPacket =
    currentFirstBlocker === "app-auth-approved-source-path-missing"
      ? readOperatorInputPacket(appAuthEnvSourceIntake)
      : null;

  return {
    target: "production-evidence-reuse-audit",
    status:
      reusableCandidateCount > 0 && currentFirstBlocker === "none"
        ? "production-evidence-reuse-audit-reusable-candidates-found"
        : "production-evidence-reuse-audit-blocked",
    releaseReady: false,
    responsibleSession: "S22/S19",
    approvedReleaseRunIdLabel,
    approvedProviderMode,
    currentGateStatus: {
      appAuthEnvSourceIntake: readString(appAuthEnvSourceIntake.status, "unknown"),
      appAuthVercelEnvSyncEvidenceGate: readString(
        appAuthVercelEnvSyncEvidenceGate.status,
        "unknown",
      ),
      appAuthProductionEvidenceGate: readString(appAuthProductionEvidenceGate.status, "unknown"),
    },
    summary: {
      candidateCount: evaluatedCandidates.length,
      reusableCandidateCount,
      rejectedCandidateCount,
      currentFirstBlocker,
      releaseReady: false,
    },
    candidates: evaluatedCandidates,
    operatorInputPacket,
    safeNextAction:
      currentFirstBlocker === "app-auth-approved-source-path-missing"
        ? "provide-approved-app-auth-env-source-path-to-s19"
        : reusableCandidateCount > 0
          ? "rerun-current-app-auth-gates-with-reusable-candidate-evidence"
          : "produce-current-release-run-bound-app-auth-production-evidence",
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      credentialValuesOmitted: true,
      cookieValuesOmitted: true,
      responseBodiesOmitted: true,
      envFileRead: false,
      vercelApiCalled: false,
      noEnvApplyPerformed: true,
      noDeploymentMutationPerformed: true,
      noLiveSmokePerformed: true,
      noReleaseRunBindingPerformed: true,
      evidenceFilesReadOnly: true,
    },
  };
}

function readOperatorInputPacket(value) {
  if (!isRecord(value?.operatorInputPacket)) {
    return null;
  }
  const packet = value.operatorInputPacket;
  return {
    target: readString(packet.target, ""),
    status: readString(packet.status, ""),
    firstRequiredInputId: readString(packet.firstRequiredInputId, ""),
    approvedServerOnlyEnvSourceLabel: readString(packet.approvedServerOnlyEnvSourceLabel, ""),
    acceptedInputModes: readStringArray(packet.acceptedInputModes),
    requiredServerOnlyEnvNames: readStringArray(packet.requiredServerOnlyEnvNames),
    nextSafeAction: readString(packet.nextSafeAction, ""),
    nextSafeCommandTemplateKey: readString(packet.nextSafeCommandTemplateKey, ""),
    ...(readString(packet.preferredInputMode, "").length > 0
      ? { preferredInputMode: readString(packet.preferredInputMode, "") }
      : {}),
    ...(readString(packet.safeInputInstruction, "").length > 0
      ? { safeInputInstruction: readString(packet.safeInputInstruction, "") }
      : {}),
    ...(packet.approvedSourceLabelIsNotEvidence === true
      ? { approvedSourceLabelIsNotEvidence: true }
      : {}),
    valuesForbidden: packet.valuesForbidden === true,
  };
}

function evaluateCandidate({
  filePath,
  evidence,
  approvedReleaseRunIdLabel,
  approvedProviderMode,
  requiredAppAuthEnvNames,
}) {
  const target = readString(evidence.target, "missing");
  if (target === "vercel-env-sync") {
    return evaluateVercelEnvSync({
      filePath,
      evidence,
      approvedReleaseRunIdLabel,
      approvedProviderMode,
      requiredAppAuthEnvNames,
    });
  }
  if (target === "app-auth-provider-readiness") {
    return evaluateAppAuthProviderReadiness({
      filePath,
      evidence,
      approvedReleaseRunIdLabel,
      approvedProviderMode,
    });
  }
  return {
    fileName: basename(filePath),
    target,
    reusable: false,
    status: readString(evidence.status, "missing"),
    mode: readString(evidence.mode, "missing"),
    releaseRunIdStatus: releaseRunIdStatus(evidence.releaseRunId, approvedReleaseRunIdLabel),
    rejectionReasons: ["unsupported-target"],
  };
}

function evaluateVercelEnvSync({
  filePath,
  evidence,
  approvedReleaseRunIdLabel,
  approvedProviderMode,
  requiredAppAuthEnvNames,
}) {
  const rejectionReasons = [];
  const missingRequiredEnvNames = readMissingEnvNames(evidence, requiredAppAuthEnvNames);

  if (evidence.mode !== "apply" || evidence.status !== "applied") {
    rejectionReasons.push("vercel-env-sync-not-applied");
  }
  if (releaseRunIdStatus(evidence.releaseRunId, approvedReleaseRunIdLabel) !== "matched") {
    rejectionReasons.push("release-run-id-mismatch");
  }
  if (readString(evidence.appAuthProviderMode, "") !== approvedProviderMode) {
    rejectionReasons.push("provider-mode-mismatch");
  }
  if (missingRequiredEnvNames.length > 0) {
    rejectionReasons.push("required-app-auth-env-missing");
  }
  if (!hasRedactedApplySummary(evidence)) {
    rejectionReasons.push("redacted-apply-summary-missing");
  }

  return {
    fileName: basename(filePath),
    target: "vercel-env-sync",
    reusable: rejectionReasons.length === 0,
    status: readString(evidence.status, "missing"),
    mode: readString(evidence.mode, "missing"),
    releaseRunIdStatus: releaseRunIdStatus(evidence.releaseRunId, approvedReleaseRunIdLabel),
    providerModeStatus:
      readString(evidence.appAuthProviderMode, "") === approvedProviderMode ? "matched" : "mismatched",
    requiredEnvStatus: missingRequiredEnvNames.length === 0 ? "present" : "missing",
    missingRequiredEnvNames,
    rejectionReasons,
  };
}

function evaluateAppAuthProviderReadiness({
  filePath,
  evidence,
  approvedReleaseRunIdLabel,
  approvedProviderMode,
}) {
  const rejectionReasons = [];

  if (evidence.mode !== "live") {
    rejectionReasons.push("mode-not-live");
  }
  if (evidence.environment !== "production") {
    rejectionReasons.push("environment-not-production");
  }
  if (evidence.status !== "ready") {
    rejectionReasons.push("status-not-ready");
  }
  if (releaseRunIdStatus(evidence.releaseRunId, approvedReleaseRunIdLabel) !== "matched") {
    rejectionReasons.push("release-run-id-mismatch");
  }
  if (readString(evidence.appAuthProviderMode, "") !== approvedProviderMode) {
    rejectionReasons.push("provider-mode-mismatch");
  }
  if (!hasPassedReadinessResults(evidence.results)) {
    rejectionReasons.push("readiness-result-proof-missing");
  }
  if (!hasReadinessSafety(evidence.safety)) {
    rejectionReasons.push("readiness-redaction-safety-incomplete");
  }

  return {
    fileName: basename(filePath),
    target: "app-auth-provider-readiness",
    reusable: rejectionReasons.length === 0,
    status: readString(evidence.status, "missing"),
    mode: readString(evidence.mode, "missing"),
    environment: readString(evidence.environment, "missing"),
    releaseRunIdStatus: releaseRunIdStatus(evidence.releaseRunId, approvedReleaseRunIdLabel),
    providerModeStatus:
      readString(evidence.appAuthProviderMode, "") === approvedProviderMode ? "matched" : "mismatched",
    rejectionReasons,
  };
}

function readCurrentFirstBlocker({
  appAuthEnvSourceIntake,
  appAuthVercelEnvSyncEvidenceGate,
  appAuthProductionEvidenceGate,
}) {
  if (appAuthEnvSourceIntake.summary?.readyForVercelEnvSyncDryRun !== true) {
    return "app-auth-approved-source-path-missing";
  }
  if (appAuthVercelEnvSyncEvidenceGate.summary?.applyEvidenceAccepted !== true) {
    return "app-auth-vercel-env-sync-evidence-not-accepted";
  }
  if (appAuthProductionEvidenceGate.summary?.appAuthProductionEvidenceCleared !== true) {
    return "app-auth-production-evidence-not-cleared";
  }
  return "none";
}

function readMissingEnvNames(evidence, requiredEnvNames) {
  const entryStatusByName = new Map();
  if (Array.isArray(evidence.entries)) {
    for (const entry of evidence.entries) {
      if (!isRecord(entry)) {
        continue;
      }
      const name = readString(entry.name, readString(entry.key, ""));
      if (name.length > 0) {
        entryStatusByName.set(name, readString(entry.status, "missing"));
      }
    }
  }
  const envStatus = isRecord(evidence.envStatus) ? evidence.envStatus : {};
  const requiredEnv = isRecord(evidence.requiredEnv) ? evidence.requiredEnv : {};

  return requiredEnvNames.filter((name) => {
    if (entryStatusByName.get(name) === "present") {
      return false;
    }
    if (envStatus[name] === "present" || requiredEnv[name] === "present") {
      return false;
    }
    return true;
  });
}

function readRequiredEnvNames(appAuthPreflight) {
  const names = readStringArray(appAuthPreflight.requiredServerOnlyEnvNames);
  return names.length > 0 ? names : defaultAppAuthEnvNames;
}

function hasRedactedApplySummary(evidence) {
  const summary = evidence.applySummary;
  return (
    isRecord(summary) &&
    summary.status === "applied" &&
    Number.isInteger(summary.appliedActions) &&
    summary.appliedActions > 0 &&
    summary.valuesRedacted === true &&
    (summary.cliOutputOmitted === true || summary.apiOutputOmitted === true)
  );
}

function hasPassedReadinessResults(results) {
  if (!isRecord(results)) {
    return false;
  }
  return readinessResultKeys.every((key) => results[key] === "passed");
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

function releaseRunIdStatus(releaseRunId, approvedReleaseRunIdLabel) {
  if (typeof releaseRunId !== "string" || releaseRunId.length === 0) {
    return "missing";
  }
  return releaseRunId === approvedReleaseRunIdLabel ? "matched" : "mismatched";
}

function renderMarkdown(report) {
  const lines = [
    "# UAIS Production Evidence Reuse Audit",
    "",
    `Status: \`${report.status}\``,
    `Provider mode: \`${report.approvedProviderMode}\``,
    `Release run label: \`${report.approvedReleaseRunIdLabel}\``,
    `Current first blocker: \`${report.summary.currentFirstBlocker}\``,
    `Reusable candidates: \`${report.summary.reusableCandidateCount} / ${report.summary.candidateCount}\``,
    `Release ready: \`${report.summary.releaseReady}\``,
    "",
    "## Current Gate Status",
    "",
    `- App auth env-source intake: \`${report.currentGateStatus.appAuthEnvSourceIntake}\``,
    `- App auth Vercel env-sync gate: \`${report.currentGateStatus.appAuthVercelEnvSyncEvidenceGate}\``,
    `- App auth production evidence gate: \`${report.currentGateStatus.appAuthProductionEvidenceGate}\``,
    "",
    ...(report.operatorInputPacket
      ? [
          "## Operator Input Packet",
          "",
          `- Status: \`${report.operatorInputPacket.status}\``,
          `- First required input: \`${report.operatorInputPacket.firstRequiredInputId}\``,
          `- Next safe action: \`${report.operatorInputPacket.nextSafeAction}\``,
          `- Next command template: \`${report.operatorInputPacket.nextSafeCommandTemplateKey}\``,
          `- Values forbidden: \`${report.operatorInputPacket.valuesForbidden}\``,
          `- Preferred input mode: \`${report.operatorInputPacket.preferredInputMode ?? "not-recorded"}\``,
          `- Safe input instruction: ${report.operatorInputPacket.safeInputInstruction ?? "not-recorded"}`,
          `- Approved source label is evidence: \`${report.operatorInputPacket.approvedSourceLabelIsNotEvidence === true ? "false" : "not-recorded"}\``,
          "",
        ]
      : []),
    "## Candidate Evidence",
    "",
    "| File | Target | Reusable | Release run | Rejections |",
    "| --- | --- | --- | --- | --- |",
    ...report.candidates.map((candidate) =>
      [
        `\`${candidate.fileName}\``,
        `\`${candidate.target}\``,
        `\`${candidate.reusable}\``,
        `\`${candidate.releaseRunIdStatus}\``,
        candidate.rejectionReasons.length > 0
          ? candidate.rejectionReasons.map((reason) => `\`${reason}\``).join(", ")
          : "None",
      ].join(" | "),
    ),
    "",
    `Safe next action: \`${report.safeNextAction}\``,
  ];

  return `${lines.join("\n")}\n`;
}

function readJsonArg(args, key) {
  const value = args[key];
  if (typeof value !== "string") {
    throw new Error(`Missing required --${key}`);
  }
  return readJsonFile(value);
}

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
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
    const value = next === undefined || next.startsWith("--") ? true : next;
    if (value !== true) {
      i += 1;
    }
    if (args[key] === undefined) {
      args[key] = value;
    } else if (Array.isArray(args[key])) {
      args[key].push(value);
    } else {
      args[key] = [args[key], value];
    }
  }
  return args;
}

function readString(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function readStringArray(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === "string" && item.length > 0);
  }
  if (typeof value === "string" && value.length > 0) {
    return [value];
  }
  return [];
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
