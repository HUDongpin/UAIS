import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const releaseRunId = "UAIS-enterprise-run-2026-07-XX";
const readinessResults = {
  teacherAuthProviderModeSupported: "passed",
  teacherAuthSessionCookieContract: "passed",
  teacherAuthProviderVercelEnvSync: "passed",
  teacherAuthProviderSpecificContract: "passed",
  teacherAuthProviderRouteBinding: "passed",
  teacherAuthReadinessSafety: "passed",
};
const upstreamOperatorInputPacket = {
  target: "app-auth-env-source-intake-operator-input",
  status: "operator-approved-source-required",
  firstRequiredInputId: "approved-env-source-path",
  approvedServerOnlyEnvSourceLabel: "UAIS-production-app-auth-env-source",
  acceptedInputModes: ["approved-source-handle", "approved-env-file-presence"],
  requiredServerOnlyEnvNames: [
    "UAIS_APP_SESSION_SIGNING_SECRET",
    "UAIS_APP_AUTH_PROVIDER",
    "UAIS_APP_AUTH_PROVIDER_URL",
    "UAIS_APP_AUTH_PROVIDER_TOKEN",
  ],
  nextSafeAction: "provide-approved-env-source-path-to-s19",
  nextSafeCommandTemplateKey: "approvedSourceHandleIntake",
  valuesForbidden: true,
};

describe("teacher auth production evidence gate", () => {
  it("waits for upstream app-auth and teacher-auth env-sync evidence before readiness", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-auth-production-gate-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const preflightPath = writeJson(reportsDir, "preflight.json", {
      target: "teacher-auth-production-evidence-preflight",
      status: "teacher-auth-production-evidence-preflight-waiting-for-upstream-app-auth",
      approvedProviderMode: "trusted-cookie-issuer",
      approvedServerOnlyEnvSourceLabel: "UAIS-production-teacher-auth-env-source",
      approvedReleaseRunIdLabel: releaseRunId,
      summary: {
        upstreamAppAuthEvidenceCleared: false,
        liveCookieIssuanceStillForbidden: true,
        releaseReady: false,
      },
    });
    const envSyncGatePath = writeJson(reportsDir, "env-sync-gate.json", {
      target: "teacher-auth-vercel-env-sync-evidence-gate",
      status: "teacher-auth-vercel-env-sync-evidence-gate-waiting-for-upstream-app-auth",
      approvedProviderMode: "trusted-cookie-issuer",
      approvedReleaseRunIdLabel: releaseRunId,
      summary: {
        operatorInputRequired: true,
        blockingInputRequired: true,
        upstreamAppAuthEvidenceCleared: false,
        teacherPreflightReady: false,
        applyEvidenceAccepted: false,
        teacherAuthReadinessMayProceed: false,
        releaseReady: false,
      },
      safeNextAction: "provide-approved-env-source-path-to-s19",
      blockedReasons: [
        "upstream-app-auth-production-evidence-not-cleared",
        "vercel-env-sync-evidence-missing",
      ],
      upstreamBlockingEvidence: {
        id: "upstream-app-auth-production-evidence",
        safeNextAction: "provide-approved-env-source-path-to-s19",
        upstreamMissingEvidence: ["approved-env-source-path"],
        upstreamOperatorInputPacket,
        upstreamSafeCommandTemplates: {
          approvedSourceHandleIntake:
            "node scripts/app-auth-env-source-intake.mjs --approved --evidence-handle <approved-source-handle> --production-env-source-handoff <production-env-source-handoff> --app-auth-preflight <app-auth-preflight> > <app-auth-env-source-intake-evidence>",
        },
      },
    });

    const output = execFileSync("node", [
      "scripts/teacher-auth-production-evidence-gate.mjs",
      "--teacher-auth-preflight",
      preflightPath,
      "--teacher-auth-vercel-env-sync-evidence-gate",
      envSyncGatePath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "teacher-auth-production-evidence-gate",
        status: "teacher-auth-production-evidence-gate-waiting-for-upstream-app-auth",
        releaseReady: false,
        responsibleSession: "S19/S22",
        approvedProviderMode: "trusted-cookie-issuer",
        approvedServerOnlyEnvSourceLabel: "UAIS-production-teacher-auth-env-source",
        approvedReleaseRunIdLabel: releaseRunId,
        summary: {
          operatorInputRequired: true,
          blockingInputRequired: true,
          upstreamAppAuthEvidenceCleared: false,
          envSyncEvidenceAccepted: false,
          issuerRouteSmokeProvided: false,
          issuerRouteSmokeAccepted: false,
          readinessEvidenceProvided: false,
          readinessEvidenceAccepted: false,
          releaseRunBound: false,
          teacherAuthProductionEvidenceCleared: false,
          liveCookieIssuanceStillForbidden: true,
          releaseReady: false,
        },
        issuerRouteSmokeStatus: {
          target: "missing",
          status: "missing",
          environment: "missing",
          releaseRunIdStatus: "missing",
          valueRedacted: true,
        },
        readinessEvidenceStatus: {
          target: "missing",
          status: "missing",
          mode: "missing",
          environment: "missing",
          releaseRunIdStatus: "missing",
          valueRedacted: true,
        },
        blockedReasons: [
          "upstream-app-auth-production-evidence-not-cleared",
          "teacher-auth-vercel-env-sync-evidence-not-accepted",
          "teacher-auth-issuer-route-smoke-evidence-missing",
          "teacher-auth-provider-readiness-evidence-missing",
        ],
      }),
    );
    expect(body.upstreamBlockingEvidence).toEqual({
      id: "upstream-teacher-auth-vercel-env-sync-evidence-gate",
      label: "teacher-auth-vercel-env-sync-evidence-gate",
      reason:
        "Teacher-auth production evidence must wait for accepted teacher-auth Vercel env-sync evidence before issuer smoke or provider readiness evidence can be requested.",
      valuesForbidden: true,
      upstreamStatus: "teacher-auth-vercel-env-sync-evidence-gate-waiting-for-upstream-app-auth",
      safeNextAction: "provide-approved-env-source-path-to-s19",
      upstreamOperatorInputRequired: true,
      upstreamMissingEvidence: ["approved-env-source-path"],
      upstreamOperatorInputPacket,
      upstreamSafeCommandTemplates: {
        approvedSourceHandleIntake:
          "node scripts/app-auth-env-source-intake.mjs --approved --evidence-handle <approved-source-handle> --production-env-source-handoff <production-env-source-handoff> --app-auth-preflight <app-auth-preflight> > <app-auth-env-source-intake-evidence>",
      },
    });
    expect(body.safeNextAction).toBe("provide-approved-env-source-path-to-s19");
    expect(body.safety).toEqual({
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      credentialValuesOmitted: true,
      cookieValuesOmitted: true,
      responseBodiesOmitted: true,
      envFileRead: false,
      vercelApiCalled: false,
      providerNetworkCallPerformed: false,
      noCookieIssued: true,
      noEnvApplyPerformed: true,
      noDeploymentMutationPerformed: true,
      noLiveSmokePerformed: true,
      noReleaseRunBindingPerformed: true,
    });
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");

    const markdown = execFileSync("node", [
      "scripts/teacher-auth-production-evidence-gate.mjs",
      "--teacher-auth-preflight",
      preflightPath,
      "--teacher-auth-vercel-env-sync-evidence-gate",
      envSyncGatePath,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(markdown).toContain("Operator input required: `true`");
    expect(markdown).toContain("Safe next action: `provide-approved-env-source-path-to-s19`");
    expect(markdown).toContain("## Upstream Operator Input Packet");
    expect(markdown).toContain("- First required input: `approved-env-source-path`");
    expect(markdown).toContain("- Next command template: `approvedSourceHandleIntake`");
    expect(markdown).toContain("## Upstream Safe Operator Command Templates");
    expect(markdown).toContain(
      "`approvedSourceHandleIntake`: `node scripts/app-auth-env-source-intake.mjs --approved --evidence-handle <approved-source-handle>",
    );
    expect(markdown).not.toContain(tmpDir);
    expect(markdown).not.toContain("/Users/");
  });

  it("accepts live trusted-cookie-issuer readiness only with route smoke and release-run binding", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-auth-production-gate-ready-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const fakeUrl = "https://teacher-auth.example.test/issuer";
    const fakeSecret = "teacher-auth-secret-must-not-appear";
    const preflightPath = writeJson(reportsDir, "preflight.json", {
      target: "teacher-auth-production-evidence-preflight",
      status: "teacher-auth-production-evidence-preflight-ready",
      approvedProviderMode: "trusted-cookie-issuer",
      approvedServerOnlyEnvSourceLabel: "UAIS-production-teacher-auth-env-source",
      approvedReleaseRunIdLabel: releaseRunId,
      summary: {
        upstreamAppAuthEvidenceCleared: true,
        liveCookieIssuanceStillForbidden: true,
        releaseReady: false,
      },
    });
    const envSyncGatePath = writeJson(reportsDir, "env-sync-gate.json", {
      target: "teacher-auth-vercel-env-sync-evidence-gate",
      status: "teacher-auth-vercel-env-sync-evidence-gate-apply-evidence-accepted",
      approvedProviderMode: "trusted-cookie-issuer",
      approvedReleaseRunIdLabel: releaseRunId,
      summary: {
        upstreamAppAuthEvidenceCleared: true,
        teacherPreflightReady: true,
        applyEvidenceAccepted: true,
        teacherAuthReadinessMayProceed: true,
        releaseReady: false,
      },
      vercelEnvSyncEvidenceStatus: {
        target: "vercel-env-sync",
        status: "matched",
        applyPreflight: "proved",
        releaseRunIdStatus: "matched",
        requiredTeacherAuthEnvStatus: "present",
        valueRedacted: true,
      },
    });
    const routeSmokePath = writeJson(reportsDir, "route-smoke.json", routeSmokeEvidence());
    const readinessPath = writeJson(reportsDir, "readiness.json", {
      target: "teacher-auth-provider-readiness",
      mode: "live",
      environment: "production",
      status: "ready",
      releaseRunId,
      responsibleSession: "S22",
      authProviderMode: "trusted-cookie-issuer",
      rawIssuerEndpoint: fakeUrl,
      rawIssuerSecret: fakeSecret,
      results: readinessResults,
      vercelEnvSyncEvidence: {
        target: "vercel-env-sync",
        status: "matched",
        applyPreflight: "proved",
        releaseRunIdStatus: "matched",
        valueRedacted: true,
      },
      trustedIssuerContract: {
        issuerSecretStrength: "sufficient",
        sessionIssuerSecretSeparation: "proved",
        issuerProofRequired: true,
        issuerProofMaxAgeSeconds: 300,
        issuerProofBoundsCookieMaxAge: true,
        valueRedacted: true,
      },
      trustedCookieSessionRoundTrip: {
        status: "proved",
        cookiePair: "created-and-verified-in-memory",
        claimsCookie: "signed-session-claims",
        signatureCookie: "hmac-sha256-signature",
        signatureVerification: "passed",
        expiryCheck: "passed",
        tamperCheck: "passed",
        sessionIdRedacted: true,
        cookieValuesEmitted: false,
        valuesRedacted: true,
      },
      trustedTeacherAuthRouteSmokeEvidence: {
        target: "teacher-auth-issuer-route-smoke",
        status: "proved",
        valueRedacted: true,
        releaseRunIdStatus: "matched",
        deploymentBinding: "proved",
        teacherAuthIssuerRoute: "proved",
        issuedTeacherAiSessionRoute: "proved",
        responseHeaders: "proved",
        responseShape: "proved",
      },
      safety: {
        valuesRedacted: true,
        secretsOmitted: true,
        providerUrlsOmitted: true,
        responseBodiesOmitted: true,
        localPrivatePathsOmitted: true,
        liveRequiresApproval: true,
        remoteMutationRequiresApproval: true,
        cookieValuesOmitted: true,
        noCookieIssued: true,
        cookiesOmitted: true,
      },
    });

    const output = execFileSync("node", [
      "scripts/teacher-auth-production-evidence-gate.mjs",
      "--teacher-auth-preflight",
      preflightPath,
      "--teacher-auth-vercel-env-sync-evidence-gate",
      envSyncGatePath,
      "--teacher-auth-issuer-route-smoke",
      routeSmokePath,
      "--teacher-auth-provider-readiness",
      readinessPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("teacher-auth-production-evidence-gate-cleared");
    expect(body.releaseReady).toBe(false);
    expect(body.summary).toEqual({
      operatorInputRequired: false,
      blockingInputRequired: false,
      upstreamAppAuthEvidenceCleared: true,
      envSyncEvidenceAccepted: true,
      issuerRouteSmokeProvided: true,
      issuerRouteSmokeAccepted: true,
      readinessEvidenceProvided: true,
      readinessEvidenceAccepted: true,
      releaseRunBound: true,
      teacherAuthProductionEvidenceCleared: true,
      liveCookieIssuanceStillForbidden: true,
      releaseReady: false,
    });
    expect(body.issuerRouteSmokeStatus).toEqual({
      target: "teacher-auth-issuer-route-smoke",
      status: "proved",
      environment: "production",
      releaseRunIdStatus: "matched",
      valueRedacted: true,
    });
    expect(body.readinessEvidenceStatus).toEqual({
      target: "teacher-auth-provider-readiness",
      status: "live-ready",
      mode: "live",
      environment: "production",
      releaseRunIdStatus: "matched",
      valueRedacted: true,
    });
    expect(body.provedEvidence).toEqual([
      "vercel-env-sync-evidence-with-teacher-auth-env-present",
      "deployed-teacher-auth-issuer-route-smoke",
      "teacher-auth-provider-readiness-production-live-ready",
      "same-release-run-id-bound-to-teacher-auth-readiness",
    ]);
    expect(body.safeNextAction).toBe("advance-external-storage-production-evidence-preflight");
    expect(output).not.toContain(fakeUrl);
    expect(output).not.toContain(fakeSecret);
    expect(output).not.toContain(routeSmokePath);
    expect(output).not.toContain(readinessPath);
  });
});

function routeSmokeEvidence() {
  return {
    target: "teacher-auth-issuer-route-smoke",
    mode: "live",
    environment: "production",
    releaseRunId,
    authProviderMode: "trusted-cookie-issuer",
    status: "passed",
    vercelProductionDeploymentEvidence: {
      target: "vercel-production-deployment",
      status: "matched",
      deploymentObservationStatus: "observed",
      releaseRunIdStatus: "matched",
      valueRedacted: true,
    },
    results: [
      {
        id: "s22-teacher-auth-issuer-route",
        route: "/api/ai/teacher-auth/issue",
        auth: "signed-admin-ai-access",
        status: "ok",
        httpStatus: 200,
        responseHeaders: {
          checked: true,
          status: "ok",
          requiredHeaders: {
            teacherAuthClaimsSetCookie: "present",
            teacherAuthSignatureSetCookie: "present",
            httpOnlySameSiteSecureMaxAge: "present",
            priorityHigh: "present",
            issuerProofBoundedMaxAge: "present",
          },
        },
        responseShape: {
          checked: true,
          status: "ok",
          requiredFields: {
            teacherAuthSession: "present",
            authProviderContract: "present",
            s12TeacherAuthIssuerBoundary: "present",
          },
        },
      },
    ],
  };
}

function writeJson(dir: string, name: string, value: unknown) {
  const path = join(dir, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}
