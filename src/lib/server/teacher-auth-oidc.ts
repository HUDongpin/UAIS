import { createPublicKey, verify, type JsonWebKey } from "node:crypto";

export type UaisOidcTeacherAuthDecision =
  | {
      status: "authorized";
      responsibleSession: "S12";
      providerKind: "oidc-jwks";
      reasonCode: "authorized";
      teacherId: string;
      teacherIdClaim: string;
      tokenExpiry: string;
      redaction: UaisOidcTeacherAuthRedaction;
    }
  | {
      status: "denied";
      responsibleSession: "S12";
      providerKind: "oidc-jwks";
      reasonCode:
        | "oidc-provider-config-missing"
        | "oidc-bearer-token-required"
        | "oidc-token-invalid"
        | "oidc-token-algorithm-unsupported"
        | "oidc-jwks-key-missing"
        | "oidc-token-signature-invalid"
        | "oidc-token-issuer-invalid"
        | "oidc-token-audience-invalid"
        | "oidc-token-expired"
        | "oidc-token-not-yet-valid"
        | "oidc-teacher-claim-missing"
        | "oidc-teacher-mismatch";
      redaction: UaisOidcTeacherAuthRedaction;
    };

type UaisOidcTeacherAuthRedaction = {
  tokens: "omitted";
  jwks: "omitted";
  providerValues: "omitted";
};

type UaisOidcJwtHeader = {
  alg?: string;
  kid?: string;
  typ?: string;
};

type UaisOidcJwtClaims = {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  nbf?: unknown;
  [claim: string]: unknown;
};

export async function authorizeUaisOidcTeacherAuthRequest(input: {
  request: Request;
  env: Record<string, string | undefined>;
  now?: Date;
  requestedTeacherId?: string;
  fetchJwks?: (url: string) => Promise<unknown>;
}): Promise<UaisOidcTeacherAuthDecision> {
  const config = readOidcConfig(input.env);
  if (!config) {
    return denied("oidc-provider-config-missing");
  }

  const token = readBearerToken(input.request);
  if (!token) {
    return denied("oidc-bearer-token-required");
  }

  const parsed = parseJwt(token);
  if (!parsed) {
    return denied("oidc-token-invalid");
  }
  if (parsed.header.alg !== "RS256" || !parsed.header.kid) {
    return denied("oidc-token-algorithm-unsupported");
  }

  const jwks = await (input.fetchJwks ?? fetchJwks)(config.jwksUrl);
  const jwk = readMatchingJwk(jwks, parsed.header.kid);
  if (!jwk) {
    return denied("oidc-jwks-key-missing");
  }

  if (!verifyJwtSignature(parsed.signedPart, parsed.signature, jwk)) {
    return denied("oidc-token-signature-invalid");
  }

  if (parsed.claims.iss !== config.issuer) {
    return denied("oidc-token-issuer-invalid");
  }
  if (!claimAudienceMatches(parsed.claims.aud, config.audience)) {
    return denied("oidc-token-audience-invalid");
  }

  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const exp = typeof parsed.claims.exp === "number" ? parsed.claims.exp : undefined;
  if (!exp || exp <= nowSeconds) {
    return denied("oidc-token-expired");
  }
  const nbf = typeof parsed.claims.nbf === "number" ? parsed.claims.nbf : undefined;
  if (nbf !== undefined && nbf > nowSeconds) {
    return denied("oidc-token-not-yet-valid");
  }

  const teacherId = readStringClaim(parsed.claims, config.teacherIdClaim);
  if (!teacherId) {
    return denied("oidc-teacher-claim-missing");
  }
  if (input.requestedTeacherId && input.requestedTeacherId !== teacherId) {
    return denied("oidc-teacher-mismatch");
  }

  return {
    status: "authorized",
    responsibleSession: "S12",
    providerKind: "oidc-jwks",
    reasonCode: "authorized",
    teacherId,
    teacherIdClaim: config.teacherIdClaim,
    tokenExpiry: new Date(exp * 1000).toISOString(),
    redaction: createRedaction(),
  };
}

function readOidcConfig(env: Record<string, string | undefined>) {
  const issuer = env.UAIS_TEACHER_AUTH_OIDC_ISSUER?.trim();
  const audience = env.UAIS_TEACHER_AUTH_OIDC_AUDIENCE?.trim();
  const jwksUrl = env.UAIS_TEACHER_AUTH_OIDC_JWKS_URL?.trim();
  const teacherIdClaim = env.UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM?.trim();
  if (!issuer || !audience || !jwksUrl || !teacherIdClaim) {
    return undefined;
  }

  return {
    issuer,
    audience,
    jwksUrl,
    teacherIdClaim,
  };
}

function readBearerToken(request: Request) {
  const authorization = request.headers.get("authorization")?.trim();
  const match = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
  return match?.[1]?.trim();
}

function parseJwt(token: string) {
  const [encodedHeader, encodedPayload, signature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !signature) {
    return undefined;
  }

  const header = parseBase64UrlJson<UaisOidcJwtHeader>(encodedHeader);
  const claims = parseBase64UrlJson<UaisOidcJwtClaims>(encodedPayload);
  if (!header || !claims) {
    return undefined;
  }

  return {
    header,
    claims,
    signedPart: `${encodedHeader}.${encodedPayload}`,
    signature,
  };
}

function parseBase64UrlJson<T>(value: string): T | undefined {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
  } catch {
    return undefined;
  }
}

function readMatchingJwk(jwks: unknown, kid: string) {
  if (!isRecord(jwks) || !Array.isArray(jwks.keys)) {
    return undefined;
  }

  return jwks.keys.find((key): key is JsonWebKey =>
    isUsableRs256VerificationJwk(key, kid),
  );
}

function isUsableRs256VerificationJwk(value: unknown, kid: string): value is JsonWebKey {
  if (!isRecord(value)) {
    return false;
  }
  if (value.kty !== "RSA" || value.kid !== kid) {
    return false;
  }
  if (value.alg !== undefined && value.alg !== "RS256") {
    return false;
  }
  if (value.use !== undefined && value.use !== "sig") {
    return false;
  }
  if (Array.isArray(value.key_ops) && !value.key_ops.includes("verify")) {
    return false;
  }
  return hasStringValue(value.n) && hasStringValue(value.e);
}

function verifyJwtSignature(signedPart: string, signature: string, jwk: JsonWebKey) {
  try {
    const publicKey = createPublicKey({ key: jwk, format: "jwk" });
    return verify(
      "RSA-SHA256",
      Buffer.from(signedPart),
      publicKey,
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
}

function claimAudienceMatches(value: unknown, audience: string) {
  return value === audience || (Array.isArray(value) && value.includes(audience));
}

function readStringClaim(claims: UaisOidcJwtClaims, claimName: string) {
  const value = claims[claimName];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function hasStringValue(value: unknown) {
  return typeof value === "string" && value.trim() !== "";
}

async function fetchJwks(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("UAIS OIDC JWKS fetch failed.");
  }

  return response.json() as Promise<unknown>;
}

function denied(
  reasonCode: Extract<UaisOidcTeacherAuthDecision, { status: "denied" }>["reasonCode"],
): UaisOidcTeacherAuthDecision {
  return {
    status: "denied",
    responsibleSession: "S12",
    providerKind: "oidc-jwks",
    reasonCode,
    redaction: createRedaction(),
  };
}

function createRedaction(): UaisOidcTeacherAuthRedaction {
  return {
    tokens: "omitted",
    jwks: "omitted",
    providerValues: "omitted",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
