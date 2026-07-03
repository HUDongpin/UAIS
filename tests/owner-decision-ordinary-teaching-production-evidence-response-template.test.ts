import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("owner decision ordinary teaching production evidence response template", () => {
  it("builds a queued redacted response template for ordinary-teaching live evidence", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ordinary-teaching-response-template-"));
    const ownerDecisionQueue = writeJson(tmpDir, "queue.json", buildQueue());
    const actionPacket = writeJson(tmpDir, "ordinary-teaching-action-packet.json", buildActionPacket());

    const output = execFileSync("node", [
      "scripts/owner-decision-ordinary-teaching-production-evidence-response-template.mjs",
      "--owner-decision-queue",
      ownerDecisionQueue,
      "--ordinary-teaching-action-packet",
      actionPacket,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "owner-decision-ordinary-teaching-production-evidence-response-template",
        status: "queued-awaiting-upstream-live-evidence",
        decisionId: "ordinary-teaching-production-evidence",
        responsibleSession: "S22/S19/S10/S12",
      }),
    );
    expect(body.summary).toEqual(
      expect.objectContaining({
        queueRank: 5,
        queueStatus: "waiting-for-live-evidence",
        actionPacketStatus: "waiting-for-live-evidence",
        upstreamBlockedDecisionCount: 4,
        upstreamEvidenceDependencyCount: 5,
        requiredEvidenceCount: 11,
        requiredCommandNameCount: 3,
        releaseReady: false,
      }),
    );
    expect(body.upstreamBlockedDecisionIds).toEqual([
      "app-auth-provider-production-selector",
      "teacher-auth-provider-production-selector",
      "external-storage-production-service",
      "vercel-env-deploy-and-smoke-chain",
    ]);
    expect(body.ownerResponseTemplate).toEqual(
      expect.objectContaining({
        responseStatus: "owner-response-required",
        decisionId: "ordinary-teaching-production-evidence",
        approvedAppAuthReadinessEvidenceLabel: null,
        approvedTeacherAuthReadinessEvidenceLabel: null,
        approvedExternalStorageReadinessEvidenceLabel: null,
        approvedVercelProductionDeploymentEvidenceLabel: null,
        approvedDeploymentReachabilityEvidenceLabel: null,
        approvedTeacherAuthCookieLabel: null,
        approvedSmokeTeacherIdLabel: null,
        approvedSmokeCourseIdLabel: null,
        approvedOtherTeacherIdLabel: null,
        approvedStudentIdLabel: null,
        approvedReleaseRunIdLabel: null,
        confirmsNoCredentialCookieUrlOrEnvValuesInResponse: false,
        confirmsAuthStorageDeploymentPrerequisitesLiveReady: false,
        confirmsOwnerApprovesOrdinaryTeachingLiveSmokes: false,
        confirmsProviderSideEffectsRequireSeparateApproval: false,
        confirmsLocalDryRunEvidenceNotProductionLiveEvidence: false,
      }),
    );
    expect(body.ownerResponseTemplate.requiredEvidenceAfterApproval).toHaveLength(11);
    expect(body.ownerResponseTemplate.requiredCommandNames).toEqual([
      "teachingOperationsRouteSmoke",
      "operationDetailBrowserSmoke",
      "teachingCourseManagementRouteSmoke",
    ]);
    expect(body.copySafeOwnerReplyStub).toEqual({
      responseStatus: "owner-response-provided",
      decisionId: "ordinary-teaching-production-evidence",
      approvedAppAuthReadinessEvidenceLabel: "<label only; no URL, cookie, env, or credential values>",
      approvedTeacherAuthReadinessEvidenceLabel: "<label only; no URL, cookie, env, or credential values>",
      approvedExternalStorageReadinessEvidenceLabel:
        "<label only; no endpoint URL or credential values>",
      approvedVercelProductionDeploymentEvidenceLabel:
        "<label only; no deployment URL or response body>",
      approvedDeploymentReachabilityEvidenceLabel: "<label only; no deployment URL>",
      approvedTeacherAuthCookieLabel: "<label only; no cookie value>",
      approvedSmokeTeacherIdLabel: "<label only; no personal data>",
      approvedSmokeCourseIdLabel: "<label only; no private course data>",
      approvedOtherTeacherIdLabel: "<label only; no personal data>",
      approvedStudentIdLabel: "<label only; no personal data>",
      approvedReleaseRunIdLabel: "<label only; no URL, token, or cookie>",
      confirmsNoCredentialCookieUrlOrEnvValuesInResponse: true,
      confirmsAuthStorageDeploymentPrerequisitesLiveReady: true,
      confirmsOwnerApprovesOrdinaryTeachingLiveSmokes: true,
      confirmsProviderSideEffectsRequireSeparateApproval: true,
      confirmsLocalDryRunEvidenceNotProductionLiveEvidence: true,
    });
    expect(body.ownerResponseValidationCommand).toBe(
      "node scripts/owner-decision-ordinary-teaching-production-evidence-response-validation.mjs --owner-response-template coordination/reports/<this-template-json> --owner-response path/to/filled-owner-response.json",
    );
    expect(body.postResponseAllowedChecks).toEqual([
      "validate-owner-response-shape",
      "confirm-no-cookie-url-env-or-credential-values-in-owner-response",
      "prepare-live-teaching-operations-route-smoke-after-auth-storage-deployment-readiness",
      "prepare-live-operation-detail-browser-smoke-after-operations-evidence",
      "prepare-live-teaching-course-management-route-smoke-after-auth-storage-deployment-readiness",
      "prepare-enterprise-audit-evidence-collection-after-live-smokes",
    ]);
    expect(body.stillForbiddenUntilSeparateApproval).toContain(
      "run-live-ordinary-teaching-smokes-before-auth-storage-and-deployment-readiness",
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://private-teaching.example.test");
    expect(output).not.toContain("uais_teacher_auth_claims=secret");
    expect(output).not.toContain("<approved-teacher-auth-cookie>");
  });

  it("reports missing when the ordinary-teaching evidence item is not present in the owner queue", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ordinary-teaching-response-template-missing-"));
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
    const actionPacket = writeJson(tmpDir, "ordinary-teaching-action-packet.json", buildActionPacket());

    const output = execFileSync("node", [
      "scripts/owner-decision-ordinary-teaching-production-evidence-response-template.mjs",
      "--owner-decision-queue",
      ownerDecisionQueue,
      "--ordinary-teaching-action-packet",
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

  it("renders markdown without source paths, deployment URLs, cookies, or credential values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ordinary-teaching-response-template-md-"));
    const ownerDecisionQueue = writeJson(tmpDir, "queue.json", buildQueue());
    const actionPacket = writeJson(tmpDir, "ordinary-teaching-action-packet.json", buildActionPacket());

    const output = execFileSync("node", [
      "scripts/owner-decision-ordinary-teaching-production-evidence-response-template.mjs",
      "--owner-decision-queue",
      ownerDecisionQueue,
      "--ordinary-teaching-action-packet",
      actionPacket,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("# UAIS Ordinary Teaching Production Evidence Response Template");
    expect(output).toContain("Status: `queued-awaiting-upstream-live-evidence`");
    expect(output).toContain("Do not include credential values, deployment URLs, cookie values, or env file paths.");
    expect(output).toContain("## Copy-Safe Owner Reply Stub");
    expect(output).toContain("<label only; no cookie value>");
    expect(output).toContain("## Validation Command");
    expect(output).toContain(
      "node scripts/owner-decision-ordinary-teaching-production-evidence-response-validation.mjs --owner-response-template coordination/reports/<this-template-json> --owner-response path/to/filled-owner-response.json",
    );
    expect(output).toContain("`teachingOperationsRouteSmoke`");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://private-teaching.example.test");
    expect(output).not.toContain("<approved-teacher-auth-cookie>");
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
      },
      {
        rank: 5,
        id: "ordinary-teaching-production-evidence",
        status: "waiting-for-live-evidence",
        category: "live-evidence",
        nextOwnerQuestion:
          "Run ordinary-teaching live smokes only after auth, storage, and deployment evidence are ready.",
      },
    ],
    leakedPath: "/Users/example/private/queue.json",
  };
}

function buildActionPacket() {
  return {
    target: "ordinary-teaching-production-evidence-action-packet",
    status: "waiting-for-live-evidence",
    decisionId: "ordinary-teaching-production-evidence",
    queueRank: 5,
    upstreamEvidenceIds: [
      "app-auth-provider-readiness",
      "teacher-auth-provider-readiness",
      "external-storage-service-readiness",
      "vercel-production-deployment",
      "deployment-domain-reachability",
    ],
    forbiddenUntilApproved: [
      "run-live-ordinary-teaching-smokes-before-auth-storage-and-deployment-readiness",
      "call-live-teaching-operations-api-without-issued-teacher-auth-cookie",
      "run-provider-backed-side-effect-smokes-without-owner-approval",
      "accept-local-production-smoke-as-production-live-evidence",
      "print-or-log-teacher-auth-cookie-or-backend-secret-values",
    ],
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
    commands: {
      teachingOperationsRouteSmoke:
        "node scripts/teaching-operations-route-smoke.mjs --cookie <approved-teacher-auth-cookie>",
      operationDetailBrowserSmoke:
        "node scripts/teaching-operation-detail-browser-smoke.mjs --base-url <deployment-url>",
      teachingCourseManagementRouteSmoke:
        "node scripts/teaching-course-management-route-smoke.mjs --env-file <approved-env-file>",
    },
    currentEvidenceSummary: {
      teachingOperationsRouteSmokeStatus: "dry-run-blocked",
      operationDetailBrowserSmokeStatus: "dry-run-blocked",
      teachingCourseManagementRouteSmokeStatus: "dry-run-blocked",
      releaseRunIdStatus: "missing",
    },
    leakedUrl: "https://private-teaching.example.test",
    leakedCookie: "uais_teacher_auth_claims=secret",
  };
}

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}
