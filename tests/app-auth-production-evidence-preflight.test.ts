import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("app auth production evidence preflight", () => {
  it("turns an accepted owner response into a redacted S19/S22 evidence preflight", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-app-auth-evidence-preflight-"));
    const ownerResponseValidation = writeJson(tmpDir, "owner-response-validation.json", {
      target: "owner-decision-app-auth-response-validation",
      status: "owner-response-accepted",
      summary: {
        missingFieldCount: 0,
        unsafeFindingCount: 0,
        providerModeAccepted: true,
        s19DryRunMayProceed: true,
        s22ReadinessMayProceed: true,
        releaseReady: false,
      },
      redactedOwnerResponse: {
        ownerApprovedProviderMode: "trusted-account-provider",
        approvedServerOnlyEnvSourceLabel: "UAIS-production-app-auth-env-source",
        approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
      },
      postValidationAllowedChecks: [
        "prepare-s19-app-auth-env-sync-dry-run",
        "prepare-app-auth-readiness-command-after-env-sync-evidence",
      ],
      stillForbiddenUntilSeparateApproval: ["run-vercel-env-apply"],
    });
    const firstBlocker = writeJson(tmpDir, "first-blocker.json", {
      target: "owner-decision-first-blocker-request",
      status: "owner-action-required",
      firstOwnerAction: {
        decisionId: "app-auth-provider-production-selector",
        queueStatus: "accepted",
        currentStatus: "accepted-awaiting-production-evidence",
        validationStatus: "owner-response-accepted",
        missingFieldCount: 0,
      },
      ownerRequest: {
        id: "app-auth-provider-production-selector",
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
      },
    });
    const actionPacket = writeJson(tmpDir, "action-packet.json", {
      target: "app-auth-owner-action-packet",
      decisionId: "app-auth-provider-production-selector",
      safeNextActions: [
        "bind-server-only-app-auth-env-through-s19-vercel-env-sync",
        "run-approved-app-auth-provider-readiness-after-env-sync",
      ],
      safeCommandTemplates: {
        vercelEnvSyncDryRun:
          "node scripts/vercel-env-sync.mjs --dry-run --scope full --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <vercel-env-sync-dry-run-evidence>",
        appAuthReadiness:
          "node scripts/app-auth-provider-readiness.mjs --live --approved --environment production --env-file <approved-env-file> --release-run-id <release-run-id> --vercel-env-sync <vercel-env-sync-evidence> > <app-auth-provider-readiness-evidence>",
      },
      forbiddenUntilApproved: ["run-live-app-auth-provider-network-call"],
    });

    const output = execFileSync("node", [
      "scripts/app-auth-production-evidence-preflight.mjs",
      "--owner-response-validation",
      ownerResponseValidation,
      "--first-blocker",
      firstBlocker,
      "--app-auth-action-packet",
      actionPacket,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "app-auth-production-evidence-preflight",
        status: "app-auth-production-evidence-preflight-ready",
        releaseReady: false,
      }),
    );
    expect(body.summary).toEqual({
      ownerResponseAccepted: true,
      firstBlockerAcceptedAwaitingEvidence: true,
      s19DryRunMayProceed: true,
      s22ReadinessMayProceedAfterEnvSync: true,
      requiredServerOnlyEnvNameCount: 4,
      missingEvidenceCount: 3,
      commandTemplateCount: 2,
      releaseReady: false,
    });
    expect(body.requiredServerOnlyEnvNames).toEqual([
      "UAIS_APP_SESSION_SIGNING_SECRET",
      "UAIS_APP_AUTH_PROVIDER",
      "UAIS_APP_AUTH_PROVIDER_URL",
      "UAIS_APP_AUTH_PROVIDER_TOKEN",
    ]);
    expect(body.blockedReasons).toEqual([
      "vercel-env-sync-evidence-with-app-auth-env-present-missing",
      "app-auth-provider-readiness-production-live-ready-missing",
      "same-release-run-id-bound-to-app-auth-readiness-missing",
    ]);
    expect(body.safeCommandTemplates).toEqual(
      expect.objectContaining({
        vercelEnvSyncDryRun:
          "node scripts/vercel-env-sync.mjs --dry-run --scope full --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <vercel-env-sync-dry-run-evidence>",
      }),
    );
    expect(body.safety).toEqual(
      expect.objectContaining({
        envFileRead: false,
        credentialValuesOmitted: true,
        noLiveMutationPerformed: true,
        noEnvApplyPerformed: true,
      }),
    );

    const markdown = execFileSync("node", [
      "scripts/app-auth-production-evidence-preflight.mjs",
      "--owner-response-validation",
      ownerResponseValidation,
      "--first-blocker",
      firstBlocker,
      "--app-auth-action-packet",
      actionPacket,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(markdown).toContain("# UAIS App Auth Production Evidence Preflight");
    expect(markdown).toContain("Status: `app-auth-production-evidence-preflight-ready`");
    expect(markdown).toContain("## Safe Command Templates");
    expect(markdown).not.toContain("UAIS-production-app-auth-env-source");
    expect(markdown).not.toContain("UAIS-enterprise-run-2026-07-XX");
  });

  it("stays blocked when the owner response is not accepted", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-app-auth-evidence-preflight-blocked-"));
    const ownerResponseValidation = writeJson(tmpDir, "owner-response-validation.json", {
      status: "owner-response-incomplete",
      summary: {
        s19DryRunMayProceed: false,
        s22ReadinessMayProceed: false,
      },
    });
    const firstBlocker = writeJson(tmpDir, "first-blocker.json", {
      firstOwnerAction: {
        decisionId: "app-auth-provider-production-selector",
        currentStatus: "owner-decision-needed",
      },
    });
    const actionPacket = writeJson(tmpDir, "action-packet.json", {
      decisionId: "app-auth-provider-production-selector",
    });

    const output = execFileSync("node", [
      "scripts/app-auth-production-evidence-preflight.mjs",
      "--owner-response-validation",
      ownerResponseValidation,
      "--first-blocker",
      firstBlocker,
      "--app-auth-action-packet",
      actionPacket,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("app-auth-production-evidence-preflight-blocked");
    expect(body.blockedReasons).toContain("app-auth-owner-response-not-accepted");
    expect(body.blockedReasons).toContain("first-blocker-not-accepted-awaiting-production-evidence");
    expect(body.summary.releaseReady).toBe(false);
  });
});

function writeJson(dir: string, name: string, value: unknown) {
  execFileSync("mkdir", ["-p", dir]);
  const filePath = join(dir, name);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}
