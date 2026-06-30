#!/usr/bin/env node

import { readFileSync } from "node:fs";

const decisionId = "app-auth-provider-production-selector";
const requiredEnvNames = [
  "UAIS_APP_SESSION_SIGNING_SECRET",
  "UAIS_APP_AUTH_PROVIDER",
  "UAIS_APP_AUTH_PROVIDER_URL",
  "UAIS_APP_AUTH_PROVIDER_TOKEN",
];

const requiredEvidence = [
  "vercel-env-sync-evidence-with-app-auth-env-present",
  "app-auth-provider-readiness-production-live-ready",
  "same-release-run-id-bound-to-app-auth-readiness",
];

const commands = {
  vercelEnvSyncDryRun:
    "node scripts/vercel-env-sync.mjs --dry-run --scope full --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <vercel-env-sync-dry-run-evidence>",
  vercelEnvSyncApply:
    "node scripts/vercel-env-sync.mjs --apply --approved --scope full --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <vercel-env-sync-evidence>",
  appAuthReadinessLive:
    "node scripts/app-auth-provider-readiness.mjs --live --approved --environment production --env-file <approved-env-file> --release-run-id <release-run-id> --vercel-env-sync <vercel-env-sync-evidence> > <app-auth-provider-readiness-evidence>",
};

const stopConditions = [
  "Stop if owner has not approved the app auth provider mode and env source.",
  "Stop if approved env source is unavailable to S19.",
  "Stop if live provider readiness would call a remote endpoint without explicit approval.",
  "Stop if Vercel env sync evidence is missing, mismatched, or not release-run-bound.",
];

function main() {
  const args = parseArgs(process.argv.slice(2));
  const ownerChecklist = readJsonArg(args, "owner-checklist");
  const ownerDecisionQueue = readJsonArg(args, "owner-decision-queue");
  const packet = buildPacket(ownerChecklist, ownerDecisionQueue);

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(packet));
    return;
  }

  process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
}

function buildPacket(ownerChecklist, ownerDecisionQueue) {
  const decision = findDecision(ownerChecklist);
  const queueItem = findQueueItem(ownerDecisionQueue);
  const readinessSummary = isRecord(decision.appAuthProviderReadinessSummary)
    ? decision.appAuthProviderReadinessSummary
    : {};
  const vercelEnvSyncEvidence = isRecord(readinessSummary.vercelEnvSyncEvidence)
    ? readinessSummary.vercelEnvSyncEvidence
    : {};

  return {
    target: "app-auth-owner-action-packet",
    status: readString(decision.status, "unknown"),
    releaseGateStatus: readString(ownerChecklist.releaseGateStatus, readString(ownerDecisionQueue.releaseGateStatus, "unknown")),
    responsibleSession: "S22",
    decisionId,
    queueRank: Number.isInteger(queueItem.rank) ? queueItem.rank : null,
    classification: "owner-env-live-evidence-blocked",
    ownerDecisionNeeded: readString(
      decision.ownerDecisionNeeded,
      "choose-production-app-auth-provider-and-approved-server-only-env-source",
    ),
    nextOwnerQuestion: readString(
      queueItem.nextOwnerQuestion,
      "Confirm production app auth provider mode and approved server-only env source.",
    ),
    acceptedOptions: readStringArray(decision.acceptedOptions),
    blockedReasons: readStringArray(decision.blockedReasons),
    safeNextActions: readStringArray(decision.safeNextActions),
    forbiddenUntilApproved: readStringArray(decision.forbiddenUntilApproved),
    requiredEnvNames,
    requiredEvidence,
    currentEvidenceSummary: {
      evidenceStatus: readString(readinessSummary.evidenceStatus, "missing"),
      evidenceEnvironment: readString(readinessSummary.evidenceEnvironment, "missing"),
      appAuthProviderMode: readString(readinessSummary.appAuthProviderMode, "missing"),
      endpointSecurity: readString(readinessSummary.endpointSecurity, "missing"),
      vercelEnvSyncStatus: readString(vercelEnvSyncEvidence.status, "missing"),
      releaseRunIdStatus: readString(vercelEnvSyncEvidence.releaseRunIdStatus, "missing"),
      requiredAppAuthEnvStatus: readString(vercelEnvSyncEvidence.requiredAppAuthEnvStatus, "missing"),
    },
    releaseGateRequirementIds: readStringArray(queueItem.releaseGateRequirementIds),
    enterpriseAuditMissingTargets: readStringArray(queueItem.enterpriseAuditMissingTargets),
    commands,
    stopConditions,
    safety: {
      sourcePathsOmitted: true,
      valuesRedacted: true,
      envValuesOmitted: true,
      liveMutationPerformed: false,
      deploymentMutationPerformed: false,
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
  const queue = Array.isArray(ownerDecisionQueue.queue) ? ownerDecisionQueue.queue : [];
  const item = queue.find((entry) => isRecord(entry) && entry.id === decisionId);
  return isRecord(item) ? item : {};
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
    "# UAIS App Auth Owner Action Packet",
    "",
    `Status: \`${packet.status}\``,
    `Release gate: \`${packet.releaseGateStatus}\``,
    `Queue rank: ${packet.queueRank ?? "not queued"}`,
    `Decision: \`${packet.decisionId}\``,
    "",
    "Do not inspect, print, or copy credential values.",
    "",
    "## Owner Decision",
    "",
    packet.nextOwnerQuestion,
    "",
    `Accepted options: ${formatInlineList(packet.acceptedOptions)}`,
    "",
    "## Required Server-Only Env Names",
    "",
    ...packet.requiredEnvNames.map((name) => `- \`${name}\``),
    "",
    "## Current Evidence Summary",
    "",
    `- Evidence status: \`${packet.currentEvidenceSummary.evidenceStatus}\``,
    `- Environment: \`${packet.currentEvidenceSummary.evidenceEnvironment}\``,
    `- Provider mode: \`${packet.currentEvidenceSummary.appAuthProviderMode}\``,
    `- Endpoint security: \`${packet.currentEvidenceSummary.endpointSecurity}\``,
    `- Vercel env sync: \`${packet.currentEvidenceSummary.vercelEnvSyncStatus}\``,
    `- Release-run binding: \`${packet.currentEvidenceSummary.releaseRunIdStatus}\``,
    `- Required app-auth env: \`${packet.currentEvidenceSummary.requiredAppAuthEnvStatus}\``,
    "",
    "## Command Templates",
    "",
    `- Dry-run env sync: \`${packet.commands.vercelEnvSyncDryRun}\``,
    `- Approved env apply: \`${packet.commands.vercelEnvSyncApply}\``,
    `- Approved app-auth readiness: \`${packet.commands.appAuthReadinessLive}\``,
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

function readString(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function readStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
