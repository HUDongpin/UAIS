import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("app auth production evidence gate", () => {
  it("waits for app-auth Vercel env-sync gate before requesting provider readiness", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-app-auth-production-gate-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const preflightPath = writeJson(reportsDir, "preflight.json", {
      target: "app-auth-production-evidence-preflight",
      status: "app-auth-production-evidence-preflight-ready",
      approvedProviderMode: "trusted-account-provider",
      approvedServerOnlyEnvSourceLabel: "UAIS-production-app-auth-env-source",
      approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
      missingEvidence: [
        "vercel-env-sync-evidence-with-app-auth-env-present",
        "app-auth-provider-readiness-production-live-ready",
        "same-release-run-id-bound-to-app-auth-readiness",
      ],
    });
    const envSyncGatePath = writeJson(reportsDir, "env-sync-gate.json", {
      target: "app-auth-vercel-env-sync-evidence-gate",
      status: "app-auth-vercel-env-sync-evidence-gate-waiting-for-env-source-intake",
      approvedProviderMode: "trusted-account-provider",
      approvedServerOnlyEnvSourceLabel: "UAIS-production-app-auth-env-source",
      approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
      summary: {
        operatorInputRequired: true,
        blockingInputRequired: true,
        upstreamEnvSourceIntakeRequired: true,
        applyEvidenceAccepted: false,
        appAuthReadinessMayProceed: false,
        releaseReady: false,
      },
      safeNextAction: "provide-approved-env-source-path-to-s19",
      blockedReasons: ["app-auth-env-source-intake-not-ready"],
      upstreamBlockingEvidence: {
        id: "upstream-app-auth-env-source-intake",
        label: "app-auth-env-source-intake",
        valuesForbidden: true,
        safeNextAction: "provide-approved-env-source-path-to-s19",
        missingEvidence: ["approved-env-source-path"],
        blockedReasons: ["approved-env-source-path-required"],
        operatorInputPacket: {
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
          preferredInputMode: "approved-source-handle",
          safeInputInstruction:
            "Provide an approved source handle or approved env-file presence proof to S19 only; do not paste raw values, URLs, cookies, credentials, or unredacted local paths into reports or chat.",
          approvedSourceLabelIsNotEvidence: true,
          valuesForbidden: true,
        },
        safeCommandTemplates: {
          approvedSourceHandleIntake:
            "node scripts/app-auth-env-source-intake.mjs --approved --evidence-handle <approved-source-handle> --production-env-source-handoff <production-env-source-handoff> --app-auth-preflight <app-auth-preflight> > <app-auth-env-source-intake-evidence>",
        },
      },
    });

    const output = execFileSync("node", [
      "scripts/app-auth-production-evidence-gate.mjs",
      "--app-auth-preflight",
      preflightPath,
      "--app-auth-vercel-env-sync-evidence-gate",
      envSyncGatePath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "app-auth-production-evidence-gate",
        status: "app-auth-production-evidence-gate-waiting-for-env-sync-evidence",
        releaseReady: false,
        responsibleSession: "S19/S22",
        approvedProviderMode: "trusted-account-provider",
        approvedServerOnlyEnvSourceLabel: "UAIS-production-app-auth-env-source",
        approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
        summary: {
          ownerInputRequired: false,
          operatorInputRequired: true,
          blockingInputRequired: true,
          upstreamEnvSyncEvidenceRequired: true,
          envSyncEvidenceAccepted: false,
          readinessEvidenceProvided: false,
          readinessEvidenceAccepted: false,
          releaseRunBound: false,
          appAuthProductionEvidenceCleared: false,
          releaseReady: false,
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
          "app-auth-vercel-env-sync-evidence-not-accepted",
        ],
      }),
    );
    expect(body.upstreamBlockingEvidence).toEqual({
      id: "upstream-app-auth-vercel-env-sync-evidence-gate",
      label: "app-auth-vercel-env-sync-evidence-gate",
      reason:
        "App-auth production evidence must wait for accepted app-auth Vercel env-sync evidence before provider readiness evidence can be requested.",
      valuesForbidden: true,
      upstreamStatus: "app-auth-vercel-env-sync-evidence-gate-waiting-for-env-source-intake",
      safeNextAction: "provide-approved-env-source-path-to-s19",
      upstreamBlockedReasons: ["app-auth-env-source-intake-not-ready"],
      upstreamOperatorInputRequired: true,
      upstreamMissingEvidence: ["approved-env-source-path"],
      upstreamOperatorInputPacket: {
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
        preferredInputMode: "approved-source-handle",
        safeInputInstruction:
          "Provide an approved source handle or approved env-file presence proof to S19 only; do not paste raw values, URLs, cookies, credentials, or unredacted local paths into reports or chat.",
        approvedSourceLabelIsNotEvidence: true,
        valuesForbidden: true,
      },
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
      noEnvApplyPerformed: true,
      noDeploymentMutationPerformed: true,
      noLiveSmokePerformed: true,
      noReleaseRunBindingPerformed: true,
    });
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");

    const markdown = execFileSync("node", [
      "scripts/app-auth-production-evidence-gate.mjs",
      "--app-auth-preflight",
      preflightPath,
      "--app-auth-vercel-env-sync-evidence-gate",
      envSyncGatePath,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(markdown).toContain("Operator input required: `true`");
    expect(markdown).toContain("Safe next action: `provide-approved-env-source-path-to-s19`");
    expect(markdown).toContain("## Upstream Safe Operator Command Templates");
    expect(markdown).toContain(
      "`approvedSourceHandleIntake`: `node scripts/app-auth-env-source-intake.mjs --approved --evidence-handle <approved-source-handle>",
    );
    expect(markdown).not.toContain(tmpDir);
    expect(markdown).not.toContain("/Users/");
  });

  it("accepts live production app-auth readiness evidence only when every release gate proof is present", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-app-auth-production-gate-ready-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const fakeUrl = "https://accounts.example.test/uais/authenticate";
    const fakeSecret = "secret-value-that-must-not-appear";
    const releaseRunId = "UAIS-enterprise-run-2026-07-XX";
    const preflightPath = writeJson(reportsDir, "preflight.json", {
      approvedProviderMode: "trusted-account-provider",
      approvedServerOnlyEnvSourceLabel: "UAIS-production-app-auth-env-source",
      approvedReleaseRunIdLabel: releaseRunId,
      missingEvidence: [
        "vercel-env-sync-evidence-with-app-auth-env-present",
        "app-auth-provider-readiness-production-live-ready",
        "same-release-run-id-bound-to-app-auth-readiness",
      ],
    });
    const envSyncGatePath = writeJson(reportsDir, "env-sync-gate.json", {
      status: "app-auth-vercel-env-sync-evidence-gate-apply-evidence-accepted",
      summary: {
        applyEvidenceAccepted: true,
        appAuthReadinessMayProceed: true,
        releaseReady: false,
      },
    });
    const readinessPath = writeJson(reportsDir, "readiness.json", {
      target: "app-auth-provider-readiness",
      mode: "live",
      environment: "production",
      status: "ready",
      releaseRunId,
      responsibleSession: "S12/S19/S22",
      appAuthProviderMode: "trusted-account-provider",
      endpointSecurity: "remote-https",
      rawProviderUrl: fakeUrl,
      rawSecret: fakeSecret,
      appSessionCookieContract: {
        signingSecretStrength: "sufficient",
        cookiePair: [
          {
            name: "uais_app_session",
            purpose: "signed-app-session-claims",
            httpOnly: true,
            sameSite: "Lax",
            secure: "required-in-production",
            path: "/",
            maxAge: "bounded-by-session-ttl",
            priority: "High",
            valueRedacted: true,
          },
          {
            name: "uais_app_session_signature",
            purpose: "hmac-sha256-signature",
            httpOnly: true,
            sameSite: "Lax",
            secure: "required-in-production",
            path: "/",
            maxAge: "bounded-by-session-ttl",
            priority: "High",
            valueRedacted: true,
          },
        ],
        valueRedacted: true,
      },
      trustedAccountProviderContract: {
        providerKind: "trusted-account-provider",
        endpoint: "configured",
        bearerCredential: "configured",
        accessTokenStrength: "sufficient",
        requestMethod: "POST",
        responseUserShape: ["account", "role", "displayName", "department"],
        valueRedacted: true,
      },
      vercelEnvSyncEvidence: {
        target: "vercel-env-sync",
        status: "matched",
        applyPreflight: "proved",
        releaseRunIdStatus: "matched",
        requiredAppAuthEnvStatus: "present",
        valueRedacted: true,
      },
      results: {
        appAuthProviderModeTrusted: "passed",
        appAuthProviderEndpointRemoteHttps: "passed",
        appAuthSessionCookieContract: "passed",
        appAuthProviderVercelEnvSync: "passed",
        trustedAccountProviderContract: "passed",
        appAuthReadinessSafety: "passed",
      },
      blockedReasons: [],
      safety: {
        valuesRedacted: true,
        secretsOmitted: true,
        passwordsOmitted: true,
        providerUrlsOmitted: true,
        responseBodiesOmitted: true,
        localPrivatePathsOmitted: true,
        liveRequiresApproval: true,
        remoteMutationRequiresApproval: true,
        cookieValuesOmitted: true,
        providerNetworkCallPerformed: false,
      },
    });

    const output = execFileSync("node", [
      "scripts/app-auth-production-evidence-gate.mjs",
      "--app-auth-preflight",
      preflightPath,
      "--app-auth-vercel-env-sync-evidence-gate",
      envSyncGatePath,
      "--app-auth-provider-readiness",
      readinessPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("app-auth-production-evidence-gate-cleared");
    expect(body.releaseReady).toBe(false);
    expect(body.summary).toEqual({
      ownerInputRequired: false,
      operatorInputRequired: false,
      blockingInputRequired: false,
      upstreamEnvSyncEvidenceRequired: false,
      envSyncEvidenceAccepted: true,
      readinessEvidenceProvided: true,
      readinessEvidenceAccepted: true,
      releaseRunBound: true,
      appAuthProductionEvidenceCleared: true,
      releaseReady: false,
    });
    expect(body.upstreamBlockingEvidence).toBeNull();
    expect(body.readinessEvidenceStatus).toEqual({
      target: "app-auth-provider-readiness",
      status: "live-ready",
      mode: "live",
      environment: "production",
      releaseRunIdStatus: "matched",
      valueRedacted: true,
    });
    expect(body.provedEvidence).toEqual([
      "vercel-env-sync-evidence-with-app-auth-env-present",
      "app-auth-provider-readiness-production-live-ready",
      "same-release-run-id-bound-to-app-auth-readiness",
    ]);
    expect(body.safeNextAction).toBe("advance-teacher-auth-production-evidence-preflight");
    expect(output).not.toContain(fakeUrl);
    expect(output).not.toContain(fakeSecret);
    expect(output).not.toContain(readinessPath);
  });
});

function writeJson(dir: string, name: string, value: unknown) {
  const path = join(dir, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}
