#!/usr/bin/env node

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as signBytes,
  verify as verifyBytes,
} from "node:crypto";
import { constants as fsConstants, existsSync } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { computeUaisStagingCandidateContentSha } from "./p2-staging-candidate-content.mjs";

const allowedActions = new Set([
  "setup",
  "readiness",
  "finalize",
  "purge",
  "readback",
  "purge-expired",
]);
const measurementActions = new Set(["readiness", "finalize"]);
const minimumSamplesPerGroup = 30;
const minimumDistinctOperatorsPerGroup = 3;
const maximumP75Ms = 200;
const maximumHistogramBucketsPerGroup = 1_000;
const maximumSamplesPerGroup = 4_000;
const maximumSamplesPerCohort = 4_000;
const maximumAccountCleanupFreshnessGapMs = 60_000;
const immutableDeploymentIdPattern = /^dpl_[A-Za-z0-9]{20,64}$/;
const digestPattern = /^[0-9a-f]{64}$/;
const fixedDistributionSourceRef =
  "/Volumes/Starship/UAIS-evidence/private-credentials/uais-staging/rum-exact-distribution-source.json";
const fixedCollectorPrivateKeySourceRef =
  "/Volumes/Starship/UAIS-evidence/private-credentials/uais-staging/rum-field-data-collector-ed25519-private.pem";
const percentileAlgorithm =
  "postgresql-percentile-cont-linear-interpolation-v1";
const distributionSignatureDomain =
  "UAIS-STAGING-INP-EXACT-DISTRIBUTION-SOURCE-V1\n";
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const expectedGroupKeys = [
  "student\u0000student-learning\u0000compact",
  "student\u0000student-learning\u0000wide",
  "student\u0000student-chatroom\u0000compact",
  "student\u0000student-chatroom\u0000wide",
  "teacher\u0000teacher-home\u0000compact",
  "teacher\u0000teacher-home\u0000wide",
  "teacher\u0000teacher-course-settings\u0000compact",
  "teacher\u0000teacher-course-settings\u0000wide",
  "teacher\u0000teacher-activities\u0000compact",
  "teacher\u0000teacher-activities\u0000wide",
  "teacher\u0000teacher-submissions\u0000compact",
  "teacher\u0000teacher-submissions\u0000wide",
];
const expectedGroupKeySet = new Set(expectedGroupKeys);

let runtimeDependenciesPromise;
let storeDependenciesPromise;
const defaultSecureFileIo = { lstat, open };

export async function runP2StagingInpLifecycle(input = {}) {
  const argv = input.argv ?? process.argv.slice(2);
  const env = input.env ?? process.env;
  const action = readOption(argv, "--action") ?? "";
  const verifiedContentSha =
    input.verifiedContentSha ?? computeUaisStagingCandidateContentSha(projectRoot);
  const runtimeDependencies =
    input.runtimeDependencies ?? (await loadRuntimeDependencies());
  const binding = runtimeDependencies.getUaisStagingInpBinding(
    env,
    verifiedContentSha,
  );
  const blockedReasons = collectBlockedReasons({
    argv,
    env,
    action,
    binding,
    verifiedContentSha,
    runtimeDependencies,
  });

  let collectorEvidence = null;
  if (measurementActions.has(action) && blockedReasons.length === 0) {
    const evidenceResult = await resolveCollectorEvidence({
      injected: input.collectorEvidence,
      binding,
      env,
    });
    if (evidenceResult.ok) {
      collectorEvidence = evidenceResult.evidence;
    } else {
      blockedReasons.push(...evidenceResult.reasons);
    }
  }

  const baseReport = createBaseReport({ action, binding, env });
  if (blockedReasons.length > 0) {
    return {
      exitCode: 2,
      report: {
        ...baseReport,
        status: "BLOCKED_ENV",
        blockedReasons: [...new Set(blockedReasons)],
      },
    };
  }

  const storeDependencies = input.createStore
    ? null
    : input.storeDependencies ?? (await loadStoreDependencies());
  const createStore =
    input.createStore ??
    ((storeEnv) =>
      storeDependencies.createUaisStagingInpPostgresStore({ env: storeEnv }));
  const store = createStore(env);
  try {
    if (action === "setup") {
      const setup = await store.setup(binding);
      return success(baseReport, { setup });
    }
    if (action === "readiness") {
      const receipt = await store.readiness(binding);
      const measurement = evaluateMeasurement(
        receipt.groups,
        collectorEvidence.distribution.groups,
      );
      return {
        exitCode: measurement.ready ? 0 : 1,
        report: {
          ...baseReport,
          status: measurement.ready ? "PASS" : "NOT_READY",
          lifecycleState: receipt.state,
          groups: collectorEvidence.distribution.groups,
          threshold: measurement.threshold,
          measurementProvenance: createMeasurementProvenance(measurement),
        },
      };
    }
    if (action === "finalize") {
      return await finalizeAndPurge({
        baseReport,
        binding,
        collectorEvidence,
        env,
        store,
      });
    }
    if (action === "purge") {
      const purge = await store.purge(binding);
      const readback = await store.readback(binding);
      const cleanup = cleanupSummary(purge, readback);
      return {
        exitCode: cleanup.rawSampleRowsZero ? 0 : 1,
        report: {
          ...baseReport,
          status: cleanup.rawSampleRowsZero ? "PASS" : "FAIL",
          cleanup,
        },
      };
    }
    if (action === "readback") {
      const readback = await store.readback(binding);
      return success(baseReport, {
        readback: {
          state: readback.state,
          rawSampleRowsRemaining: readback.rawSampleRowsRemaining,
          cohortTombstoneRetained: readback.cohortTombstoneRetained,
        },
      });
    }
    const expiry = await store.purgeExpired();
    return {
      exitCode: expiry.expiredRawSampleRowsZero ? 0 : 1,
      report: {
        ...baseReport,
        status: expiry.expiredRawSampleRowsZero ? "PASS" : "FAIL",
        expiry,
      },
    };
  } catch (error) {
    return {
      exitCode: 1,
      report: {
        ...baseReport,
        status: "FAIL",
        failureCode: readStoreFailureCode(
          error,
          "staging-inp-lifecycle-execution-failed",
        ),
        errorMessageOmitted: true,
      },
    };
  }
}

async function finalizeAndPurge({
  baseReport,
  binding,
  collectorEvidence,
  env,
  store,
}) {
  let aggregate;
  let executionFailure;
  let purge;
  let readback;
  try {
    aggregate = await store.aggregate(binding);
  } catch (error) {
    executionFailure = error;
  } finally {
    try {
      purge = await store.purge(binding);
    } catch (error) {
      executionFailure ??= error;
    } finally {
      try {
        readback = await store.readback(binding);
      } catch (error) {
        executionFailure ??= error;
      }
    }
  }

  const measurement = evaluateMeasurement(
    aggregate?.groups ?? [],
    collectorEvidence.distribution.groups,
  );
  const cleanup = cleanupSummary(purge, readback);
  const basePassed =
    !executionFailure && measurement.ready && cleanup.rawSampleRowsZero;
  let collectorSourceReceipt;
  let cleanupReceipt;
  let receiptFailureCode;
  if (basePassed) {
    try {
      const issued = createCollectorSourceReceipt({
        binding,
        cleanup,
        collectorEvidence,
        env,
      });
      collectorSourceReceipt = issued.collectorSourceReceipt;
      cleanupReceipt = issued.cleanupReceipt;
    } catch {
      receiptFailureCode = "staging-inp-account-cleanup-freshness-expired";
    }
  }
  const passed = basePassed && !receiptFailureCode;
  return {
    exitCode: passed ? 0 : 1,
    report: {
      ...baseReport,
      status: passed ? "PASS" : "FAIL",
      groups: collectorEvidence.distribution.groups,
      threshold: measurement.threshold,
      cleanup,
      measurementProvenance: createMeasurementProvenance(measurement),
      ...(collectorSourceReceipt
        ? {
            cleanupReceipt,
            collectorSourceReceipt,
            collectorSourceReceiptSha256: sha256(
              canonicalJson(collectorSourceReceipt),
            ),
            collectorSourceSignatureVerified: true,
          }
        : {}),
      ...(executionFailure
        ? {
            failureCode: readStoreFailureCode(
              executionFailure,
              "staging-inp-finalize-or-cleanup-failed",
            ),
            errorMessageOmitted: true,
          }
        : {}),
      ...(receiptFailureCode ? { failureCode: receiptFailureCode } : {}),
    },
  };
}

async function resolveCollectorEvidence({ injected, binding, env }) {
  let distributionSource;
  let privateKeyPem;
  let now;
  if (injected) {
    distributionSource = injected.distributionSource;
    privateKeyPem = injected.privateKeyPem;
    now = injected.now ?? (() => new Date());
  } else {
    const missingReasons = [];
    if (!existsSync(fixedDistributionSourceRef)) {
      missingReasons.push("signed-distribution-source-ref-required");
    }
    if (!existsSync(fixedCollectorPrivateKeySourceRef)) {
      missingReasons.push("collector-private-key-source-ref-required");
    }
    if (missingReasons.length > 0) {
      return { ok: false, reasons: missingReasons };
    }
    try {
      const [sourceText, keyText] = await Promise.all([
        readSecureFixedFile(fixedDistributionSourceRef, 2_000_000),
        readSecureFixedFile(fixedCollectorPrivateKeySourceRef, 32_768),
      ]);
      distributionSource = JSON.parse(sourceText);
      privateKeyPem = keyText;
      now = () => new Date();
    } catch {
      return {
        ok: false,
        reasons: ["collector-evidence-source-invalid-or-unreadable"],
      };
    }
  }

  try {
    const signer = inspectCollectorPrivateKey(privateKeyPem);
    const distribution = inspectSignedDistributionSource({
      binding,
      distributionSource,
      env,
      now: now(),
      signer,
    });
    return { ok: true, evidence: { distribution, now, signer } };
  } catch {
    return {
      ok: false,
      reasons: ["collector-evidence-source-invalid-or-unreadable"],
    };
  }
}

function inspectCollectorPrivateKey(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 32_768) {
    throw new Error("invalid collector private key");
  }
  const privateKey = createPrivateKey(value);
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("collector key must be Ed25519");
  }
  const publicKey = createPublicKey(privateKey);
  const publicKeySpkiDer = publicKey.export({ format: "der", type: "spki" });
  const publicKeySpkiSha256 = sha256(publicKeySpkiDer);
  return {
    keyId: `rum-field-data-collector-${publicKeySpkiSha256.slice(0, 16)}`,
    privateKey,
    publicKey,
    publicKeySpkiSha256,
  };
}

function inspectSignedDistributionSource({
  binding,
  distributionSource,
  env,
  now,
  signer,
}) {
  requireExactKeys(distributionSource, ["payload", "signature"]);
  const { payload, signature } = distributionSource;
  requireExactKeys(signature, [
    "algorithm",
    "keyId",
    "payloadSha256",
    "signatureBase64",
  ]);
  requireExactKeys(payload, [
    "accountCleanup",
    "accountMappingDigestSha256",
    "candidateContentSha256",
    "candidateGitSha",
    "cohortId",
    "collectorKeyId",
    "collectorKeyVersion",
    "collectorPublicKeySpkiSha256",
    "deploymentHost",
    "deploymentId",
    "executionClass",
    "groups",
    "issuedAt",
    "kind",
    "measurementCompletedAt",
    "measurementStartedAt",
    "operatorAllowlistSha256",
    "operatorFingerprints",
    "percentileAlgorithm",
    "projectId",
    "runId",
    "schemaVersion",
    "sourceReportSha256",
  ]);
  requireExactKeys(payload.accountCleanup, [
    "accountMappingsRemaining",
    "temporaryAccountsRemaining",
    "verifiedAt",
  ]);
  if (
    payload.schemaVersion !== 1 ||
    payload.kind !== "uais-staging-inp-exact-distribution-source" ||
    payload.executionClass !== "real-user" ||
    payload.candidateGitSha !== binding.candidateGitSha ||
    payload.candidateContentSha256 !== binding.candidateContentSha ||
    payload.projectId !== env.VERCEL_PROJECT_ID?.trim() ||
    payload.deploymentId !== env.P2_IMMUTABLE_DEPLOYMENT_ID?.trim() ||
    payload.deploymentHost !== binding.deploymentHost ||
    payload.runId !== binding.cohortId ||
    payload.cohortId !== binding.cohortId ||
    payload.collectorKeyVersion !== binding.collectorKeyVersion ||
    payload.collectorKeyId !== signer.keyId ||
    payload.collectorPublicKeySpkiSha256 !== signer.publicKeySpkiSha256 ||
    payload.percentileAlgorithm !== percentileAlgorithm ||
    !digestPattern.test(payload.accountMappingDigestSha256) ||
    !digestPattern.test(payload.sourceReportSha256) ||
    payload.accountCleanup.accountMappingsRemaining !== 0 ||
    payload.accountCleanup.temporaryAccountsRemaining !== 0
  ) {
    throw new Error("distribution binding invalid");
  }
  const operatorFingerprints = deriveOperatorFingerprints(env);
  if (
    !sameJson(payload.operatorFingerprints, operatorFingerprints) ||
    payload.operatorAllowlistSha256 !== sha256(canonicalJson(operatorFingerprints))
  ) {
    throw new Error("operator allowlist invalid");
  }
  const measurementStartedAt = parseCanonicalTimestamp(
    payload.measurementStartedAt,
  );
  const measurementCompletedAt = parseCanonicalTimestamp(
    payload.measurementCompletedAt,
  );
  const issuedAt = parseCanonicalTimestamp(payload.issuedAt);
  const cleanupVerifiedAt = parseCanonicalTimestamp(
    payload.accountCleanup.verifiedAt,
  );
  if (
    measurementStartedAt >= measurementCompletedAt ||
    measurementCompletedAt > issuedAt ||
    measurementCompletedAt > cleanupVerifiedAt ||
    cleanupVerifiedAt > issuedAt ||
    issuedAt > now.getTime() ||
    cleanupVerifiedAt > now.getTime() ||
    now.getTime() - cleanupVerifiedAt > maximumAccountCleanupFreshnessGapMs ||
    now.getTime() - measurementStartedAt > 48 * 60 * 60 * 1_000
  ) {
    throw new Error("measurement window invalid");
  }
  if (
    signature.algorithm !== "Ed25519" ||
    signature.keyId !== signer.keyId ||
    !digestPattern.test(signature.payloadSha256) ||
    typeof signature.signatureBase64 !== "string"
  ) {
    throw new Error("distribution signature metadata invalid");
  }
  const payloadJson = canonicalJson(payload);
  if (sha256(payloadJson) !== signature.payloadSha256) {
    throw new Error("distribution payload digest mismatch");
  }
  const signatureBytes = decodeCanonicalBase64(signature.signatureBase64, 64);
  if (
    !verifyBytes(
      null,
      Buffer.from(`${distributionSignatureDomain}${payloadJson}`),
      signer.publicKey,
      signatureBytes,
    )
  ) {
    throw new Error("distribution signature invalid");
  }
  const distribution = inspectDistributionGroups(payload.groups);
  return {
    ...payload,
    groups: distribution.groups,
    schemaReady: distribution.schemaReady,
    performancePassingGroups: distribution.performancePassingGroups,
  };
}

function inspectDistributionGroups(value) {
  if (!Array.isArray(value) || value.length !== expectedGroupKeys.length) {
    throw new Error("exact distribution group count required");
  }
  const byKey = new Map();
  const groups = [];
  for (const group of value) {
    requireExactKeys(group, [
      "distinctAdultHumanCount",
      "distinctOperatorCount",
      "histogram",
      "journey",
      "p75Ms",
      "role",
      "sampleCount",
      "viewportClass",
    ]);
    const key = groupKey(group);
    if (!expectedGroupKeySet.has(key) || byKey.has(key)) {
      throw new Error("distribution group identity invalid");
    }
    if (
      !Number.isInteger(group.sampleCount) ||
      group.sampleCount < 1 ||
      group.sampleCount > maximumSamplesPerGroup ||
      group.distinctOperatorCount !== minimumDistinctOperatorsPerGroup ||
      group.distinctAdultHumanCount !== minimumDistinctOperatorsPerGroup ||
      typeof group.p75Ms !== "number" ||
      !Number.isFinite(group.p75Ms) ||
      group.p75Ms < 0
    ) {
      throw new Error("distribution group metrics invalid");
    }
    const histogram = inspectExactHistogram(group.histogram, group.sampleCount);
    if (!histogram.valid || histogram.p75Ms !== group.p75Ms) {
      throw new Error("distribution percentile mismatch");
    }
    const normalized = {
      role: group.role,
      journey: group.journey,
      viewportClass: group.viewportClass,
      sampleCount: group.sampleCount,
      distinctOperatorCount: group.distinctOperatorCount,
      distinctAdultHumanCount: group.distinctAdultHumanCount,
      p75Ms: group.p75Ms,
      histogram: group.histogram.map((bucket) => ({
        valueMs: bucket.valueMs,
        count: bucket.count,
      })),
    };
    byKey.set(key, normalized);
    groups.push(normalized);
  }
  if (expectedGroupKeys.some((key) => !byKey.has(key))) {
    throw new Error("distribution group missing");
  }
  const orderedGroups = expectedGroupKeys.map((key) => byKey.get(key));
  const totalSampleCount = orderedGroups.reduce(
    (total, group) => total + group.sampleCount,
    0,
  );
  if (totalSampleCount > maximumSamplesPerCohort) {
    throw new Error("distribution cohort sample budget exceeded");
  }
  const performancePassingGroups = orderedGroups.filter(
    (group) =>
      group.sampleCount >= minimumSamplesPerGroup &&
      group.distinctOperatorCount >= minimumDistinctOperatorsPerGroup &&
      group.p75Ms <= maximumP75Ms,
  ).length;
  return {
    groups: orderedGroups,
    schemaReady: true,
    performancePassingGroups,
  };
}

function evaluateMeasurement(storeGroups, distributionGroups) {
  const store = inspectStoreAggregate(storeGroups);
  let matchingGroups = 0;
  if (store.schemaValid) {
    const storeByKey = new Map(store.groups.map((group) => [groupKey(group), group]));
    for (const distribution of distributionGroups) {
      const aggregate = storeByKey.get(groupKey(distribution));
      if (
        aggregate &&
        aggregate.n === distribution.sampleCount &&
        aggregate.distinctOperatorCount === distribution.distinctOperatorCount &&
        aggregate.p75Ms === distribution.p75Ms
      ) {
        matchingGroups += 1;
      }
    }
  }
  const performancePassingGroups = distributionGroups.filter(
    (group) =>
      group.sampleCount >= minimumSamplesPerGroup &&
      group.distinctOperatorCount >= minimumDistinctOperatorsPerGroup &&
      group.distinctAdultHumanCount === minimumDistinctOperatorsPerGroup &&
      group.p75Ms <= maximumP75Ms,
  ).length;
  const storeAggregateMatched =
    store.schemaValid && matchingGroups === expectedGroupKeys.length;
  const ready =
    storeAggregateMatched && performancePassingGroups === expectedGroupKeys.length;
  return {
    ready,
    storeAggregateMatched,
    threshold: {
      requiredGroups: expectedGroupKeys.length,
      observedGroups: distributionGroups.length,
      passingGroups: performancePassingGroups,
      groupSchemaValid: true,
      storeAggregateSchemaValid: store.schemaValid,
      storeAggregateMatched,
      storeAggregateMatchingGroups: matchingGroups,
      storeAggregateFailureCode: store.failureCode,
      minimumSamplesPerGroup,
      minimumDistinctOperatorsPerGroup,
      requiredDistinctAdultHumansPerGroup: minimumDistinctOperatorsPerGroup,
      maximumP75Ms,
      percentileAlgorithm,
      ready,
    },
  };
}

function inspectStoreAggregate(value) {
  if (!Array.isArray(value) || value.length !== expectedGroupKeys.length) {
    return {
      schemaValid: false,
      failureCode: "store-aggregate-exact-group-count-required",
      groups: [],
    };
  }
  const byKey = new Map();
  const groups = [];
  try {
    for (const group of value) {
      requireExactKeys(group, [
        "distinctOperatorCount",
        "journey",
        "n",
        "p75Ms",
        "role",
        "viewportClass",
      ]);
      const key = groupKey(group);
      if (!expectedGroupKeySet.has(key) || byKey.has(key)) {
        throw new Error("store aggregate group identity invalid");
      }
      if (
        !Number.isInteger(group.n) ||
        group.n < 0 ||
        !Number.isInteger(group.distinctOperatorCount) ||
        group.distinctOperatorCount < 0 ||
        typeof group.p75Ms !== "number" ||
        !Number.isFinite(group.p75Ms) ||
        group.p75Ms < 0
      ) {
        throw new Error("store aggregate metrics invalid");
      }
      byKey.set(key, group);
      groups.push(group);
    }
  } catch {
    return {
      schemaValid: false,
      failureCode: "store-aggregate-schema-invalid",
      groups: [],
    };
  }
  if (expectedGroupKeys.some((key) => !byKey.has(key))) {
    return {
      schemaValid: false,
      failureCode: "store-aggregate-group-missing",
      groups: [],
    };
  }
  return { schemaValid: true, failureCode: null, groups };
}

function inspectExactHistogram(value, expectedCount) {
  if (
    !Number.isInteger(expectedCount) ||
    expectedCount < 1 ||
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > maximumHistogramBucketsPerGroup
  ) {
    return { valid: false, p75Ms: null };
  }
  let previousValue = -1;
  let totalCount = 0;
  const normalized = [];
  for (const bucket of value) {
    try {
      requireExactKeys(bucket, ["count", "valueMs"]);
    } catch {
      return { valid: false, p75Ms: null };
    }
    if (
      !Number.isInteger(bucket.valueMs) ||
      bucket.valueMs < 0 ||
      bucket.valueMs > 60_000 ||
      bucket.valueMs <= previousValue ||
      !Number.isInteger(bucket.count) ||
      bucket.count < 1
    ) {
      return { valid: false, p75Ms: null };
    }
    previousValue = bucket.valueMs;
    totalCount += bucket.count;
    normalized.push({ valueMs: bucket.valueMs, count: bucket.count });
  }
  if (totalCount !== expectedCount) return { valid: false, p75Ms: null };
  const position = (expectedCount - 1) * 0.75;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = histogramValueAt(normalized, lowerIndex);
  const upper = histogramValueAt(normalized, upperIndex);
  return {
    valid: true,
    p75Ms: lower + (upper - lower) * (position - lowerIndex),
  };
}

function histogramValueAt(histogram, index) {
  let offset = 0;
  for (const bucket of histogram) {
    offset += bucket.count;
    if (index < offset) return bucket.valueMs;
  }
  throw new Error("histogram rank outside distribution");
}

function createCollectorSourceReceipt({
  binding,
  cleanup,
  collectorEvidence,
  env,
}) {
  const rawSampleCleanupVerifiedAt = collectorEvidence.now().toISOString();
  const rawCleanupTime = parseCanonicalTimestamp(rawSampleCleanupVerifiedAt);
  const accountCleanupVerifiedAt =
    collectorEvidence.distribution.accountCleanup.verifiedAt;
  const accountCleanupTime = parseCanonicalTimestamp(accountCleanupVerifiedAt);
  if (
    rawCleanupTime < accountCleanupTime ||
    rawCleanupTime - accountCleanupTime > maximumAccountCleanupFreshnessGapMs
  ) {
    throw new Error("account cleanup attestation is stale at finalize");
  }
  const cleanupReceipt = {
    schemaVersion: 1,
    kind: "uais-staging-inp-rum-cleanup",
    actionScope: "cleanup-staging-rum-only",
    runId: binding.cohortId,
    cohortId: binding.cohortId,
    rawSampleRowsRemaining: cleanup.rawSampleRowsRemaining,
    accountMappingsRemaining:
      collectorEvidence.distribution.accountCleanup.accountMappingsRemaining,
    temporaryAccountsRemaining:
      collectorEvidence.distribution.accountCleanup.temporaryAccountsRemaining,
    cohortTombstoneRetained: cleanup.cohortTombstoneRetained,
    accountCleanupVerifiedAt,
    rawSampleCleanupVerifiedAt,
  };
  const payload = {
    schemaVersion: 1,
    kind: "uais-staging-inp-rum-source",
    actionScope: "collect-real-user-inp-staging-only",
    candidateGitSha: binding.candidateGitSha,
    candidateContentSha256: binding.candidateContentSha,
    projectId: env.VERCEL_PROJECT_ID.trim(),
    deploymentId: env.P2_IMMUTABLE_DEPLOYMENT_ID.trim(),
    deploymentHost: binding.deploymentHost,
    runId: binding.cohortId,
    cohortId: binding.cohortId,
    collectorKeyVersion: binding.collectorKeyVersion,
    collectorKeyId: collectorEvidence.signer.keyId,
    collectorPublicKeySpkiSha256:
      collectorEvidence.signer.publicKeySpkiSha256,
    operatorAllowlistSha256: sha256(
      canonicalJson(collectorEvidence.distribution.operatorFingerprints),
    ),
    operatorFingerprints: collectorEvidence.distribution.operatorFingerprints,
    measurementStartedAt:
      collectorEvidence.distribution.measurementStartedAt,
    measurementCompletedAt:
      collectorEvidence.distribution.measurementCompletedAt,
    generatedAt: rawSampleCleanupVerifiedAt,
    accountMappingDigestSha256:
      collectorEvidence.distribution.accountMappingDigestSha256,
    sourceReportSha256: collectorEvidence.distribution.sourceReportSha256,
    percentileAlgorithm,
    groups: collectorEvidence.distribution.groups,
    cleanupReceipt,
    cleanupReceiptSha256: sha256(canonicalJson(cleanupReceipt)),
  };
  const payloadJson = canonicalJson(payload);
  const signature = {
    algorithm: "Ed25519",
    keyId: collectorEvidence.signer.keyId,
    payloadSha256: sha256(payloadJson),
    signatureBase64: signBytes(
      null,
      Buffer.from(payloadJson),
      collectorEvidence.signer.privateKey,
    ).toString("base64"),
  };
  return {
    cleanupReceipt,
    collectorSourceReceipt: { payload, signature },
  };
}

function createMeasurementProvenance(measurement) {
  return {
    status: measurement.storeAggregateMatched ? "validated" : "notVerified",
    sourceClass: "independently-supplied-ed25519-signed-exact-distribution",
    percentileAlgorithm,
    exactDistributionSourceVerified: true,
    storeAggregateMatched: measurement.storeAggregateMatched,
    operatorAttestedOnly: true,
    clientSuppliedValues: true,
    routeServerAttested: true,
    documentContextCompared: true,
  };
}

function collectBlockedReasons({
  argv,
  env,
  action,
  binding,
  verifiedContentSha,
  runtimeDependencies,
}) {
  const reasons = [
    ...(action === "purge-expired"
      ? runtimeDependencies.getUaisStagingInpCleanupGuard(env).reasons
      : runtimeDependencies.getUaisStagingInpGuard(env, verifiedContentSha).reasons),
  ];
  if (!argv.includes("--live")) reasons.push("live-execution-flag-required");
  if (!argv.includes("--approved")) reasons.push("owner-approval-flag-required");
  if (!allowedActions.has(action)) reasons.push("supported-action-required");
  const cohort = readOption(argv, "--cohort") ?? env.UAIS_STAGING_INP_COHORT_ID ?? "";
  if (action !== "purge-expired") {
    if (binding && cohort !== binding.cohortId) reasons.push("cohort-binding-mismatch");
    if (!hasExactImmutableOrigin(env.P2_IMMUTABLE_DEPLOYMENT_URL, binding)) {
      reasons.push("immutable-deployment-url-mismatch");
    }
    const immutableDeploymentId = env.P2_IMMUTABLE_DEPLOYMENT_ID?.trim() ?? "";
    if (!immutableDeploymentIdPattern.test(immutableDeploymentId)) {
      reasons.push("immutable-deployment-id-invalid");
    } else if (env.VERCEL_DEPLOYMENT_ID?.trim() !== immutableDeploymentId) {
      reasons.push("immutable-deployment-id-mismatch");
    }
    if (!hasExactImmutableOrigin(env.UAIS_DEPLOYMENT_BASE_URL, binding)) {
      reasons.push("deployment-base-url-not-exact-immutable-origin");
    }
    if (
      action === "finalize" &&
      readOption(argv, "--confirm-close") !== binding?.cohortId
    ) {
      reasons.push("finalize-confirmation-mismatch");
    }
    if (
      action === "purge" &&
      readOption(argv, "--confirm-purge") !== binding?.cohortId
    ) {
      reasons.push("purge-confirmation-mismatch");
    }
  }
  return [...new Set(reasons)];
}

function hasExactImmutableOrigin(value, binding) {
  if (!value || !binding) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      url.hostname === binding.deploymentHost &&
      (url.pathname === "" || url.pathname === "/") &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function cleanupSummary(purge, readback) {
  const rawSampleRowsRemaining = strictNonNegativeInteger(
    readback?.rawSampleRowsRemaining ?? purge?.rawSampleRowsRemaining,
    -1,
  );
  const rawSampleRowsDeleted = strictNonNegativeInteger(
    purge?.rawSampleRowsDeleted,
    0,
  );
  const cohortTombstoneRetained =
    readback?.cohortTombstoneRetained === true &&
    purge?.cohortTombstoneRetained === true;
  const rawSampleRowsZero =
    purge?.state === "purged" &&
    purge?.rawSampleRowsZero === true &&
    readback?.state === "purged" &&
    cohortTombstoneRetained &&
    rawSampleRowsRemaining === 0;
  return {
    state: readback?.state ?? purge?.state ?? "unavailable",
    rawSampleRowsDeleted,
    rawSampleRowsRemaining,
    rawSampleRowsZero,
    cohortTombstoneRetained,
  };
}

function createBaseReport({ action, binding, env }) {
  return {
    target: "uais-staging-inp-lifecycle",
    action: action || "missing",
    receiptSchemaVersion: 2,
    receiptKind: "uais-staging-inp-lifecycle-report",
    evidenceClass:
      action === "purge-expired"
        ? "isolated-staging-expiry-cleanup"
        : "bounded-current-sha-isolated-staging-rum",
    candidateBinding: binding
      ? {
          cohortId: binding.cohortId,
          sourceRunId: binding.cohortId,
          candidateGitSha: binding.candidateGitSha,
          candidateContentSha: binding.candidateContentSha,
          deploymentId: env.P2_IMMUTABLE_DEPLOYMENT_ID?.trim() ?? "",
          deploymentHost: binding.deploymentHost,
          projectId: env.VERCEL_PROJECT_ID?.trim() ?? "",
          collectorKeyVersion: binding.collectorKeyVersion,
          operatorAccountAllowlistBindingSha256:
            binding.operatorAllowlistFingerprint,
        }
      : null,
    productionFieldInpProven: false,
    localSourceReportOnly: true,
    externalAuthorityVerified: false,
    independentRealUserApprovalRequired: true,
    soakAdmissionEligibleByItself: false,
    valuesRedacted: true,
    databaseUrlOmitted: true,
    secretValuesOmitted: true,
    measurementProvenance: {
      status: measurementActions.has(action) ? "notVerified" : "notApplicable",
    },
  };
}

function deriveOperatorFingerprints(env) {
  const value = env.UAIS_STAGING_INP_OPERATOR_ACCOUNT_HASHES;
  if (typeof value !== "string") throw new Error("operator allowlist missing");
  const hashes = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .sort();
  if (
    hashes.length !== minimumDistinctOperatorsPerGroup ||
    hashes.some((item) => !digestPattern.test(item)) ||
    new Set(hashes).size !== hashes.length
  ) {
    throw new Error("exact operator allowlist invalid");
  }
  return hashes.map((item) =>
    sha256(`uais-staging-inp-operator:v1\u0000${item}`),
  );
}

export async function readSecureFixedFileForTest({ path, maximumBytes, io }) {
  if (!io || io === defaultSecureFileIo) {
    throw new Error("injected secure-file test IO required");
  }
  return readSecureFixedFile(path, maximumBytes, io);
}

async function readSecureFixedFile(
  path,
  maximumBytes,
  io = defaultSecureFileIo,
) {
  if (!Number.isInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error("positive bounded read limit required");
  }
  const parent = await io.lstat(dirname(path), { bigint: true });
  if (
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    permissionBits(parent.mode) !== 0o700
  ) {
    throw new Error("secure parent directory required");
  }
  const before = await io.lstat(path, { bigint: true });
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    permissionBits(before.mode) !== 0o600 ||
    before.size < 1n ||
    before.size > BigInt(maximumBytes)
  ) {
    throw new Error("secure regular file required");
  }
  const handle = await io.open(
    path,
    fsConstants.O_RDONLY |
      (fsConstants.O_NOFOLLOW ?? 0) |
      (fsConstants.O_NONBLOCK ?? 0),
  );
  try {
    const opened = await handle.stat({ bigint: true });
    if (!sameStableFileSnapshot(before, opened)) {
      throw new Error("secure file changed before read");
    }
    const boundedBuffer = Buffer.alloc(maximumBytes + 1);
    let totalBytesRead = 0;
    while (totalBytesRead < boundedBuffer.length) {
      const { bytesRead } = await handle.read(
        boundedBuffer,
        totalBytesRead,
        boundedBuffer.length - totalBytesRead,
        totalBytesRead,
      );
      if (!Number.isInteger(bytesRead) || bytesRead < 0) {
        throw new Error("secure file read result invalid");
      }
      if (bytesRead === 0) break;
      totalBytesRead += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (totalBytesRead > maximumBytes) {
      throw new Error("secure file exceeds bounded read limit");
    }
    if (
      !sameStableFileSnapshot(opened, after) ||
      BigInt(totalBytesRead) !== after.size ||
      totalBytesRead < 1
    ) {
      throw new Error("secure file changed during read");
    }
    return boundedBuffer.subarray(0, totalBytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

function sameStableFileSnapshot(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mode === right.mode &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    permissionBits(right.mode) === 0o600 &&
    right.isFile() &&
    !right.isSymbolicLink()
  );
}

function permissionBits(mode) {
  return Number(mode & 0o777n);
}

async function loadRuntimeDependencies() {
  runtimeDependenciesPromise ??= import(
    "../src/lib/server/uais-staging-inp-runtime.ts"
  ).then((runtimeImport) => runtimeImport.default ?? runtimeImport);
  return runtimeDependenciesPromise;
}

async function loadStoreDependencies() {
  storeDependenciesPromise ??= import(
    "../src/lib/server/uais-staging-inp-store.ts"
  ).then((storeImport) => storeImport.default ?? storeImport);
  return storeDependenciesPromise;
}

async function registerDirectNodeProjectAliasHook() {
  const moduleApi = await import("node:module");
  if (typeof moduleApi.registerHooks !== "function") {
    throw new Error("supported Node TypeScript resolve hook unavailable");
  }
  moduleApi.registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith("@/")) {
        const basePath = resolve(projectRoot, "src", specifier.slice(2));
        const resolvedPath = existsSync(basePath) ? basePath : `${basePath}.ts`;
        return { shortCircuit: true, url: pathToFileURL(resolvedPath).href };
      }
      return nextResolve(specifier, context);
    },
  });
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new Error("canonical JSON value invalid");
}

function requireExactKeys(value, expectedKeys) {
  if (!isPlainObject(value)) throw new Error("plain object required");
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (!sameJson(actual, expected)) throw new Error("exact object keys required");
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseCanonicalTimestamp(value) {
  if (typeof value !== "string") throw new Error("timestamp required");
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
    throw new Error("canonical timestamp required");
  }
  return time;
}

function decodeCanonicalBase64(value, expectedLength) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error("canonical base64 required");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== expectedLength || decoded.toString("base64") !== value) {
    throw new Error("canonical base64 invalid");
  }
  return decoded;
}

function groupKey(group) {
  return `${group?.role}\u0000${group?.journey}\u0000${group?.viewportClass}`;
}

function strictNonNegativeInteger(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function readStoreFailureCode(error, fallback) {
  const reasonCode =
    error && typeof error === "object" && "reasonCode" in error
      ? error.reasonCode
      : null;
  return typeof reasonCode === "string" && /^staging-inp-[a-z0-9-]+$/.test(reasonCode)
    ? reasonCode
    : fallback;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function success(baseReport, details) {
  return { exitCode: 0, report: { ...baseReport, status: "PASS", ...details } };
}

function readOption(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

const mainModule =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (mainModule) {
  try {
    await registerDirectNodeProjectAliasHook();
    const result = await runP2StagingInpLifecycle();
    process.stdout.write(`${JSON.stringify(result.report)}\n`);
    process.exitCode = result.exitCode;
  } catch {
    process.stdout.write(
      `${JSON.stringify({
        target: "uais-staging-inp-lifecycle",
        status: "BLOCKED_ENV",
        failureCode: "staging-inp-cli-initialization-failed",
        errorMessageOmitted: true,
        valuesRedacted: true,
        secretValuesOmitted: true,
      })}\n`,
    );
    process.exitCode = 2;
  }
}
