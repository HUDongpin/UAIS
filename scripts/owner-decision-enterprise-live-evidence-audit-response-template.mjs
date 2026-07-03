#!/usr/bin/env node

import { readFileSync } from "node:fs";

const decisionId = "enterprise-live-evidence-audit";
const ownerResponseValidationCommand =
  "node scripts/owner-decision-enterprise-live-evidence-audit-response-validation.mjs --owner-response-template coordination/reports/<this-template-json> --owner-response path/to/filled-owner-response.json";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const ownerDecisionQueue = readJsonArg(args, "owner-decision-queue");
  const enterpriseAuditActionPacket = readJsonArg(args, "enterprise-audit-action-packet");
  const report = buildReport({ ownerDecisionQueue, enterpriseAuditActionPacket });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(report));
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function buildReport({ ownerDecisionQueue, enterpriseAuditActionPacket }) {
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
  const templateAvailable =
    queueItem !== null && enterpriseAuditActionPacket.decisionId === decisionId;
  const status = !queueItem
    ? "decision-not-in-owner-queue"
    : upstreamBlockedDecisionIds.length > 0
      ? "queued-awaiting-all-production-live-evidence"
      : "awaiting-owner-response";
  const requiredTargets = readStringArray(enterpriseAuditActionPacket.requiredTargets);
  const missingRequiredTargets = readStringArray(
    enterpriseAuditActionPacket.missingRequiredTargets,
  );
  const requiredEvidence = readStringArray(enterpriseAuditActionPacket.requiredEvidence);
  const requiredCommandNames = Object.keys(readRecord(enterpriseAuditActionPacket.commands));
  const currentEvidenceSummary = sanitizeEvidenceSummary(
    enterpriseAuditActionPacket.currentEvidenceSummary,
  );

  return {
    target: "owner-decision-enterprise-live-evidence-audit-response-template",
    status,
    decisionId,
    responsibleSession: "S22/S10/S25",
    summary: {
      queueRank: Number.isInteger(queueItem?.rank) ? queueItem.rank : null,
      queueStatus: readString(queueItem?.status, "missing"),
      actionPacketStatus: readString(enterpriseAuditActionPacket.status, "unknown"),
      upstreamBlockedDecisionCount: upstreamBlockedDecisionIds.length,
      requiredTargetCount: requiredTargets.length,
      missingRequiredTargetCount: missingRequiredTargets.length,
      acceptedLiveEvidenceCount: readNumber(currentEvidenceSummary.acceptedLiveEvidence),
      requiredEvidenceCount: requiredEvidence.length,
      requiredCommandNameCount: requiredCommandNames.length,
      releaseReady: false,
    },
    upstreamBlockedDecisionIds,
    ownerRequestSummary: templateAvailable
      ? {
          ownerInputRequired: readString(queueItem.nextOwnerQuestion, ""),
          requiredTargets,
          missingRequiredTargets,
          requiredEvidence,
          forbiddenUntilApproved: readStringArray(
            enterpriseAuditActionPacket.forbiddenUntilApproved,
          ),
        }
      : null,
    ownerResponseTemplate: templateAvailable
      ? buildOwnerResponseTemplate({
          currentEvidenceSummary,
          requiredTargets,
          missingRequiredTargets,
          requiredEvidence,
          requiredCommandNames,
      })
      : null,
    ownerResponseValidationCommand: templateAvailable ? ownerResponseValidationCommand : null,
    copySafeOwnerReplyStub: templateAvailable ? buildCopySafeOwnerReplyStub() : null,
    postResponseAllowedChecks: templateAvailable
      ? [
          "validate-owner-response-shape",
          "confirm-no-raw-urls-local-paths-cookies-or-credential-values-in-owner-response",
          "prepare-enterprise-live-evidence-audit-command-after-all-target-evidence-exists",
          "prepare-release-gate-refresh-after-enterprise-audit-passes",
        ]
      : [],
    stillForbiddenUntilSeparateApproval: templateAvailable
      ? uniqueStrings([
          ...readStringArray(enterpriseAuditActionPacket.forbiddenUntilApproved),
          "run-enterprise-live-evidence-audit-before-all-target-evidence-exists",
          "refresh-production-release-gate-with-missing-enterprise-audit",
          "bind-production-release-run-id",
        ])
      : [],
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      cookieValuesOmitted: true,
      credentialValuesOmitted: true,
      responseBodiesOmitted: true,
      commandBodiesOmitted: true,
      fileContentsOmitted: true,
      noLiveAuditRun: true,
      noLiveMutationPerformed: true,
      noDeploymentMutationPerformed: true,
      noReleaseRunBindingPerformed: true,
      filenameOnlyEvidenceRejected: true,
      liveEvidenceRequired: true,
    },
  };
}

function buildOwnerResponseTemplate({
  currentEvidenceSummary,
  requiredTargets,
  missingRequiredTargets,
  requiredEvidence,
  requiredCommandNames,
}) {
  return {
    responseStatus: "owner-response-required",
    decisionId,
    approvedEnterpriseLiveEvidenceAuditProofLabel: null,
    approvedProductionLiveEvidenceSetLabel: null,
    approvedSharedReleaseRunIdLabel: null,
    approvedSafetyRedactionFlagsLabel: null,
    approvedTargetResultProofSetLabel: null,
    approvedTargetContractProofSetLabel: null,
    approvedRejectedFilenameOnlyEvidenceLabel: null,
    confirmsNoRawUrlsLocalPathsCookiesOrCredentialValuesInResponse: false,
    confirmsAll16RequiredTargetsBodyProven: false,
    confirmsFilenameOnlyOrBlockedEvidenceRejected: false,
    confirmsSharedReleaseRunIdAcrossProductionEvidence: false,
    confirmsRequiredSafetyFlagsPresent: false,
    confirmsTargetSpecificResultAndContractProofsPresent: false,
    confirmsLocalOrDryRunEvidenceNotAccepted: false,
    confirmsAuditRunRequiresAllEvidenceBeforeExecution: false,
    requiredTargets,
    missingRequiredTargets,
    requiredEvidenceAfterApproval: requiredEvidence,
    requiredCommandNames,
    currentEvidenceSummary,
  };
}

function buildCopySafeOwnerReplyStub() {
  return {
    responseStatus: "owner-response-provided",
    decisionId,
    approvedEnterpriseLiveEvidenceAuditProofLabel:
      "<label only; no URL, local path, cookie, or credential value>",
    approvedProductionLiveEvidenceSetLabel:
      "<label only; no URL, local path, cookie, or credential value>",
    approvedSharedReleaseRunIdLabel: "<label only; no URL, token, or cookie>",
    approvedSafetyRedactionFlagsLabel:
      "<label only; no URL, local path, cookie, or credential value>",
    approvedTargetResultProofSetLabel:
      "<label only; no URL, local path, cookie, or credential value>",
    approvedTargetContractProofSetLabel:
      "<label only; no URL, local path, cookie, or credential value>",
    approvedRejectedFilenameOnlyEvidenceLabel:
      "<label only; no URL, local path, cookie, or credential value>",
    confirmsNoRawUrlsLocalPathsCookiesOrCredentialValuesInResponse: true,
    confirmsAll16RequiredTargetsBodyProven: true,
    confirmsFilenameOnlyOrBlockedEvidenceRejected: true,
    confirmsSharedReleaseRunIdAcrossProductionEvidence: true,
    confirmsRequiredSafetyFlagsPresent: true,
    confirmsTargetSpecificResultAndContractProofsPresent: true,
    confirmsLocalOrDryRunEvidenceNotAccepted: true,
    confirmsAuditRunRequiresAllEvidenceBeforeExecution: true,
  };
}

function renderMarkdown(report) {
  const lines = [
    "# UAIS Enterprise Live Evidence Audit Response Template",
    "",
    `Status: \`${report.status}\``,
    `Decision: \`${report.decisionId}\``,
    `Queue rank: \`${report.summary.queueRank ?? "missing"}\``,
    `Release ready: \`${report.summary.releaseReady}\``,
    "",
    "Do not include raw URLs, local paths, cookie values, response bodies, or credential values. Provide redacted labels and audit-readiness flags only.",
  ];

  if (report.ownerResponseTemplate) {
    lines.push(
      "",
      "## Owner Input Needed",
      "",
      report.ownerRequestSummary?.ownerInputRequired ?? "",
      "",
      "## Response Fields",
      "",
      "- `approvedEnterpriseLiveEvidenceAuditProofLabel`",
      "- `approvedProductionLiveEvidenceSetLabel`",
      "- `approvedSharedReleaseRunIdLabel`",
      "- `approvedSafetyRedactionFlagsLabel`",
      "- `approvedTargetResultProofSetLabel`",
      "- `approvedTargetContractProofSetLabel`",
      "- `approvedRejectedFilenameOnlyEvidenceLabel`",
      "- `confirmsNoRawUrlsLocalPathsCookiesOrCredentialValuesInResponse`",
      "- `confirmsAll16RequiredTargetsBodyProven`",
      "- `confirmsFilenameOnlyOrBlockedEvidenceRejected`",
      "- `confirmsSharedReleaseRunIdAcrossProductionEvidence`",
      "- `confirmsRequiredSafetyFlagsPresent`",
      "- `confirmsTargetSpecificResultAndContractProofsPresent`",
      "- `confirmsLocalOrDryRunEvidenceNotAccepted`",
      "- `confirmsAuditRunRequiresAllEvidenceBeforeExecution`",
      "",
      "## Required Targets",
      "",
      ...formatBullets(report.ownerResponseTemplate.requiredTargets),
      "",
      "## Missing Required Targets",
      "",
      ...formatBullets(report.ownerResponseTemplate.missingRequiredTargets),
      "",
      "## Required Evidence After Approval",
      "",
      ...formatBullets(report.ownerResponseTemplate.requiredEvidenceAfterApproval),
      "",
      "## Required Command Names",
      "",
      ...formatBullets(report.ownerResponseTemplate.requiredCommandNames),
    );

    lines.push(
      "",
      "## Copy-Safe Owner Reply Stub",
      "",
      "Use this JSON shape only after replacing placeholder labels with owner-approved redacted labels. Do not add raw URLs, local paths, cookie values, response bodies, or credential values.",
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
