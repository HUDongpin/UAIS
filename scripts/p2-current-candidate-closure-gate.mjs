#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const defaultManifestPath =
  "coordination/reports/p2/current-candidate-closure.json";
const args = process.argv.slice(2);
const manifestPath = readManifestPath(args);
const candidateSelection = readCandidateSelection(args);
const validationErrors = [];

if (!existsSync(manifestPath)) {
  emitInvalid(["current-candidate-closure-manifest-missing"]);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch {
  emitInvalid(["current-candidate-closure-manifest-invalid-json"]);
}
if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
  emitInvalid(["current-candidate-closure-manifest-root-invalid"]);
}

const currentGitSha = readCurrentGitSha();
if (!currentGitSha) {
  validationErrors.push("current-git-sha-unavailable");
}
if (manifest.schemaVersion !== 1) {
  validationErrors.push("unsupported-schema-version");
}
const manifestCandidateGitSha = manifest.candidate?.gitSha;
if (!isGitSha(manifestCandidateGitSha)) {
  validationErrors.push("candidate-git-sha-invalid");
} else if (candidateSelection.explicit) {
  if (!isGitSha(candidateSelection.sha)) {
    validationErrors.push("candidate-git-sha-request-invalid");
  } else if (manifestCandidateGitSha !== candidateSelection.sha) {
    validationErrors.push("candidate-git-sha-does-not-match-requested-candidate");
  }
} else if (currentGitSha && manifestCandidateGitSha !== currentGitSha) {
  validationErrors.push("candidate-git-sha-does-not-match-head");
}
const candidateIsAncestor =
  isGitSha(manifestCandidateGitSha) &&
  isGitSha(currentGitSha) &&
  isAncestor(manifestCandidateGitSha, currentGitSha);
if (
  candidateSelection.explicit &&
  isGitSha(manifestCandidateGitSha) &&
  isGitSha(currentGitSha) &&
  !candidateIsAncestor
) {
  validationErrors.push("candidate-git-sha-not-ancestor-of-evidence-head");
}
if (!isSha256(manifest.candidate?.archiveSha256)) {
  validationErrors.push("candidate-archive-sha256-invalid");
}

const deployment = manifest.candidate?.deployment;
const sameShaImmutableDeployment =
  deployment?.project === "uais-staging" &&
  isDeploymentId(deployment?.id) &&
  isImmutableVercelUrl(deployment?.url) &&
  deployment?.status === "READY" &&
  deployment?.evidenceClass === "current-candidate" &&
  deployment?.gitSha === manifest.candidate?.gitSha;
if (!sameShaImmutableDeployment) {
  validationErrors.push("same-sha-immutable-deployment-binding-invalid");
}

const requirements = Array.isArray(manifest.requirements)
  ? manifest.requirements
  : [];
validateRequirements(requirements, validationErrors);

const teacherWorkspaces = Array.isArray(manifest.teacherWorkspaces)
  ? manifest.teacherWorkspaces
  : [];
validateTeacherWorkspaces(teacherWorkspaces, validationErrors);

const credentialSources = Array.isArray(manifest.credentialSources)
  ? manifest.credentialSources
  : [];
validateCredentialSources(credentialSources, validationErrors);

if (containsCredentialValueShape(manifest)) {
  validationErrors.push("credential-value-shaped-field-forbidden");
}

const passedIds = requirements
  .filter((requirement) => requirement.status === "PASS")
  .map((requirement) => requirement.id)
  .sort((left, right) => left - right);
const blockedIds = requirements
  .filter((requirement) => requirement.status !== "PASS")
  .map((requirement) => requirement.id)
  .sort((left, right) => left - right);
const realCompleteCount = teacherWorkspaces.filter(
  (workspace) => workspace.status === "real-complete",
).length;
const implementedUnverifiedCount = teacherWorkspaces.filter(
  (workspace) => workspace.status === "implemented-unverified",
).length;
const ownerApprovedSourceCount = credentialSources.filter(
  (source) => source.approvalStatus === "owner-approved",
).length;
const missingSourceCount = credentialSources.filter(
  (source) => source.approvalStatus === "missing",
).length;

const computedReleaseReady =
  validationErrors.length === 0 &&
  manifest.candidate?.implementationOverlayDeployed === true &&
  passedIds.length === 11 &&
  realCompleteCount === 11 &&
  ownerApprovedSourceCount === 7;
if (manifest.releaseStatus === "PASS" && !computedReleaseReady) {
  validationErrors.push("manifest-release-pass-contradicts-gates");
}
if (manifest.releaseStatus !== "PASS" && computedReleaseReady) {
  validationErrors.push("manifest-release-status-not-promoted");
}

if (validationErrors.length > 0) {
  emitInvalid(validationErrors);
}

const releaseReady = computedReleaseReady && manifest.releaseStatus === "PASS";
const output = {
  target: "p2-current-candidate-closure",
  status: releaseReady ? "PASS" : "BLOCKED_ENV",
  releaseReady,
  manifestPath,
  candidate: {
    gitSha: manifest.candidate.gitSha,
    sameShaImmutableDeployment: sameShaImmutableDeployment ? "PASS" : "FAIL",
    implementationOverlayDeployed:
      manifest.candidate.implementationOverlayDeployed === true,
  },
  evidence: {
    gitSha: currentGitSha,
    candidateSelection: candidateSelection.explicit ? "explicit" : "head",
    candidateSelectionSource: candidateSelection.source,
    candidateIsAncestor,
  },
  requirements: {
    total: requirements.length,
    passed: passedIds.length,
    passedIds,
    blockedIds,
  },
  teacherWorkspaces: {
    total: teacherWorkspaces.length,
    realComplete: realCompleteCount,
    implementedUnverified: implementedUnverifiedCount,
  },
  credentialSources: {
    total: credentialSources.length,
    ownerApproved: ownerApprovedSourceCount,
    missing: missingSourceCount,
  },
  blockedReasons: releaseReady
    ? []
    : [
        ...blockedIds.map((id) => `requirement-${id}-not-pass`),
        ...(realCompleteCount === 11
          ? []
          : ["teacher-workspaces-not-real-complete"]),
        ...(ownerApprovedSourceCount === 7
          ? []
          : ["owner-approved-credential-sources-incomplete"]),
        ...(manifest.candidate.implementationOverlayDeployed === true
          ? []
          : ["current-local-overlay-not-deployed"]),
      ],
  safety: {
    valuesRedacted: true,
    historicalEvidenceCannotPass: true,
    noNetworkUsed: true,
    noMutationPerformed: true,
  },
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
process.exit(releaseReady ? 0 : 2);

function validateRequirements(values, errors) {
  if (values.length !== 11) {
    errors.push("eleven-requirements-required");
  }
  const ids = values.map((value) => value?.id);
  if (
    new Set(ids).size !== 11 ||
    ids.some((id) => !Number.isInteger(id) || id < 1 || id > 11)
  ) {
    errors.push("requirement-ids-must-be-one-through-eleven");
  }
  for (const value of values) {
    if (!value || !["PASS", "BLOCKED_ENV", "NOT_RUN", "FAIL"].includes(value.status)) {
      errors.push(`requirement-${value?.id ?? "unknown"}-status-invalid`);
      continue;
    }
    if (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.length === 0) {
      errors.push(`requirement-${value.id}-evidence-required`);
    }
    if (value.status === "PASS" && value.evidenceClass !== "current-candidate") {
      errors.push(`requirement-${value.id}-pass-requires-current-evidence`);
    }
    if (value.evidenceClass === "historical" && value.status === "PASS") {
      errors.push(`requirement-${value.id}-historical-evidence-cannot-pass`);
    }
  }
  const deploymentBinding = values.find((value) => value?.id === 2);
  if (
    deploymentBinding?.status !== "PASS" ||
    deploymentBinding?.evidenceClass !== "current-candidate"
  ) {
    errors.push("requirement-2-same-sha-deployment-binding-must-pass");
  }
}

function validateTeacherWorkspaces(values, errors) {
  const expected = [
    "course-settings",
    "agents",
    "knowledge-base",
    "content",
    "administrators",
    "students",
    "data-export",
    "dashboard",
    "quiz-board",
    "grading",
    "invite-code",
  ];
  const names = values.map((value) => value?.name);
  if (
    values.length !== expected.length ||
    expected.some((name) => !names.includes(name)) ||
    new Set(names).size !== expected.length
  ) {
    errors.push("eleven-canonical-teacher-workspaces-required");
  }
  for (const value of values) {
    if (
      !value ||
      !["implemented-unverified", "real-complete"].includes(value.status)
    ) {
      errors.push(`teacher-workspace-${value?.name ?? "unknown"}-status-invalid`);
    }
  }
}

function validateCredentialSources(values, errors) {
  const expected = [
    "oss",
    "function-compute",
    "directmail",
    "deepseek-dashscope",
    "lrs",
    "dedicated-databases",
    "deployment",
  ];
  const capabilities = values.map((value) => value?.capability);
  if (
    values.length !== expected.length ||
    expected.some((capability) => !capabilities.includes(capability)) ||
    new Set(capabilities).size !== expected.length
  ) {
    errors.push("seven-canonical-credential-sources-required");
  }
  for (const value of values) {
    if (!value || !["missing", "owner-approved"].includes(value.approvalStatus)) {
      errors.push(`credential-source-${value?.capability ?? "unknown"}-status-invalid`);
      continue;
    }
    if (
      value.approvalStatus === "owner-approved" &&
      (value.sourceHandleRecorded !== true ||
        typeof value.sourceHandleRef !== "string" ||
        value.sourceHandleRef.trim().length === 0 ||
        typeof value.ownerApprovalRef !== "string" ||
        value.ownerApprovalRef.trim().length === 0 ||
        !["staging", "production", "staging-and-production"].includes(
          value.targetEnvironment,
        ))
    ) {
      errors.push(
        `credential-source-${value.capability}-approval-evidence-incomplete`,
      );
    }
  }
}

function containsCredentialValueShape(value) {
  if (Array.isArray(value)) {
    return value.some(containsCredentialValueShape);
  }
  if (!value || typeof value !== "object") return false;
  for (const [key, nested] of Object.entries(value)) {
    if (
      /^(?:apiKey|password|token|secret|secretValue|credentialValue)$/i.test(
        key,
      ) &&
      nested !== null &&
      nested !== "" &&
      nested !== "redacted" &&
      nested !== "missing"
    ) {
      return true;
    }
    if (containsCredentialValueShape(nested)) return true;
  }
  return false;
}

function readManifestPath(args) {
  const flagIndex = args.indexOf("--manifest");
  if (flagIndex === -1) return defaultManifestPath;
  const value = args[flagIndex + 1]?.trim();
  if (!value) {
    emitInvalid(["manifest-path-required"]);
  }
  return value;
}

function readCandidateSelection(args) {
  const flagIndex = args.indexOf("--candidate-sha");
  if (flagIndex !== -1) {
    return {
      sha: args[flagIndex + 1]?.trim() ?? "",
      explicit: true,
      source: "argument",
    };
  }
  return { sha: "", explicit: false, source: "head" };
}

function readCurrentGitSha() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    timeout: 5_000,
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

function isAncestor(ancestor, descendant) {
  const result = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", ancestor, descendant],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
      timeout: 5_000,
    },
  );
  return result.status === 0;
}

function isGitSha(value) {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}

function isSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isDeploymentId(value) {
  return typeof value === "string" && /^dpl_[A-Za-z0-9]{20,}$/.test(value);
}

function isImmutableVercelUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.pathname === "/" &&
      url.hostname.endsWith(".vercel.app") &&
      url.hostname !== "staging.uais.top" &&
      url.hostname !== "uais.top"
    );
  } catch {
    return false;
  }
}

function emitInvalid(errors) {
  process.stdout.write(
    `${JSON.stringify(
      {
        target: "p2-current-candidate-closure",
        status: "FAIL",
        releaseReady: false,
        validationErrors: [...new Set(errors)],
        safety: {
          valuesRedacted: true,
          historicalEvidenceCannotPass: true,
          noNetworkUsed: true,
          noMutationPerformed: true,
        },
      },
      null,
      2,
    )}\n`,
  );
  process.exit(1);
}
