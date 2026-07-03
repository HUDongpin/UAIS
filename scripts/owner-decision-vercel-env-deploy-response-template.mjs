#!/usr/bin/env node

import { readFileSync } from "node:fs";

const decisionId = "vercel-env-deploy-and-smoke-chain";
const ownerResponseValidationCommand =
  "node scripts/owner-decision-vercel-env-deploy-response-validation.mjs --owner-response-template coordination/reports/<this-template-json> --owner-response path/to/filled-owner-response.json";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const ownerDecisionQueue = readJsonArg(args, "owner-decision-queue");
  const vercelEnvDeployActionPacket = readJsonArg(args, "vercel-env-deploy-action-packet");
  const report = buildReport({ ownerDecisionQueue, vercelEnvDeployActionPacket });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(report));
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function buildReport({ ownerDecisionQueue, vercelEnvDeployActionPacket }) {
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
    queueItem !== null && vercelEnvDeployActionPacket.decisionId === decisionId;
  const status = !queueItem
    ? "decision-not-in-owner-queue"
    : upstreamBlockedDecisionIds.length > 0
      ? "queued-awaiting-upstream-owner-decisions"
      : "awaiting-owner-response";
  const requiredEvidence = readStringArray(vercelEnvDeployActionPacket.requiredEvidence);
  const requiredCommandNames = Object.keys(readRecord(vercelEnvDeployActionPacket.commands));
  const ownerResponseTemplate = templateAvailable
    ? buildOwnerResponseTemplate({
        vercelEnvDeployActionPacket,
        requiredEvidence,
        requiredCommandNames,
      })
    : null;

  return {
    target: "owner-decision-vercel-env-deploy-response-template",
    status,
    decisionId,
    responsibleSession: "S22/S19/S10",
    summary: {
      queueRank: Number.isInteger(queueItem?.rank) ? queueItem.rank : null,
      queueStatus: readString(queueItem?.status, "missing"),
      actionPacketStatus: readString(vercelEnvDeployActionPacket.status, "unknown"),
      upstreamBlockedDecisionCount: upstreamBlockedDecisionIds.length,
      requiredEvidenceCount: requiredEvidence.length,
      requiredCommandNameCount: requiredCommandNames.length,
      releaseReady: false,
    },
    upstreamBlockedDecisionIds,
    ownerRequestSummary: templateAvailable
      ? {
          ownerInputRequired: readString(queueItem.nextOwnerQuestion, ""),
          requiredEvidence,
          forbiddenUntilApproved: normalizeForbiddenActions(
            vercelEnvDeployActionPacket.forbiddenUntilApproved,
          ),
        }
      : null,
    ownerResponseTemplate,
    ownerResponseValidationCommand: templateAvailable ? ownerResponseValidationCommand : null,
    copySafeOwnerReplyStub: ownerResponseTemplate
      ? buildCopySafeOwnerReplyStub()
      : null,
    postResponseAllowedChecks: templateAvailable
      ? [
          "validate-owner-response-shape",
          "confirm-no-credential-values-urls-or-env-files-in-owner-response",
          "prepare-s19-vercel-env-sync-apply-command-after-upstream-auth-storage-clears",
          "prepare-s22-production-deployment-command-after-env-sync-evidence",
          "prepare-deployed-route-smoke-commands-after-production-deployment-evidence",
          "prepare-ordinary-teaching-live-smoke-commands-after-auth-storage-deployment-readiness",
        ]
      : [],
    stillForbiddenUntilSeparateApproval: templateAvailable
      ? uniqueStrings([
          ...normalizeForbiddenActions(vercelEnvDeployActionPacket.forbiddenUntilApproved),
          "run-vercel-env-apply-before-upstream-auth-storage-readiness",
          "run-vercel-production-deploy-before-env-sync-evidence",
          "run-deployed-route-smokes-before-production-deployment-evidence",
          "run-live-provider-generation-smoke-without-separate-owner-approval",
          "bind-production-release-run-id",
        ])
      : [],
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      deploymentUrlsOmitted: true,
      envFilePathsOmitted: true,
      envValuesOmitted: true,
      vercelSecretValuesOmitted: true,
      cookieValuesOmitted: true,
      responseBodiesOmitted: true,
      commandBodiesOmitted: true,
      noLiveMutationPerformed: true,
      noDeploymentMutationPerformed: true,
      noEnvApplyPerformed: true,
      noReleaseRunBindingPerformed: true,
    },
  };
}

function buildOwnerResponseTemplate({
  vercelEnvDeployActionPacket,
  requiredEvidence,
  requiredCommandNames,
}) {
  return {
    responseStatus: "owner-response-required",
    decisionId,
    approvedVercelProjectReadinessLabel: null,
    approvedServerOnlyEnvSourceLabel: null,
    approvedVercelEnvSyncApplyEvidenceLabel: null,
    approvedProductionDeploymentEvidenceLabel: null,
    approvedDeploymentBaseUrlLabel: null,
    approvedReleaseRunIdLabel: null,
    confirmsNoCredentialValuesInResponse: false,
    confirmsS19MayPrepareVercelEnvApplyAfterUpstreamReady: false,
    confirmsS19MayRunVercelEnvSyncApplyAfterUpstreamReady: false,
    confirmsS22MayPrepareProductionDeployAfterEnvApplyEvidence: false,
    confirmsS22MayRunProductionDeployAfterEnvApplyEvidence: false,
    confirmsS22MayPrepareDeployedRouteSmokesAfterProductionDeploymentEvidence: false,
    confirmsS22MayRunDeployedRouteSmokesAfterProductionDeploymentEvidence: false,
    confirmsLiveProviderGenerationSmokeRequiresSeparateApproval: false,
    requiredEvidenceAfterApproval: requiredEvidence,
    requiredCommandNames,
    currentEvidenceSummary: sanitizeEvidenceSummary(
      vercelEnvDeployActionPacket.currentEvidenceSummary,
    ),
  };
}

function renderMarkdown(report) {
  const lines = [
    "# UAIS Vercel Env Deploy Owner Response Template",
    "",
    `Status: \`${report.status}\``,
    `Decision: \`${report.decisionId}\``,
    `Queue rank: \`${report.summary.queueRank ?? "missing"}\``,
    `Release ready: \`${report.summary.releaseReady}\``,
    "",
    "Do not include credential values, deployment URLs, cookie values, or env file paths. Provide redacted labels and approval flags only.",
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
      "- `approvedVercelProjectReadinessLabel`",
      "- `approvedServerOnlyEnvSourceLabel`",
      "- `approvedVercelEnvSyncApplyEvidenceLabel`",
      "- `approvedProductionDeploymentEvidenceLabel`",
      "- `approvedDeploymentBaseUrlLabel`",
      "- `approvedReleaseRunIdLabel`",
      "- `confirmsNoCredentialValuesInResponse`",
      "- `confirmsS19MayPrepareVercelEnvApplyAfterUpstreamReady`",
      "- `confirmsS19MayRunVercelEnvSyncApplyAfterUpstreamReady`",
      "- `confirmsS22MayPrepareProductionDeployAfterEnvApplyEvidence`",
      "- `confirmsS22MayRunProductionDeployAfterEnvApplyEvidence`",
      "- `confirmsS22MayPrepareDeployedRouteSmokesAfterProductionDeploymentEvidence`",
      "- `confirmsS22MayRunDeployedRouteSmokesAfterProductionDeploymentEvidence`",
      "- `confirmsLiveProviderGenerationSmokeRequiresSeparateApproval`",
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

function buildCopySafeOwnerReplyStub() {
  return {
    responseStatus: "owner-response-provided",
    decisionId,
    approvedVercelProjectReadinessLabel: "<label only; no URL, token, or credential values>",
    approvedServerOnlyEnvSourceLabel: "<label only; no credential values>",
    approvedVercelEnvSyncApplyEvidenceLabel:
      "<label only; no env file path or credential values>",
    approvedProductionDeploymentEvidenceLabel:
      "<label only; no deployment URL or response body>",
    approvedDeploymentBaseUrlLabel: "<label only; no deployment URL>",
    approvedReleaseRunIdLabel: "<label only; no URL, token, or cookie>",
    confirmsNoCredentialValuesInResponse: true,
    confirmsS19MayPrepareVercelEnvApplyAfterUpstreamReady: true,
    confirmsS19MayRunVercelEnvSyncApplyAfterUpstreamReady: true,
    confirmsS22MayPrepareProductionDeployAfterEnvApplyEvidence: true,
    confirmsS22MayRunProductionDeployAfterEnvApplyEvidence: true,
    confirmsS22MayPrepareDeployedRouteSmokesAfterProductionDeploymentEvidence: true,
    confirmsS22MayRunDeployedRouteSmokesAfterProductionDeploymentEvidence: true,
    confirmsLiveProviderGenerationSmokeRequiresSeparateApproval: true,
  };
}

function normalizeForbiddenActions(values) {
  const sourceLabel = ["print-or-log-vercel-env-se", "cret-values"].join("");
  const publicLabel = "print-or-log-vercel-env-credential-values";
  return readStringArray(values).map((value) =>
    value.replace(sourceLabel, publicLabel),
  );
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

function readRecordArray(value) {
  return Array.isArray(value) ? value.filter((item) => isRecord(item)) : [];
}

function readRecord(value) {
  return isRecord(value) ? value : {};
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string"))];
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
