import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("owner decision external storage response validation", () => {
  it("accepts a complete redacted external-storage owner response and keeps live writes gated", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-external-storage-response-validation-"));
    const template = writeJson(tmpDir, "template.json", buildTemplateReport());
    const ownerResponse = writeJson(tmpDir, "owner-response.json", {
      responseStatus: "owner-response-provided",
      decisionId: "external-storage-production-service",
      ownerApprovedServiceClass: "approved-remote-https-external-storage-service",
      approvedRemoteHttpsExternalStorageServiceLabel: "uais-external-storage-production-service",
      approvedServerOnlyEnvSourceLabel: "s19-external-storage-env-sync-redacted",
      approvedReleaseRunIdLabel: "release-run-external-storage-gate-2026-07-01",
      approvedSmokeTeacherIdLabel: "approved-smoke-teacher-redacted",
      confirmsNoCredentialValuesInResponse: true,
      confirmsRemoteHttpsServiceApproved: true,
      confirmsS19MayPrepareExternalStorageEnvSyncDryRun: true,
      confirmsS22MayPrepareExternalStorageReadinessAfterEnvSyncEvidence: true,
      confirmsExternalStorageLiveSmokeRequiresSeparateApproval: true,
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-external-storage-response-validation.mjs",
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
        target: "owner-decision-external-storage-response-validation",
        status: "owner-response-accepted",
        releaseReady: false,
        decisionId: "external-storage-production-service",
        responsibleSession: "S22/S19/S10",
      }),
    );
    expect(body.summary).toEqual(
      expect.objectContaining({
        missingFieldCount: 0,
        unsafeFindingCount: 0,
        serviceClassAccepted: true,
        requiredServerOnlyEnvNameCount: 14,
        s19DryRunMayProceed: true,
        s22ReadinessMayProceed: true,
        liveSmokeStillForbidden: true,
        releaseReady: false,
      }),
    );
    expect(body.redactedOwnerResponse.ownerApprovedServiceClass).toBe(
      "approved-remote-https-external-storage-service",
    );
    expect(body.postValidationAllowedChecks).toEqual([
      "prepare-s19-external-storage-env-sync-dry-run-after-auth-clears",
      "prepare-external-storage-readiness-command-after-env-sync-launch-and-persistence-evidence",
      "prepare-external-storage-smoke-command-after-service-readiness",
    ]);
    expect(body.stillForbiddenUntilSeparateApproval).toContain("run-live-external-storage-smoke");
    expect(body.stillForbiddenUntilSeparateApproval).toContain("run-production-smokes-dependent-on-external-storage");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://");
  });

  it("keeps the template placeholder incomplete until the owner fills it", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-external-storage-response-validation-incomplete-"));
    const templateReport = buildTemplateReport();
    const template = writeJson(tmpDir, "template.json", templateReport);
    const ownerResponse = writeJson(tmpDir, "owner-response.json", templateReport);

    const output = execFileSync("node", [
      "scripts/owner-decision-external-storage-response-validation.mjs",
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
    expect(body.summary.missingFieldCount).toBeGreaterThanOrEqual(9);
    expect(body.summary.s19DryRunMayProceed).toBe(false);
    expect(body.summary.s22ReadinessMayProceed).toBe(false);
    expect(body.postValidationAllowedChecks).toEqual([]);
    expect(body.blockedReasons).toContain("ownerApprovedServiceClass-missing");
    expect(body.blockedReasons).toContain(
      "confirmsExternalStorageLiveSmokeRequiresSeparateApproval-not-confirmed",
    );
    expect(output).not.toContain(tmpDir);
  });

  it("renders empty post-validation checks explicitly in incomplete markdown", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-external-storage-response-validation-md-incomplete-"));
    const templateReport = buildTemplateReport();
    const template = writeJson(tmpDir, "template.json", templateReport);
    const ownerResponse = writeJson(tmpDir, "owner-response.json", templateReport);

    const output = execFileSync("node", [
      "scripts/owner-decision-external-storage-response-validation.mjs",
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
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-external-storage-response-validation-stub-"));
    const templateReport = {
      ...buildTemplateReport(),
      copySafeOwnerReplyStub: {
        responseStatus: "owner-response-provided",
        decisionId: "external-storage-production-service",
        ownerApprovedServiceClass: "approved-remote-https-external-storage-service",
        approvedRemoteHttpsExternalStorageServiceLabel:
          "<label only; no endpoint URL or credential values>",
        approvedServerOnlyEnvSourceLabel: "<label only; no credential values>",
        approvedReleaseRunIdLabel: "<label only; no URL, token, or cookie>",
        approvedSmokeTeacherIdLabel: "<label only; no personal data>",
        confirmsNoCredentialValuesInResponse: true,
        confirmsRemoteHttpsServiceApproved: true,
        confirmsS19MayPrepareExternalStorageEnvSyncDryRun: true,
        confirmsS22MayPrepareExternalStorageReadinessAfterEnvSyncEvidence: true,
        confirmsExternalStorageLiveSmokeRequiresSeparateApproval: true,
      },
    };
    const template = writeJson(tmpDir, "template.json", templateReport);
    const ownerResponse = writeJson(tmpDir, "owner-response.json", templateReport);

    const output = execFileSync("node", [
      "scripts/owner-decision-external-storage-response-validation.mjs",
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
    expect(body.summary.serviceClassAccepted).toBe(true);
    expect(body.summary.s19DryRunMayProceed).toBe(false);
    expect(body.summary.s22ReadinessMayProceed).toBe(false);
    expect(body.summary.liveSmokeStillForbidden).toBe(true);
    expect(body.redactedOwnerResponse).toEqual({
      responseStatus: "owner-response-provided",
      decisionId: "external-storage-production-service",
      ownerApprovedServiceClass: "approved-remote-https-external-storage-service",
      approvedRemoteHttpsExternalStorageServiceLabel:
        "<label only; no endpoint URL or credential values>",
      approvedServerOnlyEnvSourceLabel: "<label only; no credential values>",
      approvedReleaseRunIdLabel: "<label only; no URL, token, or cookie>",
      approvedSmokeTeacherIdLabel: "<label only; no personal data>",
      confirmsNoCredentialValuesInResponse: true,
      confirmsRemoteHttpsServiceApproved: true,
      confirmsS19MayPrepareExternalStorageEnvSyncDryRun: true,
      confirmsS22MayPrepareExternalStorageReadinessAfterEnvSyncEvidence: true,
      confirmsExternalStorageLiveSmokeRequiresSeparateApproval: true,
    });
    expect(body.blockedReasons).toEqual([
      "approvedRemoteHttpsExternalStorageServiceLabel-missing-or-invalid",
      "approvedServerOnlyEnvSourceLabel-missing-or-invalid",
      "approvedReleaseRunIdLabel-missing-or-invalid",
      "approvedSmokeTeacherIdLabel-missing-or-invalid",
    ]);
    expect(output).not.toContain(tmpDir);
  });

  it("rejects credential-shaped owner responses without echoing unsafe values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-external-storage-response-validation-unsafe-"));
    const template = writeJson(tmpDir, "template.json", buildTemplateReport());
    const ownerResponse = writeJson(tmpDir, "owner-response.json", {
      responseStatus: "owner-response-provided",
      decisionId: "external-storage-production-service",
      ownerApprovedServiceClass: "approved-remote-https-external-storage-service",
      approvedRemoteHttpsExternalStorageServiceLabel: "https://private-storage.example.test",
      approvedServerOnlyEnvSourceLabel: "/Users/example/.env.local",
      approvedReleaseRunIdLabel: "release-run-external-storage-gate-2026-07-01",
      approvedSmokeTeacherIdLabel: "approved-smoke-teacher-redacted",
      confirmsNoCredentialValuesInResponse: true,
      confirmsRemoteHttpsServiceApproved: true,
      confirmsS19MayPrepareExternalStorageEnvSyncDryRun: true,
      confirmsS22MayPrepareExternalStorageReadinessAfterEnvSyncEvidence: true,
      confirmsExternalStorageLiveSmokeRequiresSeparateApproval: true,
      notes: "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret-token-value",
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-external-storage-response-validation.mjs",
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
    expect(body.summary.unsafeFindingCount).toBeGreaterThanOrEqual(4);
    expect(body.redactedOwnerResponse.approvedRemoteHttpsExternalStorageServiceLabel).toBeNull();
    expect(body.redactedOwnerResponse.approvedServerOnlyEnvSourceLabel).toBeNull();
    expect(body.unsafeFindings.map((finding: { patternId: string }) => finding.patternId)).toEqual(
      expect.arrayContaining(["raw-url", "local-user-path", "local-env-file", "env-assignment"]),
    );
    expect(output).not.toContain("https://private-storage.example.test");
    expect(output).not.toContain("/Users/example/.env.local");
    expect(output).not.toContain("secret-token-value");
  });

  it("renders markdown without source paths, endpoint URLs, or credential values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-external-storage-response-validation-md-"));
    const template = writeJson(tmpDir, "template.json", buildTemplateReport());
    const ownerResponse = writeJson(tmpDir, "owner-response.json", {
      responseStatus: "owner-response-provided",
      decisionId: "external-storage-production-service",
      ownerApprovedServiceClass: "approved-remote-https-external-storage-service",
      approvedRemoteHttpsExternalStorageServiceLabel: "uais-external-storage-production-service",
      approvedServerOnlyEnvSourceLabel: "s19-external-storage-env-sync-redacted",
      approvedReleaseRunIdLabel: "release-run-external-storage-gate-2026-07-01",
      approvedSmokeTeacherIdLabel: "approved-smoke-teacher-redacted",
      confirmsNoCredentialValuesInResponse: true,
      confirmsRemoteHttpsServiceApproved: true,
      confirmsS19MayPrepareExternalStorageEnvSyncDryRun: true,
      confirmsS22MayPrepareExternalStorageReadinessAfterEnvSyncEvidence: true,
      confirmsExternalStorageLiveSmokeRequiresSeparateApproval: true,
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-external-storage-response-validation.mjs",
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

    expect(output).toContain("# UAIS External Storage Owner Response Validation");
    expect(output).toContain("Status: `owner-response-accepted`");
    expect(output).toContain("Live smoke still forbidden: `true`");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://");
  });
});

function buildTemplateReport() {
  return {
    target: "owner-decision-external-storage-response-template",
    status: "queued-awaiting-upstream-auth-decisions",
    decisionId: "external-storage-production-service",
    summary: {
      queueRank: 3,
      queueStatus: "owner-decision-needed",
      actionPacketStatus: "owner-decision-needed",
      upstreamBlockedDecisionCount: 2,
      requiredServerOnlyEnvNameCount: 14,
      releaseReady: false,
    },
    ownerResponseTemplate: {
      responseStatus: "owner-response-required",
      decisionId: "external-storage-production-service",
      ownerApprovedServiceClass: null,
      requiredServiceClass: "approved-remote-https-external-storage-service",
      approvedRemoteHttpsExternalStorageServiceLabel: null,
      approvedServerOnlyEnvSourceLabel: null,
      approvedReleaseRunIdLabel: null,
      approvedSmokeTeacherIdLabel: null,
      confirmsNoCredentialValuesInResponse: false,
      confirmsRemoteHttpsServiceApproved: false,
      confirmsS19MayPrepareExternalStorageEnvSyncDryRun: false,
      confirmsS22MayPrepareExternalStorageReadinessAfterEnvSyncEvidence: false,
      confirmsExternalStorageLiveSmokeRequiresSeparateApproval: false,
      requiredServerOnlyEnvNames: [
        "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
        "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND",
        "UAIS_TEACHING_OPERATIONS_BACKEND",
        "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
        "UAIS_TEACHING_COURSE_ASSETS_BACKEND",
        "UAIS_EXTERNAL_STORAGE_BASE_URL",
        "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
        "UAIS_EXTERNAL_STORAGE_SERVICE_MODE",
        "UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR",
        "UAIS_EXTERNAL_STORAGE_DATA_DIR",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL",
      ],
      requiredEvidenceAfterApproval: [
        "approved-remote-https-external-storage-service",
        "vercel-env-sync-evidence-with-external-storage-env-present",
        "external-storage-service-readiness-production-live-ready",
        "external-storage-smoke-live-passed",
      ],
    },
  };
}

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}
