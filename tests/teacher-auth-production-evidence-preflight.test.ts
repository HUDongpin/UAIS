import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("teacher auth production evidence preflight", () => {
  it("turns an accepted trusted-cookie owner response into a redacted evidence preflight waiting on app auth", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-auth-evidence-preflight-"));
    const ownerResponseValidation = writeJson(tmpDir, "owner-response-validation.json", {
      target: "owner-decision-teacher-auth-response-validation",
      status: "owner-response-accepted",
      summary: {
        providerModeAccepted: true,
        s19DryRunMayProceed: true,
        s22ReadinessMayProceed: true,
        liveCookieIssuanceStillForbidden: true,
        releaseReady: false,
      },
      requiredServerOnlyEnvNamesForApprovedMode: [
        "UAIS_TEACHER_AUTH_PROVIDER",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET",
      ],
      redactedOwnerResponse: {
        ownerApprovedProviderMode: "trusted-cookie-issuer",
        approvedServerOnlyEnvSourceLabel: "UAIS-production-teacher-auth-env-source",
        approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
      },
      postValidationAllowedChecks: [
        "prepare-s19-teacher-auth-env-sync-dry-run-after-app-auth-clears",
        "prepare-teacher-auth-readiness-command-after-env-sync-evidence",
        "prepare-teacher-auth-issuer-route-smoke-after-production-deploy",
      ],
      stillForbiddenUntilSeparateApproval: [
        "issue-live-teacher-auth-cookie",
        "run-vercel-env-apply",
      ],
    });
    const approvalGate = writeJson(tmpDir, "approval-gate.json", {
      target: "owner-decision-live-run-approval-gate",
      status: "approval-gate-blocked",
      stages: [
        {
          id: "app-auth-provider-production-selector",
          queueStatus: "accepted",
          currentStatus: "accepted-awaiting-production-evidence",
          ownerResponseAccepted: true,
        },
        {
          id: "teacher-auth-provider-production-selector",
          queueStatus: "accepted",
          currentStatus: "accepted-awaiting-production-evidence",
          ownerResponseAccepted: true,
          requiredEvidence: [
            "vercel-env-sync-evidence-with-teacher-auth-env-present",
            "trusted-teacher-auth-route-chain-contract",
            "deployed-teacher-auth-issuer-route-smoke",
            "teacher-auth-provider-readiness-production-live-ready",
            "same-release-run-id-bound-to-teacher-auth-readiness",
          ],
        },
      ],
    });
    const actionPacket = writeJson(tmpDir, "action-packet.json", {
      target: "teacher-auth-owner-action-packet",
      decisionId: "teacher-auth-provider-production-selector",
      currentModeRequiredEnvNames: [
        "UAIS_TEACHER_AUTH_PROVIDER",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET",
      ],
      requiredEvidence: [
        "vercel-env-sync-evidence-with-teacher-auth-env-present",
        "trusted-teacher-auth-route-chain-contract",
        "deployed-teacher-auth-issuer-route-smoke",
        "teacher-auth-provider-readiness-production-live-ready",
        "same-release-run-id-bound-to-teacher-auth-readiness",
      ],
      currentEvidenceSummary: {
        trustedRouteChainStatus: "proved",
        vercelEnvSyncStatus: "missing",
        trustedRouteSmokeStatus: "missing",
        releaseRunIdStatus: "missing",
      },
      commands: {
        vercelEnvSyncDryRun:
          "node scripts/vercel-env-sync.mjs --dry-run --scope teacher-auth --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <teacher-auth-vercel-env-sync-dry-run-evidence>",
        teacherAuthReadinessLive:
          "node scripts/teacher-auth-provider-readiness.mjs --live --approved --environment production --env-file <approved-env-file> --release-run-id <release-run-id> --vercel-env-sync <teacher-auth-vercel-env-sync-evidence> --trusted-teacher-auth-route-chain <trusted-teacher-auth-route-chain-evidence> --route-smoke <teacher-auth-issuer-route-smoke-evidence> > <teacher-auth-provider-readiness-evidence>",
      },
      forbiddenUntilApproved: ["issue-live-teacher-auth-cookie"],
      safeNextActions: ["bind-server-only-teacher-auth-env-through-s19-vercel-env-sync"],
    });
    const appAuthPreflight = writeJson(tmpDir, "app-auth-preflight.json", {
      target: "app-auth-production-evidence-preflight",
      status: "app-auth-production-evidence-preflight-ready",
      releaseReady: false,
      summary: {
        missingEvidenceCount: 3,
        releaseReady: false,
      },
    });

    const output = execFileSync("node", [
      "scripts/teacher-auth-production-evidence-preflight.mjs",
      "--owner-response-validation",
      ownerResponseValidation,
      "--approval-gate",
      approvalGate,
      "--teacher-auth-action-packet",
      actionPacket,
      "--app-auth-preflight",
      appAuthPreflight,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "teacher-auth-production-evidence-preflight",
        status: "teacher-auth-production-evidence-preflight-waiting-for-upstream-app-auth",
        releaseReady: false,
        ownerDecisionId: "teacher-auth-provider-production-selector",
        approvedProviderMode: "trusted-cookie-issuer",
      }),
    );
    expect(body.summary).toEqual({
      ownerResponseAccepted: true,
      teacherStageAcceptedAwaitingEvidence: true,
      upstreamAppAuthEvidenceCleared: false,
      s19DryRunMayProceedAfterAppAuthClears: true,
      s22ReadinessMayProceedAfterEnvSync: true,
      issuerRouteSmokeMayProceedAfterProductionDeploy: true,
      liveCookieIssuanceStillForbidden: true,
      requiredServerOnlyEnvNameCount: 3,
      requiredEvidenceCount: 5,
      missingEvidenceCount: 4,
      commandTemplateCount: 3,
      releaseReady: false,
    });
    expect(body.requiredServerOnlyEnvNames).toEqual([
      "UAIS_TEACHER_AUTH_PROVIDER",
      "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
      "UAIS_TEACHER_AUTH_ISSUER_SECRET",
    ]);
    expect(body.missingEvidence).toEqual([
      "vercel-env-sync-evidence-with-teacher-auth-env-present",
      "deployed-teacher-auth-issuer-route-smoke",
      "teacher-auth-provider-readiness-production-live-ready",
      "same-release-run-id-bound-to-teacher-auth-readiness",
    ]);
    expect(body.blockedReasons).toEqual([
      "upstream-app-auth-production-evidence-not-cleared",
      "vercel-env-sync-evidence-with-teacher-auth-env-present-missing",
      "deployed-teacher-auth-issuer-route-smoke-missing",
      "teacher-auth-provider-readiness-production-live-ready-missing",
      "same-release-run-id-bound-to-teacher-auth-readiness-missing",
    ]);
    expect(body.safeCommandTemplates).toEqual(
      expect.objectContaining({
        vercelEnvSyncDryRun:
          "node scripts/vercel-env-sync.mjs --dry-run --scope teacher-auth --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <teacher-auth-vercel-env-sync-dry-run-evidence>",
        issuerRouteSmoke:
          "node scripts/teacher-auth-issuer-route-smoke.mjs --live --approved --environment production --deployment <production-deployment-evidence> --release-run-id <release-run-id> > <teacher-auth-issuer-route-smoke-evidence>",
      }),
    );
    expect(body.safety).toEqual(
      expect.objectContaining({
        envFileRead: false,
        credentialValuesOmitted: true,
        cookieValuesOmitted: true,
        noCookieIssued: true,
        noLiveMutationPerformed: true,
        noEnvApplyPerformed: true,
      }),
    );

    const markdown = execFileSync("node", [
      "scripts/teacher-auth-production-evidence-preflight.mjs",
      "--owner-response-validation",
      ownerResponseValidation,
      "--approval-gate",
      approvalGate,
      "--teacher-auth-action-packet",
      actionPacket,
      "--app-auth-preflight",
      appAuthPreflight,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(markdown).toContain("# UAIS Teacher Auth Production Evidence Preflight");
    expect(markdown).toContain(
      "Status: `teacher-auth-production-evidence-preflight-waiting-for-upstream-app-auth`",
    );
    expect(markdown).toContain("## Safe Command Templates");
    expect(markdown).not.toContain("UAIS-production-teacher-auth-env-source");
    expect(markdown).not.toContain("UAIS-enterprise-run-2026-07-XX");
  });

  it("stays blocked when the owner response is incomplete", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-auth-evidence-preflight-blocked-"));
    const ownerResponseValidation = writeJson(tmpDir, "owner-response-validation.json", {
      status: "owner-response-incomplete",
      summary: {
        providerModeAccepted: false,
        s19DryRunMayProceed: false,
        s22ReadinessMayProceed: false,
      },
    });
    const approvalGate = writeJson(tmpDir, "approval-gate.json", {
      stages: [],
    });
    const actionPacket = writeJson(tmpDir, "action-packet.json", {});

    const output = execFileSync("node", [
      "scripts/teacher-auth-production-evidence-preflight.mjs",
      "--owner-response-validation",
      ownerResponseValidation,
      "--approval-gate",
      approvalGate,
      "--teacher-auth-action-packet",
      actionPacket,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("teacher-auth-production-evidence-preflight-blocked");
    expect(body.blockedReasons).toContain("teacher-auth-owner-response-not-accepted");
    expect(body.blockedReasons).toContain("teacher-auth-stage-not-accepted-awaiting-production-evidence");
    expect(body.summary.releaseReady).toBe(false);
  });
});

function writeJson(dir: string, name: string, value: unknown) {
  const filePath = join(dir, name);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}
