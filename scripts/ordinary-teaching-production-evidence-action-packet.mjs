#!/usr/bin/env node

import { readFileSync } from "node:fs";

const decisionId = "ordinary-teaching-production-evidence";
const routeSmokeIds = {
  teachingOperations: "teaching-operations-route-smoke",
  operationDetail: "teaching-operation-detail-browser-smoke",
  courseManagement: "teaching-course-management-route-smoke",
};

const upstreamEvidenceIds = [
  "app-auth-provider-readiness",
  "teacher-auth-provider-readiness",
  "external-storage-service-readiness",
  "vercel-production-deployment",
  "deployment-domain-reachability",
];

const requiredEvidence = [
  "app-auth-provider-readiness-production-live-ready",
  "teacher-auth-provider-readiness-production-live-ready",
  "external-storage-service-readiness-production-live-ready",
  "vercel-production-deployment-evidence",
  "deployment-domain-reachability",
  "issued-teacher-auth-cookie-bound-to-ordinary-teaching-smokes",
  "live-teaching-operations-route-smoke",
  "live-teaching-operation-detail-browser-smoke",
  "live-teaching-course-management-route-smoke",
  "same-release-run-id-bound-to-ordinary-teaching-evidence",
  "same-vercel-production-deployment-bound-to-ordinary-teaching-smokes",
];

const commands = {
  teachingOperationsRouteSmoke:
    "node scripts/teaching-operations-route-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <approved-env-file> --teacher-id <approved-smoke-teacher-id> --course-id <approved-smoke-course-id> --cookie <approved-teacher-auth-cookie> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --external-storage-service-readiness <external-storage-service-readiness-evidence> --teaching-operations-backend external --teaching-course-management-backend external > <teaching-operations-route-smoke-evidence>",
  operationDetailBrowserSmoke:
    "node scripts/teaching-operation-detail-browser-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <approved-env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --api-mode live-teaching-operations > <teaching-operation-detail-browser-smoke-evidence>",
  teachingCourseManagementRouteSmoke:
    "node scripts/teaching-course-management-route-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <approved-env-file> --teacher-id <approved-smoke-teacher-id> --other-teacher-id <approved-other-teacher-id> --student-id <approved-student-id> --cookie <approved-teacher-auth-cookie> --other-teacher-cookie <approved-other-teacher-auth-cookie> --student-cookie <approved-student-auth-cookie> --release-run-id <release-run-id> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --external-storage-service-readiness <external-storage-service-readiness-evidence> --teacher-ai-ownership-backend external --course-management-backend external --course-assets-backend external --teaching-operations-backend external > <teaching-course-management-route-smoke-evidence>",
};

const stopConditions = [
  "Stop if auth, storage, deployment, or reachability evidence is missing or not release-run-bound.",
  "Stop if issued teacher-auth cookies or approved smoke ids are unavailable.",
  "Stop if owner has not approved live ordinary-teaching smokes and provider-backed side effects.",
  "Stop if local or dry-run smoke evidence is being treated as production live evidence.",
  "Stop if any command would print deployment URLs, teacher-auth cookies, backend secrets, env values, or response bodies.",
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
  const teachingOperations = findRequirement(releaseGate, routeSmokeIds.teachingOperations);
  const operationDetail = findRequirement(releaseGate, routeSmokeIds.operationDetail, {});
  const courseManagement = findRequirement(releaseGate, routeSmokeIds.courseManagement, {});
  const routeRequirements = [teachingOperations, operationDetail, courseManagement];

  return {
    target: "ordinary-teaching-production-evidence-action-packet",
    status: readString(decision.status, "unknown"),
    releaseGateStatus: readString(releaseGate.status, readString(ownerDecisionQueue.releaseGateStatus, "unknown")),
    responsibleSession: "S22",
    decisionId,
    queueRank: Number.isInteger(queueItem.rank) ? queueItem.rank : null,
    classification: "auth-storage-deployment-live-smokes-blocked",
    sequencing: readString(queueItem.sequencing, readString(decision.sequencing, "external-storage-and-auth-readiness-before-live-ordinary-teaching-smokes")),
    nextOwnerQuestion: readString(
      queueItem.nextOwnerQuestion,
      "Run ordinary-teaching live smokes only after auth, storage, and deployment evidence are ready.",
    ),
    upstreamEvidenceIds,
    blockedReasons: readStringArray(decision.blockedReasons),
    safeNextActions: readStringArray(decision.safeNextActions),
    forbiddenUntilApproved: readStringArray(decision.forbiddenUntilApproved),
    requiredEvidence,
    currentEvidenceSummary: {
      teachingOperationsRouteSmokeStatus: readString(teachingOperations.evidenceStatus, "missing"),
      operationDetailBrowserSmokeStatus: readString(operationDetail.evidenceStatus, "missing"),
      teachingCourseManagementRouteSmokeStatus: readString(courseManagement.evidenceStatus, "missing"),
      releaseRunIdStatus: summarizeSharedStatus(
        routeRequirements.map((requirement) => readString(requirement.releaseRunIdStatus, "missing")),
      ),
      teacherAuthBindingStatus: summarizeBindingStatus(routeRequirements, "teacherAuthProviderReadinessBinding"),
      appAuthBindingStatus: summarizeBindingStatus(routeRequirements, "appAuthProviderReadinessBinding"),
      externalStorageBindingStatus: summarizeBindingStatus(
        [teachingOperations, courseManagement],
        "externalStorageServiceReadinessEvidence",
      ),
      vercelDeploymentBindingStatus: summarizeBindingStatus(
        routeRequirements,
        "vercelProductionDeploymentBinding",
      ),
      deploymentOriginStatus: summarizeBindingStatus(routeRequirements, "deploymentOrigin"),
      operationDetailApiMode: readString(
        readNestedRecord(operationDetail, "apiInterceptionPolicy").operationApi,
        "missing",
      ),
      courseManagementBackend: readString(courseManagement.courseManagementBackend, "missing"),
      courseAssetsBackend: readString(courseManagement.courseAssetsBackend, "missing"),
      teachingOperationsBackend: readString(courseManagement.teachingOperationsBackend, "missing"),
      teacherAiOwnershipBackend: readString(courseManagement.teacherAiOwnershipBackend, "missing"),
    },
    releaseGateRequirementIds: readStringArray(queueItem.releaseGateRequirementIds),
    enterpriseAuditMissingTargets: readStringArray(queueItem.enterpriseAuditMissingTargets),
    commands,
    stopConditions,
    safety: {
      sourcePathsOmitted: true,
      deploymentUrlsOmitted: true,
      envValuesOmitted: true,
      cookieValuesOmitted: true,
      backendSecretValuesOmitted: true,
      responseBodiesOmitted: true,
      liveSmokePerformed: false,
      remoteMutationPerformed: false,
      providerSideEffectPerformed: false,
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

function findRequirement(releaseGate, id, fallback) {
  const requirements = Array.isArray(releaseGate.requirements) ? releaseGate.requirements : [];
  const requirement = requirements.find((item) => isRecord(item) && item.id === id);
  if (!requirement && fallback) {
    return fallback;
  }
  if (!requirement) {
    throw new Error(`Missing ${id} in release gate.`);
  }
  return requirement;
}

function summarizeBindingStatus(requirements, key) {
  return summarizeSharedStatus(
    requirements.map((requirement) => readString(readNestedRecord(requirement, key).status, "missing")),
  );
}

function summarizeSharedStatus(statuses) {
  const presentStatuses = statuses.filter((status) => status !== "missing");
  if (presentStatuses.length === 0) {
    return "missing";
  }
  const unique = [...new Set(statuses)];
  return unique.length === 1 ? unique[0] : "mixed";
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
    "# UAIS Ordinary Teaching Production Evidence Action Packet",
    "",
    `Status: \`${packet.status}\``,
    `Release gate: \`${packet.releaseGateStatus}\``,
    `Queue rank: ${packet.queueRank ?? "not queued"}`,
    `Decision: \`${packet.decisionId}\``,
    `Sequencing: \`${packet.sequencing}\``,
    "",
    "Do not run ordinary-teaching live smokes until auth, storage, deployment, and reachability evidence are release-run-bound.",
    "",
    "## Owner Question",
    "",
    packet.nextOwnerQuestion,
    "",
    "## Upstream Evidence",
    "",
    ...packet.upstreamEvidenceIds.map((item) => `- \`${item}\``),
    "",
    "## Current Evidence Summary",
    "",
    `- Teaching operations route smoke: \`${packet.currentEvidenceSummary.teachingOperationsRouteSmokeStatus}\``,
    `- Operation detail browser smoke: \`${packet.currentEvidenceSummary.operationDetailBrowserSmokeStatus}\``,
    `- Teaching course management route smoke: \`${packet.currentEvidenceSummary.teachingCourseManagementRouteSmokeStatus}\``,
    `- Release-run binding: \`${packet.currentEvidenceSummary.releaseRunIdStatus}\``,
    `- Teacher-auth binding: \`${packet.currentEvidenceSummary.teacherAuthBindingStatus}\``,
    `- App-auth binding: \`${packet.currentEvidenceSummary.appAuthBindingStatus}\``,
    `- External-storage binding: \`${packet.currentEvidenceSummary.externalStorageBindingStatus}\``,
    `- Vercel deployment binding: \`${packet.currentEvidenceSummary.vercelDeploymentBindingStatus}\``,
    `- Deployment origin: \`${packet.currentEvidenceSummary.deploymentOriginStatus}\``,
    `- Operation detail API mode: \`${packet.currentEvidenceSummary.operationDetailApiMode}\``,
    `- Course management backend: \`${packet.currentEvidenceSummary.courseManagementBackend}\``,
    "",
    "## Required Evidence",
    "",
    ...packet.requiredEvidence.map((item) => `- \`${item}\``),
    "",
    "## Command Templates",
    "",
    `- Teaching operations route smoke: \`${packet.commands.teachingOperationsRouteSmoke}\``,
    `- Operation detail browser smoke: \`${packet.commands.operationDetailBrowserSmoke}\``,
    `- Teaching course management route smoke: \`${packet.commands.teachingCourseManagementRouteSmoke}\``,
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

function readNestedRecord(value, key) {
  const nested = isRecord(value) ? value[key] : undefined;
  return isRecord(nested) ? nested : {};
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
