#!/usr/bin/env node

import { readFileSync } from "node:fs";

const DECISION_ORDER = new Map([
  ["vercel-project-selection", 10],
  ["app-auth-provider-production-selector", 20],
  ["teacher-auth-provider-production-selector", 30],
  ["external-storage-production-service", 40],
  ["vercel-env-deploy-and-smoke-chain", 50],
  ["ordinary-teaching-production-evidence", 60],
  ["manual-ppt-playback-acceptance", 70],
  ["enterprise-live-evidence-audit", 80],
  ["production-release-run", 90],
]);

const DECISION_CATEGORY = {
  "vercel-project-selection": "project-selection",
  "app-auth-provider-production-selector": "owner-decision",
  "teacher-auth-provider-production-selector": "owner-decision",
  "external-storage-production-service": "owner-decision",
  "vercel-env-deploy-and-smoke-chain": "env-deploy-chain",
  "ordinary-teaching-production-evidence": "live-evidence",
  "manual-ppt-playback-acceptance": "human-qa",
  "enterprise-live-evidence-audit": "evidence-audit",
  "production-release-run": "final-release-binding",
};

const OWNER_QUESTIONS = {
  "vercel-project-selection":
    "Confirm the intended Vercel project before any env apply or production deploy.",
  "app-auth-provider-production-selector":
    "Confirm production app auth provider mode and approved server-only env source.",
  "teacher-auth-provider-production-selector":
    "Confirm production teacher auth provider mode and approved server-only env source.",
  "external-storage-production-service":
    "Confirm the approved remote HTTPS external-storage service and server-only env source.",
  "vercel-env-deploy-and-smoke-chain":
    "Approve S19 Vercel env sync/apply before production deploy and deployed smokes.",
  "ordinary-teaching-production-evidence":
    "Run ordinary-teaching live smokes only after auth, storage, and deployment evidence are ready.",
  "manual-ppt-playback-acceptance":
    "Complete human PPT playback acceptance after production deployment and bind it to the release run.",
  "enterprise-live-evidence-audit":
    "Run the enterprise live evidence audit only after all approved production live evidence files exist.",
  "production-release-run":
    "Do not bind the production release-run ID until the release gate is ready.",
};

const DECISION_AUDIT_TARGETS = {
  "app-auth-provider-production-selector": ["app-auth-provider-readiness"],
  "teacher-auth-provider-production-selector": [
    "teacher-auth-provider-readiness",
    "teacher-auth-issuer-route-smoke",
  ],
  "external-storage-production-service": [
    "external-storage-persistence",
    "external-storage-service-readiness",
    "external-storage-smoke",
  ],
  "vercel-env-deploy-and-smoke-chain": [
    "deployment-domain-reachability",
    "teacher-workflow-deployment-smoke",
    "teacher-workflow-browser-smoke",
    "teacher-workflow-live-generation-smoke",
    "learning-ppt-playback-deployment-smoke",
    "deployment-route-smoke",
  ],
  "ordinary-teaching-production-evidence": [
    "teaching-operations-route-smoke",
    "teaching-operation-detail-browser-smoke",
    "teaching-course-management-route-smoke",
  ],
  "manual-ppt-playback-acceptance": ["ppt-manual-playback-acceptance"],
};

function main() {
  const args = parseArgs(process.argv.slice(2));
  const releaseGate = readJsonArg(args, "release-gate");
  const ownerChecklist = readJsonArg(args, "owner-checklist");
  const enterpriseAudit = readJsonArg(args, "enterprise-live-evidence-audit");
  const report = buildReport({ releaseGate, ownerChecklist, enterpriseAudit });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(report));
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
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

function buildReport({ releaseGate, ownerChecklist, enterpriseAudit }) {
  const blockedRequirements = readBlockedRequirements(releaseGate);
  const activeDecisions = readActiveDecisions(ownerChecklist);
  const missingTargets = readStringArray(enterpriseAudit.missingRequiredTargets);
  const queue = activeDecisions
    .map((decision) => buildQueueItem(decision, blockedRequirements, missingTargets))
    .sort((left, right) => {
      const orderDiff =
        (DECISION_ORDER.get(left.id) ?? 1000) - (DECISION_ORDER.get(right.id) ?? 1000);
      return orderDiff === 0 ? left.id.localeCompare(right.id) : orderDiff;
    })
    .map((item, index) => ({ ...item, rank: index + 1 }));

  return {
    target: "production-owner-decision-queue",
    status: readString(ownerChecklist.status, "unknown"),
    responsibleSession: "S22",
    releaseGateStatus: readString(ownerChecklist.releaseGateStatus, readString(releaseGate.status, "unknown")),
    summary: {
      blockedRequirementCount:
        Number.isInteger(releaseGate.blockedRequirementCount)
          ? releaseGate.blockedRequirementCount
          : blockedRequirements.length,
      ownerDecisionCount: queue.length,
      acceptedLiveEvidence: readSafeNumber(enterpriseAudit.summary?.acceptedLiveEvidence),
      missingEnterpriseLiveTargetCount:
        Number.isInteger(enterpriseAudit.summary?.missingRequiredTargetCount)
          ? enterpriseAudit.summary.missingRequiredTargetCount
          : missingTargets.length,
      firstActionableDecisionId: queue[0]?.id ?? null,
    },
    queue,
    safety: {
      sourcePathsOmitted: true,
      valuesRedacted: true,
      liveMutationPerformed: false,
      deploymentMutationPerformed: false,
    },
  };
}

function readBlockedRequirements(releaseGate) {
  if (!Array.isArray(releaseGate.requirements)) {
    return [];
  }
  return releaseGate.requirements
    .filter((requirement) => isRecord(requirement) && requirement.status === "blocked")
    .map((requirement) => ({
      id: readString(requirement.id, "unknown-requirement"),
      blockedReason: readString(requirement.blockedReason, ""),
      blockedReasons: readStringArray(requirement.blockedReasons),
    }));
}

function readActiveDecisions(ownerChecklist) {
  if (!Array.isArray(ownerChecklist.decisions)) {
    return [];
  }
  return ownerChecklist.decisions
    .filter((decision) => isRecord(decision) && decision.status !== "satisfied")
    .map((decision) => ({
      id: readString(decision.id, "unknown-decision"),
      status: readString(decision.status, "unknown"),
      blockedReasons: readStringArray(decision.blockedReasons),
      safeNextActions: readStringArray(decision.safeNextActions),
      forbiddenUntilApproved: readStringArray(decision.forbiddenUntilApproved),
      sequencing: typeof decision.sequencing === "string" ? decision.sequencing : null,
    }));
}

function buildQueueItem(decision, blockedRequirements, missingTargets) {
  return {
    id: decision.id,
    category: DECISION_CATEGORY[decision.id] ?? "owner-decision",
    status: decision.status,
    blockedReasons: decision.blockedReasons,
    releaseGateRequirementIds: mapRequirementIds(decision.blockedReasons, blockedRequirements),
    enterpriseAuditMissingTargets: mapMissingTargets(decision.id, missingTargets),
    nextOwnerQuestion:
      OWNER_QUESTIONS[decision.id] ?? "Confirm the owner-approved next action for this release decision.",
    safeNextActions: decision.safeNextActions,
    forbiddenUntilApproved: decision.forbiddenUntilApproved,
    sequencing: decision.sequencing,
  };
}

function mapRequirementIds(blockedReasons, blockedRequirements) {
  const reasonSet = new Set(blockedReasons);
  return blockedRequirements
    .filter(
      (requirement) =>
        reasonSet.has(requirement.blockedReason) ||
        requirement.blockedReasons.some((reason) => reasonSet.has(reason)),
    )
    .map((requirement) => requirement.id);
}

function mapMissingTargets(decisionId, missingTargets) {
  if (decisionId === "enterprise-live-evidence-audit" || decisionId === "production-release-run") {
    return missingTargets;
  }
  const expectedTargets = DECISION_AUDIT_TARGETS[decisionId] ?? [];
  const targetSet = new Set(missingTargets);
  return expectedTargets.filter((target) => targetSet.has(target));
}

function renderMarkdown(report) {
  const lines = [
    "# UAIS Production Owner Decision Queue",
    "",
    `Status: \`${report.status}\``,
    `Release gate: \`${report.releaseGateStatus}\``,
    `Blocked requirements: ${report.summary.blockedRequirementCount}`,
    `Owner decisions queued: ${report.summary.ownerDecisionCount}`,
    `Accepted live evidence: ${report.summary.acceptedLiveEvidence}`,
    `Missing enterprise live targets: ${report.summary.missingEnterpriseLiveTargetCount}`,
    "",
    "Do not treat this report as release-ready evidence while the release gate is blocked.",
    "",
    "| Rank | Decision | Category | Status | Next owner question |",
    "| --- | --- | --- | --- | --- |",
    ...report.queue.map(
      (item) =>
        `| ${item.rank} | \`${item.id}\` | ${item.category} | ${item.status} | ${escapeMarkdownTableCell(item.nextOwnerQuestion)} |`,
    ),
    "",
    "## Safe Next Actions",
    "",
    ...report.queue.flatMap((item) => [
      `### ${item.rank}. \`${item.id}\``,
      "",
      `Safe: ${formatInlineList(item.safeNextActions)}`,
      "",
      `Forbidden until approved: ${formatInlineList(item.forbiddenUntilApproved)}`,
      "",
    ]),
  ];
  return `${lines.join("\n")}\n`;
}

function formatInlineList(values) {
  return values.length > 0 ? values.map((value) => `\`${value}\``).join(", ") : "`none-recorded`";
}

function escapeMarkdownTableCell(value) {
  return value.replaceAll("|", "\\|");
}

function readString(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function readStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function readSafeNumber(value) {
  return Number.isInteger(value) ? value : 0;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
