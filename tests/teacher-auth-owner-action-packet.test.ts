import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("teacher auth owner action packet", () => {
  it("summarizes the teacher auth owner decision without exposing secrets, URLs, or cookie values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-auth-owner-packet-"));
    const ownerChecklist = writeJson(tmpDir, "owner-checklist.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      decisions: [
        {
          id: "teacher-auth-provider-production-selector",
          status: "owner-decision-needed",
          ownerDecisionNeeded: "choose-production-teacher-auth-provider-and-approved-server-only-env-source",
          acceptedOptions: ["trusted-cookie-issuer", "oidc-jwks"],
          blockedReasons: ["teacher-auth-provider-readiness-not-live-ready"],
          teacherAuthProviderReadinessSummary: {
            evidenceStatus: "dry-run-blocked",
            evidenceEnvironment: "production",
            authProviderMode: "trusted-cookie-issuer",
            sessionCookieContract: {
              signingSecretStrength: "sufficient",
              cookiePair: "proved",
              valueRedacted: true,
            },
            vercelEnvSyncEvidence: {
              status: "missing",
              applyPreflight: "missing",
              releaseRunIdStatus: "missing",
              valueRedacted: true,
              leakedSessionSecret: "secret-session-signing-value",
            },
            trustedIssuerContract: {
              issuerSecretStrength: "sufficient",
              sessionIssuerSecretSeparation: "proved",
              valueRedacted: true,
              leakedIssuerSecret: "secret-issuer-value",
            },
            trustedCookieSessionRoundTrip: {
              status: "proved",
              cookieValuesEmitted: false,
              leakedCookie: "uais_teacher_auth_claims=encoded.claims; uais_teacher_auth_signature=encoded.signature",
            },
            trustedTeacherAuthRouteChainEvidence: {
              status: "proved",
              routeChain: "proved",
              redactionSafety: "proved",
              leakedProviderUrl: "https://private-teacher-auth.example.test",
            },
            trustedTeacherAuthRouteSmokeEvidence: {
              status: "missing",
              releaseRunIdStatus: "missing",
              deploymentBinding: "missing",
              teacherAuthIssuerRoute: "missing",
              responseHeaders: "missing",
              responseShape: "missing",
              leakedResponseBody: "secret-live-cookie-body",
            },
          },
          safeNextActions: [
            "confirm-production-teacher-auth-provider-mode",
            "bind-server-only-teacher-auth-env-through-s19-vercel-env-sync",
            "run-approved-teacher-auth-provider-readiness-after-env-sync",
            "run-deployed-teacher-auth-issuer-route-smoke-after-production-deploy",
          ],
          forbiddenUntilApproved: [
            "inspect-or-print-teacher-auth-credential-values",
            "issue-live-teacher-auth-cookie",
            "run-live-teacher-auth-provider-network-call",
          ],
        },
      ],
      leakedLocalPath: "/Users/example/private-teacher-auth.env",
      leakedSecret: "secret-teacher-auth-token",
    });
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      queue: [
        {
          id: "teacher-auth-provider-production-selector",
          rank: 2,
          category: "owner-decision",
          releaseGateRequirementIds: [
            "teacher-auth-provider-readiness",
            "teacher-auth-provider-consistency",
          ],
          enterpriseAuditMissingTargets: [
            "teacher-auth-provider-readiness",
            "teacher-auth-issuer-route-smoke",
          ],
          nextOwnerQuestion: "Confirm production teacher auth provider mode and approved server-only env source.",
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/teacher-auth-owner-action-packet.mjs",
      "--owner-checklist",
      ownerChecklist,
      "--owner-decision-queue",
      ownerQueue,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "teacher-auth-owner-action-packet",
        status: "owner-decision-needed",
        releaseGateStatus: "blocked",
        responsibleSession: "S22",
        decisionId: "teacher-auth-provider-production-selector",
        queueRank: 2,
        classification: "owner-env-deploy-route-smoke-blocked",
        ownerDecisionNeeded: "choose-production-teacher-auth-provider-and-approved-server-only-env-source",
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
        currentEvidenceSummary: {
          evidenceStatus: "dry-run-blocked",
          evidenceEnvironment: "production",
          authProviderMode: "trusted-cookie-issuer",
          vercelEnvSyncStatus: "missing",
          releaseRunIdStatus: "missing",
          trustedRouteChainStatus: "proved",
          trustedRouteSmokeStatus: "missing",
          trustedRouteSmokeDeploymentBinding: "missing",
          trustedCookieRoundTripStatus: "proved",
        },
        releaseGateRequirementIds: [
          "teacher-auth-provider-readiness",
          "teacher-auth-provider-consistency",
        ],
        enterpriseAuditMissingTargets: [
          "teacher-auth-provider-readiness",
          "teacher-auth-issuer-route-smoke",
        ],
        commands: expect.objectContaining({
          vercelEnvSyncDryRun: "node scripts/vercel-env-sync.mjs --dry-run --scope teacher-auth --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <teacher-auth-vercel-env-sync-dry-run-evidence>",
          vercelEnvSyncApply: "node scripts/vercel-env-sync.mjs --apply --approved --scope teacher-auth --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <teacher-auth-vercel-env-sync-evidence>",
          teacherAuthReadinessLive: "node scripts/teacher-auth-provider-readiness.mjs --live --approved --environment production --env-file <approved-env-file> --release-run-id <release-run-id> --vercel-env-sync <teacher-auth-vercel-env-sync-evidence> --trusted-teacher-auth-route-chain <trusted-teacher-auth-route-chain-evidence> --route-smoke <teacher-auth-issuer-route-smoke-evidence> > <teacher-auth-provider-readiness-evidence>",
        }),
        safety: {
          sourcePathsOmitted: true,
          valuesRedacted: true,
          envValuesOmitted: true,
          liveMutationPerformed: false,
          deploymentMutationPerformed: false,
          cookieValuesOmitted: true,
        },
      }),
    );
    expect(body.stopConditions).toEqual(
      expect.arrayContaining([
        "Stop if owner has not approved the teacher auth provider mode and env source.",
        "Stop if approved env source is unavailable to S19.",
        "Stop if production deployment evidence is unavailable for the issuer route smoke.",
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://private-teacher-auth.example.test");
    expect(output).not.toContain("secret-teacher-auth-token");
    expect(output).not.toContain("secret-session-signing-value");
    expect(output).not.toContain("secret-issuer-value");
    expect(output).not.toContain("uais_teacher_auth_claims=encoded.claims");
    expect(output).not.toContain("uais_teacher_auth_signature=encoded.signature");
  });

  it("renders a markdown teacher auth owner packet for handoff", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-auth-owner-packet-md-"));
    const ownerChecklist = writeJson(tmpDir, "owner-checklist.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      decisions: [
        {
          id: "teacher-auth-provider-production-selector",
          status: "owner-decision-needed",
          acceptedOptions: ["trusted-cookie-issuer", "oidc-jwks"],
          blockedReasons: ["teacher-auth-provider-readiness-not-live-ready"],
          teacherAuthProviderReadinessSummary: {
            evidenceStatus: "dry-run-blocked",
            evidenceEnvironment: "production",
            authProviderMode: "trusted-cookie-issuer",
            vercelEnvSyncEvidence: {
              status: "missing",
              releaseRunIdStatus: "missing",
            },
            trustedTeacherAuthRouteChainEvidence: {
              status: "proved",
            },
            trustedTeacherAuthRouteSmokeEvidence: {
              status: "missing",
              deploymentBinding: "missing",
            },
            trustedCookieSessionRoundTrip: {
              status: "proved",
            },
          },
          safeNextActions: ["confirm-production-teacher-auth-provider-mode"],
          forbiddenUntilApproved: ["inspect-or-print-teacher-auth-credential-values"],
        },
      ],
    });
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      queue: [
        {
          id: "teacher-auth-provider-production-selector",
          rank: 2,
          nextOwnerQuestion: "Confirm production teacher auth provider mode and approved server-only env source.",
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/teacher-auth-owner-action-packet.mjs",
      "--owner-checklist",
      ownerChecklist,
      "--owner-decision-queue",
      ownerQueue,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("# UAIS Teacher Auth Owner Action Packet");
    expect(output).toContain("Status: `owner-decision-needed`");
    expect(output).toContain("Queue rank: 2");
    expect(output).toContain("`UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET`");
    expect(output).toContain("`UAIS_TEACHER_AUTH_ISSUER_SECRET`");
    expect(output).toContain("`UAIS_TEACHER_AUTH_OIDC_JWKS_URL`");
    expect(output).toContain("Do not inspect, print, or copy credential or cookie values.");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });
});

function writeJson(tmpDir: string, filename: string, body: unknown) {
  const filePath = join(tmpDir, filename);
  writeFileSync(filePath, JSON.stringify(body, null, 2));
  return filePath;
}
