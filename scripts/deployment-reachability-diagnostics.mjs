#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

const defaultRoutes = [
  { id: "head-root", route: "/" },
  { id: "head-teaching", route: "/teaching" },
  { id: "head-learning", route: "/learning" },
];
const deploymentDomainReachabilityResultKeys = [
  "deploymentDomainOriginRemoteHttps",
  "deploymentDomainDnsOriginReachable",
  "deploymentDomainTransportConnected",
  "deploymentDomainRootHttpReachable",
  "deploymentDomainTeachingHttpReachable",
  "deploymentDomainLearningHttpReachable",
  "deploymentDomainFingerprintBound",
  "deploymentDomainReadinessSafety",
];

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.live && options.approved !== true) {
    throw new Error("Deployment reachability diagnostics require explicit owner approval.");
  }

  const mode = options.live ? "live" : "dry-run";
  const baseUrl = options.baseUrl || process.env.UAIS_DEPLOYMENT_BASE_URL;
  const deploymentOrigin = describeDeploymentOrigin(baseUrl);
  const initialBlockedReasons = readInitialBlockedReasons({
    baseUrl,
    domainReachabilityEvidence: options.domainReachabilityEvidence,
    releaseRunId: options.releaseRunId,
  });
  const plan = {
    target: options.domainReachabilityEvidence
      ? "deployment-domain-reachability"
      : "deployment-reachability-diagnostics",
    mode,
    environment: options.environment,
    network: mode === "live" ? "enabled" : "disabled",
    status: initialBlockedReasons.length === 0 ? "ready" : "blocked",
    responsibleSession: "S22",
    ...(options.domainReachabilityEvidence
      ? {
          releaseRunId: options.releaseRunId,
          deploymentFingerprint: createDeploymentFingerprint(baseUrl),
          domainOrigin: deploymentOrigin,
          httpObservation: {
            status: "planned",
            checkedRoutes: defaultRoutes.map(({ route }) => route),
            valueRedacted: true,
          },
        }
      : { deploymentOrigin }),
    timeoutMs: options.timeoutMs,
    ...(options.resolvedAddress ? { resolvedAddress: "pinned-redacted" } : {}),
    checks: buildPlannedChecks(deploymentOrigin),
    blockedReasons: initialBlockedReasons,
    safety: options.domainReachabilityEvidence ? buildDomainReachabilitySafety() : buildSafety(),
  };
  if (options.domainReachabilityEvidence) {
    plan.results = buildDeploymentDomainReachabilityResults({
      deploymentOrigin: plan.domainOrigin,
      deploymentFingerprint: plan.deploymentFingerprint,
      checks: plan.checks,
      safety: plan.safety,
      releaseRunId: options.releaseRunId,
    });
  }

  if (mode === "dry-run" || plan.status === "blocked") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exit(plan.status === "blocked" && mode === "live" ? 1 : 0);
  }

  const checks = await runDiagnostics({
    baseUrl,
    timeoutMs: options.timeoutMs,
    resolvedAddress: options.resolvedAddress,
  });
  const blockedReasons = readBlockedReasons(checks);
  if (options.domainReachabilityEvidence) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ...plan,
          status: blockedReasons.length === 0 ? "reachable" : "blocked",
          httpObservation: {
            status: blockedReasons.length === 0 ? "observed" : "blocked",
            checkedRoutes: defaultRoutes.map(({ route }) => route),
            valueRedacted: true,
          },
          sourceDiagnostics: {
            target: "deployment-reachability-diagnostics",
            status: blockedReasons.length === 0 ? "passed" : "blocked",
            valueRedacted: true,
          },
          checks,
          results: buildDeploymentDomainReachabilityResults({
            deploymentOrigin: plan.domainOrigin,
            deploymentFingerprint: plan.deploymentFingerprint,
            checks,
            safety: plan.safety,
            releaseRunId: options.releaseRunId,
          }),
          blockedReasons,
        },
        null,
        2,
      )}\n`,
    );
    if (blockedReasons.length > 0) {
      process.exitCode = 1;
    }
  } else {
    process.stdout.write(
      `${JSON.stringify(
        {
          ...plan,
          status: blockedReasons.length === 0 ? "passed" : "blocked",
          checks,
          blockedReasons,
        },
        null,
        2,
      )}\n`,
    );
    if (blockedReasons.length > 0) {
      process.exitCode = 1;
    }
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Deployment reachability diagnostics failed."}\n`,
  );
  process.exitCode = 1;
}

function buildPlannedChecks(deploymentOrigin) {
  return [
    {
      id: "origin-class",
      status: deploymentOrigin.status,
      originClass: deploymentOrigin.originClass,
      valueRedacted: true,
    },
    {
      id: "dns-origin",
      status: "planned",
      valueRedacted: true,
    },
    {
      id: "transport-origin",
      status: "planned",
      valueRedacted: true,
    },
    ...defaultRoutes.map(({ id, route }) => ({
      id,
      method: "HEAD",
      route,
      status: "planned",
      valueRedacted: true,
    })),
  ];
}

async function runDiagnostics({ baseUrl, timeoutMs, resolvedAddress }) {
  const origin = new URL(baseUrl);
  const deploymentOrigin = describeDeploymentOrigin(baseUrl);
  const dnsCheck = await runDnsCheck({
    origin,
    deploymentOrigin,
    timeoutMs,
    resolvedAddress,
  });
  const transportCheck = await runTransportCheck({
    origin,
    deploymentOrigin,
    timeoutMs,
    resolvedAddress,
  });
  const routeChecks = await Promise.all(
    defaultRoutes.map((route) =>
      runHeadCheck({ origin, timeoutMs, resolvedAddress, ...route }),
    ),
  );
  return [
    {
      id: "origin-class",
      status: deploymentOrigin.status,
      originClass: deploymentOrigin.originClass,
      valueRedacted: true,
    },
    dnsCheck,
    transportCheck,
    ...routeChecks,
  ];
}

async function runDnsCheck({ origin, deploymentOrigin, timeoutMs, resolvedAddress }) {
  if (deploymentOrigin.originClass !== "remote-https" && deploymentOrigin.originClass !== "insecure-http") {
    return {
      id: "dns-origin",
      status: "skipped-local-or-private-origin",
      valueRedacted: true,
    };
  }
  if (resolvedAddress) {
    return {
      id: "dns-origin",
      status: "pinned-address",
      addressCount: 1,
      addressFamilies: [net.isIP(resolvedAddress)],
      valueRedacted: true,
    };
  }

  try {
    const addresses = await withTimeout(
      lookup(origin.hostname, { all: true }),
      timeoutMs,
      "TimeoutError",
    );
    const families = [...new Set(addresses.map((address) => address.family))].sort();
    return {
      id: "dns-origin",
      status: addresses.length > 0 ? "resolved" : "failed",
      addressCount: addresses.length,
      addressFamilies: families,
      valueRedacted: true,
    };
  } catch (error) {
    return {
      id: "dns-origin",
      status: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "failed",
      networkError: classifyNetworkError(error),
      valueRedacted: true,
    };
  }
}

async function runTransportCheck({ origin, deploymentOrigin, timeoutMs, resolvedAddress }) {
  if (deploymentOrigin.status !== "present") {
    return {
      id: "transport-origin",
      status: "missing-origin",
      valueRedacted: true,
    };
  }

  const port = Number(origin.port || (origin.protocol === "https:" ? 443 : 80));
  const connect = origin.protocol === "https:" ? connectTls : connectTcp;
  const hostname = resolvedAddress || origin.hostname;
  try {
    await connect({
      hostname,
      port,
      timeoutMs,
      servername: origin.hostname,
    });
    return {
      id: "transport-origin",
      protocol: origin.protocol === "https:" ? "tls" : "tcp",
      status: "connected",
      ...(resolvedAddress ? { addressSource: "pinned" } : {}),
      valueRedacted: true,
    };
  } catch (error) {
    return {
      id: "transport-origin",
      protocol: origin.protocol === "https:" ? "tls" : "tcp",
      status: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "failed",
      networkError: classifyNetworkError(error),
      valueRedacted: true,
    };
  }
}

function connectTcp({ hostname, port, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: hostname, port });
    let settled = false;
    const finish = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      callback(value);
    };
    socket.setTimeout(timeoutMs, () => finish(reject, createTimeoutError()));
    socket.once("connect", () => finish(resolve));
    socket.once("error", (error) => finish(reject, error));
  });
}

function connectTls({ hostname, port, timeoutMs, servername }) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: hostname,
      port,
      servername,
      rejectUnauthorized: true,
    });
    let settled = false;
    const finish = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      callback(value);
    };
    socket.setTimeout(timeoutMs, () => finish(reject, createTimeoutError()));
    socket.once("secureConnect", () => finish(resolve));
    socket.once("error", (error) => finish(reject, error));
  });
}

function runHeadCheck({ origin, route, id, timeoutMs, resolvedAddress }) {
  return new Promise((resolve) => {
    const requestUrl = new URL(route, origin);
    const client = requestUrl.protocol === "https:" ? https : http;
    const request = client.request(
      {
        protocol: requestUrl.protocol,
        hostname: resolvedAddress || requestUrl.hostname,
        port: requestUrl.port || (requestUrl.protocol === "https:" ? 443 : 80),
        path: `${requestUrl.pathname}${requestUrl.search}`,
        method: "HEAD",
        timeout: timeoutMs,
        ...(requestUrl.protocol === "https:" ? { servername: requestUrl.hostname } : {}),
        headers: {
          host: requestUrl.host,
          accept: "text/html,application/json,audio/wav,*/*;q=0.1",
        },
      },
      (response) => {
        response.resume();
        const deploymentProtection = classifyDeploymentProtection(response.statusCode, response.headers);
        const status = deploymentProtection
          ? "deployment-protected"
          : response.statusCode && response.statusCode >= 200 && response.statusCode < 400
            ? "reachable"
            : "http-error";
        resolve({
          id,
          method: "HEAD",
          route,
          status,
          httpStatusClass: toHttpStatusClass(response.statusCode),
          ...(resolvedAddress ? { addressSource: "pinned" } : {}),
          ...(deploymentProtection ? { deploymentProtection } : {}),
          valueRedacted: true,
        });
      },
    );
    let settled = false;
    const finishFailure = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      request.destroy();
      resolve({
        id,
        method: "HEAD",
        route,
        status: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "failed",
        networkError: classifyNetworkError(error),
        valueRedacted: true,
      });
    };
    request.on("response", () => {
      settled = true;
    });
    request.on("timeout", () => finishFailure(createTimeoutError()));
    request.on("error", finishFailure);
    request.end();
  });
}

function classifyDeploymentProtection(statusCode, headers) {
  if (statusCode !== 401 && statusCode !== 403) {
    return undefined;
  }

  const setCookie = headers["set-cookie"];
  const cookies = Array.isArray(setCookie)
    ? setCookie
    : typeof setCookie === "string"
      ? [setCookie]
      : [];
  if (cookies.some((cookie) => cookie.includes("_vercel_sso_nonce="))) {
    return {
      provider: "vercel",
      evidence: "sso-cookie",
      valueRedacted: true,
    };
  }

  return undefined;
}

function readBlockedReasons(checks) {
  return checks.flatMap((check) => {
    if (check.id === "origin-class") {
      return check.status === "present" ? [] : ["deployment-origin-missing"];
    }
    if (check.id === "dns-origin") {
      if (
        check.status === "resolved" ||
        check.status === "pinned-address" ||
        check.status === "skipped-local-or-private-origin"
      ) {
        return [];
      }
      return [`dns-origin-${check.status}`];
    }
    if (check.id === "transport-origin") {
      return check.status === "connected" ? [] : [`transport-origin-${check.status}`];
    }
    if (check.id.startsWith("head-")) {
      return check.status === "reachable" ? [] : [`${check.id}-${check.status}`];
    }
    return [];
  });
}

function buildDeploymentDomainReachabilityResults({
  deploymentOrigin,
  deploymentFingerprint,
  checks,
  safety,
  releaseRunId,
}) {
  const checkById = new Map(checks.map((check) => [check.id, check]));
  return Object.fromEntries(
    deploymentDomainReachabilityResultKeys.map((key) => [
      key,
      isDeploymentDomainReachabilityResultPassed({
        key,
        deploymentOrigin,
        deploymentFingerprint,
        checkById,
        safety,
        releaseRunId,
      })
        ? "passed"
        : "blocked",
    ]),
  );
}

function isDeploymentDomainReachabilityResultPassed({
  key,
  deploymentOrigin,
  deploymentFingerprint,
  checkById,
  safety,
  releaseRunId,
}) {
  if (key === "deploymentDomainOriginRemoteHttps") {
    return deploymentOrigin.status === "present" && deploymentOrigin.originClass === "remote-https";
  }
  if (key === "deploymentDomainDnsOriginReachable") {
    const status = checkById.get("dns-origin")?.status;
    return status === "resolved" || status === "pinned-address";
  }
  if (key === "deploymentDomainTransportConnected") {
    return checkById.get("transport-origin")?.status === "connected";
  }
  if (key === "deploymentDomainRootHttpReachable") {
    return checkById.get("head-root")?.status === "reachable";
  }
  if (key === "deploymentDomainTeachingHttpReachable") {
    return checkById.get("head-teaching")?.status === "reachable";
  }
  if (key === "deploymentDomainLearningHttpReachable") {
    return checkById.get("head-learning")?.status === "reachable";
  }
  if (key === "deploymentDomainFingerprintBound") {
    return deploymentFingerprint.status === "present" && hasValue(releaseRunId);
  }
  if (key === "deploymentDomainReadinessSafety") {
    return Boolean(
      safety?.valuesRedacted === true &&
        safety?.cookieValuesOmitted === true &&
        safety?.responseBodiesOmitted === true &&
        safety?.liveRequiresApproval === true &&
        safety?.remoteMutationRequiresApproval === true &&
        safety?.noMutation === true,
    );
  }
  return false;
}

function toHttpStatusClass(statusCode) {
  if (!Number.isInteger(statusCode)) {
    return "missing";
  }
  return `${Math.floor(statusCode / 100)}xx`;
}

function withTimeout(promise, timeoutMs, errorName) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => {
        const error = createTimeoutError();
        error.name = errorName;
        reject(error);
      }, timeoutMs);
    }),
  ]).finally(() => clearTimeout(timeout));
}

function createTimeoutError() {
  const error = new Error("Operation timed out.");
  error.name = "TimeoutError";
  return error;
}

function parseArgs(args) {
  const options = {
    live: false,
    approved: false,
    environment: "unspecified",
    baseUrl: undefined,
    timeoutMs: 10_000,
    resolvedAddress: undefined,
    domainReachabilityEvidence: false,
    releaseRunId: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      options.live = false;
    } else if (arg === "--live") {
      options.live = true;
    } else if (arg === "--approved") {
      options.approved = true;
    } else if (arg === "--environment") {
      options.environment = normalizeEnvironment(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === "--base-url") {
      options.baseUrl = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = normalizeTimeout(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === "--resolved-address") {
      options.resolvedAddress = normalizeResolvedAddress(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === "--domain-reachability-evidence") {
      options.domainReachabilityEvidence = true;
    } else if (arg === "--release-run-id") {
      options.releaseRunId = normalizeReleaseRunId(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node scripts/deployment-reachability-diagnostics.mjs [--dry-run] [--live --approved] [--environment production|preview|local-production|unspecified] [--base-url URL] [--timeout-ms MS] [--resolved-address IP] [--domain-reachability-evidence --release-run-id ID]",
          "",
          "Outputs redacted origin, DNS, transport, and route-level HEAD reachability diagnostics without printing URLs, hostnames, response bodies, or response header values.",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function readInitialBlockedReasons({
  baseUrl,
  domainReachabilityEvidence,
  releaseRunId,
}) {
  return [
    ...(hasValue(baseUrl) ? [] : ["missing-UAIS_DEPLOYMENT_BASE_URL"]),
    ...(domainReachabilityEvidence && !hasValue(releaseRunId)
      ? ["missing-release-run-id"]
      : []),
  ];
}

function normalizeEnvironment(value) {
  const environment = value.trim().toLowerCase();
  if (
    environment !== "production" &&
    environment !== "preview" &&
    environment !== "local-production" &&
    environment !== "unspecified"
  ) {
    throw new Error("--environment must be production, preview, local-production, or unspecified.");
  }
  return environment;
}

function normalizeTimeout(value) {
  const timeout = Number(value);
  if (!Number.isInteger(timeout) || timeout < 25 || timeout > 60_000) {
    throw new Error("--timeout-ms must be an integer from 25 to 60000.");
  }
  return timeout;
}

function normalizeResolvedAddress(value) {
  const address = value.trim();
  if (net.isIP(address) === 0) {
    throw new Error("--resolved-address must be an IPv4 or IPv6 address.");
  }
  return address;
}

function normalizeReleaseRunId(value) {
  const releaseRunId = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(releaseRunId)) {
    throw new Error("--release-run-id must be 3-128 URL-safe-ish characters.");
  }
  return releaseRunId;
}

function readArgValue(args, index, name) {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function describeDeploymentOrigin(baseUrl) {
  const originClass = classifyDeploymentOrigin(baseUrl);
  return {
    status: originClass === "missing" ? "missing" : "present",
    originClass,
    valueRedacted: true,
  };
}

function createDeploymentFingerprint(baseUrl) {
  if (!hasValue(baseUrl)) {
    return {
      status: "missing",
      valueRedacted: true,
    };
  }

  return {
    status: "present",
    value: `sha256:${createHash("sha256").update(baseUrl).digest("hex").slice(0, 16)}`,
    valueRedacted: true,
  };
}

function classifyDeploymentOrigin(baseUrl) {
  if (!hasValue(baseUrl)) {
    return "missing";
  }

  try {
    const origin = new URL(baseUrl);
    const hostClass = classifyOriginHost(origin.hostname);
    if (hostClass !== "remote") {
      return hostClass;
    }
    return origin.protocol === "https:" ? "remote-https" : "insecure-http";
  } catch {
    return "invalid";
  }
}

function classifyOriginHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host === "0.0.0.0") {
    return "local-loopback";
  }
  const octets = host.split(".").map((part) => Number(part));
  if (octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    if (octets[0] === 127) {
      return "local-loopback";
    }
    if (
      octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 169 && octets[1] === 254)
    ) {
      return "private-network";
    }
  }
  return "remote";
}

function classifyNetworkError(error) {
  const errorClass =
    error instanceof Error && hasValue(error.name) ? error.name : "UnknownError";
  const code = isRecord(error) && typeof error.code === "string"
    ? sanitizeErrorClass(error.code)
    : undefined;
  return {
    class: sanitizeErrorClass(errorClass),
    ...(code ? { code } : {}),
    valueRedacted: true,
  };
}

function sanitizeErrorClass(value) {
  const normalized = value.trim().replace(/[^A-Za-z0-9_.:-]/g, "-");
  return normalized === "" ? "UnknownError" : normalized.slice(0, 80);
}

function buildSafety() {
  return {
    valuesRedacted: true,
    urlsOmitted: true,
    hostnamesOmitted: true,
    responseBodiesOmitted: true,
    responseHeadersOmitted: true,
    localPrivatePathsOmitted: true,
    cookieValuesOmitted: true,
    liveRequiresApproval: true,
    remoteMutationRequiresApproval: true,
  };
}

function buildDomainReachabilitySafety() {
  return {
    ...buildSafety(),
    noMutation: true,
  };
}

function hasValue(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
