#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const maxRequests = 3;
const timeoutMs = readBoundedInteger(process.env.P2_PROVIDER_TIMEOUT_MS, 1_000, 60_000);
const budgetCap = readPositiveNumber(process.env.P2_PROVIDER_BUDGET_CAP_USD);
const rateLimit = readBoundedInteger(process.env.P2_PROVIDER_RATE_LIMIT_RPM, 1, 3);
const blockedReasons = [];

if (process.env.P2_PROVIDER_LIVE_CONFIRM !== "approved") {
  blockedReasons.push("missing-P2_PROVIDER_LIVE_CONFIRM");
}
if (budgetCap === undefined) {
  blockedReasons.push("missing-P2_PROVIDER_BUDGET_CAP_USD");
}
if (rateLimit === undefined) {
  blockedReasons.push("missing-P2_PROVIDER_RATE_LIMIT_RPM");
}
if (timeoutMs === undefined) {
  blockedReasons.push("missing-P2_PROVIDER_TIMEOUT_MS");
}
if (process.env.P2_PROVIDER_MONITORING !== "confirmed") {
  blockedReasons.push("missing-P2_PROVIDER_MONITORING");
}
if (!process.env.DEEPSEEK_API_KEY?.trim() && !process.env.DASHSCOPE_API_KEY?.trim()) {
  blockedReasons.push("missing-approved-provider-credential");
}

if (blockedReasons.length > 0) {
  emit({
    status: "BLOCKED_ENV",
    networkUsed: false,
    blockedReasons,
  });
  process.exitCode = 2;
} else {
  const child = spawnSync(
    process.execPath,
    ["scripts/ai-provider-smoke.mjs", "--live", "--approved"],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs * maxRequests,
      killSignal: "SIGTERM",
    },
  );

  if (child.error || child.status !== 0) {
    emit({
      status: "FAIL",
      networkUsed: true,
      blockedReasons: [child.error?.code === "ETIMEDOUT" ? "provider-smoke-timeout" : "provider-smoke-failed"],
    });
    process.exitCode = 1;
  } else {
    const result = JSON.parse(child.stdout);
    emit({
      status: "PASS",
      networkUsed: true,
      blockedReasons: [],
      results: Array.isArray(result.results)
        ? result.results.map((item) => ({
            provider: item.provider,
            model: item.model,
            status: item.status,
            httpStatus: item.httpStatus,
          }))
        : [],
    });
  }
}

function emit(input) {
  process.stdout.write(
    `${JSON.stringify(
      {
        target: "p2-provider-live-smoke",
        status: input.status,
        networkUsed: input.networkUsed,
        maxRequests,
        costProtection: {
          budgetCap: budgetCap === undefined ? "missing" : "present",
          rateLimit: rateLimit === undefined ? "missing" : "present",
          valuesRedacted: true,
        },
        timeoutProtection: timeoutMs === undefined ? "missing" : "present",
        monitoring: process.env.P2_PROVIDER_MONITORING === "confirmed" ? "confirmed" : "missing",
        blockedReasons: input.blockedReasons,
        ...(input.results ? { results: input.results } : {}),
        safety: {
          credentialsOmitted: true,
          promptsOmitted: true,
          rawProviderBodiesOmitted: true,
          automaticRetries: 0,
        },
      },
      null,
      2,
    )}\n`,
  );
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
