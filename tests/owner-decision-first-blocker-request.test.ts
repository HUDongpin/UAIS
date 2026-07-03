import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("owner decision first-blocker request", () => {
  it("extracts the first blocked owner request from the approval gate and action packet", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-first-blocker-request-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const approvalGate = writeJson(tmpDir, "approval-gate.json", {
      target: "owner-decision-live-run-approval-gate",
      status: "approval-gate-blocked",
      firstBlockedStageId: "app-auth-provider-production-selector",
      summary: {
        stageCount: 2,
        runnableStageCount: 0,
        blockedStageCount: 2,
        ownerApprovalRequiredStageCount: 2,
        acceptedLiveEvidence: 0,
        missingEnterpriseLiveTargetCount: 2,
        releaseReady: false,
      },
      globalBlockingReasons: [
        "enterprise-live-targets-missing",
        "owner-response-postvalidation-status-owner-response-postvalidation-blocked",
      ],
      stages: [
        {
          order: 1,
          id: "app-auth-provider-production-selector",
          gateStatus: "blocked",
          canRun: false,
          queueStatus: "owner-decision-needed",
          currentStatus: "owner-decision-needed",
          blockingReasons: ["queue-status-owner-decision-needed"],
        },
        {
          order: 2,
          id: "teacher-auth-provider-production-selector",
          gateStatus: "blocked",
          canRun: false,
          queueStatus: "owner-decision-needed",
          currentStatus: "owner-decision-needed",
          blockingReasons: ["queue-status-owner-decision-needed"],
        },
      ],
      leakedPath: "/Users/example/private/approval-gate.json",
    });
    const preflight = writeJson(tmpDir, "preflight.json", {
      target: "owner-decision-live-run-preflight",
      status: "owner-decisions-required",
      preflightOrder: [
        {
          order: 1,
          id: "app-auth-provider-production-selector",
          currentStatus: "owner-decision-needed",
          ownerSession: "owner/S19/S22",
          ownerInputRequired: "Confirm production app auth provider mode and approved server-only env source.",
          requiredServerOnlyEnvNames: [
            "UAIS_APP_SESSION_SIGNING_SECRET",
            "UAIS_APP_AUTH_PROVIDER_TOKEN",
          ],
          requiredEvidence: [
            "vercel-env-sync-evidence-with-app-auth-env-present",
            "app-auth-provider-readiness-production-live-ready",
          ],
          safeNextAction: "After owner approval and S19 env sync evidence, run approved app-auth readiness.",
          stopIf: ["provider mode is not approved"],
        },
      ],
      leakedUrl: "https://private-app-auth.example.test",
    });
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "owner-decisions-required",
      queue: [
        {
          id: "app-auth-provider-production-selector",
          rank: 1,
          category: "owner-decision",
          status: "owner-decision-needed",
          nextOwnerQuestion: "Confirm production app auth provider mode and approved server-only env source.",
          blockedReasons: ["app-auth-provider-readiness-not-live-ready"],
          releaseGateRequirementIds: ["app-auth-provider-readiness"],
        },
      ],
      leakedCookie: "uais_teacher_auth_claims=secret",
    });
    writeJson(reportsDir, "2026-07-01-app-auth-owner-action-packet-enterprise-runthrough.json", {
      target: "app-auth-owner-action-packet",
      decisionId: "app-auth-provider-production-selector",
      status: "owner-decision-needed",
      queueRank: 1,
      classification: "owner-env-live-evidence-blocked",
      safeNextActions: [
        "confirm-production-app-auth-provider-mode",
        "bind-server-only-app-auth-env-through-s19-vercel-env-sync",
      ],
      forbiddenUntilApproved: [
        "inspect-or-print-app-auth-credential-values",
        "run-live-app-auth-provider-network-call",
      ],
      requiredEnvNames: [
        "UAIS_APP_SESSION_SIGNING_SECRET",
        "UAIS_APP_AUTH_PROVIDER_TOKEN",
      ],
      requiredEvidence: [
        "vercel-env-sync-evidence-with-app-auth-env-present",
        "app-auth-provider-readiness-production-live-ready",
      ],
      currentEvidenceSummary: {
        evidenceStatus: "dry-run-blocked",
        vercelEnvSyncStatus: "missing",
      },
      stopConditions: ["Stop if owner has not approved the app auth provider mode and env source."],
      safety: { sourcePathsOmitted: true, valuesRedacted: true },
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-first-blocker-request.mjs",
      "--approval-gate",
      approvalGate,
      "--live-run-preflight",
      preflight,
      "--owner-decision-queue",
      ownerQueue,
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
        target: "owner-decision-first-blocker-request",
        status: "owner-action-required",
        responsibleSession: "S22/S19/S10",
        firstBlockedStageId: "app-auth-provider-production-selector",
        summary: {
          approvalGateStatus: "approval-gate-blocked",
          stageCount: 2,
          blockedStageCount: 2,
          acceptedLiveEvidence: 0,
          missingEnterpriseLiveTargetCount: 2,
          releaseReady: false,
        },
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
    expect(body.ownerRequest).toEqual(
      expect.objectContaining({
        id: "app-auth-provider-production-selector",
        order: 1,
        queueRank: 1,
        queueStatus: "owner-decision-needed",
        currentStatus: "owner-decision-needed",
        ownerInputRequired: "Confirm production app auth provider mode and approved server-only env source.",
        actionPacketFileName: "2026-07-01-app-auth-owner-action-packet-enterprise-runthrough.json",
        actionPacketStatus: "owner-decision-needed",
        actionPacketClassification: "owner-env-live-evidence-blocked",
      }),
    );
    expect(body.ownerRequest.requiredServerOnlyEnvNames).toEqual([
      "UAIS_APP_SESSION_SIGNING_SECRET",
      "UAIS_APP_AUTH_PROVIDER_TOKEN",
    ]);
    expect(body.ownerRequest.safeNextActions).toContain("confirm-production-app-auth-provider-mode");
    expect(body.ownerRequest.forbiddenUntilApproved).toContain("run-live-app-auth-provider-network-call");
    expect(body.globalStillBlocked).toEqual([
      "enterprise-live-targets-missing",
      "owner-response-postvalidation-status-owner-response-postvalidation-blocked",
    ]);
    expect(body.globalBlockerRequest).toBeNull();
    expect(body.downstreamStillBlocked).toEqual([
      {
        order: 2,
        id: "teacher-auth-provider-production-selector",
        gateStatus: "blocked",
        currentStatus: "owner-decision-needed",
      },
    ]);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://private-app-auth.example.test");
    expect(output).not.toContain("uais_teacher_auth_claims=secret");
  });

  it("uses the approval-gate reconciled queue status when it differs from the stale owner queue", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-first-blocker-request-reconciled-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const approvalGate = writeJson(tmpDir, "approval-gate.json", {
      target: "owner-decision-live-run-approval-gate",
      status: "approval-gate-blocked",
      firstBlockedStageId: "app-auth-provider-production-selector",
      summary: {
        stageCount: 1,
        blockedStageCount: 1,
        acceptedLiveEvidence: 0,
        missingEnterpriseLiveTargetCount: 1,
        releaseReady: false,
      },
      globalBlockingReasons: ["enterprise-live-targets-missing"],
      stages: [
        {
          order: 1,
          id: "app-auth-provider-production-selector",
          gateStatus: "blocked",
          canRun: false,
          queueStatus: "accepted",
          currentStatus: "accepted-awaiting-production-evidence",
          blockingReasons: ["stage-status-accepted-awaiting-production-evidence"],
        },
      ],
    });
    const preflight = writeJson(tmpDir, "preflight.json", {
      target: "owner-decision-live-run-preflight",
      status: "owner-decisions-required",
      preflightOrder: [
        {
          order: 1,
          id: "app-auth-provider-production-selector",
          currentStatus: "owner-decision-needed",
          ownerSession: "owner/S19/S22",
          ownerInputRequired: "Produce app auth production readiness evidence.",
          safeNextAction: "Run app-auth readiness after S19 env sync evidence.",
        },
      ],
    });
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "owner-decisions-required",
      queue: [
        {
          id: "app-auth-provider-production-selector",
          rank: 1,
          category: "owner-decision",
          status: "owner-decision-needed",
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-first-blocker-request.mjs",
      "--approval-gate",
      approvalGate,
      "--live-run-preflight",
      preflight,
      "--owner-decision-queue",
      ownerQueue,
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-07-01",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.ownerRequest).toEqual(
      expect.objectContaining({
        id: "app-auth-provider-production-selector",
        queueStatus: "accepted",
        currentStatus: "accepted-awaiting-production-evidence",
        ownerInputRequired:
          "Owner response accepted; next required step: Run app-auth readiness after S19 env sync evidence.",
      }),
    );
    expect(body.firstOwnerAction).toBeNull();
    expect(body.firstOperatorAction).toEqual(
      expect.objectContaining({
        decisionId: "app-auth-provider-production-selector",
        queueStatus: "accepted",
        currentStatus: "accepted-awaiting-production-evidence",
      }),
    );
  });

  it("reports operator action when owner response is accepted but production evidence is missing", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-first-blocker-request-operator-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const approvalGate = writeJson(tmpDir, "approval-gate.json", {
      target: "owner-decision-live-run-approval-gate",
      status: "approval-gate-blocked",
      ownerDecisionQueueStatus: "owner-decisions-cleared-awaiting-production-evidence",
      sourceOwnerDecisionQueueStatus: "owner-decisions-required",
      firstBlockedStageId: "app-auth-provider-production-selector",
      summary: {
        stageCount: 1,
        blockedStageCount: 1,
        acceptedLiveEvidence: 0,
        missingEnterpriseLiveTargetCount: 1,
        releaseReady: false,
      },
      globalBlockingReasons: ["enterprise-live-targets-missing"],
      stages: [
        {
          order: 1,
          id: "app-auth-provider-production-selector",
          gateStatus: "blocked",
          canRun: false,
          queueStatus: "accepted",
          currentStatus: "accepted-awaiting-production-evidence",
          blockingReasons: ["stage-status-accepted-awaiting-production-evidence"],
        },
      ],
    });
    const preflight = writeJson(tmpDir, "preflight.json", {
      target: "owner-decision-live-run-preflight",
      status: "owner-decisions-cleared-awaiting-production-evidence",
      preflightOrder: [
        {
          order: 1,
          id: "app-auth-provider-production-selector",
          currentStatus: "accepted-awaiting-production-evidence",
          ownerSession: "S19/S22",
          ownerInputRequired: "Produce app auth production evidence.",
          safeNextAction: "After owner approval and S19 env sync evidence, run approved app-auth readiness.",
          requiredServerOnlyEnvNames: [
            "UAIS_APP_SESSION_SIGNING_SECRET",
            "UAIS_APP_AUTH_PROVIDER_TOKEN",
          ],
          requiredEvidence: [
            "vercel-env-sync-evidence-with-app-auth-env-present",
            "app-auth-provider-readiness-production-live-ready",
          ],
        },
      ],
    });
    const executionPlan = writeJson(tmpDir, "execution-plan.json", {
      target: "production-evidence-execution-plan",
      status: "production-evidence-execution-plan-awaiting-approved-env-source-path",
      firstWorkstreamId: "app-auth-provider-production-selector",
      firstSafeAction: "provide-approved-env-source-path-to-s19",
      operatorInputPacket: {
        target: "app-auth-env-source-intake-operator-input",
        status: "operator-approved-source-required",
        firstRequiredInputId: "approved-env-source-path",
        approvedServerOnlyEnvSourceLabel: "UAIS-production-app-auth-env-source",
        acceptedInputModes: ["approved-source-handle", "approved-env-file-presence"],
        requiredServerOnlyEnvNames: [
          "UAIS_APP_SESSION_SIGNING_SECRET",
          "UAIS_APP_AUTH_PROVIDER",
          "UAIS_APP_AUTH_PROVIDER_URL",
          "UAIS_APP_AUTH_PROVIDER_TOKEN",
        ],
        nextSafeAction: "provide-approved-env-source-path-to-s19",
        nextSafeCommandTemplateKey: "approvedSourceHandleIntake",
        preferredInputMode: "approved-source-handle",
        safeInputInstruction:
          "Provide an approved source handle or approved env-file presence proof to S19 only; do not paste raw values, URLs, cookies, credentials, or unredacted local paths into reports or chat.",
        approvedSourceLabelIsNotEvidence: true,
        valuesForbidden: true,
      },
      phases: [
        {
          id: "app-auth-provider-production-selector",
          nextSafeAction: "provide-approved-env-source-path-to-s19",
          missingEvidence: ["approved-env-source-path"],
          blockedReasons: ["approved-env-source-path-required"],
        },
      ],
    });
    const operatorEvidence = writeJson(tmpDir, "operator-evidence.json", {
      target: "app-auth-env-source-intake",
      status: "app-auth-env-source-intake-awaiting-approved-source-path",
      safeCommandTemplates: {
        approvedSourceHandleIntake:
          "node scripts/app-auth-env-source-intake.mjs --approved --evidence-handle <approved-source-handle> --production-env-source-handoff <production-env-source-handoff> --app-auth-preflight <app-auth-preflight> > <app-auth-env-source-intake-evidence>",
        approvedEnvFilePresenceIntake:
          "node scripts/app-auth-env-source-intake.mjs --live --approved --env-file <approved-env-file> --production-env-source-handoff <production-env-source-handoff> --app-auth-preflight <app-auth-preflight> > <app-auth-env-source-intake-evidence>",
      },
      sourceEvidenceHandle: "/Users/private/approved-app-auth.env",
    });
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "owner-decisions-required",
      queue: [
        {
          id: "app-auth-provider-production-selector",
          rank: 1,
          category: "owner-decision",
          status: "owner-decision-needed",
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-first-blocker-request.mjs",
      "--approval-gate",
      approvalGate,
      "--live-run-preflight",
      preflight,
      "--owner-decision-queue",
      ownerQueue,
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-07-01",
      "--production-evidence-execution-plan",
      executionPlan,
      "--operator-evidence",
      operatorEvidence,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("operator-action-required");
    expect(body.releaseReady).toBe(false);
    expect(body.ownerDecisionQueueStatus).toBe(
      "owner-decisions-cleared-awaiting-production-evidence",
    );
    expect(body.sourceOwnerDecisionQueueStatus).toBe("owner-decisions-required");
    expect(body.firstOwnerAction).toBeNull();
    expect(body.firstOperatorAction).toEqual(
      expect.objectContaining({
        decisionId: "app-auth-provider-production-selector",
        queueStatus: "accepted",
        currentStatus: "accepted-awaiting-production-evidence",
        requiredProductionEvidence: ["approved-env-source-path"],
        safeNextAction: "provide-approved-env-source-path-to-s19",
        safeCommandTemplates: {
          approvedSourceHandleIntake:
            "node scripts/app-auth-env-source-intake.mjs --approved --evidence-handle <approved-source-handle> --production-env-source-handoff <production-env-source-handoff> --app-auth-preflight <app-auth-preflight> > <app-auth-env-source-intake-evidence>",
          approvedEnvFilePresenceIntake:
            "node scripts/app-auth-env-source-intake.mjs --live --approved --env-file <approved-env-file> --production-env-source-handoff <production-env-source-handoff> --app-auth-preflight <app-auth-preflight> > <app-auth-env-source-intake-evidence>",
        },
        operatorInputPacket: {
          target: "app-auth-env-source-intake-operator-input",
          status: "operator-approved-source-required",
          firstRequiredInputId: "approved-env-source-path",
          approvedServerOnlyEnvSourceLabel: "UAIS-production-app-auth-env-source",
          acceptedInputModes: ["approved-source-handle", "approved-env-file-presence"],
          requiredServerOnlyEnvNames: [
            "UAIS_APP_SESSION_SIGNING_SECRET",
            "UAIS_APP_AUTH_PROVIDER",
            "UAIS_APP_AUTH_PROVIDER_URL",
            "UAIS_APP_AUTH_PROVIDER_TOKEN",
          ],
          nextSafeAction: "provide-approved-env-source-path-to-s19",
          nextSafeCommandTemplateKey: "approvedSourceHandleIntake",
          preferredInputMode: "approved-source-handle",
          safeInputInstruction:
            "Provide an approved source handle or approved env-file presence proof to S19 only; do not paste raw values, URLs, cookies, credentials, or unredacted local paths into reports or chat.",
          approvedSourceLabelIsNotEvidence: true,
          valuesForbidden: true,
        },
      }),
    );
    expect(body.ownerRequest.ownerInputRequired).toBe(
      "Owner response accepted; next required step: provide-approved-env-source-path-to-s19",
    );
    expect(body.ownerRequest.safeCommandTemplates).toEqual({
      approvedSourceHandleIntake:
        "node scripts/app-auth-env-source-intake.mjs --approved --evidence-handle <approved-source-handle> --production-env-source-handoff <production-env-source-handoff> --app-auth-preflight <app-auth-preflight> > <app-auth-env-source-intake-evidence>",
      approvedEnvFilePresenceIntake:
        "node scripts/app-auth-env-source-intake.mjs --live --approved --env-file <approved-env-file> --production-env-source-handoff <production-env-source-handoff> --app-auth-preflight <app-auth-preflight> > <app-auth-env-source-intake-evidence>",
    });
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");

    const markdown = execFileSync("node", [
      "scripts/owner-decision-first-blocker-request.mjs",
      "--approval-gate",
      approvalGate,
      "--live-run-preflight",
      preflight,
      "--owner-decision-queue",
      ownerQueue,
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-07-01",
      "--production-evidence-execution-plan",
      executionPlan,
      "--operator-evidence",
      operatorEvidence,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(markdown).toContain("Status: `operator-action-required`");
    expect(markdown).toContain("## First Operator Action");
    expect(markdown).toContain("Required production evidence: `approved-env-source-path`");
    expect(markdown).toContain("## Operator Input Packet");
    expect(markdown).toContain("- First required input: `approved-env-source-path`");
    expect(markdown).toContain("- Next command template: `approvedSourceHandleIntake`");
    expect(markdown).toContain("## Safe Operator Command Templates");
    expect(markdown).toContain(
      "`approvedSourceHandleIntake`: `node scripts/app-auth-env-source-intake.mjs --approved --evidence-handle <approved-source-handle>",
    );
    expect(markdown).toContain(
      "`approvedEnvFilePresenceIntake`: `node scripts/app-auth-env-source-intake.mjs --live --approved --env-file <approved-env-file>",
    );
    expect(markdown).not.toContain(tmpDir);
    expect(markdown).not.toContain("/Users/");
  });

  it("reports no owner action required when the approval gate is already ready", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-first-blocker-request-ready-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const approvalGate = writeJson(tmpDir, "approval-gate.json", {
      status: "approval-gate-ready",
      firstBlockedStageId: null,
      summary: {
        stageCount: 1,
        blockedStageCount: 0,
        acceptedLiveEvidence: 1,
        missingEnterpriseLiveTargetCount: 0,
        releaseReady: true,
      },
      stages: [
        {
          order: 1,
          id: "production-release-run",
          gateStatus: "ready",
          canRun: true,
          currentStatus: "ready",
        },
      ],
    });
    const preflight = writeJson(tmpDir, "preflight.json", {
      status: "ready",
      preflightOrder: [{ order: 1, id: "production-release-run", currentStatus: "ready" }],
    });
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "all-decisions-ready",
      queue: [{ id: "production-release-run", rank: 1, status: "ready" }],
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-first-blocker-request.mjs",
      "--approval-gate",
      approvalGate,
      "--live-run-preflight",
      preflight,
      "--owner-decision-queue",
      ownerQueue,
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-07-01",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("no-owner-action-required");
    expect(body.firstBlockedStageId).toBeNull();
    expect(body.ownerRequest).toBeNull();
    expect(body.downstreamStillBlocked).toEqual([]);
    expect(body.summary.releaseReady).toBe(true);

    const markdown = execFileSync("node", [
      "scripts/owner-decision-first-blocker-request.mjs",
      "--approval-gate",
      approvalGate,
      "--live-run-preflight",
      preflight,
      "--owner-decision-queue",
      ownerQueue,
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

    expect(markdown).toContain("First blocked stage: `none-recorded`");
    expect(markdown).not.toContain("First blocked stage: `none`");
  });

  it("does not report release ready when the approval gate is ready but owner queue is still waiting", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-first-blocker-request-owner-queue-waiting-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const approvalGate = writeJson(tmpDir, "approval-gate.json", {
      status: "approval-gate-ready",
      firstBlockedStageId: null,
      summary: {
        stageCount: 1,
        blockedStageCount: 0,
        acceptedLiveEvidence: 16,
        missingEnterpriseLiveTargetCount: 0,
        releaseReady: true,
      },
      globalBlockingReasons: [],
      stages: [
        {
          order: 1,
          id: "production-release-run",
          gateStatus: "ready",
          canRun: true,
          currentStatus: "ready",
        },
      ],
    });
    const preflight = writeJson(tmpDir, "preflight.json", {
      status: "ready",
      preflightOrder: [{ order: 1, id: "production-release-run", currentStatus: "ready" }],
    });
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "owner-decisions-required",
      queue: [
        {
          id: "app-auth-provider-production-selector",
          rank: 1,
          category: "owner-decision",
          status: "owner-decision-needed",
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-first-blocker-request.mjs",
      "--approval-gate",
      approvalGate,
      "--live-run-preflight",
      preflight,
      "--owner-decision-queue",
      ownerQueue,
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-07-01",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("owner-action-required");
    expect(body.ownerDecisionQueueStatus).toBe("owner-decisions-required");
    expect(body.firstBlockedStageId).toBeNull();
    expect(body.ownerRequest).toBeNull();
    expect(body.globalBlockerRequest).toEqual(
      expect.objectContaining({
        id: "approval-gate-global-blocker",
        blockingReasons: ["owner-queue-status-owner-decisions-required"],
      }),
    );
    expect(body.globalStillBlocked).toEqual(["owner-queue-status-owner-decisions-required"]);
    expect(body.summary.releaseReady).toBe(false);
  });

  it("does not mark release ready when a first owner action is still required", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-first-blocker-request-ready-false-positive-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const approvalGate = writeJson(tmpDir, "approval-gate.json", {
      status: "approval-gate-ready",
      firstBlockedStageId: "app-auth-provider-production-selector",
      summary: {
        stageCount: 1,
        blockedStageCount: 0,
        acceptedLiveEvidence: 16,
        missingEnterpriseLiveTargetCount: 0,
        releaseReady: true,
      },
      stages: [
        {
          order: 1,
          id: "app-auth-provider-production-selector",
          gateStatus: "blocked",
          canRun: false,
          queueStatus: "owner-decision-needed",
          currentStatus: "owner-decision-needed",
          blockingReasons: ["queue-status-owner-decision-needed"],
        },
      ],
    });
    const preflight = writeJson(tmpDir, "preflight.json", {
      status: "ready",
      preflightOrder: [
        {
          order: 1,
          id: "app-auth-provider-production-selector",
          currentStatus: "owner-decision-needed",
          ownerInputRequired: "Confirm production app auth provider mode and env source.",
        },
      ],
    });
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "owner-decisions-required",
      queue: [
        {
          id: "app-auth-provider-production-selector",
          rank: 1,
          category: "owner-decision",
          status: "owner-decision-needed",
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-first-blocker-request.mjs",
      "--approval-gate",
      approvalGate,
      "--live-run-preflight",
      preflight,
      "--owner-decision-queue",
      ownerQueue,
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-07-01",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("owner-action-required");
    expect(body.firstOwnerAction).toEqual(
      expect.objectContaining({
        decisionId: "app-auth-provider-production-selector",
        queueStatus: "owner-decision-needed",
        currentStatus: "owner-decision-needed",
      }),
    );
    expect(body.summary.releaseReady).toBe(false);
  });

  it("reports a global owner action when the approval gate is blocked without a stage blocker", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-first-blocker-request-global-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const approvalGate = writeJson(tmpDir, "approval-gate.json", {
      status: "approval-gate-blocked",
      firstBlockedStageId: null,
      summary: {
        stageCount: 1,
        blockedStageCount: 0,
        acceptedLiveEvidence: 1,
        missingEnterpriseLiveTargetCount: 0,
        releaseReady: false,
      },
      globalBlockingReasons: [
        "owner-response-postvalidation-status-owner-response-postvalidation-rejected",
        "owner-response-postvalidation-not-clean",
      ],
      stages: [
        {
          order: 1,
          id: "production-release-run",
          gateStatus: "ready",
          canRun: true,
          currentStatus: "ready",
        },
      ],
      leakedPath: "/Users/example/private/postvalidation-report.json",
    });
    const preflight = writeJson(tmpDir, "preflight.json", {
      status: "ready",
      preflightOrder: [{ order: 1, id: "production-release-run", currentStatus: "ready" }],
    });
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "all-decisions-ready",
      queue: [{ id: "production-release-run", rank: 1, status: "ready" }],
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-first-blocker-request.mjs",
      "--approval-gate",
      approvalGate,
      "--live-run-preflight",
      preflight,
      "--owner-decision-queue",
      ownerQueue,
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-07-01",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("owner-action-required");
    expect(body.firstBlockedStageId).toBeNull();
    expect(body.ownerRequest).toBeNull();
    expect(body.globalBlockerRequest).toEqual(
      expect.objectContaining({
        id: "approval-gate-global-blocker",
        gateStatus: "approval-gate-blocked",
        ownerInputRequired:
          "Resolve global approval-gate blockers before env apply, deployment, live smoke, or release-run binding.",
        blockingReasons: [
          "owner-response-postvalidation-status-owner-response-postvalidation-rejected",
          "owner-response-postvalidation-not-clean",
        ],
      }),
    );
    expect(body.globalBlockerRequest.safeNextActions).toContain(
      "review-owner-response-postvalidation-suite-report",
    );
    expect(body.globalBlockerRequest.forbiddenUntilResolved).toContain(
      "run-vercel-production-deploy",
    );
    expect(body.downstreamStillBlocked).toEqual([]);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");

    const markdown = execFileSync("node", [
      "scripts/owner-decision-first-blocker-request.mjs",
      "--approval-gate",
      approvalGate,
      "--live-run-preflight",
      preflight,
      "--owner-decision-queue",
      ownerQueue,
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

    expect(markdown).toContain("## Global Blocker Request");
    expect(markdown).toContain(
      "- `owner-response-postvalidation-status-owner-response-postvalidation-rejected`",
    );
    expect(markdown).toContain("- `review-owner-response-postvalidation-suite-report`");
    expect(markdown).toContain("First blocked stage: `none-recorded`");
    expect(markdown).not.toContain("First blocked stage: `none`");
    expect(markdown).not.toContain(tmpDir);
    expect(markdown).not.toContain("/Users/");
  });

  it("uses an action packet index when packet files come from an earlier evidence date", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-first-blocker-request-index-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const approvalGate = writeJson(tmpDir, "approval-gate.json", {
      status: "approval-gate-blocked",
      firstBlockedStageId: "app-auth-provider-production-selector",
      summary: {
        stageCount: 1,
        blockedStageCount: 1,
        acceptedLiveEvidence: 0,
        missingEnterpriseLiveTargetCount: 1,
        releaseReady: false,
      },
      stages: [
        {
          order: 1,
          id: "app-auth-provider-production-selector",
          gateStatus: "blocked",
          canRun: false,
          queueStatus: "owner-decision-needed",
          currentStatus: "owner-decision-needed",
        },
      ],
    });
    const preflight = writeJson(tmpDir, "preflight.json", {
      preflightOrder: [
        {
          order: 1,
          id: "app-auth-provider-production-selector",
          currentStatus: "owner-decision-needed",
          ownerInputRequired: "Confirm production app auth provider mode and env source.",
          requiredEvidence: ["app-auth-provider-readiness-production-live-ready"],
        },
      ],
    });
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "owner-decisions-required",
      queue: [
        {
          id: "app-auth-provider-production-selector",
          rank: 1,
          category: "owner-decision",
          status: "owner-decision-needed",
        },
      ],
    });
    writeJson(reportsDir, "2026-06-30-app-auth-owner-action-packet-enterprise-runthrough.json", {
      decisionId: "app-auth-provider-production-selector",
      status: "owner-decision-needed",
      queueRank: 1,
      classification: "owner-env-live-evidence-blocked",
      requiredEnvNames: ["UAIS_APP_AUTH_PROVIDER_TOKEN"],
      requiredEvidence: ["same-release-run-id-bound-to-app-auth-readiness"],
      safeNextActions: ["confirm-production-app-auth-provider-mode"],
      forbiddenUntilApproved: ["run-live-app-auth-provider-network-call"],
      stopConditions: ["Stop if owner approval is absent."],
      safety: { sourcePathsOmitted: true, secretValuesOmitted: true },
    });
    const packetIndex = writeJson(tmpDir, "packet-index.json", {
      target: "owner-decision-action-packet-index",
      status: "complete-action-packet-chain",
      generatedForDate: "2026-06-30",
      packets: [
        {
          decisionId: "app-auth-provider-production-selector",
          actionPacketFileName: "2026-06-30-app-auth-owner-action-packet-enterprise-runthrough.json",
        },
      ],
      leakedPath: "/Users/example/private/action-packet-index.json",
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-first-blocker-request.mjs",
      "--approval-gate",
      approvalGate,
      "--live-run-preflight",
      preflight,
      "--owner-decision-queue",
      ownerQueue,
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-07-01",
      "--action-packet-index",
      packetIndex,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.ownerRequest).toEqual(
      expect.objectContaining({
        actionPacketFileName: "2026-06-30-app-auth-owner-action-packet-enterprise-runthrough.json",
        actionPacketStatus: "owner-decision-needed",
        actionPacketClassification: "owner-env-live-evidence-blocked",
      }),
    );
    expect(body.ownerRequest.requiredServerOnlyEnvNames).toEqual(["UAIS_APP_AUTH_PROVIDER_TOKEN"]);
    expect(body.ownerRequest.safeNextActions).toEqual(["confirm-production-app-auth-provider-mode"]);
    expect(body.ownerRequest.forbiddenUntilApproved).toEqual([
      "run-live-app-auth-provider-network-call",
    ]);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");

    const markdown = execFileSync("node", [
      "scripts/owner-decision-first-blocker-request.mjs",
      "--approval-gate",
      approvalGate,
      "--live-run-preflight",
      preflight,
      "--owner-decision-queue",
      ownerQueue,
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-07-01",
      "--action-packet-index",
      packetIndex,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(markdown).toContain("## Safe Next Actions");
    expect(markdown).toContain("- `confirm-production-app-auth-provider-mode`");
    expect(markdown).toContain("## Forbidden Until Approved");
    expect(markdown).not.toContain(tmpDir);
    expect(markdown).not.toContain("/Users/");
  });

  it("includes the first blocker copy-safe owner reply stub from the completion packet", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-first-blocker-request-stub-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const approvalGate = writeJson(tmpDir, "approval-gate.json", {
      status: "approval-gate-blocked",
      firstBlockedStageId: "app-auth-provider-production-selector",
      summary: {
        stageCount: 1,
        blockedStageCount: 1,
        acceptedLiveEvidence: 0,
        missingEnterpriseLiveTargetCount: 1,
        releaseReady: false,
      },
      stages: [
        {
          order: 1,
          id: "app-auth-provider-production-selector",
          gateStatus: "blocked",
          canRun: false,
          currentStatus: "owner-decision-needed",
        },
      ],
    });
    const preflight = writeJson(tmpDir, "preflight.json", {
      preflightOrder: [
        {
          order: 1,
          id: "app-auth-provider-production-selector",
          currentStatus: "owner-decision-needed",
          ownerInputRequired: "Confirm production app auth provider mode and env source.",
        },
      ],
    });
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "owner-decisions-required",
      queue: [
        {
          id: "app-auth-provider-production-selector",
          rank: 1,
          category: "owner-decision",
          status: "owner-decision-needed",
        },
      ],
    });
    const completionPacket = writeJson(tmpDir, "completion-packet.json", {
      target: "owner-decision-response-completion-packet",
      status: "owner-response-completion-required",
      ownerCompletionItems: [
        {
          decisionId: "app-auth-provider-production-selector",
          validationStatus: "owner-response-incomplete",
          ownerResponseStatus: "owner-response-provided",
          templateFileName: "2026-07-01-owner-decision-app-auth-response-template-enterprise-runthrough.json",
          validationFileName: "2026-07-01-owner-decision-app-auth-response-validation-enterprise-runthrough.json",
          missingFieldCount: 2,
          requiredOwnerInputFields: [
            "approvedServerOnlyEnvSourceLabel",
            "approvedReleaseRunIdLabel",
          ],
          requiredOwnerLabelFields: [
            "approvedServerOnlyEnvSourceLabel",
            "approvedReleaseRunIdLabel",
          ],
          blockedReasons: [
            "approvedServerOnlyEnvSourceLabel-missing-or-invalid",
            "approvedReleaseRunIdLabel-missing-or-invalid",
          ],
          stillForbiddenUntilSeparateApproval: [
            "run-live-app-auth-provider-network-call",
            "run-vercel-env-apply",
            "run-vercel-production-deploy",
            "bind-production-release-run-id",
          ],
          copySafeOwnerReplyStub: {
            responseStatus: "owner-response-provided",
            decisionId: "app-auth-provider-production-selector",
            ownerApprovedProviderMode: "trusted-account-provider",
            approvedServerOnlyEnvSourceLabel: "<label only; no credential values>",
            approvedReleaseRunIdLabel: "<label only; no URL, token, or cookie>",
            confirmsNoCredentialValuesInResponse: true,
          },
        },
      ],
      leakedPath: "/Users/example/private/completion-packet.json",
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-first-blocker-request.mjs",
      "--approval-gate",
      approvalGate,
      "--live-run-preflight",
      preflight,
      "--owner-decision-queue",
      ownerQueue,
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-07-01",
      "--owner-response-completion-packet",
      completionPacket,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.firstOwnerAction).toEqual({
      decisionId: "app-auth-provider-production-selector",
      queueStatus: "owner-decision-needed",
      currentStatus: "owner-decision-needed",
      ownerInputRequired: "Confirm production app auth provider mode and env source.",
      validationStatus: "owner-response-incomplete",
      missingFieldCount: 2,
      requiredOwnerInputFields: [
        "approvedServerOnlyEnvSourceLabel",
        "approvedReleaseRunIdLabel",
      ],
      ownerResponseValidationCommand:
        "node scripts/owner-decision-app-auth-response-validation.mjs --owner-response-template coordination/reports/2026-07-01-owner-decision-app-auth-response-template-enterprise-runthrough.json --owner-response path/to/filled-owner-response.json",
      copySafeOwnerReplyStubAvailable: true,
      forbiddenUntilApproved: [
        "run-live-app-auth-provider-network-call",
        "run-vercel-env-apply",
        "run-vercel-production-deploy",
        "bind-production-release-run-id",
      ],
    });
    expect(body.ownerRequest.ownerResponseCompletion).toEqual({
      validationStatus: "owner-response-incomplete",
      ownerResponseStatus: "owner-response-provided",
      templateFileName: "2026-07-01-owner-decision-app-auth-response-template-enterprise-runthrough.json",
      validationFileName: "2026-07-01-owner-decision-app-auth-response-validation-enterprise-runthrough.json",
      ownerResponseValidationCommand:
        "node scripts/owner-decision-app-auth-response-validation.mjs --owner-response-template coordination/reports/2026-07-01-owner-decision-app-auth-response-template-enterprise-runthrough.json --owner-response path/to/filled-owner-response.json",
      missingFieldCount: 2,
      requiredOwnerInputFields: [
        "approvedServerOnlyEnvSourceLabel",
        "approvedReleaseRunIdLabel",
      ],
      requiredOwnerLabelFields: [
        "approvedServerOnlyEnvSourceLabel",
        "approvedReleaseRunIdLabel",
      ],
      blockedReasons: [
        "approvedServerOnlyEnvSourceLabel-missing-or-invalid",
        "approvedReleaseRunIdLabel-missing-or-invalid",
      ],
      stillForbiddenUntilSeparateApproval: [
        "run-live-app-auth-provider-network-call",
        "run-vercel-env-apply",
        "run-vercel-production-deploy",
        "bind-production-release-run-id",
      ],
      postValidationAllowedChecks: [],
      copySafeOwnerReplyStub: {
        responseStatus: "owner-response-provided",
        decisionId: "app-auth-provider-production-selector",
        ownerApprovedProviderMode: "trusted-account-provider",
        approvedServerOnlyEnvSourceLabel: "<label only; no credential values>",
        approvedReleaseRunIdLabel: "<label only; no URL, token, or cookie>",
        confirmsNoCredentialValuesInResponse: true,
      },
    });
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");

    const markdown = execFileSync("node", [
      "scripts/owner-decision-first-blocker-request.mjs",
      "--approval-gate",
      approvalGate,
      "--live-run-preflight",
      preflight,
      "--owner-decision-queue",
      ownerQueue,
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-07-01",
      "--owner-response-completion-packet",
      completionPacket,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(markdown).toContain("## Owner Response Completion");
    expect(markdown).toContain("- `approvedServerOnlyEnvSourceLabel`");
    expect(markdown).toContain("## Still Forbidden Until Separate Approval");
    expect(markdown).toContain("- `run-vercel-env-apply`");
    expect(markdown).toContain("- `run-vercel-production-deploy`");
    expect(markdown).toContain("- `bind-production-release-run-id`");
    expect(markdown).toContain("## Validation Command");
    expect(markdown).toContain(
      "node scripts/owner-decision-app-auth-response-validation.mjs --owner-response-template coordination/reports/2026-07-01-owner-decision-app-auth-response-template-enterprise-runthrough.json --owner-response path/to/filled-owner-response.json",
    );
    expect(markdown).toContain("## Copy-Safe Owner Reply Stub");
    expect(markdown).toContain("\"approvedReleaseRunIdLabel\": \"<label only; no URL, token, or cookie>\"");
    expect(markdown).not.toContain(tmpDir);
    expect(markdown).not.toContain("/Users/");
  });

  it("renders a concise markdown owner request", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-first-blocker-request-md-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const approvalGate = writeJson(tmpDir, "approval-gate.json", {
      status: "approval-gate-blocked",
      firstBlockedStageId: "manual-ppt-playback-acceptance",
      summary: {
        stageCount: 1,
        blockedStageCount: 1,
        acceptedLiveEvidence: 0,
        missingEnterpriseLiveTargetCount: 1,
        releaseReady: false,
      },
      globalBlockingReasons: ["enterprise-live-targets-missing"],
      stages: [
        {
          order: 1,
          id: "manual-ppt-playback-acceptance",
          gateStatus: "blocked",
          canRun: false,
          currentStatus: "human-qa-needed",
        },
      ],
    });
    const preflight = writeJson(tmpDir, "preflight.json", {
      preflightOrder: [
        {
          order: 1,
          id: "manual-ppt-playback-acceptance",
          currentStatus: "human-qa-needed",
          ownerInputRequired: "Complete human PowerPoint and WPS playback acceptance.",
          requiredEvidence: ["human-powerpoint-playback-accepted"],
          stopIf: ["PowerPoint playback is incomplete"],
        },
      ],
    });
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "owner-decisions-required",
      queue: [
        {
          id: "manual-ppt-playback-acceptance",
          rank: 1,
          category: "human-qa",
          status: "human-qa-needed",
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-first-blocker-request.mjs",
      "--approval-gate",
      approvalGate,
      "--live-run-preflight",
      preflight,
      "--owner-decision-queue",
      ownerQueue,
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

    expect(output).toContain("# UAIS Owner Decision First-Blocker Request");
    expect(output).toContain("Status: `owner-action-required`");
    expect(output).toContain("First blocked stage: `manual-ppt-playback-acceptance`");
    expect(output).toContain("Complete human PowerPoint and WPS playback acceptance.");
    expect(output).toContain("## Global Still Blocked");
    expect(output).toContain("- `enterprise-live-targets-missing`");
    expect(output).toContain("This report performs no live operation.");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });
});

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}
