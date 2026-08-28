#!/usr/bin/env node

import { createHash, createPublicKey, verify } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { computeUaisStagingCandidateContentSha } from "./p2-staging-candidate-content.mjs";
import { resolveSoakEvidencePacket } from "./p2-soak-evidence-resolver.mjs";

const defaultManifestPath =
  "coordination/reports/2026-08-27-376-soak-admission.json";
const fixedOwnerPinPath =
  "/Volumes/Starship/UAIS-evidence/private-credentials/uais-staging/soak-admission-owner-pins.json";
const requiredReceiptSchemas = [
  "uais.staging-health.v1",
  "uais.p1-load.v1",
  "uais.p2-load.v1",
  "uais.rum-approval.v1",
  "uais.manual-accessibility.v1",
  "uais.dependency-review.v1",
  "uais.production-safety.v1",
];
const requiredArtifacts = [
  ["staging-health", "uais.staging-health.v1", "health-probe-issuer"],
  ["p1-load", "uais.p1-load.v1", "p1-load-issuer"],
  ["p2-load", "uais.p2-load.v1", "p2-load-issuer"],
  ["rum-approval", "uais.rum-approval.v1", "rum-independent-approver"],
  ["manual-accessibility", "uais.manual-accessibility.v1", "manual-a11y-reviewer"],
  ["dependency-review", "uais.dependency-review.v1", "dependency-audit-reviewer"],
  ["production-safety", "uais.production-safety.v1", "production-safety-verifier"],
].map(([id, receiptSchema, sourceAuthorityRole]) => ({
  id,
  receiptSchema,
  sourceAuthorityRole,
  mustDifferFromIndexAuthority: true,
}));
const derivedFieldAllowlist = Object.fromEntries(
  requiredReceiptSchemas.map((schema) => [
    schema,
    schema === "uais.production-safety.v1" ? ["safety"] : ["gates"],
  ]),
);
const receiptGateIds = {
  "uais.staging-health.v1": ["staging-health"],
  "uais.p1-load.v1": ["p1-cleanup", "p1-conservation", "p1-performance"],
  "uais.p2-load.v1": ["p2-active-user-ramp", "p2-invite-ramp", "p2-sustained-load"],
  "uais.rum-approval.v1": ["field-inp-p75"],
  "uais.manual-accessibility.v1": [
    "keyboard-journey",
    "non-color-information",
    "nvda-chrome",
    "reduced-motion",
    "reflow-200",
    "touch-targets",
    "voiceover-safari",
  ],
  "uais.dependency-review.v1": [
    "full-tree-dependency-review",
    "production-dependency-audit",
  ],
};
const secureCliInvocation = Symbol("secure-fixed-owner-pins-cli-invocation");
const productionProjectId = "prj_MZIjawDPTU4tj4yuTBsd9hyLxHXA";
const productionDomains = ["uais.top", "www.uais.top"];
const expectedRampTargets = [5, 20, 50, 100, 200];
const expectedP1OperationCounts = {
  taskRead: 200,
  checkpoint: 200,
  autosave: 600,
  submit: 200,
  teacherDecision: 20,
};
const expectedRumGroupKeys = new Set([
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
]);
const gateIds = [
  "staging-health",
  "p1-conservation",
  "p1-cleanup",
  "p1-performance",
  "p2-invite-ramp",
  "p2-active-user-ramp",
  "p2-sustained-load",
  "field-inp-p75",
  "voiceover-safari",
  "nvda-chrome",
  "keyboard-journey",
  "reflow-200",
  "reduced-motion",
  "touch-targets",
  "non-color-information",
  "production-dependency-audit",
  "full-tree-dependency-review",
];

export function runP2SoakAdmissionGate({
  manifestPath = defaultManifestPath,
  trustPolicyPath = "",
  ownerPins,
  root = process.cwd(),
  evaluationNowMs = Date.now(),
} = {}) {
  return runP2SoakAdmissionGateCore({
    manifestPath,
    trustPolicyPath,
    ownerPins,
    root,
    evaluationNowMs,
  });
}

function runP2SoakAdmissionGateCore({
  manifestPath,
  trustPolicyPath,
  ownerPins,
  root,
  evaluationNowMs,
}, invocationCapability = null) {
  const authoritativeInvocation = invocationCapability === secureCliInvocation;
  const pinErrors = validateOwnerPins(ownerPins);
  if (!trustPolicyPath) pinErrors.push("trust-policy-path-required");
  if (!Number.isFinite(evaluationNowMs) || evaluationNowMs < 0) {
    pinErrors.push("evaluation-now-invalid");
  }
  if (pinErrors.length > 0) {
    return invalidResult(pinErrors, {}, authoritativeInvocation);
  }

  const currentGitSha = readCurrentGitSha(root);
  if (!currentGitSha) {
    return invalidResult(["current-git-sha-unavailable"], {}, authoritativeInvocation);
  }
  let currentContentSha256;
  try {
    currentContentSha256 = computeUaisStagingCandidateContentSha(root);
  } catch {
    return invalidResult(
      ["current-candidate-content-digest-failed"],
      {},
      authoritativeInvocation,
    );
  }
  const currentCandidate = {
    gitSha: currentGitSha,
    contentSha256: currentContentSha256,
    deploymentId: ownerPins.candidate.deploymentId,
    deploymentHost: ownerPins.candidate.deploymentHost,
    projectId: ownerPins.candidate.projectId,
  };
  const candidatePinErrors = Object.entries(currentCandidate)
    .filter(([key, value]) => ownerPins.candidate[key] !== value)
    .map(([key]) => `owner-pin-candidate-mismatch:${key}`);
  if (candidatePinErrors.length > 0) {
    return invalidResult(candidatePinErrors, {}, authoritativeInvocation);
  }
  const currentLockfileSha256 = createHash("sha256")
    .update(readFileSync(join(root, "package-lock.json")))
    .digest("hex");
  const resolved = resolveSoakEvidencePacket({
    manifestPath,
    trustPolicyPath,
    expectedTrustPolicySha256: ownerPins.trustPolicySha256,
    expectedAuthorityKeyId: ownerPins.authorityKeyId,
    requiredArtifacts,
    expectedCandidate: currentCandidate,
    receiptValidators: createReceiptValidators({
      expectedCandidate: currentCandidate,
      expectedRunIds: ownerPins.expectedRuns,
      currentLockfileSha256,
      dependencyMitigation: ownerPins.dependencyMitigation,
      rumAuthorities: ownerPins.rumAuthorities,
      evaluationNowMs,
    }),
    derivedFieldAllowlist,
    derivedSanitizers: createDerivedSanitizers(),
  });
  if (!resolved.valid) {
    return invalidResult(
      resolved.errors,
      {
        candidate: { ...currentCandidate, matchesCurrentSource: true },
        evidenceSetId: resolved.evidenceSetId || null,
      },
      authoritativeInvocation,
    );
  }
  const authorityMaterialErrors = validatePinnedRumAuthorityMaterials({
    trustPolicyPath,
    ownerPins,
    resolved,
  });
  if (authorityMaterialErrors.length > 0) {
    return invalidResult(
      authorityMaterialErrors,
      {
        candidate: { ...currentCandidate, matchesCurrentSource: true },
        evidenceSetId: resolved.evidenceSetId || null,
      },
      authoritativeInvocation,
    );
  }
  if (resolved.evidenceSetId !== ownerPins.evidenceSetId) {
    return invalidResult(
      ["owner-pin-evidence-set-mismatch"],
      {
        candidate: { ...currentCandidate, matchesCurrentSource: true },
        evidenceSetId: resolved.evidenceSetId || null,
      },
      authoritativeInvocation,
    );
  }

  const gateResults = Object.fromEntries(gateIds.map((id) => [id, false]));
  let productionSafety = {
    valid: false,
    productionAuthorization: "unknown",
    productionGroupMode: "unknown",
    noProductionMutation: false,
    soakStarted: "unknown",
  };
  for (const artifact of resolved.artifacts) {
    const derived = artifact.derived;
    if (isRecord(derived?.gates)) {
      for (const [id, passed] of Object.entries(derived.gates)) {
        if (Object.hasOwn(gateResults, id)) gateResults[id] = passed === true;
      }
    }
    if (isRecord(derived?.safety)) productionSafety = derived.safety;
  }

  const blockedReasons = Object.entries(gateResults)
    .filter(([, passed]) => !passed)
    .map(([id]) => `${id}-not-pass`);
  if (productionSafety.valid !== true) {
    blockedReasons.push("production-safety-boundary-not-preserved");
  }
  if (productionSafety.soakStarted !== false) blockedReasons.push("soak-already-started");
  if (!resolved.promotionEligible) {
    blockedReasons.push("evidence-packet-not-promotion-eligible");
  }
  if (!authoritativeInvocation) blockedReasons.push("non-authoritative-injected-core");
  const soakAdmitted =
    authoritativeInvocation &&
    blockedReasons.length === 0 &&
    Object.values(gateResults).every(Boolean) &&
    productionSafety.valid === true &&
    productionSafety.soakStarted === false &&
    resolved.promotionEligible === true;
  const allSourceSignaturesVerified = resolved.artifacts.every(
    (artifact) => artifact.sourceAuthority?.signatureVerified === true,
  );
  return {
    exitCode: soakAdmitted ? 0 : 2,
    report: {
      target: "p2-staging-soak-admission",
      evaluatedAt: new Date(evaluationNowMs).toISOString(),
      status: soakAdmitted ? "SOAK_ADMITTED" : "SOAK_NOT_ADMITTED",
      soakAdmitted,
      evidenceSetId: resolved.evidenceSetId,
      candidate: { ...currentCandidate, matchesCurrentSource: true },
      gates: gateResults,
      blockedReasons: soakAdmitted ? [] : [...new Set(blockedReasons)],
      safety: {
        productionAuthorization: productionSafety.productionAuthorization,
        productionGroupMode: productionSafety.productionGroupMode,
        noProductionMutation: productionSafety.noProductionMutation,
        sourceAuthorityVerified: allSourceSignaturesVerified,
      },
      soak: {
        started:
          typeof productionSafety.soakStarted === "boolean"
            ? productionSafety.soakStarted
            : "unknown",
        startedAt: null,
      },
      evidence: resolved.artifacts.map((artifact) => ({
        id: artifact.id,
        receiptSchema: artifact.receiptSchema,
        byteLength: artifact.byteLength,
        sha256: artifact.sha256,
        integrityVerified: artifact.integrityVerified,
        promotionEligible: artifact.eligible,
        sourceAuthority: artifact.sourceAuthority,
      })),
      evidenceBoundary: {
        admissionIsNotCompletedSoak: true,
        manifestIsContentAddressedIndexOnly: true,
        sourceMetricsRecomputed: true,
        ownerTrustPinsVerified: authoritativeInvocation,
        admissionEligibleInvocation: authoritativeInvocation,
        packetSignatureVerified: resolved.authority.signatureVerified === true,
        sourceSignaturesVerified: allSourceSignaturesVerified,
        noNetworkUsed: true,
        noMutationPerformed: true,
        rawReceiptsOmitted: true,
        trustMaterialOmitted: true,
        humanEvidenceCannotBeAutomated: true,
        fieldRumMustBeApprovedRealUserData: true,
      },
    },
  };
}

const mainModule =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (mainModule) {
  const args = process.argv.slice(2);
  const manifestPath = readOption(args, "--manifest") ?? defaultManifestPath;
  const trustPolicyPath = readOption(args, "--trust-policy") ?? "";
  const pins = readFixedOwnerPins();
  const result = pins.ok
    ? runP2SoakAdmissionGateCore(
      {
        manifestPath,
        trustPolicyPath,
        ownerPins: pins.value,
        root: process.cwd(),
        evaluationNowMs: Date.now(),
      },
      secureCliInvocation,
    )
    : invalidResult(pins.errors);
  process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
  process.exitCode = result.exitCode;
}

function createReceiptValidators({
  expectedCandidate,
  expectedRunIds,
  currentLockfileSha256,
  dependencyMitigation,
  rumAuthorities,
  evaluationNowMs,
}) {
  return {
    "uais.staging-health.v1": (payload, context) =>
      validateStagingHealth(payload, context, expectedCandidate, evaluationNowMs),
    "uais.p1-load.v1": (payload) =>
      validateP1Load(payload, expectedRunIds.p1),
    "uais.p2-load.v1": (payload) =>
      validateP2Load(payload, expectedRunIds.p2),
    "uais.rum-approval.v1": (payload, context) =>
      validateRumApproval(
        payload,
        context,
        expectedRunIds.rum,
        expectedCandidate,
        rumAuthorities,
        evaluationNowMs,
      ),
    "uais.manual-accessibility.v1": (payload, context) =>
      validateManualAccessibility(
        payload,
        context,
        expectedRunIds.manual,
        evaluationNowMs,
      ),
    "uais.dependency-review.v1": (payload) =>
      validateDependencyReview(
        payload,
        currentLockfileSha256,
        dependencyMitigation,
        evaluationNowMs,
      ),
    "uais.production-safety.v1": (payload, context) =>
      validateProductionSafetyReceipt(
        payload,
        context,
        expectedCandidate,
        evaluationNowMs,
      ),
  };
}

function createDerivedSanitizers() {
  const sanitizers = Object.fromEntries(
    Object.entries(receiptGateIds).map(([schema, ids]) => [
      schema,
      (derived) => {
        if (!hasExactKeys(derived, ["gates"]) || !hasExactKeys(derived.gates, ids)) {
          return { valid: false };
        }
        if (ids.some((id) => typeof derived.gates[id] !== "boolean")) {
          return { valid: false };
        }
        return {
          valid: true,
          value: {
            gates: Object.fromEntries(ids.map((id) => [id, derived.gates[id]])),
          },
        };
      },
    ]),
  );
  sanitizers["uais.production-safety.v1"] = (derived) => {
    const keys = [
      "noProductionMutation",
      "productionAuthorization",
      "productionGroupMode",
      "soakStarted",
      "valid",
    ];
    if (!hasExactKeys(derived, ["safety"]) || !hasExactKeys(derived.safety, keys)) {
      return { valid: false };
    }
    const safety = derived.safety;
    if (
      typeof safety.valid !== "boolean" ||
      typeof safety.noProductionMutation !== "boolean" ||
      typeof safety.soakStarted !== "boolean" ||
      !["NO", "unknown"].includes(safety.productionAuthorization) ||
      !["off", "unknown"].includes(safety.productionGroupMode)
    ) return { valid: false };
    return { valid: true, value: { safety: { ...safety } } };
  };
  return sanitizers;
}

function validateStagingHealth(payload, context, expectedCandidate, evaluationNowMs) {
  const errors = [];
  if (!hasExactKeys(payload, ["executionClass", "samples", "status"])) {
    errors.push("health-payload-keys-invalid");
  }
  if (!validStatus(payload?.status)) errors.push("health-status-invalid");
  if (!new Set(["external-live", "simulation"]).has(payload?.executionClass)) {
    errors.push("health-execution-class-invalid");
  }
  if (!Array.isArray(payload?.samples) || payload.samples.length < 16 || payload.samples.length > 20) {
    errors.push("health-samples-invalid");
  }
  const timestamps = [];
  const requestFingerprints = new Set();
  for (const sample of Array.isArray(payload?.samples) ? payload.samples : []) {
    if (!hasExactKeys(sample, [
      "app",
      "candidateBound",
      "database",
      "deploymentHost",
      "deploymentId",
      "httpStatus",
      "migrations",
      "observedAt",
      "requestIdFingerprint",
    ])) {
      errors.push("health-sample-keys-invalid");
      continue;
    }
    const timestamp = Date.parse(sample.observedAt);
    if (!Number.isFinite(timestamp)) errors.push("health-sample-time-invalid");
    else timestamps.push(timestamp);
    if (!Number.isInteger(sample.httpStatus)) errors.push("health-http-status-invalid");
    if (!["ok", "fail"].includes(sample.app)) errors.push("health-app-status-invalid");
    if (!["ok", "fail"].includes(sample.database)) errors.push("health-database-status-invalid");
    if (!["ok", "fail"].includes(sample.migrations)) errors.push("health-migrations-status-invalid");
    if (typeof sample.candidateBound !== "boolean") errors.push("health-candidate-binding-invalid");
    if (!/^[0-9a-f]{64}$/.test(sample.requestIdFingerprint ?? "")) {
      errors.push("health-request-fingerprint-invalid");
    } else if (requestFingerprints.has(sample.requestIdFingerprint)) {
      errors.push("health-request-fingerprint-duplicate");
    }
    requestFingerprints.add(sample.requestIdFingerprint);
    if (
      sample.deploymentId !== expectedCandidate.deploymentId ||
      sample.deploymentHost !== expectedCandidate.deploymentHost
    ) {
      errors.push("health-sample-deployment-mismatch");
    }
  }
  const issuedAtMs = Date.parse(context?.issuedAt ?? "");
  if (!Number.isFinite(issuedAtMs)) errors.push("health-receipt-issued-at-invalid");
  const lastObservedAt = timestamps.at(-1);
  if (
    !Number.isFinite(lastObservedAt) ||
    lastObservedAt > evaluationNowMs ||
    evaluationNowMs - lastObservedAt > 120_000
  ) errors.push("health-evaluation-freshness-invalid");
  for (let index = 1; index < timestamps.length; index += 1) {
    const gap = timestamps[index] - timestamps[index - 1];
    if (gap < 45_000 || gap > 75_000) errors.push("health-cadence-invalid");
  }
  if (errors.length > 0) return invalidSource(errors);
  const duration = timestamps.at(-1) - timestamps[0];
  const fullDuration = duration >= 900_000 && duration <= 1_050_000;
  const receiptFresh =
    lastObservedAt <= issuedAtMs && issuedAtMs - lastObservedAt <= 120_000;
  const pass =
    payload.status === "PASS" &&
    payload.executionClass === "external-live" &&
    fullDuration &&
    receiptFresh &&
    payload.samples.every(
      (sample) =>
        sample.httpStatus === 200 &&
        sample.app === "ok" &&
        sample.database === "ok" &&
        sample.migrations === "ok" &&
        sample.candidateBound === true,
    );
  return validSource({
    eligible: payload.executionClass === "external-live",
    gates: { "staging-health": pass },
  });
}

function validateP1Load(payload, expectedRunId) {
  const errors = [];
  if (!hasExactKeys(payload, [
    "cleanup",
    "conservation",
    "executionClass",
    "performance",
    "runId",
    "status",
    "studentCount",
  ])) errors.push("p1-payload-keys-invalid");
  if (!validStatus(payload?.status)) errors.push("p1-status-invalid");
  if (!["live", "diagnostic", "simulation"].includes(payload?.executionClass)) {
    errors.push("p1-execution-class-invalid");
  }
  if (!validRunId(payload?.runId, "p1")) errors.push("p1-run-id-invalid");
  if (payload?.runId !== expectedRunId) errors.push("p1-run-id-mismatch");
  if (payload?.studentCount !== 200) errors.push("p1-student-count-invalid");
  if (!hasExactKeys(payload?.conservation, [
    "accepted",
    "attempts",
    "awaiting",
    "duplicateVersions",
    "events",
    "outbox",
    "profiles",
    "submissions",
    "versions",
  ])) errors.push("p1-conservation-keys-invalid");
  if (!hasExactKeys(payload?.cleanup, [
    "exactPrefixResidueZero",
    "leaseReleased",
    "restoreRowsRemaining",
    "sourceRowsRemaining",
  ])) errors.push("p1-cleanup-keys-invalid");
  if (!hasExactKeys(payload?.performance, [
    "autosaveWindowMs",
    "maximumOperationP95Ms",
    "maximumSubmitWindowMs",
    "operationSamplesMs",
    "passClaimAuthorized",
    "submitWindowMs",
  ])) errors.push("p1-performance-keys-invalid");
  if (!hasExactKeys(payload?.performance?.operationSamplesMs, Object.keys(expectedP1OperationCounts))) {
    errors.push("p1-operation-sample-keys-invalid");
  }
  for (const [operation, count] of Object.entries(expectedP1OperationCounts)) {
    if (!validSamples(payload?.performance?.operationSamplesMs?.[operation], count, count)) {
      errors.push(`p1-${operation}-samples-invalid`);
    }
  }
  for (const value of [
    payload?.performance?.autosaveWindowMs,
    payload?.performance?.submitWindowMs,
    payload?.performance?.maximumSubmitWindowMs,
    payload?.performance?.maximumOperationP95Ms,
  ]) {
    if (!isFiniteNonNegative(value)) errors.push("p1-performance-number-invalid");
  }
  if (typeof payload?.performance?.passClaimAuthorized !== "boolean") {
    errors.push("p1-pass-authorization-invalid");
  }
  if (errors.length > 0) return invalidSource(errors);
  const live = payload.executionClass === "live";
  const conservation = payload.conservation;
  const cleanup = payload.cleanup;
  const performance = payload.performance;
  const conservationPass =
    live &&
    conservation.attempts === 200 &&
    conservation.submissions === 200 &&
    conservation.versions === 200 &&
    conservation.profiles === 200 &&
    conservation.duplicateVersions === 0 &&
    conservation.accepted === 20 &&
    conservation.awaiting === 180 &&
    conservation.accepted + conservation.awaiting === conservation.submissions &&
    conservation.events === 440 &&
    conservation.outbox === 440 &&
    conservation.events === conservation.outbox;
  const cleanupPass =
    live &&
    cleanup.sourceRowsRemaining === 0 &&
    cleanup.restoreRowsRemaining === 0 &&
    cleanup.exactPrefixResidueZero === true &&
    cleanup.leaseReleased === true;
  const operationP95Pass = Object.entries(expectedP1OperationCounts).every(
    ([operation]) =>
      percentile(performance.operationSamplesMs[operation], 0.95) <=
      performance.maximumOperationP95Ms,
  );
  const performancePass =
    live &&
    payload.status === "PASS" &&
    performance.passClaimAuthorized === true &&
    performance.autosaveWindowMs >= 300_000 &&
    performance.maximumSubmitWindowMs === 30_000 &&
    performance.submitWindowMs <= performance.maximumSubmitWindowMs &&
    performance.maximumOperationP95Ms === 1_500 &&
    operationP95Pass;
  return validSource({
    eligible: live,
    gates: {
      "p1-conservation": conservationPass,
      "p1-cleanup": cleanupPass,
      "p1-performance": performancePass,
    },
  });
}

function validateP2Load(payload, expectedRunId) {
  const errors = [];
  if (!hasExactKeys(payload, [
    "activeUserStages",
    "cleanup",
    "executionClass",
    "groupTopology",
    "inviteStages",
    "maximumP95Ms",
    "runId",
    "status",
    "sustained",
  ])) errors.push("p2-payload-keys-invalid");
  if (!validStatus(payload?.status)) errors.push("p2-status-invalid");
  if (!["live", "diagnostic", "simulation", "fixture"].includes(payload?.executionClass)) {
    errors.push("p2-execution-class-invalid");
  }
  if (!validRunId(payload?.runId, "p2")) errors.push("p2-run-id-invalid");
  if (payload?.runId !== expectedRunId) errors.push("p2-run-id-mismatch");
  if (payload?.maximumP95Ms !== 2_000) errors.push("p2-maximum-p95-invalid");
  validateRamp(payload?.inviteStages, "invite", errors);
  validateRamp(payload?.activeUserStages, "active", errors);
  const topology = validateGroupTopology(payload?.groupTopology, errors);
  if (!hasExactKeys(payload?.sustained, [
    "activeUsers",
    "actorFingerprints",
    "groupRequestCounts",
    "latenciesMs",
    "requestCount",
    "rounds",
  ])) errors.push("p2-sustained-keys-invalid");
  if (
    payload?.sustained?.activeUsers !== 200 ||
    payload?.sustained?.rounds !== 10 ||
    payload?.sustained?.requestCount !== 2_000 ||
    !validSamples(payload?.sustained?.latenciesMs, 2_000, 2_000) ||
    !validFingerprintSet(payload?.sustained?.actorFingerprints, 200)
  ) errors.push("p2-sustained-shape-invalid");
  const sustainedGroupCounts = validateSustainedGroupCounts(
    payload?.sustained?.groupRequestCounts,
    topology.groups,
    errors,
  );
  if (!hasExactKeys(payload?.cleanup, [
    "restoreRowsRemaining",
    "runTaggedResidueZero",
    "sourceRowsRemaining",
  ])) errors.push("p2-cleanup-keys-invalid");
  if (errors.length > 0) return invalidSource(errors);
  const live = payload.executionClass === "live";
  const cleanupPass =
    payload.cleanup.sourceRowsRemaining === 0 &&
    payload.cleanup.restoreRowsRemaining === 0 &&
    payload.cleanup.runTaggedResidueZero === true;
  const invitePass =
    live &&
    payload.status === "PASS" &&
    cleanupPass &&
    payload.inviteStages.every(
      (stage, index) =>
        stage.targetUsers === expectedRampTargets[index] &&
        stage.completedUsers === stage.targetUsers &&
        stage.inviteeFingerprints.length === stage.targetUsers &&
        new Set(stage.inviteeFingerprints).size === stage.targetUsers &&
        percentile(stage.latenciesMs, 0.95) < payload.maximumP95Ms,
    );
  const activePass =
    live &&
    payload.status === "PASS" &&
    cleanupPass &&
    payload.activeUserStages.every(
      (stage, index) =>
        stage.targetActiveUsers === expectedRampTargets[index] &&
        stage.observedDistinctActors === stage.targetActiveUsers &&
        stage.actorFingerprints.length === stage.targetActiveUsers &&
        new Set(stage.actorFingerprints).size === stage.targetActiveUsers &&
        percentile(stage.latenciesMs, 0.95) < payload.maximumP95Ms,
    );
  const sustainedPass =
    live &&
    payload.status === "PASS" &&
    cleanupPass &&
    activePass &&
    topology.valid &&
    sustainedGroupCounts.valid &&
    sameStringSet(
      payload.inviteStages.at(-1).inviteeFingerprints,
      payload.activeUserStages.at(-1).actorFingerprints,
    ) &&
    sameStringSet(
      payload.activeUserStages.at(-1).actorFingerprints,
      topology.actorFingerprints,
    ) &&
    sameStringSet(
      payload.sustained.actorFingerprints,
      topology.actorFingerprints,
    ) &&
    sameStringSet(
      sustainedGroupCounts.actorFingerprints,
      topology.actorFingerprints,
    ) &&
    sameStringSet(topology.groupFingerprints, sustainedGroupCounts.groupFingerprints) &&
    percentile(payload.sustained.latenciesMs, 0.95) < payload.maximumP95Ms;
  return validSource({
    eligible: live,
    gates: {
      "p2-invite-ramp": invitePass,
      "p2-active-user-ramp": activePass,
      "p2-sustained-load": sustainedPass,
    },
  });
}

function validateRamp(stages, kind, errors) {
  if (!Array.isArray(stages) || stages.length !== expectedRampTargets.length) {
    errors.push(`p2-${kind}-stages-invalid`);
    return;
  }
  stages.forEach((stage, index) => {
    const targetKey = kind === "invite" ? "targetUsers" : "targetActiveUsers";
    const observedKey = kind === "invite" ? "completedUsers" : "observedDistinctActors";
    const fingerprintKey = kind === "invite" ? "inviteeFingerprints" : "actorFingerprints";
    if (!hasExactKeys(stage, [fingerprintKey, observedKey, "latenciesMs", targetKey])) {
      errors.push(`p2-${kind}-stage-keys-invalid`);
      return;
    }
    const target = expectedRampTargets[index];
    if (
      stage[targetKey] !== target ||
      !Number.isInteger(stage[observedKey]) ||
      !validFingerprintSet(stage[fingerprintKey], target) ||
      !validSamples(stage.latenciesMs, target, target * 10)
    ) errors.push(`p2-${kind}-stage-shape-invalid`);
  });
}

function validateGroupTopology(value, errors) {
  if (!Array.isArray(value) || value.length !== 40) {
    errors.push("p2-group-topology-invalid");
    return { valid: false, groupFingerprints: [], actorFingerprints: [], groups: [] };
  }
  const groupFingerprints = [];
  const actorFingerprints = [];
  for (const group of value) {
    if (!hasExactKeys(group, ["actorFingerprints", "groupFingerprint"])) {
      errors.push("p2-group-topology-entry-keys-invalid");
      continue;
    }
    if (!isDigest(group.groupFingerprint) || !validFingerprintSet(group.actorFingerprints, 5)) {
      errors.push("p2-group-topology-entry-invalid");
      continue;
    }
    groupFingerprints.push(group.groupFingerprint);
    actorFingerprints.push(...group.actorFingerprints);
  }
  const valid =
    groupFingerprints.length === 40 &&
    new Set(groupFingerprints).size === 40 &&
    actorFingerprints.length === 200 &&
    new Set(actorFingerprints).size === 200;
  if (!valid) errors.push("p2-group-topology-conservation-invalid");
  return {
    valid,
    groupFingerprints,
    actorFingerprints,
    groups: value.map((group) => ({
      groupFingerprint: group.groupFingerprint,
      actorFingerprints: group.actorFingerprints,
    })),
  };
}

function validateSustainedGroupCounts(value, topologyGroups, errors) {
  if (!Array.isArray(value) || value.length !== 40) {
    errors.push("p2-sustained-group-counts-invalid");
    return { valid: false, groupFingerprints: [], actorFingerprints: [] };
  }
  const groupFingerprints = [];
  const actorFingerprints = [];
  let totalRequests = 0;
  for (const group of value) {
    if (!hasExactKeys(group, [
      "actorRequestCounts",
      "groupFingerprint",
      "requestCount",
    ])) {
      errors.push("p2-sustained-group-entry-keys-invalid");
      continue;
    }
    if (
      !isDigest(group.groupFingerprint) ||
      group.requestCount !== 50 ||
      !Array.isArray(group.actorRequestCounts) ||
      group.actorRequestCounts.length !== 5
    ) {
      errors.push("p2-sustained-group-entry-invalid");
      continue;
    }
    const groupActorFingerprints = [];
    let actorRequestTotal = 0;
    let actorConservationValid = true;
    for (const actor of group.actorRequestCounts) {
      if (!hasExactKeys(actor, ["actorFingerprint", "requestCount"])) {
        actorConservationValid = false;
        continue;
      }
      if (!isDigest(actor.actorFingerprint) || actor.requestCount !== 10) {
        actorConservationValid = false;
      }
      groupActorFingerprints.push(actor.actorFingerprint);
      actorFingerprints.push(actor.actorFingerprint);
      actorRequestTotal += Number.isInteger(actor.requestCount) ? actor.requestCount : 0;
    }
    const topologyGroup = Array.isArray(topologyGroups)
      ? topologyGroups.find(
        (entry) => entry.groupFingerprint === group.groupFingerprint,
      )
      : undefined;
    if (
      !actorConservationValid ||
      actorRequestTotal !== group.requestCount ||
      new Set(groupActorFingerprints).size !== 5 ||
      !topologyGroup ||
      !sameStringSet(groupActorFingerprints, topologyGroup.actorFingerprints)
    ) errors.push("p2-sustained-actor-request-conservation-invalid");
    groupFingerprints.push(group.groupFingerprint);
    totalRequests += group.requestCount;
  }
  const valid =
    groupFingerprints.length === 40 &&
    new Set(groupFingerprints).size === 40 &&
    actorFingerprints.length === 200 &&
    new Set(actorFingerprints).size === 200 &&
    totalRequests === 2_000;
  if (!valid) errors.push("p2-sustained-group-conservation-invalid");
  return { valid, groupFingerprints, actorFingerprints };
}

function validateRumApproval(
  payload,
  context,
  expectedRun,
  expectedCandidate,
  rumAuthorities,
  evaluationNowMs,
) {
  const errors = [];
  if (!hasExactKeys(payload, [
    "approvedAt",
    "approvedGroupKeysSha256",
    "approvedOperatorFingerprints",
    "cohortId",
    "collectorSourceReceipt",
    "collectorSourceReceiptSha256",
    "executionClass",
    "independentApprovalVerified",
    "runId",
    "status",
  ])) errors.push("rum-payload-keys-invalid");
  if (!validStatus(payload?.status)) errors.push("rum-status-invalid");
  if (!["real-user", "synthetic", "operator-attested"].includes(payload?.executionClass)) {
    errors.push("rum-execution-class-invalid");
  }
  if (!validRunId(payload?.runId, "p2-inp")) errors.push("rum-run-id-invalid");
  if (!validRunId(payload?.cohortId, "p2-inp")) errors.push("rum-cohort-id-invalid");
  if (payload?.runId !== expectedRun?.runId) errors.push("rum-run-id-mismatch");
  if (payload?.cohortId !== expectedRun?.cohortId) errors.push("rum-cohort-id-mismatch");
  if (typeof payload?.independentApprovalVerified !== "boolean") {
    errors.push("rum-approval-flag-invalid");
  }
  if (!isDigest(payload?.approvedGroupKeysSha256)) {
    errors.push("rum-approved-group-keys-digest-invalid");
  }
  if (!isDigest(payload?.collectorSourceReceiptSha256)) {
    errors.push("rum-collector-source-receipt-digest-invalid");
  }
  if (!validFingerprintSet(payload?.approvedOperatorFingerprints, 3)) {
    errors.push("rum-approved-operator-fingerprints-invalid");
  }
  const approvedAt = Date.parse(payload?.approvedAt ?? "");
  const receiptIssuedAt = Date.parse(context?.issuedAt ?? "");
  if (
    !Number.isFinite(approvedAt) ||
    !Number.isFinite(receiptIssuedAt) ||
    approvedAt > receiptIssuedAt ||
    receiptIssuedAt > evaluationNowMs
  ) errors.push("rum-approval-time-invalid");

  const sourceReceipt = payload?.collectorSourceReceipt;
  if (!hasExactKeys(sourceReceipt, ["payload", "signature"])) {
    errors.push("rum-collector-source-receipt-keys-invalid");
  }
  const sourcePayload = sourceReceipt?.payload;
  const sourceSignature = sourceReceipt?.signature;
  if (!hasExactKeys(sourcePayload, [
    "accountMappingDigestSha256",
    "actionScope",
    "candidateContentSha256",
    "candidateGitSha",
    "cleanupReceipt",
    "cleanupReceiptSha256",
    "cohortId",
    "collectorKeyId",
    "collectorKeyVersion",
    "collectorPublicKeySpkiSha256",
    "deploymentHost",
    "deploymentId",
    "generatedAt",
    "groups",
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
  ])) errors.push("rum-collector-payload-keys-invalid");
  if (!hasExactKeys(sourceSignature, [
    "algorithm",
    "keyId",
    "payloadSha256",
    "signatureBase64",
  ])) errors.push("rum-collector-signature-keys-invalid");
  if (
    sourcePayload?.schemaVersion !== 1 ||
    sourcePayload?.kind !== "uais-staging-inp-rum-source" ||
    sourcePayload?.actionScope !== "collect-real-user-inp-staging-only" ||
    sourcePayload?.percentileAlgorithm !==
      "postgresql-percentile-cont-linear-interpolation-v1"
  ) errors.push("rum-collector-payload-schema-invalid");
  if (
    sourcePayload?.candidateGitSha !== expectedCandidate.gitSha ||
    sourcePayload?.candidateContentSha256 !== expectedCandidate.contentSha256 ||
    sourcePayload?.projectId !== expectedCandidate.projectId ||
    sourcePayload?.deploymentId !== expectedCandidate.deploymentId ||
    sourcePayload?.deploymentHost !== expectedCandidate.deploymentHost
  ) errors.push("rum-collector-candidate-mismatch");
  if (
    sourcePayload?.runId !== expectedRun?.runId ||
    sourcePayload?.cohortId !== expectedRun?.cohortId ||
    sourcePayload?.runId !== payload?.runId ||
    sourcePayload?.cohortId !== payload?.cohortId
  ) errors.push("rum-collector-run-or-cohort-mismatch");
  if (
    sourcePayload?.collectorKeyId !== rumAuthorities?.collector?.keyId ||
    sourcePayload?.collectorKeyVersion !== rumAuthorities?.collector?.keyVersion ||
    sourcePayload?.collectorPublicKeySpkiSha256 !==
      rumAuthorities?.collector?.publicKeySpkiSha256 ||
    sourceSignature?.keyId !== rumAuthorities?.collector?.keyId ||
    sourceSignature?.algorithm !== "Ed25519"
  ) errors.push("rum-collector-authority-binding-invalid");
  for (const key of [
    "accountMappingDigestSha256",
    "cleanupReceiptSha256",
    "operatorAllowlistSha256",
    "sourceReportSha256",
  ]) {
    if (!isDigest(sourcePayload?.[key])) errors.push(`rum-${key}-invalid`);
  }
  if (!validFingerprintSet(sourcePayload?.operatorFingerprints, 3)) {
    errors.push("rum-operator-fingerprints-invalid");
  } else {
    if (!sameStringSet(sourcePayload.operatorFingerprints, payload.approvedOperatorFingerprints)) {
      errors.push("rum-approved-operator-set-mismatch");
    }
    const expectedAllowlistDigest = sha256Canonical(sourcePayload.operatorFingerprints);
    if (sourcePayload.operatorAllowlistSha256 !== expectedAllowlistDigest) {
      errors.push("rum-operator-allowlist-digest-mismatch");
    }
    const authorityMaterialDigests = [
      rumAuthorities?.collector?.publicKeySpkiSha256,
      rumAuthorities?.approver?.publicKeySpkiSha256,
      rumAuthorities?.index?.publicKeySpkiSha256,
    ];
    if (sourcePayload.operatorFingerprints.some((entry) => authorityMaterialDigests.includes(entry))) {
      errors.push("rum-operator-and-authority-material-not-distinct");
    }
  }

  const measurementStartedAt = Date.parse(sourcePayload?.measurementStartedAt ?? "");
  const measurementCompletedAt = Date.parse(sourcePayload?.measurementCompletedAt ?? "");
  const generatedAt = Date.parse(sourcePayload?.generatedAt ?? "");
  if (
    !Number.isFinite(measurementStartedAt) ||
    !Number.isFinite(measurementCompletedAt) ||
    !Number.isFinite(generatedAt) ||
    measurementStartedAt >= measurementCompletedAt ||
    measurementCompletedAt > generatedAt ||
    generatedAt > approvedAt ||
    approvedAt > receiptIssuedAt
  ) errors.push("rum-measurement-window-invalid");
  if (
    !Number.isFinite(measurementCompletedAt) ||
    measurementCompletedAt > evaluationNowMs ||
    evaluationNowMs - measurementCompletedAt > 24 * 60 * 60 * 1000
  ) errors.push("rum-evaluation-freshness-invalid");

  const cleanup = sourcePayload?.cleanupReceipt;
  if (!hasExactKeys(cleanup, [
    "accountCleanupVerifiedAt",
    "accountMappingsRemaining",
    "actionScope",
    "cohortId",
    "cohortTombstoneRetained",
    "kind",
    "rawSampleCleanupVerifiedAt",
    "rawSampleRowsRemaining",
    "runId",
    "schemaVersion",
    "temporaryAccountsRemaining",
  ])) errors.push("rum-cleanup-receipt-keys-invalid");
  const accountCleanupVerifiedAt = Date.parse(
    cleanup?.accountCleanupVerifiedAt ?? "",
  );
  const rawSampleCleanupVerifiedAt = Date.parse(
    cleanup?.rawSampleCleanupVerifiedAt ?? "",
  );
  if (
    cleanup?.schemaVersion !== 1 ||
    cleanup?.kind !== "uais-staging-inp-rum-cleanup" ||
    cleanup?.actionScope !== "cleanup-staging-rum-only" ||
    cleanup?.runId !== expectedRun?.runId ||
    cleanup?.cohortId !== expectedRun?.cohortId ||
    cleanup?.rawSampleRowsRemaining !== 0 ||
    cleanup?.accountMappingsRemaining !== 0 ||
    cleanup?.temporaryAccountsRemaining !== 0 ||
    cleanup?.cohortTombstoneRetained !== true ||
    !Number.isFinite(accountCleanupVerifiedAt) ||
    !Number.isFinite(rawSampleCleanupVerifiedAt) ||
    accountCleanupVerifiedAt < measurementCompletedAt ||
    rawSampleCleanupVerifiedAt < accountCleanupVerifiedAt ||
    rawSampleCleanupVerifiedAt - accountCleanupVerifiedAt > 60_000 ||
    rawSampleCleanupVerifiedAt > generatedAt ||
    cleanup?.rawSampleCleanupVerifiedAt !== sourcePayload?.generatedAt
  ) errors.push("rum-cleanup-receipt-invalid");
  if (sourcePayload?.cleanupReceiptSha256 !== sha256Canonical(cleanup)) {
    errors.push("rum-cleanup-receipt-digest-mismatch");
  }

  const expectedGroupOrder = [...expectedRumGroupKeys];
  const observedGroupOrder = [];
  let totalRumSampleCount = 0;
  let allGroupsPass = true;
  if (!Array.isArray(sourcePayload?.groups) || sourcePayload.groups.length !== expectedGroupOrder.length) {
    errors.push("rum-groups-invalid");
  }
  for (const group of Array.isArray(sourcePayload?.groups) ? sourcePayload.groups : []) {
    if (!hasExactKeys(group, [
      "distinctAdultHumanCount",
      "distinctOperatorCount",
      "histogram",
      "journey",
      "p75Ms",
      "role",
      "sampleCount",
      "viewportClass",
    ])) {
      errors.push("rum-group-keys-invalid");
      continue;
    }
    const groupKey = `${group.role}\u0000${group.journey}\u0000${group.viewportClass}`;
    observedGroupOrder.push(groupKey);
    if (Number.isInteger(group.sampleCount) && group.sampleCount >= 0) {
      totalRumSampleCount += group.sampleCount;
    }
    if (
      !Number.isInteger(group.sampleCount) ||
      group.sampleCount < 30 ||
      group.sampleCount > 4_000 ||
      group.distinctOperatorCount !== 3 ||
      group.distinctAdultHumanCount !== 3 ||
      !isFiniteNonNegative(group.p75Ms) ||
      !validRumHistogram(group.histogram, group.sampleCount)
    ) {
      errors.push("rum-group-metrics-invalid");
      continue;
    }
    const recomputedP75 = percentileContHistogram(group.histogram, 0.75);
    if (!Number.isFinite(recomputedP75) || Math.abs(recomputedP75 - group.p75Ms) > 1e-9) {
      errors.push("rum-group-p75-recompute-mismatch");
    } else if (recomputedP75 > 200) {
      allGroupsPass = false;
    }
  }
  if (
    observedGroupOrder.length !== expectedGroupOrder.length ||
    observedGroupOrder.some((entry, index) => entry !== expectedGroupOrder[index])
  ) errors.push("rum-group-order-or-identity-invalid");
  if (totalRumSampleCount > 4_000) {
    errors.push("rum-total-sample-budget-exceeded");
  }
  const approvedGroupProjection = (Array.isArray(sourcePayload?.groups) ? sourcePayload.groups : [])
    .map(({ role, journey, viewportClass }) => ({ role, journey, viewportClass }));
  if (payload?.approvedGroupKeysSha256 !== sha256Canonical(approvedGroupProjection)) {
    errors.push("rum-approved-group-keys-digest-mismatch");
  }

  let payloadBytes;
  try {
    payloadBytes = canonicalJsonBytes(sourcePayload);
  } catch {
    errors.push("rum-collector-payload-not-canonicalizable");
  }
  if (payloadBytes) {
    const payloadSha256 = sha256Bytes(payloadBytes);
    if (sourceSignature?.payloadSha256 !== payloadSha256) {
      errors.push("rum-collector-payload-digest-mismatch");
    }
    const signatureBytes = decodeCanonicalBase64(sourceSignature?.signatureBase64);
    try {
      const collectorPublicKey = createPublicKey(rumAuthorities.collector.publicKeySpkiPem);
      if (
        !signatureBytes ||
        collectorPublicKey.asymmetricKeyType !== "ed25519" ||
        !verify(null, payloadBytes, collectorPublicKey, signatureBytes)
      ) errors.push("rum-collector-signature-invalid");
    } catch {
      errors.push("rum-collector-signature-invalid");
    }
  }
  if (payload?.collectorSourceReceiptSha256 !== sha256Canonical(sourceReceipt)) {
    errors.push("rum-collector-source-receipt-digest-mismatch");
  }

  if (errors.length > 0) return invalidSource(errors);
  const independentlyApprovedRealUsers =
    payload.executionClass === "real-user" &&
    payload.independentApprovalVerified === true &&
    context?.sourceAuthority?.role === "rum-independent-approver" &&
    context?.sourceAuthority?.keyId === rumAuthorities.approver.keyId &&
    context?.sourceAuthority?.signatureVerified === true;
  const pass =
    payload.status === "PASS" &&
    independentlyApprovedRealUsers &&
    allGroupsPass;
  return validSource({
    eligible: independentlyApprovedRealUsers,
    gates: { "field-inp-p75": pass },
  });
}

function validateManualAccessibility(
  payload,
  context,
  expectedExecutionId,
  evaluationNowMs,
) {
  const errors = [];
  if (!hasExactKeys(payload, [
    "cleanupResidueZero",
    "executionClass",
    "executionId",
    "gates",
    "isolatedBackendVerified",
    "observedAt",
    "productionHostOpened",
    "reviewerIndependent",
    "routeMatrixDigestSha256",
    "status",
  ])) errors.push("manual-payload-keys-invalid");
  if (!validStatus(payload?.status)) errors.push("manual-status-invalid");
  if (!["human", "automated"].includes(payload?.executionClass)) {
    errors.push("manual-execution-class-invalid");
  }
  if (!validRunId(payload?.executionId, "manual-a11y")) {
    errors.push("manual-execution-id-invalid");
  } else if (payload.executionId !== expectedExecutionId) {
    errors.push("manual-execution-id-mismatch");
  }
  if (!isDigest(payload?.routeMatrixDigestSha256)) {
    errors.push("manual-route-matrix-digest-invalid");
  }
  const observedAt = Date.parse(payload?.observedAt ?? "");
  const receiptIssuedAt = Date.parse(context?.issuedAt ?? "");
  if (
    !Number.isFinite(observedAt) ||
    !Number.isFinite(receiptIssuedAt) ||
    observedAt > receiptIssuedAt ||
    receiptIssuedAt - observedAt > 24 * 60 * 60 * 1000
  ) errors.push("manual-observation-time-invalid");
  if (
    !Number.isFinite(observedAt) ||
    observedAt > evaluationNowMs ||
    evaluationNowMs - observedAt > 24 * 60 * 60 * 1000
  ) errors.push("manual-evaluation-freshness-invalid");
  const manualKeys = [
    "keyboardJourney",
    "nonColorInformation",
    "nvdaChrome",
    "reducedMotion",
    "reflow200",
    "touchTargets",
    "voiceOverSafari",
  ];
  if (!hasExactKeys(payload?.gates, manualKeys)) errors.push("manual-gates-keys-invalid");
  const voiceOver = payload?.gates?.voiceOverSafari;
  const nvda = payload?.gates?.nvdaChrome;
  for (const [name, gate] of [["voiceover", voiceOver], ["nvda", nvda]]) {
    if (!hasExactKeys(gate, [
      "assistiveTechnology",
      "assistiveTechnologyVersion",
      "browser",
      "browserVersion",
      "humanVerified",
      "journeys",
      "os",
      "osVersion",
      "roles",
      "status",
    ])) errors.push(`${name}-gate-keys-invalid`);
    if (!validHumanRoles(gate?.roles)) errors.push(`${name}-roles-invalid`);
    validateAssistiveJourneys(gate?.journeys, name, errors);
    for (const versionKey of ["assistiveTechnologyVersion", "browserVersion", "osVersion"]) {
      if (!/^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,63}$/.test(gate?.[versionKey] ?? "")) {
        errors.push(`${name}-${versionKey}-invalid`);
      }
    }
  }
  for (const key of [
    "keyboardJourney",
    "reflow200",
    "reducedMotion",
    "touchTargets",
    "nonColorInformation",
  ]) {
    const gate = payload?.gates?.[key];
    if (!hasExactKeys(gate, ["evidenceSha256", "humanVerified", "roles", "status"])) {
      errors.push(`${key}-gate-keys-invalid`);
    }
    if (!validHumanRoles(gate?.roles)) errors.push(`${key}-roles-invalid`);
    if (!isDigest(gate?.evidenceSha256)) errors.push(`${key}-evidence-digest-invalid`);
  }
  if (errors.length > 0) return invalidSource(errors);
  const humanBoundary =
    payload.executionClass === "human" &&
    payload.reviewerIndependent === true &&
    payload.productionHostOpened === false &&
    payload.isolatedBackendVerified === true &&
    payload.cleanupResidueZero === true &&
    context?.sourceAuthority?.role === "manual-a11y-reviewer" &&
    context?.sourceAuthority?.signatureVerified === true;
  const genericPass = (gate) =>
    humanBoundary &&
    payload.status === "PASS" &&
    gate.status === "PASS" &&
    gate.humanVerified === true &&
    validHumanRoles(gate.roles);
  const voiceOverPass =
    genericPass(voiceOver) &&
    voiceOver.os === "macOS" &&
    voiceOver.browser === "Safari" &&
    voiceOver.assistiveTechnology === "VoiceOver";
  const nvdaPass =
    genericPass(nvda) &&
    nvda.os === "Windows 11" &&
    nvda.browser === "Chrome" &&
    nvda.assistiveTechnology === "NVDA";
  return validSource({
    eligible: humanBoundary,
    gates: {
      "voiceover-safari": voiceOverPass,
      "nvda-chrome": nvdaPass,
      "keyboard-journey": genericPass(payload.gates.keyboardJourney),
      "reflow-200": genericPass(payload.gates.reflow200),
      "reduced-motion": genericPass(payload.gates.reducedMotion),
      "touch-targets": genericPass(payload.gates.touchTargets),
      "non-color-information": genericPass(payload.gates.nonColorInformation),
    },
  });
}

function validateAssistiveJourneys(value, name, errors) {
  if (!Array.isArray(value) || value.length !== 2) {
    errors.push(`${name}-journeys-invalid`);
    return;
  }
  const roles = new Set();
  for (const journey of value) {
    const evidenceKeys =
      name === "voiceover"
        ? ["role", "rotorEvidenceSha256", "route", "spokenOutputEvidenceSha256", "status"]
        : ["focusNavigationEvidenceSha256", "role", "route", "speechEvidenceSha256", "status"];
    if (!hasExactKeys(journey, evidenceKeys)) {
      errors.push(`${name}-journey-keys-invalid`);
      continue;
    }
    if (!["student", "teacher"].includes(journey.role) || roles.has(journey.role)) {
      errors.push(`${name}-journey-role-invalid`);
    }
    roles.add(journey.role);
    const expectedRoute = journey.role === "student" ? "/learning" : "/teaching";
    if (journey.route !== expectedRoute || journey.status !== "PASS") {
      errors.push(`${name}-journey-route-or-status-invalid`);
    }
    for (const [key, entry] of Object.entries(journey)) {
      if (key.endsWith("Sha256") && !isDigest(entry)) {
        errors.push(`${name}-journey-evidence-digest-invalid`);
      }
    }
  }
  if (roles.size !== 2) errors.push(`${name}-journey-matrix-incomplete`);
}

function validateDependencyReview(
  payload,
  currentLockfileSha256,
  ownerMitigation,
  evaluationNowMs,
) {
  const errors = [];
  if (!hasExactKeys(payload, ["fullTreeReview", "productionAudit", "status"])) {
    errors.push("dependency-payload-keys-invalid");
  }
  if (!validStatus(payload?.status)) errors.push("dependency-status-invalid");
  if (!hasExactKeys(payload?.productionAudit, [
    "counts",
    "dependencyScope",
    "lockfileSha256",
    "reachability",
    "scanner",
    "scannerVersion",
  ])) errors.push("production-audit-keys-invalid");
  validateVulnerabilityCounts(payload?.productionAudit?.counts, "production", errors);
  if (!hasExactKeys(payload?.fullTreeReview, [
    "counts",
    "disposition",
    "forceFixApplied",
    "lockfileEdited",
    "lockfileSha256",
    "majorDowngradeApplied",
    "mitigationAccepted",
    "mitigationExpiresAt",
    "overrideApplied",
    "reachabilityReviewed",
    "scanner",
    "scannerVersion",
    "vercelDevAllowed",
  ])) errors.push("full-tree-review-keys-invalid");
  validateVulnerabilityCounts(payload?.fullTreeReview?.counts, "full-tree", errors);
  for (const section of [payload?.productionAudit, payload?.fullTreeReview]) {
    if (section?.lockfileSha256 !== currentLockfileSha256) {
      errors.push("dependency-lockfile-digest-mismatch");
    }
    if (section?.scanner !== "npm-audit") errors.push("dependency-scanner-invalid");
    if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(section?.scannerVersion ?? "")) {
      errors.push("dependency-scanner-version-invalid");
    }
  }
  if (
    payload?.productionAudit?.dependencyScope !== "production" ||
    payload?.productionAudit?.reachability !== "production-tree"
  ) errors.push("production-audit-scope-invalid");
  if (
    payload?.fullTreeReview?.disposition === "MITIGATED_OPEN" &&
    Date.parse(ownerMitigation?.expiresAt ?? "") <= evaluationNowMs
  ) errors.push("owner-dependency-mitigation-expired-at-evaluation");
  if (errors.length > 0) return invalidSource(errors);
  const productionCounts = payload.productionAudit.counts;
  const productionAuditPass =
    payload.status === "PASS" &&
    Object.values(productionCounts).every((value) => value === 0);
  const fullTree = payload.fullTreeReview;
  const forbiddenChangesAbsent =
    fullTree.vercelDevAllowed === false &&
    fullTree.forceFixApplied === false &&
    fullTree.majorDowngradeApplied === false &&
    fullTree.overrideApplied === false &&
    fullTree.lockfileEdited === false;
  const cleanPass =
    fullTree.disposition === "CLEAN" &&
    Object.values(fullTree.counts).every((value) => value === 0) &&
    fullTree.mitigationAccepted === false &&
    fullTree.mitigationExpiresAt === null;
  const mitigatedOpenPass =
    fullTree.disposition === "MITIGATED_OPEN" &&
    vulnerabilityCountsEqual(fullTree.counts, ownerMitigation.counts) &&
    fullTree.mitigationAccepted === true &&
    fullTree.mitigationExpiresAt === ownerMitigation.expiresAt &&
    Date.parse(ownerMitigation.expiresAt) > evaluationNowMs;
  const fullTreePass =
    payload.status === "PASS" &&
    fullTree.reachabilityReviewed === true &&
    forbiddenChangesAbsent &&
    cleanPass !== mitigatedOpenPass &&
    (cleanPass || mitigatedOpenPass);
  return validSource({
    eligible: true,
    gates: {
      "production-dependency-audit": productionAuditPass,
      "full-tree-dependency-review": fullTreePass,
    },
  });
}

function vulnerabilityCountsEqual(left, right) {
  return ["critical", "high", "info", "low", "moderate", "total"].every(
    (key) => left?.[key] === right?.[key],
  );
}

function validateVulnerabilityCounts(value, prefix, errors) {
  const keys = ["critical", "high", "info", "low", "moderate", "total"];
  if (!hasExactKeys(value, keys)) {
    errors.push(`${prefix}-vulnerability-count-keys-invalid`);
    return;
  }
  for (const key of keys) {
    if (!Number.isInteger(value[key]) || value[key] < 0) {
      errors.push(`${prefix}-vulnerability-count-invalid`);
    }
  }
  if (
    keys.slice(0, -1).reduce((sum, key) => sum + value[key], 0) !== value.total
  ) errors.push(`${prefix}-vulnerability-total-mismatch`);
}

function validateProductionSafetyReceipt(
  payload,
  context,
  expectedCandidate,
  evaluationNowMs,
) {
  const errors = [];
  if (!hasExactKeys(payload, [
    "aliasReadbackReceiptSha256",
    "candidateOnRemoteMain",
    "databaseReadbackReceiptSha256",
    "environmentFingerprintSha256",
    "featureFlagsFingerprintSha256",
    "gitReadbackReceiptSha256",
    "mainPushed",
    "observedAt",
    "productionAliasChanged",
    "productionAuthorization",
    "productionDatabaseChanged",
    "productionDeployed",
    "productionDomainConfigurationChanged",
    "productionDomains",
    "productionEnvironmentChanged",
    "productionFeatureFlagsChanged",
    "productionGroupMode",
    "productionProjectId",
    "remoteMainSha",
    "soakStarted",
    "stagingAlias",
    "stagingProjectId",
    "vercelReadbackReceiptSha256",
    "verifierClass",
  ])) errors.push("production-safety-keys-invalid");
  for (const key of [
    "candidateOnRemoteMain",
    "mainPushed",
    "productionAliasChanged",
    "productionDatabaseChanged",
    "productionDeployed",
    "productionDomainConfigurationChanged",
    "productionEnvironmentChanged",
    "productionFeatureFlagsChanged",
    "soakStarted",
  ]) {
    if (typeof payload?.[key] !== "boolean") errors.push(`production-safety-${key}-invalid`);
  }
  for (const key of [
    "aliasReadbackReceiptSha256",
    "databaseReadbackReceiptSha256",
    "environmentFingerprintSha256",
    "featureFlagsFingerprintSha256",
    "gitReadbackReceiptSha256",
    "vercelReadbackReceiptSha256",
  ]) {
    if (!isDigest(payload?.[key])) errors.push(`production-safety-${key}-invalid`);
  }
  if (
    payload?.verifierClass !== "independent-git-vercel-neon-alias-readback" ||
    payload?.productionProjectId !== productionProjectId ||
    payload?.stagingProjectId !== expectedCandidate.projectId ||
    payload?.stagingAlias !== "staging.uais.top" ||
    !Array.isArray(payload?.productionDomains) ||
    payload.productionDomains.length !== productionDomains.length ||
    payload.productionDomains.some((domain, index) => domain !== productionDomains[index]) ||
    !/^[0-9a-f]{40}$/.test(payload?.remoteMainSha ?? "")
  ) errors.push("production-safety-provider-binding-invalid");
  const observedAt = Date.parse(payload?.observedAt ?? "");
  const issuedAt = Date.parse(context?.issuedAt ?? "");
  if (
    !Number.isFinite(observedAt) ||
    !Number.isFinite(issuedAt) ||
    observedAt > issuedAt ||
    issuedAt - observedAt > 10 * 60 * 1000
  ) errors.push("production-safety-observation-time-invalid");
  if (
    !Number.isFinite(observedAt) ||
    observedAt > evaluationNowMs ||
    evaluationNowMs - observedAt > 10 * 60 * 1000
  ) errors.push("production-safety-evaluation-freshness-invalid");
  if (errors.length > 0) return invalidSource(errors);
  const noProductionMutation =
    payload.candidateOnRemoteMain === false &&
    payload.mainPushed === false &&
    payload.productionAliasChanged === false &&
    payload.productionDatabaseChanged === false &&
    payload.productionDeployed === false &&
    payload.productionDomainConfigurationChanged === false &&
    payload.productionEnvironmentChanged === false &&
    payload.productionFeatureFlagsChanged === false &&
    payload.remoteMainSha !== expectedCandidate.gitSha;
  const valid =
    payload.productionAuthorization === "NO" &&
    payload.productionGroupMode === "off" &&
    noProductionMutation &&
    payload.soakStarted === false &&
    context?.sourceAuthority?.role === "production-safety-verifier" &&
    context?.sourceAuthority?.signatureVerified === true;
  return {
    valid: true,
    eligible: valid,
    derived: {
      safety: {
        valid,
        productionAuthorization: payload.productionAuthorization,
        productionGroupMode: payload.productionGroupMode,
        noProductionMutation,
        soakStarted: payload.soakStarted,
      },
    },
  };
}

function validSource({ eligible, gates }) {
  return { valid: true, eligible, derived: { gates } };
}

function invalidSource(errors) {
  return { valid: false, eligible: false, errors: [...new Set(errors)] };
}

function validSamples(value, minimumLength, maximumLength) {
  return (
    Array.isArray(value) &&
    value.length >= minimumLength &&
    value.length <= maximumLength &&
    value.every(isFiniteNonNegative)
  );
}

function validFingerprintSet(value, exactLength) {
  return (
    Array.isArray(value) &&
    value.length === exactLength &&
    value.every(isDigest) &&
    new Set(value).size === exactLength
  );
}

function sameStringSet(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    new Set(left).size === left.length &&
    left.every((value) => right.includes(value))
  );
}

function isDigest(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function percentile(samples, fraction) {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function validRumHistogram(value, expectedSampleCount) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 1_000) return false;
  let previousValue = -1;
  let total = 0;
  for (const bucket of value) {
    if (
      !hasExactKeys(bucket, ["count", "valueMs"]) ||
      !Number.isInteger(bucket.valueMs) ||
      bucket.valueMs < 0 ||
      bucket.valueMs > 60_000 ||
      bucket.valueMs <= previousValue ||
      !Number.isInteger(bucket.count) ||
      bucket.count < 1 ||
      bucket.count > 4_000
    ) return false;
    previousValue = bucket.valueMs;
    total += bucket.count;
  }
  return total === expectedSampleCount;
}

function percentileContHistogram(histogram, fraction) {
  const sampleCount = histogram.reduce((sum, bucket) => sum + bucket.count, 0);
  if (sampleCount < 1) return Number.NaN;
  const rank = (sampleCount - 1) * fraction;
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const lowerValue = histogramValueAt(histogram, lowerIndex);
  const upperValue = histogramValueAt(histogram, upperIndex);
  return lowerValue + (upperValue - lowerValue) * (rank - lowerIndex);
}

function histogramValueAt(histogram, index) {
  let seen = 0;
  for (const bucket of histogram) {
    seen += bucket.count;
    if (index < seen) return bucket.valueMs;
  }
  return Number.NaN;
}

function canonicalJsonBytes(value) {
  return Buffer.from(canonicalJson(value), "utf8");
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  throw new TypeError("canonical JSON supports only finite JSON values");
}

function sha256Canonical(value) {
  try {
    return sha256Bytes(canonicalJsonBytes(value));
  } catch {
    return "";
  }
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function decodeCanonicalBase64(value) {
  if (
    typeof value !== "string" ||
    value.length < 4 ||
    value.length > 512 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) return null;
  const bytes = Buffer.from(value, "base64");
  return bytes.toString("base64") === value ? bytes : null;
}

function validHumanRoles(value) {
  return Array.isArray(value) && value.length === 2 && value[0] === "student" && value[1] === "teacher";
}

function validStatus(value) {
  return ["PASS", "FAIL", "NOT_RUN", "BLOCKED_ENV"].includes(value);
}

function validRunId(value, prefix) {
  return typeof value === "string" && value.startsWith(`${prefix}-`) && /^[a-z0-9-]{8,96}$/.test(value);
}

function isFiniteNonNegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function hasExactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readOption(values, name) {
  const index = values.indexOf(name);
  if (index === -1) return undefined;
  const value = values[index + 1];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readCurrentGitSha(root) {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    timeout: 5_000,
  });
  const value = result.status === 0 ? result.stdout.trim() : "";
  return /^[0-9a-f]{40}$/.test(value) ? value : "";
}

function readFixedOwnerPins() {
  return inspectSecureOwnerPinsFile(fixedOwnerPinPath);
}

export function inspectSecureOwnerPinsFile(
  ownerPinPath,
  expectedUid = typeof process.getuid === "function" ? process.getuid() : null,
) {
  if (!Number.isInteger(expectedUid) || expectedUid < 0) {
    return { ok: false, errors: ["owner-trust-pins-owner-invalid"] };
  }
  let descriptor;
  try {
    const parent = lstatSync(dirname(ownerPinPath));
    if (
      !parent.isDirectory() ||
      parent.isSymbolicLink() ||
      (parent.mode & 0o777) !== 0o700
    ) return { ok: false, errors: ["owner-trust-pins-parent-invalid"] };
    const stat = lstatSync(ownerPinPath);
    if (
      parent.uid !== expectedUid || stat.uid !== expectedUid
    ) return { ok: false, errors: ["owner-trust-pins-owner-invalid"] };
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) {
      return { ok: false, errors: ["owner-trust-pins-file-invalid"] };
    }
    if (stat.size < 2 || stat.size > 64 * 1024) {
      return { ok: false, errors: ["owner-trust-pins-file-invalid"] };
    }
    descriptor = openSync(
      ownerPinPath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.dev !== stat.dev ||
      opened.ino !== stat.ino ||
      opened.size !== stat.size
    ) {
      return { ok: false, errors: ["owner-trust-pins-file-changed-during-read"] };
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (
      bytes.byteLength !== stat.size ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs
    ) {
      return { ok: false, errors: ["owner-trust-pins-file-changed-during-read"] };
    }
    const value = JSON.parse(bytes.toString("utf8"));
    const errors = validateOwnerPins(value);
    return errors.length === 0
      ? { ok: true, value }
      : { ok: false, errors };
  } catch {
    return { ok: false, errors: ["owner-trust-pins-missing-or-unreadable"] };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function validateOwnerPins(value) {
  const errors = [];
  if (!hasExactKeys(value, [
    "authorityKeyId",
    "candidate",
    "dependencyMitigation",
    "evidenceSetId",
    "expectedRuns",
    "kind",
    "ownerDecisionDigestSha256",
    "productionAuthorization",
    "rumAuthorities",
    "schemaVersion",
    "trustPolicySha256",
  ])) errors.push("owner-trust-pins-keys-invalid");
  if (value?.schemaVersion !== 1 || value?.kind !== "uais-soak-admission-owner-pins") {
    errors.push("owner-trust-pins-schema-invalid");
  }
  if (!isDigest(value?.ownerDecisionDigestSha256)) {
    errors.push("owner-decision-digest-pin-invalid");
  }
  if (!isDigest(value?.trustPolicySha256)) errors.push("trust-policy-digest-pin-invalid");
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(value?.authorityKeyId ?? "")) {
    errors.push("authority-key-id-pin-invalid");
  }
  if (!/^[a-z0-9][a-z0-9._-]{7,127}$/.test(value?.evidenceSetId ?? "")) {
    errors.push("evidence-set-id-pin-invalid");
  }
  if (!hasExactKeys(value?.candidate, [
    "contentSha256",
    "deploymentHost",
    "deploymentId",
    "gitSha",
    "projectId",
  ])) errors.push("owner-pin-candidate-keys-invalid");
  if (
    !/^[0-9a-f]{40}$/.test(value?.candidate?.gitSha ?? "") ||
    !isDigest(value?.candidate?.contentSha256) ||
    !/^dpl_[A-Za-z0-9]{20,64}$/.test(value?.candidate?.deploymentId ?? "") ||
    !/^[a-z0-9-]+\.vercel\.app$/.test(value?.candidate?.deploymentHost ?? "") ||
    !/^prj_[A-Za-z0-9]{20,64}$/.test(value?.candidate?.projectId ?? "")
  ) errors.push("owner-pin-candidate-invalid");
  if (!hasExactKeys(value?.expectedRuns, ["manual", "p1", "p2", "rum"])) {
    errors.push("owner-pin-run-keys-invalid");
  }
  if (!validRunId(value?.expectedRuns?.p1, "p1")) errors.push("expected-p1-run-id-invalid");
  if (!validRunId(value?.expectedRuns?.p2, "p2")) errors.push("expected-p2-run-id-invalid");
  if (!hasExactKeys(value?.expectedRuns?.rum, ["cohortId", "runId"])) {
    errors.push("expected-rum-run-keys-invalid");
  }
  if (!validRunId(value?.expectedRuns?.rum?.runId, "p2-inp")) {
    errors.push("expected-rum-run-id-invalid");
  }
  if (!validRunId(value?.expectedRuns?.rum?.cohortId, "p2-inp")) {
    errors.push("expected-rum-cohort-id-invalid");
  }
  if (
    value?.expectedRuns?.rum?.runId !==
    value?.expectedRuns?.rum?.cohortId
  ) errors.push("expected-rum-run-cohort-id-mismatch");
  if (!validRunId(value?.expectedRuns?.manual, "manual-a11y")) {
    errors.push("expected-manual-execution-id-invalid");
  }
  if (value?.productionAuthorization !== "NO") {
    errors.push("owner-pin-production-authorization-invalid");
  }
  const dependencyMitigation = value?.dependencyMitigation;
  if (!hasExactKeys(dependencyMitigation, ["counts", "disposition", "expiresAt"])) {
    errors.push("owner-dependency-mitigation-keys-invalid");
  }
  const approvedCounts = {
    critical: 0,
    high: 1,
    info: 0,
    low: 0,
    moderate: 9,
    total: 10,
  };
  if (
    dependencyMitigation?.disposition !== "MITIGATED_OPEN" ||
    dependencyMitigation?.expiresAt !== "2026-09-10T23:59:59Z" ||
    !hasExactKeys(dependencyMitigation?.counts, Object.keys(approvedCounts)) ||
    !vulnerabilityCountsEqual(dependencyMitigation?.counts, approvedCounts)
  ) errors.push("owner-dependency-mitigation-vector-invalid");

  const rumAuthorities = value?.rumAuthorities;
  if (!hasExactKeys(rumAuthorities, ["approver", "collector", "index"])) {
    errors.push("owner-rum-authorities-keys-invalid");
  }
  if (!hasExactKeys(rumAuthorities?.collector, [
    "keyId",
    "keyVersion",
    "publicKeySpkiPem",
    "publicKeySpkiSha256",
  ])) errors.push("owner-rum-collector-authority-keys-invalid");
  for (const role of ["approver", "index"]) {
    if (!hasExactKeys(rumAuthorities?.[role], ["keyId", "publicKeySpkiSha256"])) {
      errors.push(`owner-rum-${role}-authority-keys-invalid`);
    }
  }
  for (const role of ["collector", "approver", "index"]) {
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(rumAuthorities?.[role]?.keyId ?? "")) {
      errors.push(`owner-rum-${role}-key-id-invalid`);
    }
    if (!isDigest(rumAuthorities?.[role]?.publicKeySpkiSha256)) {
      errors.push(`owner-rum-${role}-spki-digest-invalid`);
    }
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(
    rumAuthorities?.collector?.keyVersion ?? "",
  )) errors.push("owner-rum-collector-key-version-invalid");
  try {
    const collectorKey = createPublicKey(rumAuthorities?.collector?.publicKeySpkiPem ?? "");
    if (
      collectorKey.asymmetricKeyType !== "ed25519" ||
      sha256Bytes(collectorKey.export({ format: "der", type: "spki" })) !==
        rumAuthorities?.collector?.publicKeySpkiSha256
    ) errors.push("owner-rum-collector-spki-invalid");
  } catch {
    errors.push("owner-rum-collector-spki-invalid");
  }
  const authorityKeyIds = [
    rumAuthorities?.collector?.keyId,
    rumAuthorities?.approver?.keyId,
    rumAuthorities?.index?.keyId,
  ];
  const authoritySpkiDigests = [
    rumAuthorities?.collector?.publicKeySpkiSha256,
    rumAuthorities?.approver?.publicKeySpkiSha256,
    rumAuthorities?.index?.publicKeySpkiSha256,
  ];
  if (
    new Set(authorityKeyIds).size !== 3 ||
    new Set(authoritySpkiDigests).size !== 3
  ) errors.push("owner-rum-authority-key-material-not-distinct");
  if (rumAuthorities?.index?.keyId !== value?.authorityKeyId) {
    errors.push("owner-rum-index-authority-mismatch");
  }
  return [...new Set(errors)];
}

function validatePinnedRumAuthorityMaterials({ trustPolicyPath, ownerPins, resolved }) {
  const errors = [];
  let policy;
  try {
    const bytes = readFileSync(trustPolicyPath);
    if (
      bytes.byteLength < 2 ||
      bytes.byteLength > 512 * 1024 ||
      sha256Bytes(bytes) !== ownerPins.trustPolicySha256
    ) return ["rum-authority-trust-policy-digest-mismatch"];
    policy = JSON.parse(bytes.toString("utf8"));
  } catch {
    return ["rum-authority-trust-policy-unreadable"];
  }
  if (!Array.isArray(policy?.authorities)) {
    return ["rum-authority-trust-policy-invalid"];
  }
  const material = [];
  for (const authority of policy.authorities) {
    if (
      !isRecord(authority) ||
      typeof authority.keyId !== "string" ||
      typeof authority.role !== "string" ||
      typeof authority.publicKeyPem !== "string"
    ) {
      errors.push("rum-authority-trust-policy-entry-invalid");
      continue;
    }
    try {
      const key = createPublicKey(authority.publicKeyPem);
      if (key.asymmetricKeyType !== "ed25519") {
        errors.push("rum-authority-trust-policy-key-invalid");
        continue;
      }
      material.push({
        keyId: authority.keyId,
        role: authority.role,
        publicKeySpkiSha256: sha256Bytes(
          key.export({ format: "der", type: "spki" }),
        ),
      });
    } catch {
      errors.push("rum-authority-trust-policy-key-invalid");
    }
  }
  const indexAuthority = material.find(
    (entry) =>
      entry.keyId === ownerPins.rumAuthorities.index.keyId &&
      entry.role === "soak-evidence-issuer",
  );
  const approverAuthority = material.find(
    (entry) =>
      entry.keyId === ownerPins.rumAuthorities.approver.keyId &&
      entry.role === "rum-independent-approver",
  );
  if (
    indexAuthority?.publicKeySpkiSha256 !==
      ownerPins.rumAuthorities.index.publicKeySpkiSha256
  ) errors.push("rum-index-authority-material-mismatch");
  if (
    approverAuthority?.publicKeySpkiSha256 !==
      ownerPins.rumAuthorities.approver.publicKeySpkiSha256
  ) errors.push("rum-approver-authority-material-mismatch");
  if (
    material.some(
      (entry) =>
        entry.keyId === ownerPins.rumAuthorities.collector.keyId ||
        entry.publicKeySpkiSha256 ===
          ownerPins.rumAuthorities.collector.publicKeySpkiSha256,
    )
  ) errors.push("rum-collector-must-differ-from-packet-source-authorities");
  if (
    resolved?.authority?.keyId &&
    resolved.authority.keyId !== ownerPins.rumAuthorities.index.keyId
  ) errors.push("rum-resolved-index-authority-mismatch");
  return [...new Set(errors)];
}

function invalidResult(errors, details = {}, authoritativeInvocation = false) {
  return {
    exitCode: 1,
    report: {
      target: "p2-staging-soak-admission",
      status: "FAIL",
      soakAdmitted: false,
      ...details,
      soak: { started: "unknown", startedAt: null },
      validationErrors: [...new Set(errors)],
      evidenceBoundary: {
        admissionIsNotCompletedSoak: true,
        manifestIsContentAddressedIndexOnly: true,
        sourceMetricsRecomputed: false,
        ownerTrustPinsVerified: authoritativeInvocation,
        admissionEligibleInvocation: authoritativeInvocation,
        packetSignatureVerified: false,
        sourceSignaturesVerified: false,
        noNetworkUsed: true,
        noMutationPerformed: true,
        rawReceiptsOmitted: true,
        trustMaterialOmitted: true,
        humanEvidenceCannotBeAutomated: true,
        fieldRumMustBeApprovedRealUserData: true,
      },
    },
  };
}
