#!/usr/bin/env node

import { readFileSync } from "node:fs";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const ownerResponseValidation = readJsonArg(args, "owner-response-validation");
  const firstBlocker = readJsonArg(args, "first-blocker");
  const appAuthActionPacket = readJsonArg(args, "app-auth-action-packet");
  const report = buildPreflight({
    ownerResponseValidation,
    firstBlocker,
    appAuthActionPacket,
  });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(report));
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function buildPreflight({ ownerResponseValidation, firstBlocker, appAuthActionPacket }) {
  const ownerResponseAccepted =
    readString(ownerResponseValidation.status, "") === "owner-response-accepted" &&
    ownerResponseValidation.summary?.providerModeAccepted === true;
  const firstOwnerAction = isRecord(firstBlocker.firstOwnerAction)
    ? firstBlocker.firstOwnerAction
    : {};
  const ownerRequest = isRecord(firstBlocker.ownerRequest) ? firstBlocker.ownerRequest : {};
  const firstBlockerAcceptedAwaitingEvidence =
    readString(firstOwnerAction.decisionId, "") === "app-auth-provider-production-selector" &&
    readString(firstOwnerAction.queueStatus, "") === "accepted" &&
    readString(firstOwnerAction.currentStatus, "") === "accepted-awaiting-production-evidence";
  const s19DryRunMayProceed =
    ownerResponseValidation.summary?.s19DryRunMayProceed === true &&
    readStringArray(ownerResponseValidation.postValidationAllowedChecks).includes(
      "prepare-s19-app-auth-env-sync-dry-run",
    );
  const s22ReadinessMayProceedAfterEnvSync =
    ownerResponseValidation.summary?.s22ReadinessMayProceed === true &&
    readStringArray(ownerResponseValidation.postValidationAllowedChecks).includes(
      "prepare-app-auth-readiness-command-after-env-sync-evidence",
    );
  const requiredServerOnlyEnvNames = uniqueStrings(
    readStringArray(ownerRequest.requiredServerOnlyEnvNames),
  );
  const requiredEvidence = uniqueStrings(readStringArray(ownerRequest.requiredEvidence));
  const missingEvidence = requiredEvidence;
  const safeCommandTemplates = buildSafeCommandTemplates(appAuthActionPacket);
  const blockedReasons = [
    ...(!ownerResponseAccepted ? ["app-auth-owner-response-not-accepted"] : []),
    ...(!firstBlockerAcceptedAwaitingEvidence
      ? ["first-blocker-not-accepted-awaiting-production-evidence"]
      : []),
    ...(!s19DryRunMayProceed ? ["s19-app-auth-env-sync-dry-run-not-authorized"] : []),
    ...(!s22ReadinessMayProceedAfterEnvSync
      ? ["s22-app-auth-readiness-prep-not-authorized"]
      : []),
    ...missingEvidence.map((evidence) => `${evidence}-missing`),
  ];
  const readyForPreflight =
    ownerResponseAccepted &&
    firstBlockerAcceptedAwaitingEvidence &&
    s19DryRunMayProceed &&
    s22ReadinessMayProceedAfterEnvSync;

  return {
    target: "app-auth-production-evidence-preflight",
    status: readyForPreflight
      ? "app-auth-production-evidence-preflight-ready"
      : "app-auth-production-evidence-preflight-blocked",
    releaseReady: false,
    responsibleSession: "S19/S22",
    ownerDecisionId: "app-auth-provider-production-selector",
    approvedProviderMode: readString(
      ownerResponseValidation.redactedOwnerResponse?.ownerApprovedProviderMode,
      "unknown",
    ),
    approvedServerOnlyEnvSourceLabel: readString(
      ownerResponseValidation.redactedOwnerResponse?.approvedServerOnlyEnvSourceLabel,
      "none-recorded",
    ),
    approvedReleaseRunIdLabel: readString(
      ownerResponseValidation.redactedOwnerResponse?.approvedReleaseRunIdLabel,
      "none-recorded",
    ),
    summary: {
      ownerResponseAccepted,
      firstBlockerAcceptedAwaitingEvidence,
      s19DryRunMayProceed,
      s22ReadinessMayProceedAfterEnvSync,
      requiredServerOnlyEnvNameCount: requiredServerOnlyEnvNames.length,
      missingEvidenceCount: missingEvidence.length,
      commandTemplateCount: Object.keys(safeCommandTemplates).length,
      releaseReady: false,
    },
    requiredServerOnlyEnvNames,
    missingEvidence,
    blockedReasons,
    safeCommandTemplates,
    forbiddenUntilEvidenceExists: uniqueStrings([
      ...readStringArray(ownerResponseValidation.stillForbiddenUntilSeparateApproval),
      ...readStringArray(firstOwnerAction.forbiddenUntilApproved),
      ...readStringArray(appAuthActionPacket.forbiddenUntilApproved),
    ]),
    safeNextActions: uniqueStrings(readStringArray(appAuthActionPacket.safeNextActions)),
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmittedFromMarkdown: true,
      credentialValuesOmitted: true,
      responseBodiesOmitted: true,
      envFileRead: false,
      vercelApiCalled: false,
      noLiveMutationPerformed: true,
      noDeploymentMutationPerformed: true,
      noEnvApplyPerformed: true,
      noReleaseRunBindingPerformed: true,
    },
  };
}

function buildSafeCommandTemplates(appAuthActionPacket) {
  const fromPacket = isRecord(appAuthActionPacket.safeCommandTemplates)
    ? appAuthActionPacket.safeCommandTemplates
    : {};
  return {
    ...(typeof fromPacket.vercelEnvSyncDryRun === "string"
      ? { vercelEnvSyncDryRun: fromPacket.vercelEnvSyncDryRun }
      : {
          vercelEnvSyncDryRun:
            "node scripts/vercel-env-sync.mjs --dry-run --scope full --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <vercel-env-sync-dry-run-evidence>",
        }),
    ...(typeof fromPacket.appAuthReadiness === "string"
      ? { appAuthReadiness: fromPacket.appAuthReadiness }
      : {
          appAuthReadiness:
            "node scripts/app-auth-provider-readiness.mjs --live --approved --environment production --env-file <approved-env-file> --release-run-id <release-run-id> --vercel-env-sync <vercel-env-sync-evidence> > <app-auth-provider-readiness-evidence>",
        }),
  };
}

function renderMarkdown(report) {
  const lines = [
    "# UAIS App Auth Production Evidence Preflight",
    "",
    `Status: \`${report.status}\``,
    `Release ready: \`${report.releaseReady}\``,
    `Owner decision: \`${report.ownerDecisionId}\``,
    `Approved provider mode: \`${report.approvedProviderMode}\``,
    `S19 dry-run may proceed: \`${report.summary.s19DryRunMayProceed}\``,
    `S22 readiness may proceed after env sync: \`${report.summary.s22ReadinessMayProceedAfterEnvSync}\``,
    `Missing evidence: ${report.summary.missingEvidenceCount}`,
    "",
    "This preflight reads only existing redacted coordination reports. It does not read env files, print labels, call Vercel, run live provider readiness, deploy, or bind a release run.",
    "",
    "## Required Server-Only Env Names",
    "",
    ...formatBullets(report.requiredServerOnlyEnvNames),
    "",
    "## Missing Evidence",
    "",
    ...formatBullets(report.missingEvidence),
    "",
    "## Safe Command Templates",
    "",
    "```sh",
    report.safeCommandTemplates.vercelEnvSyncDryRun,
    report.safeCommandTemplates.appAuthReadiness,
    "```",
  ];

  if (report.blockedReasons.length > 0) {
    lines.push("", "## Blocked Reasons", "");
    lines.push(...formatBullets(report.blockedReasons));
  }

  if (report.forbiddenUntilEvidenceExists.length > 0) {
    lines.push("", "## Still Forbidden", "");
    lines.push(...formatBullets(report.forbiddenUntilEvidenceExists));
  }

  return `${lines.join("\n")}\n`;
}

function formatBullets(values) {
  return values.length > 0 ? values.map((value) => `- \`${value}\``) : ["- `none-recorded`"];
}

function parseArgs(argv) {
  const args = { format: "json" };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    args[key] = value;
    index += 1;
  }
  if (!["json", "markdown"].includes(args.format)) {
    throw new Error("--format must be json or markdown");
  }
  return args;
}

function readJsonArg(args, key) {
  if (!args[key]) {
    throw new Error(`Missing required --${key}`);
  }
  return JSON.parse(readFileSync(args[key], "utf8"));
}

function readString(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function readStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
