#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const extractionReport = readJsonArg(args, "extraction-report");
  const report = buildSuite({ extractionReport });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(report));
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function buildSuite({ extractionReport }) {
  const extractionStatus = readString(extractionReport.status, "unknown");
  const extractedResponses = readRecordArray(extractionReport.extractedResponses);
  const extractionReady = extractionStatus === "owner-response-individual-files-created";
  const productionEvidenceRequired =
    !extractionReady &&
    readString(extractionReport.ownerDecisionQueueStatus, "") ===
      "owner-decisions-cleared-awaiting-production-evidence";
  const validationResults = [];
  const blockedReasons = extractionReady
    ? []
    : productionEvidenceRequired
      ? ["production-evidence-required"]
      : ["extraction-not-ready"];

  if (extractionReady) {
    for (const item of extractedResponses) {
      validationResults.push(runValidationItem(item));
    }
  }

  const acceptedValidationCount = validationResults.filter(
    (item) => item.status === "owner-response-accepted",
  ).length;
  const incompleteValidationCount = validationResults.filter(
    (item) => item.status === "owner-response-incomplete",
  ).length;
  const rejectedValidationCount = validationResults.filter(
    (item) => item.status === "owner-response-rejected",
  ).length;
  const failedValidationCount = validationResults.filter(
    (item) => item.status === "validator-execution-failed",
  ).length;
  const unsafeFindingTotal = validationResults.reduce(
    (total, item) => total + readSafeNumber(item.unsafeFindingCount),
    0,
  );
  const safetyAttentionCount = unsafeFindingTotal;
  if (unsafeFindingTotal > 0) {
    blockedReasons.push("postvalidation-unsafe-findings");
  }
  const status = !extractionReady
    ? productionEvidenceRequired
      ? "owner-response-postvalidation-awaiting-production-evidence"
      : "owner-response-postvalidation-blocked"
    : failedValidationCount > 0 || rejectedValidationCount > 0 || unsafeFindingTotal > 0
      ? "owner-response-postvalidation-rejected"
      : incompleteValidationCount > 0
        ? "owner-response-postvalidation-incomplete"
        : "owner-response-postvalidation-accepted";

  return {
    target: "owner-decision-response-postvalidation-suite",
    status,
    releaseReady: false,
    releaseGateStatus: readString(extractionReport.releaseGateStatus, "unknown"),
    ownerDecisionQueueStatus: readString(extractionReport.ownerDecisionQueueStatus, "unknown"),
    sourceOwnerDecisionQueueStatus: readString(
      extractionReport.sourceOwnerDecisionQueueStatus,
      readString(extractionReport.ownerDecisionQueueStatus, "unknown"),
    ),
    productionEvidenceRequired,
    responsibleSession: "S22/S19/S10",
    summary: {
      extractionStatus,
      requestedItemCount: readSafeNumber(extractionReport.summary?.requestedItemCount),
      runnableItemCount: extractionReady ? extractedResponses.length : 0,
      executedValidationCount: validationResults.filter((item) => item.didExecute).length,
      acceptedValidationCount,
      incompleteValidationCount,
      rejectedValidationCount,
      failedValidationCount,
      unsafeFindingTotal,
      safetyAttentionCount,
      releaseReady: false,
    },
    validationResults,
    blockedReasons: uniqueStrings(blockedReasons),
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
      responseBodiesOmitted: true,
      noLiveMutationPerformed: true,
      noDeploymentMutationPerformed: true,
      noEnvApplyPerformed: true,
      noReleaseRunBindingPerformed: true,
      validatorOutputsSummarizedOnly: true,
    },
  };
}

function runValidationItem(item) {
  const parsedCommand = parseValidationCommand(item.ownerResponseValidationCommand);
  if (!parsedCommand) {
    return {
      rank: readNullableRank(item.rank),
      decisionId: readString(item.decisionId, "unknown-decision"),
      status: "validator-execution-failed",
      didExecute: false,
      scriptFileName: null,
      templateFileName: null,
      responseFileName: null,
      missingFieldCount: 0,
      unsafeFindingCount: 0,
      blockedReasonCount: 1,
      postValidationAllowedCheckCount: 0,
    };
  }

  try {
    const stdout = execFileSync("node", [
      `scripts/${parsedCommand.scriptFileName}`,
      "--owner-response-template",
      parsedCommand.templatePath,
      "--owner-response",
      parsedCommand.responsePath,
    ], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const validationReport = JSON.parse(stdout);
    return {
      rank: readNullableRank(item.rank),
      decisionId: readString(item.decisionId, readString(validationReport.decisionId, "unknown-decision")),
      status: readString(validationReport.status, "unknown"),
      didExecute: true,
      scriptFileName: parsedCommand.scriptFileName,
      templateFileName: basename(parsedCommand.templatePath),
      responseFileName: basename(parsedCommand.responsePath),
      missingFieldCount: readSafeNumber(validationReport.summary?.missingFieldCount),
      unsafeFindingCount: readSafeNumber(validationReport.summary?.unsafeFindingCount),
      blockedReasonCount: readRecordArray(validationReport.blockedReasons).length,
      postValidationAllowedCheckCount: readRecordArray(
        validationReport.postValidationAllowedChecks,
      ).length,
    };
  } catch {
    return {
      rank: readNullableRank(item.rank),
      decisionId: readString(item.decisionId, "unknown-decision"),
      status: "validator-execution-failed",
      didExecute: false,
      scriptFileName: parsedCommand.scriptFileName,
      templateFileName: basename(parsedCommand.templatePath),
      responseFileName: basename(parsedCommand.responsePath),
      missingFieldCount: 0,
      unsafeFindingCount: 0,
      blockedReasonCount: 1,
      postValidationAllowedCheckCount: 0,
    };
  }
}

function parseValidationCommand(command) {
  if (typeof command !== "string") {
    return null;
  }
  const match = command.match(
    /^node scripts\/(owner-decision-[a-z0-9-]+-response-validation\.mjs) --owner-response-template ([^\s]+\.json) --owner-response ([^\s]+\.json)$/,
  );
  if (!match) {
    return null;
  }
  return {
    scriptFileName: match[1],
    templatePath: match[2],
    responsePath: match[3],
  };
}

function renderMarkdown(report) {
  const lines = [
    "# UAIS Owner Response Postvalidation Suite",
    "",
    `Status: \`${report.status}\``,
    `Release gate: \`${report.releaseGateStatus}\``,
    `Owner queue: \`${report.ownerDecisionQueueStatus}\``,
    `Source owner queue: \`${report.sourceOwnerDecisionQueueStatus}\``,
    `Extraction status: \`${report.summary.extractionStatus}\``,
    `Production evidence required: \`${report.productionEvidenceRequired}\``,
    `Runnable items: ${report.summary.runnableItemCount}`,
    `Executed validators: ${report.summary.executedValidationCount}`,
    `Accepted validators: ${report.summary.acceptedValidationCount}`,
    `Incomplete validators: ${report.summary.incompleteValidationCount}`,
    `Rejected validators: ${report.summary.rejectedValidationCount}`,
    `Failed validators: ${report.summary.failedValidationCount}`,
    `Unsafe findings: ${report.summary.unsafeFindingTotal}`,
    `Safety attention: ${report.summary.safetyAttentionCount}`,
    `Release ready: \`${report.summary.releaseReady}\``,
    "",
    "This suite runs local owner-response validators only. It performs no live operation, env apply, deploy, production smoke, enterprise live audit, or release-run binding.",
    "",
    "## Validation Results",
    "",
    "| Rank | Decision | Status | Script | Template | Response | Missing | Unsafe |",
    "| ---: | --- | --- | --- | --- | --- | ---: | ---: |",
    ...report.validationResults.map((item) =>
      [
        `| \`${item.rank ?? "?"}\``,
        `| \`${item.decisionId}\``,
        `| \`${item.status}\``,
        `| \`${item.scriptFileName ?? "none-recorded"}\``,
        `| \`${item.templateFileName ?? "none-recorded"}\``,
        `| \`${item.responseFileName ?? "none-recorded"}\``,
        `| ${item.missingFieldCount}`,
        `| ${item.unsafeFindingCount} |`,
      ].join(" "),
    ),
  ];

  if (report.blockedReasons.length > 0) {
    lines.push("", "## Blocked Reasons", "");
    lines.push(...report.blockedReasons.map((reason) => `- \`${reason}\``));
  }

  lines.push("", "## Still Forbidden Until Separate Approval", "");
  lines.push(...report.stillForbiddenUntilSeparateApproval.map((item) => `- \`${item}\``));

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

function readRecordArray(value) {
  return Array.isArray(value) ? value.filter((item) => isRecord(item)) : [];
}

function readSafeNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function readNullableRank(value) {
  return Number.isInteger(value) ? value : null;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string"))];
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
