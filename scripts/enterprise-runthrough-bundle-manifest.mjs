#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const ownerPackageManifest = readJsonArg(args, "owner-package-manifest");
  const enterpriseLiveEvidenceTriage = readJsonArg(args, "enterprise-live-evidence-triage");
  const releaseBlockerDependencyGraph = readJsonArg(args, "release-blocker-dependency-graph");
  const ownerResponseGapMatrix = args["owner-response-gap-matrix"]
    ? readJsonArg(args, "owner-response-gap-matrix")
    : null;
  const manifest = buildManifest({
    ownerPackageManifest,
    ownerPackageManifestPath: args["owner-package-manifest"],
    enterpriseLiveEvidenceTriage,
    enterpriseLiveEvidenceTriagePath: args["enterprise-live-evidence-triage"],
    releaseBlockerDependencyGraph,
    releaseBlockerDependencyGraphPath: args["release-blocker-dependency-graph"],
    ownerResponseGapMatrix,
    includes: args.include,
  });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(manifest));
    return;
  }

  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

function buildManifest({
  ownerPackageManifest,
  ownerPackageManifestPath,
  enterpriseLiveEvidenceTriage,
  enterpriseLiveEvidenceTriagePath,
  releaseBlockerDependencyGraph,
  releaseBlockerDependencyGraphPath,
  ownerResponseGapMatrix,
  includes,
}) {
  const artifacts = [];
  const missingArtifacts = [];

  addSourceArtifactPair({
    artifacts,
    missingArtifacts,
    role: "owner-package-manifest",
    jsonPath: ownerPackageManifestPath,
  });
  addSourceArtifactPair({
    artifacts,
    missingArtifacts,
    role: "enterprise-live-evidence-triage",
    jsonPath: enterpriseLiveEvidenceTriagePath,
  });
  addSourceArtifactPair({
    artifacts,
    missingArtifacts,
    role: "release-blocker-dependency-graph",
    jsonPath: releaseBlockerDependencyGraphPath,
  });

  for (const includePath of includes) {
    addArtifact({
      artifacts,
      missingArtifacts,
      role: "bundle-include",
      filePath: includePath,
    });
  }

  const ownerPackageStatus = readString(ownerPackageManifest.status, "unknown");
  const ownerPackageSafetyAttentionCount = readNumber(
    ownerPackageManifest.summary?.packetSafetyAttentionCount,
  );
  const triageTotalTargets = readNumber(enterpriseLiveEvidenceTriage.summary?.totalTargets);
  const triageAcceptedTargets = readNumber(enterpriseLiveEvidenceTriage.summary?.acceptedTargets);
  const dependencyGraphMappedRequirements = readNumber(
    releaseBlockerDependencyGraph.summary?.mappedBlockedRequirementCount,
  );
  const dependencyGraphTotalRequirements = readNumber(
    releaseBlockerDependencyGraph.summary?.blockedRequirementCount,
  );
  const sourceOwnerDecisionQueueStatus = readString(
    releaseBlockerDependencyGraph.ownerDecisionQueueStatus,
    readString(ownerPackageManifest.ownerDecisionQueueStatus, "unknown"),
  );
  const ownerDecisionQueueStatus = readString(
    ownerResponseGapMatrix?.ownerDecisionQueueStatus,
    sourceOwnerDecisionQueueStatus,
  );
  const needsOwnerInput =
    typeof ownerResponseGapMatrix?.summary?.needsOwnerInput === "boolean"
      ? ownerResponseGapMatrix.summary.needsOwnerInput
      : ownerDecisionQueueStatus === "owner-decisions-required";
  const productionEvidenceRequired =
    typeof ownerResponseGapMatrix?.summary?.productionEvidenceRequired === "boolean"
      ? ownerResponseGapMatrix.summary.productionEvidenceRequired
      : false;
  const releaseReady =
    missingArtifacts.length === 0 &&
    ownerPackageManifest.summary?.releaseReady === true &&
    releaseBlockerDependencyGraph.summary?.releaseReady === true &&
    ownerPackageSafetyAttentionCount === 0 &&
    triageTotalTargets > 0 &&
    triageAcceptedTargets === triageTotalTargets &&
    dependencyGraphMappedRequirements === dependencyGraphTotalRequirements &&
    isReadyLikeStatus(ownerDecisionQueueStatus);
  const status =
    missingArtifacts.length > 0
      ? "bundle-manifest-incomplete"
      : ownerPackageStatus === "manifest-needs-safety-review" ||
          ownerPackageSafetyAttentionCount > 0
        ? "bundle-manifest-needs-safety-review"
        : "bundle-manifest-created";

  return {
    target: "enterprise-runthrough-bundle-manifest",
    status,
    releaseGateStatus: readString(
      releaseBlockerDependencyGraph.releaseGateStatus,
      readString(ownerPackageManifest.releaseGateStatus, "unknown"),
    ),
    ownerDecisionQueueStatus,
    sourceOwnerDecisionQueueStatus,
    responsibleSession: "S22",
    summary: {
      sliceCount: 3,
      artifactCount: artifacts.length,
      missingArtifactCount: missingArtifacts.length,
      ownerPackageArtifactCount: readNumber(ownerPackageManifest.summary?.artifactCount),
      ownerPackageSafetyAttentionCount,
      triageTotalTargets,
      triageAcceptedTargets,
      dependencyGraphMappedRequirements,
      dependencyGraphTotalRequirements,
      needsOwnerInput,
      productionEvidenceRequired,
      releaseReady,
    },
    slices: [
      {
        id: "owner-decision-package",
        status: ownerPackageStatus,
        packetIndexStatus: readString(ownerPackageManifest.packetIndexStatus, "unknown"),
        releaseReady: ownerPackageManifest.summary?.releaseReady === true,
        artifactCount: readNumber(ownerPackageManifest.summary?.artifactCount),
        missingArtifactCount: readNumber(ownerPackageManifest.summary?.missingArtifactCount),
        packetSafetyAttentionCount: ownerPackageSafetyAttentionCount,
        sourceFileName: basename(ownerPackageManifestPath),
      },
      {
        id: "enterprise-live-evidence-triage",
        status: readString(enterpriseLiveEvidenceTriage.status, "unknown"),
        releaseGateStatus: readString(enterpriseLiveEvidenceTriage.releaseGateStatus, "unknown"),
        totalTargets: readNumber(enterpriseLiveEvidenceTriage.summary?.totalTargets),
        acceptedTargets: readNumber(enterpriseLiveEvidenceTriage.summary?.acceptedTargets),
        missingRequiredTargets: readNumber(
          enterpriseLiveEvidenceTriage.summary?.missingRequiredTargets,
        ),
        executionWaveCount: readRecordArray(enterpriseLiveEvidenceTriage.executionWaves).length,
        sourceFileName: basename(enterpriseLiveEvidenceTriagePath),
      },
      {
        id: "release-blocker-dependency-graph",
        status: readString(releaseBlockerDependencyGraph.status, "unknown"),
        blockedRequirementCount: readNumber(
          releaseBlockerDependencyGraph.summary?.blockedRequirementCount,
        ),
        mappedBlockedRequirementCount: readNumber(
          releaseBlockerDependencyGraph.summary?.mappedBlockedRequirementCount,
        ),
        unmappedBlockedRequirementCount: readNumber(
          releaseBlockerDependencyGraph.summary?.unmappedBlockedRequirementCount,
        ),
        releaseReady: releaseBlockerDependencyGraph.summary?.releaseReady === true,
        sourceFileName: basename(releaseBlockerDependencyGraphPath),
      },
    ],
    artifacts,
    missingArtifacts,
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      secretValuesOmitted: true,
      responseBodiesOmitted: true,
      fileContentsOmitted: true,
      noLiveMutationPerformed: true,
      noDeploymentMutationPerformed: true,
      noReleaseRunBindingPerformed: true,
    },
  };
}

function addSourceArtifactPair({ artifacts, missingArtifacts, role, jsonPath }) {
  addArtifact({
    artifacts,
    missingArtifacts,
    role: `${role}-json`,
    filePath: jsonPath,
  });

  const markdownPath = jsonPath.replace(/\.json$/, ".md");
  if (markdownPath !== jsonPath && existsSync(markdownPath)) {
    addArtifact({
      artifacts,
      missingArtifacts,
      role: `${role}-markdown`,
      filePath: markdownPath,
    });
  }
}

function addArtifact({ artifacts, missingArtifacts, role, filePath }) {
  const fileName = basename(filePath);
  if (!existsSync(filePath)) {
    missingArtifacts.push({ role, fileName });
    return;
  }

  const buffer = readFileSync(filePath);
  const stat = statSync(filePath);
  artifacts.push({
    role,
    fileName,
    byteLength: stat.size,
    sha256: `sha256:${createHash("sha256").update(buffer).digest("hex")}`,
  });
}

function renderMarkdown(manifest) {
  const lines = [
    "# UAIS Enterprise Runthrough Bundle Manifest",
    "",
    `Status: \`${manifest.status}\``,
    `Release gate: \`${manifest.releaseGateStatus}\``,
    `Owner queue: \`${manifest.ownerDecisionQueueStatus}\``,
    `Source owner queue: \`${manifest.sourceOwnerDecisionQueueStatus}\``,
    `Needs owner input: \`${manifest.summary.needsOwnerInput}\``,
    `Production evidence required: \`${manifest.summary.productionEvidenceRequired}\``,
    `Release ready: \`${manifest.summary.releaseReady}\``,
    `Artifacts fingerprinted: ${manifest.summary.artifactCount}`,
    `Missing artifacts: ${manifest.summary.missingArtifactCount}`,
    "",
    "This manifest fingerprints coordination artifacts only. It does not make blocked production evidence release-ready.",
    "",
    "## Slice Summary",
    "",
    "| Slice | Status | Key counts | Source |",
    "| --- | --- | --- | --- |",
    ...manifest.slices.map((slice) =>
      [
        `| \`${slice.id}\``,
        `| \`${slice.status}\``,
        `| ${sliceCounts(slice)}`,
        `| ${slice.sourceFileName} |`,
      ].join(" "),
    ),
    "",
    "## Artifact Fingerprints",
    "",
    "| Role | File | Bytes | SHA-256 |",
    "| --- | --- | ---: | --- |",
    ...manifest.artifacts.map((artifact) =>
      [
        "|",
        artifact.role,
        `| ${artifact.fileName}`,
        `| ${artifact.byteLength}`,
        `| \`${artifact.sha256}\` |`,
      ].join(" "),
    ),
  ];

  if (manifest.missingArtifacts.length > 0) {
    lines.push("", "## Missing Artifacts", "");
    lines.push(
      ...manifest.missingArtifacts.map(
        (artifact) => `- \`${artifact.role}\` (${artifact.fileName})`,
      ),
    );
  }

  return `${lines.join("\n")}\n`;
}

function sliceCounts(slice) {
  if (slice.id === "owner-decision-package") {
    return `artifacts ${slice.artifactCount}, missing ${slice.missingArtifactCount}, safety ${slice.packetSafetyAttentionCount}`;
  }
  if (slice.id === "enterprise-live-evidence-triage") {
    return `accepted ${slice.acceptedTargets}/${slice.totalTargets}, waves ${slice.executionWaveCount}`;
  }
  if (slice.id === "release-blocker-dependency-graph") {
    return `mapped ${slice.mappedBlockedRequirementCount}/${slice.blockedRequirementCount}, unmapped ${slice.unmappedBlockedRequirementCount}`;
  }
  return "n/a";
}

function parseArgs(argv) {
  const args = { format: "json", include: [] };
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
    if (key === "include") {
      args.include.push(value);
    } else {
      args[key] = value;
    }
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

function readNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function readRecordArray(value) {
  return Array.isArray(value) ? value.filter((item) => isRecord(item)) : [];
}

function isReadyLikeStatus(status) {
  return [
    "ready",
    "passed",
    "complete",
    "completed",
    "accepted",
    "no-owner-decisions-required",
    "owner-decisions-complete",
  ].includes(readString(status, "unknown"));
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
