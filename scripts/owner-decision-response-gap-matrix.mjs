#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const responsePackageManifest = readJsonArg(args, "response-package-manifest");
  const ownerDecisionQueue = readJsonArg(args, "owner-decision-queue");
  const reportsDir = args["reports-dir"];
  if (!reportsDir) {
    throw new Error("Missing required --reports-dir");
  }

  const matrix = buildMatrix({
    responsePackageManifest,
    responsePackageManifestPath: args["response-package-manifest"],
    ownerDecisionQueue,
    ownerDecisionQueuePath: args["owner-decision-queue"],
    reportsDir,
  });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(matrix));
    return;
  }

  process.stdout.write(`${JSON.stringify(matrix, null, 2)}\n`);
}

function buildMatrix({
  responsePackageManifest,
  responsePackageManifestPath,
  ownerDecisionQueue,
  ownerDecisionQueuePath,
  reportsDir,
}) {
  const queueByDecisionId = new Map(
    readRecordArray(ownerDecisionQueue.queue).map((item) => [
      readString(item.id, "unknown-decision"),
      item,
    ]),
  );
  const responsePackages = readRecordArray(responsePackageManifest.responsePackages)
    .map((item) => ({
      rank: Number.isInteger(item.rank) ? item.rank : null,
      decisionId: readString(item.decisionId, "unknown-decision"),
      category: readString(item.category, "unknown"),
      queueStatus: readString(item.queueStatus, "unknown"),
      validationStatus: readString(item.validationStatus, "unknown"),
      validationFileName: readString(item.validationFileName, null),
    }))
    .sort((a, b) => readRank(a.rank) - readRank(b.rank));

  const gapRows = responsePackages.map((item) => {
    const validationReport = item.validationFileName
      ? readJsonFile(join(reportsDir, item.validationFileName))
      : {};
    const queueItem = queueByDecisionId.get(item.decisionId) ?? {};
    const validationStatus = readString(validationReport.status, item.validationStatus);
    const missingFields = readStringArray(validationReport.blockedReasons);
    const stillForbiddenUntilSeparateApproval = readStringArray(
      validationReport.stillForbiddenUntilSeparateApproval,
    );
    const postValidationAllowedChecks = readStringArray(
      validationReport.postValidationAllowedChecks,
    );
    const missingFieldCount = readNumber(
      validationReport.summary?.missingFieldCount,
      missingFields.length,
    );
    const unsafeFindingCount = readNumber(validationReport.summary?.unsafeFindingCount, 0);
    const releaseRunBindingPerformed =
      validationReport.summary?.releaseRunBindingPerformed === true;
    const releaseReady =
      validationStatus === "owner-response-accepted" &&
      missingFieldCount === 0 &&
      unsafeFindingCount === 0 &&
      !releaseRunBindingPerformed &&
      validationReport.summary?.releaseReady === true;
    const actionClass = classifyAction({
      validationStatus,
      queueStatus: readString(queueItem.status, item.queueStatus),
      category: readString(queueItem.category, item.category),
      missingFields,
      missingFieldCount,
      unsafeFindingCount,
      releaseRunBindingPerformed,
      releaseReady,
    });

    return {
      rank: item.rank,
      decisionId: item.decisionId,
      category: readString(queueItem.category, item.category),
      queueStatus: readString(queueItem.status, item.queueStatus),
      nextOwnerQuestion: sanitizeText(readString(queueItem.nextOwnerQuestion, "")),
      validationStatus,
      ownerResponseStatus: readString(validationReport.summary?.ownerResponseStatus, "unknown"),
      missingFieldCount,
      unsafeFindingCount,
      missingFields: missingFields.map(sanitizeText),
      stillForbiddenUntilSeparateApproval:
        stillForbiddenUntilSeparateApproval.map(sanitizeText),
      postValidationAllowedChecks: postValidationAllowedChecks.map(sanitizeText),
      releaseRunBindingPerformed,
      releaseReady,
      actionClass,
      nextSafeAction: readNextSafeAction(actionClass),
      validationFileName: item.validationFileName,
    };
  });

  const incompleteRows = gapRows.filter((row) => row.validationStatus !== "owner-response-accepted");
  const missingFieldTotal = gapRows.reduce((sum, row) => sum + row.missingFieldCount, 0);
  const unsafeFindingTotal = gapRows.reduce((sum, row) => sum + row.unsafeFindingCount, 0);
  const releaseRunBindingPerformedCount = gapRows.filter(
    (row) => row.releaseRunBindingPerformed,
  ).length;
  const safetyRows = gapRows.filter(
    (row) => row.unsafeFindingCount > 0 || row.releaseRunBindingPerformed,
  );
  const safetyAttentionCount = unsafeFindingTotal + releaseRunBindingPerformedCount;
  const sourceOwnerDecisionQueueStatus = readString(
    responsePackageManifest.ownerDecisionQueueStatus,
    readString(ownerDecisionQueue.status, "unknown"),
  );
  const actionClassCounts = countActionClasses(gapRows);
  const ownerDecisionQueueStatus = deriveOwnerDecisionQueueStatus({
    actionClassCounts,
    safetyAttentionCount,
    sourceOwnerDecisionQueueStatus,
  });
  const firstOwnerInputDecisionId =
    gapRows.find((row) => row.actionClass === "needs-owner-input")?.decisionId ?? null;
  const firstEvidenceLabelDecisionId =
    gapRows.find((row) => row.actionClass === "awaiting-production-evidence-labels")
      ?.decisionId ?? null;
  const firstProductionEvidenceDecisionId =
    gapRows.find((row) => row.actionClass === "accepted-awaiting-production-evidence")
      ?.decisionId ?? null;
  const needsOwnerInput = actionClassCounts.needsOwnerInput > 0;
  const productionEvidenceRequired =
    actionClassCounts.acceptedAwaitingProductionEvidence > 0 ||
    actionClassCounts.awaitingProductionEvidenceLabels > 0;
  const releaseReady =
    responsePackageManifest.summary?.releaseReady === true &&
    isReadyLikeStatus(ownerDecisionQueueStatus) &&
    gapRows.length > 0 &&
    incompleteRows.length === 0 &&
    safetyAttentionCount === 0 &&
    gapRows.every((row) => row.releaseReady);

  return {
    target: "owner-decision-response-gap-matrix",
    status:
      safetyAttentionCount > 0
        ? "owner-response-gaps-need-safety-review"
        : ownerDecisionQueueStatus === "owner-decisions-cleared-awaiting-production-evidence"
          ? "owner-response-gaps-awaiting-production-evidence"
        : incompleteRows.length === 0
          ? "owner-response-gaps-clear"
          : "owner-response-gaps-present",
    releaseReady,
    releaseGateStatus: readString(
      responsePackageManifest.releaseGateStatus,
      readString(ownerDecisionQueue.releaseGateStatus, "blocked"),
    ),
    ownerDecisionQueueStatus,
    sourceOwnerDecisionQueueStatus,
    needsOwnerInput,
    productionEvidenceRequired,
    firstOwnerInputDecisionId,
    firstEvidenceLabelDecisionId,
    firstProductionEvidenceDecisionId,
    responsibleSession: "S22/S10/S25",
    sourceResponsePackageManifestFileName: basename(responsePackageManifestPath),
    sourceOwnerDecisionQueueFileName: basename(ownerDecisionQueuePath),
    summary: {
      queueItemCount: gapRows.length,
      gapRowCount: gapRows.length,
      incompleteResponseCount: incompleteRows.length,
      missingFieldTotal,
      unsafeFindingTotal,
      releaseRunBindingPerformedCount,
      safetyAttentionCount,
      actionClassCounts,
      needsOwnerInput,
      productionEvidenceRequired,
      firstActionableDecisionId: incompleteRows[0]?.decisionId ?? safetyRows[0]?.decisionId ?? null,
      firstOwnerInputDecisionId,
      firstEvidenceLabelDecisionId,
      firstProductionEvidenceDecisionId,
      releaseReady,
    },
    gapRows,
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      secretValuesOmitted: true,
      responseBodiesOmitted: true,
      noLiveMutationPerformed: true,
      noDeploymentMutationPerformed: true,
      noReleaseRunBindingPerformed: releaseRunBindingPerformedCount === 0,
      fileContentsOmitted: true,
    },
  };
}

function renderMarkdown(matrix) {
  const lines = [
    "# UAIS Owner Decision Response Gap Matrix",
    "",
    `Status: \`${matrix.status}\``,
    `Release gate: \`${matrix.releaseGateStatus}\``,
    `Owner queue: \`${matrix.ownerDecisionQueueStatus}\``,
    `Source owner queue: \`${matrix.sourceOwnerDecisionQueueStatus}\``,
    `Release ready: \`${matrix.summary.releaseReady}\``,
    `Incomplete responses: ${matrix.summary.incompleteResponseCount}`,
    `Missing fields total: ${matrix.summary.missingFieldTotal}`,
    `Unsafe findings total: ${matrix.summary.unsafeFindingTotal}`,
    `Safety attention: ${matrix.summary.safetyAttentionCount}`,
    `Owner-input gaps: ${matrix.summary.actionClassCounts.needsOwnerInput}`,
    `Evidence-label gaps: ${matrix.summary.actionClassCounts.awaitingProductionEvidenceLabels}`,
    `Accepted awaiting production evidence: ${matrix.summary.actionClassCounts.acceptedAwaitingProductionEvidence}`,
    "",
    "## Gap Summary",
    "",
    "| Rank | Decision | Queue status | Validation | Action class | Missing fields | Unsafe findings |",
    "| ---: | --- | --- | --- | --- | ---: | ---: |",
    ...matrix.gapRows.map((row) =>
      [
        `| \`${row.rank ?? "?"}\``,
        `| \`${row.decisionId}\``,
        `| \`${row.queueStatus}\``,
        `| \`${row.validationStatus}\``,
        `| \`${row.actionClass}\``,
        `| ${row.missingFieldCount}`,
        `| ${row.unsafeFindingCount} |`,
      ].join(" "),
    ),
  ];

  for (const row of matrix.gapRows) {
    lines.push(
      "",
      `## ${row.rank ?? "?"}. ${row.decisionId}`,
      "",
      `Queue status: \`${row.queueStatus}\``,
      `Validation status: \`${row.validationStatus}\``,
      `Action class: \`${row.actionClass}\``,
      `Next safe action: \`${row.nextSafeAction}\``,
      `Next owner question: ${row.nextOwnerQuestion || "`none-recorded`"}`,
      "",
      "Missing fields:",
      "",
      ...formatBullets(row.missingFields),
    );
    lines.push("", "Post-validation allowed checks:", "");
    lines.push(...formatBullets(row.postValidationAllowedChecks));

    if (row.stillForbiddenUntilSeparateApproval.length > 0) {
      lines.push("", "Still forbidden until separate approval:", "");
      lines.push(...formatBullets(row.stillForbiddenUntilSeparateApproval));
    }
  }

  return `${lines.join("\n")}\n`;
}

function classifyAction({
  validationStatus,
  queueStatus,
  category,
  missingFields,
  missingFieldCount,
  unsafeFindingCount,
  releaseRunBindingPerformed,
  releaseReady,
}) {
  if (unsafeFindingCount > 0 || releaseRunBindingPerformed) {
    return "safety-review";
  }
  if (releaseReady) {
    return "release-ready";
  }
  if (validationStatus === "owner-response-accepted") {
    return "accepted-awaiting-production-evidence";
  }
  if (
    missingFieldCount > 0 &&
    isEvidenceWaitingContext({ queueStatus, category }) &&
    missingFields.length > 0 &&
    missingFields.every(isEvidenceLabelMissingField)
  ) {
    return "awaiting-production-evidence-labels";
  }
  return "needs-owner-input";
}

function isEvidenceWaitingContext({ queueStatus, category }) {
  return (
    queueStatus === "waiting-for-upstream-evidence" ||
    queueStatus === "waiting-for-live-evidence" ||
    queueStatus === "accepted-awaiting-production-evidence" ||
    category === "production-evidence" ||
    category === "live-evidence" ||
    category === "evidence-audit" ||
    category === "enterprise-live-audit" ||
    category === "final-release-binding"
  );
}

function isEvidenceLabelMissingField(value) {
  return /^approved[A-Za-z0-9]*Label-missing-or-invalid$/.test(value);
}

function readNextSafeAction(actionClass) {
  if (actionClass === "release-ready") {
    return "verify-release-gate";
  }
  if (actionClass === "accepted-awaiting-production-evidence") {
    return "collect-production-evidence";
  }
  if (actionClass === "awaiting-production-evidence-labels") {
    return "collect-evidence-labels-after-live-proof";
  }
  if (actionClass === "safety-review") {
    return "safety-review-before-any-live-action";
  }
  return "request-owner-response";
}

function countActionClasses(gapRows) {
  return {
    acceptedAwaitingProductionEvidence: gapRows.filter(
      (row) => row.actionClass === "accepted-awaiting-production-evidence",
    ).length,
    awaitingProductionEvidenceLabels: gapRows.filter(
      (row) => row.actionClass === "awaiting-production-evidence-labels",
    ).length,
    needsOwnerInput: gapRows.filter((row) => row.actionClass === "needs-owner-input").length,
    safetyReview: gapRows.filter((row) => row.actionClass === "safety-review").length,
    releaseReady: gapRows.filter((row) => row.actionClass === "release-ready").length,
  };
}

function deriveOwnerDecisionQueueStatus({
  actionClassCounts,
  safetyAttentionCount,
  sourceOwnerDecisionQueueStatus,
}) {
  if (safetyAttentionCount > 0 || actionClassCounts.safetyReview > 0) {
    return "owner-decisions-need-safety-review";
  }
  if (actionClassCounts.needsOwnerInput > 0) {
    return "owner-decisions-required";
  }
  if (
    actionClassCounts.acceptedAwaitingProductionEvidence > 0 ||
    actionClassCounts.awaitingProductionEvidenceLabels > 0
  ) {
    return "owner-decisions-cleared-awaiting-production-evidence";
  }
  if (isReadyLikeStatus(sourceOwnerDecisionQueueStatus)) {
    return "owner-decisions-cleared";
  }
  return "owner-decisions-cleared-awaiting-production-evidence";
}

function sanitizeText(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/\/Users\/[^\s)]*?([.,;:]?)(?=\s|$)/g, "[redacted-path]$1")
    .replace(/\.env\.local/gi, "[redacted-env-file]")
    .replace(/\bUAIS_[A-Z0-9_]*\s*=\S*/g, "[redacted-env-assignment]")
    .replace(/uais_teacher_auth_(claims|signature)=\S*/gi, "[redacted-cookie]")
    .replace(/secret-(token|cookie|key)\S*/gi, "[redacted-secret]");
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

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readString(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function readStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function readNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
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
    "owner-decisions-cleared",
  ].includes(value);
}

function readRecordArray(value) {
  return Array.isArray(value) ? value.filter((item) => isRecord(item)) : [];
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
