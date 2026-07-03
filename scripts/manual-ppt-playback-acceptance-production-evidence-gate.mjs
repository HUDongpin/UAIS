#!/usr/bin/env node

import { readFileSync } from "node:fs";

const requiredApplications = ["Microsoft PowerPoint", "WPS Presentation"];
const provedEvidence = [
  "human-powerpoint-playback-accepted",
  "human-wps-playback-accepted",
  "explicit-accepted-after-human-playback-status",
  "valid-tested-at-timestamp",
  "all-19-slide-audio-checks-true",
  "target-cloned-voice-label-present",
  "target-cloned-voice-heard-per-slide",
  "same-release-run-id-bound-to-manual-record",
  "same-vercel-production-deployment-bound-to-manual-playback-record",
];

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manualPptPreflight = readJsonArg(args, "manual-ppt-preflight");
  const vercelEnvDeployProductionEvidenceGate =
    typeof args["vercel-env-deploy-production-evidence-gate"] === "string"
      ? readJsonArg(args, "vercel-env-deploy-production-evidence-gate")
      : undefined;
  const manualPptRecord =
    typeof args["manual-ppt-record"] === "string"
      ? readJsonArg(args, "manual-ppt-record")
      : undefined;
  const vercelProductionDeployment =
    typeof args["vercel-production-deployment"] === "string"
      ? readJsonArg(args, "vercel-production-deployment")
      : undefined;
  const report = buildReport({
    manualPptPreflight,
    vercelEnvDeployProductionEvidenceGate,
    manualPptRecord,
    vercelProductionDeployment,
  });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(report));
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function buildReport({
  manualPptPreflight,
  vercelEnvDeployProductionEvidenceGate,
  manualPptRecord,
  vercelProductionDeployment,
}) {
  const approvedReleaseRunIdLabel = readString(
    manualPptPreflight.approvedReleaseRunIdLabel,
    "",
  );
  const ownerResponseAccepted = manualPptPreflight.summary?.ownerResponseAccepted === true;
  const ownerConfirmedHumanPlaybackEvidence =
    manualPptPreflight.summary?.ownerConfirmedHumanPlaybackEvidence === true;
  const releaseRunBindingStillForbidden =
    manualPptPreflight.summary?.releaseRunBindingStillForbidden === true;
  const preflightReady =
    readString(manualPptPreflight.status, "") ===
      "manual-ppt-playback-acceptance-production-evidence-preflight-ready" &&
    ownerResponseAccepted &&
    ownerConfirmedHumanPlaybackEvidence &&
    manualPptPreflight.summary?.vercelProductionDeploymentEvidenceCleared === true &&
    !releaseRunBindingStillForbidden;
  const expectedDeploymentFingerprint = readDeploymentFingerprint(vercelProductionDeployment);
  const manualRecordStatus = evaluateManualRecord({
    evidence: manualPptRecord,
    approvedReleaseRunIdLabel,
    expectedDeploymentFingerprint,
  });
  const productionDeploymentEvidenceStatus = evaluateVercelProductionDeployment({
    evidence: vercelProductionDeployment,
    approvedReleaseRunIdLabel,
  });
  const manualRecordAccepted = manualRecordStatus.status === "accepted";
  const productionDeploymentEvidenceAccepted =
    productionDeploymentEvidenceStatus.status === "deployed";
  const releaseRunBound =
    manualRecordStatus.releaseRunIdStatus === "matched" &&
    productionDeploymentEvidenceStatus.releaseRunIdStatus === "matched";
  const deploymentBound =
    manualRecordStatus.deploymentFingerprintStatus === "matched" &&
    productionDeploymentEvidenceAccepted;
  const manualPptPlaybackAcceptanceEvidenceCleared =
    preflightReady &&
    manualRecordAccepted &&
    productionDeploymentEvidenceAccepted &&
    releaseRunBound &&
    deploymentBound;
  const upstreamDeploymentEvidenceRequired =
    !manualPptPlaybackAcceptanceEvidenceCleared && !preflightReady;
  const upstreamOperatorInputRequired =
    upstreamDeploymentEvidenceRequired &&
    vercelEnvDeployProductionEvidenceGate?.summary?.operatorInputRequired === true;
  const upstreamBlockingEvidence = upstreamDeploymentEvidenceRequired
    ? {
        id: "upstream-vercel-env-deploy-production-evidence-gate",
        label: "vercel-env-deploy-production-evidence-gate",
        reason:
          "Manual PPT playback acceptance evidence must wait for Vercel production deployment evidence before the completed human record can be release-run bound.",
        valuesForbidden: true,
        upstreamStatus: readString(vercelEnvDeployProductionEvidenceGate?.status, "unknown"),
        safeNextAction: readString(vercelEnvDeployProductionEvidenceGate?.safeNextAction, ""),
        upstreamOperatorInputRequired,
        upstreamMissingEvidence: readStringArray(
          vercelEnvDeployProductionEvidenceGate?.upstreamBlockingEvidence
            ?.upstreamMissingEvidence,
        ),
        upstreamOperatorInputPacket: readSafeOperatorInputPacket(
          vercelEnvDeployProductionEvidenceGate?.upstreamBlockingEvidence
            ?.upstreamOperatorInputPacket,
        ),
        upstreamSafeCommandTemplates: readSafeCommandTemplates(
          vercelEnvDeployProductionEvidenceGate?.upstreamBlockingEvidence
            ?.upstreamSafeCommandTemplates,
        ),
      }
    : null;
  const status = readStatus({
    manualPptPlaybackAcceptanceEvidenceCleared,
    preflightReady,
    manualRecordAccepted,
    productionDeploymentEvidenceAccepted,
  });

  return {
    target: "manual-ppt-playback-acceptance-production-evidence-gate",
    status,
    releaseReady: false,
    responsibleSession: "S24/S22/S10",
    approvedPowerPointPlaybackEvidenceLabel: readString(
      manualPptPreflight.approvedPowerPointPlaybackEvidenceLabel,
      "",
    ),
    approvedWpsPlaybackEvidenceLabel: readString(
      manualPptPreflight.approvedWpsPlaybackEvidenceLabel,
      "",
    ),
    approvedManualAcceptanceRecordLabel: readString(
      manualPptPreflight.approvedManualAcceptanceRecordLabel,
      "",
    ),
    approvedReleaseRunIdLabel,
    approvedVercelProductionDeploymentEvidenceLabel: readString(
      manualPptPreflight.approvedVercelProductionDeploymentEvidenceLabel,
      "",
    ),
    summary: {
      operatorInputRequired: upstreamOperatorInputRequired,
      blockingInputRequired: upstreamOperatorInputRequired,
      ownerResponseAccepted,
      ownerConfirmedHumanPlaybackEvidence,
      preflightReady,
      manualRecordProvided: manualPptRecord !== undefined,
      manualRecordAccepted,
      productionDeploymentEvidenceProvided: vercelProductionDeployment !== undefined,
      productionDeploymentEvidenceAccepted,
      releaseRunBound,
      deploymentBound,
      manualPptPlaybackAcceptanceEvidenceCleared,
      releaseRunBindingStillForbidden,
      releaseReady: false,
    },
    manualRecordStatus,
    productionDeploymentEvidenceStatus,
    upstreamBlockingEvidence,
    provedEvidence: manualPptPlaybackAcceptanceEvidenceCleared ? provedEvidence : [],
    blockedReasons: buildBlockedReasons({
      preflightReady,
      manualPptPreflight,
      manualRecordStatus,
      productionDeploymentEvidenceStatus,
      releaseRunBindingStillForbidden,
      releaseRunBound,
      deploymentBound,
    }),
    safeNextAction: readSafeNextAction({
      manualPptPlaybackAcceptanceEvidenceCleared,
      preflightReady,
      manualRecordAccepted,
      productionDeploymentEvidenceAccepted,
      upstreamBlockingEvidence,
    }),
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      deploymentUrlsOmitted: true,
      packagePathsOmitted: true,
      audioUrlsOmitted: true,
      credentialValuesOmitted: true,
      responseBodiesOmitted: true,
      envFileRead: false,
      manualAcceptancePerformed: false,
      machineEvidenceDoesNotCountAsAcceptance: true,
      humanPlaybackRequired: true,
      noLiveMutationPerformed: true,
      noDeploymentMutationPerformed: true,
      noReleaseRunBindingPerformed: true,
    },
  };
}

function readStatus({
  manualPptPlaybackAcceptanceEvidenceCleared,
  preflightReady,
  manualRecordAccepted,
  productionDeploymentEvidenceAccepted,
}) {
  if (manualPptPlaybackAcceptanceEvidenceCleared) {
    return "manual-ppt-playback-acceptance-production-evidence-gate-cleared";
  }
  if (!preflightReady) {
    return "manual-ppt-playback-acceptance-production-evidence-gate-waiting-for-production-deployment-binding";
  }
  if (!manualRecordAccepted) {
    return "manual-ppt-playback-acceptance-production-evidence-gate-awaiting-manual-record";
  }
  if (!productionDeploymentEvidenceAccepted) {
    return "manual-ppt-playback-acceptance-production-evidence-gate-awaiting-production-deployment";
  }
  return "manual-ppt-playback-acceptance-production-evidence-gate-awaiting-release-run-binding";
}

function evaluateManualRecord({
  evidence,
  approvedReleaseRunIdLabel,
  expectedDeploymentFingerprint,
}) {
  if (evidence === undefined) {
    return {
      target: "missing",
      status: "missing",
      mode: "missing",
      releaseRunIdStatus: "missing",
      deploymentFingerprintStatus: "missing",
      valueRedacted: true,
    };
  }
  const base = {
    target: readString(evidence.target, "missing"),
    mode: readString(evidence.mode, "missing"),
    releaseRunIdStatus:
      evidence.releaseRunId === approvedReleaseRunIdLabel ? "matched" : "mismatched",
    deploymentFingerprintStatus: readDeploymentFingerprintStatus({
      evidence,
      expectedDeploymentFingerprint,
    }),
    valueRedacted: true,
  };
  if (base.target !== "ppt-manual-playback-acceptance") {
    return { ...base, status: "invalid-target" };
  }
  if (evidence.mode !== "record" || evidence.status !== "accepted") {
    return { ...base, status: "not-accepted-record" };
  }
  if (evidence.releaseRunId !== approvedReleaseRunIdLabel) {
    return { ...base, status: "release-run-id-mismatch" };
  }
  if (!hasCompleteManualRecord(evidence)) {
    return { ...base, status: "record-proof-incomplete" };
  }
  if (base.deploymentFingerprintStatus !== "matched") {
    return { ...base, status: "deployment-fingerprint-mismatch" };
  }
  return { ...base, status: "accepted" };
}

function evaluateVercelProductionDeployment({ evidence, approvedReleaseRunIdLabel }) {
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
  const deploymentObservationStatus = readDeploymentObservationStatus(evidence);
  const base = {
    target: readString(evidence.target, "missing"),
    environment: readString(evidence.environment, "missing"),
    releaseRunIdStatus:
      evidence.releaseRunId === approvedReleaseRunIdLabel ? "matched" : "mismatched",
    deploymentObservationStatus,
    valueRedacted: true,
  };
  if (base.target !== "vercel-production-deployment") {
    return { ...base, status: "invalid-target" };
  }
  if (
    evidence.mode !== "live" ||
    evidence.environment !== "production" ||
    evidence.status !== "deployed" ||
    deploymentObservationStatus !== "observed" ||
    !readDeploymentFingerprint(evidence) ||
    !hasDeploymentSafety(evidence.safety)
  ) {
    return { ...base, status: "not-deployed" };
  }
  if (evidence.releaseRunId !== approvedReleaseRunIdLabel) {
    return { ...base, status: "release-run-id-mismatch" };
  }
  return { ...base, status: "deployed" };
}

function hasCompleteManualRecord(evidence) {
  return (
    evidence.deploymentEvidenceSource === "vercel-production-deployment" &&
    evidence.deploymentObservationBindingStatus === "proved" &&
    evidence.packageArtifactFingerprintStatus === "present" &&
    evidence.packageTargetVoiceLabelStatus === "present" &&
    evidence.manualRecordPackageIdentityStatus === "matched" &&
    evidence.manualRecordArtifactFingerprintStatus === "matched" &&
    evidence.manualRecordReleaseRunStatus === "matched" &&
    evidence.manualRecordDeploymentFingerprintStatus === "matched" &&
    evidence.manualRecordAfterDeploymentStatus === "proved" &&
    evidence.manualRecordConfirmationStatus === "accepted-after-human-playback" &&
    evidence.machinePreflightStatus === "passed" &&
    evidence.manualAcceptanceStatus === "accepted" &&
    evidence.manualRecordEvidenceStatus === "complete" &&
    evidence.manualRecordTimingStatus === "valid-past-or-present" &&
    evidence.expectedSlideCount === 19 &&
    hasRequiredApplications(evidence.acceptedApplications) &&
    evidence.checklist?.slideChecks === 19 &&
    hasRequiredApplications(evidence.checklist?.requiredApplications)
  );
}

function hasRequiredApplications(applications) {
  return (
    Array.isArray(applications) &&
    requiredApplications.every((application) => applications.includes(application))
  );
}

function readDeploymentFingerprintStatus({ evidence, expectedDeploymentFingerprint }) {
  if (!readString(evidence.deploymentFingerprint, "")) {
    return "missing";
  }
  if (!expectedDeploymentFingerprint) {
    return evidence.manualRecordDeploymentFingerprintStatus === "matched" ? "matched" : "missing";
  }
  return evidence.deploymentFingerprint === expectedDeploymentFingerprint ? "matched" : "mismatched";
}

function readDeploymentFingerprint(evidence) {
  if (!isRecord(evidence)) {
    return "";
  }
  if (typeof evidence.deploymentFingerprint === "string") {
    return evidence.deploymentFingerprint;
  }
  if (
    isRecord(evidence.deploymentFingerprint) &&
    typeof evidence.deploymentFingerprint.value === "string"
  ) {
    return evidence.deploymentFingerprint.value;
  }
  return "";
}

function readDeploymentObservationStatus(evidence) {
  if (typeof evidence.deploymentObservationStatus === "string") {
    return evidence.deploymentObservationStatus;
  }
  if (isRecord(evidence.deploymentObservation)) {
    return readString(evidence.deploymentObservation.status, "missing");
  }
  return "missing";
}

function hasDeploymentSafety(safety) {
  return (
    isRecord(safety) &&
    (safety.valuesRedacted === true || safety.secretsRedacted === true) &&
    (safety.deploymentUrlOmitted === true || safety.deploymentUrlsOmitted === true) &&
    (safety.tokenOmitted === true || safety.credentialValuesOmitted === true) &&
    safety.localPrivatePathsOmitted === true
  );
}

function buildBlockedReasons({
  preflightReady,
  manualPptPreflight,
  manualRecordStatus,
  productionDeploymentEvidenceStatus,
  releaseRunBindingStillForbidden,
  releaseRunBound,
  deploymentBound,
}) {
  const reasons = [];
  if (!preflightReady) {
    reasons.push("manual-ppt-preflight-not-ready");
  }
  if (manualPptPreflight.summary?.vercelProductionDeploymentEvidenceCleared !== true) {
    reasons.push("vercel-production-deployment-evidence-not-cleared");
  }
  if (releaseRunBindingStillForbidden) {
    reasons.push("release-run-binding-still-forbidden");
  }
  if (manualRecordStatus.status === "missing") {
    reasons.push("manual-ppt-playback-acceptance-record-missing");
  } else if (manualRecordStatus.status !== "accepted") {
    reasons.push(`manual-ppt-playback-acceptance-record-${manualRecordStatus.status}`);
  }
  if (productionDeploymentEvidenceStatus.status === "missing") {
    reasons.push("vercel-production-deployment-evidence-missing");
  } else if (productionDeploymentEvidenceStatus.status !== "deployed") {
    reasons.push(`vercel-production-deployment-evidence-${productionDeploymentEvidenceStatus.status}`);
  }
  if (!releaseRunBound) {
    reasons.push("same-release-run-id-bound-to-manual-record-missing");
  }
  if (!deploymentBound) {
    reasons.push("same-vercel-production-deployment-bound-to-manual-playback-record-missing");
  }
  return reasons;
}

function readSafeNextAction({
  manualPptPlaybackAcceptanceEvidenceCleared,
  preflightReady,
  manualRecordAccepted,
  productionDeploymentEvidenceAccepted,
  upstreamBlockingEvidence,
}) {
  if (manualPptPlaybackAcceptanceEvidenceCleared) {
    return "advance-enterprise-live-evidence-audit-preflight";
  }
  if (!preflightReady) {
    return readString(
      upstreamBlockingEvidence?.safeNextAction,
      "wait-for-vercel-production-deployment-binding",
    );
  }
  if (!manualRecordAccepted) {
    return "produce-completed-human-manual-ppt-playback-record";
  }
  if (!productionDeploymentEvidenceAccepted) {
    return "produce-vercel-production-deployment-evidence";
  }
  return "bind-manual-record-to-release-run-and-vercel-deployment";
}

function renderMarkdown(report) {
  const lines = [
    "# UAIS Manual PPT Playback Acceptance Production Evidence Gate",
    "",
    `Status: \`${report.status}\``,
    `Manual acceptance record label: \`${report.approvedManualAcceptanceRecordLabel}\``,
    `Operator input required: \`${report.summary.operatorInputRequired}\``,
    `Safe next action: \`${report.safeNextAction}\``,
    `Evidence cleared: \`${report.summary.manualPptPlaybackAcceptanceEvidenceCleared}\``,
    `Release ready: \`${report.summary.releaseReady}\``,
    "",
    "## Evidence Status",
    "",
    `- Manual record: \`${report.manualRecordStatus.status}\``,
    `- Vercel production deployment: \`${report.productionDeploymentEvidenceStatus.status}\``,
    `- Release run bound: \`${report.summary.releaseRunBound}\``,
    `- Deployment bound: \`${report.summary.deploymentBound}\``,
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
      `- \`${report.upstreamBlockingEvidence.id}\`: \`${report.upstreamBlockingEvidence.label}\``,
      `- Safe next action: \`${report.upstreamBlockingEvidence.safeNextAction}\``,
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
