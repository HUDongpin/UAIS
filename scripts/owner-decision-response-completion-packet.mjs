#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const responsePackageManifest = readJsonArg(args, "response-package-manifest");
  const responseGapMatrix = readJsonArg(args, "response-gap-matrix");
  const reportsDir = args["reports-dir"];
  if (!reportsDir) {
    throw new Error("Missing required --reports-dir");
  }

  const packet = buildPacket({ responsePackageManifest, responseGapMatrix, reportsDir });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(packet));
    return;
  }

  process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
}

function buildPacket({ responsePackageManifest, responseGapMatrix, reportsDir }) {
  const gapRows = readRecordArray(responseGapMatrix.gapRows);
  const gapByDecisionId = new Map(
    gapRows.map((row) => [readString(row.decisionId, "unknown-decision"), row]),
  );
  const responsePackages = readRecordArray(responsePackageManifest.responsePackages);
  const ownerCompletionItems = responsePackages
    .map((responsePackage) =>
      buildCompletionItem({ responsePackage, gapByDecisionId, reportsDir }),
    )
    .sort((a, b) => readRank(a.rank) - readRank(b.rank));
  const copySafeStubCount = ownerCompletionItems.filter((item) =>
    isRecord(item.copySafeOwnerReplyStub),
  ).length;
  const missingFieldTotal = ownerCompletionItems.reduce(
    (total, item) => total + readNumber(item.missingFieldCount),
    0,
  );
  const incompleteResponseCount = ownerCompletionItems.filter(
    (item) => item.validationStatus !== "owner-response-accepted",
  ).length;
  const unsafeFindingTotal = readNumber(responseGapMatrix.summary?.unsafeFindingTotal);
  const releaseRunBindingPerformedCount = readNumber(
    responseGapMatrix.summary?.releaseRunBindingPerformedCount,
  );
  const safetyAttentionCount = unsafeFindingTotal + releaseRunBindingPerformedCount;
  const ownerDecisionQueueStatus = readString(
    responseGapMatrix.ownerDecisionQueueStatus,
    readString(responsePackageManifest.ownerDecisionQueueStatus, "unknown"),
  );
  const sourceOwnerDecisionQueueStatus = readString(
    responseGapMatrix.sourceOwnerDecisionQueueStatus,
    readString(responsePackageManifest.ownerDecisionQueueStatus, ownerDecisionQueueStatus),
  );
  const productionEvidenceRequired =
    responseGapMatrix.summary?.productionEvidenceRequired === true;
  const releaseReady =
    responsePackageManifest.summary?.releaseReady === true &&
    responseGapMatrix.summary?.releaseReady === true &&
    isReadyLikeStatus(ownerDecisionQueueStatus) &&
    ownerCompletionItems.length > 0 &&
    incompleteResponseCount === 0 &&
    safetyAttentionCount === 0 &&
    ownerCompletionItems.every((item) => item.releaseReady);

  return {
    target: "owner-decision-response-completion-packet",
    status:
      safetyAttentionCount > 0
        ? "owner-response-completion-needs-safety-review"
        : incompleteResponseCount > 0
        ? "owner-response-completion-required"
        : "owner-response-complete",
    releaseReady,
    releaseGateStatus: readString(responsePackageManifest.releaseGateStatus, "unknown"),
    ownerDecisionQueueStatus,
    sourceOwnerDecisionQueueStatus,
    productionEvidenceRequired,
    firstActionableDecisionId: readString(
      responseGapMatrix.summary?.firstActionableDecisionId,
      null,
    ),
    summary: {
      responsePackageCount: ownerCompletionItems.length,
      incompleteResponseCount,
      missingFieldTotal,
      copySafeStubCount,
      unsafeFindingTotal,
      releaseRunBindingPerformedCount,
      safetyAttentionCount,
      releaseReady,
    },
    ownerCompletionItems,
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      credentialValuesOmitted: true,
      responseBodiesOmitted: true,
      noLiveMutationPerformed: true,
      noDeploymentMutationPerformed: true,
      noReleaseRunBindingPerformed: releaseRunBindingPerformedCount === 0,
      ownerMustReplacePlaceholderLabels: true,
    },
  };
}

function buildCompletionItem({ responsePackage, gapByDecisionId, reportsDir }) {
  const decisionId = readString(responsePackage.decisionId, "unknown-decision");
  const gapRow = gapByDecisionId.get(decisionId) ?? {};
  const templateFileName = readString(responsePackage.templateFileName, null);
  const validationFileName = readString(responsePackage.validationFileName, null);
  const templateReport = readReport(reportsDir, responsePackage.templateFileName);
  const validationReport = readReport(reportsDir, responsePackage.validationFileName);
  const missingFields = readStringArray(gapRow.missingFields);
  const requiredOwnerInputFields = uniqueStrings(missingFields.map(normalizeMissingFieldName));
  const requiredOwnerLabelFields = requiredOwnerInputFields.filter((field) =>
    field.endsWith("Label"),
  );

  return {
    rank: readNullableRank(responsePackage.rank),
    decisionId,
    category: readString(responsePackage.category, "unknown"),
    queueStatus: readString(responsePackage.queueStatus, "unknown"),
    validationStatus: readString(responsePackage.validationStatus, "unknown"),
    ownerResponseStatus: readString(
      validationReport.summary?.ownerResponseStatus,
      readString(gapRow.ownerResponseStatus, "unknown"),
    ),
    templateFileName,
    validationFileName,
    ownerResponseValidationCommand: buildOwnerResponseValidationCommand({
      templateFileName,
      validationFileName,
      validationTarget: validationReport.target,
    }),
    nextOwnerQuestion: readString(gapRow.nextOwnerQuestion, ""),
    missingFieldCount: readNumber(gapRow.missingFieldCount, responsePackage.missingFieldCount),
    missingFields,
    requiredOwnerInputFields,
    requiredOwnerLabelFields,
    copySafeOwnerReplyStub: isRecord(templateReport.copySafeOwnerReplyStub)
      ? templateReport.copySafeOwnerReplyStub
      : null,
    blockedReasons: readStringArray(validationReport.blockedReasons),
    stillForbiddenUntilSeparateApproval: readStringArray(
      gapRow.stillForbiddenUntilSeparateApproval,
    ),
    postValidationAllowedChecks: readStringArray(gapRow.postValidationAllowedChecks),
    releaseReady:
      readString(responsePackage.validationStatus, "unknown") === "owner-response-accepted" &&
      gapRow.releaseReady === true &&
      responsePackage.releaseReady === true,
  };
}

function readReport(reportsDir, fileName) {
  if (typeof fileName !== "string" || fileName.length === 0) {
    return {};
  }
  return JSON.parse(readFileSync(join(reportsDir, basename(fileName)), "utf8"));
}

function normalizeMissingFieldName(field) {
  if (field === "provider-mode-not-accepted") {
    return "ownerApprovedProviderMode";
  }
  return field
    .replace(/-missing-or-invalid$/, "")
    .replace(/-not-allowed$/, "")
    .replace(/-not-confirmed$/, "")
    .replace(/-not-provided$/, "");
}

function renderMarkdown(packet) {
  const lines = [
    "# UAIS Owner Decision Response Completion Packet",
    "",
    `Status: \`${packet.status}\``,
    `Release gate: \`${packet.releaseGateStatus}\``,
    `Owner queue: \`${packet.ownerDecisionQueueStatus}\``,
    `Source owner queue: \`${packet.sourceOwnerDecisionQueueStatus}\``,
    `First actionable decision: \`${packet.firstActionableDecisionId ?? "none-recorded"}\``,
    `Missing owner fields: ${packet.summary.missingFieldTotal}`,
    `Unsafe findings: ${packet.summary.unsafeFindingTotal}`,
    `Production evidence required: \`${packet.productionEvidenceRequired}\``,
    `Release-run binding performed: \`${packet.summary.releaseRunBindingPerformedCount > 0}\``,
    `Release ready: \`${packet.summary.releaseReady}\``,
    "",
    "Replace placeholder labels with owner-approved redacted labels only. This packet does not authorize live runs, deployment mutation, or release-run binding.",
    "",
    "## Remaining Owner Fields",
    "",
    "| Rank | Decision | Missing fields | Validation |",
    "| --- | --- | ---: | --- |",
    ...packet.ownerCompletionItems.map((item) =>
      [
        `| ${item.rank ?? ""}`,
        `| \`${item.decisionId}\``,
        `| ${item.requiredOwnerInputFields.length}`,
        `| \`${item.validationStatus}\` |`,
      ].join(" "),
    ),
    "",
    "## Copy-Safe Owner Reply Stubs",
  ];

  for (const item of packet.ownerCompletionItems) {
    lines.push(
      "",
      `### ${item.rank ?? "?"}. ${item.decisionId}`,
      "",
      `Next owner question: ${item.nextOwnerQuestion || "none recorded"}`,
      "",
      "Required owner input fields:",
      "",
      ...formatBullets(item.requiredOwnerInputFields),
      "",
      "Validation command:",
      "",
      "```sh",
      item.ownerResponseValidationCommand ?? "none-recorded",
      "```",
    );

    if (item.stillForbiddenUntilSeparateApproval.length > 0) {
      lines.push(
        "",
        "Still forbidden until separate approval:",
        "",
        ...formatBullets(item.stillForbiddenUntilSeparateApproval),
      );
    }

    lines.push(
      "",
      "Post-validation allowed checks:",
      "",
      ...formatBullets(item.postValidationAllowedChecks),
    );

    lines.push(
      "",
      "```json",
      JSON.stringify(item.copySafeOwnerReplyStub, null, 2),
      "```",
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

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string"))];
}

function readRecordArray(value) {
  return Array.isArray(value) ? value.filter((item) => isRecord(item)) : [];
}

function readNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : readNumber(fallback, 0);
}

function readNullableRank(value) {
  return Number.isInteger(value) ? value : null;
}

function readRank(value) {
  return Number.isInteger(value) ? value : Number.MAX_SAFE_INTEGER;
}

function isReadyLikeStatus(value) {
  return [
    "ready",
    "passed",
    "complete",
    "completed",
    "accepted",
    "no-owner-decisions-required",
    "owner-decisions-complete",
  ].includes(value);
}

function formatBullets(values) {
  return values.length > 0 ? values.map((value) => `- \`${value}\``) : ["- `none-recorded`"];
}

function buildOwnerResponseValidationCommand({
  templateFileName,
  validationFileName,
  validationTarget,
}) {
  if (!templateFileName) {
    return null;
  }
  const scriptBaseName = readValidationScriptBaseName({ validationFileName, validationTarget });
  if (!scriptBaseName) {
    return null;
  }
  return [
    `node scripts/${scriptBaseName}`,
    `--owner-response-template coordination/reports/${basename(templateFileName)}`,
    "--owner-response path/to/filled-owner-response.json",
  ].join(" ");
}

function readValidationScriptBaseName({ validationFileName, validationTarget }) {
  const target = readString(validationTarget, null);
  if (isSafeValidationTarget(target)) {
    return `${target}.mjs`;
  }
  const validationBaseName = basename(readString(validationFileName, ""));
  const match = validationBaseName.match(
    /^\d{4}-\d{2}-\d{2}-(owner-decision-[a-z0-9-]+-response-validation)-enterprise-runthrough\.json$/,
  );
  return match ? `${match[1]}.mjs` : null;
}

function isSafeValidationTarget(value) {
  return typeof value === "string" && /^owner-decision-[a-z0-9-]+-response-validation$/.test(value);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
