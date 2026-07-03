import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("owner decision enterprise live evidence audit response validation", () => {
  it("accepts a complete redacted audit readiness response while keeping release binding gated", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-enterprise-audit-response-validation-"));
    const template = writeJson(tmpDir, "template.json", buildTemplateReport());
    const ownerResponse = writeJson(tmpDir, "owner-response.json", {
      responseStatus: "owner-response-provided",
      decisionId: "enterprise-live-evidence-audit",
      approvedEnterpriseLiveEvidenceAuditProofLabel: "enterprise-audit-proof-redacted",
      approvedProductionLiveEvidenceSetLabel: "all-16-live-evidence-body-proven-redacted",
      approvedSharedReleaseRunIdLabel: "release-run-enterprise-audit-2026-07-01",
      approvedSafetyRedactionFlagsLabel: "required-safety-redaction-flags-redacted",
      approvedTargetResultProofSetLabel: "target-result-proof-set-redacted",
      approvedTargetContractProofSetLabel: "target-contract-proof-set-redacted",
      approvedRejectedFilenameOnlyEvidenceLabel: "filename-only-rejection-proof-redacted",
      confirmsNoRawUrlsLocalPathsCookiesOrCredentialValuesInResponse: true,
      confirmsAll16RequiredTargetsBodyProven: true,
      confirmsFilenameOnlyOrBlockedEvidenceRejected: true,
      confirmsSharedReleaseRunIdAcrossProductionEvidence: true,
      confirmsRequiredSafetyFlagsPresent: true,
      confirmsTargetSpecificResultAndContractProofsPresent: true,
      confirmsLocalOrDryRunEvidenceNotAccepted: true,
      confirmsAuditRunRequiresAllEvidenceBeforeExecution: true,
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-enterprise-live-evidence-audit-response-validation.mjs",
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
        target: "owner-decision-enterprise-live-evidence-audit-response-validation",
        status: "owner-response-accepted",
        decisionId: "enterprise-live-evidence-audit",
        responsibleSession: "S22/S10/S25",
      }),
    );
    expect(body.summary).toEqual(
      expect.objectContaining({
        missingFieldCount: 0,
        unsafeFindingCount: 0,
        requiredEvidenceAfterApprovalCount: 7,
        requiredCommandNameCount: 2,
        auditMayProceedAfterEvidenceVerification: true,
        releaseGateRefreshMayProceedAfterAudit: true,
        releaseRunBindingStillForbidden: true,
        releaseReady: false,
      }),
    );
    expect(body.postValidationAllowedChecks).toEqual([
      "prepare-enterprise-live-evidence-audit-command-after-all-target-evidence-exists",
      "prepare-release-gate-refresh-after-enterprise-audit-passes",
    ]);
    expect(body.stillForbiddenUntilSeparateApproval).toContain(
      "bind-production-release-run-id-while-release-gate-blocked",
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://");
    expect(output).not.toContain("uais_teacher_auth_claims=");
  });

  it("keeps the template placeholder incomplete until all production evidence is filled", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-enterprise-audit-response-validation-incomplete-"));
    const templateReport = buildTemplateReport();
    const template = writeJson(tmpDir, "template.json", templateReport);
    const ownerResponse = writeJson(tmpDir, "owner-response.json", templateReport);

    const output = execFileSync("node", [
      "scripts/owner-decision-enterprise-live-evidence-audit-response-validation.mjs",
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
    expect(body.summary.missingFieldCount).toBeGreaterThanOrEqual(16);
    expect(body.summary.auditMayProceedAfterEvidenceVerification).toBe(false);
    expect(body.summary.releaseGateRefreshMayProceedAfterAudit).toBe(false);
    expect(body.postValidationAllowedChecks).toEqual([]);
    expect(body.blockedReasons).toContain(
      "approvedEnterpriseLiveEvidenceAuditProofLabel-missing-or-invalid",
    );
    expect(body.blockedReasons).toContain(
      "confirmsAuditRunRequiresAllEvidenceBeforeExecution-not-confirmed",
    );
    expect(output).not.toContain(tmpDir);
  });

  it("renders empty post-validation checks explicitly in incomplete markdown", () => {
    const tmpDir = mkdtempSync(
      join(tmpdir(), "uais-enterprise-audit-response-validation-md-incomplete-"),
    );
    const templateReport = buildTemplateReport();
    const template = writeJson(tmpDir, "template.json", templateReport);
    const ownerResponse = writeJson(tmpDir, "owner-response.json", templateReport);

    const output = execFileSync("node", [
      "scripts/owner-decision-enterprise-live-evidence-audit-response-validation.mjs",
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
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-enterprise-audit-response-validation-stub-"));
    const templateReport = {
      ...buildTemplateReport(),
      copySafeOwnerReplyStub: {
        responseStatus: "owner-response-provided",
        decisionId: "enterprise-live-evidence-audit",
        approvedEnterpriseLiveEvidenceAuditProofLabel:
          "<label only; no URL, local path, cookie, or credential value>",
        approvedProductionLiveEvidenceSetLabel:
          "<label only; no URL, local path, cookie, or credential value>",
        approvedSharedReleaseRunIdLabel: "<label only; no URL, token, or cookie>",
        approvedSafetyRedactionFlagsLabel:
          "<label only; no URL, local path, cookie, or credential value>",
        approvedTargetResultProofSetLabel:
          "<label only; no URL, local path, cookie, or credential value>",
        approvedTargetContractProofSetLabel:
          "<label only; no URL, local path, cookie, or credential value>",
        approvedRejectedFilenameOnlyEvidenceLabel:
          "<label only; no URL, local path, cookie, or credential value>",
        confirmsNoRawUrlsLocalPathsCookiesOrCredentialValuesInResponse: true,
        confirmsAll16RequiredTargetsBodyProven: true,
        confirmsFilenameOnlyOrBlockedEvidenceRejected: true,
        confirmsSharedReleaseRunIdAcrossProductionEvidence: true,
        confirmsRequiredSafetyFlagsPresent: true,
        confirmsTargetSpecificResultAndContractProofsPresent: true,
        confirmsLocalOrDryRunEvidenceNotAccepted: true,
        confirmsAuditRunRequiresAllEvidenceBeforeExecution: true,
      },
    };
    const template = writeJson(tmpDir, "template.json", templateReport);
    const ownerResponse = writeJson(tmpDir, "owner-response.json", templateReport);

    const output = execFileSync("node", [
      "scripts/owner-decision-enterprise-live-evidence-audit-response-validation.mjs",
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
    expect(body.summary.auditMayProceedAfterEvidenceVerification).toBe(false);
    expect(body.summary.releaseGateRefreshMayProceedAfterAudit).toBe(false);
    expect(body.summary.releaseRunBindingStillForbidden).toBe(true);
    expect(body.redactedOwnerResponse).toEqual(templateReport.copySafeOwnerReplyStub);
    expect(body.blockedReasons).toEqual([
      "approvedEnterpriseLiveEvidenceAuditProofLabel-missing-or-invalid",
      "approvedProductionLiveEvidenceSetLabel-missing-or-invalid",
      "approvedSharedReleaseRunIdLabel-missing-or-invalid",
      "approvedSafetyRedactionFlagsLabel-missing-or-invalid",
      "approvedTargetResultProofSetLabel-missing-or-invalid",
      "approvedTargetContractProofSetLabel-missing-or-invalid",
      "approvedRejectedFilenameOnlyEvidenceLabel-missing-or-invalid",
    ]);
    expect(output).not.toContain(tmpDir);
  });

  it("rejects unsafe owner responses without echoing paths, URLs, cookies, or credential values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-enterprise-audit-response-validation-unsafe-"));
    const template = writeJson(tmpDir, "template.json", buildTemplateReport());
    const ownerResponse = writeJson(tmpDir, "owner-response.json", {
      responseStatus: "owner-response-provided",
      decisionId: "enterprise-live-evidence-audit",
      approvedEnterpriseLiveEvidenceAuditProofLabel: "/Users/example/private/audit.json",
      approvedProductionLiveEvidenceSetLabel: "https://private-audit.example.test/evidence",
      approvedSharedReleaseRunIdLabel: "release-run-enterprise-audit-2026-07-01",
      approvedSafetyRedactionFlagsLabel: "required-safety-redaction-flags-redacted",
      approvedTargetResultProofSetLabel: "target-result-proof-set-redacted",
      approvedTargetContractProofSetLabel: "target-contract-proof-set-redacted",
      approvedRejectedFilenameOnlyEvidenceLabel: "filename-only-rejection-proof-redacted",
      confirmsNoRawUrlsLocalPathsCookiesOrCredentialValuesInResponse: true,
      confirmsAll16RequiredTargetsBodyProven: true,
      confirmsFilenameOnlyOrBlockedEvidenceRejected: true,
      confirmsSharedReleaseRunIdAcrossProductionEvidence: true,
      confirmsRequiredSafetyFlagsPresent: true,
      confirmsTargetSpecificResultAndContractProofsPresent: true,
      confirmsLocalOrDryRunEvidenceNotAccepted: true,
      confirmsAuditRunRequiresAllEvidenceBeforeExecution: true,
      notes: "UAIS_ENTERPRISE_AUDIT_TOKEN=secret-token-value uais_teacher_auth_claims=secret-cookie",
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-enterprise-live-evidence-audit-response-validation.mjs",
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
    expect(body.redactedOwnerResponse.approvedEnterpriseLiveEvidenceAuditProofLabel).toBeNull();
    expect(body.redactedOwnerResponse.approvedProductionLiveEvidenceSetLabel).toBeNull();
    expect(body.unsafeFindings.map((finding: { patternId: string }) => finding.patternId)).toEqual(
      expect.arrayContaining([
        "raw-url",
        "local-user-path",
        "env-assignment",
        "teacher-auth-cookie-assignment",
      ]),
    );
    expect(output).not.toContain("/Users/example/private/audit.json");
    expect(output).not.toContain("https://private-audit.example.test");
    expect(output).not.toContain("secret-token-value");
    expect(output).not.toContain("uais_teacher_auth_claims=secret-cookie");
  });

  it("renders markdown without paths, URLs, cookies, or credential values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-enterprise-audit-response-validation-md-"));
    const template = writeJson(tmpDir, "template.json", buildTemplateReport());
    const ownerResponse = writeJson(tmpDir, "owner-response.json", {
      responseStatus: "owner-response-provided",
      decisionId: "enterprise-live-evidence-audit",
      approvedEnterpriseLiveEvidenceAuditProofLabel: "enterprise-audit-proof-redacted",
      approvedProductionLiveEvidenceSetLabel: "all-16-live-evidence-body-proven-redacted",
      approvedSharedReleaseRunIdLabel: "release-run-enterprise-audit-2026-07-01",
      approvedSafetyRedactionFlagsLabel: "required-safety-redaction-flags-redacted",
      approvedTargetResultProofSetLabel: "target-result-proof-set-redacted",
      approvedTargetContractProofSetLabel: "target-contract-proof-set-redacted",
      approvedRejectedFilenameOnlyEvidenceLabel: "filename-only-rejection-proof-redacted",
      confirmsNoRawUrlsLocalPathsCookiesOrCredentialValuesInResponse: true,
      confirmsAll16RequiredTargetsBodyProven: true,
      confirmsFilenameOnlyOrBlockedEvidenceRejected: true,
      confirmsSharedReleaseRunIdAcrossProductionEvidence: true,
      confirmsRequiredSafetyFlagsPresent: true,
      confirmsTargetSpecificResultAndContractProofsPresent: true,
      confirmsLocalOrDryRunEvidenceNotAccepted: true,
      confirmsAuditRunRequiresAllEvidenceBeforeExecution: true,
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-enterprise-live-evidence-audit-response-validation.mjs",
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

    expect(output).toContain("# UAIS Enterprise Live Evidence Audit Response Validation");
    expect(output).toContain("Status: `owner-response-accepted`");
    expect(output).toContain("Audit may proceed after evidence verification: `true`");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://");
    expect(output).not.toContain("uais_teacher_auth_claims=");
  });
});

function buildTemplateReport() {
  return {
    target: "owner-decision-enterprise-live-evidence-audit-response-template",
    status: "queued-awaiting-all-production-live-evidence",
    decisionId: "enterprise-live-evidence-audit",
    ownerResponseTemplate: {
      responseStatus: "owner-response-required",
      decisionId: "enterprise-live-evidence-audit",
      approvedEnterpriseLiveEvidenceAuditProofLabel: null,
      approvedProductionLiveEvidenceSetLabel: null,
      approvedSharedReleaseRunIdLabel: null,
      approvedSafetyRedactionFlagsLabel: null,
      approvedTargetResultProofSetLabel: null,
      approvedTargetContractProofSetLabel: null,
      approvedRejectedFilenameOnlyEvidenceLabel: null,
      confirmsNoRawUrlsLocalPathsCookiesOrCredentialValuesInResponse: false,
      confirmsAll16RequiredTargetsBodyProven: false,
      confirmsFilenameOnlyOrBlockedEvidenceRejected: false,
      confirmsSharedReleaseRunIdAcrossProductionEvidence: false,
      confirmsRequiredSafetyFlagsPresent: false,
      confirmsTargetSpecificResultAndContractProofsPresent: false,
      confirmsLocalOrDryRunEvidenceNotAccepted: false,
      confirmsAuditRunRequiresAllEvidenceBeforeExecution: false,
      requiredTargets: requiredTargets(),
      missingRequiredTargets: requiredTargets(),
      requiredEvidenceAfterApproval: [
        "body-level-production-live-evidence-audit-proof",
        "all-orchestrated-production-live-targets-present",
        "shared-release-run-id-across-production-live-evidence",
        "required-production-live-safety-redaction-flags",
        "target-specific-result-proof-keys-body-proven",
        "target-specific-contract-proof-keys-body-proven",
        "filename-only-production-live-evidence-rejected",
      ],
      requiredCommandNames: [
        "runEnterpriseAudit",
        "refreshReleaseGateWithAudit",
      ],
    },
  };
}

function requiredTargets() {
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
