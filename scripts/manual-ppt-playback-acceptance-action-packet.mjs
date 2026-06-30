#!/usr/bin/env node

import { readFileSync } from "node:fs";

const decisionId = "manual-ppt-playback-acceptance";
const requirementId = "ppt-manual-playback-acceptance";
const requiredApplications = ["Microsoft PowerPoint", "WPS Presentation"];

const requiredEvidence = [
  "human-powerpoint-playback-accepted",
  "human-wps-playback-accepted",
  "explicit-accepted-after-human-playback-status",
  "valid-tested-at-timestamp",
  "same-release-run-id-bound-to-manual-record",
  "same-vercel-production-deployment-bound-to-manual-playback-record",
  "all-19-slide-audio-checks-true",
  "target-cloned-voice-label-present",
  "target-cloned-voice-heard-per-slide",
];

const commands = {
  createManualRecordTemplate:
    "node scripts/ppt-manual-playback-acceptance.mjs --package-json <kangxia-package-json> --preflight-report <desktop-preflight-report> --openxml-integrity <openxml-integrity-evidence> --desktop-app-evidence <desktop-app-evidence> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --record-template-out <manual-record-template> > <ppt-manual-playback-gate-plan-evidence>",
  finalManualAcceptanceEvidence:
    "node scripts/ppt-manual-playback-acceptance.mjs --package-json <kangxia-package-json> --preflight-report <desktop-preflight-report> --manual-record <completed-human-manual-record> --openxml-integrity <openxml-integrity-evidence> --desktop-app-evidence <desktop-app-evidence> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> > <ppt-manual-playback-acceptance-evidence>",
};

const stopConditions = [
  "Stop if human PowerPoint and WPS playback have not both been completed.",
  "Stop if any of the 19 slide audio checks is missing for either application.",
  "Stop if target cloned voice label or per-slide target voice confirmation is missing.",
  "Stop if machine preflight or desktop-open evidence is being treated as final human acceptance.",
  "Stop if the manual record is not bound to the same release run and Vercel production deployment.",
  "Stop if private PPT package paths, audio URLs, or local reviewer paths would be logged.",
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
  const template = isRecord(requirement.manualRecordTemplate)
    ? requirement.manualRecordTemplate
    : {};

  return {
    target: "manual-ppt-playback-acceptance-action-packet",
    status: readString(decision.status, "unknown"),
    releaseGateStatus: readString(releaseGate.status, readString(ownerDecisionQueue.releaseGateStatus, "unknown")),
    responsibleSession: "S24",
    decisionId,
    queueRank: Number.isInteger(queueItem.rank) ? queueItem.rank : null,
    classification: "human-powerpoint-wps-playback-acceptance-blocked",
    nextOwnerQuestion: readString(
      queueItem.nextOwnerQuestion,
      "Complete human PPT playback acceptance after production deployment and bind it to the release run.",
    ),
    requiredApplications,
    blockedReasons: readStringArray(decision.blockedReasons),
    safeNextActions: readStringArray(decision.safeNextActions),
    forbiddenUntilApproved: readStringArray(decision.forbiddenUntilApproved),
    requiredEvidence,
    currentEvidenceSummary: {
      evidenceStatus: readString(requirement.evidenceStatus, "missing"),
      acceptedApplications: readAllowedApplications(requirement.acceptedApplications),
      manualRecordEvidenceStatus: readString(requirement.manualRecordEvidenceStatus, "missing"),
      manualRecordPackageIdentityStatus: readString(
        requirement.manualRecordPackageIdentityStatus,
        "missing",
      ),
      machinePreflightStatus: readString(requirement.machinePreflightStatus, "missing"),
      expectedSlideCount: readNumber(requirement.expectedSlideCount),
      checklistSlideChecks: readNumber(requirement.checklistSlideChecks),
      packageArtifactFingerprintStatus: readString(
        requirement.packageArtifactFingerprintStatus,
        "missing",
      ),
      packageTargetVoiceLabelStatus: readString(
        requirement.packageTargetVoiceLabelStatus,
        "missing",
      ),
      manualRecordArtifactFingerprintStatus: readString(
        requirement.manualRecordArtifactFingerprintStatus,
        "missing",
      ),
      manualRecordReleaseRunStatus: readString(
        requirement.manualRecordReleaseRunStatus,
        "missing",
      ),
      manualRecordAfterDeploymentStatus: readString(
        requirement.manualRecordAfterDeploymentStatus,
        "missing",
      ),
      manualRecordTimingStatus: readString(requirement.manualRecordTimingStatus, "missing"),
      manualRecordConfirmationStatus: readString(
        requirement.manualRecordConfirmationStatus,
        "missing",
      ),
      manualRecordTemplateStatus: readString(template.status, "missing"),
      manualRecordTemplateAccepted:
        typeof template.accepted === "boolean" ? template.accepted : false,
      manualRecordTemplateFileName: readString(template.fileName, "missing"),
    },
    releaseGateRequirementIds: readStringArray(queueItem.releaseGateRequirementIds),
    enterpriseAuditMissingTargets: readStringArray(queueItem.enterpriseAuditMissingTargets),
    commands,
    stopConditions,
    safety: {
      sourcePathsOmitted: true,
      packagePathsOmitted: true,
      audioUrlsOmitted: true,
      manualAcceptancePerformed: false,
      machineEvidenceDoesNotCountAsAcceptance: true,
      humanPlaybackRequired: true,
      responseBodiesOmitted: true,
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
  const lines = [
    "# UAIS Manual PPT Playback Acceptance Action Packet",
    "",
    `Status: \`${packet.status}\``,
    `Release gate: \`${packet.releaseGateStatus}\``,
    `Queue rank: ${packet.queueRank ?? "not queued"}`,
    `Decision: \`${packet.decisionId}\``,
    "",
    "Machine preflight does not count as final human acceptance.",
    "",
    "## Owner Question",
    "",
    packet.nextOwnerQuestion,
    "",
    "## Required Applications",
    "",
    ...packet.requiredApplications.map((application) => `- \`${application}\``),
    "",
    "## Current Evidence Summary",
    "",
    `- Evidence status: \`${packet.currentEvidenceSummary.evidenceStatus}\``,
    `- Accepted applications: ${formatInlineList(packet.currentEvidenceSummary.acceptedApplications)}`,
    `- Manual record evidence: \`${packet.currentEvidenceSummary.manualRecordEvidenceStatus}\``,
    `- Machine preflight: \`${packet.currentEvidenceSummary.machinePreflightStatus}\``,
    `- Expected slides: ${packet.currentEvidenceSummary.expectedSlideCount ?? "missing"}`,
    `- Checklist slide checks: ${packet.currentEvidenceSummary.checklistSlideChecks ?? "missing"}`,
    `- Package fingerprint: \`${packet.currentEvidenceSummary.packageArtifactFingerprintStatus}\``,
    `- Target voice label: \`${packet.currentEvidenceSummary.packageTargetVoiceLabelStatus}\``,
    `- Manual record release-run binding: \`${packet.currentEvidenceSummary.manualRecordReleaseRunStatus}\``,
    `- Manual record deployment binding: \`${packet.currentEvidenceSummary.manualRecordAfterDeploymentStatus}\``,
    `- Manual confirmation: \`${packet.currentEvidenceSummary.manualRecordConfirmationStatus}\``,
    `- Manual record template: \`${packet.currentEvidenceSummary.manualRecordTemplateStatus}\``,
    "",
    "## Required Evidence",
    "",
    ...packet.requiredEvidence.map((item) => `- \`${item}\``),
    "",
    "## Command Templates",
    "",
    `- Create manual record template: \`${packet.commands.createManualRecordTemplate}\``,
    `- Final manual acceptance evidence: \`${packet.commands.finalManualAcceptanceEvidence}\``,
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

function formatInlineList(values) {
  return values.length > 0 ? values.map((value) => `\`${value}\``).join(", ") : "`none-recorded`";
}

function readAllowedApplications(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.filter(
    (value) => typeof value === "string" && requiredApplications.includes(value),
  );
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

function readNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
