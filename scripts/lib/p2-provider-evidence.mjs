import { createProviderConnectivityRequestPolicy } from "./p2-provider-connectivity-child.mjs";

const REQUIRED_PROVIDERS = ["deepseek", "qwen"];
const PROVIDER_CAPABILITIES = ["text-generation-connectivity"];
const REQUIRED_PROVIDER_EVIDENCE = Object.freeze({
  deepseek: Object.freeze({
    endpointOrigin: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
  }),
  qwen: Object.freeze({
    endpointOrigin: "https://dashscope.aliyuncs.com",
    model: "qwen3.5-omni-plus",
  }),
});
const HARD_MAXIMUM_AUTHORIZED_USD_PER_RUN = 0.01;
const MINIMUM_RATE_LIMIT_RPM = 1;
const MAXIMUM_RATE_LIMIT_RPM = 3;
const MINIMUM_TIMEOUT_MS = 1_000;
const MAXIMUM_TIMEOUT_MS = 60_000;

export function assessProviderSmokeChild(child, options = {}) {
  if (child.error || child.status !== 0) {
    return {
      status: "FAIL",
      blockedReasons: [
        child.error?.code === "ETIMEDOUT"
          ? "provider-smoke-timeout"
          : "provider-smoke-failed",
      ],
      capabilities: [...PROVIDER_CAPABILITIES],
      requestsAttempted: "unverified",
      results: [],
    };
  }

  let payload;
  try {
    payload = JSON.parse(child.stdout);
  } catch {
    return {
      status: "FAIL",
      blockedReasons: ["provider-smoke-malformed-json"],
      capabilities: [...PROVIDER_CAPABILITIES],
      requestsAttempted: "unverified",
      results: [],
    };
  }
  const expectedRateLimitRpm =
    options.expectedRateLimitRpm ??
    payload?.requestPolicy?.aggregateRequestLaunchLimitPerMinute;
  const expectedRequestPolicy =
    Number.isInteger(expectedRateLimitRpm) &&
    expectedRateLimitRpm >= MINIMUM_RATE_LIMIT_RPM &&
    expectedRateLimitRpm <= MAXIMUM_RATE_LIMIT_RPM
    ? createProviderConnectivityRequestPolicy(expectedRateLimitRpm)
    : undefined;
  if (
    payload?.target !== "p2-provider-connectivity-child" ||
    JSON.stringify(payload?.capabilities) !==
      JSON.stringify(PROVIDER_CAPABILITIES) ||
    payload?.requestsAttempted !== REQUIRED_PROVIDERS.length ||
    !expectedRequestPolicy ||
    JSON.stringify(payload?.requestPolicy) !==
      JSON.stringify(expectedRequestPolicy) ||
    !Array.isArray(payload?.results) ||
    payload.results.length !== REQUIRED_PROVIDERS.length ||
    REQUIRED_PROVIDERS.some(
      (provider) =>
        payload.results.filter((candidate) => candidate?.provider === provider).length !== 1,
    )
  ) {
    return {
      status: "FAIL",
      blockedReasons: ["provider-smoke-invalid-evidence"],
      capabilities: [...PROVIDER_CAPABILITIES],
      requestsAttempted: "unverified",
      results: [],
    };
  }
  const results = REQUIRED_PROVIDERS.map((provider) => {
    const item = payload.results.find((candidate) => candidate?.provider === provider);
    const requiredEvidence = REQUIRED_PROVIDER_EVIDENCE[provider];
    return {
      provider,
      status: item.status,
      validBinding:
        item.endpointOrigin === requiredEvidence.endpointOrigin &&
        item.model === requiredEvidence.model &&
        item.requestCount === 1,
      ...(Number.isInteger(item.httpStatus) && item.httpStatus >= 200 && item.httpStatus <= 299
        ? { httpStatus: item.httpStatus }
        : {}),
    };
  });

  if (
    results.some(
      (item) =>
        item.status !== "ok" ||
        item.validBinding !== true ||
        !Number.isInteger(item.httpStatus),
    )
  ) {
    return {
      status: "FAIL",
      blockedReasons: ["provider-smoke-invalid-evidence"],
      capabilities: [...PROVIDER_CAPABILITIES],
      requestsAttempted: REQUIRED_PROVIDERS.length,
      results: [],
    };
  }

  return {
    status: "PASS",
    blockedReasons: [],
    capabilities: [...PROVIDER_CAPABILITIES],
    requestsAttempted: REQUIRED_PROVIDERS.length,
    results: results.map(({ provider, status, httpStatus }) => ({
      provider,
      status,
      httpStatus,
    })),
  };
}

export function createProviderExecutionPolicy(env) {
  const blockedReasons = [];
  const budgetCapUsd = readPositiveNumber(env.P2_PROVIDER_BUDGET_CAP_USD);
  const rateLimitRpm = readBoundedInteger(
    env.P2_PROVIDER_RATE_LIMIT_RPM,
    MINIMUM_RATE_LIMIT_RPM,
    MAXIMUM_RATE_LIMIT_RPM,
  );
  const timeoutMs = readBoundedInteger(
    env.P2_PROVIDER_TIMEOUT_MS,
    MINIMUM_TIMEOUT_MS,
    MAXIMUM_TIMEOUT_MS,
  );

  if (!env.P2_PROVIDER_BUDGET_CAP_USD?.trim()) {
    blockedReasons.push("missing-P2_PROVIDER_BUDGET_CAP_USD");
  } else if (budgetCapUsd === undefined) {
    blockedReasons.push("invalid-P2_PROVIDER_BUDGET_CAP_USD");
  } else if (budgetCapUsd > HARD_MAXIMUM_AUTHORIZED_USD_PER_RUN) {
    blockedReasons.push(
      "P2_PROVIDER_BUDGET_CAP_USD-exceeds-hard-maximum",
    );
  }
  if (!env.P2_PROVIDER_RATE_LIMIT_RPM?.trim()) {
    blockedReasons.push("missing-P2_PROVIDER_RATE_LIMIT_RPM");
  } else if (rateLimitRpm === undefined) {
    blockedReasons.push("invalid-P2_PROVIDER_RATE_LIMIT_RPM");
  }
  if (!env.P2_PROVIDER_TIMEOUT_MS?.trim()) {
    blockedReasons.push("missing-P2_PROVIDER_TIMEOUT_MS");
  } else if (timeoutMs === undefined) {
    blockedReasons.push("invalid-P2_PROVIDER_TIMEOUT_MS");
  }

  const requestPolicy = Number.isInteger(rateLimitRpm)
    ? createProviderConnectivityRequestPolicy(rateLimitRpm)
    : undefined;
  return {
    blockedReasons,
    budgetCapUsd,
    rateLimitRpm,
    timeoutMs,
    receipt: {
      budget: {
        hardMaximumAuthorizedUsdPerRun:
          HARD_MAXIMUM_AUTHORIZED_USD_PER_RUN,
        configuredAuthorization:
          budgetCapUsd !== undefined &&
          budgetCapUsd <= HARD_MAXIMUM_AUTHORIZED_USD_PER_RUN
            ? "within-hard-maximum"
            : "missing-or-invalid",
        actualChargeMeasured: false,
      },
      rate: {
        aggregateRequestLaunchLimitPerMinute: rateLimitRpm ?? "missing",
        minimumInterRequestDelayMs:
          requestPolicy?.minimumInterRequestDelayMs ?? "missing",
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
  };
}

function readPositiveNumber(value) {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function readBoundedInteger(value, minimum, maximum) {
  if (!value?.trim() || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return parsed >= minimum && parsed <= maximum ? parsed : undefined;
}
