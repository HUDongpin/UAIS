#!/usr/bin/env node

import { readFileSync } from "node:fs";

const requiredAppAuthEnvNames = [
  "UAIS_APP_SESSION_SIGNING_SECRET",
  "UAIS_APP_AUTH_PROVIDER",
  "UAIS_APP_AUTH_PROVIDER_URL",
  "UAIS_APP_AUTH_PROVIDER_TOKEN",
];

function main() {
  const args = parseArgs(process.argv.slice(2));
  const appAuthEnvSourceIntake = readJsonArg(args, "app-auth-env-source-intake");
  const appAuthPreflight = readJsonArg(args, "app-auth-preflight");
  const vercelEnvSync = typeof args["vercel-env-sync"] === "string"
    ? readJsonArg(args, "vercel-env-sync")
    : undefined;
  const report = buildReport({ appAuthEnvSourceIntake, appAuthPreflight, vercelEnvSync });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(report));
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function buildReport({ appAuthEnvSourceIntake, appAuthPreflight, vercelEnvSync }) {
  const approvedProviderMode = readString(
    appAuthEnvSourceIntake.approvedProviderMode,
    readString(appAuthPreflight.approvedProviderMode, ""),
  );
  const approvedReleaseRunIdLabel = readString(
    appAuthEnvSourceIntake.approvedReleaseRunIdLabel,
    readString(appAuthPreflight.approvedReleaseRunIdLabel, ""),
  );
  const vercelEnvSyncEvidenceStatus = evaluateVercelEnvSyncEvidence({
    evidence: vercelEnvSync,
    approvedProviderMode,
    approvedReleaseRunIdLabel,
  });
  const intakeReadyForVercelEnvSyncDryRun =
    appAuthEnvSourceIntake.summary?.readyForVercelEnvSyncDryRun === true;
  const upstreamEnvSourceIntakeRequired = !intakeReadyForVercelEnvSyncDryRun;
  const upstreamOperatorInputRequired =
    upstreamEnvSourceIntakeRequired &&
    (appAuthEnvSourceIntake.summary?.operatorInputRequired === true ||
      appAuthEnvSourceIntake.summary?.blockingInputRequired === true);
  const applyEvidenceAccepted =
    intakeReadyForVercelEnvSyncDryRun &&
    vercelEnvSyncEvidenceStatus.status === "matched" &&
    vercelEnvSyncEvidenceStatus.applyPreflight === "proved" &&
    vercelEnvSyncEvidenceStatus.releaseRunIdStatus === "matched" &&
    vercelEnvSyncEvidenceStatus.requiredAppAuthEnvStatus === "present";
  const status = applyEvidenceAccepted
    ? "app-auth-vercel-env-sync-evidence-gate-apply-evidence-accepted"
    : upstreamEnvSourceIntakeRequired
      ? "app-auth-vercel-env-sync-evidence-gate-waiting-for-env-source-intake"
      : vercelEnvSync === undefined
      ? "app-auth-vercel-env-sync-evidence-gate-awaiting-vercel-env-sync-evidence"
      : "app-auth-vercel-env-sync-evidence-gate-rejected";
  const upstreamBlockingEvidence = upstreamEnvSourceIntakeRequired
    ? {
        id: "upstream-app-auth-env-source-intake",
        label: "app-auth-env-source-intake",
        reason:
          "App-auth Vercel env-sync evidence must wait for app-auth env-source intake to prove required env-name presence without exposing values.",
        valuesForbidden: true,
        upstreamStatus: readString(appAuthEnvSourceIntake.status, "unknown"),
        safeNextAction: readString(appAuthEnvSourceIntake.safeNextAction, ""),
        missingEvidence: readStringArray(appAuthEnvSourceIntake.missingEvidence),
        blockedReasons: readStringArray(appAuthEnvSourceIntake.blockedReasons),
        operatorInputPacket: readSafeOperatorInputPacket(
          appAuthEnvSourceIntake.operatorInputPacket,
        ),
        safeCommandTemplates: readSafeCommandTemplates(appAuthEnvSourceIntake.safeCommandTemplates),
      }
    : null;

  return {
    target: "app-auth-vercel-env-sync-evidence-gate",
    status,
    releaseReady: false,
    responsibleSession: "S19/S22",
    approvedServerOnlyEnvSourceLabel: readString(
      appAuthEnvSourceIntake.approvedServerOnlyEnvSourceLabel,
      readString(appAuthPreflight.approvedServerOnlyEnvSourceLabel, ""),
    ),
    approvedProviderMode,
    approvedReleaseRunIdLabel,
    summary: {
      ownerInputRequired: false,
      operatorInputRequired: upstreamOperatorInputRequired,
      blockingInputRequired: upstreamOperatorInputRequired,
      upstreamEnvSourceIntakeRequired,
      intakeReadyForVercelEnvSyncDryRun,
      vercelEnvSyncEvidenceProvided: vercelEnvSync !== undefined,
      applyEvidenceAccepted,
      appAuthEnvPresent: vercelEnvSyncEvidenceStatus.requiredAppAuthEnvStatus === "present",
      appAuthReadinessMayProceed: applyEvidenceAccepted,
      releaseReady: false,
    },
    vercelEnvSyncEvidenceStatus,
    requiredAppAuthEnvNames: readRequiredAppAuthEnvNames(appAuthPreflight),
    upstreamBlockingEvidence,
    blockedReasons: readGateBlockedReasons({
      applyEvidenceAccepted,
      upstreamEnvSourceIntakeRequired,
      vercelEnvSyncEvidenceStatus,
    }),
    safeNextAction: applyEvidenceAccepted
      ? "run-s22-app-auth-provider-readiness-with-accepted-env-sync-evidence"
      : upstreamEnvSourceIntakeRequired
        ? readString(
            upstreamBlockingEvidence?.safeNextAction,
            "wait-for-app-auth-env-source-intake-before-vercel-env-sync",
          )
      : "run-s19-vercel-env-sync-dry-run-after-approved-env-source-intake",
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
    },
  };
}

function readGateBlockedReasons({
  applyEvidenceAccepted,
  upstreamEnvSourceIntakeRequired,
  vercelEnvSyncEvidenceStatus,
}) {
  if (applyEvidenceAccepted) {
    return [];
  }
  if (upstreamEnvSourceIntakeRequired) {
    return ["app-auth-env-source-intake-not-ready"];
  }
  return readBlockedReasons(vercelEnvSyncEvidenceStatus);
}

function evaluateVercelEnvSyncEvidence({
  evidence,
  approvedProviderMode,
  approvedReleaseRunIdLabel,
}) {
  if (evidence === undefined) {
    return {
      target: "missing",
      status: "missing",
      applyPreflight: "missing",
      releaseRunIdStatus: "missing",
      requiredAppAuthEnvStatus: "missing",
      valueRedacted: true,
    };
  }
  const summary = {
    target: readString(evidence.target, "missing"),
    valueRedacted: true,
  };
  if (summary.target !== "vercel-env-sync") {
    return {
      ...summary,
      status: "invalid-target",
      applyPreflight: "missing",
      releaseRunIdStatus: "missing",
      requiredAppAuthEnvStatus: "missing",
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
      requiredAppAuthEnvStatus: readMissingAppAuthEnvNames(evidence).length === 0
        ? "present"
        : "missing",
    };
  }
  if (!hasPassedApplyPreflight(evidence)) {
    return {
      ...summary,
      status: "apply-preflight-missing",
      applyPreflight: "missing",
      releaseRunIdStatus: "missing",
      requiredAppAuthEnvStatus: readMissingAppAuthEnvNames(evidence).length === 0
        ? "present"
        : "missing",
    };
  }
  if (evidence.releaseRunId !== approvedReleaseRunIdLabel) {
    return {
      ...summary,
      status: "release-run-id-mismatch",
      applyPreflight: "proved",
      releaseRunIdStatus: "mismatched",
      requiredAppAuthEnvStatus: readMissingAppAuthEnvNames(evidence).length === 0
        ? "present"
        : "missing",
    };
  }
  if (evidence.appAuthProviderMode !== approvedProviderMode) {
    return {
      ...summary,
      status: "app-auth-provider-selector-mismatch",
      applyPreflight: "proved",
      releaseRunIdStatus: "matched",
      requiredAppAuthEnvStatus: readMissingAppAuthEnvNames(evidence).length === 0
        ? "present"
        : "missing",
    };
  }
  const missingAppAuthEnvNames = readMissingAppAuthEnvNames(evidence);
  if (missingAppAuthEnvNames.length > 0) {
    return {
      ...summary,
      status: "app-auth-env-missing",
      applyPreflight: "proved",
      releaseRunIdStatus: "matched",
      requiredAppAuthEnvStatus: "missing",
      missingAppAuthEnvNames,
    };
  }
  return {
    ...summary,
    status: "matched",
    applyPreflight: "proved",
    releaseRunIdStatus: "matched",
    requiredAppAuthEnvStatus: "present",
  };
}

function readBlockedReasons(evidenceStatus) {
  if (evidenceStatus.status === "missing") {
    return ["vercel-env-sync-evidence-missing"];
  }
  if (evidenceStatus.status === "not-applied") {
    return ["vercel-env-sync-not-applied"];
  }
  if (evidenceStatus.status === "apply-preflight-missing") {
    return ["vercel-env-sync-apply-preflight-not-proven"];
  }
  if (evidenceStatus.status === "release-run-id-mismatch") {
    return ["vercel-env-sync-release-run-id-mismatch"];
  }
  if (evidenceStatus.status === "app-auth-provider-selector-mismatch") {
    return ["vercel-env-sync-app-auth-provider-selector-mismatch"];
  }
  if (evidenceStatus.status === "app-auth-env-missing") {
    return ["vercel-env-sync-app-auth-env-missing"];
  }
  return [`vercel-env-sync-evidence-${evidenceStatus.status}`];
}

function readMissingAppAuthEnvNames(evidence) {
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
  return requiredAppAuthEnvNames.filter((name) => {
    if (entryStatusByName.get(name) === "present") {
      return false;
    }
    if (envStatus[name] === "present" || requiredEnv[name] === "present") {
      return false;
    }
    return true;
  });
}

function readRequiredAppAuthEnvNames(appAuthPreflight) {
  const names = readStringArray(appAuthPreflight.requiredServerOnlyEnvNames);
  return names.length > 0 ? names : requiredAppAuthEnvNames;
}

function hasProductionAndPreviewTargets(targets) {
  return Array.isArray(targets) && targets.includes("production") && targets.includes("preview");
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

function renderMarkdown(report) {
  const lines = [
    "# UAIS App Auth Vercel Env Sync Evidence Gate",
    "",
    `Status: \`${report.status}\``,
    `Env source label: \`${report.approvedServerOnlyEnvSourceLabel}\``,
    `Provider mode: \`${report.approvedProviderMode}\``,
    `Operator input required: \`${report.summary.operatorInputRequired}\``,
    `Safe next action: \`${report.safeNextAction}\``,
    `Upstream env-source intake required: \`${report.summary.upstreamEnvSourceIntakeRequired}\``,
    `App auth readiness may proceed: \`${report.summary.appAuthReadinessMayProceed}\``,
    `Release ready: \`${report.summary.releaseReady}\``,
    "",
    "## Evidence Status",
    "",
    `- Target: \`${report.vercelEnvSyncEvidenceStatus.target}\``,
    `- Status: \`${report.vercelEnvSyncEvidenceStatus.status}\``,
    `- Apply preflight: \`${report.vercelEnvSyncEvidenceStatus.applyPreflight}\``,
    `- Release run ID: \`${report.vercelEnvSyncEvidenceStatus.releaseRunIdStatus}\``,
    `- Required app-auth env: \`${report.vercelEnvSyncEvidenceStatus.requiredAppAuthEnvStatus}\``,
    "",
    "## Upstream Blocking Evidence",
    "",
    ...(report.upstreamBlockingEvidence
      ? [
          `- \`${report.upstreamBlockingEvidence.id}\`: \`${report.upstreamBlockingEvidence.label}\``,
        ]
      : ["- `none-recorded`"]),
    ...(report.upstreamBlockingEvidence &&
    Object.keys(report.upstreamBlockingEvidence.safeCommandTemplates ?? {}).length > 0
      ? [
          "",
          "## Safe Operator Command Templates",
          "",
          ...Object.entries(report.upstreamBlockingEvidence.safeCommandTemplates).map(
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
