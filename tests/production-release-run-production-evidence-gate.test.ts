import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const releaseRunId = "UAIS-enterprise-run-2026-07-XX";
const provedEvidence = [
  "final-release-gate-ready",
  "owner-checklist-clear",
  "enterprise-live-evidence-audit-cleared",
  "one-public-release-run-id-used-across-production-evidence",
  "vercel-production-deployment-bound-to-release-run",
  "redacted-production-evidence-set-bound-to-release-run",
  "redacted-release-summary-ready",
  "rollback-or-hold-plan-present",
];

describe("production release-run production evidence gate", () => {
  it("keeps production release-run waiting until the final release gate is ready", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-production-release-run-gate-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const preflightPath = writeJson(reportsDir, "preflight.json", {
      target: "production-release-run-production-evidence-preflight",
      status: "production-release-run-production-evidence-preflight-waiting-for-final-release-gate",
      summary: {
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
        releaseReady: false,
      },
      blockedReasons: [
        "final-release-gate-not-ready",
        "enterprise-live-evidence-audit-not-ready",
        "release-run-consistency-not-cleared",
        "production-release-run-owner-response-not-accepted",
      ],
    });
    const enterpriseAuditGatePath = writeJson(reportsDir, "enterprise-audit-gate.json", {
      target: "enterprise-live-evidence-audit-production-evidence-gate",
      status:
        "enterprise-live-evidence-audit-production-evidence-gate-waiting-for-required-live-evidence",
      summary: {
        operatorInputRequired: true,
        blockingInputRequired: true,
        enterpriseLiveEvidenceAuditCleared: false,
        releaseReady: false,
      },
      safeNextAction: "provide-approved-env-source-path-to-s19",
      upstreamBlockingEvidence: {
        id: "upstream-ordinary-teaching-production-evidence-gate",
        valuesForbidden: true,
        upstreamMissingEvidence: ["approved-env-source-path"],
        upstreamOperatorInputPacket: {
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
          valuesForbidden: true,
        },
        upstreamSafeCommandTemplates: {
          approvedSourceHandleIntake:
            "node scripts/app-auth-env-source-intake.mjs --approved --evidence-handle <approved-source-handle> --production-env-source-handoff <production-env-source-handoff> --app-auth-preflight <app-auth-preflight> > <app-auth-env-source-intake-evidence>",
        },
      },
      sourceEvidenceHandle: "/Users/private/approved-app-auth.env",
    });

    const output = execFileSync("node", [
      "scripts/production-release-run-production-evidence-gate.mjs",
      "--production-release-run-preflight",
      preflightPath,
      "--enterprise-audit-gate",
      enterpriseAuditGatePath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "production-release-run-production-evidence-gate",
        status: "production-release-run-production-evidence-gate-waiting-for-final-release-gate",
        releaseReady: false,
        responsibleSession: "S22/S10/S25",
        summary: {
          operatorInputRequired: true,
          blockingInputRequired: true,
          ownerResponseAccepted: false,
          finalReleaseGateReady: false,
          enterpriseAuditPreflightCleared: false,
          releaseRunConsistencyCleared: false,
          releaseRunBindingApproved: false,
          preflightReady: false,
          enterpriseAuditGateProvided: true,
          enterpriseAuditGateAccepted: false,
          finalReleaseGateProvided: false,
          finalReleaseGateAccepted: false,
          releaseRunRecordProvided: false,
          releaseRunRecordAccepted: false,
          releaseRunBound: false,
          productionReleaseRunCleared: false,
          releaseReady: false,
        },
        enterpriseAuditGateStatus: {
          target: "enterprise-live-evidence-audit-production-evidence-gate",
          status: "not-cleared",
          releaseRunBound: false,
          valueRedacted: true,
        },
        finalReleaseGateStatus: {
          target: "production-e2e-release-gate",
          status: "missing",
          ownerDecisionQueueStatus: "missing",
          releaseRunConsistencyStatus: "missing",
          valueRedacted: true,
        },
        releaseRunRecordStatus: {
          target: "production-release-run",
          status: "missing",
          releaseRunIdStatus: "missing",
          valueRedacted: true,
        },
        blockedReasons: [
          "final-release-gate-not-ready",
          "enterprise-live-evidence-audit-not-ready",
          "release-run-consistency-not-cleared",
          "production-release-run-owner-response-not-accepted",
          "release-run-binding-not-approved-for-separate-owner-action",
          "enterprise-live-evidence-audit-gate-not-cleared",
          "final-release-gate-evidence-missing",
          "production-release-run-record-missing",
        ],
      }),
    );
    expect(body.upstreamBlockingEvidence).toEqual({
      id: "upstream-enterprise-live-evidence-audit-production-evidence-gate",
      label: "enterprise-live-evidence-audit-production-evidence-gate",
      reason:
        "Production release-run evidence must wait for final release gate and enterprise live-evidence audit evidence before release-run binding can be requested.",
      valuesForbidden: true,
      upstreamStatus:
        "enterprise-live-evidence-audit-production-evidence-gate-waiting-for-required-live-evidence",
      safeNextAction: "provide-approved-env-source-path-to-s19",
      upstreamOperatorInputRequired: true,
      upstreamMissingEvidence: ["approved-env-source-path"],
      upstreamOperatorInputPacket: {
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
        valuesForbidden: true,
      },
      upstreamSafeCommandTemplates: {
        approvedSourceHandleIntake:
          "node scripts/app-auth-env-source-intake.mjs --approved --evidence-handle <approved-source-handle> --production-env-source-handoff <production-env-source-handoff> --app-auth-preflight <app-auth-preflight> > <app-auth-env-source-intake-evidence>",
      },
    });
    expect(body.safeNextAction).toBe("provide-approved-env-source-path-to-s19");
    expect(body.safety).toEqual({
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      deploymentUrlsOmitted: true,
      cookieValuesOmitted: true,
      credentialValuesOmitted: true,
      responseBodiesOmitted: true,
      envFileRead: false,
      vercelApiCalled: false,
      liveSmokeRun: false,
      releaseGateRefreshPerformed: false,
      releaseRunBindingPerformed: false,
      noRemoteWritePerformed: true,
      noLiveMutationPerformed: true,
      noDeploymentMutationPerformed: true,
      noReleaseRunBindingPerformed: true,
      finalReleaseGateReadyEvidenceRequired: true,
      ownerApprovalRequired: true,
    });
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");

    const markdown = execFileSync("node", [
      "scripts/production-release-run-production-evidence-gate.mjs",
      "--production-release-run-preflight",
      preflightPath,
      "--enterprise-audit-gate",
      enterpriseAuditGatePath,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(markdown).toContain("Operator input required: `true`");
    expect(markdown).toContain("Safe next action: `provide-approved-env-source-path-to-s19`");
    expect(markdown).toContain("## Upstream Operator Input Packet");
    expect(markdown).toContain("- First required input: `approved-env-source-path`");
    expect(markdown).toContain("- Next command template: `approvedSourceHandleIntake`");
    expect(markdown).toContain("## Upstream Safe Operator Command Templates");
    expect(markdown).toContain(
      "`approvedSourceHandleIntake`: `node scripts/app-auth-env-source-intake.mjs --approved --evidence-handle <approved-source-handle>",
    );
    expect(markdown).not.toContain(tmpDir);
    expect(markdown).not.toContain("/Users/");
  });

  it("clears only with final release gate, enterprise audit gate, and release-run record bound together", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-production-release-run-gate-ready-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const fakeDeploymentUrl = "https://release.example.test/private";
    const fakeToken = "secret-release-run-token";
    const preflightPath = writeJson(reportsDir, "preflight.json", {
      target: "production-release-run-production-evidence-preflight",
      status: "production-release-run-production-evidence-preflight-ready",
      summary: {
        ownerResponseAccepted: true,
        releaseRunStageWaitingForUpstreamEvidence: true,
        packageGatePassed: true,
        packageGateReleaseReady: true,
        enterpriseAuditPreflightCleared: true,
        finalReleaseGateReady: true,
        releaseRunConsistencyCleared: true,
        releaseRunBindingMayProceedAfterSeparateOwnerAction: true,
        releaseRunBindingPerformed: false,
        waitingReleaseRunEvidenceCount: 0,
        matchedReleaseRunEvidenceCount: 16,
        releaseReady: false,
      },
      requiredEvidence: [
        "one-public-release-run-id-used-across-production-evidence",
        "final-release-gate-ready",
      ],
    });
    const enterpriseAuditGatePath = writeJson(reportsDir, "enterprise-audit-gate.json", {
      target: "enterprise-live-evidence-audit-production-evidence-gate",
      status: "enterprise-live-evidence-audit-production-evidence-gate-cleared",
      summary: {
        enterpriseLiveEvidenceAuditCleared: true,
        releaseRunBound: true,
        acceptedLiveEvidenceCount: 16,
        missingRequiredTargetCount: 0,
      },
      provedEvidence: [
        "body-level-production-live-evidence-audit-proof",
        "all-orchestrated-production-live-targets-present",
        "shared-release-run-id-across-production-live-evidence",
      ],
      releaseRunId,
      safety: { valueRedacted: true },
    });
    const finalReleaseGatePath = writeJson(reportsDir, "final-release-gate.json", {
      target: "production-e2e-release-gate",
      status: "ready",
      releaseGateStatus: "ready",
      ownerDecisionQueueStatus: "no-owner-decisions-required",
      releaseRunId,
      summary: {
        releaseReady: true,
        productionReleaseRunConsistencyStatus: "matched",
        waitingReleaseRunEvidenceCount: 0,
        matchedReleaseRunEvidenceCount: 16,
      },
      safety: {
        valuesRedacted: true,
        deploymentUrlsOmitted: true,
        cookieValuesOmitted: true,
        responseBodiesOmitted: true,
      },
      rawDeploymentUrl: fakeDeploymentUrl,
    });
    const releaseRunRecordPath = writeJson(reportsDir, "release-run-record.json", {
      target: "production-release-run",
      mode: "record",
      status: "bound",
      releaseRunId,
      finalReleaseGateStatus: "ready",
      ownerChecklistStatus: "no-owner-decisions-required",
      enterpriseAuditGateStatus: "cleared",
      sharedReleaseRunIdStatus: "matched",
      vercelProductionDeploymentStatus: "bound",
      productionEvidenceSetStatus: "matched",
      redactedReleaseSummaryStatus: "ready",
      rollbackOrHoldPlanStatus: "present",
      safety: {
        valuesRedacted: true,
        deploymentUrlsOmitted: true,
        cookieValuesOmitted: true,
        credentialValuesOmitted: true,
        responseBodiesOmitted: true,
        localPathsOmitted: true,
      },
      rawToken: fakeToken,
    });

    const output = execFileSync("node", [
      "scripts/production-release-run-production-evidence-gate.mjs",
      "--production-release-run-preflight",
      preflightPath,
      "--enterprise-audit-gate",
      enterpriseAuditGatePath,
      "--final-release-gate",
      finalReleaseGatePath,
      "--release-run-record",
      releaseRunRecordPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("production-release-run-production-evidence-gate-cleared");
    expect(body.releaseReady).toBe(false);
    expect(body.summary).toEqual({
      operatorInputRequired: false,
      blockingInputRequired: false,
      ownerResponseAccepted: true,
      finalReleaseGateReady: true,
      enterpriseAuditPreflightCleared: true,
      releaseRunConsistencyCleared: true,
      releaseRunBindingApproved: true,
      preflightReady: true,
      enterpriseAuditGateProvided: true,
      enterpriseAuditGateAccepted: true,
      finalReleaseGateProvided: true,
      finalReleaseGateAccepted: true,
      releaseRunRecordProvided: true,
      releaseRunRecordAccepted: true,
      releaseRunBound: true,
      productionReleaseRunCleared: true,
      releaseReady: false,
    });
    expect(body.enterpriseAuditGateStatus.status).toBe(
      "enterprise-live-evidence-audit-production-evidence-gate-cleared",
    );
    expect(body.finalReleaseGateStatus).toEqual({
      target: "production-e2e-release-gate",
      status: "ready",
      ownerDecisionQueueStatus: "no-owner-decisions-required",
      releaseRunConsistencyStatus: "matched",
      valueRedacted: true,
    });
    expect(body.releaseRunRecordStatus).toEqual({
      target: "production-release-run",
      status: "bound",
      releaseRunIdStatus: "matched",
      valueRedacted: true,
    });
    expect(body.provedEvidence).toEqual(provedEvidence);
    expect(body.safeNextAction).toBe("publish-redacted-production-release-run-summary");
    expect(output).not.toContain(fakeDeploymentUrl);
    expect(output).not.toContain(fakeToken);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });
});

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}
