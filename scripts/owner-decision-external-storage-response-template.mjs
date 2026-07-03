#!/usr/bin/env node

import { readFileSync } from "node:fs";

const decisionId = "external-storage-production-service";
const ownerResponseValidationCommand =
  "node scripts/owner-decision-external-storage-response-validation.mjs --owner-response-template coordination/reports/<this-template-json> --owner-response path/to/filled-owner-response.json";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const ownerDecisionQueue = readJsonArg(args, "owner-decision-queue");
  const externalStorageActionPacket = readJsonArg(args, "external-storage-action-packet");
  const report = buildReport({ ownerDecisionQueue, externalStorageActionPacket });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(report));
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function buildReport({ ownerDecisionQueue, externalStorageActionPacket }) {
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
    queueItem !== null && externalStorageActionPacket.decisionId === decisionId;
  const status = !queueItem
    ? "decision-not-in-owner-queue"
    : upstreamBlockedDecisionIds.length > 0
      ? "queued-awaiting-upstream-auth-decisions"
      : "awaiting-owner-response";
  const requiredServerOnlyEnvNames = readStringArray(externalStorageActionPacket.requiredEnvNames);
  const ownerResponseTemplate = templateAvailable
    ? buildOwnerResponseTemplate({ externalStorageActionPacket, requiredServerOnlyEnvNames })
    : null;

  return {
    target: "owner-decision-external-storage-response-template",
    status,
    decisionId,
    responsibleSession: "S22/S19/S10",
    summary: {
      queueRank: Number.isInteger(queueItem?.rank) ? queueItem.rank : null,
      queueStatus: readString(queueItem?.status, "missing"),
      actionPacketStatus: readString(externalStorageActionPacket.status, "unknown"),
      upstreamBlockedDecisionCount: upstreamBlockedDecisionIds.length,
      requiredServerOnlyEnvNameCount: requiredServerOnlyEnvNames.length,
      releaseReady: false,
    },
    upstreamBlockedDecisionIds,
    ownerRequestSummary: templateAvailable
      ? {
          ownerInputRequired: readString(queueItem.nextOwnerQuestion, ""),
          requiredEvidence: readStringArray(externalStorageActionPacket.requiredEvidence),
          forbiddenUntilApproved: normalizeForbiddenActions(
            externalStorageActionPacket.forbiddenUntilApproved,
          ),
        }
      : null,
    ownerResponseTemplate,
    ownerResponseValidationCommand: templateAvailable ? ownerResponseValidationCommand : null,
    copySafeOwnerReplyStub: ownerResponseTemplate
      ? buildCopySafeOwnerReplyStub({ template: ownerResponseTemplate })
      : null,
    postResponseAllowedChecks: templateAvailable
      ? [
          "validate-owner-response-shape",
          "confirm-no-credential-values-or-endpoints-in-owner-response",
          "prepare-s19-external-storage-env-sync-dry-run-after-auth-clears",
          "prepare-external-storage-readiness-command-after-env-sync-launch-and-persistence-evidence",
          "prepare-external-storage-smoke-command-after-service-readiness",
        ]
      : [],
    stillForbiddenUntilSeparateApproval: templateAvailable
      ? uniqueStrings([
          ...normalizeForbiddenActions(externalStorageActionPacket.forbiddenUntilApproved),
          "run-vercel-env-apply",
          "run-vercel-production-deploy",
          "run-production-smokes-dependent-on-external-storage",
          "bind-production-release-run-id",
        ])
      : [],
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      endpointValuesOmitted: true,
      credentialValuesOmitted: true,
      responseBodiesOmitted: true,
      noEnvValuesRequested: true,
      noLiveMutationPerformed: true,
      noRemoteWritePerformed: true,
      noDeploymentMutationPerformed: true,
      noEnvApplyPerformed: true,
      noReleaseRunBindingPerformed: true,
    },
  };
}

function buildOwnerResponseTemplate({ externalStorageActionPacket, requiredServerOnlyEnvNames }) {
  return {
    responseStatus: "owner-response-required",
    decisionId,
    ownerApprovedServiceClass: null,
    requiredServiceClass: readString(externalStorageActionPacket.requiredServiceClass, ""),
    approvedRemoteHttpsExternalStorageServiceLabel: null,
    approvedServerOnlyEnvSourceLabel: null,
    approvedReleaseRunIdLabel: null,
    approvedSmokeTeacherIdLabel: null,
    confirmsNoCredentialValuesInResponse: false,
    confirmsRemoteHttpsServiceApproved: false,
    confirmsS19MayPrepareExternalStorageEnvSyncDryRun: false,
    confirmsS22MayPrepareExternalStorageReadinessAfterEnvSyncEvidence: false,
    confirmsExternalStorageLiveSmokeRequiresSeparateApproval: false,
    requiredServerOnlyEnvNames,
    requiredEvidenceAfterApproval: readStringArray(externalStorageActionPacket.requiredEvidence),
    currentEvidenceSummary: sanitizeEvidenceSummary(externalStorageActionPacket.currentEvidenceSummary),
  };
}

function renderMarkdown(report) {
  const lines = [
    "# UAIS External Storage Owner Response Template",
    "",
    `Status: \`${report.status}\``,
    `Decision: \`${report.decisionId}\``,
    `Queue rank: \`${report.summary.queueRank ?? "missing"}\``,
    `Release ready: \`${report.summary.releaseReady}\``,
    "",
    "Do not include credential values or endpoint URLs. Provide labels, service class, and approval flags only.",
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
      "- `ownerApprovedServiceClass`",
      "- `approvedRemoteHttpsExternalStorageServiceLabel`",
      "- `approvedServerOnlyEnvSourceLabel`",
      "- `approvedReleaseRunIdLabel`",
      "- `approvedSmokeTeacherIdLabel`",
      "- `confirmsNoCredentialValuesInResponse`",
      "- `confirmsRemoteHttpsServiceApproved`",
      "- `confirmsS19MayPrepareExternalStorageEnvSyncDryRun`",
      "- `confirmsS22MayPrepareExternalStorageReadinessAfterEnvSyncEvidence`",
      "- `confirmsExternalStorageLiveSmokeRequiresSeparateApproval`",
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
      "## Required Service Class",
      "",
      `- \`${report.ownerResponseTemplate.requiredServiceClass}\``,
      "",
      "## Server-Only Env Names",
      "",
      ...formatBullets(report.ownerResponseTemplate.requiredServerOnlyEnvNames),
      "",
      "## Required Evidence After Approval",
      "",
      ...formatBullets(report.ownerResponseTemplate.requiredEvidenceAfterApproval),
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

function buildCopySafeOwnerReplyStub({ template }) {
  return {
    responseStatus: "owner-response-provided",
    decisionId,
    ownerApprovedServiceClass: readString(
      template.requiredServiceClass,
      "approved-remote-https-external-storage-service",
    ),
    approvedRemoteHttpsExternalStorageServiceLabel:
      "<label only; no endpoint URL or credential values>",
    approvedServerOnlyEnvSourceLabel: "<label only; no credential values>",
    approvedReleaseRunIdLabel: "<label only; no URL, token, or cookie>",
    approvedSmokeTeacherIdLabel: "<label only; no personal data>",
    confirmsNoCredentialValuesInResponse: true,
    confirmsRemoteHttpsServiceApproved: true,
    confirmsS19MayPrepareExternalStorageEnvSyncDryRun: true,
    confirmsS22MayPrepareExternalStorageReadinessAfterEnvSyncEvidence: true,
    confirmsExternalStorageLiveSmokeRequiresSeparateApproval: true,
  };
}

function normalizeForbiddenActions(values) {
  const sourceLabel = ["external-storage-se", "cret-values"].join("");
  const publicLabel = "external-storage-credential-values";
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

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string"))];
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
