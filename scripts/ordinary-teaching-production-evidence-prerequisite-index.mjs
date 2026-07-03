#!/usr/bin/env node

import { readFileSync } from "node:fs";

const decisionId = "ordinary-teaching-production-evidence";
const ownerPrerequisiteDecisionIds = [
  "app-auth-provider-production-selector",
  "teacher-auth-provider-production-selector",
  "external-storage-production-service",
  "vercel-env-deploy-and-smoke-chain",
];
const defaultSmokeTargetIds = [
  "teaching-operations-route-smoke",
  "teaching-operation-detail-browser-smoke",
  "teaching-course-management-route-smoke",
];

function main() {
  const args = parseArgs(process.argv.slice(2));
  const ownerResponseGapMatrix = readJsonArg(args, "owner-response-gap-matrix");
  const releaseGate = readJsonArg(args, "release-gate");
  const ordinaryTeachingActionPacket = readJsonArg(args, "ordinary-teaching-action-packet");
  const index = buildIndex({
    ownerResponseGapMatrix,
    releaseGate,
    ordinaryTeachingActionPacket,
  });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(index));
    return;
  }

  process.stdout.write(`${JSON.stringify(index, null, 2)}\n`);
}

function buildIndex({
  ownerResponseGapMatrix,
  releaseGate,
  ordinaryTeachingActionPacket,
}) {
  const gapRows = readRecordArray(ownerResponseGapMatrix.gapRows);
  const ownerPrerequisites = ownerPrerequisiteDecisionIds.map((prerequisiteDecisionId) => {
    const row = gapRows.find((item) => readString(item.decisionId, "") === prerequisiteDecisionId);
    const validationStatus = readString(row?.validationStatus, "missing");
    return {
      decisionId: prerequisiteDecisionId,
      validationStatus,
      missingFieldCount: readNumber(row?.missingFieldCount, validationStatus === "missing" ? 1 : 0),
      unsafeFindingCount: readNumber(row?.unsafeFindingCount, 0),
      accepted: validationStatus === "owner-response-accepted",
    };
  });
  const ordinaryRow = gapRows.find((item) => readString(item.decisionId, "") === decisionId) ?? {};
  const upstreamEvidenceIds = readStringArray(ordinaryTeachingActionPacket.upstreamEvidenceIds);
  const smokeTargetIds = uniqueStrings([
    ...readStringArray(ordinaryTeachingActionPacket.releaseGateRequirementIds),
    ...defaultSmokeTargetIds,
  ]);
  const releaseRequirements = readRecordArray(releaseGate.requirements);
  const missingPrerequisiteEvidence = upstreamEvidenceIds
    .map((id) => buildEvidenceStatus({ id, releaseRequirements }))
    .filter((item) => item.satisfied !== true);
  const missingSmokeTargets = smokeTargetIds
    .map((id) => buildEvidenceStatus({ id, releaseRequirements }))
    .filter((item) => item.satisfied !== true);
  const incompleteOwnerPrerequisites = ownerPrerequisites.filter((item) => !item.accepted);
  const ordinaryOwnerResponseCanBeAccepted =
    incompleteOwnerPrerequisites.length === 0 &&
    missingPrerequisiteEvidence.length === 0 &&
    readString(ordinaryRow.validationStatus, "unknown") !== "owner-response-accepted";
  const status =
    incompleteOwnerPrerequisites.length > 0
      ? "waiting-for-owner-prerequisite-responses"
      : missingPrerequisiteEvidence.length > 0
        ? "waiting-for-production-live-evidence"
        : ordinaryOwnerResponseCanBeAccepted
          ? "ready-for-ordinary-teaching-owner-response"
          : "ordinary-teaching-owner-response-accepted-or-not-actionable";
  const nextOperationalBlocker =
    incompleteOwnerPrerequisites.length > 0
      ? "owner-prerequisite-response-missing"
      : missingPrerequisiteEvidence.length > 0
        ? "production-live-evidence-missing"
        : missingSmokeTargets.length > 0
          ? "ordinary-teaching-live-smokes-not-yet-run"
          : "none-recorded";

  return {
    target: "ordinary-teaching-production-evidence-prerequisite-index",
    status,
    releaseReady: false,
    decisionId,
    releaseGateStatus: readString(releaseGate.status, "unknown"),
    ownerResponseGapStatus: readString(ownerResponseGapMatrix.status, "unknown"),
    responsibleSession: "S22/S19/S10/S12",
    nextOperationalBlocker,
    commandBodiesOmitted: true,
    summary: {
      acceptedOwnerPrerequisiteCount: ownerPrerequisites.length - incompleteOwnerPrerequisites.length,
      incompleteOwnerPrerequisiteCount: incompleteOwnerPrerequisites.length,
      upstreamEvidenceDependencyCount: upstreamEvidenceIds.length,
      missingPrerequisiteEvidenceCount: missingPrerequisiteEvidence.length,
      smokeTargetCount: smokeTargetIds.length,
      missingSmokeTargetCount: missingSmokeTargets.length,
      ordinaryOwnerMissingFieldCount: readNumber(ordinaryRow.missingFieldCount, 0),
      ordinaryOwnerResponseCanBeAccepted,
      releaseReady: false,
    },
    ownerPrerequisites,
    missingPrerequisiteEvidence,
    missingSmokeTargets,
    requiredEvidenceAfterApproval: readStringArray(ordinaryTeachingActionPacket.requiredEvidence),
    requiredCommandNames: Object.keys(readRecord(ordinaryTeachingActionPacket.commands)),
    nextSafeActions: buildNextSafeActions({
      incompleteOwnerPrerequisites,
      missingPrerequisiteEvidence,
      missingSmokeTargets,
    }),
    stillForbiddenUntilResolved: [
      "fill-ordinary-teaching-owner-response-with-unproven-evidence-labels",
      "run-live-ordinary-teaching-smokes-before-auth-storage-and-deployment-readiness",
      "call-live-teaching-operations-api-without-issued-teacher-auth-cookie",
      "accept-local-production-smoke-as-production-live-evidence",
      "bind-production-release-run-id",
    ],
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      deploymentUrlsOmitted: true,
      envFilePathsOmitted: true,
      envValuesOmitted: true,
      cookieValuesOmitted: true,
      credentialValuesOmitted: true,
      responseBodiesOmitted: true,
      commandBodiesOmitted: true,
      noLiveMutationPerformed: true,
      noDeploymentMutationPerformed: true,
      noEnvApplyPerformed: true,
      noReleaseRunBindingPerformed: true,
    },
  };
}

function buildEvidenceStatus({ id, releaseRequirements }) {
  const requirement = releaseRequirements.find((item) => readString(item.id, "") === id) ?? {};
  const requirementStatus = readString(requirement.status, "missing");
  const evidenceStatus = readString(requirement.evidenceStatus, "missing");
  return {
    id,
    requirementStatus,
    evidenceStatus,
    blockedReason: readString(requirement.blockedReason, "missing"),
    satisfied: isSatisfiedRequirementStatus(requirementStatus),
  };
}

function buildNextSafeActions({
  incompleteOwnerPrerequisites,
  missingPrerequisiteEvidence,
  missingSmokeTargets,
}) {
  const actions = [];
  if (incompleteOwnerPrerequisites.length > 0) {
    actions.push("complete-upstream-owner-response-validations-before-ordinary-teaching");
  }
  if (missingPrerequisiteEvidence.length > 0) {
    actions.push(
      "produce-release-run-bound-auth-storage-deployment-evidence-before-ordinary-owner-response",
      "prepare-s19-env-apply-and-s22-deployment-evidence-without-printing-secret-values",
    );
  }
  if (missingSmokeTargets.length > 0 && missingPrerequisiteEvidence.length === 0) {
    actions.push(
      "request-or-validate-ordinary-teaching-owner-response-labels",
      "run-owner-approved-ordinary-teaching-live-smokes-after-prerequisites",
    );
  }
  if (actions.length === 0) {
    actions.push("review-ordinary-teaching-production-evidence-gate");
  }
  return uniqueStrings(actions);
}

function renderMarkdown(index) {
  const lines = [
    "# UAIS Ordinary Teaching Production Evidence Prerequisite Index",
    "",
    `Status: \`${index.status}\``,
    `Decision: \`${index.decisionId}\``,
    `Release gate: \`${index.releaseGateStatus}\``,
    `Next operational blocker: \`${index.nextOperationalBlocker}\``,
    `Ordinary owner response can be accepted: \`${index.summary.ordinaryOwnerResponseCanBeAccepted}\``,
    `Release ready: \`${index.summary.releaseReady}\``,
    "",
    "This index omits command bodies, URLs, cookies, env values, credentials, and response bodies. It performs no live operation, env apply, deployment, smoke, or release-run binding.",
    "",
    "## Owner Prerequisites",
    "",
    "| Decision | Validation | Missing fields | Unsafe findings |",
    "| --- | --- | ---: | ---: |",
    ...index.ownerPrerequisites.map((item) =>
      `| \`${item.decisionId}\` | \`${item.validationStatus}\` | ${item.missingFieldCount} | ${item.unsafeFindingCount} |`,
    ),
    "",
    "## Missing Prerequisite Evidence",
    "",
    "| Evidence | Requirement | Evidence status | Blocker |",
    "| --- | --- | --- | --- |",
    ...index.missingPrerequisiteEvidence.map((item) =>
      `| \`${item.id}\` | \`${item.requirementStatus}\` | \`${item.evidenceStatus}\` | \`${item.blockedReason}\` |`,
    ),
    "",
    "## Missing Smoke Targets",
    "",
    ...formatBullets(index.missingSmokeTargets.map((item) => item.id)),
    "",
    "## Required Command Names",
    "",
    ...formatBullets(index.requiredCommandNames),
    "",
    "## Next Safe Actions",
    "",
    ...formatBullets(index.nextSafeActions),
    "",
    "## Still Forbidden Until Resolved",
    "",
    ...formatBullets(index.stillForbiddenUntilResolved),
  ];

  return `${lines.join("\n")}\n`;
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

function isSatisfiedRequirementStatus(status) {
  return ["satisfied", "ready", "passed"].includes(readString(status, "unknown"));
}

function readRecord(value) {
  return isRecord(value) ? value : {};
}

function readRecordArray(value) {
  return Array.isArray(value) ? value.filter((item) => isRecord(item)) : [];
}

function readString(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function readStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function readNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

function formatBullets(values) {
  return values.length > 0 ? values.map((value) => `- \`${value}\``) : ["- `none-recorded`"];
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
