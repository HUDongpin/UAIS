import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("owner decision Vercel env/deploy response validation", () => {
  it("accepts a complete redacted owner response while keeping the live chain gated", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-deploy-response-validation-"));
    const template = writeJson(tmpDir, "template.json", buildTemplateReport());
    const ownerResponse = writeJson(tmpDir, "owner-response.json", {
      responseStatus: "owner-response-provided",
      decisionId: "vercel-env-deploy-and-smoke-chain",
      approvedVercelProjectReadinessLabel: "vercel-project-readiness-current-redacted",
      approvedServerOnlyEnvSourceLabel: "s19-vercel-env-source-redacted",
      approvedVercelEnvSyncApplyEvidenceLabel: "s19-vercel-env-sync-apply-redacted",
      approvedProductionDeploymentEvidenceLabel: "s22-vercel-production-deployment-redacted",
      approvedDeploymentBaseUrlLabel: "production-deployment-url-redacted-label",
      approvedReleaseRunIdLabel: "release-run-env-deploy-chain-2026-07-01",
      confirmsNoCredentialValuesInResponse: true,
      confirmsS19MayPrepareVercelEnvApplyAfterUpstreamReady: true,
      confirmsS19MayRunVercelEnvSyncApplyAfterUpstreamReady: true,
      confirmsS22MayPrepareProductionDeployAfterEnvApplyEvidence: true,
      confirmsS22MayRunProductionDeployAfterEnvApplyEvidence: true,
      confirmsS22MayPrepareDeployedRouteSmokesAfterProductionDeploymentEvidence: true,
      confirmsS22MayRunDeployedRouteSmokesAfterProductionDeploymentEvidence: true,
      confirmsLiveProviderGenerationSmokeRequiresSeparateApproval: true,
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-vercel-env-deploy-response-validation.mjs",
      "--owner-response-template",
      template,
      "--owner-response",
      ownerResponse,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "owner-decision-vercel-env-deploy-response-validation",
        status: "owner-response-accepted",
        releaseReady: false,
        decisionId: "vercel-env-deploy-and-smoke-chain",
        responsibleSession: "S22/S19/S10",
      }),
    );
    expect(body.summary).toEqual(
      expect.objectContaining({
        missingFieldCount: 0,
        unsafeFindingCount: 0,
        requiredEvidenceAfterApprovalCount: 13,
        requiredCommandNameCount: 11,
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
      }),
    );
    expect(body.postValidationAllowedChecks).toEqual([
      "prepare-s19-vercel-env-sync-apply-command-after-upstream-auth-storage-clears",
      "prepare-s22-production-deployment-command-after-env-sync-evidence",
      "prepare-deployed-route-smoke-commands-after-production-deployment-evidence",
      "prepare-ordinary-teaching-live-smoke-commands-after-auth-storage-deployment-readiness",
    ]);
    expect(body.stillForbiddenUntilSeparateApproval).not.toContain(
      "run-vercel-env-apply-without-owner-approval",
    );
    expect(body.stillForbiddenUntilSeparateApproval).not.toContain(
      "run-vercel-production-deploy-without-owner-approval",
    );
    expect(body.stillForbiddenUntilSeparateApproval).toContain(
      "run-vercel-env-apply-before-upstream-auth-storage-clears",
    );
    expect(body.stillForbiddenUntilSeparateApproval).toContain(
      "run-vercel-production-deploy-before-env-apply-evidence",
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://");
    expect(output).not.toContain("<approved-env-file>");
  });

  it("keeps the template placeholder incomplete until the owner fills it", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-deploy-response-validation-incomplete-"));
    const templateReport = buildTemplateReport();
    const template = writeJson(tmpDir, "template.json", templateReport);
    const ownerResponse = writeJson(tmpDir, "owner-response.json", templateReport);

    const output = execFileSync("node", [
      "scripts/owner-decision-vercel-env-deploy-response-validation.mjs",
      "--owner-response-template",
      template,
      "--owner-response",
      ownerResponse,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("owner-response-incomplete");
    expect(body.summary.missingFieldCount).toBeGreaterThanOrEqual(10);
    expect(body.summary.s19EnvApplyPrepMayProceed).toBe(false);
    expect(body.summary.s22DeployPrepMayProceed).toBe(false);
    expect(body.postValidationAllowedChecks).toEqual([]);
    expect(body.blockedReasons).toContain("approvedVercelProjectReadinessLabel-missing-or-invalid");
    expect(body.blockedReasons).toContain(
      "confirmsLiveProviderGenerationSmokeRequiresSeparateApproval-not-confirmed",
    );
    expect(output).not.toContain(tmpDir);
  });

  it("renders empty post-validation checks explicitly in incomplete markdown", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-deploy-response-validation-md-incomplete-"));
    const templateReport = buildTemplateReport();
    const template = writeJson(tmpDir, "template.json", templateReport);
    const ownerResponse = writeJson(tmpDir, "owner-response.json", templateReport);

    const output = execFileSync("node", [
      "scripts/owner-decision-vercel-env-deploy-response-validation.mjs",
      "--owner-response-template",
      template,
      "--owner-response",
      ownerResponse,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("Status: `owner-response-incomplete`");
    expect(output).toContain("## Post-Validation Allowed Checks");
    expect(output).toContain("- `none-recorded`");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("uses the copy-safe owner reply stub when validating a generated template report", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-deploy-response-validation-stub-"));
    const templateReport = {
      ...buildTemplateReport(),
      copySafeOwnerReplyStub: {
        responseStatus: "owner-response-provided",
        decisionId: "vercel-env-deploy-and-smoke-chain",
        approvedVercelProjectReadinessLabel:
          "<label only; no URL, token, or credential values>",
        approvedServerOnlyEnvSourceLabel: "<label only; no credential values>",
        approvedVercelEnvSyncApplyEvidenceLabel:
          "<label only; no env file path or credential values>",
        approvedProductionDeploymentEvidenceLabel:
          "<label only; no deployment URL or response body>",
        approvedDeploymentBaseUrlLabel: "<label only; no deployment URL>",
        approvedReleaseRunIdLabel: "<label only; no URL, token, or cookie>",
        confirmsNoCredentialValuesInResponse: true,
        confirmsS19MayPrepareVercelEnvApplyAfterUpstreamReady: true,
        confirmsS19MayRunVercelEnvSyncApplyAfterUpstreamReady: true,
        confirmsS22MayPrepareProductionDeployAfterEnvApplyEvidence: true,
        confirmsS22MayRunProductionDeployAfterEnvApplyEvidence: true,
        confirmsS22MayPrepareDeployedRouteSmokesAfterProductionDeploymentEvidence: true,
        confirmsS22MayRunDeployedRouteSmokesAfterProductionDeploymentEvidence: true,
        confirmsLiveProviderGenerationSmokeRequiresSeparateApproval: true,
      },
    };
    const template = writeJson(tmpDir, "template.json", templateReport);
    const ownerResponse = writeJson(tmpDir, "owner-response.json", templateReport);

    const output = execFileSync("node", [
      "scripts/owner-decision-vercel-env-deploy-response-validation.mjs",
      "--owner-response-template",
      template,
      "--owner-response",
      ownerResponse,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("owner-response-incomplete");
    expect(body.summary.s19EnvApplyPrepMayProceed).toBe(false);
    expect(body.summary.s19EnvApplyRunApproved).toBe(false);
    expect(body.summary.s22DeployPrepMayProceed).toBe(false);
    expect(body.summary.s22ProductionDeployRunApproved).toBe(false);
    expect(body.summary.deployedSmokePrepMayProceed).toBe(false);
    expect(body.summary.deployedSmokeRunApproved).toBe(false);
    expect(body.summary.vercelLiveRunApproved).toBe(false);
    expect(body.summary.liveChainStillForbidden).toBe(true);
    expect(body.summary.liveProviderGenerationSmokeRequiresSeparateApproval).toBe(true);
    expect(body.redactedOwnerResponse).toEqual({
      responseStatus: "owner-response-provided",
      decisionId: "vercel-env-deploy-and-smoke-chain",
      approvedVercelProjectReadinessLabel: "<label only; no URL, token, or credential values>",
      approvedServerOnlyEnvSourceLabel: "<label only; no credential values>",
      approvedVercelEnvSyncApplyEvidenceLabel:
        "<label only; no env file path or credential values>",
      approvedProductionDeploymentEvidenceLabel:
        "<label only; no deployment URL or response body>",
      approvedDeploymentBaseUrlLabel: "<label only; no deployment URL>",
      approvedReleaseRunIdLabel: "<label only; no URL, token, or cookie>",
      confirmsNoCredentialValuesInResponse: true,
      confirmsS19MayPrepareVercelEnvApplyAfterUpstreamReady: true,
      confirmsS19MayRunVercelEnvSyncApplyAfterUpstreamReady: true,
      confirmsS22MayPrepareProductionDeployAfterEnvApplyEvidence: true,
      confirmsS22MayRunProductionDeployAfterEnvApplyEvidence: true,
      confirmsS22MayPrepareDeployedRouteSmokesAfterProductionDeploymentEvidence: true,
      confirmsS22MayRunDeployedRouteSmokesAfterProductionDeploymentEvidence: true,
      confirmsLiveProviderGenerationSmokeRequiresSeparateApproval: true,
    });
    expect(body.blockedReasons).toEqual([
      "approvedVercelProjectReadinessLabel-missing-or-invalid",
      "approvedServerOnlyEnvSourceLabel-missing-or-invalid",
      "approvedVercelEnvSyncApplyEvidenceLabel-missing-or-invalid",
      "approvedProductionDeploymentEvidenceLabel-missing-or-invalid",
      "approvedDeploymentBaseUrlLabel-missing-or-invalid",
      "approvedReleaseRunIdLabel-missing-or-invalid",
    ]);
    expect(output).not.toContain(tmpDir);
  });

  it("rejects unsafe owner responses without echoing deployment URLs or secret-like values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-deploy-response-validation-unsafe-"));
    const template = writeJson(tmpDir, "template.json", buildTemplateReport());
    const ownerResponse = writeJson(tmpDir, "owner-response.json", {
      responseStatus: "owner-response-provided",
      decisionId: "vercel-env-deploy-and-smoke-chain",
      approvedVercelProjectReadinessLabel: "vercel-project-readiness-current-redacted",
      approvedServerOnlyEnvSourceLabel: "/Users/example/.env.local",
      approvedVercelEnvSyncApplyEvidenceLabel: "s19-vercel-env-sync-apply-redacted",
      approvedProductionDeploymentEvidenceLabel: "https://private-deploy.example.test",
      approvedDeploymentBaseUrlLabel: "https://private-deploy.example.test",
      approvedReleaseRunIdLabel: "release-run-env-deploy-chain-2026-07-01",
      confirmsNoCredentialValuesInResponse: true,
      confirmsS19MayPrepareVercelEnvApplyAfterUpstreamReady: true,
      confirmsS19MayRunVercelEnvSyncApplyAfterUpstreamReady: true,
      confirmsS22MayPrepareProductionDeployAfterEnvApplyEvidence: true,
      confirmsS22MayRunProductionDeployAfterEnvApplyEvidence: true,
      confirmsS22MayPrepareDeployedRouteSmokesAfterProductionDeploymentEvidence: true,
      confirmsS22MayRunDeployedRouteSmokesAfterProductionDeploymentEvidence: true,
      confirmsLiveProviderGenerationSmokeRequiresSeparateApproval: true,
      notes: "UAIS_APP_AUTH_SECRET=secret-token-value",
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-vercel-env-deploy-response-validation.mjs",
      "--owner-response-template",
      template,
      "--owner-response",
      ownerResponse,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("owner-response-rejected");
    expect(body.summary.unsafeFindingCount).toBeGreaterThanOrEqual(5);
    expect(body.redactedOwnerResponse.approvedServerOnlyEnvSourceLabel).toBeNull();
    expect(body.redactedOwnerResponse.approvedProductionDeploymentEvidenceLabel).toBeNull();
    expect(body.redactedOwnerResponse.approvedDeploymentBaseUrlLabel).toBeNull();
    expect(body.unsafeFindings.map((finding: { patternId: string }) => finding.patternId)).toEqual(
      expect.arrayContaining(["raw-url", "local-user-path", "local-env-file", "env-assignment"]),
    );
    expect(output).not.toContain("https://private-deploy.example.test");
    expect(output).not.toContain("/Users/example/.env.local");
    expect(output).not.toContain("secret-token-value");
  });

  it("renders markdown without source paths, deployment URLs, env files, or credential values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-deploy-response-validation-md-"));
    const template = writeJson(tmpDir, "template.json", buildTemplateReport());
    const ownerResponse = writeJson(tmpDir, "owner-response.json", {
      responseStatus: "owner-response-provided",
      decisionId: "vercel-env-deploy-and-smoke-chain",
      approvedVercelProjectReadinessLabel: "vercel-project-readiness-current-redacted",
      approvedServerOnlyEnvSourceLabel: "s19-vercel-env-source-redacted",
      approvedVercelEnvSyncApplyEvidenceLabel: "s19-vercel-env-sync-apply-redacted",
      approvedProductionDeploymentEvidenceLabel: "s22-vercel-production-deployment-redacted",
      approvedDeploymentBaseUrlLabel: "production-deployment-url-redacted-label",
      approvedReleaseRunIdLabel: "release-run-env-deploy-chain-2026-07-01",
      confirmsNoCredentialValuesInResponse: true,
      confirmsS19MayPrepareVercelEnvApplyAfterUpstreamReady: true,
      confirmsS19MayRunVercelEnvSyncApplyAfterUpstreamReady: true,
      confirmsS22MayPrepareProductionDeployAfterEnvApplyEvidence: true,
      confirmsS22MayRunProductionDeployAfterEnvApplyEvidence: true,
      confirmsS22MayPrepareDeployedRouteSmokesAfterProductionDeploymentEvidence: true,
      confirmsS22MayRunDeployedRouteSmokesAfterProductionDeploymentEvidence: true,
      confirmsLiveProviderGenerationSmokeRequiresSeparateApproval: true,
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-vercel-env-deploy-response-validation.mjs",
      "--owner-response-template",
      template,
      "--owner-response",
      ownerResponse,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("# UAIS Vercel Env Deploy Owner Response Validation");
    expect(output).toContain("Status: `owner-response-accepted`");
    expect(output).toContain("Vercel live run approved: `true`");
    expect(output).toContain("Live chain still forbidden: `true`");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://");
    expect(output).not.toContain("<approved-env-file>");
  });
});

function buildTemplateReport() {
  return {
    target: "owner-decision-vercel-env-deploy-response-template",
    status: "queued-awaiting-upstream-owner-decisions",
    decisionId: "vercel-env-deploy-and-smoke-chain",
    summary: {
      queueRank: 4,
      queueStatus: "waiting-for-upstream-owner-decisions",
      actionPacketStatus: "waiting-for-upstream-owner-decisions",
      upstreamBlockedDecisionCount: 3,
      requiredEvidenceCount: 13,
      requiredCommandNameCount: 11,
      releaseReady: false,
    },
    ownerResponseTemplate: {
      responseStatus: "owner-response-required",
      decisionId: "vercel-env-deploy-and-smoke-chain",
      approvedVercelProjectReadinessLabel: null,
      approvedServerOnlyEnvSourceLabel: null,
      approvedVercelEnvSyncApplyEvidenceLabel: null,
      approvedProductionDeploymentEvidenceLabel: null,
      approvedDeploymentBaseUrlLabel: null,
      approvedReleaseRunIdLabel: null,
      confirmsNoCredentialValuesInResponse: false,
      confirmsS19MayPrepareVercelEnvApplyAfterUpstreamReady: false,
      confirmsS19MayRunVercelEnvSyncApplyAfterUpstreamReady: false,
      confirmsS22MayPrepareProductionDeployAfterEnvApplyEvidence: false,
      confirmsS22MayRunProductionDeployAfterEnvApplyEvidence: false,
      confirmsS22MayPrepareDeployedRouteSmokesAfterProductionDeploymentEvidence: false,
      confirmsS22MayRunDeployedRouteSmokesAfterProductionDeploymentEvidence: false,
      confirmsLiveProviderGenerationSmokeRequiresSeparateApproval: false,
      requiredEvidenceAfterApproval: [
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
      requiredCommandNames: [
        "vercelEnvSyncApply",
        "vercelProductionDeployment",
        "deploymentReachability",
        "deploymentRouteSmoke",
        "teacherWorkflowDeploymentSmoke",
        "teacherWorkflowBrowserSmoke",
        "teacherWorkflowLiveGenerationSmoke",
        "learningPptPlaybackDeploymentSmoke",
        "ordinaryTeachingRouteSmoke",
        "operationDetailBrowserSmoke",
        "teachingCourseManagementRouteSmoke",
      ],
    },
  };
}

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}
