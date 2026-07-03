import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("owner decision Vercel env/deploy response template", () => {
  it("builds a queued redacted owner response template for the Vercel env/deploy chain", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-deploy-response-template-"));
    const ownerDecisionQueue = writeJson(tmpDir, "queue.json", buildQueue());
    const actionPacket = writeJson(tmpDir, "vercel-env-deploy-action-packet.json", buildActionPacket());

    const output = execFileSync("node", [
      "scripts/owner-decision-vercel-env-deploy-response-template.mjs",
      "--owner-decision-queue",
      ownerDecisionQueue,
      "--vercel-env-deploy-action-packet",
      actionPacket,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "owner-decision-vercel-env-deploy-response-template",
        status: "queued-awaiting-upstream-owner-decisions",
        decisionId: "vercel-env-deploy-and-smoke-chain",
        responsibleSession: "S22/S19/S10",
      }),
    );
    expect(body.summary).toEqual(
      expect.objectContaining({
        queueRank: 4,
        queueStatus: "waiting-for-upstream-owner-decisions",
        actionPacketStatus: "waiting-for-upstream-owner-decisions",
        upstreamBlockedDecisionCount: 3,
        requiredEvidenceCount: 13,
        requiredCommandNameCount: 11,
        releaseReady: false,
      }),
    );
    expect(body.upstreamBlockedDecisionIds).toEqual([
      "app-auth-provider-production-selector",
      "teacher-auth-provider-production-selector",
      "external-storage-production-service",
    ]);
    expect(body.ownerResponseTemplate).toEqual(
      expect.objectContaining({
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
      }),
    );
    expect(body.ownerResponseTemplate.requiredEvidenceAfterApproval).toHaveLength(13);
    expect(body.copySafeOwnerReplyStub).toEqual({
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
    expect(body.ownerResponseValidationCommand).toBe(
      "node scripts/owner-decision-vercel-env-deploy-response-validation.mjs --owner-response-template coordination/reports/<this-template-json> --owner-response path/to/filled-owner-response.json",
    );
    expect(body.ownerResponseTemplate.requiredCommandNames).toEqual([
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
    ]);
    expect(body.postResponseAllowedChecks).toEqual([
      "validate-owner-response-shape",
      "confirm-no-credential-values-urls-or-env-files-in-owner-response",
      "prepare-s19-vercel-env-sync-apply-command-after-upstream-auth-storage-clears",
      "prepare-s22-production-deployment-command-after-env-sync-evidence",
      "prepare-deployed-route-smoke-commands-after-production-deployment-evidence",
      "prepare-ordinary-teaching-live-smoke-commands-after-auth-storage-deployment-readiness",
    ]);
    expect(body.stillForbiddenUntilSeparateApproval).toContain("run-vercel-production-deploy-without-owner-approval");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://private-deploy.example.test");
    expect(output).not.toContain("UAIS_APP_AUTH_SECRET=secret");
    expect(output).not.toContain("<approved-env-file>");
  });

  it("reports missing when the Vercel env/deploy decision is not present in the owner queue", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-deploy-response-template-missing-"));
    const ownerDecisionQueue = writeJson(tmpDir, "queue.json", {
      status: "owner-decisions-required",
      queue: [
        {
          rank: 1,
          id: "app-auth-provider-production-selector",
          status: "owner-decision-needed",
        },
      ],
    });
    const actionPacket = writeJson(tmpDir, "vercel-env-deploy-action-packet.json", buildActionPacket());

    const output = execFileSync("node", [
      "scripts/owner-decision-vercel-env-deploy-response-template.mjs",
      "--owner-decision-queue",
      ownerDecisionQueue,
      "--vercel-env-deploy-action-packet",
      actionPacket,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("decision-not-in-owner-queue");
    expect(body.ownerResponseTemplate).toBeNull();
    expect(body.summary.queueRank).toBeNull();
  });

  it("renders markdown without source paths, deployment URLs, env files, or credential values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-deploy-response-template-md-"));
    const ownerDecisionQueue = writeJson(tmpDir, "queue.json", buildQueue());
    const actionPacket = writeJson(tmpDir, "vercel-env-deploy-action-packet.json", buildActionPacket());

    const output = execFileSync("node", [
      "scripts/owner-decision-vercel-env-deploy-response-template.mjs",
      "--owner-decision-queue",
      ownerDecisionQueue,
      "--vercel-env-deploy-action-packet",
      actionPacket,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("# UAIS Vercel Env Deploy Owner Response Template");
    expect(output).toContain("Status: `queued-awaiting-upstream-owner-decisions`");
    expect(output).toContain("Do not include credential values, deployment URLs, cookie values, or env file paths.");
    expect(output).toContain("## Copy-Safe Owner Reply Stub");
    expect(output).toContain(
      '"approvedVercelEnvSyncApplyEvidenceLabel": "<label only; no env file path or credential values>"',
    );
    expect(output).toContain('"confirmsS19MayRunVercelEnvSyncApplyAfterUpstreamReady": true');
    expect(output).toContain('"confirmsS22MayRunProductionDeployAfterEnvApplyEvidence": true');
    expect(output).toContain(
      '"confirmsS22MayRunDeployedRouteSmokesAfterProductionDeploymentEvidence": true',
    );
    expect(output).toContain("## Validation Command");
    expect(output).toContain(
      "node scripts/owner-decision-vercel-env-deploy-response-validation.mjs --owner-response-template coordination/reports/<this-template-json> --owner-response path/to/filled-owner-response.json",
    );
    expect(output).toContain("`vercelProductionDeployment`");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://private-deploy.example.test");
    expect(output).not.toContain("<approved-env-file>");
  });
});

function buildQueue() {
  return {
    status: "owner-decisions-required",
    queue: [
      {
        rank: 1,
        id: "app-auth-provider-production-selector",
        status: "owner-decision-needed",
      },
      {
        rank: 2,
        id: "teacher-auth-provider-production-selector",
        status: "owner-decision-needed",
      },
      {
        rank: 3,
        id: "external-storage-production-service",
        status: "owner-decision-needed",
      },
      {
        rank: 4,
        id: "vercel-env-deploy-and-smoke-chain",
        status: "waiting-for-upstream-owner-decisions",
        category: "env-deploy-chain",
        nextOwnerQuestion: "Approve S19 Vercel env sync/apply before production deploy and deployed smokes.",
      },
    ],
    leakedPath: "/Users/example/private/queue.json",
  };
}

function buildActionPacket() {
  return {
    target: "vercel-env-deploy-chain-action-packet",
    status: "waiting-for-upstream-owner-decisions",
    decisionId: "vercel-env-deploy-and-smoke-chain",
    queueRank: 4,
    upstreamDecisionIds: [
      "app-auth-provider-production-selector",
      "teacher-auth-provider-production-selector",
      "external-storage-production-service",
    ],
    forbiddenUntilApproved: [
      "run-vercel-env-apply-without-owner-approval",
      "run-vercel-production-deploy-without-owner-approval",
      "run-live-provider-generation-smoke-before-browser-smoke-and-owner-approval",
      "run-deployed-route-smokes-before-production-deployment-evidence",
      "print-or-log-vercel-env-secret-values",
    ],
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
      vercelEnvSyncApply: "node scripts/vercel-env-sync.mjs --apply --env-file <approved-env-file>",
      vercelProductionDeployment: "node scripts/vercel-production-deployment-evidence.mjs --deploy",
      deploymentReachability: "node scripts/deployment-reachability-diagnostics.mjs --base-url <deployment-url>",
      deploymentRouteSmoke: "node scripts/ai-route-smoke.mjs --base-url <deployment-url>",
      teacherWorkflowDeploymentSmoke: "node scripts/teacher-workflow-deployment-smoke.mjs",
      teacherWorkflowBrowserSmoke: "node scripts/teacher-workflow-browser-smoke.mjs",
      teacherWorkflowLiveGenerationSmoke: "node scripts/teacher-workflow-live-generation-smoke.mjs",
      learningPptPlaybackDeploymentSmoke: "node scripts/learning-ppt-playback-deployment-smoke.mjs",
      ordinaryTeachingRouteSmoke: "node scripts/teaching-operations-route-smoke.mjs",
      operationDetailBrowserSmoke: "node scripts/teaching-operation-detail-browser-smoke.mjs",
      teachingCourseManagementRouteSmoke: "node scripts/teaching-course-management-route-smoke.mjs",
    },
    currentEvidenceSummary: {
      chainStatus: "waiting-for-upstream-owner-decisions",
      vercelProjectSelectionStatus: "satisfied",
      envApplyStatus: "missing",
      productionDeploymentStatus: "missing",
    },
    leakedUrl: "https://private-deploy.example.test",
    leakedEnv: "UAIS_APP_AUTH_SECRET=secret",
  };
}

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}
