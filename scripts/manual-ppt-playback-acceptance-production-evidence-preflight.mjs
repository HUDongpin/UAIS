#!/usr/bin/env node

import { readFileSync } from "node:fs";

const decisionId = "manual-ppt-playback-acceptance";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const ownerResponseValidation = readJsonArg(args, "owner-response-validation");
  const approvalGate = readJsonArg(args, "approval-gate");
  const manualPptActionPacket = readJsonArg(args, "manual-ppt-action-packet");
  const vercelEnvDeployPreflight = args["vercel-env-deploy-preflight"]
    ? readJsonArg(args, "vercel-env-deploy-preflight")
    : {};
  const report = buildPreflight({
    ownerResponseValidation,
    approvalGate,
    manualPptActionPacket,
    vercelEnvDeployPreflight,
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
  manualPptActionPacket,
  vercelEnvDeployPreflight,
}) {
  const ownerResponseAccepted =
    readString(ownerResponseValidation.status, "") === "owner-response-accepted" &&
    ownerResponseValidation.summary?.humanQaMayProceedToFinalEvidence === true;
  const stages = readRecordArray(approvalGate.stages);
  const manualStage = stages.find((stage) => readString(stage.id, "") === decisionId) || {};
  const manualStageAcceptedAwaitingEvidence =
    readString(manualStage.queueStatus, "") === "accepted" &&
    readString(manualStage.currentStatus, "") === "accepted-awaiting-production-evidence" &&
    manualStage.ownerResponseAccepted === true;
  const ownerConfirmedHumanPlaybackEvidence = ownerConfirmsHumanPlaybackEvidence(
    ownerResponseValidation.redactedOwnerResponse,
  );
  const vercelProductionDeploymentEvidenceCleared =
    deploymentEvidenceCleared(vercelEnvDeployPreflight);
  const releaseRunBindingStillForbidden =
    ownerResponseValidation.summary?.releaseRunBindingStillForbidden === true;
  const requiredEvidence = uniqueStrings([
    ...readStringArray(ownerResponseValidation.requiredEvidenceAfterApproval),
    ...readStringArray(manualStage.requiredEvidence),
    ...readStringArray(manualPptActionPacket.requiredEvidence),
  ]);
  const provedOwnerConfirmedEvidence = requiredEvidence.filter((evidence) =>
    isOwnerConfirmedEvidence(evidence, ownerResponseValidation.redactedOwnerResponse),
  );
  const deployBoundEvidence = new Set(
    vercelProductionDeploymentEvidenceCleared && !releaseRunBindingStillForbidden
      ? [
          "same-release-run-id-bound-to-manual-record",
          "same-vercel-production-deployment-bound-to-manual-playback-record",
        ]
      : [],
  );
  const provedSet = new Set([...provedOwnerConfirmedEvidence, ...deployBoundEvidence]);
  const missingEvidence = requiredEvidence.filter((evidence) => !provedSet.has(evidence));
  const safeCommandTemplates = buildSafeCommandTemplates(manualPptActionPacket);
  const blockedReasons = [
    ...(!ownerResponseAccepted ? ["manual-ppt-owner-response-not-accepted"] : []),
    ...(!manualStageAcceptedAwaitingEvidence
      ? ["manual-ppt-stage-not-accepted-awaiting-production-evidence"]
      : []),
    ...(!ownerConfirmedHumanPlaybackEvidence
      ? ["owner-confirmed-human-playback-evidence-incomplete"]
      : []),
    ...(!vercelProductionDeploymentEvidenceCleared
      ? ["vercel-production-deployment-evidence-not-cleared"]
      : []),
    ...(releaseRunBindingStillForbidden ? ["release-run-binding-still-forbidden"] : []),
    ...missingEvidence.map((evidence) => `${evidence}-missing`),
  ];
  const status =
    ownerResponseAccepted &&
    manualStageAcceptedAwaitingEvidence &&
    ownerConfirmedHumanPlaybackEvidence
      ? vercelProductionDeploymentEvidenceCleared && !releaseRunBindingStillForbidden
        ? "manual-ppt-playback-acceptance-production-evidence-preflight-ready"
        : "manual-ppt-playback-acceptance-production-evidence-preflight-waiting-for-production-deployment-binding"
      : "manual-ppt-playback-acceptance-production-evidence-preflight-blocked";

  return {
    target: "manual-ppt-playback-acceptance-production-evidence-preflight",
    status,
    releaseReady: false,
    responsibleSession: "S24/S22/S10",
    ownerDecisionId: decisionId,
    approvedPowerPointPlaybackEvidenceLabel: readString(
      ownerResponseValidation.redactedOwnerResponse?.approvedPowerPointPlaybackEvidenceLabel,
      "none-recorded",
    ),
    approvedWpsPlaybackEvidenceLabel: readString(
      ownerResponseValidation.redactedOwnerResponse?.approvedWpsPlaybackEvidenceLabel,
      "none-recorded",
    ),
    approvedManualAcceptanceRecordLabel: readString(
      ownerResponseValidation.redactedOwnerResponse?.approvedManualAcceptanceRecordLabel,
      "none-recorded",
    ),
    approvedReleaseRunIdLabel: readString(
      ownerResponseValidation.redactedOwnerResponse?.approvedReleaseRunIdLabel,
      "none-recorded",
    ),
    approvedVercelProductionDeploymentEvidenceLabel: readString(
      ownerResponseValidation.redactedOwnerResponse
        ?.approvedVercelProductionDeploymentEvidenceLabel,
      "none-recorded",
    ),
    summary: {
      ownerResponseAccepted,
      manualStageAcceptedAwaitingEvidence,
      ownerConfirmedHumanPlaybackEvidence,
      vercelProductionDeploymentEvidenceCleared,
      releaseRunBindingStillForbidden,
      requiredEvidenceCount: requiredEvidence.length,
      provedOwnerConfirmedEvidenceCount: provedOwnerConfirmedEvidence.length,
      missingEvidenceCount: missingEvidence.length,
      commandTemplateCount: Object.keys(safeCommandTemplates).length,
      releaseReady: false,
    },
    requiredEvidence,
    provedOwnerConfirmedEvidence,
    missingEvidence,
    blockedReasons,
    safeCommandTemplates,
    safeNextActions: uniqueStrings(readStringArray(manualPptActionPacket.safeNextActions)),
    forbiddenUntilEvidenceExists: uniqueStrings([
      ...readStringArray(ownerResponseValidation.stillForbiddenUntilSeparateApproval),
      ...readStringArray(manualPptActionPacket.forbiddenUntilApproved),
    ]),
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmittedFromMarkdown: true,
      deploymentUrlsOmitted: true,
      packagePathsOmitted: true,
      audioUrlsOmitted: true,
      credentialValuesOmitted: true,
      responseBodiesOmitted: true,
      envFileRead: false,
      manualAcceptancePerformed: false,
      machineEvidenceDoesNotCountAsAcceptance: true,
      humanPlaybackRequired: true,
      noLiveMutationPerformed: true,
      noDeploymentMutationPerformed: true,
      noReleaseRunBindingPerformed: true,
    },
  };
}

function ownerConfirmsHumanPlaybackEvidence(redactedOwnerResponse) {
  return [
    "confirmsHumanPowerPointPlaybackAccepted",
    "confirmsHumanWpsPlaybackAccepted",
    "confirmsAcceptedAfterHumanPlayback",
    "confirmsAll19SlideAudioChecksTrue",
    "confirmsTargetClonedVoiceHeardPerSlide",
    "confirmsMachinePreflightNotUsedAsFinalHumanAcceptance",
  ].every((field) => redactedOwnerResponse?.[field] === true);
}

function deploymentEvidenceCleared(vercelEnvDeployPreflight) {
  return (
    readString(vercelEnvDeployPreflight.status, "").includes("ready") &&
    vercelEnvDeployPreflight.releaseReady === true &&
    vercelEnvDeployPreflight.summary?.missingEvidenceCount === 0
  );
}

function isOwnerConfirmedEvidence(evidence, redactedOwnerResponse) {
  switch (evidence) {
    case "human-powerpoint-playback-accepted":
      return redactedOwnerResponse?.confirmsHumanPowerPointPlaybackAccepted === true;
    case "human-wps-playback-accepted":
      return redactedOwnerResponse?.confirmsHumanWpsPlaybackAccepted === true;
    case "explicit-accepted-after-human-playback-status":
      return redactedOwnerResponse?.confirmsAcceptedAfterHumanPlayback === true;
    case "valid-tested-at-timestamp":
      return isSafeLabel(redactedOwnerResponse?.approvedTestedAtTimestampLabel);
    case "all-19-slide-audio-checks-true":
      return redactedOwnerResponse?.confirmsAll19SlideAudioChecksTrue === true;
    case "target-cloned-voice-label-present":
      return isSafeLabel(redactedOwnerResponse?.approvedTargetClonedVoiceLabel);
    case "target-cloned-voice-heard-per-slide":
      return redactedOwnerResponse?.confirmsTargetClonedVoiceHeardPerSlide === true;
    default:
      return false;
  }
}

function buildSafeCommandTemplates(manualPptActionPacket) {
  const commands = isRecord(manualPptActionPacket.commands)
    ? manualPptActionPacket.commands
    : {};
  return {
    createManualRecordTemplate:
      typeof commands.createManualRecordTemplate === "string"
        ? commands.createManualRecordTemplate
        : "node scripts/ppt-manual-playback-acceptance.mjs --package-json <kangxia-package-json> --preflight-report <desktop-preflight-report> --openxml-integrity <openxml-integrity-evidence> --desktop-app-evidence <desktop-app-evidence> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --record-template-out <manual-record-template> > <ppt-manual-playback-gate-plan-evidence>",
    finalManualAcceptanceEvidence:
      typeof commands.finalManualAcceptanceEvidence === "string"
        ? commands.finalManualAcceptanceEvidence
        : "node scripts/ppt-manual-playback-acceptance.mjs --package-json <kangxia-package-json> --preflight-report <desktop-preflight-report> --manual-record <completed-human-manual-record> --openxml-integrity <openxml-integrity-evidence> --desktop-app-evidence <desktop-app-evidence> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> > <ppt-manual-playback-acceptance-evidence>",
  };
}

function renderMarkdown(report) {
  const lines = [
    "# UAIS Manual PPT Playback Acceptance Production Evidence Preflight",
    "",
    `Status: \`${report.status}\``,
    `Release ready: \`${report.releaseReady}\``,
    `Owner decision: \`${report.ownerDecisionId}\``,
    `Owner confirmed human playback evidence: \`${report.summary.ownerConfirmedHumanPlaybackEvidence}\``,
    `Vercel production deployment evidence cleared: \`${report.summary.vercelProductionDeploymentEvidenceCleared}\``,
    `Release-run binding still forbidden: \`${report.summary.releaseRunBindingStillForbidden}\``,
    `Missing evidence: ${report.summary.missingEvidenceCount}`,
    "",
    "This preflight reads only existing redacted coordination reports. It does not read env files, print labels, open presentation packages, log private paths or audio URLs, deploy, run live smokes, or bind a release run.",
    "",
    "## Proved Owner-Confirmed Evidence",
    "",
    ...formatBullets(report.provedOwnerConfirmedEvidence),
    "",
    "## Missing Evidence",
    "",
    ...formatBullets(report.missingEvidence),
    "",
    "## Safe Command Templates",
    "",
    "```sh",
    report.safeCommandTemplates.createManualRecordTemplate,
    report.safeCommandTemplates.finalManualAcceptanceEvidence,
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

function isSafeLabel(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9 .:_/-]{2,120}$/.test(value);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
