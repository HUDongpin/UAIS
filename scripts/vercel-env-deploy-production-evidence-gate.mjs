#!/usr/bin/env node

import { readFileSync } from "node:fs";

const smokeEvidenceArgs = [
  "deployment-route-smoke",
  "teacher-workflow-deployment-smoke",
  "teacher-workflow-browser-smoke",
  "teacher-workflow-live-generation-smoke",
  "learning-ppt-playback-deployment-smoke",
  "teaching-operations-route-smoke",
  "teaching-operation-detail-browser-smoke",
  "teaching-course-management-route-smoke",
];

const provedEvidence = [
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const vercelEnvDeployPreflight = readJsonArg(args, "vercel-env-deploy-preflight");
  const externalStorageProductionEvidenceGate =
    typeof args["external-storage-production-evidence-gate"] === "string"
      ? readJsonArg(args, "external-storage-production-evidence-gate")
      : undefined;
  const vercelEnvSync =
    typeof args["vercel-env-sync"] === "string"
      ? readJsonArg(args, "vercel-env-sync")
      : undefined;
  const vercelProductionDeployment =
    typeof args["vercel-production-deployment"] === "string"
      ? readJsonArg(args, "vercel-production-deployment")
      : undefined;
  const deploymentReachability =
    typeof args["deployment-reachability"] === "string"
      ? readJsonArg(args, "deployment-reachability")
      : undefined;
  const deployedSmokes = Object.fromEntries(
    smokeEvidenceArgs.map((argName) => [
      argName,
      typeof args[argName] === "string" ? readJsonArg(args, argName) : undefined,
    ]),
  );
  const report = buildReport({
    vercelEnvDeployPreflight,
    externalStorageProductionEvidenceGate,
    vercelEnvSync,
    vercelProductionDeployment,
    deploymentReachability,
    deployedSmokes,
  });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(report));
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function buildReport({
  vercelEnvDeployPreflight,
  externalStorageProductionEvidenceGate,
  vercelEnvSync,
  vercelProductionDeployment,
  deploymentReachability,
  deployedSmokes,
}) {
  const approvedReleaseRunIdLabel = readString(
    vercelEnvDeployPreflight.approvedReleaseRunIdLabel,
    "",
  );
  const upstreamProviderEvidenceCleared =
    vercelEnvDeployPreflight.summary?.upstreamProviderEvidenceCleared === true;
  const upstreamProviderEvidenceRequired = !upstreamProviderEvidenceCleared;
  const preflightReady =
    readString(vercelEnvDeployPreflight.status, "") ===
      "vercel-env-deploy-production-evidence-preflight-ready" &&
    upstreamProviderEvidenceCleared;
  const liveChainStillForbidden =
    vercelEnvDeployPreflight.summary?.liveChainStillForbidden === true;
  const envSyncEvidenceStatus = evaluateEnvSyncEvidence({
    evidence: vercelEnvSync,
    approvedReleaseRunIdLabel,
  });
  const deploymentFingerprint = readDeploymentFingerprint(vercelProductionDeployment);
  const productionDeploymentEvidenceStatus = evaluateProductionDeploymentEvidence({
    evidence: vercelProductionDeployment,
    approvedReleaseRunIdLabel,
  });
  const deploymentReachabilityEvidenceStatus = evaluateDeploymentReachabilityEvidence({
    evidence: deploymentReachability,
    approvedReleaseRunIdLabel,
  });
  const deployedSmokeEvidenceStatuses = smokeEvidenceArgs.map((target) =>
    evaluateSmokeEvidence({
      target,
      evidence: deployedSmokes[target],
      approvedReleaseRunIdLabel,
      expectedDeploymentFingerprint: deploymentFingerprint,
    }),
  );
  const envSyncEvidenceAccepted = envSyncEvidenceStatus.status === "matched";
  const productionDeploymentEvidenceAccepted =
    productionDeploymentEvidenceStatus.status === "deployed";
  const deploymentReachabilityEvidenceAccepted =
    deploymentReachabilityEvidenceStatus.status === "reachable";
  const deployedSmokeEvidenceAcceptedCount = deployedSmokeEvidenceStatuses.filter(
    (status) => status.status === "live-passed",
  ).length;
  const deployedSmokeEvidenceProvidedCount = smokeEvidenceArgs.filter((target) =>
    isRecord(deployedSmokes[target]),
  ).length;
  const releaseRunBound =
    envSyncEvidenceStatus.releaseRunIdStatus === "matched" &&
    productionDeploymentEvidenceStatus.releaseRunIdStatus === "matched" &&
    deploymentReachabilityEvidenceStatus.releaseRunIdStatus === "matched" &&
    deployedSmokeEvidenceStatuses.every(
      (status) => status.releaseRunIdStatus === "matched",
    );
  const vercelEnvDeployProductionEvidenceCleared =
    preflightReady &&
    envSyncEvidenceAccepted &&
    productionDeploymentEvidenceAccepted &&
    deploymentReachabilityEvidenceAccepted &&
    deployedSmokeEvidenceAcceptedCount === smokeEvidenceArgs.length &&
    releaseRunBound &&
    liveChainStillForbidden;
  const status = readStatus({
    vercelEnvDeployProductionEvidenceCleared,
    preflightReady,
    envSyncEvidenceAccepted,
    productionDeploymentEvidenceAccepted,
    deploymentReachabilityEvidenceAccepted,
  });
  const upstreamBlockingEvidence = upstreamProviderEvidenceRequired
    ? {
        id: "upstream-provider-production-evidence",
        label: "app-auth-teacher-auth-external-storage-production-evidence",
        reason:
          "Vercel env/deploy production evidence must wait for app-auth, teacher-auth, and external-storage production evidence before S19/S22 run or accept Vercel env apply, deploy, or deployed smoke evidence.",
        valuesForbidden: true,
        upstreamStatus: readString(vercelEnvDeployPreflight.status, "unknown"),
        upstreamBlockedReasons: ["upstream-provider-production-evidence-not-cleared"],
        safeNextAction: readString(externalStorageProductionEvidenceGate?.safeNextAction, ""),
        upstreamOperatorInputRequired:
          externalStorageProductionEvidenceGate?.summary?.operatorInputRequired === true,
        upstreamMissingEvidence: readStringArray(
          externalStorageProductionEvidenceGate?.upstreamBlockingEvidence
            ?.upstreamMissingEvidence,
        ),
        upstreamOperatorInputPacket: readSafeOperatorInputPacket(
          externalStorageProductionEvidenceGate?.upstreamBlockingEvidence
            ?.upstreamOperatorInputPacket,
        ),
        upstreamSafeCommandTemplates: readSafeCommandTemplates(
          externalStorageProductionEvidenceGate?.upstreamBlockingEvidence
            ?.upstreamSafeCommandTemplates,
        ),
      }
    : null;
  const upstreamOperatorInputRequired =
    upstreamProviderEvidenceRequired &&
    upstreamBlockingEvidence?.upstreamOperatorInputRequired === true;

  return {
    target: "vercel-env-deploy-production-evidence-gate",
    status,
    releaseReady: false,
    responsibleSession: "S19/S22",
    approvedVercelProjectReadinessLabel: readString(
      vercelEnvDeployPreflight.approvedVercelProjectReadinessLabel,
      "",
    ),
    approvedServerOnlyEnvSourceLabel: readString(
      vercelEnvDeployPreflight.approvedServerOnlyEnvSourceLabel,
      "",
    ),
    approvedVercelEnvSyncApplyEvidenceLabel: readString(
      vercelEnvDeployPreflight.approvedVercelEnvSyncApplyEvidenceLabel,
      "",
    ),
    approvedProductionDeploymentEvidenceLabel: readString(
      vercelEnvDeployPreflight.approvedProductionDeploymentEvidenceLabel,
      "",
    ),
    approvedDeploymentBaseUrlLabel: readString(
      vercelEnvDeployPreflight.approvedDeploymentBaseUrlLabel,
      "",
    ),
    approvedReleaseRunIdLabel,
    summary: {
      ownerInputRequired: false,
      operatorInputRequired: upstreamOperatorInputRequired,
      blockingInputRequired: upstreamOperatorInputRequired,
      upstreamProviderEvidenceRequired,
      upstreamProviderEvidenceCleared,
      preflightReady,
      envSyncEvidenceProvided: vercelEnvSync !== undefined,
      envSyncEvidenceAccepted,
      productionDeploymentEvidenceProvided: vercelProductionDeployment !== undefined,
      productionDeploymentEvidenceAccepted,
      deploymentReachabilityEvidenceProvided: deploymentReachability !== undefined,
      deploymentReachabilityEvidenceAccepted,
      deployedSmokeEvidenceProvidedCount,
      deployedSmokeEvidenceAcceptedCount,
      releaseRunBound,
      vercelEnvDeployProductionEvidenceCleared,
      liveChainStillForbidden,
      releaseReady: false,
    },
    upstreamBlockingEvidence,
    envSyncEvidenceStatus,
    productionDeploymentEvidenceStatus,
    deploymentReachabilityEvidenceStatus,
    deployedSmokeEvidenceStatuses,
    provedEvidence: vercelEnvDeployProductionEvidenceCleared ? provedEvidence : [],
    blockedReasons: buildBlockedReasons({
      preflightReady,
      upstreamProviderEvidenceRequired,
      envSyncEvidenceStatus,
      productionDeploymentEvidenceStatus,
      deploymentReachabilityEvidenceStatus,
      deployedSmokeEvidenceStatuses,
      liveChainStillForbidden,
    }),
    safeNextAction: readSafeNextAction({
      vercelEnvDeployProductionEvidenceCleared,
      preflightReady,
      envSyncEvidenceAccepted,
      productionDeploymentEvidenceAccepted,
      deploymentReachabilityEvidenceAccepted,
      upstreamBlockingEvidence,
    }),
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      deploymentUrlsOmitted: true,
      credentialValuesOmitted: true,
      cookieValuesOmitted: true,
      responseBodiesOmitted: true,
      envFileRead: false,
      vercelApiCalled: false,
      providerNetworkCallPerformed: false,
      noRemoteWritePerformed: true,
      noEnvApplyPerformed: true,
      noDeploymentMutationPerformed: true,
      noLiveSmokePerformed: true,
      noReleaseRunBindingPerformed: true,
    },
  };
}

function readStatus({
  vercelEnvDeployProductionEvidenceCleared,
  preflightReady,
  envSyncEvidenceAccepted,
  productionDeploymentEvidenceAccepted,
  deploymentReachabilityEvidenceAccepted,
}) {
  if (vercelEnvDeployProductionEvidenceCleared) {
    return "vercel-env-deploy-production-evidence-gate-cleared";
  }
  if (!preflightReady) {
    return "vercel-env-deploy-production-evidence-gate-waiting-for-upstream-provider-evidence";
  }
  if (!envSyncEvidenceAccepted) {
    return "vercel-env-deploy-production-evidence-gate-awaiting-env-sync-evidence";
  }
  if (!productionDeploymentEvidenceAccepted || !deploymentReachabilityEvidenceAccepted) {
    return "vercel-env-deploy-production-evidence-gate-awaiting-production-deployment-evidence";
  }
  return "vercel-env-deploy-production-evidence-gate-awaiting-deployed-smoke-evidence";
}

function evaluateEnvSyncEvidence({ evidence, approvedReleaseRunIdLabel }) {
  if (evidence === undefined) {
    return {
      target: "missing",
      status: "missing",
      releaseRunIdStatus: "missing",
      valueRedacted: true,
    };
  }
  const base = {
    target: readString(evidence.target, "missing"),
    releaseRunIdStatus:
      evidence.releaseRunId === approvedReleaseRunIdLabel ? "matched" : "mismatched",
    valueRedacted: true,
  };
  if (base.target !== "vercel-env-sync") {
    return { ...base, status: "invalid-target" };
  }
  if (
    evidence.mode !== "apply" ||
    evidence.status !== "matched" ||
    evidence.projectReadinessEvidenceStatus !== "ready" ||
    evidence.applyPreflight !== "proved" ||
    evidence.requiredEnvStatus !== "present" ||
    evidence.valueRedacted !== true ||
    evidence.envValuesEmitted !== false ||
    !hasProductionAndPreviewTargets(evidence.targets)
  ) {
    return { ...base, status: "not-applied" };
  }
  if (evidence.releaseRunId !== approvedReleaseRunIdLabel) {
    return { ...base, status: "release-run-id-mismatch" };
  }
  return { ...base, status: "matched" };
}

function evaluateProductionDeploymentEvidence({ evidence, approvedReleaseRunIdLabel }) {
  if (evidence === undefined) {
    return {
      target: "missing",
      status: "missing",
      environment: "missing",
      releaseRunIdStatus: "missing",
      deploymentObservationStatus: "missing",
      valueRedacted: true,
    };
  }
  const base = {
    target: readString(evidence.target, "missing"),
    environment: readString(evidence.environment, "missing"),
    releaseRunIdStatus:
      evidence.releaseRunId === approvedReleaseRunIdLabel ? "matched" : "mismatched",
    deploymentObservationStatus: readString(evidence.deploymentObservationStatus, "missing"),
    valueRedacted: true,
  };
  if (base.target !== "vercel-production-deployment") {
    return { ...base, status: "invalid-target" };
  }
  if (
    evidence.mode !== "live" ||
    evidence.environment !== "production" ||
    evidence.status !== "deployed" ||
    evidence.deploymentObservationStatus !== "observed" ||
    evidence.deploymentUrlClass !== "remote-https" ||
    evidence.valueRedacted !== true ||
    evidence.deploymentUrlOmitted !== true ||
    evidence.responseBodiesOmitted !== true ||
    !hasDeploymentFingerprint(evidence)
  ) {
    return { ...base, status: "not-deployed" };
  }
  if (evidence.releaseRunId !== approvedReleaseRunIdLabel) {
    return { ...base, status: "release-run-id-mismatch" };
  }
  return { ...base, status: "deployed" };
}

function evaluateDeploymentReachabilityEvidence({ evidence, approvedReleaseRunIdLabel }) {
  if (evidence === undefined) {
    return {
      target: "missing",
      status: "missing",
      environment: "missing",
      releaseRunIdStatus: "missing",
      valueRedacted: true,
    };
  }
  const base = {
    target: readString(evidence.target, "missing"),
    environment: readString(evidence.environment, "missing"),
    releaseRunIdStatus:
      evidence.releaseRunId === approvedReleaseRunIdLabel ? "matched" : "mismatched",
    valueRedacted: true,
  };
  if (base.target !== "deployment-domain-reachability") {
    return { ...base, status: "invalid-target" };
  }
  if (
    evidence.mode !== "live" ||
    evidence.environment !== "production" ||
    evidence.status !== "reachable" ||
    evidence.deploymentUrlClass !== "remote-https" ||
    !hasMatchedDeploymentBinding(evidence.vercelProductionDeploymentEvidence) ||
    !hasReachabilitySafety(evidence.safety)
  ) {
    return { ...base, status: "not-reachable" };
  }
  if (evidence.releaseRunId !== approvedReleaseRunIdLabel) {
    return { ...base, status: "release-run-id-mismatch" };
  }
  return { ...base, status: "reachable" };
}

function evaluateSmokeEvidence({
  target,
  evidence,
  approvedReleaseRunIdLabel,
  expectedDeploymentFingerprint,
}) {
  if (evidence === undefined) {
    return {
      target,
      status: "missing",
      environment: "missing",
      releaseRunIdStatus: "missing",
      valueRedacted: true,
    };
  }
  const base = {
    target: readString(evidence.target, "missing"),
    environment: readString(evidence.environment, "missing"),
    releaseRunIdStatus:
      evidence.releaseRunId === approvedReleaseRunIdLabel ? "matched" : "mismatched",
    valueRedacted: true,
  };
  if (base.target !== target) {
    return { ...base, status: "invalid-target" };
  }
  if (
    evidence.mode !== "live" ||
    evidence.environment !== "production" ||
    evidence.status !== "passed" ||
    !hasMatchedDeploymentBinding(evidence.vercelProductionDeploymentEvidence) ||
    !hasMatchedReachabilityBinding(evidence.deploymentReachabilityEvidence) ||
    !hasSmokeSafety(evidence.safety)
  ) {
    return { ...base, status: "not-live-passed" };
  }
  if (evidence.releaseRunId !== approvedReleaseRunIdLabel) {
    return { ...base, status: "release-run-id-mismatch" };
  }
  if (
    expectedDeploymentFingerprint &&
    evidence.vercelProductionDeploymentEvidence?.deploymentFingerprint !==
      expectedDeploymentFingerprint
  ) {
    return { ...base, status: "deployment-fingerprint-mismatch" };
  }
  return { ...base, status: "live-passed" };
}

function buildBlockedReasons({
  preflightReady,
  upstreamProviderEvidenceRequired,
  envSyncEvidenceStatus,
  productionDeploymentEvidenceStatus,
  deploymentReachabilityEvidenceStatus,
  deployedSmokeEvidenceStatuses,
  liveChainStillForbidden,
}) {
  const reasons = [];
  if (upstreamProviderEvidenceRequired) {
    return ["upstream-provider-production-evidence-not-cleared"];
  }
  if (!preflightReady) {
    reasons.push("vercel-env-deploy-production-evidence-preflight-not-ready");
  }
  pushEvidenceReason({
    reasons,
    status: envSyncEvidenceStatus.status,
    missingReason: "vercel-env-sync-apply-production-and-preview-evidence-missing",
    invalidPrefix: "vercel-env-sync-apply-production-and-preview",
    acceptedStatus: "matched",
  });
  pushEvidenceReason({
    reasons,
    status: productionDeploymentEvidenceStatus.status,
    missingReason: "vercel-production-deployment-evidence-missing",
    invalidPrefix: "vercel-production-deployment-evidence",
    acceptedStatus: "deployed",
  });
  pushEvidenceReason({
    reasons,
    status: deploymentReachabilityEvidenceStatus.status,
    missingReason: "deployment-domain-reachability-evidence-missing",
    invalidPrefix: "deployment-domain-reachability-evidence",
    acceptedStatus: "reachable",
  });
  for (const smokeStatus of deployedSmokeEvidenceStatuses) {
    pushEvidenceReason({
      reasons,
      status: smokeStatus.status,
      missingReason: `${smokeStatus.target}-live-passed-missing`,
      invalidPrefix: `${smokeStatus.target}-live-passed`,
      acceptedStatus: "live-passed",
    });
  }
  if (!liveChainStillForbidden) {
    reasons.push("vercel-env-deploy-live-chain-separate-approval-not-preserved");
  }
  return reasons;
}

function pushEvidenceReason({ reasons, status, missingReason, invalidPrefix, acceptedStatus }) {
  if (status === acceptedStatus) {
    return;
  }
  if (status === "missing") {
    reasons.push(missingReason);
    return;
  }
  reasons.push(`${invalidPrefix}-${status}`);
}

function readSafeNextAction({
  vercelEnvDeployProductionEvidenceCleared,
  preflightReady,
  envSyncEvidenceAccepted,
  productionDeploymentEvidenceAccepted,
  deploymentReachabilityEvidenceAccepted,
  upstreamBlockingEvidence,
}) {
  if (vercelEnvDeployProductionEvidenceCleared) {
    return "advance-ordinary-teaching-and-manual-ppt-production-evidence-preflight";
  }
  if (!preflightReady) {
    return readString(
      upstreamBlockingEvidence?.safeNextAction,
      "wait-for-upstream-provider-production-evidence",
    );
  }
  if (!envSyncEvidenceAccepted) {
    return "produce-vercel-env-sync-apply-production-and-preview-evidence";
  }
  if (!productionDeploymentEvidenceAccepted || !deploymentReachabilityEvidenceAccepted) {
    return "produce-vercel-production-deployment-and-reachability-evidence";
  }
  return "produce-deployed-route-smoke-evidence";
}

function renderMarkdown(report) {
  const lines = [
    "# UAIS Vercel Env Deploy Production Evidence Gate",
    "",
    `Status: \`${report.status}\``,
    `Env source label: \`${report.approvedServerOnlyEnvSourceLabel}\``,
    `Vercel env-sync evidence label: \`${report.approvedVercelEnvSyncApplyEvidenceLabel}\``,
    `Production deployment evidence label: \`${report.approvedProductionDeploymentEvidenceLabel}\``,
    `Operator input required: \`${report.summary.operatorInputRequired}\``,
    `Safe next action: \`${report.safeNextAction}\``,
    `Upstream provider evidence required: \`${report.summary.upstreamProviderEvidenceRequired}\``,
    `Evidence cleared: \`${report.summary.vercelEnvDeployProductionEvidenceCleared}\``,
    `Release ready: \`${report.summary.releaseReady}\``,
    "",
    "## Evidence Status",
    "",
    `- Env sync: \`${report.envSyncEvidenceStatus.status}\``,
    `- Production deployment: \`${report.productionDeploymentEvidenceStatus.status}\``,
    `- Deployment reachability: \`${report.deploymentReachabilityEvidenceStatus.status}\``,
    `- Deployed smokes accepted: \`${report.summary.deployedSmokeEvidenceAcceptedCount}\``,
    "",
    "## Blocked Reasons",
    "",
    ...(report.blockedReasons.length > 0
      ? report.blockedReasons.map((reason) => `- \`${reason}\``)
      : ["- None"]),
  ];

  if (report.upstreamBlockingEvidence) {
    lines.push(
      "",
      "## Upstream Blocking Evidence",
      "",
      `- ID: \`${report.upstreamBlockingEvidence.id}\``,
      `- Label: \`${report.upstreamBlockingEvidence.label}\``,
      `- Values forbidden: \`${report.upstreamBlockingEvidence.valuesForbidden}\``,
      `- Upstream status: \`${report.upstreamBlockingEvidence.upstreamStatus}\``,
      `- Safe next action: \`${report.upstreamBlockingEvidence.safeNextAction}\``,
      "- Upstream blocked reasons:",
      ...report.upstreamBlockingEvidence.upstreamBlockedReasons.map(
        (reason) => `  - \`${reason}\``,
      ),
    );
    if (Object.keys(report.upstreamBlockingEvidence.upstreamOperatorInputPacket ?? {}).length > 0) {
      lines.push(
        "",
        "## Upstream Operator Input Packet",
        "",
        `- Status: \`${report.upstreamBlockingEvidence.upstreamOperatorInputPacket.status}\``,
        `- First required input: \`${report.upstreamBlockingEvidence.upstreamOperatorInputPacket.firstRequiredInputId}\``,
        `- Next safe action: \`${report.upstreamBlockingEvidence.upstreamOperatorInputPacket.nextSafeAction}\``,
        `- Next command template: \`${report.upstreamBlockingEvidence.upstreamOperatorInputPacket.nextSafeCommandTemplateKey}\``,
        `- Values forbidden: \`${report.upstreamBlockingEvidence.upstreamOperatorInputPacket.valuesForbidden}\``,
        `- Preferred input mode: \`${report.upstreamBlockingEvidence.upstreamOperatorInputPacket.preferredInputMode ?? "not-recorded"}\``,
        `- Safe input instruction: ${report.upstreamBlockingEvidence.upstreamOperatorInputPacket.safeInputInstruction ?? "not-recorded"}`,
        `- Approved source label is evidence: \`${report.upstreamBlockingEvidence.upstreamOperatorInputPacket.approvedSourceLabelIsNotEvidence === true ? "false" : "not-recorded"}\``,
      );
    }
    if (
      Object.keys(report.upstreamBlockingEvidence.upstreamSafeCommandTemplates ?? {}).length > 0
    ) {
      lines.push(
        "",
        "## Upstream Safe Operator Command Templates",
        "",
        ...Object.entries(report.upstreamBlockingEvidence.upstreamSafeCommandTemplates).map(
          ([name, command]) => `- \`${name}\`: \`${command}\``,
        ),
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

function hasProductionAndPreviewTargets(targets) {
  return Array.isArray(targets) && targets.includes("production") && targets.includes("preview");
}

function hasDeploymentFingerprint(evidence) {
  const fingerprint = evidence.deploymentFingerprint;
  return (
    isRecord(fingerprint) &&
    fingerprint.status === "present" &&
    typeof fingerprint.value === "string" &&
    fingerprint.value.length > 0 &&
    fingerprint.valueRedacted === true
  );
}

function readDeploymentFingerprint(evidence) {
  if (!isRecord(evidence) || !hasDeploymentFingerprint(evidence)) {
    return "";
  }
  return evidence.deploymentFingerprint.value;
}

function hasMatchedDeploymentBinding(evidence) {
  return (
    isRecord(evidence) &&
    evidence.target === "vercel-production-deployment" &&
    evidence.status === "matched" &&
    evidence.releaseRunIdStatus === "matched" &&
    evidence.deploymentFingerprintStatus === "matched" &&
    evidence.valueRedacted === true
  );
}

function hasMatchedReachabilityBinding(evidence) {
  return (
    isRecord(evidence) &&
    evidence.target === "deployment-domain-reachability" &&
    evidence.status === "matched" &&
    evidence.releaseRunIdStatus === "matched" &&
    evidence.valueRedacted === true
  );
}

function hasReachabilitySafety(safety) {
  return (
    isRecord(safety) &&
    safety.deploymentUrlOmitted === true &&
    safety.responseBodiesOmitted === true &&
    safety.secretsRedacted === true
  );
}

function hasSmokeSafety(safety) {
  return (
    isRecord(safety) &&
    safety.secretsRedacted === true &&
    safety.deploymentUrlOmitted === true &&
    safety.cookieValuesOmitted === true &&
    safety.responseBodiesOmitted === true &&
    safety.localPrivatePathsOmitted === true
  );
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function readJsonArg(args, key) {
  const path = args[key];
  if (typeof path !== "string" || path.length === 0) {
    throw new Error(`Missing required --${key}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function readStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function readSafeCommandTemplates(value) {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      ([name, command]) =>
        /^[A-Za-z0-9._:-]+$/.test(name) &&
        typeof command === "string" &&
        !/\/Users\/|https?:\/\/|(?:SECRET|TOKEN|KEY|PASSWORD|COOKIE|CREDENTIAL)\s*=/i.test(
          command,
        ),
    ),
  );
}

function readSafeOperatorInputPacket(value) {
  if (!isRecord(value)) {
    return {};
  }
  return {
    target: readString(value.target, ""),
    status: readString(value.status, ""),
    firstRequiredInputId: readString(value.firstRequiredInputId, ""),
    approvedServerOnlyEnvSourceLabel: readString(value.approvedServerOnlyEnvSourceLabel, ""),
    acceptedInputModes: readStringArray(value.acceptedInputModes),
    requiredServerOnlyEnvNames: readStringArray(value.requiredServerOnlyEnvNames),
    nextSafeAction: readString(value.nextSafeAction, ""),
    nextSafeCommandTemplateKey: readString(value.nextSafeCommandTemplateKey, ""),
    ...(readString(value.preferredInputMode, "").length > 0
      ? { preferredInputMode: readString(value.preferredInputMode, "") }
      : {}),
    ...(readString(value.safeInputInstruction, "").length > 0
      ? { safeInputInstruction: readString(value.safeInputInstruction, "") }
      : {}),
    ...(value.approvedSourceLabelIsNotEvidence === true
      ? { approvedSourceLabelIsNotEvidence: true }
      : {}),
    valuesForbidden: value.valuesForbidden === true,
  };
}

main();
