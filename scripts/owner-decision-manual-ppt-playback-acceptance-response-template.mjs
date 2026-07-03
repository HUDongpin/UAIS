#!/usr/bin/env node

import { readFileSync } from "node:fs";

const decisionId = "manual-ppt-playback-acceptance";
const ownerResponseValidationCommand =
  "node scripts/owner-decision-manual-ppt-playback-acceptance-response-validation.mjs --owner-response-template coordination/reports/<this-template-json> --owner-response path/to/filled-owner-response.json";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const ownerDecisionQueue = readJsonArg(args, "owner-decision-queue");
  const manualPptActionPacket = readJsonArg(args, "manual-ppt-action-packet");
  const report = buildReport({ ownerDecisionQueue, manualPptActionPacket });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(report));
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function buildReport({ ownerDecisionQueue, manualPptActionPacket }) {
  const queue = readRecordArray(ownerDecisionQueue.queue);
  const queueItem = queue.find((item) => item.id === decisionId) ?? null;
  const upstreamBlockedDecisionIds = queue
    .filter(
      (item) =>
        Number.isInteger(item.rank) &&
        Number.isInteger(queueItem?.rank) &&
        item.rank < queueItem.rank &&
        readString(item.status, "") !== "satisfied",
    )
    .map((item) => readString(item.id, "unknown-decision"));
  const templateAvailable = queueItem !== null && manualPptActionPacket.decisionId === decisionId;
  const status = !queueItem
    ? "decision-not-in-owner-queue"
    : upstreamBlockedDecisionIds.length > 0
      ? "queued-awaiting-post-deployment-human-qa"
      : "awaiting-owner-response";
  const requiredApplications = readStringArray(manualPptActionPacket.requiredApplications);
  const requiredEvidence = readStringArray(manualPptActionPacket.requiredEvidence);
  const requiredCommandNames = Object.keys(readRecord(manualPptActionPacket.commands));
  const currentEvidenceSummary = sanitizeEvidenceSummary(
    manualPptActionPacket.currentEvidenceSummary,
  );
  const ownerResponseTemplate = templateAvailable
    ? buildOwnerResponseTemplate({
        currentEvidenceSummary,
        requiredApplications,
        requiredEvidence,
        requiredCommandNames,
      })
    : null;

  return {
    target: "owner-decision-manual-ppt-playback-acceptance-response-template",
    status,
    decisionId,
    responsibleSession: "S24/S22/S10",
    summary: {
      queueRank: Number.isInteger(queueItem?.rank) ? queueItem.rank : null,
      queueStatus: readString(queueItem?.status, "missing"),
      actionPacketStatus: readString(manualPptActionPacket.status, "unknown"),
      upstreamBlockedDecisionCount: upstreamBlockedDecisionIds.length,
      requiredApplicationCount: requiredApplications.length,
      requiredEvidenceCount: requiredEvidence.length,
      requiredCommandNameCount: requiredCommandNames.length,
      expectedSlideCount: readNumber(currentEvidenceSummary.expectedSlideCount),
      releaseReady: false,
    },
    upstreamBlockedDecisionIds,
    ownerRequestSummary: templateAvailable
      ? {
          ownerInputRequired: readString(queueItem.nextOwnerQuestion, ""),
          requiredApplications,
          requiredEvidence,
          forbiddenUntilApproved: normalizeForbiddenActions(
            manualPptActionPacket.forbiddenUntilApproved,
          ),
        }
      : null,
    ownerResponseTemplate,
    ownerResponseValidationCommand: templateAvailable ? ownerResponseValidationCommand : null,
    copySafeOwnerReplyStub: ownerResponseTemplate ? buildCopySafeOwnerReplyStub() : null,
    postResponseAllowedChecks: templateAvailable
      ? [
          "validate-owner-response-shape",
          "confirm-no-private-paths-audio-urls-or-credential-values-in-owner-response",
          "prepare-final-manual-ppt-playback-acceptance-evidence-after-human-record",
          "prepare-enterprise-audit-evidence-collection-after-manual-acceptance",
        ]
      : [],
    stillForbiddenUntilSeparateApproval: templateAvailable
      ? uniqueStrings([
          ...normalizeForbiddenActions(manualPptActionPacket.forbiddenUntilApproved),
          "mark-manual-ppt-accepted-before-human-playback",
          "reuse-manual-ppt-record-from-different-release-run",
          "reuse-manual-ppt-record-from-different-vercel-deployment",
          "accept-machine-preflight-as-final-human-acceptance",
          "bind-production-release-run-id",
        ])
      : [],
    safety: {
      sourcePathsOmitted: true,
      packagePathsOmitted: true,
      audioUrlsOmitted: true,
      rawUrlsOmitted: true,
      credentialValuesOmitted: true,
      responseBodiesOmitted: true,
      commandBodiesOmitted: true,
      manualAcceptancePerformed: false,
      machineEvidenceDoesNotCountAsAcceptance: true,
      humanPlaybackRequired: true,
      noLiveMutationPerformed: true,
      noDeploymentMutationPerformed: true,
      noReleaseRunBindingPerformed: true,
    },
  };
}

function buildOwnerResponseTemplate({
  currentEvidenceSummary,
  requiredApplications,
  requiredEvidence,
  requiredCommandNames,
}) {
  return {
    responseStatus: "owner-response-required",
    decisionId,
    approvedPowerPointPlaybackEvidenceLabel: null,
    approvedWpsPlaybackEvidenceLabel: null,
    approvedManualAcceptanceRecordLabel: null,
    approvedReleaseRunIdLabel: null,
    approvedVercelProductionDeploymentEvidenceLabel: null,
    approvedTargetClonedVoiceLabel: null,
    approvedSlideAudioChecklistLabel: null,
    approvedTestedAtTimestampLabel: null,
    confirmsNoPrivatePathsAudioUrlsOrCredentialValuesInResponse: false,
    confirmsHumanPowerPointPlaybackAccepted: false,
    confirmsHumanWpsPlaybackAccepted: false,
    confirmsAcceptedAfterHumanPlayback: false,
    confirmsAll19SlideAudioChecksTrue: false,
    confirmsTargetClonedVoiceHeardPerSlide: false,
    confirmsSameReleaseRunAndVercelDeploymentBinding: false,
    confirmsMachinePreflightNotUsedAsFinalHumanAcceptance: false,
    requiredApplications,
    requiredEvidenceAfterApproval: requiredEvidence,
    requiredCommandNames,
    currentEvidenceSummary,
  };
}

function buildCopySafeOwnerReplyStub() {
  return {
    responseStatus: "owner-response-provided",
    decisionId,
    approvedPowerPointPlaybackEvidenceLabel:
      "<label only; no private path, package filename, or audio URL>",
    approvedWpsPlaybackEvidenceLabel:
      "<label only; no private path, package filename, or audio URL>",
    approvedManualAcceptanceRecordLabel: "<label only; no private reviewer path>",
    approvedReleaseRunIdLabel: "<label only; no URL, token, or cookie>",
    approvedVercelProductionDeploymentEvidenceLabel:
      "<label only; no deployment URL or response body>",
    approvedTargetClonedVoiceLabel: "<label only; no audio URL>",
    approvedSlideAudioChecklistLabel: "<label only; no audio file names or URLs>",
    approvedTestedAtTimestampLabel: "<label only; no local reviewer path>",
    confirmsNoPrivatePathsAudioUrlsOrCredentialValuesInResponse: true,
    confirmsHumanPowerPointPlaybackAccepted: true,
    confirmsHumanWpsPlaybackAccepted: true,
    confirmsAcceptedAfterHumanPlayback: true,
    confirmsAll19SlideAudioChecksTrue: true,
    confirmsTargetClonedVoiceHeardPerSlide: true,
    confirmsSameReleaseRunAndVercelDeploymentBinding: true,
    confirmsMachinePreflightNotUsedAsFinalHumanAcceptance: true,
  };
}

function renderMarkdown(report) {
  const lines = [
    "# UAIS Manual PPT Playback Acceptance Response Template",
    "",
    `Status: \`${report.status}\``,
    `Decision: \`${report.decisionId}\``,
    `Queue rank: \`${report.summary.queueRank ?? "missing"}\``,
    `Release ready: \`${report.summary.releaseReady}\``,
    "",
    "Do not include private PPT package paths, audio URLs, credential values, or local reviewer paths. Provide redacted labels and human acceptance flags only.",
  ];

  if (report.ownerResponseTemplate) {
    lines.push(
      "",
      "## Owner Input Needed",
      "",
      report.ownerRequestSummary?.ownerInputRequired ?? "",
      "",
      "## Required Applications",
      "",
      ...formatBullets(report.ownerResponseTemplate.requiredApplications),
      "",
      "## Response Fields",
      "",
      "- `approvedPowerPointPlaybackEvidenceLabel`",
      "- `approvedWpsPlaybackEvidenceLabel`",
      "- `approvedManualAcceptanceRecordLabel`",
      "- `approvedReleaseRunIdLabel`",
      "- `approvedVercelProductionDeploymentEvidenceLabel`",
      "- `approvedTargetClonedVoiceLabel`",
      "- `approvedSlideAudioChecklistLabel`",
      "- `approvedTestedAtTimestampLabel`",
      "- `confirmsNoPrivatePathsAudioUrlsOrCredentialValuesInResponse`",
      "- `confirmsHumanPowerPointPlaybackAccepted`",
      "- `confirmsHumanWpsPlaybackAccepted`",
      "- `confirmsAcceptedAfterHumanPlayback`",
      "- `confirmsAll19SlideAudioChecksTrue`",
      "- `confirmsTargetClonedVoiceHeardPerSlide`",
      "- `confirmsSameReleaseRunAndVercelDeploymentBinding`",
      "- `confirmsMachinePreflightNotUsedAsFinalHumanAcceptance`",
      "",
      "## Copy-Safe Owner Reply Stub",
      "",
      "```json",
      JSON.stringify(report.copySafeOwnerReplyStub, null, 2),
      "```",
      "",
      "## Validation Command",
      "",
      "```sh",
      report.ownerResponseValidationCommand,
      "```",
      "",
      "## Required Evidence After Approval",
      "",
      ...formatBullets(report.ownerResponseTemplate.requiredEvidenceAfterApproval),
      "",
      "## Required Command Names",
      "",
      ...formatBullets(report.ownerResponseTemplate.requiredCommandNames),
    );
  }

  if (report.upstreamBlockedDecisionIds.length > 0) {
    lines.push("", "## Upstream Decisions Still Blocking", "");
    lines.push(...formatBullets(report.upstreamBlockedDecisionIds));
  }

  if (report.stillForbiddenUntilSeparateApproval.length > 0) {
    lines.push("", "## Still Forbidden Until Separate Approval", "");
    lines.push(...formatBullets(report.stillForbiddenUntilSeparateApproval));
  }

  return `${lines.join("\n")}\n`;
}

function normalizeForbiddenActions(values) {
  return readStringArray(values);
}

function sanitizeEvidenceSummary(summary) {
  if (!isRecord(summary)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(summary).filter(
      ([, value]) =>
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        value === null,
    ),
  );
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

function readNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string"))];
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
