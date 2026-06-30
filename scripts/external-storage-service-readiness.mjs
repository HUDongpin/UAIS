#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const expectedExternalStorageApiContractVersion = "uais-external-storage-v1";
const healthCheck = {
  id: "s22-external-storage-service-health",
  endpointTemplate: "/healthz",
  method: "GET",
  expectedStatus: 200,
  responsibleSessions: ["S22", "S12", "S19", "S24"],
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
    "teachingOperationsStorageSchema.productionDatabaseAdapter",
    "teachingOperationsStorageSchema.productionDatabaseAdapter.status",
    "teachingOperationsStorageSchema.productionDatabaseAdapter.providerClass",
    "teachingOperationsStorageSchema.productionDatabaseAdapter.migrationStatus",
    "teachingOperationsStorageSchema.productionDatabaseAdapter.backupPolicy",
    "teachingOperationsStorageSchema.productionDatabaseAdapter.concurrencyControl",
    "teachingOperationsStorageSchema.productionDatabaseAdapter.valueRedacted",
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
    "teachingCourseManagementStorageSchema.productionDatabaseAdapter",
    "teachingCourseManagementStorageSchema.productionDatabaseAdapter.status",
    "teachingCourseManagementStorageSchema.productionDatabaseAdapter.providerClass",
    "teachingCourseManagementStorageSchema.productionDatabaseAdapter.migrationStatus",
    "teachingCourseManagementStorageSchema.productionDatabaseAdapter.backupPolicy",
    "teachingCourseManagementStorageSchema.productionDatabaseAdapter.concurrencyControl",
    "teachingCourseManagementStorageSchema.productionDatabaseAdapter.valueRedacted",
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
    "teachingCourseAssetsStorageSchema.productionDatabaseAdapter",
    "teachingCourseAssetsStorageSchema.productionDatabaseAdapter.status",
    "teachingCourseAssetsStorageSchema.productionDatabaseAdapter.providerClass",
    "teachingCourseAssetsStorageSchema.productionDatabaseAdapter.migrationStatus",
    "teachingCourseAssetsStorageSchema.productionDatabaseAdapter.backupPolicy",
    "teachingCourseAssetsStorageSchema.productionDatabaseAdapter.concurrencyControl",
    "teachingCourseAssetsStorageSchema.productionDatabaseAdapter.valueRedacted",
    "teachingCourseAssetsStorageSchema.valueRedacted",
    "productionServiceIdentity",
    "redaction",
  ],
};
const networkRetryPolicy = {
  maxAttempts: 3,
  perAttemptTimeoutMs: 10_000,
  retryOn: ["request-error"],
  valuesRedacted: true,
};
const externalStorageServiceReadinessResultKeys = [
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

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.live && options.approved !== true) {
    throw new Error("External storage service readiness requires explicit owner approval.");
  }

  const env = {
    ...process.env,
    ...readEnvFile(options.envFile),
  };
  const mode = options.live ? "live" : "dry-run";
  const baseUrl = options.baseUrl || env.UAIS_EXTERNAL_STORAGE_BASE_URL;
  const vercelEnvSync = readJsonEvidence(options.vercelEnvSync);
  const productionLaunchContract = readJsonEvidence(
    options.externalStorageProductionLaunchContract,
  );
  const persistence = readJsonEvidence(options.externalStoragePersistence);
  const plan = buildExternalStorageServiceReadinessPlan({
    mode,
    environment: options.environment,
    baseUrl,
    releaseRunId: normalizeReleaseRunId(options.releaseRunId),
    vercelEnvSync,
    productionLaunchContract,
    persistence,
  });

  if (mode === "dry-run") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exit(0);
  }

  if (plan.status === "blocked" && shouldSkipLiveHealth(plan)) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exitCode = 1;
  } else {
    const health = await readHealth(baseUrl);
    const blockedReasons = dedupeBlockedReasons([
      ...plan.blockedReasons,
      ...evaluateHealthBlockedReasons(health),
    ]);
    const status = blockedReasons.length === 0 ? "ready" : "blocked";
    const evidence = withExternalStorageServiceReadinessResults({
      ...plan,
      status,
      health,
      blockedReasons,
    });
    process.stdout.write(
      `${JSON.stringify(
        evidence,
        null,
        2,
      )}\n`,
    );
    if (status !== "ready") {
      process.exitCode = 1;
    }
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "External storage service readiness failed."}\n`,
  );
  process.exitCode = 1;
}

function shouldSkipLiveHealth(plan) {
  const diagnosticOnlyBlockedReasons = new Set([
    "external-storage-service-readiness-not-production",
  ]);
  return plan.blockedReasons.some((reason) => !diagnosticOnlyBlockedReasons.has(reason));
}

function dedupeBlockedReasons(blockedReasons) {
  return [...new Set(blockedReasons)];
}

function buildExternalStorageServiceReadinessPlan({
  mode,
  environment,
  baseUrl,
  releaseRunId,
  vercelEnvSync,
  productionLaunchContract,
  persistence,
}) {
  const storageEndpoint = describeStorageEndpoint(baseUrl);
  const storageServiceFingerprint = createStorageServiceFingerprint(baseUrl);
  const vercelEnvSyncEvidence = evaluateVercelEnvSyncEvidence({
    evidence: vercelEnvSync,
    storageServiceFingerprint,
    releaseRunId,
    required: mode === "live" && environment === "production",
  });
  const productionLaunchContractEvidence = evaluateProductionLaunchContractEvidence({
    evidence: productionLaunchContract,
    required:
      mode === "live" &&
      environment === "production" &&
      vercelEnvSyncEvidence?.status === "matched",
  });
  const persistenceEvidence = evaluatePersistenceEvidence({
    evidence: persistence,
    storageServiceFingerprint,
    releaseRunId,
    required:
      mode === "live" &&
      environment === "production" &&
      vercelEnvSyncEvidence?.status === "matched" &&
      productionLaunchContractEvidence?.status === "ready",
  });
  const prerequisites = [
    {
      id: "s19-external-storage-base-url",
      responsibleSession: "S19",
      requiredEnv: "UAIS_EXTERNAL_STORAGE_BASE_URL",
      status: hasValue(baseUrl) ? "present" : "missing",
    },
    ...(vercelEnvSyncEvidence
      ? [
          {
            id: "s19-vercel-env-sync-apply-evidence",
            responsibleSession: "S19",
            requiredEvidence: "vercel-env-sync",
            status: vercelEnvSyncEvidence.status,
            valueRedacted: true,
          },
        ]
      : []),
    ...(productionLaunchContractEvidence
      ? [
          {
            id: "s22-external-storage-production-launch-contract",
            responsibleSession: "S22",
            requiredEvidence: "external-storage-service-production-launcher",
            status: productionLaunchContractEvidence.status,
            valueRedacted: true,
          },
        ]
      : []),
    ...(persistenceEvidence
      ? [
          {
            id: "s22-external-storage-persistence-evidence",
            responsibleSession: "S22",
            requiredEvidence: "external-storage-persistence",
            status: persistenceEvidence.status,
            valueRedacted: true,
          },
        ]
      : []),
  ];
  const blockedReasons = [
    ...(mode === "live" && environment !== "production"
      ? ["external-storage-service-readiness-not-production"]
      : []),
    ...prerequisites.flatMap((prerequisite) =>
      prerequisite.requiredEnv && prerequisite.status === "missing"
        ? [`missing-${prerequisite.requiredEnv}`]
        : [],
    ),
    ...readProductionEndpointBlockedReasons({ environment, storageEndpoint }),
    ...readVercelEnvSyncBlockedReasons(vercelEnvSyncEvidence),
    ...readProductionLaunchContractBlockedReasons(productionLaunchContractEvidence),
    ...readPersistenceBlockedReasons(persistenceEvidence),
    ...(mode === "dry-run" ? ["external-storage-service-live-readiness-not-run"] : []),
  ];

  const safety = {
    valuesRedacted: true,
    serviceUrlOmitted: true,
    responseBodiesOmitted: true,
    localPrivatePathsOmitted: true,
    cookieValuesOmitted: true,
    liveRequiresApproval: true,
    remoteMutationRequiresApproval: true,
    noWriteOperations: true,
  };

  return withExternalStorageServiceReadinessResults({
    target: "external-storage-service-readiness",
    mode,
    environment,
    network: mode === "live" ? "enabled" : "disabled",
    storageEndpoint,
    storageServiceFingerprint,
    ...(vercelEnvSyncEvidence ? { vercelEnvSyncEvidence } : {}),
    ...(productionLaunchContractEvidence
      ? { productionLaunchContractEvidence }
      : {}),
    ...(persistenceEvidence ? { persistenceEvidence } : {}),
    status: blockedReasons.length === 0 ? "ready" : "blocked",
    ...(releaseRunId ? { releaseRunId } : {}),
    responsibleSession: "S22",
    networkRetryPolicy,
    checks: [healthCheck],
    prerequisites,
    blockedReasons,
    safety,
  });
}

function withExternalStorageServiceReadinessResults(evidence) {
  return {
    ...evidence,
    results: buildExternalStorageServiceReadinessResults(evidence),
  };
}

function buildExternalStorageServiceReadinessResults(evidence) {
  const teachingOperationsSchemaReady = isExternalStorageTeachingOperationsSchemaProved(
    evidence.health,
  );
  const teachingCourseManagementSchemaReady =
    isExternalStorageTeachingCourseManagementSchemaProved(evidence.health);
  const teachingCourseAssetsSchemaReady = isExternalStorageTeachingCourseAssetsSchemaProved(
    evidence.health,
  );

  return {
    [externalStorageServiceReadinessResultKeys[0]]: resultStatus(
      evidence.storageEndpoint?.endpointClass === "remote-https",
    ),
    [externalStorageServiceReadinessResultKeys[1]]: resultStatus(
      isExternalStorageHealthContractProved(evidence.health),
    ),
    externalStorageOrdinaryTeachingSchemas: resultStatus(
      areExternalStorageOrdinaryTeachingSchemasProved(evidence.health),
    ),
    externalStorageTeachingOperationsSchema: resultStatus(teachingOperationsSchemaReady),
    externalStorageTeachingCourseManagementSchema: resultStatus(
      teachingCourseManagementSchemaReady,
    ),
    externalStorageTeachingCourseAssetsSchema: resultStatus(
      teachingCourseAssetsSchemaReady,
    ),
    externalStorageVercelEnvSync: resultStatus(
      isExternalStorageVercelEnvSyncProved(evidence.vercelEnvSyncEvidence),
    ),
    externalStorageProductionLaunchContract: resultStatus(
      isExternalStorageProductionLaunchContractProved(
        evidence.productionLaunchContractEvidence,
      ),
    ),
    externalStoragePersistenceEvidence: resultStatus(
      isExternalStoragePersistenceEvidenceProved(evidence.persistenceEvidence),
    ),
    externalStorageReadinessSafety: resultStatus(
      isExternalStorageReadinessSafetyProved(evidence.safety),
    ),
  };
}

function resultStatus(proved) {
  return proved ? "passed" : "blocked";
}

function isExternalStorageHealthContractProved(health) {
  return health?.httpStatus === 200 &&
    health.status === "ok" &&
    health.target === "uais-external-storage-production-service" &&
    health.cacheControl === "no-store" &&
    health.productionServiceIdentity === "proved" &&
    health.apiContractVersion === "matched" &&
    health.durableBackingStore === "ready" &&
    health.redaction === "present";
}

function areExternalStorageOrdinaryTeachingSchemasProved(health) {
  return (
    isExternalStorageTeachingOperationsSchemaProved(health) &&
    isExternalStorageTeachingCourseManagementSchemaProved(health) &&
    isExternalStorageTeachingCourseAssetsSchemaProved(health)
  );
}

function isExternalStorageTeachingOperationsSchemaProved(health) {
  return Boolean(health) &&
    isTeachingOperationsStorageSchemaHealthReady(
      health.teachingOperationsStorageSchema,
    ) &&
    isProductionDatabaseAdapterHealthReady(
      health.teachingOperationsStorageSchema?.productionDatabaseAdapter,
    );
}

function isExternalStorageTeachingCourseManagementSchemaProved(health) {
  return Boolean(health) &&
    isSnapshotStorageSchemaHealthReady({
      schema: health.teachingCourseManagementStorageSchema,
      schemaVersion: "matched",
    }) &&
    isProductionDatabaseAdapterHealthReady(
      health.teachingCourseManagementStorageSchema?.productionDatabaseAdapter,
    );
}

function isExternalStorageTeachingCourseAssetsSchemaProved(health) {
  return Boolean(health) &&
    isSnapshotStorageSchemaHealthReady({
      schema: health.teachingCourseAssetsStorageSchema,
      schemaVersion: "matched",
    }) &&
    isProductionDatabaseAdapterHealthReady(
      health.teachingCourseAssetsStorageSchema?.productionDatabaseAdapter,
    );
}

function isExternalStorageVercelEnvSyncProved(evidence) {
  return evidence?.target === "vercel-env-sync" &&
    evidence.status === "matched" &&
    evidence.applyPreflight === "proved" &&
    evidence.releaseRunIdStatus === "matched" &&
    evidence.valueRedacted === true;
}

function isExternalStorageProductionLaunchContractProved(evidence) {
  return evidence?.target === "external-storage-service-production-launcher" &&
    evidence.status === "ready" &&
    evidence.valueRedacted === true &&
    evidence.serviceMode === "production" &&
    evidence.runtime === "proved" &&
    evidence.envContract === "proved" &&
    evidence.dataDirPersistence === "proved" &&
    evidence.containerArtifact === "proved" &&
    evidence.redactionSafety === "proved";
}

function isExternalStoragePersistenceEvidenceProved(evidence) {
  return evidence?.target === "external-storage-persistence" &&
    evidence.status === "matched" &&
    evidence.releaseRunIdStatus === "matched" &&
    evidence.valueRedacted === true;
}

function isExternalStorageReadinessSafetyProved(safety) {
  return safety?.valuesRedacted === true &&
    safety.serviceUrlOmitted === true &&
    safety.responseBodiesOmitted === true &&
    safety.localPrivatePathsOmitted === true &&
    safety.cookieValuesOmitted === true &&
    safety.liveRequiresApproval === true &&
    safety.remoteMutationRequiresApproval === true &&
    safety.noWriteOperations === true;
}

function evaluateProductionLaunchContractEvidence({ evidence, required }) {
  if (evidence === undefined) {
    return required
      ? {
          target: "missing",
          status: "missing",
          valueRedacted: true,
          serviceMode: "missing",
          runtime: "missing",
          envContract: "missing",
          dataDirPersistence: "missing",
          containerArtifact: "missing",
          redactionSafety: "missing",
        }
      : undefined;
  }
  if (!isRecord(evidence)) {
    return {
      target: "missing",
      status: "invalid",
      valueRedacted: true,
      serviceMode: "missing",
      runtime: "missing",
      envContract: "missing",
      dataDirPersistence: "missing",
      containerArtifact: "missing",
      redactionSafety: "missing",
    };
  }

  const runtime = isRecord(evidence.runtime) ? evidence.runtime : {};
  const launch = isRecord(evidence.launch) ? evidence.launch : {};
  const artifact = isRecord(evidence.containerArtifact) ? evidence.containerArtifact : {};
  const requiredEnv = Array.isArray(evidence.requiredEnv) ? evidence.requiredEnv : [];
  const accessToken = requiredEnv.find(
    (entry) => isRecord(entry) && entry.name === "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
  );
  const dataDir = requiredEnv.find(
    (entry) => isRecord(entry) && entry.name === "UAIS_EXTERNAL_STORAGE_DATA_DIR",
  );
  const databaseAdapterProviderClass = readExpectedRequiredEnvValue(
    requiredEnv,
    "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS",
    "managed-database",
  );
  const databaseAdapterMigrationStatus = readExpectedRequiredEnvValue(
    requiredEnv,
    "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS",
    "up-to-date",
  );
  const databaseAdapterBackupPolicy = readExpectedRequiredEnvValue(
    requiredEnv,
    "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY",
    "point-in-time-restore",
  );
  const databaseAdapterConcurrencyControl = readExpectedRequiredEnvValue(
    requiredEnv,
    "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL",
    "transactional",
  );
  const safety = isRecord(evidence.safety) ? evidence.safety : {};
  const runtimeStatus =
    runtime.node === "required" &&
    runtime.longRunningProcess === true &&
    runtime.healthEndpoint === "/healthz" &&
    runtime.serviceTarget === "uais-external-storage-production-service"
      ? "proved"
      : "missing";
  const envContract =
    isRecord(accessToken) &&
    accessToken.status === "present" &&
    accessToken.strength === "sufficient" &&
    isRecord(dataDir) &&
    dataDir.status === "present" &&
    databaseAdapterProviderClass === "present-managed-database" &&
    databaseAdapterMigrationStatus === "present-up-to-date" &&
    databaseAdapterBackupPolicy === "present-point-in-time-restore" &&
    databaseAdapterConcurrencyControl === "present-transactional"
      ? "proved"
      : "missing";
  const dataDirPersistence =
    launch.dataDirPersistence === "persistent-volume" ? "proved" : "missing";
  const containerArtifact =
    artifact.dockerfile === "Dockerfile.external-storage" &&
    artifact.dockerignore === ".dockerignore" &&
    artifact.persistentVolumePath === "/data/uais-external-storage" &&
    artifact.imageSecretsPolicy === "env-only-at-runtime"
      ? "proved"
      : "missing";
  const redactionSafety =
    safety.accessTokenOmitted === true &&
    safety.dataDirOmitted === true &&
    safety.localPrivatePathsOmitted === true &&
    safety.startupOutputRedacted === true &&
    safety.productionServiceModeForced === true
      ? "proved"
      : "missing";
  const target =
    evidence.target === "external-storage-service-production-launcher"
      ? "external-storage-service-production-launcher"
      : typeof evidence.target === "string"
        ? "unexpected"
        : "missing";
  const serviceMode = evidence.serviceMode === "production" ? "production" : "missing";
  const ready =
    target === "external-storage-service-production-launcher" &&
    evidence.mode === "dry-run" &&
    evidence.status === "ready" &&
    serviceMode === "production" &&
    runtimeStatus === "proved" &&
    envContract === "proved" &&
    dataDirPersistence === "proved" &&
    containerArtifact === "proved" &&
    redactionSafety === "proved";

  return {
    target,
    status: ready ? "ready" : "not-ready",
    valueRedacted: true,
    serviceMode,
    runtime: runtimeStatus,
    envContract,
    dataDirPersistence,
    containerArtifact,
    redactionSafety,
  };
}

function readExpectedRequiredEnvValue(entries, name, expected) {
  const entry = entries.find((value) => isRecord(value) && value.name === name);
  if (!isRecord(entry) || entry.status !== "present") {
    return "missing";
  }
  return entry.expected === expected ? `present-${expected}` : "present-invalid";
}

function readProductionLaunchContractBlockedReasons(evidenceStatus) {
  if (!evidenceStatus || evidenceStatus.status === "ready") {
    return [];
  }
  if (evidenceStatus.status === "missing") {
    return ["external-storage-production-launch-contract-missing"];
  }
  return ["external-storage-production-launch-contract-not-ready"];
}

function evaluatePersistenceEvidence({
  evidence,
  storageServiceFingerprint,
  releaseRunId,
  required,
}) {
  if (evidence === undefined) {
    return required
      ? {
          target: "missing",
          status: "missing",
          valueRedacted: true,
          releaseRunIdStatus: "missing",
        }
      : undefined;
  }
  if (!isRecord(evidence)) {
    return {
      target: "missing",
      status: "invalid",
      valueRedacted: true,
      releaseRunIdStatus: "missing",
    };
  }

  const target =
    evidence.target === "external-storage-persistence"
      ? "external-storage-persistence"
      : typeof evidence.target === "string"
        ? "unexpected"
        : "missing";
  const summary = {
    target,
    valueRedacted: true,
    releaseRunIdStatus: "missing",
  };
  if (target !== "external-storage-persistence") {
    return { ...summary, status: "invalid-target" };
  }
  if (
    evidence.mode !== "live" ||
    evidence.environment !== "production" ||
    evidence.phase !== "read" ||
    evidence.status !== "passed"
  ) {
    return { ...summary, status: "not-passed" };
  }
  if (releaseRunId && evidence.releaseRunId !== releaseRunId) {
    return {
      ...summary,
      status: "release-run-id-mismatch",
      releaseRunIdStatus: evidence.releaseRunId ? "mismatched" : "missing",
    };
  }

  const endpoint = isRecord(evidence.storageEndpoint) ? evidence.storageEndpoint : {};
  if (endpoint.endpointClass !== "remote-https") {
    return { ...summary, status: "not-production" };
  }

  const evidenceFingerprint = readPersistenceStorageServiceFingerprint(evidence);
  if (!evidenceFingerprint) {
    return {
      ...summary,
      status: "fingerprint-missing",
      releaseRunIdStatus: releaseRunId ? "matched" : "missing",
    };
  }
  if (
    storageServiceFingerprint.status !== "present" ||
    typeof storageServiceFingerprint.value !== "string"
  ) {
    return {
      ...summary,
      status: "readiness-fingerprint-missing",
      releaseRunIdStatus: releaseRunId ? "matched" : "missing",
    };
  }
  if (evidenceFingerprint !== storageServiceFingerprint.value) {
    return {
      ...summary,
      status: "mismatched",
      releaseRunIdStatus: releaseRunId ? "matched" : "missing",
    };
  }
  if (!hasPersistenceResults(evidence)) {
    return {
      ...summary,
      status: "results-not-proven",
      releaseRunIdStatus: releaseRunId ? "matched" : "missing",
    };
  }
  if (!hasPersistenceRedactionSafety(evidence)) {
    return {
      ...summary,
      status: "redaction-not-proven",
      releaseRunIdStatus: releaseRunId ? "matched" : "missing",
    };
  }

  return {
    ...summary,
    status: "matched",
    releaseRunIdStatus: releaseRunId ? "matched" : "missing",
  };
}

function readPersistenceBlockedReasons(evidenceStatus) {
  if (!evidenceStatus || evidenceStatus.status === "matched") {
    return [];
  }
  if (evidenceStatus.status === "missing") {
    return ["external-storage-persistence-evidence-missing"];
  }
  if (evidenceStatus.status === "release-run-id-mismatch") {
    return ["external-storage-persistence-release-run-id-mismatch"];
  }
  if (evidenceStatus.status === "mismatched") {
    return ["external-storage-persistence-fingerprint-mismatch"];
  }
  if (evidenceStatus.status === "not-production") {
    return ["external-storage-persistence-not-production"];
  }
  return [`external-storage-persistence-evidence-${evidenceStatus.status}`];
}

function readPersistenceStorageServiceFingerprint(evidence) {
  if (!isRecord(evidence.storageServiceFingerprint)) {
    return undefined;
  }
  const { storageServiceFingerprint } = evidence;
  if (
    storageServiceFingerprint.status !== "present" ||
    storageServiceFingerprint.source !== "origin" ||
    storageServiceFingerprint.valueRedacted !== true ||
    typeof storageServiceFingerprint.value !== "string"
  ) {
    return undefined;
  }
  return storageServiceFingerprint.value;
}

function hasPersistenceResults(evidence) {
  if (!Array.isArray(evidence.results)) {
    return false;
  }
  const statuses = new Map(
    evidence.results
      .filter((entry) => isRecord(entry) && typeof entry.id === "string")
      .map((entry) => [entry.id, entry.status]),
  );
  return (
    statuses.get("s22-external-storage-persistence-health") === "ok" &&
    statuses.get("s22-external-storage-persisted-ownership-read") === "ok" &&
    statuses.get("s24-external-storage-persisted-audit-read") === "ok"
  );
}

function hasPersistenceRedactionSafety(evidence) {
  const safety = isRecord(evidence.safety) ? evidence.safety : {};
  return (
    safety.secretsRedacted === true &&
    safety.serviceUrlOmitted === true &&
    safety.teacherIdOmitted === true &&
    safety.proofIdOmitted === true &&
    safety.responseBodiesOmitted === true &&
    safety.localPrivatePathsOmitted === true
  );
}

function evaluateVercelEnvSyncEvidence({
  evidence,
  storageServiceFingerprint,
  releaseRunId,
  required,
}) {
  if (evidence === undefined) {
    return required
      ? {
          target: "missing",
          status: "missing",
          valueRedacted: true,
          releaseRunIdStatus: "missing",
        }
      : undefined;
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
  if (target !== "vercel-env-sync") {
    return { ...summary, status: "invalid-target" };
  }
  if (
    evidence.mode !== "apply" ||
    evidence.projectReadinessEvidenceStatus !== "ready" ||
    !hasProductionAndPreviewTargets(evidence.targets) ||
    !hasRedactedApplySummary(evidence)
  ) {
    return { ...summary, status: "not-applied", applyPreflight: "missing" };
  }
  if (!hasPassedApplyPreflight(evidence)) {
    return { ...summary, status: "apply-preflight-missing", applyPreflight: "missing" };
  }
  if (releaseRunId && evidence.releaseRunId !== releaseRunId) {
    return {
      ...summary,
      status: "release-run-id-mismatch",
      applyPreflight: "proved",
      releaseRunIdStatus: "mismatched",
    };
  }

  const envSyncFingerprint = readVercelEnvSyncStorageServiceFingerprint(evidence);
  if (!envSyncFingerprint) {
    return { ...summary, status: "fingerprint-missing", applyPreflight: "proved" };
  }
  if (
    storageServiceFingerprint.status !== "present" ||
    typeof storageServiceFingerprint.value !== "string"
  ) {
    return { ...summary, status: "readiness-fingerprint-missing", applyPreflight: "proved" };
  }
  if (envSyncFingerprint !== storageServiceFingerprint.value) {
    return { ...summary, status: "mismatched", applyPreflight: "proved" };
  }

  return {
    ...summary,
    status: "matched",
    applyPreflight: "proved",
    releaseRunIdStatus: releaseRunId ? "matched" : "missing",
  };
}

function hasProductionAndPreviewTargets(targets) {
  return (
    Array.isArray(targets) &&
    targets.includes("production") &&
    targets.includes("preview")
  );
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
    summary.cliOutputOmitted === true
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

function readVercelEnvSyncStorageServiceFingerprint(evidence) {
  if (!isRecord(evidence.externalStorageServiceFingerprint)) {
    return undefined;
  }
  const { externalStorageServiceFingerprint } = evidence;
  if (
    externalStorageServiceFingerprint.status !== "present" ||
    externalStorageServiceFingerprint.source !== "origin" ||
    externalStorageServiceFingerprint.valueRedacted !== true ||
    typeof externalStorageServiceFingerprint.value !== "string"
  ) {
    return undefined;
  }
  return externalStorageServiceFingerprint.value;
}

function readVercelEnvSyncBlockedReasons(evidenceStatus) {
  if (!evidenceStatus || evidenceStatus.status === "matched") {
    return [];
  }
  if (evidenceStatus.status === "mismatched") {
    return ["vercel-env-sync-external-storage-fingerprint-mismatch"];
  }
  if (evidenceStatus.status === "apply-preflight-missing") {
    return ["vercel-env-sync-apply-preflight-not-proven"];
  }
  return [`vercel-env-sync-evidence-${evidenceStatus.status}`];
}

async function readHealth(baseUrl) {
  const requestResult = await fetchWithNetworkRetry(`${stripTrailingSlashes(baseUrl)}/healthz`, {
    method: "GET",
    headers: {
      accept: "application/json",
    },
  });
  if (!requestResult.response) {
    return {
      httpStatus: undefined,
      status: "blocked",
      target: "missing",
      cacheControl: "missing",
      productionServiceIdentity: "missing",
      apiContractVersion: "missing",
      durableBackingStore: "not-ready",
      teachingOperationsStorageSchema: readTeachingOperationsStorageSchemaHealth(undefined),
      teachingCourseManagementStorageSchema:
        readTeachingCourseManagementStorageSchemaHealth(undefined),
      teachingCourseAssetsStorageSchema: readTeachingCourseAssetsStorageSchemaHealth(undefined),
      redaction: "missing",
      networkAttempts: requestResult.networkAttempts,
      networkError: requestResult.networkError,
    };
  }

  const response = requestResult.response;
  const body = await readJsonResponse(response);
  const target = typeof body.target === "string" ? body.target : "missing";
  const productionServiceIdentity = isRecord(body.productionServiceIdentity)
    ? body.productionServiceIdentity
    : {};
  return {
    httpStatus: response.status,
    status: body.status === "ok" ? "ok" : "blocked",
    target,
    cacheControl: classifyCacheControlNoStore(
      response.headers.get("cache-control"),
    ),
    productionServiceIdentity:
      target === "uais-external-storage-production-service" &&
      productionServiceIdentity.status === "proved" &&
      productionServiceIdentity.serviceMode === "production" &&
      productionServiceIdentity.serviceTarget === "uais-external-storage-production-service" &&
      productionServiceIdentity.valueRedacted === true
        ? "proved"
        : "missing",
    apiContractVersion:
      body.apiContractVersion === expectedExternalStorageApiContractVersion
        ? "matched"
        : hasValue(body.apiContractVersion)
          ? "mismatched"
          : "missing",
    durableBackingStore: hasReadyDurableBackingStore(body.durableBackingStore)
      ? "ready"
      : "not-ready",
    teachingOperationsStorageSchema: readTeachingOperationsStorageSchemaHealth(
      body.teachingOperationsStorageSchema,
    ),
    teachingCourseManagementStorageSchema:
      readTeachingCourseManagementStorageSchemaHealth(
        body.teachingCourseManagementStorageSchema,
      ),
    teachingCourseAssetsStorageSchema: readTeachingCourseAssetsStorageSchemaHealth(
      body.teachingCourseAssetsStorageSchema,
    ),
    redaction: isRecord(body.redaction) ? "present" : "missing",
    networkAttempts: requestResult.networkAttempts,
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

async function readJsonResponse(response) {
  try {
    const body = await response.json();
    return isRecord(body) ? body : {};
  } catch {
    return {};
  }
}

function evaluateHealthBlockedReasons(health) {
  const blockedReasons = [];
  if (health.httpStatus !== 200 || health.status !== "ok") {
    blockedReasons.push("external-storage-service-health-not-ok");
  }
  if (health.productionServiceIdentity !== "proved") {
    blockedReasons.push("external-storage-service-production-identity-not-proven");
  }
  if (health.apiContractVersion !== "matched") {
    blockedReasons.push("external-storage-service-api-contract-not-proven");
  }
  if (health.cacheControl !== "no-store") {
    blockedReasons.push("external-storage-service-cache-control-not-proven");
  }
  if (health.durableBackingStore !== "ready") {
    blockedReasons.push("external-storage-service-durable-backing-store-not-ready");
  }
  if (!isTeachingOperationsStorageSchemaHealthReady(health.teachingOperationsStorageSchema)) {
    blockedReasons.push("external-storage-service-teaching-operations-schema-not-proven");
  } else if (
    !isProductionDatabaseAdapterHealthReady(
      health.teachingOperationsStorageSchema.productionDatabaseAdapter,
    )
  ) {
    blockedReasons.push(
      "external-storage-service-teaching-operations-database-adapter-not-proven",
    );
  }
  if (
    !isSnapshotStorageSchemaHealthReady({
      schema: health.teachingCourseManagementStorageSchema,
      schemaVersion: "matched",
    })
  ) {
    blockedReasons.push(
      "external-storage-service-teaching-course-management-schema-not-proven",
    );
  } else if (
    !isProductionDatabaseAdapterHealthReady(
      health.teachingCourseManagementStorageSchema.productionDatabaseAdapter,
    )
  ) {
    blockedReasons.push(
      "external-storage-service-teaching-course-management-database-adapter-not-proven",
    );
  }
  if (
    !isSnapshotStorageSchemaHealthReady({
      schema: health.teachingCourseAssetsStorageSchema,
      schemaVersion: "matched",
    })
  ) {
    blockedReasons.push(
      "external-storage-service-teaching-course-assets-schema-not-proven",
    );
  } else if (
    !isProductionDatabaseAdapterHealthReady(
      health.teachingCourseAssetsStorageSchema.productionDatabaseAdapter,
    )
  ) {
    blockedReasons.push(
      "external-storage-service-teaching-course-assets-database-adapter-not-proven",
    );
  }
  if (health.redaction !== "present") {
    blockedReasons.push("external-storage-service-redaction-not-proven");
  }
  return blockedReasons;
}

function isTeachingOperationsStorageSchemaHealthReady(schema) {
  return (
    isRecord(schema) &&
    schema.status === "ready" &&
    schema.schemaVersion === "matched" &&
    schema.migrationStatus === "up-to-date" &&
    schema.operationLedger === "jsonl-append-only" &&
    schema.auditLedger === "jsonl-append-only" &&
    schema.rollbackLedger === "jsonl-append-only" &&
    schema.backupStore === "json-atomic-snapshot" &&
    schema.restoreDrillLog === "jsonl-append-only" &&
    schema.concurrencyControl === "atomic-append-and-rename" &&
    schema.valueRedacted === true
  );
}

function readTeachingOperationsStorageSchemaHealth(value) {
  return {
    status: value?.status === "ready" ? "ready" : "missing",
    schemaVersion:
      value?.schemaVersion === "uais-teaching-operations-v1" ? "matched" : "missing",
    migrationStatus:
      value?.migrationStatus === "up-to-date" ? "up-to-date" : "missing",
    operationLedger:
      value?.operationLedger === "jsonl-append-only" ? "jsonl-append-only" : "missing",
    auditLedger:
      value?.auditLedger === "jsonl-append-only" ? "jsonl-append-only" : "missing",
    rollbackLedger:
      value?.rollbackLedger === "jsonl-append-only" ? "jsonl-append-only" : "missing",
    backupStore:
      value?.backupStore === "json-atomic-snapshot" ? "json-atomic-snapshot" : "missing",
    restoreDrillLog:
      value?.restoreDrillLog === "jsonl-append-only" ? "jsonl-append-only" : "missing",
    concurrencyControl:
      value?.concurrencyControl === "atomic-append-and-rename"
        ? "atomic-append-and-rename"
        : "missing",
    productionDatabaseAdapter: readProductionDatabaseAdapterHealth(
      value?.productionDatabaseAdapter,
    ),
    valueRedacted: value?.valueRedacted === true,
  };
}

function isProductionDatabaseAdapterHealthReady(adapter) {
  return (
    isRecord(adapter) &&
    adapter.status === "ready" &&
    adapter.providerClass === "managed-database" &&
    adapter.migrationStatus === "up-to-date" &&
    adapter.backupPolicy === "point-in-time-restore" &&
    adapter.concurrencyControl === "transactional" &&
    adapter.valueRedacted === true
  );
}

function readProductionDatabaseAdapterHealth(value) {
  return {
    status: value?.status === "ready" ? "ready" : "missing",
    providerClass:
      value?.providerClass === "managed-database" ? "managed-database" : "missing",
    migrationStatus:
      value?.migrationStatus === "up-to-date" ? "up-to-date" : "missing",
    backupPolicy:
      value?.backupPolicy === "point-in-time-restore"
        ? "point-in-time-restore"
        : "missing",
    concurrencyControl:
      value?.concurrencyControl === "transactional" ? "transactional" : "missing",
    valueRedacted: value?.valueRedacted === true,
  };
}

function isSnapshotStorageSchemaHealthReady({ schema, schemaVersion }) {
  return (
    isRecord(schema) &&
    schema.status === "ready" &&
    schema.schemaVersion === schemaVersion &&
    schema.migrationStatus === "up-to-date" &&
    schema.snapshotStore === "json-atomic-snapshot" &&
    schema.auditLog === "jsonl-append-only" &&
    schema.backupStore === "json-atomic-snapshot" &&
    schema.restoreDrillLog === "jsonl-append-only" &&
    schema.revisionControl === "optimistic-revision" &&
    schema.concurrencyControl === "atomic-rename-with-revision-check" &&
    schema.valueRedacted === true
  );
}

function readTeachingCourseManagementStorageSchemaHealth(value) {
  return readSnapshotStorageSchemaHealth(value, "uais-teaching-course-management-v1");
}

function readTeachingCourseAssetsStorageSchemaHealth(value) {
  return readSnapshotStorageSchemaHealth(value, "uais-teaching-course-assets-v1");
}

function readSnapshotStorageSchemaHealth(value, expectedSchemaVersion) {
  return {
    status: value?.status === "ready" ? "ready" : "missing",
    schemaVersion: value?.schemaVersion === expectedSchemaVersion ? "matched" : "missing",
    migrationStatus:
      value?.migrationStatus === "up-to-date" ? "up-to-date" : "missing",
    snapshotStore:
      value?.snapshotStore === "json-atomic-snapshot" ? "json-atomic-snapshot" : "missing",
    auditLog: value?.auditLog === "jsonl-append-only" ? "jsonl-append-only" : "missing",
    backupStore:
      value?.backupStore === "json-atomic-snapshot" ? "json-atomic-snapshot" : "missing",
    restoreDrillLog:
      value?.restoreDrillLog === "jsonl-append-only" ? "jsonl-append-only" : "missing",
    revisionControl:
      value?.revisionControl === "optimistic-revision" ? "optimistic-revision" : "missing",
    concurrencyControl:
      value?.concurrencyControl === "atomic-rename-with-revision-check"
        ? "atomic-rename-with-revision-check"
        : "missing",
    productionDatabaseAdapter: readProductionDatabaseAdapterHealth(
      value?.productionDatabaseAdapter,
    ),
    valueRedacted: value?.valueRedacted === true,
  };
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

function readProductionEndpointBlockedReasons({ environment, storageEndpoint }) {
  if (
    environment !== "production" ||
    storageEndpoint.status !== "present" ||
    storageEndpoint.endpointClass === "remote-https"
  ) {
    return [];
  }
  return ["production-external-storage-service-endpoint-not-remote-https"];
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

function parseArgs(args) {
  const options = {
    live: false,
    approved: false,
    baseUrl: undefined,
    environment: "unspecified",
    envFile: undefined,
    vercelEnvSync: undefined,
    externalStorageProductionLaunchContract: undefined,
    externalStoragePersistence: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      options.live = false;
    } else if (arg === "--live") {
      options.live = true;
    } else if (arg === "--approved") {
      options.approved = true;
    } else if (arg === "--base-url") {
      options.baseUrl = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--environment") {
      options.environment = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--env-file") {
      options.envFile = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--vercel-env-sync") {
      options.vercelEnvSync = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--external-storage-production-launch-contract") {
      options.externalStorageProductionLaunchContract = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--external-storage-persistence") {
      options.externalStoragePersistence = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--release-run-id") {
      options.releaseRunId = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node -- scripts/external-storage-service-readiness.mjs [--dry-run] [--live --approved] [--base-url URL] [--environment production|preview|local-reference|unspecified] [--env-file PATH] [--vercel-env-sync PATH] [--external-storage-production-launch-contract PATH]",
          "       node -- scripts/external-storage-service-readiness.mjs --live --approved --environment production --env-file PATH --vercel-env-sync PATH --external-storage-production-launch-contract PATH --external-storage-persistence PATH",
          "",
          "Checks only the redacted /healthz readiness contract for a production external storage service. It never writes data.",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function readJsonEvidence(path) {
  if (!hasValue(path)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { status: "invalid" };
  }
}

function readEnvFile(path) {
  if (!hasValue(path)) {
    return {};
  }
  const entries = {};
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (key) {
      entries[key] = stripOptionalQuotes(value);
    }
  }
  return entries;
}

function stripOptionalQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function readArgValue(args, index, name) {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function normalizeReleaseRunId(value) {
  if (!hasValue(value)) {
    return undefined;
  }
  const releaseRunId = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(releaseRunId)) {
    throw new Error("--release-run-id must be a non-secret release identifier.");
  }
  return releaseRunId;
}

function stripTrailingSlashes(value) {
  return value.replace(/\/+$/, "");
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
