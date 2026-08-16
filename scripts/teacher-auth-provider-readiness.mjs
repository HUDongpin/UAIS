#!/usr/bin/env node

import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

const minimumProductionSecretLength = 32;
const teacherAuthIssuerProofTtlSeconds = 300;

// Mirrors resolveUaisTeacherAuthProviderContract in
// src/lib/server/teacher-auth-provider-contract.ts. All three are
// production-capable; they differ in how much has to exist outside this
// deployment. `database-account-cookie` mints the teacher session at login for
// an account the first-party provider already verified as role = 'teacher', so
// its entire requirement is UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET at >= 32
// characters - there is no second party to authenticate, hence no issuer secret
// and no identity provider.
const acceptedTeacherAuthProviderModes = [
  "trusted-cookie-issuer",
  "oidc-jwks",
  "database-account-cookie",
];
const teacherAuthSessionCookiePair = [
  {
    name: "uais_teacher_auth_claims",
    purpose: "signed-session-claims",
  },
  {
    name: "uais_teacher_auth_signature",
    purpose: "hmac-sha256-signature",
  },
];
const teacherAuthProviderReadinessResultKeys = [
  "teacherAuthProviderModeSupported",
  "teacherAuthSessionCookieContract",
  "teacherAuthProviderVercelEnvSync",
  "teacherAuthProviderSpecificContract",
  "teacherAuthProviderRouteBinding",
  "teacherAuthReadinessSafety",
];

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.live && options.approved !== true) {
    throw new Error("Teacher auth provider readiness requires explicit owner approval.");
  }

  const env = {
    ...process.env,
    ...readEnvFile(options.envFile),
  };
  const mode = options.live ? "live" : "dry-run";
  const authProviderMode = normalizeTeacherAuthProvider(
    options.provider || env.UAIS_TEACHER_AUTH_PROVIDER,
  );
  const vercelEnvSync = readJsonEvidence(options.vercelEnvSync);
  const trustedTeacherAuthRouteChain = readJsonEvidence(
    options.trustedTeacherAuthRouteChain,
  );
  const routeSmoke = readJsonEvidence(options.routeSmoke);
  const plan = buildTeacherAuthProviderReadinessPlan({
    mode,
    environment: options.environment,
    authProviderMode,
    sessionSecret: options.sessionSecret || env.UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET,
    issuerSecret: options.issuerSecret || env.UAIS_TEACHER_AUTH_ISSUER_SECRET,
    oidcIssuer: options.baseUrl || env.UAIS_TEACHER_AUTH_OIDC_ISSUER,
    oidcAudience: options.audience || env.UAIS_TEACHER_AUTH_OIDC_AUDIENCE,
    oidcJwksUrl: options.jwksUrl || env.UAIS_TEACHER_AUTH_OIDC_JWKS_URL,
    oidcTeacherIdClaim:
      options.teacherIdClaim || env.UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM,
    releaseRunId: normalizeReleaseRunId(options.releaseRunId),
    vercelEnvSync,
    trustedTeacherAuthRouteChain,
    routeSmoke,
  });

  if (mode === "dry-run") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exit(0);
  }

  if (plan.status === "blocked") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exitCode = 1;
  } else if (authProviderMode === "oidc-jwks") {
    const jwksReadiness = await readJwksReadiness(options.jwksUrl || env.UAIS_TEACHER_AUTH_OIDC_JWKS_URL);
    const status = jwksReadiness.status === "ready" ? "ready" : "blocked";
    const oidcPlan = withTeacherAuthProviderReadinessResults({
      ...plan,
      status,
      oidcJwksReadiness: jwksReadiness,
      blockedReasons:
        status === "ready"
          ? []
          : [...plan.blockedReasons, "teacher-auth-oidc-jwks-readiness-not-proven"],
    });
    process.stdout.write(
      `${JSON.stringify(
        oidcPlan,
        null,
        2,
      )}\n`,
    );
    if (status !== "ready") {
      process.exitCode = 1;
    }
  } else {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Teacher auth provider readiness failed."}\n`,
  );
  process.exitCode = 1;
}

function buildTeacherAuthProviderReadinessPlan({
  mode,
  environment,
  authProviderMode,
  sessionSecret,
  issuerSecret,
  oidcIssuer,
  oidcAudience,
  oidcJwksUrl,
  oidcTeacherIdClaim,
  releaseRunId,
  vercelEnvSync,
  trustedTeacherAuthRouteChain,
  routeSmoke,
}) {
  const sessionCookieContract = {
    signingSecretStrength: classifySecretStrength(sessionSecret),
    httpOnly: "required",
    sameSite: "lax",
    secureInProduction: true,
    maxAgeBounded: true,
    cookiePair: teacherAuthSessionCookiePair.map((cookie) => ({
      ...cookie,
      httpOnly: true,
      sameSite: "Lax",
      secure: "required-in-production",
      path: "/",
      maxAge: "bounded-by-session-ttl",
      priority: "High",
      valueRedacted: true,
    })),
    valueRedacted: true,
  };
  const trustedIssuerContract =
    authProviderMode === "trusted-cookie-issuer"
      ? {
          issuerSecretStrength: classifySecretStrength(issuerSecret),
          sessionIssuerSecretSeparation: classifyTrustedIssuerSecretSeparation({
            sessionSecret,
            issuerSecret,
          }),
          issuerProofRequired: true,
          issuerProofMaxAgeSeconds: teacherAuthIssuerProofTtlSeconds,
          issuerProofBoundsCookieMaxAge: true,
          valueRedacted: true,
        }
      : undefined;
  const trustedCookieSessionRoundTrip =
    authProviderMode === "trusted-cookie-issuer" &&
    classifySecretStrength(sessionSecret) === "sufficient"
      ? createTrustedCookieSessionRoundTripProof({ sessionSecret })
      : undefined;
  // No issuer secret, no endpoint, no round-trip against a second party: the
  // account row is the authority and the login route is the only mint point, so
  // the signing secret is the whole trust chain. Deliberately no development
  // fallback - a committed constant here would be a published forgery key for
  // every teacher write.
  const databaseAccountCookieContract =
    authProviderMode === "database-account-cookie"
      ? {
          sessionSecretStrength: classifySecretStrength(sessionSecret),
          accountAuthority: "uais_users",
          sessionMintPoint: "app-session-login-route",
          issuerServiceRequired: false,
          identityProviderRequired: false,
          valueRedacted: true,
        }
      : undefined;
  const databaseAccountCookieSessionRoundTrip =
    authProviderMode === "database-account-cookie" &&
    classifySecretStrength(sessionSecret) === "sufficient"
      ? createTrustedCookieSessionRoundTripProof({ sessionSecret })
      : undefined;
  const oidcEndpointSecurity =
    authProviderMode === "oidc-jwks"
      ? {
          issuer: classifyEndpointSecurity(oidcIssuer),
          jwks: classifyEndpointSecurity(oidcJwksUrl),
        }
      : undefined;
  const oidcProviderContract =
    authProviderMode === "oidc-jwks"
      ? {
          audience: hasValue(oidcAudience) ? "present" : "missing",
          teacherIdClaim: hasValue(oidcTeacherIdClaim) ? "present" : "missing",
          bearerTokenNotRequiredForReadiness: true,
          providerValuesRedacted: true,
        }
      : undefined;
  const vercelEnvSyncEvidence = evaluateVercelEnvSyncEvidence({
    evidence: vercelEnvSync,
    authProviderMode,
    releaseRunId,
    required: mode === "live" && environment === "production",
  });
  const vercelEnvSyncMatchedForRouteChain =
    vercelEnvSyncEvidence?.status === "matched" &&
    vercelEnvSyncEvidence.applyPreflight === "proved" &&
    (!releaseRunId || vercelEnvSyncEvidence.releaseRunIdStatus === "matched");
  const trustedTeacherAuthRouteChainEvidence =
    evaluateTrustedTeacherAuthRouteChainEvidence({
      evidence: trustedTeacherAuthRouteChain,
      required:
        mode === "live" &&
        environment === "production" &&
        authProviderMode === "trusted-cookie-issuer" &&
        vercelEnvSyncMatchedForRouteChain,
    });
  const trustedTeacherAuthRouteSmokeEvidence =
    evaluateTrustedTeacherAuthRouteSmokeEvidence({
      evidence: routeSmoke,
      authProviderMode,
      releaseRunId,
      required:
        mode === "live" &&
        environment === "production" &&
        authProviderMode === "trusted-cookie-issuer" &&
        Boolean(releaseRunId) &&
        vercelEnvSyncMatchedForRouteChain &&
        trustedTeacherAuthRouteChainEvidence?.status === "proved",
    });
  const prerequisites = [
    ...(vercelEnvSyncEvidence
      ? [
          {
            id: "s19-vercel-env-sync-apply-evidence",
            responsibleSession: "S19",
            requiredEvidence: "vercel-env-sync",
            status: vercelEnvSyncEvidence.status,
            valueRedacted: true,
          },
        ]
      : []),
    ...(trustedTeacherAuthRouteChainEvidence
      ? [
          {
            id: "s12-trusted-teacher-auth-route-chain-contract",
            responsibleSession: "S12",
            requiredEvidence: "trusted-teacher-auth-route-chain-contract",
            status: trustedTeacherAuthRouteChainEvidence.status,
            valueRedacted: true,
          },
        ]
      : []),
    ...(trustedTeacherAuthRouteSmokeEvidence
      ? [
          {
            id: "s22-trusted-teacher-auth-route-smoke",
            responsibleSession: "S22",
            requiredEvidence: "deployment-route-smoke",
            status: trustedTeacherAuthRouteSmokeEvidence.status,
            valueRedacted: true,
          },
        ]
      : []),
  ];

  const blockedReasons = [
    ...(mode === "live" && environment !== "production"
      ? ["teacher-auth-provider-readiness-not-production"]
      : []),
    ...(mode === "live" && environment === "production" && !releaseRunId
      ? ["teacher-auth-provider-release-run-id-missing"]
      : []),
    ...readVercelEnvSyncBlockedReasons(vercelEnvSyncEvidence),
    ...readTrustedTeacherAuthRouteChainBlockedReasons({
      authProviderMode,
      evidenceStatus: trustedTeacherAuthRouteChainEvidence,
    }),
    ...readTrustedTeacherAuthRouteSmokeBlockedReasons({
      authProviderMode,
      evidenceStatus: trustedTeacherAuthRouteSmokeEvidence,
    }),
    ...readAuthProviderBlockedReasons(authProviderMode),
    ...readSessionSecretBlockedReasons(sessionCookieContract),
    ...readTrustedIssuerBlockedReasons({ authProviderMode, trustedIssuerContract }),
    ...readTrustedCookieSessionRoundTripBlockedReasons({
      authProviderMode,
      trustedCookieSessionRoundTrip,
    }),
    ...readDatabaseAccountCookieBlockedReasons({
      authProviderMode,
      databaseAccountCookieSessionRoundTrip,
    }),
    ...readOidcBlockedReasons({
      environment,
      authProviderMode,
      oidcEndpointSecurity,
      oidcProviderContract,
    }),
    ...(mode === "dry-run" ? ["teacher-auth-provider-live-readiness-not-run"] : []),
  ];
  const safety = {
    valuesRedacted: true,
    secretsOmitted: true,
    providerUrlsOmitted: true,
    responseBodiesOmitted: true,
    localPrivatePathsOmitted: true,
    liveRequiresApproval: true,
    remoteMutationRequiresApproval: true,
    cookieValuesOmitted: true,
    noCookieIssued: true,
    cookiesOmitted: true,
  };

  return withTeacherAuthProviderReadinessResults({
    target: "teacher-auth-provider-readiness",
    mode,
    environment,
    network: mode === "live" && authProviderMode === "oidc-jwks" ? "enabled" : "disabled",
    status: blockedReasons.length === 0 ? "ready" : "blocked",
    ...(releaseRunId ? { releaseRunId } : {}),
    responsibleSession: "S22",
    authProviderMode,
    sessionCookieContract,
    ...(trustedIssuerContract ? { trustedIssuerContract } : {}),
    ...(trustedCookieSessionRoundTrip ? { trustedCookieSessionRoundTrip } : {}),
    ...(databaseAccountCookieContract ? { databaseAccountCookieContract } : {}),
    ...(databaseAccountCookieSessionRoundTrip
      ? { databaseAccountCookieSessionRoundTrip }
      : {}),
    ...(oidcEndpointSecurity ? { oidcEndpointSecurity } : {}),
    ...(oidcProviderContract ? { oidcProviderContract } : {}),
    ...(vercelEnvSyncEvidence ? { vercelEnvSyncEvidence } : {}),
    ...(trustedTeacherAuthRouteChainEvidence
      ? { trustedTeacherAuthRouteChainEvidence }
      : {}),
    ...(trustedTeacherAuthRouteSmokeEvidence
      ? { trustedTeacherAuthRouteSmokeEvidence }
      : {}),
    prerequisites,
    blockedReasons,
    safety,
  });
}

function withTeacherAuthProviderReadinessResults(evidence) {
  return {
    ...evidence,
    results: buildTeacherAuthProviderReadinessResults(evidence),
  };
}

function buildTeacherAuthProviderReadinessResults(evidence) {
  return {
    [teacherAuthProviderReadinessResultKeys[0]]: resultStatus(
      acceptedTeacherAuthProviderModes.includes(evidence.authProviderMode),
    ),
    [teacherAuthProviderReadinessResultKeys[1]]: resultStatus(
      isTeacherAuthSessionCookieContractProved(evidence.sessionCookieContract),
    ),
    [teacherAuthProviderReadinessResultKeys[2]]: resultStatus(
      isTeacherAuthProviderVercelEnvSyncProved(evidence.vercelEnvSyncEvidence),
    ),
    [teacherAuthProviderReadinessResultKeys[3]]: resultStatus(
      isTeacherAuthProviderSpecificContractProved(evidence),
    ),
    [teacherAuthProviderReadinessResultKeys[4]]: resultStatus(
      isTeacherAuthProviderRouteBindingProved(evidence),
    ),
    [teacherAuthProviderReadinessResultKeys[5]]: resultStatus(
      isTeacherAuthReadinessSafetyProved(evidence.safety),
    ),
  };
}

function resultStatus(proved) {
  return proved ? "passed" : "blocked";
}

function isTeacherAuthSessionCookieContractProved(contract) {
  return contract?.signingSecretStrength === "sufficient" &&
    contract.httpOnly === "required" &&
    contract.sameSite === "lax" &&
    contract.secureInProduction === true &&
    contract.maxAgeBounded === true &&
    Array.isArray(contract.cookiePair) &&
    contract.cookiePair.length === teacherAuthSessionCookiePair.length &&
    contract.cookiePair.every((cookie, index) =>
      cookie.name === teacherAuthSessionCookiePair[index].name &&
      cookie.purpose === teacherAuthSessionCookiePair[index].purpose &&
      cookie.httpOnly === true &&
      cookie.sameSite === "Lax" &&
      cookie.secure === "required-in-production" &&
      cookie.path === "/" &&
      cookie.maxAge === "bounded-by-session-ttl" &&
      cookie.priority === "High" &&
      cookie.valueRedacted === true
    ) &&
    contract.valueRedacted === true;
}

function isTeacherAuthProviderVercelEnvSyncProved(evidence) {
  return evidence?.target === "vercel-env-sync" &&
    evidence.status === "matched" &&
    evidence.applyPreflight === "proved" &&
    evidence.releaseRunIdStatus === "matched" &&
    evidence.valueRedacted === true;
}

function isTeacherAuthProviderSpecificContractProved(evidence) {
  if (evidence.authProviderMode === "trusted-cookie-issuer") {
    return isTrustedIssuerContractProved(evidence.trustedIssuerContract) &&
      isTrustedCookieSessionRoundTripProved(evidence.trustedCookieSessionRoundTrip);
  }
  if (evidence.authProviderMode === "database-account-cookie") {
    return isDatabaseAccountCookieContractProved(evidence.databaseAccountCookieContract) &&
      isTrustedCookieSessionRoundTripProved(
        evidence.databaseAccountCookieSessionRoundTrip,
      );
  }
  if (evidence.authProviderMode === "oidc-jwks") {
    return evidence.oidcEndpointSecurity?.issuer === "remote-https" &&
      evidence.oidcEndpointSecurity?.jwks === "remote-https" &&
      evidence.oidcProviderContract?.audience === "present" &&
      evidence.oidcProviderContract?.teacherIdClaim === "present" &&
      evidence.oidcProviderContract?.bearerTokenNotRequiredForReadiness === true &&
      evidence.oidcProviderContract?.providerValuesRedacted === true &&
      evidence.oidcJwksReadiness?.status === "ready" &&
      evidence.oidcJwksReadiness?.keys === "present" &&
      evidence.oidcJwksReadiness?.signingKeys === "present";
  }
  return false;
}

function isDatabaseAccountCookieContractProved(contract) {
  return contract?.sessionSecretStrength === "sufficient" &&
    contract.accountAuthority === "uais_users" &&
    contract.sessionMintPoint === "app-session-login-route" &&
    contract.issuerServiceRequired === false &&
    contract.identityProviderRequired === false &&
    contract.valueRedacted === true;
}

function isTrustedIssuerContractProved(contract) {
  return contract?.issuerSecretStrength === "sufficient" &&
    contract.sessionIssuerSecretSeparation === "proved" &&
    contract.issuerProofRequired === true &&
    contract.issuerProofMaxAgeSeconds === teacherAuthIssuerProofTtlSeconds &&
    contract.issuerProofBoundsCookieMaxAge === true &&
    contract.valueRedacted === true;
}

function isTrustedCookieSessionRoundTripProved(proof) {
  return proof?.status === "proved" &&
    proof.cookiePair === "created-and-verified-in-memory" &&
    proof.claimsCookie === "signed-session-claims" &&
    proof.signatureCookie === "hmac-sha256-signature" &&
    proof.signatureVerification === "passed" &&
    proof.expiryCheck === "passed" &&
    proof.tamperCheck === "passed" &&
    proof.sessionIdRedacted === true &&
    proof.cookieValuesEmitted === false &&
    proof.valuesRedacted === true;
}

function isTeacherAuthProviderRouteBindingProved(evidence) {
  // Neither of these has a separate issuer route to bind to: OIDC verifies a
  // bearer token from the identity provider, and the database selector mints
  // the cookie inside the login route it already shares a deployment with. Only
  // trusted-cookie-issuer has an issuer endpoint whose chain has to be proved.
  if (
    evidence.authProviderMode === "oidc-jwks" ||
    evidence.authProviderMode === "database-account-cookie"
  ) {
    return true;
  }
  if (evidence.authProviderMode !== "trusted-cookie-issuer") {
    return false;
  }
  return isTrustedTeacherAuthRouteChainEvidenceProved(
    evidence.trustedTeacherAuthRouteChainEvidence,
  ) && (
    evidence.mode === "dry-run" ||
    isTrustedTeacherAuthRouteSmokeEvidenceProved(
      evidence.trustedTeacherAuthRouteSmokeEvidence,
    )
  );
}

function isTrustedTeacherAuthRouteChainEvidenceProved(evidence) {
  return evidence?.target === "trusted-teacher-auth-route-chain-contract" &&
    evidence.status === "proved" &&
    evidence.valueRedacted === true &&
    evidence.authProvider === "trusted-cookie-issuer" &&
    evidence.routeChain === "proved" &&
    evidence.issuerProofValidation === "proved" &&
    evidence.issuerCookieHardening === "proved" &&
    evidence.sessionCookiePair === "proved" &&
    evidence.downstreamAiSession === "proved" &&
    evidence.workflowAction === "proved" &&
    evidence.localTrustedCookieRouteWiring === "proved" &&
    evidence.redactionSafety === "proved";
}

function isTrustedTeacherAuthRouteSmokeEvidenceProved(evidence) {
  return evidence?.target === "teacher-auth-issuer-route-smoke" &&
    evidence.status === "proved" &&
    evidence.valueRedacted === true &&
    evidence.releaseRunIdStatus === "matched" &&
    evidence.deploymentBinding === "proved" &&
    evidence.teacherAuthIssuerRoute === "proved" &&
    evidence.responseHeaders === "proved" &&
    evidence.responseShape === "proved";
}

function isTeacherAuthReadinessSafetyProved(safety) {
  return safety?.valuesRedacted === true &&
    safety.secretsOmitted === true &&
    safety.providerUrlsOmitted === true &&
    safety.responseBodiesOmitted === true &&
    safety.localPrivatePathsOmitted === true &&
    safety.liveRequiresApproval === true &&
    safety.remoteMutationRequiresApproval === true &&
    safety.cookieValuesOmitted === true &&
    safety.noCookieIssued === true &&
    safety.cookiesOmitted === true;
}

function evaluateTrustedTeacherAuthRouteChainEvidence({
  evidence,
  required,
}) {
  if (evidence === undefined) {
    return required ? createMissingTrustedTeacherAuthRouteChainEvidence() : undefined;
  }
  if (!isRecord(evidence)) {
    return {
      ...createMissingTrustedTeacherAuthRouteChainEvidence(),
      status: "invalid",
    };
  }

  const routeEvidence = isRecord(evidence.evidence) ? evidence.evidence : {};
  const releaseImpact = isRecord(evidence.releaseImpact) ? evidence.releaseImpact : {};
  const safety = isRecord(evidence.safety) ? evidence.safety : {};
  const routeChain = readTrustedTeacherAuthRouteChainRoutes(routeEvidence.routeChain);
  const issuerProofValidation = readTrustedTeacherAuthRouteChainIssuerProofValidation(
    routeEvidence.issuerProofValidation,
  );
  const sessionCookiePair = readTrustedTeacherAuthRouteChainCookiePair(
    routeEvidence.sessionCookiePair,
  );
  const issuerCookieHardening = readTrustedTeacherAuthRouteChainIssuerCookieHardening(
    routeEvidence.issuerCookieHardening,
  );
  const target =
    evidence.target === "trusted-teacher-auth-route-chain-contract"
      ? "trusted-teacher-auth-route-chain-contract"
      : typeof evidence.target === "string"
        ? "unexpected"
        : "missing";
  const authProvider =
    routeEvidence.authProvider === "trusted-cookie-issuer"
      ? "trusted-cookie-issuer"
      : "missing";
  const downstreamAiSession =
    routeEvidence.downstreamAiSession === "scoped-teacher-ai-session-issued"
      ? "proved"
      : "missing";
  const workflowAction =
    routeEvidence.workflowAction === "ppt-narration-submit" ? "proved" : "missing";
  const localTrustedCookieRouteWiring =
    releaseImpact.localTrustedCookieRouteWiring === "proved" ? "proved" : "missing";
  const redactionSafety =
    safety.secretsRedacted === true &&
    safety.cookieValuesOmitted === true &&
    safety.sessionIdsOmitted === true &&
    safety.commandOutputOmitted === true &&
    safety.localPrivatePathsOmitted === true &&
    safety.productionMutationPerformed === false
      ? "proved"
      : "missing";
  const proved =
    target === "trusted-teacher-auth-route-chain-contract" &&
    evidence.status === "proved-locally" &&
    authProvider === "trusted-cookie-issuer" &&
    routeChain === "proved" &&
    issuerProofValidation === "proved" &&
    issuerCookieHardening === "proved" &&
    sessionCookiePair === "proved" &&
    downstreamAiSession === "proved" &&
    workflowAction === "proved" &&
    localTrustedCookieRouteWiring === "proved" &&
    redactionSafety === "proved";

  return {
    target,
    status: proved ? "proved" : "not-proven",
    valueRedacted: true,
    authProvider,
    routeChain,
    issuerProofValidation,
    issuerCookieHardening,
    sessionCookiePair,
    downstreamAiSession,
    workflowAction,
    localTrustedCookieRouteWiring,
    redactionSafety,
  };
}

function createMissingTrustedTeacherAuthRouteChainEvidence() {
  return {
    target: "missing",
    status: "missing",
    valueRedacted: true,
    authProvider: "missing",
    routeChain: "missing",
    issuerProofValidation: "missing",
    issuerCookieHardening: "missing",
    sessionCookiePair: "missing",
    downstreamAiSession: "missing",
    workflowAction: "missing",
    localTrustedCookieRouteWiring: "missing",
    redactionSafety: "missing",
  };
}

function evaluateTrustedTeacherAuthRouteSmokeEvidence({
  evidence,
  authProviderMode,
  releaseRunId,
  required,
}) {
  if (evidence === undefined) {
    return required ? createMissingTrustedTeacherAuthRouteSmokeEvidence() : undefined;
  }
  if (!isRecord(evidence)) {
    return {
      ...createMissingTrustedTeacherAuthRouteSmokeEvidence(),
      status: "invalid",
    };
  }

  const target =
    evidence.target === "teacher-auth-issuer-route-smoke"
      ? "teacher-auth-issuer-route-smoke"
      : evidence.target === "deployment-route-smoke"
        ? "deployment-route-smoke"
      : typeof evidence.target === "string"
        ? "unexpected"
        : "missing";
  const releaseRunIdStatus = readReleaseRunIdStatus(evidence, releaseRunId);
  const deploymentBinding = readTrustedTeacherAuthRouteSmokeDeploymentBinding(evidence);
  const issuerRoute = readTrustedTeacherAuthIssuerRouteSmoke(evidence.results);
  const issuedTeacherAiSessionRoute = readIssuedTeacherAiSessionRouteSmoke(evidence.results);
  const responseHeaders = readTrustedTeacherAuthIssuerRouteSmokeResponseHeaders(issuerRoute);
  const responseShape = readTrustedTeacherAuthIssuerRouteSmokeResponseShape(issuerRoute);
  const issuedTeacherAiSessionRouteShape =
    readIssuedTeacherAiSessionRouteSmokeResponseShape(issuedTeacherAiSessionRoute);
  const teacherAuthIssuerOnly = target === "teacher-auth-issuer-route-smoke";
  const issuedTeacherAiSessionRouteProved =
    issuedTeacherAiSessionRoute !== undefined &&
    issuedTeacherAiSessionRoute.status === "ok" &&
    issuedTeacherAiSessionRoute.auth === "issued-teacher-auth-cookie" &&
    issuedTeacherAiSessionRouteShape === "proved";
  const issuedTeacherAiSessionRouteSatisfied =
    issuedTeacherAiSessionRouteProved ||
    (teacherAuthIssuerOnly && issuedTeacherAiSessionRoute === undefined);
  const proved =
    authProviderMode === "trusted-cookie-issuer" &&
    (target === "teacher-auth-issuer-route-smoke" || target === "deployment-route-smoke") &&
    evidence.mode === "live" &&
    evidence.environment === "production" &&
    evidence.authProviderMode === "trusted-cookie-issuer" &&
    releaseRunIdStatus === "matched" &&
    deploymentBinding === "proved" &&
    issuerRoute !== undefined &&
    issuerRoute.status === "ok" &&
    issuerRoute.auth === "signed-admin-ai-access" &&
    responseHeaders === "proved" &&
    responseShape === "proved" &&
    issuedTeacherAiSessionRouteSatisfied;

  return {
    target,
    status: proved ? "proved" : "not-proven",
    valueRedacted: true,
    releaseRunIdStatus,
    deploymentBinding,
    teacherAuthIssuerRoute:
      issuerRoute?.status === "ok" && issuerRoute.auth === "signed-admin-ai-access"
        ? "proved"
        : "missing",
    issuedTeacherAiSessionRoute:
      issuedTeacherAiSessionRouteProved
        ? "proved"
        : teacherAuthIssuerOnly && issuedTeacherAiSessionRoute === undefined
          ? "not-required-for-issuer-only"
          : "missing",
    responseHeaders,
    responseShape,
  };
}

function createMissingTrustedTeacherAuthRouteSmokeEvidence() {
  return {
    target: "missing",
    status: "missing",
    valueRedacted: true,
    releaseRunIdStatus: "missing",
    deploymentBinding: "missing",
    teacherAuthIssuerRoute: "missing",
    issuedTeacherAiSessionRoute: "missing",
    responseHeaders: "missing",
    responseShape: "missing",
  };
}

function readTrustedTeacherAuthRouteSmokeDeploymentBinding(evidence) {
  const binding = isRecord(evidence.vercelProductionDeploymentEvidence)
    ? evidence.vercelProductionDeploymentEvidence
    : {};
  return (binding.status === "matched" ||
    binding.status === "matched-via-domain-reachability") &&
    binding.deploymentObservationStatus === "observed" &&
    binding.releaseRunIdStatus === "matched" &&
    binding.valueRedacted === true
    ? "proved"
    : "missing";
}

function readTrustedTeacherAuthIssuerRouteSmoke(results) {
  if (!Array.isArray(results)) {
    return undefined;
  }
  return results.find(
    (result) => isRecord(result) && result.id === "s22-teacher-auth-issuer-route",
  );
}

function readIssuedTeacherAiSessionRouteSmoke(results) {
  if (!Array.isArray(results)) {
    return undefined;
  }
  return results.find(
    (result) => isRecord(result) && result.id === "s22-teacher-ai-session-route",
  );
}

function readTrustedTeacherAuthIssuerRouteSmokeResponseHeaders(routeResult) {
  if (!isRecord(routeResult) || !isRecord(routeResult.responseHeaders)) {
    return "missing";
  }
  const headers = routeResult.responseHeaders;
  const requiredHeaders = isRecord(headers.requiredHeaders)
    ? headers.requiredHeaders
    : {};
  return headers.checked === true &&
    headers.status === "ok" &&
    requiredHeaders.teacherAuthClaimsSetCookie === "present" &&
    requiredHeaders.teacherAuthSignatureSetCookie === "present" &&
    requiredHeaders.httpOnlySameSiteSecureMaxAge === "present" &&
    requiredHeaders.priorityHigh === "present" &&
    requiredHeaders.issuerProofBoundedMaxAge === "present"
    ? "proved"
    : "missing";
}

function readTrustedTeacherAuthIssuerRouteSmokeResponseShape(routeResult) {
  if (!isRecord(routeResult) || !isRecord(routeResult.responseShape)) {
    return "missing";
  }
  const shape = routeResult.responseShape;
  const requiredFields = isRecord(shape.requiredFields) ? shape.requiredFields : {};
  return shape.checked === true &&
    shape.status === "ok" &&
    requiredFields.teacherAuthSession === "present" &&
    requiredFields.authProviderContract === "present" &&
    requiredFields.s12TeacherAuthIssuerBoundary === "present"
    ? "proved"
    : "missing";
}

function readIssuedTeacherAiSessionRouteSmokeResponseShape(routeResult) {
  if (!isRecord(routeResult) || !isRecord(routeResult.responseShape)) {
    return "missing";
  }
  const shape = routeResult.responseShape;
  const requiredFields = isRecord(shape.requiredFields) ? shape.requiredFields : {};
  return shape.checked === true &&
    shape.status === "ok" &&
    requiredFields.accessSession === "present" &&
    requiredFields.accessPlan === "present" &&
    requiredFields.authProviderContract === "present" &&
    requiredFields.s12TeacherAiSessionBoundary === "present" &&
    requiredFields.signedContractDirectCallDenied === "present"
    ? "proved"
    : "missing";
}

function readTrustedTeacherAuthRouteChainRoutes(value) {
  if (!Array.isArray(value)) {
    return "missing";
  }
  return value[0] === "/api/ai/teacher-auth/issue" &&
    value[1] === "/api/ai/session" &&
    value.length === 2
    ? "proved"
    : "missing";
}

function readTrustedTeacherAuthRouteChainIssuerProofValidation(value) {
  if (!isRecord(value)) {
    return "missing";
  }
  return value.maxLifetimeSeconds === 300 &&
    value.rejectsFutureIssuedAt === true &&
    value.rejectsExpiresBeforeIssuedAt === true &&
    value.rejectsOverlongLifetime === true &&
    value.valuesRedacted === true
    ? "proved"
    : "missing";
}

function readTrustedTeacherAuthRouteChainCookiePair(value) {
  if (!Array.isArray(value)) {
    return "missing";
  }
  return value[0] === "uais_teacher_auth_claims" &&
    value[1] === "uais_teacher_auth_signature" &&
    value.length === 2
    ? "proved"
    : "missing";
}

function readTrustedTeacherAuthRouteChainIssuerCookieHardening(value) {
  if (!isRecord(value)) {
    return "missing";
  }
  return value.httpOnly === "required" &&
    value.sameSite === "lax" &&
    value.secureInProduction === true &&
    value.path === "/" &&
    value.maxAge === "bounded-by-session-ttl" &&
    value.priority === "High" &&
    value.valuesRedacted === true
    ? "proved"
    : "missing";
}

function createTrustedCookieSessionRoundTripProof({ sessionSecret }) {
  if (classifySecretStrength(sessionSecret) !== "sufficient") {
    return {
      status: "blocked",
      cookiePair: "missing",
      claimsCookie: "signed-session-claims",
      signatureCookie: "hmac-sha256-signature",
      signatureVerification: "missing",
      expiryCheck: "missing",
      tamperCheck: "missing",
      sessionIdRedacted: true,
      cookieValuesEmitted: false,
      valuesRedacted: true,
    };
  }

  const issuedAt = new Date("2026-06-19T00:00:00.000Z");
  const claims = {
    sessionId: "redacted-session-id",
    actorId: "s22-teacher-auth-readiness",
    role: "teacher",
    authenticatedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + 900_000).toISOString(),
  };
  const claimsValue = base64UrlEncode(Buffer.from(JSON.stringify(claims), "utf8"));
  const signature = signClaims(claimsValue, sessionSecret);
  const tamperedClaimsValue = base64UrlEncode(
    Buffer.from(
      JSON.stringify({
        ...claims,
        actorId: "tampered-teacher",
      }),
      "utf8",
    ),
  );
  const signatureVerification = signatureMatches(claimsValue, signature, sessionSecret);
  const expiryCheck =
    Date.parse(claims.expiresAt) > Date.parse(claims.authenticatedAt);
  const tamperRejected = !signatureMatches(tamperedClaimsValue, signature, sessionSecret);

  return {
    status: signatureVerification && expiryCheck && tamperRejected ? "proved" : "blocked",
    cookiePair: "created-and-verified-in-memory",
    claimsCookie: "signed-session-claims",
    signatureCookie: "hmac-sha256-signature",
    signatureVerification: signatureVerification ? "passed" : "failed",
    expiryCheck: expiryCheck ? "passed" : "failed",
    tamperCheck: tamperRejected ? "passed" : "failed",
    sessionIdRedacted: true,
    cookieValuesEmitted: false,
    valuesRedacted: true,
  };
}

function evaluateVercelEnvSyncEvidence({
  evidence,
  authProviderMode,
  releaseRunId,
  required,
}) {
  if (evidence === undefined) {
    return required
      ? {
          target: "missing",
          status: "missing",
          valueRedacted: true,
          releaseRunIdStatus: "missing",
        }
      : undefined;
  }
  if (!isRecord(evidence)) {
    return {
      target: "missing",
      status: "invalid",
      valueRedacted: true,
      releaseRunIdStatus: "missing",
    };
  }

  const target = typeof evidence.target === "string" ? evidence.target : "missing";
  const deploymentScope = readEvidenceDeploymentScope(evidence);
  const summary = {
    target,
    ...(deploymentScope ? { deploymentScope } : {}),
    valueRedacted: true,
  };
  if (target !== "vercel-env-sync") {
    return {
      ...summary,
      status: "invalid-target",
      applyPreflight: "missing",
      releaseRunIdStatus: "missing",
    };
  }
  if (deploymentScope === "unsupported") {
    return {
      ...summary,
      status: "unsupported-scope",
      applyPreflight: "missing",
      releaseRunIdStatus: "missing",
    };
  }
  if (
    evidence.mode !== "apply" ||
    evidence.projectReadinessEvidenceStatus !== "ready" ||
    !hasProductionAndPreviewTargets(evidence.targets) ||
    !hasRedactedApplySummary(evidence)
  ) {
    return {
      ...summary,
      status: "not-applied",
      applyPreflight: "missing",
      releaseRunIdStatus: "missing",
    };
  }
  if (!hasPassedApplyPreflight(evidence)) {
    return {
      ...summary,
      status: "apply-preflight-missing",
      applyPreflight: "missing",
      releaseRunIdStatus: "missing",
    };
  }
  if (releaseRunId && evidence.releaseRunId !== releaseRunId) {
    return {
      ...summary,
      status: "release-run-id-mismatch",
      applyPreflight: "proved",
      releaseRunIdStatus: "mismatched",
    };
  }
  if (evidence.authProviderMode !== authProviderMode) {
    return {
      ...summary,
      status: "mismatched",
      applyPreflight: "proved",
      releaseRunIdStatus: releaseRunId ? "matched" : "missing",
    };
  }

  return {
    ...summary,
    status: "matched",
    applyPreflight: "proved",
    releaseRunIdStatus: releaseRunId ? "matched" : "missing",
  };
}

function readEvidenceDeploymentScope(evidence) {
  if (typeof evidence.deploymentScope === "undefined") {
    return undefined;
  }
  if (evidence.deploymentScope === "full" || evidence.deploymentScope === "teacher-auth") {
    return evidence.deploymentScope;
  }
  return "unsupported";
}

function readReleaseRunIdStatus(evidence, expectedReleaseRunId) {
  if (!expectedReleaseRunId) {
    return "missing";
  }
  return evidence.releaseRunId === expectedReleaseRunId
    ? "matched"
    : typeof evidence.releaseRunId === "string"
      ? "mismatched"
      : "missing";
}

function hasProductionAndPreviewTargets(targets) {
  return (
    Array.isArray(targets) &&
    targets.includes("production") &&
    targets.includes("preview")
  );
}

function hasRedactedApplySummary(evidence) {
  const summary = evidence.applySummary;
  const appliedByTarget = summary?.appliedByTarget;
  return (
    isRecord(summary) &&
    summary.status === "applied" &&
    Number.isInteger(summary.appliedActions) &&
    summary.appliedActions > 0 &&
    isRecord(appliedByTarget) &&
    Number.isInteger(appliedByTarget.production) &&
    appliedByTarget.production > 0 &&
    Number.isInteger(appliedByTarget.preview) &&
    appliedByTarget.preview > 0 &&
    Number.isInteger(summary.localOnlyEntriesSkipped) &&
    summary.localOnlyEntriesSkipped >= 0 &&
    summary.valuesRedacted === true &&
    (summary.cliOutputOmitted === true || summary.apiOutputOmitted === true)
  );
}

function hasPassedApplyPreflight(evidence) {
  const preflight = evidence.applyPreflight;
  return (
    isRecord(preflight) &&
    preflight.status === "passed" &&
    Array.isArray(preflight.blockedReasons) &&
    preflight.blockedReasons.length === 0 &&
    preflight.valuesRedacted === true &&
    preflight.cliSafeToInvoke === true
  );
}

function readVercelEnvSyncBlockedReasons(evidenceStatus) {
  if (!evidenceStatus || evidenceStatus.status === "matched") {
    return [];
  }
  if (evidenceStatus.status === "mismatched") {
    return ["vercel-env-sync-auth-provider-selector-mismatch"];
  }
  if (evidenceStatus.status === "apply-preflight-missing") {
    return ["vercel-env-sync-apply-preflight-not-proven"];
  }
  return [`vercel-env-sync-evidence-${evidenceStatus.status}`];
}

function readTrustedTeacherAuthRouteChainBlockedReasons({
  authProviderMode,
  evidenceStatus,
}) {
  if (authProviderMode !== "trusted-cookie-issuer") {
    return [];
  }
  if (!evidenceStatus || evidenceStatus.status === "proved") {
    return [];
  }
  return ["trusted-teacher-auth-route-chain-not-proven"];
}

function readTrustedTeacherAuthRouteSmokeBlockedReasons({
  authProviderMode,
  evidenceStatus,
}) {
  if (authProviderMode !== "trusted-cookie-issuer") {
    return [];
  }
  if (!evidenceStatus || evidenceStatus.status === "proved") {
    return [];
  }
  return ["trusted-teacher-auth-route-smoke-not-proven"];
}

function readAuthProviderBlockedReasons(authProviderMode) {
  return acceptedTeacherAuthProviderModes.includes(authProviderMode)
    ? []
    : ["teacher-auth-provider-selector-not-proven"];
}

function readDatabaseAccountCookieBlockedReasons({
  authProviderMode,
  databaseAccountCookieSessionRoundTrip,
}) {
  if (authProviderMode !== "database-account-cookie") {
    return [];
  }
  // Absent because the secret was already reported as insufficient, which
  // readSessionSecretBlockedReasons names on its own.
  if (!databaseAccountCookieSessionRoundTrip) {
    return [];
  }
  return databaseAccountCookieSessionRoundTrip.status === "proved"
    ? []
    : ["teacher-auth-session-cookie-round-trip-not-proven"];
}

function readSessionSecretBlockedReasons(sessionCookieContract) {
  return sessionCookieContract.signingSecretStrength === "sufficient"
    ? []
    : ["teacher-auth-session-signing-secret-not-sufficient"];
}

function readTrustedIssuerBlockedReasons({ authProviderMode, trustedIssuerContract }) {
  if (authProviderMode !== "trusted-cookie-issuer") {
    return [];
  }
  if (trustedIssuerContract?.issuerSecretStrength !== "sufficient") {
    return ["teacher-auth-issuer-secret-not-sufficient"];
  }
  if (trustedIssuerContract.sessionIssuerSecretSeparation !== "proved") {
    return ["teacher-auth-session-issuer-secret-separation-not-proven"];
  }
  return [];
}

function readTrustedCookieSessionRoundTripBlockedReasons({
  authProviderMode,
  trustedCookieSessionRoundTrip,
}) {
  if (authProviderMode !== "trusted-cookie-issuer") {
    return [];
  }
  if (!trustedCookieSessionRoundTrip) {
    return [];
  }
  return trustedCookieSessionRoundTrip?.status === "proved"
    ? []
    : ["teacher-auth-session-cookie-round-trip-not-proven"];
}

function readOidcBlockedReasons({
  environment,
  authProviderMode,
  oidcEndpointSecurity,
  oidcProviderContract,
}) {
  if (authProviderMode !== "oidc-jwks") {
    return [];
  }
  const missingContract = [];
  if (oidcProviderContract?.audience !== "present") {
    missingContract.push("teacher-auth-oidc-audience-missing");
  }
  if (oidcProviderContract?.teacherIdClaim !== "present") {
    missingContract.push("teacher-auth-oidc-teacher-id-claim-missing");
  }
  const endpointBlocked =
    environment === "production" &&
    (!oidcEndpointSecurity ||
      oidcEndpointSecurity.issuer !== "remote-https" ||
      oidcEndpointSecurity.jwks !== "remote-https")
      ? ["production-teacher-auth-oidc-endpoints-not-remote-https"]
      : [];
  return [...missingContract, ...endpointBlocked];
}

async function readJwksReadiness(jwksUrl) {
  try {
    const response = await fetch(jwksUrl);
    if (!response.ok) {
      return { status: "blocked", httpStatus: response.status, keys: "missing" };
    }
    const body = await response.json();
    const keys = Array.isArray(body?.keys) ? body.keys : [];
    const signingKeys = keys.filter(isUsableRs256SigningJwk);
    const ready = signingKeys.length > 0;
    return {
      status: ready ? "ready" : "blocked",
      httpStatus: response.status,
      keys: keys.length > 0 ? "present" : "missing",
      signingKeys: ready ? "present" : "missing",
      valuesRedacted: true,
    };
  } catch {
    return {
      status: "blocked",
      httpStatus: "request-failed",
      keys: "missing",
      signingKeys: "missing",
    };
  }
}

function isUsableRs256SigningJwk(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  if (value.kty !== "RSA") {
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
  return hasValue(value.kid) && hasValue(value.n) && hasValue(value.e);
}

function normalizeTeacherAuthProvider(value) {
  if (!hasValue(value)) {
    return "missing";
  }
  const provider = value.trim();
  if (acceptedTeacherAuthProviderModes.includes(provider)) {
    return provider;
  }
  return "unsupported";
}

function classifySecretStrength(value) {
  if (!hasValue(value)) {
    return "missing";
  }
  return value.trim().length >= minimumProductionSecretLength ? "sufficient" : "weak";
}

function signatureMatches(claimsValue, signatureValue, secret) {
  const expected = signClaims(claimsValue, secret);
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(signatureValue);
  return expectedBytes.byteLength === actualBytes.byteLength && timingSafeEqual(expectedBytes, actualBytes);
}

function signClaims(claimsValue, secret) {
  return base64UrlEncode(createHmac("sha256", secret.trim()).update(claimsValue).digest());
}

function base64UrlEncode(bytes) {
  return bytes.toString("base64url");
}

function classifyTrustedIssuerSecretSeparation({ sessionSecret, issuerSecret }) {
  if (!hasValue(sessionSecret) || !hasValue(issuerSecret)) {
    return "missing";
  }
  return sessionSecret.trim() === issuerSecret.trim() ? "missing" : "proved";
}

function classifyEndpointSecurity(value) {
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

function classifyEndpointHost(hostname) {
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

function parseArgs(args) {
  const options = {
    live: false,
    approved: false,
    environment: "unspecified",
    envFile: undefined,
    provider: undefined,
    baseUrl: undefined,
    jwksUrl: undefined,
    audience: undefined,
    teacherIdClaim: undefined,
    sessionSecret: undefined,
    issuerSecret: undefined,
    vercelEnvSync: undefined,
    trustedTeacherAuthRouteChain: undefined,
    routeSmoke: undefined,
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
      options.environment = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--env-file") {
      options.envFile = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--vercel-env-sync") {
      options.vercelEnvSync = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--trusted-teacher-auth-route-chain") {
      options.trustedTeacherAuthRouteChain = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--route-smoke") {
      options.routeSmoke = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--provider") {
      options.provider = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--base-url") {
      options.baseUrl = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--jwks-url") {
      options.jwksUrl = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--audience") {
      options.audience = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--teacher-id-claim") {
      options.teacherIdClaim = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--session-secret") {
      options.sessionSecret = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--issuer-secret") {
      options.issuerSecret = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--release-run-id") {
      options.releaseRunId = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node -- scripts/teacher-auth-provider-readiness.mjs [--dry-run] [--live --approved] [--environment production|preview|local-production|unspecified] [--env-file PATH] [--vercel-env-sync PATH] [--trusted-teacher-auth-route-chain PATH] [--route-smoke PATH]",
          "",
          "Checks redacted teacher auth/session provider readiness without issuing cookies or printing secrets.",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function readJsonEvidence(path) {
  if (!hasValue(path)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { status: "invalid" };
  }
}

function readEnvFile(path) {
  if (!hasValue(path)) {
    return {};
  }
  const entries = {};
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (key) {
      entries[key] = stripOptionalQuotes(value);
    }
  }
  return entries;
}

function stripOptionalQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function readArgValue(args, index, name) {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function normalizeReleaseRunId(value) {
  if (!hasValue(value)) {
    return undefined;
  }
  const releaseRunId = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(releaseRunId)) {
    throw new Error("--release-run-id must be a non-secret release identifier.");
  }
  return releaseRunId;
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
