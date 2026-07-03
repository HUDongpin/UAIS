#!/usr/bin/env node

import { readFileSync } from "node:fs";

const decisionId = "external-storage-production-service";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const ownerResponseValidation = readJsonArg(args, "owner-response-validation");
  const approvalGate = readJsonArg(args, "approval-gate");
  const externalStorageActionPacket = readJsonArg(args, "external-storage-action-packet");
  const appAuthPreflight = args["app-auth-preflight"]
    ? readJsonArg(args, "app-auth-preflight")
    : {};
  const teacherAuthPreflight = args["teacher-auth-preflight"]
    ? readJsonArg(args, "teacher-auth-preflight")
    : {};
  const productionLaunchContract = args["production-launch-contract"]
    ? readJsonArg(args, "production-launch-contract")
    : {};
  const report = buildPreflight({
    ownerResponseValidation,
    approvalGate,
    externalStorageActionPacket,
    appAuthPreflight,
    teacherAuthPreflight,
    productionLaunchContract,
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
  externalStorageActionPacket,
  appAuthPreflight,
  teacherAuthPreflight,
  productionLaunchContract,
}) {
  const ownerResponseAccepted =
    readString(ownerResponseValidation.status, "") === "owner-response-accepted" &&
    ownerResponseValidation.summary?.serviceClassAccepted === true;
  const stages = readRecordArray(approvalGate.stages);
  const externalStorageStage =
    stages.find((stage) => readString(stage.id, "") === decisionId) || {};
  const externalStorageStageAcceptedAwaitingEvidence =
    readString(externalStorageStage.queueStatus, "") === "accepted" &&
    readString(externalStorageStage.currentStatus, "") ===
      "accepted-awaiting-production-evidence" &&
    externalStorageStage.ownerResponseAccepted === true;
  const upstreamAuthEvidenceCleared =
    authEvidenceCleared(appAuthPreflight) && authEvidenceCleared(teacherAuthPreflight);
  const allowedChecks = readStringArray(ownerResponseValidation.postValidationAllowedChecks);
  const s19DryRunMayProceedAfterAuthClears =
    ownerResponseValidation.summary?.s19DryRunMayProceed === true &&
    allowedChecks.includes("prepare-s19-external-storage-env-sync-dry-run-after-auth-clears");
  const s22ReadinessMayProceedAfterEnvSyncLaunchAndPersistenceEvidence =
    ownerResponseValidation.summary?.s22ReadinessMayProceed === true &&
    allowedChecks.includes(
      "prepare-external-storage-readiness-command-after-env-sync-launch-and-persistence-evidence",
    );
  const smokeMayProceedAfterServiceReadiness = allowedChecks.includes(
    "prepare-external-storage-smoke-command-after-service-readiness",
  );
  const liveSmokeStillForbidden =
    ownerResponseValidation.summary?.liveSmokeStillForbidden === true;
  const approvedServiceClass = readString(
    ownerResponseValidation.redactedOwnerResponse?.ownerApprovedServiceClass,
    "unknown",
  );
  const requiredServerOnlyEnvNames = uniqueStrings([
    ...readStringArray(ownerResponseValidation.requiredServerOnlyEnvNames),
    ...readStringArray(externalStorageActionPacket.requiredEnvNames),
  ]);
  const requiredEvidence = uniqueStrings([
    ...readStringArray(externalStorageStage.requiredEvidence),
    ...readStringArray(externalStorageActionPacket.requiredEvidence),
  ]);
  const safeCommandTemplates = buildSafeCommandTemplates(externalStorageActionPacket);
  const provedPrerequisiteEvidence = requiredEvidence.filter((evidence) =>
    isEvidenceCurrentlyProved({ evidence, ownerResponseValidation, productionLaunchContract }),
  );
  const provedSet = new Set(provedPrerequisiteEvidence);
  const missingEvidence = requiredEvidence.filter((evidence) => !provedSet.has(evidence));
  const blockedReasons = [
    ...(!ownerResponseAccepted ? ["external-storage-owner-response-not-accepted"] : []),
    ...(!externalStorageStageAcceptedAwaitingEvidence
      ? ["external-storage-stage-not-accepted-awaiting-production-evidence"]
      : []),
    ...(!upstreamAuthEvidenceCleared
      ? ["upstream-auth-production-evidence-not-cleared"]
      : []),
    ...(!s19DryRunMayProceedAfterAuthClears
      ? ["s19-external-storage-env-sync-dry-run-not-authorized"]
      : []),
    ...(!s22ReadinessMayProceedAfterEnvSyncLaunchAndPersistenceEvidence
      ? ["s22-external-storage-readiness-prep-not-authorized"]
      : []),
    ...(!smokeMayProceedAfterServiceReadiness
      ? ["external-storage-smoke-prep-not-authorized"]
      : []),
    ...(!liveSmokeStillForbidden
      ? ["external-storage-live-smoke-separate-approval-not-confirmed"]
      : []),
    ...missingEvidence.map((evidence) => `${evidence}-missing`),
  ];
  const status =
    ownerResponseAccepted &&
    externalStorageStageAcceptedAwaitingEvidence &&
    s19DryRunMayProceedAfterAuthClears &&
    s22ReadinessMayProceedAfterEnvSyncLaunchAndPersistenceEvidence &&
    smokeMayProceedAfterServiceReadiness &&
    liveSmokeStillForbidden
      ? upstreamAuthEvidenceCleared
        ? "external-storage-production-evidence-preflight-ready"
        : "external-storage-production-evidence-preflight-waiting-for-upstream-auth"
      : "external-storage-production-evidence-preflight-blocked";

  return {
    target: "external-storage-production-evidence-preflight",
    status,
    releaseReady: false,
    responsibleSession: "S19/S22",
    ownerDecisionId: decisionId,
    approvedServiceClass,
    approvedRemoteHttpsExternalStorageServiceLabel: readString(
      ownerResponseValidation.redactedOwnerResponse
        ?.approvedRemoteHttpsExternalStorageServiceLabel,
      "none-recorded",
    ),
    approvedServerOnlyEnvSourceLabel: readString(
      ownerResponseValidation.redactedOwnerResponse?.approvedServerOnlyEnvSourceLabel,
      "none-recorded",
    ),
    approvedReleaseRunIdLabel: readString(
      ownerResponseValidation.redactedOwnerResponse?.approvedReleaseRunIdLabel,
      "none-recorded",
    ),
    approvedSmokeTeacherIdLabel: readString(
      ownerResponseValidation.redactedOwnerResponse?.approvedSmokeTeacherIdLabel,
      "none-recorded",
    ),
    summary: {
      ownerResponseAccepted,
      externalStorageStageAcceptedAwaitingEvidence,
      upstreamAuthEvidenceCleared,
      s19DryRunMayProceedAfterAuthClears,
      s22ReadinessMayProceedAfterEnvSyncLaunchAndPersistenceEvidence,
      smokeMayProceedAfterServiceReadiness,
      liveSmokeStillForbidden,
      requiredServerOnlyEnvNameCount: requiredServerOnlyEnvNames.length,
      requiredEvidenceCount: requiredEvidence.length,
      missingEvidenceCount: missingEvidence.length,
      commandTemplateCount: Object.keys(safeCommandTemplates).length,
      releaseReady: false,
    },
    upstreamBlockers: upstreamAuthEvidenceCleared
      ? []
      : ["app-auth-production-evidence-missing", "teacher-auth-production-evidence-missing"],
    requiredServerOnlyEnvNames,
    requiredEvidence,
    provedPrerequisiteEvidence,
    missingEvidence,
    blockedReasons,
    safeCommandTemplates,
    safeNextActions: uniqueStrings(readStringArray(externalStorageActionPacket.safeNextActions)),
    forbiddenUntilEvidenceExists: uniqueStrings([
      ...readStringArray(ownerResponseValidation.stillForbiddenUntilSeparateApproval),
      ...readStringArray(externalStorageActionPacket.forbiddenUntilApproved),
    ]),
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmittedFromMarkdown: true,
      endpointValuesOmitted: true,
      credentialValuesOmitted: true,
      responseBodiesOmitted: true,
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

function authEvidenceCleared(preflight) {
  return (
    readString(preflight.status, "").includes("ready") &&
    preflight.releaseReady === true &&
    preflight.summary?.missingEvidenceCount === 0
  );
}

function isEvidenceCurrentlyProved({
  evidence,
  ownerResponseValidation,
  productionLaunchContract,
}) {
  if (evidence === "approved-remote-https-external-storage-service") {
    return (
      readString(ownerResponseValidation.status, "") === "owner-response-accepted" &&
      ownerResponseValidation.summary?.serviceClassAccepted === true &&
      ownerResponseValidation.redactedOwnerResponse?.confirmsRemoteHttpsServiceApproved !== false
    );
  }

  if (evidence === "external-storage-production-launch-contract") {
    return (
      readString(productionLaunchContract.target, "") ===
        "external-storage-service-production-launcher" &&
      readString(productionLaunchContract.status, "") === "ready" &&
      productionLaunchContract.safety?.accessTokenOmitted === true
    );
  }

  return false;
}

function buildSafeCommandTemplates(externalStorageActionPacket) {
  const commands = isRecord(externalStorageActionPacket.commands)
    ? externalStorageActionPacket.commands
    : {};
  return {
    vercelEnvSyncDryRun:
      typeof commands.vercelEnvSyncDryRun === "string"
        ? commands.vercelEnvSyncDryRun
        : "node scripts/vercel-env-sync.mjs --dry-run --scope external-storage --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <external-storage-vercel-env-sync-dry-run-evidence>",
    externalStoragePersistence:
      typeof commands.externalStoragePersistence === "string"
        ? commands.externalStoragePersistence
        : "node scripts/external-storage-persistence-smoke.mjs --live --approved --environment production --env-file <approved-env-file> --release-run-id <release-run-id> > <external-storage-persistence-evidence>",
    externalStorageReadiness:
      typeof commands.externalStorageReadinessLive === "string"
        ? commands.externalStorageReadinessLive
        : "node scripts/external-storage-service-readiness.mjs --live --approved --environment production --env-file <approved-env-file> --release-run-id <release-run-id> --vercel-env-sync <external-storage-vercel-env-sync-evidence> --external-storage-production-launch-contract <external-storage-production-launch-contract-evidence> --external-storage-persistence <external-storage-persistence-evidence> > <external-storage-service-readiness-evidence>",
    externalStorageSmoke:
      typeof commands.externalStorageSmokeLive === "string"
        ? commands.externalStorageSmokeLive
        : "node scripts/external-storage-smoke.mjs --live --approved --environment production --env-file <approved-env-file> --teacher-id <approved-smoke-teacher-id> --release-run-id <release-run-id> --external-storage-service-readiness <external-storage-service-readiness-evidence> > <external-storage-smoke-evidence>",
  };
}

function renderMarkdown(report) {
  const lines = [
    "# UAIS External Storage Production Evidence Preflight",
    "",
    `Status: \`${report.status}\``,
    `Release ready: \`${report.releaseReady}\``,
    `Owner decision: \`${report.ownerDecisionId}\``,
    `Approved service class: \`${report.approvedServiceClass}\``,
    `Upstream auth evidence cleared: \`${report.summary.upstreamAuthEvidenceCleared}\``,
    `S19 dry-run may proceed after auth clears: \`${report.summary.s19DryRunMayProceedAfterAuthClears}\``,
    `S22 readiness may proceed after env sync, launch, and persistence evidence: \`${report.summary.s22ReadinessMayProceedAfterEnvSyncLaunchAndPersistenceEvidence}\``,
    `External-storage live smoke still forbidden: \`${report.summary.liveSmokeStillForbidden}\``,
    `Missing evidence: ${report.summary.missingEvidenceCount}`,
    "",
    "This preflight reads only existing redacted coordination reports. It does not read env files, print labels, call Vercel, call external-storage endpoints, perform remote writes, run live readiness or smoke, deploy, or bind a release run.",
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
    report.safeCommandTemplates.vercelEnvSyncDryRun,
    report.safeCommandTemplates.externalStoragePersistence,
    report.safeCommandTemplates.externalStorageReadiness,
    report.safeCommandTemplates.externalStorageSmoke,
    "```",
  ];

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
