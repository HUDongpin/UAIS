import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("owner decision live-run approval gate", () => {
  it("blocks the live-run at the first unresolved owner decision without leaking source details", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-live-run-gate-"));
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      queue: [
        queueItem({
          id: "app-auth-provider-production-selector",
          rank: 1,
          status: "owner-decision-needed",
          category: "owner-decision",
        }),
        queueItem({
          id: "teacher-auth-provider-production-selector",
          rank: 2,
          status: "owner-decision-needed",
          category: "owner-decision",
        }),
      ],
      leakedPath: "/Users/example/private/queue.json",
      leakedUrl: "https://private-production.example.test/queue",
    });
    const preflight = writeJson(tmpDir, "preflight.json", {
      target: "owner-decision-live-run-preflight",
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      summary: {
        ownerDecisionQueueCount: 2,
        blockedReleaseGateRequirementCount: 2,
        enterpriseLiveEvidenceTargetCount: 2,
        acceptedEnterpriseLiveEvidenceCount: 0,
        releaseReady: false,
      },
      preflightOrder: [
        preflightStage({
          order: 1,
          id: "app-auth-provider-production-selector",
          currentStatus: "owner-decision-needed",
        }),
        preflightStage({
          order: 2,
          id: "teacher-auth-provider-production-selector",
          currentStatus: "owner-decision-needed",
        }),
      ],
      leakedCookie: "uais_teacher_auth_claims=secret",
    });
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      status: "blocked",
      summary: { releaseReady: false },
    });
    const enterpriseAudit = writeJson(tmpDir, "enterprise-audit.json", {
      status: "blocked",
      summary: {
        acceptedLiveEvidence: 0,
        missingRequiredTargetCount: 2,
      },
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-live-run-approval-gate.mjs",
      "--owner-decision-queue",
      ownerQueue,
      "--live-run-preflight",
      preflight,
      "--release-gate",
      releaseGate,
      "--enterprise-live-evidence-audit",
      enterpriseAudit,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "owner-decision-live-run-approval-gate",
        status: "approval-gate-blocked",
        releaseReady: false,
        releaseGateStatus: "blocked",
        ownerDecisionQueueStatus: "owner-decisions-required",
        responsibleSession: "S22/S19/S10/S25",
        firstBlockedStageId: "app-auth-provider-production-selector",
        summary: expect.objectContaining({
          stageCount: 2,
          runnableStageCount: 0,
          blockedStageCount: 2,
          ownerApprovalRequiredStageCount: 2,
          acceptedLiveEvidence: 0,
          missingEnterpriseLiveTargetCount: 2,
          releaseReady: false,
        }),
        safety: {
          sourcePathsOmitted: true,
          rawUrlsOmitted: true,
          credentialValuesOmitted: true,
          cookieValuesOmitted: true,
          responseBodiesOmitted: true,
          noLiveMutationPerformed: true,
          noDeploymentMutationPerformed: true,
          noEnvApplyPerformed: true,
          noReleaseRunBindingPerformed: true,
        },
      }),
    );
    expect(body.stages[0]).toEqual(
      expect.objectContaining({
        order: 1,
        id: "app-auth-provider-production-selector",
        canRun: false,
        gateStatus: "blocked",
        queueStatus: "owner-decision-needed",
      }),
    );
    expect(body.stages[0].blockingReasons).toContain("queue-status-owner-decision-needed");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://private-production.example.test");
    expect(output).not.toContain("uais_teacher_auth_claims=secret");
  });

  it("reconciles accepted owner responses so old queue rows no longer look decision-blocked", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-live-run-gate-reconcile-"));
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      queue: [
        queueItem({
          id: "app-auth-provider-production-selector",
          rank: 1,
          status: "owner-decision-needed",
          category: "owner-decision",
        }),
      ],
    });
    const preflight = writeJson(tmpDir, "preflight.json", {
      target: "owner-decision-live-run-preflight",
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      summary: {
        ownerDecisionQueueCount: 1,
        blockedReleaseGateRequirementCount: 1,
        enterpriseLiveEvidenceTargetCount: 1,
        acceptedEnterpriseLiveEvidenceCount: 0,
        releaseRunIdConsistency: "missing",
        releaseReady: false,
      },
      preflightOrder: [
        preflightStage({
          order: 1,
          id: "app-auth-provider-production-selector",
          currentStatus: "owner-decision-needed",
        }),
      ],
    });
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      status: "blocked",
      summary: { releaseReady: false },
    });
    const enterpriseAudit = writeJson(tmpDir, "enterprise-audit.json", {
      status: "blocked",
      summary: {
        acceptedLiveEvidence: 0,
        missingRequiredTargetCount: 1,
      },
    });
    const ownerResponseCompletionValidation = writeJson(
      tmpDir,
      "owner-response-completion-validation.json",
      {
        target: "owner-decision-response-completion-validation",
        status: "owner-response-completion-incomplete",
        ownerDecisionQueueStatus: "owner-decisions-cleared-awaiting-production-evidence",
        sourceOwnerDecisionQueueStatus: "owner-decisions-required",
        summary: {
          ownerCompletionItemCount: 1,
          acceptedItemCount: 1,
          incompleteItemCount: 0,
          placeholderFieldTotal: 0,
          individualValidationCommandCount: 1,
          unsafeFindingTotal: 0,
          postValidationMayProceed: false,
          releaseReady: false,
        },
        validationItems: [
          {
            rank: 1,
            decisionId: "app-auth-provider-production-selector",
            status: "owner-response-completion-accepted",
          },
        ],
      },
    );

    const output = execFileSync("node", [
      "scripts/owner-decision-live-run-approval-gate.mjs",
      "--owner-decision-queue",
      ownerQueue,
      "--live-run-preflight",
      preflight,
      "--release-gate",
      releaseGate,
      "--enterprise-live-evidence-audit",
      enterpriseAudit,
      "--owner-response-completion-validation",
      ownerResponseCompletionValidation,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("approval-gate-blocked");
    expect(body.releaseReady).toBe(false);
    expect(body.ownerDecisionQueueStatus).toBe(
      "owner-decisions-cleared-awaiting-production-evidence",
    );
    expect(body.sourceOwnerDecisionQueueStatus).toBe("owner-decisions-required");
    expect(body.globalBlockingReasons).not.toContain(
      "owner-queue-status-owner-decisions-required",
    );
    expect(body.globalBlockingReasons).not.toContain(
      "owner-queue-status-owner-decisions-cleared-awaiting-production-evidence",
    );
    expect(body.summary.acceptedOwnerCompletionItemCount).toBe(1);
    expect(body.summary.ownerApprovalRequiredStageCount).toBe(0);
    expect(body.stages[0]).toEqual(
      expect.objectContaining({
        id: "app-auth-provider-production-selector",
        canRun: false,
        queueStatus: "accepted",
        currentStatus: "accepted-awaiting-production-evidence",
      }),
    );
    expect(body.stages[0].blockingReasons).not.toContain(
      "queue-status-owner-decision-needed",
    );
    expect(body.stages[0].blockingReasons).toContain(
      "stage-status-accepted-awaiting-production-evidence",
    );
  });

  it("marks the approval gate ready only when stages, release gate, and live audit are ready", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-live-run-gate-ready-"));
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "all-decisions-ready",
      releaseGateStatus: "ready",
      queue: [
        queueItem({
          id: "app-auth-provider-production-selector",
          rank: 1,
          status: "ready",
          category: "owner-decision",
        }),
        queueItem({
          id: "production-release-run",
          rank: 2,
          status: "ready",
          category: "final-release-binding",
        }),
      ],
    });
    const preflight = writeJson(tmpDir, "preflight.json", {
      target: "owner-decision-live-run-preflight",
      status: "ready",
      releaseGateStatus: "ready",
      summary: {
        ownerDecisionQueueCount: 2,
        blockedReleaseGateRequirementCount: 0,
        enterpriseLiveEvidenceTargetCount: 2,
        acceptedEnterpriseLiveEvidenceCount: 2,
        releaseReady: true,
      },
      preflightOrder: [
        preflightStage({
          order: 1,
          id: "app-auth-provider-production-selector",
          currentStatus: "ready",
        }),
        preflightStage({
          order: 2,
          id: "production-release-run",
          currentStatus: "ready",
        }),
      ],
    });
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      status: "ready",
      summary: { releaseReady: true },
    });
    const enterpriseAudit = writeJson(tmpDir, "enterprise-audit.json", {
      status: "ready",
      summary: {
        acceptedLiveEvidence: 2,
        missingRequiredTargetCount: 0,
      },
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-live-run-approval-gate.mjs",
      "--owner-decision-queue",
      ownerQueue,
      "--live-run-preflight",
      preflight,
      "--release-gate",
      releaseGate,
      "--enterprise-live-evidence-audit",
      enterpriseAudit,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("approval-gate-ready");
    expect(body.releaseReady).toBe(true);
    expect(body.firstBlockedStageId).toBeNull();
    expect(body.summary).toEqual(
      expect.objectContaining({
        stageCount: 2,
        runnableStageCount: 2,
        blockedStageCount: 0,
        ownerApprovalRequiredStageCount: 0,
        acceptedLiveEvidence: 2,
        missingEnterpriseLiveTargetCount: 0,
        releaseReady: true,
      }),
    );
    expect(body.stages.every((stage: { canRun: boolean }) => stage.canRun)).toBe(true);

    const markdown = execFileSync("node", [
      "scripts/owner-decision-live-run-approval-gate.mjs",
      "--owner-decision-queue",
      ownerQueue,
      "--live-run-preflight",
      preflight,
      "--release-gate",
      releaseGate,
      "--enterprise-live-evidence-audit",
      enterpriseAudit,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(markdown).toContain("First blocked stage: `none-recorded`");
    expect(markdown).not.toContain("First blocked stage: `none`");
  });

  it("keeps the approval gate blocked when owner response completion validation is incomplete", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-live-run-gate-owner-validation-"));
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "all-decisions-ready",
      releaseGateStatus: "ready",
      queue: [
        queueItem({
          id: "app-auth-provider-production-selector",
          rank: 1,
          status: "ready",
          category: "owner-decision",
        }),
      ],
    });
    const preflight = writeJson(tmpDir, "preflight.json", {
      target: "owner-decision-live-run-preflight",
      status: "ready",
      releaseGateStatus: "ready",
      summary: {
        ownerDecisionQueueCount: 1,
        blockedReleaseGateRequirementCount: 0,
        enterpriseLiveEvidenceTargetCount: 1,
        acceptedEnterpriseLiveEvidenceCount: 1,
        releaseRunIdConsistency: "ready",
        releaseReady: true,
      },
      preflightOrder: [
        preflightStage({
          order: 1,
          id: "app-auth-provider-production-selector",
          currentStatus: "ready",
        }),
      ],
    });
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      status: "ready",
      summary: { releaseReady: true },
    });
    const enterpriseAudit = writeJson(tmpDir, "enterprise-audit.json", {
      status: "ready",
      summary: {
        acceptedLiveEvidence: 1,
        missingRequiredTargetCount: 0,
      },
    });
    const ownerResponseCompletionValidation = writeJson(
      tmpDir,
      "owner-response-completion-validation.json",
      {
        target: "owner-decision-response-completion-validation",
        status: "owner-response-completion-incomplete",
        summary: {
          ownerCompletionItemCount: 1,
          acceptedItemCount: 0,
          incompleteItemCount: 1,
          placeholderFieldTotal: 2,
          individualValidationCommandCount: 1,
          unsafeFindingTotal: 0,
          postValidationMayProceed: false,
          releaseReady: false,
        },
        firstIncompleteOwnerResponse: {
          rank: 1,
          decisionId: "app-auth-provider-production-selector",
          status: "owner-response-completion-incomplete",
          missingFieldCount: 0,
          placeholderFieldCount: 2,
          unsafeFindingCount: 0,
          confirmationFailureCount: 0,
          requiredOwnerInputFields: [
            "approvedServerOnlyEnvSourceLabel",
            "approvedReleaseRunIdLabel",
          ],
          ownerResponseValidationCommand:
            "node scripts/owner-decision-app-auth-response-validation.mjs --owner-response-template coordination/reports/app-template.json --owner-response path/to/filled-owner-response.json",
        },
        individualOwnerResponseValidationCommands: [
          {
            rank: 1,
            decisionId: "app-auth-provider-production-selector",
            ownerResponseValidationCommand:
              "node scripts/owner-decision-app-auth-response-validation.mjs --owner-response-template coordination/reports/app-template.json --owner-response path/to/filled-owner-response.json",
          },
        ],
        leakedUrl: "https://private-owner-response.example.test/value",
      },
    );

    const output = execFileSync("node", [
      "scripts/owner-decision-live-run-approval-gate.mjs",
      "--owner-decision-queue",
      ownerQueue,
      "--live-run-preflight",
      preflight,
      "--release-gate",
      releaseGate,
      "--enterprise-live-evidence-audit",
      enterpriseAudit,
      "--owner-response-completion-validation",
      ownerResponseCompletionValidation,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("approval-gate-blocked");
    expect(body.summary).toEqual(
      expect.objectContaining({
        runnableStageCount: 1,
        blockedStageCount: 0,
        acceptedLiveEvidence: 1,
        missingEnterpriseLiveTargetCount: 0,
        ownerResponseCompletionStatus: "owner-response-completion-incomplete",
        acceptedOwnerCompletionItemCount: 0,
        placeholderOwnerCompletionFieldCount: 2,
        ownerResponseIndividualValidationCommandCount: 1,
        postValidationMayProceed: false,
        releaseReady: false,
      }),
    );
    expect(body.firstIncompleteOwnerResponse).toEqual({
      rank: 1,
      decisionId: "app-auth-provider-production-selector",
      status: "owner-response-completion-incomplete",
      missingFieldCount: 0,
      placeholderFieldCount: 2,
      unsafeFindingCount: 0,
      confirmationFailureCount: 0,
      requiredOwnerInputFields: [
        "approvedServerOnlyEnvSourceLabel",
        "approvedReleaseRunIdLabel",
      ],
      ownerResponseValidationCommand:
        "node scripts/owner-decision-app-auth-response-validation.mjs --owner-response-template coordination/reports/app-template.json --owner-response path/to/filled-owner-response.json",
    });
    expect(body.ownerResponseCompletionValidationCommands).toEqual([
      {
        rank: 1,
        decisionId: "app-auth-provider-production-selector",
        ownerResponseValidationCommand:
          "node scripts/owner-decision-app-auth-response-validation.mjs --owner-response-template coordination/reports/app-template.json --owner-response path/to/filled-owner-response.json",
      },
    ]);
    expect(body.globalBlockingReasons).toContain(
      "owner-response-completion-validation-status-owner-response-completion-incomplete",
    );
    expect(body.globalBlockingReasons).toContain("owner-response-completion-not-authorized");
    expect(output).not.toContain("https://private-owner-response.example.test");

    const markdown = execFileSync("node", [
      "scripts/owner-decision-live-run-approval-gate.mjs",
      "--owner-decision-queue",
      ownerQueue,
      "--live-run-preflight",
      preflight,
      "--release-gate",
      releaseGate,
      "--enterprise-live-evidence-audit",
      enterpriseAudit,
      "--owner-response-completion-validation",
      ownerResponseCompletionValidation,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(markdown).toContain("## First Incomplete Owner Response");
    expect(markdown).toContain("Decision: `app-auth-provider-production-selector`");
    expect(markdown).toContain("Placeholder fields: 2");
    expect(markdown).toContain(
      "node scripts/owner-decision-app-auth-response-validation.mjs --owner-response-template coordination/reports/app-template.json --owner-response path/to/filled-owner-response.json",
    );
    expect(markdown).not.toContain("https://private-owner-response.example.test");
  });

  it("keeps the approval gate ready when owner response completion validation is accepted", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-live-run-gate-owner-validation-ready-"));
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "all-decisions-ready",
      releaseGateStatus: "ready",
      queue: [
        queueItem({
          id: "production-release-run",
          rank: 1,
          status: "ready",
          category: "final-release-binding",
        }),
      ],
    });
    const preflight = writeJson(tmpDir, "preflight.json", {
      target: "owner-decision-live-run-preflight",
      status: "ready",
      releaseGateStatus: "ready",
      summary: {
        ownerDecisionQueueCount: 1,
        blockedReleaseGateRequirementCount: 0,
        enterpriseLiveEvidenceTargetCount: 1,
        acceptedEnterpriseLiveEvidenceCount: 1,
        releaseRunIdConsistency: "ready",
        releaseReady: true,
      },
      preflightOrder: [
        preflightStage({
          order: 1,
          id: "production-release-run",
          currentStatus: "ready",
        }),
      ],
    });
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      status: "ready",
      summary: { releaseReady: true },
    });
    const enterpriseAudit = writeJson(tmpDir, "enterprise-audit.json", {
      status: "ready",
      summary: {
        acceptedLiveEvidence: 1,
        missingRequiredTargetCount: 0,
      },
    });
    const ownerResponseCompletionValidation = writeJson(
      tmpDir,
      "owner-response-completion-validation.json",
      {
        target: "owner-decision-response-completion-validation",
        status: "owner-response-completion-accepted",
        summary: {
          ownerCompletionItemCount: 1,
          acceptedItemCount: 1,
          incompleteItemCount: 0,
          placeholderFieldTotal: 0,
          unsafeFindingTotal: 0,
          postValidationMayProceed: true,
          releaseReady: false,
        },
      },
    );

    const output = execFileSync("node", [
      "scripts/owner-decision-live-run-approval-gate.mjs",
      "--owner-decision-queue",
      ownerQueue,
      "--live-run-preflight",
      preflight,
      "--release-gate",
      releaseGate,
      "--enterprise-live-evidence-audit",
      enterpriseAudit,
      "--owner-response-completion-validation",
      ownerResponseCompletionValidation,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("approval-gate-ready");
    expect(body.firstIncompleteOwnerResponse).toBeNull();
    expect(body.summary).toEqual(
      expect.objectContaining({
        ownerResponseCompletionStatus: "owner-response-completion-accepted",
        acceptedOwnerCompletionItemCount: 1,
        placeholderOwnerCompletionFieldCount: 0,
        postValidationMayProceed: true,
        releaseReady: true,
      }),
    );
    expect(body.globalBlockingReasons).toEqual([]);
  });

  it("keeps the approval gate blocked when owner response postvalidation rejects an individual validator", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-live-run-gate-postvalidation-rejected-"));
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "all-decisions-ready",
      releaseGateStatus: "ready",
      queue: [
        queueItem({
          id: "production-release-run",
          rank: 1,
          status: "ready",
          category: "final-release-binding",
        }),
      ],
    });
    const preflight = writeJson(tmpDir, "preflight.json", {
      target: "owner-decision-live-run-preflight",
      status: "ready",
      releaseGateStatus: "ready",
      summary: {
        ownerDecisionQueueCount: 1,
        blockedReleaseGateRequirementCount: 0,
        enterpriseLiveEvidenceTargetCount: 1,
        acceptedEnterpriseLiveEvidenceCount: 1,
        releaseRunIdConsistency: "ready",
        releaseReady: true,
      },
      preflightOrder: [
        preflightStage({
          order: 1,
          id: "production-release-run",
          currentStatus: "ready",
        }),
      ],
    });
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      status: "ready",
      summary: { releaseReady: true },
    });
    const enterpriseAudit = writeJson(tmpDir, "enterprise-audit.json", {
      status: "ready",
      summary: {
        acceptedLiveEvidence: 1,
        missingRequiredTargetCount: 0,
      },
    });
    const ownerResponseCompletionValidation = writeJson(
      tmpDir,
      "owner-response-completion-validation.json",
      {
        target: "owner-decision-response-completion-validation",
        status: "owner-response-completion-accepted",
        summary: {
          ownerCompletionItemCount: 1,
          acceptedItemCount: 1,
          incompleteItemCount: 0,
          placeholderFieldTotal: 0,
          unsafeFindingTotal: 0,
          postValidationMayProceed: true,
          releaseReady: false,
        },
      },
    );
    const ownerResponsePostvalidationSuite = writeJson(
      tmpDir,
      "owner-response-postvalidation-suite.json",
      {
        target: "owner-decision-response-postvalidation-suite",
        status: "owner-response-postvalidation-rejected",
        summary: {
          extractionStatus: "owner-response-individual-files-created",
          requestedItemCount: 1,
          runnableItemCount: 1,
          executedValidationCount: 1,
          acceptedValidationCount: 0,
          incompleteValidationCount: 0,
          rejectedValidationCount: 1,
          failedValidationCount: 0,
          unsafeFindingTotal: 2,
          safetyAttentionCount: 2,
          releaseReady: false,
        },
        validationResults: [
          {
            rank: 1,
            decisionId: "app-auth-provider-production-selector",
            status: "owner-response-rejected",
            responseFileName: "owner-response.json",
          },
        ],
        leakedPath: "/Users/example/private/owner-response.json",
      },
    );

    const output = execFileSync("node", [
      "scripts/owner-decision-live-run-approval-gate.mjs",
      "--owner-decision-queue",
      ownerQueue,
      "--live-run-preflight",
      preflight,
      "--release-gate",
      releaseGate,
      "--enterprise-live-evidence-audit",
      enterpriseAudit,
      "--owner-response-completion-validation",
      ownerResponseCompletionValidation,
      "--owner-response-postvalidation-suite",
      ownerResponsePostvalidationSuite,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("approval-gate-blocked");
    expect(body.summary).toEqual(
      expect.objectContaining({
        ownerResponseCompletionStatus: "owner-response-completion-accepted",
        ownerResponsePostvalidationStatus: "owner-response-postvalidation-rejected",
        ownerResponsePostvalidationExecutedCount: 1,
        ownerResponsePostvalidationAcceptedCount: 0,
        ownerResponsePostvalidationRejectedCount: 1,
        ownerResponsePostvalidationUnsafeFindingTotal: 2,
        ownerResponsePostvalidationSafetyAttentionCount: 2,
        releaseReady: false,
      }),
    );
    expect(body.globalBlockingReasons).toContain(
      "owner-response-postvalidation-status-owner-response-postvalidation-rejected",
    );
    expect(body.globalBlockingReasons).toContain("owner-response-postvalidation-unsafe-findings");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/example/private");
  });

  it("does not treat production-evidence-only owner response status as a postvalidation failure", () => {
    const tmpDir = mkdtempSync(
      join(tmpdir(), "uais-owner-live-run-gate-postvalidation-awaiting-evidence-"),
    );
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      queue: [
        queueItem({
          id: "app-auth-provider-production-selector",
          rank: 1,
          status: "owner-decision-needed",
          category: "owner-decision",
        }),
      ],
    });
    const preflight = writeJson(tmpDir, "preflight.json", {
      target: "owner-decision-live-run-preflight",
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      summary: {
        ownerDecisionQueueCount: 1,
        blockedReleaseGateRequirementCount: 1,
        enterpriseLiveEvidenceTargetCount: 1,
        acceptedEnterpriseLiveEvidenceCount: 0,
        releaseRunIdConsistency: "missing",
        releaseReady: false,
      },
      preflightOrder: [
        preflightStage({
          order: 1,
          id: "app-auth-provider-production-selector",
          currentStatus: "owner-decision-needed",
        }),
      ],
    });
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      status: "blocked",
      summary: { releaseReady: false },
    });
    const enterpriseAudit = writeJson(tmpDir, "enterprise-audit.json", {
      status: "blocked",
      summary: {
        acceptedLiveEvidence: 0,
        missingRequiredTargetCount: 1,
      },
    });
    const ownerResponseCompletionValidation = writeJson(
      tmpDir,
      "owner-response-completion-validation.json",
      {
        target: "owner-decision-response-completion-validation",
        status: "owner-response-completion-incomplete",
        ownerDecisionQueueStatus: "owner-decisions-cleared-awaiting-production-evidence",
        sourceOwnerDecisionQueueStatus: "owner-decisions-required",
        summary: {
          ownerCompletionItemCount: 2,
          acceptedItemCount: 1,
          incompleteItemCount: 1,
          placeholderFieldTotal: 3,
          unsafeFindingTotal: 0,
          productionEvidenceRequired: true,
          postValidationMayProceed: false,
          releaseReady: false,
        },
        validationItems: [
          {
            rank: 1,
            decisionId: "app-auth-provider-production-selector",
            status: "owner-response-completion-accepted",
          },
          {
            rank: 2,
            decisionId: "ordinary-teaching-production-evidence",
            status: "owner-response-completion-incomplete",
          },
        ],
        firstIncompleteOwnerResponse: {
          rank: 2,
          decisionId: "ordinary-teaching-production-evidence",
          status: "owner-response-completion-incomplete",
          missingFieldCount: 0,
          placeholderFieldCount: 3,
          unsafeFindingCount: 0,
          confirmationFailureCount: 0,
          requiredOwnerInputFields: [
            "approvedAppAuthReadinessEvidenceLabel",
            "approvedTeacherAuthReadinessEvidenceLabel",
          ],
          ownerResponseValidationCommand:
            "node scripts/owner-decision-ordinary-teaching-production-evidence-response-validation.mjs --owner-response-template coordination/reports/ordinary-template.json --owner-response path/to/filled-owner-response.json",
        },
      },
    );
    const ownerResponsePostvalidationSuite = writeJson(
      tmpDir,
      "owner-response-postvalidation-suite.json",
      {
        target: "owner-decision-response-postvalidation-suite",
        status: "owner-response-postvalidation-awaiting-production-evidence",
        ownerDecisionQueueStatus: "owner-decisions-cleared-awaiting-production-evidence",
        sourceOwnerDecisionQueueStatus: "owner-decisions-required",
        productionEvidenceRequired: true,
        summary: {
          extractionStatus: "owner-response-extraction-blocked",
          requestedItemCount: 2,
          runnableItemCount: 0,
          executedValidationCount: 0,
          acceptedValidationCount: 0,
          incompleteValidationCount: 0,
          rejectedValidationCount: 0,
          failedValidationCount: 0,
          unsafeFindingTotal: 0,
          safetyAttentionCount: 0,
          releaseReady: false,
        },
        validationResults: [],
        blockedReasons: ["production-evidence-required"],
      },
    );

    const output = execFileSync("node", [
      "scripts/owner-decision-live-run-approval-gate.mjs",
      "--owner-decision-queue",
      ownerQueue,
      "--live-run-preflight",
      preflight,
      "--release-gate",
      releaseGate,
      "--enterprise-live-evidence-audit",
      enterpriseAudit,
      "--owner-response-completion-validation",
      ownerResponseCompletionValidation,
      "--owner-response-postvalidation-suite",
      ownerResponsePostvalidationSuite,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("approval-gate-blocked");
    expect(body.ownerDecisionQueueStatus).toBe(
      "owner-decisions-cleared-awaiting-production-evidence",
    );
    expect(body.ownerResponseCompletionStatus).toBe(
      "owner-response-completion-incomplete",
    );
    expect(body.ownerResponsePostvalidationStatus).toBe(
      "owner-response-postvalidation-awaiting-production-evidence",
    );
    expect(body.productionEvidenceRequired).toBe(true);
    expect(body.postValidationMayProceed).toBe(false);
    expect(body.globalBlockingReasons).toEqual([
      "release-gate-status-blocked",
      "preflight-status-owner-decisions-required",
      "enterprise-audit-status-blocked",
      "enterprise-live-targets-missing",
      "release-run-consistency-not-ready",
    ]);
    expect(output).not.toContain(tmpDir);

    const markdown = execFileSync("node", [
      "scripts/owner-decision-live-run-approval-gate.mjs",
      "--owner-decision-queue",
      ownerQueue,
      "--live-run-preflight",
      preflight,
      "--release-gate",
      releaseGate,
      "--enterprise-live-evidence-audit",
      enterpriseAudit,
      "--owner-response-completion-validation",
      ownerResponseCompletionValidation,
      "--owner-response-postvalidation-suite",
      ownerResponsePostvalidationSuite,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(markdown).toContain("## First Pending Production Evidence Labels");
    expect(markdown).toContain("Pending production evidence label fields:");
    expect(markdown).toContain("- `approvedAppAuthReadinessEvidenceLabel`");
    expect(markdown).not.toContain("Required owner input fields:");
    expect(markdown).not.toContain(tmpDir);
  });

  it("renders a markdown approval gate for S10 and S25 handoff", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-live-run-gate-md-"));
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      queue: [
        queueItem({
          id: "manual-ppt-playback-acceptance",
          rank: 1,
          status: "human-qa-needed",
          category: "human-qa",
        }),
      ],
    });
    const preflight = writeJson(tmpDir, "preflight.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      summary: { releaseReady: false },
      preflightOrder: [
        preflightStage({
          order: 1,
          id: "manual-ppt-playback-acceptance",
          currentStatus: "human-qa-needed",
        }),
      ],
    });
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      status: "blocked",
    });
    const enterpriseAudit = writeJson(tmpDir, "enterprise-audit.json", {
      status: "blocked",
      summary: { acceptedLiveEvidence: 0, missingRequiredTargetCount: 1 },
    });
    const ownerResponseCompletionValidation = writeJson(
      tmpDir,
      "owner-response-completion-validation.json",
      {
        target: "owner-decision-response-completion-validation",
        status: "owner-response-completion-incomplete",
        summary: {
          ownerCompletionItemCount: 1,
          acceptedItemCount: 0,
          incompleteItemCount: 1,
          placeholderFieldTotal: 2,
          individualValidationCommandCount: 1,
          postValidationMayProceed: false,
          releaseReady: false,
        },
        individualOwnerResponseValidationCommands: [
          {
            rank: 1,
            decisionId: "manual-ppt-playback-acceptance",
            ownerResponseValidationCommand:
              "node scripts/owner-decision-manual-ppt-playback-acceptance-response-validation.mjs --owner-response-template coordination/reports/manual-template.json --owner-response path/to/filled-owner-response.json",
          },
        ],
      },
    );

    const output = execFileSync("node", [
      "scripts/owner-decision-live-run-approval-gate.mjs",
      "--owner-decision-queue",
      ownerQueue,
      "--live-run-preflight",
      preflight,
      "--release-gate",
      releaseGate,
      "--enterprise-live-evidence-audit",
      enterpriseAudit,
      "--owner-response-completion-validation",
      ownerResponseCompletionValidation,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("# UAIS Owner Decision Live-Run Approval Gate");
    expect(output).toContain("Status: `approval-gate-blocked`");
    expect(output).toContain("Owner response individual validators: 1");
    expect(output).toContain("## Owner Response Validation Commands");
    expect(output).toContain(
      "node scripts/owner-decision-manual-ppt-playback-acceptance-response-validation.mjs --owner-response-template coordination/reports/manual-template.json --owner-response path/to/filled-owner-response.json",
    );
    expect(output).toContain("| 1 | `manual-ppt-playback-acceptance` | human-qa-needed | blocked | false |");
    expect(output).toContain("This report performs no live operation.");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });
});

function queueItem({
  id,
  rank,
  status,
  category,
}: {
  id: string;
  rank: number;
  status: string;
  category: string;
}) {
  return {
    id,
    rank,
    status,
    category,
    blockedReasons: [`${id}-blocked`],
    releaseGateRequirementIds: [`${id}-requirement`],
  };
}

function preflightStage({
  order,
  id,
  currentStatus,
}: {
  order: number;
  id: string;
  currentStatus: string;
}) {
  return {
    order,
    id,
    currentStatus,
    ownerSession: "S22",
    ownerInputRequired: `Owner input for ${id}`,
    requiredEvidence: [`${id}-evidence`],
    stopIf: [`${id}-stop-condition`],
  };
}

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}
