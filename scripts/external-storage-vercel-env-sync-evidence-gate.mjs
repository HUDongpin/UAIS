#!/usr/bin/env node

import { readFileSync } from "node:fs";

const defaultRequiredExternalStorageEnvNames = [
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const externalStoragePreflight = readJsonArg(args, "external-storage-preflight");
  const externalStorageEnvSourceIntake =
    typeof args["external-storage-env-source-intake"] === "string"
      ? readJsonArg(args, "external-storage-env-source-intake")
      : undefined;
  const vercelEnvSync =
    typeof args["vercel-env-sync"] === "string"
      ? readJsonArg(args, "vercel-env-sync")
      : undefined;
  const report = buildReport({
    externalStoragePreflight,
    externalStorageEnvSourceIntake,
    vercelEnvSync,
  });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(report));
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function buildReport({ externalStoragePreflight, externalStorageEnvSourceIntake, vercelEnvSync }) {
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
  const externalStoragePreflightReady =
    upstreamAuthEvidenceCleared &&
    readString(externalStoragePreflight.status, "") ===
      "external-storage-production-evidence-preflight-ready";
  const requiredExternalStorageEnvNames =
    readRequiredExternalStorageEnvNames(externalStoragePreflight);
  const vercelEnvSyncEvidenceStatus = evaluateVercelEnvSyncEvidence({
    evidence: vercelEnvSync,
    approvedReleaseRunIdLabel,
    approvedRemoteHttpsExternalStorageServiceLabel,
    requiredExternalStorageEnvNames,
  });
  const applyEvidenceAccepted =
    externalStoragePreflightReady &&
    vercelEnvSyncEvidenceStatus.status === "matched" &&
    vercelEnvSyncEvidenceStatus.applyPreflight === "proved" &&
    vercelEnvSyncEvidenceStatus.releaseRunIdStatus === "matched" &&
    vercelEnvSyncEvidenceStatus.requiredExternalStorageEnvStatus === "present" &&
    vercelEnvSyncEvidenceStatus.serviceEndpointStatus === "remote-https" &&
    vercelEnvSyncEvidenceStatus.serviceFingerprintStatus === "present" &&
    vercelEnvSyncEvidenceStatus.databaseAdapterProofStatus === "ready";
  const upstreamProductionEvidenceRequired = !externalStoragePreflightReady;
  const upstreamOperatorInputRequired =
    upstreamProductionEvidenceRequired &&
    externalStorageEnvSourceIntake?.summary?.operatorInputRequired === true;
  const upstreamBlockingEvidence = upstreamProductionEvidenceRequired
    ? {
        id: "upstream-auth-production-evidence",
        label: "app-auth-and-teacher-auth-production-evidence",
        reason:
          "External-storage Vercel env-sync evidence must wait for app-auth and teacher-auth production evidence before S19 runs or accepts external-storage env-sync evidence.",
        valuesForbidden: true,
        upstreamStatus: readString(externalStoragePreflight.status, "unknown"),
        upstreamBlockedReasons: ["upstream-auth-production-evidence-not-cleared"],
        safeNextAction: readString(externalStorageEnvSourceIntake?.safeNextAction, ""),
        upstreamOperatorInputRequired,
        upstreamMissingEvidence: readStringArray(
          externalStorageEnvSourceIntake?.upstreamBlockingEvidence?.upstreamMissingEvidence,
        ),
        upstreamOperatorInputPacket: readSafeOperatorInputPacket(
          externalStorageEnvSourceIntake?.upstreamBlockingEvidence?.upstreamOperatorInputPacket,
        ),
        upstreamSafeCommandTemplates: readSafeCommandTemplates(
          externalStorageEnvSourceIntake?.upstreamBlockingEvidence?.upstreamSafeCommandTemplates,
        ),
      }
    : null;
  const status = readStatus({
    externalStoragePreflightReady,
    vercelEnvSync,
    applyEvidenceAccepted,
  });

  return {
    target: "external-storage-vercel-env-sync-evidence-gate",
    status,
    releaseReady: false,
    responsibleSession: "S19/S22",
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
      ownerInputRequired: false,
      operatorInputRequired: upstreamOperatorInputRequired,
      blockingInputRequired: upstreamOperatorInputRequired,
      upstreamProductionEvidenceRequired,
      upstreamAuthEvidenceCleared,
      externalStoragePreflightReady,
      vercelEnvSyncEvidenceProvided: vercelEnvSync !== undefined,
      applyEvidenceAccepted,
      externalStorageEnvPresent:
        vercelEnvSyncEvidenceStatus.requiredExternalStorageEnvStatus === "present",
      externalStorageReadinessMayProceed: applyEvidenceAccepted,
      releaseReady: false,
    },
    vercelEnvSyncEvidenceStatus,
    requiredExternalStorageEnvNames,
    upstreamBlockingEvidence,
    blockedReasons: applyEvidenceAccepted
      ? []
      : readBlockedReasons({
        externalStoragePreflightReady,
        vercelEnvSyncEvidenceStatus,
      }),
    safeNextAction: readSafeNextAction({
      externalStoragePreflightReady,
      applyEvidenceAccepted,
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
      noRemoteWritePerformed: true,
      noEnvApplyPerformed: true,
      noDeploymentMutationPerformed: true,
      noLiveSmokePerformed: true,
      noReleaseRunBindingPerformed: true,
    },
  };
}

function readStatus({ externalStoragePreflightReady, vercelEnvSync, applyEvidenceAccepted }) {
  if (applyEvidenceAccepted) {
    return "external-storage-vercel-env-sync-evidence-gate-apply-evidence-accepted";
  }
  if (!externalStoragePreflightReady) {
    return "external-storage-vercel-env-sync-evidence-gate-waiting-for-upstream-auth";
  }
  if (vercelEnvSync === undefined) {
    return "external-storage-vercel-env-sync-evidence-gate-awaiting-vercel-env-sync-evidence";
  }
  return "external-storage-vercel-env-sync-evidence-gate-rejected";
}

function evaluateVercelEnvSyncEvidence({
  evidence,
  approvedReleaseRunIdLabel,
  approvedRemoteHttpsExternalStorageServiceLabel,
  requiredExternalStorageEnvNames,
}) {
  if (evidence === undefined) {
    return {
      target: "missing",
      status: "missing",
      applyPreflight: "missing",
      releaseRunIdStatus: "missing",
      requiredExternalStorageEnvStatus: "missing",
      serviceEndpointStatus: "missing",
      serviceFingerprintStatus: "missing",
      databaseAdapterProofStatus: "missing",
      valueRedacted: true,
    };
  }
  const base = {
    target: readString(evidence.target, "missing"),
    valueRedacted: true,
  };
  if (base.target !== "vercel-env-sync") {
    return {
      ...base,
      status: "invalid-target",
      applyPreflight: "missing",
      releaseRunIdStatus: "missing",
      requiredExternalStorageEnvStatus: "missing",
      serviceEndpointStatus: "missing",
      serviceFingerprintStatus: "missing",
      databaseAdapterProofStatus: "missing",
    };
  }
  const requiredExternalStorageEnvStatus =
    readMissingExternalStorageEnvNames(evidence, requiredExternalStorageEnvNames).length === 0
      ? "present"
      : "missing";
  const serviceEndpointStatus = readServiceEndpointStatus(evidence);
  const serviceFingerprintStatus = readServiceFingerprintStatus(evidence);
  const databaseAdapterProofStatus = readDatabaseAdapterProofStatus(evidence);
  if (
    evidence.mode !== "apply" ||
    evidence.projectReadinessEvidenceStatus !== "ready" ||
    !hasProductionAndPreviewTargets(evidence.targets) ||
    !hasRedactedApplySummary(evidence)
  ) {
    return {
      ...base,
      status: "not-applied",
      applyPreflight: "missing",
      releaseRunIdStatus: "missing",
      requiredExternalStorageEnvStatus,
      serviceEndpointStatus,
      serviceFingerprintStatus,
      databaseAdapterProofStatus,
    };
  }
  if (!hasPassedApplyPreflight(evidence)) {
    return {
      ...base,
      status: "apply-preflight-missing",
      applyPreflight: "missing",
      releaseRunIdStatus: "missing",
      requiredExternalStorageEnvStatus,
      serviceEndpointStatus,
      serviceFingerprintStatus,
      databaseAdapterProofStatus,
    };
  }
  if (evidence.releaseRunId !== approvedReleaseRunIdLabel) {
    return {
      ...base,
      status: "release-run-id-mismatch",
      applyPreflight: "proved",
      releaseRunIdStatus: "mismatched",
      requiredExternalStorageEnvStatus,
      serviceEndpointStatus,
      serviceFingerprintStatus,
      databaseAdapterProofStatus,
    };
  }
  if (
    readString(evidence.approvedRemoteHttpsExternalStorageServiceLabel, "") !==
    approvedRemoteHttpsExternalStorageServiceLabel
  ) {
    return {
      ...base,
      status: "external-storage-service-label-mismatch",
      applyPreflight: "proved",
      releaseRunIdStatus: "matched",
      requiredExternalStorageEnvStatus,
      serviceEndpointStatus,
      serviceFingerprintStatus,
      databaseAdapterProofStatus,
    };
  }
  if (requiredExternalStorageEnvStatus !== "present") {
    return {
      ...base,
      status: "external-storage-env-missing",
      applyPreflight: "proved",
      releaseRunIdStatus: "matched",
      requiredExternalStorageEnvStatus,
      serviceEndpointStatus,
      serviceFingerprintStatus,
      databaseAdapterProofStatus,
      missingExternalStorageEnvNames: readMissingExternalStorageEnvNames(
        evidence,
        requiredExternalStorageEnvNames,
      ),
    };
  }
  if (serviceEndpointStatus !== "remote-https") {
    return {
      ...base,
      status: "external-storage-endpoint-not-remote-https",
      applyPreflight: "proved",
      releaseRunIdStatus: "matched",
      requiredExternalStorageEnvStatus,
      serviceEndpointStatus,
      serviceFingerprintStatus,
      databaseAdapterProofStatus,
    };
  }
  if (serviceFingerprintStatus !== "present") {
    return {
      ...base,
      status: "external-storage-service-fingerprint-missing",
      applyPreflight: "proved",
      releaseRunIdStatus: "matched",
      requiredExternalStorageEnvStatus,
      serviceEndpointStatus,
      serviceFingerprintStatus,
      databaseAdapterProofStatus,
    };
  }
  if (databaseAdapterProofStatus !== "ready") {
    return {
      ...base,
      status: "external-storage-database-adapter-proof-not-ready",
      applyPreflight: "proved",
      releaseRunIdStatus: "matched",
      requiredExternalStorageEnvStatus,
      serviceEndpointStatus,
      serviceFingerprintStatus,
      databaseAdapterProofStatus,
    };
  }
  return {
    ...base,
    status: "matched",
    applyPreflight: "proved",
    releaseRunIdStatus: "matched",
    requiredExternalStorageEnvStatus: "present",
    serviceEndpointStatus: "remote-https",
    serviceFingerprintStatus: "present",
    databaseAdapterProofStatus: "ready",
  };
}

function readBlockedReasons({ externalStoragePreflightReady, vercelEnvSyncEvidenceStatus }) {
  const reasons = [];
  if (!externalStoragePreflightReady) {
    reasons.push("upstream-auth-production-evidence-not-cleared");
    return reasons;
  }
  if (vercelEnvSyncEvidenceStatus.status === "missing") {
    reasons.push("vercel-env-sync-evidence-missing");
  } else if (vercelEnvSyncEvidenceStatus.status === "not-applied") {
    reasons.push("vercel-env-sync-not-applied");
  } else if (vercelEnvSyncEvidenceStatus.status === "apply-preflight-missing") {
    reasons.push("vercel-env-sync-apply-preflight-not-proven");
  } else if (vercelEnvSyncEvidenceStatus.status === "release-run-id-mismatch") {
    reasons.push("vercel-env-sync-release-run-id-mismatch");
  } else if (vercelEnvSyncEvidenceStatus.status === "external-storage-service-label-mismatch") {
    reasons.push("vercel-env-sync-external-storage-service-label-mismatch");
  } else if (vercelEnvSyncEvidenceStatus.status === "external-storage-env-missing") {
    reasons.push("vercel-env-sync-external-storage-env-missing");
  } else if (
    vercelEnvSyncEvidenceStatus.status === "external-storage-endpoint-not-remote-https"
  ) {
    reasons.push("vercel-env-sync-external-storage-not-remote-https");
  } else if (
    vercelEnvSyncEvidenceStatus.status === "external-storage-service-fingerprint-missing"
  ) {
    reasons.push("vercel-env-sync-external-storage-fingerprint-not-proven");
  } else if (
    vercelEnvSyncEvidenceStatus.status === "external-storage-database-adapter-proof-not-ready"
  ) {
    reasons.push("vercel-env-sync-external-storage-database-adapter-proof-not-ready");
  } else if (vercelEnvSyncEvidenceStatus.status !== "matched") {
    reasons.push(`vercel-env-sync-evidence-${vercelEnvSyncEvidenceStatus.status}`);
  }
  return reasons;
}

function readSafeNextAction({
  externalStoragePreflightReady,
  applyEvidenceAccepted,
  upstreamBlockingEvidence,
}) {
  if (applyEvidenceAccepted) {
    return "run-s22-external-storage-readiness-after-accepted-env-sync-launch-and-persistence-evidence";
  }
  if (!externalStoragePreflightReady) {
    return readString(
      upstreamBlockingEvidence?.safeNextAction,
      "wait-for-auth-production-evidence-before-external-storage-env-sync",
    );
  }
  return "run-s19-external-storage-vercel-env-sync-after-auth-clears";
}

function readMissingExternalStorageEnvNames(evidence, requiredExternalStorageEnvNames) {
  const entryStatusByName = new Map();
  if (Array.isArray(evidence.entries)) {
    for (const entry of evidence.entries) {
      if (!isRecord(entry)) {
        continue;
      }
      const name = readString(entry.name, readString(entry.key, ""));
      if (name.length > 0) {
        entryStatusByName.set(name, readString(entry.status, "missing"));
      }
    }
  }
  const envStatus = isRecord(evidence.envStatus) ? evidence.envStatus : {};
  const requiredEnv = isRecord(evidence.requiredEnv) ? evidence.requiredEnv : {};
  return requiredExternalStorageEnvNames.filter((name) => {
    if (entryStatusByName.get(name) === "present") {
      return false;
    }
    if (envStatus[name] === "present" || requiredEnv[name] === "present") {
      return false;
    }
    return true;
  });
}

function readRequiredExternalStorageEnvNames(externalStoragePreflight) {
  const names = readStringArray(externalStoragePreflight.requiredServerOnlyEnvNames);
  return names.length > 0 ? names : defaultRequiredExternalStorageEnvNames;
}

function readServiceEndpointStatus(evidence) {
  return evidence.externalStorageEndpoint?.endpointClass === "remote-https" &&
    evidence.externalStorageEndpoint?.valueRedacted === true
    ? "remote-https"
    : "missing";
}

function readServiceFingerprintStatus(evidence) {
  const fingerprint = evidence.externalStorageServiceFingerprint;
  return isRecord(fingerprint) &&
    fingerprint.status === "present" &&
    fingerprint.source === "origin" &&
    fingerprint.valueRedacted === true &&
    typeof fingerprint.value === "string"
    ? "present"
    : "missing";
}

function readDatabaseAdapterProofStatus(evidence) {
  const proof = evidence.externalStorageDatabaseAdapterProof;
  return isRecord(proof) && proof.status === "ready" && proof.valuesRedacted === true
    ? "ready"
    : "missing";
}

function hasProductionAndPreviewTargets(targets) {
  return Array.isArray(targets) && targets.includes("production") && targets.includes("preview");
}

function hasRedactedApplySummary(evidence) {
  const summary = evidence.applySummary;
  const appliedByTarget = summary?.appliedByTarget;
  return (
    isRecord(summary) &&
    summary.status === "applied" &&
    Number.isInteger(summary.appliedActions) &&
    summary.appliedActions > 0 &&
    isRecord(appliedByTarget) &&
    Number.isInteger(appliedByTarget.production) &&
    appliedByTarget.production > 0 &&
    Number.isInteger(appliedByTarget.preview) &&
    appliedByTarget.preview > 0 &&
    Number.isInteger(summary.localOnlyEntriesSkipped) &&
    summary.localOnlyEntriesSkipped >= 0 &&
    summary.valuesRedacted === true &&
    (summary.cliOutputOmitted === true || summary.apiOutputOmitted === true)
  );
}

function hasPassedApplyPreflight(evidence) {
  const preflight = evidence.applyPreflight;
  return (
    isRecord(preflight) &&
    preflight.status === "passed" &&
    Array.isArray(preflight.blockedReasons) &&
    preflight.blockedReasons.length === 0 &&
    preflight.valuesRedacted === true &&
    preflight.cliSafeToInvoke === true
  );
}

function renderMarkdown(report) {
  const lines = [
    "# UAIS External Storage Vercel Env Sync Evidence Gate",
    "",
    `Status: \`${report.status}\``,
    `Service class: \`${report.approvedServiceClass}\``,
    `Service label: \`${report.approvedRemoteHttpsExternalStorageServiceLabel}\``,
    `Env source label: \`${report.approvedServerOnlyEnvSourceLabel}\``,
    `Operator input required: \`${report.summary.operatorInputRequired}\``,
    `Safe next action: \`${report.safeNextAction}\``,
    `Upstream production evidence required: \`${report.summary.upstreamProductionEvidenceRequired}\``,
    `Upstream auth evidence cleared: \`${report.summary.upstreamAuthEvidenceCleared}\``,
    `External storage readiness may proceed: \`${report.summary.externalStorageReadinessMayProceed}\``,
    `Release ready: \`${report.summary.releaseReady}\``,
    "",
    "## Evidence Status",
    "",
    `- Target: \`${report.vercelEnvSyncEvidenceStatus.target}\``,
    `- Status: \`${report.vercelEnvSyncEvidenceStatus.status}\``,
    `- Apply preflight: \`${report.vercelEnvSyncEvidenceStatus.applyPreflight}\``,
    `- Release run ID: \`${report.vercelEnvSyncEvidenceStatus.releaseRunIdStatus}\``,
    `- Required external-storage env: \`${report.vercelEnvSyncEvidenceStatus.requiredExternalStorageEnvStatus}\``,
    `- Service endpoint: \`${report.vercelEnvSyncEvidenceStatus.serviceEndpointStatus}\``,
    `- Service fingerprint: \`${report.vercelEnvSyncEvidenceStatus.serviceFingerprintStatus}\``,
    `- Database adapter proof: \`${report.vercelEnvSyncEvidenceStatus.databaseAdapterProofStatus}\``,
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
