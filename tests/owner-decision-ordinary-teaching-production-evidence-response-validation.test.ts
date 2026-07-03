import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("owner decision ordinary teaching production evidence response validation", () => {
  it("accepts a complete redacted owner response while keeping live smokes gated", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ordinary-teaching-response-validation-"));
    const template = writeJson(tmpDir, "template.json", buildTemplateReport());
    const ownerResponse = writeJson(tmpDir, "owner-response.json", {
      responseStatus: "owner-response-provided",
      decisionId: "ordinary-teaching-production-evidence",
      approvedAppAuthReadinessEvidenceLabel: "app-auth-readiness-live-ready-redacted",
      approvedTeacherAuthReadinessEvidenceLabel: "teacher-auth-readiness-live-ready-redacted",
      approvedExternalStorageReadinessEvidenceLabel: "external-storage-readiness-live-ready-redacted",
      approvedVercelProductionDeploymentEvidenceLabel: "vercel-production-deployment-redacted",
      approvedDeploymentReachabilityEvidenceLabel: "deployment-reachability-redacted",
      approvedTeacherAuthCookieLabel: "teacher-auth-cookie-redacted-label",
      approvedSmokeTeacherIdLabel: "smoke-teacher-redacted",
      approvedSmokeCourseIdLabel: "smoke-course-redacted",
      approvedOtherTeacherIdLabel: "other-teacher-redacted",
      approvedStudentIdLabel: "student-redacted",
      approvedReleaseRunIdLabel: "release-run-ordinary-teaching-2026-07-01",
      confirmsNoCredentialCookieUrlOrEnvValuesInResponse: true,
      confirmsAuthStorageDeploymentPrerequisitesLiveReady: true,
      confirmsOwnerApprovesOrdinaryTeachingLiveSmokes: true,
      confirmsProviderSideEffectsRequireSeparateApproval: true,
      confirmsLocalDryRunEvidenceNotProductionLiveEvidence: true,
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-ordinary-teaching-production-evidence-response-validation.mjs",
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
        target: "owner-decision-ordinary-teaching-production-evidence-response-validation",
        status: "owner-response-accepted",
        decisionId: "ordinary-teaching-production-evidence",
        responsibleSession: "S22/S19/S10/S12",
      }),
    );
    expect(body.summary).toEqual(
      expect.objectContaining({
        missingFieldCount: 0,
        unsafeFindingCount: 0,
        requiredEvidenceAfterApprovalCount: 11,
        requiredCommandNameCount: 3,
        liveSmokePrepMayProceed: true,
        enterpriseAuditCollectionMayProceed: true,
        providerSideEffectsStillForbidden: true,
        releaseReady: false,
      }),
    );
    expect(body.postValidationAllowedChecks).toEqual([
      "prepare-live-teaching-operations-route-smoke-after-auth-storage-deployment-readiness",
      "prepare-live-operation-detail-browser-smoke-after-operations-evidence",
      "prepare-live-teaching-course-management-route-smoke-after-auth-storage-deployment-readiness",
      "prepare-enterprise-audit-evidence-collection-after-live-smokes",
    ]);
    expect(body.stillForbiddenUntilSeparateApproval).toContain(
      "run-provider-backed-side-effect-smokes-without-owner-approval",
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://");
    expect(output).not.toContain("uais_teacher_auth_claims=");
  });

  it("keeps the template placeholder incomplete until the owner fills it", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ordinary-teaching-response-validation-incomplete-"));
    const templateReport = buildTemplateReport();
    const template = writeJson(tmpDir, "template.json", templateReport);
    const ownerResponse = writeJson(tmpDir, "owner-response.json", templateReport);

    const output = execFileSync("node", [
      "scripts/owner-decision-ordinary-teaching-production-evidence-response-validation.mjs",
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
    expect(body.summary.missingFieldCount).toBeGreaterThanOrEqual(15);
    expect(body.summary.liveSmokePrepMayProceed).toBe(false);
    expect(body.summary.enterpriseAuditCollectionMayProceed).toBe(false);
    expect(body.postValidationAllowedChecks).toEqual([]);
    expect(body.blockedReasons).toContain("approvedTeacherAuthCookieLabel-missing-or-invalid");
    expect(body.blockedReasons).toContain(
      "confirmsLocalDryRunEvidenceNotProductionLiveEvidence-not-confirmed",
    );
    expect(output).not.toContain(tmpDir);
  });

  it("renders empty post-validation checks explicitly in incomplete markdown", () => {
    const tmpDir = mkdtempSync(
      join(tmpdir(), "uais-ordinary-teaching-response-validation-md-incomplete-"),
    );
    const templateReport = buildTemplateReport();
    const template = writeJson(tmpDir, "template.json", templateReport);
    const ownerResponse = writeJson(tmpDir, "owner-response.json", templateReport);

    const output = execFileSync("node", [
      "scripts/owner-decision-ordinary-teaching-production-evidence-response-validation.mjs",
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
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ordinary-teaching-response-validation-stub-"));
    const templateReport = {
      ...buildTemplateReport(),
      copySafeOwnerReplyStub: {
        responseStatus: "owner-response-provided",
        decisionId: "ordinary-teaching-production-evidence",
        approvedAppAuthReadinessEvidenceLabel:
          "<label only; no URL, cookie, env, or credential values>",
        approvedTeacherAuthReadinessEvidenceLabel:
          "<label only; no URL, cookie, env, or credential values>",
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
      },
    };
    const template = writeJson(tmpDir, "template.json", templateReport);
    const ownerResponse = writeJson(tmpDir, "owner-response.json", templateReport);

    const output = execFileSync("node", [
      "scripts/owner-decision-ordinary-teaching-production-evidence-response-validation.mjs",
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
    expect(body.summary.liveSmokePrepMayProceed).toBe(false);
    expect(body.summary.enterpriseAuditCollectionMayProceed).toBe(false);
    expect(body.summary.providerSideEffectsStillForbidden).toBe(true);
    expect(body.redactedOwnerResponse).toEqual(templateReport.copySafeOwnerReplyStub);
    expect(body.blockedReasons).toEqual([
      "approvedAppAuthReadinessEvidenceLabel-missing-or-invalid",
      "approvedTeacherAuthReadinessEvidenceLabel-missing-or-invalid",
      "approvedExternalStorageReadinessEvidenceLabel-missing-or-invalid",
      "approvedVercelProductionDeploymentEvidenceLabel-missing-or-invalid",
      "approvedDeploymentReachabilityEvidenceLabel-missing-or-invalid",
      "approvedTeacherAuthCookieLabel-missing-or-invalid",
      "approvedSmokeTeacherIdLabel-missing-or-invalid",
      "approvedSmokeCourseIdLabel-missing-or-invalid",
      "approvedOtherTeacherIdLabel-missing-or-invalid",
      "approvedStudentIdLabel-missing-or-invalid",
      "approvedReleaseRunIdLabel-missing-or-invalid",
    ]);
    expect(output).not.toContain(tmpDir);
  });

  it("rejects unsafe owner responses without echoing cookie, URL, env, or credential values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ordinary-teaching-response-validation-unsafe-"));
    const template = writeJson(tmpDir, "template.json", buildTemplateReport());
    const ownerResponse = writeJson(tmpDir, "owner-response.json", {
      responseStatus: "owner-response-provided",
      decisionId: "ordinary-teaching-production-evidence",
      approvedAppAuthReadinessEvidenceLabel: "app-auth-readiness-live-ready-redacted",
      approvedTeacherAuthReadinessEvidenceLabel: "teacher-auth-readiness-live-ready-redacted",
      approvedExternalStorageReadinessEvidenceLabel: "external-storage-readiness-live-ready-redacted",
      approvedVercelProductionDeploymentEvidenceLabel: "https://private-teaching.example.test",
      approvedDeploymentReachabilityEvidenceLabel: "deployment-reachability-redacted",
      approvedTeacherAuthCookieLabel: "uais_teacher_auth_claims=secret-cookie-value",
      approvedSmokeTeacherIdLabel: "smoke-teacher-redacted",
      approvedSmokeCourseIdLabel: "smoke-course-redacted",
      approvedOtherTeacherIdLabel: "other-teacher-redacted",
      approvedStudentIdLabel: "student-redacted",
      approvedReleaseRunIdLabel: "/Users/example/.env.local",
      confirmsNoCredentialCookieUrlOrEnvValuesInResponse: true,
      confirmsAuthStorageDeploymentPrerequisitesLiveReady: true,
      confirmsOwnerApprovesOrdinaryTeachingLiveSmokes: true,
      confirmsProviderSideEffectsRequireSeparateApproval: true,
      confirmsLocalDryRunEvidenceNotProductionLiveEvidence: true,
      notes: "UAIS_TEACHING_OPERATIONS_BACKEND=secret-token-value",
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-ordinary-teaching-production-evidence-response-validation.mjs",
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
    expect(body.summary.unsafeFindingCount).toBeGreaterThanOrEqual(6);
    expect(body.redactedOwnerResponse.approvedVercelProductionDeploymentEvidenceLabel).toBeNull();
    expect(body.redactedOwnerResponse.approvedTeacherAuthCookieLabel).toBeNull();
    expect(body.redactedOwnerResponse.approvedReleaseRunIdLabel).toBeNull();
    expect(body.unsafeFindings.map((finding: { patternId: string }) => finding.patternId)).toEqual(
      expect.arrayContaining([
        "raw-url",
        "teacher-auth-cookie-assignment",
        "local-user-path",
        "local-env-file",
        "env-assignment",
      ]),
    );
    expect(output).not.toContain("https://private-teaching.example.test");
    expect(output).not.toContain("uais_teacher_auth_claims=secret-cookie-value");
    expect(output).not.toContain("secret-token-value");
  });

  it("renders markdown without source paths, deployment URLs, cookies, or credential values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ordinary-teaching-response-validation-md-"));
    const template = writeJson(tmpDir, "template.json", buildTemplateReport());
    const ownerResponse = writeJson(tmpDir, "owner-response.json", {
      responseStatus: "owner-response-provided",
      decisionId: "ordinary-teaching-production-evidence",
      approvedAppAuthReadinessEvidenceLabel: "app-auth-readiness-live-ready-redacted",
      approvedTeacherAuthReadinessEvidenceLabel: "teacher-auth-readiness-live-ready-redacted",
      approvedExternalStorageReadinessEvidenceLabel: "external-storage-readiness-live-ready-redacted",
      approvedVercelProductionDeploymentEvidenceLabel: "vercel-production-deployment-redacted",
      approvedDeploymentReachabilityEvidenceLabel: "deployment-reachability-redacted",
      approvedTeacherAuthCookieLabel: "teacher-auth-cookie-redacted-label",
      approvedSmokeTeacherIdLabel: "smoke-teacher-redacted",
      approvedSmokeCourseIdLabel: "smoke-course-redacted",
      approvedOtherTeacherIdLabel: "other-teacher-redacted",
      approvedStudentIdLabel: "student-redacted",
      approvedReleaseRunIdLabel: "release-run-ordinary-teaching-2026-07-01",
      confirmsNoCredentialCookieUrlOrEnvValuesInResponse: true,
      confirmsAuthStorageDeploymentPrerequisitesLiveReady: true,
      confirmsOwnerApprovesOrdinaryTeachingLiveSmokes: true,
      confirmsProviderSideEffectsRequireSeparateApproval: true,
      confirmsLocalDryRunEvidenceNotProductionLiveEvidence: true,
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-ordinary-teaching-production-evidence-response-validation.mjs",
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

    expect(output).toContain("# UAIS Ordinary Teaching Production Evidence Response Validation");
    expect(output).toContain("Status: `owner-response-accepted`");
    expect(output).toContain("Provider side effects still forbidden: `true`");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://");
    expect(output).not.toContain("uais_teacher_auth_claims=");
  });
});

function buildTemplateReport() {
  return {
    target: "owner-decision-ordinary-teaching-production-evidence-response-template",
    status: "queued-awaiting-upstream-live-evidence",
    decisionId: "ordinary-teaching-production-evidence",
    ownerResponseTemplate: {
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
    },
  };
}

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}
