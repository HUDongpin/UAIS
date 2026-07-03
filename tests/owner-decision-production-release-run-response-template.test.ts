import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("owner decision production release run response template", () => {
  it("builds a queued redacted response template for final release-run binding", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-production-release-run-response-template-"));
    const ownerDecisionQueue = writeJson(tmpDir, "queue.json", buildQueue());
    const actionPacket = writeJson(tmpDir, "production-release-run-action-packet.json", buildActionPacket());

    const output = execFileSync("node", [
      "scripts/owner-decision-production-release-run-response-template.mjs",
      "--owner-decision-queue",
      ownerDecisionQueue,
      "--production-release-run-action-packet",
      actionPacket,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "owner-decision-production-release-run-response-template",
        status: "queued-awaiting-final-release-gate",
        decisionId: "production-release-run",
        responsibleSession: "S22/S10/S25",
      }),
    );
    expect(body.summary).toEqual(
      expect.objectContaining({
        queueRank: 8,
        queueStatus: "waiting-for-upstream-evidence",
        actionPacketStatus: "waiting-for-upstream-evidence",
        upstreamBlockedDecisionCount: 7,
        blockedReasonCount: 15,
        releaseGateRequirementCount: 19,
        missingEnterpriseAuditTargetCount: 16,
        requiredEvidenceCount: 2,
        requiredCommandNameCount: 2,
        waitingReleaseRunEvidenceCount: 15,
        matchedReleaseRunEvidenceCount: 0,
        releaseReady: false,
      }),
    );
    expect(body.upstreamBlockedDecisionIds).toEqual([
      "app-auth-provider-production-selector",
      "teacher-auth-provider-production-selector",
      "external-storage-production-service",
      "vercel-env-deploy-and-smoke-chain",
      "ordinary-teaching-production-evidence",
      "manual-ppt-playback-acceptance",
      "enterprise-live-evidence-audit",
    ]);
    expect(body.ownerResponseTemplate).toEqual(
      expect.objectContaining({
        responseStatus: "owner-response-required",
        decisionId: "production-release-run",
        approvedFinalReleaseGateReadyEvidenceLabel: null,
        approvedOwnerChecklistClearEvidenceLabel: null,
        approvedEnterpriseLiveEvidenceAuditReadyLabel: null,
        approvedSharedReleaseRunIdLabel: null,
        approvedVercelProductionDeploymentEvidenceLabel: null,
        approvedProductionEvidenceSetLabel: null,
        approvedRedactedReleaseSummaryLabel: null,
        approvedRollbackOrHoldPlanLabel: null,
        confirmsNoRawUrlsLocalPathsCookiesOrCredentialValuesInResponse: false,
        confirmsProductionReleaseGateReady: false,
        confirmsOwnerChecklistHasNoWaitingOrBlockedDecisions: false,
        confirmsAllProductionEvidenceUsesSameReleaseRunId: false,
        confirmsEnterpriseLiveEvidenceAuditReady: false,
        confirmsNoMixedDeploymentOrReleaseRunEvidence: false,
        confirmsReleaseSummaryIsRedacted: false,
        confirmsOwnerApprovesFinalReleaseRunBinding: false,
      }),
    );
    expect(body.ownerResponseTemplate.releaseGateRequirementIds).toHaveLength(19);
    expect(body.ownerResponseTemplate.missingEnterpriseAuditTargets).toHaveLength(16);
    expect(body.ownerResponseTemplate.blockedReasons).toHaveLength(15);
    expect(body.ownerResponseTemplate.requiredEvidenceAfterApproval).toEqual([
      "one-public-release-run-id-used-across-production-evidence",
      "final-release-gate-ready",
    ]);
    expect(body.ownerResponseTemplate.requiredCommandNames).toEqual([
      "finalReleaseGateCheck",
      "releaseRunBindingReview",
    ]);
    expect(body.copySafeOwnerReplyStub).toEqual({
      responseStatus: "owner-response-provided",
      decisionId: "production-release-run",
      approvedFinalReleaseGateReadyEvidenceLabel:
        "<label only; no URL, local path, cookie, or credential value>",
      approvedOwnerChecklistClearEvidenceLabel:
        "<label only; no URL, local path, cookie, or credential value>",
      approvedEnterpriseLiveEvidenceAuditReadyLabel:
        "<label only; no URL, local path, cookie, or credential value>",
      approvedSharedReleaseRunIdLabel: "<label only; no URL, token, or cookie>",
      approvedVercelProductionDeploymentEvidenceLabel:
        "<label only; no URL, local path, cookie, or credential value>",
      approvedProductionEvidenceSetLabel:
        "<label only; no URL, local path, cookie, or credential value>",
      approvedRedactedReleaseSummaryLabel:
        "<label only; no URL, local path, cookie, or credential value>",
      approvedRollbackOrHoldPlanLabel:
        "<label only; no URL, local path, cookie, or credential value>",
      confirmsNoRawUrlsLocalPathsCookiesOrCredentialValuesInResponse: true,
      confirmsProductionReleaseGateReady: true,
      confirmsOwnerChecklistHasNoWaitingOrBlockedDecisions: true,
      confirmsAllProductionEvidenceUsesSameReleaseRunId: true,
      confirmsEnterpriseLiveEvidenceAuditReady: true,
      confirmsNoMixedDeploymentOrReleaseRunEvidence: true,
      confirmsReleaseSummaryIsRedacted: true,
      confirmsOwnerApprovesFinalReleaseRunBinding: true,
    });
    expect(body.ownerResponseValidationCommand).toBe(
      "node scripts/owner-decision-production-release-run-response-validation.mjs --owner-response-template coordination/reports/<this-template-json> --owner-response path/to/filled-owner-response.json",
    );
    expect(body.postResponseAllowedChecks).toEqual([
      "validate-owner-response-shape",
      "confirm-no-raw-urls-local-paths-cookies-or-credential-values-in-owner-response",
      "confirm-final-release-gate-ready-before-binding-release-run",
      "prepare-redacted-production-release-run-summary-after-owner-approval",
    ]);
    expect(body.stillForbiddenUntilSeparateApproval).toContain(
      "bind-release-run-id-while-release-gate-blocked",
    );
    expect(body.stillForbiddenUntilSeparateApproval).toContain(
      "execute-release-run-binding-in-this-template",
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://private-release.example.test");
    expect(output).not.toContain("<release-gate-inputs>");
  });

  it("reports missing when the production release run item is not present in the owner queue", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-production-release-run-response-template-missing-"));
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
    const actionPacket = writeJson(tmpDir, "production-release-run-action-packet.json", buildActionPacket());

    const output = execFileSync("node", [
      "scripts/owner-decision-production-release-run-response-template.mjs",
      "--owner-decision-queue",
      ownerDecisionQueue,
      "--production-release-run-action-packet",
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

  it("renders markdown without source paths, raw URLs, cookies, or command placeholders", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-production-release-run-response-template-md-"));
    const ownerDecisionQueue = writeJson(tmpDir, "queue.json", buildQueue());
    const actionPacket = writeJson(tmpDir, "production-release-run-action-packet.json", buildActionPacket());

    const output = execFileSync("node", [
      "scripts/owner-decision-production-release-run-response-template.mjs",
      "--owner-decision-queue",
      ownerDecisionQueue,
      "--production-release-run-action-packet",
      actionPacket,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("# UAIS Production Release Run Response Template");
    expect(output).toContain("Status: `queued-awaiting-final-release-gate`");
    expect(output).toContain("Do not include raw URLs, local paths, cookie values, response bodies, or credential values.");
    expect(output).toContain("## Copy-Safe Owner Reply Stub");
    expect(output).toContain("<label only; no URL, local path, cookie, or credential value>");
    expect(output).toContain("## Validation Command");
    expect(output).toContain(
      "node scripts/owner-decision-production-release-run-response-validation.mjs --owner-response-template coordination/reports/<this-template-json> --owner-response path/to/filled-owner-response.json",
    );
    expect(output).toContain("`production-release-run-consistency`");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://private-release.example.test");
    expect(output).not.toContain("<release-gate-inputs>");
  });
});

function buildQueue() {
  return {
    status: "owner-decisions-required",
    queue: [
      { rank: 1, id: "app-auth-provider-production-selector", status: "owner-decision-needed" },
      { rank: 2, id: "teacher-auth-provider-production-selector", status: "owner-decision-needed" },
      { rank: 3, id: "external-storage-production-service", status: "owner-decision-needed" },
      { rank: 4, id: "vercel-env-deploy-and-smoke-chain", status: "waiting-for-upstream-owner-decisions" },
      { rank: 5, id: "ordinary-teaching-production-evidence", status: "waiting-for-live-evidence" },
      { rank: 6, id: "manual-ppt-playback-acceptance", status: "human-qa-needed" },
      { rank: 7, id: "enterprise-live-evidence-audit", status: "waiting-for-live-evidence" },
      {
        rank: 8,
        id: "production-release-run",
        status: "waiting-for-upstream-evidence",
        category: "final-release-binding",
        nextOwnerQuestion: "Do not bind the production release-run ID until the release gate is ready.",
      },
    ],
    leakedPath: "/Users/example/private/queue.json",
  };
}

function buildActionPacket() {
  return {
    target: "production-release-run-action-packet",
    status: "waiting-for-upstream-evidence",
    releaseGateStatus: "blocked",
    responsibleSessions: ["S22", "S24"],
    decisionId: "production-release-run",
    queueRank: 8,
    classification: "final-release-run-binding-blocked",
    nextOwnerQuestion: "Do not bind the production release-run ID until the release gate is ready.",
    blockedReasons: blockedReasons(),
    safeNextActions: [
      "wait-for-final-release-gate-ready",
      "bind-one-public-release-run-id-after-all-production-evidence-is-ready",
      "verify-owner-checklist-has-no-waiting-or-blocked-decisions",
      "publish-release-run-summary-with-redacted-evidence-only",
    ],
    forbiddenUntilApproved: [
      "bind-release-run-id-while-release-gate-blocked",
      "mix-production-evidence-from-multiple-release-run-ids",
      "include-local-private-paths-or-secret-values-in-release-run-summary",
      "treat-owner-decisions-required-as-release-ready",
    ],
    requiredEvidence: [
      "one-public-release-run-id-used-across-production-evidence",
      "final-release-gate-ready",
    ],
    currentEvidenceSummary: {
      requirementStatus: "blocked",
      evidenceStatus: "waiting-for-production-evidence",
      waitingReleaseRunEvidenceCount: 15,
      presentReleaseRunEvidenceCount: 1,
      matchedReleaseRunEvidenceCount: 0,
      matchStatus: "waiting",
    },
    releaseGateRequirementIds: releaseGateRequirements(),
    enterpriseAuditMissingTargets: enterpriseAuditMissingTargets(),
    commands: {
      finalReleaseGateCheck:
        "node -- scripts/production-e2e-release-gate.mjs <release-gate-inputs> > <production-e2e-release-gate-output>",
      releaseRunBindingReview:
        "review production-release-run-consistency in <production-e2e-release-gate-output> and bind one public release-run ID only after status is ready",
    },
    leakedUrl: "https://private-release.example.test/evidence",
    leakedCookie: "uais_teacher_auth_signature=secret-cookie-value",
  };
}

function blockedReasons() {
  return [
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
}

function releaseGateRequirements() {
  return [
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
}

function enterpriseAuditMissingTargets() {
  return [
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
}

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}
