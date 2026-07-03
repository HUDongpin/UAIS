#!/usr/bin/env node

import { readFileSync } from "node:fs";

const decisionId = "vercel-env-deploy-and-smoke-chain";
const uaisEnvPrefix = "UAIS_";
const secretLikePrefix = "secret";
const approvedEnvFilePlaceholderPattern = ["<approved-env", "-file>"].join("");
const deploymentUrlPlaceholderPattern = ["<deployment", "-url>"].join("");
const unsafePatterns = [
  { id: "raw-url", pattern: /https?:\/\//i },
  { id: "local-user-path", pattern: /\/Users\// },
  { id: "local-env-file", pattern: /\.env\.local/i },
  {
    id: "env-assignment",
    pattern: new RegExp(`\\b${uaisEnvPrefix}[A-Z0-9_]*\\s*=`),
  },
  { id: "secret_like_token", pattern: new RegExp(`${secretLikePrefix}-`, "i") },
  { id: "env-file-placeholder", pattern: new RegExp(approvedEnvFilePlaceholderPattern, "i") },
  { id: "deployment-url-placeholder", pattern: new RegExp(deploymentUrlPlaceholderPattern, "i") },
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
    target: "owner-decision-vercel-env-deploy-response-validation",
    status,
    releaseReady: false,
    decisionId,
    responsibleSession: "S22/S19/S10",
    summary: {
      templateStatus: readString(templateReport.status, "unknown"),
      ownerResponseStatus: readString(ownerResponse.responseStatus, "unknown"),
      requiredEvidenceAfterApprovalCount: requiredEvidenceAfterApproval.length,
      requiredCommandNameCount: requiredCommandNames.length,
      missingFieldCount: missingFields.length,
      unsafeFindingCount: unsafeFindings.length,
      s19EnvApplyPrepMayProceed:
        accepted && ownerResponse.confirmsS19MayPrepareVercelEnvApplyAfterUpstreamReady === true,
      s19EnvApplyRunApproved:
        accepted &&
        ownerResponse.confirmsS19MayRunVercelEnvSyncApplyAfterUpstreamReady === true,
      s22DeployPrepMayProceed:
        accepted &&
        ownerResponse.confirmsS22MayPrepareProductionDeployAfterEnvApplyEvidence === true,
      s22ProductionDeployRunApproved:
        accepted &&
        ownerResponse.confirmsS22MayRunProductionDeployAfterEnvApplyEvidence === true,
      deployedSmokePrepMayProceed:
        accepted &&
        ownerResponse.confirmsS22MayPrepareDeployedRouteSmokesAfterProductionDeploymentEvidence ===
          true,
      deployedSmokeRunApproved:
        accepted &&
        ownerResponse.confirmsS22MayRunDeployedRouteSmokesAfterProductionDeploymentEvidence ===
          true,
      vercelLiveRunApproved:
        accepted &&
        ownerResponse.confirmsS19MayRunVercelEnvSyncApplyAfterUpstreamReady === true &&
        ownerResponse.confirmsS22MayRunProductionDeployAfterEnvApplyEvidence === true &&
        ownerResponse.confirmsS22MayRunDeployedRouteSmokesAfterProductionDeploymentEvidence ===
          true,
      liveChainStillForbidden:
        ownerResponse.confirmsLiveProviderGenerationSmokeRequiresSeparateApproval === true,
      liveProviderGenerationSmokeRequiresSeparateApproval:
        ownerResponse.confirmsLiveProviderGenerationSmokeRequiresSeparateApproval === true,
      releaseReady: false,
    },
    requiredEvidenceAfterApproval,
    requiredCommandNames,
    redactedOwnerResponse: buildRedactedOwnerResponse({ ownerResponse, unsafeFindings }),
    blockedReasons: buildBlockedReasons({ missingFields, unsafeFindings }),
    unsafeFindings,
    postValidationAllowedChecks: accepted
      ? [
          "prepare-s19-vercel-env-sync-apply-command-after-upstream-auth-storage-clears",
          "prepare-s22-production-deployment-command-after-env-sync-evidence",
          "prepare-deployed-route-smoke-commands-after-production-deployment-evidence",
          "prepare-ordinary-teaching-live-smoke-commands-after-auth-storage-deployment-readiness",
        ]
      : [],
    stillForbiddenUntilSeparateApproval: [
      "print-or-log-vercel-env-credential-values",
      "print-or-log-deployment-url-values",
      "print-or-log-teacher-auth-cookie-values",
      "run-vercel-env-apply-before-upstream-auth-storage-clears",
      "run-vercel-production-deploy-before-env-apply-evidence",
      "run-live-provider-generation-smoke-before-browser-smoke-and-owner-approval",
      "run-deployed-route-smokes-before-production-deployment-evidence",
      "run-ordinary-teaching-live-smokes-before-auth-storage-and-deployment-readiness",
      "bind-production-release-run-id",
    ],
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      deploymentUrlsOmitted: true,
      envFilePathsOmitted: true,
      envValuesOmitted: true,
      vercelSecretValuesOmitted: true,
      cookieValuesOmitted: true,
      responseBodiesOmitted: true,
      unsafeValuesOmitted: true,
      commandBodiesOmitted: true,
      noLiveMutationPerformed: true,
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

function findMissingFields(ownerResponse) {
  const missing = [];
  if (ownerResponse.responseStatus !== "owner-response-provided") {
    missing.push("responseStatus-not-provided");
  }
  if (ownerResponse.decisionId !== decisionId) {
    missing.push("decisionId-mismatch");
  }
  if (!isSafeLabel(ownerResponse.approvedVercelProjectReadinessLabel)) {
    missing.push("approvedVercelProjectReadinessLabel-missing-or-invalid");
  }
  if (!isSafeLabel(ownerResponse.approvedServerOnlyEnvSourceLabel)) {
    missing.push("approvedServerOnlyEnvSourceLabel-missing-or-invalid");
  }
  if (!isSafeLabel(ownerResponse.approvedVercelEnvSyncApplyEvidenceLabel)) {
    missing.push("approvedVercelEnvSyncApplyEvidenceLabel-missing-or-invalid");
  }
  if (!isSafeLabel(ownerResponse.approvedProductionDeploymentEvidenceLabel)) {
    missing.push("approvedProductionDeploymentEvidenceLabel-missing-or-invalid");
  }
  if (!isSafeLabel(ownerResponse.approvedDeploymentBaseUrlLabel)) {
    missing.push("approvedDeploymentBaseUrlLabel-missing-or-invalid");
  }
  if (!isSafeLabel(ownerResponse.approvedReleaseRunIdLabel)) {
    missing.push("approvedReleaseRunIdLabel-missing-or-invalid");
  }
  if (ownerResponse.confirmsNoCredentialValuesInResponse !== true) {
    missing.push("confirmsNoCredentialValuesInResponse-not-confirmed");
  }
  if (ownerResponse.confirmsS19MayPrepareVercelEnvApplyAfterUpstreamReady !== true) {
    missing.push("confirmsS19MayPrepareVercelEnvApplyAfterUpstreamReady-not-confirmed");
  }
  if (ownerResponse.confirmsS19MayRunVercelEnvSyncApplyAfterUpstreamReady !== true) {
    missing.push("confirmsS19MayRunVercelEnvSyncApplyAfterUpstreamReady-not-confirmed");
  }
  if (ownerResponse.confirmsS22MayPrepareProductionDeployAfterEnvApplyEvidence !== true) {
    missing.push("confirmsS22MayPrepareProductionDeployAfterEnvApplyEvidence-not-confirmed");
  }
  if (ownerResponse.confirmsS22MayRunProductionDeployAfterEnvApplyEvidence !== true) {
    missing.push("confirmsS22MayRunProductionDeployAfterEnvApplyEvidence-not-confirmed");
  }
  if (
    ownerResponse.confirmsS22MayPrepareDeployedRouteSmokesAfterProductionDeploymentEvidence !==
    true
  ) {
    missing.push(
      "confirmsS22MayPrepareDeployedRouteSmokesAfterProductionDeploymentEvidence-not-confirmed",
    );
  }
  if (
    ownerResponse.confirmsS22MayRunDeployedRouteSmokesAfterProductionDeploymentEvidence !== true
  ) {
    missing.push(
      "confirmsS22MayRunDeployedRouteSmokesAfterProductionDeploymentEvidence-not-confirmed",
    );
  }
  if (ownerResponse.confirmsLiveProviderGenerationSmokeRequiresSeparateApproval !== true) {
    missing.push("confirmsLiveProviderGenerationSmokeRequiresSeparateApproval-not-confirmed");
  }
  return missing;
}

function buildRedactedOwnerResponse({ ownerResponse, unsafeFindings }) {
  const unsafeFieldPaths = new Set(unsafeFindings.map((finding) => finding.fieldPath));
  return {
    responseStatus: readString(ownerResponse.responseStatus, "unknown"),
    decisionId: readString(ownerResponse.decisionId, null),
    approvedVercelProjectReadinessLabel: unsafeFieldPaths.has(
      "approvedVercelProjectReadinessLabel",
    )
      ? null
      : readString(ownerResponse.approvedVercelProjectReadinessLabel, null),
    approvedServerOnlyEnvSourceLabel: unsafeFieldPaths.has("approvedServerOnlyEnvSourceLabel")
      ? null
      : readString(ownerResponse.approvedServerOnlyEnvSourceLabel, null),
    approvedVercelEnvSyncApplyEvidenceLabel: unsafeFieldPaths.has(
      "approvedVercelEnvSyncApplyEvidenceLabel",
    )
      ? null
      : readString(ownerResponse.approvedVercelEnvSyncApplyEvidenceLabel, null),
    approvedProductionDeploymentEvidenceLabel: unsafeFieldPaths.has(
      "approvedProductionDeploymentEvidenceLabel",
    )
      ? null
      : readString(ownerResponse.approvedProductionDeploymentEvidenceLabel, null),
    approvedDeploymentBaseUrlLabel: unsafeFieldPaths.has("approvedDeploymentBaseUrlLabel")
      ? null
      : readString(ownerResponse.approvedDeploymentBaseUrlLabel, null),
    approvedReleaseRunIdLabel: unsafeFieldPaths.has("approvedReleaseRunIdLabel")
      ? null
      : readString(ownerResponse.approvedReleaseRunIdLabel, null),
    confirmsNoCredentialValuesInResponse:
      ownerResponse.confirmsNoCredentialValuesInResponse === true,
    confirmsS19MayPrepareVercelEnvApplyAfterUpstreamReady:
      ownerResponse.confirmsS19MayPrepareVercelEnvApplyAfterUpstreamReady === true,
    confirmsS19MayRunVercelEnvSyncApplyAfterUpstreamReady:
      ownerResponse.confirmsS19MayRunVercelEnvSyncApplyAfterUpstreamReady === true,
    confirmsS22MayPrepareProductionDeployAfterEnvApplyEvidence:
      ownerResponse.confirmsS22MayPrepareProductionDeployAfterEnvApplyEvidence === true,
    confirmsS22MayRunProductionDeployAfterEnvApplyEvidence:
      ownerResponse.confirmsS22MayRunProductionDeployAfterEnvApplyEvidence === true,
    confirmsS22MayPrepareDeployedRouteSmokesAfterProductionDeploymentEvidence:
      ownerResponse.confirmsS22MayPrepareDeployedRouteSmokesAfterProductionDeploymentEvidence ===
      true,
    confirmsS22MayRunDeployedRouteSmokesAfterProductionDeploymentEvidence:
      ownerResponse.confirmsS22MayRunDeployedRouteSmokesAfterProductionDeploymentEvidence === true,
    confirmsLiveProviderGenerationSmokeRequiresSeparateApproval:
      ownerResponse.confirmsLiveProviderGenerationSmokeRequiresSeparateApproval === true,
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
    "# UAIS Vercel Env Deploy Owner Response Validation",
    "",
    `Status: \`${report.status}\``,
    `Decision: \`${report.decisionId}\``,
    `Owner response status: \`${report.summary.ownerResponseStatus}\``,
    `S19 env apply prep may proceed: \`${report.summary.s19EnvApplyPrepMayProceed}\``,
    `S19 env apply run approved: \`${report.summary.s19EnvApplyRunApproved}\``,
    `S22 deploy prep may proceed: \`${report.summary.s22DeployPrepMayProceed}\``,
    `S22 production deploy run approved: \`${report.summary.s22ProductionDeployRunApproved}\``,
    `Deployed smoke prep may proceed: \`${report.summary.deployedSmokePrepMayProceed}\``,
    `Deployed smoke run approved: \`${report.summary.deployedSmokeRunApproved}\``,
    `Vercel live run approved: \`${report.summary.vercelLiveRunApproved}\``,
    `Live chain still forbidden: \`${report.summary.liveChainStillForbidden}\``,
    `Live provider generation smoke requires separate approval: \`${report.summary.liveProviderGenerationSmokeRequiresSeparateApproval}\``,
    `Release ready: \`${report.summary.releaseReady}\``,
    "",
    "This validation performs no live operation, env apply, deployment, smoke, remote write, or release-run binding.",
    "",
    "## Redacted Owner Response",
    "",
    `- Project readiness label: \`${report.redactedOwnerResponse.approvedVercelProjectReadinessLabel ?? "missing"}\``,
    `- Env source label: \`${report.redactedOwnerResponse.approvedServerOnlyEnvSourceLabel ?? "missing"}\``,
    `- Env sync apply evidence label: \`${report.redactedOwnerResponse.approvedVercelEnvSyncApplyEvidenceLabel ?? "missing"}\``,
    `- Production deployment evidence label: \`${report.redactedOwnerResponse.approvedProductionDeploymentEvidenceLabel ?? "missing"}\``,
    `- Deployment base URL label: \`${report.redactedOwnerResponse.approvedDeploymentBaseUrlLabel ?? "missing"}\``,
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
