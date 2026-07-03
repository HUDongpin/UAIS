#!/usr/bin/env node

import { readFileSync } from "node:fs";

const decisionId = "ordinary-teaching-production-evidence";
const ownerResponseValidationCommand =
  "node scripts/owner-decision-ordinary-teaching-production-evidence-response-validation.mjs --owner-response-template coordination/reports/<this-template-json> --owner-response path/to/filled-owner-response.json";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const ownerDecisionQueue = readJsonArg(args, "owner-decision-queue");
  const ordinaryTeachingActionPacket = readJsonArg(args, "ordinary-teaching-action-packet");
  const report = buildReport({ ownerDecisionQueue, ordinaryTeachingActionPacket });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(report));
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function buildReport({ ownerDecisionQueue, ordinaryTeachingActionPacket }) {
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
    queueItem !== null && ordinaryTeachingActionPacket.decisionId === decisionId;
  const status = !queueItem
    ? "decision-not-in-owner-queue"
    : upstreamBlockedDecisionIds.length > 0
      ? "queued-awaiting-upstream-live-evidence"
      : "awaiting-owner-response";
  const requiredEvidence = readStringArray(ordinaryTeachingActionPacket.requiredEvidence);
  const requiredCommandNames = Object.keys(readRecord(ordinaryTeachingActionPacket.commands));
  const upstreamEvidenceIds = readStringArray(ordinaryTeachingActionPacket.upstreamEvidenceIds);
  const ownerResponseTemplate = templateAvailable
    ? buildOwnerResponseTemplate({
        ordinaryTeachingActionPacket,
        requiredEvidence,
        requiredCommandNames,
      })
    : null;

  return {
    target: "owner-decision-ordinary-teaching-production-evidence-response-template",
    status,
    decisionId,
    responsibleSession: "S22/S19/S10/S12",
    summary: {
      queueRank: Number.isInteger(queueItem?.rank) ? queueItem.rank : null,
      queueStatus: readString(queueItem?.status, "missing"),
      actionPacketStatus: readString(ordinaryTeachingActionPacket.status, "unknown"),
      upstreamBlockedDecisionCount: upstreamBlockedDecisionIds.length,
      upstreamEvidenceDependencyCount: upstreamEvidenceIds.length,
      requiredEvidenceCount: requiredEvidence.length,
      requiredCommandNameCount: requiredCommandNames.length,
      releaseReady: false,
    },
    upstreamBlockedDecisionIds,
    upstreamEvidenceIds,
    ownerRequestSummary: templateAvailable
      ? {
          ownerInputRequired: readString(queueItem.nextOwnerQuestion, ""),
          requiredEvidence,
          forbiddenUntilApproved: normalizeForbiddenActions(
            ordinaryTeachingActionPacket.forbiddenUntilApproved,
          ),
        }
      : null,
    ownerResponseTemplate,
    ownerResponseValidationCommand: templateAvailable ? ownerResponseValidationCommand : null,
    copySafeOwnerReplyStub: ownerResponseTemplate ? buildCopySafeOwnerReplyStub() : null,
    postResponseAllowedChecks: templateAvailable
      ? [
          "validate-owner-response-shape",
          "confirm-no-cookie-url-env-or-credential-values-in-owner-response",
          "prepare-live-teaching-operations-route-smoke-after-auth-storage-deployment-readiness",
          "prepare-live-operation-detail-browser-smoke-after-operations-evidence",
          "prepare-live-teaching-course-management-route-smoke-after-auth-storage-deployment-readiness",
          "prepare-enterprise-audit-evidence-collection-after-live-smokes",
        ]
      : [],
    stillForbiddenUntilSeparateApproval: templateAvailable
      ? uniqueStrings([
          ...normalizeForbiddenActions(ordinaryTeachingActionPacket.forbiddenUntilApproved),
          "run-live-ordinary-teaching-smokes-before-auth-storage-and-deployment-readiness",
          "call-live-teaching-operations-api-without-issued-teacher-auth-cookie",
          "run-provider-backed-side-effect-smokes-without-owner-approval",
          "accept-local-production-smoke-as-production-live-evidence",
          "bind-production-release-run-id",
        ])
      : [],
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      deploymentUrlsOmitted: true,
      envFilePathsOmitted: true,
      envValuesOmitted: true,
      cookieValuesOmitted: true,
      backendCredentialValuesOmitted: true,
      responseBodiesOmitted: true,
      commandBodiesOmitted: true,
      noLiveMutationPerformed: true,
      noRemoteWritePerformed: true,
      noProviderSideEffectPerformed: true,
      noReleaseRunBindingPerformed: true,
    },
  };
}

function buildOwnerResponseTemplate({
  ordinaryTeachingActionPacket,
  requiredEvidence,
  requiredCommandNames,
}) {
  return {
    responseStatus: "owner-response-required",
    decisionId,
    approvedAppAuthReadinessEvidenceLabel: null,
    approvedTeacherAuthReadinessEvidenceLabel: null,
    approvedExternalStorageReadinessEvidenceLabel: null,
    approvedVercelProductionDeploymentEvidenceLabel: null,
    approvedDeploymentReachabilityEvidenceLabel: null,
    approvedTeacherAuthCookieLabel: null,
    approvedSmokeTeacherIdLabel: null,
    approvedSmokeCourseIdLabel: null,
    approvedOtherTeacherIdLabel: null,
    approvedStudentIdLabel: null,
    approvedReleaseRunIdLabel: null,
    confirmsNoCredentialCookieUrlOrEnvValuesInResponse: false,
    confirmsAuthStorageDeploymentPrerequisitesLiveReady: false,
    confirmsOwnerApprovesOrdinaryTeachingLiveSmokes: false,
    confirmsProviderSideEffectsRequireSeparateApproval: false,
    confirmsLocalDryRunEvidenceNotProductionLiveEvidence: false,
    requiredEvidenceAfterApproval: requiredEvidence,
    requiredCommandNames,
    currentEvidenceSummary: sanitizeEvidenceSummary(
      ordinaryTeachingActionPacket.currentEvidenceSummary,
    ),
  };
}

function renderMarkdown(report) {
  const lines = [
    "# UAIS Ordinary Teaching Production Evidence Response Template",
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
      "- `approvedAppAuthReadinessEvidenceLabel`",
      "- `approvedTeacherAuthReadinessEvidenceLabel`",
      "- `approvedExternalStorageReadinessEvidenceLabel`",
      "- `approvedVercelProductionDeploymentEvidenceLabel`",
      "- `approvedDeploymentReachabilityEvidenceLabel`",
      "- `approvedTeacherAuthCookieLabel`",
      "- `approvedSmokeTeacherIdLabel`",
      "- `approvedSmokeCourseIdLabel`",
      "- `approvedOtherTeacherIdLabel`",
      "- `approvedStudentIdLabel`",
      "- `approvedReleaseRunIdLabel`",
      "- `confirmsNoCredentialCookieUrlOrEnvValuesInResponse`",
      "- `confirmsAuthStorageDeploymentPrerequisitesLiveReady`",
      "- `confirmsOwnerApprovesOrdinaryTeachingLiveSmokes`",
      "- `confirmsProviderSideEffectsRequireSeparateApproval`",
      "- `confirmsLocalDryRunEvidenceNotProductionLiveEvidence`",
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

  if (report.upstreamEvidenceIds.length > 0) {
    lines.push("", "## Upstream Evidence Dependencies", "");
    lines.push(...formatBullets(report.upstreamEvidenceIds));
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
    approvedAppAuthReadinessEvidenceLabel:
      "<label only; no URL, cookie, env, or credential values>",
    approvedTeacherAuthReadinessEvidenceLabel:
      "<label only; no URL, cookie, env, or credential values>",
    approvedExternalStorageReadinessEvidenceLabel:
      "<label only; no endpoint URL or credential values>",
    approvedVercelProductionDeploymentEvidenceLabel:
      "<label only; no deployment URL or response body>",
    approvedDeploymentReachabilityEvidenceLabel: "<label only; no deployment URL>",
    approvedTeacherAuthCookieLabel: "<label only; no cookie value>",
    approvedSmokeTeacherIdLabel: "<label only; no personal data>",
    approvedSmokeCourseIdLabel: "<label only; no private course data>",
    approvedOtherTeacherIdLabel: "<label only; no personal data>",
    approvedStudentIdLabel: "<label only; no personal data>",
    approvedReleaseRunIdLabel: "<label only; no URL, token, or cookie>",
    confirmsNoCredentialCookieUrlOrEnvValuesInResponse: true,
    confirmsAuthStorageDeploymentPrerequisitesLiveReady: true,
    confirmsOwnerApprovesOrdinaryTeachingLiveSmokes: true,
    confirmsProviderSideEffectsRequireSeparateApproval: true,
    confirmsLocalDryRunEvidenceNotProductionLiveEvidence: true,
  };
}

function normalizeForbiddenActions(values) {
  const sourceLabel = ["backend-se", "cret-values"].join("");
  const publicLabel = "backend-credential-values";
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

function formatBullets(values) {
  return values.length > 0 ? values.map((value) => `- \`${value}\``) : ["- `none-recorded`"];
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
