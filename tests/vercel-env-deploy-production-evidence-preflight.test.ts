import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("vercel env deploy production evidence preflight", () => {
  it("turns accepted S19/S22 approval into a redacted evidence preflight waiting on upstream providers", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-deploy-evidence-preflight-"));
    const ownerResponseValidation = writeJson(tmpDir, "owner-response-validation.json", {
      target: "owner-decision-vercel-env-deploy-response-validation",
      status: "owner-response-accepted",
      decisionId: "vercel-env-deploy-and-smoke-chain",
      summary: {
        s19EnvApplyPrepMayProceed: true,
        s19EnvApplyRunApproved: true,
        s22DeployPrepMayProceed: true,
        s22ProductionDeployRunApproved: true,
        deployedSmokePrepMayProceed: true,
        deployedSmokeRunApproved: true,
        vercelLiveRunApproved: true,
        liveChainStillForbidden: true,
        liveProviderGenerationSmokeRequiresSeparateApproval: true,
        releaseReady: false,
      },
      redactedOwnerResponse: {
        approvedVercelProjectReadinessLabel: "UAIS-Vercel-project-readiness-approved",
        approvedServerOnlyEnvSourceLabel: "UAIS-production-server-only-env-source-set",
        approvedVercelEnvSyncApplyEvidenceLabel:
          "UAIS-S19-Vercel-env-sync-apply-evidence-label",
        approvedProductionDeploymentEvidenceLabel:
          "UAIS-S22-production-deployment-evidence-label",
        approvedDeploymentBaseUrlLabel: "UAIS-production-deployment-base-url-label",
        approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
      },
      postValidationAllowedChecks: [
        "prepare-s19-vercel-env-sync-apply-command-after-upstream-auth-storage-clears",
        "prepare-s22-production-deployment-command-after-env-sync-evidence",
        "prepare-deployed-route-smoke-commands-after-production-deployment-evidence",
        "prepare-ordinary-teaching-live-smoke-commands-after-auth-storage-deployment-readiness",
      ],
      stillForbiddenUntilSeparateApproval: [
        "run-vercel-env-apply-without-owner-approval",
        "run-vercel-production-deploy-without-owner-approval",
        "bind-production-release-run-id",
      ],
    });
    const approvalGate = writeJson(tmpDir, "approval-gate.json", {
      target: "owner-decision-live-run-approval-gate",
      status: "approval-gate-blocked",
      stages: [
        {
          id: "app-auth-provider-production-selector",
          queueStatus: "accepted",
          currentStatus: "accepted-awaiting-production-evidence",
          ownerResponseAccepted: true,
        },
        {
          id: "teacher-auth-provider-production-selector",
          queueStatus: "accepted",
          currentStatus: "accepted-awaiting-production-evidence",
          ownerResponseAccepted: true,
        },
        {
          id: "external-storage-production-service",
          queueStatus: "accepted",
          currentStatus: "accepted-awaiting-production-evidence",
          ownerResponseAccepted: true,
        },
        {
          id: "vercel-env-deploy-and-smoke-chain",
          queueStatus: "accepted",
          currentStatus: "accepted-awaiting-production-evidence",
          ownerResponseAccepted: true,
          requiredEvidence: [
            "vercel-project-readiness-current",
            "vercel-env-sync-apply-production-and-preview",
            "vercel-production-deployment-evidence",
            "deployment-domain-reachability",
            "same-release-run-id-bound-to-env-deploy-and-smokes",
          ],
          requiredServerOnlyEnvNames: ["VERCEL_TOKEN"],
        },
      ],
    });
    const actionPacket = writeJson(tmpDir, "action-packet.json", {
      target: "vercel-env-deploy-chain-action-packet",
      status: "waiting-for-upstream-owner-decisions",
      decisionId: "vercel-env-deploy-and-smoke-chain",
      currentEvidenceSummary: {
        vercelProjectSelectionStatus: "satisfied",
        envApplyStatus: "missing",
        productionDeploymentStatus: "missing",
        deployedSmokeStatus: "missing",
        releaseRunBindingStatus: "missing",
      },
      requiredEvidence: [
        "vercel-project-readiness-current",
        "vercel-env-sync-apply-production-and-preview",
        "vercel-production-deployment-evidence",
        "deployment-domain-reachability",
        "deployment-route-smoke-live-passed",
        "teacher-workflow-deployment-smoke-live-passed",
        "teacher-workflow-browser-smoke-live-passed",
        "teacher-workflow-live-generation-smoke-live-passed",
        "learning-ppt-playback-deployment-smoke-live-passed",
        "teaching-operations-route-smoke-live-passed",
        "teaching-operation-detail-browser-smoke-live-passed",
        "teaching-course-management-route-smoke-live-passed",
        "same-release-run-id-bound-to-env-deploy-and-smokes",
      ],
      commands: {
        vercelEnvSyncApply:
          "node scripts/vercel-env-sync.mjs --apply --approved --scope full --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <vercel-env-sync-evidence>",
        vercelProductionDeployment:
          "node scripts/vercel-production-deployment-evidence.mjs --live --approved --deploy --environment production --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --vercel-env-sync <vercel-env-sync-evidence> --release-run-id <release-run-id> > <vercel-production-deployment-evidence>",
        deploymentReachability:
          "node scripts/deployment-reachability-diagnostics.mjs --live --approved --environment production --base-url <deployment-url> --domain-reachability-evidence --release-run-id <release-run-id> > <deployment-domain-reachability-evidence>",
      },
      forbiddenUntilApproved: [
        "print-or-log-vercel-env-secret-values",
        "run-deployed-route-smokes-before-production-deployment-evidence",
      ],
      safeNextActions: [
        "run-redacted-vercel-env-sync-apply-with-approved-project-and-release-run-id",
      ],
    });
    const appAuthPreflight = writeJson(tmpDir, "app-auth-preflight.json", {
      status: "app-auth-production-evidence-preflight-ready",
      releaseReady: false,
      summary: { missingEvidenceCount: 3 },
    });
    const teacherAuthPreflight = writeJson(tmpDir, "teacher-auth-preflight.json", {
      status: "teacher-auth-production-evidence-preflight-waiting-for-upstream-app-auth",
      releaseReady: false,
      summary: { missingEvidenceCount: 4 },
    });
    const externalStoragePreflight = writeJson(tmpDir, "external-storage-preflight.json", {
      status: "external-storage-production-evidence-preflight-waiting-for-upstream-auth",
      releaseReady: false,
      summary: { missingEvidenceCount: 5 },
    });

    const output = execFileSync("node", [
      "scripts/vercel-env-deploy-production-evidence-preflight.mjs",
      "--owner-response-validation",
      ownerResponseValidation,
      "--approval-gate",
      approvalGate,
      "--vercel-env-deploy-action-packet",
      actionPacket,
      "--app-auth-preflight",
      appAuthPreflight,
      "--teacher-auth-preflight",
      teacherAuthPreflight,
      "--external-storage-preflight",
      externalStoragePreflight,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "vercel-env-deploy-production-evidence-preflight",
        status:
          "vercel-env-deploy-production-evidence-preflight-waiting-for-upstream-provider-evidence",
        releaseReady: false,
        ownerDecisionId: "vercel-env-deploy-and-smoke-chain",
      }),
    );
    expect(body.summary).toEqual({
      ownerResponseAccepted: true,
      vercelStageAcceptedAwaitingEvidence: true,
      upstreamProviderEvidenceCleared: false,
      s19EnvApplyPrepMayProceedAfterUpstreamReady: true,
      s19EnvApplyRunApprovedAfterUpstreamReady: true,
      s22DeployPrepMayProceedAfterEnvApplyEvidence: true,
      s22ProductionDeployRunApprovedAfterEnvApplyEvidence: true,
      deployedSmokePrepMayProceedAfterProductionDeploymentEvidence: true,
      deployedSmokeRunApprovedAfterProductionDeploymentEvidence: true,
      vercelLiveRunApproved: true,
      liveChainStillForbidden: true,
      liveProviderGenerationSmokeRequiresSeparateApproval: true,
      requiredServerOnlyEnvNameCount: 1,
      requiredEvidenceCount: 13,
      missingEvidenceCount: 12,
      commandTemplateCount: 11,
      releaseReady: false,
    });
    expect(body.provedPrerequisiteEvidence).toEqual(["vercel-project-readiness-current"]);
    expect(body.missingEvidence).toEqual([
      "vercel-env-sync-apply-production-and-preview",
      "vercel-production-deployment-evidence",
      "deployment-domain-reachability",
      "deployment-route-smoke-live-passed",
      "teacher-workflow-deployment-smoke-live-passed",
      "teacher-workflow-browser-smoke-live-passed",
      "teacher-workflow-live-generation-smoke-live-passed",
      "learning-ppt-playback-deployment-smoke-live-passed",
      "teaching-operations-route-smoke-live-passed",
      "teaching-operation-detail-browser-smoke-live-passed",
      "teaching-course-management-route-smoke-live-passed",
      "same-release-run-id-bound-to-env-deploy-and-smokes",
    ]);
    expect(body.blockedReasons).toContain("upstream-provider-production-evidence-not-cleared");
    expect(body.blockedReasons).toContain(
      "vercel-env-sync-apply-production-and-preview-missing",
    );
    expect(body.forbiddenUntilEvidenceExists).not.toContain(
      "run-vercel-env-apply-without-owner-approval",
    );
    expect(body.forbiddenUntilEvidenceExists).not.toContain(
      "run-vercel-production-deploy-without-owner-approval",
    );
    expect(body.forbiddenUntilEvidenceExists).toContain(
      "run-vercel-env-apply-before-upstream-auth-storage-clears",
    );
    expect(body.forbiddenUntilEvidenceExists).toContain(
      "run-vercel-production-deploy-before-env-apply-evidence",
    );
    expect(body.safeCommandTemplates).toEqual(
      expect.objectContaining({
        vercelEnvSyncApply:
          "node scripts/vercel-env-sync.mjs --apply --approved --scope full --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <vercel-env-sync-evidence>",
        vercelProductionDeployment:
          "node scripts/vercel-production-deployment-evidence.mjs --live --approved --deploy --environment production --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --vercel-env-sync <vercel-env-sync-evidence> --release-run-id <release-run-id> > <vercel-production-deployment-evidence>",
      }),
    );
    expect(body.safety).toEqual(
      expect.objectContaining({
        envFileRead: false,
        vercelApiCalled: false,
        credentialValuesOmitted: true,
        deploymentUrlsOmitted: true,
        noLiveMutationPerformed: true,
        noDeploymentMutationPerformed: true,
        noEnvApplyPerformed: true,
        noReleaseRunBindingPerformed: true,
      }),
    );

    const markdown = execFileSync("node", [
      "scripts/vercel-env-deploy-production-evidence-preflight.mjs",
      "--owner-response-validation",
      ownerResponseValidation,
      "--approval-gate",
      approvalGate,
      "--vercel-env-deploy-action-packet",
      actionPacket,
      "--app-auth-preflight",
      appAuthPreflight,
      "--teacher-auth-preflight",
      teacherAuthPreflight,
      "--external-storage-preflight",
      externalStoragePreflight,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(markdown).toContain("# UAIS Vercel Env Deploy Production Evidence Preflight");
    expect(markdown).toContain(
      "Status: `vercel-env-deploy-production-evidence-preflight-waiting-for-upstream-provider-evidence`",
    );
    expect(markdown).toContain("## Safe Command Templates");
    expect(markdown).not.toContain("UAIS-production-server-only-env-source-set");
    expect(markdown).not.toContain("UAIS-enterprise-run-2026-07-XX");
    expect(markdown).not.toContain("https://");
  });

  it("stays blocked when the owner response is incomplete", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-deploy-evidence-blocked-"));
    const ownerResponseValidation = writeJson(tmpDir, "owner-response-validation.json", {
      status: "owner-response-incomplete",
      summary: {
        s19EnvApplyPrepMayProceed: false,
        s19EnvApplyRunApproved: false,
        s22DeployPrepMayProceed: false,
        s22ProductionDeployRunApproved: false,
        deployedSmokePrepMayProceed: false,
        deployedSmokeRunApproved: false,
        vercelLiveRunApproved: false,
        liveProviderGenerationSmokeRequiresSeparateApproval: false,
      },
    });
    const approvalGate = writeJson(tmpDir, "approval-gate.json", { stages: [] });
    const actionPacket = writeJson(tmpDir, "action-packet.json", {});

    const output = execFileSync("node", [
      "scripts/vercel-env-deploy-production-evidence-preflight.mjs",
      "--owner-response-validation",
      ownerResponseValidation,
      "--approval-gate",
      approvalGate,
      "--vercel-env-deploy-action-packet",
      actionPacket,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("vercel-env-deploy-production-evidence-preflight-blocked");
    expect(body.blockedReasons).toContain("vercel-env-deploy-owner-response-not-accepted");
    expect(body.blockedReasons).toContain(
      "vercel-env-deploy-stage-not-accepted-awaiting-production-evidence",
    );
    expect(body.summary.releaseReady).toBe(false);
  });
});

function writeJson(dir: string, name: string, value: unknown) {
  const filePath = join(dir, name);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}
