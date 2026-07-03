#!/usr/bin/env node

import { readFileSync } from "node:fs";

const decisionId = "enterprise-live-evidence-audit";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const ownerResponseValidation = readJsonArg(args, "owner-response-validation");
  const approvalGate = readJsonArg(args, "approval-gate");
  const enterpriseAuditActionPacket = readJsonArg(args, "enterprise-audit-action-packet");
  const enterpriseLiveEvidenceTriage = readJsonArg(args, "enterprise-live-evidence-triage");
  const report = buildPreflight({
    ownerResponseValidation,
    approvalGate,
    enterpriseAuditActionPacket,
    enterpriseLiveEvidenceTriage,
    appAuthPreflight: args["app-auth-preflight"]
      ? readJsonArg(args, "app-auth-preflight")
      : {},
    teacherAuthPreflight: args["teacher-auth-preflight"]
      ? readJsonArg(args, "teacher-auth-preflight")
      : {},
    externalStoragePreflight: args["external-storage-preflight"]
      ? readJsonArg(args, "external-storage-preflight")
      : {},
    vercelEnvDeployPreflight: args["vercel-env-deploy-preflight"]
      ? readJsonArg(args, "vercel-env-deploy-preflight")
      : {},
    manualPptPreflight: args["manual-ppt-preflight"]
      ? readJsonArg(args, "manual-ppt-preflight")
      : {},
    ordinaryTeachingPreflight: args["ordinary-teaching-preflight"]
      ? readJsonArg(args, "ordinary-teaching-preflight")
      : {},
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
  enterpriseAuditActionPacket,
  enterpriseLiveEvidenceTriage,
  appAuthPreflight,
  teacherAuthPreflight,
  externalStoragePreflight,
  vercelEnvDeployPreflight,
  manualPptPreflight,
  ordinaryTeachingPreflight,
}) {
  const ownerResponseAccepted =
    readString(ownerResponseValidation.status, "") === "owner-response-accepted";
  const stages = readRecordArray(approvalGate.stages);
  const auditStage = stages.find((stage) => readString(stage.id, "") === decisionId) || {};
  const auditStageWaitingForLiveEvidence =
    readString(auditStage.queueStatus, "") === "waiting-for-live-evidence" ||
    readString(auditStage.currentStatus, "") === "waiting-for-live-evidence";
  const requiredTargets = uniqueStrings([
    ...readStringArray(enterpriseAuditActionPacket.requiredTargets),
    ...readStringArray(enterpriseLiveEvidenceTriage.requiredTargets),
  ]);
  const missingRequiredTargets = uniqueStrings([
    ...readStringArray(enterpriseLiveEvidenceTriage.missingRequiredTargets),
    ...readStringArray(enterpriseAuditActionPacket.missingRequiredTargets),
    ...readStringArray(enterpriseAuditActionPacket.enterpriseAuditMissingTargets),
  ]);
  const acceptedLiveEvidenceCount = readNumber(
    enterpriseLiveEvidenceTriage.summary?.acceptedTargets,
    readNumber(enterpriseAuditActionPacket.currentEvidenceSummary?.acceptedLiveEvidence),
  );
  const liveEvidenceTargetsCleared =
    readString(enterpriseLiveEvidenceTriage.status, "") === "ready" &&
    missingRequiredTargets.length === 0 &&
    acceptedLiveEvidenceCount === requiredTargets.length &&
    requiredTargets.length > 0;
  const releaseRunConsistencyCleared =
    isReadyLikeStatus(enterpriseLiveEvidenceTriage.summary?.releaseRunIdConsistency) &&
    isReadyLikeStatus(enterpriseLiveEvidenceTriage.summary?.sharedReleaseRunIdStatus);
  const releaseRunBindingStillForbidden =
    ownerResponseValidation.summary?.releaseRunBindingStillForbidden !== false;
  const upstreamBlockers = buildUpstreamBlockers({
    appAuthPreflight,
    teacherAuthPreflight,
    externalStoragePreflight,
    vercelEnvDeployPreflight,
    manualPptPreflight,
    ordinaryTeachingPreflight,
  });
  const upstreamProductionPreflightsCleared = upstreamBlockers.length === 0;
  const requiredEvidence = uniqueStrings([
    ...readStringArray(ownerResponseValidation.requiredEvidenceAfterApproval),
    ...readStringArray(auditStage.requiredEvidence),
    ...readStringArray(enterpriseAuditActionPacket.requiredEvidence),
  ]);
  const safeCommandTemplates = buildSafeCommandTemplates({
    actionPacket: enterpriseAuditActionPacket,
    ownerResponseValidation,
  });
  const blockedReasons = uniqueStrings([
    ...(!auditStageWaitingForLiveEvidence
      ? ["enterprise-audit-stage-not-waiting-for-live-evidence"]
      : []),
    ...(!liveEvidenceTargetsCleared ? ["enterprise-live-required-targets-missing"] : []),
    ...(!upstreamProductionPreflightsCleared
      ? ["upstream-production-preflights-not-cleared"]
      : []),
    ...(!releaseRunConsistencyCleared ? ["release-run-consistency-not-cleared"] : []),
    ...(!ownerResponseAccepted ? ["enterprise-audit-owner-response-not-accepted"] : []),
    ...(releaseRunBindingStillForbidden ? ["release-run-binding-still-forbidden"] : []),
    ...readStringArray(enterpriseAuditActionPacket.currentEvidenceSummary?.auditBlockedReasons),
  ]);
  const status = !auditStageWaitingForLiveEvidence
    ? "enterprise-live-evidence-audit-production-evidence-preflight-blocked"
    : !liveEvidenceTargetsCleared || !upstreamProductionPreflightsCleared
      ? "enterprise-live-evidence-audit-production-evidence-preflight-waiting-for-required-live-evidence"
      : !ownerResponseAccepted
        ? "enterprise-live-evidence-audit-production-evidence-preflight-waiting-for-owner-audit-labels"
        : !releaseRunConsistencyCleared
          ? "enterprise-live-evidence-audit-production-evidence-preflight-waiting-for-release-run-consistency"
          : "enterprise-live-evidence-audit-production-evidence-preflight-ready";

  return {
    target: "enterprise-live-evidence-audit-production-evidence-preflight",
    status,
    releaseReady: false,
    responsibleSession: "S22/S10/S25",
    ownerDecisionId: decisionId,
    summary: {
      ownerResponseAccepted,
      auditStageWaitingForLiveEvidence,
      liveEvidenceTargetsCleared,
      upstreamProductionPreflightsCleared,
      releaseRunConsistencyCleared,
      releaseRunBindingStillForbidden,
      requiredTargetCount: requiredTargets.length,
      acceptedLiveEvidenceCount,
      missingRequiredTargetCount: missingRequiredTargets.length,
      requiredEvidenceCount: requiredEvidence.length,
      commandTemplateCount: Object.keys(safeCommandTemplates).length,
      releaseReady: false,
    },
    upstreamBlockers,
    requiredTargets,
    missingRequiredTargets,
    requiredEvidence,
    blockedReasons,
    safeCommandTemplates,
    safeNextActions: uniqueStrings([
      ...readStringArray(enterpriseAuditActionPacket.safeNextActions),
      ...readStringArray(enterpriseLiveEvidenceTriage.nextActions),
      ...readStringArray(ownerResponseValidation.postValidationAllowedChecks),
    ]),
    forbiddenUntilEvidenceExists: uniqueStrings([
      ...readStringArray(enterpriseAuditActionPacket.forbiddenUntilApproved),
      ...readStringArray(ownerResponseValidation.stillForbiddenUntilSeparateApproval),
      "run-enterprise-live-evidence-audit-before-all-target-evidence-exists",
      "refresh-production-release-gate-with-missing-enterprise-audit",
      "bind-production-release-run-id-while-release-gate-blocked",
    ]),
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmittedFromMarkdown: true,
      cookieValuesOmitted: true,
      credentialValuesOmitted: true,
      responseBodiesOmitted: true,
      commandBodiesRedactedToTemplates: true,
      envFileRead: false,
      vercelApiCalled: false,
      liveAuditRun: false,
      releaseGateRefreshPerformed: false,
      noRemoteWritePerformed: true,
      noLiveMutationPerformed: true,
      noDeploymentMutationPerformed: true,
      noReleaseRunBindingPerformed: true,
      filenameOnlyEvidenceRejected: true,
      liveEvidenceRequired: true,
    },
  };
}

function buildUpstreamBlockers({
  appAuthPreflight,
  teacherAuthPreflight,
  externalStoragePreflight,
  vercelEnvDeployPreflight,
  manualPptPreflight,
  ordinaryTeachingPreflight,
}) {
  const blockers = [];
  if (!preflightEvidenceCleared(appAuthPreflight)) {
    blockers.push("app-auth-production-evidence-not-cleared");
  }
  if (!preflightEvidenceCleared(teacherAuthPreflight)) {
    blockers.push("teacher-auth-production-evidence-not-cleared");
  }
  if (!preflightEvidenceCleared(externalStoragePreflight)) {
    blockers.push("external-storage-production-evidence-not-cleared");
  }
  if (!preflightEvidenceCleared(vercelEnvDeployPreflight)) {
    blockers.push("vercel-production-deployment-evidence-not-cleared");
  }
  if (!preflightEvidenceCleared(manualPptPreflight)) {
    blockers.push("manual-ppt-production-binding-not-cleared");
  }
  if (!preflightEvidenceCleared(ordinaryTeachingPreflight)) {
    blockers.push("ordinary-teaching-production-evidence-not-cleared");
  }
  return blockers;
}

function preflightEvidenceCleared(preflight) {
  return (
    readString(preflight.status, "").includes("ready") &&
    preflight.releaseReady === true &&
    preflight.summary?.missingEvidenceCount === 0
  );
}

function buildSafeCommandTemplates({ actionPacket, ownerResponseValidation }) {
  const commandNames = uniqueStrings([
    ...Object.keys(readRecord(actionPacket.commands)),
    ...readStringArray(ownerResponseValidation.requiredCommandNames),
    "runEnterpriseAudit",
    "refreshReleaseGateWithAudit",
  ]);
  const commands = readRecord(actionPacket.commands);
  const templates = {};
  for (const commandName of commandNames) {
    templates[commandName] = sanitizeCommandTemplate(
      readString(commands[commandName], defaultCommandTemplate(commandName)),
    );
  }
  return templates;
}

function defaultCommandTemplate(commandName) {
  if (commandName === "runEnterpriseAudit") {
    return "node scripts/enterprise-live-evidence-audit.mjs --reports-dir <redacted-production-evidence-reports-dir> --date <production-live-date-label> --output <enterprise-live-evidence-audit-output>";
  }
  if (commandName === "refreshReleaseGateWithAudit") {
    return "node -- scripts/production-e2e-release-gate.mjs <release-gate-inputs> --enterprise-live-evidence-audit <enterprise-live-evidence-audit-output> > <production-e2e-release-gate-output>";
  }
  return `node scripts/${commandName}.mjs <redacted-production-evidence-inputs> > <${commandName}-evidence>`;
}

function sanitizeCommandTemplate(command) {
  return command
    .replace(/https?:\/\/\S+/g, "<raw-url-omitted>")
    .replace(/\/Users\/\S+/g, "<local-path-omitted>")
    .replace(/--date\s+<production-live-date>/g, "--date <production-live-date-label>")
    .replace(/<production-live-date>/g, "<production-live-date-label>")
    .replace(/coordination\/reports/g, "<redacted-production-evidence-reports-dir>");
}

function renderMarkdown(report) {
  const lines = [
    "# UAIS Enterprise Live Evidence Audit Production Evidence Preflight",
    "",
    `Status: \`${report.status}\``,
    `Release ready: \`${report.releaseReady}\``,
    `Owner decision: \`${report.ownerDecisionId}\``,
    `Live evidence targets cleared: \`${report.summary.liveEvidenceTargetsCleared}\``,
    `Upstream production preflights cleared: \`${report.summary.upstreamProductionPreflightsCleared}\``,
    `Release-run consistency cleared: \`${report.summary.releaseRunConsistencyCleared}\``,
    `Missing required targets: ${report.summary.missingRequiredTargetCount}`,
    "",
    "This preflight reads only existing redacted coordination reports. It does not read env files, run the enterprise audit, refresh the live release gate, deploy, call Vercel, or bind a release run.",
    "",
    "## Upstream Blockers",
    "",
    ...formatBullets(report.upstreamBlockers),
    "",
    "## Missing Required Targets",
    "",
    ...formatBullets(report.missingRequiredTargets),
    "",
    "## Required Evidence",
    "",
    ...formatBullets(report.requiredEvidence),
    "",
    "## Safe Command Templates",
    "",
    "```sh",
    ...Object.values(report.safeCommandTemplates),
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

function readRecord(value) {
  return isRecord(value) ? value : {};
}

function readRecordArray(value) {
  return Array.isArray(value) ? value.filter((item) => isRecord(item)) : [];
}

function readNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

function isReadyLikeStatus(value) {
  return [
    "ready",
    "passed",
    "complete",
    "completed",
    "accepted",
    "consistent",
    "ok",
  ].includes(readString(value, "unknown"));
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
