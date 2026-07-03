import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("owner decision app auth response template", () => {
  it("builds a redacted owner response template for the app-auth first blocker", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-app-auth-response-template-"));
    const firstBlockerRequest = writeJson(tmpDir, "first-blocker.json", {
      target: "owner-decision-first-blocker-request",
      status: "owner-action-required",
      firstBlockedStageId: "app-auth-provider-production-selector",
      summary: {
        approvalGateStatus: "approval-gate-blocked",
        stageCount: 10,
        blockedStageCount: 10,
        acceptedLiveEvidence: 0,
        missingEnterpriseLiveTargetCount: 16,
        releaseReady: false,
      },
      ownerRequest: {
        id: "app-auth-provider-production-selector",
        queueRank: 1,
        queueStatus: "owner-decision-needed",
        currentStatus: "owner-decision-needed",
        ownerInputRequired: "Confirm production app auth provider mode and approved server-only env source.",
        requiredServerOnlyEnvNames: [
          "UAIS_APP_SESSION_SIGNING_SECRET",
          "UAIS_APP_AUTH_PROVIDER",
          "UAIS_APP_AUTH_PROVIDER_URL",
          "UAIS_APP_AUTH_PROVIDER_TOKEN",
        ],
        requiredEvidence: [
          "vercel-env-sync-evidence-with-app-auth-env-present",
          "app-auth-provider-readiness-production-live-ready",
          "same-release-run-id-bound-to-app-auth-readiness",
        ],
        safeNextActions: [
          "confirm-production-app-auth-provider-mode",
          "bind-server-only-app-auth-env-through-s19-vercel-env-sync",
        ],
        forbiddenUntilApproved: [
          "inspect-or-print-app-auth-credential-values",
          "run-live-app-auth-provider-network-call",
        ],
      },
      leakedPath: "/Users/example/private/first-blocker.json",
      leakedUrl: "https://private-app-auth.example.test",
    });
    const actionPacket = writeJson(tmpDir, "app-auth-action-packet.json", {
      target: "app-auth-owner-action-packet",
      status: "owner-decision-needed",
      decisionId: "app-auth-provider-production-selector",
      acceptedOptions: ["trusted-account-provider"],
      requiredEnvNames: [
        "UAIS_APP_SESSION_SIGNING_SECRET",
        "UAIS_APP_AUTH_PROVIDER",
        "UAIS_APP_AUTH_PROVIDER_URL",
        "UAIS_APP_AUTH_PROVIDER_TOKEN",
      ],
      currentEvidenceSummary: {
        evidenceStatus: "dry-run-blocked",
        appAuthProviderMode: "trusted-account-provider",
        vercelEnvSyncStatus: "missing",
        releaseRunIdStatus: "missing",
      },
      requiredEvidence: [
        "vercel-env-sync-evidence-with-app-auth-env-present",
        "app-auth-provider-readiness-production-live-ready",
      ],
      leakedCookie: "uais_teacher_auth_claims=secret",
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-app-auth-response-template.mjs",
      "--first-blocker-request",
      firstBlockerRequest,
      "--app-auth-action-packet",
      actionPacket,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "owner-decision-app-auth-response-template",
        status: "awaiting-owner-response",
        decisionId: "app-auth-provider-production-selector",
        responsibleSession: "S22/S19/S10",
        summary: {
          firstBlockedStageId: "app-auth-provider-production-selector",
          queueStatus: "owner-decision-needed",
          actionPacketStatus: "owner-decision-needed",
          acceptedLiveEvidence: 0,
          missingEnterpriseLiveTargetCount: 16,
          releaseReady: false,
        },
        safety: {
          sourcePathsOmitted: true,
          rawUrlsOmitted: true,
          credentialValuesOmitted: true,
          cookieValuesOmitted: true,
          responseBodiesOmitted: true,
          noEnvValuesRequested: true,
          noLiveMutationPerformed: true,
          noDeploymentMutationPerformed: true,
          noEnvApplyPerformed: true,
          noReleaseRunBindingPerformed: true,
        },
      }),
    );
    expect(body.ownerResponseTemplate).toEqual(
      expect.objectContaining({
        responseStatus: "owner-response-required",
        ownerApprovedProviderMode: null,
        approvedServerOnlyEnvSourceLabel: null,
        approvedReleaseRunIdLabel: null,
        confirmsNoCredentialValuesInResponse: false,
      }),
    );
    expect(body.ownerResponseTemplate.allowedProviderModes).toEqual(["trusted-account-provider"]);
    expect(body.ownerResponseTemplate.requiredServerOnlyEnvNames).toEqual([
      "UAIS_APP_SESSION_SIGNING_SECRET",
      "UAIS_APP_AUTH_PROVIDER",
      "UAIS_APP_AUTH_PROVIDER_URL",
      "UAIS_APP_AUTH_PROVIDER_TOKEN",
    ]);
    expect(body.copySafeOwnerReplyStub).toEqual({
      responseStatus: "owner-response-provided",
      decisionId: "app-auth-provider-production-selector",
      ownerApprovedProviderMode: "trusted-account-provider",
      approvedServerOnlyEnvSourceLabel: "<label only; no credential values>",
      approvedReleaseRunIdLabel: "<label only; no URL, token, or cookie>",
      confirmsNoCredentialValuesInResponse: true,
      confirmsS19MayPrepareAppAuthEnvSyncDryRun: true,
      confirmsS22MayPrepareAppAuthReadinessAfterEnvSyncEvidence: true,
    });
    expect(body.ownerResponseValidationCommand).toBe(
      "node scripts/owner-decision-app-auth-response-validation.mjs --owner-response-template coordination/reports/<this-template-json> --owner-response path/to/filled-owner-response.json",
    );
    expect(body.postResponseAllowedChecks).toContain("validate-owner-response-shape");
    expect(body.stillForbiddenUntilSeparateApproval).toContain("run-live-app-auth-provider-network-call");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://private-app-auth.example.test");
    expect(output).not.toContain("uais_teacher_auth_claims=secret");
  });

  it("blocks template generation when app auth is not the first blocker", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-app-auth-response-template-blocked-"));
    const firstBlockerRequest = writeJson(tmpDir, "first-blocker.json", {
      status: "owner-action-required",
      firstBlockedStageId: "teacher-auth-provider-production-selector",
      summary: {
        acceptedLiveEvidence: 0,
        missingEnterpriseLiveTargetCount: 16,
        releaseReady: false,
      },
      ownerRequest: {
        id: "teacher-auth-provider-production-selector",
        queueStatus: "owner-decision-needed",
        currentStatus: "owner-decision-needed",
      },
    });
    const actionPacket = writeJson(tmpDir, "app-auth-action-packet.json", {
      decisionId: "app-auth-provider-production-selector",
      status: "owner-decision-needed",
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-app-auth-response-template.mjs",
      "--first-blocker-request",
      firstBlockerRequest,
      "--app-auth-action-packet",
      actionPacket,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("not-current-first-blocker");
    expect(body.ownerResponseTemplate).toBeNull();
    expect(body.summary.firstBlockedStageId).toBe("teacher-auth-provider-production-selector");
    expect(body.summary.releaseReady).toBe(false);
  });

  it("keeps releaseReady false while the app auth owner response is still required", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-app-auth-response-template-ready-guard-"));
    const firstBlockerRequest = writeJson(tmpDir, "first-blocker.json", {
      status: "owner-action-required",
      firstBlockedStageId: "app-auth-provider-production-selector",
      summary: {
        acceptedLiveEvidence: 16,
        missingEnterpriseLiveTargetCount: 0,
        releaseReady: true,
      },
      ownerRequest: {
        id: "app-auth-provider-production-selector",
        queueStatus: "owner-decision-needed",
        currentStatus: "owner-decision-needed",
        ownerInputRequired: "Confirm production app auth provider mode and approved server-only env source.",
      },
    });
    const actionPacket = writeJson(tmpDir, "app-auth-action-packet.json", {
      decisionId: "app-auth-provider-production-selector",
      status: "owner-decision-needed",
      acceptedOptions: ["trusted-account-provider"],
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-app-auth-response-template.mjs",
      "--first-blocker-request",
      firstBlockerRequest,
      "--app-auth-action-packet",
      actionPacket,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("awaiting-owner-response");
    expect(body.ownerResponseTemplate.responseStatus).toBe("owner-response-required");
    expect(body.summary.releaseReady).toBe(false);
  });

  it("renders a missing first blocked stage as none-recorded in Markdown", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-app-auth-response-template-empty-stage-"));
    const firstBlockerRequest = writeJson(tmpDir, "first-blocker.json", {
      status: "owner-action-required",
      summary: {
        acceptedLiveEvidence: 0,
        missingEnterpriseLiveTargetCount: 16,
        releaseReady: false,
      },
      ownerRequest: {
        queueStatus: "owner-decision-needed",
      },
    });
    const actionPacket = writeJson(tmpDir, "app-auth-action-packet.json", {
      decisionId: "app-auth-provider-production-selector",
      status: "owner-decision-needed",
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-app-auth-response-template.mjs",
      "--first-blocker-request",
      firstBlockerRequest,
      "--app-auth-action-packet",
      actionPacket,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("First blocked stage: `none-recorded`");
    expect(output).not.toContain("First blocked stage: `none`");
  });

  it("renders a markdown owner response template without credential fields", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-app-auth-response-template-md-"));
    const firstBlockerRequest = writeJson(tmpDir, "first-blocker.json", {
      status: "owner-action-required",
      firstBlockedStageId: "app-auth-provider-production-selector",
      summary: {
        acceptedLiveEvidence: 0,
        missingEnterpriseLiveTargetCount: 16,
        releaseReady: false,
      },
      ownerRequest: {
        id: "app-auth-provider-production-selector",
        queueStatus: "owner-decision-needed",
        currentStatus: "owner-decision-needed",
        ownerInputRequired: "Confirm production app auth provider mode and approved server-only env source.",
        requiredServerOnlyEnvNames: ["UAIS_APP_AUTH_PROVIDER"],
        requiredEvidence: ["app-auth-provider-readiness-production-live-ready"],
      },
    });
    const actionPacket = writeJson(tmpDir, "app-auth-action-packet.json", {
      decisionId: "app-auth-provider-production-selector",
      status: "owner-decision-needed",
      acceptedOptions: ["trusted-account-provider"],
      requiredEnvNames: ["UAIS_APP_AUTH_PROVIDER"],
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-app-auth-response-template.mjs",
      "--first-blocker-request",
      firstBlockerRequest,
      "--app-auth-action-packet",
      actionPacket,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("# UAIS App Auth Owner Response Template");
    expect(output).toContain("Status: `awaiting-owner-response`");
    expect(output).toContain("Confirm production app auth provider mode and approved server-only env source.");
    expect(output).toContain("Do not include credential values.");
    expect(output).toContain("## Copy-Safe Owner Reply Stub");
    expect(output).toContain('"ownerApprovedProviderMode": "trusted-account-provider"');
    expect(output).toContain('"approvedServerOnlyEnvSourceLabel": "<label only; no credential values>"');
    expect(output).toContain('"confirmsNoCredentialValuesInResponse": true');
    expect(output).toContain('"confirmsS19MayPrepareAppAuthEnvSyncDryRun": true');
    expect(output).toContain('"confirmsS22MayPrepareAppAuthReadinessAfterEnvSyncEvidence": true');
    expect(output).toContain("## Validation Command");
    expect(output).toContain(
      "node scripts/owner-decision-app-auth-response-validation.mjs --owner-response-template coordination/reports/<this-template-json> --owner-response path/to/filled-owner-response.json",
    );
    expect(output).toContain("`UAIS_APP_AUTH_PROVIDER`");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });
});

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}
