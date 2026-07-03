#!/usr/bin/env node

import { readFileSync } from "node:fs";

const decisionId = "teacher-auth-provider-production-selector";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const ownerResponseValidation = readJsonArg(args, "owner-response-validation");
  const approvalGate = readJsonArg(args, "approval-gate");
  const teacherAuthActionPacket = readJsonArg(args, "teacher-auth-action-packet");
  const appAuthPreflight = args["app-auth-preflight"]
    ? readJsonArg(args, "app-auth-preflight")
    : {};
  const report = buildPreflight({
    ownerResponseValidation,
    approvalGate,
    teacherAuthActionPacket,
    appAuthPreflight,
  });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(report));
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function buildPreflight({
  ownerResponseValidation,
  approvalGate,
  teacherAuthActionPacket,
  appAuthPreflight,
}) {
  const ownerResponseAccepted =
    readString(ownerResponseValidation.status, "") === "owner-response-accepted" &&
    ownerResponseValidation.summary?.providerModeAccepted === true;
  const stages = readRecordArray(approvalGate.stages);
  const teacherStage = stages.find((stage) => readString(stage.id, "") === decisionId) || {};
  const appAuthStage =
    stages.find((stage) => readString(stage.id, "") === "app-auth-provider-production-selector") ||
    {};
  const teacherStageAcceptedAwaitingEvidence =
    readString(teacherStage.queueStatus, "") === "accepted" &&
    readString(teacherStage.currentStatus, "") === "accepted-awaiting-production-evidence" &&
    teacherStage.ownerResponseAccepted === true;
  const upstreamAppAuthEvidenceCleared = appAuthEvidenceCleared({
    appAuthStage,
    appAuthPreflight,
  });
  const allowedChecks = readStringArray(ownerResponseValidation.postValidationAllowedChecks);
  const s19DryRunMayProceedAfterAppAuthClears =
    ownerResponseValidation.summary?.s19DryRunMayProceed === true &&
    allowedChecks.includes("prepare-s19-teacher-auth-env-sync-dry-run-after-app-auth-clears");
  const s22ReadinessMayProceedAfterEnvSync =
    ownerResponseValidation.summary?.s22ReadinessMayProceed === true &&
    allowedChecks.includes("prepare-teacher-auth-readiness-command-after-env-sync-evidence");
  const issuerRouteSmokeMayProceedAfterProductionDeploy = allowedChecks.includes(
    "prepare-teacher-auth-issuer-route-smoke-after-production-deploy",
  );
  const liveCookieIssuanceStillForbidden =
    ownerResponseValidation.summary?.liveCookieIssuanceStillForbidden === true;
  const approvedProviderMode = readString(
    ownerResponseValidation.redactedOwnerResponse?.ownerApprovedProviderMode,
    "unknown",
  );
  const requiredServerOnlyEnvNames = uniqueStrings([
    ...readStringArray(ownerResponseValidation.requiredServerOnlyEnvNamesForApprovedMode),
    ...readStringArray(teacherAuthActionPacket.currentModeRequiredEnvNames),
  ]);
  const requiredEvidence = uniqueStrings([
    ...readStringArray(teacherStage.requiredEvidence),
    ...readStringArray(teacherAuthActionPacket.requiredEvidence),
  ]);
  const currentEvidenceSummary = isRecord(teacherAuthActionPacket.currentEvidenceSummary)
    ? teacherAuthActionPacket.currentEvidenceSummary
    : {};
  const missingEvidence = requiredEvidence.filter(
    (evidence) => !isEvidenceCurrentlyProved(evidence, currentEvidenceSummary),
  );
  const safeCommandTemplates = buildSafeCommandTemplates(teacherAuthActionPacket);
  const blockedReasons = [
    ...(!ownerResponseAccepted ? ["teacher-auth-owner-response-not-accepted"] : []),
    ...(!teacherStageAcceptedAwaitingEvidence
      ? ["teacher-auth-stage-not-accepted-awaiting-production-evidence"]
      : []),
    ...(!upstreamAppAuthEvidenceCleared
      ? ["upstream-app-auth-production-evidence-not-cleared"]
      : []),
    ...(!s19DryRunMayProceedAfterAppAuthClears
      ? ["s19-teacher-auth-env-sync-dry-run-not-authorized"]
      : []),
    ...(!s22ReadinessMayProceedAfterEnvSync
      ? ["s22-teacher-auth-readiness-prep-not-authorized"]
      : []),
    ...(!issuerRouteSmokeMayProceedAfterProductionDeploy
      ? ["teacher-auth-issuer-route-smoke-prep-not-authorized"]
      : []),
    ...(!liveCookieIssuanceStillForbidden
      ? ["teacher-auth-live-cookie-issuance-separate-approval-not-confirmed"]
      : []),
    ...missingEvidence.map((evidence) => `${evidence}-missing`),
  ];
  const status =
    ownerResponseAccepted &&
    teacherStageAcceptedAwaitingEvidence &&
    s19DryRunMayProceedAfterAppAuthClears &&
    s22ReadinessMayProceedAfterEnvSync &&
    issuerRouteSmokeMayProceedAfterProductionDeploy &&
    liveCookieIssuanceStillForbidden
      ? upstreamAppAuthEvidenceCleared
        ? "teacher-auth-production-evidence-preflight-ready"
        : "teacher-auth-production-evidence-preflight-waiting-for-upstream-app-auth"
      : "teacher-auth-production-evidence-preflight-blocked";

  return {
    target: "teacher-auth-production-evidence-preflight",
    status,
    releaseReady: false,
    responsibleSession: "S19/S22",
    ownerDecisionId: decisionId,
    approvedProviderMode,
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
      teacherStageAcceptedAwaitingEvidence,
      upstreamAppAuthEvidenceCleared,
      s19DryRunMayProceedAfterAppAuthClears,
      s22ReadinessMayProceedAfterEnvSync,
      issuerRouteSmokeMayProceedAfterProductionDeploy,
      liveCookieIssuanceStillForbidden,
      requiredServerOnlyEnvNameCount: requiredServerOnlyEnvNames.length,
      requiredEvidenceCount: requiredEvidence.length,
      missingEvidenceCount: missingEvidence.length,
      commandTemplateCount: Object.keys(safeCommandTemplates).length,
      releaseReady: false,
    },
    upstreamBlockers: upstreamAppAuthEvidenceCleared
      ? []
      : ["app-auth-production-evidence-missing"],
    requiredServerOnlyEnvNames,
    requiredEvidence,
    missingEvidence,
    provedPrerequisiteEvidence: requiredEvidence.filter((evidence) =>
      isEvidenceCurrentlyProved(evidence, currentEvidenceSummary),
    ),
    blockedReasons,
    safeCommandTemplates,
    safeNextActions: uniqueStrings(readStringArray(teacherAuthActionPacket.safeNextActions)),
    forbiddenUntilEvidenceExists: uniqueStrings([
      ...readStringArray(ownerResponseValidation.stillForbiddenUntilSeparateApproval),
      ...readStringArray(teacherAuthActionPacket.forbiddenUntilApproved),
    ]),
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmittedFromMarkdown: true,
      credentialValuesOmitted: true,
      cookieValuesOmitted: true,
      responseBodiesOmitted: true,
      envFileRead: false,
      vercelApiCalled: false,
      noCookieIssued: true,
      noLiveMutationPerformed: true,
      noDeploymentMutationPerformed: true,
      noEnvApplyPerformed: true,
      noReleaseRunBindingPerformed: true,
    },
  };
}

function appAuthEvidenceCleared({ appAuthStage, appAuthPreflight }) {
  const stageStatus = readString(appAuthStage.currentStatus, "");
  if (
    [
      "accepted-production-evidence-ready",
      "accepted-live-evidence-ready",
      "production-evidence-ready",
      "live-ready",
      "ready",
    ].includes(stageStatus)
  ) {
    return true;
  }

  return (
    appAuthPreflight.summary?.missingEvidenceCount === 0 &&
    readString(appAuthPreflight.status, "").includes("ready") &&
    appAuthPreflight.releaseReady === true
  );
}

function isEvidenceCurrentlyProved(evidence, currentEvidenceSummary) {
  if (evidence === "trusted-teacher-auth-route-chain-contract") {
    return readString(currentEvidenceSummary.trustedRouteChainStatus, "") === "proved";
  }
  return false;
}

function buildSafeCommandTemplates(teacherAuthActionPacket) {
  const commands = isRecord(teacherAuthActionPacket.commands)
    ? teacherAuthActionPacket.commands
    : {};
  return {
    vercelEnvSyncDryRun:
      typeof commands.vercelEnvSyncDryRun === "string"
        ? commands.vercelEnvSyncDryRun
        : "node scripts/vercel-env-sync.mjs --dry-run --scope teacher-auth --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <teacher-auth-vercel-env-sync-dry-run-evidence>",
    issuerRouteSmoke:
      typeof commands.issuerRouteSmoke === "string"
        ? commands.issuerRouteSmoke
        : "node scripts/teacher-auth-issuer-route-smoke.mjs --live --approved --environment production --deployment <production-deployment-evidence> --release-run-id <release-run-id> > <teacher-auth-issuer-route-smoke-evidence>",
    teacherAuthReadiness:
      typeof commands.teacherAuthReadinessLive === "string"
        ? commands.teacherAuthReadinessLive
        : "node scripts/teacher-auth-provider-readiness.mjs --live --approved --environment production --env-file <approved-env-file> --release-run-id <release-run-id> --vercel-env-sync <teacher-auth-vercel-env-sync-evidence> --trusted-teacher-auth-route-chain <trusted-teacher-auth-route-chain-evidence> --route-smoke <teacher-auth-issuer-route-smoke-evidence> > <teacher-auth-provider-readiness-evidence>",
  };
}

function renderMarkdown(report) {
  const lines = [
    "# UAIS Teacher Auth Production Evidence Preflight",
    "",
    `Status: \`${report.status}\``,
    `Release ready: \`${report.releaseReady}\``,
    `Owner decision: \`${report.ownerDecisionId}\``,
    `Approved provider mode: \`${report.approvedProviderMode}\``,
    `Upstream app-auth evidence cleared: \`${report.summary.upstreamAppAuthEvidenceCleared}\``,
    `S19 dry-run may proceed after app-auth clears: \`${report.summary.s19DryRunMayProceedAfterAppAuthClears}\``,
    `S22 readiness may proceed after env sync: \`${report.summary.s22ReadinessMayProceedAfterEnvSync}\``,
    `Live cookie issuance still forbidden: \`${report.summary.liveCookieIssuanceStillForbidden}\``,
    `Missing evidence: ${report.summary.missingEvidenceCount}`,
    "",
    "This preflight reads only existing redacted coordination reports. It does not read env files, print labels, call Vercel, issue cookies, run live provider readiness, deploy, or bind a release run.",
    "",
    "## Required Server-Only Env Names",
    "",
    ...formatBullets(report.requiredServerOnlyEnvNames),
    "",
    "## Missing Evidence",
    "",
    ...formatBullets(report.missingEvidence),
    "",
    "## Proved Prerequisite Evidence",
    "",
    ...formatBullets(report.provedPrerequisiteEvidence),
    "",
    "## Safe Command Templates",
    "",
    "```sh",
    report.safeCommandTemplates.vercelEnvSyncDryRun,
    report.safeCommandTemplates.issuerRouteSmoke,
    report.safeCommandTemplates.teacherAuthReadiness,
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

function readRecordArray(value) {
  return Array.isArray(value) ? value.filter((item) => isRecord(item)) : [];
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
