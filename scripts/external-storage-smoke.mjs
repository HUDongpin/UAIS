#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";

const expectedExternalStorageApiContractVersion = "uais-external-storage-v1";
const externalStorageSmokeUserAgent = "UAIS external storage smoke";
const smokeIdPrefixes = {
  courseId: "uais-external-storage-smoke-course",
  sampleAssetId: "uais-external-storage-smoke-sample",
  pptAssetId: "uais-external-storage-smoke-ppt",
  voiceRefId: "uais-external-storage-smoke-voice-ref",
  audioManifestId: "uais-external-storage-smoke-audio-manifest",
  lifecycleAuditEventId: "uais-external-storage-smoke-audit",
  providerRevocationRequestId: "uais-external-storage-smoke-request",
  unauthenticatedAppendOperationId:
    "uais-external-storage-smoke-unauthenticated-append",
  invalidTokenAppendOperationId:
    "uais-external-storage-smoke-invalid-token-append",
  concurrentAppendOperationId:
    "uais-external-storage-smoke-concurrent-append",
};
const smokeIds = createRunScopedSmokeIds();

const ordinaryTeachingProductionDatabaseAdapterResponseShapeChecks = [
  "teachingOperationsStorageSchema.productionDatabaseAdapter",
  "teachingOperationsStorageSchema.productionDatabaseAdapter.status",
  "teachingOperationsStorageSchema.productionDatabaseAdapter.providerClass",
  "teachingOperationsStorageSchema.productionDatabaseAdapter.migrationStatus",
  "teachingOperationsStorageSchema.productionDatabaseAdapter.backupPolicy",
  "teachingOperationsStorageSchema.productionDatabaseAdapter.concurrencyControl",
  "teachingOperationsStorageSchema.productionDatabaseAdapter.valueRedacted",
  "teachingCourseManagementStorageSchema.productionDatabaseAdapter",
  "teachingCourseManagementStorageSchema.productionDatabaseAdapter.status",
  "teachingCourseManagementStorageSchema.productionDatabaseAdapter.providerClass",
  "teachingCourseManagementStorageSchema.productionDatabaseAdapter.migrationStatus",
  "teachingCourseManagementStorageSchema.productionDatabaseAdapter.backupPolicy",
  "teachingCourseManagementStorageSchema.productionDatabaseAdapter.concurrencyControl",
  "teachingCourseManagementStorageSchema.productionDatabaseAdapter.valueRedacted",
  "teachingCourseAssetsStorageSchema.productionDatabaseAdapter",
  "teachingCourseAssetsStorageSchema.productionDatabaseAdapter.status",
  "teachingCourseAssetsStorageSchema.productionDatabaseAdapter.providerClass",
  "teachingCourseAssetsStorageSchema.productionDatabaseAdapter.migrationStatus",
  "teachingCourseAssetsStorageSchema.productionDatabaseAdapter.backupPolicy",
  "teachingCourseAssetsStorageSchema.productionDatabaseAdapter.concurrencyControl",
  "teachingCourseAssetsStorageSchema.productionDatabaseAdapter.valueRedacted",
];

const baseChecks = [
  {
    id: "s22-external-storage-health",
    endpointTemplate: "/healthz",
    method: "GET",
    expectedStatus: 200,
    responsibleSessions: ["S22", "S12", "S24", "S19"],
    responseShapeChecks: [
      "status",
      "target",
      "apiContractVersion",
      "cacheControlNoStore",
      "durableBackingStore",
      "teachingOperationsStorageSchema",
      "teachingOperationsStorageSchema.status",
      "teachingOperationsStorageSchema.schemaVersion",
      "teachingOperationsStorageSchema.migrationStatus",
      "teachingOperationsStorageSchema.operationLedger",
      "teachingOperationsStorageSchema.auditLedger",
      "teachingOperationsStorageSchema.rollbackLedger",
      "teachingOperationsStorageSchema.backupStore",
      "teachingOperationsStorageSchema.restoreDrillLog",
      "teachingOperationsStorageSchema.concurrencyControl",
      "teachingOperationsStorageSchema.valueRedacted",
      "teachingCourseManagementStorageSchema",
      "teachingCourseManagementStorageSchema.status",
      "teachingCourseManagementStorageSchema.schemaVersion",
      "teachingCourseManagementStorageSchema.migrationStatus",
      "teachingCourseManagementStorageSchema.snapshotStore",
      "teachingCourseManagementStorageSchema.auditLog",
      "teachingCourseManagementStorageSchema.backupStore",
      "teachingCourseManagementStorageSchema.restoreDrillLog",
      "teachingCourseManagementStorageSchema.revisionControl",
      "teachingCourseManagementStorageSchema.concurrencyControl",
      "teachingCourseManagementStorageSchema.valueRedacted",
      "teachingCourseAssetsStorageSchema",
      "teachingCourseAssetsStorageSchema.status",
      "teachingCourseAssetsStorageSchema.schemaVersion",
      "teachingCourseAssetsStorageSchema.migrationStatus",
      "teachingCourseAssetsStorageSchema.snapshotStore",
      "teachingCourseAssetsStorageSchema.auditLog",
      "teachingCourseAssetsStorageSchema.backupStore",
      "teachingCourseAssetsStorageSchema.restoreDrillLog",
      "teachingCourseAssetsStorageSchema.revisionControl",
      "teachingCourseAssetsStorageSchema.concurrencyControl",
      "teachingCourseAssetsStorageSchema.valueRedacted",
      "productionServiceIdentity",
      "redaction",
    ],
  },
  {
    id: "s12-external-teacher-ownership-merge",
    endpointTemplate: "/teacher-ai-ownership/{teacherId}/merge",
    method: "POST",
    expectedStatus: 200,
    responsibleSessions: ["S22", "S12", "S19"],
    responseShapeChecks: ["status", "storageWritePolicy", "redaction"],
  },
  {
    id: "s12-external-teacher-ownership-read",
    endpointTemplate: "/teacher-ai-ownership/{teacherId}",
    method: "GET",
    expectedStatus: 200,
    responsibleSessions: ["S22", "S12", "S19"],
    responseShapeChecks: [
      "teacherId",
      "courseIds",
      "assetCollections",
      "smokeGrantMerged",
      "runScopedSmokeGrant",
      "privateFieldsOmitted",
    ],
  },
  {
    id: "s12-external-course-management-backup-restore-drill",
    endpointTemplate:
      "/teaching-course-management/backups + /teaching-course-management/backups/{backupId}/restore-drill",
    method: "POST",
    expectedStatus: 200,
    responsibleSessions: ["S22", "S12", "S19"],
    responseShapeChecks: [
      "backupStatus",
      "restoreDrillStatus",
      "backupStorageWritePolicy",
      "restoreDrillStorageWritePolicy",
      "redaction",
    ],
  },
  {
    id: "s12-external-course-assets-backup-restore-drill",
    endpointTemplate:
      "/teaching-course-assets/backups + /teaching-course-assets/backups/{backupId}/restore-drill",
    method: "POST",
    expectedStatus: 200,
    responsibleSessions: ["S22", "S12", "S19"],
    responseShapeChecks: [
      "backupStatus",
      "restoreDrillStatus",
      "backupStorageWritePolicy",
      "restoreDrillStorageWritePolicy",
      "redaction",
    ],
  },
  {
    id: "s12-external-teaching-operations-backup-restore-drill",
    endpointTemplate:
      "/teaching-operations/{teacherId}/backups + /teaching-operations/{teacherId}/backups/{backupId}/restore-drill",
    method: "POST",
    expectedStatus: 200,
    responsibleSessions: ["S22", "S12", "S19"],
    responseShapeChecks: [
      "backupStatus",
      "restoreDrillStatus",
      "backupStorageWritePolicy",
      "restoreDrillStorageWritePolicy",
      "redaction",
    ],
  },
  {
    id: "s12-external-teaching-operations-concurrent-append-readback",
    endpointTemplate:
      "/teaching-operations/{teacherId}/append + /teaching-operations/{teacherId}/audit",
    method: "POST",
    expectedStatus: 200,
    responsibleSessions: ["S22", "S12", "S19"],
    responseShapeChecks: [
      "bothAppendsPersisted",
      "appendSequencesReturned",
      "appendSequencesDistinct",
      "auditReadbackReturned",
      "operationRecordsPresent",
      "auditEventsPresent",
      "domainProjectionsPresent",
      "redaction",
    ],
  },
  {
    id: "s12-external-teaching-operations-unauthenticated-append-denied",
    endpointTemplate: "/teaching-operations/{teacherId}/append",
    method: "POST",
    expectedStatus: 401,
    responsibleSessions: ["S22", "S12", "S19"],
    responseShapeChecks: [
      "appendDenied",
      "appendResponseRedacted",
      "auditReadbackReturned",
      "operationRecordAbsent",
      "auditEventAbsent",
    ],
  },
  {
    id: "s12-external-teaching-operations-invalid-token-append-denied",
    endpointTemplate: "/teaching-operations/{teacherId}/append",
    method: "POST",
    expectedStatus: 401,
    responsibleSessions: ["S22", "S12", "S19"],
    responseShapeChecks: [
      "appendDenied",
      "appendResponseRedacted",
      "auditReadbackReturned",
      "operationRecordAbsent",
      "auditEventAbsent",
    ],
  },
  {
    id: "s24-external-lifecycle-audit-append",
    endpointTemplate: "/qwen-voice-lifecycle-audit",
    method: "POST",
    expectedStatus: 200,
    responsibleSessions: ["S22", "S24", "S19"],
    responseShapeChecks: ["status", "provider", "redaction"],
  },
  {
    id: "s24-external-lifecycle-audit-read",
    endpointTemplate: "/qwen-voice-lifecycle-audit",
    method: "GET",
    expectedStatus: 200,
    responsibleSessions: ["S22", "S24", "S19"],
    responseShapeChecks: [
      "provider",
      "eventType",
      "eventsArray",
      "smokeAuditEventPresent",
      "runScopedSmokeAuditEvent",
      "redaction",
    ],
  },
];
const networkRetryPolicy = {
  maxAttempts: 3,
  perAttemptTimeoutMs: 10_000,
  retryOn: ["request-error"],
  valuesRedacted: true,
};

function createChecksForEnvironment(environment) {
  if (!requiresOrdinaryCourseProductionDatabaseAdapterEvidence(environment)) {
    return baseChecks;
  }
  return baseChecks.map((check) => {
    if (check.id !== "s22-external-storage-health") {
      return check;
    }
    return {
      ...check,
      responseShapeChecks: [
        ...check.responseShapeChecks,
        ...ordinaryTeachingProductionDatabaseAdapterResponseShapeChecks,
      ],
    };
  });
}

function requiresOrdinaryCourseProductionDatabaseAdapterEvidence(environment) {
  return environment === "production" || environment === "preview";
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.live && options.approved !== true) {
    throw new Error("External storage smoke checks require explicit owner approval.");
  }
  if (options.live && options.environment === "production" && !hasValue(options.releaseRunId)) {
    throw new Error("External storage smoke checks require --release-run-id.");
  }

  const env = {
    ...process.env,
    ...readEnvFile(options.envFile),
  };
  const mode = options.live ? "live" : "dry-run";
  const baseUrl = options.baseUrl || env.UAIS_EXTERNAL_STORAGE_BASE_URL;
  const accessToken = env.UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN;
  const teacherId = options.teacherId || env.UAIS_EXTERNAL_STORAGE_SMOKE_TEACHER_ID;
  const externalStorageServiceReadiness = readJsonEvidence(
    options.externalStorageServiceReadiness,
  );
  const plan = buildExternalStorageSmokePlan({
    mode,
    environment: options.environment,
    baseUrl,
    accessToken,
    teacherId,
    releaseRunId: options.releaseRunId,
    externalStorageServiceReadiness,
  });

  if (mode === "dry-run") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exit(0);
  }

  if (plan.status === "blocked") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exitCode = 1;
  } else {
    assertLivePrerequisites({ baseUrl, accessToken, teacherId });
    const results = await executeExternalStorageSmoke({
      baseUrl,
      accessToken,
      teacherId,
      checks: plan.checks,
    });
    const status = results.every((result) => result.status === "ok") ? "passed" : "failed";
    process.stdout.write(`${JSON.stringify({ ...plan, status, results }, null, 2)}\n`);
    if (status !== "passed") {
      process.exitCode = 1;
    }
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "External storage smoke failed."}\n`,
  );
  process.exitCode = 1;
}

function buildExternalStorageSmokePlan({
  mode,
  environment,
  baseUrl,
  accessToken,
  teacherId,
  releaseRunId,
  externalStorageServiceReadiness,
}) {
  const storageEndpoint = describeStorageEndpoint(baseUrl);
  const storageServiceFingerprint = createStorageServiceFingerprint(baseUrl);
  const externalStorageServiceReadinessEvidence =
    externalStorageServiceReadiness === undefined &&
    mode === "live" &&
    environment === "production"
      ? {
          target: "missing",
          status: "missing",
          valueRedacted: true,
          releaseRunIdStatus: "missing",
        }
      : evaluateExternalStorageServiceReadinessEvidence({
          evidence: externalStorageServiceReadiness,
          storageServiceFingerprint,
          releaseRunId,
          environment,
        });
  const prerequisites = [
    {
      id: "s19-external-storage-base-url",
      responsibleSession: "S19",
      requiredEnv: "UAIS_EXTERNAL_STORAGE_BASE_URL",
      status: hasValue(baseUrl) ? "present" : "missing",
    },
    {
      id: "s19-external-storage-access-token",
      responsibleSession: "S19",
      requiredEnv: "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
      status: hasValue(accessToken) ? "present" : "missing",
    },
    {
      id: "s22-external-storage-smoke-teacher-id",
      responsibleSession: "S22",
      requiredArg: "--teacher-id",
      status: hasValue(teacherId) ? "present" : "missing",
    },
    ...(externalStorageServiceReadinessEvidence
      ? [
          {
            id: "s22-external-storage-service-readiness-evidence",
            responsibleSession: "S22",
            requiredEvidence: "external-storage-service-readiness",
            status: externalStorageServiceReadinessEvidence.status,
            valueRedacted: true,
          },
        ]
      : []),
  ];
  const blockedReasons = [
    ...prerequisites.flatMap((prerequisite) => {
      if (prerequisite.status !== "missing") {
        return [];
      }
      if (prerequisite.requiredEnv) {
        return [`missing-${prerequisite.requiredEnv}`];
      }
      if (prerequisite.requiredEvidence) {
        return [];
      }
      return ["missing-teacher-id"];
    }),
    ...readProductionEndpointBlockedReasons({ environment, storageEndpoint }),
    ...readExternalStorageServiceReadinessBlockedReasons(
      externalStorageServiceReadinessEvidence,
    ),
  ];

  return {
    target: "external-storage-smoke",
    mode,
    environment,
    network: mode === "live" ? "enabled" : "disabled",
    storageEndpoint,
    storageServiceFingerprint,
    ...(externalStorageServiceReadinessEvidence
      ? { externalStorageServiceReadinessEvidence }
      : {}),
    status: blockedReasons.length === 0 ? "ready" : "blocked",
    responsibleSession: "S22",
    ...(releaseRunId ? { releaseRunId } : {}),
    networkRetryPolicy,
    checks: createChecksForEnvironment(environment),
    prerequisites,
    blockedReasons,
    safety: {
      secretsRedacted: true,
      valuesRedacted: true,
      approvedWriteThenRead: true,
      destructiveWrites: false,
      writePayloadsRedacted: true,
      responseBodiesOmitted: true,
      cookieValuesOmitted: true,
      liveRequiresApproval: true,
      remoteMutationRequiresApproval: true,
    },
  };
}

function readProductionEndpointBlockedReasons({ environment, storageEndpoint }) {
  if (
    environment !== "production" ||
    storageEndpoint.status !== "present" ||
    storageEndpoint.endpointClass === "remote-https"
  ) {
    return [];
  }
  return ["production-external-storage-endpoint-not-remote-https"];
}

function evaluateExternalStorageServiceReadinessEvidence({
  evidence,
  storageServiceFingerprint,
  releaseRunId,
  environment,
}) {
  if (evidence === undefined) {
    return undefined;
  }
  if (!isRecord(evidence)) {
    return {
      target: "missing",
      status: "invalid",
      valueRedacted: true,
      releaseRunIdStatus: "missing",
    };
  }

  const target = typeof evidence.target === "string" ? evidence.target : "missing";
  const summary = {
    target,
    valueRedacted: true,
    releaseRunIdStatus: "missing",
  };
  if (target !== "external-storage-service-readiness") {
    return { ...summary, status: "invalid-target" };
  }
  if (evidence.mode !== "live") {
    return { ...summary, status: "not-live-ready" };
  }
  if (environment === "local-reference") {
    return evaluateLocalReferenceServiceReadinessEvidence({
      evidence,
      summary,
      storageServiceFingerprint,
    });
  }
  if (evidence.status !== "ready") {
    return { ...summary, status: "not-live-ready" };
  }
  if (evidence.environment !== "production") {
    return { ...summary, status: "not-production" };
  }
  if (releaseRunId && evidence.releaseRunId !== releaseRunId) {
    return {
      ...summary,
      status: "release-run-id-mismatch",
      releaseRunIdStatus: "mismatched",
    };
  }

  const readinessFingerprint = readStorageServiceFingerprint(evidence);
  if (!readinessFingerprint) {
    return { ...summary, status: "fingerprint-missing" };
  }
  if (
    storageServiceFingerprint.status !== "present" ||
    typeof storageServiceFingerprint.value !== "string"
  ) {
    return { ...summary, status: "smoke-fingerprint-missing" };
  }
  if (readinessFingerprint !== storageServiceFingerprint.value) {
    return { ...summary, status: "mismatched" };
  }

  const productionLaunchContractEvidence =
    readExternalStorageServiceProductionLaunchContractEvidence(evidence);
  if (
    !isExternalStorageServiceProductionLaunchContractEvidenceProved(
      productionLaunchContractEvidence,
    )
  ) {
    return {
      ...summary,
      status: "launch-contract-not-proven",
      releaseRunIdStatus: releaseRunId ? "matched" : "missing",
      productionLaunchContractEvidence,
    };
  }

  return {
    ...summary,
    status: "matched",
    releaseRunIdStatus: releaseRunId ? "matched" : "missing",
    productionLaunchContractEvidence,
  };
}

function evaluateLocalReferenceServiceReadinessEvidence({
  evidence,
  summary,
  storageServiceFingerprint,
}) {
  if (
    evidence.environment !== "production" &&
    evidence.environment !== "local-production" &&
    evidence.environment !== "local-reference"
  ) {
    return { ...summary, status: "not-local-reference", releaseRunIdStatus: "not-required" };
  }
  if (
    evidence.status !== "ready" &&
    !isBlockedOnlyBecauseReadinessIsLocalReference(evidence)
  ) {
    return { ...summary, status: "not-live-ready", releaseRunIdStatus: "not-required" };
  }

  const readinessFingerprint = readStorageServiceFingerprint(evidence);
  if (!readinessFingerprint) {
    return { ...summary, status: "fingerprint-missing" };
  }
  if (
    storageServiceFingerprint.status !== "present" ||
    typeof storageServiceFingerprint.value !== "string"
  ) {
    return {
      ...summary,
      status: "smoke-fingerprint-missing",
    };
  }
  if (readinessFingerprint !== storageServiceFingerprint.value) {
    return { ...summary, status: "mismatched" };
  }

  const productionLaunchContractEvidence =
    readExternalStorageServiceProductionLaunchContractEvidence(evidence);
  if (
    !isExternalStorageServiceProductionLaunchContractEvidenceProved(
      productionLaunchContractEvidence,
    )
  ) {
    return {
      ...summary,
      status: "launch-contract-not-proven",
      releaseRunIdStatus: "not-required",
      productionLaunchContractEvidence,
    };
  }

  return {
    ...summary,
    status: "local-reference-matched",
    releaseRunIdStatus: "not-required",
    productionLaunchContractEvidence,
  };
}

function isBlockedOnlyBecauseReadinessIsLocalReference(evidence) {
  if (evidence.status !== "blocked" || !Array.isArray(evidence.blockedReasons)) {
    return false;
  }
  return (
    evidence.blockedReasons.length === 1 &&
    evidence.blockedReasons[0] === "external-storage-service-readiness-not-production"
  );
}

function readStorageServiceFingerprint(evidence) {
  if (!isRecord(evidence.storageServiceFingerprint)) {
    return undefined;
  }
  const { storageServiceFingerprint } = evidence;
  if (
    storageServiceFingerprint.status !== "present" ||
    storageServiceFingerprint.source !== "origin" ||
    typeof storageServiceFingerprint.value !== "string"
  ) {
    return undefined;
  }
  return storageServiceFingerprint.value;
}

function readExternalStorageServiceProductionLaunchContractEvidence(evidence) {
  if (!isRecord(evidence.productionLaunchContractEvidence)) {
    return {
      target: "missing",
      status: "missing",
      valueRedacted: true,
      serviceMode: "missing",
      runtime: "missing",
      envContract: "missing",
      dataDirPersistence: "missing",
      containerArtifact: "missing",
      redactionSafety: "missing",
    };
  }
  const guard = evidence.productionLaunchContractEvidence;
  const target =
    guard.target === "external-storage-service-production-launcher"
      ? "external-storage-service-production-launcher"
      : typeof guard.target === "string"
        ? "unexpected"
        : "missing";
  const serviceMode = guard.serviceMode === "production" ? "production" : "missing";
  const runtime = guard.runtime === "proved" ? "proved" : "missing";
  const envContract = guard.envContract === "proved" ? "proved" : "missing";
  const dataDirPersistence =
    guard.dataDirPersistence === "proved" ? "proved" : "missing";
  const containerArtifact =
    guard.containerArtifact === "proved" ? "proved" : "missing";
  const redactionSafety = guard.redactionSafety === "proved" ? "proved" : "missing";
  const ready =
    target === "external-storage-service-production-launcher" &&
    guard.status === "ready" &&
    guard.valueRedacted === true &&
    serviceMode === "production" &&
    runtime === "proved" &&
    envContract === "proved" &&
    dataDirPersistence === "proved" &&
    containerArtifact === "proved" &&
    redactionSafety === "proved";

  return {
    target,
    status: ready ? "ready" : target === "missing" ? "missing" : "not-ready",
    valueRedacted: true,
    serviceMode,
    runtime,
    envContract,
    dataDirPersistence,
    containerArtifact,
    redactionSafety,
  };
}

function isExternalStorageServiceProductionLaunchContractEvidenceProved(evidence) {
  return (
    evidence.target === "external-storage-service-production-launcher" &&
    evidence.status === "ready" &&
    evidence.valueRedacted === true &&
    evidence.serviceMode === "production" &&
    evidence.runtime === "proved" &&
    evidence.envContract === "proved" &&
    evidence.dataDirPersistence === "proved" &&
    evidence.containerArtifact === "proved" &&
    evidence.redactionSafety === "proved"
  );
}

function readExternalStorageServiceReadinessBlockedReasons(evidenceStatus) {
  if (
    !evidenceStatus ||
    evidenceStatus.status === "matched" ||
    evidenceStatus.status === "local-reference-matched"
  ) {
    return [];
  }
  if (evidenceStatus.status === "mismatched") {
    return ["external-storage-service-readiness-fingerprint-mismatch"];
  }
  if (evidenceStatus.status === "launch-contract-not-proven") {
    return ["external-storage-service-readiness-launch-contract-not-proven"];
  }
  return [`external-storage-service-readiness-evidence-${evidenceStatus.status}`];
}

function describeStorageEndpoint(baseUrl) {
  if (!hasValue(baseUrl)) {
    return {
      status: "missing",
      networkClass: "missing",
      endpointClass: "missing",
      valueRedacted: true,
    };
  }
  try {
    const parsed = new URL(baseUrl);
    const networkClass = classifyEndpointHost(parsed.hostname);
    return {
      status: "present",
      networkClass,
      endpointClass: classifyStorageEndpoint({ protocol: parsed.protocol, networkClass }),
      valueRedacted: true,
    };
  } catch {
    return {
      status: "invalid",
      networkClass: "invalid",
      endpointClass: "invalid",
      valueRedacted: true,
    };
  }
}

function createStorageServiceFingerprint(baseUrl) {
  if (!hasValue(baseUrl)) {
    return {
      status: "missing",
      source: "origin",
      valueRedacted: true,
    };
  }
  try {
    const parsed = new URL(baseUrl);
    return {
      status: "present",
      value: `sha256:${createHash("sha256").update(parsed.origin).digest("hex").slice(0, 16)}`,
      source: "origin",
      valueRedacted: true,
    };
  } catch {
    return {
      status: "invalid",
      source: "origin",
      valueRedacted: true,
    };
  }
}

function classifyStorageEndpoint({ protocol, networkClass }) {
  if (networkClass === "local-loopback" || networkClass === "private-network" || networkClass === "invalid") {
    return networkClass;
  }
  if (networkClass !== "remote") {
    return networkClass;
  }
  return protocol === "https:" ? "remote-https" : "insecure-http";
}

function classifyEndpointHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host === "0.0.0.0") {
    return "local-loopback";
  }
  const octets = host.split(".").map((part) => Number(part));
  if (octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    if (octets[0] === 127) {
      return "local-loopback";
    }
    if (
      octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 169 && octets[1] === 254)
    ) {
      return "private-network";
    }
  }
  return "remote";
}

async function executeExternalStorageSmoke({ baseUrl, accessToken, teacherId, checks }) {
  const normalizedBaseUrl = stripTrailingSlashes(baseUrl);
  const results = [];

  for (const check of checks) {
    let networkAttempts;
    try {
      if (isCourseBackupRestoreDrillCheck(check)) {
        results.push(
          await executeCourseBackupRestoreDrillSmokeCheck({
            normalizedBaseUrl,
            accessToken,
            teacherId,
            check,
          }),
        );
        continue;
      }
      if (isConcurrentTeachingOperationAppendCheck(check)) {
        results.push(
          await executeConcurrentTeachingOperationAppendSmokeCheck({
            normalizedBaseUrl,
            accessToken,
            teacherId,
            check,
          }),
        );
        continue;
      }
      if (isUnauthorizedTeachingOperationAppendCheck(check)) {
        results.push(
          await executeUnauthorizedTeachingOperationAppendSmokeCheck({
            normalizedBaseUrl,
            accessToken,
            teacherId,
            check,
          }),
        );
        continue;
      }
      const endpoint = createEndpointForCheck({ check, teacherId });
      const headers = createHeadersForCheck({ check, accessToken });
      const body = createBodyForCheck({ check, teacherId });
      if (body) {
        headers["content-type"] = "application/json";
      }
      const requestResult = await fetchWithNetworkRetry(`${normalizedBaseUrl}${endpoint}`, {
        method: check.method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      networkAttempts = requestResult.networkAttempts;
      if (!requestResult.response) {
        results.push({
          ...check,
          status: "failed",
          error: "request-failed",
          networkAttempts,
          networkError: requestResult.networkError,
        });
        continue;
      }
      const response = requestResult.response;
      const responseShape = await validateResponseShapeForCheck({ check, response });
      results.push({
        ...check,
        status:
          response.status === check.expectedStatus && responseShape.status === "ok"
            ? "ok"
            : "failed",
        httpStatus: response.status,
        responseShape,
        networkAttempts,
      });
    } catch {
      results.push({
        ...check,
        status: "failed",
        error: "request-failed",
        ...(networkAttempts ? { networkAttempts } : {}),
      });
    }
  }

  return results;
}

async function executeConcurrentTeachingOperationAppendSmokeCheck({
  normalizedBaseUrl,
  accessToken,
  teacherId,
  check,
}) {
  const probes = createConcurrentTeachingOperationAppendProbes({ teacherId });
  const appendRequests = await Promise.all(
    probes.map((probe) =>
      fetchWithNetworkRetry(
        `${normalizedBaseUrl}/teaching-operations/${encodeURIComponent(teacherId)}/append`,
        {
          method: "POST",
          headers: {
            ...createAuthorizedJsonHeaders(accessToken),
            "content-type": "application/json",
          },
          body: JSON.stringify(probe.body),
        },
      ),
    ),
  );
  const failedAppendRequest = appendRequests.find((request) => !request.response);
  if (failedAppendRequest) {
    return {
      ...check,
      status: "failed",
      error: "request-failed",
      networkAttempts: {
        appends: appendRequests.map((request) => request.networkAttempts),
        valueRedacted: true,
      },
      networkError: failedAppendRequest.networkError,
    };
  }

  const auditRequest = await fetchWithNetworkRetry(
    `${normalizedBaseUrl}/teaching-operations/${encodeURIComponent(teacherId)}/audit`,
    {
      method: "GET",
      headers: createAuthorizedJsonHeaders(accessToken),
    },
  );
  if (!auditRequest.response) {
    return {
      ...check,
      status: "failed",
      error: "audit-readback-request-failed",
      httpStatus: {
        appends: appendRequests.map((request) => request.response?.status ?? "missing"),
        valueRedacted: true,
      },
      networkAttempts: {
        appends: appendRequests.map((request) => request.networkAttempts),
        auditReadback: auditRequest.networkAttempts,
        valueRedacted: true,
      },
      networkError: auditRequest.networkError,
    };
  }

  const appendResponses = appendRequests.map((request) => request.response);
  const responseShape = await validateConcurrentTeachingOperationAppendShape({
    appendResponses,
    auditResponse: auditRequest.response,
    probes,
  });

  return {
    ...check,
    status:
      appendResponses.every((response) => response.status === check.expectedStatus) &&
      auditRequest.response.status === 200 &&
      responseShape.status === "ok"
        ? "ok"
        : "failed",
    httpStatus: {
      appends: appendResponses.map((response) => response.status),
      auditReadback: auditRequest.response.status,
      valueRedacted: true,
    },
    responseShape,
    networkAttempts: {
      appends: appendRequests.map((request) => request.networkAttempts),
      auditReadback: auditRequest.networkAttempts,
      valueRedacted: true,
    },
  };
}

async function executeUnauthorizedTeachingOperationAppendSmokeCheck({
  normalizedBaseUrl,
  accessToken,
  teacherId,
  check,
}) {
  const probe = createUnauthorizedTeachingOperationAppendProbe({ check, teacherId });
  const appendHeaders = {
    accept: "application/json",
    "content-type": "application/json",
  };
  if (check.id === "s12-external-teaching-operations-invalid-token-append-denied") {
    appendHeaders.authorization = "Bearer invalid-external-storage-smoke-token";
  }

  const appendRequest = await fetchWithNetworkRetry(
    `${normalizedBaseUrl}/teaching-operations/${encodeURIComponent(teacherId)}/append`,
    {
      method: "POST",
      headers: appendHeaders,
      body: JSON.stringify(probe.body),
    },
  );
  if (!appendRequest.response) {
    return {
      ...check,
      status: "failed",
      error: "request-failed",
      networkAttempts: {
        append: appendRequest.networkAttempts,
        valueRedacted: true,
      },
      networkError: appendRequest.networkError,
    };
  }

  const auditRequest = await fetchWithNetworkRetry(
    `${normalizedBaseUrl}/teaching-operations/${encodeURIComponent(teacherId)}/audit`,
    {
      method: "GET",
      headers: createAuthorizedJsonHeaders(accessToken),
    },
  );
  if (!auditRequest.response) {
    return {
      ...check,
      status: "failed",
      error: "audit-readback-request-failed",
      httpStatus: appendRequest.response.status,
      networkAttempts: {
        append: appendRequest.networkAttempts,
        auditReadback: auditRequest.networkAttempts,
        valueRedacted: true,
      },
      networkError: auditRequest.networkError,
    };
  }

  const responseShape = await validateUnauthorizedTeachingOperationAppendShape({
    appendResponse: appendRequest.response,
    auditResponse: auditRequest.response,
    probe,
  });

  return {
    ...check,
    status:
      appendRequest.response.status === check.expectedStatus &&
      auditRequest.response.status === 200 &&
      responseShape.status === "ok"
        ? "ok"
        : "failed",
    httpStatus: {
      append: appendRequest.response.status,
      auditReadback: auditRequest.response.status,
      valueRedacted: true,
    },
    responseShape,
    networkAttempts: {
      append: appendRequest.networkAttempts,
      auditReadback: auditRequest.networkAttempts,
      valueRedacted: true,
    },
  };
}

async function executeCourseBackupRestoreDrillSmokeCheck({
  normalizedBaseUrl,
  accessToken,
  teacherId,
  check,
}) {
  const headers = createHeadersForCheck({ check, accessToken });
  headers["content-type"] = "application/json";
  const backupRequest = await fetchWithNetworkRetry(
    `${normalizedBaseUrl}${createCourseBackupEndpointForCheck(check, teacherId)}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(createCourseBackupBodyForCheck(check)),
    },
  );
  if (!backupRequest.response) {
    return {
      ...check,
      status: "failed",
      error: "request-failed",
      networkAttempts: {
        backup: backupRequest.networkAttempts,
        valueRedacted: true,
      },
      networkError: backupRequest.networkError,
    };
  }

  const backupResponse = backupRequest.response;
  const backupBody = await backupResponse.json().catch(() => undefined);
  const backupId = isRecord(backupBody) && typeof backupBody.backupId === "string"
    ? backupBody.backupId
    : undefined;
  if (!backupId) {
    const responseShape = validateCourseBackupRestoreDrillShape({
      check,
      backupBody,
      restoreBody: undefined,
    });
    return {
      ...check,
      status: "failed",
      httpStatus: backupResponse.status,
      responseShape,
      networkAttempts: {
        backup: backupRequest.networkAttempts,
        valueRedacted: true,
      },
    };
  }

  const restoreRequest = await fetchWithNetworkRetry(
    `${normalizedBaseUrl}${createCourseBackupRestoreDrillEndpointForCheck({
      check,
      teacherId,
      backupId,
    })}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(createCourseBackupRestoreDrillBodyForCheck(check)),
    },
  );
  if (!restoreRequest.response) {
    return {
      ...check,
      status: "failed",
      error: "request-failed",
      httpStatus: backupResponse.status,
      networkAttempts: {
        backup: backupRequest.networkAttempts,
        restoreDrill: restoreRequest.networkAttempts,
        valueRedacted: true,
      },
      networkError: restoreRequest.networkError,
    };
  }

  const restoreResponse = restoreRequest.response;
  const restoreBody = await restoreResponse.json().catch(() => undefined);
  const responseShape = validateCourseBackupRestoreDrillShape({
    check,
    backupBody,
    restoreBody,
  });
  return {
    ...check,
    status:
      backupResponse.status === check.expectedStatus &&
      restoreResponse.status === check.expectedStatus &&
      responseShape.status === "ok"
        ? "ok"
        : "failed",
    httpStatus: {
      backup: backupResponse.status,
      restoreDrill: restoreResponse.status,
      valueRedacted: true,
    },
    responseShape,
    networkAttempts: {
      backup: backupRequest.networkAttempts,
      restoreDrill: restoreRequest.networkAttempts,
      valueRedacted: true,
    },
  };
}

async function fetchWithNetworkRetry(url, init) {
  let lastError;
  for (let attempt = 1; attempt <= networkRetryPolicy.maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(networkRetryPolicy.perAttemptTimeoutMs),
      });
      return {
        response,
        networkAttempts: createNetworkAttempts(attempt),
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    response: undefined,
    networkAttempts: createNetworkAttempts(networkRetryPolicy.maxAttempts),
    networkError: classifyNetworkError(lastError),
  };
}

function createNetworkAttempts(attempted) {
  return {
    attempted,
    maxAttempts: networkRetryPolicy.maxAttempts,
    retried: attempted > 1,
    valueRedacted: true,
  };
}

function classifyNetworkError(error) {
  const errorClass =
    error instanceof Error && hasValue(error.name) ? error.name : "UnknownError";
  return {
    class: sanitizeErrorClass(errorClass),
    valueRedacted: true,
  };
}

function sanitizeErrorClass(value) {
  const normalized = value.trim().replace(/[^A-Za-z0-9_.:-]/g, "-");
  return normalized === "" ? "UnknownError" : normalized.slice(0, 80);
}

function createEndpointForCheck({ check, teacherId }) {
  if (check.id === "s22-external-storage-health") {
    return "/healthz";
  }
  if (check.id === "s12-external-teacher-ownership-merge") {
    return `/teacher-ai-ownership/${encodeURIComponent(teacherId)}/merge`;
  }
  if (check.id === "s12-external-teacher-ownership-read") {
    return `/teacher-ai-ownership/${encodeURIComponent(teacherId)}`;
  }
  return "/qwen-voice-lifecycle-audit";
}

function isCourseBackupRestoreDrillCheck(check) {
  return (
    check.id === "s12-external-course-management-backup-restore-drill" ||
    check.id === "s12-external-course-assets-backup-restore-drill" ||
    check.id === "s12-external-teaching-operations-backup-restore-drill"
  );
}

function isConcurrentTeachingOperationAppendCheck(check) {
  return check.id === "s12-external-teaching-operations-concurrent-append-readback";
}

function isUnauthorizedTeachingOperationAppendCheck(check) {
  return (
    check.id === "s12-external-teaching-operations-unauthenticated-append-denied" ||
    check.id === "s12-external-teaching-operations-invalid-token-append-denied"
  );
}

function createCourseBackupEndpointForCheck(check, teacherId) {
  if (check.id === "s12-external-course-management-backup-restore-drill") {
    return "/teaching-course-management/backups";
  }
  if (check.id === "s12-external-teaching-operations-backup-restore-drill") {
    return `/teaching-operations/${encodeURIComponent(teacherId)}/backups`;
  }
  return "/teaching-course-assets/backups";
}

function createCourseBackupRestoreDrillEndpointForCheck({ check, teacherId, backupId }) {
  const encodedBackupId = encodeURIComponent(backupId);
  if (check.id === "s12-external-course-management-backup-restore-drill") {
    return `/teaching-course-management/backups/${encodedBackupId}/restore-drill`;
  }
  if (check.id === "s12-external-teaching-operations-backup-restore-drill") {
    return `/teaching-operations/${encodeURIComponent(
      teacherId,
    )}/backups/${encodedBackupId}/restore-drill`;
  }
  return `/teaching-course-assets/backups/${encodedBackupId}/restore-drill`;
}

function createHeadersForCheck({ check, accessToken }) {
  const headers = { accept: "application/json" };
  if (check.id !== "s22-external-storage-health") {
    headers.authorization = `${"Bearer"} ${accessToken}`;
  }
  return headers;
}

function createAuthorizedJsonHeaders(accessToken) {
  return {
    accept: "application/json",
    authorization: `${"Bearer"} ${accessToken}`,
  };
}

function createUnauthorizedTeachingOperationAppendProbe({ check, teacherId }) {
  const operationId =
    check.id === "s12-external-teaching-operations-invalid-token-append-denied"
      ? smokeIds.invalidTokenAppendOperationId
      : smokeIds.unauthenticatedAppendOperationId;
  const recordId = `record-${operationId}`;
  const auditId = `audit-${operationId}`;
  const courseId = `${smokeIds.courseId}-auth-denial`;
  const createdAt = "2026-06-25T12:20:00.000Z";

  return {
    operationId,
    recordId,
    auditId,
    body: {
      action: "append-teaching-operation",
      record: {
        recordId,
        operationId,
        actionSlot: "primary",
        actionId: "save-course-settings",
        actorId: teacherId,
        courseId,
        sourceAction: "external-storage-auth-denial-probe",
        idempotencyKey: `idempotency-${operationId}`,
        createdAt,
        status: "persisted",
        storagePolicy: "external-redacted-teaching-operation-append",
        artifacts: [],
        domainProjections: [
          {
            objectId: `settings-${operationId}`,
            objectType: "course-settings",
            courseId,
            operationRecordId: recordId,
            storagePolicy: "domain-projection-teaching-course-settings",
          },
        ],
      },
      auditEvent: {
        auditId,
        traceId: `trace-${operationId}`,
        eventType: "teaching-operation.persisted",
        actorId: teacherId,
        actorRole: "teacher",
        authMode: "signed-teacher-session",
        operationId,
        actionSlot: "primary",
        actionId: "save-course-settings",
        courseId,
        sourceAction: "external-storage-auth-denial-probe",
        requestSource: {
          userAgent: externalStorageSmokeUserAgent,
          ipAddress: "redacted",
        },
        createdAt,
      },
    },
  };
}

function createConcurrentTeachingOperationAppendProbes({ teacherId }) {
  const courseId = `${smokeIds.courseId}-concurrent`;
  const createdAt = "2026-06-25T12:30:00.000Z";
  return ["a", "b"].map((suffix) => {
    const operationId = `${smokeIds.concurrentAppendOperationId}-${suffix}`;
    const recordId = `record-${operationId}`;
    const auditId = `audit-${operationId}`;
    const projectionId = `settings-${operationId}`;
    return {
      operationId,
      recordId,
      auditId,
      projectionId,
      body: {
        action: "append-teaching-operation",
        record: {
          recordId,
          operationId,
          actionSlot: "primary",
          actionId: "save-course-settings",
          actorId: teacherId,
          courseId,
          sourceAction: "external-storage-concurrent-append-probe",
          idempotencyKey: `idempotency-${operationId}`,
          createdAt,
          status: "persisted",
          storagePolicy: "external-redacted-teaching-operation-append",
          artifacts: [],
          domainProjections: [
            {
              objectId: projectionId,
              objectType: "course-settings",
              courseId,
              operationRecordId: recordId,
              storagePolicy: "domain-projection-teaching-course-settings",
            },
          ],
        },
        auditEvent: {
          auditId,
          traceId: `trace-${operationId}`,
          eventType: "teaching-operation.persisted",
          actorId: teacherId,
          actorRole: "teacher",
          authMode: "signed-teacher-session",
          operationId,
          actionSlot: "primary",
          actionId: "save-course-settings",
          courseId,
          sourceAction: "external-storage-concurrent-append-probe",
          requestSource: {
            userAgent: externalStorageSmokeUserAgent,
            ipAddress: "redacted",
          },
          createdAt,
        },
      },
    };
  });
}

function createCourseBackupBodyForCheck(check) {
  if (check.id === "s12-external-course-management-backup-restore-drill") {
    return {
      action: "create-teaching-course-management-backup",
      requestedBy: "s22-external-storage-smoke",
      requestedAt: "2026-06-25T12:00:00.000Z",
      traceId: "trace-external-storage-smoke-course-management-backup",
    };
  }
  if (check.id === "s12-external-teaching-operations-backup-restore-drill") {
    return {
      action: "create-teaching-operation-backup",
      requestedBy: "s22-external-storage-smoke",
      requestedAt: "2026-06-25T12:10:00.000Z",
      traceId: "trace-external-storage-smoke-teaching-operations-backup",
    };
  }
  return {
    action: "create-teaching-course-assets-backup",
    requestedBy: "s22-external-storage-smoke",
    requestedAt: "2026-06-25T12:05:00.000Z",
    traceId: "trace-external-storage-smoke-course-assets-backup",
  };
}

function createCourseBackupRestoreDrillBodyForCheck(check) {
  if (check.id === "s12-external-course-management-backup-restore-drill") {
    return {
      action: "verify-teaching-course-management-backup-restore",
      requestedBy: "s22-external-storage-smoke",
      requestedAt: "2026-06-25T12:01:00.000Z",
      traceId: "trace-external-storage-smoke-course-management-restore-drill",
    };
  }
  if (check.id === "s12-external-teaching-operations-backup-restore-drill") {
    return {
      action: "verify-teaching-operation-backup-restore",
      requestedBy: "s22-external-storage-smoke",
      requestedAt: "2026-06-25T12:11:00.000Z",
      traceId: "trace-external-storage-smoke-teaching-operations-restore-drill",
    };
  }
  return {
    action: "verify-teaching-course-assets-backup-restore",
    requestedBy: "s22-external-storage-smoke",
    requestedAt: "2026-06-25T12:06:00.000Z",
    traceId: "trace-external-storage-smoke-course-assets-restore-drill",
  };
}

function createBodyForCheck({ check, teacherId }) {
  if (check.id === "s12-external-teacher-ownership-merge") {
    return {
      action: "merge-teacher-ai-ownership",
      updatedAt: "2026-06-17T00:00:00.000Z",
      ownership: {
        teacherId,
        courseIds: [smokeIds.courseId],
        sampleAssets: [
          {
            sampleAssetId: smokeIds.sampleAssetId,
            courseId: smokeIds.courseId,
          },
        ],
        pptAssets: [
          {
            pptAssetId: smokeIds.pptAssetId,
            courseId: smokeIds.courseId,
          },
        ],
        clonedVoiceRefs: [
          {
            voiceRefId: smokeIds.voiceRefId,
            sampleAssetId: smokeIds.sampleAssetId,
          },
        ],
        audioManifests: [
          {
            audioManifestId: smokeIds.audioManifestId,
            courseId: smokeIds.courseId,
            pptAssetId: smokeIds.pptAssetId,
            voiceRefId: smokeIds.voiceRefId,
          },
        ],
      },
    };
  }

  if (check.id === "s24-external-lifecycle-audit-append") {
    return {
      eventId: smokeIds.lifecycleAuditEventId,
      eventType: "qwen-voice-lifecycle",
      provider: "qwen",
      providerRole: "voice-clone",
      action: "voice-clone-revoke",
      status: "recorded",
      occurredAt: "2026-06-17T00:01:00.000Z",
      actor: { actorId: teacherId, role: "teacher" },
      resource: {
        teacherId,
        sampleAssetId: smokeIds.sampleAssetId,
        voiceRefId: smokeIds.voiceRefId,
      },
      deletionReason: "owner-request",
      providerRevocation: {
        status: "revoked",
        requestId: smokeIds.providerRevocationRequestId,
      },
      localReference: { status: "deleted" },
      localAuditRecord: {
        auditId: smokeIds.lifecycleAuditEventId,
        storagePolicy: "local-redacted-lifecycle-audit",
      },
      storagePolicy: "append-only-redacted-lifecycle-audit",
      responsibleSession: "S12/S24",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    };
  }

  return undefined;
}

async function validateResponseShapeForCheck({ check, response }) {
  if (check.id === "s22-external-storage-health") {
    return await validateHealthShape(response, {
      requireOrdinaryCourseProductionDatabaseAdapter:
        check.responseShapeChecks.includes(
          "teachingOperationsStorageSchema.productionDatabaseAdapter",
        ),
    });
  }
  if (check.id === "s12-external-teacher-ownership-merge") {
    return await validateTeacherOwnershipMergeShape(response);
  }
  if (check.id === "s12-external-teacher-ownership-read") {
    return await validateTeacherOwnershipShape(response);
  }
  if (check.id === "s24-external-lifecycle-audit-append") {
    return await validateLifecycleAuditAppendShape(response);
  }
  return await validateLifecycleAuditShape(response);
}

async function validateConcurrentTeachingOperationAppendShape({
  appendResponses,
  auditResponse,
  probes,
}) {
  const appendBodies = await Promise.all(
    appendResponses.map((response) => response.json().catch(() => undefined)),
  );
  const auditBody = await auditResponse.json().catch(() => undefined);
  const records =
    isRecord(auditBody) && Array.isArray(auditBody.records) ? auditBody.records : [];
  const auditEvents =
    isRecord(auditBody) && Array.isArray(auditBody.auditEvents)
      ? auditBody.auditEvents
      : isRecord(auditBody) && Array.isArray(auditBody.events)
        ? auditBody.events
        : [];
  const domainProjections =
    isRecord(auditBody) && Array.isArray(auditBody.domainProjections)
      ? auditBody.domainProjections
      : [];
  const appendSequences = appendBodies.flatMap((body) =>
    isRecord(body) && Number.isInteger(body.appendSequence) && body.appendSequence > 0
      ? [body.appendSequence]
      : [],
  );
  const requiredFields = {
    bothAppendsPersisted: probes.every((probe, index) =>
      isPersistedAppendBodyForProbe(appendBodies[index], probe),
    )
      ? "present"
      : "missing",
    appendSequencesReturned:
      appendSequences.length === probes.length ? "present" : "missing",
    appendSequencesDistinct:
      new Set(appendSequences).size === probes.length ? "present" : "missing",
    auditReadbackReturned:
      auditResponse.status === 200 && isRecord(auditBody) ? "present" : "missing",
    operationRecordsPresent: probes.every((probe) =>
      hasTeachingOperationProbeRecord(records, probe),
    )
      ? "present"
      : "missing",
    auditEventsPresent: probes.every((probe) =>
      hasTeachingOperationProbeAuditEvent(auditEvents, probe),
    )
      ? "present"
      : "missing",
    domainProjectionsPresent: probes.every((probe) =>
      hasTeachingOperationProbeDomainProjection(domainProjections, probe),
    )
      ? "present"
      : "missing",
    redaction:
      appendBodies.every((body) => isRecord(body) && hasExpectedRedaction(body.redaction)) &&
      isRecord(auditBody) &&
      hasExpectedRedaction(auditBody.redaction)
        ? "present"
        : "missing",
  };
  return createResponseShape(statusForRequiredFields(requiredFields), requiredFields);
}

function isPersistedAppendBodyForProbe(body, probe) {
  return (
    isRecord(body) &&
    body.receiptId === probe.recordId &&
    body.status === "persisted" &&
    body.idempotencyStatus === "created" &&
    body.storageWritePolicy === "external-append-only-operation-log"
  );
}

function hasTeachingOperationProbeRecord(records, probe) {
  return records.some(
    (record) =>
      isRecord(record) &&
      record.recordId === probe.recordId &&
      record.operationId === probe.operationId,
  );
}

function hasTeachingOperationProbeAuditEvent(events, probe) {
  return events.some(
    (event) =>
      isRecord(event) &&
      event.auditId === probe.auditId &&
      event.operationId === probe.operationId,
  );
}

function hasTeachingOperationProbeDomainProjection(domainProjections, probe) {
  return domainProjections.some(
    (projection) =>
      isRecord(projection) &&
      projection.objectId === probe.projectionId &&
      projection.operationRecordId === probe.recordId,
  );
}

async function validateUnauthorizedTeachingOperationAppendShape({
  appendResponse,
  auditResponse,
  probe,
}) {
  const appendBody = await appendResponse.json().catch(() => undefined);
  const auditBody = await auditResponse.json().catch(() => undefined);
  const records = isRecord(auditBody) && Array.isArray(auditBody.records)
    ? auditBody.records
    : [];
  const auditEvents =
    isRecord(auditBody) && Array.isArray(auditBody.auditEvents)
      ? auditBody.auditEvents
      : isRecord(auditBody) && Array.isArray(auditBody.events)
        ? auditBody.events
        : [];
  const requiredFields = {
    appendDenied: appendResponse.status === 401 ? "present" : "missing",
    appendResponseRedacted: hasExpectedRedaction(appendBody?.redaction)
      ? "present"
      : "missing",
    auditReadbackReturned: auditResponse.status === 200 && isRecord(auditBody)
      ? "present"
      : "missing",
    operationRecordAbsent: records.some((record) =>
      isRecord(record) &&
      (record.operationId === probe.operationId || record.recordId === probe.recordId)
    )
      ? "missing"
      : "present",
    auditEventAbsent: auditEvents.some((event) =>
      isRecord(event) &&
      (event.operationId === probe.operationId || event.auditId === probe.auditId)
    )
      ? "missing"
      : "present",
  };
  return createResponseShape(statusForRequiredFields(requiredFields), requiredFields);
}

async function validateHealthShape(
  response,
  { requireOrdinaryCourseProductionDatabaseAdapter },
) {
  if (!response.ok) {
    return createResponseShape("skipped", {});
  }
  const body = await response.json().catch(() => undefined);
  if (!isRecord(body)) {
    return createResponseShape("failed", {});
  }
  const requiredFields = {
    status: body.status === "ok" ? "present" : "missing",
    target: isAcceptedHealthTarget(body.target) ? "present" : "missing",
    apiContractVersion:
      body.apiContractVersion === expectedExternalStorageApiContractVersion
        ? "present"
        : "missing",
    cacheControlNoStore:
      classifyCacheControlNoStore(response.headers.get("cache-control")) === "no-store"
        ? "present"
        : "missing",
    durableBackingStore: hasReadyDurableBackingStore(body.durableBackingStore)
      ? "present"
      : "missing",
    ...readTeachingOperationsStorageSchemaFields(body.teachingOperationsStorageSchema, {
      requireProductionDatabaseAdapter: requireOrdinaryCourseProductionDatabaseAdapter,
    }),
    ...readSnapshotStorageSchemaFields(
      "teachingCourseManagementStorageSchema",
      body.teachingCourseManagementStorageSchema,
      "uais-teaching-course-management-v1",
      { requireProductionDatabaseAdapter: requireOrdinaryCourseProductionDatabaseAdapter },
    ),
    ...readSnapshotStorageSchemaFields(
      "teachingCourseAssetsStorageSchema",
      body.teachingCourseAssetsStorageSchema,
      "uais-teaching-course-assets-v1",
      { requireProductionDatabaseAdapter: requireOrdinaryCourseProductionDatabaseAdapter },
    ),
    productionServiceIdentity: hasExpectedServiceIdentity(
      body.productionServiceIdentity,
      body.target,
    )
      ? "present"
      : "missing",
    redaction:
      body.redaction?.secrets === "omitted" &&
      body.redaction?.localFiles === "omitted" &&
      body.redaction?.assets === "ids-only"
        ? "present"
        : "missing",
  };
  return createResponseShape(statusForRequiredFields(requiredFields), requiredFields);
}

function classifyCacheControlNoStore(value) {
  if (!hasValue(value)) {
    return "missing";
  }
  const directives = value
    .split(",")
    .map((directive) => directive.trim().toLowerCase())
    .filter(Boolean);
  return directives.includes("no-store") ? "no-store" : "unsafe";
}

function isAcceptedHealthTarget(value) {
  return (
    value === "uais-external-storage-reference-service" ||
    value === "uais-external-storage-production-service"
  );
}

function hasReadyDurableBackingStore(value) {
  return (
    isRecord(value) &&
    value.status === "ready" &&
    value.storageMode === "file-backed" &&
    value.probe === "write-read-delete" &&
    value.ownershipWritePolicy === "external-atomic-merge" &&
    value.lifecycleAuditWritePolicy === "append-only-redacted-lifecycle-audit" &&
    value.valueRedacted === true
  );
}

function readTeachingOperationsStorageSchemaFields(
  value,
  { requireProductionDatabaseAdapter },
) {
  const fields = {
    teachingOperationsStorageSchema: isRecord(value) ? "present" : "missing",
    "teachingOperationsStorageSchema.status": value?.status === "ready" ? "present" : "missing",
    "teachingOperationsStorageSchema.schemaVersion":
      value?.schemaVersion === "uais-teaching-operations-v1" ? "present" : "missing",
    "teachingOperationsStorageSchema.migrationStatus":
      value?.migrationStatus === "up-to-date" ? "present" : "missing",
    "teachingOperationsStorageSchema.operationLedger":
      value?.operationLedger === "jsonl-append-only" ? "present" : "missing",
    "teachingOperationsStorageSchema.auditLedger":
      value?.auditLedger === "jsonl-append-only" ? "present" : "missing",
    "teachingOperationsStorageSchema.rollbackLedger":
      value?.rollbackLedger === "jsonl-append-only" ? "present" : "missing",
    "teachingOperationsStorageSchema.backupStore":
      value?.backupStore === "json-atomic-snapshot" ? "present" : "missing",
    "teachingOperationsStorageSchema.restoreDrillLog":
      value?.restoreDrillLog === "jsonl-append-only" ? "present" : "missing",
    "teachingOperationsStorageSchema.concurrencyControl":
      value?.concurrencyControl === "atomic-append-and-rename" ? "present" : "missing",
    "teachingOperationsStorageSchema.valueRedacted":
      value?.valueRedacted === true ? "present" : "missing",
  };
  if (!requireProductionDatabaseAdapter) {
    return fields;
  }
  return {
    ...fields,
    ...readProductionDatabaseAdapterFields(
      "teachingOperationsStorageSchema.productionDatabaseAdapter",
      value?.productionDatabaseAdapter,
    ),
  };
}

function readSnapshotStorageSchemaFields(
  prefix,
  value,
  expectedSchemaVersion,
  { requireProductionDatabaseAdapter },
) {
  const fields = {
    [prefix]: isRecord(value) ? "present" : "missing",
    [`${prefix}.status`]: value?.status === "ready" ? "present" : "missing",
    [`${prefix}.schemaVersion`]:
      value?.schemaVersion === expectedSchemaVersion ? "present" : "missing",
    [`${prefix}.migrationStatus`]:
      value?.migrationStatus === "up-to-date" ? "present" : "missing",
    [`${prefix}.snapshotStore`]:
      value?.snapshotStore === "json-atomic-snapshot" ? "present" : "missing",
    [`${prefix}.auditLog`]:
      value?.auditLog === "jsonl-append-only" ? "present" : "missing",
    [`${prefix}.backupStore`]:
      value?.backupStore === "json-atomic-snapshot" ? "present" : "missing",
    [`${prefix}.restoreDrillLog`]:
      value?.restoreDrillLog === "jsonl-append-only" ? "present" : "missing",
    [`${prefix}.revisionControl`]:
      value?.revisionControl === "optimistic-revision" ? "present" : "missing",
    [`${prefix}.concurrencyControl`]:
      value?.concurrencyControl === "atomic-rename-with-revision-check"
        ? "present"
        : "missing",
    [`${prefix}.valueRedacted`]: value?.valueRedacted === true ? "present" : "missing",
  };
  if (!requireProductionDatabaseAdapter) {
    return fields;
  }
  return {
    ...fields,
    ...readProductionDatabaseAdapterFields(
      `${prefix}.productionDatabaseAdapter`,
      value?.productionDatabaseAdapter,
    ),
  };
}

function readProductionDatabaseAdapterFields(prefix, value) {
  return {
    [prefix]: isRecord(value) ? "present" : "missing",
    [`${prefix}.status`]: value?.status === "ready" ? "present" : "missing",
    [`${prefix}.providerClass`]:
      value?.providerClass === "managed-database" ? "present" : "missing",
    [`${prefix}.migrationStatus`]:
      value?.migrationStatus === "up-to-date" ? "present" : "missing",
    [`${prefix}.backupPolicy`]:
      value?.backupPolicy === "point-in-time-restore" ? "present" : "missing",
    [`${prefix}.concurrencyControl`]:
      value?.concurrencyControl === "transactional" ? "present" : "missing",
    [`${prefix}.valueRedacted`]: value?.valueRedacted === true ? "present" : "missing",
  };
}

function hasExpectedServiceIdentity(value, target) {
  if (!isRecord(value) || value.serviceTarget !== target || value.valueRedacted !== true) {
    return false;
  }
  if (target === "uais-external-storage-production-service") {
    return value.status === "proved" && value.serviceMode === "production";
  }
  if (target === "uais-external-storage-reference-service") {
    return value.status === "not-production" && value.serviceMode === "reference";
  }
  return false;
}

async function validateTeacherOwnershipMergeShape(response) {
  if (!response.ok) {
    return createResponseShape("skipped", {});
  }
  const body = await response.json().catch(() => undefined);
  if (!isRecord(body)) {
    return createResponseShape("failed", {});
  }
  const requiredFields = {
    status: body.status === "merged" ? "present" : "missing",
    storageWritePolicy:
      body.storageWritePolicy === "external-atomic-merge" ? "present" : "missing",
    redaction: hasExpectedRedaction(body.redaction) ? "present" : "missing",
  };
  return createResponseShape(statusForRequiredFields(requiredFields), requiredFields);
}

async function validateTeacherOwnershipShape(response) {
  if (!response.ok) {
    return createResponseShape("skipped", {});
  }
  const body = await response.json().catch(() => undefined);
  if (!isRecord(body)) {
    return createResponseShape("failed", {});
  }
  const requiredFields = {
    teacherId: typeof body.teacherId === "string" ? "present" : "missing",
    courseIds: Array.isArray(body.courseIds) ? "present" : "missing",
    assetCollections:
      Array.isArray(body.sampleAssets) &&
      Array.isArray(body.pptAssets) &&
      Array.isArray(body.clonedVoiceRefs) &&
      Array.isArray(body.audioManifests)
        ? "present"
        : "missing",
    smokeGrantMerged:
      Array.isArray(body.audioManifests) &&
      body.audioManifests.some(
        (manifest) =>
          isRecord(manifest) && manifest.audioManifestId === smokeIds.audioManifestId,
      )
        ? "present"
        : "missing",
    runScopedSmokeGrant:
      Array.isArray(body.audioManifests) &&
      body.audioManifests.some(
        (manifest) =>
          isRecord(manifest) && manifest.audioManifestId === smokeIds.audioManifestId,
      )
        ? "present"
        : "missing",
    privateFieldsOmitted: "present",
  };
  return createResponseShape(statusForRequiredFields(requiredFields), requiredFields);
}

async function validateLifecycleAuditAppendShape(response) {
  if (!response.ok) {
    return createResponseShape("skipped", {});
  }
  const body = await response.json().catch(() => undefined);
  if (!isRecord(body)) {
    return createResponseShape("failed", {});
  }
  const requiredFields = {
    status: body.status === "recorded" ? "present" : "missing",
    provider: body.provider === "qwen" ? "present" : "missing",
    redaction: hasExpectedRedaction(body.redaction) ? "present" : "missing",
  };
  return createResponseShape(statusForRequiredFields(requiredFields), requiredFields);
}

async function validateLifecycleAuditShape(response) {
  if (!response.ok) {
    return createResponseShape("skipped", {});
  }
  const body = await response.json().catch(() => undefined);
  if (!isRecord(body)) {
    return createResponseShape("failed", {});
  }
  const requiredFields = {
    provider: body.provider === "qwen" ? "present" : "missing",
    eventType: body.eventType === "qwen-voice-lifecycle" ? "present" : "missing",
    eventsArray: Array.isArray(body.events) ? "present" : "missing",
    smokeAuditEventPresent:
      Array.isArray(body.events) &&
      body.events.some(
        (event) => isRecord(event) && event.eventId === smokeIds.lifecycleAuditEventId,
      )
        ? "present"
        : "missing",
    runScopedSmokeAuditEvent:
      Array.isArray(body.events) &&
      body.events.some(
        (event) => isRecord(event) && event.eventId === smokeIds.lifecycleAuditEventId,
      )
        ? "present"
        : "missing",
    redaction: hasExpectedRedaction(body.redaction) ? "present" : "missing",
  };
  return createResponseShape(statusForRequiredFields(requiredFields), requiredFields);
}

function validateCourseBackupRestoreDrillShape({ check, backupBody, restoreBody }) {
  if (!isRecord(backupBody) || !isRecord(restoreBody)) {
    return createResponseShape("failed", {
      backupStatus: isRecord(backupBody) ? "present" : "missing",
      restoreDrillStatus: isRecord(restoreBody) ? "present" : "missing",
    });
  }

  const expected = createExpectedBackupRestoreShapeForCheck(check);
  const requiredFields = {
    backupId: typeof backupBody.backupId === "string" ? "present" : "missing",
    restoreDrillBackupId:
      restoreBody.backupId === backupBody.backupId ? "present" : "missing",
    backupStatus: backupBody.status === "persisted" ? "present" : "missing",
    restoreDrillStatus: restoreBody.status === "verified" ? "present" : "missing",
    backupEventType:
      backupBody.eventType === expected.backupEventType ? "present" : "missing",
    restoreDrillEventType:
      restoreBody.eventType === expected.restoreEventType ? "present" : "missing",
    backupStoragePolicy:
      backupBody.storagePolicy === expected.backupStoragePolicy ? "present" : "missing",
    restoreDrillStoragePolicy:
      restoreBody.storagePolicy === expected.restoreStoragePolicy
        ? "present"
        : "missing",
    backupStorageWritePolicy:
      backupBody.storageWritePolicy === "external-atomic-backup-snapshot"
        ? "present"
        : "missing",
    restoreDrillStorageWritePolicy:
      restoreBody.storageWritePolicy === "external-append-only-restore-drill-log"
        ? "present"
        : "missing",
    sourceRecordCounts: hasExpectedRecordCounts(backupBody.sourceRecordCounts, expected.counts)
      ? "present"
      : "missing",
    restoredRecordCounts: hasExpectedRecordCounts(
      restoreBody.restoredRecordCounts,
      expected.counts,
    )
      ? "present"
      : "missing",
    redaction:
      hasExpectedRedaction(backupBody.redaction) &&
      hasExpectedRedaction(restoreBody.redaction)
        ? "present"
        : "missing",
  };
  return createResponseShape(statusForRequiredFields(requiredFields), requiredFields);
}

function createExpectedBackupRestoreShapeForCheck(check) {
  if (check.id === "s12-external-course-management-backup-restore-drill") {
    return {
      backupEventType: "teaching-course-management-backup.created",
      restoreEventType: "teaching-course-management-backup.restore-drill-verified",
      backupStoragePolicy: "external-redacted-teaching-course-management-backup",
      restoreStoragePolicy: "external-redacted-teaching-course-management-restore-drill",
      counts: ["courses", "classes", "memberships", "auditEvents"],
    };
  }
  if (check.id === "s12-external-teaching-operations-backup-restore-drill") {
    return {
      backupEventType: "teaching-operation-backup.created",
      restoreEventType: "teaching-operation-backup.restore-drill-verified",
      backupStoragePolicy: "external-redacted-teaching-operation-backup",
      restoreStoragePolicy: "external-redacted-teaching-operation-restore-drill",
      counts: ["operations", "auditEvents", "rollbacks", "alertNotifications"],
    };
  }
  return {
    backupEventType: "teaching-course-assets-backup.created",
    restoreEventType: "teaching-course-assets-backup.restore-drill-verified",
    backupStoragePolicy: "external-redacted-teaching-course-assets-backup",
    restoreStoragePolicy: "external-redacted-teaching-course-assets-restore-drill",
    counts: ["assets", "auditEvents"],
  };
}

function hasExpectedRecordCounts(value, keys) {
  return (
    isRecord(value) &&
    keys.every((key) => Number.isInteger(value[key]) && value[key] >= 0)
  );
}

function hasExpectedRedaction(value) {
  return (
    isRecord(value) &&
    value.secrets === "omitted" &&
    value.localFiles === "omitted" &&
    value.assets === "ids-only"
  );
}

function createResponseShape(status, requiredFields) {
  return {
    checked: true,
    status,
    requiredFields,
  };
}

function statusForRequiredFields(requiredFields) {
  return Object.values(requiredFields).every((value) => value === "present")
    ? "ok"
    : "failed";
}

function parseArgs(args) {
  const options = {
    live: false,
    approved: false,
    envFile: undefined,
    baseUrl: undefined,
    teacherId: undefined,
    environment: "unspecified",
    releaseRunId: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      options.live = false;
    } else if (arg === "--live") {
      options.live = true;
    } else if (arg === "--approved") {
      options.approved = true;
    } else if (arg === "--env-file") {
      const envFile = args[index + 1];
      if (!envFile) {
        throw new Error("--env-file requires a path.");
      }
      options.envFile = envFile;
      index += 1;
    } else if (arg === "--base-url") {
      const baseUrl = args[index + 1];
      if (!baseUrl) {
        throw new Error("--base-url requires a URL.");
      }
      options.baseUrl = baseUrl;
      index += 1;
    } else if (arg === "--teacher-id") {
      const teacherId = args[index + 1];
      if (!teacherId) {
        throw new Error("--teacher-id requires an id.");
      }
      options.teacherId = teacherId;
      index += 1;
    } else if (arg === "--release-run-id") {
      const releaseRunId = args[index + 1];
      if (!releaseRunId) {
        throw new Error("--release-run-id requires an id.");
      }
      options.releaseRunId = normalizeReleaseRunId(releaseRunId);
      index += 1;
    } else if (arg === "--external-storage-service-readiness") {
      const evidencePath = args[index + 1];
      if (!evidencePath) {
        throw new Error("--external-storage-service-readiness requires a path.");
      }
      options.externalStorageServiceReadiness = evidencePath;
      index += 1;
    } else if (arg === "--environment") {
      const environment = args[index + 1];
      if (!environment) {
        throw new Error("--environment requires a value.");
      }
      options.environment = normalizeEnvironment(environment);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node -- scripts/external-storage-smoke.mjs [--dry-run] [--live --approved --base-url URL --teacher-id ID] [--environment production|local-reference|preview] [--env-file PATH] [--release-run-id ID] [--external-storage-service-readiness PATH]",
          "",
          "Outputs redacted external storage smoke JSON. Dry-run never uses network; approved live mode writes and reads per-run smoke markers without printing secrets, storage URLs, teacher ids, payloads, marker values, or response bodies.",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error("Unknown option.");
    }
  }

  return options;
}

function normalizeEnvironment(value) {
  const environment = value.trim().toLowerCase();
  if (
    environment !== "production" &&
    environment !== "preview" &&
    environment !== "local-reference" &&
    environment !== "unspecified"
  ) {
    throw new Error("--environment must be production, preview, local-reference, or unspecified.");
  }
  return environment;
}

function normalizeReleaseRunId(value) {
  const releaseRunId = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(releaseRunId)) {
    throw new Error("--release-run-id must be a non-secret release identifier.");
  }
  return releaseRunId;
}

function readEnvFile(envFile) {
  if (!envFile) {
    return {};
  }

  const parsed = {};
  const content = readFileSync(envFile, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (key) {
      parsed[key] = stripQuotes(value);
    }
  }

  return parsed;
}

function readJsonEvidence(evidencePath) {
  if (!evidencePath) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(evidencePath, "utf8"));
  } catch {
    return null;
  }
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function assertLivePrerequisites({ baseUrl, accessToken, teacherId }) {
  if (!hasValue(baseUrl)) {
    throw new Error("External storage smoke requires UAIS_EXTERNAL_STORAGE_BASE_URL or --base-url.");
  }
  if (!hasValue(accessToken)) {
    throw new Error("External storage smoke requires UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN.");
  }
  if (!hasValue(teacherId)) {
    throw new Error("External storage smoke requires --teacher-id.");
  }
}

function hasValue(value) {
  return typeof value === "string" && value.trim() !== "";
}

function stripTrailingSlashes(value) {
  return value.replace(/\/+$/, "");
}

function createRunScopedSmokeIds() {
  const runMarker = randomBytes(6).toString("hex");
  return {
    ...smokeIdPrefixes,
    audioManifestId: `${smokeIdPrefixes.audioManifestId}-${runMarker}`,
    lifecycleAuditEventId: `${smokeIdPrefixes.lifecycleAuditEventId}-${runMarker}`,
    providerRevocationRequestId: `${smokeIdPrefixes.providerRevocationRequestId}-${runMarker}`,
    unauthenticatedAppendOperationId:
      `${smokeIdPrefixes.unauthenticatedAppendOperationId}-${runMarker}`,
    invalidTokenAppendOperationId:
      `${smokeIdPrefixes.invalidTokenAppendOperationId}-${runMarker}`,
    concurrentAppendOperationId:
      `${smokeIdPrefixes.concurrentAppendOperationId}-${runMarker}`,
  };
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
