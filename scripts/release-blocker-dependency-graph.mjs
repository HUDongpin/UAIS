#!/usr/bin/env node

import { readFileSync } from "node:fs";

const upstreamStatusOrder = [
  "owner-decision-required",
  "waiting-for-upstream-owner-decisions",
  "human-qa-needed",
  "waiting-for-live-evidence",
  "waiting-for-upstream-evidence",
  "blocked",
  "unknown",
];
const aggregateDecisionIdsForRequirementTargetExpansion = new Set([
  "production-release-run",
]);

function main() {
  const args = parseArgs(process.argv.slice(2));
  const releaseGate = readJsonArg(args, "release-gate");
  const ownerDecisionQueue = readJsonArg(args, "owner-decision-queue");
  const enterpriseLiveEvidenceTriage = readJsonArg(args, "enterprise-live-evidence-triage");
  const diagnosisCoverage = args["diagnosis-coverage"]
    ? readJsonArg(args, "diagnosis-coverage")
    : null;
  const graph = buildGraph({
    releaseGate,
    ownerDecisionQueue,
    enterpriseLiveEvidenceTriage,
    diagnosisCoverage,
  });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(graph));
    return;
  }

  process.stdout.write(`${JSON.stringify(graph, null, 2)}\n`);
}

function buildGraph({ releaseGate, ownerDecisionQueue, enterpriseLiveEvidenceTriage, diagnosisCoverage }) {
  const releaseGateRequirements = readRecordArray(releaseGate.requirements).filter(
    (requirement) => readString(requirement.status, "unknown") !== "satisfied",
  );
  const queueItems = readRecordArray(ownerDecisionQueue.queue);
  const targetToWave = buildTargetToWaveMap(enterpriseLiveEvidenceTriage.executionWaves);
  const knownTriageTargets = new Set([
    ...readRecordArray(enterpriseLiveEvidenceTriage.nextActions).map((action) =>
      readString(action.target, ""),
    ),
    ...targetToWave.keys(),
  ].filter(Boolean));

  const requirements = releaseGateRequirements.map((requirement) =>
    buildRequirementDependency({
      requirement,
      queueItems,
      targetToWave,
      knownTriageTargets,
    }),
  );
  const decisionDependencies = queueItems.map((queueItem) =>
    buildDecisionDependency({
      queueItem,
      releaseGateRequirements,
      targetToWave,
      knownTriageTargets,
    }),
  );
  const unmappedRequirementIds = requirements
    .filter(
      (requirement) =>
        requirement.blockingDecisionIds.length === 0 && requirement.triageTargetIds.length === 0,
    )
    .map((requirement) => requirement.requirementId);
  const liveEvidenceTargetIds = uniqueStrings([
    ...knownTriageTargets,
    ...decisionDependencies.flatMap((decision) => decision.triageTargetIds),
  ]);
  const diagnosisCoverageStatus = readString(diagnosisCoverage?.status, "not-provided");
  const releaseReadinessBlockers = buildDiagnosisCoverageReleaseReadinessBlockers({
    diagnosisCoverage,
    diagnosisCoverageStatus,
  });
  const diagnosisCoverageReady = !diagnosisCoverage || (
    isReadyLikeStatus(diagnosisCoverageStatus) &&
    diagnosisCoverage?.summary?.releaseReady === true &&
    releaseReadinessBlockers.length === 0
  );
  const releaseReady =
    isReadyReleaseGateStatus(releaseGate.status) &&
    releaseGateRequirements.length === 0 &&
    unmappedRequirementIds.length === 0 &&
    (queueItems.length === 0 || isReadyLikeStatus(ownerDecisionQueue.status)) &&
    (liveEvidenceTargetIds.length === 0 || isReadyLikeStatus(enterpriseLiveEvidenceTriage.status)) &&
    diagnosisCoverageReady;

  return {
    target: "release-blocker-dependency-graph",
    status: releaseReady ? "ready" : "blocked",
    releaseGateStatus: readString(releaseGate.status, "unknown"),
    ownerDecisionQueueStatus: readString(ownerDecisionQueue.status, "unknown"),
    enterpriseLiveEvidenceTriageStatus: readString(enterpriseLiveEvidenceTriage.status, "unknown"),
    diagnosisCoverageStatus,
    responsibleSession: "S22",
    summary: {
      blockedRequirementCount: releaseGateRequirements.length,
      mappedBlockedRequirementCount: releaseGateRequirements.length - unmappedRequirementIds.length,
      unmappedBlockedRequirementCount: unmappedRequirementIds.length,
      ownerDecisionCount: queueItems.length,
      executionWaveCount: readRecordArray(enterpriseLiveEvidenceTriage.executionWaves).length,
      liveEvidenceTargetCount: liveEvidenceTargetIds.length,
      diagnosisCoverageReady,
      diagnosisCoverageBlockerCount: releaseReadinessBlockers.length,
      releaseReady,
    },
    releaseReadinessBlockers,
    unmappedRequirementIds,
    requirements,
    decisionDependencies,
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      secretValuesOmitted: true,
      responseBodiesOmitted: true,
      noLiveMutationPerformed: true,
      noDeploymentMutationPerformed: true,
      noReleaseRunBindingPerformed: true,
    },
  };
}

function buildDiagnosisCoverageReleaseReadinessBlockers({
  diagnosisCoverage,
  diagnosisCoverageStatus,
}) {
  if (!diagnosisCoverage) {
    return [];
  }

  const blockers = [
    ...readStringArray(diagnosisCoverage.releaseReadinessBlockers),
  ];
  const summary = isRecord(diagnosisCoverage.summary) ? diagnosisCoverage.summary : {};

  if (!isReadyLikeStatus(diagnosisCoverageStatus)) {
    blockers.push(`diagnosis-coverage-status-${diagnosisCoverageStatus}`);
  }
  if (readNumber(summary.uncoveredRequirementCount, 0) > 0) {
    blockers.push("diagnosis-coverage-uncovered-requirements");
  }
  if (summary.releaseReady !== true && blockers.length === 0) {
    blockers.push("diagnosis-coverage-release-ready-false");
  }

  return uniqueStrings(blockers);
}

function buildRequirementDependency({ requirement, queueItems, targetToWave, knownTriageTargets }) {
  const requirementId = readString(requirement.id, "unknown-requirement");
  const blockedReason = readString(requirement.blockedReason, "unknown-blocker");
  const blockingDecisions = queueItems
    .filter(
      (item) =>
        readStringArray(item.releaseGateRequirementIds).includes(requirementId) ||
        readStringArray(item.blockedReasons).includes(blockedReason),
    )
    .sort(compareRank);
  const directTargetDecisions = blockingDecisions.filter(
    (decision) =>
      !aggregateDecisionIdsForRequirementTargetExpansion.has(
        readString(decision.id, "unknown-decision"),
      ),
  );
  const triageTargetIds = uniqueStrings([
    ...(knownTriageTargets.has(requirementId) ? [requirementId] : []),
    ...directTargetDecisions.flatMap((item) => readStringArray(item.enterpriseAuditMissingTargets)),
  ]);

  return {
    requirementId,
    status: readString(requirement.status, "unknown"),
    blockedReason,
    upstreamStatus: summarizeUpstreamStatus(blockingDecisions),
    blockingDecisionIds: blockingDecisions.map((decision) => readString(decision.id, "unknown-decision")),
    blockingDecisionRanks: blockingDecisions.map((decision) =>
      Number.isInteger(decision.rank) ? decision.rank : null,
    ),
    triageTargetIds,
    executionWaveIds: waveIdsForTargets(triageTargetIds, targetToWave),
    nextSafeActions: uniqueStrings(blockingDecisions.flatMap((decision) =>
      readStringArray(decision.safeNextActions),
    )),
    responsibleSessions: uniqueStrings(blockingDecisions.flatMap((decision) =>
      readStringArray(decision.responsibleSessions),
    )),
  };
}

function buildDecisionDependency({ queueItem, releaseGateRequirements, targetToWave, knownTriageTargets }) {
  const decisionId = readString(queueItem.id, "unknown-decision");
  const releaseGateRequirementIds = readStringArray(queueItem.releaseGateRequirementIds);
  const blockedReasons = readStringArray(queueItem.blockedReasons);
  const blockedRequirementIds = releaseGateRequirements
    .filter((requirement) => {
      const requirementId = readString(requirement.id, "");
      const blockedReason = readString(requirement.blockedReason, "");
      return releaseGateRequirementIds.includes(requirementId) || blockedReasons.includes(blockedReason);
    })
    .map((requirement) => readString(requirement.id, "unknown-requirement"));
  const triageTargetIds = uniqueStrings([
    ...readStringArray(queueItem.enterpriseAuditMissingTargets),
    ...releaseGateRequirementIds.filter((requirementId) => knownTriageTargets.has(requirementId)),
  ]);

  return {
    decisionId,
    rank: Number.isInteger(queueItem.rank) ? queueItem.rank : null,
    status: readString(queueItem.status, "unknown"),
    category: readString(queueItem.category, "unknown-category"),
    blockedRequirementIds,
    blockedReasons,
    triageTargetIds,
    executionWaveIds: waveIdsForTargets(triageTargetIds, targetToWave),
    nextSafeActions: readStringArray(queueItem.safeNextActions),
  };
}

function buildTargetToWaveMap(executionWaves) {
  const targetToWave = new Map();
  for (const wave of readRecordArray(executionWaves)) {
    const waveId = readString(wave.id, "unknown-wave");
    for (const targetEntry of readArray(wave.targets)) {
      const target = typeof targetEntry === "string"
        ? targetEntry
        : readString(targetEntry?.target, "");
      if (!target) {
        continue;
      }
      if (!targetToWave.has(target)) {
        targetToWave.set(target, []);
      }
      targetToWave.get(target).push(waveId);
    }
  }
  return targetToWave;
}

function summarizeUpstreamStatus(decisions) {
  if (decisions.length === 0) {
    return "unknown";
  }
  const statuses = decisions.map((decision) => normalizeDecisionStatus(readString(decision.status, "unknown")));
  return statuses.sort(
    (left, right) => upstreamStatusOrder.indexOf(left) - upstreamStatusOrder.indexOf(right),
  )[0] ?? "unknown";
}

function normalizeDecisionStatus(status) {
  if (status === "owner-decision-needed") {
    return "owner-decision-required";
  }
  if (upstreamStatusOrder.includes(status)) {
    return status;
  }
  return "blocked";
}

function isReadyReleaseGateStatus(status) {
  const value = readString(status, "unknown");
  return value === "ready" || value === "passed";
}

function isReadyLikeStatus(status) {
  return [
    "ready",
    "passed",
    "complete",
    "completed",
    "accepted",
    "no-owner-decisions-required",
    "owner-decisions-complete",
    "coverage-complete",
  ].includes(readString(status, "unknown"));
}

function waveIdsForTargets(targets, targetToWave) {
  return uniqueStrings(targets.flatMap((target) => targetToWave.get(target) ?? []));
}

function renderMarkdown(graph) {
  const lines = [
    "# UAIS Release Blocker Dependency Graph",
    "",
    `Status: \`${graph.status}\``,
    `Release gate: \`${graph.releaseGateStatus}\``,
    `Owner queue: \`${graph.ownerDecisionQueueStatus}\``,
    `Enterprise live triage: \`${graph.enterpriseLiveEvidenceTriageStatus}\``,
    `Diagnosis coverage: \`${graph.diagnosisCoverageStatus}\``,
    `Diagnosis coverage ready: \`${graph.summary.diagnosisCoverageReady}\``,
    `Blocked requirements mapped: ${graph.summary.mappedBlockedRequirementCount} / ${graph.summary.blockedRequirementCount}`,
    "",
    "This graph is coordination evidence only. It does not make blocked production evidence release-ready.",
    "",
    "## Requirement Dependency Graph",
    "",
    "| Requirement | Blocker | Upstream status | Decisions | Waves | Live targets |",
    "| --- | --- | --- | --- | --- | --- |",
    ...graph.requirements.map((requirement) =>
      [
        `| \`${requirement.requirementId}\``,
        `| \`${requirement.blockedReason}\``,
        `| \`${requirement.upstreamStatus}\``,
        `| ${formatInlineList(requirement.blockingDecisionIds)}`,
        `| ${formatInlineList(requirement.executionWaveIds)}`,
        `| ${formatInlineList(requirement.triageTargetIds)} |`,
      ].join(" "),
    ),
    "",
    "## Decision Dependencies",
    "",
    "| Rank | Decision | Status | Requirements | Waves |",
    "| ---: | --- | --- | --- | --- |",
    ...graph.decisionDependencies.map((decision) =>
      [
        `| ${decision.rank ?? ""}`,
        `| \`${decision.decisionId}\``,
        `| \`${decision.status}\``,
        `| ${formatInlineList(decision.blockedRequirementIds)}`,
        `| ${formatInlineList(decision.executionWaveIds)} |`,
      ].join(" "),
    ),
    "",
    `Unmapped requirements: ${formatInlineList(graph.unmappedRequirementIds)}`,
    `Release readiness blockers: ${formatInlineList(graph.releaseReadinessBlockers)}`,
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
  return JSON.parse(readFileSync(args[key], "utf8"));
}

function compareRank(left, right) {
  const leftRank = Number.isInteger(left.rank) ? left.rank : Number.MAX_SAFE_INTEGER;
  const rightRank = Number.isInteger(right.rank) ? right.rank : Number.MAX_SAFE_INTEGER;
  return leftRank - rightRank;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

function formatInlineList(values) {
  return values.length > 0 ? values.map((value) => `\`${value}\``).join(", ") : "`none-recorded`";
}

function readString(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function readStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function readNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function readRecordArray(value) {
  return Array.isArray(value) ? value.filter((item) => isRecord(item)) : [];
}

function readArray(value) {
  return Array.isArray(value) ? value : [];
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
