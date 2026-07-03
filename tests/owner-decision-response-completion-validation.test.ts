import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("owner decision response completion validation", () => {
  it("rejects unsafe or placeholder-filled consolidated owner responses without echoing values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-completion-validation-"));
    const completionPacket = writeJson(tmpDir, "completion-packet.json", buildCompletionPacket());
    const ownerResponseCompletion = writeJson(tmpDir, "owner-response-completion.json", {
      ownerCompletionItems: [
        {
          decisionId: "app-auth-provider-production-selector",
          copySafeOwnerReplyStub: {
            responseStatus: "owner-response-provided",
            decisionId: "app-auth-provider-production-selector",
            ownerApprovedProviderMode: "trusted-account-provider",
            approvedServerOnlyEnvSourceLabel: "<label only; no credential values>",
            approvedReleaseRunIdLabel: "https://private-release.example.test/run",
            confirmsNoCredentialValuesInResponse: true,
            confirmsS19MayPrepareAppAuthEnvSyncDryRun: true,
            confirmsS22MayPrepareAppAuthReadinessAfterEnvSyncEvidence: true,
          },
        },
        {
          decisionId: "teacher-auth-provider-production-selector",
          copySafeOwnerReplyStub: {
            responseStatus: "owner-response-provided",
            decisionId: "teacher-auth-provider-production-selector",
            ownerApprovedProviderMode: "<choose trusted-cookie-issuer or oidc-jwks>",
            approvedServerOnlyEnvSourceLabel: "teacher-auth-env-source-label",
            approvedReleaseRunIdLabel: "teacher-auth-release-run-label",
            confirmsNoCredentialValuesInResponse: true,
            confirmsS19MayPrepareTeacherAuthEnvSyncDryRun: true,
            confirmsS22MayPrepareTeacherAuthReadinessAfterEnvSyncEvidence: true,
            confirmsTeacherAuthLiveCookieIssuanceRequiresSeparateApproval: true,
          },
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-response-completion-validation.mjs",
      "--completion-packet",
      completionPacket,
      "--owner-response-completion",
      ownerResponseCompletion,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "owner-decision-response-completion-validation",
        status: "owner-response-completion-rejected",
        releaseReady: false,
        releaseGateStatus: "blocked",
        ownerDecisionQueueStatus: "owner-decisions-required",
      }),
    );
    expect(body.summary).toEqual({
      ownerCompletionItemCount: 2,
      acceptedItemCount: 0,
      incompleteItemCount: 2,
      missingFieldTotal: 0,
      placeholderFieldTotal: 2,
      unsafeFindingTotal: 1,
      releaseRunBindingPerformedCount: 0,
      confirmationFailureTotal: 0,
      individualValidationCommandCount: 2,
      safetyAttentionCount: 1,
      needsOwnerInput: true,
      productionEvidenceRequired: false,
      postValidationMayProceed: false,
      releaseReady: false,
    });
    expect(body.firstIncompleteOwnerResponse).toEqual({
      rank: 1,
      decisionId: "app-auth-provider-production-selector",
      status: "owner-response-completion-rejected",
      missingFieldCount: 0,
      placeholderFieldCount: 1,
      unsafeFindingCount: 1,
      confirmationFailureCount: 0,
      requiredOwnerInputFields: [
        "ownerApprovedProviderMode",
        "approvedServerOnlyEnvSourceLabel",
        "approvedReleaseRunIdLabel",
      ],
      ownerResponseValidationCommand:
        "node scripts/owner-decision-app-auth-response-validation.mjs --owner-response-template coordination/reports/app-template.json --owner-response path/to/filled-owner-response.json",
    });
    expect(body.individualOwnerResponseValidationCommands).toEqual([
      {
        rank: 1,
        decisionId: "app-auth-provider-production-selector",
        ownerResponseValidationCommand:
          "node scripts/owner-decision-app-auth-response-validation.mjs --owner-response-template coordination/reports/app-template.json --owner-response path/to/filled-owner-response.json",
      },
      {
        rank: 2,
        decisionId: "teacher-auth-provider-production-selector",
        ownerResponseValidationCommand:
          "node scripts/owner-decision-teacher-auth-response-validation.mjs --owner-response-template coordination/reports/teacher-template.json --owner-response path/to/filled-owner-response.json",
      },
    ]);
    expect(body.validationItems).toEqual([
      expect.objectContaining({
        decisionId: "app-auth-provider-production-selector",
        status: "owner-response-completion-rejected",
        ownerResponseValidationCommand:
          "node scripts/owner-decision-app-auth-response-validation.mjs --owner-response-template coordination/reports/app-template.json --owner-response path/to/filled-owner-response.json",
        placeholderFields: ["approvedServerOnlyEnvSourceLabel"],
        unsafeFindings: [
          {
            fieldPath: "copySafeOwnerReplyStub.approvedReleaseRunIdLabel",
            patternId: "raw-url",
          },
        ],
      }),
      expect.objectContaining({
        decisionId: "teacher-auth-provider-production-selector",
        status: "owner-response-completion-incomplete",
        ownerResponseValidationCommand:
          "node scripts/owner-decision-teacher-auth-response-validation.mjs --owner-response-template coordination/reports/teacher-template.json --owner-response path/to/filled-owner-response.json",
        placeholderFields: ["ownerApprovedProviderMode"],
        unsafeFindings: [],
      }),
    ]);
    expect(output).not.toContain("https://private-release.example.test");
    expect(output).not.toContain("teacher-auth-env-source-label");

    const markdownOutput = execFileSync("node", [
      "scripts/owner-decision-response-completion-validation.mjs",
      "--completion-packet",
      completionPacket,
      "--owner-response-completion",
      ownerResponseCompletion,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(markdownOutput).toContain("## Post-Validation Allowed Checks");
    expect(markdownOutput).toContain("## First Incomplete Owner Response");
    expect(markdownOutput).toContain("Decision: `app-auth-provider-production-selector`");
    expect(markdownOutput).toContain("Placeholder fields: 1");
    expect(markdownOutput).toContain("Unsafe findings: 1");
    expect(markdownOutput).toContain("- `none-recorded`");
    expect(markdownOutput).toContain("## Still Forbidden Until Separate Approval");
    expect(markdownOutput).toContain("- `run-vercel-env-apply`");
    expect(markdownOutput).toContain("- `run-vercel-production-deploy`");
    expect(markdownOutput).toContain("- `bind-production-release-run-id`");
    expect(markdownOutput).not.toContain("https://private-release.example.test");
    expect(markdownOutput).not.toContain("teacher-auth-env-source-label");
  });

  it("accepts a complete copy-safe consolidated owner response and renders redacted markdown", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-completion-validation-md-"));
    const completionPacket = writeJson(tmpDir, "completion-packet.json", buildCompletionPacket());
    const ownerResponseCompletion = writeJson(tmpDir, "owner-response-completion.json", {
      ownerCompletionItems: [
        {
          decisionId: "app-auth-provider-production-selector",
          copySafeOwnerReplyStub: {
            responseStatus: "owner-response-provided",
            decisionId: "app-auth-provider-production-selector",
            ownerApprovedProviderMode: "trusted-account-provider",
            approvedServerOnlyEnvSourceLabel: "app-auth-env-source-label",
            approvedReleaseRunIdLabel: "app-auth-release-run-label",
            confirmsNoCredentialValuesInResponse: true,
            confirmsS19MayPrepareAppAuthEnvSyncDryRun: true,
            confirmsS22MayPrepareAppAuthReadinessAfterEnvSyncEvidence: true,
          },
        },
        {
          decisionId: "teacher-auth-provider-production-selector",
          copySafeOwnerReplyStub: {
            responseStatus: "owner-response-provided",
            decisionId: "teacher-auth-provider-production-selector",
            ownerApprovedProviderMode: "trusted-cookie-issuer",
            approvedServerOnlyEnvSourceLabel: "teacher-auth-env-source-label",
            approvedReleaseRunIdLabel: "teacher-auth-release-run-label",
            confirmsNoCredentialValuesInResponse: true,
            confirmsS19MayPrepareTeacherAuthEnvSyncDryRun: true,
            confirmsS22MayPrepareTeacherAuthReadinessAfterEnvSyncEvidence: true,
            confirmsTeacherAuthLiveCookieIssuanceRequiresSeparateApproval: true,
          },
        },
      ],
    });

    const jsonOutput = execFileSync("node", [
      "scripts/owner-decision-response-completion-validation.mjs",
      "--completion-packet",
      completionPacket,
      "--owner-response-completion",
      ownerResponseCompletion,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(jsonOutput);

    expect(body.status).toBe("owner-response-completion-accepted");
    expect(body.firstIncompleteOwnerResponse).toBeNull();
    expect(body.summary).toEqual({
      ownerCompletionItemCount: 2,
      acceptedItemCount: 2,
      incompleteItemCount: 0,
      missingFieldTotal: 0,
      placeholderFieldTotal: 0,
      unsafeFindingTotal: 0,
      releaseRunBindingPerformedCount: 0,
      confirmationFailureTotal: 0,
      individualValidationCommandCount: 2,
      safetyAttentionCount: 0,
      needsOwnerInput: false,
      productionEvidenceRequired: false,
      postValidationMayProceed: true,
      releaseReady: false,
    });
    expect(body.safety).toEqual(
      expect.objectContaining({
        rawUrlsOmitted: true,
        credentialValuesOmitted: true,
        noLiveMutationPerformed: true,
        noDeploymentMutationPerformed: true,
        noReleaseRunBindingPerformed: true,
      }),
    );

    const markdownOutput = execFileSync("node", [
      "scripts/owner-decision-response-completion-validation.mjs",
      "--completion-packet",
      completionPacket,
      "--owner-response-completion",
      ownerResponseCompletion,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(markdownOutput).toContain("# UAIS Owner Response Completion Validation");
    expect(markdownOutput).toContain("Status: `owner-response-completion-accepted`");
    expect(markdownOutput).toContain("Post-validation may proceed: `true`");
    expect(markdownOutput).toContain("## Individual Validation Commands");
    expect(markdownOutput).toContain(
      "node scripts/owner-decision-app-auth-response-validation.mjs --owner-response-template coordination/reports/app-template.json --owner-response path/to/filled-owner-response.json",
    );
    expect(markdownOutput).toContain("Individual validation command:");
    expect(markdownOutput).toContain("app-auth-provider-production-selector");
    expect(markdownOutput).toContain("## Post-Validation Allowed Checks");
    expect(markdownOutput).toContain("- `run-individual-owner-response-validators`");
    expect(markdownOutput).toContain("## Still Forbidden Until Separate Approval");
    expect(markdownOutput).toContain("- `run-vercel-production-deploy`");
    expect(markdownOutput).toContain("- `bind-production-release-run-id`");
    expect(markdownOutput).not.toContain("app-auth-env-source-label");
    expect(markdownOutput).not.toContain("teacher-auth-release-run-label");
  });

  it("rejects completion when the completion packet already needs safety review", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-completion-validation-upstream-safety-"));
    const completionPacketBody = buildCompletionPacket();
    completionPacketBody.status = "owner-response-completion-needs-safety-review";
    completionPacketBody.summary.unsafeFindingTotal = 2;
    completionPacketBody.summary.releaseRunBindingPerformedCount = 1;
    completionPacketBody.summary.safetyAttentionCount = 3;
    const completionPacket = writeJson(tmpDir, "completion-packet.json", completionPacketBody);
    const ownerResponseCompletion = writeJson(tmpDir, "owner-response-completion.json", {
      ownerCompletionItems: [
        {
          decisionId: "app-auth-provider-production-selector",
          copySafeOwnerReplyStub: {
            responseStatus: "owner-response-provided",
            decisionId: "app-auth-provider-production-selector",
            ownerApprovedProviderMode: "trusted-account-provider",
            approvedServerOnlyEnvSourceLabel: "app-auth-env-source-label",
            approvedReleaseRunIdLabel: "app-auth-release-run-label",
            confirmsNoCredentialValuesInResponse: true,
            confirmsS19MayPrepareAppAuthEnvSyncDryRun: true,
            confirmsS22MayPrepareAppAuthReadinessAfterEnvSyncEvidence: true,
          },
        },
        {
          decisionId: "teacher-auth-provider-production-selector",
          copySafeOwnerReplyStub: {
            responseStatus: "owner-response-provided",
            decisionId: "teacher-auth-provider-production-selector",
            ownerApprovedProviderMode: "trusted-cookie-issuer",
            approvedServerOnlyEnvSourceLabel: "teacher-auth-env-source-label",
            approvedReleaseRunIdLabel: "teacher-auth-release-run-label",
            confirmsNoCredentialValuesInResponse: true,
            confirmsS19MayPrepareTeacherAuthEnvSyncDryRun: true,
            confirmsS22MayPrepareTeacherAuthReadinessAfterEnvSyncEvidence: true,
            confirmsTeacherAuthLiveCookieIssuanceRequiresSeparateApproval: true,
          },
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-response-completion-validation.mjs",
      "--completion-packet",
      completionPacket,
      "--owner-response-completion",
      ownerResponseCompletion,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("owner-response-completion-rejected");
    expect(body.summary.acceptedItemCount).toBe(2);
    expect(body.summary.unsafeFindingTotal).toBe(2);
    expect(body.summary.releaseRunBindingPerformedCount).toBe(1);
    expect(body.summary.safetyAttentionCount).toBe(3);
    expect(body.summary.needsOwnerInput).toBe(false);
    expect(body.summary.productionEvidenceRequired).toBe(false);
    expect(body.summary.postValidationMayProceed).toBe(false);
    expect(body.upstreamSafetyFindings).toEqual([
      "completion-packet-unsafe-finding-total-2",
      "completion-packet-release-run-binding-performed-1",
    ]);
  });

  it("derives current owner queue status when only production evidence labels remain placeholders", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-completion-validation-evidence-"));
    const completionPacket = writeJson(tmpDir, "completion-packet.json", {
      target: "owner-decision-response-completion-packet",
      status: "owner-response-completion-required",
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-cleared-awaiting-production-evidence",
      sourceOwnerDecisionQueueStatus: "owner-decisions-required",
      summary: {
        unsafeFindingTotal: 0,
        releaseRunBindingPerformedCount: 0,
        releaseReady: false,
      },
      ownerCompletionItems: [
        {
          rank: 1,
          decisionId: "app-auth-provider-production-selector",
          ownerResponseValidationCommand:
            "node scripts/owner-decision-app-auth-response-validation.mjs --owner-response-template coordination/reports/app-template.json --owner-response path/to/filled-owner-response.json",
          requiredOwnerInputFields: [
            "ownerApprovedProviderMode",
            "approvedServerOnlyEnvSourceLabel",
            "approvedReleaseRunIdLabel",
          ],
          requiredOwnerLabelFields: [
            "approvedServerOnlyEnvSourceLabel",
            "approvedReleaseRunIdLabel",
          ],
        },
        {
          rank: 2,
          decisionId: "ordinary-teaching-production-evidence",
          ownerResponseValidationCommand:
            "node scripts/owner-decision-ordinary-teaching-production-evidence-response-validation.mjs --owner-response-template coordination/reports/ordinary-template.json --owner-response path/to/filled-owner-response.json",
          requiredOwnerInputFields: [
            "approvedAppAuthReadinessEvidenceLabel",
            "approvedTeachingOperationsRouteSmokeLabel",
            "approvedReleaseRunIdLabel",
          ],
          requiredOwnerLabelFields: [
            "approvedAppAuthReadinessEvidenceLabel",
            "approvedTeachingOperationsRouteSmokeLabel",
            "approvedReleaseRunIdLabel",
          ],
        },
      ],
    });
    const ownerResponseCompletion = writeJson(tmpDir, "owner-response-completion.json", {
      ownerCompletionItems: [
        {
          decisionId: "app-auth-provider-production-selector",
          copySafeOwnerReplyStub: {
            responseStatus: "owner-response-provided",
            decisionId: "app-auth-provider-production-selector",
            ownerApprovedProviderMode: "trusted-account-provider",
            approvedServerOnlyEnvSourceLabel: "app-auth-env-source-label",
            approvedReleaseRunIdLabel: "app-auth-release-run-label",
            confirmsNoCredentialValuesInResponse: true,
            confirmsS19MayPrepareAppAuthEnvSyncDryRun: true,
            confirmsS22MayPrepareAppAuthReadinessAfterEnvSyncEvidence: true,
          },
        },
        {
          decisionId: "ordinary-teaching-production-evidence",
          copySafeOwnerReplyStub: {
            responseStatus: "owner-response-provided",
            decisionId: "ordinary-teaching-production-evidence",
            approvedAppAuthReadinessEvidenceLabel: "<label after live evidence exists>",
            approvedTeachingOperationsRouteSmokeLabel: "<label after live evidence exists>",
            approvedReleaseRunIdLabel: "<label after release-run binding exists>",
            confirmsNoCredentialValuesInResponse: true,
          },
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-response-completion-validation.mjs",
      "--completion-packet",
      completionPacket,
      "--owner-response-completion",
      ownerResponseCompletion,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("owner-response-completion-awaiting-production-evidence");
    expect(body.ownerDecisionQueueStatus).toBe(
      "owner-decisions-cleared-awaiting-production-evidence",
    );
    expect(body.sourceOwnerDecisionQueueStatus).toBe("owner-decisions-required");
    expect(body.summary).toEqual(
      expect.objectContaining({
        acceptedItemCount: 1,
        incompleteItemCount: 1,
        missingFieldTotal: 0,
        placeholderFieldTotal: 3,
        needsOwnerInput: false,
        productionEvidenceRequired: true,
        postValidationMayProceed: false,
        releaseReady: false,
      }),
    );
    expect(body.firstIncompleteOwnerResponse).toEqual(
      expect.objectContaining({
        decisionId: "ordinary-teaching-production-evidence",
        placeholderFieldCount: 3,
        missingFieldCount: 0,
      }),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });
});

function buildCompletionPacket() {
  return {
    target: "owner-decision-response-completion-packet",
    status: "owner-response-completion-required",
    releaseGateStatus: "blocked",
    ownerDecisionQueueStatus: "owner-decisions-required",
    summary: {
      responsePackageCount: 2,
      incompleteResponseCount: 2,
      missingFieldTotal: 5,
      copySafeStubCount: 2,
      unsafeFindingTotal: 0,
      releaseRunBindingPerformedCount: 0,
      safetyAttentionCount: 0,
      releaseReady: false,
    },
    ownerCompletionItems: [
      {
        rank: 1,
        decisionId: "app-auth-provider-production-selector",
        validationStatus: "owner-response-incomplete",
        ownerResponseValidationCommand:
          "node scripts/owner-decision-app-auth-response-validation.mjs --owner-response-template coordination/reports/app-template.json --owner-response path/to/filled-owner-response.json",
        requiredOwnerInputFields: [
          "ownerApprovedProviderMode",
          "approvedServerOnlyEnvSourceLabel",
          "approvedReleaseRunIdLabel",
        ],
        requiredOwnerLabelFields: [
          "approvedServerOnlyEnvSourceLabel",
          "approvedReleaseRunIdLabel",
        ],
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
      },
      {
        rank: 2,
        decisionId: "teacher-auth-provider-production-selector",
        validationStatus: "owner-response-incomplete",
        ownerResponseValidationCommand:
          "node scripts/owner-decision-teacher-auth-response-validation.mjs --owner-response-template coordination/reports/teacher-template.json --owner-response path/to/filled-owner-response.json",
        requiredOwnerInputFields: [
          "ownerApprovedProviderMode",
          "approvedServerOnlyEnvSourceLabel",
          "approvedReleaseRunIdLabel",
        ],
        requiredOwnerLabelFields: [
          "approvedServerOnlyEnvSourceLabel",
          "approvedReleaseRunIdLabel",
        ],
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
      },
    ],
  };
}

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}
