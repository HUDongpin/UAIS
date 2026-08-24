import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  assessUaisStagingProtectionDifferential,
  assessUaisStagingRemoteHealth,
  createUaisStagingHostFingerprint,
  runUaisStagingRemotePreflight,
} from "../scripts/lib/p2-staging-remote-attestation.mjs";

const candidateGitSha = "a".repeat(40);
const candidateContentSha = "b".repeat(64);
const hostname = "uais-staging-current-team.vercel.app";
const baseUrl = `https://${hostname}`;

function healthyBody(overrides: Record<string, unknown> = {}) {
  return {
    status: "ok",
    checks: { app: "ok", database: "ok", migrations: "ok" },
    deploymentBinding: {
      status: "bound",
      lane: "isolated-staging",
      project: "uais-staging",
      stagingInpRum: "disabled",
      candidateGitSha,
      candidateContentSha,
      deploymentHostFingerprint: createUaisStagingHostFingerprint(hostname),
      valuesRedacted: true,
      ...overrides,
    },
  };
}

function assess(body = healthyBody()) {
  return assessUaisStagingRemoteHealth({
    httpStatus: 200,
    body,
    baseUrl,
    candidateGitSha,
    candidateContentSha,
    stagingInpRum: "disabled",
  });
}

function deploymentProtectionChallenge(status = 401) {
  return new Response("test-only Vercel Authentication challenge", {
    status,
    headers: {
      "cache-control": "no-store, max-age=0",
      "content-type": "text/html; charset=utf-8",
      ...(status >= 300 && status < 400
        ? {
            location:
              "https://vercel.com/sso-api?url=https%3A%2F%2Fexample.invalid%2F",
          }
        : {}),
      server: "Vercel",
      "set-cookie":
        "_vercel_sso_nonce=test-only-nonce-value-1234; Max-Age=3600; Path=/; Secure; HttpOnly; SameSite=Lax",
      "x-frame-options": "DENY",
      "x-robots-tag": "noindex",
      "x-vercel-id": "hkg1::test-1787587200000-abc123",
    },
  });
}

function deploymentProtectionRedirectChallenge(
  location = `https://vercel.com/sso-api?url=${encodeURIComponent(
    `${baseUrl}/healthz`,
  )}&nonce=test-only-redirect-nonce-1234`,
) {
  const headers = new Headers(deploymentProtectionChallenge().headers);
  headers.set("location", location);
  return new Response("test-only Vercel Authentication redirect", {
    status: 302,
    headers,
  });
}

function healthyResponse() {
  return new Response(JSON.stringify(healthyBody()), {
    status: 200,
    headers: {
      "content-type": "application/json",
      server: "Vercel",
      "x-vercel-id": "hkg1::test-1787587200001-def456",
    },
  });
}

function preflightOptions(fetchImpl: typeof fetch, overrides = {}) {
  return {
    fetchImpl,
    baseUrl,
    immutableDeploymentUrl: baseUrl,
    bypassSecret: "test-only-bypass-secret",
    candidateGitSha,
    candidateContentSha,
    stagingInpRum: "disabled",
    ...overrides,
  };
}

describe("P2 isolated staging remote attestation", () => {
  it("accepts only a healthy exact same-SHA/content/host binding", () => {
    expect(assess()).toEqual({
      status: "PASS",
      failureCodes: [],
      checks: {
        applicationHealth: "PASS",
        deploymentBinding: "PASS",
        candidateGitSha: "PASS",
        candidateContentSha: "PASS",
        deploymentHost: "PASS",
        stagingInpRum: "PASS",
        valuesRedacted: "PASS",
      },
    });
  });

  it.each([
    ["old Git SHA", { candidateGitSha: "c".repeat(40) }, "remote-candidate-git-sha-mismatch"],
    ["wrong content SHA", { candidateContentSha: "d".repeat(64) }, "remote-candidate-content-sha-mismatch"],
    ["wrong host fingerprint", { deploymentHostFingerprint: "e".repeat(64) }, "remote-deployment-host-mismatch"],
    ["wrong RUM mode", { stagingInpRum: "enabled" }, "remote-staging-rum-mode-mismatch"],
    ["unredacted receipt", { valuesRedacted: false }, "remote-redaction-attestation-missing"],
  ])("fails %s without reflecting remote values", (_label, override, code) => {
    const result = assess(healthyBody(override));
    expect(result.status).toBe("FAIL");
    expect(result.failureCodes).toContain(code);
    expect(JSON.stringify(result)).not.toContain("c".repeat(40));
    expect(JSON.stringify(result)).not.toContain("d".repeat(64));
  });

  it("fails a missing deployment binding even when app and database are healthy", () => {
    const result = assess({
      status: "ok",
      checks: { app: "ok", database: "ok", migrations: "ok" },
    });
    expect(result.status).toBe("FAIL");
    expect(result.failureCodes).toContain("remote-deployment-binding-missing");
  });

  it("requires the exact Vercel Authentication challenge and the bound app with bypass", () => {
    const bypassed = assess();
    expect(
      assessUaisStagingProtectionDifferential({
        unprotectedHttpStatus: 401,
        unprotectedHeaders: deploymentProtectionChallenge().headers,
        targetUrl: `${baseUrl}/healthz`,
        immutableDeploymentUrl: baseUrl,
        bypassed,
      }),
    ).toEqual({
      status: "PASS",
      failureCodes: [],
      checks: {
        unprotectedDeploymentProtectionChallenge: "PASS",
        bypassedBoundApplicationReached: "PASS",
      },
    });
  });

  it("accepts only an exact Vercel SSO redirect bound to the immutable health target", () => {
    const bypassed = assess();
    expect(
      assessUaisStagingProtectionDifferential({
        unprotectedHttpStatus: 302,
        unprotectedHeaders: deploymentProtectionRedirectChallenge().headers,
        targetUrl: `${baseUrl}/healthz`,
        immutableDeploymentUrl: baseUrl,
        bypassed,
      }),
    ).toEqual({
      status: "PASS",
      failureCodes: [],
      checks: {
        unprotectedDeploymentProtectionChallenge: "PASS",
        bypassedBoundApplicationReached: "PASS",
      },
    });
  });

  it.each([
    [
      "non-Vercel host",
      `https://ordinary-app.example.test/sso-api?url=${encodeURIComponent(
        `${baseUrl}/healthz`,
      )}&nonce=test-only-redirect-nonce-1234`,
    ],
    [
      "wrong SSO path",
      `https://vercel.com/not-sso-api?url=${encodeURIComponent(
        `${baseUrl}/healthz`,
      )}&nonce=test-only-redirect-nonce-1234`,
    ],
    [
      "different callback target",
      `https://vercel.com/sso-api?url=${encodeURIComponent(
        `${baseUrl}/not-healthz`,
      )}&nonce=test-only-redirect-nonce-1234`,
    ],
    [
      "missing nonce",
      `https://vercel.com/sso-api?url=${encodeURIComponent(
        `${baseUrl}/healthz`,
      )}`,
    ],
    [
      "extra query parameter",
      `https://vercel.com/sso-api?url=${encodeURIComponent(
        `${baseUrl}/healthz`,
      )}&nonce=test-only-redirect-nonce-1234&extra=1`,
    ],
  ])("rejects a 302 challenge with %s", (_label, location) => {
    const response = deploymentProtectionRedirectChallenge(location);
    const result = assessUaisStagingProtectionDifferential({
      unprotectedHttpStatus: response.status,
      unprotectedHeaders: response.headers,
      targetUrl: `${baseUrl}/healthz`,
      immutableDeploymentUrl: baseUrl,
      bypassed: assess(),
    });
    expect(result.status).toBe("FAIL");
    expect(result.failureCodes).toContain("deployment-protection-not-proven");
  });

  it.each([200, 302, 400, 404, 409, 429, 500])(
    "rejects status %s even when every challenge header is spoofed",
    (unprotectedHttpStatus) => {
      const result = assessUaisStagingProtectionDifferential({
        unprotectedHttpStatus,
        unprotectedHeaders: deploymentProtectionChallenge(
          unprotectedHttpStatus,
        ).headers,
        targetUrl: `${baseUrl}/healthz`,
        immutableDeploymentUrl: baseUrl,
        bypassed: assess(),
      });
      expect(result.status).toBe("FAIL");
      expect(result.failureCodes).toContain("deployment-protection-not-proven");
    },
  );

  it("rejects a Vercel firewall challenge because automation bypass cannot prove Deployment Protection", () => {
    const headers = new Headers(deploymentProtectionChallenge(403).headers);
    headers.set("x-vercel-mitigated", "challenge");
    headers.set("x-vercel-challenge-token", "test-only-firewall-token");
    const result = assessUaisStagingProtectionDifferential({
      unprotectedHttpStatus: 403,
      unprotectedHeaders: headers,
      targetUrl: `${baseUrl}/healthz`,
      immutableDeploymentUrl: baseUrl,
      bypassed: assess(),
    });
    expect(result.status).toBe("FAIL");
    expect(result.failureCodes).toContain("deployment-protection-not-proven");
  });

  it.each([
    "server",
    "set-cookie",
    "x-frame-options",
    "x-robots-tag",
    "x-vercel-id",
  ])("rejects a 401 challenge missing the %s platform header", (header) => {
    const headers = new Headers(deploymentProtectionChallenge().headers);
    headers.delete(header);
    const result = assessUaisStagingProtectionDifferential({
      unprotectedHttpStatus: 401,
      unprotectedHeaders: headers,
      targetUrl: `${baseUrl}/healthz`,
      immutableDeploymentUrl: baseUrl,
      bypassed: assess(),
    });
    expect(result.status).toBe("FAIL");
    expect(result.failureCodes).toContain("deployment-protection-not-proven");
  });

  it("short-circuits every non-challenge status without ever sending the bypass secret", async () => {
    for (const status of [302, 400, 404, 409, 429]) {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValue(deploymentProtectionChallenge(status));

      const result = await runUaisStagingRemotePreflight(
        preflightOptions(fetchImpl),
      );

      expect(result.status).toBe("FAIL");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [, options] = fetchImpl.mock.calls[0];
      expect(options?.redirect).toBe("manual");
      expect(
        new Headers(options?.headers).has("x-vercel-protection-bypass"),
      ).toBe(false);
    }
  });

  it("short-circuits an ordinary app response before the secret-bearing request", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "ordinary application auth" }), {
        status: 401,
        headers: {
          "content-type": "application/json",
          server: "Vercel",
          "x-vercel-id": "hkg1::test-1787587200000-app401",
        },
      }),
    );

    const result = await runUaisStagingRemotePreflight(
      preflightOptions(fetchImpl),
    );

    expect(result.status).toBe("FAIL");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(
      new Headers(fetchImpl.mock.calls[0][1]?.headers).has(
        "x-vercel-protection-bypass",
      ),
    ).toBe(false);
  });

  it("rejects a wrong or mutable host before making any request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    const wrongHost = await runUaisStagingRemotePreflight(
      preflightOptions(fetchImpl, {
        baseUrl: "https://ordinary-app.example.test",
        immutableDeploymentUrl: "https://ordinary-app.example.test",
      }),
    );
    const mismatchedImmutableHost = await runUaisStagingRemotePreflight(
      preflightOptions(fetchImpl, {
        immutableDeploymentUrl:
          "https://different-immutable-deployment.vercel.app",
      }),
    );

    expect(wrongHost.status).toBe("FAIL");
    expect(mismatchedImmutableHost.status).toBe("FAIL");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("performs anonymous challenge then one same-host bypass request in strict order", async () => {
    const calls: Array<{
      url: string;
      redirect: RequestRedirect | undefined;
      accept: string | null;
      bypass: string | null;
    }> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, options) => {
      calls.push({
        url: String(input),
        redirect: options?.redirect,
        accept: new Headers(options?.headers).get("accept"),
        bypass:
          new Headers(options?.headers).get("x-vercel-protection-bypass"),
      });
      return calls.length === 1
        ? deploymentProtectionChallenge()
        : healthyResponse();
    });

    const result = await runUaisStagingRemotePreflight(
      preflightOptions(fetchImpl),
    );

    expect(result.status).toBe("PASS");
    expect(calls).toEqual([
      {
        url: `${baseUrl}/healthz`,
        redirect: "manual",
        accept: "text/html",
        bypass: null,
      },
      {
        url: `${baseUrl}/healthz`,
        redirect: "manual",
        accept: "application/json",
        bypass: "test-only-bypass-secret",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("test-only-bypass-secret");
    expect(JSON.stringify(result)).not.toContain("test-only-nonce-value");
  });

  it("does not follow a redirect returned to the secret-bearing request", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(deploymentProtectionChallenge())
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://ordinary-app.example.test/collect" },
        }),
      );

    const result = await runUaisStagingRemotePreflight(
      preflightOptions(fetchImpl),
    );

    expect(result.status).toBe("FAIL");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][0]).toBe(`${baseUrl}/healthz`);
    expect(fetchImpl.mock.calls[1][1]?.redirect).toBe("manual");
  });

  it("wires remote binding and manual redirect handling before live fixtures", () => {
    const source = readFileSync("scripts/p2-staging-live-load.mjs", "utf8");
    expect(source).toContain("verifyRemoteDeploymentPreflight");
    expect(source).toContain("runUaisStagingRemotePreflight");
    expect(source).toContain("assessUaisStagingRemoteHealth");
    expect(source).toContain('redirect: "manual"');
    expect(source).toContain("deploymentProtectionBypassAuthorized");
    expect(source.indexOf("verifyRemoteDeploymentPreflight")).toBeLessThan(
      source.indexOf("createSql(sourceDatabaseUrl)"),
    );
    expect(
      source.indexOf("const remoteDeploymentPreflight = await"),
    ).toBeLessThan(
      source.indexOf("deploymentProtectionBypassAuthorized = true"),
    );
  });
});
