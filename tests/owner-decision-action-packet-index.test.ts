import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("owner decision action packet index", () => {
  it("indexes queued action packets without exposing source paths or live evidence details", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-packet-index-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      target: "production-owner-decision-queue",
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      queue: [
        queueItem({
          id: "app-auth-provider-production-selector",
          rank: 1,
          category: "owner-decision",
          status: "owner-decision-needed",
        }),
        queueItem({
          id: "vercel-env-deploy-and-smoke-chain",
          rank: 2,
          category: "env-deploy-chain",
          status: "waiting-for-upstream-owner-decisions",
        }),
        queueItem({
          id: "production-release-run",
          rank: 3,
          category: "final-release-binding",
          status: "waiting-for-upstream-evidence",
        }),
      ],
      leakedPath: "/Users/example/private/queue.json",
      leakedUrl: "https://private-production.example.test/queue",
    });
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "blocked",
      requirements: [
        { id: "app-auth-provider-readiness", status: "blocked" },
      ],
    });
    const enterpriseAudit = writeJson(tmpDir, "enterprise-audit.json", {
      target: "enterprise-live-evidence-audit",
      status: "blocked",
      summary: {
        acceptedLiveEvidence: 0,
        missingRequiredTargetCount: 3,
      },
      leakedCookie: "uais_teacher_auth_claims=secret",
    });
    writeJson(
      reportsDir,
      "2026-07-01-app-auth-owner-action-packet-enterprise-runthrough.json",
      packet({
        decisionId: "app-auth-provider-production-selector",
        queueRank: 1,
        status: "owner-decision-needed",
        classification: "owner-env-live-evidence-blocked",
      }),
    );
    writeJson(
      reportsDir,
      "2026-07-01-vercel-env-deploy-chain-action-packet-enterprise-runthrough.json",
      packet({
        decisionId: "vercel-env-deploy-and-smoke-chain",
        queueRank: 2,
        status: "waiting-for-upstream-owner-decisions",
        classification: "upstream-owner-decisions-env-deploy-smoke-blocked",
      }),
    );
    writeJson(
      reportsDir,
      "2026-07-01-production-release-run-action-packet-enterprise-runthrough.json",
      packet({
        decisionId: "production-release-run",
        queueRank: 3,
        status: "waiting-for-upstream-evidence",
        classification: "final-release-run-binding-blocked",
      }),
    );
    writeFileSync(
      join(reportsDir, "2026-07-01-production-release-run-action-packet-enterprise-runthrough.md"),
      "# redacted markdown\n",
    );

    const output = execFileSync("node", [
      "scripts/owner-decision-action-packet-index.mjs",
      "--owner-decision-queue",
      ownerQueue,
      "--release-gate",
      releaseGate,
      "--enterprise-live-evidence-audit",
      enterpriseAudit,
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-07-01",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "owner-decision-action-packet-index",
        status: "complete-action-packet-chain",
        releaseGateStatus: "blocked",
        ownerDecisionQueueStatus: "owner-decisions-required",
        responsibleSession: "S22",
        summary: {
          queueItemCount: 3,
          actionPacketCount: 3,
          matchedPacketCount: 3,
          missingPacketCount: 0,
          extraPacketCount: 0,
          packetSafetyAttentionCount: 0,
          acceptedLiveEvidence: 0,
          missingEnterpriseLiveTargetCount: 3,
          releaseReady: false,
        },
        missingPacketDecisionIds: [],
        extraPacketDecisionIds: [],
        safety: {
          sourcePathsOmitted: true,
          rawUrlsOmitted: true,
          secretValuesOmitted: true,
          responseBodiesOmitted: true,
          noLiveMutationPerformed: true,
          noDeploymentMutationPerformed: true,
          noReleaseRunBindingPerformed: true,
          releaseGateStillBlocked: true,
        },
      }),
    );
    expect(body.packets).toEqual([
      expect.objectContaining({
        rank: 1,
        decisionId: "app-auth-provider-production-selector",
        queueStatus: "owner-decision-needed",
        packetStatus: "owner-decision-needed",
        actionPacketFileName: "2026-07-01-app-auth-owner-action-packet-enterprise-runthrough.json",
        markdownPacketFileName: null,
        safetyAttention: [],
      }),
      expect.objectContaining({
        rank: 2,
        decisionId: "vercel-env-deploy-and-smoke-chain",
        queueStatus: "waiting-for-upstream-owner-decisions",
        packetStatus: "waiting-for-upstream-owner-decisions",
      }),
      expect.objectContaining({
        rank: 3,
        decisionId: "production-release-run",
        queueStatus: "waiting-for-upstream-evidence",
        packetStatus: "waiting-for-upstream-evidence",
        markdownPacketFileName: "2026-07-01-production-release-run-action-packet-enterprise-runthrough.md",
      }),
    ]);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://private-production.example.test");
    expect(output).not.toContain("uais_teacher_auth_claims=secret");
  });

  it("does not flag omitted URL or response body fields when no such fields are present", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-packet-index-clean-safety-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      queue: [
        queueItem({
          id: "app-auth-provider-production-selector",
          rank: 1,
          category: "owner-decision",
          status: "owner-decision-needed",
        }),
      ],
    });
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      status: "blocked",
    });
    const enterpriseAudit = writeJson(tmpDir, "enterprise-audit.json", {
      status: "blocked",
      summary: {
        acceptedLiveEvidence: 0,
        missingRequiredTargetCount: 1,
      },
    });
    writeJson(
      reportsDir,
      "2026-07-01-app-auth-owner-action-packet-enterprise-runthrough.json",
      {
        target: "app-auth-owner-action-packet",
        decisionId: "app-auth-provider-production-selector",
        queueRank: 1,
        status: "owner-decision-needed",
        releaseGateStatus: "blocked",
        classification: "owner-env-live-evidence-blocked",
        currentEvidenceSummary: {
          endpointSecurity: "documented-without-raw-endpoint",
        },
        safety: {
          sourcePathsOmitted: true,
          liveMutationPerformed: false,
          deploymentMutationPerformed: false,
        },
      },
    );

    const output = execFileSync("node", [
      "scripts/owner-decision-action-packet-index.mjs",
      "--owner-decision-queue",
      ownerQueue,
      "--release-gate",
      releaseGate,
      "--enterprise-live-evidence-audit",
      enterpriseAudit,
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-07-01",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("complete-action-packet-chain");
    expect(body.summary.packetSafetyAttentionCount).toBe(0);
    expect(body.packets[0].safety).toEqual({
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      secretValuesOmitted: true,
      responseBodiesOmitted: true,
    });
    expect(body.packets[0].safetyAttention).toEqual([]);
  });

  it("marks the packet chain for safety review when a raw URL field lacks an omission flag", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-packet-index-safety-review-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      queue: [
        queueItem({
          id: "app-auth-provider-production-selector",
          rank: 1,
          category: "owner-decision",
          status: "owner-decision-needed",
        }),
      ],
    });
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      status: "blocked",
    });
    const enterpriseAudit = writeJson(tmpDir, "enterprise-audit.json", {
      status: "blocked",
      summary: {
        acceptedLiveEvidence: 0,
        missingRequiredTargetCount: 1,
      },
    });
    writeJson(
      reportsDir,
      "2026-07-01-app-auth-owner-action-packet-enterprise-runthrough.json",
      {
        target: "app-auth-owner-action-packet",
        decisionId: "app-auth-provider-production-selector",
        queueRank: 1,
        status: "owner-decision-needed",
        releaseGateStatus: "blocked",
        classification: "owner-env-live-evidence-blocked",
        diagnosticUrl: "https://private-production.example.test/evidence",
        safety: {
          sourcePathsOmitted: true,
          valuesRedacted: true,
          responseBodiesOmitted: true,
        },
      },
    );

    const output = execFileSync("node", [
      "scripts/owner-decision-action-packet-index.mjs",
      "--owner-decision-queue",
      ownerQueue,
      "--release-gate",
      releaseGate,
      "--enterprise-live-evidence-audit",
      enterpriseAudit,
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-07-01",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("action-packet-chain-needs-safety-review");
    expect(body.summary.packetSafetyAttentionCount).toBe(1);
    expect(body.packets[0].safety.rawUrlsOmitted).toBe(false);
    expect(body.packets[0].safetyAttention).toEqual(["raw-url-field-without-omission-flag"]);
    expect(output).not.toContain("https://private-production.example.test");
  });

  it("does not mark the packet index release-ready when the release gate is ready but packets or live audit evidence are incomplete", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-packet-index-ready-mismatch-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "ready",
      queue: [
        queueItem({
          id: "app-auth-provider-production-selector",
          rank: 1,
          category: "owner-decision",
          status: "satisfied",
        }),
      ],
    });
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      status: "ready",
    });
    const enterpriseAudit = writeJson(tmpDir, "enterprise-audit.json", {
      status: "blocked",
      summary: {
        acceptedLiveEvidence: 15,
        missingRequiredTargetCount: 1,
      },
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-action-packet-index.mjs",
      "--owner-decision-queue",
      ownerQueue,
      "--release-gate",
      releaseGate,
      "--enterprise-live-evidence-audit",
      enterpriseAudit,
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-07-01",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("incomplete-action-packet-chain");
    expect(body.summary.missingPacketCount).toBe(1);
    expect(body.summary.missingEnterpriseLiveTargetCount).toBe(1);
    expect(body.summary.releaseReady).toBe(false);
  });

  it("keeps releaseReady false while owner decisions are still required", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-packet-index-owner-queue-guard-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "ready",
      queue: [
        queueItem({
          id: "app-auth-provider-production-selector",
          rank: 1,
          category: "owner-decision",
          status: "owner-decision-needed",
        }),
      ],
    });
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      status: "ready",
    });
    const enterpriseAudit = writeJson(tmpDir, "enterprise-audit.json", {
      status: "accepted",
      summary: {
        acceptedLiveEvidence: 16,
        missingRequiredTargetCount: 0,
      },
    });
    writeJson(
      reportsDir,
      "2026-07-01-app-auth-owner-action-packet-enterprise-runthrough.json",
      packet({
        decisionId: "app-auth-provider-production-selector",
        queueRank: 1,
        status: "owner-decision-needed",
        classification: "owner-env-live-evidence-blocked",
      }),
    );

    const output = execFileSync("node", [
      "scripts/owner-decision-action-packet-index.mjs",
      "--owner-decision-queue",
      ownerQueue,
      "--release-gate",
      releaseGate,
      "--enterprise-live-evidence-audit",
      enterpriseAudit,
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-07-01",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("complete-action-packet-chain");
    expect(body.ownerDecisionQueueStatus).toBe("owner-decisions-required");
    expect(body.summary.releaseReady).toBe(false);
  });

  it("renders a markdown packet index for S10 and S25 handoff", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-packet-index-md-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      queue: [
        queueItem({
          id: "manual-ppt-playback-acceptance",
          rank: 1,
          category: "human-qa",
          status: "human-qa-needed",
        }),
      ],
    });
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      status: "blocked",
      requirements: [{ id: "ppt-manual-playback-acceptance", status: "blocked" }],
    });
    const enterpriseAudit = writeJson(tmpDir, "enterprise-audit.json", {
      status: "blocked",
      summary: {
        acceptedLiveEvidence: 0,
        missingRequiredTargetCount: 1,
      },
    });
    writeJson(
      reportsDir,
      "2026-07-01-manual-ppt-playback-acceptance-action-packet-enterprise-runthrough.json",
      packet({
        decisionId: "manual-ppt-playback-acceptance",
        queueRank: 1,
        status: "human-qa-needed",
        classification: "human-powerpoint-wps-playback-acceptance-blocked",
      }),
    );

    const output = execFileSync("node", [
      "scripts/owner-decision-action-packet-index.mjs",
      "--owner-decision-queue",
      ownerQueue,
      "--release-gate",
      releaseGate,
      "--enterprise-live-evidence-audit",
      enterpriseAudit,
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-07-01",
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("# UAIS Owner Decision Action Packet Index");
    expect(output).toContain("Action packet chain: 1 / 1");
    expect(output).toContain("Missing packet decisions: `none-recorded`");
    expect(output).toContain("Extra packet decisions: `none-recorded`");
    expect(output).toContain("| 1 | `manual-ppt-playback-acceptance` | human-qa | human-qa-needed |");
    expect(output).toContain("This index is not release-ready evidence while the release gate is blocked.");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });
});

function queueItem({
  id,
  rank,
  category,
  status,
}: {
  id: string;
  rank: number;
  category: string;
  status: string;
}) {
  return {
    id,
    rank,
    category,
    status,
    blockedReasons: [`${id}-blocked`],
    releaseGateRequirementIds: [`${id}-requirement`],
    enterpriseAuditMissingTargets: [`${id}-target`],
    nextOwnerQuestion: `Owner question for ${id}`,
  };
}

function packet({
  decisionId,
  queueRank,
  status,
  classification,
}: {
  decisionId: string;
  queueRank: number;
  status: string;
  classification: string;
}) {
  return {
    target: `${decisionId}-action-packet`,
    decisionId,
    queueRank,
    status,
    releaseGateStatus: "blocked",
    classification,
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      secretValuesOmitted: true,
    },
    leakedPath: "/Users/example/private/evidence.json",
    leakedUrl: "https://private-production.example.test/evidence",
  };
}

function writeJson(dir: string, filename: string, body: unknown) {
  const filePath = join(dir, filename);
  writeFileSync(filePath, JSON.stringify(body, null, 2));
  return filePath;
}
