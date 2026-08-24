import { createHmac, timingSafeEqual } from "node:crypto";
import type { UaisAuthenticatedTeacherPrincipal } from "@/app/api/ai/session/handler";

export const UAIS_TEACHER_AUTH_CLAIMS_COOKIE = "uais_teacher_auth_claims";
export const UAIS_TEACHER_AUTH_SIGNATURE_COOKIE = "uais_teacher_auth_signature";

export type UaisTeacherAuthSessionClaims = {
  sessionId: string;
  actorId: string;
  role: "teacher";
  authenticatedAt: string;
  expiresAt: string;
};

export function createUaisTeacherAuthSessionCookieHeader(input: {
  claims: UaisTeacherAuthSessionClaims;
  secret: string;
}) {
  const claims = base64UrlEncode(Buffer.from(JSON.stringify(input.claims), "utf8"));
  const signature = signClaims(claims, input.secret);
  return `${UAIS_TEACHER_AUTH_CLAIMS_COOKIE}=${claims}; ${UAIS_TEACHER_AUTH_SIGNATURE_COOKIE}=${signature}`;
}

export function createUaisTeacherAuthSessionSetCookieHeaders(input: {
  claims: UaisTeacherAuthSessionClaims;
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

  return createUaisTeacherAuthSessionCookieHeader(input)
    .split("; ")
    .map((cookiePair) => [cookiePair, ...attributes].join("; "));
}

export function readUaisAuthenticatedTeacherSessionFromSignedCookies(input: {
  request: Request;
  secret: string;
  now?: Date;
}): UaisAuthenticatedTeacherPrincipal | undefined {
  const secret = input.secret.trim();
  if (!secret) {
    return undefined;
  }

  const cookies = parseCookieHeader(input.request.headers.get("cookie"));
  const claimsValue = cookies.get(UAIS_TEACHER_AUTH_CLAIMS_COOKIE);
  const signatureValue = cookies.get(UAIS_TEACHER_AUTH_SIGNATURE_COOKIE);
  if (!claimsValue || !signatureValue || !signatureMatches(claimsValue, signatureValue, secret)) {
    return undefined;
  }

  const claims = parseClaims(claimsValue);
  if (!claims) {
    return undefined;
  }

  const authenticatedAt = Date.parse(claims.authenticatedAt);
  const expiresAt = Date.parse(claims.expiresAt);
  if (!Number.isFinite(authenticatedAt) || !Number.isFinite(expiresAt)) {
    return undefined;
  }
  if (expiresAt <= (input.now ?? new Date()).getTime()) {
    return undefined;
  }

  const sessionId = claims.sessionId.trim();
  const actorId = claims.actorId.trim();
  if (!isSafeTeacherAuthSessionId(sessionId) || !isSafeTeacherAuthSessionId(actorId)) {
    return undefined;
  }

  return {
    sessionId,
    actorId,
    role: "teacher",
    authenticatedAt: new Date(authenticatedAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

function parseClaims(claimsValue: string): UaisTeacherAuthSessionClaims | undefined {
  try {
    const claims = JSON.parse(Buffer.from(claimsValue, "base64url").toString("utf8")) as
      | Partial<UaisTeacherAuthSessionClaims>
      | undefined;
    if (
      !claims ||
      typeof claims.sessionId !== "string" ||
      typeof claims.actorId !== "string" ||
      claims.role !== "teacher" ||
      typeof claims.authenticatedAt !== "string" ||
      typeof claims.expiresAt !== "string" ||
      !claims.sessionId.trim() ||
      !claims.actorId.trim()
    ) {
      return undefined;
    }

    return {
      sessionId: claims.sessionId,
      actorId: claims.actorId,
      role: "teacher",
      authenticatedAt: claims.authenticatedAt,
      expiresAt: claims.expiresAt,
    };
  } catch {
    return undefined;
  }
}

function parseCookieHeader(cookieHeader: string | null) {
  const cookies = new Map<string, string>();
  for (const part of cookieHeader?.split(";") ?? []) {
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
  return base64UrlEncode(createHmac("sha256", secret).update(claimsValue).digest());
}

function isSafeTeacherAuthSessionId(value: string) {
  return (
    value.length >= 1 &&
    value.length <= 128 &&
    /^[a-zA-Z0-9][a-zA-Z0-9._@-]*$/.test(value)
  );
}

function base64UrlEncode(bytes: Buffer) {
  return bytes.toString("base64url");
}
