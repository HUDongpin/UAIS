#!/usr/bin/env node

import { readFileSync } from "node:fs";

const decisionId = "production-release-run";
const requirementId = "production-release-run-consistency";

const safeReleaseRunStatuses = new Set([
  "waiting",
  "present",
  "missing",
  "matched",
  "mismatched",
  "not-required",
  "blocked",
  "ready",
]);

const commands = {
  finalReleaseGateCheck:
    "node -- scripts/production-e2e-release-gate.mjs <release-gate-inputs> > <production-e2e-release-gate-output>",
  releaseRunBindingReview:
    "review production-release-run-consistency in <production-e2e-release-gate-output> and bind one public release-run ID only after status is ready",
};

const stopConditions = [
  "Stop if the final release gate is not ready.",
  "Stop if any upstream owner decision or production live evidence remains blocked.",
  "Stop if release-run IDs across production evidence are missing or mismatched.",
  "Stop if a release-run ID would be bound while the release gate is blocked.",
  "Stop if production evidence comes from multiple release-run IDs.",
  "Stop if local private paths, raw URLs, response bodies, or secret-like values would be included in the release summary.",
];

function main() {
  const args = parseArgs(process.argv.slice(2));
  const ownerChecklist = readJsonArg(args, "owner-checklist");
  const ownerDecisionQueue = readJsonArg(args, "owner-decision-queue");
  const releaseGate = readJsonArg(args, "release-gate");
  const packet = buildPacket({ ownerChecklist, ownerDecisionQueue, releaseGate });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(packet));
    return;
  }

  process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
}

function buildPacket({ ownerChecklist, ownerDecisionQueue, releaseGate }) {
  const decision = findDecision(ownerChecklist);
  const queueItem = findQueueItem(ownerDecisionQueue);
  const requirement = findRequirement(releaseGate);
  const releaseRunEvidenceStatusBySource = sanitizeReleaseRunStatuses(
    requirement.releaseRunIds,
  );
  const counts = countReleaseRunStatuses(releaseRunEvidenceStatusBySource);

  return {
    target: "production-release-run-action-packet",
    status: readString(decision.status, "unknown"),
    releaseGateStatus: readString(releaseGate.status, readString(ownerDecisionQueue.releaseGateStatus, "unknown")),
    responsibleSessions: readStringArray(decision.responsibleSessions),
    decisionId,
    queueRank: Number.isInteger(queueItem.rank) ? queueItem.rank : null,
    classification: "final-release-run-binding-blocked",
    nextOwnerQuestion: readString(
      queueItem.nextOwnerQuestion,
      "Do not bind the production release-run ID until the release gate is ready.",
    ),
    blockedReasons: readStringArray(decision.blockedReasons),
    safeNextActions: readStringArray(decision.safeNextActions),
    forbiddenUntilApproved: readStringArray(decision.forbiddenUntilApproved),
    requiredEvidence: readStringArray(decision.proofNeeded),
    currentEvidenceSummary: {
      requirementStatus: readString(requirement.status, "missing"),
      evidenceStatus: readString(requirement.evidenceStatus, "missing"),
      blockedReason: readString(requirement.blockedReason, "missing"),
      releaseRunEvidenceStatusBySource,
      waitingReleaseRunEvidenceCount: counts.waiting,
      presentReleaseRunEvidenceCount: counts.present,
      matchedReleaseRunEvidenceCount: counts.matched,
      matchStatus: releaseRunEvidenceStatusBySource.match ?? "missing",
    },
    releaseGateRequirementIds: readStringArray(queueItem.releaseGateRequirementIds),
    enterpriseAuditMissingTargets: readStringArray(queueItem.enterpriseAuditMissingTargets),
    commands,
    stopConditions,
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      secretValuesOmitted: true,
      responseBodiesOmitted: true,
      noReleaseRunIdBound: true,
      releaseGateStillBlocked: releaseGate.status === "blocked",
      noGitOperation: true,
    },
  };
}

function sanitizeReleaseRunStatuses(value) {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, rawStatus]) => [
      key,
      sanitizeReleaseRunStatus(rawStatus),
    ]),
  );
}

function sanitizeReleaseRunStatus(value) {
  if (typeof value !== "string") {
    return "missing";
  }

  const status = value.trim();
  if (safeReleaseRunStatuses.has(status)) {
    return status;
  }

  return status.length > 0 ? "present" : "missing";
}

function countReleaseRunStatuses(statuses) {
  const counts = { waiting: 0, present: 0, matched: 0 };
  for (const [key, status] of Object.entries(statuses)) {
    if (key === "match") {
      continue;
    }
    if (status === "waiting") {
      counts.waiting += 1;
    } else if (status === "matched") {
      counts.matched += 1;
    } else if (status === "present") {
      counts.present += 1;
    }
  }
  return counts;
}

function findDecision(ownerChecklist) {
  const decisions = Array.isArray(ownerChecklist.decisions) ? ownerChecklist.decisions : [];
  const decision = decisions.find((item) => isRecord(item) && item.id === decisionId);
  if (!decision) {
    throw new Error(`Missing ${decisionId} in owner checklist.`);
  }
  return decision;
}

function findQueueItem(ownerDecisionQueue) {
  const queue = Array.isArray(ownerDecisionQueue.queue)
    ? ownerDecisionQueue.queue
    : readRecordArray(ownerDecisionQueue.ownerDecisionQueue);
  const item = queue.find((entry) => isRecord(entry) && entry.id === decisionId);
  return isRecord(item) ? item : {};
}

function findRequirement(releaseGate) {
  const requirements = Array.isArray(releaseGate.requirements) ? releaseGate.requirements : [];
  const requirement = requirements.find((item) => isRecord(item) && item.id === requirementId);
  if (!requirement) {
    throw new Error(`Missing ${requirementId} in release gate.`);
  }
  return requirement;
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

function renderMarkdown(packet) {
  const lines = [
    "# UAIS Production Release-Run Action Packet",
    "",
    `Status: \`${packet.status}\``,
    `Release gate: \`${packet.releaseGateStatus}\``,
    `Queue rank: ${packet.queueRank ?? "not queued"}`,
    `Decision: \`${packet.decisionId}\``,
    "",
    "Release-run binding must wait until the final release gate is ready.",
    "",
    "## Owner Question",
    "",
    packet.nextOwnerQuestion,
    "",
    "## Current Evidence Summary",
    "",
    `- Requirement status: \`${packet.currentEvidenceSummary.requirementStatus}\``,
    `- Evidence status: \`${packet.currentEvidenceSummary.evidenceStatus}\``,
    `- Blocked reason: \`${packet.currentEvidenceSummary.blockedReason}\``,
    `- Waiting release-run evidence: ${packet.currentEvidenceSummary.waitingReleaseRunEvidenceCount}`,
    `- Present release-run evidence: ${packet.currentEvidenceSummary.presentReleaseRunEvidenceCount}`,
    `- Matched release-run evidence: ${packet.currentEvidenceSummary.matchedReleaseRunEvidenceCount}`,
    `- Match status: \`${packet.currentEvidenceSummary.matchStatus}\``,
    "",
    "## Release-Run Evidence Status By Source",
    "",
    ...Object.entries(packet.currentEvidenceSummary.releaseRunEvidenceStatusBySource).map(
      ([source, status]) => `- \`${source}\`: \`${status}\``,
    ),
    "",
    "## Required Evidence",
    "",
    ...packet.requiredEvidence.map((item) => `- \`${item}\``),
    "",
    "## Command Templates",
    "",
    `- Final release gate check: \`${packet.commands.finalReleaseGateCheck}\``,
    `- Release-run binding review: \`${packet.commands.releaseRunBindingReview}\``,
    "",
    "## Safe Next Actions",
    "",
    ...packet.safeNextActions.map((item) => `- \`${item}\``),
    "",
    "## Stop Conditions",
    "",
    ...packet.stopConditions.map((condition) => `- ${condition}`),
    "",
    "## Forbidden Until Approved",
    "",
    ...packet.forbiddenUntilApproved.map((item) => `- \`${item}\``),
  ];
  return `${lines.join("\n")}\n`;
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
