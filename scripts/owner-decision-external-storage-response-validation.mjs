#!/usr/bin/env node

import { readFileSync } from "node:fs";

const decisionId = "external-storage-production-service";
const uaisEnvPrefix = "UAIS_";
const secretLikePrefix = "secret";
const unsafePatterns = [
  { id: "raw-url", pattern: /https?:\/\//i },
  { id: "local-user-path", pattern: /\/Users\// },
  { id: "local-env-file", pattern: /\.env\.local/i },
  {
    id: "env-assignment",
    pattern: new RegExp(`\\b${uaisEnvPrefix}[A-Z0-9_]*\\s*=`),
  },
  { id: "secret_like_token", pattern: new RegExp(`${secretLikePrefix}-`, "i") },
];

function main() {
  const args = parseArgs(process.argv.slice(2));
  const templateReport = readJsonArg(args, "owner-response-template");
  const ownerResponseInput = readJsonArg(args, "owner-response");
  const report = buildReport({ templateReport, ownerResponseInput });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(report));
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function buildReport({ templateReport, ownerResponseInput }) {
  const template = extractTemplate(templateReport);
  const ownerResponse = extractOwnerResponse(ownerResponseInput);
  const requiredServiceClass = readString(template.requiredServiceClass, "");
  const requiredServerOnlyEnvNames = readStringArray(template.requiredServerOnlyEnvNames);
  const unsafeFindings = findUnsafeFindings(ownerResponseInput);
  const missingFields = findMissingFields({ ownerResponse, requiredServiceClass });
  const serviceClassAccepted =
    typeof ownerResponse.ownerApprovedServiceClass === "string" &&
    ownerResponse.ownerApprovedServiceClass === requiredServiceClass;
  const accepted =
    unsafeFindings.length === 0 && missingFields.length === 0 && serviceClassAccepted;
  const status =
    unsafeFindings.length > 0
      ? "owner-response-rejected"
      : accepted
        ? "owner-response-accepted"
        : "owner-response-incomplete";

  return {
    target: "owner-decision-external-storage-response-validation",
    status,
    releaseReady: false,
    decisionId,
    responsibleSession: "S22/S19/S10",
    summary: {
      templateStatus: readString(templateReport.status, "unknown"),
      ownerResponseStatus: readString(ownerResponse.responseStatus, "unknown"),
      requiredServiceClass,
      requiredServerOnlyEnvNameCount: requiredServerOnlyEnvNames.length,
      requiredEvidenceAfterApprovalCount: readStringArray(
        template.requiredEvidenceAfterApproval,
      ).length,
      missingFieldCount: missingFields.length,
      unsafeFindingCount: unsafeFindings.length,
      serviceClassAccepted,
      s19DryRunMayProceed:
        accepted && ownerResponse.confirmsS19MayPrepareExternalStorageEnvSyncDryRun === true,
      s22ReadinessMayProceed:
        accepted &&
        ownerResponse.confirmsS22MayPrepareExternalStorageReadinessAfterEnvSyncEvidence === true,
      liveSmokeStillForbidden:
        ownerResponse.confirmsExternalStorageLiveSmokeRequiresSeparateApproval === true,
      releaseReady: false,
    },
    requiredServerOnlyEnvNames,
    redactedOwnerResponse: buildRedactedOwnerResponse({ ownerResponse, unsafeFindings }),
    blockedReasons: buildBlockedReasons({ missingFields, unsafeFindings, serviceClassAccepted }),
    unsafeFindings,
    postValidationAllowedChecks: accepted
      ? [
          "prepare-s19-external-storage-env-sync-dry-run-after-auth-clears",
          "prepare-external-storage-readiness-command-after-env-sync-launch-and-persistence-evidence",
          "prepare-external-storage-smoke-command-after-service-readiness",
        ]
      : [],
    stillForbiddenUntilSeparateApproval: [
      "inspect-or-print-external-storage-credential-values",
      "run-live-external-storage-service-readiness",
      "run-live-external-storage-smoke",
      "run-vercel-env-apply",
      "run-vercel-production-deploy",
      "run-production-smokes-dependent-on-external-storage",
      "bind-production-release-run-id",
    ],
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      endpointValuesOmitted: true,
      credentialValuesOmitted: true,
      responseBodiesOmitted: true,
      unsafeValuesOmitted: true,
      noEnvValuesRequested: true,
      noLiveMutationPerformed: true,
      noRemoteWritePerformed: true,
      noDeploymentMutationPerformed: true,
      noEnvApplyPerformed: true,
      noReleaseRunBindingPerformed: true,
    },
  };
}

function extractTemplate(templateReport) {
  return isRecord(templateReport.ownerResponseTemplate)
    ? templateReport.ownerResponseTemplate
    : {};
}

function extractOwnerResponse(input) {
  if (isRecord(input.ownerResponse)) {
    return input.ownerResponse;
  }
  if (isRecord(input.copySafeOwnerReplyStub)) {
    return input.copySafeOwnerReplyStub;
  }
  if (isRecord(input.ownerResponseTemplate)) {
    return input.ownerResponseTemplate;
  }
  return isRecord(input) ? input : {};
}

function findMissingFields({ ownerResponse, requiredServiceClass }) {
  const missing = [];
  if (ownerResponse.responseStatus !== "owner-response-provided") {
    missing.push("responseStatus-not-provided");
  }
  if (ownerResponse.decisionId !== decisionId) {
    missing.push("decisionId-mismatch");
  }
  if (typeof ownerResponse.ownerApprovedServiceClass !== "string") {
    missing.push("ownerApprovedServiceClass-missing");
  } else if (ownerResponse.ownerApprovedServiceClass !== requiredServiceClass) {
    missing.push("ownerApprovedServiceClass-not-approved");
  }
  if (!isSafeLabel(ownerResponse.approvedRemoteHttpsExternalStorageServiceLabel)) {
    missing.push("approvedRemoteHttpsExternalStorageServiceLabel-missing-or-invalid");
  }
  if (!isSafeLabel(ownerResponse.approvedServerOnlyEnvSourceLabel)) {
    missing.push("approvedServerOnlyEnvSourceLabel-missing-or-invalid");
  }
  if (!isSafeLabel(ownerResponse.approvedReleaseRunIdLabel)) {
    missing.push("approvedReleaseRunIdLabel-missing-or-invalid");
  }
  if (!isSafeLabel(ownerResponse.approvedSmokeTeacherIdLabel)) {
    missing.push("approvedSmokeTeacherIdLabel-missing-or-invalid");
  }
  if (ownerResponse.confirmsNoCredentialValuesInResponse !== true) {
    missing.push("confirmsNoCredentialValuesInResponse-not-confirmed");
  }
  if (ownerResponse.confirmsRemoteHttpsServiceApproved !== true) {
    missing.push("confirmsRemoteHttpsServiceApproved-not-confirmed");
  }
  if (ownerResponse.confirmsS19MayPrepareExternalStorageEnvSyncDryRun !== true) {
    missing.push("confirmsS19MayPrepareExternalStorageEnvSyncDryRun-not-confirmed");
  }
  if (ownerResponse.confirmsS22MayPrepareExternalStorageReadinessAfterEnvSyncEvidence !== true) {
    missing.push("confirmsS22MayPrepareExternalStorageReadinessAfterEnvSyncEvidence-not-confirmed");
  }
  if (ownerResponse.confirmsExternalStorageLiveSmokeRequiresSeparateApproval !== true) {
    missing.push("confirmsExternalStorageLiveSmokeRequiresSeparateApproval-not-confirmed");
  }
  return missing;
}

function buildRedactedOwnerResponse({ ownerResponse, unsafeFindings }) {
  const unsafeFieldPaths = new Set(unsafeFindings.map((finding) => finding.fieldPath));
  return {
    responseStatus: readString(ownerResponse.responseStatus, "unknown"),
    decisionId: readString(ownerResponse.decisionId, null),
    ownerApprovedServiceClass: readString(ownerResponse.ownerApprovedServiceClass, null),
    approvedRemoteHttpsExternalStorageServiceLabel: unsafeFieldPaths.has(
      "approvedRemoteHttpsExternalStorageServiceLabel",
    )
      ? null
      : readString(ownerResponse.approvedRemoteHttpsExternalStorageServiceLabel, null),
    approvedServerOnlyEnvSourceLabel: unsafeFieldPaths.has("approvedServerOnlyEnvSourceLabel")
      ? null
      : readString(ownerResponse.approvedServerOnlyEnvSourceLabel, null),
    approvedReleaseRunIdLabel: unsafeFieldPaths.has("approvedReleaseRunIdLabel")
      ? null
      : readString(ownerResponse.approvedReleaseRunIdLabel, null),
    approvedSmokeTeacherIdLabel: unsafeFieldPaths.has("approvedSmokeTeacherIdLabel")
      ? null
      : readString(ownerResponse.approvedSmokeTeacherIdLabel, null),
    confirmsNoCredentialValuesInResponse:
      ownerResponse.confirmsNoCredentialValuesInResponse === true,
    confirmsRemoteHttpsServiceApproved:
      ownerResponse.confirmsRemoteHttpsServiceApproved === true,
    confirmsS19MayPrepareExternalStorageEnvSyncDryRun:
      ownerResponse.confirmsS19MayPrepareExternalStorageEnvSyncDryRun === true,
    confirmsS22MayPrepareExternalStorageReadinessAfterEnvSyncEvidence:
      ownerResponse.confirmsS22MayPrepareExternalStorageReadinessAfterEnvSyncEvidence === true,
    confirmsExternalStorageLiveSmokeRequiresSeparateApproval:
      ownerResponse.confirmsExternalStorageLiveSmokeRequiresSeparateApproval === true,
  };
}

function buildBlockedReasons({ missingFields, unsafeFindings, serviceClassAccepted }) {
  const reasons = [...missingFields];
  if (!serviceClassAccepted && !reasons.includes("ownerApprovedServiceClass-missing")) {
    reasons.push("service-class-not-accepted");
  }
  if (unsafeFindings.length > 0) {
    reasons.push("unsafe-owner-response-values-detected");
  }
  return uniqueStrings(reasons);
}

function findUnsafeFindings(value) {
  const findings = [];
  for (const entry of flattenStrings(value)) {
    for (const unsafePattern of unsafePatterns) {
      if (unsafePattern.pattern.test(entry.value)) {
        findings.push({
          fieldPath: entry.path,
          patternId: unsafePattern.id,
        });
      }
    }
  }
  return dedupeFindings(findings);
}

function flattenStrings(value, path = "") {
  if (typeof value === "string") {
    return [{ path: path || "root", value }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenStrings(item, `${path}[${index}]`));
  }
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, child]) =>
      flattenStrings(child, path ? `${path}.${key}` : key),
    );
  }
  return [];
}

function dedupeFindings(findings) {
  const seen = new Set();
  const deduped = [];
  for (const finding of findings) {
    const key = `${finding.fieldPath}:${finding.patternId}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(finding);
    }
  }
  return deduped;
}

function renderMarkdown(report) {
  const lines = [
    "# UAIS External Storage Owner Response Validation",
    "",
    `Status: \`${report.status}\``,
    `Decision: \`${report.decisionId}\``,
    `Owner response status: \`${report.summary.ownerResponseStatus}\``,
    `Service class accepted: \`${report.summary.serviceClassAccepted}\``,
    `S19 dry-run may proceed: \`${report.summary.s19DryRunMayProceed}\``,
    `S22 readiness may proceed: \`${report.summary.s22ReadinessMayProceed}\``,
    `Live smoke still forbidden: \`${report.summary.liveSmokeStillForbidden}\``,
    `Release ready: \`${report.summary.releaseReady}\``,
    "",
    "This validation performs no live operation, remote write, env apply, deploy, production smoke, or release-run binding.",
    "",
    "## Redacted Owner Response",
    "",
    `- Service class: \`${report.redactedOwnerResponse.ownerApprovedServiceClass ?? "missing"}\``,
    `- Service label: \`${report.redactedOwnerResponse.approvedRemoteHttpsExternalStorageServiceLabel ?? "missing"}\``,
    `- Env source label: \`${report.redactedOwnerResponse.approvedServerOnlyEnvSourceLabel ?? "missing"}\``,
    `- Release run label: \`${report.redactedOwnerResponse.approvedReleaseRunIdLabel ?? "missing"}\``,
    "",
    "## Blocked Reasons",
    "",
    ...formatBullets(report.blockedReasons),
  ];

  if (report.requiredServerOnlyEnvNames.length > 0) {
    lines.push("", "## Required Server-Only Env Names", "");
    lines.push(...formatBullets(report.requiredServerOnlyEnvNames));
  }

  if (report.unsafeFindings.length > 0) {
    lines.push("", "## Unsafe Findings", "");
    lines.push(
      ...report.unsafeFindings.map(
        (finding) => `- \`${finding.fieldPath}\`: \`${finding.patternId}\``,
      ),
    );
  }

  lines.push("", "## Post-Validation Allowed Checks", "");
  lines.push(...formatBullets(report.postValidationAllowedChecks));

  lines.push("", "## Still Forbidden Until Separate Approval", "");
  lines.push(...formatBullets(report.stillForbiddenUntilSeparateApproval));

  return `${lines.join("\n")}\n`;
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

function isSafeLabel(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:@-]{1,127}$/.test(value);
}

function readString(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function readStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
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
