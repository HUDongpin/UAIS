import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("owner decision production release run response validation", () => {
  it("accepts a complete redacted final release-run response while performing no binding", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-production-release-run-response-validation-"));
    const template = writeJson(tmpDir, "template.json", buildTemplateReport());
    const ownerResponse = writeJson(tmpDir, "owner-response.json", {
      responseStatus: "owner-response-provided",
      decisionId: "production-release-run",
      approvedFinalReleaseGateReadyEvidenceLabel: "final-release-gate-ready-redacted",
      approvedOwnerChecklistClearEvidenceLabel: "owner-checklist-clear-redacted",
      approvedEnterpriseLiveEvidenceAuditReadyLabel: "enterprise-live-audit-ready-redacted",
      approvedSharedReleaseRunIdLabel: "release-run-final-2026-07-01",
      approvedVercelProductionDeploymentEvidenceLabel: "vercel-production-deployment-redacted",
      approvedProductionEvidenceSetLabel: "all-production-evidence-same-release-run-redacted",
      approvedRedactedReleaseSummaryLabel: "redacted-release-summary-approved",
      approvedRollbackOrHoldPlanLabel: "rollback-or-hold-plan-approved",
      confirmsNoRawUrlsLocalPathsCookiesOrCredentialValuesInResponse: true,
      confirmsProductionReleaseGateReady: true,
      confirmsOwnerChecklistHasNoWaitingOrBlockedDecisions: true,
      confirmsAllProductionEvidenceUsesSameReleaseRunId: true,
      confirmsEnterpriseLiveEvidenceAuditReady: true,
      confirmsNoMixedDeploymentOrReleaseRunEvidence: true,
      confirmsReleaseSummaryIsRedacted: true,
      confirmsOwnerApprovesFinalReleaseRunBinding: true,
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-production-release-run-response-validation.mjs",
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
        target: "owner-decision-production-release-run-response-validation",
        status: "owner-response-accepted",
        decisionId: "production-release-run",
        responsibleSession: "S22/S10/S25",
      }),
    );
    expect(body.summary).toEqual(
      expect.objectContaining({
        missingFieldCount: 0,
        unsafeFindingCount: 0,
        requiredEvidenceAfterApprovalCount: 2,
        requiredCommandNameCount: 2,
        finalReleaseSummaryMayProceed: true,
        releaseRunBindingMayProceedAfterSeparateOwnerAction: true,
        releaseRunBindingPerformed: false,
        releaseReady: false,
      }),
    );
    expect(body.postValidationAllowedChecks).toEqual([
      "prepare-final-release-gate-readback-after-all-live-evidence-exists",
      "prepare-redacted-production-release-run-summary-for-owner-review",
    ]);
    expect(body.stillForbiddenUntilSeparateApproval).toContain(
      "bind-release-run-id-in-this-validation-script",
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://");
    expect(output).not.toContain("uais_teacher_auth_signature=");
  });

  it("keeps the template placeholder incomplete until final gate evidence is filled", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-production-release-run-response-validation-incomplete-"));
    const templateReport = buildTemplateReport();
    const template = writeJson(tmpDir, "template.json", templateReport);
    const ownerResponse = writeJson(tmpDir, "owner-response.json", templateReport);

    const output = execFileSync("node", [
      "scripts/owner-decision-production-release-run-response-validation.mjs",
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
    expect(body.summary.missingFieldCount).toBeGreaterThanOrEqual(17);
    expect(body.summary.finalReleaseSummaryMayProceed).toBe(false);
    expect(body.summary.releaseRunBindingMayProceedAfterSeparateOwnerAction).toBe(false);
    expect(body.postValidationAllowedChecks).toEqual([]);
    expect(body.blockedReasons).toContain(
      "approvedFinalReleaseGateReadyEvidenceLabel-missing-or-invalid",
    );
    expect(body.blockedReasons).toContain(
      "confirmsOwnerApprovesFinalReleaseRunBinding-not-confirmed",
    );
    expect(output).not.toContain(tmpDir);
  });

  it("renders empty post-validation checks explicitly in incomplete markdown", () => {
    const tmpDir = mkdtempSync(
      join(tmpdir(), "uais-production-release-run-response-validation-md-incomplete-"),
    );
    const templateReport = buildTemplateReport();
    const template = writeJson(tmpDir, "template.json", templateReport);
    const ownerResponse = writeJson(tmpDir, "owner-response.json", templateReport);

    const output = execFileSync("node", [
      "scripts/owner-decision-production-release-run-response-validation.mjs",
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
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-production-release-run-response-validation-stub-"));
    const templateReport = {
      ...buildTemplateReport(),
      copySafeOwnerReplyStub: {
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
      },
    };
    const template = writeJson(tmpDir, "template.json", templateReport);
    const ownerResponse = writeJson(tmpDir, "owner-response.json", templateReport);

    const output = execFileSync("node", [
      "scripts/owner-decision-production-release-run-response-validation.mjs",
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
    expect(body.summary.finalReleaseSummaryMayProceed).toBe(false);
    expect(body.summary.releaseRunBindingMayProceedAfterSeparateOwnerAction).toBe(false);
    expect(body.summary.releaseRunBindingPerformed).toBe(false);
    expect(body.redactedOwnerResponse).toEqual(templateReport.copySafeOwnerReplyStub);
    expect(body.blockedReasons).toEqual([
      "approvedFinalReleaseGateReadyEvidenceLabel-missing-or-invalid",
      "approvedOwnerChecklistClearEvidenceLabel-missing-or-invalid",
      "approvedEnterpriseLiveEvidenceAuditReadyLabel-missing-or-invalid",
      "approvedSharedReleaseRunIdLabel-missing-or-invalid",
      "approvedVercelProductionDeploymentEvidenceLabel-missing-or-invalid",
      "approvedProductionEvidenceSetLabel-missing-or-invalid",
      "approvedRedactedReleaseSummaryLabel-missing-or-invalid",
      "approvedRollbackOrHoldPlanLabel-missing-or-invalid",
    ]);
    expect(output).not.toContain(tmpDir);
  });

  it("rejects unsafe owner responses without echoing paths, URLs, cookies, or credential values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-production-release-run-response-validation-unsafe-"));
    const template = writeJson(tmpDir, "template.json", buildTemplateReport());
    const ownerResponse = writeJson(tmpDir, "owner-response.json", {
      responseStatus: "owner-response-provided",
      decisionId: "production-release-run",
      approvedFinalReleaseGateReadyEvidenceLabel: "/Users/example/private/release-gate.json",
      approvedOwnerChecklistClearEvidenceLabel: "https://private-release.example.test/checklist",
      approvedEnterpriseLiveEvidenceAuditReadyLabel: "enterprise-live-audit-ready-redacted",
      approvedSharedReleaseRunIdLabel: "release-run-final-2026-07-01",
      approvedVercelProductionDeploymentEvidenceLabel: "vercel-production-deployment-redacted",
      approvedProductionEvidenceSetLabel: "all-production-evidence-same-release-run-redacted",
      approvedRedactedReleaseSummaryLabel: "redacted-release-summary-approved",
      approvedRollbackOrHoldPlanLabel: "rollback-or-hold-plan-approved",
      confirmsNoRawUrlsLocalPathsCookiesOrCredentialValuesInResponse: true,
      confirmsProductionReleaseGateReady: true,
      confirmsOwnerChecklistHasNoWaitingOrBlockedDecisions: true,
      confirmsAllProductionEvidenceUsesSameReleaseRunId: true,
      confirmsEnterpriseLiveEvidenceAuditReady: true,
      confirmsNoMixedDeploymentOrReleaseRunEvidence: true,
      confirmsReleaseSummaryIsRedacted: true,
      confirmsOwnerApprovesFinalReleaseRunBinding: true,
      notes: "UAIS_RELEASE_RUN_TOKEN=secret-token-value uais_teacher_auth_signature=secret-cookie",
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-production-release-run-response-validation.mjs",
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
    expect(body.redactedOwnerResponse.approvedFinalReleaseGateReadyEvidenceLabel).toBeNull();
    expect(body.redactedOwnerResponse.approvedOwnerChecklistClearEvidenceLabel).toBeNull();
    expect(body.unsafeFindings.map((finding: { patternId: string }) => finding.patternId)).toEqual(
      expect.arrayContaining([
        "raw-url",
        "local-user-path",
        "env-assignment",
        "teacher-auth-cookie-assignment",
      ]),
    );
    expect(output).not.toContain("/Users/example/private/release-gate.json");
    expect(output).not.toContain("https://private-release.example.test");
    expect(output).not.toContain("secret-token-value");
    expect(output).not.toContain("uais_teacher_auth_signature=secret-cookie");
  });

  it("renders markdown without paths, URLs, cookies, or credential values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-production-release-run-response-validation-md-"));
    const template = writeJson(tmpDir, "template.json", buildTemplateReport());
    const ownerResponse = writeJson(tmpDir, "owner-response.json", {
      responseStatus: "owner-response-provided",
      decisionId: "production-release-run",
      approvedFinalReleaseGateReadyEvidenceLabel: "final-release-gate-ready-redacted",
      approvedOwnerChecklistClearEvidenceLabel: "owner-checklist-clear-redacted",
      approvedEnterpriseLiveEvidenceAuditReadyLabel: "enterprise-live-audit-ready-redacted",
      approvedSharedReleaseRunIdLabel: "release-run-final-2026-07-01",
      approvedVercelProductionDeploymentEvidenceLabel: "vercel-production-deployment-redacted",
      approvedProductionEvidenceSetLabel: "all-production-evidence-same-release-run-redacted",
      approvedRedactedReleaseSummaryLabel: "redacted-release-summary-approved",
      approvedRollbackOrHoldPlanLabel: "rollback-or-hold-plan-approved",
      confirmsNoRawUrlsLocalPathsCookiesOrCredentialValuesInResponse: true,
      confirmsProductionReleaseGateReady: true,
      confirmsOwnerChecklistHasNoWaitingOrBlockedDecisions: true,
      confirmsAllProductionEvidenceUsesSameReleaseRunId: true,
      confirmsEnterpriseLiveEvidenceAuditReady: true,
      confirmsNoMixedDeploymentOrReleaseRunEvidence: true,
      confirmsReleaseSummaryIsRedacted: true,
      confirmsOwnerApprovesFinalReleaseRunBinding: true,
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-production-release-run-response-validation.mjs",
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

    expect(output).toContain("# UAIS Production Release Run Response Validation");
    expect(output).toContain("Status: `owner-response-accepted`");
    expect(output).toContain("Release-run binding performed: `false`");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://");
    expect(output).not.toContain("uais_teacher_auth_signature=");
  });
});

function buildTemplateReport() {
  return {
    target: "owner-decision-production-release-run-response-template",
    status: "queued-awaiting-final-release-gate",
    decisionId: "production-release-run",
    ownerResponseTemplate: {
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
      releaseGateRequirementIds: releaseGateRequirements(),
      missingEnterpriseAuditTargets: ["app-auth-provider-readiness", "external-storage-smoke"],
      blockedReasons: ["vercel-production-deployment-not-proven"],
      requiredEvidenceAfterApproval: [
        "one-public-release-run-id-used-across-production-evidence",
        "final-release-gate-ready",
      ],
      requiredCommandNames: [
        "finalReleaseGateCheck",
        "releaseRunBindingReview",
      ],
    },
  };
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

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}
