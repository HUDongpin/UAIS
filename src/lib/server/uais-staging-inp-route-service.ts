import { createHmac } from "node:crypto";
import {
  UAIS_STAGING_INP_TTL_HOURS,
  classifyUaisStagingInpJourney,
  parseUaisStagingInpPayload,
  type UaisStagingInpBinding,
} from "@/lib/observability/uais-staging-inp";
import { getUaisAppSessionClaimsFromCookieString } from "@/lib/server/uais-app-session";
import { isApprovedUaisStagingInpOperator } from "@/lib/server/uais-staging-inp-access";
import {
  getVerifiedUaisStagingInpRouteAttestation,
  readUaisStagingInpRouteAttestationFromCookieString,
} from "@/lib/server/uais-staging-inp-route-attestation";
import {
  getUaisStagingInpBinding,
  getUaisStagingInpGuard,
} from "@/lib/server/uais-staging-inp-runtime";
import {
  UaisStagingInpStoreError,
  createUaisStagingInpPostgresStore,
  type UaisStagingInpStoredSample,
} from "@/lib/server/uais-staging-inp-store";

type StagingInpHandlerDependencies = {
  env?: Record<string, string | undefined>;
  verifiedContentSha?: string;
  now?: () => Date;
  persist?: (
    sample: UaisStagingInpStoredSample,
  ) => Promise<{ status: "stored" | "updated" | "unchanged" }>;
  consumeIngress?: (input: {
    cohortId: string;
    operatorKey: string;
    observedAt: Date;
  }) => { allowed: boolean; retryAfterSeconds: number };
};

const ingressBuckets = new Map<string, { minute: number; count: number }>();
const maximumIngressRequestsPerOperatorMinute = 60;

export function createStagingInpPostHandler(
  dependencies: StagingInpHandlerDependencies = {},
) {
  const env = dependencies.env ?? process.env;
  const now = dependencies.now ?? (() => new Date());

  return async function post(request: Request) {
    const guard = getUaisStagingInpGuard(env, dependencies.verifiedContentSha);
    const binding = guard.enabled
      ? getUaisStagingInpBinding(env, dependencies.verifiedContentSha)
      : null;
    if (!guard.enabled || !binding) return jsonResponse(404, "not-found");
    if (!hasExactImmutableOrigin(request, binding)) {
      return jsonResponse(403, "denied");
    }

    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.split(";", 1)[0]?.trim() !== "application/json") {
      return jsonResponse(415, "unsupported-media-type");
    }
    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > 512) {
      return jsonResponse(413, "payload-too-large");
    }
    const boundedBody = await readBoundedBody(request, 512);
    if (!boundedBody.ok) {
      return jsonResponse(413, "payload-too-large");
    }
    const payload = parseUaisStagingInpPayload(parseJson(boundedBody.text));
    if (!payload) return jsonResponse(400, "invalid-payload");

    const observedAt = now();
    const claims = getUaisAppSessionClaimsFromCookieString(
      request.headers.get("cookie"),
      { env, now: observedAt },
    );
    if (!claims || (claims.role !== "student" && claims.role !== "teacher")) {
      return jsonResponse(401, "session-required");
    }
    if (!isApprovedUaisStagingInpOperator(claims.account, env)) {
      return jsonResponse(403, "operator-not-approved");
    }
    const documentJourney = getSameOriginDocumentJourney(request, binding);
    if (!documentJourney) {
      return jsonResponse(403, "document-context-required");
    }
    const routeAttestation = getVerifiedUaisStagingInpRouteAttestation({
      token: readUaisStagingInpRouteAttestationFromCookieString(
        request.headers.get("cookie"),
      ),
      binding,
      account: claims.account,
      sessionId: claims.sessionId,
      role: claims.role,
      journey: documentJourney,
      secret: env.UAIS_STAGING_INP_HMAC_SECRET ?? "",
      now: observedAt,
      sessionExpiresAt: claims.expiresAt,
    });
    if (!routeAttestation) {
      return jsonResponse(403, "route-attestation-required");
    }
    const ingress = (dependencies.consumeIngress ?? consumeIngress)({
      cohortId: binding.cohortId,
      operatorKey: routeAttestation.operatorKey,
      observedAt,
    });
    if (!ingress.allowed) {
      return jsonResponse(429, "rate-limited", {
        "retry-after": String(ingress.retryAfterSeconds),
      });
    }

    const sample: UaisStagingInpStoredSample = {
      ...binding,
      sampleKey: createSampleKey({
        secret: env.UAIS_STAGING_INP_HMAC_SECRET ?? "",
        binding,
        routeAttestationId: routeAttestation.jti,
      }),
      operatorKey: routeAttestation.operatorKey,
      metricIdKey: createMetricIdKey({
        secret: env.UAIS_STAGING_INP_HMAC_SECRET ?? "",
        routeAttestationId: routeAttestation.jti,
        metricId: payload.id,
      }),
      role: claims.role,
      journey: routeAttestation.journey,
      viewportClass: payload.viewportClass,
      navigationType: payload.navigationType,
      valueMs: payload.valueMs,
      receivedAt: observedAt.toISOString(),
      expiresAt: new Date(
        observedAt.getTime() + UAIS_STAGING_INP_TTL_HOURS * 60 * 60 * 1_000,
      ).toISOString(),
    };

    try {
      const persist =
        dependencies.persist ?? createUaisStagingInpPostgresStore({ env }).persist;
      await persist(sample);
      return jsonResponse(202, "accepted");
    } catch (error) {
      if (error instanceof UaisStagingInpStoreError) {
        return jsonResponse(error.status, "temporarily-unavailable");
      }
      return jsonResponse(503, "temporarily-unavailable");
    }
  };
}

function getSameOriginDocumentJourney(
  request: Request,
  binding: UaisStagingInpBinding,
) {
  const referrer = request.headers.get("referer");
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    if (
      url.protocol !== "https:" ||
      url.hostname !== binding.deploymentHost ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return null;
    }
    return classifyUaisStagingInpJourney(url.pathname);
  } catch {
    return null;
  }
}

async function readBoundedBody(
  request: Request,
  maximumBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  if (!request.body) return { ok: true, text: "" };
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel("staging-inp-payload-too-large").catch(() => undefined);
        return { ok: false };
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, text };
  } catch {
    return { ok: false };
  } finally {
    reader.releaseLock();
  }
}

function hasExactImmutableOrigin(request: Request, binding: UaisStagingInpBinding) {
  return (
    request.headers.get("origin") === `https://${binding.deploymentHost}` &&
    request.headers.get("host") === binding.deploymentHost &&
    request.headers.get("x-forwarded-proto") === "https" &&
    request.headers.get("sec-fetch-site") === "same-origin"
  );
}

function createSampleKey(input: {
  secret: string;
  binding: UaisStagingInpBinding;
  routeAttestationId: string;
}) {
  return createHmac("sha256", input.secret)
    .update(
      [
        "uais-staging-inp-sample:v4",
        input.binding.cohortId,
        input.binding.candidateGitSha,
        input.binding.candidateContentSha,
        input.binding.deploymentHost,
        input.binding.collectorKeyVersion,
        input.binding.operatorAllowlistFingerprint,
        input.routeAttestationId,
      ].join("\u0000"),
    )
    .digest("hex");
}

function createMetricIdKey(input: {
  secret: string;
  routeAttestationId: string;
  metricId: string;
}) {
  return createHmac("sha256", input.secret)
    .update(
      [
        "uais-staging-inp-metric-id:v1",
        input.routeAttestationId,
        input.metricId,
      ].join("\u0000"),
    )
    .digest("hex");
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function consumeIngress(input: {
  cohortId: string;
  operatorKey: string;
  observedAt: Date;
}) {
  const observedMs = input.observedAt.getTime();
  const minute = Math.floor(observedMs / 60_000);
  const key = `${input.cohortId}\u0000${input.operatorKey}`;
  const bucket = ingressBuckets.get(key);
  const count = bucket?.minute === minute ? bucket.count + 1 : 1;
  ingressBuckets.set(key, { minute, count });
  if (ingressBuckets.size > 2_000) {
    for (const [candidateKey, candidate] of ingressBuckets) {
      if (candidate.minute < minute) ingressBuckets.delete(candidateKey);
    }
  }
  return {
    allowed: count <= maximumIngressRequestsPerOperatorMinute,
    retryAfterSeconds: Math.max(1, 60 - Math.floor((observedMs % 60_000) / 1_000)),
  };
}

function jsonResponse(
  status: number,
  responseStatus: string,
  additionalHeaders: Record<string, string> = {},
) {
  return Response.json(
    {
      target: "uais-staging-inp",
      status: responseStatus,
      valuesRedacted: true,
    },
    {
      status,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
        ...additionalHeaders,
      },
    },
  );
}
