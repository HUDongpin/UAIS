#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { basename } from "node:path";

const unsafePatterns = [
  { id: "raw-url", pattern: /https?:\/\//i },
  { id: "local-user-path", pattern: /\/Users\// },
  { id: "local-env-file", pattern: /\.env\.local/i },
  { id: "teacher-auth-cookie-assignment", pattern: /uais_teacher_auth_(claims|signature)=/i },
  { id: "env-assignment", pattern: /\bUAIS_[A-Z0-9_]*\s*=/ },
  { id: "bearer-token", pattern: /\bBearer\s+[A-Za-z0-9._~+/-]+=*/ },
  { id: "secret-like-token", pattern: /secret-(token|cookie|key)/i },
];

const productionEvidenceDecisionIds = new Set([
  "ordinary-teaching-production-evidence",
  "manual-ppt-playback-acceptance",
  "enterprise-live-evidence-audit",
  "production-release-run",
]);

function main() {
  const args = parseArgs(process.argv.slice(2));
  const completionPacket = readJsonArg(args, "completion-packet");
  const ownerResponseCompletion = args["owner-response-completion"]
    ? readJsonArg(args, "owner-response-completion")
    : completionPacket;
  const validation = buildValidation({
    completionPacket,
    completionPacketPath: args["completion-packet"],
    ownerResponseCompletion,
    ownerResponseCompletionPath: args["owner-response-completion"] ?? args["completion-packet"],
  });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(validation));
    return;
  }

  process.stdout.write(`${JSON.stringify(validation, null, 2)}\n`);
}

function buildValidation({
  completionPacket,
  completionPacketPath,
  ownerResponseCompletion,
  ownerResponseCompletionPath,
}) {
  const requirementItems = readRecordArray(completionPacket.ownerCompletionItems)
    .map((item) => ({
      rank: readNullableRank(item.rank),
      decisionId: readString(item.decisionId, "unknown-decision"),
      requiredOwnerInputFields: readStringArray(item.requiredOwnerInputFields),
      requiredOwnerLabelFields: readStringArray(item.requiredOwnerLabelFields),
      ownerResponseValidationCommand: readSafeOwnerResponseValidationCommand(
        item.ownerResponseValidationCommand,
      ),
    }))
    .sort((a, b) => readRank(a.rank) - readRank(b.rank));
  const responseByDecisionId = new Map(
    readRecordArray(ownerResponseCompletion.ownerCompletionItems).map((item) => [
      readString(item.decisionId, "unknown-decision"),
      item,
    ]),
  );

  const validationItems = requirementItems.map((requirement) =>
    validateItem({ requirement, responseItem: responseByDecisionId.get(requirement.decisionId) }),
  );
  const ownerResponseUnsafeFindingTotal = validationItems.reduce(
    (sum, item) => sum + item.unsafeFindings.length,
    0,
  );
  const upstreamUnsafeFindingTotal = readNumber(completionPacket.summary?.unsafeFindingTotal, 0);
  const releaseRunBindingPerformedCount = readNumber(
    completionPacket.summary?.releaseRunBindingPerformedCount,
    0,
  );
  const unsafeFindingTotal = ownerResponseUnsafeFindingTotal + upstreamUnsafeFindingTotal;
  const safetyAttentionCount = unsafeFindingTotal + releaseRunBindingPerformedCount;
  const upstreamSafetyFindings = buildUpstreamSafetyFindings({
    upstreamUnsafeFindingTotal,
    releaseRunBindingPerformedCount,
  });
  const missingFieldTotal = validationItems.reduce(
    (sum, item) => sum + item.missingFields.length,
    0,
  );
  const placeholderFieldTotal = validationItems.reduce(
    (sum, item) => sum + item.placeholderFields.length,
    0,
  );
  const confirmationFailureTotal = validationItems.reduce(
    (sum, item) => sum + item.confirmationFailures.length,
    0,
  );
  const productionEvidencePlaceholderFieldTotal = validationItems.reduce(
    (sum, item) =>
      isProductionEvidencePlaceholderItem(item) ? sum + item.placeholderFields.length : sum,
    0,
  );
  const needsOwnerInput = validationItems.some(
    (item) =>
      item.status !== "owner-response-completion-accepted" &&
      !isProductionEvidencePlaceholderItem(item),
  );
  const productionEvidenceRequired =
    productionEvidencePlaceholderFieldTotal > 0 && !needsOwnerInput && safetyAttentionCount === 0;
  const acceptedItemCount = validationItems.filter(
    (item) => item.status === "owner-response-completion-accepted",
  ).length;
  const individualOwnerResponseValidationCommands = validationItems
    .filter((item) => item.ownerResponseValidationCommand)
    .map((item) => ({
      rank: item.rank,
      decisionId: item.decisionId,
      ownerResponseValidationCommand: item.ownerResponseValidationCommand,
    }));
  const firstIncompleteOwnerResponse = buildFirstIncompleteOwnerResponse(validationItems);
  const incompleteItemCount = validationItems.length - acceptedItemCount;
  const status =
    safetyAttentionCount > 0
      ? "owner-response-completion-rejected"
      : productionEvidenceRequired
        ? "owner-response-completion-awaiting-production-evidence"
      : incompleteItemCount > 0
        ? "owner-response-completion-incomplete"
        : "owner-response-completion-accepted";
  const postValidationMayProceed = status === "owner-response-completion-accepted";
  const sourceOwnerDecisionQueueStatus = readString(
    completionPacket.sourceOwnerDecisionQueueStatus,
    readString(completionPacket.ownerDecisionQueueStatus, "unknown"),
  );
  const ownerDecisionQueueStatus = deriveOwnerDecisionQueueStatus({
    sourceOwnerDecisionQueueStatus,
    status,
    needsOwnerInput,
    productionEvidenceRequired,
    safetyAttentionCount,
  });

  return {
    target: "owner-decision-response-completion-validation",
    status,
    releaseReady: false,
    releaseGateStatus: readString(completionPacket.releaseGateStatus, "unknown"),
    ownerDecisionQueueStatus,
    sourceOwnerDecisionQueueStatus,
    responsibleSession: "S22/S19/S10",
    sourceCompletionPacketFileName: basename(completionPacketPath),
    sourceOwnerResponseCompletionFileName: basename(ownerResponseCompletionPath),
    summary: {
      ownerCompletionItemCount: validationItems.length,
      acceptedItemCount,
      incompleteItemCount,
      missingFieldTotal,
      placeholderFieldTotal,
      unsafeFindingTotal,
      releaseRunBindingPerformedCount,
      confirmationFailureTotal,
      individualValidationCommandCount: individualOwnerResponseValidationCommands.length,
      safetyAttentionCount,
      needsOwnerInput,
      productionEvidenceRequired,
      postValidationMayProceed,
      releaseReady: false,
    },
    firstIncompleteOwnerResponse,
    validationItems,
    individualOwnerResponseValidationCommands,
    upstreamSafetyFindings,
    postValidationAllowedChecks: postValidationMayProceed
      ? [
          "run-individual-owner-response-validators",
          "prepare-redacted-s19-env-sync-dry-run-after-owner-approval",
          "prepare-s22-readiness-evidence-after-env-sync-evidence",
        ]
      : [],
    stillForbiddenUntilSeparateApproval: [
      "inspect-or-print-credential-values",
      "run-vercel-env-apply",
      "run-vercel-production-deploy",
      "run-production-live-smokes",
      "run-enterprise-live-evidence-audit",
      "bind-production-release-run-id",
    ],
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      credentialValuesOmitted: true,
      cookieValuesOmitted: true,
      responseBodiesOmitted: true,
      unsafeValuesOmitted: true,
      noEnvValuesRequested: true,
      noLiveMutationPerformed: true,
      noDeploymentMutationPerformed: true,
      noEnvApplyPerformed: true,
      noReleaseRunBindingPerformed: releaseRunBindingPerformedCount === 0,
    },
  };
}

function isProductionEvidencePlaceholderItem(item) {
  return (
    productionEvidenceDecisionIds.has(item.decisionId) &&
    item.missingFields.length === 0 &&
    item.unsafeFindings.length === 0 &&
    item.confirmationFailures.length === 0 &&
    item.placeholderFields.length > 0
  );
}

function deriveOwnerDecisionQueueStatus({
  sourceOwnerDecisionQueueStatus,
  status,
  needsOwnerInput,
  productionEvidenceRequired,
  safetyAttentionCount,
}) {
  if (safetyAttentionCount > 0 || status === "owner-response-completion-rejected") {
    return sourceOwnerDecisionQueueStatus;
  }
  if (needsOwnerInput) {
    return sourceOwnerDecisionQueueStatus;
  }
  if (productionEvidenceRequired) {
    return "owner-decisions-cleared-awaiting-production-evidence";
  }
  if (status === "owner-response-completion-accepted") {
    return "owner-decisions-cleared";
  }
  return sourceOwnerDecisionQueueStatus;
}

function buildFirstIncompleteOwnerResponse(validationItems) {
  const firstIncomplete = validationItems.find(
    (item) => item.status !== "owner-response-completion-accepted",
  );
  if (!firstIncomplete) {
    return null;
  }
  return {
    rank: firstIncomplete.rank,
    decisionId: firstIncomplete.decisionId,
    status: firstIncomplete.status,
    missingFieldCount: firstIncomplete.missingFields.length,
    placeholderFieldCount: firstIncomplete.placeholderFields.length,
    unsafeFindingCount: firstIncomplete.unsafeFindings.length,
    confirmationFailureCount: firstIncomplete.confirmationFailures.length,
    requiredOwnerInputFields: firstIncomplete.requiredOwnerInputFields,
    ownerResponseValidationCommand: firstIncomplete.ownerResponseValidationCommand,
  };
}

function buildUpstreamSafetyFindings({
  upstreamUnsafeFindingTotal,
  releaseRunBindingPerformedCount,
}) {
  const findings = [];
  if (upstreamUnsafeFindingTotal > 0) {
    findings.push(`completion-packet-unsafe-finding-total-${upstreamUnsafeFindingTotal}`);
  }
  if (releaseRunBindingPerformedCount > 0) {
    findings.push(
      `completion-packet-release-run-binding-performed-${releaseRunBindingPerformedCount}`,
    );
  }
  return findings;
}

function validateItem({ requirement, responseItem }) {
  const response = extractOwnerResponse(responseItem);
  const missingFields = [];
  const placeholderFields = [];
  const unsafeFindings = isRecord(response)
    ? findUnsafeFindings(response, ownerResponsePath(responseItem))
    : [];
  const confirmationFailures = [];

  if (!isRecord(responseItem) || !isRecord(response)) {
    missingFields.push("ownerCompletionItem");
  } else {
    if (response.responseStatus !== "owner-response-provided") {
      missingFields.push("responseStatus");
    }
    if (response.decisionId !== requirement.decisionId) {
      missingFields.push("decisionId");
    }
    for (const field of requirement.requiredOwnerInputFields) {
      if (!hasUsableString(response[field])) {
        missingFields.push(field);
      } else if (isPlaceholder(response[field])) {
        placeholderFields.push(field);
      }
    }
    for (const [key, value] of Object.entries(response)) {
      if (key.startsWith("confirms") && value !== true) {
        confirmationFailures.push(key);
      }
    }
  }

  const status =
    unsafeFindings.length > 0
      ? "owner-response-completion-rejected"
      : missingFields.length > 0 ||
          placeholderFields.length > 0 ||
          confirmationFailures.length > 0
        ? "owner-response-completion-incomplete"
        : "owner-response-completion-accepted";

  return {
    rank: requirement.rank,
    decisionId: requirement.decisionId,
    status,
    ownerResponseValidationCommand: requirement.ownerResponseValidationCommand,
    requiredOwnerInputFields: requirement.requiredOwnerInputFields,
    requiredOwnerLabelFields: requirement.requiredOwnerLabelFields,
    providedSafeFieldNames: isRecord(response)
      ? requirement.requiredOwnerInputFields.filter(
          (field) =>
            hasUsableString(response[field]) &&
            !isPlaceholder(response[field]) &&
            !fieldHasUnsafeFinding(field, unsafeFindings),
        )
      : [],
    missingFields: uniqueStrings(missingFields),
    placeholderFields: uniqueStrings(placeholderFields),
    unsafeFindings,
    confirmationFailures: uniqueStrings(confirmationFailures),
    releaseReady: false,
  };
}

function extractOwnerResponse(item) {
  if (!isRecord(item)) {
    return {};
  }
  if (isRecord(item.copySafeOwnerReplyStub)) {
    return item.copySafeOwnerReplyStub;
  }
  if (isRecord(item.ownerResponse)) {
    return item.ownerResponse;
  }
  return item;
}

function ownerResponsePath(item) {
  if (isRecord(item?.copySafeOwnerReplyStub)) {
    return "copySafeOwnerReplyStub";
  }
  if (isRecord(item?.ownerResponse)) {
    return "ownerResponse";
  }
  return "";
}

function findUnsafeFindings(value, path = "") {
  const findings = [];
  for (const entry of flattenStrings(value, path)) {
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

function renderMarkdown(validation) {
  const lines = [
    "# UAIS Owner Response Completion Validation",
    "",
    `Status: \`${validation.status}\``,
    `Release gate: \`${validation.releaseGateStatus}\``,
    `Owner queue: \`${validation.ownerDecisionQueueStatus}\``,
    `Source owner queue: \`${validation.sourceOwnerDecisionQueueStatus}\``,
    `Needs owner input: \`${validation.summary.needsOwnerInput}\``,
    `Production evidence required: \`${validation.summary.productionEvidenceRequired}\``,
    `Post-validation may proceed: \`${validation.summary.postValidationMayProceed}\``,
    `Release ready: \`${validation.summary.releaseReady}\``,
    "",
    "This validation performs no live operation, env apply, deploy, production smoke, enterprise live audit, or release-run binding.",
    "",
    "## Summary",
    "",
    `- Accepted items: ${validation.summary.acceptedItemCount}`,
    `- Incomplete items: ${validation.summary.incompleteItemCount}`,
    `- Missing fields: ${validation.summary.missingFieldTotal}`,
    `- Placeholder fields: ${validation.summary.placeholderFieldTotal}`,
    `- Unsafe findings: ${validation.summary.unsafeFindingTotal}`,
    `- Confirmation failures: ${validation.summary.confirmationFailureTotal}`,
    `- Individual validation commands: ${validation.summary.individualValidationCommandCount}`,
  ];

  if (validation.firstIncompleteOwnerResponse) {
    lines.push(
      "",
      "## First Incomplete Owner Response",
      "",
      `Decision: \`${validation.firstIncompleteOwnerResponse.decisionId}\``,
      `Status: \`${validation.firstIncompleteOwnerResponse.status}\``,
      `Missing fields: ${validation.firstIncompleteOwnerResponse.missingFieldCount}`,
      `Placeholder fields: ${validation.firstIncompleteOwnerResponse.placeholderFieldCount}`,
      `Unsafe findings: ${validation.firstIncompleteOwnerResponse.unsafeFindingCount}`,
      `Confirmation failures: ${validation.firstIncompleteOwnerResponse.confirmationFailureCount}`,
      "",
      "Required owner input fields:",
      "",
      ...formatBullets(validation.firstIncompleteOwnerResponse.requiredOwnerInputFields),
      "",
      "Validation command:",
      "",
      "```sh",
      validation.firstIncompleteOwnerResponse.ownerResponseValidationCommand ?? "none-recorded",
      "```",
    );
  } else {
    lines.push("", "## First Incomplete Owner Response", "", "`none-recorded`");
  }

  lines.push(
    "",
    "## Post-Validation Allowed Checks",
    "",
    ...formatBullets(validation.postValidationAllowedChecks),
  );

  if (validation.stillForbiddenUntilSeparateApproval.length > 0) {
    lines.push(
      "",
      "## Still Forbidden Until Separate Approval",
      "",
      ...formatBullets(validation.stillForbiddenUntilSeparateApproval),
    );
  }

  lines.push(
    "",
    "## Individual Validation Commands",
    "",
    "| Rank | Decision | Command |",
    "| ---: | --- | --- |",
    ...validation.individualOwnerResponseValidationCommands.map(
      (item) =>
        `| \`${item.rank ?? "?"}\` | \`${item.decisionId}\` | \`${item.ownerResponseValidationCommand}\` |`,
    ),
    "",
    "## Item Validation",
    "",
    "| Rank | Decision | Status | Missing | Placeholder | Unsafe | Confirmations |",
    "| ---: | --- | --- | ---: | ---: | ---: | ---: |",
    ...validation.validationItems.map((item) =>
      [
        `| \`${item.rank ?? "?"}\``,
        `| \`${item.decisionId}\``,
        `| \`${item.status}\``,
        `| ${item.missingFields.length}`,
        `| ${item.placeholderFields.length}`,
        `| ${item.unsafeFindings.length}`,
        `| ${item.confirmationFailures.length} |`,
      ].join(" "),
    ),
  );

  for (const item of validation.validationItems) {
    lines.push(
      "",
      `## ${item.rank ?? "?"}. ${item.decisionId}`,
      "",
      `Status: \`${item.status}\``,
      "",
      "Individual validation command:",
      "",
      "```sh",
      item.ownerResponseValidationCommand ?? "none-recorded",
      "```",
      "",
      "Provided safe field names:",
      "",
      ...formatBullets(item.providedSafeFieldNames),
      "",
      "Missing fields:",
      "",
      ...formatBullets(item.missingFields),
      "",
      "Placeholder fields:",
      "",
      ...formatBullets(item.placeholderFields),
      "",
      "Unsafe finding field paths:",
      "",
      ...formatBullets(
        item.unsafeFindings.map((finding) => `${finding.fieldPath}:${finding.patternId}`),
      ),
      "",
      "Confirmation failures:",
      "",
      ...formatBullets(item.confirmationFailures),
    );
  }

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

function readString(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function readStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function readRecordArray(value) {
  return Array.isArray(value) ? value.filter((item) => isRecord(item)) : [];
}

function readNullableRank(value) {
  return Number.isInteger(value) ? value : null;
}

function readRank(value) {
  return Number.isInteger(value) ? value : Number.MAX_SAFE_INTEGER;
}

function readNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function hasUsableString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlaceholder(value) {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return (
    normalized.includes("<") ||
    normalized.includes(">") ||
    normalized.includes("label only") ||
    normalized.includes("no url") ||
    normalized.includes("no credential") ||
    normalized.includes("choose ") ||
    normalized === "missing"
  );
}

function fieldHasUnsafeFinding(field, unsafeFindings) {
  return unsafeFindings.some(
    (finding) =>
      finding.fieldPath === field || finding.fieldPath.endsWith(`.${field}`),
  );
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

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string"))];
}

function formatBullets(values) {
  return values.length > 0 ? values.map((value) => `- \`${value}\``) : ["- `none-recorded`"];
}

function readSafeOwnerResponseValidationCommand(value) {
  if (typeof value !== "string") {
    return null;
  }
  const safePattern =
    /^node scripts\/owner-decision-[a-z0-9-]+-response-validation\.mjs --owner-response-template coordination\/reports\/[A-Za-z0-9._-]+\.json --owner-response path\/to\/filled-owner-response\.json$/;
  return safePattern.test(value) ? value : null;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

main();
