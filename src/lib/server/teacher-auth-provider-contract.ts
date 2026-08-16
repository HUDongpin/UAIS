export type UaisTeacherAuthProviderEnvName =
  | "UAIS_TEACHER_AUTH_PROVIDER"
  | "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET"
  | "UAIS_TEACHER_AUTH_ISSUER_SECRET"
  | "UAIS_TEACHER_AUTH_OIDC_ISSUER"
  | "UAIS_TEACHER_AUTH_OIDC_AUDIENCE"
  | "UAIS_TEACHER_AUTH_OIDC_JWKS_URL"
  | "UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM";

export type UaisTeacherAuthProviderRequiredEnvCheck = {
  name: Exclude<UaisTeacherAuthProviderEnvName, "UAIS_TEACHER_AUTH_PROVIDER">;
  status: "present" | "missing";
};

export type UaisTeacherAuthProviderSecretStrengthCheck = {
  name: "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET" | "UAIS_TEACHER_AUTH_ISSUER_SECRET";
  status: "sufficient" | "weak" | "missing";
  valueRedacted: true;
};

type UaisTeacherAuthProviderSecretStrength = {
  minimumLength: 32;
  valuesRedacted: true;
  checks: UaisTeacherAuthProviderSecretStrengthCheck[];
};

type UaisTeacherAuthEndpointSecurity = {
  issuer: "remote-https" | "insecure-http" | "local-loopback" | "private-network" | "invalid" | "missing";
  jwks: "remote-https" | "insecure-http" | "local-loopback" | "private-network" | "invalid" | "missing";
};

type UaisTrustedTeacherAuthIssuerSeparation = {
  sessionIssuerSecretSeparation: "proved" | "missing";
  valueRedacted: true;
};

export type UaisTeacherAuthProviderContract = {
  selector: string;
  providerKind:
    | "missing"
    | "local-signed-cookie"
    | "database-account-cookie"
    | "trusted-cookie-issuer"
    | "oidc-jwks"
    | "unsupported";
  adapterStatus: "not-configured" | "implemented" | "unsupported";
  productionStatus: "ready" | "blocked";
  blockedReason?: UaisTeacherAuthProviderBlockedReason;
  requiredEnv?: UaisTeacherAuthProviderRequiredEnvCheck[];
  secretStrength?: UaisTeacherAuthProviderSecretStrength;
  trustedIssuerSeparation?: UaisTrustedTeacherAuthIssuerSeparation;
  endpointSecurity?: UaisTeacherAuthEndpointSecurity;
  responsibleSession: "S12";
  redaction: {
    values: "omitted";
    cookies: "omitted";
  };
};

export type UaisTeacherAuthProviderBlockedReason =
  | "missing-UAIS_TEACHER_AUTH_PROVIDER"
  | "missing-UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET"
  | "missing-UAIS_TEACHER_AUTH_ISSUER_SECRET"
  | "missing-UAIS_TEACHER_AUTH_OIDC_ISSUER"
  | "missing-UAIS_TEACHER_AUTH_OIDC_AUDIENCE"
  | "missing-UAIS_TEACHER_AUTH_OIDC_JWKS_URL"
  | "missing-UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM"
  | "weak-UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET"
  | "weak-UAIS_TEACHER_AUTH_ISSUER_SECRET"
  | "shared-UAIS_TEACHER_AUTH_SESSION_AND_ISSUER_SECRET"
  | "non-production-UAIS_TEACHER_AUTH_OIDC_ENDPOINTS"
  | "non-production-UAIS_TEACHER_AUTH_PROVIDER"
  | "unsupported-UAIS_TEACHER_AUTH_PROVIDER";

const minimumTeacherAuthSecretLength = 32;

export function resolveUaisTeacherAuthProviderContract(input: {
  env: Record<string, string | undefined>;
}): UaisTeacherAuthProviderContract {
  const selector = normalizeTeacherAuthProviderSelector(input.env.UAIS_TEACHER_AUTH_PROVIDER);

  if (selector === "missing") {
    return {
      selector,
      providerKind: "missing",
      adapterStatus: "not-configured",
      productionStatus: "blocked",
      blockedReason: "missing-UAIS_TEACHER_AUTH_PROVIDER",
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
  }

  if (isLocalSignedCookieSelector(selector)) {
    return {
      selector: "local-signed-cookie",
      providerKind: "local-signed-cookie",
      adapterStatus: "implemented",
      productionStatus: "blocked",
      blockedReason: "non-production-UAIS_TEACHER_AUTH_PROVIDER",
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
  }

  if (selector === "trusted-cookie-issuer") {
    const requiredEnv = buildRequiredEnvChecks(input.env, [
      "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
      "UAIS_TEACHER_AUTH_ISSUER_SECRET",
    ]);
    const secretStrength = buildSecretStrengthChecks(input.env, [
      "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
      "UAIS_TEACHER_AUTH_ISSUER_SECRET",
    ]);
    const secretsReady = secretStrength.checks.every((entry) => entry.status === "sufficient");
    const trustedIssuerSeparation = buildTrustedIssuerSeparation(input.env);
    const secretsSeparated =
      trustedIssuerSeparation.sessionIssuerSecretSeparation === "proved";
    const ready =
      requiredEnv.every((entry) => entry.status === "present") &&
      secretsReady &&
      secretsSeparated;
    const missing = requiredEnv.find((entry) => entry.status === "missing");
    const weak = secretStrength.checks.find((entry) => entry.status === "weak");
    return {
      selector,
      providerKind: "trusted-cookie-issuer",
      adapterStatus: "implemented",
      productionStatus: ready ? "ready" : "blocked",
      ...(ready
        ? {}
        : {
            blockedReason: missing
              ? missingRequiredTeacherAuthEnvReason(missing.name)
              : weak
              ? weakTeacherAuthSecretReason(weak.name)
              : "shared-UAIS_TEACHER_AUTH_SESSION_AND_ISSUER_SECRET",
          }),
      requiredEnv,
      secretStrength,
      trustedIssuerSeparation,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
  }

  if (selector === "oidc-jwks") {
    const requiredEnv = buildRequiredEnvChecks(input.env, [
      "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
      "UAIS_TEACHER_AUTH_OIDC_ISSUER",
      "UAIS_TEACHER_AUTH_OIDC_AUDIENCE",
      "UAIS_TEACHER_AUTH_OIDC_JWKS_URL",
      "UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM",
    ]);
    const endpointSecurity = {
      issuer: classifyOidcEndpoint(input.env.UAIS_TEACHER_AUTH_OIDC_ISSUER),
      jwks: classifyOidcEndpoint(input.env.UAIS_TEACHER_AUTH_OIDC_JWKS_URL),
    };
    const secretStrength = buildSecretStrengthChecks(input.env, [
      "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
    ]);
    const secretsReady = secretStrength.checks.every((entry) => entry.status === "sufficient");
    const endpointsReady =
      endpointSecurity.issuer === "remote-https" &&
      endpointSecurity.jwks === "remote-https";
    const ready = requiredEnv.every((entry) => entry.status === "present") && secretsReady && endpointsReady;
    const missing = requiredEnv.find((entry) => entry.status === "missing");
    const weak = secretStrength.checks.find((entry) => entry.status === "weak");
    return {
      selector,
      providerKind: "oidc-jwks",
      adapterStatus: "implemented",
      productionStatus: ready ? "ready" : "blocked",
      ...(ready
        ? {}
        : {
            blockedReason: missing
              ? missingRequiredTeacherAuthEnvReason(missing.name)
              : weak
              ? weakTeacherAuthSecretReason(weak.name)
              : "non-production-UAIS_TEACHER_AUTH_OIDC_ENDPOINTS",
          }),
      requiredEnv,
      secretStrength,
      endpointSecurity,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
  }

  // Teacher sessions minted at login for accounts the first-party account
  // provider has already verified as `role = 'teacher'` in `uais_users`.
  //
  // This is the selector that makes a production teacher able to write. The
  // other two production-capable kinds each need something that does not exist:
  // `trusted-cookie-issuer` needs a separate issuer service holding a second
  // secret, and `oidc-jwks` needs a campus identity provider and a client that
  // was never built. Meanwhile `local-signed-cookie` is - correctly - hard
  // blocked in production, which left `www.uais.top` with a teacher who could
  // list courses read-only and then 401 on create-course, invite codes,
  // approvals and groups.
  //
  // It requires exactly one secret because the trust chain is shorter: there is
  // no second party to authenticate. The account row is the authority, the
  // login route is the only mint point, and the signing secret is what keeps a
  // client from forging the cookie. The >= 32-character floor is the same one
  // the other kinds enforce, and there is deliberately no development fallback
  // - a committed constant would be a published forgery key for teacher writes.
  if (selector === "database-account-cookie") {
    const requiredEnv = buildRequiredEnvChecks(input.env, [
      "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
    ]);
    const secretStrength = buildSecretStrengthChecks(input.env, [
      "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
    ]);
    const present = requiredEnv.every((entry) => entry.status === "present");
    const strong = secretStrength.checks.every((entry) => entry.status === "sufficient");
    return {
      selector,
      providerKind: "database-account-cookie",
      adapterStatus: "implemented",
      productionStatus: present && strong ? "ready" : "blocked",
      ...(present && strong
        ? {}
        : {
            blockedReason: present
              ? ("weak-UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET" as const)
              : ("missing-UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET" as const),
          }),
      requiredEnv,
      secretStrength,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
  }

  return {
    selector,
    providerKind: "unsupported",
    adapterStatus: "unsupported",
    productionStatus: "blocked",
    blockedReason: "unsupported-UAIS_TEACHER_AUTH_PROVIDER",
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeTeacherAuthProviderSelector(value: string | undefined) {
  const selector = value?.trim().toLowerCase();
  return selector || "missing";
}

function isLocalSignedCookieSelector(selector: string) {
  return (
    selector === "local" ||
    selector === "signed-cookie" ||
    selector === "local-signed-cookie"
  );
}

function hasValue(value: string | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function classifyOidcEndpoint(value: string | undefined): UaisTeacherAuthEndpointSecurity["issuer"] {
  if (!hasValue(value)) {
    return "missing";
  }
  try {
    const endpoint = new URL(value);
    const hostClass = classifyEndpointHost(endpoint.hostname);
    if (hostClass !== "remote") {
      return hostClass;
    }
    return endpoint.protocol === "https:" ? "remote-https" : "insecure-http";
  } catch {
    return "invalid";
  }
}

function classifyEndpointHost(hostname: string) {
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

function buildRequiredEnvChecks(
  env: Record<string, string | undefined>,
  names: UaisTeacherAuthProviderRequiredEnvCheck["name"][],
): UaisTeacherAuthProviderRequiredEnvCheck[] {
  return names.map((name) => ({
    name,
    status: hasValue(env[name]) ? "present" : "missing",
  }));
}

function buildSecretStrengthChecks(
  env: Record<string, string | undefined>,
  names: UaisTeacherAuthProviderSecretStrengthCheck["name"][],
): UaisTeacherAuthProviderSecretStrength {
  return {
    minimumLength: minimumTeacherAuthSecretLength,
    valuesRedacted: true,
    checks: names.map((name) => ({
      name,
      status: classifyTeacherAuthSecretStrength(env[name]),
      valueRedacted: true,
    })),
  };
}

function buildTrustedIssuerSeparation(
  env: Record<string, string | undefined>,
): UaisTrustedTeacherAuthIssuerSeparation {
  return {
    sessionIssuerSecretSeparation:
      hasValue(env.UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET) &&
      hasValue(env.UAIS_TEACHER_AUTH_ISSUER_SECRET) &&
      env.UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET.trim() !==
        env.UAIS_TEACHER_AUTH_ISSUER_SECRET.trim()
        ? "proved"
        : "missing",
    valueRedacted: true,
  };
}

function classifyTeacherAuthSecretStrength(value: string | undefined): UaisTeacherAuthProviderSecretStrengthCheck["status"] {
  if (!hasValue(value)) {
    return "missing";
  }
  return value.trim().length >= minimumTeacherAuthSecretLength ? "sufficient" : "weak";
}

function missingRequiredTeacherAuthEnvReason(
  name: UaisTeacherAuthProviderRequiredEnvCheck["name"] | undefined,
): Exclude<
  UaisTeacherAuthProviderBlockedReason,
  | "missing-UAIS_TEACHER_AUTH_PROVIDER"
  | "non-production-UAIS_TEACHER_AUTH_PROVIDER"
  | "unsupported-UAIS_TEACHER_AUTH_PROVIDER"
> {
  if (name === "UAIS_TEACHER_AUTH_ISSUER_SECRET") {
    return "missing-UAIS_TEACHER_AUTH_ISSUER_SECRET";
  }
  if (name === "UAIS_TEACHER_AUTH_OIDC_ISSUER") {
    return "missing-UAIS_TEACHER_AUTH_OIDC_ISSUER";
  }
  if (name === "UAIS_TEACHER_AUTH_OIDC_AUDIENCE") {
    return "missing-UAIS_TEACHER_AUTH_OIDC_AUDIENCE";
  }
  if (name === "UAIS_TEACHER_AUTH_OIDC_JWKS_URL") {
    return "missing-UAIS_TEACHER_AUTH_OIDC_JWKS_URL";
  }
  if (name === "UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM") {
    return "missing-UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM";
  }

  return "missing-UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET";
}

function weakTeacherAuthSecretReason(
  name: UaisTeacherAuthProviderSecretStrengthCheck["name"] | undefined,
): Extract<
  UaisTeacherAuthProviderBlockedReason,
  "weak-UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET" | "weak-UAIS_TEACHER_AUTH_ISSUER_SECRET"
> {
  if (name === "UAIS_TEACHER_AUTH_ISSUER_SECRET") {
    return "weak-UAIS_TEACHER_AUTH_ISSUER_SECRET";
  }
  return "weak-UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET";
}

function createRedaction(): UaisTeacherAuthProviderContract["redaction"] {
  return {
    values: "omitted",
    cookies: "omitted",
  };
}
