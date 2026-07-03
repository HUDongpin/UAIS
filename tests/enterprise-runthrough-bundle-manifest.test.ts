import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("enterprise runthrough bundle manifest", () => {
  it("fingerprints the release evidence bundle without exposing source paths or file contents", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-enterprise-bundle-manifest-"));
    const reportsDir = join(tmpDir, "reports");
    const scriptsDir = join(tmpDir, "scripts");
    const testsDir = join(tmpDir, "tests");
    const intakeDir = join(tmpDir, "release-intake");
    mkdirSync(reportsDir);
    mkdirSync(scriptsDir);
    mkdirSync(testsDir);
    mkdirSync(intakeDir);

    const fakeLocalPath = [
      "",
      "Users",
      "example",
      "private",
      "owner-package.json",
    ].join("/");
    const fakeUrl = ["https://", "private-production.example.test", "/evidence"].join("");

    const ownerManifest = writeText(
      reportsDir,
      "2026-07-01-owner-decision-package-manifest-enterprise-runthrough.json",
      JSON.stringify({
        target: "owner-decision-package-manifest",
        status: "manifest-created",
        releaseGateStatus: "blocked",
        ownerDecisionQueueStatus: "owner-decisions-required",
        packetIndexStatus: "complete-action-packet-chain",
        summary: {
          artifactCount: 20,
          missingArtifactCount: 0,
          packetSafetyAttentionCount: 0,
          releaseReady: false,
        },
        sourcePath: fakeLocalPath,
      }),
    );
    const ownerManifestMd = writeText(
      reportsDir,
      "2026-07-01-owner-decision-package-manifest-enterprise-runthrough.md",
      `private ${fakeUrl}\n`,
    );
    const triage = writeText(
      reportsDir,
      "2026-07-01-enterprise-live-evidence-triage-enterprise-runthrough.json",
      JSON.stringify({
        target: "enterprise-live-evidence-triage",
        status: "blocked",
        releaseGateStatus: "blocked",
        summary: {
          totalTargets: 16,
          acceptedTargets: 0,
          missingRequiredTargets: 16,
        },
        executionWaves: [
          { id: "provider-and-env-decisions" },
          { id: "workflow-and-ordinary-teaching-smokes" },
        ],
      }),
    );
    const graph = writeText(
      reportsDir,
      "2026-07-01-release-blocker-dependency-graph-enterprise-runthrough.json",
      JSON.stringify({
        target: "release-blocker-dependency-graph",
        status: "blocked",
        releaseGateStatus: "blocked",
        ownerDecisionQueueStatus: "owner-decisions-required",
        summary: {
          blockedRequirementCount: 19,
          mappedBlockedRequirementCount: 19,
          unmappedBlockedRequirementCount: 0,
          ownerDecisionCount: 8,
          executionWaveCount: 5,
          liveEvidenceTargetCount: 16,
          releaseReady: false,
        },
      }),
    );
    const graphMd = writeText(
      reportsDir,
      "2026-07-01-release-blocker-dependency-graph-enterprise-runthrough.md",
      "dependency graph markdown\n",
    );
    const bundleScript = writeText(
      scriptsDir,
      "enterprise-runthrough-bundle-manifest.mjs",
      "script content\n",
    );
    const bundleTest = writeText(
      testsDir,
      "enterprise-runthrough-bundle-manifest.test.ts",
      "test content\n",
    );
    const intakeNote = writeText(
      intakeDir,
      "2026-07-01-release-blocker-dependency-graph-slice.md",
      "intake note\n",
    );

    const output = execFileSync("node", [
      "scripts/enterprise-runthrough-bundle-manifest.mjs",
      "--owner-package-manifest",
      ownerManifest,
      "--enterprise-live-evidence-triage",
      triage,
      "--release-blocker-dependency-graph",
      graph,
      "--include",
      bundleScript,
      "--include",
      bundleTest,
      "--include",
      intakeNote,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "enterprise-runthrough-bundle-manifest",
        status: "bundle-manifest-created",
        releaseGateStatus: "blocked",
        ownerDecisionQueueStatus: "owner-decisions-required",
        responsibleSession: "S22",
        summary: {
          sliceCount: 3,
          artifactCount: 8,
          missingArtifactCount: 0,
          ownerPackageArtifactCount: 20,
          ownerPackageSafetyAttentionCount: 0,
          triageTotalTargets: 16,
          triageAcceptedTargets: 0,
          dependencyGraphMappedRequirements: 19,
          dependencyGraphTotalRequirements: 19,
          needsOwnerInput: true,
          productionEvidenceRequired: false,
          releaseReady: false,
        },
        missingArtifacts: [],
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
      }),
    );
    expect(body.slices).toEqual([
      expect.objectContaining({
        id: "owner-decision-package",
        status: "manifest-created",
        packetIndexStatus: "complete-action-packet-chain",
        releaseReady: false,
        artifactCount: 20,
        missingArtifactCount: 0,
        packetSafetyAttentionCount: 0,
      }),
      expect.objectContaining({
        id: "enterprise-live-evidence-triage",
        status: "blocked",
        totalTargets: 16,
        acceptedTargets: 0,
        executionWaveCount: 2,
      }),
      expect.objectContaining({
        id: "release-blocker-dependency-graph",
        status: "blocked",
        mappedBlockedRequirementCount: 19,
        blockedRequirementCount: 19,
        releaseReady: false,
      }),
    ]);
    expect(body.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "owner-package-manifest-json",
          fileName: "2026-07-01-owner-decision-package-manifest-enterprise-runthrough.json",
          sha256: sha256(ownerManifest),
        }),
        expect.objectContaining({
          role: "owner-package-manifest-markdown",
          fileName: "2026-07-01-owner-decision-package-manifest-enterprise-runthrough.md",
          sha256: sha256(ownerManifestMd),
        }),
        expect.objectContaining({
          role: "enterprise-live-evidence-triage-json",
          fileName: "2026-07-01-enterprise-live-evidence-triage-enterprise-runthrough.json",
          sha256: sha256(triage),
        }),
        expect.objectContaining({
          role: "release-blocker-dependency-graph-json",
          fileName: "2026-07-01-release-blocker-dependency-graph-enterprise-runthrough.json",
          sha256: sha256(graph),
        }),
        expect.objectContaining({
          role: "release-blocker-dependency-graph-markdown",
          fileName: "2026-07-01-release-blocker-dependency-graph-enterprise-runthrough.md",
          sha256: sha256(graphMd),
        }),
        expect.objectContaining({
          role: "bundle-include",
          fileName: "enterprise-runthrough-bundle-manifest.mjs",
          sha256: sha256(bundleScript),
        }),
        expect.objectContaining({
          role: "bundle-include",
          fileName: "enterprise-runthrough-bundle-manifest.test.ts",
          sha256: sha256(bundleTest),
        }),
        expect.objectContaining({
          role: "bundle-include",
          fileName: "2026-07-01-release-blocker-dependency-graph-slice.md",
          sha256: sha256(intakeNote),
        }),
      ]),
    );
    expect(body.artifacts.every((artifact: { sha256: string }) => /^sha256:[a-f0-9]{64}$/.test(artifact.sha256))).toBe(true);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain(["", "Users", ""].join("/"));
    expect(output).not.toContain(fakeUrl);
  });

  it("propagates owner-package safety review into the aggregate bundle status", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-enterprise-bundle-manifest-safety-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const ownerManifest = writeText(
      reportsDir,
      "owner.json",
      JSON.stringify({
        status: "manifest-needs-safety-review",
        releaseGateStatus: "blocked",
        ownerDecisionQueueStatus: "owner-decisions-required",
        packetIndexStatus: "action-packet-chain-needs-safety-review",
        summary: {
          artifactCount: 2,
          missingArtifactCount: 0,
          packetSafetyAttentionCount: 2,
          releaseReady: false,
        },
      }),
    );
    const triage = writeText(
      reportsDir,
      "triage.json",
      JSON.stringify({
        status: "blocked",
        summary: {
          totalTargets: 16,
          acceptedTargets: 0,
          missingRequiredTargets: 16,
        },
        executionWaves: [],
      }),
    );
    const graph = writeText(
      reportsDir,
      "graph.json",
      JSON.stringify({
        status: "blocked",
        releaseGateStatus: "blocked",
        summary: {
          blockedRequirementCount: 19,
          mappedBlockedRequirementCount: 19,
          releaseReady: false,
        },
      }),
    );

    const output = execFileSync("node", [
      "scripts/enterprise-runthrough-bundle-manifest.mjs",
      "--owner-package-manifest",
      ownerManifest,
      "--enterprise-live-evidence-triage",
      triage,
      "--release-blocker-dependency-graph",
      graph,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("bundle-manifest-needs-safety-review");
    expect(body.summary.ownerPackageSafetyAttentionCount).toBe(2);
    expect(body.slices[0]).toEqual(
      expect.objectContaining({
        id: "owner-decision-package",
        status: "manifest-needs-safety-review",
        packetIndexStatus: "action-packet-chain-needs-safety-review",
        packetSafetyAttentionCount: 2,
      }),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain(["", "Users", ""].join("/"));
  });

  it("does not mark the aggregate bundle release-ready when one source is ready but live triage and blocker graph remain blocked", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-enterprise-bundle-manifest-ready-mismatch-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const ownerManifest = writeText(
      reportsDir,
      "owner.json",
      JSON.stringify({
        status: "manifest-created",
        releaseGateStatus: "blocked",
        ownerDecisionQueueStatus: "owner-decisions-required",
        packetIndexStatus: "complete-action-packet-chain",
        summary: {
          artifactCount: 20,
          missingArtifactCount: 0,
          packetSafetyAttentionCount: 0,
          releaseReady: true,
        },
      }),
    );
    const triage = writeText(
      reportsDir,
      "triage.json",
      JSON.stringify({
        status: "blocked",
        releaseGateStatus: "blocked",
        summary: {
          totalTargets: 16,
          acceptedTargets: 0,
          missingRequiredTargets: 16,
        },
        executionWaves: [],
      }),
    );
    const graph = writeText(
      reportsDir,
      "graph.json",
      JSON.stringify({
        status: "blocked",
        releaseGateStatus: "blocked",
        ownerDecisionQueueStatus: "owner-decisions-required",
        summary: {
          blockedRequirementCount: 19,
          mappedBlockedRequirementCount: 19,
          unmappedBlockedRequirementCount: 0,
          releaseReady: false,
        },
      }),
    );

    const output = execFileSync("node", [
      "scripts/enterprise-runthrough-bundle-manifest.mjs",
      "--owner-package-manifest",
      ownerManifest,
      "--enterprise-live-evidence-triage",
      triage,
      "--release-blocker-dependency-graph",
      graph,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("bundle-manifest-created");
    expect(body.slices[0]).toEqual(
      expect.objectContaining({
        id: "owner-decision-package",
        releaseReady: true,
      }),
    );
    expect(body.slices[2]).toEqual(
      expect.objectContaining({
        id: "release-blocker-dependency-graph",
        status: "blocked",
        releaseReady: false,
      }),
    );
    expect(body.summary.releaseReady).toBe(false);
  });

  it("does not mark the aggregate bundle release-ready while the owner queue still requires decisions", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-enterprise-bundle-manifest-queue-blocked-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const ownerManifest = writeText(
      reportsDir,
      "owner.json",
      JSON.stringify({
        status: "manifest-created",
        releaseGateStatus: "ready",
        ownerDecisionQueueStatus: "owner-decisions-required",
        packetIndexStatus: "complete-action-packet-chain",
        summary: {
          artifactCount: 20,
          missingArtifactCount: 0,
          packetSafetyAttentionCount: 0,
          releaseReady: true,
        },
      }),
    );
    const triage = writeText(
      reportsDir,
      "triage.json",
      JSON.stringify({
        status: "ready",
        releaseGateStatus: "ready",
        summary: {
          totalTargets: 1,
          acceptedTargets: 1,
          missingRequiredTargets: 0,
        },
        executionWaves: [],
      }),
    );
    const graph = writeText(
      reportsDir,
      "graph.json",
      JSON.stringify({
        status: "ready",
        releaseGateStatus: "ready",
        ownerDecisionQueueStatus: "owner-decisions-required",
        summary: {
          blockedRequirementCount: 1,
          mappedBlockedRequirementCount: 1,
          unmappedBlockedRequirementCount: 0,
          releaseReady: true,
        },
      }),
    );

    const output = execFileSync("node", [
      "scripts/enterprise-runthrough-bundle-manifest.mjs",
      "--owner-package-manifest",
      ownerManifest,
      "--enterprise-live-evidence-triage",
      triage,
      "--release-blocker-dependency-graph",
      graph,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.ownerDecisionQueueStatus).toBe("owner-decisions-required");
    expect(body.summary.missingArtifactCount).toBe(0);
    expect(body.summary.triageAcceptedTargets).toBe(body.summary.triageTotalTargets);
    expect(body.summary.releaseReady).toBe(false);
  });

  it("uses the owner-response gap matrix as the current owner queue while preserving the source queue", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-enterprise-bundle-manifest-gap-matrix-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const ownerManifest = writeText(
      reportsDir,
      "owner.json",
      JSON.stringify({
        status: "manifest-created",
        releaseGateStatus: "blocked",
        ownerDecisionQueueStatus: "owner-decisions-required",
        packetIndexStatus: "complete-action-packet-chain",
        summary: {
          artifactCount: 20,
          missingArtifactCount: 0,
          packetSafetyAttentionCount: 0,
          releaseReady: false,
        },
      }),
    );
    const triage = writeText(
      reportsDir,
      "triage.json",
      JSON.stringify({
        status: "blocked",
        releaseGateStatus: "blocked",
        summary: {
          totalTargets: 16,
          acceptedTargets: 0,
          missingRequiredTargets: 16,
        },
        executionWaves: [],
      }),
    );
    const graph = writeText(
      reportsDir,
      "graph.json",
      JSON.stringify({
        status: "blocked",
        releaseGateStatus: "blocked",
        ownerDecisionQueueStatus: "owner-decisions-required",
        summary: {
          blockedRequirementCount: 19,
          mappedBlockedRequirementCount: 19,
          unmappedBlockedRequirementCount: 0,
          releaseReady: false,
        },
      }),
    );
    const gapMatrix = writeText(
      reportsDir,
      "gap-matrix.json",
      JSON.stringify({
        target: "owner-decision-response-gap-matrix",
        ownerDecisionQueueStatus: "owner-decisions-cleared-awaiting-production-evidence",
        sourceOwnerDecisionQueueStatus: "owner-decisions-required",
        summary: {
          needsOwnerInput: false,
          productionEvidenceRequired: true,
          releaseReady: false,
        },
      }),
    );

    const output = execFileSync("node", [
      "scripts/enterprise-runthrough-bundle-manifest.mjs",
      "--owner-package-manifest",
      ownerManifest,
      "--enterprise-live-evidence-triage",
      triage,
      "--release-blocker-dependency-graph",
      graph,
      "--owner-response-gap-matrix",
      gapMatrix,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.ownerDecisionQueueStatus).toBe(
      "owner-decisions-cleared-awaiting-production-evidence",
    );
    expect(body.sourceOwnerDecisionQueueStatus).toBe("owner-decisions-required");
    expect(body.summary.needsOwnerInput).toBe(false);
    expect(body.summary.productionEvidenceRequired).toBe(true);
    expect(body.summary.releaseReady).toBe(false);
    expect(output).not.toContain(tmpDir);
  });

  it("renders a markdown bundle manifest for release intake", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-enterprise-bundle-manifest-md-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const ownerManifest = writeText(
      reportsDir,
      "owner.json",
      JSON.stringify({
        status: "manifest-created",
        releaseGateStatus: "blocked",
        ownerDecisionQueueStatus: "owner-decisions-required",
        summary: {
          artifactCount: 1,
          missingArtifactCount: 0,
          releaseReady: false,
        },
      }),
    );
    const triage = writeText(
      reportsDir,
      "triage.json",
      JSON.stringify({
        status: "blocked",
        summary: { totalTargets: 16, acceptedTargets: 0 },
        executionWaves: [],
      }),
    );
    const graph = writeText(
      reportsDir,
      "graph.json",
      JSON.stringify({
        status: "blocked",
        summary: {
          blockedRequirementCount: 19,
          mappedBlockedRequirementCount: 19,
          releaseReady: false,
        },
      }),
    );

    const output = execFileSync("node", [
      "scripts/enterprise-runthrough-bundle-manifest.mjs",
      "--owner-package-manifest",
      ownerManifest,
      "--enterprise-live-evidence-triage",
      triage,
      "--release-blocker-dependency-graph",
      graph,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("# UAIS Enterprise Runthrough Bundle Manifest");
    expect(output).toContain("Release gate: `blocked`");
    expect(output).toContain("Release ready: `false`");
    expect(output).toContain("## Slice Summary");
    expect(output).toContain("`enterprise-live-evidence-triage`");
    expect(output).toContain("## Artifact Fingerprints");
    expect(output).toContain("| owner-package-manifest-json |");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain(["", "Users", ""].join("/"));
  });
});

function writeText(dir: string, filename: string, body: string) {
  const filePath = join(dir, filename);
  writeFileSync(filePath, body);
  return filePath;
}

function sha256(filePath: string) {
  const output = execFileSync("shasum", ["-a", "256", filePath], {
    encoding: "utf8",
  });
  return `sha256:${output.split(/\s+/)[0]}`;
}
