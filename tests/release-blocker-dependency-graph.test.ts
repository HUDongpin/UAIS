import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("release blocker dependency graph", () => {
  it("does not mark release ready when a ready release gate still has upstream blockers", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-release-blocker-graph-ready-"));
    const releaseGatePath = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "ready",
      requirements: [
        {
          id: "app-auth-provider-readiness",
          status: "blocked",
          blockedReason: "app-auth-provider-readiness-not-live-ready",
        },
      ],
    });
    const ownerQueuePath = writeJson(tmpDir, "owner-queue.json", {
      target: "production-owner-decision-queue",
      status: "owner-decisions-required",
      queue: [
        {
          rank: 1,
          id: "app-auth-provider-production-selector",
          status: "owner-decision-needed",
          category: "owner-decision",
          blockedReasons: ["app-auth-provider-readiness-not-live-ready"],
          releaseGateRequirementIds: ["app-auth-provider-readiness"],
          enterpriseAuditMissingTargets: ["app-auth-provider-readiness"],
        },
      ],
    });
    const triagePath = writeJson(tmpDir, "triage.json", {
      target: "enterprise-live-evidence-triage",
      status: "blocked",
      executionWaves: [
        {
          id: "provider-and-env-decisions",
          targets: [{ target: "app-auth-provider-readiness" }],
        },
      ],
      nextActions: [
        {
          target: "app-auth-provider-readiness",
          blockedReasons: [
            "mode-not-live",
            "target-result-proof-missing",
          ],
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/release-blocker-dependency-graph.mjs",
      "--release-gate",
      releaseGatePath,
      "--owner-decision-queue",
      ownerQueuePath,
      "--enterprise-live-evidence-triage",
      triagePath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.summary.releaseReady).toBe(false);
    expect(body.summary.blockedRequirementCount).toBe(1);
    expect(body.summary.mappedBlockedRequirementCount).toBe(1);
  });

  it("does not mark release ready when diagnosis coverage still has release blockers", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-release-blocker-graph-diagnosis-"));
    const releaseGatePath = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "ready",
      requirements: [
        {
          id: "local-production-smoke",
          status: "satisfied",
        },
      ],
    });
    const ownerQueuePath = writeJson(tmpDir, "owner-queue.json", {
      target: "production-owner-decision-queue",
      status: "owner-decisions-complete",
      queue: [],
    });
    const triagePath = writeJson(tmpDir, "triage.json", {
      target: "enterprise-live-evidence-triage",
      status: "accepted",
      executionWaves: [],
      nextActions: [],
    });
    const diagnosisCoveragePath = writeJson(tmpDir, "diagnosis-coverage.json", {
      target: "release-blocker-diagnosis-coverage",
      status: "coverage-complete",
      releaseGateStatus: "ready",
      ownerDecisionQueueStatus: "owner-decisions-required",
      summary: {
        blockedRequirementCount: 0,
        uncoveredRequirementCount: 0,
        ownerQueueBlockingReasonCount: 1,
        releaseReady: false,
      },
      releaseReadinessBlockers: [
        "owner-queue-status-owner-decisions-required",
      ],
    });

    const output = execFileSync("node", [
      "scripts/release-blocker-dependency-graph.mjs",
      "--release-gate",
      releaseGatePath,
      "--owner-decision-queue",
      ownerQueuePath,
      "--enterprise-live-evidence-triage",
      triagePath,
      "--diagnosis-coverage",
      diagnosisCoveragePath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.diagnosisCoverageStatus).toBe("coverage-complete");
    expect(body.summary.releaseReady).toBe(false);
    expect(body.summary.diagnosisCoverageReady).toBe(false);
    expect(body.summary.diagnosisCoverageBlockerCount).toBe(1);
    expect(body.releaseReadinessBlockers).toEqual([
      "owner-queue-status-owner-decisions-required",
    ]);
    expect(output).not.toContain(tmpDir);
  });

  it("maps release gate blockers to owner decisions and execution waves", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-release-blocker-graph-"));
    const releaseGatePath = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "blocked",
      blockedRequirementCount: 3,
      blockedRequirementReasons: [
        "app-auth-provider-readiness-not-live-ready",
        "teaching-operation-detail-browser-smoke-not-live-passed",
        "enterprise-live-evidence-audit-not-ready",
      ],
      requirements: [
        {
          id: "app-auth-provider-readiness",
          status: "blocked",
          blockedReason: "app-auth-provider-readiness-not-live-ready",
        },
        {
          id: "teaching-operation-detail-browser-smoke",
          status: "blocked",
          blockedReason: "teaching-operation-detail-browser-smoke-not-live-passed",
        },
        {
          id: "enterprise-live-evidence-audit",
          status: "blocked",
          blockedReason: "enterprise-live-evidence-audit-not-ready",
        },
        {
          id: "website-teacher-workflow-ui",
          status: "satisfied",
        },
      ],
    });
    const ownerQueuePath = writeJson(tmpDir, "owner-queue.json", {
      target: "production-owner-decision-queue",
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      queue: [
        {
          rank: 1,
          id: "app-auth-provider-production-selector",
          status: "owner-decision-needed",
          category: "owner-decision",
          blockedReasons: ["app-auth-provider-readiness-not-live-ready"],
          releaseGateRequirementIds: ["app-auth-provider-readiness"],
          enterpriseAuditMissingTargets: ["app-auth-provider-readiness"],
          safeNextActions: ["confirm-production-app-auth-provider-mode"],
        },
        {
          rank: 5,
          id: "ordinary-teaching-production-evidence",
          status: "waiting-for-live-evidence",
          category: "live-evidence",
          blockedReasons: [
            "teaching-operation-detail-browser-smoke-not-live-passed",
          ],
          releaseGateRequirementIds: ["teaching-operation-detail-browser-smoke"],
          enterpriseAuditMissingTargets: ["teaching-operation-detail-browser-smoke"],
          safeNextActions: [
            "wait-for-auth-storage-and-deployment-evidence",
          ],
        },
        {
          rank: 7,
          id: "enterprise-live-evidence-audit",
          status: "waiting-for-live-evidence",
          category: "evidence-audit",
          blockedReasons: ["enterprise-live-evidence-audit-not-ready"],
          releaseGateRequirementIds: ["enterprise-live-evidence-audit"],
          enterpriseAuditMissingTargets: [
            "app-auth-provider-readiness",
            "teaching-operation-detail-browser-smoke",
          ],
          safeNextActions: [
            "run-enterprise-live-evidence-audit-after-all-target-evidence-exists",
          ],
        },
        {
          rank: 8,
          id: "production-release-run",
          status: "waiting-for-upstream-evidence",
          category: "final-release-binding",
          blockedReasons: [
            "app-auth-provider-readiness-not-live-ready",
            "teaching-operation-detail-browser-smoke-not-live-passed",
            "enterprise-live-evidence-audit-not-ready",
          ],
          releaseGateRequirementIds: [
            "app-auth-provider-readiness",
            "teaching-operation-detail-browser-smoke",
            "enterprise-live-evidence-audit",
          ],
          enterpriseAuditMissingTargets: [
            "app-auth-provider-readiness",
            "teaching-operation-detail-browser-smoke",
          ],
          safeNextActions: ["wait-for-final-release-gate-ready"],
        },
      ],
    });
    const triagePath = writeJson(tmpDir, "triage.json", {
      target: "enterprise-live-evidence-triage",
      status: "blocked",
      releaseGateStatus: "blocked",
      summary: {
        totalTargets: 2,
        acceptedTargets: 0,
        missingRequiredTargets: 2,
      },
      executionWaves: [
        {
          id: "provider-and-env-decisions",
          label: "Provider and env decisions",
          targetCount: 1,
          targets: [
            { target: "app-auth-provider-readiness" },
          ],
        },
        {
          id: "workflow-and-ordinary-teaching-smokes",
          label: "Workflow and ordinary teaching smokes",
          targetCount: 1,
          targets: [
            { target: "teaching-operation-detail-browser-smoke" },
          ],
        },
      ],
      nextActions: [
        {
          target: "app-auth-provider-readiness",
          blockedReasons: [
            "mode-not-live",
            "status-not-ready",
            "target-result-proof-missing",
          ],
          responsibleSessions: ["Owner", "S12", "S19", "S22"],
        },
        {
          target: "teaching-operation-detail-browser-smoke",
          blockedReasons: [
            "mode-not-live",
            "status-not-passed",
            "release-run-missing",
          ],
          responsibleSessions: ["S05", "S12", "S13", "S19", "S22"],
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/release-blocker-dependency-graph.mjs",
      "--release-gate",
      releaseGatePath,
      "--owner-decision-queue",
      ownerQueuePath,
      "--enterprise-live-evidence-triage",
      triagePath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "release-blocker-dependency-graph",
        status: "blocked",
        releaseGateStatus: "blocked",
        ownerDecisionQueueStatus: "owner-decisions-required",
        enterpriseLiveEvidenceTriageStatus: "blocked",
        summary: expect.objectContaining({
          blockedRequirementCount: 3,
          mappedBlockedRequirementCount: 3,
          unmappedBlockedRequirementCount: 0,
          ownerDecisionCount: 4,
          executionWaveCount: 2,
          liveEvidenceTargetCount: 2,
          releaseReady: false,
        }),
        unmappedRequirementIds: [],
        safety: {
          sourcePathsOmitted: true,
          rawUrlsOmitted: true,
          secretValuesOmitted: true,
          responseBodiesOmitted: true,
          noLiveMutationPerformed: true,
          noDeploymentMutationPerformed: true,
          noReleaseRunBindingPerformed: true,
        },
      }),
    );
    expect(body.requirements).toEqual([
      expect.objectContaining({
        requirementId: "app-auth-provider-readiness",
        blockedReason: "app-auth-provider-readiness-not-live-ready",
        upstreamStatus: "owner-decision-required",
        blockingDecisionIds: [
          "app-auth-provider-production-selector",
          "production-release-run",
        ],
        triageTargetIds: ["app-auth-provider-readiness"],
        executionWaveIds: ["provider-and-env-decisions"],
        nextSafeActions: [
          "confirm-production-app-auth-provider-mode",
          "wait-for-final-release-gate-ready",
        ],
      }),
      expect.objectContaining({
        requirementId: "teaching-operation-detail-browser-smoke",
        upstreamStatus: "waiting-for-live-evidence",
        blockingDecisionIds: [
          "ordinary-teaching-production-evidence",
          "production-release-run",
        ],
        triageTargetIds: ["teaching-operation-detail-browser-smoke"],
        executionWaveIds: ["workflow-and-ordinary-teaching-smokes"],
      }),
      expect.objectContaining({
        requirementId: "enterprise-live-evidence-audit",
        upstreamStatus: "waiting-for-live-evidence",
        blockingDecisionIds: [
          "enterprise-live-evidence-audit",
          "production-release-run",
        ],
        triageTargetIds: [
          "app-auth-provider-readiness",
          "teaching-operation-detail-browser-smoke",
        ],
        executionWaveIds: [
          "provider-and-env-decisions",
          "workflow-and-ordinary-teaching-smokes",
        ],
      }),
    ]);
    expect(body.decisionDependencies).toEqual([
      expect.objectContaining({
        decisionId: "app-auth-provider-production-selector",
        rank: 1,
        blockedRequirementIds: ["app-auth-provider-readiness"],
        executionWaveIds: ["provider-and-env-decisions"],
      }),
      expect.objectContaining({
        decisionId: "ordinary-teaching-production-evidence",
        rank: 5,
        blockedRequirementIds: ["teaching-operation-detail-browser-smoke"],
        executionWaveIds: ["workflow-and-ordinary-teaching-smokes"],
      }),
      expect.objectContaining({
        decisionId: "enterprise-live-evidence-audit",
        rank: 7,
        blockedRequirementIds: ["enterprise-live-evidence-audit"],
        executionWaveIds: [
          "provider-and-env-decisions",
          "workflow-and-ordinary-teaching-smokes",
        ],
      }),
      expect.objectContaining({
        decisionId: "production-release-run",
        rank: 8,
        blockedRequirementIds: [
          "app-auth-provider-readiness",
          "teaching-operation-detail-browser-smoke",
          "enterprise-live-evidence-audit",
        ],
        executionWaveIds: [
          "provider-and-env-decisions",
          "workflow-and-ordinary-teaching-smokes",
        ],
      }),
    ]);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain(["", "Users", ""].join("/"));
  });

  it("renders a markdown dependency table without source paths", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-release-blocker-graph-md-"));
    const releaseGatePath = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "blocked",
      requirements: [
        {
          id: "external-durable-storage-smoke",
          status: "blocked",
          blockedReason: "external-storage-smoke-not-live-passed",
        },
      ],
    });
    const ownerQueuePath = writeJson(tmpDir, "owner-queue.json", {
      status: "owner-decisions-required",
      queue: [
        {
          rank: 3,
          id: "external-storage-production-service",
          status: "owner-decision-needed",
          category: "owner-decision",
          blockedReasons: ["external-storage-smoke-not-live-passed"],
          releaseGateRequirementIds: ["external-durable-storage-smoke"],
          enterpriseAuditMissingTargets: ["external-storage-smoke"],
        },
      ],
    });
    const triagePath = writeJson(tmpDir, "triage.json", {
      status: "blocked",
      executionWaves: [
        {
          id: "auth-and-storage-readiness",
          label: "Auth and storage readiness",
          targets: [{ target: "external-storage-smoke" }],
        },
      ],
      nextActions: [
        {
          target: "external-storage-smoke",
          blockedReasons: ["mode-not-live"],
          responsibleSessions: ["S12", "S22", "S24"],
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/release-blocker-dependency-graph.mjs",
      "--release-gate",
      releaseGatePath,
      "--owner-decision-queue",
      ownerQueuePath,
      "--enterprise-live-evidence-triage",
      triagePath,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("# UAIS Release Blocker Dependency Graph");
    expect(output).toContain("Status: `blocked`");
    expect(output).toContain("## Requirement Dependency Graph");
    expect(output).toContain("`external-durable-storage-smoke`");
    expect(output).toContain("`external-storage-production-service`");
    expect(output).toContain("`auth-and-storage-readiness`");
    expect(output).toContain("## Decision Dependencies");
    expect(output).toContain("Unmapped requirements: `none-recorded`");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain(["", "Users", ""].join("/"));
  });
});

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}
