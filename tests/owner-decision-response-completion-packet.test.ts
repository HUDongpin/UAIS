import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("owner decision response completion packet", () => {
  it("aggregates copy-safe stubs and remaining owner label gaps without leaking source evidence", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-response-completion-packet-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    writeJson(reportsDir, "app-template.json", {
      target: "owner-decision-app-auth-response-template",
      decisionId: "app-auth-provider-production-selector",
      copySafeOwnerReplyStub: {
        responseStatus: "owner-response-provided",
        decisionId: "app-auth-provider-production-selector",
        selectedProviderMode: "fallback-only",
        ownerApprovedProviderMode: "<choose approved production provider mode>",
        approvedServerOnlyEnvSourceLabel:
          "<label only; no URL, local path, cookie, or credential value>",
        approvedReleaseRunIdLabel: "<label only; no URL, token, or cookie>",
        confirmsNoRawUrlsLocalPathsCookiesOrCredentialValuesInResponse: true,
      },
      leakedPath: "/Users/example/private/source.json",
    });
    writeJson(reportsDir, "app-validation.json", {
      target: "owner-decision-app-auth-response-validation",
      decisionId: "app-auth-provider-production-selector",
      status: "owner-response-incomplete",
      summary: {
        ownerResponseStatus: "owner-response-provided",
        missingFieldCount: 3,
        unsafeFindingCount: 0,
        releaseReady: false,
      },
      blockedReasons: [
        "ownerApprovedProviderMode-missing-or-invalid",
        "approvedServerOnlyEnvSourceLabel-missing-or-invalid",
        "approvedReleaseRunIdLabel-missing-or-invalid",
        "provider-mode-not-accepted",
      ],
    });
    writeJson(reportsDir, "release-template.json", {
      target: "owner-decision-production-release-run-response-template",
      decisionId: "production-release-run",
      copySafeOwnerReplyStub: {
        responseStatus: "owner-response-provided",
        decisionId: "production-release-run",
        approvedFinalReleaseGateReadyEvidenceLabel:
          "<label only; no URL, local path, cookie, or credential value>",
        approvedSharedReleaseRunIdLabel: "<label only; no URL, token, or cookie>",
        approvedRollbackOrHoldPlanLabel:
          "<label only; no URL, local path, cookie, or credential value>",
        confirmsNoRawUrlsLocalPathsCookiesOrCredentialValuesInResponse: true,
        confirmsOwnerApprovesFinalReleaseRunBinding: true,
      },
      leakedUrl: "https://private-release.example.test/evidence",
    });
    writeJson(reportsDir, "release-validation.json", {
      target: "owner-decision-production-release-run-response-validation",
      decisionId: "production-release-run",
      status: "owner-response-incomplete",
      summary: {
        ownerResponseStatus: "owner-response-provided",
        missingFieldCount: 3,
        unsafeFindingCount: 0,
        releaseRunBindingPerformed: false,
        releaseReady: false,
      },
      blockedReasons: [
        "approvedFinalReleaseGateReadyEvidenceLabel-missing-or-invalid",
        "approvedSharedReleaseRunIdLabel-missing-or-invalid",
        "approvedRollbackOrHoldPlanLabel-missing-or-invalid",
      ],
    });
    const manifest = writeJson(tmpDir, "manifest.json", {
      target: "owner-decision-response-package-manifest",
      status: "response-package-manifest-created",
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      summary: {
        responsePackageCount: 2,
        unsafeFindingTotal: 0,
        releaseRunBindingPerformedCount: 0,
        releaseReady: false,
      },
      responsePackages: [
        {
          rank: 1,
          decisionId: "app-auth-provider-production-selector",
          category: "owner-decision",
          queueStatus: "owner-decision-needed",
          validationStatus: "owner-response-incomplete",
          templateFileName: "app-template.json",
          validationFileName: "app-validation.json",
          missingFieldCount: 3,
          unsafeFindingCount: 0,
        },
        {
          rank: 8,
          decisionId: "production-release-run",
          category: "final-release-binding",
          queueStatus: "waiting-for-upstream-evidence",
          validationStatus: "owner-response-incomplete",
          templateFileName: "release-template.json",
          validationFileName: "release-validation.json",
          missingFieldCount: 3,
          unsafeFindingCount: 0,
          releaseRunBindingPerformed: false,
        },
      ],
    });
    const gapMatrix = writeJson(tmpDir, "gap-matrix.json", {
      target: "owner-decision-response-gap-matrix",
      status: "owner-response-gaps-present",
      summary: {
        incompleteResponseCount: 2,
        missingFieldTotal: 6,
        unsafeFindingTotal: 0,
        releaseRunBindingPerformedCount: 0,
        firstActionableDecisionId: "app-auth-provider-production-selector",
        releaseReady: false,
      },
      gapRows: [
        {
          rank: 1,
          decisionId: "app-auth-provider-production-selector",
          nextOwnerQuestion: "Choose production app auth evidence labels.",
          missingFieldCount: 3,
          missingFields: [
            "ownerApprovedProviderMode-missing-or-invalid",
            "approvedServerOnlyEnvSourceLabel-missing-or-invalid",
            "approvedReleaseRunIdLabel-missing-or-invalid",
            "provider-mode-not-accepted",
          ],
          stillForbiddenUntilSeparateApproval: ["run-live-smoke-before-owner-approval"],
        },
        {
          rank: 8,
          decisionId: "production-release-run",
          nextOwnerQuestion: "Do not bind release-run ID until gate ready.",
          missingFieldCount: 3,
          missingFields: [
            "approvedFinalReleaseGateReadyEvidenceLabel-missing-or-invalid",
            "approvedSharedReleaseRunIdLabel-missing-or-invalid",
            "approvedRollbackOrHoldPlanLabel-missing-or-invalid",
          ],
          stillForbiddenUntilSeparateApproval: ["bind-release-run-id-while-release-gate-blocked"],
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-response-completion-packet.mjs",
      "--response-package-manifest",
      manifest,
      "--response-gap-matrix",
      gapMatrix,
      "--reports-dir",
      reportsDir,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "owner-decision-response-completion-packet",
        status: "owner-response-completion-required",
        releaseReady: false,
        releaseGateStatus: "blocked",
        ownerDecisionQueueStatus: "owner-decisions-required",
        firstActionableDecisionId: "app-auth-provider-production-selector",
      }),
    );
    expect(body.summary).toEqual({
      responsePackageCount: 2,
      incompleteResponseCount: 2,
      missingFieldTotal: 6,
      copySafeStubCount: 2,
      unsafeFindingTotal: 0,
      releaseRunBindingPerformedCount: 0,
      safetyAttentionCount: 0,
      releaseReady: false,
    });
    expect(body.ownerCompletionItems).toEqual([
      expect.objectContaining({
        rank: 1,
        decisionId: "app-auth-provider-production-selector",
        missingFieldCount: 3,
        requiredOwnerInputFields: [
          "ownerApprovedProviderMode",
          "approvedServerOnlyEnvSourceLabel",
          "approvedReleaseRunIdLabel",
        ],
        requiredOwnerLabelFields: [
          "approvedServerOnlyEnvSourceLabel",
          "approvedReleaseRunIdLabel",
        ],
        ownerResponseValidationCommand:
          "node scripts/owner-decision-app-auth-response-validation.mjs --owner-response-template coordination/reports/app-template.json --owner-response path/to/filled-owner-response.json",
        copySafeOwnerReplyStub: expect.objectContaining({
          responseStatus: "owner-response-provided",
          selectedProviderMode: "fallback-only",
        }),
      }),
      expect.objectContaining({
        rank: 8,
        decisionId: "production-release-run",
        missingFieldCount: 3,
        requiredOwnerLabelFields: [
          "approvedFinalReleaseGateReadyEvidenceLabel",
          "approvedSharedReleaseRunIdLabel",
          "approvedRollbackOrHoldPlanLabel",
        ],
        ownerResponseValidationCommand:
          "node scripts/owner-decision-production-release-run-response-validation.mjs --owner-response-template coordination/reports/release-template.json --owner-response path/to/filled-owner-response.json",
        copySafeOwnerReplyStub: expect.objectContaining({
          responseStatus: "owner-response-provided",
          decisionId: "production-release-run",
        }),
      }),
    ]);
    expect(body.safety).toEqual({
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      credentialValuesOmitted: true,
      responseBodiesOmitted: true,
      noLiveMutationPerformed: true,
      noDeploymentMutationPerformed: true,
      noReleaseRunBindingPerformed: true,
      ownerMustReplacePlaceholderLabels: true,
    });
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://private-release.example.test");
  });

  it("renders a Markdown owner completion packet without private evidence values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-response-completion-packet-md-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    writeJson(reportsDir, "template.json", {
      copySafeOwnerReplyStub: {
        responseStatus: "owner-response-provided",
        decisionId: "production-release-run",
        approvedSharedReleaseRunIdLabel: "<label only; no URL, token, or cookie>",
      },
    });
    writeJson(reportsDir, "validation.json", {
      target: "owner-decision-production-release-run-response-validation",
      summary: {
        ownerResponseStatus: "owner-response-provided",
        missingFieldCount: 1,
        unsafeFindingCount: 0,
      },
      blockedReasons: ["approvedSharedReleaseRunIdLabel-missing-or-invalid"],
    });
    const manifest = writeJson(tmpDir, "manifest.json", {
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      summary: {
        responsePackageCount: 1,
        unsafeFindingTotal: 0,
        releaseRunBindingPerformedCount: 0,
        releaseReady: false,
      },
      responsePackages: [
        {
          rank: 8,
          decisionId: "production-release-run",
          category: "final-release-binding",
          queueStatus: "waiting-for-upstream-evidence",
          validationStatus: "owner-response-incomplete",
          templateFileName: "template.json",
          validationFileName: "validation.json",
          missingFieldCount: 1,
          unsafeFindingCount: 0,
        },
      ],
    });
    const gapMatrix = writeJson(tmpDir, "gap-matrix.json", {
      summary: {
        incompleteResponseCount: 1,
        missingFieldTotal: 1,
        unsafeFindingTotal: 0,
        releaseRunBindingPerformedCount: 0,
        firstActionableDecisionId: "production-release-run",
        releaseReady: false,
      },
      gapRows: [
        {
          rank: 8,
          decisionId: "production-release-run",
          nextOwnerQuestion: "Do not bind release-run ID until gate ready.",
          missingFieldCount: 1,
          missingFields: ["approvedSharedReleaseRunIdLabel-missing-or-invalid"],
          stillForbiddenUntilSeparateApproval: ["bind-release-run-id-while-release-gate-blocked"],
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-response-completion-packet.mjs",
      "--response-package-manifest",
      manifest,
      "--response-gap-matrix",
      gapMatrix,
      "--reports-dir",
      reportsDir,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("# UAIS Owner Decision Response Completion Packet");
    expect(output).toContain("Missing owner fields: 1");
    expect(output).toContain("## Copy-Safe Owner Reply Stubs");
    expect(output).toContain("approvedSharedReleaseRunIdLabel");
    expect(output).toContain("Validation command:");
    expect(output).toContain(
      "node scripts/owner-decision-production-release-run-response-validation.mjs --owner-response-template coordination/reports/template.json --owner-response path/to/filled-owner-response.json",
    );
    expect(output).toContain("Still forbidden until separate approval:");
    expect(output).toContain("- `bind-release-run-id-while-release-gate-blocked`");
    expect(output).toContain("Post-validation allowed checks:");
    expect(output).toContain("- `none-recorded`");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://");
  });

  it("renders a missing first actionable decision as none-recorded in Markdown", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-response-completion-packet-empty-decision-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const manifest = writeJson(tmpDir, "manifest.json", {
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      summary: {
        responsePackageCount: 0,
        unsafeFindingTotal: 0,
        releaseRunBindingPerformedCount: 0,
        releaseReady: false,
      },
      responsePackages: [],
    });
    const gapMatrix = writeJson(tmpDir, "gap-matrix.json", {
      summary: {
        incompleteResponseCount: 0,
        missingFieldTotal: 0,
        unsafeFindingTotal: 0,
        releaseRunBindingPerformedCount: 0,
        releaseReady: false,
      },
      gapRows: [],
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-response-completion-packet.mjs",
      "--response-package-manifest",
      manifest,
      "--response-gap-matrix",
      gapMatrix,
      "--reports-dir",
      reportsDir,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("First actionable decision: `none-recorded`");
    expect(output).not.toContain("First actionable decision: `none`");
  });

  it("keeps the completion packet in safety review when upstream response evidence is unsafe", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-response-completion-packet-safety-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    writeJson(reportsDir, "template.json", {
      target: "owner-decision-production-release-run-response-template",
      decisionId: "production-release-run",
      copySafeOwnerReplyStub: {
        responseStatus: "owner-response-provided",
        decisionId: "production-release-run",
        approvedSharedReleaseRunIdLabel: "redacted-shared-release-run",
        confirmsNoRawUrlsLocalPathsCookiesOrCredentialValuesInResponse: true,
      },
    });
    writeJson(reportsDir, "validation.json", {
      target: "owner-decision-production-release-run-response-validation",
      decisionId: "production-release-run",
      status: "owner-response-accepted",
      summary: {
        ownerResponseStatus: "owner-response-provided",
        missingFieldCount: 0,
        unsafeFindingCount: 2,
        releaseRunBindingPerformed: true,
        releaseReady: false,
      },
      blockedReasons: [],
    });
    const manifest = writeJson(tmpDir, "manifest.json", {
      status: "response-package-manifest-needs-safety-review",
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      summary: {
        responsePackageCount: 1,
        unsafeFindingTotal: 2,
        releaseRunBindingPerformedCount: 1,
        safetyAttentionCount: 3,
        releaseReady: false,
      },
      responsePackages: [
        {
          rank: 8,
          decisionId: "production-release-run",
          category: "final-release-binding",
          queueStatus: "waiting-for-upstream-evidence",
          validationStatus: "owner-response-accepted",
          templateFileName: "template.json",
          validationFileName: "validation.json",
          missingFieldCount: 0,
          unsafeFindingCount: 2,
          releaseRunBindingPerformed: true,
        },
      ],
    });
    const gapMatrix = writeJson(tmpDir, "gap-matrix.json", {
      status: "owner-response-gaps-need-safety-review",
      summary: {
        incompleteResponseCount: 0,
        missingFieldTotal: 0,
        unsafeFindingTotal: 2,
        releaseRunBindingPerformedCount: 1,
        safetyAttentionCount: 3,
        firstActionableDecisionId: "production-release-run",
        releaseReady: false,
      },
      gapRows: [
        {
          rank: 8,
          decisionId: "production-release-run",
          nextOwnerQuestion: "Safety review required before any release-run binding.",
          validationStatus: "owner-response-accepted",
          missingFieldCount: 0,
          missingFields: [],
          releaseRunBindingPerformed: true,
          stillForbiddenUntilSeparateApproval: ["bind-release-run-id-while-release-gate-blocked"],
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-response-completion-packet.mjs",
      "--response-package-manifest",
      manifest,
      "--response-gap-matrix",
      gapMatrix,
      "--reports-dir",
      reportsDir,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("owner-response-completion-needs-safety-review");
    expect(body.summary.incompleteResponseCount).toBe(0);
    expect(body.summary.unsafeFindingTotal).toBe(2);
    expect(body.summary.releaseRunBindingPerformedCount).toBe(1);
    expect(body.summary.safetyAttentionCount).toBe(3);
    expect(body.safety.noReleaseRunBindingPerformed).toBe(false);
  });

  it("does not mark completion release-ready from a ready manifest while owner fields remain incomplete", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-response-completion-packet-ready-mismatch-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    writeJson(reportsDir, "template.json", {
      target: "owner-decision-app-auth-response-template",
      decisionId: "app-auth-provider-production-selector",
      copySafeOwnerReplyStub: {
        responseStatus: "owner-response-provided",
        decisionId: "app-auth-provider-production-selector",
        approvedServerOnlyEnvSourceLabel: "<label only; no credential values>",
      },
    });
    writeJson(reportsDir, "validation.json", {
      target: "owner-decision-app-auth-response-validation",
      decisionId: "app-auth-provider-production-selector",
      status: "owner-response-incomplete",
      summary: {
        ownerResponseStatus: "owner-response-provided",
        missingFieldCount: 1,
        unsafeFindingCount: 0,
        releaseReady: false,
      },
      blockedReasons: ["approvedReleaseRunIdLabel-missing-or-invalid"],
    });
    const manifest = writeJson(tmpDir, "manifest.json", {
      status: "response-package-manifest-created",
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      summary: {
        responsePackageCount: 1,
        unsafeFindingTotal: 0,
        releaseRunBindingPerformedCount: 0,
        releaseReady: true,
      },
      responsePackages: [
        {
          rank: 1,
          decisionId: "app-auth-provider-production-selector",
          category: "owner-decision",
          queueStatus: "owner-decision-needed",
          validationStatus: "owner-response-incomplete",
          templateFileName: "template.json",
          validationFileName: "validation.json",
          missingFieldCount: 1,
          unsafeFindingCount: 0,
        },
      ],
    });
    const gapMatrix = writeJson(tmpDir, "gap-matrix.json", {
      status: "owner-response-gaps-present",
      summary: {
        incompleteResponseCount: 1,
        missingFieldTotal: 1,
        unsafeFindingTotal: 0,
        releaseRunBindingPerformedCount: 0,
        firstActionableDecisionId: "app-auth-provider-production-selector",
        releaseReady: false,
      },
      gapRows: [
        {
          rank: 1,
          decisionId: "app-auth-provider-production-selector",
          nextOwnerQuestion: "Confirm app auth labels.",
          missingFieldCount: 1,
          missingFields: ["approvedReleaseRunIdLabel-missing-or-invalid"],
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-response-completion-packet.mjs",
      "--response-package-manifest",
      manifest,
      "--response-gap-matrix",
      gapMatrix,
      "--reports-dir",
      reportsDir,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("owner-response-completion-required");
    expect(body.summary.incompleteResponseCount).toBe(1);
    expect(body.summary.releaseReady).toBe(false);
    expect(body.ownerCompletionItems[0]).toEqual(
      expect.objectContaining({
        decisionId: "app-auth-provider-production-selector",
        validationStatus: "owner-response-incomplete",
        releaseReady: false,
      }),
    );
  });

  it("does not mark completion release-ready while the owner decision queue is still waiting", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-response-completion-packet-queue-waiting-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    writeJson(reportsDir, "template.json", {
      target: "owner-decision-app-auth-response-template",
      decisionId: "app-auth-provider-production-selector",
      copySafeOwnerReplyStub: {
        responseStatus: "owner-response-provided",
        decisionId: "app-auth-provider-production-selector",
        approvedServerOnlyEnvSourceLabel: "redacted-app-auth-env-source",
      },
    });
    writeJson(reportsDir, "validation.json", {
      target: "owner-decision-app-auth-response-validation",
      decisionId: "app-auth-provider-production-selector",
      status: "owner-response-accepted",
      summary: {
        ownerResponseStatus: "owner-response-provided",
        missingFieldCount: 0,
        unsafeFindingCount: 0,
        releaseReady: true,
      },
      blockedReasons: [],
    });
    const manifest = writeJson(tmpDir, "manifest.json", {
      status: "response-package-manifest-created",
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      summary: {
        responsePackageCount: 1,
        unsafeFindingTotal: 0,
        releaseRunBindingPerformedCount: 0,
        releaseReady: true,
      },
      responsePackages: [
        {
          rank: 1,
          decisionId: "app-auth-provider-production-selector",
          category: "owner-decision",
          queueStatus: "owner-decision-needed",
          validationStatus: "owner-response-accepted",
          templateFileName: "template.json",
          validationFileName: "validation.json",
          missingFieldCount: 0,
          unsafeFindingCount: 0,
          releaseReady: true,
        },
      ],
    });
    const gapMatrix = writeJson(tmpDir, "gap-matrix.json", {
      status: "owner-response-gaps-clear",
      ownerDecisionQueueStatus: "owner-decisions-required",
      summary: {
        incompleteResponseCount: 0,
        missingFieldTotal: 0,
        unsafeFindingTotal: 0,
        releaseRunBindingPerformedCount: 0,
        firstActionableDecisionId: null,
        releaseReady: true,
      },
      gapRows: [
        {
          rank: 1,
          decisionId: "app-auth-provider-production-selector",
          nextOwnerQuestion: "Confirm app auth labels.",
          validationStatus: "owner-response-accepted",
          missingFieldCount: 0,
          missingFields: [],
          releaseReady: true,
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-response-completion-packet.mjs",
      "--response-package-manifest",
      manifest,
      "--response-gap-matrix",
      gapMatrix,
      "--reports-dir",
      reportsDir,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.ownerDecisionQueueStatus).toBe("owner-decisions-required");
    expect(body.ownerCompletionItems[0]).toEqual(
      expect.objectContaining({
        decisionId: "app-auth-provider-production-selector",
        validationStatus: "owner-response-accepted",
        releaseReady: true,
      }),
    );
    expect(body.summary.releaseReady).toBe(false);
  });

  it("prefers current owner queue status from the gap matrix while preserving source queue provenance", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-response-completion-packet-status-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    writeJson(reportsDir, "template.json", {
      target: "owner-decision-app-auth-response-template",
      copySafeOwnerReplyStub: {
        responseStatus: "owner-response-provided",
        decisionId: "app-auth-provider-production-selector",
      },
    });
    writeJson(reportsDir, "validation.json", {
      target: "owner-decision-app-auth-response-validation",
      status: "owner-response-accepted",
      summary: {
        ownerResponseStatus: "owner-response-provided",
        missingFieldCount: 0,
        unsafeFindingCount: 0,
        releaseReady: false,
      },
      blockedReasons: [],
    });
    const manifest = writeJson(tmpDir, "manifest.json", {
      target: "owner-decision-response-package-manifest",
      status: "response-package-manifest-created",
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      summary: {
        responsePackageCount: 1,
        unsafeFindingTotal: 0,
        releaseRunBindingPerformedCount: 0,
        releaseReady: false,
      },
      responsePackages: [
        {
          rank: 1,
          decisionId: "app-auth-provider-production-selector",
          category: "owner-decision",
          queueStatus: "owner-decision-needed",
          validationStatus: "owner-response-accepted",
          templateFileName: "template.json",
          validationFileName: "validation.json",
          missingFieldCount: 0,
          unsafeFindingCount: 0,
          releaseReady: false,
        },
      ],
    });
    const gapMatrix = writeJson(tmpDir, "gap-matrix.json", {
      target: "owner-decision-response-gap-matrix",
      status: "owner-response-gaps-present",
      ownerDecisionQueueStatus: "owner-decisions-cleared-awaiting-production-evidence",
      sourceOwnerDecisionQueueStatus: "owner-decisions-required",
      summary: {
        incompleteResponseCount: 0,
        missingFieldTotal: 0,
        unsafeFindingTotal: 0,
        releaseRunBindingPerformedCount: 0,
        firstActionableDecisionId: null,
        productionEvidenceRequired: true,
        releaseReady: false,
      },
      gapRows: [
        {
          rank: 1,
          decisionId: "app-auth-provider-production-selector",
          validationStatus: "owner-response-accepted",
          missingFieldCount: 0,
          missingFields: [],
          releaseReady: false,
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-response-completion-packet.mjs",
      "--response-package-manifest",
      manifest,
      "--response-gap-matrix",
      gapMatrix,
      "--reports-dir",
      reportsDir,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.ownerDecisionQueueStatus).toBe(
      "owner-decisions-cleared-awaiting-production-evidence",
    );
    expect(body.sourceOwnerDecisionQueueStatus).toBe("owner-decisions-required");
    expect(body.productionEvidenceRequired).toBe(true);
    expect(body.summary.releaseReady).toBe(false);
  });
});

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}
