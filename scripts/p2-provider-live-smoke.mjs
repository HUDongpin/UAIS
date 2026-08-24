#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createProviderConnectivityChildEnv } from "./lib/p2-provider-connectivity-child.mjs";
import {
  assessProviderSmokeChild,
  createProviderExecutionPolicy,
} from "./lib/p2-provider-evidence.mjs";

// Kept for the established aggregate receipt contract. The trusted child has a
// stricter fixed totalRequestLimit of two and no code path for a third request.
const maxRequests = 3;
const executionPolicy = createProviderExecutionPolicy(process.env);
const { rateLimitRpm, timeoutMs } = executionPolicy;
const blockedReasons = [...executionPolicy.blockedReasons];

if (process.env.P2_PROVIDER_LIVE_CONFIRM !== "approved") {
  blockedReasons.push("missing-P2_PROVIDER_LIVE_CONFIRM");
}
if (process.env.P2_PROVIDER_MONITORING !== "confirmed") {
  blockedReasons.push("missing-P2_PROVIDER_MONITORING");
}
if (!process.env.DEEPSEEK_API_KEY?.trim()) {
  blockedReasons.push("missing-DEEPSEEK_API_KEY");
}
if (!process.env.DASHSCOPE_API_KEY?.trim()) {
  blockedReasons.push("missing-DASHSCOPE_API_KEY");
}

if (blockedReasons.length > 0) {
  emit({
    status: "BLOCKED_ENV",
    networkUsed: false,
    requestsAttempted: 0,
    blockedReasons,
  });
  process.exitCode = 2;
} else {
  const childPath = fileURLToPath(new URL("./lib/p2-provider-connectivity-child.mjs", import.meta.url));
  const childEnv = createProviderConnectivityChildEnv(process.env, {
    timeoutMs,
    rateLimitRpm,
  });
  const childTimeoutMs =
    timeoutMs * executionPolicy.receipt.requests.totalRequestLimit +
    executionPolicy.receipt.rate.minimumInterRequestDelayMs +
    5_000;
  const child = spawnSync(
    process.execPath,
    [childPath],
    {
      env: childEnv,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: childTimeoutMs,
      killSignal: "SIGTERM",
    },
  );

  const assessment = assessProviderSmokeChild(child, {
    expectedRateLimitRpm: rateLimitRpm,
  });
  emit({
    status: assessment.status,
    networkUsed: true,
    requestsAttempted: assessment.requestsAttempted,
    blockedReasons: assessment.blockedReasons,
    results: assessment.results,
  });
  process.exitCode = assessment.status === "PASS" ? 0 : 1;
}

function emit(input) {
  process.stdout.write(
    `${JSON.stringify(
      {
        target: "p2-provider-live-smoke",
        status: input.status,
        networkUsed: input.networkUsed,
        capabilities: ["text-generation-connectivity"],
        requestsAttempted: input.requestsAttempted,
        maxRequests,
        maxRequestsMeaning: "legacy-absolute-ceiling",
        budgetProtection: executionPolicy.receipt.budget,
        rateProtection: executionPolicy.receipt.rate,
        requestProtection: executionPolicy.receipt.requests,
        timeoutProtection: timeoutMs === undefined ? "missing" : "present",
        monitoring: process.env.P2_PROVIDER_MONITORING === "confirmed" ? "confirmed" : "missing",
        blockedReasons: input.blockedReasons,
        ...(input.results ? { results: input.results } : {}),
        safety: {
          credentialsOmitted: true,
          promptsOmitted: true,
          rawProviderBodiesOmitted: true,
          automaticRetries: 0,
          officialHttpsOriginsOnly: true,
          redirectsBlocked: true,
          childEnvironmentAllowlisted: true,
          actualProviderChargeClaimed: false,
        },
      },
      null,
      2,
    )}\n`,
  );
}
