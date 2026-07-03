#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const completionValidation = readJsonArg(args, "completion-validation");
  const ownerResponseCompletion = readJsonArg(args, "owner-response-completion");
  const report = buildExtraction({
    completionValidation,
    ownerResponseCompletion,
    outDir: args["out-dir"],
    ownerResponseCommandDir: args["owner-response-command-dir"],
  });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(report));
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function buildExtraction({
  completionValidation,
  ownerResponseCompletion,
  outDir,
  ownerResponseCommandDir,
}) {
  if (!outDir) {
    throw new Error("Missing required --out-dir");
  }
  if (!ownerResponseCommandDir) {
    throw new Error("Missing required --owner-response-command-dir");
  }

  const validationItems = readRecordArray(completionValidation.validationItems);
  const validationCommandByDecisionId = new Map(
    readRecordArray(completionValidation.individualOwnerResponseValidationCommands)
      .map((item) => [
        readString(item.decisionId, ""),
        readSafeValidationCommand(item.ownerResponseValidationCommand),
      ])
      .filter(([decisionId, command]) => decisionId && command),
  );
  const ownerResponseByDecisionId = new Map(
    readRecordArray(ownerResponseCompletion.ownerCompletionItems).map((item) => [
      readString(item.decisionId, ""),
      item,
    ]),
  );
  const completionAccepted =
    completionValidation.status === "owner-response-completion-accepted" &&
    completionValidation.summary?.postValidationMayProceed === true &&
    validationItems.every((item) => item.status === "owner-response-completion-accepted");
  const productionEvidenceRequired =
    !completionAccepted &&
    (completionValidation.status === "owner-response-completion-awaiting-production-evidence" ||
      (readString(completionValidation.ownerDecisionQueueStatus, "") ===
        "owner-decisions-cleared-awaiting-production-evidence" &&
        completionValidation.summary?.productionEvidenceRequired === true));
  const requestedItems = validationItems
    .map((item) => ({
      rank: readNullableRank(item.rank),
      decisionId: readString(item.decisionId, ""),
    }))
    .filter((item) => item.decisionId);
  const blockedReasons = completionAccepted
    ? []
    : productionEvidenceRequired
      ? ["production-evidence-required"]
      : ["completion-validation-not-accepted"];
  const extractedResponses = [];
  const skippedItems = [];
  let invalidCommandCount = 0;

  if (completionAccepted) {
    mkdirSync(outDir, { recursive: true });
    for (const item of requestedItems) {
      const ownerResponseItem = ownerResponseByDecisionId.get(item.decisionId);
      const ownerResponse = extractOwnerResponse(ownerResponseItem);
      const command = validationCommandByDecisionId.get(item.decisionId);
      if (!isRecord(ownerResponse) || !command) {
        skippedItems.push({
          rank: item.rank,
          decisionId: item.decisionId,
          reason: !command ? "missing-or-invalid-validation-command" : "missing-owner-response",
        });
        if (!command) {
          invalidCommandCount += 1;
        }
        continue;
      }

      const fileName = ownerResponseFileName(item);
      writeFileSync(join(outDir, fileName), `${JSON.stringify(ownerResponse, null, 2)}\n`);
      extractedResponses.push({
        rank: item.rank,
        decisionId: item.decisionId,
        individualResponseFileName: fileName,
        ownerResponseValidationCommand: command.replace(
          "path/to/filled-owner-response.json",
          `${trimTrailingSlash(ownerResponseCommandDir)}/${fileName}`,
        ),
      });
    }
  } else {
    skippedItems.push(
      ...requestedItems.map((item) => ({
        rank: item.rank,
        decisionId: item.decisionId,
        reason: "completion-validation-not-accepted",
      })),
    );
    invalidCommandCount = requestedItems.filter(
      (item) => !validationCommandByDecisionId.has(item.decisionId),
    ).length;
  }

  return {
    target: "owner-decision-response-completion-extract",
    status:
      completionAccepted && skippedItems.length === 0
        ? "owner-response-individual-files-created"
        : productionEvidenceRequired
          ? "owner-response-extraction-awaiting-production-evidence"
        : "owner-response-extraction-blocked",
    releaseReady: false,
    releaseGateStatus: readString(completionValidation.releaseGateStatus, "unknown"),
    ownerDecisionQueueStatus: readString(
      completionValidation.ownerDecisionQueueStatus,
      "unknown",
    ),
    sourceOwnerDecisionQueueStatus: readString(
      completionValidation.sourceOwnerDecisionQueueStatus,
      readString(completionValidation.ownerDecisionQueueStatus, "unknown"),
    ),
    productionEvidenceRequired,
    responsibleSession: "S22/S19/S10",
    summary: {
      completionAccepted,
      requestedItemCount: requestedItems.length,
      extractedFileCount: extractedResponses.length,
      skippedItemCount: skippedItems.length,
      invalidCommandCount,
      releaseReady: false,
    },
    extractedResponses,
    skippedItems,
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
      outputValuesOmittedFromReport: true,
    },
  };
}

function ownerResponseFileName(item) {
  const rankPrefix = Number.isInteger(item.rank) ? String(item.rank).padStart(2, "0") : "xx";
  return `${rankPrefix}-${item.decisionId}-owner-response.json`;
}

function extractOwnerResponse(item) {
  if (!isRecord(item)) {
    return null;
  }
  if (isRecord(item.copySafeOwnerReplyStub)) {
    return item.copySafeOwnerReplyStub;
  }
  if (isRecord(item.ownerResponse)) {
    return item.ownerResponse;
  }
  return null;
}

function readSafeValidationCommand(value) {
  if (typeof value !== "string") {
    return null;
  }
  const pattern =
    /^node scripts\/owner-decision-[a-z0-9-]+-response-validation\.mjs --owner-response-template coordination\/reports\/[A-Za-z0-9._-]+\.json --owner-response path\/to\/filled-owner-response\.json$/;
  return pattern.test(value) ? value : null;
}

function renderMarkdown(report) {
  const lines = [
    "# UAIS Owner Response Completion Extract",
    "",
    `Status: \`${report.status}\``,
    `Release gate: \`${report.releaseGateStatus}\``,
    `Owner queue: \`${report.ownerDecisionQueueStatus}\``,
    `Source owner queue: \`${report.sourceOwnerDecisionQueueStatus}\``,
    `Completion accepted: \`${report.summary.completionAccepted}\``,
    `Individual files created: ${report.summary.extractedFileCount}`,
    `Skipped items: ${report.summary.skippedItemCount}`,
    `Invalid commands: ${report.summary.invalidCommandCount}`,
    `Release ready: \`${report.summary.releaseReady}\``,
    "",
    "This extraction writes local per-decision owner response files only after consolidated validation accepts the response. It performs no live operation, env apply, deploy, production smoke, enterprise live audit, or release-run binding.",
    "",
    "## Extracted Response Commands",
    "",
    "| Rank | Decision | File | Command |",
    "| ---: | --- | --- | --- |",
    ...report.extractedResponses.map(
      (item) =>
        `| \`${item.rank ?? "?"}\` | \`${item.decisionId}\` | \`${item.individualResponseFileName}\` | \`${item.ownerResponseValidationCommand}\` |`,
    ),
  ];

  if (report.skippedItems.length > 0) {
    lines.push("", "## Skipped Items", "", "| Rank | Decision | Reason |", "| ---: | --- | --- |");
    lines.push(
      ...report.skippedItems.map(
        (item) => `| \`${item.rank ?? "?"}\` | \`${item.decisionId}\` | \`${item.reason}\` |`,
      ),
    );
  }

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

function readNullableRank(value) {
  return Number.isInteger(value) ? value : null;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string"))];
}

function trimTrailingSlash(value) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
