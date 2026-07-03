#!/usr/bin/env node

import { readFileSync } from "node:fs";

const provedEvidence = [
  "vercel-env-sync-evidence-with-external-storage-env-present",
  "external-storage-persistence-read-after-restart-proof",
  "external-storage-service-readiness-production-live-ready",
  "external-storage-smoke-live-passed",
  "same-release-run-id-bound-to-external-storage-readiness-and-smoke",
];

const readinessResultKeys = [
  "externalStorageEndpointRemoteHttps",
  "externalStorageHealthContract",
  "externalStorageOrdinaryTeachingSchemas",
  "externalStorageTeachingOperationsSchema",
  "externalStorageTeachingCourseManagementSchema",
  "externalStorageTeachingCourseAssetsSchema",
  "externalStorageVercelEnvSync",
  "externalStorageProductionLaunchContract",
  "externalStoragePersistenceEvidence",
  "externalStorageReadinessSafety",
];

const persistenceResultIds = [
  "s22-external-storage-persistence-health",
  "s22-external-storage-persisted-ownership-read",
  "s24-external-storage-persisted-audit-read",
];

const smokeResultIds = [
  "s22-external-storage-health",
  "s22-external-storage-teaching-operations",
  "s22-external-storage-course-management",
  "s24-external-storage-course-assets",
];

function main() {
  const args = parseArgs(process.argv.slice(2));
  const externalStoragePreflight = readJsonArg(args, "external-storage-preflight");
  const externalStorageVercelEnvSyncEvidenceGate = readJsonArg(
    args,
    "external-storage-vercel-env-sync-evidence-gate",
  );
  const externalStoragePersistence =
    typeof args["external-storage-persistence"] === "string"
      ? readJsonArg(args, "external-storage-persistence")
      : undefined;
  const externalStorageServiceReadiness =
    typeof args["external-storage-service-readiness"] === "string"
      ? readJsonArg(args, "external-storage-service-readiness")
      : undefined;
  const externalStorageSmoke =
    typeof args["external-storage-smoke"] === "string"
      ? readJsonArg(args, "external-storage-smoke")
      : undefined;
  const report = buildReport({
    externalStoragePreflight,
    externalStorageVercelEnvSyncEvidenceGate,
    externalStoragePersistence,
    externalStorageServiceReadiness,
    externalStorageSmoke,
  });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(report));
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function buildReport({
  externalStoragePreflight,
  externalStorageVercelEnvSyncEvidenceGate,
  externalStoragePersistence,
  externalStorageServiceReadiness,
  externalStorageSmoke,
}) {
  const approvedServiceClass = readString(externalStoragePreflight.approvedServiceClass, "");
  const approvedReleaseRunIdLabel = readString(
    externalStoragePreflight.approvedReleaseRunIdLabel,
    "",
  );
  const approvedRemoteHttpsExternalStorageServiceLabel = readString(
    externalStoragePreflight.approvedRemoteHttpsExternalStorageServiceLabel,
    "",
  );
  const upstreamAuthEvidenceCleared =
    externalStoragePreflight.summary?.upstreamAuthEvidenceCleared === true;
  const liveSmokeStillForbidden =
    externalStoragePreflight.summary?.liveSmokeStillForbidden === true;
  const envSyncEvidenceAccepted =
    externalStorageVercelEnvSyncEvidenceGate.summary?.applyEvidenceAccepted === true &&
    externalStorageVercelEnvSyncEvidenceGate.summary?.externalStorageReadinessMayProceed ===
      true &&
    externalStorageVercelEnvSyncEvidenceGate.vercelEnvSyncEvidenceStatus?.releaseRunIdStatus ===
      "matched" &&
    externalStorageVercelEnvSyncEvidenceGate.vercelEnvSyncEvidenceStatus
      ?.requiredExternalStorageEnvStatus === "present";
  const persistenceEvidenceStatus = evaluatePersistenceEvidence({
    evidence: externalStoragePersistence,
    approvedReleaseRunIdLabel,
  });
  const persistenceFingerprint = readStorageFingerprint(externalStoragePersistence);
  const readinessEvidenceStatus = evaluateReadinessEvidence({
    evidence: externalStorageServiceReadiness,
    approvedReleaseRunIdLabel,
    expectedFingerprint: persistenceFingerprint,
  });
  const readinessFingerprint = readStorageFingerprint(externalStorageServiceReadiness);
  const smokeEvidenceStatus = evaluateSmokeEvidence({
    evidence: externalStorageSmoke,
    approvedReleaseRunIdLabel,
    expectedFingerprint: readinessFingerprint || persistenceFingerprint,
  });
  const persistenceEvidenceAccepted = persistenceEvidenceStatus.status === "matched";
  const readinessEvidenceAccepted = readinessEvidenceStatus.status === "live-ready";
  const smokeEvidenceAccepted = smokeEvidenceStatus.status === "live-passed";
  const releaseRunBound =
    persistenceEvidenceStatus.releaseRunIdStatus === "matched" &&
    readinessEvidenceStatus.releaseRunIdStatus === "matched" &&
    smokeEvidenceStatus.releaseRunIdStatus === "matched";
  const externalStorageProductionEvidenceCleared =
    upstreamAuthEvidenceCleared &&
    envSyncEvidenceAccepted &&
    persistenceEvidenceAccepted &&
    readinessEvidenceAccepted &&
    smokeEvidenceAccepted &&
    releaseRunBound &&
    liveSmokeStillForbidden;
  const status = readStatus({
    externalStorageProductionEvidenceCleared,
    upstreamAuthEvidenceCleared,
    envSyncEvidenceAccepted,
  });
  const upstreamEnvSyncEvidenceRequired = !envSyncEvidenceAccepted;
  const upstreamOperatorInputRequired =
    upstreamEnvSyncEvidenceRequired &&
    externalStorageVercelEnvSyncEvidenceGate.summary?.operatorInputRequired === true;
  const upstreamBlockingEvidence = upstreamEnvSyncEvidenceRequired
    ? {
        id: "upstream-external-storage-vercel-env-sync-evidence-gate",
        label: "external-storage-vercel-env-sync-evidence-gate",
        reason:
          "External-storage production evidence must wait for accepted external-storage Vercel env-sync evidence before persistence, readiness, or smoke evidence can be requested.",
        valuesForbidden: true,
        upstreamStatus: readString(externalStorageVercelEnvSyncEvidenceGate.status, "unknown"),
        safeNextAction: readString(externalStorageVercelEnvSyncEvidenceGate.safeNextAction, ""),
        upstreamOperatorInputRequired,
        upstreamMissingEvidence: readStringArray(
          externalStorageVercelEnvSyncEvidenceGate.upstreamBlockingEvidence
            ?.upstreamMissingEvidence,
        ),
        upstreamOperatorInputPacket: readSafeOperatorInputPacket(
          externalStorageVercelEnvSyncEvidenceGate.upstreamBlockingEvidence
            ?.upstreamOperatorInputPacket,
        ),
        upstreamSafeCommandTemplates: readSafeCommandTemplates(
          externalStorageVercelEnvSyncEvidenceGate.upstreamBlockingEvidence
            ?.upstreamSafeCommandTemplates,
        ),
      }
    : null;

  return {
    target: "external-storage-production-evidence-gate",
    status,
    releaseReady: false,
    responsibleSession: "S19/S22/S24",
    approvedServiceClass,
    approvedRemoteHttpsExternalStorageServiceLabel,
    approvedServerOnlyEnvSourceLabel: readString(
      externalStoragePreflight.approvedServerOnlyEnvSourceLabel,
      "",
    ),
    approvedReleaseRunIdLabel,
    approvedSmokeTeacherIdLabel: readString(
      externalStoragePreflight.approvedSmokeTeacherIdLabel,
      "",
    ),
    summary: {
      operatorInputRequired: upstreamOperatorInputRequired,
      blockingInputRequired: upstreamOperatorInputRequired,
      upstreamAuthEvidenceCleared,
      envSyncEvidenceAccepted,
      persistenceEvidenceProvided: externalStoragePersistence !== undefined,
      persistenceEvidenceAccepted,
      readinessEvidenceProvided: externalStorageServiceReadiness !== undefined,
      readinessEvidenceAccepted,
      smokeEvidenceProvided: externalStorageSmoke !== undefined,
      smokeEvidenceAccepted,
      releaseRunBound,
      externalStorageProductionEvidenceCleared,
      liveSmokeStillForbidden,
      releaseReady: false,
    },
    persistenceEvidenceStatus,
    readinessEvidenceStatus,
    smokeEvidenceStatus,
    upstreamBlockingEvidence,
    provedEvidence: externalStorageProductionEvidenceCleared ? provedEvidence : [],
    blockedReasons: buildBlockedReasons({
      upstreamAuthEvidenceCleared,
      envSyncEvidenceAccepted,
      persistenceEvidenceStatus,
      readinessEvidenceStatus,
      smokeEvidenceStatus,
      liveSmokeStillForbidden,
    }),
    safeNextAction: readSafeNextAction({
      externalStorageProductionEvidenceCleared,
      upstreamAuthEvidenceCleared,
      envSyncEvidenceAccepted,
      upstreamBlockingEvidence,
    }),
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      endpointValuesOmitted: true,
      credentialValuesOmitted: true,
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
  externalStorageProductionEvidenceCleared,
  upstreamAuthEvidenceCleared,
  envSyncEvidenceAccepted,
}) {
  if (externalStorageProductionEvidenceCleared) {
    return "external-storage-production-evidence-gate-cleared";
  }
  if (!upstreamAuthEvidenceCleared) {
    return "external-storage-production-evidence-gate-waiting-for-upstream-auth";
  }
  if (!envSyncEvidenceAccepted) {
    return "external-storage-production-evidence-gate-awaiting-env-sync-evidence";
  }
  return "external-storage-production-evidence-gate-awaiting-readiness-evidence";
}

function evaluatePersistenceEvidence({ evidence, approvedReleaseRunIdLabel }) {
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
  if (base.target !== "external-storage-persistence") {
    return { ...base, status: "invalid-target" };
  }
  if (
    evidence.mode !== "live" ||
    evidence.environment !== "production" ||
    evidence.phase !== "read" ||
    evidence.status !== "passed"
  ) {
    return { ...base, status: "not-production-read" };
  }
  if (evidence.releaseRunId !== approvedReleaseRunIdLabel) {
    return { ...base, status: "release-run-id-mismatch" };
  }
  if (!hasRemoteHttpsStorageEndpoint(evidence)) {
    return { ...base, status: "remote-https-endpoint-missing" };
  }
  if (!hasStorageFingerprint(evidence)) {
    return { ...base, status: "service-fingerprint-missing" };
  }
  if (!hasOkResults(evidence.results, persistenceResultIds)) {
    return { ...base, status: "result-proof-missing" };
  }
  if (!hasPersistenceSafety(evidence.safety)) {
    return { ...base, status: "redaction-safety-missing" };
  }
  return { ...base, status: "matched" };
}

function evaluateReadinessEvidence({ evidence, approvedReleaseRunIdLabel, expectedFingerprint }) {
  if (evidence === undefined) {
    return {
      target: "missing",
      status: "missing",
      mode: "missing",
      environment: "missing",
      releaseRunIdStatus: "missing",
      valueRedacted: true,
    };
  }
  const base = {
    target: readString(evidence.target, "missing"),
    mode: readString(evidence.mode, "missing"),
    environment: readString(evidence.environment, "missing"),
    releaseRunIdStatus:
      evidence.releaseRunId === approvedReleaseRunIdLabel ? "matched" : "mismatched",
    valueRedacted: true,
  };
  if (base.target !== "external-storage-service-readiness") {
    return { ...base, status: "invalid-target" };
  }
  if (
    evidence.mode !== "live" ||
    evidence.environment !== "production" ||
    evidence.status !== "ready"
  ) {
    return { ...base, status: "not-live-ready" };
  }
  if (evidence.releaseRunId !== approvedReleaseRunIdLabel) {
    return { ...base, status: "release-run-id-mismatch" };
  }
  if (!hasRemoteHttpsStorageEndpoint(evidence)) {
    return { ...base, status: "remote-https-endpoint-missing" };
  }
  if (!hasStorageFingerprint(evidence)) {
    return { ...base, status: "service-fingerprint-missing" };
  }
  if (expectedFingerprint && readStorageFingerprint(evidence) !== expectedFingerprint) {
    return { ...base, status: "service-fingerprint-mismatch" };
  }
  if (!hasPassedReadinessResults(evidence.results)) {
    return { ...base, status: "result-proof-missing" };
  }
  if (!hasReadinessProofs(evidence)) {
    return { ...base, status: "readiness-proof-missing" };
  }
  if (!hasReadinessSafety(evidence.safety)) {
    return { ...base, status: "redaction-safety-missing" };
  }
  return { ...base, status: "live-ready" };
}

function evaluateSmokeEvidence({ evidence, approvedReleaseRunIdLabel, expectedFingerprint }) {
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
  if (base.target !== "external-storage-smoke") {
    return { ...base, status: "invalid-target" };
  }
  if (evidence.mode !== "live" || evidence.environment !== "production" || evidence.status !== "passed") {
    return { ...base, status: "not-live-passed" };
  }
  if (evidence.releaseRunId !== approvedReleaseRunIdLabel) {
    return { ...base, status: "release-run-id-mismatch" };
  }
  if (!hasRemoteHttpsStorageEndpoint(evidence)) {
    return { ...base, status: "remote-https-endpoint-missing" };
  }
  if (!hasStorageFingerprint(evidence)) {
    return { ...base, status: "service-fingerprint-missing" };
  }
  if (expectedFingerprint && readStorageFingerprint(evidence) !== expectedFingerprint) {
    return { ...base, status: "service-fingerprint-mismatch" };
  }
  if (!hasOkResults(evidence.results, smokeResultIds)) {
    return { ...base, status: "result-proof-missing" };
  }
  if (!hasSmokeReadinessBinding(evidence.externalStorageServiceReadinessEvidence)) {
    return { ...base, status: "readiness-binding-missing" };
  }
  if (!hasSmokeSafety(evidence.safety)) {
    return { ...base, status: "redaction-safety-missing" };
  }
  return { ...base, status: "live-passed" };
}

function hasRemoteHttpsStorageEndpoint(evidence) {
  return evidence.storageEndpoint?.endpointClass === "remote-https";
}

function hasStorageFingerprint(evidence) {
  const fingerprint = evidence.storageServiceFingerprint;
  return (
    isRecord(fingerprint) &&
    fingerprint.status === "present" &&
    fingerprint.source === "origin" &&
    typeof fingerprint.value === "string" &&
    fingerprint.value.length > 0 &&
    fingerprint.valueRedacted === true
  );
}

function readStorageFingerprint(evidence) {
  if (!isRecord(evidence) || !hasStorageFingerprint(evidence)) {
    return "";
  }
  return evidence.storageServiceFingerprint.value;
}

function hasPassedReadinessResults(results) {
  if (!isRecord(results)) {
    return false;
  }
  return readinessResultKeys.every((key) => results[key] === "passed");
}

function hasOkResults(results, ids) {
  return ids.every((id) => readResultById(results, id)?.status === "ok");
}

function hasReadinessProofs(evidence) {
  return (
    evidence.vercelEnvSyncEvidence?.target === "vercel-env-sync" &&
    evidence.vercelEnvSyncEvidence?.status === "matched" &&
    evidence.vercelEnvSyncEvidence?.applyPreflight === "proved" &&
    evidence.vercelEnvSyncEvidence?.releaseRunIdStatus === "matched" &&
    evidence.vercelEnvSyncEvidence?.valueRedacted === true &&
    evidence.productionLaunchContractEvidence?.target ===
      "external-storage-service-production-launcher" &&
    evidence.productionLaunchContractEvidence?.status === "ready" &&
    evidence.productionLaunchContractEvidence?.valueRedacted === true &&
    evidence.productionLaunchContractEvidence?.serviceMode === "production" &&
    evidence.productionLaunchContractEvidence?.runtime === "proved" &&
    evidence.productionLaunchContractEvidence?.envContract === "proved" &&
    evidence.productionLaunchContractEvidence?.dataDirPersistence === "proved" &&
    evidence.productionLaunchContractEvidence?.containerArtifact === "proved" &&
    evidence.productionLaunchContractEvidence?.redactionSafety === "proved" &&
    evidence.persistenceEvidence?.target === "external-storage-persistence" &&
    evidence.persistenceEvidence?.status === "matched" &&
    evidence.persistenceEvidence?.releaseRunIdStatus === "matched" &&
    evidence.persistenceEvidence?.valueRedacted === true
  );
}

function hasSmokeReadinessBinding(evidence) {
  return (
    isRecord(evidence) &&
    evidence.target === "external-storage-service-readiness" &&
    evidence.status === "matched" &&
    evidence.releaseRunIdStatus === "matched" &&
    evidence.valueRedacted === true
  );
}

function hasPersistenceSafety(safety) {
  return (
    isRecord(safety) &&
    safety.secretsRedacted === true &&
    safety.serviceUrlOmitted === true &&
    safety.teacherIdOmitted === true &&
    safety.proofIdOmitted === true &&
    safety.responseBodiesOmitted === true &&
    safety.localPrivatePathsOmitted === true
  );
}

function hasReadinessSafety(safety) {
  return (
    isRecord(safety) &&
    safety.valuesRedacted === true &&
    safety.serviceUrlOmitted === true &&
    safety.responseBodiesOmitted === true &&
    safety.localPrivatePathsOmitted === true &&
    safety.cookieValuesOmitted === true &&
    safety.liveRequiresApproval === true &&
    safety.remoteMutationRequiresApproval === true &&
    safety.noWriteOperations === true
  );
}

function hasSmokeSafety(safety) {
  return (
    isRecord(safety) &&
    safety.secretsRedacted === true &&
    safety.serviceUrlOmitted === true &&
    safety.teacherIdOmitted === true &&
    safety.responseBodiesOmitted === true &&
    safety.localPrivatePathsOmitted === true &&
    safety.noCredentialValuesEmitted === true
  );
}

function buildBlockedReasons({
  upstreamAuthEvidenceCleared,
  envSyncEvidenceAccepted,
  persistenceEvidenceStatus,
  readinessEvidenceStatus,
  smokeEvidenceStatus,
  liveSmokeStillForbidden,
}) {
  const reasons = [];
  if (!upstreamAuthEvidenceCleared) {
    reasons.push("upstream-auth-production-evidence-not-cleared");
  }
  if (!envSyncEvidenceAccepted) {
    reasons.push("external-storage-vercel-env-sync-evidence-not-accepted");
  }
  if (persistenceEvidenceStatus.status === "missing") {
    reasons.push("external-storage-persistence-evidence-missing");
  } else if (persistenceEvidenceStatus.status !== "matched") {
    reasons.push(`external-storage-persistence-${persistenceEvidenceStatus.status}`);
  }
  if (readinessEvidenceStatus.status === "missing") {
    reasons.push("external-storage-service-readiness-evidence-missing");
  } else if (readinessEvidenceStatus.status !== "live-ready") {
    reasons.push(`external-storage-service-readiness-${readinessEvidenceStatus.status}`);
  }
  if (smokeEvidenceStatus.status === "missing") {
    reasons.push("external-storage-smoke-evidence-missing");
  } else if (smokeEvidenceStatus.status !== "live-passed") {
    reasons.push(`external-storage-smoke-${smokeEvidenceStatus.status}`);
  }
  if (!liveSmokeStillForbidden) {
    reasons.push("external-storage-live-smoke-separate-approval-not-preserved");
  }
  return reasons;
}

function readSafeNextAction({
  externalStorageProductionEvidenceCleared,
  upstreamAuthEvidenceCleared,
  envSyncEvidenceAccepted,
  upstreamBlockingEvidence,
}) {
  if (externalStorageProductionEvidenceCleared) {
    return "advance-vercel-env-deploy-production-evidence-preflight";
  }
  if (!upstreamAuthEvidenceCleared) {
    return readString(
      upstreamBlockingEvidence?.safeNextAction,
      "wait-for-auth-production-evidence-before-external-storage",
    );
  }
  if (!envSyncEvidenceAccepted) {
    return readString(
      upstreamBlockingEvidence?.safeNextAction,
      "produce-external-storage-vercel-env-sync-evidence",
    );
  }
  return "produce-external-storage-persistence-readiness-and-smoke-evidence";
}

function renderMarkdown(report) {
  const lines = [
    "# UAIS External Storage Production Evidence Gate",
    "",
    `Status: \`${report.status}\``,
    `Env source label: \`${report.approvedServerOnlyEnvSourceLabel}\``,
    `Service label: \`${report.approvedRemoteHttpsExternalStorageServiceLabel}\``,
    `Smoke teacher label: \`${report.approvedSmokeTeacherIdLabel}\``,
    `Operator input required: \`${report.summary.operatorInputRequired}\``,
    `Safe next action: \`${report.safeNextAction}\``,
    `External-storage evidence cleared: \`${report.summary.externalStorageProductionEvidenceCleared}\``,
    `Release ready: \`${report.summary.releaseReady}\``,
    "",
    "## Persistence Evidence",
    "",
    `- Target: \`${report.persistenceEvidenceStatus.target}\``,
    `- Status: \`${report.persistenceEvidenceStatus.status}\``,
    `- Environment: \`${report.persistenceEvidenceStatus.environment}\``,
    `- Release run: \`${report.persistenceEvidenceStatus.releaseRunIdStatus}\``,
    "",
    "## Service Readiness Evidence",
    "",
    `- Target: \`${report.readinessEvidenceStatus.target}\``,
    `- Status: \`${report.readinessEvidenceStatus.status}\``,
    `- Mode: \`${report.readinessEvidenceStatus.mode}\``,
    `- Environment: \`${report.readinessEvidenceStatus.environment}\``,
    `- Release run: \`${report.readinessEvidenceStatus.releaseRunIdStatus}\``,
    "",
    "## Smoke Evidence",
    "",
    `- Target: \`${report.smokeEvidenceStatus.target}\``,
    `- Status: \`${report.smokeEvidenceStatus.status}\``,
    `- Environment: \`${report.smokeEvidenceStatus.environment}\``,
    `- Release run: \`${report.smokeEvidenceStatus.releaseRunIdStatus}\``,
    "",
    "## Upstream Blocking Evidence",
    "",
    ...(report.upstreamBlockingEvidence
      ? [
          `- \`${report.upstreamBlockingEvidence.id}\`: \`${report.upstreamBlockingEvidence.label}\``,
        ]
      : ["- `none-recorded`"]),
    ...(report.upstreamBlockingEvidence &&
    Object.keys(report.upstreamBlockingEvidence.upstreamOperatorInputPacket ?? {}).length > 0
      ? [
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
        ]
      : []),
    ...(report.upstreamBlockingEvidence &&
    Object.keys(report.upstreamBlockingEvidence.upstreamSafeCommandTemplates ?? {}).length > 0
      ? [
          "",
          "## Upstream Safe Operator Command Templates",
          "",
          ...Object.entries(report.upstreamBlockingEvidence.upstreamSafeCommandTemplates).map(
            ([name, command]) => `- \`${name}\`: \`${command}\``,
          ),
        ]
      : []),
    "",
    "## Blocked Reasons",
    "",
    ...(report.blockedReasons.length > 0
      ? report.blockedReasons.map((reason) => `- \`${reason}\``)
      : ["- None"]),
  ];

  return `${lines.join("\n")}\n`;
}

function readResultById(results, id) {
  return Array.isArray(results)
    ? results.find((result) => isRecord(result) && result.id === id)
    : undefined;
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
