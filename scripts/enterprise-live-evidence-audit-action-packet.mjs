#!/usr/bin/env node

import { readFileSync } from "node:fs";

const decisionId = "enterprise-live-evidence-audit";
const requirementId = "enterprise-live-evidence-audit";

const commands = {
  runEnterpriseAudit:
    "node scripts/enterprise-live-evidence-audit.mjs --reports-dir coordination/reports --date <production-live-date> --output <enterprise-live-evidence-audit-output>",
  refreshReleaseGateWithAudit:
    "node -- scripts/production-e2e-release-gate.mjs <release-gate-inputs> --enterprise-live-evidence-audit <enterprise-live-evidence-audit-output> > <production-e2e-release-gate-output>",
};

const stopConditions = [
  "Stop if any required production-live evidence target is missing.",
  "Stop if any candidate evidence is filename-only or blocked rather than body-proven live production evidence.",
  "Stop if production live evidence does not share the same non-secret release-run ID.",
  "Stop if local or dry-run evidence is being treated as production live evidence.",
  "Stop if target-specific result, env, or contract proof is missing for any accepted target.",
  "Stop if raw URLs, local paths, cookies, response bodies, or secret-like values would be logged.",
];

function main() {
  const args = parseArgs(process.argv.slice(2));
  const ownerChecklist = readJsonArg(args, "owner-checklist");
  const ownerDecisionQueue = readJsonArg(args, "owner-decision-queue");
  const releaseGate = readJsonArg(args, "release-gate");
  const enterpriseAudit = readJsonArg(args, "enterprise-live-evidence-audit");
  const packet = buildPacket({
    ownerChecklist,
    ownerDecisionQueue,
    releaseGate,
    enterpriseAudit,
  });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(packet));
    return;
  }

  process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
}

function buildPacket({ ownerChecklist, ownerDecisionQueue, releaseGate, enterpriseAudit }) {
  const decision = findDecision(ownerChecklist);
  const queueItem = findQueueItem(ownerDecisionQueue);
  const requirement = findRequirement(releaseGate);
  const auditSummary = isRecord(enterpriseAudit.summary) ? enterpriseAudit.summary : {};
  const auditCriteria = isRecord(enterpriseAudit.criteria) ? enterpriseAudit.criteria : {};
  const acceptedBodyFields = isRecord(auditCriteria.acceptedBodyFields)
    ? auditCriteria.acceptedBodyFields
    : {};

  const requiredTargets = firstStringArray(
    enterpriseAudit.requiredTargets,
    requirement.requiredTargets,
    queueItem.enterpriseAuditMissingTargets,
  );
  const missingRequiredTargets = firstStringArray(
    enterpriseAudit.missingRequiredTargets,
    requirement.missingRequiredTargets,
    queueItem.enterpriseAuditMissingTargets,
  );
  const auditBlockedReasons = firstStringArray(
    enterpriseAudit.blockedReasons,
    requirement.auditBlockedReasons,
    decision.blockedReasons,
  );

  return {
    target: "enterprise-live-evidence-audit-action-packet",
    status: readString(decision.status, "unknown"),
    releaseGateStatus: readString(releaseGate.status, readString(ownerDecisionQueue.releaseGateStatus, "unknown")),
    responsibleSession: "S22",
    decisionId,
    queueRank: Number.isInteger(queueItem.rank) ? queueItem.rank : null,
    classification: "production-live-evidence-audit-blocked",
    nextOwnerQuestion: readString(
      queueItem.nextOwnerQuestion,
      "Run the enterprise live evidence audit only after all approved production live evidence files exist.",
    ),
    blockedReasons: readStringArray(decision.blockedReasons),
    safeNextActions: readStringArray(decision.safeNextActions),
    forbiddenUntilApproved: readStringArray(decision.forbiddenUntilApproved),
    requiredEvidence: readStringArray(decision.proofNeeded),
    currentEvidenceSummary: {
      evidenceStatus: readString(requirement.evidenceStatus, readString(enterpriseAudit.status, "missing")),
      totalProductionLiveNamed: readNumber(
        requirement.totalProductionLiveNamed,
        auditSummary.totalProductionLiveNamed,
      ),
      acceptedLiveEvidence: readNumber(
        requirement.acceptedLiveEvidence,
        auditSummary.acceptedLiveEvidence,
      ),
      filenameOnlyOrBlocked: readNumber(
        requirement.filenameOnlyOrBlocked,
        auditSummary.filenameOnlyOrBlocked,
      ),
      releaseRunIdConsistency: readString(
        requirement.releaseRunIdConsistency,
        readString(auditSummary.releaseRunIdConsistency, "missing"),
      ),
      sharedReleaseRunIdStatus: readString(
        requirement.sharedReleaseRunIdStatus,
        readString(auditSummary.sharedReleaseRunIdStatus, "missing"),
      ),
      distinctReleaseRunIdCount: readNumber(
        requirement.distinctReleaseRunIdCount,
        auditSummary.distinctReleaseRunIdCount,
      ),
      rowProofStatus: readString(requirement.rowProofStatus, "missing"),
      rowCount: readNumber(requirement.rowCount, auditSummary.totalProductionLiveNamed),
      acceptedRowCount: readNumber(
        requirement.acceptedRowCount,
        Array.isArray(enterpriseAudit.acceptedTargets) ? enterpriseAudit.acceptedTargets.length : 0,
      ),
      blockedRowCount: readNumber(
        requirement.blockedRowCount,
        auditSummary.filenameOnlyOrBlocked,
      ),
      requiredTargetProofStatus: readString(
        requirement.requiredTargetProofStatus,
        readString(auditSummary.requiredTargetProofStatus, "missing"),
      ),
      requiredTargetResultCriteriaStatus: readString(
        requirement.requiredTargetResultCriteriaStatus,
        "missing",
      ),
      requiredTargetContractCriteriaStatus: readString(
        requirement.requiredTargetContractCriteriaStatus,
        "missing",
      ),
      missingRequiredTargetCount: readNumber(
        requirement.missingRequiredTargetCount,
        auditSummary.missingRequiredTargetCount,
      ),
      unexpectedTargetCount: readNumber(
        requirement.unexpectedTargetCount,
        auditSummary.unexpectedTargetCount,
      ),
      unexpectedEvidenceFileCount: readNumber(
        requirement.unexpectedEvidenceFileCount,
        auditSummary.unexpectedEvidenceFileCount,
      ),
      auditBlockedReasons,
      safety: readSafety(requirement.safety, enterpriseAudit.safety),
      requiredSafetyFlags: readStringArray(acceptedBodyFields.requiredSafetyFlags),
    },
    requiredTargets,
    missingRequiredTargets,
    releaseGateRequirementIds: readStringArray(queueItem.releaseGateRequirementIds),
    enterpriseAuditMissingTargets: readStringArray(queueItem.enterpriseAuditMissingTargets),
    commands,
    stopConditions,
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      cookieValuesOmitted: true,
      responseBodiesOmitted: true,
      noLiveAuditRun: true,
      noReleaseRunBindingPerformed: true,
      filenameOnlyEvidenceRejected: true,
      liveEvidenceRequired: true,
      valuesRedacted: true,
    },
  };
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
  const accepted = packet.currentEvidenceSummary.acceptedLiveEvidence ?? "missing";
  const total = packet.currentEvidenceSummary.totalProductionLiveNamed ?? "missing";
  const lines = [
    "# UAIS Enterprise Live Evidence Audit Action Packet",
    "",
    `Status: \`${packet.status}\``,
    `Release gate: \`${packet.releaseGateStatus}\``,
    `Queue rank: ${packet.queueRank ?? "not queued"}`,
    `Decision: \`${packet.decisionId}\``,
    "",
    "Filename-only or blocked evidence cannot satisfy the enterprise live audit.",
    "",
    "## Owner Question",
    "",
    packet.nextOwnerQuestion,
    "",
    "## Current Evidence Summary",
    "",
    `- Evidence status: \`${packet.currentEvidenceSummary.evidenceStatus}\``,
    `- Accepted live evidence: ${accepted} / ${total}`,
    `- Filename-only or blocked: ${packet.currentEvidenceSummary.filenameOnlyOrBlocked ?? "missing"}`,
    `- Release-run consistency: \`${packet.currentEvidenceSummary.releaseRunIdConsistency}\``,
    `- Shared release-run status: \`${packet.currentEvidenceSummary.sharedReleaseRunIdStatus}\``,
    `- Missing required targets: ${packet.currentEvidenceSummary.missingRequiredTargetCount ?? packet.missingRequiredTargets.length}`,
    `- Unexpected targets: ${packet.currentEvidenceSummary.unexpectedTargetCount ?? "missing"}`,
    `- Unexpected evidence files: ${packet.currentEvidenceSummary.unexpectedEvidenceFileCount ?? "missing"}`,
    `- Required target proof: \`${packet.currentEvidenceSummary.requiredTargetProofStatus}\``,
    `- Required target result criteria: \`${packet.currentEvidenceSummary.requiredTargetResultCriteriaStatus}\``,
    `- Required target contract criteria: \`${packet.currentEvidenceSummary.requiredTargetContractCriteriaStatus}\``,
    "",
    "## Missing Required Targets",
    "",
    ...packet.missingRequiredTargets.map((target) => `- \`${target}\``),
    "",
    "## Required Evidence",
    "",
    ...packet.requiredEvidence.map((item) => `- \`${item}\``),
    "",
    "## Command Templates",
    "",
    `- Run enterprise audit: \`${packet.commands.runEnterpriseAudit}\``,
    `- Refresh release gate with audit: \`${packet.commands.refreshReleaseGateWithAudit}\``,
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

function firstStringArray(...values) {
  for (const value of values) {
    const strings = readStringArray(value);
    if (strings.length > 0) {
      return strings;
    }
  }
  return [];
}

function readSafety(...values) {
  const safety = {
    valuesRedacted: false,
    cookieValuesOmitted: false,
    localPathsOmitted: false,
    fileNamesOnly: false,
    responseBodiesOmitted: false,
  };

  for (const value of values) {
    if (!isRecord(value)) {
      continue;
    }
    for (const key of Object.keys(safety)) {
      safety[key] = safety[key] || value[key] === true || value[key] === "proved";
    }
  }

  return safety;
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

function readNumber(...values) {
  for (const value of values) {
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
