import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("owner decision package manifest", () => {
  it("fingerprints packet artifacts without exposing source paths or file contents", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-package-manifest-"));
    const reportsDir = join(tmpDir, "reports");
    const intakeDir = join(tmpDir, "release-intake");
    mkdirSync(reportsDir);
    mkdirSync(intakeDir);

    const appPacket = writeText(
      reportsDir,
      "2026-07-01-app-auth-owner-action-packet-enterprise-runthrough.json",
      JSON.stringify({
        decisionId: "app-auth-provider-production-selector",
        leakedPath: "/Users/example/private/app-auth.json",
        leakedUrl: "https://private-production.example.test/app-auth",
      }),
    );
    const appPacketMd = writeText(
      reportsDir,
      "2026-07-01-app-auth-owner-action-packet-enterprise-runthrough.md",
      "private url https://private-production.example.test/app-auth\n",
    );
    const finalPacket = writeText(
      reportsDir,
      "2026-07-01-production-release-run-action-packet-enterprise-runthrough.json",
      JSON.stringify({
        decisionId: "production-release-run",
        leakedCookie: "uais_teacher_auth_claims=secret",
      }),
    );
    const dirtyMap = writeText(
      intakeDir,
      "2026-07-01-owner-decision-packet-index-dirty-map.json",
      JSON.stringify({ leakedPath: "/Users/example/private/dirty-map.json" }),
    );
    const packetIndex = writeText(
      reportsDir,
      "2026-07-01-owner-decision-action-packet-index-enterprise-runthrough.json",
      JSON.stringify({
        target: "owner-decision-action-packet-index",
        status: "complete-action-packet-chain",
        releaseGateStatus: "blocked",
        ownerDecisionQueueStatus: "owner-decisions-required",
        summary: {
          queueItemCount: 2,
          actionPacketCount: 2,
          matchedPacketCount: 2,
          missingPacketCount: 0,
          extraPacketCount: 0,
          acceptedLiveEvidence: 0,
          missingEnterpriseLiveTargetCount: 2,
          releaseReady: false,
        },
        packets: [
          {
            rank: 1,
            decisionId: "app-auth-provider-production-selector",
            actionPacketFileName: "2026-07-01-app-auth-owner-action-packet-enterprise-runthrough.json",
            markdownPacketFileName: "2026-07-01-app-auth-owner-action-packet-enterprise-runthrough.md",
          },
          {
            rank: 2,
            decisionId: "production-release-run",
            actionPacketFileName: "2026-07-01-production-release-run-action-packet-enterprise-runthrough.json",
            markdownPacketFileName: null,
          },
        ],
      }),
    );
    const packetIndexMd = writeText(
      reportsDir,
      "2026-07-01-owner-decision-action-packet-index-enterprise-runthrough.md",
      "index markdown\n",
    );

    const output = execFileSync("node", [
      "scripts/owner-decision-package-manifest.mjs",
      "--packet-index",
      packetIndex,
      "--reports-dir",
      reportsDir,
      "--include",
      dirtyMap,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "owner-decision-package-manifest",
        status: "manifest-created",
        releaseGateStatus: "blocked",
        ownerDecisionQueueStatus: "owner-decisions-required",
        packetIndexStatus: "complete-action-packet-chain",
        sourceIndexFileName: "2026-07-01-owner-decision-action-packet-index-enterprise-runthrough.json",
        summary: {
          queueItemCount: 2,
          indexedPacketCount: 2,
          artifactCount: 6,
          missingArtifactCount: 0,
          includedArtifactCount: 1,
          packetSafetyAttentionCount: 0,
          releaseReady: false,
        },
        missingArtifacts: [],
        safety: {
          sourcePathsOmitted: true,
          rawUrlsOmitted: true,
          secretValuesOmitted: true,
          responseBodiesOmitted: true,
          noLiveMutationPerformed: true,
          noDeploymentMutationPerformed: true,
          noReleaseRunBindingPerformed: true,
          fileContentsOmitted: true,
        },
      }),
    );
    expect(body.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "packet-index-json",
          fileName: "2026-07-01-owner-decision-action-packet-index-enterprise-runthrough.json",
          sha256: sha256(packetIndex),
        }),
        expect.objectContaining({
          role: "packet-index-markdown",
          fileName: "2026-07-01-owner-decision-action-packet-index-enterprise-runthrough.md",
          sha256: sha256(packetIndexMd),
        }),
        expect.objectContaining({
          role: "action-packet-json",
          decisionId: "app-auth-provider-production-selector",
          rank: 1,
          fileName: "2026-07-01-app-auth-owner-action-packet-enterprise-runthrough.json",
          sha256: sha256(appPacket),
        }),
        expect.objectContaining({
          role: "action-packet-markdown",
          decisionId: "app-auth-provider-production-selector",
          rank: 1,
          fileName: "2026-07-01-app-auth-owner-action-packet-enterprise-runthrough.md",
          sha256: sha256(appPacketMd),
        }),
        expect.objectContaining({
          role: "release-intake-include",
          fileName: "2026-07-01-owner-decision-packet-index-dirty-map.json",
          sha256: sha256(dirtyMap),
        }),
        expect.objectContaining({
          role: "action-packet-json",
          decisionId: "production-release-run",
          rank: 2,
          fileName: "2026-07-01-production-release-run-action-packet-enterprise-runthrough.json",
          sha256: sha256(finalPacket),
        }),
      ]),
    );
    expect(body.artifacts.every((artifact: { sha256: string }) => /^sha256:[a-f0-9]{64}$/.test(artifact.sha256))).toBe(true);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://private-production.example.test");
    expect(output).not.toContain("uais_teacher_auth_claims=secret");
  });

  it("propagates packet-index safety review status into the manifest", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-package-manifest-safety-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const packetIndex = writeText(
      reportsDir,
      "2026-07-01-owner-decision-action-packet-index-enterprise-runthrough.json",
      JSON.stringify({
        target: "owner-decision-action-packet-index",
        status: "action-packet-chain-needs-safety-review",
        releaseGateStatus: "blocked",
        ownerDecisionQueueStatus: "owner-decisions-required",
        summary: {
          queueItemCount: 1,
          packetSafetyAttentionCount: 1,
          releaseReady: false,
        },
        packets: [
          {
            rank: 1,
            decisionId: "app-auth-provider-production-selector",
            actionPacketFileName: "2026-07-01-app-auth-owner-action-packet-enterprise-runthrough.json",
            markdownPacketFileName: null,
          },
        ],
      }),
    );
    writeText(
      reportsDir,
      "2026-07-01-app-auth-owner-action-packet-enterprise-runthrough.json",
      JSON.stringify({ decisionId: "app-auth-provider-production-selector" }),
    );

    const output = execFileSync("node", [
      "scripts/owner-decision-package-manifest.mjs",
      "--packet-index",
      packetIndex,
      "--reports-dir",
      reportsDir,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("manifest-needs-safety-review");
    expect(body.packetIndexStatus).toBe("action-packet-chain-needs-safety-review");
    expect(body.summary.packetSafetyAttentionCount).toBe(1);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("does not mark the package manifest release-ready when packet artifacts are missing", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-package-manifest-ready-missing-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const packetIndex = writeText(
      reportsDir,
      "2026-07-01-owner-decision-action-packet-index-enterprise-runthrough.json",
      JSON.stringify({
        target: "owner-decision-action-packet-index",
        status: "complete-action-packet-chain",
        releaseGateStatus: "ready",
        ownerDecisionQueueStatus: "satisfied",
        summary: {
          queueItemCount: 1,
          actionPacketCount: 1,
          matchedPacketCount: 1,
          missingPacketCount: 0,
          extraPacketCount: 0,
          packetSafetyAttentionCount: 0,
          acceptedLiveEvidence: 16,
          missingEnterpriseLiveTargetCount: 0,
          releaseReady: true,
        },
        packets: [
          {
            rank: 1,
            decisionId: "app-auth-provider-production-selector",
            actionPacketFileName: "2026-07-01-app-auth-owner-action-packet-enterprise-runthrough.json",
            markdownPacketFileName: null,
          },
        ],
      }),
    );

    const output = execFileSync("node", [
      "scripts/owner-decision-package-manifest.mjs",
      "--packet-index",
      packetIndex,
      "--reports-dir",
      reportsDir,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("manifest-incomplete");
    expect(body.summary.missingArtifactCount).toBe(1);
    expect(body.summary.releaseReady).toBe(false);
  });

  it("keeps releaseReady false while owner decisions are still required", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-package-manifest-owner-queue-guard-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const packetIndex = writeText(
      reportsDir,
      "2026-07-01-owner-decision-action-packet-index-enterprise-runthrough.json",
      JSON.stringify({
        target: "owner-decision-action-packet-index",
        status: "complete-action-packet-chain",
        releaseGateStatus: "ready",
        ownerDecisionQueueStatus: "owner-decisions-required",
        summary: {
          queueItemCount: 1,
          actionPacketCount: 1,
          matchedPacketCount: 1,
          missingPacketCount: 0,
          extraPacketCount: 0,
          packetSafetyAttentionCount: 0,
          acceptedLiveEvidence: 16,
          missingEnterpriseLiveTargetCount: 0,
          releaseReady: true,
        },
        packets: [
          {
            rank: 1,
            decisionId: "app-auth-provider-production-selector",
            actionPacketFileName: "2026-07-01-app-auth-owner-action-packet-enterprise-runthrough.json",
            markdownPacketFileName: null,
          },
        ],
      }),
    );
    writeText(
      reportsDir,
      "2026-07-01-app-auth-owner-action-packet-enterprise-runthrough.json",
      JSON.stringify({ decisionId: "app-auth-provider-production-selector" }),
    );

    const output = execFileSync("node", [
      "scripts/owner-decision-package-manifest.mjs",
      "--packet-index",
      packetIndex,
      "--reports-dir",
      reportsDir,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("manifest-created");
    expect(body.ownerDecisionQueueStatus).toBe("owner-decisions-required");
    expect(body.summary.releaseReady).toBe(false);
  });

  it("renders a markdown manifest for release intake handoff", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-package-manifest-md-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const packetIndex = writeText(
      reportsDir,
      "2026-07-01-owner-decision-action-packet-index-enterprise-runthrough.json",
      JSON.stringify({
        releaseGateStatus: "blocked",
        ownerDecisionQueueStatus: "owner-decisions-required",
        summary: {
          queueItemCount: 1,
          releaseReady: false,
        },
        packets: [
          {
            rank: 1,
            decisionId: "manual-ppt-playback-acceptance",
            actionPacketFileName: "2026-07-01-manual-ppt-playback-acceptance-action-packet-enterprise-runthrough.json",
            markdownPacketFileName: null,
          },
        ],
      }),
    );
    writeText(
      reportsDir,
      "2026-07-01-manual-ppt-playback-acceptance-action-packet-enterprise-runthrough.json",
      JSON.stringify({ decisionId: "manual-ppt-playback-acceptance" }),
    );

    const output = execFileSync("node", [
      "scripts/owner-decision-package-manifest.mjs",
      "--packet-index",
      packetIndex,
      "--reports-dir",
      reportsDir,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("# UAIS Owner Decision Package Manifest");
    expect(output).toContain("Release gate: `blocked`");
    expect(output).toContain("Release ready: `false`");
    expect(output).toContain("| packet-index-json |");
    expect(output).toContain("| action-packet-json | `manual-ppt-playback-acceptance` |");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
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
