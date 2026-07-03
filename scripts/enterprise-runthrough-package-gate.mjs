#!/usr/bin/env node

import { readFileSync } from "node:fs";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dirtyMap = readJsonArg(args, "dirty-map");
  const reviewSliceIndex = readJsonArg(args, "review-slice-index");
  const reviewedPathspecs = args["pathspecs-file"]
    ? readPathspecFile(args["pathspecs-file"])
    : null;
  const ownerResponseGapMatrix = args["owner-response-gap-matrix"]
    ? readJsonArg(args, "owner-response-gap-matrix")
    : null;
  const gate = buildGate({
    dirtyMap,
    reviewSliceIndex,
    ownerResponseGapMatrix,
    reviewedPathspecs,
  });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(gate));
  } else {
    process.stdout.write(`${JSON.stringify(gate, null, 2)}\n`);
  }

  if (gate.status !== "package-gate-passed") {
    process.exitCode = 1;
  }
}

function buildGate({ dirtyMap, reviewSliceIndex, ownerResponseGapMatrix, reviewedPathspecs }) {
  const dirtyPaths = readRecordArray(dirtyMap.entries)
    .map((entry) => readString(entry.path, ""))
    .filter(Boolean);
  const aggregatePathspecs = readStringArray(reviewSliceIndex.aggregatePathspecs);
  const dirtyPathSet = new Set(dirtyPaths);
  const pathspecSet = new Set(aggregatePathspecs);
  const duplicatePathspecs = findDuplicates(aggregatePathspecs);
  const wildcardPathspecs = aggregatePathspecs.filter(isWildcardPathspec);
  const missingDirtyPaths = dirtyPaths.filter((path) => !pathspecSet.has(path));
  const stalePathspecs = aggregatePathspecs.filter((pathspec) => !dirtyPathSet.has(pathspec));
  const pathspecFileMismatches = reviewedPathspecs
    ? comparePathspecFile({ aggregatePathspecs, reviewedPathspecs })
    : [];
  const retainedIntermediateDirtyMaps = findRetainedIntermediateDirtyMaps(dirtyPaths);
  const reviewIndexUncoveredPathCount = readNumber(reviewSliceIndex.summary?.uncoveredPathCount);
  const reviewIndexDuplicatePathCount = readNumber(reviewSliceIndex.summary?.duplicatePathCount);
  const failureCount =
    missingDirtyPaths.length +
    stalePathspecs.length +
    duplicatePathspecs.length +
    wildcardPathspecs.length +
    pathspecFileMismatches.length +
    retainedIntermediateDirtyMaps.length +
    reviewIndexUncoveredPathCount +
    reviewIndexDuplicatePathCount;
  const status = failureCount === 0 ? "package-gate-passed" : "package-gate-failed";
  const ownerDecisionQueueStatus = readString(
    ownerResponseGapMatrix?.ownerDecisionQueueStatus,
    readString(reviewSliceIndex.ownerDecisionQueueStatus, "unknown"),
  );
  const sourceOwnerDecisionQueueStatus = readString(
    ownerResponseGapMatrix?.sourceOwnerDecisionQueueStatus,
    readString(reviewSliceIndex.sourceOwnerDecisionQueueStatus, ownerDecisionQueueStatus),
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
    reviewSliceIndex.summary?.releaseReady === true &&
    readString(reviewSliceIndex.status, "unknown") === "review-slice-index-created" &&
    status === "package-gate-passed" &&
    isReadyLikeStatus(ownerDecisionQueueStatus);

  return {
    target: "enterprise-runthrough-package-gate",
    status,
    releaseReady,
    releaseGateStatus: readString(reviewSliceIndex.releaseGateStatus, "unknown"),
    ownerDecisionQueueStatus,
    sourceOwnerDecisionQueueStatus,
    responsibleSession: "S25/S22",
    sourceDirtyMapReason: readString(dirtyMap.reason, "unknown"),
    summary: {
      dirtyEntryCount: dirtyPaths.length,
      aggregatePathspecCount: aggregatePathspecs.length,
      reviewGroupCount: readRecordArray(reviewSliceIndex.reviewGroups).length,
      missingDirtyPathCount: missingDirtyPaths.length,
      stalePathspecCount: stalePathspecs.length,
      duplicatePathspecCount: duplicatePathspecs.length,
      wildcardPathspecCount: wildcardPathspecs.length,
      pathspecFileMismatchCount: pathspecFileMismatches.length,
      retainedIntermediateDirtyMapCount: retainedIntermediateDirtyMaps.length,
      reviewIndexUncoveredPathCount,
      reviewIndexDuplicatePathCount,
      needsOwnerInput,
      productionEvidenceRequired,
      releaseReady,
    },
    missingDirtyPaths,
    stalePathspecs,
    duplicatePathspecs,
    wildcardPathspecs,
    pathspecFileMismatches,
    retainedIntermediateDirtyMaps,
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      secretValuesOmitted: true,
      responseBodiesOmitted: true,
      noGitMutationPerformed: true,
      noStagingPerformed: true,
      explicitPathspecsOnly: true,
      noWildcardPathspecs: wildcardPathspecs.length === 0,
    },
  };
}

function renderMarkdown(gate) {
  const lines = [
    "# UAIS Enterprise Runthrough Package Gate",
    "",
    `Status: \`${gate.status}\``,
    `Release gate: \`${gate.releaseGateStatus}\``,
    `Owner queue: \`${gate.ownerDecisionQueueStatus}\``,
    `Source owner queue: \`${gate.sourceOwnerDecisionQueueStatus}\``,
    `Needs owner input: \`${gate.summary.needsOwnerInput}\``,
    `Production evidence required: \`${gate.summary.productionEvidenceRequired}\``,
    `Release ready: \`${gate.summary.releaseReady}\``,
    "",
    "This gate verifies explicit pathspec coverage only. It performs no staging or Git mutation.",
    "",
    "## Gate Checks",
    "",
    `Dirty entries: ${gate.summary.dirtyEntryCount}`,
    `Aggregate pathspecs: ${gate.summary.aggregatePathspecCount}`,
    `Missing dirty paths: ${gate.summary.missingDirtyPathCount}`,
    `Stale pathspecs: ${gate.summary.stalePathspecCount}`,
    `Duplicate pathspecs: ${gate.summary.duplicatePathspecCount}`,
    `Wildcard pathspecs: ${gate.summary.wildcardPathspecCount}`,
    `Pathspec file mismatches: ${gate.summary.pathspecFileMismatchCount}`,
    `Retained intermediate dirty maps: ${gate.summary.retainedIntermediateDirtyMapCount}`,
    `Review-index uncovered paths: ${gate.summary.reviewIndexUncoveredPathCount}`,
    `Review-index duplicate assignments: ${gate.summary.reviewIndexDuplicatePathCount}`,
  ];

  if (gate.missingDirtyPaths.length > 0) {
    lines.push("", "## Missing Dirty Paths", "");
    lines.push(...gate.missingDirtyPaths.map((path) => `- ${path}`));
  }

  if (gate.stalePathspecs.length > 0) {
    lines.push("", "## Stale Pathspecs", "");
    lines.push(...gate.stalePathspecs.map((path) => `- ${path}`));
  }

  if (gate.duplicatePathspecs.length > 0) {
    lines.push("", "## Duplicate Pathspecs", "");
    lines.push(...gate.duplicatePathspecs.map((path) => `- ${path}`));
  }

  if (gate.wildcardPathspecs.length > 0) {
    lines.push("", "## Unsafe Wildcard Pathspecs", "");
    lines.push(...gate.wildcardPathspecs.map((path) => `- ${path}`));
  }

  if (gate.pathspecFileMismatches.length > 0) {
    lines.push("", "## Pathspec File Mismatches", "");
    lines.push(...gate.pathspecFileMismatches.map((path) => `- ${path}`));
  }

  if (gate.retainedIntermediateDirtyMaps.length > 0) {
    lines.push("", "## Retained Intermediate Dirty Maps", "");
    lines.push(...gate.retainedIntermediateDirtyMaps.map((path) => `- ${path}`));
  }

  return `${lines.join("\n")}\n`;
}

function comparePathspecFile({ aggregatePathspecs, reviewedPathspecs }) {
  const mismatches = [];
  const maxLength = Math.max(aggregatePathspecs.length, reviewedPathspecs.length);
  for (let index = 0; index < maxLength; index += 1) {
    if (aggregatePathspecs[index] !== reviewedPathspecs[index]) {
      mismatches.push(
        `line ${index + 1}: expected ${aggregatePathspecs[index] ?? "<missing>"}, got ${
          reviewedPathspecs[index] ?? "<missing>"
        }`,
      );
    }
  }
  return mismatches;
}

function findRetainedIntermediateDirtyMaps(dirtyPaths) {
  const allowedDirtyMaps = new Set([
    "coordination/release-intake/2026-07-03-current-rescue-dirty-map.json",
    "coordination/release-intake/2026-07-03-final-rescue-dirty-map.json",
  ]);
  return dirtyPaths.filter(
    (path) =>
      path.startsWith("coordination/release-intake/") &&
      path.endsWith("-dirty-map.json") &&
      !allowedDirtyMaps.has(path),
  );
}

function findDuplicates(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  return [...duplicates];
}

function isWildcardPathspec(pathspec) {
  return pathspec === "." || pathspec.includes("*") || pathspec.endsWith("/");
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

function readPathspecFile(filePath) {
  return readFileSync(filePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
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

function readNumber(value) {
  return Number.isFinite(value) ? value : 0;
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
