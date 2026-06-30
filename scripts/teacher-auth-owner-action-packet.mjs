#!/usr/bin/env node

import { readFileSync } from "node:fs";

const decisionId = "teacher-auth-provider-production-selector";
const requiredEnvNamesByMode = {
  "trusted-cookie-issuer": [
    "UAIS_TEACHER_AUTH_PROVIDER",
    "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
    "UAIS_TEACHER_AUTH_ISSUER_SECRET",
  ],
  "oidc-jwks": [
    "UAIS_TEACHER_AUTH_PROVIDER",
    "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
    "UAIS_TEACHER_AUTH_OIDC_ISSUER",
    "UAIS_TEACHER_AUTH_OIDC_AUDIENCE",
    "UAIS_TEACHER_AUTH_OIDC_JWKS_URL",
    "UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM",
  ],
};

const requiredEvidence = [
  "vercel-env-sync-evidence-with-teacher-auth-env-present",
  "trusted-teacher-auth-route-chain-contract",
  "deployed-teacher-auth-issuer-route-smoke",
  "teacher-auth-provider-readiness-production-live-ready",
  "same-release-run-id-bound-to-teacher-auth-readiness",
];

const commands = {
  vercelEnvSyncDryRun:
    "node scripts/vercel-env-sync.mjs --dry-run --scope teacher-auth --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <teacher-auth-vercel-env-sync-dry-run-evidence>",
  vercelEnvSyncApply:
    "node scripts/vercel-env-sync.mjs --apply --approved --scope teacher-auth --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <teacher-auth-vercel-env-sync-evidence>",
  teacherAuthReadinessLive:
    "node scripts/teacher-auth-provider-readiness.mjs --live --approved --environment production --env-file <approved-env-file> --release-run-id <release-run-id> --vercel-env-sync <teacher-auth-vercel-env-sync-evidence> --trusted-teacher-auth-route-chain <trusted-teacher-auth-route-chain-evidence> --route-smoke <teacher-auth-issuer-route-smoke-evidence> > <teacher-auth-provider-readiness-evidence>",
};

const stopConditions = [
  "Stop if owner has not approved the teacher auth provider mode and env source.",
  "Stop if approved env source is unavailable to S19.",
  "Stop if production deployment evidence is unavailable for the issuer route smoke.",
  "Stop if live teacher-auth readiness would issue a reusable teacher-auth cookie without explicit approval.",
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
  const readinessSummary = isRecord(decision.teacherAuthProviderReadinessSummary)
    ? decision.teacherAuthProviderReadinessSummary
    : {};
  const authProviderMode = readString(readinessSummary.authProviderMode, "missing");
  const vercelEnvSyncEvidence = isRecord(readinessSummary.vercelEnvSyncEvidence)
    ? readinessSummary.vercelEnvSyncEvidence
    : {};
  const trustedRouteChainEvidence = isRecord(readinessSummary.trustedTeacherAuthRouteChainEvidence)
    ? readinessSummary.trustedTeacherAuthRouteChainEvidence
    : {};
  const trustedRouteSmokeEvidence = isRecord(readinessSummary.trustedTeacherAuthRouteSmokeEvidence)
    ? readinessSummary.trustedTeacherAuthRouteSmokeEvidence
    : {};
  const trustedCookieRoundTrip = isRecord(readinessSummary.trustedCookieSessionRoundTrip)
    ? readinessSummary.trustedCookieSessionRoundTrip
    : {};

  return {
    target: "teacher-auth-owner-action-packet",
    status: readString(decision.status, "unknown"),
    releaseGateStatus: readString(ownerChecklist.releaseGateStatus, readString(ownerDecisionQueue.releaseGateStatus, "unknown")),
    responsibleSession: "S22",
    decisionId,
    queueRank: Number.isInteger(queueItem.rank) ? queueItem.rank : null,
    classification: "owner-env-deploy-route-smoke-blocked",
    ownerDecisionNeeded: readString(
      decision.ownerDecisionNeeded,
      "choose-production-teacher-auth-provider-and-approved-server-only-env-source",
    ),
    nextOwnerQuestion: readString(
      queueItem.nextOwnerQuestion,
      "Confirm production teacher auth provider mode and approved server-only env source.",
    ),
    acceptedOptions: readStringArray(decision.acceptedOptions),
    blockedReasons: readStringArray(decision.blockedReasons),
    safeNextActions: readStringArray(decision.safeNextActions),
    forbiddenUntilApproved: readStringArray(decision.forbiddenUntilApproved),
    requiredEnvNamesByMode,
    currentModeRequiredEnvNames: requiredEnvNamesByMode[authProviderMode] ?? [],
    requiredEvidence,
    currentEvidenceSummary: {
      evidenceStatus: readString(readinessSummary.evidenceStatus, "missing"),
      evidenceEnvironment: readString(readinessSummary.evidenceEnvironment, "missing"),
      authProviderMode,
      vercelEnvSyncStatus: readString(vercelEnvSyncEvidence.status, "missing"),
      releaseRunIdStatus: readString(vercelEnvSyncEvidence.releaseRunIdStatus, "missing"),
      trustedRouteChainStatus: readString(trustedRouteChainEvidence.status, "missing"),
      trustedRouteSmokeStatus: readString(trustedRouteSmokeEvidence.status, "missing"),
      trustedRouteSmokeDeploymentBinding: readString(trustedRouteSmokeEvidence.deploymentBinding, "missing"),
      trustedCookieRoundTripStatus: readString(trustedCookieRoundTrip.status, "missing"),
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
      cookieValuesOmitted: true,
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
    "# UAIS Teacher Auth Owner Action Packet",
    "",
    `Status: \`${packet.status}\``,
    `Release gate: \`${packet.releaseGateStatus}\``,
    `Queue rank: ${packet.queueRank ?? "not queued"}`,
    `Decision: \`${packet.decisionId}\``,
    "",
    "Do not inspect, print, or copy credential or cookie values.",
    "",
    "## Owner Decision",
    "",
    packet.nextOwnerQuestion,
    "",
    `Accepted options: ${formatInlineList(packet.acceptedOptions)}`,
    "",
    "## Required Server-Only Env Names",
    "",
    `Current mode: \`${packet.currentEvidenceSummary.authProviderMode}\``,
    "",
    ...packet.currentModeRequiredEnvNames.map((name) => `- \`${name}\``),
    "",
    "Trusted-cookie issuer mode:",
    "",
    ...packet.requiredEnvNamesByMode["trusted-cookie-issuer"].map((name) => `- \`${name}\``),
    "",
    "OIDC JWKS mode:",
    "",
    ...packet.requiredEnvNamesByMode["oidc-jwks"].map((name) => `- \`${name}\``),
    "",
    "## Current Evidence Summary",
    "",
    `- Evidence status: \`${packet.currentEvidenceSummary.evidenceStatus}\``,
    `- Environment: \`${packet.currentEvidenceSummary.evidenceEnvironment}\``,
    `- Provider mode: \`${packet.currentEvidenceSummary.authProviderMode}\``,
    `- Vercel env sync: \`${packet.currentEvidenceSummary.vercelEnvSyncStatus}\``,
    `- Release-run binding: \`${packet.currentEvidenceSummary.releaseRunIdStatus}\``,
    `- Trusted route-chain evidence: \`${packet.currentEvidenceSummary.trustedRouteChainStatus}\``,
    `- Trusted issuer route smoke: \`${packet.currentEvidenceSummary.trustedRouteSmokeStatus}\``,
    `- Route-smoke deployment binding: \`${packet.currentEvidenceSummary.trustedRouteSmokeDeploymentBinding}\``,
    `- Trusted-cookie round trip: \`${packet.currentEvidenceSummary.trustedCookieRoundTripStatus}\``,
    "",
    "## Required Evidence",
    "",
    ...packet.requiredEvidence.map((item) => `- \`${item}\``),
    "",
    "## Command Templates",
    "",
    `- Dry-run env sync: \`${packet.commands.vercelEnvSyncDryRun}\``,
    `- Approved env apply: \`${packet.commands.vercelEnvSyncApply}\``,
    `- Approved teacher-auth readiness: \`${packet.commands.teacherAuthReadinessLive}\``,
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
