#!/usr/bin/env node

import { readFileSync } from "node:fs";

const decisionId = "vercel-env-deploy-and-smoke-chain";
const upstreamDecisionIds = [
  "app-auth-provider-production-selector",
  "teacher-auth-provider-production-selector",
  "external-storage-production-service",
];

const requiredEvidence = [
  "vercel-project-readiness-current",
  "vercel-env-sync-apply-production-and-preview",
  "vercel-production-deployment-evidence",
  "deployment-domain-reachability",
  "deployment-route-smoke-live-passed",
  "teacher-workflow-deployment-smoke-live-passed",
  "teacher-workflow-browser-smoke-live-passed",
  "teacher-workflow-live-generation-smoke-live-passed",
  "learning-ppt-playback-deployment-smoke-live-passed",
  "teaching-operations-route-smoke-live-passed",
  "teaching-operation-detail-browser-smoke-live-passed",
  "teaching-course-management-route-smoke-live-passed",
  "same-release-run-id-bound-to-env-deploy-and-smokes",
];

const commands = {
  vercelEnvSyncApply:
    "node scripts/vercel-env-sync.mjs --apply --approved --scope full --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <vercel-env-sync-evidence>",
  vercelProductionDeployment:
    "node scripts/vercel-production-deployment-evidence.mjs --live --approved --deploy --environment production --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --vercel-env-sync <vercel-env-sync-evidence> --release-run-id <release-run-id> > <vercel-production-deployment-evidence>",
  deploymentReachability:
    "node scripts/deployment-reachability-diagnostics.mjs --live --approved --environment production --base-url <deployment-url> --domain-reachability-evidence --release-run-id <release-run-id> > <deployment-domain-reachability-evidence>",
  deploymentRouteSmoke:
    "node scripts/ai-route-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <approved-env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> > <deployment-route-smoke-evidence>",
  teacherWorkflowDeploymentSmoke:
    "node scripts/teacher-workflow-deployment-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <approved-env-file> --cookie <approved-teacher-auth-cookie> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> > <teacher-workflow-deployment-smoke-evidence>",
  teacherWorkflowBrowserSmoke:
    "node scripts/teacher-workflow-browser-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <approved-env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> > <teacher-workflow-browser-smoke-evidence>",
  teacherWorkflowLiveGenerationSmoke:
    "node scripts/teacher-workflow-live-generation-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <approved-env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --external-storage-service-readiness <external-storage-service-readiness-evidence> > <teacher-workflow-live-generation-smoke-evidence>",
  learningPptPlaybackDeploymentSmoke:
    "node scripts/learning-ppt-playback-deployment-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <approved-env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> > <learning-ppt-playback-deployment-smoke-evidence>",
  ordinaryTeachingRouteSmoke:
    "node scripts/teaching-operations-route-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <approved-env-file> --teacher-id <approved-smoke-teacher-id> --course-id <approved-smoke-course-id> --cookie <approved-teacher-auth-cookie> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --external-storage-service-readiness <external-storage-service-readiness-evidence> --teaching-operations-backend external --teaching-course-management-backend external > <teaching-operations-route-smoke-evidence>",
  operationDetailBrowserSmoke:
    "node scripts/teaching-operation-detail-browser-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <approved-env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --api-mode live-teaching-operations > <teaching-operation-detail-browser-smoke-evidence>",
  teachingCourseManagementRouteSmoke:
    "node scripts/teaching-course-management-route-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <approved-env-file> --teacher-id <approved-smoke-teacher-id> --other-teacher-id <approved-other-teacher-id> --student-id <approved-student-id> --cookie <approved-teacher-auth-cookie> --other-teacher-cookie <approved-other-teacher-auth-cookie> --student-cookie <approved-student-auth-cookie> --release-run-id <release-run-id> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --external-storage-service-readiness <external-storage-service-readiness-evidence> --teacher-ai-ownership-backend external --course-management-backend external --course-assets-backend external --teaching-operations-backend external > <teaching-course-management-route-smoke-evidence>",
};

const stopConditions = [
  "Stop if app-auth, teacher-auth, or external-storage readiness is not live-ready.",
  "Stop if owner has not approved S19 Vercel env apply and S22 production deploy.",
  "Stop if Vercel env sync evidence is missing, mismatched, or not release-run-bound.",
  "Stop if production deployment evidence is missing or not bound to the release run.",
  "Stop if any live smoke would print deployment URLs, Vercel secrets, teacher-auth cookies, or response bodies.",
  "Stop if live provider-generation smoke would mutate a remote provider without explicit owner approval.",
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
  const decision = findDecision(ownerChecklist, decisionId);
  const queueItem = findQueueItem(ownerDecisionQueue);
  const vercelProjectSelection = findDecision(ownerChecklist, "vercel-project-selection", {
    status: "missing",
  });
  const upstreamDecisionStatuses = Object.fromEntries(
    upstreamDecisionIds.map((id) => [
      id,
      readString(findDecision(ownerChecklist, id, { status: "missing" }).status, "missing"),
    ]),
  );
  const blockedReasons = readStringArray(decision.blockedReasons);

  return {
    target: "vercel-env-deploy-chain-action-packet",
    status: readString(decision.status, "unknown"),
    releaseGateStatus: readString(ownerChecklist.releaseGateStatus, readString(ownerDecisionQueue.releaseGateStatus, "unknown")),
    responsibleSession: "S22",
    decisionId,
    queueRank: Number.isInteger(queueItem.rank) ? queueItem.rank : null,
    classification: "upstream-owner-decisions-env-deploy-smoke-blocked",
    sequencing: readString(queueItem.sequencing, readString(decision.sequencing, "project-readiness-before-env-apply-before-production-deploy-before-smokes")),
    nextOwnerQuestion: readString(
      queueItem.nextOwnerQuestion,
      "Approve S19 Vercel env sync/apply before production deploy and deployed smokes.",
    ),
    upstreamDecisionIds,
    upstreamDecisionStatuses,
    blockedReasons,
    safeNextActions: readStringArray(decision.safeNextActions),
    forbiddenUntilApproved: readStringArray(decision.forbiddenUntilApproved),
    currentEvidenceSummary: {
      chainStatus: readString(decision.status, "unknown"),
      vercelProjectSelectionStatus: readString(vercelProjectSelection.status, "missing"),
      blockedRequirementCount: blockedReasons.length,
      envApplyStatus: blockedReasons.includes("vercel-env-not-applied") ? "missing" : "unknown",
      productionDeploymentStatus: blockedReasons.includes("vercel-production-deployment-not-proven")
        ? "missing"
        : "unknown",
      deployedSmokeStatus: blockedReasons.some((reason) => reason.endsWith("-not-live-passed"))
        ? "missing"
        : "unknown",
      releaseRunBindingStatus: hasProductionReleaseRunRequirement(queueItem) ? "missing" : "not-required",
    },
    requiredEvidence,
    releaseGateRequirementIds: readStringArray(queueItem.releaseGateRequirementIds),
    enterpriseAuditMissingTargets: readStringArray(queueItem.enterpriseAuditMissingTargets),
    commands,
    stopConditions,
    safety: {
      sourcePathsOmitted: true,
      deploymentUrlsOmitted: true,
      envValuesOmitted: true,
      vercelSecretValuesOmitted: true,
      cookieValuesOmitted: true,
      responseBodiesOmitted: true,
      envApplyPerformed: false,
      deploymentMutationPerformed: false,
      liveSmokePerformed: false,
      providerMutationPerformed: false,
    },
  };
}

function findDecision(ownerChecklist, id, fallback) {
  const decisions = Array.isArray(ownerChecklist.decisions) ? ownerChecklist.decisions : [];
  const decision = decisions.find((item) => isRecord(item) && item.id === id);
  if (!decision && fallback) {
    return fallback;
  }
  if (!decision) {
    throw new Error(`Missing ${id} in owner checklist.`);
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

function hasProductionReleaseRunRequirement(queueItem) {
  return readStringArray(queueItem.releaseGateRequirementIds).includes(
    "production-release-run-consistency",
  );
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
    "# UAIS Vercel Env Deploy Chain Action Packet",
    "",
    `Status: \`${packet.status}\``,
    `Release gate: \`${packet.releaseGateStatus}\``,
    `Queue rank: ${packet.queueRank ?? "not queued"}`,
    `Decision: \`${packet.decisionId}\``,
    `Sequencing: \`${packet.sequencing}\``,
    "",
    "Do not run env apply, production deploy, or live smokes until upstream owner decisions are live-ready and approval is explicit.",
    "",
    "## Owner Question",
    "",
    packet.nextOwnerQuestion,
    "",
    "## Upstream Decisions",
    "",
    ...Object.entries(packet.upstreamDecisionStatuses).map(
      ([id, status]) => `- \`${id}\`: \`${status}\``,
    ),
    "",
    "## Current Evidence Summary",
    "",
    `- Chain status: \`${packet.currentEvidenceSummary.chainStatus}\``,
    `- Vercel project selection: \`${packet.currentEvidenceSummary.vercelProjectSelectionStatus}\``,
    `- Blocked requirement count: ${packet.currentEvidenceSummary.blockedRequirementCount}`,
    `- Env apply: \`${packet.currentEvidenceSummary.envApplyStatus}\``,
    `- Production deployment: \`${packet.currentEvidenceSummary.productionDeploymentStatus}\``,
    `- Deployed smokes: \`${packet.currentEvidenceSummary.deployedSmokeStatus}\``,
    `- Release-run binding: \`${packet.currentEvidenceSummary.releaseRunBindingStatus}\``,
    "",
    "## Required Evidence",
    "",
    ...packet.requiredEvidence.map((item) => `- \`${item}\``),
    "",
    "## Command Templates",
    "",
    `- Approved env apply: \`${packet.commands.vercelEnvSyncApply}\``,
    `- Approved production deploy: \`${packet.commands.vercelProductionDeployment}\``,
    `- Deployment reachability: \`${packet.commands.deploymentReachability}\``,
    `- Protected route smoke: \`${packet.commands.deploymentRouteSmoke}\``,
    `- Teacher page smoke: \`${packet.commands.teacherWorkflowDeploymentSmoke}\``,
    `- Teacher browser smoke: \`${packet.commands.teacherWorkflowBrowserSmoke}\``,
    `- Live generation smoke: \`${packet.commands.teacherWorkflowLiveGenerationSmoke}\``,
    `- Learning playback smoke: \`${packet.commands.learningPptPlaybackDeploymentSmoke}\``,
    `- Ordinary teaching route smoke: \`${packet.commands.ordinaryTeachingRouteSmoke}\``,
    `- Operation detail browser smoke: \`${packet.commands.operationDetailBrowserSmoke}\``,
    `- Course management route smoke: \`${packet.commands.teachingCourseManagementRouteSmoke}\``,
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
