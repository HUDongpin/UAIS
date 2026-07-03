import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("owner decision response gap matrix", () => {
  it("summarizes missing owner response fields in queue order without unsafe source values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-response-gap-matrix-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const queue = writeJson(reportsDir, "queue.json", {
      status: "owner-decisions-complete",
      releaseGateStatus: "blocked",
      queue: [
        {
          rank: 1,
          id: "app-auth-provider-production-selector",
          status: "owner-decision-needed",
          category: "owner-decision",
          nextOwnerQuestion:
            "Confirm app auth provider from https://private-production.example.test/auth without exposing /Users/example/private/auth.json.",
        },
        {
          rank: 2,
          id: "production-release-run",
          status: "waiting-for-upstream-evidence",
          category: "final-release-binding",
          nextOwnerQuestion: "Do not bind the production release-run ID until the release gate is ready.",
        },
      ],
    });
    writeJson(
      reportsDir,
      "app-auth-validation.json",
      validationReport({
        decisionId: "app-auth-provider-production-selector",
        missingFieldCount: 7,
        blockedReasons: [
          "responseStatus-not-provided",
          "ownerApprovedProviderMode-missing",
          "approvedServerOnlyEnvSourceLabel-missing-or-invalid",
          "confirmsNoCredentialValuesInResponse-not-confirmed",
        ],
        stillForbiddenUntilSeparateApproval: [
          "run-live-app-auth-provider-network-call",
          "run-vercel-env-apply",
        ],
      }),
    );
    writeJson(
      reportsDir,
      "production-release-run-validation.json",
      validationReport({
        decisionId: "production-release-run",
        missingFieldCount: 17,
        blockedReasons: [
          "responseStatus-not-provided",
          "approvedFinalReleaseGateReadyEvidenceLabel-missing-or-invalid",
          "approvedSharedReleaseRunIdLabel-missing-or-invalid",
          "confirmsOwnerApprovesFinalReleaseRunBinding-not-confirmed",
        ],
        stillForbiddenUntilSeparateApproval: [
          "bind-release-run-id-in-this-validation-script",
          "bind-release-run-id-while-release-gate-blocked",
        ],
        releaseRunBindingPerformed: false,
      }),
    );
    const manifest = writeJson(reportsDir, "response-package-manifest.json", {
      status: "response-package-manifest-created",
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-complete",
      summary: {
        queueItemCount: 2,
        responsePackageCount: 2,
        releaseReady: false,
      },
      responsePackages: [
        {
          rank: 1,
          decisionId: "app-auth-provider-production-selector",
          category: "owner-decision",
          queueStatus: "owner-decision-needed",
          validationStatus: "owner-response-incomplete",
          validationFileName: "app-auth-validation.json",
        },
        {
          rank: 2,
          decisionId: "production-release-run",
          category: "final-release-binding",
          queueStatus: "waiting-for-upstream-evidence",
          validationStatus: "owner-response-incomplete",
          validationFileName: "production-release-run-validation.json",
        },
      ],
      leakedPath: "/Users/example/private/manifest.json",
      leakedToken: "secret-token-value",
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-response-gap-matrix.mjs",
      "--response-package-manifest",
      manifest,
      "--owner-decision-queue",
      queue,
      "--reports-dir",
      reportsDir,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "owner-decision-response-gap-matrix",
        status: "owner-response-gaps-present",
        releaseReady: false,
        releaseGateStatus: "blocked",
        ownerDecisionQueueStatus: "owner-decisions-required",
        responsibleSession: "S22/S10/S25",
        summary: expect.objectContaining({
          queueItemCount: 2,
          gapRowCount: 2,
          incompleteResponseCount: 2,
          missingFieldTotal: 24,
          unsafeFindingTotal: 0,
          releaseRunBindingPerformedCount: 0,
          safetyAttentionCount: 0,
          firstActionableDecisionId: "app-auth-provider-production-selector",
          releaseReady: false,
        }),
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
    expect(body.gapRows).toEqual([
      expect.objectContaining({
        rank: 1,
        decisionId: "app-auth-provider-production-selector",
        validationStatus: "owner-response-incomplete",
        missingFieldCount: 7,
        missingFields: [
          "responseStatus-not-provided",
          "ownerApprovedProviderMode-missing",
          "approvedServerOnlyEnvSourceLabel-missing-or-invalid",
          "confirmsNoCredentialValuesInResponse-not-confirmed",
        ],
        nextOwnerQuestion:
          "Confirm app auth provider from [redacted-url] without exposing [redacted-path].",
      }),
      expect.objectContaining({
        rank: 2,
        decisionId: "production-release-run",
        validationStatus: "owner-response-incomplete",
        missingFieldCount: 17,
        releaseRunBindingPerformed: false,
        missingFields: [
          "responseStatus-not-provided",
          "approvedFinalReleaseGateReadyEvidenceLabel-missing-or-invalid",
          "approvedSharedReleaseRunIdLabel-missing-or-invalid",
          "confirmsOwnerApprovesFinalReleaseRunBinding-not-confirmed",
        ],
      }),
    ]);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://private-production.example.test");
    expect(output).not.toContain("secret-token-value");
  });

  it("marks the matrix clear only when all validations are accepted", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-response-gap-matrix-clear-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const queue = writeJson(reportsDir, "queue.json", {
      status: "owner-decisions-complete",
      releaseGateStatus: "blocked",
      queue: [
        {
          rank: 1,
          id: "app-auth-provider-production-selector",
          status: "satisfied",
          category: "owner-decision",
          nextOwnerQuestion: "Already accepted.",
        },
      ],
    });
    writeJson(
      reportsDir,
      "app-auth-validation.json",
      validationReport({
        decisionId: "app-auth-provider-production-selector",
        status: "owner-response-accepted",
        missingFieldCount: 0,
        blockedReasons: [],
        postValidationAllowedChecks: ["prepare-app-auth-readiness"],
        releaseReady: true,
      }),
    );
    const manifest = writeJson(reportsDir, "response-package-manifest.json", {
      status: "response-package-manifest-created",
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-complete",
      summary: {
        releaseReady: true,
      },
      responsePackages: [
        {
          rank: 1,
          decisionId: "app-auth-provider-production-selector",
          category: "owner-decision",
          queueStatus: "satisfied",
          validationStatus: "owner-response-accepted",
          validationFileName: "app-auth-validation.json",
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-response-gap-matrix.mjs",
      "--response-package-manifest",
      manifest,
      "--owner-decision-queue",
      queue,
      "--reports-dir",
      reportsDir,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("owner-response-gaps-clear");
    expect(body.summary.incompleteResponseCount).toBe(0);
    expect(body.summary.missingFieldTotal).toBe(0);
    expect(body.summary.firstActionableDecisionId).toBeNull();
    expect(body.gapRows[0].postValidationAllowedChecks).toEqual(["prepare-app-auth-readiness"]);
  });

  it("keeps the matrix in safety review when accepted validations contain unsafe findings", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-response-gap-matrix-safety-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const queue = writeJson(reportsDir, "queue.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      queue: [
        {
          rank: 8,
          id: "production-release-run",
          status: "waiting-for-upstream-evidence",
          category: "final-release-binding",
          nextOwnerQuestion: "Do not bind the production release-run ID until the gate is ready.",
        },
      ],
    });
    writeJson(
      reportsDir,
      "production-release-run-validation.json",
      validationReport({
        decisionId: "production-release-run",
        status: "owner-response-accepted",
        missingFieldCount: 0,
        unsafeFindingCount: 2,
        blockedReasons: [],
        releaseRunBindingPerformed: true,
      }),
    );
    const manifest = writeJson(reportsDir, "response-package-manifest.json", {
      status: "response-package-manifest-needs-safety-review",
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      responsePackages: [
        {
          rank: 8,
          decisionId: "production-release-run",
          category: "final-release-binding",
          queueStatus: "waiting-for-upstream-evidence",
          validationStatus: "owner-response-accepted",
          validationFileName: "production-release-run-validation.json",
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-response-gap-matrix.mjs",
      "--response-package-manifest",
      manifest,
      "--owner-decision-queue",
      queue,
      "--reports-dir",
      reportsDir,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("owner-response-gaps-need-safety-review");
    expect(body.summary.incompleteResponseCount).toBe(0);
    expect(body.summary.unsafeFindingTotal).toBe(2);
    expect(body.summary.releaseRunBindingPerformedCount).toBe(1);
    expect(body.summary.safetyAttentionCount).toBe(3);
    expect(body.summary.firstActionableDecisionId).toBe("production-release-run");
    expect(body.safety.noReleaseRunBindingPerformed).toBe(false);
  });

  it("does not mark the matrix release-ready when upstream manifest or one validation is ready but owner responses are incomplete", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-response-gap-matrix-ready-mismatch-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const queue = writeJson(reportsDir, "queue.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      queue: [
        {
          rank: 1,
          id: "app-auth-provider-production-selector",
          status: "owner-decision-needed",
          category: "owner-decision",
          nextOwnerQuestion: "Confirm app auth provider readiness labels.",
        },
      ],
    });
    writeJson(
      reportsDir,
      "app-auth-validation.json",
      validationReport({
        decisionId: "app-auth-provider-production-selector",
        status: "owner-response-incomplete",
        missingFieldCount: 2,
        blockedReasons: [
          "approvedServerOnlyEnvSourceLabel-missing-or-invalid",
          "approvedReleaseRunIdLabel-missing-or-invalid",
        ],
      }),
    );
    const manifest = writeJson(reportsDir, "response-package-manifest.json", {
      status: "response-package-manifest-created",
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      summary: {
        releaseReady: true,
      },
      responsePackages: [
        {
          rank: 1,
          decisionId: "app-auth-provider-production-selector",
          category: "owner-decision",
          queueStatus: "owner-decision-needed",
          validationStatus: "owner-response-incomplete",
          validationFileName: "app-auth-validation.json",
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-response-gap-matrix.mjs",
      "--response-package-manifest",
      manifest,
      "--owner-decision-queue",
      queue,
      "--reports-dir",
      reportsDir,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("owner-response-gaps-present");
    expect(body.summary.incompleteResponseCount).toBe(1);
    expect(body.gapRows[0]).toEqual(
      expect.objectContaining({
        decisionId: "app-auth-provider-production-selector",
        validationStatus: "owner-response-incomplete",
        releaseReady: false,
      }),
    );
    expect(body.summary.releaseReady).toBe(false);
  });

  it("does not mark the matrix release-ready while the owner decision queue is still waiting", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-response-gap-matrix-queue-waiting-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const queue = writeJson(reportsDir, "queue.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      queue: [
        {
          rank: 1,
          id: "app-auth-provider-production-selector",
          status: "owner-decision-needed",
          category: "owner-decision",
          nextOwnerQuestion: "Confirm app auth provider readiness labels.",
        },
      ],
    });
    writeJson(
      reportsDir,
      "app-auth-validation.json",
      validationReport({
        decisionId: "app-auth-provider-production-selector",
        status: "owner-response-accepted",
        missingFieldCount: 0,
        blockedReasons: [],
        releaseReady: true,
      }),
    );
    const manifest = writeJson(reportsDir, "response-package-manifest.json", {
      status: "response-package-manifest-created",
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      summary: {
        releaseReady: true,
      },
      responsePackages: [
        {
          rank: 1,
          decisionId: "app-auth-provider-production-selector",
          category: "owner-decision",
          queueStatus: "owner-decision-needed",
          validationStatus: "owner-response-accepted",
          validationFileName: "app-auth-validation.json",
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-response-gap-matrix.mjs",
      "--response-package-manifest",
      manifest,
      "--owner-decision-queue",
      queue,
      "--reports-dir",
      reportsDir,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("owner-response-gaps-awaiting-production-evidence");
    expect(body.ownerDecisionQueueStatus).toBe(
      "owner-decisions-cleared-awaiting-production-evidence",
    );
    expect(body.sourceOwnerDecisionQueueStatus).toBe("owner-decisions-required");
    expect(body.gapRows[0]).toEqual(
      expect.objectContaining({
        decisionId: "app-auth-provider-production-selector",
        validationStatus: "owner-response-accepted",
        releaseReady: true,
      }),
    );
    expect(body.summary.releaseReady).toBe(false);
  });

  it("classifies accepted responses, evidence-label gaps, and true owner-input gaps separately", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-response-gap-matrix-action-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const queue = writeJson(reportsDir, "queue.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      queue: [
        {
          rank: 1,
          id: "app-auth-provider-production-selector",
          status: "accepted-awaiting-production-evidence",
          category: "owner-decision",
          nextOwnerQuestion: "Collect app-auth production evidence.",
        },
        {
          rank: 2,
          id: "ordinary-teaching-production-evidence",
          status: "waiting-for-live-evidence",
          category: "live-evidence",
          nextOwnerQuestion: "Label ordinary teaching live smoke evidence after it exists.",
        },
        {
          rank: 3,
          id: "enterprise-live-evidence-audit",
          status: "waiting-for-live-evidence",
          category: "evidence-audit",
          nextOwnerQuestion: "Label enterprise live evidence audit after it exists.",
        },
        {
          rank: 4,
          id: "production-release-run",
          status: "waiting-for-upstream-evidence",
          category: "final-release-binding",
          nextOwnerQuestion: "Label final release gate proof after it exists.",
        },
        {
          rank: 5,
          id: "teacher-auth-provider-production-selector",
          status: "owner-decision-needed",
          category: "owner-decision",
          nextOwnerQuestion: "Choose teacher auth provider mode.",
        },
      ],
    });
    writeJson(
      reportsDir,
      "app-auth-validation.json",
      validationReport({
        decisionId: "app-auth-provider-production-selector",
        status: "owner-response-accepted",
        missingFieldCount: 0,
        blockedReasons: [],
        postValidationAllowedChecks: ["prepare-app-auth-readiness"],
      }),
    );
    writeJson(
      reportsDir,
      "ordinary-validation.json",
      validationReport({
        decisionId: "ordinary-teaching-production-evidence",
        missingFieldCount: 2,
        blockedReasons: [
          "approvedTeachingOperationsRouteSmokeLabel-missing-or-invalid",
          "approvedReleaseRunIdLabel-missing-or-invalid",
        ],
      }),
    );
    writeJson(
      reportsDir,
      "enterprise-audit-validation.json",
      validationReport({
        decisionId: "enterprise-live-evidence-audit",
        missingFieldCount: 2,
        blockedReasons: [
          "approvedEnterpriseLiveEvidenceAuditProofLabel-missing-or-invalid",
          "approvedProductionLiveEvidenceSetLabel-missing-or-invalid",
        ],
      }),
    );
    writeJson(
      reportsDir,
      "release-run-validation.json",
      validationReport({
        decisionId: "production-release-run",
        missingFieldCount: 2,
        blockedReasons: [
          "approvedFinalReleaseGateReadyEvidenceLabel-missing-or-invalid",
          "approvedSharedReleaseRunIdLabel-missing-or-invalid",
        ],
      }),
    );
    writeJson(
      reportsDir,
      "teacher-auth-validation.json",
      validationReport({
        decisionId: "teacher-auth-provider-production-selector",
        missingFieldCount: 2,
        blockedReasons: [
          "ownerApprovedProviderMode-missing",
          "confirmsNoCredentialValuesInResponse-not-confirmed",
        ],
      }),
    );
    const manifest = writeJson(reportsDir, "response-package-manifest.json", {
      status: "response-package-manifest-created",
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      responsePackages: [
        {
          rank: 1,
          decisionId: "app-auth-provider-production-selector",
          category: "owner-decision",
          queueStatus: "accepted-awaiting-production-evidence",
          validationStatus: "owner-response-accepted",
          validationFileName: "app-auth-validation.json",
        },
        {
          rank: 2,
          decisionId: "ordinary-teaching-production-evidence",
          category: "live-evidence",
          queueStatus: "waiting-for-live-evidence",
          validationStatus: "owner-response-incomplete",
          validationFileName: "ordinary-validation.json",
        },
        {
          rank: 3,
          decisionId: "enterprise-live-evidence-audit",
          category: "evidence-audit",
          queueStatus: "waiting-for-live-evidence",
          validationStatus: "owner-response-incomplete",
          validationFileName: "enterprise-audit-validation.json",
        },
        {
          rank: 4,
          decisionId: "production-release-run",
          category: "final-release-binding",
          queueStatus: "waiting-for-upstream-evidence",
          validationStatus: "owner-response-incomplete",
          validationFileName: "release-run-validation.json",
        },
        {
          rank: 5,
          decisionId: "teacher-auth-provider-production-selector",
          category: "owner-decision",
          queueStatus: "owner-decision-needed",
          validationStatus: "owner-response-incomplete",
          validationFileName: "teacher-auth-validation.json",
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-response-gap-matrix.mjs",
      "--response-package-manifest",
      manifest,
      "--owner-decision-queue",
      queue,
      "--reports-dir",
      reportsDir,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.summary.actionClassCounts).toEqual({
      acceptedAwaitingProductionEvidence: 1,
      awaitingProductionEvidenceLabels: 3,
      needsOwnerInput: 1,
      safetyReview: 0,
      releaseReady: 0,
    });
    expect(body.summary.firstOwnerInputDecisionId).toBe(
      "teacher-auth-provider-production-selector",
    );
    expect(body.summary.firstEvidenceLabelDecisionId).toBe(
      "ordinary-teaching-production-evidence",
    );
    expect(body.gapRows.map((row: { decisionId: string; actionClass: string }) => [
      row.decisionId,
      row.actionClass,
    ])).toEqual([
      ["app-auth-provider-production-selector", "accepted-awaiting-production-evidence"],
      ["ordinary-teaching-production-evidence", "awaiting-production-evidence-labels"],
      ["enterprise-live-evidence-audit", "awaiting-production-evidence-labels"],
      ["production-release-run", "awaiting-production-evidence-labels"],
      ["teacher-auth-provider-production-selector", "needs-owner-input"],
    ]);
    expect(body.gapRows.map((row: { nextSafeAction: string }) => row.nextSafeAction)).toEqual([
      "collect-production-evidence",
      "collect-evidence-labels-after-live-proof",
      "collect-evidence-labels-after-live-proof",
      "collect-evidence-labels-after-live-proof",
      "request-owner-response",
    ]);
  });

  it("derives a current queue status when owner decisions are accepted but production evidence is still pending", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-response-gap-matrix-current-status-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const queue = writeJson(reportsDir, "queue.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      queue: [
        {
          rank: 1,
          id: "app-auth-provider-production-selector",
          status: "accepted-awaiting-production-evidence",
          category: "owner-decision",
          nextOwnerQuestion: "Collect app-auth production evidence.",
        },
        {
          rank: 2,
          id: "ordinary-teaching-production-evidence",
          status: "waiting-for-live-evidence",
          category: "live-evidence",
          nextOwnerQuestion: "Label ordinary teaching evidence after live proof exists.",
        },
      ],
    });
    writeJson(
      reportsDir,
      "app-auth-validation.json",
      validationReport({
        decisionId: "app-auth-provider-production-selector",
        status: "owner-response-accepted",
        missingFieldCount: 0,
        blockedReasons: [],
      }),
    );
    writeJson(
      reportsDir,
      "ordinary-validation.json",
      validationReport({
        decisionId: "ordinary-teaching-production-evidence",
        missingFieldCount: 2,
        blockedReasons: [
          "approvedTeachingOperationsRouteSmokeLabel-missing-or-invalid",
          "approvedReleaseRunIdLabel-missing-or-invalid",
        ],
      }),
    );
    const manifest = writeJson(reportsDir, "response-package-manifest.json", {
      status: "response-package-manifest-created",
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      responsePackages: [
        {
          rank: 1,
          decisionId: "app-auth-provider-production-selector",
          category: "owner-decision",
          queueStatus: "accepted-awaiting-production-evidence",
          validationStatus: "owner-response-accepted",
          validationFileName: "app-auth-validation.json",
        },
        {
          rank: 2,
          decisionId: "ordinary-teaching-production-evidence",
          category: "live-evidence",
          queueStatus: "waiting-for-live-evidence",
          validationStatus: "owner-response-incomplete",
          validationFileName: "ordinary-validation.json",
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-response-gap-matrix.mjs",
      "--response-package-manifest",
      manifest,
      "--owner-decision-queue",
      queue,
      "--reports-dir",
      reportsDir,
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
    expect(body.needsOwnerInput).toBe(false);
    expect(body.productionEvidenceRequired).toBe(true);
    expect(body.firstOwnerInputDecisionId).toBeNull();
    expect(body.firstProductionEvidenceDecisionId).toBe(
      "app-auth-provider-production-selector",
    );
    expect(body.firstEvidenceLabelDecisionId).toBe(
      "ordinary-teaching-production-evidence",
    );
    expect(body.summary.firstOwnerInputDecisionId).toBeNull();
    expect(body.summary.firstProductionEvidenceDecisionId).toBe(
      "app-auth-provider-production-selector",
    );
    expect(body.summary.firstEvidenceLabelDecisionId).toBe(
      "ordinary-teaching-production-evidence",
    );
    expect(body.summary.releaseReady).toBe(false);
    expect(output).not.toContain(tmpDir);
  });

  it("renders markdown for owner-facing response completion", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-response-gap-matrix-md-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const queue = writeJson(reportsDir, "queue.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      queue: [
        {
          rank: 1,
          id: "external-storage-production-service",
          status: "owner-decision-needed",
          category: "owner-decision",
          nextOwnerQuestion: "Confirm the approved remote external-storage service.",
        },
      ],
    });
    writeJson(
      reportsDir,
      "external-storage-validation.json",
      validationReport({
        decisionId: "external-storage-production-service",
        missingFieldCount: 11,
        blockedReasons: [
          "approvedExternalStorageServiceLabel-missing-or-invalid",
          "confirmsS19MayPrepareExternalStorageEnvSyncDryRun-not-confirmed",
        ],
      }),
    );
    const manifest = writeJson(reportsDir, "response-package-manifest.json", {
      status: "response-package-manifest-created",
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      responsePackages: [
        {
          rank: 1,
          decisionId: "external-storage-production-service",
          category: "owner-decision",
          queueStatus: "owner-decision-needed",
          validationStatus: "owner-response-incomplete",
          validationFileName: "external-storage-validation.json",
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-response-gap-matrix.mjs",
      "--response-package-manifest",
      manifest,
      "--owner-decision-queue",
      queue,
      "--reports-dir",
      reportsDir,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("# UAIS Owner Decision Response Gap Matrix");
    expect(output).toContain("Status: `owner-response-gaps-present`");
    expect(output).toContain("| `1` | `external-storage-production-service` |");
    expect(output).toContain("`approvedExternalStorageServiceLabel-missing-or-invalid`");
    expect(output).toContain("Post-validation allowed checks:");
    expect(output).toContain("- `none-recorded`");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });
});

function validationReport({
  decisionId,
  status = "owner-response-incomplete",
  missingFieldCount,
  unsafeFindingCount = 0,
  blockedReasons,
  stillForbiddenUntilSeparateApproval = [],
  postValidationAllowedChecks = [],
  releaseRunBindingPerformed = false,
  releaseReady = false,
}: {
  decisionId: string;
  status?: string;
  missingFieldCount: number;
  unsafeFindingCount?: number;
  blockedReasons: string[];
  stillForbiddenUntilSeparateApproval?: string[];
  postValidationAllowedChecks?: string[];
  releaseRunBindingPerformed?: boolean;
  releaseReady?: boolean;
}) {
  return {
    target: "owner-decision-response-validation",
    status,
    decisionId,
    summary: {
      ownerResponseStatus:
        status === "owner-response-accepted" ? "owner-response-provided" : "owner-response-required",
      missingFieldCount,
      unsafeFindingCount,
      releaseRunBindingPerformed,
      releaseReady,
    },
    blockedReasons,
    stillForbiddenUntilSeparateApproval,
    postValidationAllowedChecks,
    notes: "private fixture secret-token-value",
  };
}

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}
