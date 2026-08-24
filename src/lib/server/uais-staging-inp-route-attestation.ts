import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  uaisStagingInpJourneys,
  type UaisStagingInpBinding,
  type UaisStagingInpJourney,
} from "@/lib/observability/uais-staging-inp";
import type { UaisStagingInpRole } from "@/lib/server/uais-staging-inp-store";

export const UAIS_STAGING_INP_ROUTE_ATTESTATION_COOKIE =
  "__Host-uais_staging_inp_journey";
export const UAIS_STAGING_INP_ROUTE_ATTESTATION_TTL_SECONDS = 30 * 60;

const audience = "uais-staging-inp";
const tokenDomain = "uais-staging-inp-route-attestation:v1";
const bindingDomain = "uais-staging-inp-route-binding:v1";
const operatorDomain = "uais-staging-inp-operator-key:v1";
const sessionDomain = "uais-staging-inp-session-key:v1";
const journeys = new Set<string>(uaisStagingInpJourneys);
const claimKeys = [
  "aud",
  "bindingKey",
  "exp",
  "iat",
  "journey",
  "jti",
  "kid",
  "operatorKey",
  "role",
  "sessionKey",
  "v",
].sort();

type RouteAttestationClaims = {
  v: 1;
  aud: typeof audience;
  kid: string;
  bindingKey: string;
  operatorKey: string;
  sessionKey: string;
  role: UaisStagingInpRole;
  journey: UaisStagingInpJourney;
  jti: string;
  iat: number;
  exp: number;
};

type RouteAttestationInput = {
  binding: UaisStagingInpBinding;
  account: string;
  sessionId: string;
  role: UaisStagingInpRole;
  journey: UaisStagingInpJourney;
  secret: string;
  now?: Date;
  sessionExpiresAt?: string;
};

type RouteAttestationVerificationInput = Omit<
  RouteAttestationInput,
  "journey"
> & {
  journey?: UaisStagingInpJourney;
};

export type VerifiedUaisStagingInpRouteAttestation = {
  operatorKey: string;
  jti: string;
  journey: UaisStagingInpJourney;
  issuedAt: string;
  expiresAt: string;
};

export function createUaisStagingInpRouteAttestation(
  input: RouteAttestationInput,
) {
  const normalized = normalizeInput(input);
  if (!normalized) return null;
  const issuedAt = Math.floor(normalized.now.getTime() / 1_000);
  const sessionExpiry = input.sessionExpiresAt
    ? Math.floor(Date.parse(input.sessionExpiresAt) / 1_000)
    : Number.POSITIVE_INFINITY;
  const expiresAt = Math.min(
    issuedAt + UAIS_STAGING_INP_ROUTE_ATTESTATION_TTL_SECONDS,
    sessionExpiry,
  );
  if (!Number.isFinite(expiresAt) || expiresAt <= issuedAt) return null;

  const claims: RouteAttestationClaims = {
    v: 1,
    aud: audience,
    kid: input.binding.collectorKeyVersion,
    bindingKey: bindingKey(input.binding, normalized.secret),
    operatorKey: createOperatorKey(input, normalized.account, normalized.secret),
    sessionKey: createSessionKey(input, normalized.sessionId, normalized.secret),
    role: input.role,
    journey: input.journey,
    jti: randomBytes(16).toString("hex"),
    iat: issuedAt,
    exp: expiresAt,
  };
  const encoded = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${encoded}.${sign(encoded, normalized.secret)}`;
}

export function verifyUaisStagingInpRouteAttestation(
  input: RouteAttestationVerificationInput & {
    token: string | null | undefined;
  },
) {
  return getVerifiedUaisStagingInpRouteAttestation(input) !== null;
}

export function getVerifiedUaisStagingInpRouteAttestation(
  input: RouteAttestationVerificationInput & {
    token: string | null | undefined;
  },
): VerifiedUaisStagingInpRouteAttestation | null {
  const normalized = normalizeInput(input);
  if (!normalized || !input.token) return null;
  const parts = input.token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, candidateSignature] = parts;
  if (!encoded || !candidateSignature || !signatureMatches(encoded, candidateSignature, normalized.secret)) {
    return null;
  }
  const claims = parseClaims(encoded);
  if (!claims) return null;
  const nowSeconds = Math.floor(normalized.now.getTime() / 1_000);
  if (
    claims.v !== 1 ||
    claims.aud !== audience ||
    claims.kid !== input.binding.collectorKeyVersion ||
    claims.iat > nowSeconds ||
    claims.exp <= nowSeconds ||
    claims.exp - claims.iat > UAIS_STAGING_INP_ROUTE_ATTESTATION_TTL_SECONDS ||
    claims.bindingKey !== bindingKey(input.binding, normalized.secret) ||
    claims.operatorKey !== createOperatorKey(input, normalized.account, normalized.secret) ||
    claims.sessionKey !== createSessionKey(input, normalized.sessionId, normalized.secret) ||
    claims.role !== input.role ||
    (input.journey !== undefined && claims.journey !== input.journey) ||
    !roleOwnsJourney(claims.role, claims.journey)
  ) {
    return null;
  }
  return {
    operatorKey: claims.operatorKey,
    jti: claims.jti,
    journey: claims.journey,
    issuedAt: new Date(claims.iat * 1_000).toISOString(),
    expiresAt: new Date(claims.exp * 1_000).toISOString(),
  };
}

export function readUaisStagingInpRouteAttestationFromCookieString(
  cookieString: string | null | undefined,
) {
  if (!cookieString) return null;
  for (const item of cookieString.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    const name = item.slice(0, separator).trim();
    if (name !== UAIS_STAGING_INP_ROUTE_ATTESTATION_COOKIE) continue;
    const value = item.slice(separator + 1).trim();
    return value || null;
  }
  return null;
}

function normalizeInput(
  input: Pick<
    RouteAttestationVerificationInput,
    "account" | "journey" | "now" | "role" | "secret" | "sessionId"
  >,
) {
  const secret = input.secret.trim();
  const account = input.account.trim().toLowerCase();
  const sessionId = input.sessionId.trim();
  const now = input.now ?? new Date();
  if (
    secret.length < 32 ||
    !account ||
    !sessionId ||
    (input.journey !== undefined &&
      (!journeys.has(input.journey) || !roleOwnsJourney(input.role, input.journey))) ||
    !Number.isFinite(now.getTime())
  ) {
    return null;
  }
  return { secret, account, sessionId, now };
}

function bindingKey(binding: UaisStagingInpBinding, secret: string) {
  return keyedDigest(
    bindingDomain,
    [
      binding.cohortId,
      binding.candidateGitSha,
      binding.candidateContentSha,
      binding.deploymentHost,
      binding.collectorKeyVersion,
      binding.operatorAllowlistFingerprint,
    ].join("\u0000"),
    secret,
  );
}

function keyedDigest(domain: string, value: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`${domain}\u0000${value}`)
    .digest("hex");
}

function createOperatorKey(
  input: Pick<RouteAttestationVerificationInput, "binding" | "role">,
  account: string,
  secret: string,
) {
  return keyedDigest(
    operatorDomain,
    `${input.binding.cohortId}\u0000${input.role}\u0000${account}`,
    secret,
  );
}

function createSessionKey(
  input: Pick<RouteAttestationVerificationInput, "binding">,
  sessionId: string,
  secret: string,
) {
  return keyedDigest(
    sessionDomain,
    `${input.binding.cohortId}\u0000${sessionId}`,
    secret,
  );
}

function roleOwnsJourney(
  role: UaisStagingInpRole,
  journey: UaisStagingInpJourney,
) {
  return role === "student"
    ? journey.startsWith("student-")
    : journey.startsWith("teacher-");
}

function sign(encoded: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`${tokenDomain}\u0000${encoded}`)
    .digest("base64url");
}

function signatureMatches(encoded: string, candidate: string, secret: string) {
  const expected = Buffer.from(sign(encoded, secret), "utf8");
  const actual = Buffer.from(candidate, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function parseClaims(encoded: string): RouteAttestationClaims | null {
  try {
    const value = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Partial<RouteAttestationClaims>;
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).sort().some((key, index) => key !== claimKeys[index]) ||
      Object.keys(value).length !== claimKeys.length
    ) {
      return null;
    }
    if (
      value.v !== 1 ||
      value.aud !== audience ||
      typeof value.kid !== "string" ||
      !/^[a-z0-9][a-z0-9._-]{0,31}$/.test(value.kid) ||
      typeof value.bindingKey !== "string" ||
      !/^[0-9a-f]{64}$/.test(value.bindingKey) ||
      typeof value.operatorKey !== "string" ||
      !/^[0-9a-f]{64}$/.test(value.operatorKey) ||
      typeof value.sessionKey !== "string" ||
      !/^[0-9a-f]{64}$/.test(value.sessionKey) ||
      (value.role !== "student" && value.role !== "teacher") ||
      typeof value.journey !== "string" ||
      !journeys.has(value.journey) ||
      typeof value.jti !== "string" ||
      !/^[0-9a-f]{32}$/.test(value.jti) ||
      !Number.isSafeInteger(value.iat) ||
      !Number.isSafeInteger(value.exp)
    ) {
      return null;
    }
    return value as RouteAttestationClaims;
  } catch {
    return null;
  }
}
