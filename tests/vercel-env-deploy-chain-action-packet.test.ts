import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Vercel env deploy chain action packet", () => {
  it("summarizes rank 4 deploy-chain sequencing without exposing URLs, tokens, or cookies", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-chain-packet-"));
    const ownerChecklist = writeJson(tmpDir, "owner-checklist.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      decisions: [
        {
          id: "vercel-project-selection",
          status: "satisfied",
          blockedReasons: [],
          leakedProjectUrl: "https://private-vercel-project.example.test",
        },
        {
          id: "app-auth-provider-production-selector",
          status: "owner-decision-needed",
          blockedReasons: ["app-auth-provider-readiness-not-live-ready"],
        },
        {
          id: "teacher-auth-provider-production-selector",
          status: "owner-decision-needed",
          blockedReasons: ["teacher-auth-provider-readiness-not-live-ready"],
        },
        {
          id: "external-storage-production-service",
          status: "owner-decision-needed",
          blockedReasons: ["external-storage-service-readiness-not-live-ready"],
        },
        {
          id: "vercel-env-deploy-and-smoke-chain",
          status: "waiting-for-upstream-owner-decisions",
          blockedReasons: [
            "vercel-env-not-applied",
            "vercel-production-deployment-not-proven",
            "deployment-route-smoke-not-live-passed",
            "teaching-operations-route-smoke-not-live-passed",
          ],
          safeNextActions: [
            "confirm-s19-vercel-env-apply-approval",
            "run-redacted-vercel-env-sync-apply-with-approved-project-and-release-run-id",
            "run-production-deployment-only-after-env-sync-evidence-is-applied",
          ],
          forbiddenUntilApproved: [
            "run-vercel-env-apply-without-owner-approval",
            "run-vercel-production-deploy-without-owner-approval",
            "print-or-log-vercel-env-secret-values",
          ],
          proofNeeded: [
            "vercel-env-sync-apply-production-and-preview",
            "vercel-production-deployment-evidence",
            "same-vercel-production-deployment-bound-to-browser-learning-and-route-smokes",
          ],
          sequencing: "project-readiness-before-env-apply-before-production-deploy-before-smokes",
          leakedDeploymentUrl: "https://private-deployment.example.test",
          leakedToken: "secret-vercel-token",
          leakedCookie: "uais_teacher_auth_claims=claims; uais_teacher_auth_signature=sig",
        },
      ],
    });
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      queue: [
        {
          id: "vercel-env-deploy-and-smoke-chain",
          rank: 4,
          category: "env-deploy-chain",
          status: "waiting-for-upstream-owner-decisions",
          blockedReasons: [
            "vercel-env-not-applied",
            "vercel-production-deployment-not-proven",
            "deployment-route-smoke-not-live-passed",
            "teaching-operations-route-smoke-not-live-passed",
          ],
          releaseGateRequirementIds: [
            "vercel-env-placement",
            "vercel-production-deployment",
            "deployment-route-smoke",
            "teaching-operations-route-smoke",
            "production-release-run-consistency",
          ],
          enterpriseAuditMissingTargets: [
            "deployment-domain-reachability",
            "deployment-route-smoke",
            "teaching-operations-route-smoke",
          ],
          nextOwnerQuestion: "Approve S19 Vercel env sync/apply before production deploy and deployed smokes.",
          sequencing: "project-readiness-before-env-apply-before-production-deploy-before-smokes",
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/vercel-env-deploy-chain-action-packet.mjs",
      "--owner-checklist",
      ownerChecklist,
      "--owner-decision-queue",
      ownerQueue,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "vercel-env-deploy-chain-action-packet",
        status: "waiting-for-upstream-owner-decisions",
        releaseGateStatus: "blocked",
        responsibleSession: "S22",
        decisionId: "vercel-env-deploy-and-smoke-chain",
        queueRank: 4,
        classification: "upstream-owner-decisions-env-deploy-smoke-blocked",
        sequencing: "project-readiness-before-env-apply-before-production-deploy-before-smokes",
        upstreamDecisionIds: [
          "app-auth-provider-production-selector",
          "teacher-auth-provider-production-selector",
          "external-storage-production-service",
        ],
        upstreamDecisionStatuses: {
          "app-auth-provider-production-selector": "owner-decision-needed",
          "teacher-auth-provider-production-selector": "owner-decision-needed",
          "external-storage-production-service": "owner-decision-needed",
        },
        currentEvidenceSummary: {
          chainStatus: "waiting-for-upstream-owner-decisions",
          vercelProjectSelectionStatus: "satisfied",
          blockedRequirementCount: 4,
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
        commands: expect.objectContaining({
          vercelEnvSyncApply: "node scripts/vercel-env-sync.mjs --apply --approved --scope full --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <vercel-env-sync-evidence>",
          vercelProductionDeployment: "node scripts/vercel-production-deployment-evidence.mjs --live --approved --deploy --environment production --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --vercel-env-sync <vercel-env-sync-evidence> --release-run-id <release-run-id> > <vercel-production-deployment-evidence>",
          deploymentReachability: "node scripts/deployment-reachability-diagnostics.mjs --live --approved --environment production --base-url <deployment-url> --domain-reachability-evidence --release-run-id <release-run-id> > <deployment-domain-reachability-evidence>",
          deploymentRouteSmoke: "node scripts/ai-route-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <approved-env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> > <deployment-route-smoke-evidence>",
          ordinaryTeachingRouteSmoke: "node scripts/teaching-operations-route-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <approved-env-file> --teacher-id <approved-smoke-teacher-id> --course-id <approved-smoke-course-id> --cookie <approved-teacher-auth-cookie> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --external-storage-service-readiness <external-storage-service-readiness-evidence> --teaching-operations-backend external --teaching-course-management-backend external > <teaching-operations-route-smoke-evidence>",
        }),
        releaseGateRequirementIds: [
          "vercel-env-placement",
          "vercel-production-deployment",
          "deployment-route-smoke",
          "teaching-operations-route-smoke",
          "production-release-run-consistency",
        ],
        enterpriseAuditMissingTargets: [
          "deployment-domain-reachability",
          "deployment-route-smoke",
          "teaching-operations-route-smoke",
        ],
        safety: {
          sourcePathsOmitted: true,
          deploymentUrlsOmitted: true,
          envValuesOmitted: true,
          vercelSecretValuesOmitted: true,
          cookieValuesOmitted: true,
          responseBodiesOmitted: true,
          envApplyPerformed: false,
          deploymentMutationPerformed: false,
          liveSmokePerformed: false,
          providerMutationPerformed: false,
        },
      }),
    );
    expect(body.stopConditions).toEqual(
      expect.arrayContaining([
        "Stop if app-auth, teacher-auth, or external-storage readiness is not live-ready.",
        "Stop if owner has not approved S19 Vercel env apply and S22 production deploy.",
        "Stop if any live smoke would print deployment URLs, Vercel secrets, teacher-auth cookies, or response bodies.",
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://private-deployment.example.test");
    expect(output).not.toContain("https://private-vercel-project.example.test");
    expect(output).not.toContain("secret-vercel-token");
    expect(output).not.toContain("uais_teacher_auth_claims=claims");
    expect(output).not.toContain("uais_teacher_auth_signature=sig");
  });

  it("renders a markdown Vercel deploy chain packet for handoff", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-chain-packet-md-"));
    const ownerChecklist = writeJson(tmpDir, "owner-checklist.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      decisions: [
        { id: "vercel-project-selection", status: "satisfied" },
        { id: "app-auth-provider-production-selector", status: "owner-decision-needed" },
        { id: "teacher-auth-provider-production-selector", status: "owner-decision-needed" },
        { id: "external-storage-production-service", status: "owner-decision-needed" },
        {
          id: "vercel-env-deploy-and-smoke-chain",
          status: "waiting-for-upstream-owner-decisions",
          blockedReasons: ["vercel-env-not-applied"],
          safeNextActions: ["confirm-s19-vercel-env-apply-approval"],
          forbiddenUntilApproved: ["run-vercel-env-apply-without-owner-approval"],
          sequencing: "project-readiness-before-env-apply-before-production-deploy-before-smokes",
        },
      ],
    });
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      queue: [
        {
          id: "vercel-env-deploy-and-smoke-chain",
          rank: 4,
          nextOwnerQuestion: "Approve S19 Vercel env sync/apply before production deploy and deployed smokes.",
          releaseGateRequirementIds: ["vercel-env-placement"],
          enterpriseAuditMissingTargets: ["deployment-domain-reachability"],
          sequencing: "project-readiness-before-env-apply-before-production-deploy-before-smokes",
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/vercel-env-deploy-chain-action-packet.mjs",
      "--owner-checklist",
      ownerChecklist,
      "--owner-decision-queue",
      ownerQueue,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("# UAIS Vercel Env Deploy Chain Action Packet");
    expect(output).toContain("Status: `waiting-for-upstream-owner-decisions`");
    expect(output).toContain("Queue rank: 4");
    expect(output).toContain("`app-auth-provider-production-selector`: `owner-decision-needed`");
    expect(output).toContain("`vercel-env-sync-apply-production-and-preview`");
    expect(output).toContain("Do not run env apply, production deploy, or live smokes until upstream owner decisions are live-ready and approval is explicit.");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });
});

function writeJson(tmpDir: string, filename: string, body: unknown) {
  const filePath = join(tmpDir, filename);
  writeFileSync(filePath, JSON.stringify(body, null, 2));
  return filePath;
}
