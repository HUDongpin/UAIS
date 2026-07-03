import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("owner decision response completion from responses", () => {
  it("consolidates accepted owner response files while preserving missing decisions as placeholders", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-completion-from-responses-"));
    const reportsDir = join(tmpDir, "reports");
    const completionPacket = writeJson(tmpDir, "completion-packet.json", {
      target: "owner-decision-response-completion-packet",
      status: "owner-response-completion-required",
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      ownerCompletionItems: [
        {
          rank: 1,
          decisionId: "app-auth-provider-production-selector",
          requiredOwnerInputFields: [
            "ownerApprovedProviderMode",
            "approvedServerOnlyEnvSourceLabel",
            "approvedReleaseRunIdLabel",
          ],
          copySafeOwnerReplyStub: {
            responseStatus: "owner-response-provided",
            decisionId: "app-auth-provider-production-selector",
            ownerApprovedProviderMode: "<trusted-account-provider>",
            approvedServerOnlyEnvSourceLabel: "<label only>",
            approvedReleaseRunIdLabel: "<release run label>",
            confirmsNoCredentialValuesInResponse: true,
          },
        },
        {
          rank: 2,
          decisionId: "ordinary-teaching-production-evidence",
          requiredOwnerInputFields: ["approvedTeachingOperationsRouteSmokeLabel"],
          copySafeOwnerReplyStub: {
            responseStatus: "owner-response-provided",
            decisionId: "ordinary-teaching-production-evidence",
            approvedTeachingOperationsRouteSmokeLabel: "<label only>",
            confirmsNoCredentialValuesInResponse: true,
          },
        },
      ],
    });
    writeJson(
      reportsDir,
      "2026-07-02-owner-response-app-auth-provider-production-selector-enterprise-runthrough.json",
      {
        responseStatus: "owner-response-provided",
        decisionId: "app-auth-provider-production-selector",
        ownerApprovedProviderMode: "trusted-account-provider",
        approvedServerOnlyEnvSourceLabel: "app-auth-env-source-label",
        approvedReleaseRunIdLabel: "app-auth-release-run-label",
        confirmsNoCredentialValuesInResponse: true,
      },
    );

    const output = execFileSync("node", [
      "scripts/owner-decision-response-completion-from-responses.mjs",
      "--completion-packet",
      completionPacket,
      "--reports-dir",
      reportsDir,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "owner-decision-response-completion-from-responses",
        status: "owner-response-completion-input-created",
        releaseReady: false,
        releaseGateStatus: "blocked",
        ownerDecisionQueueStatus: "owner-decisions-required",
      }),
    );
    expect(body.summary).toEqual({
      ownerCompletionItemCount: 2,
      foundOwnerResponseCount: 1,
      placeholderFallbackCount: 1,
      missingOwnerResponseCount: 1,
      releaseReady: false,
    });
    expect(body.ownerCompletionItems).toEqual([
      expect.objectContaining({
        decisionId: "app-auth-provider-production-selector",
        ownerResponseFileName:
          "2026-07-02-owner-response-app-auth-provider-production-selector-enterprise-runthrough.json",
        ownerResponse: expect.objectContaining({
          ownerApprovedProviderMode: "trusted-account-provider",
        }),
      }),
      expect.objectContaining({
        decisionId: "ordinary-teaching-production-evidence",
        ownerResponseFileName: null,
        copySafeOwnerReplyStub: expect.objectContaining({
          approvedTeachingOperationsRouteSmokeLabel: "<label only>",
        }),
      }),
    ]);

    const markdown = execFileSync("node", [
      "scripts/owner-decision-response-completion-from-responses.mjs",
      "--completion-packet",
      completionPacket,
      "--reports-dir",
      reportsDir,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(markdown).toContain("# UAIS Owner Response Completion From Responses");
    expect(markdown).toContain("Found owner responses: 1");
    expect(markdown).toContain("Placeholder fallbacks: 1");
    expect(markdown).toContain("app-auth-provider-production-selector");
    expect(markdown).toContain("ordinary-teaching-production-evidence");
    expect(markdown).not.toContain("app-auth-env-source-label");
    expect(markdown).not.toContain("app-auth-release-run-label");
  });

  it("uses the newest matching owner response file for a decision", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-completion-from-responses-newest-"));
    const reportsDir = join(tmpDir, "reports");
    const completionPacket = writeJson(tmpDir, "completion-packet.json", {
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-required",
      ownerCompletionItems: [
        {
          rank: 1,
          decisionId: "teacher-auth-provider-production-selector",
          requiredOwnerInputFields: ["ownerApprovedProviderMode"],
          copySafeOwnerReplyStub: {
            responseStatus: "owner-response-provided",
            decisionId: "teacher-auth-provider-production-selector",
            ownerApprovedProviderMode: "<mode>",
          },
        },
      ],
    });
    writeJson(
      reportsDir,
      "2026-07-01-owner-response-teacher-auth-provider-production-selector-enterprise-runthrough.json",
      {
        responseStatus: "owner-response-provided",
        decisionId: "teacher-auth-provider-production-selector",
        ownerApprovedProviderMode: "oidc-jwks",
      },
    );
    writeJson(
      reportsDir,
      "2026-07-02-owner-response-teacher-auth-provider-production-selector-enterprise-runthrough.json",
      {
        responseStatus: "owner-response-provided",
        decisionId: "teacher-auth-provider-production-selector",
        ownerApprovedProviderMode: "trusted-cookie-issuer",
      },
    );

    const output = execFileSync("node", [
      "scripts/owner-decision-response-completion-from-responses.mjs",
      "--completion-packet",
      completionPacket,
      "--reports-dir",
      reportsDir,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.summary.foundOwnerResponseCount).toBe(1);
    expect(body.ownerCompletionItems[0]).toEqual(
      expect.objectContaining({
        ownerResponseFileName:
          "2026-07-02-owner-response-teacher-auth-provider-production-selector-enterprise-runthrough.json",
        ownerResponse: expect.objectContaining({
          ownerApprovedProviderMode: "trusted-cookie-issuer",
        }),
      }),
    );
  });

  it("propagates current and source owner queue statuses from the completion packet", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-completion-from-responses-status-"));
    const reportsDir = join(tmpDir, "reports");
    execFileSync("mkdir", ["-p", reportsDir]);
    const completionPacket = writeJson(tmpDir, "completion-packet.json", {
      releaseGateStatus: "blocked",
      ownerDecisionQueueStatus: "owner-decisions-cleared-awaiting-production-evidence",
      sourceOwnerDecisionQueueStatus: "owner-decisions-required",
      ownerCompletionItems: [
        {
          rank: 1,
          decisionId: "app-auth-provider-production-selector",
          requiredOwnerInputFields: [],
          copySafeOwnerReplyStub: {
            responseStatus: "owner-response-provided",
            decisionId: "app-auth-provider-production-selector",
          },
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-response-completion-from-responses.mjs",
      "--completion-packet",
      completionPacket,
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
    expect(body.summary.releaseReady).toBe(false);
    expect(output).not.toContain(tmpDir);
  });
});

function writeJson(dir: string, name: string, value: unknown) {
  execFileSync("mkdir", ["-p", dir]);
  const filePath = join(dir, name);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}
