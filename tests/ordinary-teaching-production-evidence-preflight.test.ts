import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("ordinary teaching production evidence preflight", () => {
  it("keeps ordinary teaching evidence waiting until upstream production evidence and live smokes clear", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ordinary-teaching-preflight-"));
    const ownerResponseValidation = writeJson(tmpDir, "owner-response-validation.json", {
      target: "owner-decision-ordinary-teaching-production-evidence-response-validation",
      status: "owner-response-incomplete",
      decisionId: "ordinary-teaching-production-evidence",
      summary: {
        requiredEvidenceAfterApprovalCount: 11,
        requiredCommandNameCount: 3,
        missingFieldCount: 11,
        liveSmokePrepMayProceed: false,
        enterpriseAuditCollectionMayProceed: false,
        providerSideEffectsStillForbidden: true,
        releaseReady: false,
      },
      requiredEvidenceAfterApproval: [
        "app-auth-provider-readiness-production-live-ready",
        "teacher-auth-provider-readiness-production-live-ready",
        "external-storage-service-readiness-production-live-ready",
        "vercel-production-deployment-evidence",
        "deployment-domain-reachability",
        "issued-teacher-auth-cookie-bound-to-ordinary-teaching-smokes",
        "live-teaching-operations-route-smoke",
        "live-teaching-operation-detail-browser-smoke",
        "live-teaching-course-management-route-smoke",
        "same-release-run-id-bound-to-ordinary-teaching-evidence",
        "same-vercel-production-deployment-bound-to-ordinary-teaching-smokes",
      ],
      requiredCommandNames: [
        "teachingOperationsRouteSmoke",
        "operationDetailBrowserSmoke",
        "teachingCourseManagementRouteSmoke",
      ],
      redactedOwnerResponse: {
        approvedAppAuthReadinessEvidenceLabel: "",
        approvedTeacherAuthReadinessEvidenceLabel: "",
        approvedExternalStorageReadinessEvidenceLabel: "",
      },
      stillForbiddenUntilSeparateApproval: [
        "run-live-ordinary-teaching-smokes-before-auth-storage-and-deployment-readiness",
        "call-live-teaching-operations-api-without-issued-teacher-auth-cookie",
      ],
    });
    const approvalGate = writeJson(tmpDir, "approval-gate.json", {
      target: "owner-decision-live-run-approval-gate",
      status: "approval-gate-blocked",
      stages: [
        {
          id: "ordinary-teaching-production-evidence",
          queueStatus: "waiting-for-live-evidence",
          currentStatus: "waiting-for-live-evidence",
          ownerResponseAccepted: false,
          requiredEvidence: [
            "issued-teacher-auth-cookie-bound-to-ordinary-teaching-smokes",
            "live-teaching-operations-route-smoke",
            "live-teaching-operation-detail-browser-smoke",
            "live-teaching-course-management-route-smoke",
            "same-release-run-id-bound-to-ordinary-teaching-evidence",
            "same-vercel-production-deployment-bound-to-ordinary-teaching-smokes",
          ],
        },
      ],
      firstIncompleteOwnerResponse: {
        id: "ordinary-teaching-production-evidence",
        requiredOwnerInputFields: [
          "approvedAppAuthReadinessEvidenceLabel",
          "approvedTeacherAuthReadinessEvidenceLabel",
          "approvedExternalStorageReadinessEvidenceLabel",
          "approvedVercelProductionDeploymentEvidenceLabel",
          "approvedDeploymentReachabilityEvidenceLabel",
          "approvedTeacherAuthCookieLabel",
          "approvedSmokeTeacherIdLabel",
          "approvedSmokeCourseIdLabel",
          "approvedOtherTeacherIdLabel",
          "approvedStudentIdLabel",
          "approvedReleaseRunIdLabel",
        ],
      },
    });
    const prerequisiteIndex = writeJson(tmpDir, "prerequisite-index.json", {
      target: "ordinary-teaching-production-evidence-prerequisite-index",
      status: "waiting-for-production-live-evidence",
      decisionId: "ordinary-teaching-production-evidence",
      summary: {
        acceptedOwnerPrerequisiteCount: 4,
        incompleteOwnerPrerequisiteCount: 0,
        upstreamEvidenceDependencyCount: 5,
        missingPrerequisiteEvidenceCount: 5,
        smokeTargetCount: 3,
        missingSmokeTargetCount: 3,
        ordinaryOwnerMissingFieldCount: 11,
        ordinaryOwnerResponseCanBeAccepted: false,
        releaseReady: false,
      },
      ownerPrerequisites: [
        acceptedPrerequisite("app-auth-provider-production-selector"),
        acceptedPrerequisite("teacher-auth-provider-production-selector"),
        acceptedPrerequisite("external-storage-production-service"),
        acceptedPrerequisite("vercel-env-deploy-and-smoke-chain"),
      ],
      missingPrerequisiteEvidence: [
        missingEvidence("app-auth-provider-readiness"),
        missingEvidence("teacher-auth-provider-readiness"),
        missingEvidence("external-storage-service-readiness"),
        missingEvidence("vercel-production-deployment"),
        missingEvidence("deployment-domain-reachability"),
      ],
      missingSmokeTargets: [
        missingEvidence("teaching-operations-route-smoke"),
        missingEvidence("teaching-operation-detail-browser-smoke"),
        missingEvidence("teaching-course-management-route-smoke"),
      ],
      requiredEvidenceAfterApproval: [
        "app-auth-provider-readiness-production-live-ready",
        "teacher-auth-provider-readiness-production-live-ready",
        "external-storage-service-readiness-production-live-ready",
      ],
      requiredCommandNames: [
        "teachingOperationsRouteSmoke",
        "operationDetailBrowserSmoke",
        "teachingCourseManagementRouteSmoke",
      ],
    });
    const actionPacket = writeJson(tmpDir, "ordinary-action-packet.json", {
      target: "ordinary-teaching-production-evidence-action-packet",
      decisionId: "ordinary-teaching-production-evidence",
      requiredEvidence: [
        "app-auth-provider-readiness-production-live-ready",
        "teacher-auth-provider-readiness-production-live-ready",
        "external-storage-service-readiness-production-live-ready",
        "vercel-production-deployment-evidence",
        "deployment-domain-reachability",
        "issued-teacher-auth-cookie-bound-to-ordinary-teaching-smokes",
        "live-teaching-operations-route-smoke",
        "live-teaching-operation-detail-browser-smoke",
        "live-teaching-course-management-route-smoke",
        "same-release-run-id-bound-to-ordinary-teaching-evidence",
        "same-vercel-production-deployment-bound-to-ordinary-teaching-smokes",
      ],
      currentEvidenceSummary: {
        teachingOperationsRouteSmokeStatus: "dry-run-blocked",
        operationDetailBrowserSmokeStatus: "dry-run-blocked",
        teachingCourseManagementRouteSmokeStatus: "dry-run-blocked",
        releaseRunIdStatus: "missing",
        teacherAuthBindingStatus: "missing",
      },
      commands: {
        teachingOperationsRouteSmoke:
          "node scripts/teaching-operations-route-smoke.mjs --base-url <deployment-url> --teacher-cookie <approved-teacher-auth-cookie> --release-run-id <release-run-id> > <teaching-operations-route-smoke-evidence>",
        operationDetailBrowserSmoke:
          "node scripts/operation-detail-browser-smoke.mjs --base-url <deployment-url> --teacher-id <smoke-teacher-id> --course-id <smoke-course-id> --release-run-id <release-run-id> > <operation-detail-browser-smoke-evidence>",
        teachingCourseManagementRouteSmoke:
          "node scripts/teaching-course-management-route-smoke.mjs --base-url <deployment-url> --teacher-id <smoke-teacher-id> --course-id <smoke-course-id> --release-run-id <release-run-id> > <teaching-course-management-route-smoke-evidence>",
      },
      safeNextActions: [
        "wait-for-auth-storage-and-vercel-deployment-evidence",
        "run-live-teaching-operations-route-smoke-after-auth-storage-deployment-readiness",
      ],
      forbiddenUntilApproved: [
        "run-live-ordinary-teaching-smokes-before-auth-storage-and-deployment-readiness",
      ],
    });
    const appAuthPreflight = writePreflight(tmpDir, "app-auth-preflight.json", {
      status: "app-auth-production-evidence-preflight-ready",
      releaseReady: false,
      missingEvidenceCount: 3,
    });
    const teacherAuthPreflight = writePreflight(tmpDir, "teacher-auth-preflight.json", {
      status: "teacher-auth-production-evidence-preflight-waiting-for-upstream-app-auth",
      releaseReady: false,
      missingEvidenceCount: 4,
    });
    const externalStoragePreflight = writePreflight(tmpDir, "external-storage-preflight.json", {
      status: "external-storage-production-evidence-preflight-waiting-for-upstream-auth",
      releaseReady: false,
      missingEvidenceCount: 5,
    });
    const vercelPreflight = writePreflight(tmpDir, "vercel-preflight.json", {
      status:
        "vercel-env-deploy-production-evidence-preflight-waiting-for-upstream-provider-evidence",
      releaseReady: false,
      missingEvidenceCount: 12,
    });

    const output = execFileSync("node", [
      "scripts/ordinary-teaching-production-evidence-preflight.mjs",
      "--owner-response-validation",
      ownerResponseValidation,
      "--approval-gate",
      approvalGate,
      "--ordinary-prerequisite-index",
      prerequisiteIndex,
      "--ordinary-teaching-action-packet",
      actionPacket,
      "--app-auth-preflight",
      appAuthPreflight,
      "--teacher-auth-preflight",
      teacherAuthPreflight,
      "--external-storage-preflight",
      externalStoragePreflight,
      "--vercel-env-deploy-preflight",
      vercelPreflight,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "ordinary-teaching-production-evidence-preflight",
        status:
          "ordinary-teaching-production-evidence-preflight-waiting-for-upstream-production-evidence",
        releaseReady: false,
        ownerDecisionId: "ordinary-teaching-production-evidence",
      }),
    );
    expect(body.summary).toEqual({
      ownerResponseAccepted: false,
      ordinaryStageWaitingForLiveEvidence: true,
      ownerPrerequisitesAccepted: true,
      upstreamProductionEvidenceCleared: false,
      smokeTargetsCleared: false,
      ordinaryOwnerResponseCanBeAccepted: false,
      requiredEvidenceCount: 11,
      missingPrerequisiteEvidenceCount: 5,
      missingSmokeTargetCount: 3,
      ordinaryOwnerMissingFieldCount: 11,
      requiredOwnerInputFieldCount: 11,
      commandTemplateCount: 3,
      releaseReady: false,
    });
    expect(body.requiredOwnerInputFields).toEqual([
      "approvedAppAuthReadinessEvidenceLabel",
      "approvedTeacherAuthReadinessEvidenceLabel",
      "approvedExternalStorageReadinessEvidenceLabel",
      "approvedVercelProductionDeploymentEvidenceLabel",
      "approvedDeploymentReachabilityEvidenceLabel",
      "approvedTeacherAuthCookieLabel",
      "approvedSmokeTeacherIdLabel",
      "approvedSmokeCourseIdLabel",
      "approvedOtherTeacherIdLabel",
      "approvedStudentIdLabel",
      "approvedReleaseRunIdLabel",
    ]);
    expect(body.upstreamBlockers).toEqual([
      "app-auth-production-evidence-not-cleared",
      "teacher-auth-production-evidence-not-cleared",
      "external-storage-production-evidence-not-cleared",
      "vercel-production-deployment-evidence-not-cleared",
    ]);
    expect(body.missingPrerequisiteEvidence.map((item: { id: string }) => item.id)).toEqual([
      "app-auth-provider-readiness",
      "teacher-auth-provider-readiness",
      "external-storage-service-readiness",
      "vercel-production-deployment",
      "deployment-domain-reachability",
    ]);
    expect(body.missingSmokeTargets.map((item: { id: string }) => item.id)).toEqual([
      "teaching-operations-route-smoke",
      "teaching-operation-detail-browser-smoke",
      "teaching-course-management-route-smoke",
    ]);
    expect(body.blockedReasons).toContain("upstream-production-evidence-not-cleared");
    expect(body.blockedReasons).toContain("ordinary-owner-response-not-accepted");
    expect(body.blockedReasons).toContain("ordinary-live-smoke-targets-not-cleared");
    expect(body.safety).toEqual(
      expect.objectContaining({
        envFileRead: false,
        deploymentUrlsOmitted: true,
        cookieValuesOmitted: true,
        credentialValuesOmitted: true,
        responseBodiesOmitted: true,
        liveSmokePerformed: false,
        noLiveMutationPerformed: true,
        noDeploymentMutationPerformed: true,
        noReleaseRunBindingPerformed: true,
      }),
    );

    const markdown = execFileSync("node", [
      "scripts/ordinary-teaching-production-evidence-preflight.mjs",
      "--owner-response-validation",
      ownerResponseValidation,
      "--approval-gate",
      approvalGate,
      "--ordinary-prerequisite-index",
      prerequisiteIndex,
      "--ordinary-teaching-action-packet",
      actionPacket,
      "--app-auth-preflight",
      appAuthPreflight,
      "--teacher-auth-preflight",
      teacherAuthPreflight,
      "--external-storage-preflight",
      externalStoragePreflight,
      "--vercel-env-deploy-preflight",
      vercelPreflight,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(markdown).toContain("# UAIS Ordinary Teaching Production Evidence Preflight");
    expect(markdown).toContain(
      "Status: `ordinary-teaching-production-evidence-preflight-waiting-for-upstream-production-evidence`",
    );
    expect(markdown).toContain("## Safe Command Templates");
    expect(markdown).not.toContain("https://");
    expect(markdown).not.toContain("/Users/");
    expect(markdown).not.toContain("approved-teacher-auth-cookie");
    expect(markdown).not.toContain("teacher-cookie");
    expect(markdown).not.toContain("teacher-id");
  });

  it("stays blocked when upstream owner prerequisites are incomplete", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ordinary-teaching-blocked-"));
    const ownerResponseValidation = writeJson(tmpDir, "owner-response-validation.json", {
      status: "owner-response-incomplete",
      summary: { missingFieldCount: 11 },
    });
    const approvalGate = writeJson(tmpDir, "approval-gate.json", { stages: [] });
    const prerequisiteIndex = writeJson(tmpDir, "prerequisite-index.json", {
      summary: {
        acceptedOwnerPrerequisiteCount: 3,
        incompleteOwnerPrerequisiteCount: 1,
        missingPrerequisiteEvidenceCount: 5,
        missingSmokeTargetCount: 3,
        ordinaryOwnerResponseCanBeAccepted: false,
      },
      ownerPrerequisites: [
        acceptedPrerequisite("app-auth-provider-production-selector"),
        {
          decisionId: "teacher-auth-provider-production-selector",
          validationStatus: "owner-response-incomplete",
          accepted: false,
        },
      ],
      missingPrerequisiteEvidence: [],
      missingSmokeTargets: [],
      requiredCommandNames: [],
    });
    const actionPacket = writeJson(tmpDir, "ordinary-action-packet.json", {});

    const output = execFileSync("node", [
      "scripts/ordinary-teaching-production-evidence-preflight.mjs",
      "--owner-response-validation",
      ownerResponseValidation,
      "--approval-gate",
      approvalGate,
      "--ordinary-prerequisite-index",
      prerequisiteIndex,
      "--ordinary-teaching-action-packet",
      actionPacket,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe(
      "ordinary-teaching-production-evidence-preflight-blocked",
    );
    expect(body.summary.ownerPrerequisitesAccepted).toBe(false);
    expect(body.blockedReasons).toContain("owner-prerequisite-responses-incomplete");
  });
});

function acceptedPrerequisite(decisionId: string) {
  return {
    decisionId,
    validationStatus: "owner-response-accepted",
    missingFieldCount: 0,
    unsafeFindingCount: 0,
    accepted: true,
  };
}

function missingEvidence(id: string) {
  return {
    id,
    requirementStatus: "blocked",
    evidenceStatus: "dry-run-blocked",
    blockedReason: `${id}-not-live-ready`,
    satisfied: false,
  };
}

function writePreflight(
  dir: string,
  fileName: string,
  value: { status: string; releaseReady: boolean; missingEvidenceCount: number },
) {
  return writeJson(dir, fileName, {
    status: value.status,
    releaseReady: value.releaseReady,
    summary: {
      missingEvidenceCount: value.missingEvidenceCount,
    },
  });
}

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}
