#!/usr/bin/env node

import { readFileSync } from "node:fs";

const decisionId = "external-storage-production-service";
const requiredServiceClass = "approved-remote-https-external-storage-service";
const requiredEnvNames = [
  "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
  "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND",
  "UAIS_TEACHING_OPERATIONS_BACKEND",
  "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
  "UAIS_TEACHING_COURSE_ASSETS_BACKEND",
  "UAIS_EXTERNAL_STORAGE_BASE_URL",
  "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
  "UAIS_EXTERNAL_STORAGE_SERVICE_MODE",
  "UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR",
  "UAIS_EXTERNAL_STORAGE_DATA_DIR",
  "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS",
  "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS",
  "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY",
  "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL",
];

const requiredEvidence = [
  "approved-remote-https-external-storage-service",
  "vercel-env-sync-evidence-with-external-storage-env-present",
  "external-storage-production-launch-contract",
  "external-storage-persistence-read-after-restart-proof",
  "external-storage-service-readiness-production-live-ready",
  "external-storage-smoke-live-passed",
  "same-release-run-id-bound-to-external-storage-readiness-and-smoke",
];

const commands = {
  vercelEnvSyncDryRun:
    "node scripts/vercel-env-sync.mjs --dry-run --scope external-storage --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <external-storage-vercel-env-sync-dry-run-evidence>",
  vercelEnvSyncApply:
    "node scripts/vercel-env-sync.mjs --apply --approved --scope external-storage --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <external-storage-vercel-env-sync-evidence>",
  externalStorageReadinessLive:
    "node scripts/external-storage-service-readiness.mjs --live --approved --environment production --env-file <approved-env-file> --release-run-id <release-run-id> --vercel-env-sync <external-storage-vercel-env-sync-evidence> --external-storage-production-launch-contract <external-storage-production-launch-contract-evidence> --external-storage-persistence <external-storage-persistence-evidence> > <external-storage-service-readiness-evidence>",
  externalStorageSmokeLive:
    "node scripts/external-storage-smoke.mjs --live --approved --environment production --env-file <approved-env-file> --teacher-id <approved-smoke-teacher-id> --release-run-id <release-run-id> --external-storage-service-readiness <external-storage-service-readiness-evidence> > <external-storage-smoke-evidence>",
};

const stopConditions = [
  "Stop if owner has not confirmed the approved remote HTTPS external-storage service and env source.",
  "Stop if approved env source is unavailable to S19.",
  "Stop if the external-storage endpoint is not remote HTTPS.",
  "Stop if Vercel env sync evidence is missing, mismatched, or not release-run-bound.",
  "Stop if production launch contract or persistence evidence is missing.",
  "Stop if live external-storage smoke would write to production without an approved smoke teacher id.",
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
  const containerBuildReadiness = isRecord(decision.containerBuildReadinessSummary)
    ? decision.containerBuildReadinessSummary
    : {};
  const serviceReadiness = isRecord(decision.externalStorageServiceReadinessSummary)
    ? decision.externalStorageServiceReadinessSummary
    : {};
  const health = isRecord(serviceReadiness.health) ? serviceReadiness.health : {};
  const teachingOperationsSchema = isRecord(health.teachingOperationsStorageSchema)
    ? health.teachingOperationsStorageSchema
    : {};
  const teachingCourseManagementSchema = isRecord(
    health.teachingCourseManagementStorageSchema,
  )
    ? health.teachingCourseManagementStorageSchema
    : {};
  const teachingCourseAssetsSchema = isRecord(health.teachingCourseAssetsStorageSchema)
    ? health.teachingCourseAssetsStorageSchema
    : {};
  const vercelEnvSyncEvidence = isRecord(serviceReadiness.vercelEnvSyncEvidence)
    ? serviceReadiness.vercelEnvSyncEvidence
    : {};

  return {
    target: "external-storage-owner-action-packet",
    status: readString(decision.status, "unknown"),
    releaseGateStatus: readString(ownerChecklist.releaseGateStatus, readString(ownerDecisionQueue.releaseGateStatus, "unknown")),
    responsibleSession: "S22",
    decisionId,
    queueRank: Number.isInteger(queueItem.rank) ? queueItem.rank : null,
    classification: "owner-env-service-live-smoke-blocked",
    ownerDecisionNeeded: readString(
      decision.ownerDecisionNeeded,
      "provision-approved-remote-https-external-storage-service-and-env",
    ),
    nextOwnerQuestion: readString(
      queueItem.nextOwnerQuestion,
      "Confirm the approved remote HTTPS external-storage service and server-only env source.",
    ),
    blockedReasons: readStringArray(decision.blockedReasons),
    safeNextActions: readStringArray(decision.safeNextActions),
    forbiddenUntilApproved: readStringArray(decision.forbiddenUntilApproved),
    requiredServiceClass,
    requiredEnvNames,
    requiredEvidence,
    currentEvidenceSummary: {
      containerBuildReadinessStatus: readString(
        containerBuildReadiness.currentStatus,
        readString(containerBuildReadiness.evidenceStatus, "missing"),
      ),
      localImageBuild: readString(containerBuildReadiness.localImageBuild, "missing"),
      externalStorageReadinessStatus: readString(serviceReadiness.evidenceStatus, "missing"),
      evidenceEnvironment: readString(serviceReadiness.evidenceEnvironment, "missing"),
      healthStatus: readString(health.status, "missing"),
      healthTarget: readString(health.target, "missing"),
      productionServiceIdentity: readString(health.productionServiceIdentity, "missing"),
      apiContractVersion: readString(health.apiContractVersion, "missing"),
      cacheControl: readString(health.cacheControl, "missing"),
      durableBackingStore: readString(health.durableBackingStore, "missing"),
      teachingOperationsSchemaStatus: readString(teachingOperationsSchema.status, "missing"),
      teachingCourseManagementSchemaStatus: readString(
        teachingCourseManagementSchema.status,
        "missing",
      ),
      teachingCourseAssetsSchemaStatus: readString(teachingCourseAssetsSchema.status, "missing"),
      vercelEnvSyncStatus: readString(vercelEnvSyncEvidence.status, "missing"),
    },
    releaseGateRequirementIds: readStringArray(queueItem.releaseGateRequirementIds),
    enterpriseAuditMissingTargets: readStringArray(queueItem.enterpriseAuditMissingTargets),
    commands,
    stopConditions,
    safety: {
      sourcePathsOmitted: true,
      endpointValuesOmitted: true,
      valuesRedacted: true,
      envValuesOmitted: true,
      liveMutationPerformed: false,
      deploymentMutationPerformed: false,
      remoteWritePerformed: false,
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
    "# UAIS External Storage Owner Action Packet",
    "",
    `Status: \`${packet.status}\``,
    `Release gate: \`${packet.releaseGateStatus}\``,
    `Queue rank: ${packet.queueRank ?? "not queued"}`,
    `Decision: \`${packet.decisionId}\``,
    "",
    "Do not inspect, print, or copy endpoint, credential, token, data-dir, or response-body values.",
    "",
    "## Owner Decision",
    "",
    packet.nextOwnerQuestion,
    "",
    `Required service class: \`${packet.requiredServiceClass}\``,
    "",
    "## Required Server-Only Env Names",
    "",
    ...packet.requiredEnvNames.map((name) => `- \`${name}\``),
    "",
    "## Current Evidence Summary",
    "",
    `- Container build readiness: \`${packet.currentEvidenceSummary.containerBuildReadinessStatus}\``,
    `- Local image build: \`${packet.currentEvidenceSummary.localImageBuild}\``,
    `- Service readiness: \`${packet.currentEvidenceSummary.externalStorageReadinessStatus}\``,
    `- Environment: \`${packet.currentEvidenceSummary.evidenceEnvironment}\``,
    `- Health status: \`${packet.currentEvidenceSummary.healthStatus}\``,
    `- Health target: \`${packet.currentEvidenceSummary.healthTarget}\``,
    `- Production service identity: \`${packet.currentEvidenceSummary.productionServiceIdentity}\``,
    `- API contract version: \`${packet.currentEvidenceSummary.apiContractVersion}\``,
    `- Cache control: \`${packet.currentEvidenceSummary.cacheControl}\``,
    `- Durable backing store: \`${packet.currentEvidenceSummary.durableBackingStore}\``,
    `- Teaching operations schema: \`${packet.currentEvidenceSummary.teachingOperationsSchemaStatus}\``,
    `- Teaching course management schema: \`${packet.currentEvidenceSummary.teachingCourseManagementSchemaStatus}\``,
    `- Teaching course assets schema: \`${packet.currentEvidenceSummary.teachingCourseAssetsSchemaStatus}\``,
    `- Vercel env sync: \`${packet.currentEvidenceSummary.vercelEnvSyncStatus}\``,
    "",
    "## Required Evidence",
    "",
    ...packet.requiredEvidence.map((item) => `- \`${item}\``),
    "",
    "## Command Templates",
    "",
    `- Dry-run env sync: \`${packet.commands.vercelEnvSyncDryRun}\``,
    `- Approved env apply: \`${packet.commands.vercelEnvSyncApply}\``,
    `- Approved service readiness: \`${packet.commands.externalStorageReadinessLive}\``,
    `- Approved live smoke: \`${packet.commands.externalStorageSmokeLive}\``,
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
