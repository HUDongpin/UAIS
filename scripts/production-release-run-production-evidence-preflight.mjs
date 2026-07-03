#!/usr/bin/env node

import { readFileSync } from "node:fs";

const decisionId = "production-release-run";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = buildPreflight({
    ownerResponseValidation: readJsonArg(args, "owner-response-validation"),
    approvalGate: readJsonArg(args, "approval-gate"),
    productionReleaseRunActionPacket: readJsonArg(args, "production-release-run-action-packet"),
    enterpriseAuditPreflight: readJsonArg(args, "enterprise-audit-preflight"),
    packageGate: readJsonArg(args, "package-gate"),
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
  productionReleaseRunActionPacket,
  enterpriseAuditPreflight,
  packageGate,
}) {
  const ownerResponseAccepted =
    readString(ownerResponseValidation.status, "") === "owner-response-accepted";
  const stages = readRecordArray(approvalGate.stages);
  const releaseRunStage = stages.find((stage) => readString(stage.id, "") === decisionId) || {};
  const releaseRunStageWaitingForUpstreamEvidence =
    readString(releaseRunStage.queueStatus, "") === "waiting-for-upstream-evidence" ||
    readString(releaseRunStage.currentStatus, "") === "waiting-for-upstream-evidence";
  const packageGatePassed = readString(packageGate.status, "") === "package-gate-passed";
  const packageGateReleaseReady = packageGate.summary?.releaseReady === true;
  const enterpriseAuditPreflightCleared =
    readString(enterpriseAuditPreflight.status, "").includes("ready") &&
    enterpriseAuditPreflight.releaseReady === true &&
    enterpriseAuditPreflight.summary?.missingRequiredTargetCount === 0 &&
    enterpriseAuditPreflight.summary?.releaseRunConsistencyCleared === true;
  const releaseRunBindingMayProceedAfterSeparateOwnerAction =
    ownerResponseValidation.summary?.releaseRunBindingMayProceedAfterSeparateOwnerAction === true;
  const releaseRunBindingPerformed =
    ownerResponseValidation.summary?.releaseRunBindingPerformed === true;
  const currentEvidenceSummary = readRecord(
    productionReleaseRunActionPacket.currentEvidenceSummary,
  );
  const releaseRunConsistencyCleared =
    isReadyLikeStatus(currentEvidenceSummary.matchStatus) &&
    readNumber(currentEvidenceSummary.waitingReleaseRunEvidenceCount) === 0 &&
    readNumber(currentEvidenceSummary.matchedReleaseRunEvidenceCount) > 0;
  const finalReleaseGateReady =
    readString(productionReleaseRunActionPacket.releaseGateStatus, "") === "ready" &&
    readString(approvalGate.status, "") === "approval-gate-ready" &&
    approvalGate.summary?.releaseReady === true &&
    packageGatePassed &&
    packageGateReleaseReady &&
    enterpriseAuditPreflightCleared &&
    releaseRunConsistencyCleared;
  const requiredEvidence = uniqueStrings([
    ...readStringArray(ownerResponseValidation.requiredEvidenceAfterApproval),
    ...readStringArray(releaseRunStage.requiredEvidence),
    ...readStringArray(productionReleaseRunActionPacket.requiredEvidence),
  ]);
  const safeCommandTemplates = buildSafeCommandTemplates({
    actionPacket: productionReleaseRunActionPacket,
    ownerResponseValidation,
  });
  const upstreamBlockers = uniqueStrings([
    ...(!enterpriseAuditPreflightCleared ? ["enterprise-live-evidence-audit-not-ready"] : []),
    ...(!packageGateReleaseReady ? ["package-gate-not-release-ready"] : []),
    ...readStringArray(enterpriseAuditPreflight.upstreamBlockers),
  ]);
  const blockedReasons = uniqueStrings([
    ...(!releaseRunStageWaitingForUpstreamEvidence
      ? ["production-release-run-stage-not-waiting-for-upstream-evidence"]
      : []),
    ...(!finalReleaseGateReady ? ["final-release-gate-not-ready"] : []),
    ...(!enterpriseAuditPreflightCleared ? ["enterprise-live-evidence-audit-not-ready"] : []),
    ...(!releaseRunConsistencyCleared ? ["release-run-consistency-not-cleared"] : []),
    ...(!ownerResponseAccepted ? ["production-release-run-owner-response-not-accepted"] : []),
    ...(!releaseRunBindingMayProceedAfterSeparateOwnerAction
      ? ["release-run-binding-not-approved-for-separate-owner-action"]
      : []),
    ...readStringArray(productionReleaseRunActionPacket.blockedReasons),
  ]);
  const status = !releaseRunStageWaitingForUpstreamEvidence
    ? "production-release-run-production-evidence-preflight-blocked"
    : !finalReleaseGateReady
      ? "production-release-run-production-evidence-preflight-waiting-for-final-release-gate"
      : !ownerResponseAccepted
        ? "production-release-run-production-evidence-preflight-waiting-for-owner-release-labels"
        : !releaseRunBindingMayProceedAfterSeparateOwnerAction
          ? "production-release-run-production-evidence-preflight-waiting-for-binding-approval"
          : "production-release-run-production-evidence-preflight-ready";

  return {
    target: "production-release-run-production-evidence-preflight",
    status,
    releaseReady: false,
    responsibleSession: "S22/S10/S25",
    ownerDecisionId: decisionId,
    summary: {
      ownerResponseAccepted,
      releaseRunStageWaitingForUpstreamEvidence,
      packageGatePassed,
      packageGateReleaseReady,
      enterpriseAuditPreflightCleared,
      finalReleaseGateReady,
      releaseRunConsistencyCleared,
      releaseRunBindingMayProceedAfterSeparateOwnerAction,
      releaseRunBindingPerformed,
      waitingReleaseRunEvidenceCount: readNumber(
        currentEvidenceSummary.waitingReleaseRunEvidenceCount,
      ),
      matchedReleaseRunEvidenceCount: readNumber(
        currentEvidenceSummary.matchedReleaseRunEvidenceCount,
      ),
      requiredEvidenceCount: requiredEvidence.length,
      commandTemplateCount: Object.keys(safeCommandTemplates).length,
      releaseReady: false,
    },
    upstreamBlockers,
    releaseGateRequirementIds: uniqueStrings([
      ...readStringArray(releaseRunStage.releaseGateRequirementIds),
      ...readStringArray(productionReleaseRunActionPacket.releaseGateRequirementIds),
    ]),
    enterpriseAuditMissingTargets: readStringArray(
      productionReleaseRunActionPacket.enterpriseAuditMissingTargets,
    ),
    requiredEvidence,
    blockedReasons,
    safeCommandTemplates,
    safeNextActions: uniqueStrings([
      ...readStringArray(productionReleaseRunActionPacket.safeNextActions),
      ...readStringArray(ownerResponseValidation.postValidationAllowedChecks),
    ]),
    forbiddenUntilEvidenceExists: uniqueStrings([
      ...readStringArray(productionReleaseRunActionPacket.forbiddenUntilApproved),
      ...readStringArray(ownerResponseValidation.stillForbiddenUntilSeparateApproval),
      "bind-release-run-id-while-release-gate-blocked",
      "bind-release-run-id-in-this-preflight",
      "mix-production-evidence-from-multiple-release-run-ids",
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
      liveSmokeRun: false,
      releaseGateRefreshPerformed: false,
      releaseRunBindingPerformed: false,
      noRemoteWritePerformed: true,
      noLiveMutationPerformed: true,
      noDeploymentMutationPerformed: true,
      noReleaseRunBindingPerformed: true,
      finalReleaseGateReadyEvidenceRequired: true,
      ownerApprovalRequired: true,
    },
  };
}

function buildSafeCommandTemplates({ actionPacket, ownerResponseValidation }) {
  const commandNames = uniqueStrings([
    ...Object.keys(readRecord(actionPacket.commands)),
    ...readStringArray(ownerResponseValidation.requiredCommandNames),
    "finalReleaseGateCheck",
    "releaseRunBindingReview",
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
  if (commandName === "finalReleaseGateCheck") {
    return "node -- scripts/production-e2e-release-gate.mjs <release-gate-inputs> > <production-e2e-release-gate-output>";
  }
  if (commandName === "releaseRunBindingReview") {
    return "review production-release-run-consistency in <production-e2e-release-gate-output> and bind one public release-run ID only after status is ready";
  }
  return `node scripts/${commandName}.mjs <redacted-production-release-inputs> > <${commandName}-evidence>`;
}

function sanitizeCommandTemplate(command) {
  return command
    .replace(/https?:\/\/\S+/g, "<raw-url-omitted>")
    .replace(/\/Users\/\S+/g, "<local-path-omitted>")
    .replace(/coordination\/reports/g, "<redacted-production-evidence-reports-dir>");
}

function renderMarkdown(report) {
  const lines = [
    "# UAIS Production Release Run Production Evidence Preflight",
    "",
    `Status: \`${report.status}\``,
    `Release ready: \`${report.releaseReady}\``,
    `Owner decision: \`${report.ownerDecisionId}\``,
    `Final release gate ready: \`${report.summary.finalReleaseGateReady}\``,
    `Enterprise audit preflight cleared: \`${report.summary.enterpriseAuditPreflightCleared}\``,
    `Release-run consistency cleared: \`${report.summary.releaseRunConsistencyCleared}\``,
    `Release-run binding performed: \`${report.summary.releaseRunBindingPerformed}\``,
    "",
    "This preflight reads only existing redacted coordination reports. It does not read env files, run production smokes, refresh the live release gate, deploy, call Vercel, or bind a release run.",
    "",
    "## Upstream Blockers",
    "",
    ...formatBullets(report.upstreamBlockers),
    "",
    "## Release Gate Requirements",
    "",
    ...formatBullets(report.releaseGateRequirementIds),
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

  if (report.enterpriseAuditMissingTargets.length > 0) {
    lines.push("", "## Enterprise Audit Missing Targets", "");
    lines.push(...formatBullets(report.enterpriseAuditMissingTargets));
  }

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
  return ["ready", "passed", "complete", "completed", "matched", "consistent", "ok"].includes(
    readString(value, "unknown"),
  );
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
