#!/usr/bin/env node

import { readFileSync } from "node:fs";

const decisionId = "ordinary-teaching-production-evidence";
const uaisEnvPrefix = "UAIS_";
const secretLikePrefix = "secret";
const approvedEnvFilePlaceholderPattern = ["<approved-env", "-file>"].join("");
const deploymentUrlPlaceholderPattern = ["<deployment", "-url>"].join("");
const approvedTeacherCookiePlaceholderPattern = ["<approved-teacher-auth", "-cookie>"].join("");
const unsafePatterns = [
  { id: "raw-url", pattern: /https?:\/\//i },
  { id: "local-user-path", pattern: /\/Users\// },
  { id: "local-env-file", pattern: /\.env\.local/i },
  { id: "teacher-auth-cookie-assignment", pattern: /uais_teacher_auth_(claims|signature)=/i },
  {
    id: "env-assignment",
    pattern: new RegExp(`\\b${uaisEnvPrefix}[A-Z0-9_]*\\s*=`),
  },
  { id: "secret_like_token", pattern: new RegExp(`${secretLikePrefix}-`, "i") },
  { id: "env-file-placeholder", pattern: new RegExp(approvedEnvFilePlaceholderPattern, "i") },
  { id: "deployment-url-placeholder", pattern: new RegExp(deploymentUrlPlaceholderPattern, "i") },
  {
    id: "teacher-auth-cookie-placeholder",
    pattern: new RegExp(approvedTeacherCookiePlaceholderPattern, "i"),
  },
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
  const requiredEvidenceAfterApproval = readStringArray(template.requiredEvidenceAfterApproval);
  const requiredCommandNames = readStringArray(template.requiredCommandNames);
  const unsafeFindings = findUnsafeFindings(ownerResponseInput);
  const missingFields = findMissingFields(ownerResponse);
  const accepted = unsafeFindings.length === 0 && missingFields.length === 0;
  const status =
    unsafeFindings.length > 0
      ? "owner-response-rejected"
      : accepted
        ? "owner-response-accepted"
        : "owner-response-incomplete";

  return {
    target: "owner-decision-ordinary-teaching-production-evidence-response-validation",
    status,
    decisionId,
    responsibleSession: "S22/S19/S10/S12",
    summary: {
      templateStatus: readString(templateReport.status, "unknown"),
      ownerResponseStatus: readString(ownerResponse.responseStatus, "unknown"),
      requiredEvidenceAfterApprovalCount: requiredEvidenceAfterApproval.length,
      requiredCommandNameCount: requiredCommandNames.length,
      missingFieldCount: missingFields.length,
      unsafeFindingCount: unsafeFindings.length,
      liveSmokePrepMayProceed:
        accepted && ownerResponse.confirmsOwnerApprovesOrdinaryTeachingLiveSmokes === true,
      enterpriseAuditCollectionMayProceed:
        accepted && ownerResponse.confirmsLocalDryRunEvidenceNotProductionLiveEvidence === true,
      providerSideEffectsStillForbidden:
        ownerResponse.confirmsProviderSideEffectsRequireSeparateApproval === true,
      releaseReady: false,
    },
    requiredEvidenceAfterApproval,
    requiredCommandNames,
    redactedOwnerResponse: buildRedactedOwnerResponse({ ownerResponse, unsafeFindings }),
    blockedReasons: buildBlockedReasons({ missingFields, unsafeFindings }),
    unsafeFindings,
    postValidationAllowedChecks: accepted
      ? [
          "prepare-live-teaching-operations-route-smoke-after-auth-storage-deployment-readiness",
          "prepare-live-operation-detail-browser-smoke-after-operations-evidence",
          "prepare-live-teaching-course-management-route-smoke-after-auth-storage-deployment-readiness",
          "prepare-enterprise-audit-evidence-collection-after-live-smokes",
        ]
      : [],
    stillForbiddenUntilSeparateApproval: [
      "print-or-log-teacher-auth-cookie-values",
      "print-or-log-deployment-url-values",
      "print-or-log-backend-credential-values",
      "run-live-ordinary-teaching-smokes-before-auth-storage-and-deployment-readiness",
      "call-live-teaching-operations-api-without-issued-teacher-auth-cookie",
      "run-provider-backed-side-effect-smokes-without-owner-approval",
      "accept-local-production-smoke-as-production-live-evidence",
      "bind-production-release-run-id",
    ],
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      deploymentUrlsOmitted: true,
      envFilePathsOmitted: true,
      envValuesOmitted: true,
      cookieValuesOmitted: true,
      backendCredentialValuesOmitted: true,
      responseBodiesOmitted: true,
      unsafeValuesOmitted: true,
      commandBodiesOmitted: true,
      noLiveMutationPerformed: true,
      noRemoteWritePerformed: true,
      noProviderSideEffectPerformed: true,
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

function findMissingFields(ownerResponse) {
  const missing = [];
  if (ownerResponse.responseStatus !== "owner-response-provided") {
    missing.push("responseStatus-not-provided");
  }
  if (ownerResponse.decisionId !== decisionId) {
    missing.push("decisionId-mismatch");
  }
  for (const field of safeLabelFields) {
    if (!isSafeLabel(ownerResponse[field])) {
      missing.push(`${field}-missing-or-invalid`);
    }
  }
  if (ownerResponse.confirmsNoCredentialCookieUrlOrEnvValuesInResponse !== true) {
    missing.push("confirmsNoCredentialCookieUrlOrEnvValuesInResponse-not-confirmed");
  }
  if (ownerResponse.confirmsAuthStorageDeploymentPrerequisitesLiveReady !== true) {
    missing.push("confirmsAuthStorageDeploymentPrerequisitesLiveReady-not-confirmed");
  }
  if (ownerResponse.confirmsOwnerApprovesOrdinaryTeachingLiveSmokes !== true) {
    missing.push("confirmsOwnerApprovesOrdinaryTeachingLiveSmokes-not-confirmed");
  }
  if (ownerResponse.confirmsProviderSideEffectsRequireSeparateApproval !== true) {
    missing.push("confirmsProviderSideEffectsRequireSeparateApproval-not-confirmed");
  }
  if (ownerResponse.confirmsLocalDryRunEvidenceNotProductionLiveEvidence !== true) {
    missing.push("confirmsLocalDryRunEvidenceNotProductionLiveEvidence-not-confirmed");
  }
  return missing;
}

const safeLabelFields = [
  "approvedAppAuthReadinessEvidenceLabel",
  "approvedTeacherAuthReadinessEvidenceLabel",
  "approvedExternalStorageReadinessEvidenceLabel",
  "approvedVercelProductionDeploymentEvidenceLabel",
  "approvedDeploymentReachabilityEvidenceLabel",
  "approvedTeacherAuthCookieLabel",
  "approvedSmokeTeacherIdLabel",
  "approvedSmokeCourseIdLabel",
  "approvedOtherTeacherIdLabel",
  "approvedStudentIdLabel",
  "approvedReleaseRunIdLabel",
];

function buildRedactedOwnerResponse({ ownerResponse, unsafeFindings }) {
  const unsafeFieldPaths = new Set(unsafeFindings.map((finding) => finding.fieldPath));
  const redactedLabels = Object.fromEntries(
    safeLabelFields.map((field) => [
      field,
      unsafeFieldPaths.has(field) ? null : readString(ownerResponse[field], null),
    ]),
  );
  return {
    responseStatus: readString(ownerResponse.responseStatus, "unknown"),
    decisionId: readString(ownerResponse.decisionId, null),
    ...redactedLabels,
    confirmsNoCredentialCookieUrlOrEnvValuesInResponse:
      ownerResponse.confirmsNoCredentialCookieUrlOrEnvValuesInResponse === true,
    confirmsAuthStorageDeploymentPrerequisitesLiveReady:
      ownerResponse.confirmsAuthStorageDeploymentPrerequisitesLiveReady === true,
    confirmsOwnerApprovesOrdinaryTeachingLiveSmokes:
      ownerResponse.confirmsOwnerApprovesOrdinaryTeachingLiveSmokes === true,
    confirmsProviderSideEffectsRequireSeparateApproval:
      ownerResponse.confirmsProviderSideEffectsRequireSeparateApproval === true,
    confirmsLocalDryRunEvidenceNotProductionLiveEvidence:
      ownerResponse.confirmsLocalDryRunEvidenceNotProductionLiveEvidence === true,
  };
}

function buildBlockedReasons({ missingFields, unsafeFindings }) {
  const reasons = [...missingFields];
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
    "# UAIS Ordinary Teaching Production Evidence Response Validation",
    "",
    `Status: \`${report.status}\``,
    `Decision: \`${report.decisionId}\``,
    `Owner response status: \`${report.summary.ownerResponseStatus}\``,
    `Live smoke prep may proceed: \`${report.summary.liveSmokePrepMayProceed}\``,
    `Enterprise audit collection may proceed: \`${report.summary.enterpriseAuditCollectionMayProceed}\``,
    `Provider side effects still forbidden: \`${report.summary.providerSideEffectsStillForbidden}\``,
    `Release ready: \`${report.summary.releaseReady}\``,
    "",
    "This validation performs no live operation, production smoke, remote write, provider side effect, or release-run binding.",
    "",
    "## Redacted Owner Response",
    "",
    `- App auth evidence label: \`${report.redactedOwnerResponse.approvedAppAuthReadinessEvidenceLabel ?? "missing"}\``,
    `- Teacher auth evidence label: \`${report.redactedOwnerResponse.approvedTeacherAuthReadinessEvidenceLabel ?? "missing"}\``,
    `- External storage evidence label: \`${report.redactedOwnerResponse.approvedExternalStorageReadinessEvidenceLabel ?? "missing"}\``,
    `- Vercel deployment evidence label: \`${report.redactedOwnerResponse.approvedVercelProductionDeploymentEvidenceLabel ?? "missing"}\``,
    `- Deployment reachability label: \`${report.redactedOwnerResponse.approvedDeploymentReachabilityEvidenceLabel ?? "missing"}\``,
    `- Teacher cookie label: \`${report.redactedOwnerResponse.approvedTeacherAuthCookieLabel ?? "missing"}\``,
    `- Release run label: \`${report.redactedOwnerResponse.approvedReleaseRunIdLabel ?? "missing"}\``,
    "",
    "## Blocked Reasons",
    "",
    ...formatBullets(report.blockedReasons),
  ];

  if (report.requiredEvidenceAfterApproval.length > 0) {
    lines.push("", "## Required Evidence After Approval", "");
    lines.push(...formatBullets(report.requiredEvidenceAfterApproval));
  }

  if (report.requiredCommandNames.length > 0) {
    lines.push("", "## Required Command Names", "");
    lines.push(...formatBullets(report.requiredCommandNames));
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
