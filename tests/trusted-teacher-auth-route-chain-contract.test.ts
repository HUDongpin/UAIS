import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("trusted teacher auth route-chain contract evidence", () => {
  it("emits redacted local route-chain proof when the regression command passes", () => {
    const fakeBinDir = mkdtempSync(join(tmpdir(), "uais-auth-route-chain-"));
    const fakeNpm = join(fakeBinDir, "npm");
    const invocationLog = join(fakeBinDir, "npm-invocations.log");
    writeFileSync(
      fakeNpm,
      [
        "#!/bin/sh",
        `echo "$@" >> "${invocationLog}"`,
        "echo 'passing with secret-cookie-value and /Users/private/auth-proof'",
        "exit 0",
        "",
      ].join("\n"),
    );
    chmodSync(fakeNpm, 0o755);

    const output = execFileSync("node", [
      "scripts/trusted-teacher-auth-route-chain-contract.mjs",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
      },
    });
    const body = JSON.parse(output);
    const invocations = readFileSync(invocationLog, "utf8");

    expect(body).toEqual(
      expect.objectContaining({
        target: "trusted-teacher-auth-route-chain-contract",
        status: "proved-locally",
        responsibleSessions: ["S12", "S22"],
        scope: "local-route-contract-regression",
        command: {
          status: "passed",
          stdoutOmitted: true,
          stderrOmitted: true,
        },
        evidence: {
          routeChain: ["/api/ai/teacher-auth/issue", "/api/ai/session"],
          authProvider: "trusted-cookie-issuer",
          providerContract: "production-ready-with-fixture-secrets",
          issuerProof: "signed-admin-ai-access-plus-trusted-issuer-proof",
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
          scopes: [
            "teacherIds",
            "courseIds",
            "sampleAssetIds",
            "pptAssetIds",
            "voiceRefIds",
          ],
        },
        releaseImpact: {
          localTrustedCookieRouteWiring: "proved",
          productionTeacherAuthReadiness:
            "still-blocked-without-owner-approved-vercel-env-and-live-route-smoke",
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
      }),
    );
    expect(invocations).toContain(
      'run test -- tests/ai-api-routes.test.ts -t uses issued trusted teacher auth cookies',
    );
    expect(output).not.toContain("secret-cookie-value");
    expect(output).not.toContain("/Users/private/auth-proof");
    expect(output).not.toContain(fakeBinDir);
    expect(output).not.toContain("/Users/");
  });

  it("blocks without leaking output when the route-chain regression fails", () => {
    const fakeBinDir = mkdtempSync(join(tmpdir(), "uais-auth-route-chain-fail-"));
    const fakeNpm = join(fakeBinDir, "npm");
    writeFileSync(
      fakeNpm,
      [
        "#!/bin/sh",
        "echo 'failure with secret-cookie-value and /Users/private/auth-proof' >&2",
        "exit 1",
        "",
      ].join("\n"),
    );
    chmodSync(fakeNpm, 0o755);

    const output = execFileSync("node", [
      "scripts/trusted-teacher-auth-route-chain-contract.mjs",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
      },
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "trusted-teacher-auth-route-chain-contract",
        status: "blocked",
        command: {
          status: "failed",
          stdoutOmitted: true,
          stderrOmitted: true,
        },
        blockedReasons: ["trusted-teacher-auth-route-chain-regression-failed"],
      }),
    );
    expect(output).not.toContain("secret-cookie-value");
    expect(output).not.toContain("/Users/private/auth-proof");
    expect(output).not.toContain(fakeBinDir);
    expect(output).not.toContain("/Users/");
  });
});
