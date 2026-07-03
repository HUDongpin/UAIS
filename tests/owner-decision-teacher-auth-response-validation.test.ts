import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("owner decision teacher auth response validation", () => {
  it("accepts a complete trusted-cookie-issuer owner response and keeps live actions gated", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-auth-response-validation-"));
    const template = writeJson(tmpDir, "template.json", buildTemplateReport());
    const ownerResponse = writeJson(tmpDir, "owner-response.json", {
      responseStatus: "owner-response-provided",
      decisionId: "teacher-auth-provider-production-selector",
      ownerApprovedProviderMode: "trusted-cookie-issuer",
      approvedServerOnlyEnvSourceLabel: "s19-teacher-auth-env-sync-redacted",
      approvedReleaseRunIdLabel: "release-run-teacher-auth-gate-2026-07-01",
      confirmsNoCredentialValuesInResponse: true,
      confirmsS19MayPrepareTeacherAuthEnvSyncDryRun: true,
      confirmsS22MayPrepareTeacherAuthReadinessAfterEnvSyncEvidence: true,
      confirmsTeacherAuthLiveCookieIssuanceRequiresSeparateApproval: true,
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-teacher-auth-response-validation.mjs",
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
        target: "owner-decision-teacher-auth-response-validation",
        status: "owner-response-accepted",
        releaseReady: false,
        decisionId: "teacher-auth-provider-production-selector",
        responsibleSession: "S22/S19/S10",
      }),
    );
    expect(body.summary).toEqual(
      expect.objectContaining({
        missingFieldCount: 0,
        unsafeFindingCount: 0,
        providerModeAccepted: true,
        requiredServerOnlyEnvNameCount: 3,
        s19DryRunMayProceed: true,
        s22ReadinessMayProceed: true,
        liveCookieIssuanceStillForbidden: true,
        releaseReady: false,
      }),
    );
    expect(body.redactedOwnerResponse.ownerApprovedProviderMode).toBe("trusted-cookie-issuer");
    expect(body.postValidationAllowedChecks).toEqual([
      "prepare-s19-teacher-auth-env-sync-dry-run-after-app-auth-clears",
      "prepare-teacher-auth-readiness-command-after-env-sync-evidence",
      "prepare-teacher-auth-issuer-route-smoke-after-production-deploy",
    ]);
    expect(body.stillForbiddenUntilSeparateApproval).toContain("issue-live-teacher-auth-cookie");
    expect(body.stillForbiddenUntilSeparateApproval).toContain("run-production-smokes-dependent-on-teacher-auth");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://");
  });

  it("accepts oidc-jwks mode and counts its required server-only env names", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-auth-response-validation-oidc-"));
    const template = writeJson(tmpDir, "template.json", buildTemplateReport());
    const ownerResponse = writeJson(tmpDir, "owner-response.json", {
      responseStatus: "owner-response-provided",
      decisionId: "teacher-auth-provider-production-selector",
      ownerApprovedProviderMode: "oidc-jwks",
      approvedServerOnlyEnvSourceLabel: "s19-teacher-auth-oidc-env-sync-redacted",
      approvedReleaseRunIdLabel: "release-run-teacher-auth-oidc-gate-2026-07-01",
      confirmsNoCredentialValuesInResponse: true,
      confirmsS19MayPrepareTeacherAuthEnvSyncDryRun: true,
      confirmsS22MayPrepareTeacherAuthReadinessAfterEnvSyncEvidence: true,
      confirmsTeacherAuthLiveCookieIssuanceRequiresSeparateApproval: true,
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-teacher-auth-response-validation.mjs",
      "--owner-response-template",
      template,
      "--owner-response",
      ownerResponse,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("owner-response-accepted");
    expect(body.summary.requiredServerOnlyEnvNameCount).toBe(6);
    expect(body.requiredServerOnlyEnvNamesForApprovedMode).toEqual([
      "UAIS_TEACHER_AUTH_PROVIDER",
      "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
      "UAIS_TEACHER_AUTH_OIDC_ISSUER",
      "UAIS_TEACHER_AUTH_OIDC_AUDIENCE",
      "UAIS_TEACHER_AUTH_OIDC_JWKS_URL",
      "UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM",
    ]);
  });

  it("keeps the template placeholder incomplete until the owner fills it", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-auth-response-validation-incomplete-"));
    const templateReport = buildTemplateReport();
    const template = writeJson(tmpDir, "template.json", templateReport);
    const ownerResponse = writeJson(tmpDir, "owner-response.json", templateReport);

    const output = execFileSync("node", [
      "scripts/owner-decision-teacher-auth-response-validation.mjs",
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
    expect(body.summary.missingFieldCount).toBeGreaterThanOrEqual(7);
    expect(body.summary.s19DryRunMayProceed).toBe(false);
    expect(body.summary.s22ReadinessMayProceed).toBe(false);
    expect(body.postValidationAllowedChecks).toEqual([]);
    expect(body.blockedReasons).toContain("ownerApprovedProviderMode-missing");
    expect(body.blockedReasons).toContain(
      "confirmsTeacherAuthLiveCookieIssuanceRequiresSeparateApproval-not-confirmed",
    );
    expect(output).not.toContain(tmpDir);
  });

  it("renders empty post-validation checks explicitly in incomplete markdown", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-auth-response-validation-md-incomplete-"));
    const templateReport = buildTemplateReport();
    const template = writeJson(tmpDir, "template.json", templateReport);
    const ownerResponse = writeJson(tmpDir, "owner-response.json", templateReport);

    const output = execFileSync("node", [
      "scripts/owner-decision-teacher-auth-response-validation.mjs",
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
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-auth-response-validation-stub-"));
    const templateReport = {
      ...buildTemplateReport(),
      copySafeOwnerReplyStub: {
        responseStatus: "owner-response-provided",
        decisionId: "teacher-auth-provider-production-selector",
        ownerApprovedProviderMode: "<choose trusted-cookie-issuer or oidc-jwks>",
        approvedServerOnlyEnvSourceLabel: "<label only; no credential values>",
        approvedReleaseRunIdLabel: "<label only; no URL, token, or cookie>",
        confirmsNoCredentialValuesInResponse: true,
        confirmsS19MayPrepareTeacherAuthEnvSyncDryRun: true,
        confirmsS22MayPrepareTeacherAuthReadinessAfterEnvSyncEvidence: true,
        confirmsTeacherAuthLiveCookieIssuanceRequiresSeparateApproval: true,
      },
    };
    const template = writeJson(tmpDir, "template.json", templateReport);
    const ownerResponse = writeJson(tmpDir, "owner-response.json", templateReport);

    const output = execFileSync("node", [
      "scripts/owner-decision-teacher-auth-response-validation.mjs",
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
    expect(body.summary.providerModeAccepted).toBe(false);
    expect(body.summary.s19DryRunMayProceed).toBe(false);
    expect(body.summary.s22ReadinessMayProceed).toBe(false);
    expect(body.summary.liveCookieIssuanceStillForbidden).toBe(true);
    expect(body.redactedOwnerResponse).toEqual({
      responseStatus: "owner-response-provided",
      decisionId: "teacher-auth-provider-production-selector",
      ownerApprovedProviderMode: "<choose trusted-cookie-issuer or oidc-jwks>",
      approvedServerOnlyEnvSourceLabel: "<label only; no credential values>",
      approvedReleaseRunIdLabel: "<label only; no URL, token, or cookie>",
      confirmsNoCredentialValuesInResponse: true,
      confirmsS19MayPrepareTeacherAuthEnvSyncDryRun: true,
      confirmsS22MayPrepareTeacherAuthReadinessAfterEnvSyncEvidence: true,
      confirmsTeacherAuthLiveCookieIssuanceRequiresSeparateApproval: true,
    });
    expect(body.blockedReasons).toEqual([
      "ownerApprovedProviderMode-not-allowed",
      "approvedServerOnlyEnvSourceLabel-missing-or-invalid",
      "approvedReleaseRunIdLabel-missing-or-invalid",
      "provider-mode-not-accepted",
    ]);
    expect(output).not.toContain(tmpDir);
  });

  it("rejects credential-shaped owner responses without echoing unsafe values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-auth-response-validation-unsafe-"));
    const template = writeJson(tmpDir, "template.json", buildTemplateReport());
    const ownerResponse = writeJson(tmpDir, "owner-response.json", {
      responseStatus: "owner-response-provided",
      decisionId: "teacher-auth-provider-production-selector",
      ownerApprovedProviderMode: "trusted-cookie-issuer",
      approvedServerOnlyEnvSourceLabel: "/Users/example/.env.local",
      approvedReleaseRunIdLabel: "https://private.example.test/run/123",
      confirmsNoCredentialValuesInResponse: true,
      confirmsS19MayPrepareTeacherAuthEnvSyncDryRun: true,
      confirmsS22MayPrepareTeacherAuthReadinessAfterEnvSyncEvidence: true,
      confirmsTeacherAuthLiveCookieIssuanceRequiresSeparateApproval: true,
      notes: "UAIS_TEACHER_AUTH_ISSUER_SECRET=secret-token-value uais_teacher_auth_signature=secret",
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-teacher-auth-response-validation.mjs",
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
    expect(output).not.toContain("uais_teacher_auth_signature=secret");
  });
});

function buildTemplateReport() {
  return {
    target: "owner-decision-teacher-auth-response-template",
    status: "queued-awaiting-upstream-app-auth",
    decisionId: "teacher-auth-provider-production-selector",
    summary: {
      queueRank: 2,
      queueStatus: "owner-decision-needed",
      actionPacketStatus: "owner-decision-needed",
      upstreamBlockedDecisionCount: 1,
      releaseReady: false,
    },
    ownerResponseTemplate: {
      responseStatus: "owner-response-required",
      decisionId: "teacher-auth-provider-production-selector",
      ownerApprovedProviderMode: null,
      allowedProviderModes: ["trusted-cookie-issuer", "oidc-jwks"],
      approvedServerOnlyEnvSourceLabel: null,
      approvedReleaseRunIdLabel: null,
      confirmsNoCredentialValuesInResponse: false,
      confirmsS19MayPrepareTeacherAuthEnvSyncDryRun: false,
      confirmsS22MayPrepareTeacherAuthReadinessAfterEnvSyncEvidence: false,
      confirmsTeacherAuthLiveCookieIssuanceRequiresSeparateApproval: false,
      requiredServerOnlyEnvNamesByMode: {
        "trusted-cookie-issuer": [
          "UAIS_TEACHER_AUTH_PROVIDER",
          "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
          "UAIS_TEACHER_AUTH_ISSUER_SECRET",
        ],
        "oidc-jwks": [
          "UAIS_TEACHER_AUTH_PROVIDER",
          "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
          "UAIS_TEACHER_AUTH_OIDC_ISSUER",
          "UAIS_TEACHER_AUTH_OIDC_AUDIENCE",
          "UAIS_TEACHER_AUTH_OIDC_JWKS_URL",
          "UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM",
        ],
      },
      requiredEvidenceAfterApproval: [
        "vercel-env-sync-evidence-with-teacher-auth-env-present",
        "teacher-auth-provider-readiness-production-live-ready",
      ],
    },
  };
}

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}
