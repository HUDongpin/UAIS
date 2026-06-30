import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const releaseGateRequirementIds = [
  "deployed-teacher-workflow-page",
  "teacher-workflow-browser-smoke",
  "teacher-workflow-live-generation-smoke",
  "deployed-learning-ppt-playback",
  "vercel-env-placement",
  "app-auth-provider-readiness",
  "teacher-auth-provider-readiness",
  "external-storage-service-readiness",
  "vercel-production-deployment",
  "deployment-route-smoke",
  "teacher-auth-provider-consistency",
  "teaching-operations-route-smoke",
  "teaching-operation-detail-browser-smoke",
  "teaching-course-management-route-smoke",
  "external-durable-storage-smoke",
  "external-storage-service-consistency",
  "ppt-manual-playback-acceptance",
  "enterprise-live-evidence-audit",
  "production-release-run-consistency",
];

const enterpriseAuditMissingTargets = [
  "app-auth-provider-readiness",
  "teacher-auth-issuer-route-smoke",
  "teacher-auth-provider-readiness",
  "external-storage-persistence",
  "external-storage-service-readiness",
  "deployment-domain-reachability",
  "teacher-workflow-deployment-smoke",
  "teacher-workflow-browser-smoke",
  "teacher-workflow-live-generation-smoke",
  "learning-ppt-playback-deployment-smoke",
  "ppt-manual-playback-acceptance",
  "deployment-route-smoke",
  "teaching-operations-route-smoke",
  "teaching-operation-detail-browser-smoke",
  "teaching-course-management-route-smoke",
  "external-storage-smoke",
];

const blockedReasons = [
  "deployed-teacher-workflow-page-not-live-passed",
  "deployed-learning-ppt-playback-not-live-passed",
  "vercel-env-not-applied",
  "app-auth-provider-readiness-not-live-ready",
  "teacher-auth-provider-readiness-not-live-ready",
  "external-storage-service-readiness-not-live-ready",
  "vercel-production-deployment-not-proven",
  "deployment-route-smoke-not-live-passed",
  "teaching-operations-route-smoke-not-live-passed",
  "teaching-operation-detail-browser-smoke-not-live-passed",
  "teaching-course-management-route-smoke-not-live-passed",
  "external-storage-smoke-not-live-passed",
  "manual-ppt-playback-not-accepted",
  "enterprise-live-evidence-audit-not-ready",
  "teacher-workflow-browser-smoke-not-live-passed",
];

describe("production release-run action packet", () => {
  it("summarizes final release-run binding blockers without leaking release details", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-release-run-packet-"));
    const ownerChecklist = writeJson(tmpDir, "owner-checklist.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      decisions: [
        {
          id: "production-release-run",
          status: "waiting-for-upstream-evidence",
          responsibleSessions: ["S22", "S24"],
          blockedReasons,
          safeNextActions: [
            "wait-for-final-release-gate-ready",
            "bind-one-public-release-run-id-after-all-production-evidence-is-ready",
            "verify-owner-checklist-has-no-waiting-or-blocked-decisions",
          ],
          forbiddenUntilApproved: [
            "bind-release-run-id-while-release-gate-blocked",
            "mix-production-evidence-from-multiple-release-run-ids",
            "include-local-private-paths-or-secret-values-in-release-run-summary",
          ],
          proofNeeded: [
            "one-public-release-run-id-used-across-production-evidence",
            "final-release-gate-ready",
          ],
          leakedReleaseRunId: "secret-/Users/local-release-id",
          leakedUrl: "https://private-release.example.test",
        },
      ],
    });
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      queue: [
        {
          id: "production-release-run",
          rank: 8,
          category: "final-release-binding",
          status: "waiting-for-upstream-evidence",
          blockedReasons,
          releaseGateRequirementIds,
          enterpriseAuditMissingTargets,
          nextOwnerQuestion: "Do not bind the production release-run ID until the release gate is ready.",
        },
      ],
    });
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      status: "blocked",
      requirements: [
        {
          id: "production-release-run-consistency",
          status: "blocked",
          evidenceStatus: "waiting-for-production-evidence",
          blockedReason: "vercel-production-deployment-not-proven",
          releaseRunIds: {
            vercelEnvSync: "waiting",
            vercelProductionDeployment: "waiting",
            deployedTeacherWorkflowUi: "waiting",
            teacherWorkflowBrowserUi: "secret-/Users/release-run",
            teacherWorkflowLiveGeneration: "waiting",
            learningPptPlayback: "waiting",
            appAuthProviderReadiness: "waiting",
            teacherAuthProviderReadiness: "waiting",
            externalStorageContainerBuildReadiness: "present",
            externalStorageServiceReadiness: "waiting",
            routeSmoke: "waiting",
            teachingOperationsRouteSmoke: "waiting",
            teachingOperationDetailBrowserSmoke: "waiting",
            teachingCourseManagementRouteSmoke: "waiting",
            externalStorageSmoke: "waiting",
            pptAcceptance: "waiting",
            match: "waiting",
          },
          leakedUrl: "https://private-release.example.test/evidence",
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/production-release-run-action-packet.mjs",
      "--owner-checklist",
      ownerChecklist,
      "--owner-decision-queue",
      ownerQueue,
      "--release-gate",
      releaseGate,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "production-release-run-action-packet",
        status: "waiting-for-upstream-evidence",
        releaseGateStatus: "blocked",
        responsibleSessions: ["S22", "S24"],
        decisionId: "production-release-run",
        queueRank: 8,
        classification: "final-release-run-binding-blocked",
        requiredEvidence: [
          "one-public-release-run-id-used-across-production-evidence",
          "final-release-gate-ready",
        ],
        currentEvidenceSummary: {
          requirementStatus: "blocked",
          evidenceStatus: "waiting-for-production-evidence",
          blockedReason: "vercel-production-deployment-not-proven",
          releaseRunEvidenceStatusBySource: {
            vercelEnvSync: "waiting",
            vercelProductionDeployment: "waiting",
            deployedTeacherWorkflowUi: "waiting",
            teacherWorkflowBrowserUi: "present",
            teacherWorkflowLiveGeneration: "waiting",
            learningPptPlayback: "waiting",
            appAuthProviderReadiness: "waiting",
            teacherAuthProviderReadiness: "waiting",
            externalStorageContainerBuildReadiness: "present",
            externalStorageServiceReadiness: "waiting",
            routeSmoke: "waiting",
            teachingOperationsRouteSmoke: "waiting",
            teachingOperationDetailBrowserSmoke: "waiting",
            teachingCourseManagementRouteSmoke: "waiting",
            externalStorageSmoke: "waiting",
            pptAcceptance: "waiting",
            match: "waiting",
          },
          waitingReleaseRunEvidenceCount: 14,
          presentReleaseRunEvidenceCount: 2,
          matchedReleaseRunEvidenceCount: 0,
          matchStatus: "waiting",
        },
        releaseGateRequirementIds,
        enterpriseAuditMissingTargets,
        commands: expect.objectContaining({
          finalReleaseGateCheck: "node -- scripts/production-e2e-release-gate.mjs <release-gate-inputs> > <production-e2e-release-gate-output>",
          releaseRunBindingReview: "review production-release-run-consistency in <production-e2e-release-gate-output> and bind one public release-run ID only after status is ready",
        }),
        safety: {
          sourcePathsOmitted: true,
          rawUrlsOmitted: true,
          secretValuesOmitted: true,
          responseBodiesOmitted: true,
          noReleaseRunIdBound: true,
          releaseGateStillBlocked: true,
          noGitOperation: true,
        },
      }),
    );
    expect(body.stopConditions).toEqual(
      expect.arrayContaining([
        "Stop if the final release gate is not ready.",
        "Stop if any upstream owner decision or production live evidence remains blocked.",
        "Stop if release-run IDs across production evidence are missing or mismatched.",
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://private-release.example.test");
    expect(output).not.toContain("secret-/Users/local-release-id");
    expect(output).not.toContain("secret-/Users/release-run");
  });

  it("renders a markdown final release-run packet for handoff", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-release-run-packet-md-"));
    const ownerChecklist = writeJson(tmpDir, "owner-checklist.json", {
      releaseGateStatus: "blocked",
      decisions: [
        {
          id: "production-release-run",
          status: "waiting-for-upstream-evidence",
          responsibleSessions: ["S22", "S24"],
          blockedReasons,
          safeNextActions: ["wait-for-final-release-gate-ready"],
          forbiddenUntilApproved: ["bind-release-run-id-while-release-gate-blocked"],
          proofNeeded: ["final-release-gate-ready"],
        },
      ],
    });
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      releaseGateStatus: "blocked",
      queue: [
        {
          id: "production-release-run",
          rank: 8,
          nextOwnerQuestion: "Do not bind the production release-run ID until the release gate is ready.",
          releaseGateRequirementIds,
          enterpriseAuditMissingTargets,
        },
      ],
    });
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      status: "blocked",
      requirements: [
        {
          id: "production-release-run-consistency",
          status: "blocked",
          evidenceStatus: "waiting-for-production-evidence",
          blockedReason: "vercel-production-deployment-not-proven",
          releaseRunIds: {
            vercelEnvSync: "waiting",
            vercelProductionDeployment: "waiting",
            externalStorageContainerBuildReadiness: "present",
            match: "waiting",
          },
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/production-release-run-action-packet.mjs",
      "--owner-checklist",
      ownerChecklist,
      "--owner-decision-queue",
      ownerQueue,
      "--release-gate",
      releaseGate,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("# UAIS Production Release-Run Action Packet");
    expect(output).toContain("Status: `waiting-for-upstream-evidence`");
    expect(output).toContain("Queue rank: 8");
    expect(output).toContain("Release-run binding must wait until the final release gate is ready.");
    expect(output).toContain("`vercelEnvSync`: `waiting`");
    expect(output).toContain("`externalStorageContainerBuildReadiness`: `present`");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });
});

function writeJson(tmpDir: string, filename: string, body: unknown) {
  const filePath = join(tmpDir, filename);
  writeFileSync(filePath, JSON.stringify(body, null, 2));
  return filePath;
}
