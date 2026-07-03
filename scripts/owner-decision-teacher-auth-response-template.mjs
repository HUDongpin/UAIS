#!/usr/bin/env node

import { readFileSync } from "node:fs";

const decisionId = "teacher-auth-provider-production-selector";
const ownerResponseValidationCommand =
  "node scripts/owner-decision-teacher-auth-response-validation.mjs --owner-response-template coordination/reports/<this-template-json> --owner-response path/to/filled-owner-response.json";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const ownerDecisionQueue = readJsonArg(args, "owner-decision-queue");
  const teacherAuthActionPacket = readJsonArg(args, "teacher-auth-action-packet");
  const report = buildReport({ ownerDecisionQueue, teacherAuthActionPacket });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(report));
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function buildReport({ ownerDecisionQueue, teacherAuthActionPacket }) {
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
  const templateAvailable = queueItem !== null && teacherAuthActionPacket.decisionId === decisionId;
  const status = !queueItem
    ? "decision-not-in-owner-queue"
    : upstreamBlockedDecisionIds.length > 0
      ? "queued-awaiting-upstream-app-auth"
      : "awaiting-owner-response";
  const ownerResponseTemplate = templateAvailable
    ? buildOwnerResponseTemplate({ teacherAuthActionPacket })
    : null;

  return {
    target: "owner-decision-teacher-auth-response-template",
    status,
    decisionId,
    responsibleSession: "S22/S19/S10",
    summary: {
      queueRank: Number.isInteger(queueItem?.rank) ? queueItem.rank : null,
      queueStatus: readString(queueItem?.status, "missing"),
      actionPacketStatus: readString(teacherAuthActionPacket.status, "unknown"),
      upstreamBlockedDecisionCount: upstreamBlockedDecisionIds.length,
      releaseReady: false,
    },
    upstreamBlockedDecisionIds,
    ownerRequestSummary: templateAvailable
      ? {
          ownerInputRequired: readString(queueItem.nextOwnerQuestion, ""),
          requiredEvidence: readStringArray(teacherAuthActionPacket.requiredEvidence),
          forbiddenUntilApproved: readStringArray(teacherAuthActionPacket.forbiddenUntilApproved),
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
          "confirm-no-credential-values-in-owner-response",
          "prepare-s19-teacher-auth-env-sync-dry-run-after-app-auth-clears",
          "prepare-teacher-auth-readiness-command-after-env-sync-evidence",
          "prepare-teacher-auth-issuer-route-smoke-after-production-deploy",
        ]
      : [],
    stillForbiddenUntilSeparateApproval: templateAvailable
      ? uniqueStrings([
          ...readStringArray(teacherAuthActionPacket.forbiddenUntilApproved),
          "run-vercel-env-apply",
          "run-vercel-production-deploy",
          "run-production-smokes-dependent-on-teacher-auth",
          "bind-production-release-run-id",
        ])
      : [],
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      credentialValuesOmitted: true,
      cookieValuesOmitted: true,
      responseBodiesOmitted: true,
      noEnvValuesRequested: true,
      noLiveMutationPerformed: true,
      noDeploymentMutationPerformed: true,
      noEnvApplyPerformed: true,
      noReleaseRunBindingPerformed: true,
    },
  };
}

function buildOwnerResponseTemplate({ teacherAuthActionPacket }) {
  return {
    responseStatus: "owner-response-required",
    decisionId,
    ownerApprovedProviderMode: null,
    allowedProviderModes: uniqueStrings(readStringArray(teacherAuthActionPacket.acceptedOptions)),
    approvedServerOnlyEnvSourceLabel: null,
    approvedReleaseRunIdLabel: null,
    confirmsNoCredentialValuesInResponse: false,
    confirmsS19MayPrepareTeacherAuthEnvSyncDryRun: false,
    confirmsS22MayPrepareTeacherAuthReadinessAfterEnvSyncEvidence: false,
    confirmsTeacherAuthLiveCookieIssuanceRequiresSeparateApproval: false,
    requiredServerOnlyEnvNamesByMode: sanitizeEnvNamesByMode(
      teacherAuthActionPacket.requiredEnvNamesByMode,
    ),
    currentModeRequiredEnvNames: readStringArray(teacherAuthActionPacket.currentModeRequiredEnvNames),
    requiredEvidenceAfterApproval: readStringArray(teacherAuthActionPacket.requiredEvidence),
    currentEvidenceSummary: sanitizeEvidenceSummary(teacherAuthActionPacket.currentEvidenceSummary),
  };
}

function renderMarkdown(report) {
  const lines = [
    "# UAIS Teacher Auth Owner Response Template",
    "",
    `Status: \`${report.status}\``,
    `Decision: \`${report.decisionId}\``,
    `Queue rank: \`${report.summary.queueRank ?? "missing"}\``,
    `Release ready: \`${report.summary.releaseReady}\``,
    "",
    "Do not include credential values. Provide labels, provider mode, and approval flags only.",
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
      "- `ownerApprovedProviderMode`",
      "- `approvedServerOnlyEnvSourceLabel`",
      "- `approvedReleaseRunIdLabel`",
      "- `confirmsNoCredentialValuesInResponse`",
      "- `confirmsS19MayPrepareTeacherAuthEnvSyncDryRun`",
      "- `confirmsS22MayPrepareTeacherAuthReadinessAfterEnvSyncEvidence`",
      "- `confirmsTeacherAuthLiveCookieIssuanceRequiresSeparateApproval`",
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
      "## Allowed Provider Modes",
      "",
      ...formatBullets(report.ownerResponseTemplate.allowedProviderModes),
      "",
      "## Server-Only Env Names By Mode",
      "",
      ...formatModeBullets(report.ownerResponseTemplate.requiredServerOnlyEnvNamesByMode),
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
  const allowedProviderModes = readStringArray(template.allowedProviderModes);
  const providerModePlaceholder =
    allowedProviderModes.length > 0
      ? `<choose ${allowedProviderModes.join(" or ")}>`
      : "<choose approved provider mode>";
  return {
    responseStatus: "owner-response-provided",
    decisionId,
    ownerApprovedProviderMode: providerModePlaceholder,
    approvedServerOnlyEnvSourceLabel: "<label only; no credential values>",
    approvedReleaseRunIdLabel: "<label only; no URL, token, or cookie>",
    confirmsNoCredentialValuesInResponse: true,
    confirmsS19MayPrepareTeacherAuthEnvSyncDryRun: true,
    confirmsS22MayPrepareTeacherAuthReadinessAfterEnvSyncEvidence: true,
    confirmsTeacherAuthLiveCookieIssuanceRequiresSeparateApproval: true,
  };
}

function sanitizeEnvNamesByMode(value) {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).map(([mode, envNames]) => [mode, readStringArray(envNames)]),
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

function formatModeBullets(modes) {
  const lines = [];
  for (const [mode, envNames] of Object.entries(modes)) {
    lines.push(`- \`${mode}\`: ${envNames.map((envName) => `\`${envName}\``).join(", ")}`);
  }
  return lines.length > 0 ? lines : ["- `none-recorded`"];
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
