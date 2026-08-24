#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAXIMUM_OUTPUT_TOKENS_PER_REQUEST = 1;
const MAXIMUM_RATE_LIMIT_RPM = 3;
const MINIMUM_RATE_LIMIT_RPM = 1;
const MINIMUM_TIMEOUT_MS = 1_000;
const MAXIMUM_TIMEOUT_MS = 60_000;

const providerRequests = Object.freeze([
  Object.freeze({
    provider: "deepseek",
    endpoint: "https://api.deepseek.com/chat/completions",
    endpointOrigin: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    credentialName: "deepseekApiKey",
  }),
  Object.freeze({
    provider: "qwen",
    endpoint:
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    endpointOrigin: "https://dashscope.aliyuncs.com",
    model: "qwen3.5-omni-plus",
    credentialName: "dashscopeApiKey",
  }),
]);

export function createProviderConnectivityChildEnv(
  sourceEnv,
  { timeoutMs, rateLimitRpm },
) {
  return {
    DEEPSEEK_API_KEY: sourceEnv.DEEPSEEK_API_KEY?.trim() ?? "",
    DASHSCOPE_API_KEY: sourceEnv.DASHSCOPE_API_KEY?.trim() ?? "",
    P2_PROVIDER_RATE_LIMIT_RPM: String(rateLimitRpm),
    P2_PROVIDER_TIMEOUT_MS: String(timeoutMs),
  };
}

export function createProviderConnectivityRequestPolicy(rateLimitRpm) {
  return {
    officialHttpsOrigins: providerRequests.map(
      (request) => request.endpointOrigin,
    ),
    totalRequestLimit: providerRequests.length,
    perProviderRequestLimit: 1,
    maximumOutputTokensPerRequest: MAXIMUM_OUTPUT_TOKENS_PER_REQUEST,
    maximumOutputTokensTotal:
      providerRequests.length * MAXIMUM_OUTPUT_TOKENS_PER_REQUEST,
    automaticRetries: 0,
    redirectMode: "error",
    aggregateRequestLaunchLimitPerMinute: rateLimitRpm,
    minimumInterRequestDelayMs: Math.ceil(60_000 / rateLimitRpm),
  };
}

export async function runProviderConnectivityProbes({
  credentials,
  rateLimitRpm,
  timeoutMs,
  fetchImpl = fetch,
  wait = delay,
}) {
  assertExecutionInputs({ credentials, rateLimitRpm, timeoutMs });
  const requestPolicy = createProviderConnectivityRequestPolicy(rateLimitRpm);
  const results = [];
  let requestsAttempted = 0;

  for (let index = 0; index < providerRequests.length; index += 1) {
    if (index > 0) {
      await wait(requestPolicy.minimumInterRequestDelayMs);
    }
    const request = providerRequests[index];
    requestsAttempted += 1;
    results.push(
      await executeProviderRequest({
        request,
        credential: credentials[request.credentialName],
        timeoutMs,
        fetchImpl,
      }),
    );
  }

  return {
    target: "p2-provider-connectivity-child",
    status: results.every((result) => result.status === "ok")
      ? "PASS"
      : "FAIL",
    capabilities: ["text-generation-connectivity"],
    requestsAttempted,
    requestPolicy,
    results,
  };
}

async function executeProviderRequest({
  request,
  credential,
  timeoutMs,
  fetchImpl,
}) {
  try {
    const response = await fetchImpl(request.endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${credential}`,
      },
      body: JSON.stringify({
        model: request.model,
        messages: [{ role: "user", content: "Reply with OK." }],
        max_tokens: MAXIMUM_OUTPUT_TOKENS_PER_REQUEST,
        stream: false,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    await discardResponseBody(response);
    return {
      provider: request.provider,
      endpointOrigin: request.endpointOrigin,
      model: request.model,
      requestCount: 1,
      status: response.ok ? "ok" : "failed",
      ...(Number.isInteger(response.status)
        ? { httpStatus: response.status }
        : {}),
    };
  } catch {
    return {
      provider: request.provider,
      endpointOrigin: request.endpointOrigin,
      model: request.model,
      requestCount: 1,
      status: "failed",
    };
  }
}

async function discardResponseBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // Connectivity evidence intentionally excludes provider response bodies.
  }
}

function assertExecutionInputs({ credentials, rateLimitRpm, timeoutMs }) {
  if (
    !credentials?.deepseekApiKey?.trim() ||
    !credentials?.dashscopeApiKey?.trim()
  ) {
    throw new Error("Both provider credentials are required.");
  }
  if (
    !Number.isInteger(rateLimitRpm) ||
    rateLimitRpm < MINIMUM_RATE_LIMIT_RPM ||
    rateLimitRpm > MAXIMUM_RATE_LIMIT_RPM
  ) {
    throw new Error("Provider request rate limit is invalid.");
  }
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < MINIMUM_TIMEOUT_MS ||
    timeoutMs > MAXIMUM_TIMEOUT_MS
  ) {
    throw new Error("Provider request timeout is invalid.");
  }
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}

async function runCli() {
  try {
    const report = await runProviderConnectivityProbes({
      credentials: {
        deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? "",
        dashscopeApiKey: process.env.DASHSCOPE_API_KEY ?? "",
      },
      rateLimitRpm: readBoundedInteger(
        process.env.P2_PROVIDER_RATE_LIMIT_RPM,
        MINIMUM_RATE_LIMIT_RPM,
        MAXIMUM_RATE_LIMIT_RPM,
      ),
      timeoutMs: readBoundedInteger(
        process.env.P2_PROVIDER_TIMEOUT_MS,
        MINIMUM_TIMEOUT_MS,
        MAXIMUM_TIMEOUT_MS,
      ),
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.exitCode = report.status === "PASS" ? 0 : 1;
  } catch {
    process.stdout.write(
      `${JSON.stringify({
        target: "p2-provider-connectivity-child",
        status: "FAIL",
        capabilities: ["text-generation-connectivity"],
        requestsAttempted: 0,
        results: [],
      })}\n`,
    );
    process.exitCode = 1;
  }
}

function readBoundedInteger(value, minimum, maximum) {
  if (!value?.trim() || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return parsed >= minimum && parsed <= maximum ? parsed : undefined;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await runCli();
}
