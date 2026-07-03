#!/usr/bin/env node

import { readFileSync } from "node:fs";

const decisionId = "vercel-env-deploy-and-smoke-chain";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const ownerResponseValidation = readJsonArg(args, "owner-response-validation");
  const approvalGate = readJsonArg(args, "approval-gate");
  const vercelEnvDeployActionPacket = readJsonArg(args, "vercel-env-deploy-action-packet");
  const appAuthPreflight = args["app-auth-preflight"]
    ? readJsonArg(args, "app-auth-preflight")
    : {};
  const teacherAuthPreflight = args["teacher-auth-preflight"]
    ? readJsonArg(args, "teacher-auth-preflight")
    : {};
  const externalStoragePreflight = args["external-storage-preflight"]
    ? readJsonArg(args, "external-storage-preflight")
    : {};
  const report = buildPreflight({
    ownerResponseValidation,
    approvalGate,
    vercelEnvDeployActionPacket,
    appAuthPreflight,
    teacherAuthPreflight,
    externalStoragePreflight,
  });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(report));
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function buildPreflight({
  ownerResponseValidation,
  approvalGate,
  vercelEnvDeployActionPacket,
  appAuthPreflight,
  teacherAuthPreflight,
  externalStoragePreflight,
}) {
  const ownerResponseAccepted =
    readString(ownerResponseValidation.status, "") === "owner-response-accepted";
  const stages = readRecordArray(approvalGate.stages);
  const vercelStage = stages.find((stage) => readString(stage.id, "") === decisionId) || {};
  const vercelStageAcceptedAwaitingEvidence =
    readString(vercelStage.queueStatus, "") === "accepted" &&
    readString(vercelStage.currentStatus, "") === "accepted-awaiting-production-evidence" &&
    vercelStage.ownerResponseAccepted === true;
  const upstreamProviderEvidenceCleared =
    providerEvidenceCleared(appAuthPreflight) &&
    providerEvidenceCleared(teacherAuthPreflight) &&
    providerEvidenceCleared(externalStoragePreflight);
  const allowedChecks = readStringArray(ownerResponseValidation.postValidationAllowedChecks);
  const s19EnvApplyPrepMayProceedAfterUpstreamReady =
    ownerResponseValidation.summary?.s19EnvApplyPrepMayProceed === true &&
    allowedChecks.includes(
      "prepare-s19-vercel-env-sync-apply-command-after-upstream-auth-storage-clears",
    );
  const s19EnvApplyRunApprovedAfterUpstreamReady =
    ownerResponseValidation.summary?.s19EnvApplyRunApproved === true;
  const s22DeployPrepMayProceedAfterEnvApplyEvidence =
    ownerResponseValidation.summary?.s22DeployPrepMayProceed === true &&
    allowedChecks.includes("prepare-s22-production-deployment-command-after-env-sync-evidence");
  const s22ProductionDeployRunApprovedAfterEnvApplyEvidence =
    ownerResponseValidation.summary?.s22ProductionDeployRunApproved === true;
  const deployedSmokePrepMayProceedAfterProductionDeploymentEvidence =
    ownerResponseValidation.summary?.deployedSmokePrepMayProceed === true &&
    allowedChecks.includes(
      "prepare-deployed-route-smoke-commands-after-production-deployment-evidence",
    );
  const deployedSmokeRunApprovedAfterProductionDeploymentEvidence =
    ownerResponseValidation.summary?.deployedSmokeRunApproved === true;
  const vercelLiveRunApproved =
    ownerResponseValidation.summary?.vercelLiveRunApproved === true;
  const liveChainStillForbidden =
    ownerResponseValidation.summary?.liveChainStillForbidden === true;
  const liveProviderGenerationSmokeRequiresSeparateApproval =
    ownerResponseValidation.summary?.liveProviderGenerationSmokeRequiresSeparateApproval === true;
  const requiredServerOnlyEnvNames = uniqueStrings(
    readStringArray(vercelStage.requiredServerOnlyEnvNames),
  );
  const requiredEvidence = uniqueStrings([
    ...readStringArray(vercelEnvDeployActionPacket.requiredEvidence),
    ...readStringArray(vercelStage.requiredEvidence),
  ]);
  const currentEvidenceSummary = isRecord(vercelEnvDeployActionPacket.currentEvidenceSummary)
    ? vercelEnvDeployActionPacket.currentEvidenceSummary
    : {};
  const provedPrerequisiteEvidence = requiredEvidence.filter((evidence) =>
    isEvidenceCurrentlyProved(evidence, currentEvidenceSummary),
  );
  const provedSet = new Set(provedPrerequisiteEvidence);
  const missingEvidence = requiredEvidence.filter((evidence) => !provedSet.has(evidence));
  const safeCommandTemplates = buildSafeCommandTemplates(vercelEnvDeployActionPacket);
  const blockedReasons = [
    ...(!ownerResponseAccepted ? ["vercel-env-deploy-owner-response-not-accepted"] : []),
    ...(!vercelStageAcceptedAwaitingEvidence
      ? ["vercel-env-deploy-stage-not-accepted-awaiting-production-evidence"]
      : []),
    ...(!upstreamProviderEvidenceCleared
      ? ["upstream-provider-production-evidence-not-cleared"]
      : []),
    ...(!s19EnvApplyPrepMayProceedAfterUpstreamReady
      ? ["s19-vercel-env-sync-apply-prep-not-authorized"]
      : []),
    ...(!s19EnvApplyRunApprovedAfterUpstreamReady
      ? ["s19-vercel-env-sync-apply-run-not-approved"]
      : []),
    ...(!s22DeployPrepMayProceedAfterEnvApplyEvidence
      ? ["s22-production-deploy-prep-not-authorized"]
      : []),
    ...(!s22ProductionDeployRunApprovedAfterEnvApplyEvidence
      ? ["s22-production-deploy-run-not-approved"]
      : []),
    ...(!deployedSmokePrepMayProceedAfterProductionDeploymentEvidence
      ? ["deployed-smoke-prep-not-authorized"]
      : []),
    ...(!deployedSmokeRunApprovedAfterProductionDeploymentEvidence
      ? ["deployed-smoke-run-not-approved"]
      : []),
    ...(!vercelLiveRunApproved ? ["vercel-live-run-not-approved"] : []),
    ...(!liveChainStillForbidden ? ["live-chain-separate-approval-not-confirmed"] : []),
    ...(!liveProviderGenerationSmokeRequiresSeparateApproval
      ? ["live-provider-generation-smoke-separate-approval-not-confirmed"]
      : []),
    ...missingEvidence.map((evidence) => `${evidence}-missing`),
  ];
  const status =
    ownerResponseAccepted &&
    vercelStageAcceptedAwaitingEvidence &&
    s19EnvApplyPrepMayProceedAfterUpstreamReady &&
    s19EnvApplyRunApprovedAfterUpstreamReady &&
    s22DeployPrepMayProceedAfterEnvApplyEvidence &&
    s22ProductionDeployRunApprovedAfterEnvApplyEvidence &&
    deployedSmokePrepMayProceedAfterProductionDeploymentEvidence &&
    deployedSmokeRunApprovedAfterProductionDeploymentEvidence &&
    vercelLiveRunApproved &&
    liveChainStillForbidden &&
    liveProviderGenerationSmokeRequiresSeparateApproval
      ? upstreamProviderEvidenceCleared
        ? "vercel-env-deploy-production-evidence-preflight-ready"
        : "vercel-env-deploy-production-evidence-preflight-waiting-for-upstream-provider-evidence"
      : "vercel-env-deploy-production-evidence-preflight-blocked";

  return {
    target: "vercel-env-deploy-production-evidence-preflight",
    status,
    releaseReady: false,
    responsibleSession: "S19/S22",
    ownerDecisionId: decisionId,
    approvedVercelProjectReadinessLabel: readString(
      ownerResponseValidation.redactedOwnerResponse?.approvedVercelProjectReadinessLabel,
      "none-recorded",
    ),
    approvedServerOnlyEnvSourceLabel: readString(
      ownerResponseValidation.redactedOwnerResponse?.approvedServerOnlyEnvSourceLabel,
      "none-recorded",
    ),
    approvedVercelEnvSyncApplyEvidenceLabel: readString(
      ownerResponseValidation.redactedOwnerResponse?.approvedVercelEnvSyncApplyEvidenceLabel,
      "none-recorded",
    ),
    approvedProductionDeploymentEvidenceLabel: readString(
      ownerResponseValidation.redactedOwnerResponse?.approvedProductionDeploymentEvidenceLabel,
      "none-recorded",
    ),
    approvedDeploymentBaseUrlLabel: readString(
      ownerResponseValidation.redactedOwnerResponse?.approvedDeploymentBaseUrlLabel,
      "none-recorded",
    ),
    approvedReleaseRunIdLabel: readString(
      ownerResponseValidation.redactedOwnerResponse?.approvedReleaseRunIdLabel,
      "none-recorded",
    ),
    summary: {
      ownerResponseAccepted,
      vercelStageAcceptedAwaitingEvidence,
      upstreamProviderEvidenceCleared,
      s19EnvApplyPrepMayProceedAfterUpstreamReady,
      s19EnvApplyRunApprovedAfterUpstreamReady,
      s22DeployPrepMayProceedAfterEnvApplyEvidence,
      s22ProductionDeployRunApprovedAfterEnvApplyEvidence,
      deployedSmokePrepMayProceedAfterProductionDeploymentEvidence,
      deployedSmokeRunApprovedAfterProductionDeploymentEvidence,
      vercelLiveRunApproved,
      liveChainStillForbidden,
      liveProviderGenerationSmokeRequiresSeparateApproval,
      requiredServerOnlyEnvNameCount: requiredServerOnlyEnvNames.length,
      requiredEvidenceCount: requiredEvidence.length,
      missingEvidenceCount: missingEvidence.length,
      commandTemplateCount: Object.keys(safeCommandTemplates).length,
      releaseReady: false,
    },
    upstreamBlockers: upstreamProviderEvidenceCleared
      ? []
      : [
          "app-auth-production-evidence-missing",
          "teacher-auth-production-evidence-missing",
          "external-storage-production-evidence-missing",
        ],
    requiredServerOnlyEnvNames,
    requiredEvidence,
    provedPrerequisiteEvidence,
    missingEvidence,
    blockedReasons,
    safeCommandTemplates,
    safeNextActions: uniqueStrings(
      readStringArray(vercelEnvDeployActionPacket.safeNextActions),
    ),
    forbiddenUntilEvidenceExists: buildForbiddenUntilEvidenceExists({
      ownerResponseValidation,
      vercelEnvDeployActionPacket,
      vercelLiveRunApproved,
    }),
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmittedFromMarkdown: true,
      deploymentUrlsOmitted: true,
      credentialValuesOmitted: true,
      responseBodiesOmitted: true,
      commandBodiesRedactedToTemplates: true,
      envFileRead: false,
      vercelApiCalled: false,
      noRemoteWritePerformed: true,
      noLiveMutationPerformed: true,
      noDeploymentMutationPerformed: true,
      noEnvApplyPerformed: true,
      noReleaseRunBindingPerformed: true,
    },
  };
}

function buildForbiddenUntilEvidenceExists({
  ownerResponseValidation,
  vercelEnvDeployActionPacket,
  vercelLiveRunApproved,
}) {
  const rawForbiddenActions = uniqueStrings([
    ...readStringArray(ownerResponseValidation.stillForbiddenUntilSeparateApproval),
    ...readStringArray(vercelEnvDeployActionPacket.forbiddenUntilApproved),
  ]);
  const normalizedActions = rawForbiddenActions.flatMap((action) => {
    if (!vercelLiveRunApproved) {
      return [action];
    }
    if (action === "run-vercel-env-apply-without-owner-approval") {
      return ["run-vercel-env-apply-before-upstream-auth-storage-clears"];
    }
    if (action === "run-vercel-production-deploy-without-owner-approval") {
      return ["run-vercel-production-deploy-before-env-apply-evidence"];
    }
    return [action];
  });
  return uniqueStrings(normalizedActions);
}

function providerEvidenceCleared(preflight) {
  return (
    readString(preflight.status, "").includes("ready") &&
    preflight.releaseReady === true &&
    preflight.summary?.missingEvidenceCount === 0
  );
}

function isEvidenceCurrentlyProved(evidence, currentEvidenceSummary) {
  if (evidence === "vercel-project-readiness-current") {
    return isReadyEvidenceStatus(currentEvidenceSummary.vercelProjectSelectionStatus);
  }

  if (evidence === "vercel-env-sync-apply-production-and-preview") {
    return isReadyEvidenceStatus(currentEvidenceSummary.envApplyStatus);
  }

  if (evidence === "vercel-production-deployment-evidence") {
    return isReadyEvidenceStatus(currentEvidenceSummary.productionDeploymentStatus);
  }

  if (evidence === "deployment-domain-reachability") {
    return isReadyEvidenceStatus(currentEvidenceSummary.deploymentReachabilityStatus);
  }

  if (evidence === "same-release-run-id-bound-to-env-deploy-and-smokes") {
    return isReadyEvidenceStatus(currentEvidenceSummary.releaseRunBindingStatus);
  }

  return false;
}

function buildSafeCommandTemplates(vercelEnvDeployActionPacket) {
  const commands = isRecord(vercelEnvDeployActionPacket.commands)
    ? vercelEnvDeployActionPacket.commands
    : {};
  return {
    vercelEnvSyncApply:
      typeof commands.vercelEnvSyncApply === "string"
        ? commands.vercelEnvSyncApply
        : "node scripts/vercel-env-sync.mjs --apply --approved --scope full --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <vercel-env-sync-evidence>",
    vercelProductionDeployment:
      typeof commands.vercelProductionDeployment === "string"
        ? commands.vercelProductionDeployment
        : "node scripts/vercel-production-deployment-evidence.mjs --live --approved --deploy --environment production --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --vercel-env-sync <vercel-env-sync-evidence> --release-run-id <release-run-id> > <vercel-production-deployment-evidence>",
    deploymentReachability:
      typeof commands.deploymentReachability === "string"
        ? commands.deploymentReachability
        : "node scripts/deployment-reachability-diagnostics.mjs --live --approved --environment production --base-url <deployment-url> --domain-reachability-evidence --release-run-id <release-run-id> > <deployment-domain-reachability-evidence>",
    deploymentRouteSmoke:
      typeof commands.deploymentRouteSmoke === "string"
        ? commands.deploymentRouteSmoke
        : "node scripts/ai-route-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <approved-env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> > <deployment-route-smoke-evidence>",
    teacherWorkflowDeploymentSmoke:
      typeof commands.teacherWorkflowDeploymentSmoke === "string"
        ? commands.teacherWorkflowDeploymentSmoke
        : "node scripts/teacher-workflow-deployment-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <approved-env-file> --cookie <approved-teacher-auth-cookie> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> > <teacher-workflow-deployment-smoke-evidence>",
    teacherWorkflowBrowserSmoke:
      typeof commands.teacherWorkflowBrowserSmoke === "string"
        ? commands.teacherWorkflowBrowserSmoke
        : "node scripts/teacher-workflow-browser-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <approved-env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> > <teacher-workflow-browser-smoke-evidence>",
    teacherWorkflowLiveGenerationSmoke:
      typeof commands.teacherWorkflowLiveGenerationSmoke === "string"
        ? commands.teacherWorkflowLiveGenerationSmoke
        : "node scripts/teacher-workflow-live-generation-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <approved-env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --external-storage-service-readiness <external-storage-service-readiness-evidence> > <teacher-workflow-live-generation-smoke-evidence>",
    learningPptPlaybackDeploymentSmoke:
      typeof commands.learningPptPlaybackDeploymentSmoke === "string"
        ? commands.learningPptPlaybackDeploymentSmoke
        : "node scripts/learning-ppt-playback-deployment-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <approved-env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> > <learning-ppt-playback-deployment-smoke-evidence>",
    ordinaryTeachingRouteSmoke:
      typeof commands.ordinaryTeachingRouteSmoke === "string"
        ? commands.ordinaryTeachingRouteSmoke
        : "node scripts/teaching-operations-route-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <approved-env-file> --teacher-id <approved-smoke-teacher-id> --course-id <approved-smoke-course-id> --cookie <approved-teacher-auth-cookie> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --external-storage-service-readiness <external-storage-service-readiness-evidence> --teaching-operations-backend external --teaching-course-management-backend external > <teaching-operations-route-smoke-evidence>",
    operationDetailBrowserSmoke:
      typeof commands.operationDetailBrowserSmoke === "string"
        ? commands.operationDetailBrowserSmoke
        : "node scripts/teaching-operation-detail-browser-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <approved-env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --api-mode live-teaching-operations > <teaching-operation-detail-browser-smoke-evidence>",
    teachingCourseManagementRouteSmoke:
      typeof commands.teachingCourseManagementRouteSmoke === "string"
        ? commands.teachingCourseManagementRouteSmoke
        : "node scripts/teaching-course-management-route-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <approved-env-file> --teacher-id <approved-smoke-teacher-id> --other-teacher-id <approved-other-teacher-id> --student-id <approved-student-id> --cookie <approved-teacher-auth-cookie> --other-teacher-cookie <approved-other-teacher-auth-cookie> --student-cookie <approved-student-auth-cookie> --release-run-id <release-run-id> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --external-storage-service-readiness <external-storage-service-readiness-evidence> --teacher-ai-ownership-backend external --course-management-backend external --course-assets-backend external --teaching-operations-backend external > <teaching-course-management-route-smoke-evidence>",
  };
}

function renderMarkdown(report) {
  const lines = [
    "# UAIS Vercel Env Deploy Production Evidence Preflight",
    "",
    `Status: \`${report.status}\``,
    `Release ready: \`${report.releaseReady}\``,
    `Owner decision: \`${report.ownerDecisionId}\``,
    `Upstream provider evidence cleared: \`${report.summary.upstreamProviderEvidenceCleared}\``,
    `S19 env apply prep may proceed after upstream ready: \`${report.summary.s19EnvApplyPrepMayProceedAfterUpstreamReady}\``,
    `S19 env apply run approved after upstream ready: \`${report.summary.s19EnvApplyRunApprovedAfterUpstreamReady}\``,
    `S22 deploy prep may proceed after env apply evidence: \`${report.summary.s22DeployPrepMayProceedAfterEnvApplyEvidence}\``,
    `S22 production deploy run approved after env apply evidence: \`${report.summary.s22ProductionDeployRunApprovedAfterEnvApplyEvidence}\``,
    `Deployed smoke prep may proceed after production deployment evidence: \`${report.summary.deployedSmokePrepMayProceedAfterProductionDeploymentEvidence}\``,
    `Deployed smoke run approved after production deployment evidence: \`${report.summary.deployedSmokeRunApprovedAfterProductionDeploymentEvidence}\``,
    `Vercel live run approved: \`${report.summary.vercelLiveRunApproved}\``,
    `Live chain still forbidden: \`${report.summary.liveChainStillForbidden}\``,
    `Live provider generation smoke requires separate approval: \`${report.summary.liveProviderGenerationSmokeRequiresSeparateApproval}\``,
    `Missing evidence: ${report.summary.missingEvidenceCount}`,
    "",
    "This preflight reads only existing redacted coordination reports. It does not read env files, print labels, call Vercel, apply env, deploy, run live smokes, call provider endpoints, or bind a release run.",
    "",
    "## Required Server-Only Env Names",
    "",
    ...formatBullets(report.requiredServerOnlyEnvNames),
    "",
    "## Proved Prerequisite Evidence",
    "",
    ...formatBullets(report.provedPrerequisiteEvidence),
    "",
    "## Missing Evidence",
    "",
    ...formatBullets(report.missingEvidence),
    "",
    "## Safe Command Templates",
    "",
    "```sh",
    ...Object.values(report.safeCommandTemplates),
    "```",
  ];

  if (report.upstreamBlockers.length > 0) {
    lines.push("", "## Upstream Blockers", "");
    lines.push(...formatBullets(report.upstreamBlockers));
  }

  if (report.blockedReasons.length > 0) {
    lines.push("", "## Blocked Reasons", "");
    lines.push(...formatBullets(report.blockedReasons));
  }

  if (report.forbiddenUntilEvidenceExists.length > 0) {
    lines.push("", "## Still Forbidden", "");
    lines.push(...formatBullets(report.forbiddenUntilEvidenceExists));
  }

  return `${lines.join("\n")}\n`;
}

function isReadyEvidenceStatus(value) {
  return ["satisfied", "ready", "proven", "passed", "applied", "bound", "live-ready"].includes(
    readString(value, "missing"),
  );
}

function formatBullets(values) {
  return values.length > 0 ? values.map((value) => `- \`${value}\``) : ["- `none-recorded`"];
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

function readString(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function readStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function readRecordArray(value) {
  return Array.isArray(value) ? value.filter((item) => isRecord(item)) : [];
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
