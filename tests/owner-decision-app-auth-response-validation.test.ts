import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("owner decision app auth response validation", () => {
  it("accepts a complete redacted owner response and opens only dry-run next steps", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-app-auth-response-validation-"));
    const template = writeJson(tmpDir, "template.json", buildTemplateReport());
    const ownerResponse = writeJson(tmpDir, "owner-response.json", {
      responseStatus: "owner-response-provided",
      decisionId: "app-auth-provider-production-selector",
      ownerApprovedProviderMode: "trusted-account-provider",
      approvedServerOnlyEnvSourceLabel: "s19-app-auth-env-sync-redacted",
      approvedReleaseRunIdLabel: "release-run-app-auth-gate-2026-07-01",
      confirmsNoCredentialValuesInResponse: true,
      confirmsS19MayPrepareAppAuthEnvSyncDryRun: true,
      confirmsS22MayPrepareAppAuthReadinessAfterEnvSyncEvidence: true,
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-app-auth-response-validation.mjs",
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
        target: "owner-decision-app-auth-response-validation",
        status: "owner-response-accepted",
        releaseReady: false,
        decisionId: "app-auth-provider-production-selector",
        responsibleSession: "S22/S19/S10",
      }),
    );
    expect(body.summary).toEqual(
      expect.objectContaining({
        missingFieldCount: 0,
        unsafeFindingCount: 0,
        providerModeAccepted: true,
        s19DryRunMayProceed: true,
        s22ReadinessMayProceed: true,
        releaseReady: false,
      }),
    );
    expect(body.redactedOwnerResponse).toEqual({
      responseStatus: "owner-response-provided",
      decisionId: "app-auth-provider-production-selector",
      ownerApprovedProviderMode: "trusted-account-provider",
      approvedServerOnlyEnvSourceLabel: "s19-app-auth-env-sync-redacted",
      approvedReleaseRunIdLabel: "release-run-app-auth-gate-2026-07-01",
      confirmsNoCredentialValuesInResponse: true,
      confirmsS19MayPrepareAppAuthEnvSyncDryRun: true,
      confirmsS22MayPrepareAppAuthReadinessAfterEnvSyncEvidence: true,
    });
    expect(body.postValidationAllowedChecks).toEqual([
      "prepare-s19-app-auth-env-sync-dry-run",
      "prepare-app-auth-readiness-command-after-env-sync-evidence",
    ]);
    expect(body.stillForbiddenUntilSeparateApproval).toContain("run-vercel-env-apply");
    expect(body.stillForbiddenUntilSeparateApproval).toContain("run-production-smokes-dependent-on-app-auth");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://");
  });

  it("keeps the current template placeholder incomplete until the owner fills it", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-app-auth-response-validation-incomplete-"));
    const templateReport = buildTemplateReport();
    const template = writeJson(tmpDir, "template.json", templateReport);
    const ownerResponse = writeJson(tmpDir, "owner-response.json", templateReport);

    const output = execFileSync("node", [
      "scripts/owner-decision-app-auth-response-validation.mjs",
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
    expect(body.summary.missingFieldCount).toBeGreaterThanOrEqual(6);
    expect(body.summary.s19DryRunMayProceed).toBe(false);
    expect(body.summary.s22ReadinessMayProceed).toBe(false);
    expect(body.postValidationAllowedChecks).toEqual([]);
    expect(body.blockedReasons).toContain("ownerApprovedProviderMode-missing");
    expect(body.blockedReasons).toContain("confirmsNoCredentialValuesInResponse-not-confirmed");
    expect(output).not.toContain(tmpDir);
  });

  it("uses the copy-safe owner reply stub when validating a generated template report", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-app-auth-response-validation-stub-"));
    const templateReport = {
      ...buildTemplateReport(),
      copySafeOwnerReplyStub: {
        responseStatus: "owner-response-provided",
        decisionId: "app-auth-provider-production-selector",
        ownerApprovedProviderMode: "trusted-account-provider",
        approvedServerOnlyEnvSourceLabel: "<label only; no credential values>",
        approvedReleaseRunIdLabel: "<label only; no URL, token, or cookie>",
        confirmsNoCredentialValuesInResponse: true,
        confirmsS19MayPrepareAppAuthEnvSyncDryRun: true,
        confirmsS22MayPrepareAppAuthReadinessAfterEnvSyncEvidence: true,
      },
    };
    const template = writeJson(tmpDir, "template.json", templateReport);
    const ownerResponse = writeJson(tmpDir, "owner-response.json", templateReport);

    const output = execFileSync("node", [
      "scripts/owner-decision-app-auth-response-validation.mjs",
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
    expect(body.summary.providerModeAccepted).toBe(true);
    expect(body.summary.s19DryRunMayProceed).toBe(false);
    expect(body.summary.s22ReadinessMayProceed).toBe(false);
    expect(body.redactedOwnerResponse).toEqual({
      responseStatus: "owner-response-provided",
      decisionId: "app-auth-provider-production-selector",
      ownerApprovedProviderMode: "trusted-account-provider",
      approvedServerOnlyEnvSourceLabel: "<label only; no credential values>",
      approvedReleaseRunIdLabel: "<label only; no URL, token, or cookie>",
      confirmsNoCredentialValuesInResponse: true,
      confirmsS19MayPrepareAppAuthEnvSyncDryRun: true,
      confirmsS22MayPrepareAppAuthReadinessAfterEnvSyncEvidence: true,
    });
    expect(body.blockedReasons).toEqual([
      "approvedServerOnlyEnvSourceLabel-missing-or-invalid",
      "approvedReleaseRunIdLabel-missing-or-invalid",
    ]);
    expect(output).not.toContain(tmpDir);
  });

  it("rejects credential-shaped owner responses without echoing unsafe values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-app-auth-response-validation-unsafe-"));
    const template = writeJson(tmpDir, "template.json", buildTemplateReport());
    const ownerResponse = writeJson(tmpDir, "owner-response.json", {
      responseStatus: "owner-response-provided",
      decisionId: "app-auth-provider-production-selector",
      ownerApprovedProviderMode: "trusted-account-provider",
      approvedServerOnlyEnvSourceLabel: "/Users/example/.env.local",
      approvedReleaseRunIdLabel: "https://private.example.test/run/123",
      confirmsNoCredentialValuesInResponse: true,
      confirmsS19MayPrepareAppAuthEnvSyncDryRun: true,
      confirmsS22MayPrepareAppAuthReadinessAfterEnvSyncEvidence: true,
      notes: "UAIS_APP_AUTH_PROVIDER_TOKEN=secret-token-value uais_teacher_auth_claims=secret",
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-app-auth-response-validation.mjs",
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
    expect(body.redactedOwnerResponse.approvedServerOnlyEnvSourceLabel).toBeNull();
    expect(body.redactedOwnerResponse.approvedReleaseRunIdLabel).toBeNull();
    expect(body.unsafeFindings.map((finding: { patternId: string }) => finding.patternId)).toEqual(
      expect.arrayContaining([
        "local-user-path",
        "local-env-file",
        "raw-url",
        "env-assignment",
        "teacher-auth-cookie-assignment",
      ]),
    );
    expect(output).not.toContain("/Users/example/.env.local");
    expect(output).not.toContain("https://private.example.test/run/123");
    expect(output).not.toContain("secret-token-value");
    expect(output).not.toContain("uais_teacher_auth_claims=secret");
  });

  it("renders markdown without source paths or credential values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-app-auth-response-validation-md-"));
    const template = writeJson(tmpDir, "template.json", buildTemplateReport());
    const ownerResponse = writeJson(tmpDir, "owner-response.json", {
      responseStatus: "owner-response-provided",
      decisionId: "app-auth-provider-production-selector",
      ownerApprovedProviderMode: "trusted-account-provider",
      approvedServerOnlyEnvSourceLabel: "s19-app-auth-env-sync-redacted",
      approvedReleaseRunIdLabel: "release-run-app-auth-gate-2026-07-01",
      confirmsNoCredentialValuesInResponse: true,
      confirmsS19MayPrepareAppAuthEnvSyncDryRun: true,
      confirmsS22MayPrepareAppAuthReadinessAfterEnvSyncEvidence: true,
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-app-auth-response-validation.mjs",
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

    expect(output).toContain("# UAIS App Auth Owner Response Validation");
    expect(output).toContain("Status: `owner-response-accepted`");
    expect(output).toContain("S19 dry-run may proceed: `true`");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://");
  });

  it("renders empty post-validation checks explicitly in incomplete markdown", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-app-auth-response-validation-md-incomplete-"));
    const templateReport = buildTemplateReport();
    const template = writeJson(tmpDir, "template.json", templateReport);
    const ownerResponse = writeJson(tmpDir, "owner-response.json", templateReport);

    const output = execFileSync("node", [
      "scripts/owner-decision-app-auth-response-validation.mjs",
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
});

function buildTemplateReport() {
  return {
    target: "owner-decision-app-auth-response-template",
    status: "awaiting-owner-response",
    decisionId: "app-auth-provider-production-selector",
    summary: {
      firstBlockedStageId: "app-auth-provider-production-selector",
      queueStatus: "owner-decision-needed",
      actionPacketStatus: "owner-decision-needed",
      acceptedLiveEvidence: 0,
      missingEnterpriseLiveTargetCount: 16,
      releaseReady: false,
    },
    ownerResponseTemplate: {
      responseStatus: "owner-response-required",
      decisionId: "app-auth-provider-production-selector",
      ownerApprovedProviderMode: null,
      allowedProviderModes: ["trusted-account-provider"],
      approvedServerOnlyEnvSourceLabel: null,
      approvedReleaseRunIdLabel: null,
      confirmsNoCredentialValuesInResponse: false,
      confirmsS19MayPrepareAppAuthEnvSyncDryRun: false,
      confirmsS22MayPrepareAppAuthReadinessAfterEnvSyncEvidence: false,
      requiredServerOnlyEnvNames: [
        "UAIS_APP_SESSION_SIGNING_SECRET",
        "UAIS_APP_AUTH_PROVIDER",
        "UAIS_APP_AUTH_PROVIDER_URL",
        "UAIS_APP_AUTH_PROVIDER_TOKEN",
      ],
      requiredEvidenceAfterApproval: [
        "vercel-env-sync-evidence-with-app-auth-env-present",
        "app-auth-provider-readiness-production-live-ready",
      ],
    },
  };
}

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}
