import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("owner decision response postvalidation suite", () => {
  it("blocks without executing validators when extraction is not ready", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-postvalidation-blocked-"));
    const extractionReport = writeJson(tmpDir, "extraction-report.json", {
      target: "owner-decision-response-completion-extract",
      status: "owner-response-extraction-blocked",
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      summary: {
        completionAccepted: false,
        requestedItemCount: 2,
        extractedFileCount: 0,
        skippedItemCount: 2,
        invalidCommandCount: 0,
        releaseReady: false,
      },
      extractedResponses: [],
      skippedItems: [
        {
          rank: 1,
          decisionId: "app-auth-provider-production-selector",
          reason: "completion-validation-not-accepted",
        },
        {
          rank: 2,
          decisionId: "teacher-auth-provider-production-selector",
          reason: "completion-validation-not-accepted",
        },
      ],
      blockedReasons: ["completion-validation-not-accepted"],
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-response-postvalidation-suite.mjs",
      "--extraction-report",
      extractionReport,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "owner-decision-response-postvalidation-suite",
        status: "owner-response-postvalidation-blocked",
        releaseReady: false,
        releaseGateStatus: "blocked",
        ownerDecisionQueueStatus: "owner-decisions-required",
      }),
    );
    expect(body.summary).toEqual({
      extractionStatus: "owner-response-extraction-blocked",
      requestedItemCount: 2,
      runnableItemCount: 0,
      executedValidationCount: 0,
      acceptedValidationCount: 0,
      incompleteValidationCount: 0,
      rejectedValidationCount: 0,
      failedValidationCount: 0,
      unsafeFindingTotal: 0,
      safetyAttentionCount: 0,
      releaseReady: false,
    });
    expect(body.validationResults).toEqual([]);
    expect(body.blockedReasons).toContain("extraction-not-ready");
    expect(output).not.toContain(tmpDir);
  });

  it("propagates current and source owner queue statuses when extraction is blocked by production evidence", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-postvalidation-status-"));
    const extractionReport = writeJson(tmpDir, "extraction-report.json", {
      target: "owner-decision-response-completion-extract",
      status: "owner-response-extraction-blocked",
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-cleared-awaiting-production-evidence",
      sourceOwnerDecisionQueueStatus: "owner-decisions-required",
      summary: {
        completionAccepted: false,
        requestedItemCount: 1,
        extractedFileCount: 0,
        skippedItemCount: 1,
        invalidCommandCount: 0,
        releaseReady: false,
      },
      extractedResponses: [],
      skippedItems: [
        {
          rank: 1,
          decisionId: "ordinary-teaching-production-evidence",
          reason: "completion-validation-not-accepted",
        },
      ],
      blockedReasons: ["completion-validation-not-accepted"],
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-response-postvalidation-suite.mjs",
      "--extraction-report",
      extractionReport,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("owner-response-postvalidation-awaiting-production-evidence");
    expect(body.ownerDecisionQueueStatus).toBe(
      "owner-decisions-cleared-awaiting-production-evidence",
    );
    expect(body.sourceOwnerDecisionQueueStatus).toBe("owner-decisions-required");
    expect(body.blockedReasons).toEqual(["production-evidence-required"]);
    expect(body.productionEvidenceRequired).toBe(true);
    expect(output).not.toContain(tmpDir);
  });

  it("runs extracted individual validators and summarizes accepted responses without echoing values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-postvalidation-accepted-"));
    const appTemplate = writeJson(tmpDir, "app-template.json", {
      status: "awaiting-owner-response",
      ownerResponseTemplate: {
        allowedProviderModes: ["trusted-account-provider"],
        requiredServerOnlyEnvNames: [
          "UAIS_APP_AUTH_PROVIDER",
          "UAIS_APP_AUTH_ISSUER",
        ],
        requiredEvidenceAfterApproval: ["s19-env-sync-dry-run"],
      },
    });
    const appResponse = writeJson(tmpDir, "app-response.json", {
      responseStatus: "owner-response-provided",
      decisionId: "app-auth-provider-production-selector",
      ownerApprovedProviderMode: "trusted-account-provider",
      approvedServerOnlyEnvSourceLabel: "app-auth-env-source-label",
      approvedReleaseRunIdLabel: "release-run-app-auth-label",
      confirmsNoCredentialValuesInResponse: true,
      confirmsS19MayPrepareAppAuthEnvSyncDryRun: true,
      confirmsS22MayPrepareAppAuthReadinessAfterEnvSyncEvidence: true,
    });
    const teacherTemplate = writeJson(tmpDir, "teacher-template.json", {
      status: "awaiting-owner-response",
      ownerResponseTemplate: {
        allowedProviderModes: ["trusted-cookie-issuer"],
        requiredServerOnlyEnvNamesByMode: {
          "trusted-cookie-issuer": [
            "UAIS_TEACHER_AUTH_COOKIE_SECRET",
          ],
        },
        requiredEvidenceAfterApproval: ["teacher-auth-readiness"],
      },
    });
    const teacherResponse = writeJson(tmpDir, "teacher-response.json", {
      responseStatus: "owner-response-provided",
      decisionId: "teacher-auth-provider-production-selector",
      ownerApprovedProviderMode: "trusted-cookie-issuer",
      approvedServerOnlyEnvSourceLabel: "teacher-auth-env-source-label",
      approvedReleaseRunIdLabel: "release-run-teacher-auth-label",
      confirmsNoCredentialValuesInResponse: true,
      confirmsS19MayPrepareTeacherAuthEnvSyncDryRun: true,
      confirmsS22MayPrepareTeacherAuthReadinessAfterEnvSyncEvidence: true,
      confirmsTeacherAuthLiveCookieIssuanceRequiresSeparateApproval: true,
    });
    const extractionReport = writeJson(tmpDir, "extraction-report.json", {
      target: "owner-decision-response-completion-extract",
      status: "owner-response-individual-files-created",
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      summary: {
        completionAccepted: true,
        requestedItemCount: 2,
        extractedFileCount: 2,
        skippedItemCount: 0,
        invalidCommandCount: 0,
        releaseReady: false,
      },
      extractedResponses: [
        {
          rank: 1,
          decisionId: "app-auth-provider-production-selector",
          individualResponseFileName: "01-app-auth-provider-production-selector-owner-response.json",
          ownerResponseValidationCommand: [
            "node scripts/owner-decision-app-auth-response-validation.mjs",
            `--owner-response-template ${appTemplate}`,
            `--owner-response ${appResponse}`,
          ].join(" "),
        },
        {
          rank: 2,
          decisionId: "teacher-auth-provider-production-selector",
          individualResponseFileName:
            "02-teacher-auth-provider-production-selector-owner-response.json",
          ownerResponseValidationCommand: [
            "node scripts/owner-decision-teacher-auth-response-validation.mjs",
            `--owner-response-template ${teacherTemplate}`,
            `--owner-response ${teacherResponse}`,
          ].join(" "),
        },
      ],
      skippedItems: [],
      blockedReasons: [],
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-response-postvalidation-suite.mjs",
      "--extraction-report",
      extractionReport,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("owner-response-postvalidation-accepted");
    expect(body.summary).toEqual({
      extractionStatus: "owner-response-individual-files-created",
      requestedItemCount: 2,
      runnableItemCount: 2,
      executedValidationCount: 2,
      acceptedValidationCount: 2,
      incompleteValidationCount: 0,
      rejectedValidationCount: 0,
      failedValidationCount: 0,
      unsafeFindingTotal: 0,
      safetyAttentionCount: 0,
      releaseReady: false,
    });
    expect(body.validationResults).toEqual([
      expect.objectContaining({
        rank: 1,
        decisionId: "app-auth-provider-production-selector",
        status: "owner-response-accepted",
        scriptFileName: "owner-decision-app-auth-response-validation.mjs",
        templateFileName: "app-template.json",
        responseFileName: "app-response.json",
        missingFieldCount: 0,
        unsafeFindingCount: 0,
      }),
      expect.objectContaining({
        rank: 2,
        decisionId: "teacher-auth-provider-production-selector",
        status: "owner-response-accepted",
        scriptFileName: "owner-decision-teacher-auth-response-validation.mjs",
        templateFileName: "teacher-template.json",
        responseFileName: "teacher-response.json",
        missingFieldCount: 0,
        unsafeFindingCount: 0,
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
    expect(output).not.toContain("teacher-auth-env-source-label");
    expect(output).not.toContain("release-run-teacher-auth-label");
  });

  it("summarizes unsafe validator findings and keeps postvalidation blocked for safety review", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-postvalidation-unsafe-"));
    const appTemplate = writeJson(tmpDir, "app-template.json", {
      status: "awaiting-owner-response",
      ownerResponseTemplate: {
        allowedProviderModes: ["trusted-account-provider"],
        requiredServerOnlyEnvNames: ["UAIS_APP_AUTH_PROVIDER"],
        requiredEvidenceAfterApproval: ["s19-env-sync-dry-run"],
      },
    });
    const appResponse = writeJson(tmpDir, "app-response.json", {
      responseStatus: "owner-response-provided",
      decisionId: "app-auth-provider-production-selector",
      ownerApprovedProviderMode: "trusted-account-provider",
      approvedServerOnlyEnvSourceLabel: "app-auth-env-source-label",
      approvedReleaseRunIdLabel: "https://private-release.example.test/run",
      confirmsNoCredentialValuesInResponse: true,
      confirmsS19MayPrepareAppAuthEnvSyncDryRun: true,
      confirmsS22MayPrepareAppAuthReadinessAfterEnvSyncEvidence: true,
    });
    const extractionReport = writeJson(tmpDir, "extraction-report.json", {
      target: "owner-decision-response-completion-extract",
      status: "owner-response-individual-files-created",
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      summary: {
        completionAccepted: true,
        requestedItemCount: 1,
        extractedFileCount: 1,
        skippedItemCount: 0,
        invalidCommandCount: 0,
        releaseReady: false,
      },
      extractedResponses: [
        {
          rank: 1,
          decisionId: "app-auth-provider-production-selector",
          individualResponseFileName: "01-app-auth-provider-production-selector-owner-response.json",
          ownerResponseValidationCommand: [
            "node scripts/owner-decision-app-auth-response-validation.mjs",
            `--owner-response-template ${appTemplate}`,
            `--owner-response ${appResponse}`,
          ].join(" "),
        },
      ],
      skippedItems: [],
      blockedReasons: [],
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-response-postvalidation-suite.mjs",
      "--extraction-report",
      extractionReport,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("owner-response-postvalidation-rejected");
    expect(body.summary).toEqual(
      expect.objectContaining({
        executedValidationCount: 1,
        acceptedValidationCount: 0,
        rejectedValidationCount: 1,
        unsafeFindingTotal: 1,
        safetyAttentionCount: 1,
      }),
    );
    expect(body.blockedReasons).toContain("postvalidation-unsafe-findings");
    expect(body.validationResults[0]).toEqual(
      expect.objectContaining({
        decisionId: "app-auth-provider-production-selector",
        status: "owner-response-rejected",
        unsafeFindingCount: 1,
      }),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("https://private-release.example.test");
    expect(output).not.toContain("app-auth-env-source-label");
  });

  it("renders none-recorded for missing validator file names in markdown", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-postvalidation-missing-files-"));
    const extractionReport = writeJson(tmpDir, "extraction-report.json", {
      target: "owner-decision-response-completion-extract",
      status: "owner-response-individual-files-created",
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      summary: {
        completionAccepted: true,
        requestedItemCount: 1,
        extractedFileCount: 1,
        skippedItemCount: 0,
        invalidCommandCount: 0,
        releaseReady: false,
      },
      extractedResponses: [
        {
          rank: 1,
          decisionId: "app-auth-provider-production-selector",
          individualResponseFileName: "01-app-auth-provider-production-selector-owner-response.json",
          ownerResponseValidationCommand: "not-a-valid-validation-command",
        },
      ],
      skippedItems: [],
      blockedReasons: [],
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-response-postvalidation-suite.mjs",
      "--extraction-report",
      extractionReport,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("| `1` | `app-auth-provider-production-selector` | `validator-execution-failed` | `none-recorded` | `none-recorded` | `none-recorded` |");
    expect(output).not.toContain("`none`");
    expect(output).not.toContain(tmpDir);
  });
});

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}
