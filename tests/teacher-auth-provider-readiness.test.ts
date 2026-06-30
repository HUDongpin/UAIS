import { execFile, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const teacherAuthProviderReadinessResults = {
  teacherAuthProviderModeSupported: "passed",
  teacherAuthSessionCookieContract: "passed",
  teacherAuthProviderVercelEnvSync: "passed",
  teacherAuthProviderSpecificContract: "passed",
  teacherAuthProviderRouteBinding: "passed",
  teacherAuthReadinessSafety: "passed",
};

describe("teacher auth provider production readiness evidence", () => {
  it("prints a redacted trusted-cookie dry-run contract without proving production readiness", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-auth-readiness-"));
    const envFile = join(tmpDir, "teacher-auth.env");
    writeFileSync(
      envFile,
      [
        "UAIS_TEACHER_AUTH_PROVIDER=trusted-cookie-issuer",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-session-signing-fixture-strong",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET=secret-issuer-fixture-strong-enough",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/teacher-auth-provider-readiness.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--release-run-id",
      "uais-release-2026-06-18T000000Z",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "teacher-auth-provider-readiness",
        mode: "dry-run",
        environment: "production",
        network: "disabled",
        status: "blocked",
        releaseRunId: "uais-release-2026-06-18T000000Z",
        responsibleSession: "S22",
        authProviderMode: "trusted-cookie-issuer",
        blockedReasons: ["teacher-auth-provider-live-readiness-not-run"],
        results: {
          teacherAuthProviderModeSupported: "passed",
          teacherAuthSessionCookieContract: "passed",
          teacherAuthProviderVercelEnvSync: "blocked",
          teacherAuthProviderSpecificContract: "passed",
          teacherAuthProviderRouteBinding: "blocked",
          teacherAuthReadinessSafety: "passed",
        },
        sessionCookieContract: expect.objectContaining({
          signingSecretStrength: "sufficient",
          httpOnly: "required",
          sameSite: "lax",
          secureInProduction: true,
          maxAgeBounded: true,
          valueRedacted: true,
        }),
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
        safety: expect.objectContaining({
          valuesRedacted: true,
          secretsOmitted: true,
          providerUrlsOmitted: true,
          responseBodiesOmitted: true,
          localPrivatePathsOmitted: true,
          liveRequiresApproval: true,
          noCookieIssued: true,
          cookieValuesOmitted: true,
          cookiesOmitted: true,
          remoteMutationRequiresApproval: true,
        }),
      }),
    );
    expect(output).not.toContain("secret-session");
    expect(output).not.toContain("secret-issuer");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("teacher-auth.env");
    expect(output).not.toContain("/Users/");
  });

  it("passes dry-run trusted-cookie route binding when local route-chain proof is present", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-auth-dry-run-route-chain-"));
    const routeChainFile = join(tmpDir, "trusted-route-chain.json");
    writeFileSync(
      routeChainFile,
      JSON.stringify(
        {
          target: "trusted-teacher-auth-route-chain-contract",
          status: "proved-locally",
          evidence: {
            routeChain: ["/api/ai/teacher-auth/issue", "/api/ai/session"],
            authProvider: "trusted-cookie-issuer",
            issuerProofValidation: {
              maxLifetimeSeconds: 300,
              rejectsFutureIssuedAt: true,
              rejectsExpiresBeforeIssuedAt: true,
              rejectsOverlongLifetime: true,
              valuesRedacted: true,
            },
            issuerCookieHardening: {
              httpOnly: "required",
              sameSite: "lax",
              secureInProduction: true,
              path: "/",
              maxAge: "bounded-by-session-ttl",
              priority: "High",
              valuesRedacted: true,
            },
            sessionCookiePair: [
              "uais_teacher_auth_claims",
              "uais_teacher_auth_signature",
            ],
            downstreamAiSession: "scoped-teacher-ai-session-issued",
            workflowAction: "ppt-narration-submit",
          },
          releaseImpact: {
            localTrustedCookieRouteWiring: "proved",
          },
          safety: {
            secretsRedacted: true,
            cookieValuesOmitted: true,
            sessionIdsOmitted: true,
            commandOutputOmitted: true,
            localPrivatePathsOmitted: true,
            productionMutationPerformed: false,
          },
        },
        null,
        2,
      ),
    );

    const output = execFileSync("node", [
      "scripts/teacher-auth-provider-readiness.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--provider",
      "trusted-cookie-issuer",
      "--session-secret",
      "secret-session-signing-fixture-strong",
      "--issuer-secret",
      "secret-issuer-fixture-strong-enough",
      "--trusted-teacher-auth-route-chain",
      routeChainFile,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        status: "blocked",
        blockedReasons: ["teacher-auth-provider-live-readiness-not-run"],
        trustedCookieSessionRoundTrip: expect.objectContaining({
          status: "proved",
          cookieValuesEmitted: false,
          valuesRedacted: true,
        }),
        trustedTeacherAuthRouteChainEvidence: expect.objectContaining({
          status: "proved",
          routeChain: "proved",
          redactionSafety: "proved",
        }),
        results: {
          teacherAuthProviderModeSupported: "passed",
          teacherAuthSessionCookieContract: "passed",
          teacherAuthProviderVercelEnvSync: "blocked",
          teacherAuthProviderSpecificContract: "passed",
          teacherAuthProviderRouteBinding: "passed",
          teacherAuthReadinessSafety: "passed",
        },
      }),
    );
    expect(output).not.toContain("secret-session");
    expect(output).not.toContain("secret-issuer");
    expect(output).not.toContain("uais_teacher_auth_claims=");
    expect(output).not.toContain("uais_teacher_auth_signature=");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("documents the exact production teacher-auth cookie pair contract", () => {
    const output = execFileSync("node", [
      "scripts/teacher-auth-provider-readiness.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--provider",
      "trusted-cookie-issuer",
      "--session-secret",
      "secret-session-signing-fixture-strong",
      "--issuer-secret",
      "secret-issuer-fixture-strong-enough",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.sessionCookieContract).toEqual(
      expect.objectContaining({
        cookiePair: [
          {
            name: "uais_teacher_auth_claims",
            purpose: "signed-session-claims",
            httpOnly: true,
            sameSite: "Lax",
            secure: "required-in-production",
            path: "/",
            maxAge: "bounded-by-session-ttl",
            priority: "High",
            valueRedacted: true,
          },
          {
            name: "uais_teacher_auth_signature",
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
      }),
    );
    expect(output).not.toContain("secret-session");
    expect(output).not.toContain("secret-issuer");
    expect(output).not.toContain("/Users/");
  });

  it("blocks production OIDC readiness when issuer or JWKS endpoints are not remote HTTPS", () => {
    const output = execFileSync("node", [
      "scripts/teacher-auth-provider-readiness.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--base-url",
      "http://127.0.0.1/issuer",
      "--jwks-url",
      "http://127.0.0.1/jwks.json",
      "--provider",
      "oidc-jwks",
      "--audience",
      "uais-teacher-workflow",
      "--teacher-id-claim",
      "sub",
      "--session-secret",
      "secret-session-signing-fixture-strong",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        status: "blocked",
        authProviderMode: "oidc-jwks",
        oidcEndpointSecurity: {
          issuer: "local-loopback",
          jwks: "local-loopback",
        },
        blockedReasons: expect.arrayContaining([
          "teacher-auth-provider-live-readiness-not-run",
          "production-teacher-auth-oidc-endpoints-not-remote-https",
        ]),
      }),
    );
    expect(output).not.toContain("127.0.0.1");
    expect(output).not.toContain("secret-session");
    expect(output).not.toContain("/Users/");
  });

  it("rejects live production readiness without explicit owner approval", () => {
    expect(() =>
      execFileSync("node", [
        "scripts/teacher-auth-provider-readiness.mjs",
        "--live",
        "--environment",
        "production",
        "--provider",
        "trusted-cookie-issuer",
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).toThrow("explicit owner approval");
  });

  it("blocks live readiness outside the production environment before issuing reusable evidence", () => {
    let output = "";
    expect(() => {
      try {
        execFileSync("node", [
          "scripts/teacher-auth-provider-readiness.mjs",
          "--live",
          "--approved",
          "--environment",
          "preview",
          "--provider",
          "trusted-cookie-issuer",
          "--session-secret",
          "secret-session-signing-fixture-strong",
          "--issuer-secret",
          "secret-issuer-fixture-strong-enough",
          "--release-run-id",
          "uais-release-2026-06-18T000000Z",
        ], {
          cwd: process.cwd(),
          encoding: "utf8",
          stdio: "pipe",
        });
      } catch (error) {
        output = String((error as { stdout?: unknown }).stdout ?? "");
        throw error;
      }
    }).toThrow();
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "teacher-auth-provider-readiness",
        mode: "live",
        environment: "preview",
        status: "blocked",
        authProviderMode: "trusted-cookie-issuer",
        blockedReasons: ["teacher-auth-provider-readiness-not-production"],
      }),
    );
    expect(output).not.toContain("secret-session");
    expect(output).not.toContain("secret-issuer");
    expect(output).not.toContain("/Users/");
  });

  it("blocks production readiness when Vercel env sync selected a different auth provider", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-auth-env-sync-binding-"));
    const envSyncFile = join(tmpDir, "vercel-env-sync.json");
    const releaseRunId = "uais-release-teacher-auth-env-sync-binding";
    writeFileSync(
      envSyncFile,
      JSON.stringify(
        {
          target: "vercel-env-sync",
          mode: "apply",
          releaseRunId,
          authProviderMode: "oidc-jwks",
          projectReadinessEvidenceStatus: "ready",
          targets: ["production", "preview"],
          applySummary: {
            status: "applied",
            appliedActions: 4,
            appliedByTarget: { production: 2, preview: 2 },
            localOnlyEntriesSkipped: 2,
            valuesRedacted: true,
            cliOutputOmitted: true,
          },
          applyPreflight: {
            status: "passed",
            blockedReasons: [],
            valuesRedacted: true,
            cliSafeToInvoke: true,
          },
        },
        null,
        2,
      ),
    );

    const result = await execFileResultForTest("node", [
      "scripts/teacher-auth-provider-readiness.mjs",
      "--live",
      "--approved",
      "--environment",
      "production",
      "--provider",
      "trusted-cookie-issuer",
      "--session-secret",
      "secret-session-signing-fixture-strong",
      "--issuer-secret",
      "secret-issuer-fixture-strong-enough",
      "--release-run-id",
      releaseRunId,
      "--vercel-env-sync",
      envSyncFile,
    ]);
    const body = result.stdout
      ? JSON.parse(result.stdout)
      : { stderr: result.stderr, stdout: "missing-json-evidence" };

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(body).toEqual(
      expect.objectContaining({
        target: "teacher-auth-provider-readiness",
        mode: "live",
        environment: "production",
        status: "blocked",
        authProviderMode: "trusted-cookie-issuer",
        blockedReasons: ["vercel-env-sync-auth-provider-selector-mismatch"],
        vercelEnvSyncEvidence: {
          target: "vercel-env-sync",
          status: "mismatched",
          valueRedacted: true,
          applyPreflight: "proved",
          releaseRunIdStatus: "matched",
        },
      }),
    );
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        {
          id: "s19-vercel-env-sync-apply-evidence",
          responsibleSession: "S19",
          requiredEvidence: "vercel-env-sync",
          status: "mismatched",
          valueRedacted: true,
        },
      ]),
    );
    expect(result.stdout).not.toContain("secret-session");
    expect(result.stdout).not.toContain("secret-issuer");
    expect(result.stdout).not.toContain(tmpDir);
    expect(result.stdout).not.toContain("/Users/");
  });

  it("blocks production readiness when Vercel env sync lacks passed apply preflight proof", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-auth-env-sync-preflight-"));
    const envSyncFile = join(tmpDir, "vercel-env-sync.json");
    const releaseRunId = "uais-release-teacher-auth-env-sync-preflight";
    writeFileSync(
      envSyncFile,
      JSON.stringify(
        {
          target: "vercel-env-sync",
          mode: "apply",
          releaseRunId,
          authProviderMode: "trusted-cookie-issuer",
          projectReadinessEvidenceStatus: "ready",
          targets: ["production", "preview"],
          applySummary: {
            status: "applied",
            appliedActions: 4,
            appliedByTarget: { production: 2, preview: 2 },
            localOnlyEntriesSkipped: 2,
            valuesRedacted: true,
            cliOutputOmitted: true,
          },
        },
        null,
        2,
      ),
    );

    const result = await execFileResultForTest("node", [
      "scripts/teacher-auth-provider-readiness.mjs",
      "--live",
      "--approved",
      "--environment",
      "production",
      "--provider",
      "trusted-cookie-issuer",
      "--session-secret",
      "secret-session-signing-fixture-strong",
      "--issuer-secret",
      "secret-issuer-fixture-strong-enough",
      "--release-run-id",
      releaseRunId,
      "--vercel-env-sync",
      envSyncFile,
    ]);
    const body = result.stdout
      ? JSON.parse(result.stdout)
      : { stderr: result.stderr, stdout: "missing-json-evidence" };

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(body).toEqual(
      expect.objectContaining({
        target: "teacher-auth-provider-readiness",
        mode: "live",
        environment: "production",
        status: "blocked",
        authProviderMode: "trusted-cookie-issuer",
        blockedReasons: ["vercel-env-sync-apply-preflight-not-proven"],
        vercelEnvSyncEvidence: {
          target: "vercel-env-sync",
          status: "apply-preflight-missing",
          valueRedacted: true,
          applyPreflight: "missing",
          releaseRunIdStatus: "missing",
        },
      }),
    );
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        {
          id: "s19-vercel-env-sync-apply-evidence",
          responsibleSession: "S19",
          requiredEvidence: "vercel-env-sync",
          status: "apply-preflight-missing",
          valueRedacted: true,
        },
      ]),
    );
    expect(result.stdout).not.toContain("secret-session");
    expect(result.stdout).not.toContain("secret-issuer");
    expect(result.stdout).not.toContain(tmpDir);
    expect(result.stdout).not.toContain("/Users/");
  });

  it("blocks production readiness when Vercel env sync belongs to a different release run", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-auth-env-sync-run-binding-"));
    const envSyncFile = join(tmpDir, "vercel-env-sync.json");
    const releaseRunId = "uais-release-teacher-auth-run-binding";
    writeFileSync(
      envSyncFile,
      JSON.stringify(
        {
          target: "vercel-env-sync",
          mode: "apply",
          releaseRunId: "uais-release-teacher-auth-run-binding-other",
          authProviderMode: "trusted-cookie-issuer",
          projectReadinessEvidenceStatus: "ready",
          targets: ["production", "preview"],
          applySummary: {
            status: "applied",
            appliedActions: 4,
            appliedByTarget: { production: 2, preview: 2 },
            localOnlyEntriesSkipped: 2,
            valuesRedacted: true,
            cliOutputOmitted: true,
          },
          applyPreflight: {
            status: "passed",
            blockedReasons: [],
            valuesRedacted: true,
            cliSafeToInvoke: true,
          },
        },
        null,
        2,
      ),
    );

    const result = await execFileResultForTest("node", [
      "scripts/teacher-auth-provider-readiness.mjs",
      "--live",
      "--approved",
      "--environment",
      "production",
      "--provider",
      "trusted-cookie-issuer",
      "--session-secret",
      "secret-session-signing-fixture-strong",
      "--issuer-secret",
      "secret-issuer-fixture-strong-enough",
      "--release-run-id",
      releaseRunId,
      "--vercel-env-sync",
      envSyncFile,
    ]);
    const body = result.stdout
      ? JSON.parse(result.stdout)
      : { stderr: result.stderr, stdout: "missing-json-evidence" };

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(body).toEqual(
      expect.objectContaining({
        target: "teacher-auth-provider-readiness",
        mode: "live",
        environment: "production",
        status: "blocked",
        authProviderMode: "trusted-cookie-issuer",
        blockedReasons: ["vercel-env-sync-evidence-release-run-id-mismatch"],
        vercelEnvSyncEvidence: {
          target: "vercel-env-sync",
          status: "release-run-id-mismatch",
          valueRedacted: true,
          applyPreflight: "proved",
          releaseRunIdStatus: "mismatched",
        },
      }),
    );
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        {
          id: "s19-vercel-env-sync-apply-evidence",
          responsibleSession: "S19",
          requiredEvidence: "vercel-env-sync",
          status: "release-run-id-mismatch",
          valueRedacted: true,
        },
      ]),
    );
    expect(result.stdout).not.toContain("secret-session");
    expect(result.stdout).not.toContain("secret-issuer");
    expect(result.stdout).not.toContain(tmpDir);
    expect(result.stdout).not.toContain("/Users/");
  });

  it("blocks trusted-cookie production readiness without trusted route-chain proof", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-auth-route-chain-missing-"));
    const envSyncFile = join(tmpDir, "vercel-env-sync.json");
    const releaseRunId = "uais-release-teacher-auth-route-chain-missing";
    writeFileSync(
      envSyncFile,
      JSON.stringify(
        {
          target: "vercel-env-sync",
          mode: "apply",
          releaseRunId,
          authProviderMode: "trusted-cookie-issuer",
          projectReadinessEvidenceStatus: "ready",
          targets: ["production", "preview"],
          applySummary: {
            status: "applied",
            appliedActions: 4,
            appliedByTarget: { production: 2, preview: 2 },
            localOnlyEntriesSkipped: 2,
            valuesRedacted: true,
            cliOutputOmitted: true,
          },
          applyPreflight: {
            status: "passed",
            blockedReasons: [],
            valuesRedacted: true,
            cliSafeToInvoke: true,
          },
        },
        null,
        2,
      ),
    );

    const result = await execFileResultForTest("node", [
      "scripts/teacher-auth-provider-readiness.mjs",
      "--live",
      "--approved",
      "--environment",
      "production",
      "--provider",
      "trusted-cookie-issuer",
      "--session-secret",
      "secret-session-signing-fixture-strong",
      "--issuer-secret",
      "secret-issuer-fixture-strong-enough",
      "--release-run-id",
      releaseRunId,
      "--vercel-env-sync",
      envSyncFile,
    ]);
    const body = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(body).toEqual(
      expect.objectContaining({
        target: "teacher-auth-provider-readiness",
        mode: "live",
        environment: "production",
        status: "blocked",
        authProviderMode: "trusted-cookie-issuer",
        blockedReasons: ["trusted-teacher-auth-route-chain-not-proven"],
        trustedTeacherAuthRouteChainEvidence: {
          target: "missing",
          status: "missing",
          valueRedacted: true,
          authProvider: "missing",
          routeChain: "missing",
          issuerProofValidation: "missing",
          issuerCookieHardening: "missing",
          sessionCookiePair: "missing",
          downstreamAiSession: "missing",
          workflowAction: "missing",
          localTrustedCookieRouteWiring: "missing",
          redactionSafety: "missing",
        },
      }),
    );
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        {
          id: "s12-trusted-teacher-auth-route-chain-contract",
          responsibleSession: "S12",
          requiredEvidence: "trusted-teacher-auth-route-chain-contract",
          status: "missing",
          valueRedacted: true,
        },
      ]),
    );
    expect(result.stdout).not.toContain("secret-session");
    expect(result.stdout).not.toContain("secret-issuer");
    expect(result.stdout).not.toContain(tmpDir);
    expect(result.stdout).not.toContain("/Users/");
  });

  it("blocks trusted-cookie production readiness without deployed teacher-auth route smoke proof", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-auth-route-smoke-missing-"));
    const envSyncFile = join(tmpDir, "vercel-env-sync.json");
    const routeChainFile = join(tmpDir, "trusted-route-chain.json");
    const releaseRunId = "uais-release-teacher-auth-route-smoke-missing";
    writeFileSync(
      envSyncFile,
      JSON.stringify(
        {
          target: "vercel-env-sync",
          mode: "apply",
          releaseRunId,
          authProviderMode: "trusted-cookie-issuer",
          projectReadinessEvidenceStatus: "ready",
          targets: ["production", "preview"],
          applySummary: {
            status: "applied",
            appliedActions: 4,
            appliedByTarget: { production: 2, preview: 2 },
            localOnlyEntriesSkipped: 2,
            valuesRedacted: true,
            cliOutputOmitted: true,
          },
          applyPreflight: {
            status: "passed",
            blockedReasons: [],
            valuesRedacted: true,
            cliSafeToInvoke: true,
          },
        },
        null,
        2,
      ),
    );
    writeTrustedTeacherAuthRouteChainEvidenceForTest(routeChainFile);

    const result = await execFileResultForTest("node", [
      "scripts/teacher-auth-provider-readiness.mjs",
      "--live",
      "--approved",
      "--environment",
      "production",
      "--provider",
      "trusted-cookie-issuer",
      "--session-secret",
      "secret-session-signing-fixture-strong",
      "--issuer-secret",
      "secret-issuer-fixture-strong-enough",
      "--release-run-id",
      releaseRunId,
      "--vercel-env-sync",
      envSyncFile,
      "--trusted-teacher-auth-route-chain",
      routeChainFile,
    ]);
    const body = result.stdout
      ? JSON.parse(result.stdout)
      : { stderr: result.stderr, stdout: "missing-json-evidence" };

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(body).toEqual(
      expect.objectContaining({
        target: "teacher-auth-provider-readiness",
        mode: "live",
        environment: "production",
        status: "blocked",
        authProviderMode: "trusted-cookie-issuer",
        blockedReasons: ["trusted-teacher-auth-route-smoke-not-proven"],
        trustedTeacherAuthRouteSmokeEvidence: {
          target: "missing",
          status: "missing",
          valueRedacted: true,
          releaseRunIdStatus: "missing",
          deploymentBinding: "missing",
          teacherAuthIssuerRoute: "missing",
          issuedTeacherAiSessionRoute: "missing",
          responseHeaders: "missing",
          responseShape: "missing",
        },
      }),
    );
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        {
          id: "s22-trusted-teacher-auth-route-smoke",
          responsibleSession: "S22",
          requiredEvidence: "deployment-route-smoke",
          status: "missing",
          valueRedacted: true,
        },
      ]),
    );
    expect(result.stdout).not.toContain("secret-session");
    expect(result.stdout).not.toContain("secret-issuer");
    expect(result.stdout).not.toContain(tmpDir);
    expect(result.stdout).not.toContain("/Users/");
  });

  it("blocks trusted-cookie production readiness when deployed issued teacher AI session route fails", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-auth-session-route-failed-"));
    const envSyncFile = join(tmpDir, "vercel-env-sync.json");
    const routeChainFile = join(tmpDir, "trusted-route-chain.json");
    const routeSmokeFile = join(tmpDir, "route-smoke.json");
    const releaseRunId = "uais-release-teacher-auth-session-route-failed";
    writeFileSync(
      envSyncFile,
      JSON.stringify(
        {
          target: "vercel-env-sync",
          mode: "apply",
          releaseRunId,
          authProviderMode: "trusted-cookie-issuer",
          projectReadinessEvidenceStatus: "ready",
          targets: ["production", "preview"],
          applySummary: {
            status: "applied",
            appliedActions: 4,
            appliedByTarget: { production: 2, preview: 2 },
            localOnlyEntriesSkipped: 2,
            valuesRedacted: true,
            cliOutputOmitted: true,
          },
          applyPreflight: {
            status: "passed",
            blockedReasons: [],
            valuesRedacted: true,
            cliSafeToInvoke: true,
          },
        },
        null,
        2,
      ),
    );
    writeTrustedTeacherAuthRouteChainEvidenceForTest(routeChainFile);
    writeTrustedTeacherAuthRouteSmokeEvidenceForTest(routeSmokeFile, {
      releaseRunId,
      deploymentBindingStatus: "matched-via-domain-reachability",
      target: "deployment-route-smoke",
      teacherAiSessionRouteStatus: "failed",
    });

    const result = await execFileResultForTest("node", [
      "scripts/teacher-auth-provider-readiness.mjs",
      "--live",
      "--approved",
      "--environment",
      "production",
      "--provider",
      "trusted-cookie-issuer",
      "--session-secret",
      "secret-session-signing-fixture-strong",
      "--issuer-secret",
      "secret-issuer-fixture-strong-enough",
      "--release-run-id",
      releaseRunId,
      "--vercel-env-sync",
      envSyncFile,
      "--trusted-teacher-auth-route-chain",
      routeChainFile,
      "--route-smoke",
      routeSmokeFile,
    ]);
    const body = result.stdout
      ? JSON.parse(result.stdout)
      : { stderr: result.stderr, stdout: "missing-json-evidence" };

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(body).toEqual(
      expect.objectContaining({
        target: "teacher-auth-provider-readiness",
        mode: "live",
        environment: "production",
        status: "blocked",
        authProviderMode: "trusted-cookie-issuer",
        blockedReasons: ["trusted-teacher-auth-route-smoke-not-proven"],
        trustedTeacherAuthRouteSmokeEvidence: expect.objectContaining({
          target: "deployment-route-smoke",
          status: "not-proven",
          teacherAuthIssuerRoute: "proved",
          issuedTeacherAiSessionRoute: "missing",
        }),
      }),
    );
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        {
          id: "s22-trusted-teacher-auth-route-smoke",
          responsibleSession: "S22",
          requiredEvidence: "deployment-route-smoke",
          status: "not-proven",
          valueRedacted: true,
        },
      ]),
    );
    expect(result.stdout).not.toContain("secret-session");
    expect(result.stdout).not.toContain("secret-issuer");
    expect(result.stdout).not.toContain(tmpDir);
    expect(result.stdout).not.toContain("/Users/");
  });

  it("proves trusted-cookie live readiness with a redacted signed session round trip", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-auth-round-trip-"));
    const envSyncFile = join(tmpDir, "vercel-env-sync.json");
    const routeChainFile = join(tmpDir, "trusted-route-chain.json");
    const routeSmokeFile = join(tmpDir, "route-smoke.json");
    const releaseRunId = "uais-release-teacher-auth-round-trip";
    writeFileSync(
      envSyncFile,
      JSON.stringify(
        {
          target: "vercel-env-sync",
          mode: "apply",
          releaseRunId,
          authProviderMode: "trusted-cookie-issuer",
          projectReadinessEvidenceStatus: "ready",
          targets: ["production", "preview"],
          applySummary: {
            status: "applied",
            appliedActions: 4,
            appliedByTarget: { production: 2, preview: 2 },
            localOnlyEntriesSkipped: 2,
            valuesRedacted: true,
            cliOutputOmitted: true,
          },
          applyPreflight: {
            status: "passed",
            blockedReasons: [],
            valuesRedacted: true,
            cliSafeToInvoke: true,
          },
        },
        null,
        2,
      ),
    );
    writeTrustedTeacherAuthRouteChainEvidenceForTest(routeChainFile);
    writeTrustedTeacherAuthRouteSmokeEvidenceForTest(routeSmokeFile, {
      releaseRunId,
      deploymentBindingStatus: "matched-via-domain-reachability",
    });

    const result = await execFileResultForTest("node", [
      "scripts/teacher-auth-provider-readiness.mjs",
      "--live",
      "--approved",
      "--environment",
      "production",
      "--provider",
      "trusted-cookie-issuer",
      "--session-secret",
      "secret-session-signing-fixture-strong",
      "--issuer-secret",
      "secret-issuer-fixture-strong-enough",
      "--release-run-id",
      releaseRunId,
      "--vercel-env-sync",
      envSyncFile,
      "--trusted-teacher-auth-route-chain",
      routeChainFile,
      "--route-smoke",
      routeSmokeFile,
    ]);
    const body = result.stdout
      ? JSON.parse(result.stdout)
      : { stderr: result.stderr, stdout: "missing-json-evidence" };

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(body).toEqual(
      expect.objectContaining({
        target: "teacher-auth-provider-readiness",
        mode: "live",
        environment: "production",
        status: "ready",
        authProviderMode: "trusted-cookie-issuer",
        results: teacherAuthProviderReadinessResults,
        blockedReasons: [],
        trustedTeacherAuthRouteChainEvidence: {
          target: "trusted-teacher-auth-route-chain-contract",
          status: "proved",
          valueRedacted: true,
          authProvider: "trusted-cookie-issuer",
          routeChain: "proved",
          issuerProofValidation: "proved",
          issuerCookieHardening: "proved",
          sessionCookiePair: "proved",
          downstreamAiSession: "proved",
          workflowAction: "proved",
          localTrustedCookieRouteWiring: "proved",
          redactionSafety: "proved",
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
        safety: expect.objectContaining({
          valuesRedacted: true,
          secretsOmitted: true,
          cookiesOmitted: true,
        }),
      }),
    );
    expect(result.stdout).not.toContain("secret-session");
    expect(result.stdout).not.toContain("secret-issuer");
    expect(result.stdout).not.toContain("uais_teacher_auth_claims=");
    expect(result.stdout).not.toContain("uais_teacher_auth_signature=");
    expect(result.stdout).not.toContain(tmpDir);
    expect(result.stdout).not.toContain("/Users/");
  });

  it("accepts teacher-auth scoped Vercel env sync evidence for trusted-cookie production readiness", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-auth-scoped-env-sync-"));
    const envSyncFile = join(tmpDir, "vercel-env-sync.json");
    const routeChainFile = join(tmpDir, "trusted-route-chain.json");
    const routeSmokeFile = join(tmpDir, "route-smoke.json");
    const releaseRunId = "uais-release-teacher-auth-scoped-env-sync";
    writeFileSync(
      envSyncFile,
      JSON.stringify(
        {
          target: "vercel-env-sync",
          mode: "apply",
          deploymentScope: "teacher-auth",
          releaseRunId,
          authProviderMode: "trusted-cookie-issuer",
          projectReadinessEvidenceStatus: "ready",
          targets: ["production", "preview"],
          entries: [
            { name: "UAIS_LIVE_AI_APPROVAL_TOKEN", status: "present" },
            { name: "UAIS_AI_ACCESS_SIGNING_SECRET", status: "present" },
            { name: "UAIS_TEACHER_AUTH_PROVIDER", status: "present" },
            {
              name: "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
              status: "present",
            },
            { name: "UAIS_TEACHER_AUTH_ISSUER_SECRET", status: "present" },
          ],
          applySummary: {
            status: "applied",
            appliedEntries: 5,
            appliedActions: 10,
            appliedByTarget: { production: 5, preview: 5 },
            localOnlyEntriesSkipped: 2,
            valuesRedacted: true,
            apiOutputOmitted: true,
          },
          applyPreflight: {
            status: "passed",
            blockedReasons: [],
            valuesRedacted: true,
            cliSafeToInvoke: true,
          },
        },
        null,
        2,
      ),
    );
    writeTrustedTeacherAuthRouteChainEvidenceForTest(routeChainFile);
    writeTrustedTeacherAuthRouteSmokeEvidenceForTest(routeSmokeFile, {
      releaseRunId,
      deploymentBindingStatus: "matched-via-domain-reachability",
    });

    const result = await execFileResultForTest("node", [
      "scripts/teacher-auth-provider-readiness.mjs",
      "--live",
      "--approved",
      "--environment",
      "production",
      "--provider",
      "trusted-cookie-issuer",
      "--session-secret",
      "secret-session-signing-fixture-strong",
      "--issuer-secret",
      "secret-issuer-fixture-strong-enough",
      "--release-run-id",
      releaseRunId,
      "--vercel-env-sync",
      envSyncFile,
      "--trusted-teacher-auth-route-chain",
      routeChainFile,
      "--route-smoke",
      routeSmokeFile,
    ]);
    const body = result.stdout
      ? JSON.parse(result.stdout)
      : { stderr: result.stderr, stdout: "missing-json-evidence" };

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(body).toEqual(
      expect.objectContaining({
        target: "teacher-auth-provider-readiness",
        mode: "live",
        environment: "production",
        status: "ready",
        blockedReasons: [],
        vercelEnvSyncEvidence: {
          target: "vercel-env-sync",
          status: "matched",
          deploymentScope: "teacher-auth",
          valueRedacted: true,
          applyPreflight: "proved",
          releaseRunIdStatus: "matched",
        },
      }),
    );
    expect(result.stdout).not.toContain("secret-session");
    expect(result.stdout).not.toContain("secret-issuer");
    expect(result.stdout).not.toContain(tmpDir);
    expect(result.stdout).not.toContain("/Users/");
  });

  it("proves trusted-cookie live readiness from issuer-only route smoke before full route smoke runs", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-auth-issuer-only-readiness-"));
    const envSyncFile = join(tmpDir, "vercel-env-sync.json");
    const routeChainFile = join(tmpDir, "trusted-route-chain.json");
    const routeSmokeFile = join(tmpDir, "route-smoke.json");
    const releaseRunId = "uais-release-teacher-auth-issuer-only-readiness";
    writeFileSync(
      envSyncFile,
      JSON.stringify(
        {
          target: "vercel-env-sync",
          mode: "apply",
          releaseRunId,
          authProviderMode: "trusted-cookie-issuer",
          projectReadinessEvidenceStatus: "ready",
          targets: ["production", "preview"],
          applySummary: {
            status: "applied",
            appliedActions: 4,
            appliedByTarget: { production: 2, preview: 2 },
            localOnlyEntriesSkipped: 2,
            valuesRedacted: true,
            cliOutputOmitted: true,
          },
          applyPreflight: {
            status: "passed",
            blockedReasons: [],
            valuesRedacted: true,
            cliSafeToInvoke: true,
          },
        },
        null,
        2,
      ),
    );
    writeTrustedTeacherAuthRouteChainEvidenceForTest(routeChainFile);
    writeTrustedTeacherAuthRouteSmokeEvidenceForTest(routeSmokeFile, {
      releaseRunId,
      deploymentBindingStatus: "matched",
      omitTeacherAiSessionRoute: true,
    });

    const result = await execFileResultForTest("node", [
      "scripts/teacher-auth-provider-readiness.mjs",
      "--live",
      "--approved",
      "--environment",
      "production",
      "--provider",
      "trusted-cookie-issuer",
      "--session-secret",
      "secret-session-signing-fixture-strong",
      "--issuer-secret",
      "secret-issuer-fixture-strong-enough",
      "--release-run-id",
      releaseRunId,
      "--vercel-env-sync",
      envSyncFile,
      "--trusted-teacher-auth-route-chain",
      routeChainFile,
      "--route-smoke",
      routeSmokeFile,
    ]);
    const body = result.stdout
      ? JSON.parse(result.stdout)
      : { stderr: result.stderr, stdout: "missing-json-evidence" };

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(body).toEqual(
      expect.objectContaining({
        target: "teacher-auth-provider-readiness",
        mode: "live",
        environment: "production",
        status: "ready",
        blockedReasons: [],
        trustedTeacherAuthRouteSmokeEvidence: {
          target: "teacher-auth-issuer-route-smoke",
          status: "proved",
          valueRedacted: true,
          releaseRunIdStatus: "matched",
          deploymentBinding: "proved",
          teacherAuthIssuerRoute: "proved",
          issuedTeacherAiSessionRoute: "not-required-for-issuer-only",
          responseHeaders: "proved",
          responseShape: "proved",
        },
      }),
    );
    expect(result.stdout).not.toContain("secret-session");
    expect(result.stdout).not.toContain("secret-issuer");
    expect(result.stdout).not.toContain(tmpDir);
    expect(result.stdout).not.toContain("/Users/");
  });

  it("blocks trusted-cookie production readiness when route-chain omits issuer cookie hardening proof", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-auth-cookie-hardening-"));
    const envSyncFile = join(tmpDir, "vercel-env-sync.json");
    const routeChainFile = join(tmpDir, "trusted-route-chain.json");
    const releaseRunId = "uais-release-teacher-auth-cookie-hardening";
    writeFileSync(
      envSyncFile,
      JSON.stringify(
        {
          target: "vercel-env-sync",
          mode: "apply",
          releaseRunId,
          authProviderMode: "trusted-cookie-issuer",
          projectReadinessEvidenceStatus: "ready",
          targets: ["production", "preview"],
          applySummary: {
            status: "applied",
            appliedActions: 4,
            appliedByTarget: { production: 2, preview: 2 },
            localOnlyEntriesSkipped: 2,
            valuesRedacted: true,
            cliOutputOmitted: true,
          },
          applyPreflight: {
            status: "passed",
            blockedReasons: [],
            valuesRedacted: true,
            cliSafeToInvoke: true,
          },
        },
        null,
        2,
      ),
    );
    writeTrustedTeacherAuthRouteChainEvidenceForTest(routeChainFile, {
      issuerCookieHardening: undefined,
    });

    const result = await execFileResultForTest("node", [
      "scripts/teacher-auth-provider-readiness.mjs",
      "--live",
      "--approved",
      "--environment",
      "production",
      "--provider",
      "trusted-cookie-issuer",
      "--session-secret",
      "secret-session-signing-fixture-strong",
      "--issuer-secret",
      "secret-issuer-fixture-strong-enough",
      "--release-run-id",
      releaseRunId,
      "--vercel-env-sync",
      envSyncFile,
      "--trusted-teacher-auth-route-chain",
      routeChainFile,
    ]);
    const body = result.stdout
      ? JSON.parse(result.stdout)
      : { stderr: result.stderr, stdout: "missing-json-evidence" };

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(body).toEqual(
      expect.objectContaining({
        status: "blocked",
        authProviderMode: "trusted-cookie-issuer",
        blockedReasons: ["trusted-teacher-auth-route-chain-not-proven"],
        trustedTeacherAuthRouteChainEvidence: expect.objectContaining({
          status: "not-proven",
          issuerCookieHardening: "missing",
        }),
      }),
    );
    expect(result.stdout).not.toContain("secret-session");
    expect(result.stdout).not.toContain("secret-issuer");
    expect(result.stdout).not.toContain(tmpDir);
    expect(result.stdout).not.toContain("/Users/");
  });

  it("blocks trusted-cookie production readiness when route-chain omits issuer proof validation evidence", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-auth-proof-validation-"));
    const envSyncFile = join(tmpDir, "vercel-env-sync.json");
    const routeChainFile = join(tmpDir, "trusted-route-chain.json");
    const releaseRunId = "uais-release-teacher-auth-proof-validation";
    writeFileSync(
      envSyncFile,
      JSON.stringify(
        {
          target: "vercel-env-sync",
          mode: "apply",
          releaseRunId,
          authProviderMode: "trusted-cookie-issuer",
          projectReadinessEvidenceStatus: "ready",
          targets: ["production", "preview"],
          applySummary: {
            status: "applied",
            appliedActions: 4,
            appliedByTarget: { production: 2, preview: 2 },
            localOnlyEntriesSkipped: 2,
            valuesRedacted: true,
            cliOutputOmitted: true,
          },
          applyPreflight: {
            status: "passed",
            blockedReasons: [],
            valuesRedacted: true,
            cliSafeToInvoke: true,
          },
        },
        null,
        2,
      ),
    );
    writeTrustedTeacherAuthRouteChainEvidenceForTest(routeChainFile, {
      issuerProofValidation: undefined,
    });

    const result = await execFileResultForTest("node", [
      "scripts/teacher-auth-provider-readiness.mjs",
      "--live",
      "--approved",
      "--environment",
      "production",
      "--provider",
      "trusted-cookie-issuer",
      "--session-secret",
      "secret-session-signing-fixture-strong",
      "--issuer-secret",
      "secret-issuer-fixture-strong-enough",
      "--release-run-id",
      releaseRunId,
      "--vercel-env-sync",
      envSyncFile,
      "--trusted-teacher-auth-route-chain",
      routeChainFile,
    ]);
    const body = result.stdout
      ? JSON.parse(result.stdout)
      : { stderr: result.stderr, stdout: "missing-json-evidence" };

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(body).toEqual(
      expect.objectContaining({
        status: "blocked",
        authProviderMode: "trusted-cookie-issuer",
        blockedReasons: ["trusted-teacher-auth-route-chain-not-proven"],
        trustedTeacherAuthRouteChainEvidence: expect.objectContaining({
          status: "not-proven",
          issuerProofValidation: "missing",
        }),
      }),
    );
    expect(result.stdout).not.toContain("secret-session");
    expect(result.stdout).not.toContain("secret-issuer");
    expect(result.stdout).not.toContain(tmpDir);
    expect(result.stdout).not.toContain("/Users/");
  });

  it("blocks live production readiness without a release-run id before issuing reusable auth evidence", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-auth-release-run-missing-"));
    const envSyncFile = join(tmpDir, "vercel-env-sync.json");
    const routeChainFile = join(tmpDir, "trusted-route-chain.json");
    writeFileSync(
      envSyncFile,
      JSON.stringify(
        {
          target: "vercel-env-sync",
          mode: "apply",
          authProviderMode: "trusted-cookie-issuer",
          projectReadinessEvidenceStatus: "ready",
          targets: ["production", "preview"],
          applySummary: {
            status: "applied",
            appliedActions: 4,
            appliedByTarget: { production: 2, preview: 2 },
            localOnlyEntriesSkipped: 2,
            valuesRedacted: true,
            cliOutputOmitted: true,
          },
          applyPreflight: {
            status: "passed",
            blockedReasons: [],
            valuesRedacted: true,
            cliSafeToInvoke: true,
          },
        },
        null,
        2,
      ),
    );
    writeTrustedTeacherAuthRouteChainEvidenceForTest(routeChainFile);

    const result = await execFileResultForTest("node", [
      "scripts/teacher-auth-provider-readiness.mjs",
      "--live",
      "--approved",
      "--environment",
      "production",
      "--provider",
      "trusted-cookie-issuer",
      "--session-secret",
      "secret-session-signing-fixture-strong",
      "--issuer-secret",
      "secret-issuer-fixture-strong-enough",
      "--vercel-env-sync",
      envSyncFile,
      "--trusted-teacher-auth-route-chain",
      routeChainFile,
    ]);
    const body = result.stdout
      ? JSON.parse(result.stdout)
      : { stderr: result.stderr, stdout: "missing-json-evidence" };

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(body).toEqual(
      expect.objectContaining({
        target: "teacher-auth-provider-readiness",
        mode: "live",
        environment: "production",
        status: "blocked",
        authProviderMode: "trusted-cookie-issuer",
        blockedReasons: ["teacher-auth-provider-release-run-id-missing"],
        vercelEnvSyncEvidence: {
          target: "vercel-env-sync",
          status: "matched",
          valueRedacted: true,
          applyPreflight: "proved",
          releaseRunIdStatus: "missing",
        },
        trustedTeacherAuthRouteChainEvidence: expect.objectContaining({
          status: "proved",
        }),
      }),
    );
    expect(body).not.toHaveProperty("releaseRunId");
    expect(result.stdout).not.toContain("secret-session");
    expect(result.stdout).not.toContain("secret-issuer");
    expect(result.stdout).not.toContain(tmpDir);
    expect(result.stdout).not.toContain("/Users/");
  });

  it("blocks trusted-cookie readiness when session and issuer secrets are not separated", () => {
    const sharedSecret = "secret-shared-teacher-auth-fixture-strong-enough";
    let output = "";
    expect(() => {
      try {
        execFileSync("node", [
          "scripts/teacher-auth-provider-readiness.mjs",
          "--live",
          "--approved",
          "--environment",
          "production",
          "--provider",
          "trusted-cookie-issuer",
          "--session-secret",
          sharedSecret,
          "--issuer-secret",
          sharedSecret,
        ], {
          cwd: process.cwd(),
          encoding: "utf8",
          stdio: "pipe",
        });
      } catch (error) {
        output = String((error as { stdout?: unknown }).stdout ?? "");
        throw error;
      }
    }).toThrow();
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        status: "blocked",
        authProviderMode: "trusted-cookie-issuer",
        trustedIssuerContract: expect.objectContaining({
          issuerSecretStrength: "sufficient",
          sessionIssuerSecretSeparation: "missing",
        }),
        blockedReasons: expect.arrayContaining([
          "teacher-auth-session-issuer-secret-separation-not-proven",
        ]),
      }),
    );
    expect(output).not.toContain(sharedSecret);
    expect(output).not.toContain("secret-shared");
    expect(output).not.toContain("/Users/");
  });

  it("blocks non-production OIDC live readiness before JWKS proof can become reusable", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/jwks.json") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ keys: [{ kid: "metadata-only" }] }));
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected test JWKS server to listen on a TCP port.");
      }
      const jwksUrl = `http://127.0.0.1:${address.port}/jwks.json`;

      let stdout = "";
      await expect(
        execFileAsync(
          "node",
          [
            "scripts/teacher-auth-provider-readiness.mjs",
            "--live",
            "--approved",
            "--environment",
            "preview",
            "--provider",
            "oidc-jwks",
            "--base-url",
            `http://127.0.0.1:${address.port}/issuer`,
            "--jwks-url",
            jwksUrl,
            "--audience",
            "uais-teacher-workflow",
            "--teacher-id-claim",
            "sub",
            "--session-secret",
            "secret-session-signing-fixture-strong",
          ],
          {
            cwd: process.cwd(),
            encoding: "utf8",
          },
        ).catch((error: unknown) => {
          stdout = String((error as { stdout?: unknown }).stdout ?? "");
          throw error;
        }),
      ).rejects.toThrow();

      const body = JSON.parse(stdout);
      expect(body).toEqual(
        expect.objectContaining({
          status: "blocked",
          environment: "preview",
          blockedReasons: expect.arrayContaining([
            "teacher-auth-provider-readiness-not-production",
          ]),
        }),
      );
      expect(body).not.toHaveProperty("oidcJwksReadiness");
      expect(stdout).not.toContain(jwksUrl);
      expect(stdout).not.toContain("secret-session");
      expect(stdout).not.toContain("/Users/");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});

function writeTrustedTeacherAuthRouteChainEvidenceForTest(
  routeChainFile: string,
  options: {
    issuerProofValidation?:
      | {
          maxLifetimeSeconds: number;
          rejectsFutureIssuedAt: boolean;
          rejectsExpiresBeforeIssuedAt: boolean;
          rejectsOverlongLifetime: boolean;
          valuesRedacted: boolean;
        }
      | undefined;
    issuerCookieHardening?:
      | {
          httpOnly: string;
          sameSite: string;
          secureInProduction: boolean;
          path: string;
          maxAge: string;
          priority: string;
          valuesRedacted: boolean;
        }
      | undefined;
  } = {},
) {
  const issuerProofValidation =
    "issuerProofValidation" in options
      ? options.issuerProofValidation
      : {
          maxLifetimeSeconds: 300,
          rejectsFutureIssuedAt: true,
          rejectsExpiresBeforeIssuedAt: true,
          rejectsOverlongLifetime: true,
          valuesRedacted: true,
        };
  const issuerCookieHardening =
    "issuerCookieHardening" in options
      ? options.issuerCookieHardening
      : {
          httpOnly: "required",
          sameSite: "lax",
          secureInProduction: true,
          path: "/",
          maxAge: "bounded-by-session-ttl",
          priority: "High",
          valuesRedacted: true,
        };

  writeFileSync(
    routeChainFile,
    JSON.stringify(
      {
        target: "trusted-teacher-auth-route-chain-contract",
        status: "proved-locally",
        evidence: {
          routeChain: ["/api/ai/teacher-auth/issue", "/api/ai/session"],
          authProvider: "trusted-cookie-issuer",
          ...(issuerProofValidation ? { issuerProofValidation } : {}),
          ...(issuerCookieHardening ? { issuerCookieHardening } : {}),
          sessionCookiePair: [
            "uais_teacher_auth_claims",
            "uais_teacher_auth_signature",
          ],
          downstreamAiSession: "scoped-teacher-ai-session-issued",
          workflowAction: "ppt-narration-submit",
        },
        releaseImpact: {
          localTrustedCookieRouteWiring: "proved",
          releaseGateEligible: false,
        },
        safety: {
          secretsRedacted: true,
          cookieValuesOmitted: true,
          sessionIdsOmitted: true,
          commandOutputOmitted: true,
          localPrivatePathsOmitted: true,
          productionMutationPerformed: false,
        },
      },
      null,
      2,
    ),
  );
}

function writeTrustedTeacherAuthRouteSmokeEvidenceForTest(
  routeSmokeFile: string,
  {
    releaseRunId,
    deploymentBindingStatus = "matched",
    target = "teacher-auth-issuer-route-smoke",
    teacherAiSessionRouteStatus = "ok",
    omitTeacherAiSessionRoute = false,
  }: {
    releaseRunId: string;
    deploymentBindingStatus?: "matched" | "matched-via-domain-reachability";
    target?: "teacher-auth-issuer-route-smoke" | "deployment-route-smoke";
    teacherAiSessionRouteStatus?: "ok" | "failed";
    omitTeacherAiSessionRoute?: boolean;
  },
) {
  const results = [
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
  ];
  if (!omitTeacherAiSessionRoute) {
    results.push({
      id: "s22-teacher-ai-session-route",
      route: "/api/ai/session",
      auth: "issued-teacher-auth-cookie",
      status: teacherAiSessionRouteStatus,
      httpStatus: teacherAiSessionRouteStatus === "ok" ? 200 : 403,
      responseShape:
        teacherAiSessionRouteStatus === "ok"
          ? {
              checked: true,
              status: "ok",
              requiredFields: {
                accessSession: "present",
                accessPlan: "present",
                authProviderContract: "present",
                s12TeacherAiSessionBoundary: "present",
                signedContractDirectCallDenied: "present",
              },
            }
          : {
              checked: true,
              status: "skipped",
              requiredFields: {},
            },
    });
  }
  writeFileSync(
    routeSmokeFile,
    JSON.stringify(
      {
        target,
        mode: "live",
        environment: "production",
        releaseRunId,
        authProviderMode: "trusted-cookie-issuer",
        status: "passed",
        vercelProductionDeploymentEvidence: {
          target: "vercel-production-deployment",
          status: deploymentBindingStatus,
          deploymentObservationStatus: "observed",
          releaseRunIdStatus: "matched",
          valueRedacted: true,
          ...(deploymentBindingStatus === "matched-via-domain-reachability"
            ? { deploymentDomainReachabilityStatus: "matched" }
            : {}),
        },
        results,
      },
      null,
      2,
    ),
  );
}

async function execFileResultForTest(command: string, args: string[]) {
  try {
    const output = await execFileAsync(command, args, {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    return {
      exitCode: 0,
      stdout: output.stdout,
      stderr: output.stderr,
    };
  } catch (error: unknown) {
    const candidate = error as {
      code?: unknown;
      stdout?: unknown;
      stderr?: unknown;
    };
    return {
      exitCode: typeof candidate.code === "number" ? candidate.code : 1,
      stdout: String(candidate.stdout ?? ""),
      stderr: String(candidate.stderr ?? ""),
    };
  }
}
