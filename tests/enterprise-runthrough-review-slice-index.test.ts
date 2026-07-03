import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("enterprise runthrough review slice index", () => {
  it("does not mark release ready when ready bundle input still leaves dirty paths uncovered", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-review-slice-index-ready-"));
    const dirtyMapPath = writeJson(tmpDir, "dirty-map.json", {
      reason: "fixture",
      entries: [
        { status: "??", path: "coordination/reports/unmatched-owner-note.md" },
      ],
    });
    const bundleManifestPath = writeJson(tmpDir, "bundle.json", {
      target: "enterprise-runthrough-bundle-manifest",
      status: "bundle-manifest-created",
      releaseGateStatus: "ready",
      ownerDecisionQueueStatus: "ready",
      summary: {
        releaseReady: true,
      },
    });

    const output = execFileSync("node", [
      "scripts/enterprise-runthrough-review-slice-index.mjs",
      "--dirty-map",
      dirtyMapPath,
      "--bundle-manifest",
      bundleManifestPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("review-slice-index-needs-attention");
    expect(body.summary.uncoveredPathCount).toBe(1);
    expect(body.summary.releaseReady).toBe(false);
  });

  it("covers S10 dated session logs as coordination evidence", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-review-slice-index-s10-log-"));
    const dirtyMapPath = writeJson(tmpDir, "dirty-map.json", {
      reason: "fixture",
      entries: [
        { status: "??", path: "coordination/session-logs/2026-07-02-S10.md" },
      ],
    });
    const bundleManifestPath = writeJson(tmpDir, "bundle.json", {
      target: "enterprise-runthrough-bundle-manifest",
      status: "bundle-manifest-created",
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      summary: {
        releaseReady: false,
      },
    });

    const output = execFileSync("node", [
      "scripts/enterprise-runthrough-review-slice-index.mjs",
      "--dirty-map",
      dirtyMapPath,
      "--bundle-manifest",
      bundleManifestPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("review-slice-index-created");
    expect(body.summary.uncoveredPathCount).toBe(0);
    expect(body.reviewGroups).toEqual([
      expect.objectContaining({
        id: "s10-president-report",
        owner: "S10/S25",
        pathspecs: [
          "coordination/session-logs/2026-07-02-S10.md",
        ],
      }),
    ]);
  });

  it("covers S25 dated session logs as release-intake coordination evidence", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-review-slice-index-s25-log-"));
    const dirtyMapPath = writeJson(tmpDir, "dirty-map.json", {
      reason: "fixture",
      entries: [
        { status: "??", path: "coordination/session-logs/2026-07-03-S25.md" },
      ],
    });
    const bundleManifestPath = writeJson(tmpDir, "bundle.json", {
      target: "enterprise-runthrough-bundle-manifest",
      status: "bundle-manifest-created",
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      summary: { releaseReady: false },
    });

    const output = execFileSync("node", [
      "scripts/enterprise-runthrough-review-slice-index.mjs",
      "--dirty-map",
      dirtyMapPath,
      "--bundle-manifest",
      bundleManifestPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("review-slice-index-created");
    expect(body.summary.uncoveredPathCount).toBe(0);
    expect(body.reviewGroups).toEqual([
      expect.objectContaining({
        id: "s10-president-report",
        owner: "S10/S25",
        pathspecs: [
          "coordination/session-logs/2026-07-03-S25.md",
        ],
      }),
    ]);
  });

  it("covers dirty-worktree rescue closeout artifacts", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-review-slice-index-rescue-"));
    const dirtyMapPath = writeJson(tmpDir, "dirty-map.json", {
      reason: "fixture",
      entries: [
        { status: "??", path: "coordination/reports/2026-07-03-dirty-worktree-rescue-closeout.md" },
        { status: "??", path: "coordination/release-intake/2026-07-03-dirty-worktree-rescue-archive-manifest.json" },
        { status: "??", path: "coordination/release-intake/2026-07-03-dirty-worktree-rescue-pathspecs.txt" },
      ],
    });
    const bundleManifestPath = writeJson(tmpDir, "bundle.json", {
      target: "enterprise-runthrough-bundle-manifest",
      status: "bundle-manifest-created",
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      summary: { releaseReady: false },
    });

    const output = execFileSync("node", [
      "scripts/enterprise-runthrough-review-slice-index.mjs",
      "--dirty-map",
      dirtyMapPath,
      "--bundle-manifest",
      bundleManifestPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("review-slice-index-created");
    expect(body.summary.uncoveredPathCount).toBe(0);
    expect(body.reviewGroups).toEqual([
      expect.objectContaining({
        id: "dirty-worktree-rescue-evidence",
        pathspecCount: 3,
      }),
    ]);
  });

  it("covers S10 governance files changed by cleanup guardrails", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-review-slice-index-governance-"));
    const dirtyMapPath = writeJson(tmpDir, "dirty-map.json", {
      reason: "fixture",
      entries: [
        { status: " M", path: "AGENTS.md" },
        { status: " M", path: "package.json" },
        { status: " M", path: ".gitignore" },
      ],
    });
    const bundleManifestPath = writeJson(tmpDir, "bundle.json", {
      target: "enterprise-runthrough-bundle-manifest",
      status: "bundle-manifest-created",
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      summary: { releaseReady: false },
    });

    const output = execFileSync("node", [
      "scripts/enterprise-runthrough-review-slice-index.mjs",
      "--dirty-map",
      dirtyMapPath,
      "--bundle-manifest",
      bundleManifestPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("review-slice-index-created");
    expect(body.summary.uncoveredPathCount).toBe(0);
    expect(body.reviewGroups).toEqual([
      expect.objectContaining({
        id: "s10-governance-tooling",
        pathspecs: ["AGENTS.md", "package.json", ".gitignore"],
      }),
    ]);
  });

  it("covers operator packet markdown visibility tests as owner release evidence", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-review-slice-index-operator-md-"));
    const dirtyMapPath = writeJson(tmpDir, "dirty-map.json", {
      reason: "fixture",
      entries: [
        { status: "??", path: "tests/operator-input-packet-markdown-visibility.test.ts" },
      ],
    });
    const bundleManifestPath = writeJson(tmpDir, "bundle.json", {
      target: "enterprise-runthrough-bundle-manifest",
      status: "bundle-manifest-created",
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      summary: {
        releaseReady: false,
      },
    });

    const output = execFileSync("node", [
      "scripts/enterprise-runthrough-review-slice-index.mjs",
      "--dirty-map",
      dirtyMapPath,
      "--bundle-manifest",
      bundleManifestPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("review-slice-index-created");
    expect(body.summary.uncoveredPathCount).toBe(0);
    expect(body.reviewGroups).toEqual([
      expect.objectContaining({
        id: "owner-decision-package",
        pathspecs: [
          "tests/operator-input-packet-markdown-visibility.test.ts",
        ],
      }),
    ]);
  });

  it("groups dirty paths into explicit review pathspecs without wildcards", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-review-slice-index-"));
    const fakePath = ["", "Users", "example", "private", "secret.json"].join("/");
    const dirtyMapPath = writeJson(tmpDir, "dirty-map.json", {
      reason: "fixture",
      branch: "codex/uais-dirty-rescue-2026-06-30",
      summary: {
        totalEntries: 27,
        byStatus: { " M": 1, "??": 26 },
        byTopLevel: { coordination: 15, scripts: 3, tests: 3 },
      },
      entries: [
        { status: " M", path: "coordination/session-logs/2026-06-30-S22.md" },
        { status: "??", path: "coordination/reports/2026-07-01-owner-decision-package-manifest-enterprise-runthrough.json" },
        { status: "??", path: "coordination/reports/2026-07-02-owner-response-app-auth-provider-production-selector-enterprise-runthrough.json" },
        { status: "??", path: "coordination/reports/2026-07-02-ordinary-teaching-production-evidence-prerequisite-index-enterprise-runthrough.json" },
        { status: "??", path: "coordination/reports/2026-07-02-ordinary-teaching-production-evidence-preflight-enterprise-runthrough.json" },
        { status: "??", path: "coordination/reports/2026-07-02-ordinary-teaching-production-evidence-preflight-enterprise-runthrough.md" },
        { status: "??", path: "coordination/reports/2026-07-02-ordinary-teaching-production-evidence-gate-enterprise-runthrough.json" },
        { status: "??", path: "coordination/reports/2026-07-02-ordinary-teaching-production-evidence-gate-enterprise-runthrough.md" },
        { status: "??", path: "coordination/reports/2026-07-02-app-auth-production-evidence-preflight-enterprise-runthrough.json" },
        { status: "??", path: "coordination/reports/2026-07-02-app-auth-production-evidence-preflight-enterprise-runthrough.md" },
        { status: "??", path: "coordination/reports/2026-07-02-app-auth-production-evidence-gate-enterprise-runthrough.json" },
        { status: "??", path: "coordination/reports/2026-07-02-app-auth-production-evidence-gate-enterprise-runthrough.md" },
        { status: "??", path: "coordination/reports/2026-07-02-teacher-auth-production-evidence-preflight-enterprise-runthrough.json" },
        { status: "??", path: "coordination/reports/2026-07-02-teacher-auth-production-evidence-preflight-enterprise-runthrough.md" },
        { status: "??", path: "coordination/reports/2026-07-02-teacher-auth-production-evidence-gate-enterprise-runthrough.json" },
        { status: "??", path: "coordination/reports/2026-07-02-teacher-auth-production-evidence-gate-enterprise-runthrough.md" },
        { status: "??", path: "coordination/reports/2026-07-02-teacher-auth-vercel-env-sync-evidence-gate-enterprise-runthrough.json" },
        { status: "??", path: "coordination/reports/2026-07-02-teacher-auth-vercel-env-sync-evidence-gate-enterprise-runthrough.md" },
        { status: "??", path: "coordination/reports/2026-07-02-external-storage-production-evidence-preflight-enterprise-runthrough.json" },
        { status: "??", path: "coordination/reports/2026-07-02-external-storage-production-evidence-preflight-enterprise-runthrough.md" },
        { status: "??", path: "coordination/reports/2026-07-02-external-storage-vercel-env-sync-evidence-gate-enterprise-runthrough.json" },
        { status: "??", path: "coordination/reports/2026-07-02-external-storage-vercel-env-sync-evidence-gate-enterprise-runthrough.md" },
        { status: "??", path: "coordination/reports/2026-07-02-external-storage-production-evidence-gate-enterprise-runthrough.json" },
        { status: "??", path: "coordination/reports/2026-07-02-external-storage-production-evidence-gate-enterprise-runthrough.md" },
        { status: "??", path: "coordination/reports/2026-07-02-vercel-env-deploy-production-evidence-preflight-enterprise-runthrough.json" },
        { status: "??", path: "coordination/reports/2026-07-02-vercel-env-deploy-production-evidence-preflight-enterprise-runthrough.md" },
        { status: "??", path: "coordination/reports/2026-07-02-vercel-env-deploy-production-evidence-gate-enterprise-runthrough.json" },
        { status: "??", path: "coordination/reports/2026-07-02-vercel-env-deploy-production-evidence-gate-enterprise-runthrough.md" },
        { status: "??", path: "coordination/reports/2026-07-02-manual-ppt-playback-acceptance-production-evidence-preflight-enterprise-runthrough.json" },
        { status: "??", path: "coordination/reports/2026-07-02-manual-ppt-playback-acceptance-production-evidence-preflight-enterprise-runthrough.md" },
        { status: "??", path: "coordination/reports/2026-07-02-manual-ppt-playback-acceptance-production-evidence-gate-enterprise-runthrough.json" },
        { status: "??", path: "coordination/reports/2026-07-02-manual-ppt-playback-acceptance-production-evidence-gate-enterprise-runthrough.md" },
        { status: "??", path: "coordination/reports/2026-07-02-enterprise-live-evidence-audit-production-evidence-preflight-enterprise-runthrough.json" },
        { status: "??", path: "coordination/reports/2026-07-02-enterprise-live-evidence-audit-production-evidence-preflight-enterprise-runthrough.md" },
        { status: "??", path: "coordination/reports/2026-07-02-enterprise-live-evidence-audit-production-evidence-gate-enterprise-runthrough.json" },
        { status: "??", path: "coordination/reports/2026-07-02-enterprise-live-evidence-audit-production-evidence-gate-enterprise-runthrough.md" },
        { status: "??", path: "coordination/reports/2026-07-02-production-release-run-production-evidence-preflight-enterprise-runthrough.json" },
        { status: "??", path: "coordination/reports/2026-07-02-production-release-run-production-evidence-preflight-enterprise-runthrough.md" },
        { status: "??", path: "coordination/reports/2026-07-02-production-release-run-production-evidence-gate-enterprise-runthrough.json" },
        { status: "??", path: "coordination/reports/2026-07-02-production-release-run-production-evidence-gate-enterprise-runthrough.md" },
        { status: "??", path: "coordination/reports/2026-07-02-production-evidence-execution-plan-enterprise-runthrough.json" },
        { status: "??", path: "coordination/reports/2026-07-02-production-evidence-execution-plan-enterprise-runthrough.md" },
        { status: "??", path: "coordination/reports/2026-07-02-production-evidence-reuse-audit-enterprise-runthrough.json" },
        { status: "??", path: "coordination/reports/2026-07-02-production-evidence-reuse-audit-enterprise-runthrough.md" },
        { status: "??", path: "coordination/reports/2026-07-02-production-env-source-handoff-enterprise-runthrough.json" },
        { status: "??", path: "coordination/reports/2026-07-02-production-env-source-handoff-enterprise-runthrough.md" },
        { status: "??", path: "coordination/reports/2026-07-02-app-auth-env-source-intake-enterprise-runthrough.json" },
        { status: "??", path: "coordination/reports/2026-07-02-app-auth-env-source-intake-enterprise-runthrough.md" },
        { status: "??", path: "coordination/reports/2026-07-02-teacher-auth-env-source-intake-enterprise-runthrough.json" },
        { status: "??", path: "coordination/reports/2026-07-02-teacher-auth-env-source-intake-enterprise-runthrough.md" },
        { status: "??", path: "coordination/reports/2026-07-02-external-storage-env-source-intake-enterprise-runthrough.json" },
        { status: "??", path: "coordination/reports/2026-07-02-external-storage-env-source-intake-enterprise-runthrough.md" },
        { status: "??", path: "coordination/reports/2026-07-02-app-auth-vercel-env-sync-evidence-gate-enterprise-runthrough.json" },
        { status: "??", path: "coordination/reports/2026-07-02-app-auth-vercel-env-sync-evidence-gate-enterprise-runthrough.md" },
        { status: "??", path: "coordination/release-intake/2026-07-01-production-release-run-response-initial-dirty-map.json" },
        { status: "??", path: "coordination/release-intake/2026-07-01-enterprise-runthrough-package-gate-dirty-map.json" },
        { status: "??", path: "coordination/reports/2026-07-01-enterprise-live-evidence-triage-enterprise-runthrough.json" },
        { status: "??", path: "coordination/reports/2026-07-01-release-blocker-dependency-graph-enterprise-runthrough.json" },
        { status: "??", path: "coordination/reports/2026-07-01-release-blocker-diagnosis-coverage-enterprise-runthrough.json" },
        { status: "??", path: "coordination/reports/2026-07-01-teaching-course-management-live-blocker-diagnosis.md" },
        { status: "??", path: "coordination/reports/2026-07-01-external-storage-service-live-blocker-diagnosis.md" },
        { status: "??", path: "coordination/reports/2026-07-01-enterprise-runthrough-bundle-manifest.json" },
        { status: "??", path: "coordination/reports/2026-07-01-enterprise-runthrough-review-slice-index.json" },
        { status: "??", path: "coordination/reports/2026-07-01-enterprise-runthrough-package-gate.json" },
        { status: "??", path: "coordination/reports/2026-07-01-president-report.docx" },
        { status: "??", path: "coordination/session-logs/2026-07-01-S10.md" },
        { status: "??", path: "coordination/release-intake/2026-07-01-enterprise-runthrough-bundle-manifest-slice.md" },
        { status: "??", path: "coordination/release-intake/2026-07-01-goal-continuation-current-dirty-map.json" },
        { status: "??", path: "coordination/release-intake/2026-07-01-goal-continuation-dependency-graph-coverage-guard-dirty-map.json" },
        { status: "??", path: "scripts/owner-decision-package-manifest.mjs" },
        { status: "??", path: "scripts/ordinary-teaching-production-evidence-prerequisite-index.mjs" },
        { status: "??", path: "scripts/ordinary-teaching-production-evidence-preflight.mjs" },
        { status: "??", path: "scripts/ordinary-teaching-production-evidence-gate.mjs" },
        { status: "??", path: "scripts/app-auth-production-evidence-preflight.mjs" },
        { status: "??", path: "scripts/app-auth-production-evidence-gate.mjs" },
        { status: "??", path: "scripts/teacher-auth-production-evidence-preflight.mjs" },
        { status: "??", path: "scripts/teacher-auth-production-evidence-gate.mjs" },
        { status: "??", path: "scripts/teacher-auth-vercel-env-sync-evidence-gate.mjs" },
        { status: "??", path: "scripts/external-storage-production-evidence-preflight.mjs" },
        { status: "??", path: "scripts/external-storage-vercel-env-sync-evidence-gate.mjs" },
        { status: "??", path: "scripts/external-storage-production-evidence-gate.mjs" },
        { status: "??", path: "scripts/vercel-env-deploy-production-evidence-preflight.mjs" },
        { status: "??", path: "scripts/vercel-env-deploy-production-evidence-gate.mjs" },
        { status: "??", path: "scripts/manual-ppt-playback-acceptance-production-evidence-preflight.mjs" },
        { status: "??", path: "scripts/manual-ppt-playback-acceptance-production-evidence-gate.mjs" },
        { status: "??", path: "scripts/enterprise-live-evidence-audit-production-evidence-preflight.mjs" },
        { status: "??", path: "scripts/enterprise-live-evidence-audit-production-evidence-gate.mjs" },
        { status: "??", path: "scripts/production-release-run-production-evidence-preflight.mjs" },
        { status: "??", path: "scripts/production-release-run-production-evidence-gate.mjs" },
        { status: "??", path: "scripts/production-evidence-execution-plan.mjs" },
        { status: "??", path: "scripts/production-evidence-reuse-audit.mjs" },
        { status: "??", path: "scripts/production-env-source-handoff.mjs" },
        { status: "??", path: "scripts/app-auth-env-source-intake.mjs" },
        { status: "??", path: "scripts/teacher-auth-env-source-intake.mjs" },
        { status: "??", path: "scripts/external-storage-env-source-intake.mjs" },
        { status: "??", path: "scripts/app-auth-vercel-env-sync-evidence-gate.mjs" },
        { status: "??", path: "scripts/enterprise-runthrough-bundle-manifest.mjs" },
        { status: "??", path: "scripts/release-blocker-diagnosis-coverage.mjs" },
        { status: "??", path: "tests/release-blocker-dependency-graph.test.ts" },
        { status: "??", path: "tests/ordinary-teaching-production-evidence-prerequisite-index.test.ts" },
        { status: "??", path: "tests/ordinary-teaching-production-evidence-preflight.test.ts" },
        { status: "??", path: "tests/ordinary-teaching-production-evidence-gate.test.ts" },
        { status: "??", path: "tests/app-auth-production-evidence-preflight.test.ts" },
        { status: "??", path: "tests/app-auth-production-evidence-gate.test.ts" },
        { status: "??", path: "tests/teacher-auth-production-evidence-preflight.test.ts" },
        { status: "??", path: "tests/teacher-auth-production-evidence-gate.test.ts" },
        { status: "??", path: "tests/teacher-auth-vercel-env-sync-evidence-gate.test.ts" },
        { status: "??", path: "tests/external-storage-production-evidence-preflight.test.ts" },
        { status: "??", path: "tests/external-storage-vercel-env-sync-evidence-gate.test.ts" },
        { status: "??", path: "tests/external-storage-production-evidence-gate.test.ts" },
        { status: "??", path: "tests/vercel-env-deploy-production-evidence-preflight.test.ts" },
        { status: "??", path: "tests/vercel-env-deploy-production-evidence-gate.test.ts" },
        { status: "??", path: "tests/manual-ppt-playback-acceptance-production-evidence-preflight.test.ts" },
        { status: "??", path: "tests/manual-ppt-playback-acceptance-production-evidence-gate.test.ts" },
        { status: "??", path: "tests/enterprise-live-evidence-audit-production-evidence-preflight.test.ts" },
        { status: "??", path: "tests/enterprise-live-evidence-audit-production-evidence-gate.test.ts" },
        { status: "??", path: "tests/production-release-run-production-evidence-preflight.test.ts" },
        { status: "??", path: "tests/production-release-run-production-evidence-gate.test.ts" },
        { status: "??", path: "tests/production-evidence-execution-plan.test.ts" },
        { status: "??", path: "tests/production-evidence-reuse-audit.test.ts" },
        { status: "??", path: "tests/production-env-source-handoff.test.ts" },
        { status: "??", path: "tests/app-auth-env-source-intake.test.ts" },
        { status: "??", path: "tests/teacher-auth-env-source-intake.test.ts" },
        { status: "??", path: "tests/external-storage-env-source-intake.test.ts" },
        { status: "??", path: "tests/app-auth-vercel-env-sync-evidence-gate.test.ts" },
        { status: "??", path: "tests/enterprise-runthrough-bundle-manifest.test.ts" },
        { status: "??", path: "tests/release-blocker-diagnosis-coverage.test.ts" },
      ],
      sourcePath: fakePath,
    });
    const bundleManifestPath = writeJson(tmpDir, "bundle.json", {
      target: "enterprise-runthrough-bundle-manifest",
      status: "bundle-manifest-created",
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      summary: {
        artifactCount: 22,
        missingArtifactCount: 0,
        releaseReady: false,
      },
      slices: [
        { id: "owner-decision-package", status: "manifest-created" },
        { id: "enterprise-live-evidence-triage", status: "blocked" },
        { id: "release-blocker-dependency-graph", status: "blocked" },
      ],
    });

    const output = execFileSync("node", [
      "scripts/enterprise-runthrough-review-slice-index.mjs",
      "--dirty-map",
      dirtyMapPath,
      "--bundle-manifest",
      bundleManifestPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "enterprise-runthrough-review-slice-index",
        status: "review-slice-index-created",
        releaseGateStatus: "blocked",
        ownerDecisionQueueStatus: "owner-decisions-required",
        responsibleSession: "S25/S22",
        summary: {
          dirtyEntryCount: 127,
          reviewGroupCount: 11,
          coveredPathCount: 127,
          uncoveredPathCount: 0,
          duplicatePathCount: 0,
          trackedModifiedCount: 1,
          untrackedCount: 126,
          releaseReady: false,
        },
        uncoveredPaths: [],
        duplicatePathAssignments: [],
        safety: {
          sourcePathsOmitted: true,
          rawUrlsOmitted: true,
          secretValuesOmitted: true,
          responseBodiesOmitted: true,
          noGitMutationPerformed: true,
          explicitPathspecsOnly: true,
          noWildcardPathspecs: true,
        },
      }),
    );
    expect(body.reviewGroups).toEqual([
      expect.objectContaining({
        id: "owner-decision-package",
        owner: "S22/S10/S25",
        pathspecs: [
          "coordination/reports/2026-07-01-owner-decision-package-manifest-enterprise-runthrough.json",
          "coordination/reports/2026-07-02-owner-response-app-auth-provider-production-selector-enterprise-runthrough.json",
          "coordination/reports/2026-07-02-ordinary-teaching-production-evidence-prerequisite-index-enterprise-runthrough.json",
          "coordination/reports/2026-07-02-ordinary-teaching-production-evidence-preflight-enterprise-runthrough.json",
          "coordination/reports/2026-07-02-ordinary-teaching-production-evidence-preflight-enterprise-runthrough.md",
          "coordination/reports/2026-07-02-ordinary-teaching-production-evidence-gate-enterprise-runthrough.json",
          "coordination/reports/2026-07-02-ordinary-teaching-production-evidence-gate-enterprise-runthrough.md",
          "coordination/reports/2026-07-02-app-auth-production-evidence-preflight-enterprise-runthrough.json",
          "coordination/reports/2026-07-02-app-auth-production-evidence-preflight-enterprise-runthrough.md",
          "coordination/reports/2026-07-02-app-auth-production-evidence-gate-enterprise-runthrough.json",
          "coordination/reports/2026-07-02-app-auth-production-evidence-gate-enterprise-runthrough.md",
          "coordination/reports/2026-07-02-teacher-auth-production-evidence-preflight-enterprise-runthrough.json",
          "coordination/reports/2026-07-02-teacher-auth-production-evidence-preflight-enterprise-runthrough.md",
          "coordination/reports/2026-07-02-teacher-auth-production-evidence-gate-enterprise-runthrough.json",
          "coordination/reports/2026-07-02-teacher-auth-production-evidence-gate-enterprise-runthrough.md",
          "coordination/reports/2026-07-02-teacher-auth-vercel-env-sync-evidence-gate-enterprise-runthrough.json",
          "coordination/reports/2026-07-02-teacher-auth-vercel-env-sync-evidence-gate-enterprise-runthrough.md",
          "coordination/reports/2026-07-02-external-storage-production-evidence-preflight-enterprise-runthrough.json",
          "coordination/reports/2026-07-02-external-storage-production-evidence-preflight-enterprise-runthrough.md",
          "coordination/reports/2026-07-02-external-storage-vercel-env-sync-evidence-gate-enterprise-runthrough.json",
          "coordination/reports/2026-07-02-external-storage-vercel-env-sync-evidence-gate-enterprise-runthrough.md",
          "coordination/reports/2026-07-02-external-storage-production-evidence-gate-enterprise-runthrough.json",
          "coordination/reports/2026-07-02-external-storage-production-evidence-gate-enterprise-runthrough.md",
          "coordination/reports/2026-07-02-vercel-env-deploy-production-evidence-preflight-enterprise-runthrough.json",
          "coordination/reports/2026-07-02-vercel-env-deploy-production-evidence-preflight-enterprise-runthrough.md",
          "coordination/reports/2026-07-02-vercel-env-deploy-production-evidence-gate-enterprise-runthrough.json",
          "coordination/reports/2026-07-02-vercel-env-deploy-production-evidence-gate-enterprise-runthrough.md",
          "coordination/reports/2026-07-02-manual-ppt-playback-acceptance-production-evidence-preflight-enterprise-runthrough.json",
          "coordination/reports/2026-07-02-manual-ppt-playback-acceptance-production-evidence-preflight-enterprise-runthrough.md",
          "coordination/reports/2026-07-02-manual-ppt-playback-acceptance-production-evidence-gate-enterprise-runthrough.json",
          "coordination/reports/2026-07-02-manual-ppt-playback-acceptance-production-evidence-gate-enterprise-runthrough.md",
          "coordination/reports/2026-07-02-enterprise-live-evidence-audit-production-evidence-preflight-enterprise-runthrough.json",
          "coordination/reports/2026-07-02-enterprise-live-evidence-audit-production-evidence-preflight-enterprise-runthrough.md",
          "coordination/reports/2026-07-02-enterprise-live-evidence-audit-production-evidence-gate-enterprise-runthrough.json",
          "coordination/reports/2026-07-02-enterprise-live-evidence-audit-production-evidence-gate-enterprise-runthrough.md",
          "coordination/reports/2026-07-02-production-release-run-production-evidence-preflight-enterprise-runthrough.json",
          "coordination/reports/2026-07-02-production-release-run-production-evidence-preflight-enterprise-runthrough.md",
          "coordination/reports/2026-07-02-production-release-run-production-evidence-gate-enterprise-runthrough.json",
          "coordination/reports/2026-07-02-production-release-run-production-evidence-gate-enterprise-runthrough.md",
          "coordination/reports/2026-07-02-production-evidence-execution-plan-enterprise-runthrough.json",
          "coordination/reports/2026-07-02-production-evidence-execution-plan-enterprise-runthrough.md",
          "coordination/reports/2026-07-02-production-evidence-reuse-audit-enterprise-runthrough.json",
          "coordination/reports/2026-07-02-production-evidence-reuse-audit-enterprise-runthrough.md",
          "coordination/reports/2026-07-02-production-env-source-handoff-enterprise-runthrough.json",
          "coordination/reports/2026-07-02-production-env-source-handoff-enterprise-runthrough.md",
          "coordination/reports/2026-07-02-app-auth-env-source-intake-enterprise-runthrough.json",
          "coordination/reports/2026-07-02-app-auth-env-source-intake-enterprise-runthrough.md",
          "coordination/reports/2026-07-02-teacher-auth-env-source-intake-enterprise-runthrough.json",
          "coordination/reports/2026-07-02-teacher-auth-env-source-intake-enterprise-runthrough.md",
          "coordination/reports/2026-07-02-external-storage-env-source-intake-enterprise-runthrough.json",
          "coordination/reports/2026-07-02-external-storage-env-source-intake-enterprise-runthrough.md",
          "coordination/reports/2026-07-02-app-auth-vercel-env-sync-evidence-gate-enterprise-runthrough.json",
          "coordination/reports/2026-07-02-app-auth-vercel-env-sync-evidence-gate-enterprise-runthrough.md",
          "scripts/owner-decision-package-manifest.mjs",
          "scripts/ordinary-teaching-production-evidence-prerequisite-index.mjs",
          "scripts/ordinary-teaching-production-evidence-preflight.mjs",
          "scripts/ordinary-teaching-production-evidence-gate.mjs",
          "scripts/app-auth-production-evidence-preflight.mjs",
          "scripts/app-auth-production-evidence-gate.mjs",
          "scripts/teacher-auth-production-evidence-preflight.mjs",
          "scripts/teacher-auth-production-evidence-gate.mjs",
          "scripts/teacher-auth-vercel-env-sync-evidence-gate.mjs",
          "scripts/external-storage-production-evidence-preflight.mjs",
          "scripts/external-storage-vercel-env-sync-evidence-gate.mjs",
          "scripts/external-storage-production-evidence-gate.mjs",
          "scripts/vercel-env-deploy-production-evidence-preflight.mjs",
          "scripts/vercel-env-deploy-production-evidence-gate.mjs",
          "scripts/manual-ppt-playback-acceptance-production-evidence-preflight.mjs",
          "scripts/manual-ppt-playback-acceptance-production-evidence-gate.mjs",
          "scripts/enterprise-live-evidence-audit-production-evidence-preflight.mjs",
          "scripts/enterprise-live-evidence-audit-production-evidence-gate.mjs",
          "scripts/production-release-run-production-evidence-preflight.mjs",
          "scripts/production-release-run-production-evidence-gate.mjs",
          "scripts/production-evidence-execution-plan.mjs",
          "scripts/production-evidence-reuse-audit.mjs",
          "scripts/production-env-source-handoff.mjs",
          "scripts/app-auth-env-source-intake.mjs",
          "scripts/teacher-auth-env-source-intake.mjs",
          "scripts/external-storage-env-source-intake.mjs",
          "scripts/app-auth-vercel-env-sync-evidence-gate.mjs",
          "tests/ordinary-teaching-production-evidence-prerequisite-index.test.ts",
          "tests/ordinary-teaching-production-evidence-preflight.test.ts",
          "tests/ordinary-teaching-production-evidence-gate.test.ts",
          "tests/app-auth-production-evidence-preflight.test.ts",
          "tests/app-auth-production-evidence-gate.test.ts",
          "tests/teacher-auth-production-evidence-preflight.test.ts",
          "tests/teacher-auth-production-evidence-gate.test.ts",
          "tests/teacher-auth-vercel-env-sync-evidence-gate.test.ts",
          "tests/external-storage-production-evidence-preflight.test.ts",
          "tests/external-storage-vercel-env-sync-evidence-gate.test.ts",
          "tests/external-storage-production-evidence-gate.test.ts",
          "tests/vercel-env-deploy-production-evidence-preflight.test.ts",
          "tests/vercel-env-deploy-production-evidence-gate.test.ts",
          "tests/manual-ppt-playback-acceptance-production-evidence-preflight.test.ts",
          "tests/manual-ppt-playback-acceptance-production-evidence-gate.test.ts",
          "tests/enterprise-live-evidence-audit-production-evidence-preflight.test.ts",
          "tests/enterprise-live-evidence-audit-production-evidence-gate.test.ts",
          "tests/production-release-run-production-evidence-preflight.test.ts",
          "tests/production-release-run-production-evidence-gate.test.ts",
          "tests/production-evidence-execution-plan.test.ts",
          "tests/production-evidence-reuse-audit.test.ts",
          "tests/production-env-source-handoff.test.ts",
          "tests/app-auth-env-source-intake.test.ts",
          "tests/teacher-auth-env-source-intake.test.ts",
          "tests/external-storage-env-source-intake.test.ts",
          "tests/app-auth-vercel-env-sync-evidence-gate.test.ts",
        ],
      }),
      expect.objectContaining({
        id: "enterprise-live-evidence-triage",
        pathspecs: [
          "coordination/reports/2026-07-01-enterprise-live-evidence-triage-enterprise-runthrough.json",
        ],
      }),
      expect.objectContaining({
        id: "release-blocker-dependency-graph",
        pathspecs: [
          "coordination/reports/2026-07-01-release-blocker-dependency-graph-enterprise-runthrough.json",
          "tests/release-blocker-dependency-graph.test.ts",
        ],
      }),
      expect.objectContaining({
        id: "release-blocker-diagnosis-coverage",
        pathspecs: [
          "coordination/reports/2026-07-01-release-blocker-diagnosis-coverage-enterprise-runthrough.json",
          "scripts/release-blocker-diagnosis-coverage.mjs",
          "tests/release-blocker-diagnosis-coverage.test.ts",
        ],
      }),
      expect.objectContaining({
        id: "targeted-live-blocker-diagnoses",
        pathspecs: [
          "coordination/reports/2026-07-01-teaching-course-management-live-blocker-diagnosis.md",
          "coordination/reports/2026-07-01-external-storage-service-live-blocker-diagnosis.md",
        ],
      }),
      expect.objectContaining({
        id: "enterprise-runthrough-bundle-manifest",
        pathspecs: [
          "coordination/reports/2026-07-01-enterprise-runthrough-bundle-manifest.json",
          "coordination/release-intake/2026-07-01-enterprise-runthrough-bundle-manifest-slice.md",
          "scripts/enterprise-runthrough-bundle-manifest.mjs",
          "tests/enterprise-runthrough-bundle-manifest.test.ts",
        ],
      }),
      expect.objectContaining({
        id: "enterprise-runthrough-review-slice-index",
        pathspecs: [
          "coordination/reports/2026-07-01-enterprise-runthrough-review-slice-index.json",
        ],
      }),
      expect.objectContaining({
        id: "enterprise-runthrough-package-gate",
        pathspecs: [
          "coordination/reports/2026-07-01-enterprise-runthrough-package-gate.json",
        ],
      }),
      expect.objectContaining({
        id: "release-intake-current-state-probes",
        owner: "S25/S10",
        pathspecs: [
          "coordination/release-intake/2026-07-01-production-release-run-response-initial-dirty-map.json",
          "coordination/release-intake/2026-07-01-enterprise-runthrough-package-gate-dirty-map.json",
          "coordination/release-intake/2026-07-01-goal-continuation-current-dirty-map.json",
          "coordination/release-intake/2026-07-01-goal-continuation-dependency-graph-coverage-guard-dirty-map.json",
        ],
      }),
      expect.objectContaining({
        id: "s10-president-report",
        owner: "S10/S25",
        pathspecs: [
          "coordination/reports/2026-07-01-president-report.docx",
          "coordination/session-logs/2026-07-01-S10.md",
        ],
      }),
      expect.objectContaining({
        id: "s22-session-log",
        pathspecs: ["coordination/session-logs/2026-06-30-S22.md"],
      }),
    ]);
    expect(body.aggregatePathspecs).toEqual([
      "coordination/reports/2026-07-01-owner-decision-package-manifest-enterprise-runthrough.json",
      "coordination/reports/2026-07-02-owner-response-app-auth-provider-production-selector-enterprise-runthrough.json",
      "coordination/reports/2026-07-02-ordinary-teaching-production-evidence-prerequisite-index-enterprise-runthrough.json",
      "coordination/reports/2026-07-02-ordinary-teaching-production-evidence-preflight-enterprise-runthrough.json",
      "coordination/reports/2026-07-02-ordinary-teaching-production-evidence-preflight-enterprise-runthrough.md",
      "coordination/reports/2026-07-02-ordinary-teaching-production-evidence-gate-enterprise-runthrough.json",
      "coordination/reports/2026-07-02-ordinary-teaching-production-evidence-gate-enterprise-runthrough.md",
      "coordination/reports/2026-07-02-app-auth-production-evidence-preflight-enterprise-runthrough.json",
      "coordination/reports/2026-07-02-app-auth-production-evidence-preflight-enterprise-runthrough.md",
      "coordination/reports/2026-07-02-app-auth-production-evidence-gate-enterprise-runthrough.json",
      "coordination/reports/2026-07-02-app-auth-production-evidence-gate-enterprise-runthrough.md",
      "coordination/reports/2026-07-02-teacher-auth-production-evidence-preflight-enterprise-runthrough.json",
      "coordination/reports/2026-07-02-teacher-auth-production-evidence-preflight-enterprise-runthrough.md",
      "coordination/reports/2026-07-02-teacher-auth-production-evidence-gate-enterprise-runthrough.json",
      "coordination/reports/2026-07-02-teacher-auth-production-evidence-gate-enterprise-runthrough.md",
      "coordination/reports/2026-07-02-teacher-auth-vercel-env-sync-evidence-gate-enterprise-runthrough.json",
      "coordination/reports/2026-07-02-teacher-auth-vercel-env-sync-evidence-gate-enterprise-runthrough.md",
      "coordination/reports/2026-07-02-external-storage-production-evidence-preflight-enterprise-runthrough.json",
      "coordination/reports/2026-07-02-external-storage-production-evidence-preflight-enterprise-runthrough.md",
      "coordination/reports/2026-07-02-external-storage-vercel-env-sync-evidence-gate-enterprise-runthrough.json",
      "coordination/reports/2026-07-02-external-storage-vercel-env-sync-evidence-gate-enterprise-runthrough.md",
      "coordination/reports/2026-07-02-external-storage-production-evidence-gate-enterprise-runthrough.json",
      "coordination/reports/2026-07-02-external-storage-production-evidence-gate-enterprise-runthrough.md",
      "coordination/reports/2026-07-02-vercel-env-deploy-production-evidence-preflight-enterprise-runthrough.json",
      "coordination/reports/2026-07-02-vercel-env-deploy-production-evidence-preflight-enterprise-runthrough.md",
      "coordination/reports/2026-07-02-vercel-env-deploy-production-evidence-gate-enterprise-runthrough.json",
      "coordination/reports/2026-07-02-vercel-env-deploy-production-evidence-gate-enterprise-runthrough.md",
      "coordination/reports/2026-07-02-manual-ppt-playback-acceptance-production-evidence-preflight-enterprise-runthrough.json",
      "coordination/reports/2026-07-02-manual-ppt-playback-acceptance-production-evidence-preflight-enterprise-runthrough.md",
      "coordination/reports/2026-07-02-manual-ppt-playback-acceptance-production-evidence-gate-enterprise-runthrough.json",
      "coordination/reports/2026-07-02-manual-ppt-playback-acceptance-production-evidence-gate-enterprise-runthrough.md",
      "coordination/reports/2026-07-02-enterprise-live-evidence-audit-production-evidence-preflight-enterprise-runthrough.json",
      "coordination/reports/2026-07-02-enterprise-live-evidence-audit-production-evidence-preflight-enterprise-runthrough.md",
      "coordination/reports/2026-07-02-enterprise-live-evidence-audit-production-evidence-gate-enterprise-runthrough.json",
      "coordination/reports/2026-07-02-enterprise-live-evidence-audit-production-evidence-gate-enterprise-runthrough.md",
      "coordination/reports/2026-07-02-production-release-run-production-evidence-preflight-enterprise-runthrough.json",
      "coordination/reports/2026-07-02-production-release-run-production-evidence-preflight-enterprise-runthrough.md",
      "coordination/reports/2026-07-02-production-release-run-production-evidence-gate-enterprise-runthrough.json",
      "coordination/reports/2026-07-02-production-release-run-production-evidence-gate-enterprise-runthrough.md",
      "coordination/reports/2026-07-02-production-evidence-execution-plan-enterprise-runthrough.json",
      "coordination/reports/2026-07-02-production-evidence-execution-plan-enterprise-runthrough.md",
      "coordination/reports/2026-07-02-production-evidence-reuse-audit-enterprise-runthrough.json",
      "coordination/reports/2026-07-02-production-evidence-reuse-audit-enterprise-runthrough.md",
      "coordination/reports/2026-07-02-production-env-source-handoff-enterprise-runthrough.json",
      "coordination/reports/2026-07-02-production-env-source-handoff-enterprise-runthrough.md",
      "coordination/reports/2026-07-02-app-auth-env-source-intake-enterprise-runthrough.json",
      "coordination/reports/2026-07-02-app-auth-env-source-intake-enterprise-runthrough.md",
      "coordination/reports/2026-07-02-teacher-auth-env-source-intake-enterprise-runthrough.json",
      "coordination/reports/2026-07-02-teacher-auth-env-source-intake-enterprise-runthrough.md",
      "coordination/reports/2026-07-02-external-storage-env-source-intake-enterprise-runthrough.json",
      "coordination/reports/2026-07-02-external-storage-env-source-intake-enterprise-runthrough.md",
      "coordination/reports/2026-07-02-app-auth-vercel-env-sync-evidence-gate-enterprise-runthrough.json",
      "coordination/reports/2026-07-02-app-auth-vercel-env-sync-evidence-gate-enterprise-runthrough.md",
      "scripts/owner-decision-package-manifest.mjs",
      "scripts/ordinary-teaching-production-evidence-prerequisite-index.mjs",
      "scripts/ordinary-teaching-production-evidence-preflight.mjs",
      "scripts/ordinary-teaching-production-evidence-gate.mjs",
      "scripts/app-auth-production-evidence-preflight.mjs",
      "scripts/app-auth-production-evidence-gate.mjs",
      "scripts/teacher-auth-production-evidence-preflight.mjs",
      "scripts/teacher-auth-production-evidence-gate.mjs",
      "scripts/teacher-auth-vercel-env-sync-evidence-gate.mjs",
      "scripts/external-storage-production-evidence-preflight.mjs",
      "scripts/external-storage-vercel-env-sync-evidence-gate.mjs",
      "scripts/external-storage-production-evidence-gate.mjs",
      "scripts/vercel-env-deploy-production-evidence-preflight.mjs",
      "scripts/vercel-env-deploy-production-evidence-gate.mjs",
      "scripts/manual-ppt-playback-acceptance-production-evidence-preflight.mjs",
      "scripts/manual-ppt-playback-acceptance-production-evidence-gate.mjs",
      "scripts/enterprise-live-evidence-audit-production-evidence-preflight.mjs",
      "scripts/enterprise-live-evidence-audit-production-evidence-gate.mjs",
      "scripts/production-release-run-production-evidence-preflight.mjs",
      "scripts/production-release-run-production-evidence-gate.mjs",
      "scripts/production-evidence-execution-plan.mjs",
      "scripts/production-evidence-reuse-audit.mjs",
      "scripts/production-env-source-handoff.mjs",
      "scripts/app-auth-env-source-intake.mjs",
      "scripts/teacher-auth-env-source-intake.mjs",
      "scripts/external-storage-env-source-intake.mjs",
      "scripts/app-auth-vercel-env-sync-evidence-gate.mjs",
      "tests/ordinary-teaching-production-evidence-prerequisite-index.test.ts",
      "tests/ordinary-teaching-production-evidence-preflight.test.ts",
      "tests/ordinary-teaching-production-evidence-gate.test.ts",
      "tests/app-auth-production-evidence-preflight.test.ts",
      "tests/app-auth-production-evidence-gate.test.ts",
      "tests/teacher-auth-production-evidence-preflight.test.ts",
      "tests/teacher-auth-production-evidence-gate.test.ts",
      "tests/teacher-auth-vercel-env-sync-evidence-gate.test.ts",
      "tests/external-storage-production-evidence-preflight.test.ts",
      "tests/external-storage-vercel-env-sync-evidence-gate.test.ts",
      "tests/external-storage-production-evidence-gate.test.ts",
      "tests/vercel-env-deploy-production-evidence-preflight.test.ts",
      "tests/vercel-env-deploy-production-evidence-gate.test.ts",
      "tests/manual-ppt-playback-acceptance-production-evidence-preflight.test.ts",
      "tests/manual-ppt-playback-acceptance-production-evidence-gate.test.ts",
      "tests/enterprise-live-evidence-audit-production-evidence-preflight.test.ts",
      "tests/enterprise-live-evidence-audit-production-evidence-gate.test.ts",
      "tests/production-release-run-production-evidence-preflight.test.ts",
      "tests/production-release-run-production-evidence-gate.test.ts",
      "tests/production-evidence-execution-plan.test.ts",
      "tests/production-evidence-reuse-audit.test.ts",
      "tests/production-env-source-handoff.test.ts",
      "tests/app-auth-env-source-intake.test.ts",
      "tests/teacher-auth-env-source-intake.test.ts",
      "tests/external-storage-env-source-intake.test.ts",
      "tests/app-auth-vercel-env-sync-evidence-gate.test.ts",
      "coordination/reports/2026-07-01-enterprise-live-evidence-triage-enterprise-runthrough.json",
      "coordination/reports/2026-07-01-release-blocker-dependency-graph-enterprise-runthrough.json",
      "tests/release-blocker-dependency-graph.test.ts",
      "coordination/reports/2026-07-01-release-blocker-diagnosis-coverage-enterprise-runthrough.json",
      "scripts/release-blocker-diagnosis-coverage.mjs",
      "tests/release-blocker-diagnosis-coverage.test.ts",
      "coordination/reports/2026-07-01-teaching-course-management-live-blocker-diagnosis.md",
      "coordination/reports/2026-07-01-external-storage-service-live-blocker-diagnosis.md",
      "coordination/reports/2026-07-01-enterprise-runthrough-bundle-manifest.json",
      "coordination/release-intake/2026-07-01-enterprise-runthrough-bundle-manifest-slice.md",
      "scripts/enterprise-runthrough-bundle-manifest.mjs",
      "tests/enterprise-runthrough-bundle-manifest.test.ts",
      "coordination/reports/2026-07-01-enterprise-runthrough-review-slice-index.json",
      "coordination/reports/2026-07-01-enterprise-runthrough-package-gate.json",
      "coordination/release-intake/2026-07-01-production-release-run-response-initial-dirty-map.json",
      "coordination/release-intake/2026-07-01-enterprise-runthrough-package-gate-dirty-map.json",
      "coordination/release-intake/2026-07-01-goal-continuation-current-dirty-map.json",
      "coordination/release-intake/2026-07-01-goal-continuation-dependency-graph-coverage-guard-dirty-map.json",
      "coordination/reports/2026-07-01-president-report.docx",
      "coordination/session-logs/2026-07-01-S10.md",
      "coordination/session-logs/2026-06-30-S22.md",
    ]);
    expect(body.aggregatePathspecs.every((pathspec: string) => !pathspec.includes("*"))).toBe(true);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain(["", "Users", ""].join("/"));
  });

  it("does not mark the review index release-ready while the owner queue still requires decisions", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-review-slice-index-queue-blocked-"));
    const dirtyMapPath = writeJson(tmpDir, "dirty-map.json", {
      reason: "fixture",
      entries: [
        { status: "??", path: "scripts/enterprise-runthrough-bundle-manifest.mjs" },
      ],
    });
    const bundleManifestPath = writeJson(tmpDir, "bundle.json", {
      target: "enterprise-runthrough-bundle-manifest",
      status: "bundle-manifest-created",
      releaseGateStatus: "ready",
      ownerDecisionQueueStatus: "owner-decisions-required",
      summary: {
        releaseReady: true,
      },
    });

    const output = execFileSync("node", [
      "scripts/enterprise-runthrough-review-slice-index.mjs",
      "--dirty-map",
      dirtyMapPath,
      "--bundle-manifest",
      bundleManifestPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("review-slice-index-created");
    expect(body.ownerDecisionQueueStatus).toBe("owner-decisions-required");
    expect(body.summary.uncoveredPathCount).toBe(0);
    expect(body.summary.duplicatePathCount).toBe(0);
    expect(body.summary.releaseReady).toBe(false);
  });

  it("renders a markdown review index with no wildcard staging command", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-review-slice-index-md-"));
    const dirtyMapPath = writeJson(tmpDir, "dirty-map.json", {
      summary: { totalEntries: 2, byStatus: { "??": 2 } },
      entries: [
        { status: "??", path: "scripts/enterprise-live-evidence-triage.mjs" },
        { status: "??", path: "coordination/release-intake/2026-07-01-enterprise-live-evidence-triage-slice.md" },
      ],
    });
    const bundleManifestPath = writeJson(tmpDir, "bundle.json", {
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      summary: { releaseReady: false },
      slices: [],
    });

    const output = execFileSync("node", [
      "scripts/enterprise-runthrough-review-slice-index.mjs",
      "--dirty-map",
      dirtyMapPath,
      "--bundle-manifest",
      bundleManifestPath,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("# UAIS Enterprise Runthrough Review Slice Index");
    expect(output).toContain("Release gate: `blocked`");
    expect(output).toContain("## Review Groups");
    expect(output).toContain("`enterprise-live-evidence-triage`");
    expect(output).toContain("## Aggregate Explicit Pathspecs");
    expect(output).toContain("scripts/enterprise-live-evidence-triage.mjs");
    expect(output).not.toContain("git add .");
    expect(output).not.toContain("*");
    expect(output).not.toContain(tmpDir);
  });

  it("writes aggregate pathspecs to a staging-safe pathspec file", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-review-slice-pathspecs-"));
    const dirtyMapPath = writeJson(tmpDir, "dirty-map.json", {
      reason: "fixture",
      entries: [
        { status: "??", path: "scripts/enterprise-runthrough-review-slice-index.mjs" },
        { status: "??", path: "tests/enterprise-runthrough-review-slice-index.test.ts" },
      ],
    });
    const bundleManifestPath = writeJson(tmpDir, "bundle.json", {
      target: "enterprise-runthrough-bundle-manifest",
      status: "bundle-manifest-created",
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      summary: { releaseReady: false },
    });
    const pathspecsPath = join(tmpDir, "pathspecs.txt");

    const output = execFileSync("node", [
      "scripts/enterprise-runthrough-review-slice-index.mjs",
      "--dirty-map",
      dirtyMapPath,
      "--bundle-manifest",
      bundleManifestPath,
      "--pathspecs-out",
      pathspecsPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("review-slice-index-created");
    expect(readFileSync(pathspecsPath, "utf8")).toBe(
      [
        "scripts/enterprise-runthrough-review-slice-index.mjs",
        "tests/enterprise-runthrough-review-slice-index.test.ts",
        "",
      ].join("\n"),
    );
  });
});

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}
