#!/usr/bin/env node

import { readFileSync } from "node:fs";

const decisionId = "production-release-run";
const ownerResponseValidationCommand =
  "node scripts/owner-decision-production-release-run-response-validation.mjs --owner-response-template coordination/reports/<this-template-json> --owner-response path/to/filled-owner-response.json";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const ownerDecisionQueue = readJsonArg(args, "owner-decision-queue");
  const productionReleaseRunActionPacket = readJsonArg(
    args,
    "production-release-run-action-packet",
  );
  const report = buildReport({ ownerDecisionQueue, productionReleaseRunActionPacket });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(report));
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function buildReport({ ownerDecisionQueue, productionReleaseRunActionPacket }) {
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
    queueItem !== null && productionReleaseRunActionPacket.decisionId === decisionId;
  const blockedReasons = readStringArray(productionReleaseRunActionPacket.blockedReasons);
  const finalReleaseGateReady =
    readString(productionReleaseRunActionPacket.releaseGateStatus, "unknown") === "ready" &&
    blockedReasons.length === 0;
  const status = !queueItem
    ? "decision-not-in-owner-queue"
    : finalReleaseGateReady && upstreamBlockedDecisionIds.length === 0
      ? "awaiting-owner-response"
      : "queued-awaiting-final-release-gate";
  const releaseGateRequirementIds = readStringArray(
    productionReleaseRunActionPacket.releaseGateRequirementIds,
  );
  const missingEnterpriseAuditTargets = readStringArray(
    productionReleaseRunActionPacket.enterpriseAuditMissingTargets,
  );
  const requiredEvidence = readStringArray(productionReleaseRunActionPacket.requiredEvidence);
  const requiredCommandNames = Object.keys(readRecord(productionReleaseRunActionPacket.commands));
  const currentEvidenceSummary = sanitizeEvidenceSummary(
    productionReleaseRunActionPacket.currentEvidenceSummary,
  );
  const safeNextActions = readStringArray(productionReleaseRunActionPacket.safeNextActions);

  return {
    target: "owner-decision-production-release-run-response-template",
    status,
    decisionId,
    responsibleSession: "S22/S10/S25",
    summary: {
      queueRank: Number.isInteger(queueItem?.rank) ? queueItem.rank : null,
      queueStatus: readString(queueItem?.status, "missing"),
      actionPacketStatus: readString(productionReleaseRunActionPacket.status, "unknown"),
      upstreamBlockedDecisionCount: upstreamBlockedDecisionIds.length,
      blockedReasonCount: blockedReasons.length,
      releaseGateRequirementCount: releaseGateRequirementIds.length,
      missingEnterpriseAuditTargetCount: missingEnterpriseAuditTargets.length,
      requiredEvidenceCount: requiredEvidence.length,
      requiredCommandNameCount: requiredCommandNames.length,
      waitingReleaseRunEvidenceCount: readNumber(
        currentEvidenceSummary.waitingReleaseRunEvidenceCount,
      ),
      matchedReleaseRunEvidenceCount: readNumber(
        currentEvidenceSummary.matchedReleaseRunEvidenceCount,
      ),
      releaseReady: false,
    },
    upstreamBlockedDecisionIds,
    ownerRequestSummary: templateAvailable
      ? {
          ownerInputRequired: readString(queueItem.nextOwnerQuestion, ""),
          blockedReasons,
          releaseGateRequirementIds,
          missingEnterpriseAuditTargets,
          requiredEvidence,
          safeNextActions,
          forbiddenUntilApproved: readStringArray(
            productionReleaseRunActionPacket.forbiddenUntilApproved,
          ),
        }
      : null,
    ownerResponseTemplate: templateAvailable
      ? buildOwnerResponseTemplate({
          blockedReasons,
          currentEvidenceSummary,
          releaseGateRequirementIds,
          missingEnterpriseAuditTargets,
          requiredEvidence,
          requiredCommandNames,
          safeNextActions,
      })
      : null,
    ownerResponseValidationCommand: templateAvailable ? ownerResponseValidationCommand : null,
    copySafeOwnerReplyStub: templateAvailable ? buildCopySafeOwnerReplyStub() : null,
    postResponseAllowedChecks: templateAvailable
      ? [
          "validate-owner-response-shape",
          "confirm-no-raw-urls-local-paths-cookies-or-credential-values-in-owner-response",
          "confirm-final-release-gate-ready-before-binding-release-run",
          "prepare-redacted-production-release-run-summary-after-owner-approval",
        ]
      : [],
    stillForbiddenUntilSeparateApproval: templateAvailable
      ? uniqueStrings([
          ...readStringArray(productionReleaseRunActionPacket.forbiddenUntilApproved),
          "execute-release-run-binding-in-this-template",
          "bind-release-run-id-before-enterprise-live-evidence-audit-ready",
          "publish-release-summary-with-private-source-paths-or-raw-urls",
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
      noLiveSmokeRun: true,
      noLiveMutationPerformed: true,
      noDeploymentMutationPerformed: true,
      noReleaseRunBindingPerformed: true,
      releaseGateStillBlocked: !finalReleaseGateReady,
      liveEvidenceRequired: true,
    },
  };
}

function buildOwnerResponseTemplate({
  blockedReasons,
  currentEvidenceSummary,
  releaseGateRequirementIds,
  missingEnterpriseAuditTargets,
  requiredEvidence,
  requiredCommandNames,
  safeNextActions,
}) {
  return {
    responseStatus: "owner-response-required",
    decisionId,
    approvedFinalReleaseGateReadyEvidenceLabel: null,
    approvedOwnerChecklistClearEvidenceLabel: null,
    approvedEnterpriseLiveEvidenceAuditReadyLabel: null,
    approvedSharedReleaseRunIdLabel: null,
    approvedVercelProductionDeploymentEvidenceLabel: null,
    approvedProductionEvidenceSetLabel: null,
    approvedRedactedReleaseSummaryLabel: null,
    approvedRollbackOrHoldPlanLabel: null,
    confirmsNoRawUrlsLocalPathsCookiesOrCredentialValuesInResponse: false,
    confirmsProductionReleaseGateReady: false,
    confirmsOwnerChecklistHasNoWaitingOrBlockedDecisions: false,
    confirmsAllProductionEvidenceUsesSameReleaseRunId: false,
    confirmsEnterpriseLiveEvidenceAuditReady: false,
    confirmsNoMixedDeploymentOrReleaseRunEvidence: false,
    confirmsReleaseSummaryIsRedacted: false,
    confirmsOwnerApprovesFinalReleaseRunBinding: false,
    releaseGateRequirementIds,
    missingEnterpriseAuditTargets,
    blockedReasons,
    requiredEvidenceAfterApproval: requiredEvidence,
    requiredCommandNames,
    safeNextActionsAfterApproval: safeNextActions,
    currentEvidenceSummary,
  };
}

function buildCopySafeOwnerReplyStub() {
  return {
    responseStatus: "owner-response-provided",
    decisionId,
    approvedFinalReleaseGateReadyEvidenceLabel:
      "<label only; no URL, local path, cookie, or credential value>",
    approvedOwnerChecklistClearEvidenceLabel:
      "<label only; no URL, local path, cookie, or credential value>",
    approvedEnterpriseLiveEvidenceAuditReadyLabel:
      "<label only; no URL, local path, cookie, or credential value>",
    approvedSharedReleaseRunIdLabel: "<label only; no URL, token, or cookie>",
    approvedVercelProductionDeploymentEvidenceLabel:
      "<label only; no URL, local path, cookie, or credential value>",
    approvedProductionEvidenceSetLabel:
      "<label only; no URL, local path, cookie, or credential value>",
    approvedRedactedReleaseSummaryLabel:
      "<label only; no URL, local path, cookie, or credential value>",
    approvedRollbackOrHoldPlanLabel:
      "<label only; no URL, local path, cookie, or credential value>",
    confirmsNoRawUrlsLocalPathsCookiesOrCredentialValuesInResponse: true,
    confirmsProductionReleaseGateReady: true,
    confirmsOwnerChecklistHasNoWaitingOrBlockedDecisions: true,
    confirmsAllProductionEvidenceUsesSameReleaseRunId: true,
    confirmsEnterpriseLiveEvidenceAuditReady: true,
    confirmsNoMixedDeploymentOrReleaseRunEvidence: true,
    confirmsReleaseSummaryIsRedacted: true,
    confirmsOwnerApprovesFinalReleaseRunBinding: true,
  };
}

function renderMarkdown(report) {
  const lines = [
    "# UAIS Production Release Run Response Template",
    "",
    `Status: \`${report.status}\``,
    `Decision: \`${report.decisionId}\``,
    `Queue rank: \`${report.summary.queueRank ?? "missing"}\``,
    `Release ready: \`${report.summary.releaseReady}\``,
    "",
    "Do not include raw URLs, local paths, cookie values, response bodies, or credential values. Provide redacted labels and final-gate flags only.",
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
      "- `approvedFinalReleaseGateReadyEvidenceLabel`",
      "- `approvedOwnerChecklistClearEvidenceLabel`",
      "- `approvedEnterpriseLiveEvidenceAuditReadyLabel`",
      "- `approvedSharedReleaseRunIdLabel`",
      "- `approvedVercelProductionDeploymentEvidenceLabel`",
      "- `approvedProductionEvidenceSetLabel`",
      "- `approvedRedactedReleaseSummaryLabel`",
      "- `approvedRollbackOrHoldPlanLabel`",
      "- `confirmsNoRawUrlsLocalPathsCookiesOrCredentialValuesInResponse`",
      "- `confirmsProductionReleaseGateReady`",
      "- `confirmsOwnerChecklistHasNoWaitingOrBlockedDecisions`",
      "- `confirmsAllProductionEvidenceUsesSameReleaseRunId`",
      "- `confirmsEnterpriseLiveEvidenceAuditReady`",
      "- `confirmsNoMixedDeploymentOrReleaseRunEvidence`",
      "- `confirmsReleaseSummaryIsRedacted`",
      "- `confirmsOwnerApprovesFinalReleaseRunBinding`",
      "",
      "## Release Gate Requirements",
      "",
      ...formatBullets(report.ownerResponseTemplate.releaseGateRequirementIds),
      "",
      "## Missing Enterprise Audit Targets",
      "",
      ...formatBullets(report.ownerResponseTemplate.missingEnterpriseAuditTargets),
      "",
      "## Blocked Reasons",
      "",
      ...formatBullets(report.ownerResponseTemplate.blockedReasons),
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
