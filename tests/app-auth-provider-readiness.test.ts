import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appAuthProviderReadinessResults = {
  appAuthProviderModeTrusted: "passed",
  appAuthProviderEndpointRemoteHttps: "passed",
  appAuthSessionCookieContract: "passed",
  appAuthProviderVercelEnvSync: "passed",
  trustedAccountProviderContract: "passed",
  appAuthReadinessSafety: "passed",
};

describe("app auth provider production readiness evidence", () => {
  it("prints a redacted trusted-account dry-run contract without proving production readiness", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-app-auth-readiness-"));
    const envFile = join(tmpDir, "app-auth.env");
    writeFileSync(
      envFile,
      [
        "UAIS_APP_SESSION_SIGNING_SECRET=secret-app-session-signing-fixture-strong",
        "UAIS_APP_AUTH_PROVIDER=trusted-account-provider",
        "UAIS_APP_AUTH_PROVIDER_URL=https://accounts.example.test/uais/authenticate",
        "UAIS_APP_AUTH_PROVIDER_TOKEN=secret-app-auth-provider-token-strong",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/app-auth-provider-readiness.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--release-run-id",
      "uais-release-app-auth-readiness",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "app-auth-provider-readiness",
        mode: "dry-run",
        environment: "production",
        network: "disabled",
        status: "blocked",
        releaseRunId: "uais-release-app-auth-readiness",
        responsibleSession: "S12/S19/S22",
        appAuthProviderMode: "trusted-account-provider",
        endpointSecurity: "remote-https",
        blockedReasons: ["app-auth-provider-live-readiness-not-run"],
        appSessionCookieContract: expect.objectContaining({
          signingSecretStrength: "sufficient",
          httpOnly: "required",
          sameSite: "lax",
          secureInProduction: true,
          maxAgeBounded: true,
          valueRedacted: true,
        }),
        trustedAccountProviderContract: {
          providerKind: "trusted-account-provider",
          endpoint: "configured",
          bearerCredential: "configured",
          accessTokenStrength: "sufficient",
          requestMethod: "POST",
          responseUserShape: ["account", "role", "displayName", "department"],
          valueRedacted: true,
        },
        safety: expect.objectContaining({
          valuesRedacted: true,
          secretsOmitted: true,
          passwordsOmitted: true,
          providerUrlsOmitted: true,
          responseBodiesOmitted: true,
          localPrivatePathsOmitted: true,
          liveRequiresApproval: true,
          cookieValuesOmitted: true,
          remoteMutationRequiresApproval: true,
        }),
      }),
    );
    expect(body.appSessionCookieContract.cookiePair).toEqual([
      expect.objectContaining({
        name: "uais_app_session",
        purpose: "signed-app-session-claims",
        valueRedacted: true,
      }),
      expect.objectContaining({
        name: "uais_app_session_signature",
        purpose: "hmac-sha256-signature",
        valueRedacted: true,
      }),
    ]);
    expect(output).not.toContain("secret-app-session");
    expect(output).not.toContain("secret-app-auth-provider-token");
    expect(output).not.toContain("accounts.example.test");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("app-auth.env");
    expect(output).not.toContain("/Users/");
  });

  it("blocks production local-demo app auth provider readiness", () => {
    const output = execFileSync("node", [
      "scripts/app-auth-provider-readiness.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--provider",
      "local-demo",
      "--session-secret",
      "secret-app-session-signing-fixture-strong",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "app-auth-provider-readiness",
        status: "blocked",
        appAuthProviderMode: "local-demo",
        blockedReasons: expect.arrayContaining([
          "app-auth-provider-local-demo-not-production",
          "app-auth-provider-live-readiness-not-run",
        ]),
      }),
    );
    expect(output).not.toContain("secret-app-session");
    expect(output).not.toContain("/Users/");
  });

  it("reports local-production trusted-account readiness without making it production-gate eligible", () => {
    const output = execFileSync("node", [
      "scripts/app-auth-provider-readiness.mjs",
      "--live",
      "--approved",
      "--environment",
      "local-production",
      "--provider",
      "trusted-account-provider",
      "--session-secret",
      "secret-app-session-signing-fixture-strong",
      "--provider-url",
      "http://127.0.0.1:43123/app-auth",
      "--provider-token",
      "secret-app-auth-provider-token-strong",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "app-auth-provider-readiness",
        mode: "live",
        environment: "local-production",
        status: "ready",
        appAuthProviderMode: "trusted-account-provider",
        endpointSecurity: "local-loopback",
        blockedReasons: [],
        safety: expect.objectContaining({
          productionGateEligible: false,
          providerNetworkCallPerformed: false,
        }),
      }),
    );
    expect(output).not.toContain("secret-app-session");
    expect(output).not.toContain("secret-app-auth-provider-token");
    expect(output).not.toContain("127.0.0.1");
    expect(output).not.toContain("/Users/");
  });

  it("rejects live production readiness without explicit owner approval", () => {
    expect(() =>
      execFileSync("node", [
        "scripts/app-auth-provider-readiness.mjs",
        "--live",
        "--environment",
        "production",
        "--provider",
        "trusted-account-provider",
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).toThrow("explicit owner approval");
  });

  it("blocks live production readiness until matching Vercel env sync evidence is supplied", () => {
    let output = "";
    expect(() => {
      try {
        execFileSync("node", [
          "scripts/app-auth-provider-readiness.mjs",
          "--live",
          "--approved",
          "--environment",
          "production",
          "--provider",
          "trusted-account-provider",
          "--session-secret",
          "secret-app-session-signing-fixture-strong",
          "--provider-url",
          "https://accounts.example.test/uais/authenticate",
          "--provider-token",
          "secret-app-auth-provider-token-strong",
          "--release-run-id",
          "uais-release-app-auth-readiness",
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
        target: "app-auth-provider-readiness",
        mode: "live",
        environment: "production",
        status: "blocked",
        blockedReasons: ["vercel-env-sync-evidence-missing"],
        vercelEnvSyncEvidence: {
          target: "missing",
          status: "missing",
          valueRedacted: true,
          releaseRunIdStatus: "missing",
        },
      }),
    );
    expect(output).not.toContain("secret-app-session");
    expect(output).not.toContain("secret-app-auth-provider-token");
    expect(output).not.toContain("accounts.example.test");
    expect(output).not.toContain("/Users/");
  });

  it("emits app-auth result proof keys for live production readiness", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-app-auth-ready-results-"));
    const envSyncFile = join(tmpDir, "vercel-env-sync.json");
    const releaseRunId = "uais-release-app-auth-results";
    writeFileSync(
      envSyncFile,
      JSON.stringify(
        {
          target: "vercel-env-sync",
          mode: "apply",
          releaseRunId,
          appAuthProviderMode: "trusted-account-provider",
          projectReadinessEvidenceStatus: "ready",
          targets: ["production", "preview"],
          applySummary: {
            status: "applied",
            appliedActions: 4,
            appliedByTarget: { production: 2, preview: 2 },
            localOnlyEntriesSkipped: 0,
            valuesRedacted: true,
            cliOutputOmitted: true,
          },
          applyPreflight: {
            status: "passed",
            blockedReasons: [],
            valuesRedacted: true,
            cliSafeToInvoke: true,
          },
          entries: [
            { name: "UAIS_APP_SESSION_SIGNING_SECRET" },
            { name: "UAIS_APP_AUTH_PROVIDER" },
            { name: "UAIS_APP_AUTH_PROVIDER_URL" },
            { name: "UAIS_APP_AUTH_PROVIDER_TOKEN" },
          ],
        },
        null,
        2,
      ),
    );

    const output = execFileSync("node", [
      "scripts/app-auth-provider-readiness.mjs",
      "--live",
      "--approved",
      "--environment",
      "production",
      "--provider",
      "trusted-account-provider",
      "--session-secret",
      "secret-app-session-signing-fixture-strong",
      "--provider-url",
      "https://accounts.example.test/uais/authenticate",
      "--provider-token",
      "secret-app-auth-provider-token-strong",
      "--release-run-id",
      releaseRunId,
      "--vercel-env-sync",
      envSyncFile,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "app-auth-provider-readiness",
        mode: "live",
        environment: "production",
        status: "ready",
        results: appAuthProviderReadinessResults,
        blockedReasons: [],
      }),
    );
    expect(output).not.toContain("secret-app-session");
    expect(output).not.toContain("secret-app-auth-provider-token");
    expect(output).not.toContain("accounts.example.test");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  // The launch selector. It authenticates against the uais_users rows on the
  // core database this deployment already runs, so it reads neither the
  // provider endpoint nor the provider token - and until now this script
  // normalized it to "unsupported" and demanded both, which failed the one
  // configuration that can actually serve a cohort.
  it("accepts the database-accounts selector on the core database alone, without a provider endpoint or token", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-app-auth-database-accounts-"));
    const envFile = join(tmpDir, "app-auth.env");
    writeFileSync(
      envFile,
      [
        "UAIS_APP_SESSION_SIGNING_SECRET=secret-app-session-signing-fixture-strong",
        "UAIS_APP_AUTH_PROVIDER=database-accounts",
        "UAIS_CORE_DATABASE_URL=postgres://uais:secret-core-db@db.example.test/uais",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/app-auth-provider-readiness.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.appAuthProviderMode).toBe("database-accounts");
    expect(body.databaseAccountProviderContract).toEqual(
      expect.objectContaining({
        providerKind: "database-accounts",
        source: "uais-core-database",
        accountTable: "uais_users",
        coreDatabase: "configured",
        externalProviderRequired: false,
        valueRedacted: true,
      }),
    );
    // The only remaining blocker is "this was a dry-run" - not a missing
    // endpoint, and not a missing token.
    expect(body.blockedReasons).toEqual(["app-auth-provider-live-readiness-not-run"]);
    expect(body.results.appAuthProviderModeTrusted).toBe("passed");
    // No endpoint exists to be remote-https: the account lookup never leaves
    // the deployment.
    expect(body.results.appAuthProviderEndpointRemoteHttps).toBe("passed");
    expect(output).not.toContain("secret-core-db");
    expect(output).not.toContain("db.example.test");
    expect(output).not.toContain(tmpDir);
  });

  it("blocks the database-accounts selector when no core database is configured", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-app-auth-database-accounts-missing-"));
    const envFile = join(tmpDir, "app-auth.env");
    writeFileSync(
      envFile,
      [
        "UAIS_APP_SESSION_SIGNING_SECRET=secret-app-session-signing-fixture-strong",
        "UAIS_APP_AUTH_PROVIDER=database-accounts",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/app-auth-provider-readiness.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, UAIS_CORE_DATABASE_URL: "", DATABASE_URL: "", POSTGRES_URL: "" },
    });
    const body = JSON.parse(output);

    expect(body.blockedReasons).toContain(
      "app-auth-database-accounts-core-database-missing",
    );
    expect(body.databaseAccountProviderContract.coreDatabase).toBe("missing");
  });

  // Flipping the selector on against an empty uais_users passes every other
  // check in the chain and fails every single login, so "I could not read the
  // roster" has to be said out loud rather than read as a pass.
  it("warns that roster seeding is unverified when the roster was not probed", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-app-auth-roster-unverified-"));
    const envFile = join(tmpDir, "app-auth.env");
    writeFileSync(
      envFile,
      [
        "UAIS_APP_SESSION_SIGNING_SECRET=secret-app-session-signing-fixture-strong",
        "UAIS_APP_AUTH_PROVIDER=database-accounts",
        "UAIS_CORE_DATABASE_URL=postgres://uais:secret-core-db@db.example.test/uais",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/app-auth-provider-readiness.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.warnings).toEqual(["unverified: roster seeding"]);
    expect(body.databaseAccountProviderContract.rosterSeeding).toEqual({
      status: "unverified",
      reason: "roster-probe-not-requested",
      valueRedacted: true,
    });
    // Unverified never reads as proved.
    expect(body.results.trustedAccountProviderContract).toBe("blocked");
  });

  it("reports the roster as unverified rather than seeded when the database cannot be reached", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-app-auth-roster-unreachable-"));
    const envFile = join(tmpDir, "app-auth.env");
    writeFileSync(
      envFile,
      [
        "UAIS_APP_SESSION_SIGNING_SECRET=secret-app-session-signing-fixture-strong",
        "UAIS_APP_AUTH_PROVIDER=database-accounts",
        // Reserved by RFC 6761 and never resolvable, so the probe fails the
        // way an unreachable production database would.
        "UAIS_CORE_DATABASE_URL=postgres://uais:secret-core-db@uais-core.invalid:5432/uais",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/app-auth-provider-readiness.mjs",
      "--dry-run",
      "--roster-probe",
      "--environment",
      "production",
      "--env-file",
      envFile,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.databaseAccountProviderContract.rosterSeeding).toEqual({
      status: "unverified",
      reason: "core-database-unreachable",
      valueRedacted: true,
    });
    expect(body.warnings).toEqual(["unverified: roster seeding"]);
    expect(output).not.toContain("secret-core-db");
    expect(output).not.toContain("uais-core.invalid");
  });

  // The flag is live on production right now, and no script in the release
  // chain refused it.
  it("hard-blocks a production target that carries the demo-auth escape hatch", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-app-auth-demo-flag-"));
    const envFile = join(tmpDir, "app-auth.env");
    writeFileSync(
      envFile,
      [
        "UAIS_APP_SESSION_SIGNING_SECRET=secret-app-session-signing-fixture-strong",
        "UAIS_APP_AUTH_PROVIDER=database-accounts",
        "UAIS_CORE_DATABASE_URL=postgres://uais:secret-core-db@db.example.test/uais",
        "UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH=1",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/app-auth-provider-readiness.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.blockedReasons).toContain("app-auth-production-demo-auth-flag-set");
    expect(body.productionDemoAuthFlag).toEqual({
      status: "set",
      requiredForProduction: "unset",
      valueRedacted: true,
    });
  });
});
