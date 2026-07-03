import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("owner decision teacher auth response template", () => {
  it("builds a queued redacted owner response template for the teacher-auth owner decision", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-auth-response-template-"));
    const ownerDecisionQueue = writeJson(tmpDir, "queue.json", buildQueue());
    const actionPacket = writeJson(tmpDir, "teacher-auth-action-packet.json", buildActionPacket());

    const output = execFileSync("node", [
      "scripts/owner-decision-teacher-auth-response-template.mjs",
      "--owner-decision-queue",
      ownerDecisionQueue,
      "--teacher-auth-action-packet",
      actionPacket,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "owner-decision-teacher-auth-response-template",
        status: "queued-awaiting-upstream-app-auth",
        decisionId: "teacher-auth-provider-production-selector",
        responsibleSession: "S22/S19/S10",
      }),
    );
    expect(body.summary).toEqual(
      expect.objectContaining({
        queueRank: 2,
        queueStatus: "owner-decision-needed",
        actionPacketStatus: "owner-decision-needed",
        upstreamBlockedDecisionCount: 1,
        releaseReady: false,
      }),
    );
    expect(body.ownerResponseTemplate).toEqual(
      expect.objectContaining({
        responseStatus: "owner-response-required",
        decisionId: "teacher-auth-provider-production-selector",
        ownerApprovedProviderMode: null,
        approvedServerOnlyEnvSourceLabel: null,
        approvedReleaseRunIdLabel: null,
        confirmsNoCredentialValuesInResponse: false,
      }),
    );
    expect(body.ownerResponseTemplate.allowedProviderModes).toEqual([
      "trusted-cookie-issuer",
      "oidc-jwks",
    ]);
    expect(body.ownerResponseTemplate.requiredServerOnlyEnvNamesByMode).toEqual({
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
    });
    expect(body.copySafeOwnerReplyStub).toEqual({
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
    expect(body.ownerResponseValidationCommand).toBe(
      "node scripts/owner-decision-teacher-auth-response-validation.mjs --owner-response-template coordination/reports/<this-template-json> --owner-response path/to/filled-owner-response.json",
    );
    expect(body.postResponseAllowedChecks).toEqual([
      "validate-owner-response-shape",
      "confirm-no-credential-values-in-owner-response",
      "prepare-s19-teacher-auth-env-sync-dry-run-after-app-auth-clears",
      "prepare-teacher-auth-readiness-command-after-env-sync-evidence",
      "prepare-teacher-auth-issuer-route-smoke-after-production-deploy",
    ]);
    expect(body.stillForbiddenUntilSeparateApproval).toContain("issue-live-teacher-auth-cookie");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://private-teacher-auth.example.test");
    expect(output).not.toContain("uais_teacher_auth_claims=secret");
  });

  it("reports missing when the teacher-auth decision is not present in the owner queue", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-auth-response-template-missing-"));
    const ownerDecisionQueue = writeJson(tmpDir, "queue.json", {
      status: "owner-decisions-required",
      queue: [
        {
          rank: 1,
          id: "app-auth-provider-production-selector",
          status: "owner-decision-needed",
        },
      ],
    });
    const actionPacket = writeJson(tmpDir, "teacher-auth-action-packet.json", buildActionPacket());

    const output = execFileSync("node", [
      "scripts/owner-decision-teacher-auth-response-template.mjs",
      "--owner-decision-queue",
      ownerDecisionQueue,
      "--teacher-auth-action-packet",
      actionPacket,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("decision-not-in-owner-queue");
    expect(body.ownerResponseTemplate).toBeNull();
    expect(body.summary.queueRank).toBeNull();
  });

  it("renders markdown without source paths or credential values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-auth-response-template-md-"));
    const ownerDecisionQueue = writeJson(tmpDir, "queue.json", buildQueue());
    const actionPacket = writeJson(tmpDir, "teacher-auth-action-packet.json", buildActionPacket());

    const output = execFileSync("node", [
      "scripts/owner-decision-teacher-auth-response-template.mjs",
      "--owner-decision-queue",
      ownerDecisionQueue,
      "--teacher-auth-action-packet",
      actionPacket,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("# UAIS Teacher Auth Owner Response Template");
    expect(output).toContain("Status: `queued-awaiting-upstream-app-auth`");
    expect(output).toContain("Do not include credential values.");
    expect(output).toContain("## Copy-Safe Owner Reply Stub");
    expect(output).toContain('"ownerApprovedProviderMode": "<choose trusted-cookie-issuer or oidc-jwks>"');
    expect(output).toContain("## Validation Command");
    expect(output).toContain(
      "node scripts/owner-decision-teacher-auth-response-validation.mjs --owner-response-template coordination/reports/<this-template-json> --owner-response path/to/filled-owner-response.json",
    );
    expect(output).toContain("`trusted-cookie-issuer`");
    expect(output).toContain("`oidc-jwks`");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });
});

function buildQueue() {
  return {
    status: "owner-decisions-required",
    queue: [
      {
        rank: 1,
        id: "app-auth-provider-production-selector",
        status: "owner-decision-needed",
      },
      {
        rank: 2,
        id: "teacher-auth-provider-production-selector",
        status: "owner-decision-needed",
        category: "owner-decision",
        nextOwnerQuestion:
          "Confirm production teacher auth provider mode and approved server-only env source.",
      },
    ],
    leakedPath: "/Users/example/private/queue.json",
  };
}

function buildActionPacket() {
  return {
    target: "teacher-auth-owner-action-packet",
    status: "owner-decision-needed",
    decisionId: "teacher-auth-provider-production-selector",
    queueRank: 2,
    acceptedOptions: ["trusted-cookie-issuer", "oidc-jwks"],
    requiredEnvNamesByMode: {
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
    forbiddenUntilApproved: [
      "inspect-or-print-teacher-auth-credential-values",
      "issue-live-teacher-auth-cookie",
      "run-live-teacher-auth-provider-network-call",
      "run-production-smokes-dependent-on-teacher-auth",
    ],
    currentEvidenceSummary: {
      evidenceStatus: "dry-run-blocked",
      authProviderMode: "trusted-cookie-issuer",
      trustedRouteChainStatus: "proved",
      vercelEnvSyncStatus: "missing",
    },
    leakedUrl: "https://private-teacher-auth.example.test",
    leakedCookie: "uais_teacher_auth_claims=secret",
  };
}

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}
