#!/usr/bin/env node

import { readFileSync } from "node:fs";

const decisionId = "manual-ppt-playback-acceptance";
const uaisEnvPrefix = "UAIS_";
const secretLikePrefix = "secret";
const audioUrlPlaceholderPattern = ["<audio", "-url>"].join("");
const pptPackagePathPlaceholderPattern = ["<ppt-package", "-path>"].join("");
const unsafePatterns = [
  { id: "raw-url", pattern: /https?:\/\//i },
  { id: "local-user-path", pattern: /\/Users\// },
  { id: "local-env-file", pattern: /\.env\.local/i },
  { id: "ppt-package-file", pattern: /\.(pptx|pptm|ppt)$/i },
  { id: "audio-file-or-url", pattern: /\.(wav|mp3|m4a|aac)(\b|$|\?)/i },
  {
    id: "env-assignment",
    pattern: new RegExp(`\\b${uaisEnvPrefix}[A-Z0-9_]*\\s*=`),
  },
  { id: "secret_like_token", pattern: new RegExp(`${secretLikePrefix}-`, "i") },
  { id: "audio-url-placeholder", pattern: new RegExp(audioUrlPlaceholderPattern, "i") },
  {
    id: "ppt-package-path-placeholder",
    pattern: new RegExp(pptPackagePathPlaceholderPattern, "i"),
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
    target: "owner-decision-manual-ppt-playback-acceptance-response-validation",
    status,
    releaseReady: false,
    decisionId,
    responsibleSession: "S24/S22/S10",
    summary: {
      templateStatus: readString(templateReport.status, "unknown"),
      ownerResponseStatus: readString(ownerResponse.responseStatus, "unknown"),
      requiredEvidenceAfterApprovalCount: requiredEvidenceAfterApproval.length,
      requiredCommandNameCount: requiredCommandNames.length,
      missingFieldCount: missingFields.length,
      unsafeFindingCount: unsafeFindings.length,
      humanQaMayProceedToFinalEvidence:
        accepted &&
        ownerResponse.confirmsHumanPowerPointPlaybackAccepted === true &&
        ownerResponse.confirmsHumanWpsPlaybackAccepted === true,
      enterpriseAuditCollectionMayProceed:
        accepted && ownerResponse.confirmsSameReleaseRunAndVercelDeploymentBinding === true,
      releaseRunBindingStillForbidden: true,
      releaseReady: false,
    },
    requiredEvidenceAfterApproval,
    requiredCommandNames,
    redactedOwnerResponse: buildRedactedOwnerResponse({ ownerResponse, unsafeFindings }),
    blockedReasons: buildBlockedReasons({ missingFields, unsafeFindings }),
    unsafeFindings,
    postValidationAllowedChecks: accepted
      ? [
          "prepare-final-manual-ppt-playback-acceptance-evidence-after-human-record",
          "prepare-enterprise-audit-evidence-collection-after-manual-acceptance",
        ]
      : [],
    stillForbiddenUntilSeparateApproval: [
      "mark-manual-ppt-accepted-before-human-playback",
      "reuse-manual-ppt-record-from-different-release-run",
      "reuse-manual-ppt-record-from-different-vercel-deployment",
      "accept-machine-preflight-as-final-human-acceptance",
      "log-private-ppt-package-paths-or-audio-urls",
      "bind-production-release-run-id-while-release-gate-blocked",
    ],
    safety: {
      sourcePathsOmitted: true,
      packagePathsOmitted: true,
      audioUrlsOmitted: true,
      rawUrlsOmitted: true,
      credentialValuesOmitted: true,
      responseBodiesOmitted: true,
      unsafeValuesOmitted: true,
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
  for (const field of requiredBooleanFields) {
    if (ownerResponse[field] !== true) {
      missing.push(`${field}-not-confirmed`);
    }
  }
  return missing;
}

const safeLabelFields = [
  "approvedPowerPointPlaybackEvidenceLabel",
  "approvedWpsPlaybackEvidenceLabel",
  "approvedManualAcceptanceRecordLabel",
  "approvedReleaseRunIdLabel",
  "approvedVercelProductionDeploymentEvidenceLabel",
  "approvedTargetClonedVoiceLabel",
  "approvedSlideAudioChecklistLabel",
  "approvedTestedAtTimestampLabel",
];

const requiredBooleanFields = [
  "confirmsNoPrivatePathsAudioUrlsOrCredentialValuesInResponse",
  "confirmsHumanPowerPointPlaybackAccepted",
  "confirmsHumanWpsPlaybackAccepted",
  "confirmsAcceptedAfterHumanPlayback",
  "confirmsAll19SlideAudioChecksTrue",
  "confirmsTargetClonedVoiceHeardPerSlide",
  "confirmsSameReleaseRunAndVercelDeploymentBinding",
  "confirmsMachinePreflightNotUsedAsFinalHumanAcceptance",
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
    confirmsNoPrivatePathsAudioUrlsOrCredentialValuesInResponse:
      ownerResponse.confirmsNoPrivatePathsAudioUrlsOrCredentialValuesInResponse === true,
    confirmsHumanPowerPointPlaybackAccepted:
      ownerResponse.confirmsHumanPowerPointPlaybackAccepted === true,
    confirmsHumanWpsPlaybackAccepted: ownerResponse.confirmsHumanWpsPlaybackAccepted === true,
    confirmsAcceptedAfterHumanPlayback:
      ownerResponse.confirmsAcceptedAfterHumanPlayback === true,
    confirmsAll19SlideAudioChecksTrue:
      ownerResponse.confirmsAll19SlideAudioChecksTrue === true,
    confirmsTargetClonedVoiceHeardPerSlide:
      ownerResponse.confirmsTargetClonedVoiceHeardPerSlide === true,
    confirmsSameReleaseRunAndVercelDeploymentBinding:
      ownerResponse.confirmsSameReleaseRunAndVercelDeploymentBinding === true,
    confirmsMachinePreflightNotUsedAsFinalHumanAcceptance:
      ownerResponse.confirmsMachinePreflightNotUsedAsFinalHumanAcceptance === true,
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
    "# UAIS Manual PPT Playback Acceptance Response Validation",
    "",
    `Status: \`${report.status}\``,
    `Decision: \`${report.decisionId}\``,
    `Owner response status: \`${report.summary.ownerResponseStatus}\``,
    `Human QA may proceed to final evidence: \`${report.summary.humanQaMayProceedToFinalEvidence}\``,
    `Enterprise audit collection may proceed: \`${report.summary.enterpriseAuditCollectionMayProceed}\``,
    `Release run binding still forbidden: \`${report.summary.releaseRunBindingStillForbidden}\``,
    `Release ready: \`${report.summary.releaseReady}\``,
    "",
    "This validation performs no human playback, live operation, deployment mutation, remote write, or release-run binding.",
    "",
    "## Redacted Owner Response",
    "",
    `- PowerPoint playback label: \`${report.redactedOwnerResponse.approvedPowerPointPlaybackEvidenceLabel ?? "missing"}\``,
    `- WPS playback label: \`${report.redactedOwnerResponse.approvedWpsPlaybackEvidenceLabel ?? "missing"}\``,
    `- Manual record label: \`${report.redactedOwnerResponse.approvedManualAcceptanceRecordLabel ?? "missing"}\``,
    `- Release run label: \`${report.redactedOwnerResponse.approvedReleaseRunIdLabel ?? "missing"}\``,
    `- Vercel deployment label: \`${report.redactedOwnerResponse.approvedVercelProductionDeploymentEvidenceLabel ?? "missing"}\``,
    `- Target cloned voice label: \`${report.redactedOwnerResponse.approvedTargetClonedVoiceLabel ?? "missing"}\``,
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
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:@/ -]{2,160}$/.test(value);
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

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatBullets(values) {
  return values.length > 0 ? values.map((value) => `- \`${value}\``) : ["- `none-recorded`"];
}

main();
