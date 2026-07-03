#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";

const groupDefinitions = [
  {
    id: "s10-governance-tooling",
    label: "S10 governance and tooling",
    owner: "S10/S25",
    match: (path) =>
      [
        ".gitignore",
        "AGENTS.md",
        "package.json",
        "package-lock.json",
      ].includes(path),
  },
  {
    id: "dirty-worktree-rescue-evidence",
    label: "Dirty worktree rescue evidence",
    owner: "S25/S10",
    match: (path) =>
      path === "coordination/reports/2026-07-03-dirty-worktree-rescue-closeout.md" ||
      path === "coordination/release-intake/2026-07-03-dirty-worktree-rescue-archive-manifest.json" ||
      path === "coordination/release-intake/2026-07-03-dirty-worktree-rescue-pathspecs.txt",
  },
  {
    id: "owner-decision-package",
    label: "Owner decision package",
    owner: "S22/S10/S25",
    match: (path) =>
      !isReleaseIntakeDirtyMap(path) &&
      (
        path.includes("owner-decision") ||
        path.includes("owner-response") ||
        path.includes("production-release-run-response") ||
        path.includes("ordinary-teaching-production-evidence") ||
        path.includes("app-auth-production-evidence-preflight") ||
        path.includes("app-auth-production-evidence-gate") ||
        path.includes("owner-package") ||
        path.includes("teacher-auth-production-evidence-preflight") ||
        path.includes("teacher-auth-production-evidence-gate") ||
        path.includes("teacher-auth-vercel-env-sync-evidence-gate") ||
        path.includes("external-storage-production-evidence-preflight") ||
        path.includes("external-storage-vercel-env-sync-evidence-gate") ||
        path.includes("external-storage-production-evidence-gate") ||
        path.includes("vercel-env-deploy-production-evidence-preflight") ||
        path.includes("vercel-env-deploy-production-evidence-gate") ||
        path.includes("manual-ppt-playback-acceptance-production-evidence-preflight") ||
        path.includes("manual-ppt-playback-acceptance-production-evidence-gate") ||
        path.includes("enterprise-live-evidence-audit-production-evidence-preflight") ||
        path.includes("enterprise-live-evidence-audit-production-evidence-gate") ||
        path.includes("production-release-run-production-evidence-preflight") ||
        path.includes("production-release-run-production-evidence-gate") ||
        path.includes("production-evidence-execution-plan") ||
        path.includes("production-evidence-reuse-audit") ||
        path.includes("production-env-source-handoff") ||
        path.includes("app-auth-env-source-intake") ||
        path.includes("teacher-auth-env-source-intake") ||
        path.includes("external-storage-env-source-intake") ||
        path.includes("app-auth-vercel-env-sync-evidence-gate") ||
        path.includes("operator-input-packet-safety-propagation") ||
        path.includes("operator-input-packet-markdown-visibility") ||
        path.includes("action-packet-index")
      ),
  },
  {
    id: "enterprise-live-evidence-triage",
    label: "Enterprise live evidence triage",
    owner: "S22/S10/S25",
    match: (path) => !isReleaseIntakeDirtyMap(path) && path.includes("enterprise-live-evidence-triage"),
  },
  {
    id: "release-blocker-dependency-graph",
    label: "Release blocker dependency graph",
    owner: "S22/S10/S25",
    match: (path) => !isReleaseIntakeDirtyMap(path) && path.includes("release-blocker-dependency-graph"),
  },
  {
    id: "release-blocker-diagnosis-coverage",
    label: "Release blocker diagnosis coverage",
    owner: "S22/S25",
    match: (path) => !isReleaseIntakeDirtyMap(path) && path.includes("release-blocker-diagnosis-coverage"),
  },
  {
    id: "targeted-live-blocker-diagnoses",
    label: "Targeted live blocker diagnoses",
    owner: "S22/S25",
    match: (path) =>
      path.startsWith("coordination/reports/") && path.endsWith("-live-blocker-diagnosis.md"),
  },
  {
    id: "enterprise-runthrough-bundle-manifest",
    label: "Enterprise runthrough bundle manifest",
    owner: "S22/S10/S25",
    match: (path) => !isReleaseIntakeDirtyMap(path) && path.includes("enterprise-runthrough-bundle-manifest"),
  },
  {
    id: "enterprise-runthrough-review-slice-index",
    label: "Enterprise runthrough review slice index",
    owner: "S25/S22",
    match: (path) => !isReleaseIntakeDirtyMap(path) && path.includes("enterprise-runthrough-review-slice-index"),
  },
  {
    id: "enterprise-runthrough-package-gate",
    label: "Enterprise runthrough package gate",
    owner: "S25/S22",
    match: (path) => !isReleaseIntakeDirtyMap(path) && path.includes("enterprise-runthrough-package-gate"),
  },
  {
    id: "release-intake-current-state-probes",
    label: "Release intake current-state probes",
    owner: "S25/S10",
    match: (path) => isReleaseIntakeDirtyMap(path),
  },
  {
    id: "s10-president-report",
    label: "S10 president report and coordination logs",
    owner: "S10/S25",
    match: (path) =>
      (path.startsWith("coordination/reports/") && path.endsWith("-president-report.docx")) ||
      isS10OrS25SessionLog(path),
  },
  {
    id: "s22-session-log",
    label: "S22 session log",
    owner: "S22",
    match: (path) => path === "coordination/session-logs/2026-06-30-S22.md",
  },
];

function isReleaseIntakeDirtyMap(path) {
  return path.startsWith("coordination/release-intake/") && path.endsWith("-dirty-map.json");
}

function isS10OrS25SessionLog(path) {
  return /^coordination\/session-logs\/\d{4}-\d{2}-\d{2}-S(10|25)\.md$/.test(path);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dirtyMap = readJsonArg(args, "dirty-map");
  const bundleManifest = readJsonArg(args, "bundle-manifest");
  const index = buildIndex({ dirtyMap, bundleManifest });

  if (args["pathspecs-out"]) {
    writeFileSync(args["pathspecs-out"], `${index.aggregatePathspecs.join("\n")}\n`);
  }

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(index));
    return;
  }

  process.stdout.write(`${JSON.stringify(index, null, 2)}\n`);
}

function buildIndex({ dirtyMap, bundleManifest }) {
  const dirtyEntries = readRecordArray(dirtyMap.entries).map((entry) => ({
    status: readString(entry.status, "??"),
    path: readString(entry.path, ""),
    topLevel: readString(entry.topLevel, readString(entry.path, "").split("/")[0] || ""),
  })).filter((entry) => entry.path.length > 0);
  const assignmentByPath = new Map();
  const duplicatePathAssignments = [];
  const reviewGroups = groupDefinitions.map((definition) => {
    const pathspecs = dirtyEntries
      .filter((entry) => definition.match(entry.path))
      .map((entry) => entry.path);

    for (const pathspec of pathspecs) {
      if (assignmentByPath.has(pathspec)) {
        duplicatePathAssignments.push({
          path: pathspec,
          groups: [assignmentByPath.get(pathspec), definition.id],
        });
      } else {
        assignmentByPath.set(pathspec, definition.id);
      }
    }

    return {
      id: definition.id,
      label: definition.label,
      owner: definition.owner,
      pathspecCount: pathspecs.length,
      pathspecs,
    };
  }).filter((group) => group.pathspecCount > 0);
  const coveredPaths = [...assignmentByPath.keys()];
  const uncoveredPaths = dirtyEntries
    .map((entry) => entry.path)
    .filter((path) => !assignmentByPath.has(path));
  const status =
    uncoveredPaths.length === 0 && duplicatePathAssignments.length === 0
      ? "review-slice-index-created"
      : "review-slice-index-needs-attention";
  const ownerDecisionQueueStatus = readString(bundleManifest.ownerDecisionQueueStatus, "unknown");
  const releaseReady =
    bundleManifest.summary?.releaseReady === true &&
    status === "review-slice-index-created" &&
    isReadyLikeStatus(ownerDecisionQueueStatus);

  return {
    target: "enterprise-runthrough-review-slice-index",
    status,
    releaseGateStatus: readString(bundleManifest.releaseGateStatus, "unknown"),
    ownerDecisionQueueStatus,
    responsibleSession: "S25/S22",
    sourceDirtyMapReason: readString(dirtyMap.reason, "unknown"),
    summary: {
      dirtyEntryCount: dirtyEntries.length,
      reviewGroupCount: reviewGroups.length,
      coveredPathCount: coveredPaths.length,
      uncoveredPathCount: uncoveredPaths.length,
      duplicatePathCount: duplicatePathAssignments.length,
      trackedModifiedCount: dirtyEntries.filter((entry) => entry.status.trim() === "M").length,
      untrackedCount: dirtyEntries.filter((entry) => entry.status === "??").length,
      releaseReady,
    },
    reviewGroups,
    aggregatePathspecs: reviewGroups.flatMap((group) => group.pathspecs),
    uncoveredPaths,
    duplicatePathAssignments,
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      secretValuesOmitted: true,
      responseBodiesOmitted: true,
      noGitMutationPerformed: true,
      explicitPathspecsOnly: true,
      noWildcardPathspecs: true,
    },
  };
}

function renderMarkdown(index) {
  const lines = [
    "# UAIS Enterprise Runthrough Review Slice Index",
    "",
    `Status: \`${index.status}\``,
    `Release gate: \`${index.releaseGateStatus}\``,
    `Owner queue: \`${index.ownerDecisionQueueStatus}\``,
    `Dirty paths covered: ${index.summary.coveredPathCount} / ${index.summary.dirtyEntryCount}`,
    `Uncovered paths: ${index.summary.uncoveredPathCount}`,
    `Duplicate path assignments: ${index.summary.duplicatePathCount}`,
    `Release ready: \`${index.summary.releaseReady}\``,
    "",
    "This index lists explicit pathspecs only. Do not stage with a wildcard command.",
    "",
    "## Review Groups",
    "",
    "| Group | Owner | Paths |",
    "| --- | --- | ---: |",
    ...index.reviewGroups.map((group) =>
      `| \`${group.id}\` | ${group.owner} | ${group.pathspecCount} |`,
    ),
    "",
    "## Aggregate Explicit Pathspecs",
    "",
    ...index.aggregatePathspecs.map((pathspec) => `- ${pathspec}`),
  ];

  if (index.uncoveredPaths.length > 0) {
    lines.push("", "## Uncovered Paths", "");
    lines.push(...index.uncoveredPaths.map((path) => `- ${path}`));
  }

  if (index.duplicatePathAssignments.length > 0) {
    lines.push("", "## Duplicate Path Assignments", "");
    lines.push(
      ...index.duplicatePathAssignments.map(
        (assignment) => `- ${assignment.path}: ${assignment.groups.join(", ")}`,
      ),
    );
  }

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

function readString(value, fallback) {
  return typeof value === "string" ? value : fallback;
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
