import { createHmac, timingSafeEqual } from "node:crypto";
import {
  UAIS_APP_SESSION_COOKIE,
  UAIS_APP_SESSION_SIGNATURE_COOKIE,
  type UaisAppRole,
  type UaisAppSessionUser,
} from "@/lib/auth/uais-app-session";

const developmentAppSessionSigningSecret =
  "uais-development-only-app-session-signing-secret";
const defaultSessionTtlSeconds = 8 * 60 * 60;

// The same floor `minimumTeacherAuthSecretLength` applies to the teacher session
// secret, and the same one scripts/app-auth-provider-readiness.mjs has always
// GRADED against - it reported `signingSecretStrength: "weak"` and blocked the
// release for anything shorter, while the runtime accepted any non-empty string.
// A release gate that refuses what the runtime accepts is not a gate: the
// deployment that skips the gate is exactly the one that ends up signing every
// session in the cohort with a guessable key.
//
// 32 characters is a floor on the ENCODED length, not on entropy, because that
// is the only property this code can check. It is enough to make a hand-typed
// value ("uais-secret") fail and a generated one pass.
export const minimumUaisAppSessionSecretLength = 32;

export type UaisAppSessionSigningSecretContract = {
  // `development-fallback` is the committed constant a local runtime signs with.
  // It is never reachable from a deployed runtime - see the deployed branch in
  // readAppSessionSigningSecretState.
  status: "configured" | "development-fallback" | "missing" | "weak";
  minimumLength: typeof minimumUaisAppSessionSecretLength;
  valueRedacted: true;
};

export function isUaisAppProductionRuntime(
  env: Record<string, string | undefined>,
) {
  return (
    env.VERCEL_ENV === "production" ||
    env.NODE_ENV === "production" ||
    env.UAIS_DEPLOYMENT_ENV === "production"
  );
}

export function isUaisAppDeployedRuntime(
  env: Record<string, string | undefined>,
) {
  const deploymentEnv = env.UAIS_DEPLOYMENT_ENV?.trim().toLowerCase();
  return (
    isUaisAppProductionRuntime(env) ||
    env.VERCEL_ENV === "preview" ||
    deploymentEnv === "preview" ||
    deploymentEnv === "staging"
  );
}

export type UaisAppSessionClaims = UaisAppSessionUser & {
  sessionId: string;
  authenticatedAt: string;
  expiresAt: string;
};

export function createUaisAppSessionClaims(input: {
  user: UaisAppSessionUser;
  sessionId: string;
  now?: Date;
  ttlSeconds?: number;
}): UaisAppSessionClaims {
  const issuedAt = input.now ?? new Date();
  const ttlSeconds = Math.max(
    1,
    Math.floor(input.ttlSeconds ?? defaultSessionTtlSeconds),
  );

  return {
    account: input.user.account,
    role: input.user.role,
    displayName: input.user.displayName,
    department: input.user.department,
    sessionId: input.sessionId,
    authenticatedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + ttlSeconds * 1000).toISOString(),
  };
}

export function createUaisAppSessionCookie(
  user: UaisAppSessionUser = {
    account: "Phoebe",
    department: "教师账号",
    displayName: "Phoebe",
    role: "teacher",
  },
  options: {
    secret?: string;
    env?: Record<string, string | undefined>;
    now?: Date;
    sessionId?: string;
    ttlSeconds?: number;
  } = {},
) {
  const secret = options.secret ?? resolveUaisAppSessionSigningSecret(options.env ?? {});
  if (!secret) {
    throw new Error("UAIS app session signing secret is not configured.");
  }

  return createUaisAppSessionCookieHeader({
    claims: createUaisAppSessionClaims({
      user,
      sessionId: options.sessionId ?? "test-app-session",
      now: options.now,
      ttlSeconds: options.ttlSeconds,
    }),
    secret,
  });
}

export function createUaisAppSessionCookieHeader(input: {
  claims: UaisAppSessionClaims;
  secret: string;
}) {
  const claims = encodeClaims(input.claims);
  const signature = signClaims(claims, input.secret);
  return `${UAIS_APP_SESSION_COOKIE}=${claims}; ${UAIS_APP_SESSION_SIGNATURE_COOKIE}=${signature}`;
}

export function createUaisAppSessionSetCookieHeaders(input: {
  claims: UaisAppSessionClaims;
  secret: string;
  maxAgeSeconds: number;
  secure?: boolean;
}) {
  const maxAgeSeconds = Math.max(0, Math.floor(input.maxAgeSeconds));
  const attributes = [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    "Priority=High",
    ...(input.secure ? ["Secure"] : []),
  ];

  return createUaisAppSessionCookieHeader(input)
    .split("; ")
    .map((cookiePair) => [cookiePair, ...attributes].join("; "));
}

export function getUaisAppSessionUserFromCookieString(
  cookieString: string | undefined | null,
  input: {
    secret?: string;
    env?: Record<string, string | undefined>;
    now?: Date;
  } = {},
) {
  if (!cookieString) {
    return null;
  }

  const claims = getUaisAppSessionClaimsFromCookieString(cookieString, input);
  if (!claims) {
    return null;
  }

  return {
    account: claims.account,
    department: claims.department,
    displayName: claims.displayName,
    role: claims.role,
  };
}

export function getUaisAppSessionClaimsFromCookieString(
  cookieString: string | undefined | null,
  input: {
    secret?: string;
    env?: Record<string, string | undefined>;
    now?: Date;
  } = {},
) {
  if (!cookieString) {
    return null;
  }

  const cookies = parseCookieHeader(cookieString);
  return readUaisAppSessionClaimsFromCookieValues({
    claimsValue: cookies.get(UAIS_APP_SESSION_COOKIE),
    signatureValue: cookies.get(UAIS_APP_SESSION_SIGNATURE_COOKIE),
    secret: input.secret ?? resolveUaisAppSessionSigningSecret(input.env ?? {}),
    now: input.now,
  });
}

export function readUaisAppSessionUserFromCookieValues(input: {
  claimsValue: string | undefined;
  signatureValue: string | undefined;
  secret: string | undefined;
  now?: Date;
}) {
  const claims = readUaisAppSessionClaimsFromCookieValues(input);
  if (!claims) {
    return null;
  }

  return {
    account: claims.account,
    department: claims.department,
    displayName: claims.displayName,
    role: claims.role,
  };
}

export function readUaisAppSessionClaimsFromCookieValues(input: {
  claimsValue: string | undefined;
  signatureValue: string | undefined;
  secret: string | undefined;
  now?: Date;
}) {
  const secret = input.secret?.trim();
  if (!secret || !input.claimsValue || !input.signatureValue) {
    return null;
  }

  if (!signatureMatches(input.claimsValue, input.signatureValue, secret)) {
    return null;
  }

  const claims = parseClaims(input.claimsValue);
  if (!claims) {
    return null;
  }

  const authenticatedAt = Date.parse(claims.authenticatedAt);
  const expiresAt = Date.parse(claims.expiresAt);
  if (!Number.isFinite(authenticatedAt) || !Number.isFinite(expiresAt)) {
    return null;
  }
  if (expiresAt <= (input.now ?? new Date()).getTime()) {
    return null;
  }

  return claims;
}

export function resolveUaisAppSessionSigningSecret(
  env: Record<string, string | undefined>,
) {
  return readAppSessionSigningSecretState(env).secret;
}

/**
 * The same decision, reported rather than resolved.
 *
 * Callers that have to EXPLAIN a refusal need to tell `missing` from `weak`:
 * they are different operator actions (set the variable / replace the value with
 * a longer one), and a deployment that answers "not configured" for a secret
 * that is plainly configured sends the owner looking in the wrong place. Carries
 * a status and a length floor, never the value.
 */
export function classifyUaisAppSessionSigningSecret(
  env: Record<string, string | undefined>,
): UaisAppSessionSigningSecretContract {
  return {
    status: readAppSessionSigningSecretState(env).status,
    minimumLength: minimumUaisAppSessionSecretLength,
    valueRedacted: true,
  };
}

function readAppSessionSigningSecretState(env: Record<string, string | undefined>): {
  status: UaisAppSessionSigningSecretContract["status"];
  secret?: string;
} {
  const configured = env.UAIS_APP_SESSION_SIGNING_SECRET?.trim();
  const deployed = isUaisAppDeployedRuntime(env);

  if (!configured) {
    // A deployed runtime has no fallback: a committed constant would be a
    // published forgery key for every session on the deployment.
    return deployed
      ? { status: "missing" }
      : { status: "development-fallback", secret: developmentAppSessionSigningSecret };
  }

  // The floor applies to DEPLOYED runtimes only. A short secret on a laptop
  // signs cookies nobody else can reach, and refusing it would break every
  // local `.env.local` and every suite fixture in the repository for no security
  // gain - the same split `isUaisAppDeployedRuntime` already draws for the
  // fallback above.
  if (deployed && configured.length < minimumUaisAppSessionSecretLength) {
    return { status: "weak" };
  }

  return { status: "configured", secret: configured };
}

function parseClaims(claimsValue: string): UaisAppSessionClaims | undefined {
  try {
    const claims = JSON.parse(Buffer.from(claimsValue, "base64url").toString("utf8")) as
      | Partial<UaisAppSessionClaims>
      | undefined;
    if (
      !claims ||
      typeof claims.account !== "string" ||
      (claims.role !== "teacher" && claims.role !== "student" && claims.role !== "admin") ||
      typeof claims.displayName !== "string" ||
      typeof claims.department !== "string" ||
      typeof claims.sessionId !== "string" ||
      typeof claims.authenticatedAt !== "string" ||
      typeof claims.expiresAt !== "string" ||
      !claims.account.trim() ||
      !claims.sessionId.trim()
    ) {
      return undefined;
    }

    return {
      account: claims.account,
      role: claims.role as UaisAppRole,
      displayName: claims.displayName,
      department: claims.department,
      sessionId: claims.sessionId,
      authenticatedAt: claims.authenticatedAt,
      expiresAt: claims.expiresAt,
    };
  } catch {
    return undefined;
  }
}

function parseCookieHeader(cookieHeader: string) {
  const cookies = new Map<string, string>();
  for (const part of cookieHeader.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex <= 0) continue;
    const name = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (name && value) {
      cookies.set(name, value);
    }
  }
  return cookies;
}

function signatureMatches(claimsValue: string, signatureValue: string, secret: string) {
  const expected = signClaims(claimsValue, secret);
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(signatureValue);
  return (
    expectedBytes.byteLength === actualBytes.byteLength &&
    timingSafeEqual(expectedBytes, actualBytes)
  );
}

function signClaims(claimsValue: string, secret: string) {
  return createHmac("sha256", secret).update(claimsValue).digest().toString("base64url");
}

function encodeClaims(claims: UaisAppSessionClaims) {
  return Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
}
