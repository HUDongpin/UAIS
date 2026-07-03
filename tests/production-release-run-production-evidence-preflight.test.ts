import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("production release-run production evidence preflight", () => {
  it("keeps release-run binding blocked until final release gate and enterprise audit evidence are ready", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-production-release-run-preflight-"));
    const ownerResponseValidation = writeJson(tmpDir, "owner-response-validation.json", {
      target: "owner-decision-production-release-run-response-validation",
      status: "owner-response-incomplete",
      decisionId: "production-release-run",
      summary: {
        missingFieldCount: 8,
        unsafeFindingCount: 0,
        finalReleaseSummaryMayProceed: false,
        releaseRunBindingMayProceedAfterSeparateOwnerAction: false,
        releaseRunBindingPerformed: false,
        releaseReady: false,
      },
      requiredEvidenceAfterApproval: [
        "one-public-release-run-id-used-across-production-evidence",
        "final-release-gate-ready",
      ],
      requiredCommandNames: ["finalReleaseGateCheck", "releaseRunBindingReview"],
      stillForbiddenUntilSeparateApproval: [
        "bind-release-run-id-in-this-validation-script",
        "bind-release-run-id-while-release-gate-blocked",
      ],
    });
    const approvalGate = writeJson(tmpDir, "approval-gate.json", {
      target: "owner-decision-live-run-approval-gate",
      status: "approval-gate-blocked",
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      summary: {
        releaseReady: false,
      },
      stages: [
        {
          id: "production-release-run",
          queueStatus: "waiting-for-upstream-evidence",
          currentStatus: "waiting-for-upstream-evidence",
          ownerResponseAccepted: false,
          releaseGateRequirementIds: [
            "enterprise-live-evidence-audit",
            "production-release-run-consistency",
          ],
          requiredEvidence: [
            "one-public-release-run-id-used-across-production-evidence",
            "final-release-gate-ready",
          ],
        },
      ],
    });
    const actionPacket = writeJson(tmpDir, "action-packet.json", {
      target: "production-release-run-action-packet",
      status: "waiting-for-upstream-evidence",
      releaseGateStatus: "blocked",
      decisionId: "production-release-run",
      blockedReasons: [
        "enterprise-live-evidence-audit-not-ready",
        "production-release-run-consistency-not-ready",
      ],
      requiredEvidence: [
        "one-public-release-run-id-used-across-production-evidence",
        "final-release-gate-ready",
      ],
      currentEvidenceSummary: {
        requirementStatus: "blocked",
        evidenceStatus: "waiting-for-production-evidence",
        blockedReason: "vercel-production-deployment-not-proven",
        waitingReleaseRunEvidenceCount: 15,
        presentReleaseRunEvidenceCount: 1,
        matchedReleaseRunEvidenceCount: 0,
        matchStatus: "waiting",
      },
      releaseGateRequirementIds: [
        "enterprise-live-evidence-audit",
        "production-release-run-consistency",
      ],
      enterpriseAuditMissingTargets: [
        "app-auth-provider-readiness",
        "teacher-auth-provider-readiness",
      ],
      commands: {
        finalReleaseGateCheck:
          "node -- scripts/production-e2e-release-gate.mjs <release-gate-inputs> > <production-e2e-release-gate-output>",
        releaseRunBindingReview:
          "review production-release-run-consistency in <production-e2e-release-gate-output> and bind one public release-run ID only after status is ready",
      },
      safeNextActions: [
        "wait-for-final-release-gate-ready",
        "prepare-redacted-production-release-run-summary-after-owner-approval",
      ],
      forbiddenUntilApproved: [
        "bind-release-run-id-while-release-gate-blocked",
        "mix-production-evidence-from-multiple-release-run-ids",
      ],
    });
    const enterpriseAuditPreflight = writeJson(tmpDir, "enterprise-audit-preflight.json", {
      target: "enterprise-live-evidence-audit-production-evidence-preflight",
      status:
        "enterprise-live-evidence-audit-production-evidence-preflight-waiting-for-required-live-evidence",
      releaseReady: false,
      summary: {
        liveEvidenceTargetsCleared: false,
        upstreamProductionPreflightsCleared: false,
        releaseRunConsistencyCleared: false,
        missingRequiredTargetCount: 16,
      },
      upstreamBlockers: [
        "app-auth-production-evidence-not-cleared",
        "vercel-production-deployment-evidence-not-cleared",
      ],
    });
    const packageGate = writeJson(tmpDir, "package-gate.json", {
      target: "enterprise-runthrough-package-gate",
      status: "package-gate-passed",
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      summary: {
        dirtyEntryCount: 240,
        aggregatePathspecCount: 240,
        missingDirtyPathCount: 0,
        stalePathspecCount: 0,
        duplicatePathspecCount: 0,
        wildcardPathspecCount: 0,
        releaseReady: false,
      },
    });

    const output = execFileSync("node", [
      "scripts/production-release-run-production-evidence-preflight.mjs",
      "--owner-response-validation",
      ownerResponseValidation,
      "--approval-gate",
      approvalGate,
      "--production-release-run-action-packet",
      actionPacket,
      "--enterprise-audit-preflight",
      enterpriseAuditPreflight,
      "--package-gate",
      packageGate,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "production-release-run-production-evidence-preflight",
        status:
          "production-release-run-production-evidence-preflight-waiting-for-final-release-gate",
        releaseReady: false,
        ownerDecisionId: "production-release-run",
      }),
    );
    expect(body.summary).toEqual({
      ownerResponseAccepted: false,
      releaseRunStageWaitingForUpstreamEvidence: true,
      packageGatePassed: true,
      packageGateReleaseReady: false,
      enterpriseAuditPreflightCleared: false,
      finalReleaseGateReady: false,
      releaseRunConsistencyCleared: false,
      releaseRunBindingMayProceedAfterSeparateOwnerAction: false,
      releaseRunBindingPerformed: false,
      waitingReleaseRunEvidenceCount: 15,
      matchedReleaseRunEvidenceCount: 0,
      requiredEvidenceCount: 2,
      commandTemplateCount: 2,
      releaseReady: false,
    });
    expect(body.upstreamBlockers).toEqual([
      "enterprise-live-evidence-audit-not-ready",
      "package-gate-not-release-ready",
      "app-auth-production-evidence-not-cleared",
      "vercel-production-deployment-evidence-not-cleared",
    ]);
    expect(body.blockedReasons).toContain("final-release-gate-not-ready");
    expect(body.blockedReasons).toContain("release-run-consistency-not-cleared");
    expect(body.blockedReasons).toContain("production-release-run-owner-response-not-accepted");
    expect(body.safety).toEqual(
      expect.objectContaining({
        envFileRead: false,
        rawUrlsOmittedFromMarkdown: true,
        cookieValuesOmitted: true,
        credentialValuesOmitted: true,
        responseBodiesOmitted: true,
        releaseRunBindingPerformed: false,
        noLiveMutationPerformed: true,
        noDeploymentMutationPerformed: true,
        noReleaseRunBindingPerformed: true,
      }),
    );

    const markdown = execFileSync("node", [
      "scripts/production-release-run-production-evidence-preflight.mjs",
      "--owner-response-validation",
      ownerResponseValidation,
      "--approval-gate",
      approvalGate,
      "--production-release-run-action-packet",
      actionPacket,
      "--enterprise-audit-preflight",
      enterpriseAuditPreflight,
      "--package-gate",
      packageGate,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(markdown).toContain("# UAIS Production Release Run Production Evidence Preflight");
    expect(markdown).toContain(
      "Status: `production-release-run-production-evidence-preflight-waiting-for-final-release-gate`",
    );
    expect(markdown).toContain("## Safe Command Templates");
    expect(markdown).not.toContain("https://");
    expect(markdown).not.toContain("/Users/");
  });

  it("stays blocked when the production release-run stage is missing from the approval gate", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-production-release-run-preflight-blocked-"));
    const ownerResponseValidation = writeJson(tmpDir, "owner-response-validation.json", {
      status: "owner-response-incomplete",
      summary: { releaseRunBindingPerformed: false },
    });
    const approvalGate = writeJson(tmpDir, "approval-gate.json", { stages: [] });
    const actionPacket = writeJson(tmpDir, "action-packet.json", {});
    const enterpriseAuditPreflight = writeJson(tmpDir, "enterprise-audit-preflight.json", {});
    const packageGate = writeJson(tmpDir, "package-gate.json", {});

    const output = execFileSync("node", [
      "scripts/production-release-run-production-evidence-preflight.mjs",
      "--owner-response-validation",
      ownerResponseValidation,
      "--approval-gate",
      approvalGate,
      "--production-release-run-action-packet",
      actionPacket,
      "--enterprise-audit-preflight",
      enterpriseAuditPreflight,
      "--package-gate",
      packageGate,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("production-release-run-production-evidence-preflight-blocked");
    expect(body.summary.releaseRunStageWaitingForUpstreamEvidence).toBe(false);
    expect(body.blockedReasons).toContain(
      "production-release-run-stage-not-waiting-for-upstream-evidence",
    );
  });
});

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}
