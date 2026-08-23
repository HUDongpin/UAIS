#!/usr/bin/env node

const productionHostnames = new Set([
  "uais.top",
  "www.uais.top",
  "uais.vercel.app",
]);
const userRamp = Object.freeze([5, 20, 50, 100, 200]);

const options = parseArgs(process.argv.slice(2));
const baseUrl = process.env.P2_LOAD_BASE_URL?.trim();
const allowlist = new Set(
  (process.env.P2_LOAD_ALLOWLIST ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);
const blockedReasons = [];
let hostname = "";

if (!baseUrl) {
  blockedReasons.push("missing-P2_LOAD_BASE_URL");
} else {
  try {
    const url = new URL(baseUrl);
    hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:") {
      blockedReasons.push("staging-target-must-use-https");
    }
  } catch {
    blockedReasons.push("invalid-P2_LOAD_BASE_URL");
  }
}

if (process.env.P2_LOAD_CONFIRM !== "staging") {
  blockedReasons.push("missing-P2_LOAD_CONFIRM");
}
if (allowlist.size === 0) {
  blockedReasons.push("missing-P2_LOAD_ALLOWLIST");
}

const productionRejected = hostname && isProductionHostname(hostname);
if (productionRejected) {
  blockedReasons.length = 0;
  blockedReasons.push("production-hostname-rejected");
} else if (hostname && !allowlist.has(hostname)) {
  blockedReasons.push("hostname-not-allowlisted");
}

const scenarios = [
  {
    id: "invite-join",
    users: 200,
    userRamp,
    maxRetriesPerUser: 2,
    successRateMinimum: 0.99,
    serverErrorRateMaximum: 0.005,
    p95MillisecondsMaximum: 2_000,
  },
  {
    id: "group-collaboration",
    users: 200,
    groups: 40,
    usersPerGroup: 5,
    durationSeconds: 600,
    provider: "deterministic-stub",
    successRateMinimum: 0.99,
    serverErrorRateMaximum: 0.005,
    p95MillisecondsMaximum: 2_000,
  },
];

if (productionRejected) {
  emit("FAIL", blockedReasons, 1);
} else if (blockedReasons.length > 0) {
  emit("BLOCKED_ENV", blockedReasons, 2);
} else if (options.dryRun) {
  emit("PASS", [], 0);
} else {
  const executionBlockers = ["staging-load-executor-not-configured"];
  if (!process.env.P2_LOAD_FIXTURE_MANIFEST?.trim()) {
    executionBlockers.push("missing-P2_LOAD_FIXTURE_MANIFEST");
  }
  if (process.env.P2_LOAD_CLEANUP_CONFIRM !== "run-id-cleanup") {
    executionBlockers.push("missing-P2_LOAD_CLEANUP_CONFIRM");
  }
  emit("BLOCKED_ENV", executionBlockers, 2);
}

function emit(status, reasons, exitCode) {
  const report = {
    target: "p2-staging-load",
    status,
    mode: options.dryRun ? "dry-run" : "execute",
    targetHostname: hostname ? "allowlisted-staging-host" : "missing",
    networkUsed: false,
    runId: options.runId,
    scenarios,
    blockedReasons: reasons,
    safety: {
      productionTargetsRejected: true,
      explicitStagingConfirmationRequired: true,
      fixtureValuesOmitted: true,
      cleanupRequiredBeforeExecution: true,
      liveProviderUsed: false,
    },
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = exitCode;
}

function isProductionHostname(host) {
  return productionHostnames.has(host) ||
    (host.endsWith(".uais.top") && host !== "staging.uais.top");
}

function parseArgs(args) {
  const parsed = {
    dryRun: false,
    runId: `p2-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`,
  };
  for (const arg of args) {
    if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "Usage: P2_LOAD_BASE_URL=https://staging.example P2_LOAD_ALLOWLIST=staging.example P2_LOAD_CONFIRM=staging node scripts/p2-load-test.mjs [--dry-run]\n",
      );
      process.exit(0);
    } else {
      throw new Error("Unknown P2 load-test option; value omitted.");
    }
  }
  return parsed;
}
