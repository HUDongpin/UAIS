import { createHmac, timingSafeEqual } from "node:crypto";

export const UAIS_TEACHER_AUTH_ISSUER_CLAIMS_HEADER =
  "x-uais-teacher-auth-issuer-claims";
export const UAIS_TEACHER_AUTH_ISSUER_SIGNATURE_HEADER =
  "x-uais-teacher-auth-issuer-signature";
const MAX_TRUSTED_ISSUER_PROOF_TTL_MS = 300_000;

export type UaisTrustedTeacherAuthIssuerClaims = {
  issuerId: "trusted-cookie-issuer";
  teacherId: string;
  issuedAt: string;
  expiresAt: string;
};

export type UaisTrustedTeacherAuthIssuerDecision = {
  status: "authorized" | "denied";
  responsibleSession: "S12";
  reasonCode:
    | "authorized"
    | "trusted-issuer-secret-missing"
    | "trusted-issuer-signature-required"
    | "trusted-issuer-signature-invalid"
    | "trusted-issuer-claims-invalid"
    | "trusted-issuer-claims-expired"
    | "trusted-issuer-teacher-mismatch";
  issuer?: {
    issuerId: "trusted-cookie-issuer";
    teacherId: string;
    expiresAt: string;
  };
  redaction: {
    secrets: "omitted";
    headers: "omitted";
    cookies: "omitted";
  };
};

export function createUaisTrustedTeacherAuthIssuerHeaders(input: {
  secret: string;
  teacherId: string;
  now?: Date;
  ttlSeconds?: number;
}) {
  const secret = input.secret.trim();
  const teacherId = input.teacherId.trim();
  if (!secret) {
    throw new Error("UAIS teacher auth issuer secret is required.");
  }
  if (!teacherId) {
    throw new Error("UAIS teacher auth issuer teacherId is required.");
  }

  const issuedAt = input.now ?? new Date();
  const ttlSeconds = Math.min(Math.floor(input.ttlSeconds ?? 300), 300);
  const claims: UaisTrustedTeacherAuthIssuerClaims = {
    issuerId: "trusted-cookie-issuer",
    teacherId,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + ttlSeconds * 1000).toISOString(),
  };
  const encodedClaims = base64UrlEncode(Buffer.from(JSON.stringify(claims), "utf8"));

  return {
    headers: {
      [UAIS_TEACHER_AUTH_ISSUER_CLAIMS_HEADER]: encodedClaims,
      [UAIS_TEACHER_AUTH_ISSUER_SIGNATURE_HEADER]: signClaims(encodedClaims, secret),
    },
    claims,
    redaction: createRedaction(),
  };
}

export function authorizeUaisTrustedTeacherAuthIssuerRequest(input: {
  request: Request;
  secret: string | undefined;
  teacherId: string;
  now?: Date;
}): UaisTrustedTeacherAuthIssuerDecision {
  const secret = input.secret?.trim();
  if (!secret) {
    return denied("trusted-issuer-secret-missing");
  }

  const claimsValue = input.request.headers.get(UAIS_TEACHER_AUTH_ISSUER_CLAIMS_HEADER);
  const signatureValue = input.request.headers.get(UAIS_TEACHER_AUTH_ISSUER_SIGNATURE_HEADER);
  if (!claimsValue || !signatureValue) {
    return denied("trusted-issuer-signature-required");
  }

  if (!signatureMatches(claimsValue, signatureValue, secret)) {
    return denied("trusted-issuer-signature-invalid");
  }

  const claims = parseClaims(claimsValue);
  if (!claims) {
    return denied("trusted-issuer-claims-invalid");
  }

  const issuedAt = Date.parse(claims.issuedAt);
  const expiresAt = Date.parse(claims.expiresAt);
  const now = (input.now ?? new Date()).getTime();
  if (
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    issuedAt > now ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > MAX_TRUSTED_ISSUER_PROOF_TTL_MS
  ) {
    return denied("trusted-issuer-claims-invalid", claims);
  }

  if (expiresAt <= now) {
    return denied("trusted-issuer-claims-expired", claims);
  }

  if (claims.teacherId !== input.teacherId.trim()) {
    return denied("trusted-issuer-teacher-mismatch", claims);
  }

  return {
    status: "authorized",
    responsibleSession: "S12",
    reasonCode: "authorized",
    issuer: {
      issuerId: claims.issuerId,
      teacherId: claims.teacherId,
      expiresAt: claims.expiresAt,
    },
    redaction: createRedaction(),
  };
}

function parseClaims(claimsValue: string): UaisTrustedTeacherAuthIssuerClaims | undefined {
  try {
    const claims = JSON.parse(Buffer.from(claimsValue, "base64url").toString("utf8")) as
      | Partial<UaisTrustedTeacherAuthIssuerClaims>
      | undefined;
    if (
      !claims ||
      claims.issuerId !== "trusted-cookie-issuer" ||
      typeof claims.teacherId !== "string" ||
      typeof claims.issuedAt !== "string" ||
      typeof claims.expiresAt !== "string" ||
      !claims.teacherId.trim()
    ) {
      return undefined;
    }

    return {
      issuerId: claims.issuerId,
      teacherId: claims.teacherId.trim(),
      issuedAt: claims.issuedAt,
      expiresAt: claims.expiresAt,
    };
  } catch {
    return undefined;
  }
}

function signatureMatches(claimsValue: string, signatureValue: string, secret: string) {
  const expected = signClaims(claimsValue, secret);
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(signatureValue);
  return expectedBytes.byteLength === actualBytes.byteLength && timingSafeEqual(expectedBytes, actualBytes);
}

function signClaims(claimsValue: string, secret: string) {
  return base64UrlEncode(createHmac("sha256", secret).update(claimsValue).digest());
}

function base64UrlEncode(bytes: Buffer) {
  return bytes.toString("base64url");
}

function denied(
  reasonCode: Exclude<UaisTrustedTeacherAuthIssuerDecision["reasonCode"], "authorized">,
  claims?: UaisTrustedTeacherAuthIssuerClaims,
): UaisTrustedTeacherAuthIssuerDecision {
  return {
    status: "denied",
    responsibleSession: "S12",
    reasonCode,
    ...(claims
      ? {
          issuer: {
            issuerId: claims.issuerId,
            teacherId: claims.teacherId,
            expiresAt: claims.expiresAt,
          },
        }
      : {}),
    redaction: createRedaction(),
  };
}

function createRedaction(): UaisTrustedTeacherAuthIssuerDecision["redaction"] {
  return {
    secrets: "omitted",
    headers: "omitted",
    cookies: "omitted",
  };
}
