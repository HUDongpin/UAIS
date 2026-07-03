import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("enterprise runthrough package gate", () => {
  it("does not mark release ready when ready review input still fails package coverage", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-package-gate-ready-fail-"));
    const dirtyMapPath = writeJson(tmpDir, "dirty-map.json", {
      entries: [
        { status: "??", path: "scripts/enterprise-runthrough-package-gate.mjs" },
        { status: "??", path: "tests/enterprise-runthrough-package-gate.test.ts" },
      ],
    });
    const reviewIndexPath = writeJson(tmpDir, "review-index.json", {
      target: "enterprise-runthrough-review-slice-index",
      status: "review-slice-index-created",
      releaseGateStatus: "ready",
      ownerDecisionQueueStatus: "ready",
      summary: {
        releaseReady: true,
        uncoveredPathCount: 0,
        duplicatePathCount: 0,
      },
      reviewGroups: [
        {
          id: "unsafe",
          pathspecs: [
            "scripts/enterprise-runthrough-package-gate.mjs",
            "scripts/*",
          ],
        },
      ],
      aggregatePathspecs: [
        "scripts/enterprise-runthrough-package-gate.mjs",
        "scripts/*",
      ],
    });

    const result = spawnSync("node", [
      "scripts/enterprise-runthrough-package-gate.mjs",
      "--dirty-map",
      dirtyMapPath,
      "--review-slice-index",
      reviewIndexPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    const body = JSON.parse(result.stdout);
    expect(body.status).toBe("package-gate-failed");
    expect(body.summary.releaseReady).toBe(false);
  });

  it("passes when review-slice pathspecs exactly cover dirty-map paths", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-package-gate-"));
    const fakeLocalPath = ["", "Users", "example", "private", "dirty-map.json"].join("/");
    const dirtyMapPath = writeJson(tmpDir, "dirty-map.json", {
      reason: "fixture",
      summary: {
        totalEntries: 3,
        byStatus: { " M": 1, "??": 2 },
      },
      entries: [
        { status: " M", path: "coordination/session-logs/2026-06-30-S22.md" },
        { status: "??", path: "scripts/enterprise-runthrough-review-slice-index.mjs" },
        { status: "??", path: "tests/enterprise-runthrough-review-slice-index.test.ts" },
      ],
      sourcePath: fakeLocalPath,
    });
    const reviewIndexPath = writeJson(tmpDir, "review-index.json", {
      target: "enterprise-runthrough-review-slice-index",
      status: "review-slice-index-created",
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      summary: {
        dirtyEntryCount: 3,
        coveredPathCount: 3,
        uncoveredPathCount: 0,
        duplicatePathCount: 0,
        releaseReady: false,
      },
      reviewGroups: [
        {
          id: "enterprise-runthrough-review-slice-index",
          pathspecs: [
            "scripts/enterprise-runthrough-review-slice-index.mjs",
            "tests/enterprise-runthrough-review-slice-index.test.ts",
          ],
        },
        {
          id: "s22-session-log",
          pathspecs: ["coordination/session-logs/2026-06-30-S22.md"],
        },
      ],
      aggregatePathspecs: [
        "scripts/enterprise-runthrough-review-slice-index.mjs",
        "tests/enterprise-runthrough-review-slice-index.test.ts",
        "coordination/session-logs/2026-06-30-S22.md",
      ],
      uncoveredPaths: [],
      duplicatePathAssignments: [],
    });

    const output = execFileSync("node", [
      "scripts/enterprise-runthrough-package-gate.mjs",
      "--dirty-map",
      dirtyMapPath,
      "--review-slice-index",
      reviewIndexPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "enterprise-runthrough-package-gate",
        status: "package-gate-passed",
        releaseGateStatus: "blocked",
        ownerDecisionQueueStatus: "owner-decisions-required",
        responsibleSession: "S25/S22",
        releaseReady: false,
        summary: {
          dirtyEntryCount: 3,
          aggregatePathspecCount: 3,
          reviewGroupCount: 2,
          missingDirtyPathCount: 0,
          stalePathspecCount: 0,
          duplicatePathspecCount: 0,
          wildcardPathspecCount: 0,
          pathspecFileMismatchCount: 0,
          retainedIntermediateDirtyMapCount: 0,
          reviewIndexUncoveredPathCount: 0,
          reviewIndexDuplicatePathCount: 0,
          needsOwnerInput: true,
          productionEvidenceRequired: false,
          releaseReady: false,
        },
        missingDirtyPaths: [],
        stalePathspecs: [],
        duplicatePathspecs: [],
        wildcardPathspecs: [],
        pathspecFileMismatches: [],
        retainedIntermediateDirtyMaps: [],
        safety: {
          sourcePathsOmitted: true,
          rawUrlsOmitted: true,
          secretValuesOmitted: true,
          responseBodiesOmitted: true,
          noGitMutationPerformed: true,
          noStagingPerformed: true,
          explicitPathspecsOnly: true,
          noWildcardPathspecs: true,
        },
      }),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain(["", "Users", ""].join("/"));
  });

  it("does not mark the package gate release-ready while the owner queue still requires decisions", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-package-gate-queue-blocked-"));
    const dirtyMapPath = writeJson(tmpDir, "dirty-map.json", {
      entries: [
        { status: "??", path: "scripts/enterprise-runthrough-package-gate.mjs" },
      ],
    });
    const reviewIndexPath = writeJson(tmpDir, "review-index.json", {
      target: "enterprise-runthrough-review-slice-index",
      status: "review-slice-index-created",
      releaseGateStatus: "ready",
      ownerDecisionQueueStatus: "owner-decisions-required",
      summary: {
        releaseReady: true,
        uncoveredPathCount: 0,
        duplicatePathCount: 0,
      },
      reviewGroups: [
        {
          id: "enterprise-runthrough-package-gate",
          pathspecs: ["scripts/enterprise-runthrough-package-gate.mjs"],
        },
      ],
      aggregatePathspecs: ["scripts/enterprise-runthrough-package-gate.mjs"],
    });

    const output = execFileSync("node", [
      "scripts/enterprise-runthrough-package-gate.mjs",
      "--dirty-map",
      dirtyMapPath,
      "--review-slice-index",
      reviewIndexPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("package-gate-passed");
    expect(body.ownerDecisionQueueStatus).toBe("owner-decisions-required");
    expect(body.summary.missingDirtyPathCount).toBe(0);
    expect(body.summary.stalePathspecCount).toBe(0);
    expect(body.summary.releaseReady).toBe(false);
  });

  it("uses the current owner response gap matrix queue status when provided", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-package-gate-gap-matrix-"));
    const dirtyMapPath = writeJson(tmpDir, "dirty-map.json", {
      entries: [
        { status: "??", path: "scripts/enterprise-runthrough-package-gate.mjs" },
      ],
    });
    const reviewIndexPath = writeJson(tmpDir, "review-index.json", {
      target: "enterprise-runthrough-review-slice-index",
      status: "review-slice-index-created",
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      summary: {
        releaseReady: false,
        uncoveredPathCount: 0,
        duplicatePathCount: 0,
      },
      reviewGroups: [
        {
          id: "enterprise-runthrough-package-gate",
          pathspecs: ["scripts/enterprise-runthrough-package-gate.mjs"],
        },
      ],
      aggregatePathspecs: ["scripts/enterprise-runthrough-package-gate.mjs"],
    });
    const ownerResponseGapMatrixPath = writeJson(tmpDir, "owner-response-gap-matrix.json", {
      target: "owner-decision-response-gap-matrix",
      status: "owner-response-gaps-present",
      ownerDecisionQueueStatus: "owner-decisions-cleared-awaiting-production-evidence",
      sourceOwnerDecisionQueueStatus: "owner-decisions-required",
      summary: {
        needsOwnerInput: false,
        productionEvidenceRequired: true,
        releaseReady: false,
      },
    });

    const output = execFileSync("node", [
      "scripts/enterprise-runthrough-package-gate.mjs",
      "--dirty-map",
      dirtyMapPath,
      "--review-slice-index",
      reviewIndexPath,
      "--owner-response-gap-matrix",
      ownerResponseGapMatrixPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("package-gate-passed");
    expect(body.ownerDecisionQueueStatus).toBe(
      "owner-decisions-cleared-awaiting-production-evidence",
    );
    expect(body.sourceOwnerDecisionQueueStatus).toBe("owner-decisions-required");
    expect(body.summary.needsOwnerInput).toBe(false);
    expect(body.summary.productionEvidenceRequired).toBe(true);
    expect(body.summary.releaseReady).toBe(false);
  });

  it("accepts an exact reviewed pathspec file", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-package-gate-pathspec-file-"));
    const dirtyMapPath = writeJson(tmpDir, "dirty-map.json", {
      entries: [
        { status: "??", path: "coordination/release-intake/2026-07-03-current-rescue-dirty-map.json" },
        { status: "??", path: "scripts/enterprise-runthrough-package-gate.mjs" },
      ],
    });
    const reviewIndexPath = writeJson(tmpDir, "review-index.json", {
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      summary: { releaseReady: false, uncoveredPathCount: 0, duplicatePathCount: 0 },
      reviewGroups: [],
      aggregatePathspecs: [
        "coordination/release-intake/2026-07-03-current-rescue-dirty-map.json",
        "scripts/enterprise-runthrough-package-gate.mjs",
      ],
    });
    const pathspecsPath = join(tmpDir, "pathspecs.txt");
    writeFileSync(
      pathspecsPath,
      [
        "coordination/release-intake/2026-07-03-current-rescue-dirty-map.json",
        "scripts/enterprise-runthrough-package-gate.mjs",
        "",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/enterprise-runthrough-package-gate.mjs",
      "--dirty-map",
      dirtyMapPath,
      "--review-slice-index",
      reviewIndexPath,
      "--pathspecs-file",
      pathspecsPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("package-gate-passed");
    expect(body.summary.pathspecFileMismatchCount).toBe(0);
    expect(body.summary.retainedIntermediateDirtyMapCount).toBe(0);
  });

  it("rejects retained intermediate dirty-map piles", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-package-gate-dirty-map-pile-"));
    const dirtyMapPath = writeJson(tmpDir, "dirty-map.json", {
      entries: [
        { status: "??", path: "coordination/release-intake/2026-07-02-app-auth-env-source-intake-dirty-map.json" },
        { status: "??", path: "scripts/enterprise-runthrough-package-gate.mjs" },
      ],
    });
    const reviewIndexPath = writeJson(tmpDir, "review-index.json", {
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      summary: { releaseReady: false, uncoveredPathCount: 0, duplicatePathCount: 0 },
      reviewGroups: [],
      aggregatePathspecs: [
        "coordination/release-intake/2026-07-02-app-auth-env-source-intake-dirty-map.json",
        "scripts/enterprise-runthrough-package-gate.mjs",
      ],
    });

    const result = spawnSync("node", [
      "scripts/enterprise-runthrough-package-gate.mjs",
      "--dirty-map",
      dirtyMapPath,
      "--review-slice-index",
      reviewIndexPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    const body = JSON.parse(result.stdout);
    expect(body.status).toBe("package-gate-failed");
    expect(body.retainedIntermediateDirtyMaps).toEqual([
      "coordination/release-intake/2026-07-02-app-auth-env-source-intake-dirty-map.json",
    ]);
  });

  it("fails when dirty paths are missing or wildcard pathspecs are present", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-package-gate-fail-"));
    const dirtyMapPath = writeJson(tmpDir, "dirty-map.json", {
      entries: [
        { status: "??", path: "scripts/enterprise-runthrough-package-gate.mjs" },
        { status: "??", path: "tests/enterprise-runthrough-package-gate.test.ts" },
      ],
    });
    const reviewIndexPath = writeJson(tmpDir, "review-index.json", {
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      summary: {
        releaseReady: false,
        uncoveredPathCount: 1,
        duplicatePathCount: 0,
      },
      reviewGroups: [
        {
          id: "unsafe",
          pathspecs: [
            "scripts/enterprise-runthrough-package-gate.mjs",
            "scripts/*",
          ],
        },
      ],
      aggregatePathspecs: [
        "scripts/enterprise-runthrough-package-gate.mjs",
        "scripts/*",
      ],
    });

    const result = spawnSync("node", [
      "scripts/enterprise-runthrough-package-gate.mjs",
      "--dirty-map",
      dirtyMapPath,
      "--review-slice-index",
      reviewIndexPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    const body = JSON.parse(result.stdout);
    expect(body).toEqual(
      expect.objectContaining({
        status: "package-gate-failed",
        missingDirtyPaths: ["tests/enterprise-runthrough-package-gate.test.ts"],
        stalePathspecs: ["scripts/*"],
        wildcardPathspecs: ["scripts/*"],
      }),
    );
  });

  it("renders a markdown package gate report without wildcard staging instructions", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-package-gate-md-"));
    const dirtyMapPath = writeJson(tmpDir, "dirty-map.json", {
      entries: [
        { status: "??", path: "coordination/reports/2026-07-01-enterprise-runthrough-review-slice-index.json" },
      ],
    });
    const reviewIndexPath = writeJson(tmpDir, "review-index.json", {
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      summary: { releaseReady: false, uncoveredPathCount: 0, duplicatePathCount: 0 },
      reviewGroups: [
        {
          id: "enterprise-runthrough-review-slice-index",
          pathspecs: [
            "coordination/reports/2026-07-01-enterprise-runthrough-review-slice-index.json",
          ],
        },
      ],
      aggregatePathspecs: [
        "coordination/reports/2026-07-01-enterprise-runthrough-review-slice-index.json",
      ],
    });

    const output = execFileSync("node", [
      "scripts/enterprise-runthrough-package-gate.mjs",
      "--dirty-map",
      dirtyMapPath,
      "--review-slice-index",
      reviewIndexPath,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("# UAIS Enterprise Runthrough Package Gate");
    expect(output).toContain("Status: `package-gate-passed`");
    expect(output).toContain("Release gate: `blocked`");
    expect(output).toContain("## Gate Checks");
    expect(output).toContain("Missing dirty paths: 0");
    expect(output).toContain("Wildcard pathspecs: 0");
    expect(output).toContain("Retained intermediate dirty maps: 0");
    expect(output).not.toContain("git add .");
    expect(output).not.toContain("*");
    expect(output).not.toContain(tmpDir);
  });
});

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}
