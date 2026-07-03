#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { basename } from "node:path";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const releaseGate = readJsonArg(args, "release-gate");
  const ownerDecisionQueue = args["owner-decision-queue"]
    ? readJsonArg(args, "owner-decision-queue")
    : null;
  const diagnoses = readStringArray(args.diagnosis).map((filePath) => ({
    fileName: basename(filePath),
    content: readFileSync(filePath, "utf8"),
  }));
  const coverage = buildCoverage({ releaseGate, diagnoses, ownerDecisionQueue });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(coverage));
    return;
  }

  process.stdout.write(`${JSON.stringify(coverage, null, 2)}\n`);
}

function buildCoverage({ releaseGate, diagnoses, ownerDecisionQueue }) {
  const blockedRequirements = readRecordArray(releaseGate.requirements).filter(
    (requirement) => readString(requirement.status, "unknown") === "blocked",
  );
  const requirements = blockedRequirements.map((requirement) => {
    const requirementId = readString(requirement.id, "unknown-requirement");
    const blockedReason = readString(requirement.blockedReason, "unknown-blocker");
    const diagnosisFileNames = diagnoses
      .filter((diagnosis) =>
        containsToken(diagnosis.content, requirementId) ||
        containsToken(diagnosis.content, blockedReason),
      )
      .map((diagnosis) => diagnosis.fileName);

    return {
      requirementId,
      status: readString(requirement.status, "unknown"),
      evidenceStatus: readString(requirement.evidenceStatus, "unknown"),
      blockedReason,
      covered: diagnosisFileNames.length > 0,
      diagnosisFileNames,
    };
  });
  const uncoveredRequirementIds = requirements
    .filter((requirement) => !requirement.covered)
    .map((requirement) => requirement.requirementId);
  const allReleaseGateRequirementsSatisfied = readRecordArray(releaseGate.requirements)
    .every((requirement) => isSatisfiedRequirementStatus(requirement.status));
  const ownerDecisionQueueStatus = readString(ownerDecisionQueue?.status, "not-provided");
  const ownerQueueBlockingReasons = buildOwnerQueueBlockingReasons(ownerDecisionQueueStatus);
  const releaseReady =
    isReadyReleaseGateStatus(releaseGate.status) &&
    requirements.length === 0 &&
    uncoveredRequirementIds.length === 0 &&
    ownerQueueBlockingReasons.length === 0 &&
    allReleaseGateRequirementsSatisfied;

  return {
    target: "release-blocker-diagnosis-coverage",
    status: uncoveredRequirementIds.length === 0 ? "coverage-complete" : "coverage-needs-attention",
    releaseGateStatus: readString(releaseGate.status, "unknown"),
    ownerDecisionQueueStatus,
    responsibleSession: "S22/S25",
    summary: {
      blockedRequirementCount: requirements.length,
      coveredRequirementCount: requirements.length - uncoveredRequirementIds.length,
      uncoveredRequirementCount: uncoveredRequirementIds.length,
      diagnosisFileCount: diagnoses.length,
      ownerQueueBlockingReasonCount: ownerQueueBlockingReasons.length,
      releaseReady,
    },
    releaseReadinessBlockers: ownerQueueBlockingReasons,
    uncoveredRequirementIds,
    requirements,
    diagnosisFileNames: diagnoses.map((diagnosis) => diagnosis.fileName),
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      secretValuesOmitted: true,
      responseBodiesOmitted: true,
      fileContentsOmitted: true,
      noLiveMutationPerformed: true,
      noDeploymentMutationPerformed: true,
      noReleaseRunBindingPerformed: true,
    },
  };
}

function containsToken(content, token) {
  return token.length > 0 && content.includes(token);
}

function isReadyReleaseGateStatus(status) {
  const value = readString(status, "unknown");
  return value === "ready" || value === "passed";
}

function isSatisfiedRequirementStatus(status) {
  return [
    "satisfied",
    "ready",
    "passed",
    "not-required-for-scope",
  ].includes(readString(status, "unknown"));
}

function buildOwnerQueueBlockingReasons(ownerDecisionQueueStatus) {
  if (ownerDecisionQueueStatus === "not-provided" || isReadyLikeStatus(ownerDecisionQueueStatus)) {
    return [];
  }
  return [`owner-queue-status-${ownerDecisionQueueStatus}`];
}

function isReadyLikeStatus(status) {
  return [
    "ready",
    "passed",
    "complete",
    "completed",
    "accepted",
    "approved",
    "live-ready",
    "release-ready",
    "satisfied",
    "all-decisions-ready",
    "no-owner-decisions-required",
    "owner-decisions-complete",
  ].includes(readString(status, "unknown"));
}

function renderMarkdown(coverage) {
  const lines = [
    "# UAIS Release Blocker Diagnosis Coverage",
    "",
    `Status: \`${coverage.status}\``,
    `Release gate: \`${coverage.releaseGateStatus}\``,
    `Owner queue: \`${coverage.ownerDecisionQueueStatus}\``,
    `Release ready: \`${coverage.summary.releaseReady}\``,
    `Blocked requirements covered: ${coverage.summary.coveredRequirementCount} / ${coverage.summary.blockedRequirementCount}`,
    `Diagnosis files: ${coverage.summary.diagnosisFileCount}`,
    "",
    "This matrix maps release-gate blockers to redacted coordination diagnoses. It does not make blocked production evidence release-ready.",
    "",
    "## Requirement Coverage",
    "",
    "| Requirement | Blocker | Evidence | Covered | Diagnosis files |",
    "| --- | --- | --- | --- | --- |",
    ...coverage.requirements.map((requirement) =>
      [
        `| \`${requirement.requirementId}\``,
        `| \`${requirement.blockedReason}\``,
        `| \`${requirement.evidenceStatus}\``,
        `| \`${requirement.covered}\``,
        `| ${formatInlineList(requirement.diagnosisFileNames)} |`,
      ].join(" "),
    ),
  ];

  if (coverage.uncoveredRequirementIds.length > 0) {
    lines.push("", "## Uncovered Requirements", "");
    lines.push(...coverage.uncoveredRequirementIds.map((id) => `- ${id}`));
  }

  if (coverage.releaseReadinessBlockers.length > 0) {
    lines.push("", "## Release Readiness Blockers", "");
    lines.push(...coverage.releaseReadinessBlockers.map((id) => `- \`${id}\``));
  }

  return `${lines.join("\n")}\n`;
}

function formatInlineList(values) {
  if (values.length === 0) {
    return "`none-recorded`";
  }
  return values.map((value) => `\`${value}\``).join(", ");
}

function parseArgs(argv) {
  const args = { format: "json", diagnosis: [] };
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
    if (key === "diagnosis") {
      args.diagnosis.push(value);
    } else {
      args[key] = value;
    }
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

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
