import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { assessProviderSmokeChild } from "../scripts/lib/p2-provider-evidence.mjs";

describe("P2 live-provider smoke evidence", () => {
  it("passes only the redacted text-generation connectivity result for one successful DeepSeek and Qwen probe", () => {
    const assessment = assessProviderSmokeChild({
      status: 0,
      stdout: JSON.stringify({
        target: "p2-provider-connectivity-child",
        capabilities: ["text-generation-connectivity"],
        requestsAttempted: 2,
        requestPolicy: expectedRequestPolicy(1),
        results: [
          {
            provider: "deepseek",
            endpointOrigin: "https://api.deepseek.com",
            model: "deepseek-v4-flash",
            requestCount: 1,
            status: "ok",
            httpStatus: 200,
            rawBody: "must-not-escape",
          },
          {
            provider: "qwen",
            endpointOrigin: "https://dashscope.aliyuncs.com",
            model: "qwen3.5-omni-plus",
            requestCount: 1,
            status: "ok",
            httpStatus: 200,
            apiKey: "must-not-escape",
          },
        ],
      }),
    }, {
      expectedRateLimitRpm: 1,
    });

    expect(assessment).toEqual({
      status: "PASS",
      blockedReasons: [],
      capabilities: ["text-generation-connectivity"],
      requestsAttempted: 2,
      results: [
        { provider: "deepseek", status: "ok", httpStatus: 200 },
        { provider: "qwen", status: "ok", httpStatus: 200 },
      ],
    });
    expect(JSON.stringify(assessment)).not.toContain("must-not-escape");
  });

  it("rejects two successful provider statuses without the trusted child execution policy", () => {
    const assessment = assessProviderSmokeChild({
      status: 0,
      stdout: JSON.stringify({
        results: [
          { provider: "deepseek", status: "ok", httpStatus: 200 },
          { provider: "qwen", status: "ok", httpStatus: 200 },
        ],
      }),
    });

    expect(assessment).toMatchObject({
      status: "FAIL",
      blockedReasons: ["provider-smoke-invalid-evidence"],
      results: [],
    });
  });

  it("rejects a child-declared request rate outside the approved one-to-three RPM bound", () => {
    const assessment = assessProviderSmokeChild(
      {
        status: 0,
        stdout: JSON.stringify({
          target: "p2-provider-connectivity-child",
          capabilities: ["text-generation-connectivity"],
          requestsAttempted: 2,
          requestPolicy: expectedRequestPolicy(100),
          results: [
            {
              provider: "deepseek",
              endpointOrigin: "https://api.deepseek.com",
              model: "deepseek-v4-flash",
              requestCount: 1,
              status: "ok",
              httpStatus: 200,
            },
            {
              provider: "qwen",
              endpointOrigin: "https://dashscope.aliyuncs.com",
              model: "qwen3.5-omni-plus",
              requestCount: 1,
              status: "ok",
              httpStatus: 200,
            },
          ],
        }),
      },
      { expectedRateLimitRpm: 100 },
    );

    expect(assessment.status).toBe("FAIL");
  });

  it("fails when a provider probe is skipped even if the child exits successfully", () => {
    const assessment = assessProviderSmokeChild({
      status: 0,
      stdout: JSON.stringify({
        results: [
          { provider: "deepseek", status: "ok", httpStatus: 200 },
          { provider: "qwen", status: "skipped", reason: "missing-required-env" },
        ],
      }),
    });

    expect(assessment).toMatchObject({
      status: "FAIL",
      blockedReasons: ["provider-smoke-invalid-evidence"],
      capabilities: ["text-generation-connectivity"],
    });
  });

  it.each(["failed", "unknown"])(
    "fails when a provider probe reports %s",
    (providerStatus) => {
      const assessment = assessProviderSmokeChild({
        status: 0,
        stdout: JSON.stringify({
          results: [
            { provider: "deepseek", status: "ok", httpStatus: 200 },
            { provider: "qwen", status: providerStatus, httpStatus: 503 },
          ],
        }),
      });

      expect(assessment.status).toBe("FAIL");
      expect(assessment.blockedReasons).toEqual(["provider-smoke-invalid-evidence"]);
    },
  );

  it("fails when a required provider appears more than once", () => {
    const assessment = assessProviderSmokeChild({
      status: 0,
      stdout: JSON.stringify({
        results: [
          { provider: "deepseek", status: "ok", httpStatus: 200 },
          { provider: "deepseek", status: "ok", httpStatus: 200 },
          { provider: "qwen", status: "ok", httpStatus: 200 },
        ],
      }),
    });

    expect(assessment.status).toBe("FAIL");
    expect(assessment.blockedReasons).toEqual(["provider-smoke-invalid-evidence"]);
  });

  it("fails closed on malformed child JSON", () => {
    expect(
      assessProviderSmokeChild({ status: 0, stdout: "not-json" }),
    ).toMatchObject({
      status: "FAIL",
      blockedReasons: ["provider-smoke-malformed-json"],
      capabilities: ["text-generation-connectivity"],
    });
  });

  it("fails without parsing child output when the provider smoke exits nonzero", () => {
    expect(
      assessProviderSmokeChild({
        status: 1,
        stdout: JSON.stringify({
          results: [
            { provider: "deepseek", status: "ok", httpStatus: 200 },
            { provider: "qwen", status: "ok", httpStatus: 200 },
          ],
        }),
      }),
    ).toMatchObject({
      status: "FAIL",
      blockedReasons: ["provider-smoke-failed"],
    });
  });

  it("reports a timed-out provider child as a non-PASS timeout", () => {
    expect(
      assessProviderSmokeChild({
        status: null,
        stdout: "",
        error: { code: "ETIMEDOUT" },
      }),
    ).toMatchObject({
      status: "FAIL",
      blockedReasons: ["provider-smoke-timeout"],
    });
  });

  it("fails on a child process error even if a contradictory zero status is present", () => {
    expect(
      assessProviderSmokeChild({
        status: 0,
        error: { code: "EIO" },
        stdout: JSON.stringify({
          results: [
            { provider: "deepseek", status: "ok", httpStatus: 200 },
            { provider: "qwen", status: "ok", httpStatus: 200 },
          ],
        }),
      }),
    ).toMatchObject({
      status: "FAIL",
      blockedReasons: ["provider-smoke-failed"],
    });
  });

  it("fails closed when the child receipt omits provider results", () => {
    expect(
      assessProviderSmokeChild({ status: 0, stdout: JSON.stringify({ mode: "live" }) }),
    ).toMatchObject({
      status: "FAIL",
      blockedReasons: ["provider-smoke-invalid-evidence"],
    });
  });

  it("returns a minimal BLOCKED_ENV receipt when dedicated live configuration is missing", () => {
    const outcome = spawnSync(process.execPath, ["scripts/p2-provider-live-smoke.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "" },
    });
    const receipt = JSON.parse(outcome.stdout);

    expect(outcome.status).toBe(2);
    expect(receipt).toMatchObject({
      status: "BLOCKED_ENV",
      networkUsed: false,
      capabilities: ["text-generation-connectivity"],
      requestsAttempted: 0,
    });
    expect(receipt.capabilities).toEqual(["text-generation-connectivity"]);
  });

  it("keeps the CLI blocked when only the DeepSeek credential is configured", () => {
    const outcome = spawnSync(process.execPath, ["scripts/p2-provider-live-smoke.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        DEEPSEEK_API_KEY: "redacted-test-value",
      },
    });
    const receipt = JSON.parse(outcome.stdout);

    expect(outcome.status).toBe(2);
    expect(receipt).toMatchObject({ status: "BLOCKED_ENV", networkUsed: false });
    expect(receipt.blockedReasons).toContain("missing-DASHSCOPE_API_KEY");
    expect(JSON.stringify(receipt)).not.toContain("redacted-test-value");
  });

  it("does not echo an unknown provider status or other raw child fields on failure", () => {
    const assessment = assessProviderSmokeChild({
      status: 0,
      stdout: JSON.stringify({
        results: [
          { provider: "deepseek", status: "ok", httpStatus: 200 },
          {
            provider: "qwen",
            status: "raw-provider-body-secret",
            body: "raw-provider-body-secret",
          },
        ],
      }),
    });

    expect(assessment.status).toBe("FAIL");
    expect(JSON.stringify(assessment)).not.toContain("raw-provider-body-secret");
  });

  it("fails without echoing a nonnumeric HTTP field", () => {
    const assessment = assessProviderSmokeChild({
      status: 0,
      stdout: JSON.stringify({
        results: [
          { provider: "deepseek", status: "ok", httpStatus: "raw-secret" },
          { provider: "qwen", status: "ok", httpStatus: 200 },
        ],
      }),
    });

    expect(assessment.status).toBe("FAIL");
    expect(JSON.stringify(assessment)).not.toContain("raw-secret");
    expect(assessment.results).toEqual([]);
  });

  it("fails an internally inconsistent ok result carrying a server error status", () => {
    const assessment = assessProviderSmokeChild({
      status: 0,
      stdout: JSON.stringify({
        results: [
          { provider: "deepseek", status: "ok", httpStatus: 200 },
          { provider: "qwen", status: "ok", httpStatus: 500 },
        ],
      }),
    });

    expect(assessment).toMatchObject({
      status: "FAIL",
      blockedReasons: ["provider-smoke-invalid-evidence"],
      results: [],
    });
  });

  it("fails closed on structurally malformed result entries", () => {
    expect(
      assessProviderSmokeChild({
        status: 0,
        stdout: JSON.stringify({ results: [null, { provider: "qwen", status: "ok" }] }),
      }),
    ).toMatchObject({
      status: "FAIL",
      blockedReasons: ["provider-smoke-invalid-evidence"],
    });
  });

  it("resolves the trusted connectivity child relative to the parent module", () => {
    const source = readFileSync("scripts/p2-provider-live-smoke.mjs", "utf8");

    expect(source).toContain(
      'new URL("./lib/p2-provider-connectivity-child.mjs", import.meta.url)',
    );
    expect(source).not.toContain('"scripts/ai-provider-smoke.mjs"');
    expect(source).not.toContain("cwd: process.cwd()");
    expect(source).not.toContain("env: process.env");
  });

  it("passes only credential and enforced limit fields to the connectivity child", async () => {
    const childModule = await importProviderConnectivityChild();
    const childEnv = childModule.createProviderConnectivityChildEnv(
      {
        ...liveFixtureEnv(),
        DEEPSEEK_BASE_URL: "http://127.0.0.1:9876",
        DASHSCOPE_BASE_URL: "https://attacker.example.test",
        HTTPS_PROXY: "http://proxy.example.test",
        HTTP_PROXY: "http://proxy.example.test",
        ALL_PROXY: "socks5://proxy.example.test",
        NO_PROXY: "*",
        NODE_OPTIONS: "--import=/tmp/untrusted.mjs",
        NODE_USE_ENV_PROXY: "1",
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
        SSL_CERT_FILE: "/tmp/untrusted-ca.pem",
      },
      { timeoutMs: 1_000, rateLimitRpm: 3 },
    );

    expect(Object.keys(childEnv).sort()).toEqual([
      "DASHSCOPE_API_KEY",
      "DEEPSEEK_API_KEY",
      "P2_PROVIDER_RATE_LIMIT_RPM",
      "P2_PROVIDER_TIMEOUT_MS",
    ]);
    expect(childEnv).toEqual({
      DASHSCOPE_API_KEY: "redacted-qwen-test-value",
      DEEPSEEK_API_KEY: "redacted-deepseek-test-value",
      P2_PROVIDER_RATE_LIMIT_RPM: "3",
      P2_PROVIDER_TIMEOUT_MS: "1000",
    });
  });

  it("executes exactly two fixed official HTTPS requests with redirect and token limits", async () => {
    const childModule = await importProviderConnectivityChild();
    const calls: Array<{ url: string; options: RequestInit }> = [];
    const waits: number[] = [];
    const report = await childModule.runProviderConnectivityProbes({
      credentials: {
        deepseekApiKey: "redacted-deepseek-test-value",
        dashscopeApiKey: "redacted-qwen-test-value",
      },
      rateLimitRpm: 3,
      timeoutMs: 1_000,
      fetchImpl: async (url: string, options: RequestInit) => {
        calls.push({ url, options });
        return {
          ok: true,
          status: 200,
          body: { cancel: async () => undefined },
        } as unknown as Response;
      },
      wait: async (milliseconds: number) => {
        waits.push(milliseconds);
      },
    });

    expect(calls.map((call) => call.url)).toEqual([
      "https://api.deepseek.com/chat/completions",
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    ]);
    expect(waits).toEqual([20_000]);
    for (const call of calls) {
      expect(call.options).toMatchObject({
        method: "POST",
        redirect: "error",
      });
      const body = JSON.parse(String(call.options.body));
      expect(body).toMatchObject({
        max_tokens: 1,
        stream: false,
      });
      expect(body.messages).toEqual([
        { role: "user", content: "Reply with OK." },
      ]);
    }
    expect(JSON.parse(String(calls[0].options.body)).model).toBe(
      "deepseek-v4-flash",
    );
    expect(JSON.parse(String(calls[1].options.body)).model).toBe(
      "qwen3.5-omni-plus",
    );
    expect(report).toMatchObject({
      target: "p2-provider-connectivity-child",
      capabilities: ["text-generation-connectivity"],
      requestsAttempted: 2,
      requestPolicy: expectedRequestPolicy(3),
      results: [
        {
          provider: "deepseek",
          endpointOrigin: "https://api.deepseek.com",
          model: "deepseek-v4-flash",
          requestCount: 1,
          status: "ok",
          httpStatus: 200,
        },
        {
          provider: "qwen",
          endpointOrigin: "https://dashscope.aliyuncs.com",
          model: "qwen3.5-omni-plus",
          requestCount: 1,
          status: "ok",
          httpStatus: 200,
        },
      ],
    });
  });

  it("keeps both provider attempts in the redacted receipt when one request throws", async () => {
    const childModule = await importProviderConnectivityChild();
    let requestCount = 0;
    const report = await childModule.runProviderConnectivityProbes({
      credentials: {
        deepseekApiKey: "redacted-deepseek-test-value",
        dashscopeApiKey: "redacted-qwen-test-value",
      },
      rateLimitRpm: 3,
      timeoutMs: 1_000,
      fetchImpl: async () => {
        requestCount += 1;
        if (requestCount === 1) throw new Error("must-not-escape");
        return {
          ok: true,
          status: 200,
          body: { cancel: async () => undefined },
        } as unknown as Response;
      },
      wait: async () => undefined,
    });

    expect(requestCount).toBe(2);
    expect(report.results.map((result: { status: string }) => result.status)).toEqual([
      "failed",
      "ok",
    ]);
    expect(JSON.stringify(report)).not.toContain("must-not-escape");
    expect(
      assessProviderSmokeChild(
        { status: 0, stdout: JSON.stringify(report) },
        { expectedRateLimitRpm: 3 },
      ).status,
    ).toBe("FAIL");
  });

  it("enforces a fixed run budget ceiling and executable request-rate policy", async () => {
    const evidenceModule = (await import(
      "../scripts/lib/p2-provider-evidence.mjs"
    )) as Record<string, unknown>;
    const createPolicy = evidenceModule.createProviderExecutionPolicy as (
      env: NodeJS.ProcessEnv,
    ) => {
      blockedReasons: string[];
      timeoutMs?: number;
      rateLimitRpm?: number;
      receipt: Record<string, unknown>;
    };

    expect(typeof createPolicy).toBe("function");
    expect(
      createPolicy({
        P2_PROVIDER_BUDGET_CAP_USD: "0.02",
        P2_PROVIDER_RATE_LIMIT_RPM: "3",
        P2_PROVIDER_TIMEOUT_MS: "1000",
      }).blockedReasons,
    ).toContain("P2_PROVIDER_BUDGET_CAP_USD-exceeds-hard-maximum");

    const policy = createPolicy({
      P2_PROVIDER_BUDGET_CAP_USD: "0.01",
      P2_PROVIDER_RATE_LIMIT_RPM: "2",
      P2_PROVIDER_TIMEOUT_MS: "1000",
    });
    expect(policy).toMatchObject({
      blockedReasons: [],
      timeoutMs: 1_000,
      rateLimitRpm: 2,
      receipt: {
        budget: {
          hardMaximumAuthorizedUsdPerRun: 0.01,
          configuredAuthorization: "within-hard-maximum",
          actualChargeMeasured: false,
        },
        rate: {
          aggregateRequestLaunchLimitPerMinute: 2,
          minimumInterRequestDelayMs: 30_000,
          enforcementScope: "single-child-process",
        },
        requests: {
          totalRequestLimit: 2,
          perProviderRequestLimit: 1,
          maximumOutputTokensPerRequest: 1,
          maximumOutputTokensTotal: 2,
          automaticRetries: 0,
        },
      },
    });
  });
});

function expectedRequestPolicy(rateLimitRpm: number) {
  return {
    officialHttpsOrigins: [
      "https://api.deepseek.com",
      "https://dashscope.aliyuncs.com",
    ],
    totalRequestLimit: 2,
    perProviderRequestLimit: 1,
    maximumOutputTokensPerRequest: 1,
    maximumOutputTokensTotal: 2,
    automaticRetries: 0,
    redirectMode: "error",
    aggregateRequestLaunchLimitPerMinute: rateLimitRpm,
    minimumInterRequestDelayMs: Math.ceil(60_000 / rateLimitRpm),
  };
}

async function importProviderConnectivityChild() {
  const moduleUrl = pathToFileURL(
    resolve("scripts/lib/p2-provider-connectivity-child.mjs"),
  ).href;
  return import(/* @vite-ignore */ moduleUrl);
}

function liveFixtureEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "",
    P2_PROVIDER_LIVE_CONFIRM: "approved",
    P2_PROVIDER_BUDGET_CAP_USD: "0.01",
    P2_PROVIDER_RATE_LIMIT_RPM: "1",
    P2_PROVIDER_TIMEOUT_MS: "1000",
    P2_PROVIDER_MONITORING: "confirmed",
    DEEPSEEK_API_KEY: "redacted-deepseek-test-value",
    DASHSCOPE_API_KEY: "redacted-qwen-test-value",
  };
}
