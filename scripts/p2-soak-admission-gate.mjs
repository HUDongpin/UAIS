#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const defaultManifestPath =
  "coordination/reports/2026-08-27-376-soak-admission.json";
const manifestPath = readManifestPath(process.argv.slice(2));

if (!existsSync(manifestPath)) {
  emitInvalid(["soak-admission-manifest-missing"]);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch {
  emitInvalid(["soak-admission-manifest-invalid-json"]);
}
if (!isRecord(manifest)) {
  emitInvalid(["soak-admission-manifest-root-invalid"]);
}

const validationErrors = [];
if (manifest.schemaVersion !== 1) {
  validationErrors.push("unsupported-schema-version");
}
if (!["SOAK_ADMITTED", "SOAK_NOT_ADMITTED"].includes(manifest.decision)) {
  validationErrors.push("soak-decision-invalid");
}

const currentGitSha = readCurrentGitSha();
const candidateGitSha = readString(manifest.candidate?.gitSha);
const candidateMatchesHead =
  isGitSha(candidateGitSha) &&
  isGitSha(currentGitSha) &&
  candidateGitSha === currentGitSha;
if (!isGitSha(candidateGitSha)) {
  validationErrors.push("candidate-git-sha-invalid");
} else if (!candidateMatchesHead) {
  validationErrors.push("candidate-git-sha-does-not-match-head");
}
if (manifest.candidate?.evidenceClass !== "current-candidate") {
  validationErrors.push("candidate-current-evidence-required");
}

const gates = manifest.gates;
if (!isRecord(gates)) validationErrors.push("soak-gates-required");

const stagingHealth = validateEvidenceGate({
  value: gates?.stagingHealth,
  id: "staging-health",
  passEvidenceClasses: ["current-candidate-external"],
  validationErrors,
  passMetrics: (value) =>
    Number.isInteger(value.sampleCount) &&
    value.sampleCount >= 15 &&
    value.successCount === value.sampleCount &&
    value.app === "ok" &&
    value.database === "ok" &&
    value.migrations === "ok",
});

const p1Conservation = validateEvidenceGate({
  value: gates?.p1?.conservation,
  id: "p1-conservation",
  passEvidenceClasses: ["current-candidate"],
  validationErrors,
  passMetrics: (value) =>
    value.studentCount === 200 &&
    value.attempts === 200 &&
    value.submissions === 200 &&
    value.versions === 200 &&
    value.profiles === 200 &&
    value.duplicateVersions === 0,
});
const p1Cleanup = validateEvidenceGate({
  value: gates?.p1?.cleanup,
  id: "p1-cleanup",
  passEvidenceClasses: ["current-candidate"],
  validationErrors,
  passMetrics: (value) =>
    value.sourceRowsRemaining === 0 && value.restoreRowsRemaining === 0,
});
const p1Performance = validateEvidenceGate({
  value: gates?.p1?.performance,
  id: "p1-performance",
  passEvidenceClasses: ["current-candidate-regional"],
  validationErrors,
  passMetrics: validP1Performance,
});

const p2InviteRamp = validateEvidenceGate({
  value: gates?.p2?.inviteRamp,
  id: "p2-invite-ramp",
  passEvidenceClasses: [
    "current-candidate-external",
    "current-candidate-regional",
  ],
  validationErrors,
  passMetrics: (value) =>
    value.targetUsers === 200 && validP95(value, "aggregateP95Ms"),
});
const p2ActiveUserRamp = validateEvidenceGate({
  value: gates?.p2?.activeUserRamp,
  id: "p2-active-user-ramp",
  passEvidenceClasses: [
    "current-candidate-external",
    "current-candidate-regional",
  ],
  validationErrors,
  passMetrics: (value) =>
    value.targetActiveUsers === 200 && validP95(value, "aggregateP95Ms"),
});
const p2Sustained = validateEvidenceGate({
  value: gates?.p2?.sustained,
  id: "p2-sustained-load",
  passEvidenceClasses: [
    "current-candidate-external",
    "current-candidate-regional",
  ],
  validationErrors,
  passMetrics: (value) => value.activeUsers === 200 && value.rounds === 10,
});
if (
  gates?.p2?.sustained?.status === "PASS" &&
  gates?.p2?.activeUserRamp?.status !== "PASS"
) {
  validationErrors.push(
    "p2-sustained-pass-requires-active-user-ramp-pass",
  );
}

const fieldInpP75 = validateEvidenceGate({
  value: gates?.rum?.fieldInpP75,
  id: "field-inp-p75",
  passEvidenceClasses: ["approved-real-user-rum"],
  validationErrors,
  passMetrics: validFieldInp,
});

const manualGateDefinitions = [
  ["voiceOverSafari", "voiceover-safari"],
  ["nvdaChrome", "nvda-chrome"],
  ["keyboardJourney", "keyboard-journey"],
  ["reflow200", "reflow-200"],
  ["reducedMotion", "reduced-motion"],
  ["touchTargets", "touch-targets"],
  ["nonColorInformation", "non-color-information"],
];
const manualResults = Object.fromEntries(
  manualGateDefinitions.map(([key, id]) => [
    id,
    validateEvidenceGate({
      value: gates?.manualAccessibility?.[key],
      id,
      passEvidenceClasses: ["human-attested"],
      validationErrors,
      passMetrics: () => true,
    }),
  ]),
);

const productionAudit = validateEvidenceGate({
  value: gates?.dependencies?.productionAudit,
  id: "production-dependency-audit",
  passEvidenceClasses: ["current-lockfile-audit"],
  validationErrors,
  passMetrics: (value) => value.vulnerabilities === 0,
});
const fullTreeReview = validateEvidenceGate({
  value: gates?.dependencies?.fullTreeReview,
  id: "full-tree-dependency-review",
  passEvidenceClasses: ["reviewed-mitigation"],
  validationErrors,
  passMetrics: (value) =>
    ["CLEAN", "MITIGATED_OPEN"].includes(value.disposition) &&
    isNonNegativeInteger(value.moderate) &&
    isNonNegativeInteger(value.high) &&
    value.unsafeDowngradeApplied === false,
});

const productionSafety = validateProductionSafety(manifest.safety);
if (!productionSafety.valid) {
  validationErrors.push("production-safety-boundary-invalid");
}
const soakNotStarted =
  manifest.soak?.started === false && manifest.soak?.startedAt === null;
if (!soakNotStarted) {
  validationErrors.push("soak-must-not-start-before-admission");
}

const gateResults = {
  "staging-health": stagingHealth,
  "p1-conservation": p1Conservation,
  "p1-cleanup": p1Cleanup,
  "p1-performance": p1Performance,
  "p2-invite-ramp": p2InviteRamp,
  "p2-active-user-ramp": p2ActiveUserRamp,
  "p2-sustained-load": p2Sustained,
  "field-inp-p75": fieldInpP75,
  ...manualResults,
  "production-dependency-audit": productionAudit,
  "full-tree-dependency-review": fullTreeReview,
};
const blockedReasons = Object.entries(gateResults)
  .filter(([, passed]) => !passed)
  .map(([id]) => `${id}-not-pass`);
if (!productionSafety.valid) {
  blockedReasons.push("production-safety-boundary-not-preserved");
}
if (!soakNotStarted) blockedReasons.push("soak-already-started");

const gatesReady =
  candidateMatchesHead &&
  Object.values(gateResults).every(Boolean) &&
  productionSafety.valid &&
  soakNotStarted;
const preliminarilyAdmitted = validationErrors.length === 0 && gatesReady;
if (manifest.decision === "SOAK_ADMITTED" && !preliminarilyAdmitted) {
  validationErrors.push("manifest-soak-admitted-contradicts-gates");
}
if (manifest.decision !== "SOAK_ADMITTED" && preliminarilyAdmitted) {
  validationErrors.push("manifest-soak-decision-not-promoted");
}

if (validationErrors.length > 0) {
  emitInvalid(validationErrors, {
    manifestPath,
    candidateGitSha,
    currentGitSha,
    blockedReasons,
    safety: productionSafety.output,
  });
}

const soakAdmitted =
  gatesReady && manifest.decision === "SOAK_ADMITTED";
const output = {
  target: "p2-staging-soak-admission",
  status: soakAdmitted ? "SOAK_ADMITTED" : "SOAK_NOT_ADMITTED",
  soakAdmitted,
  manifestPath,
  candidate: {
    gitSha: candidateGitSha,
    matchesHead: candidateMatchesHead,
  },
  gates: gateResults,
  blockedReasons: soakAdmitted ? [] : blockedReasons,
  safety: productionSafety.output,
  soak: {
    started: false,
    startedAt: null,
  },
  evidenceBoundary: {
    admissionIsNotCompletedSoak: true,
    noNetworkUsed: true,
    noMutationPerformed: true,
    humanEvidenceCannotBeAutomated: true,
    fieldRumMustBeApprovedRealUserData: true,
  },
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
process.exit(soakAdmitted ? 0 : 2);

function validateEvidenceGate({
  value,
  id,
  passEvidenceClasses,
  validationErrors,
  passMetrics,
}) {
  if (!isRecord(value)) {
    validationErrors.push(`${id}-gate-required`);
    return false;
  }
  if (!["PASS", "FAIL", "NOT_RUN", "BLOCKED_ENV"].includes(value.status)) {
    validationErrors.push(`${id}-status-invalid`);
    return false;
  }
  if (!hasEvidenceRefs(value.evidenceRefs)) {
    validationErrors.push(`${id}-evidence-required`);
  }
  if (value.status !== "PASS") return false;
  if (!passEvidenceClasses.includes(value.evidenceClass)) {
    validationErrors.push(
      `${id}-pass-requires-${passEvidenceClasses.join("-or-")}-evidence`,
    );
    return false;
  }
  if (!passMetrics(value)) {
    validationErrors.push(`${id}-pass-metrics-invalid`);
    return false;
  }
  return true;
}

function validP1Performance(value) {
  const p95 = value.operationP95Ms;
  const keys = [
    "taskRead",
    "checkpoint",
    "autosave",
    "submit",
    "teacherDecision",
  ];
  return (
    value.studentCount === 200 &&
    value.maximumSubmitWindowMs === 30_000 &&
    isFiniteNonNegative(value.submitWindowMs) &&
    value.submitWindowMs <= value.maximumSubmitWindowMs &&
    value.maximumOperationP95Ms === 1500 &&
    isRecord(p95) &&
    keys.every(
      (key) =>
        isFiniteNonNegative(p95[key]) &&
        p95[key] <= value.maximumOperationP95Ms,
    )
  );
}

function validP95(value, metricName) {
  return (
    value.maximumP95Ms === 2000 &&
    isFiniteNonNegative(value[metricName]) &&
    value[metricName] <= value.maximumP95Ms
  );
}

function validFieldInp(value) {
  return (
    value.maximumP75Ms === 200 &&
    isFiniteNonNegative(value.p75Ms) &&
    value.p75Ms <= value.maximumP75Ms &&
    value.groups === 12 &&
    value.requiredGroups === 12 &&
    value.minimumSamplesPerGroup >= 30 &&
    value.minimumDistinctOperatorsPerGroup >= 3
  );
}

function validateProductionSafety(value) {
  const noProductionMutation =
    value?.mainPushed === false &&
    value?.productionDeployed === false &&
    value?.productionEnvironmentChanged === false &&
    value?.productionFeatureFlagsChanged === false;
  const valid =
    value?.productionGroupMode === "off" &&
    value?.productionAuthorization === "NO" &&
    noProductionMutation;
  return {
    valid,
    output: {
      productionGroupMode: readString(value?.productionGroupMode) || "unknown",
      productionAuthorization:
        readString(value?.productionAuthorization) || "unknown",
      noProductionMutation,
    },
  };
}

function readManifestPath(args) {
  const index = args.indexOf("--manifest");
  if (index === -1) return defaultManifestPath;
  const value = readString(args[index + 1]);
  if (!value) emitInvalid(["manifest-path-required"]);
  return value;
}

function readCurrentGitSha() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    timeout: 5000,
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

function hasEvidenceRefs(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => readString(entry).length > 0)
  );
}

function isGitSha(value) {
  return /^[0-9a-f]{40}$/.test(readString(value));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNonNegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function readString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function emitInvalid(errors, details = {}) {
  process.stdout.write(
    `${JSON.stringify(
      {
        target: "p2-staging-soak-admission",
        status: "FAIL",
        soakAdmitted: false,
        ...details,
        validationErrors: [...new Set(errors)],
        evidenceBoundary: {
          admissionIsNotCompletedSoak: true,
          noNetworkUsed: true,
          noMutationPerformed: true,
          humanEvidenceCannotBeAutomated: true,
          fieldRumMustBeApprovedRealUserData: true,
        },
      },
      null,
      2,
    )}\n`,
  );
  process.exit(1);
}
