#!/usr/bin/env node

import { readFileSync } from "node:fs";

const decisionId = "app-auth-provider-production-selector";
const ownerResponseValidationCommand =
  "node scripts/owner-decision-app-auth-response-validation.mjs --owner-response-template coordination/reports/<this-template-json> --owner-response path/to/filled-owner-response.json";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const firstBlockerRequest = readJsonArg(args, "first-blocker-request");
  const appAuthActionPacket = readJsonArg(args, "app-auth-action-packet");
  const report = buildReport({ firstBlockerRequest, appAuthActionPacket });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(report));
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function buildReport({ firstBlockerRequest, appAuthActionPacket }) {
  const ownerRequest = isRecord(firstBlockerRequest.ownerRequest)
    ? firstBlockerRequest.ownerRequest
    : {};
  const firstBlockedStageId = readString(firstBlockerRequest.firstBlockedStageId, null);
  const firstBlockerStatus = readString(firstBlockerRequest.status, "unknown");
  const isCurrentFirstBlocker = firstBlockedStageId === decisionId;
  const summary = {
    firstBlockedStageId,
    queueStatus: readString(ownerRequest.queueStatus, "unknown"),
    actionPacketStatus: readString(appAuthActionPacket.status, "unknown"),
    acceptedLiveEvidence: readNumber(firstBlockerRequest.summary?.acceptedLiveEvidence, 0),
    missingEnterpriseLiveTargetCount: readNumber(
      firstBlockerRequest.summary?.missingEnterpriseLiveTargetCount,
      0,
    ),
    releaseReady:
      firstBlockerRequest.summary?.releaseReady === true &&
      firstBlockerStatus === "no-owner-action-required" &&
      firstBlockedStageId === null,
  };
  const ownerResponseTemplate = isCurrentFirstBlocker
    ? buildOwnerResponseTemplate({ ownerRequest, appAuthActionPacket })
    : null;

  return {
    target: "owner-decision-app-auth-response-template",
    status: isCurrentFirstBlocker ? "awaiting-owner-response" : "not-current-first-blocker",
    decisionId,
    responsibleSession: "S22/S19/S10",
    summary,
    ownerRequestSummary: isCurrentFirstBlocker
      ? {
          ownerInputRequired: readString(ownerRequest.ownerInputRequired, ""),
          requiredEvidence: uniqueStrings([
            ...readStringArray(ownerRequest.requiredEvidence),
            ...readStringArray(appAuthActionPacket.requiredEvidence),
          ]),
          forbiddenUntilApproved: uniqueStrings([
            ...readStringArray(ownerRequest.forbiddenUntilApproved),
            ...readStringArray(appAuthActionPacket.forbiddenUntilApproved),
          ]),
        }
      : null,
    ownerResponseTemplate,
    ownerResponseValidationCommand: isCurrentFirstBlocker ? ownerResponseValidationCommand : null,
    copySafeOwnerReplyStub: ownerResponseTemplate
      ? buildCopySafeOwnerReplyStub(ownerResponseTemplate)
      : null,
    postResponseAllowedChecks: isCurrentFirstBlocker
      ? [
          "validate-owner-response-shape",
          "confirm-no-credential-values-in-owner-response",
          "prepare-s19-app-auth-env-sync-dry-run",
          "prepare-app-auth-readiness-command-after-env-sync-evidence",
        ]
      : [],
    stillForbiddenUntilSeparateApproval: isCurrentFirstBlocker
      ? uniqueStrings([
          ...readStringArray(ownerRequest.forbiddenUntilApproved),
          ...readStringArray(appAuthActionPacket.forbiddenUntilApproved),
          "run-vercel-env-apply",
          "run-vercel-production-deploy",
          "run-production-smokes-dependent-on-app-auth",
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

function buildOwnerResponseTemplate({ ownerRequest, appAuthActionPacket }) {
  return {
    responseStatus: "owner-response-required",
    decisionId,
    ownerApprovedProviderMode: null,
    allowedProviderModes: uniqueStrings(readStringArray(appAuthActionPacket.acceptedOptions)),
    approvedServerOnlyEnvSourceLabel: null,
    approvedReleaseRunIdLabel: null,
    confirmsNoCredentialValuesInResponse: false,
    confirmsS19MayPrepareAppAuthEnvSyncDryRun: false,
    confirmsS22MayPrepareAppAuthReadinessAfterEnvSyncEvidence: false,
    requiredServerOnlyEnvNames: uniqueStrings([
      ...readStringArray(ownerRequest.requiredServerOnlyEnvNames),
      ...readStringArray(appAuthActionPacket.requiredEnvNames),
    ]),
    requiredEvidenceAfterApproval: uniqueStrings([
      ...readStringArray(ownerRequest.requiredEvidence),
      ...readStringArray(appAuthActionPacket.requiredEvidence),
    ]),
    currentEvidenceSummary: sanitizeEvidenceSummary(appAuthActionPacket.currentEvidenceSummary),
  };
}

function renderMarkdown(report) {
  const lines = [
    "# UAIS App Auth Owner Response Template",
    "",
    `Status: \`${report.status}\``,
    `Decision: \`${report.decisionId}\``,
    `First blocked stage: \`${report.summary.firstBlockedStageId ?? "none-recorded"}\``,
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
      "- `confirmsS19MayPrepareAppAuthEnvSyncDryRun`",
      "- `confirmsS22MayPrepareAppAuthReadinessAfterEnvSyncEvidence`",
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
      "## Server-Only Env Names",
      "",
      ...formatBullets(report.ownerResponseTemplate.requiredServerOnlyEnvNames),
      "",
      "## Required Evidence After Approval",
      "",
      ...formatBullets(report.ownerResponseTemplate.requiredEvidenceAfterApproval),
    );
  }

  if (report.stillForbiddenUntilSeparateApproval.length > 0) {
    lines.push("", "## Still Forbidden Until Separate Approval", "");
    lines.push(...formatBullets(report.stillForbiddenUntilSeparateApproval));
  }

  return `${lines.join("\n")}\n`;
}

function buildCopySafeOwnerReplyStub(template) {
  const firstAllowedProviderMode = template.allowedProviderModes[0] ?? "<approved-provider-mode>";
  return {
    responseStatus: "owner-response-provided",
    decisionId,
    ownerApprovedProviderMode: firstAllowedProviderMode,
    approvedServerOnlyEnvSourceLabel: "<label only; no credential values>",
    approvedReleaseRunIdLabel: "<label only; no URL, token, or cookie>",
    confirmsNoCredentialValuesInResponse: true,
    confirmsS19MayPrepareAppAuthEnvSyncDryRun: true,
    confirmsS22MayPrepareAppAuthReadinessAfterEnvSyncEvidence: true,
  };
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

function readNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string"))];
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
