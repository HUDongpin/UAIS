import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("owner decision response completion extract", () => {
  it("extracts accepted consolidated owner responses into individual files and commands", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-completion-extract-"));
    const outDir = join(tmpDir, "responses");
    const validation = writeJson(tmpDir, "completion-validation.json", {
      target: "owner-decision-response-completion-validation",
      status: "owner-response-completion-accepted",
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      summary: {
        ownerCompletionItemCount: 2,
        acceptedItemCount: 2,
        incompleteItemCount: 0,
        postValidationMayProceed: true,
        releaseReady: false,
      },
      validationItems: [
        { rank: 1, decisionId: "app-auth-provider-production-selector", status: "owner-response-completion-accepted" },
        { rank: 2, decisionId: "teacher-auth-provider-production-selector", status: "owner-response-completion-accepted" },
      ],
      individualOwnerResponseValidationCommands: [
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
          decisionId: "teacher-auth-provider-production-selector",
          ownerResponse: {
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
      "scripts/owner-decision-response-completion-extract.mjs",
      "--completion-validation",
      validation,
      "--owner-response-completion",
      ownerResponseCompletion,
      "--out-dir",
      outDir,
      "--owner-response-command-dir",
      "coordination/reports/owner-responses/2026-07-01",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "owner-decision-response-completion-extract",
        status: "owner-response-individual-files-created",
        releaseReady: false,
        releaseGateStatus: "blocked",
        ownerDecisionQueueStatus: "owner-decisions-required",
      }),
    );
    expect(body.summary).toEqual({
      completionAccepted: true,
      requestedItemCount: 2,
      extractedFileCount: 2,
      skippedItemCount: 0,
      invalidCommandCount: 0,
      releaseReady: false,
    });
    expect(body.extractedResponses).toEqual([
      expect.objectContaining({
        rank: 1,
        decisionId: "app-auth-provider-production-selector",
        individualResponseFileName:
          "01-app-auth-provider-production-selector-owner-response.json",
        ownerResponseValidationCommand:
          "node scripts/owner-decision-app-auth-response-validation.mjs --owner-response-template coordination/reports/app-template.json --owner-response coordination/reports/owner-responses/2026-07-01/01-app-auth-provider-production-selector-owner-response.json",
      }),
      expect.objectContaining({
        rank: 2,
        decisionId: "teacher-auth-provider-production-selector",
        individualResponseFileName:
          "02-teacher-auth-provider-production-selector-owner-response.json",
      }),
    ]);
    expect(body.safety).toEqual(
      expect.objectContaining({
        sourcePathsOmitted: true,
        credentialValuesOmitted: true,
        noLiveMutationPerformed: true,
        noDeploymentMutationPerformed: true,
        noReleaseRunBindingPerformed: true,
      }),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("app-auth-env-source-label");
    expect(output).not.toContain("teacher-auth-release-run-label");

    const files = readdirSync(outDir).sort();
    expect(files).toEqual([
      "01-app-auth-provider-production-selector-owner-response.json",
      "02-teacher-auth-provider-production-selector-owner-response.json",
    ]);
    const appResponse = JSON.parse(
      readFileSync(join(outDir, "01-app-auth-provider-production-selector-owner-response.json"), "utf8"),
    );
    expect(appResponse).toEqual({
      responseStatus: "owner-response-provided",
      decisionId: "app-auth-provider-production-selector",
      ownerApprovedProviderMode: "trusted-account-provider",
      approvedServerOnlyEnvSourceLabel: "app-auth-env-source-label",
      approvedReleaseRunIdLabel: "app-auth-release-run-label",
      confirmsNoCredentialValuesInResponse: true,
      confirmsS19MayPrepareAppAuthEnvSyncDryRun: true,
      confirmsS22MayPrepareAppAuthReadinessAfterEnvSyncEvidence: true,
    });
  });

  it("blocks extraction when consolidated validation has not accepted the owner response", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-completion-extract-blocked-"));
    const outDir = join(tmpDir, "responses");
    const validation = writeJson(tmpDir, "completion-validation.json", {
      target: "owner-decision-response-completion-validation",
      status: "owner-response-completion-incomplete",
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      summary: {
        ownerCompletionItemCount: 1,
        acceptedItemCount: 0,
        incompleteItemCount: 1,
        postValidationMayProceed: false,
        releaseReady: false,
      },
      validationItems: [
        {
          rank: 1,
          decisionId: "app-auth-provider-production-selector",
          status: "owner-response-completion-incomplete",
        },
      ],
      individualOwnerResponseValidationCommands: [
        {
          rank: 1,
          decisionId: "app-auth-provider-production-selector",
          ownerResponseValidationCommand:
            "node scripts/owner-decision-app-auth-response-validation.mjs --owner-response-template coordination/reports/app-template.json --owner-response path/to/filled-owner-response.json",
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
            approvedServerOnlyEnvSourceLabel: "<label only; no credential values>",
          },
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-response-completion-extract.mjs",
      "--completion-validation",
      validation,
      "--owner-response-completion",
      ownerResponseCompletion,
      "--out-dir",
      outDir,
      "--owner-response-command-dir",
      "coordination/reports/owner-responses/2026-07-01",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("owner-response-extraction-blocked");
    expect(body.summary).toEqual({
      completionAccepted: false,
      requestedItemCount: 1,
      extractedFileCount: 0,
      skippedItemCount: 1,
      invalidCommandCount: 0,
      releaseReady: false,
    });
    expect(body.extractedResponses).toEqual([]);
    expect(body.blockedReasons).toContain("completion-validation-not-accepted");
    expect(existsSync(outDir)).toBe(false);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("<label only; no credential values>");
  });

  it("classifies extraction as awaiting production evidence when owner decisions are cleared", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-completion-extract-status-"));
    const outDir = join(tmpDir, "responses");
    const validation = writeJson(tmpDir, "completion-validation.json", {
      target: "owner-decision-response-completion-validation",
      status: "owner-response-completion-awaiting-production-evidence",
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-cleared-awaiting-production-evidence",
      sourceOwnerDecisionQueueStatus: "owner-decisions-required",
      summary: {
        ownerCompletionItemCount: 1,
        acceptedItemCount: 0,
        incompleteItemCount: 1,
        needsOwnerInput: false,
        productionEvidenceRequired: true,
        postValidationMayProceed: false,
        releaseReady: false,
      },
      validationItems: [
        {
          rank: 1,
          decisionId: "ordinary-teaching-production-evidence",
          status: "owner-response-completion-incomplete",
        },
      ],
      individualOwnerResponseValidationCommands: [
        {
          rank: 1,
          decisionId: "ordinary-teaching-production-evidence",
          ownerResponseValidationCommand:
            "node scripts/owner-decision-ordinary-teaching-production-evidence-response-validation.mjs --owner-response-template coordination/reports/ordinary-template.json --owner-response path/to/filled-owner-response.json",
        },
      ],
    });
    const ownerResponseCompletion = writeJson(tmpDir, "owner-response-completion.json", {
      ownerCompletionItems: [
        {
          decisionId: "ordinary-teaching-production-evidence",
          copySafeOwnerReplyStub: {
            responseStatus: "owner-response-provided",
            decisionId: "ordinary-teaching-production-evidence",
            approvedTeachingOperationsRouteSmokeLabel: "<label after live evidence exists>",
          },
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-response-completion-extract.mjs",
      "--completion-validation",
      validation,
      "--owner-response-completion",
      ownerResponseCompletion,
      "--out-dir",
      outDir,
      "--owner-response-command-dir",
      "coordination/reports/owner-responses/2026-07-02",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("owner-response-extraction-awaiting-production-evidence");
    expect(body.ownerDecisionQueueStatus).toBe(
      "owner-decisions-cleared-awaiting-production-evidence",
    );
    expect(body.sourceOwnerDecisionQueueStatus).toBe("owner-decisions-required");
    expect(body.blockedReasons).toEqual(["production-evidence-required"]);
    expect(body.productionEvidenceRequired).toBe(true);
    expect(output).not.toContain(tmpDir);
  });
});

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}
