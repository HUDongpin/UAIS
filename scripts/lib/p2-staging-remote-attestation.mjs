import { createHash } from "node:crypto";

const expectedBindingShape = Object.freeze({
  status: "bound",
  lane: "isolated-staging",
  project: "uais-staging",
});

export function createUaisStagingHostFingerprint(hostname) {
  return createHash("sha256")
    .update(`uais-staging-deployment-host:v1\u0000${hostname}`)
    .digest("hex");
}

export function assessUaisStagingRemoteHealth({
  httpStatus,
  body,
  baseUrl,
  candidateGitSha,
  candidateContentSha,
  stagingInpRum,
}) {
  const binding = body?.deploymentBinding;
  const failureCodes = [];
  const applicationHealth =
    httpStatus === 200 &&
    body?.status === "ok" &&
    body?.checks?.app === "ok" &&
    body?.checks?.database === "ok" &&
    body?.checks?.migrations === "ok";
  if (!applicationHealth) failureCodes.push("remote-application-health-failed");

  const bindingPresent =
    binding &&
    typeof binding === "object" &&
    binding.status === expectedBindingShape.status &&
    binding.lane === expectedBindingShape.lane &&
    binding.project === expectedBindingShape.project;
  if (!bindingPresent) failureCodes.push("remote-deployment-binding-missing");

  const expectedHostFingerprint = readExpectedHostFingerprint(baseUrl);
  const checks = {
    applicationHealth: applicationHealth ? "PASS" : "FAIL",
    deploymentBinding: bindingPresent ? "PASS" : "FAIL",
    candidateGitSha:
      bindingPresent && binding.candidateGitSha === candidateGitSha
        ? "PASS"
        : "FAIL",
    candidateContentSha:
      bindingPresent && binding.candidateContentSha === candidateContentSha
        ? "PASS"
        : "FAIL",
    deploymentHost:
      bindingPresent &&
      expectedHostFingerprint &&
      binding.deploymentHostFingerprint === expectedHostFingerprint
        ? "PASS"
        : "FAIL",
    stagingInpRum:
      bindingPresent && binding.stagingInpRum === stagingInpRum
        ? "PASS"
        : "FAIL",
    valuesRedacted:
      bindingPresent && binding.valuesRedacted === true ? "PASS" : "FAIL",
  };
  if (checks.candidateGitSha === "FAIL") {
    failureCodes.push("remote-candidate-git-sha-mismatch");
  }
  if (checks.candidateContentSha === "FAIL") {
    failureCodes.push("remote-candidate-content-sha-mismatch");
  }
  if (checks.deploymentHost === "FAIL") {
    failureCodes.push("remote-deployment-host-mismatch");
  }
  if (checks.stagingInpRum === "FAIL") {
    failureCodes.push("remote-staging-rum-mode-mismatch");
  }
  if (checks.valuesRedacted === "FAIL") {
    failureCodes.push("remote-redaction-attestation-missing");
  }

  return {
    status: failureCodes.length === 0 ? "PASS" : "FAIL",
    failureCodes: [...new Set(failureCodes)],
    checks,
  };
}

export function assessUaisStagingProtectionDifferential({
  unprotectedHttpStatus,
  unprotectedHeaders,
  targetUrl,
  immutableDeploymentUrl,
  bypassed,
}) {
  const challenge = assessVercelAuthenticationChallenge({
    httpStatus: unprotectedHttpStatus,
    headers: unprotectedHeaders,
    targetUrl,
    immutableDeploymentUrl,
  });
  const unprotectedDeploymentProtectionChallenge =
    challenge.status === "PASS";
  const bypassedBoundApplicationReached = bypassed?.status === "PASS";
  const failureCodes = [];
  if (!unprotectedDeploymentProtectionChallenge) {
    failureCodes.push("deployment-protection-not-proven");
  }
  if (!bypassedBoundApplicationReached) {
    failureCodes.push("deployment-protection-bypass-or-binding-failed");
  }
  return {
    status: failureCodes.length === 0 ? "PASS" : "FAIL",
    failureCodes,
    checks: {
      unprotectedDeploymentProtectionChallenge:
        unprotectedDeploymentProtectionChallenge ? "PASS" : "FAIL",
      bypassedBoundApplicationReached: bypassedBoundApplicationReached
        ? "PASS"
        : "FAIL",
    },
  };
}

export async function runUaisStagingRemotePreflight({
  fetchImpl = globalThis.fetch,
  baseUrl,
  immutableDeploymentUrl,
  bypassSecret,
  candidateGitSha,
  candidateContentSha,
  stagingInpRum,
  signal,
}) {
  const target = readExactImmutableHealthTarget({
    baseUrl,
    immutableDeploymentUrl,
  });
  if (!target) {
    return createPreflightFailure({
      protectionFailureCode: "deployment-protection-target-invalid",
      remoteHealthFailureCode: "remote-healthz-not-run",
    });
  }
  if (
    typeof bypassSecret !== "string" ||
    bypassSecret.length < 16 ||
    bypassSecret.length > 1_024 ||
    /[\r\n]/.test(bypassSecret)
  ) {
    return createPreflightFailure({
      protectionFailureCode: "deployment-protection-bypass-secret-invalid",
      remoteHealthFailureCode: "remote-healthz-not-run",
    });
  }
  if (typeof fetchImpl !== "function") {
    return createPreflightFailure({
      protectionFailureCode: "deployment-protection-fetch-unavailable",
      remoteHealthFailureCode: "remote-healthz-not-run",
    });
  }

  let unprotectedResponse;
  try {
    unprotectedResponse = await fetchImpl(target.healthUrl, {
      method: "GET",
      headers: { accept: "text/html" },
      cache: "no-store",
      credentials: "omit",
      redirect: "manual",
      signal,
    });
  } catch {
    return createPreflightFailure({
      protectionFailureCode: "deployment-protection-preflight-network-failed",
      remoteHealthFailureCode: "remote-healthz-not-run",
    });
  }

  const challenge = assessVercelAuthenticationChallenge({
    httpStatus: unprotectedResponse?.status,
    headers: unprotectedResponse?.headers,
    targetUrl: target.healthUrl,
    immutableDeploymentUrl: target.immutableOrigin,
  });
  await cancelResponseBody(unprotectedResponse);
  if (challenge.status !== "PASS") {
    return createPreflightFailure({
      protectionFailureCode: "deployment-protection-not-proven",
      remoteHealthFailureCode: "remote-healthz-not-run",
    });
  }

  let bypassedResponse;
  try {
    bypassedResponse = await fetchImpl(target.healthUrl, {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-vercel-protection-bypass": bypassSecret,
      },
      cache: "no-store",
      credentials: "omit",
      redirect: "manual",
      signal,
    });
  } catch {
    return createPreflightFailure({
      protectionFailureCode:
        "deployment-protection-bypass-request-network-failed",
      remoteHealthFailureCode: "remote-healthz-preflight-network-failed",
    });
  }

  const bypassedBody = await bypassedResponse.json().catch(() => undefined);
  const remoteHealth = assessUaisStagingRemoteHealth({
    httpStatus: bypassedResponse.status,
    body: bypassedBody,
    baseUrl: target.immutableOrigin,
    candidateGitSha,
    candidateContentSha,
    stagingInpRum,
  });
  const protection = assessUaisStagingProtectionDifferential({
    unprotectedHttpStatus: unprotectedResponse.status,
    unprotectedHeaders: unprotectedResponse.headers,
    targetUrl: target.healthUrl,
    immutableDeploymentUrl: target.immutableOrigin,
    bypassed: remoteHealth,
  });

  return {
    status:
      protection.status === "PASS" && remoteHealth.status === "PASS"
        ? "PASS"
        : "FAIL",
    protection,
    remoteHealth,
    redirectsFollowed: false,
    valuesRedacted: true,
  };
}

function readExpectedHostFingerprint(baseUrl) {
  try {
    const url = new URL(baseUrl);
    return createUaisStagingHostFingerprint(url.hostname.toLowerCase());
  } catch {
    return "";
  }
}

function assessVercelAuthenticationChallenge({
  httpStatus,
  headers,
  targetUrl,
  immutableDeploymentUrl,
}) {
  const normalizedHeaders = readHeaders(headers);
  const setCookies = readSetCookies(normalizedHeaders);
  const checks = {
    exactChallengeTransport: isExactVercelSsoChallengeTransport({
      httpStatus,
      location: normalizedHeaders.get("location"),
      targetUrl,
    }),
    exactImmutableTarget: Boolean(
      readExactImmutableHealthTarget({
        baseUrl: immutableDeploymentUrl,
        immutableDeploymentUrl,
        targetUrl,
      }),
    ),
    vercelEdge:
      normalizedHeaders.get("server")?.trim().toLowerCase() === "vercel" &&
      isVercelRequestId(normalizedHeaders.get("x-vercel-id")),
    htmlChallenge:
      /^text\/html(?:\s*;|$)/i.test(
        normalizedHeaders.get("content-type")?.trim() ?? "",
      ) &&
      normalizedHeaders
        .get("cache-control")
        ?.toLowerCase()
        .split(",")
        .map((value) => value.trim())
        .includes("no-store") === true,
    ssoNonceCookie: setCookies.some(isExactVercelSsoNonceCookie),
    challengeHardening:
      normalizedHeaders.get("x-frame-options")?.trim().toUpperCase() ===
        "DENY" &&
      normalizedHeaders
        .get("x-robots-tag")
        ?.toLowerCase()
        .split(",")
        .map((value) => value.trim())
        .includes("noindex") === true,
    firewallMitigationAbsent:
      normalizedHeaders.get("x-vercel-mitigated") === null &&
      normalizedHeaders.get("x-vercel-challenge-token") === null,
  };
  return {
    status: Object.values(checks).every(Boolean) ? "PASS" : "FAIL",
  };
}

function isExactVercelSsoChallengeTransport({
  httpStatus,
  location,
  targetUrl,
}) {
  if (httpStatus === 401) return location === null;
  if (httpStatus !== 302 || typeof location !== "string") return false;
  try {
    const redirect = new URL(location);
    const queryEntries = [...redirect.searchParams.entries()];
    const nonce = redirect.searchParams.get("nonce") ?? "";
    return (
      redirect.protocol === "https:" &&
      redirect.hostname === "vercel.com" &&
      redirect.port === "" &&
      redirect.username === "" &&
      redirect.password === "" &&
      redirect.pathname === "/sso-api" &&
      redirect.hash === "" &&
      queryEntries.length === 2 &&
      queryEntries.filter(([key]) => key === "url").length === 1 &&
      queryEntries.filter(([key]) => key === "nonce").length === 1 &&
      redirect.searchParams.get("url") === targetUrl &&
      /^[A-Za-z0-9_-]{16,512}$/.test(nonce)
    );
  } catch {
    return false;
  }
}

function readExactImmutableHealthTarget({
  baseUrl,
  immutableDeploymentUrl,
  targetUrl,
}) {
  try {
    const base = new URL(baseUrl);
    const immutable = new URL(immutableDeploymentUrl);
    const exactRootUrls = [base, immutable].every(
      (url) =>
        url.protocol === "https:" &&
        url.port === "" &&
        url.username === "" &&
        url.password === "" &&
        url.pathname === "/" &&
        url.search === "" &&
        url.hash === "" &&
        url.hostname !== "vercel.app" &&
        url.hostname.toLowerCase().endsWith(".vercel.app"),
    );
    if (!exactRootUrls || base.origin !== immutable.origin) return undefined;

    const healthUrl = new URL("/healthz", base.origin).href;
    if (targetUrl !== undefined && new URL(targetUrl).href !== healthUrl) {
      return undefined;
    }
    return {
      healthUrl,
      immutableOrigin: immutable.origin,
    };
  } catch {
    return undefined;
  }
}

function readHeaders(headers) {
  try {
    return headers instanceof Headers ? headers : new Headers(headers);
  } catch {
    return new Headers();
  }
}

function readSetCookies(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const value = headers.get("set-cookie");
  return value ? [value] : [];
}

function isExactVercelSsoNonceCookie(cookie) {
  if (typeof cookie !== "string") return false;
  const parts = cookie.split(";").map((part) => part.trim());
  if (!/^_vercel_sso_nonce=[A-Za-z0-9_-]{16,256}$/.test(parts[0] ?? "")) {
    return false;
  }
  const attributes = new Set(parts.slice(1).map((part) => part.toLowerCase()));
  return (
    attributes.has("max-age=3600") &&
    attributes.has("path=/") &&
    attributes.has("secure") &&
    attributes.has("httponly") &&
    attributes.has("samesite=lax")
  );
}

function isVercelRequestId(value) {
  return (
    typeof value === "string" &&
    /^[a-z0-9-]+::(?:[a-z0-9-]+-)?\d{10,16}-[A-Za-z0-9_-]{4,}$/i.test(
      value.trim(),
    )
  );
}

async function cancelResponseBody(response) {
  try {
    await response?.body?.cancel();
  } catch {
    // The response is already classified. Body disposal is best effort and its
    // contents are deliberately never surfaced in evidence.
  }
}

function createPreflightFailure({
  protectionFailureCode,
  remoteHealthFailureCode,
}) {
  return {
    status: "FAIL",
    protection: {
      status: "FAIL",
      failureCodes: [protectionFailureCode],
      checks: {
        unprotectedDeploymentProtectionChallenge: "FAIL",
        bypassedBoundApplicationReached: "NOT_RUN",
      },
    },
    remoteHealth: {
      status: "NOT_RUN",
      failureCodes: [remoteHealthFailureCode],
    },
    redirectsFollowed: false,
    valuesRedacted: true,
  };
}
