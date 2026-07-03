#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const completionPacket = readJsonArg(args, "completion-packet");
  const reportsDir = args["reports-dir"];
  if (!reportsDir) {
    throw new Error("Missing required --reports-dir");
  }

  const report = buildCompletionFromResponses({
    completionPacket,
    completionPacketPath: args["completion-packet"],
    reportsDir,
  });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(report));
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function buildCompletionFromResponses({ completionPacket, completionPacketPath, reportsDir }) {
  const reportFileNames = readdirSync(reportsDir);
  const ownerCompletionItems = readRecordArray(completionPacket.ownerCompletionItems).map((item) =>
    buildCompletionItem({ item, reportsDir, reportFileNames }),
  );
  const foundOwnerResponseCount = ownerCompletionItems.filter((item) =>
    isRecord(item.ownerResponse),
  ).length;
  const placeholderFallbackCount = ownerCompletionItems.filter((item) =>
    isRecord(item.copySafeOwnerReplyStub),
  ).length;
  const missingOwnerResponseCount = ownerCompletionItems.length - foundOwnerResponseCount;

  return {
    target: "owner-decision-response-completion-from-responses",
    status: "owner-response-completion-input-created",
    releaseReady: false,
    releaseGateStatus: readString(completionPacket.releaseGateStatus, "unknown"),
    ownerDecisionQueueStatus: readString(completionPacket.ownerDecisionQueueStatus, "unknown"),
    sourceOwnerDecisionQueueStatus: readString(
      completionPacket.sourceOwnerDecisionQueueStatus,
      readString(completionPacket.ownerDecisionQueueStatus, "unknown"),
    ),
    responsibleSession: "S22/S19/S10",
    sourceCompletionPacketFileName: basename(completionPacketPath),
    summary: {
      ownerCompletionItemCount: ownerCompletionItems.length,
      foundOwnerResponseCount,
      placeholderFallbackCount,
      missingOwnerResponseCount,
      releaseReady: false,
    },
    ownerCompletionItems,
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmittedFromMarkdown: true,
      credentialValuesOmittedFromMarkdown: true,
      responseBodiesOmittedFromMarkdown: true,
      jsonContainsOwnerProvidedRedactedLabelsOnly: true,
      noLiveMutationPerformed: true,
      noDeploymentMutationPerformed: true,
      noEnvApplyPerformed: true,
      noReleaseRunBindingPerformed: true,
    },
  };
}

function buildCompletionItem({ item, reportsDir, reportFileNames }) {
  const decisionId = readString(item.decisionId, "unknown-decision");
  const ownerResponseFileName = findOwnerResponseFile(reportFileNames, decisionId);
  const ownerResponse = ownerResponseFileName
    ? readJsonFile(join(reportsDir, ownerResponseFileName))
    : null;
  const base = {
    rank: readNullableRank(item.rank),
    decisionId,
    ownerResponseFileName,
    requiredOwnerInputFields: readStringArray(item.requiredOwnerInputFields),
    requiredOwnerLabelFields: readStringArray(item.requiredOwnerLabelFields),
  };

  if (isRecord(ownerResponse)) {
    return {
      ...base,
      ownerResponse,
    };
  }

  return {
    ...base,
    copySafeOwnerReplyStub: isRecord(item.copySafeOwnerReplyStub)
      ? item.copySafeOwnerReplyStub
      : null,
  };
}

function findOwnerResponseFile(reportFileNames, decisionId) {
  const prefix = "owner-response-";
  const suffix = "-enterprise-runthrough.json";
  const matches = reportFileNames
    .filter(
      (fileName) =>
        fileName.includes(`${prefix}${decisionId}`) &&
        fileName.endsWith(suffix) &&
        !fileName.includes("-validation-"),
    )
    .sort();
  return matches.at(-1) ?? null;
}

function renderMarkdown(report) {
  const lines = [
    "# UAIS Owner Response Completion From Responses",
    "",
    `Status: \`${report.status}\``,
    `Release gate: \`${report.releaseGateStatus}\``,
    `Owner queue: \`${report.ownerDecisionQueueStatus}\``,
    `Source owner queue: \`${report.sourceOwnerDecisionQueueStatus}\``,
    `Source completion packet: \`${report.sourceCompletionPacketFileName}\``,
    `Owner completion items: ${report.summary.ownerCompletionItemCount}`,
    `Found owner responses: ${report.summary.foundOwnerResponseCount}`,
    `Placeholder fallbacks: ${report.summary.placeholderFallbackCount}`,
    `Missing owner responses: ${report.summary.missingOwnerResponseCount}`,
    `Release ready: \`${report.summary.releaseReady}\``,
    "",
    "This report builds a local completion input from owner-response files. Markdown omits owner-provided label values; JSON is intended for local validators only.",
    "",
    "## Completion Input Rows",
    "",
    "| Rank | Decision | Source | Required fields |",
    "| ---: | --- | --- | ---: |",
    ...report.ownerCompletionItems.map((item) =>
      [
        `| \`${item.rank ?? "?"}\``,
        `| \`${item.decisionId}\``,
        `| \`${item.ownerResponseFileName ?? "placeholder-fallback"}\``,
        `| ${item.requiredOwnerInputFields.length} |`,
      ].join(" "),
    ),
  ];

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
  return readJsonFile(args[key]);
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

function readNullableRank(value) {
  return Number.isInteger(value) ? value : null;
}

function readRecordArray(value) {
  return Array.isArray(value) ? value.filter((item) => isRecord(item)) : [];
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
