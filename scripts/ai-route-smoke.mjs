#!/usr/bin/env node

import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const teacherAuthIssuerProofTtlSeconds = 300;

// Mirrors resolveUaisTeacherAuthProviderContract in
// src/lib/server/teacher-auth-provider-contract.ts. `database-account-cookie`
// mints the teacher session inside the app's own login route for an account
// already verified as role = 'teacher', so this smoke cannot issue one - it has
// no password and must never hold one. An operator supplies the minted cookie.
const supportedTeacherAuthProviders = [
  "trusted-cookie-issuer",
  "oidc-jwks",
  "database-account-cookie",
];

const teacherAuthProviderRequiredSmokeEnvNames = {
  "trusted-cookie-issuer": ["UAIS_TEACHER_AUTH_ISSUER_SECRET"],
  "oidc-jwks": [
    "UAIS_TEACHER_AUTH_OIDC_ISSUER",
    "UAIS_TEACHER_AUTH_OIDC_AUDIENCE",
    "UAIS_TEACHER_AUTH_OIDC_JWKS_URL",
    "UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM",
    "UAIS_TEACHER_AUTH_OIDC_SMOKE_BEARER_TOKEN",
    "UAIS_TEACHER_AUTH_OIDC_SMOKE_TEACHER_ID",
  ],
  "database-account-cookie": ["UAIS_TEACHER_AUTH_ROUTE_SMOKE_SESSION_COOKIE"],
};

const routeChecks = [
  {
    id: "s22-retention-readiness-route",
    route: "/api/ai/voice-assets/retention-readiness",
    method: "GET",
    action: "verify-admin-retention-readiness-route",
    auth: "signed-admin-ai-access",
    expectedStatus: 200,
    responsibleSessions: ["S22", "S12", "S24"],
  },
  {
    id: "s22-voice-lifecycle-audit-route",
    route: "/api/ai/voice-clone/lifecycle-audit",
    method: "GET",
    action: "verify-admin-voice-lifecycle-audit-route",
    auth: "signed-admin-ai-access",
    expectedStatus: 200,
    responsibleSessions: ["S22", "S12", "S24"],
  },
  {
    id: "s22-ai-readiness-route",
    route: "/api/ai/readiness",
    method: "GET",
    action: "verify-admin-ai-readiness-route",
    auth: "signed-admin-ai-access",
    expectedStatus: 200,
    responsibleSessions: ["S22", "S12", "S19"],
  },
  {
    id: "s22-ai-smoke-plan-route",
    route: "/api/ai/smoke-plan",
    method: "GET",
    action: "verify-admin-ai-smoke-plan-route",
    auth: "signed-admin-ai-access",
    expectedStatus: 200,
    responsibleSessions: ["S22", "S12", "S19"],
  },
  {
    id: "s22-teacher-auth-issuer-route",
    route: "/api/ai/teacher-auth/issue",
    method: "POST",
    action: "verify-admin-teacher-auth-issuer-route",
    auth: "signed-admin-ai-access",
    expectedStatus: 200,
    responsibleSessions: ["S22", "S12", "S19"],
    requestBodyShape: "teacher-auth-session-issue",
    responseHeaderChecks: [
      "teacherAuthClaimsSetCookie",
      "teacherAuthSignatureSetCookie",
      "httpOnlySameSiteSecureMaxAge",
      "priorityHigh",
      "issuerProofBoundedMaxAge",
    ],
    responseShapeChecks: [
      "teacherAuthSession",
      "authProviderContract",
      "s12TeacherAuthIssuerBoundary",
    ],
  },
  {
    id: "s22-teacher-ownership-route",
    route: "/api/ai/teacher-ownership",
    method: "GET",
    action: "verify-issued-teacher-ownership-route",
    auth: "issued-teacher-auth-cookie",
    expectedStatus: 200,
    responsibleSessions: ["S22", "S12", "S24", "S19"],
    responseShapeChecks: [
      "ownership",
      "consistency",
      "s12TeacherOwnershipSummary",
    ],
  },
  {
    id: "s22-teacher-ai-session-route",
    route: "/api/ai/session",
    method: "POST",
    action: "verify-issued-teacher-ai-session-route",
    auth: "issued-teacher-auth-cookie",
    expectedStatus: 200,
    responsibleSessions: ["S22", "S12", "S19"],
    requestBodyShape: "teacher-ai-session-issue",
    responseShapeChecks: [
      "accessSession",
      "accessPlan",
      "authProviderContract",
      "s12TeacherAiSessionBoundary",
      "signedContractDirectCallDenied",
    ],
  },
  {
    id: "s22-teacher-ppt-workflow-route",
    route: "/api/ai/teacher-ppt-workflow",
    method: "GET",
    action: "verify-signed-teacher-ppt-workflow-route",
    auth: "issued-teacher-auth-cookie",
    expectedStatus: 200,
    responsibleSessions: ["S22", "S12", "S24", "S19"],
    responseShapeChecks: [
      "workflow",
      "workflowReadyForDownloads",
      "workflowDownloadContract",
      "workflowAudioDownloadPattern",
      "workflowExportDownloadUrl",
      "agentHandoffPlan",
      "agentHandoffPlanFramework",
      "s22ReleaseSmokeAgent",
    ],
  },
];
const networkRetryPolicy = {
  maxAttempts: 3,
  perAttemptTimeoutMs: 10_000,
  retryOn: ["request-error"],
  valuesRedacted: true,
};

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.live && options.approved !== true) {
    throw new Error("Protected route smoke checks require explicit owner approval.");
  }
  if (options.live && options.environment === "production" && !hasValue(options.releaseRunId)) {
    throw new Error("Protected route smoke checks require --release-run-id.");
  }

  const env = {
    ...process.env,
    ...readEnvFile(options.envFile),
  };
  const mode = options.live ? "live" : "dry-run";
  const baseUrl = options.baseUrl || env.UAIS_DEPLOYMENT_BASE_URL;
  const vercelProductionDeployment = readJsonEvidence(options.vercelProductionDeployment);
  const deploymentDomainReachability = readJsonEvidence(options.deploymentDomainReachability);
  const teacherAuthProviderReadiness = readJsonEvidence(options.teacherAuthProviderReadiness);
  const authProviderMode = normalizeTeacherAuthProvider(env.UAIS_TEACHER_AUTH_PROVIDER);
  const activeRouteChecks = buildRouteChecks(authProviderMode, {
    teacherAuthIssuerOnly: options.teacherAuthIssuerOnly,
  });
  const plan = buildRouteSmokePlan({
    mode,
    environment: options.environment,
    baseUrl,
    env,
    authProviderMode,
    routeChecks: activeRouteChecks,
    teacherAuthIssuerOnly: options.teacherAuthIssuerOnly,
    releaseRunId: options.releaseRunId,
    vercelProductionDeployment,
    deploymentDomainReachability,
    teacherAuthProviderReadiness,
  });

  if (mode === "dry-run") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exit(0);
  }

  if (plan.status === "blocked") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exitCode = 1;
  } else {
    assertLivePrerequisites({ baseUrl, env });
    const results = await executeRouteSmoke({
      routeChecks: activeRouteChecks,
      baseUrl,
      authProviderMode,
      aiAccessSigningSecret: env.UAIS_AI_ACCESS_SIGNING_SECRET,
      teacherAuthIssuerSecret: env.UAIS_TEACHER_AUTH_ISSUER_SECRET,
      oidcSmokeBearerToken: env.UAIS_TEACHER_AUTH_OIDC_SMOKE_BEARER_TOKEN,
      teacherAuthSessionCookie: env.UAIS_TEACHER_AUTH_ROUTE_SMOKE_SESSION_COOKIE,
      teacherId: readRouteSmokeTeacherId({ env, authProviderMode }),
    });
    const status = results.every((result) => result.status === "ok") ? "passed" : "failed";
    process.stdout.write(`${JSON.stringify({ ...plan, status, results }, null, 2)}\n`);
    if (status !== "passed") {
      process.exitCode = 1;
    }
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Route smoke failed."}\n`);
  process.exitCode = 1;
}

function buildRouteChecks(authProviderMode, { teacherAuthIssuerOnly = false } = {}) {
  const checks = teacherAuthIssuerOnly
    ? routeChecks.filter((check) => check.id === "s22-teacher-auth-issuer-route")
    : routeChecks;
  return checks.map((check) => {
    if (check.id !== "s22-teacher-auth-issuer-route") {
      return check;
    }
    if (authProviderMode === "oidc-jwks") {
      return {
        ...check,
        action: "verify-oidc-teacher-auth-issuer-route",
        auth: "oidc-jwks-bearer-token",
      };
    }
    if (authProviderMode === "database-account-cookie") {
      // There is no issuer endpoint to call: the session was minted at login
      // and the smoke presents it, so the route is exercised as the holder of
      // that cookie rather than as a party proving an issuer signature.
      return {
        ...check,
        action: "verify-database-account-teacher-auth-session",
        auth: "database-account-session-cookie",
      };
    }
    return {
      ...check,
      responseShapeChecks: [
        ...new Set([
          ...(Array.isArray(check.responseShapeChecks) ? check.responseShapeChecks : []),
          "signedContractDirectCallDenied",
        ]),
      ],
    };
  });
}

function buildRouteSmokePlan({
  mode,
  environment,
  baseUrl,
  env,
  authProviderMode,
  routeChecks,
  teacherAuthIssuerOnly,
  releaseRunId,
  vercelProductionDeployment,
  deploymentDomainReachability,
  teacherAuthProviderReadiness,
}) {
  const deploymentOrigin = describeDeploymentOrigin(baseUrl);
  const deploymentFingerprint = createDeploymentFingerprint(baseUrl);
  const deploymentDomainReachabilityEvidence = evaluateDeploymentDomainReachabilityEvidence({
    evidence: deploymentDomainReachability,
    deploymentFingerprint,
    releaseRunId,
  });
  const vercelProductionDeploymentEvidence =
    vercelProductionDeployment === undefined && environment === "production"
      ? {
          target: "missing",
          status: "missing",
          deploymentObservationStatus: "missing",
          releaseRunIdStatus: "missing",
          valueRedacted: true,
        }
      : evaluateVercelProductionDeploymentEvidence({
          evidence: vercelProductionDeployment,
          deploymentFingerprint,
          releaseRunId,
          deploymentDomainReachabilityEvidence,
        });
  const teacherAuthProviderReadinessEvidence = evaluateTeacherAuthProviderReadinessEvidence({
    evidence: teacherAuthProviderReadiness,
    authProviderMode,
    releaseRunId,
    required: mode === "live" && environment === "production" && !teacherAuthIssuerOnly,
  });
  const oidcEndpointSecurity =
    authProviderMode === "oidc-jwks"
      ? describeOidcEndpointSecurity({
          issuer: env.UAIS_TEACHER_AUTH_OIDC_ISSUER,
          jwks: env.UAIS_TEACHER_AUTH_OIDC_JWKS_URL,
        })
      : undefined;
  const sharedPrerequisites = [
    {
      id: "s22-deployment-base-url",
      responsibleSession: "S22",
      requiredEnv: "UAIS_DEPLOYMENT_BASE_URL",
      status: hasValue(baseUrl) ? "present" : "missing",
    },
    {
      id: "s19-ai-access-signing-secret",
      responsibleSession: "S19",
      requiredEnv: "UAIS_AI_ACCESS_SIGNING_SECRET",
      status: hasValue(env.UAIS_AI_ACCESS_SIGNING_SECRET) ? "present" : "missing",
    },
    {
      id: "s12-teacher-auth-provider",
      responsibleSession: "S12",
      requiredEnv: "UAIS_TEACHER_AUTH_PROVIDER",
      status: isSupportedTeacherAuthProvider(authProviderMode)
        ? "present"
        : "missing",
    },
    {
      id: "s19-teacher-auth-session-signing-secret",
      responsibleSession: "S19",
      requiredEnv: "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
      status: hasValue(env.UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET) ? "present" : "missing",
    },
    ...(vercelProductionDeploymentEvidence
      ? [
          {
            id: "s22-vercel-production-deployment-evidence",
            responsibleSession: "S22",
            requiredEvidence: "vercel-production-deployment",
            status: vercelProductionDeploymentEvidence.status,
            valueRedacted: true,
          },
        ]
      : []),
    ...(teacherAuthProviderReadinessEvidence
      ? [
          {
            id: "s22-teacher-auth-provider-readiness-evidence",
            responsibleSession: "S22",
            requiredEvidence: "teacher-auth-provider-readiness",
            status: teacherAuthProviderReadinessEvidence.status,
            valueRedacted: true,
          },
        ]
      : []),
  ];
  const trustedIssuerPrerequisites = [
    {
      id: "s12-teacher-auth-issuer-secret",
      responsibleSession: "S12",
      requiredEnv: "UAIS_TEACHER_AUTH_ISSUER_SECRET",
      status: hasValue(env.UAIS_TEACHER_AUTH_ISSUER_SECRET) ? "present" : "missing",
    },
  ];
  // `database-account-cookie` verifies the session with the shared signing
  // secret already listed above and mints it inside the app's own login route,
  // so it needs neither an issuer secret nor an OIDC endpoint. What it does need
  // is the one credential this smoke cannot produce: a cookie an operator minted
  // at login. Listed for the same reason the OIDC branch lists its bearer token
  // - a plan that stays silent about it reports "ready" and then the live run
  // throws in assertLivePrerequisites.
  const databaseAccountCookiePrerequisites = [
    {
      id: "s22-teacher-auth-route-smoke-session-cookie",
      responsibleSession: "S22",
      requiredEnv: "UAIS_TEACHER_AUTH_ROUTE_SMOKE_SESSION_COOKIE",
      status: hasValue(env.UAIS_TEACHER_AUTH_ROUTE_SMOKE_SESSION_COOKIE)
        ? "present"
        : "missing",
    },
  ];
  const oidcPrerequisites = [
    {
      id: "s12-teacher-auth-oidc-issuer",
      responsibleSession: "S12",
      requiredEnv: "UAIS_TEACHER_AUTH_OIDC_ISSUER",
      status: hasValue(env.UAIS_TEACHER_AUTH_OIDC_ISSUER) ? "present" : "missing",
    },
    {
      id: "s12-teacher-auth-oidc-audience",
      responsibleSession: "S12",
      requiredEnv: "UAIS_TEACHER_AUTH_OIDC_AUDIENCE",
      status: hasValue(env.UAIS_TEACHER_AUTH_OIDC_AUDIENCE) ? "present" : "missing",
    },
    {
      id: "s12-teacher-auth-oidc-jwks-url",
      responsibleSession: "S12",
      requiredEnv: "UAIS_TEACHER_AUTH_OIDC_JWKS_URL",
      status: hasValue(env.UAIS_TEACHER_AUTH_OIDC_JWKS_URL) ? "present" : "missing",
    },
    {
      id: "s12-teacher-auth-oidc-teacher-id-claim",
      responsibleSession: "S12",
      requiredEnv: "UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM",
      status: hasValue(env.UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM)
        ? "present"
        : "missing",
    },
    {
      id: "s22-teacher-auth-oidc-smoke-token",
      responsibleSession: "S22",
      requiredEnv: "UAIS_TEACHER_AUTH_OIDC_SMOKE_BEARER_TOKEN",
      status: hasValue(env.UAIS_TEACHER_AUTH_OIDC_SMOKE_BEARER_TOKEN)
        ? "present"
        : "missing",
    },
    {
      id: "s22-teacher-auth-oidc-smoke-teacher-id",
      responsibleSession: "S22",
      requiredEnv: "UAIS_TEACHER_AUTH_OIDC_SMOKE_TEACHER_ID",
      status: hasValue(env.UAIS_TEACHER_AUTH_OIDC_SMOKE_TEACHER_ID)
        ? "present"
        : "missing",
    },
  ];
  // Keyed on the SELECTED provider, three ways. A two-way oidc-vs-issuer split
  // sent database-account-cookie down the issuer branch, so a first-party
  // deployment was told it was blocked on a secret that selector never reads and
  // no service anywhere holds. An unset or unrecognised provider still lands on
  // the issuer branch, which is the default the rest of this script assumes.
  const prerequisites = [
    ...sharedPrerequisites,
    ...(authProviderMode === "oidc-jwks"
      ? oidcPrerequisites
      : authProviderMode === "database-account-cookie"
        ? databaseAccountCookiePrerequisites
        : trustedIssuerPrerequisites),
  ];
  const blockedReasons = [
    ...prerequisites.flatMap((prerequisite) => {
      if (prerequisite.status !== "missing") {
        return [];
      }
      if (prerequisite.id === "s12-teacher-auth-provider") {
        return [teacherAuthProviderBlockedReason(env.UAIS_TEACHER_AUTH_PROVIDER)];
      }
      return prerequisite.requiredEnv ? [`missing-${prerequisite.requiredEnv}`] : [];
    }),
    ...readProductionDeploymentOriginBlockedReasons({ environment, deploymentOrigin }),
    ...readProductionOidcEndpointBlockedReasons({
      environment,
      authProviderMode,
      oidcEndpointSecurity,
    }),
    ...readVercelProductionDeploymentBlockedReasons(vercelProductionDeploymentEvidence),
    ...readTeacherAuthProviderReadinessBlockedReasons(teacherAuthProviderReadinessEvidence),
  ];

  return {
    target: teacherAuthIssuerOnly
      ? "teacher-auth-issuer-route-smoke"
      : "deployment-route-smoke",
    mode,
    environment,
    authProviderMode,
    network: mode === "live" ? "enabled" : "disabled",
    status: blockedReasons.length === 0 ? "ready" : "blocked",
    responsibleSession: "S22",
    ...(releaseRunId ? { releaseRunId } : {}),
    deploymentFingerprint,
    deploymentOrigin,
    ...(vercelProductionDeploymentEvidence
      ? { vercelProductionDeploymentEvidence }
      : {}),
    ...(deploymentDomainReachabilityEvidence
      ? { deploymentDomainReachabilityEvidence }
      : {}),
    ...(teacherAuthProviderReadinessEvidence
      ? { teacherAuthProviderReadinessEvidence }
      : {}),
    ...(oidcEndpointSecurity ? { oidcEndpointSecurity } : {}),
    networkRetryPolicy,
    routeChecks,
    ...(teacherAuthIssuerOnly ? { routeScope: "teacher-auth-issuer-only" } : {}),
    prerequisites,
    blockedReasons,
    safety: {
      secretsRedacted: true,
      valuesRedacted: true,
      signedAdminAccess: true,
      issuedTeacherAuthCookie: true,
      cookieValuesOmitted: true,
      oidcBearerTokenOmitted: true,
      responseBodiesOmitted: true,
      liveRequiresApproval: true,
      remoteMutationRequiresApproval: true,
    },
  };
}

function evaluateTeacherAuthProviderReadinessEvidence({
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
          releaseRunIdStatus: "missing",
          valueRedacted: true,
        }
      : undefined;
  }
  if (!isRecord(evidence)) {
    return {
      target: "missing",
      status: "invalid",
      releaseRunIdStatus: "missing",
      valueRedacted: true,
    };
  }

  const target = typeof evidence.target === "string" ? evidence.target : "missing";
  const evidenceAuthProviderMode =
    typeof evidence.authProviderMode === "string"
      ? evidence.authProviderMode
      : "missing";
  const summary = {
    target,
    authProviderMode: evidenceAuthProviderMode,
    releaseRunIdStatus: readReleaseRunIdStatus(evidence, releaseRunId),
    valueRedacted: true,
  };
  if (target !== "teacher-auth-provider-readiness") {
    return { ...summary, status: "invalid-target" };
  }
  if (
    evidence.mode !== "live" ||
    evidence.environment !== "production" ||
    evidence.status !== "ready"
  ) {
    return { ...summary, status: "not-live-ready" };
  }
  if (releaseRunId && evidence.releaseRunId !== releaseRunId) {
    return { ...summary, status: "release-run-id-mismatch" };
  }
  if (evidenceAuthProviderMode !== authProviderMode) {
    return { ...summary, status: "mismatched" };
  }

  return { ...summary, status: "matched" };
}

function readTeacherAuthProviderReadinessBlockedReasons(evidenceStatus) {
  if (!evidenceStatus || evidenceStatus.status === "matched") {
    return [];
  }
  if (evidenceStatus.status === "mismatched") {
    return ["teacher-auth-provider-readiness-selector-mismatch"];
  }
  return [`teacher-auth-provider-readiness-evidence-${evidenceStatus.status}`];
}

function readProductionDeploymentOriginBlockedReasons({ environment, deploymentOrigin }) {
  if (
    environment !== "production" ||
    deploymentOrigin.status !== "present" ||
    deploymentOrigin.originClass === "remote-https"
  ) {
    return [];
  }
  return ["production-deployment-origin-not-remote-https"];
}

function evaluateVercelProductionDeploymentEvidence({
  evidence,
  deploymentFingerprint,
  releaseRunId,
  deploymentDomainReachabilityEvidence,
}) {
  if (evidence === undefined) {
    return undefined;
  }
  if (!isRecord(evidence)) {
    return {
      target: "missing",
      status: "invalid",
      deploymentObservationStatus: "missing",
      releaseRunIdStatus: "missing",
      valueRedacted: true,
    };
  }

  const target = typeof evidence.target === "string" ? evidence.target : "missing";
  const deploymentObservationStatus = readDeploymentObservationStatus(evidence);
  const summary = {
    target,
    deploymentObservationStatus,
    releaseRunIdStatus: readReleaseRunIdStatus(evidence, releaseRunId),
    valueRedacted: true,
  };
  if (target !== "vercel-production-deployment") {
    return { ...summary, status: "invalid-target" };
  }
  if (evidence.mode !== "live" || evidence.status !== "deployed") {
    return { ...summary, status: "not-deployed" };
  }
  if (deploymentObservationStatus !== "observed") {
    return { ...summary, status: "not-observed" };
  }
  if (releaseRunId && evidence.releaseRunId !== releaseRunId) {
    return { ...summary, status: "release-run-id-mismatch" };
  }

  const evidenceFingerprint = isRecord(evidence.deploymentFingerprint)
    ? evidence.deploymentFingerprint
    : undefined;
  if (
    !evidenceFingerprint ||
    evidenceFingerprint.status !== "present" ||
    typeof evidenceFingerprint.value !== "string"
  ) {
    return { ...summary, status: "fingerprint-missing" };
  }
  if (deploymentFingerprint.status !== "present") {
    return { ...summary, status: "deployment-fingerprint-missing" };
  }
  if (evidenceFingerprint.value !== deploymentFingerprint.value) {
    if (deploymentDomainReachabilityEvidence?.status === "matched") {
      return {
        ...summary,
        status: "matched-via-domain-reachability",
        deploymentDomainReachabilityStatus: "matched",
      };
    }
    return { ...summary, status: "mismatched" };
  }

  return { ...summary, status: "matched" };
}

function evaluateDeploymentDomainReachabilityEvidence({
  evidence,
  deploymentFingerprint,
  releaseRunId,
}) {
  if (evidence === undefined) {
    return undefined;
  }
  if (!isRecord(evidence)) {
    return {
      target: "missing",
      status: "invalid",
      releaseRunIdStatus: "missing",
      deploymentFingerprintStatus: "missing",
      valueRedacted: true,
    };
  }

  const target = typeof evidence.target === "string" ? evidence.target : "missing";
  const summary = {
    target,
    releaseRunIdStatus: readReleaseRunIdStatus(evidence, releaseRunId),
    deploymentFingerprintStatus: "missing",
    valueRedacted: true,
  };
  if (target !== "deployment-domain-reachability") {
    return { ...summary, status: "invalid-target" };
  }
  if (evidence.mode !== "live" || evidence.status !== "reachable") {
    return { ...summary, status: "not-reachable" };
  }
  if (releaseRunId && evidence.releaseRunId !== releaseRunId) {
    return { ...summary, status: "release-run-id-mismatch" };
  }

  const evidenceFingerprint = isRecord(evidence.deploymentFingerprint)
    ? evidence.deploymentFingerprint
    : undefined;
  if (
    !evidenceFingerprint ||
    evidenceFingerprint.status !== "present" ||
    typeof evidenceFingerprint.value !== "string"
  ) {
    return { ...summary, status: "fingerprint-missing" };
  }
  if (deploymentFingerprint.status !== "present") {
    return { ...summary, status: "deployment-fingerprint-missing" };
  }
  if (evidenceFingerprint.value !== deploymentFingerprint.value) {
    return {
      ...summary,
      status: "mismatched",
      deploymentFingerprintStatus: "mismatched",
    };
  }

  return {
    ...summary,
    status: "matched",
    deploymentFingerprintStatus: "matched",
  };
}

function readDeploymentObservationStatus(evidence) {
  return isRecord(evidence.deploymentObservation) &&
    typeof evidence.deploymentObservation.status === "string"
    ? evidence.deploymentObservation.status
    : "missing";
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

function readVercelProductionDeploymentBlockedReasons(evidenceStatus) {
  if (
    !evidenceStatus ||
    evidenceStatus.status === "matched" ||
    evidenceStatus.status === "matched-via-domain-reachability"
  ) {
    return [];
  }
  if (evidenceStatus.status === "mismatched") {
    return ["vercel-production-deployment-fingerprint-mismatch"];
  }
  return [`vercel-production-deployment-evidence-${evidenceStatus.status}`];
}

function readProductionOidcEndpointBlockedReasons({
  environment,
  authProviderMode,
  oidcEndpointSecurity,
}) {
  if (
    environment !== "production" ||
    authProviderMode !== "oidc-jwks" ||
    !oidcEndpointSecurity ||
    (oidcEndpointSecurity.issuer === "remote-https" &&
      oidcEndpointSecurity.jwks === "remote-https")
  ) {
    return [];
  }
  return ["production-oidc-endpoints-not-remote-https"];
}

async function executeRouteSmoke({
  routeChecks,
  baseUrl,
  authProviderMode,
  aiAccessSigningSecret,
  teacherAuthIssuerSecret,
  oidcSmokeBearerToken,
  teacherAuthSessionCookie,
  teacherId,
}) {
  const normalizedBaseUrl = stripTrailingSlash(baseUrl);
  const results = [];
  // For database-account-cookie the session is not issued during this run; the
  // operator supplies one minted at login, and every downstream route reuses it
  // exactly as it reuses an issued cookie.
  let issuedTeacherCookieHeader = teacherAuthSessionCookie;
  let issuedTeacherAiAccessHeaders;
  let derivedTeacherAiSessionResource;

  for (const check of routeChecks) {
    let networkAttempts;
    try {
      const requestBody = check.requestBodyShape
        ? createRouteSmokeRequestBody(check.requestBodyShape, {
            teacherId,
            teacherAiSessionResource: derivedTeacherAiSessionResource,
          })
        : undefined;
      const headers =
        check.auth === "issued-teacher-auth-cookie" ||
        check.auth === "database-account-session-cookie"
          ? createIssuedTeacherCookieHeaders(issuedTeacherCookieHeader)
          : check.auth === "oidc-jwks-bearer-token"
            ? createOidcBearerTokenHeaders(oidcSmokeBearerToken)
            : createSignedAdminHeaders({
                actorId: "s22-route-smoke-admin",
                secret: aiAccessSigningSecret,
              });
      if (check.id === "s22-teacher-ppt-workflow-route" && issuedTeacherAiAccessHeaders) {
        Object.assign(headers, issuedTeacherAiAccessHeaders);
      }
      if (
        check.id === "s22-teacher-auth-issuer-route" &&
        authProviderMode === "trusted-cookie-issuer"
      ) {
        Object.assign(
          headers,
          createTrustedTeacherAuthIssuerHeaders({
            teacherId: requestBody.teacherId,
            secret: teacherAuthIssuerSecret,
          }),
        );
      }
      if (check.requestBodyShape) {
        headers["content-type"] = "application/json";
      }
      const requestResult = await fetchWithNetworkRetry(`${normalizedBaseUrl}${check.route}`, {
        method: check.method,
        headers,
        ...(requestBody ? { body: JSON.stringify(requestBody) } : {}),
      });
      networkAttempts = requestResult.networkAttempts;
      if (!requestResult.response) {
        results.push({
          ...check,
          status: "failed",
          error: "request-failed",
          networkAttempts,
          networkError: requestResult.networkError,
        });
        continue;
      }
      const response = requestResult.response;
      const ownershipResponseForDerivation =
        check.id === "s22-teacher-ownership-route" && response.ok ? response.clone() : undefined;
      const teacherAiSessionResponseForDerivation =
        check.id === "s22-teacher-ai-session-route" && response.ok ? response.clone() : undefined;
      let responseShape =
        check.responseShapeChecks
          ? await validateRouteResponseShape(check, response)
          : undefined;
      const directCallBoundary =
        check.id === "s22-teacher-auth-issuer-route" &&
        authProviderMode === "trusted-cookie-issuer" &&
        response.ok
          ? await verifyTrustedTeacherAuthIssuerDirectCallDenied({
              baseUrl: normalizedBaseUrl,
              teacherId: requestBody?.teacherId ?? teacherId,
              teacherAuthIssuerSecret,
            })
          : check.id === "s22-teacher-ai-session-route" && response.ok
            ? await verifyUnsignedAiContractDirectCallDenied({
                baseUrl: normalizedBaseUrl,
                teacherId,
                resource: requestBody?.resource,
              })
            : undefined;
      if (responseShape && directCallBoundary) {
        responseShape = mergeRouteResponseShapeField(
          responseShape,
          "signedContractDirectCallDenied",
          directCallBoundary.status === "ok" ? "present" : "missing",
        );
      }
      const responseHeaders =
        check.responseHeaderChecks
          ? validateTeacherAuthIssueResponseHeaders(response, check.responseHeaderChecks)
          : undefined;
      if (check.id === "s22-teacher-auth-issuer-route" && responseHeaders?.status === "ok") {
        issuedTeacherCookieHeader = createTeacherCookieHeaderFromSetCookieHeaders(
          readSetCookieHeaders(response.headers),
        );
      }
      if (ownershipResponseForDerivation && responseShape?.status === "ok") {
        derivedTeacherAiSessionResource = await deriveTeacherAiSessionResourceFromOwnershipResponse(
          ownershipResponseForDerivation,
          teacherId,
        );
      }
      if (teacherAiSessionResponseForDerivation && responseShape?.status === "ok") {
        issuedTeacherAiAccessHeaders = await readTeacherAiAccessHeadersFromSessionResponse(
          teacherAiSessionResponseForDerivation,
        );
      }
      results.push({
        ...check,
        status:
          response.status === check.expectedStatus &&
          (!responseShape || responseShape.status === "ok") &&
          (!responseHeaders || responseHeaders.status === "ok")
            ? "ok"
            : "failed",
        httpStatus: response.status,
        networkAttempts,
        ...(responseShape ? { responseShape } : {}),
        ...(responseHeaders ? { responseHeaders } : {}),
        ...(directCallBoundary ? { directCallBoundary } : {}),
      });
    } catch {
      results.push({
        ...check,
        status: "failed",
        error: "request-failed",
        ...(networkAttempts ? { networkAttempts } : {}),
      });
    }
  }

  return results;
}

async function readTeacherAiAccessHeadersFromSessionResponse(response) {
  const body = await response.json().catch(() => undefined);
  const headers = body?.accessSession?.headers;
  if (!isRecord(headers)) {
    return undefined;
  }
  const claims = readNonEmptyString(headers["x-uais-access-claims"]);
  const signature = readNonEmptyString(headers["x-uais-access-signature"]);
  if (!claims || !signature) {
    return undefined;
  }
  return {
    "x-uais-access-claims": claims,
    "x-uais-access-signature": signature,
  };
}

async function fetchWithNetworkRetry(url, init) {
  let lastError;
  for (let attempt = 1; attempt <= networkRetryPolicy.maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(networkRetryPolicy.perAttemptTimeoutMs),
      });
      return {
        response,
        networkAttempts: createNetworkAttempts(attempt),
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    response: undefined,
    networkAttempts: createNetworkAttempts(networkRetryPolicy.maxAttempts),
    networkError: classifyNetworkError(lastError),
  };
}

function createNetworkAttempts(attempted) {
  return {
    attempted,
    maxAttempts: networkRetryPolicy.maxAttempts,
    retried: attempted > 1,
    valueRedacted: true,
  };
}

function createRouteSmokeRequestBody(
  requestBodyShape,
  { teacherId, teacherAiSessionResource } = {},
) {
  if (requestBodyShape === "teacher-auth-session-issue") {
    return {
      teacherId,
      ttlSeconds: teacherAuthIssuerProofTtlSeconds,
    };
  }
  if (requestBodyShape === "teacher-ai-session-issue") {
    return {
      action: "ppt-narration-submit",
      ttlSeconds: 300,
      resource: teacherAiSessionResource ?? {
        teacherId,
        courseId: "research-methods",
        sampleAssetId: "asset-voice-10s",
        pptAssetId: "research-methods-unit-3",
        voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
      },
    };
  }

  return {};
}

async function verifyUnsignedAiContractDirectCallDenied({ baseUrl, teacherId, resource }) {
  const probes = [
    {
      route: "/api/ai/ppt-narration",
      method: "POST",
      body: createUnsignedPptNarrationContractProbeBody({ teacherId, resource }),
    },
    {
      route: "/api/ai/chat",
      method: "POST",
      body: createUnsignedChatContractProbeBody({ resource }),
    },
    {
      route: "/api/ai/voice-sample",
      method: "POST",
      body: createUnsignedVoiceSampleContractProbeBody({ teacherId, resource }),
    },
    {
      route: "/api/ai/voice-clone/preflight",
      method: "POST",
      body: createUnsignedVoiceClonePreflightContractProbeBody({ teacherId, resource }),
    },
    {
      route: "/api/ai/voice-clone/status",
      method: "POST",
      body: createUnsignedVoiceCloneStatusContractProbeBody({ teacherId, resource }),
    },
    {
      route: "/api/ai/voice-clone/revoke",
      method: "POST",
      body: createUnsignedVoiceCloneRevokeContractProbeBody({ teacherId, resource }),
    },
    {
      route: createUnsignedPptNarrationExportProbeRoute({ resource }),
      reportRoute: "/api/ai/ppt-narration/export/{audioManifestId}",
      method: "GET",
    },
    {
      route: createUnsignedPptNarrationAudioProbeRoute({ resource }),
      reportRoute: "/api/ai/ppt-narration/audio/{audioManifestId}/{audioId}",
      method: "GET",
    },
  ];
  const teacherCookieRouteProbes = [
    {
      route: "/api/ai/teacher-ownership",
      method: "GET",
      expectedStatus: 401,
      expectedReasonCode: "authenticated-session-required",
    },
    {
      route: "/api/ai/teacher-ppt-workflow",
      method: "GET",
      expectedStatus: 401,
      expectedReasonCode: "authenticated-session-required",
    },
  ];
  const adminRouteProbes = [
    {
      route: "/api/ai/voice-assets/retention-readiness",
      method: "GET",
    },
    {
      route: "/api/ai/voice-clone/lifecycle-audit",
      method: "GET",
    },
    {
      route: "/api/ai/readiness",
      method: "GET",
    },
    {
      route: "/api/ai/smoke-plan",
      method: "GET",
    },
  ];
  const probeResults = await executeDirectCallDenialProbes({ baseUrl, probes });
  const legacyScopedHeaderProbes = await executeDirectCallDenialProbes({
    baseUrl,
    probes,
    headers: createLegacyScopedAiAccessHeaders({ teacherId, resource }),
  });
  const teacherCookieRouteProbeResults = await executeDirectCallDenialProbes({
    baseUrl,
    probes: teacherCookieRouteProbes,
  });
  const legacyScopedHeaderTeacherCookieRouteProbes = await executeDirectCallDenialProbes({
    baseUrl,
    probes: teacherCookieRouteProbes,
    headers: createLegacyScopedAiAccessHeaders({ teacherId, resource }),
  });
  const adminRouteProbeResults = await executeDirectCallDenialProbes({
    baseUrl,
    probes: adminRouteProbes,
  });
  const legacyScopedHeaderAdminRouteProbes = await executeDirectCallDenialProbes({
    baseUrl,
    probes: adminRouteProbes,
    headers: createLegacyScopedAiAdminAccessHeaders(),
  });

  const primaryProbe = probeResults[0] ?? {
    route: "/api/ai/ppt-narration",
    method: "POST",
    expectedStatus: 403,
  };

  return {
    checked: true,
    status:
      probeResults.every((probe) => probe.status === "ok") &&
      legacyScopedHeaderProbes.every((probe) => probe.status === "ok") &&
      teacherCookieRouteProbeResults.every((probe) => probe.status === "ok") &&
      legacyScopedHeaderTeacherCookieRouteProbes.every((probe) => probe.status === "ok") &&
      adminRouteProbeResults.every((probe) => probe.status === "ok") &&
      legacyScopedHeaderAdminRouteProbes.every((probe) => probe.status === "ok")
        ? "ok"
        : "failed",
    route: primaryProbe.route,
    method: primaryProbe.method,
    expectedStatus: primaryProbe.expectedStatus,
    ...(primaryProbe.httpStatus ? { httpStatus: primaryProbe.httpStatus } : {}),
    reasonCode: primaryProbe.reasonCode ?? "missing",
    ...(primaryProbe.networkAttempts ? { networkAttempts: primaryProbe.networkAttempts } : {}),
    probes: probeResults,
    legacyScopedHeaderPolicy: {
      actorHeaders: "legacy-scoped-ai-access",
      expectedResult: "signed-session-required",
      valuesRedacted: true,
    },
    legacyScopedHeaderProbes,
    teacherCookieRoutePolicy: {
      routes: "signed-teacher-cookie-required",
      expectedResult: "authenticated-session-required",
      valuesRedacted: true,
    },
    teacherCookieRouteProbes: teacherCookieRouteProbeResults,
    legacyScopedHeaderTeacherCookieRouteProbes,
    adminRoutePolicy: {
      routes: "signed-admin-ai-access-required",
      expectedResult: "signed-session-required",
      valuesRedacted: true,
    },
    adminRouteProbes: adminRouteProbeResults,
    legacyScopedHeaderAdminRouteProbes,
    valuesRedacted: true,
  };
}

async function verifyTrustedTeacherAuthIssuerDirectCallDenied({
  baseUrl,
  teacherId,
  teacherAuthIssuerSecret,
}) {
  const body = createRouteSmokeRequestBody("teacher-auth-session-issue", { teacherId });
  const probes = [
    {
      route: "/api/ai/teacher-auth/issue",
      method: "POST",
      body,
      headers: createTrustedTeacherAuthIssuerHeaders({
        teacherId: body.teacherId,
        secret: teacherAuthIssuerSecret,
      }),
    },
  ];
  const probeResults = await executeDirectCallDenialProbes({ baseUrl, probes });
  const legacyScopedHeaderProbes = await executeDirectCallDenialProbes({
    baseUrl,
    probes,
    headers: createLegacyScopedAiAdminAccessHeaders(),
  });
  const primaryProbe = probeResults[0] ?? {
    route: "/api/ai/teacher-auth/issue",
    method: "POST",
    expectedStatus: 403,
  };

  return {
    checked: true,
    status:
      probeResults.every((probe) => probe.status === "ok") &&
      legacyScopedHeaderProbes.every((probe) => probe.status === "ok")
        ? "ok"
        : "failed",
    route: primaryProbe.route,
    method: primaryProbe.method,
    expectedStatus: primaryProbe.expectedStatus,
    ...(primaryProbe.httpStatus ? { httpStatus: primaryProbe.httpStatus } : {}),
    reasonCode: primaryProbe.reasonCode ?? "missing",
    ...(primaryProbe.networkAttempts ? { networkAttempts: primaryProbe.networkAttempts } : {}),
    probes: probeResults,
    legacyScopedHeaderPolicy: {
      actorHeaders: "legacy-scoped-ai-access",
      expectedResult: "signed-session-required",
      valuesRedacted: true,
    },
    legacyScopedHeaderProbes,
    valuesRedacted: true,
  };
}

async function executeDirectCallDenialProbes({ baseUrl, probes, headers = {} }) {
  const probeResults = [];

  for (const probe of probes) {
    const expectedStatus = probe.expectedStatus ?? 403;
    const expectedReasonCode = probe.expectedReasonCode ?? "signed-session-required";
    const requestResult = await fetchWithNetworkRetry(`${baseUrl}${probe.route}`, {
      method: probe.method,
      headers: {
        ...headers,
        ...(isRecord(probe.headers) ? probe.headers : {}),
        ...(probe.body ? { "content-type": "application/json" } : {}),
      },
      ...(probe.body ? { body: JSON.stringify(probe.body) } : {}),
    });

    if (!requestResult.response) {
      probeResults.push({
        checked: true,
        status: "failed",
        route: probe.reportRoute ?? probe.route,
        method: probe.method,
        expectedStatus,
        networkAttempts: requestResult.networkAttempts,
        networkError: requestResult.networkError,
        valuesRedacted: true,
      });
      continue;
    }

    const response = requestResult.response;
    const body = await response.json().catch(() => undefined);
    const reasonCode = isRecord(body) && isRecord(body.access)
      ? readNonEmptyString(body.access.reasonCode)
      : undefined;
    const denied = response.status === expectedStatus && reasonCode === expectedReasonCode;
    probeResults.push({
      checked: true,
      status: denied ? "ok" : "failed",
      route: probe.reportRoute ?? probe.route,
      method: probe.method,
      expectedStatus,
      httpStatus: response.status,
      reasonCode: reasonCode ?? "missing",
      networkAttempts: requestResult.networkAttempts,
      valuesRedacted: true,
    });
  }

  return probeResults;
}

function createLegacyScopedAiAccessHeaders({ teacherId, resource }) {
  const scopedResource = isRecord(resource) ? resource : {};
  const legacyActorId = "s22-route-smoke-legacy-teacher";
  const scopedTeacherId = readNonEmptyString(scopedResource.teacherId) ?? teacherId;
  return compactHeaders({
    "x-uais-actor-id": legacyActorId,
    "x-uais-actor-role": "teacher",
    "x-uais-teacher-ids": joinScopeValues([legacyActorId, scopedTeacherId]),
    "x-uais-course-ids": joinScopeValues([
      readNonEmptyString(scopedResource.courseId) ?? "research-methods",
    ]),
    "x-uais-sample-asset-ids": joinScopeValues([
      readNonEmptyString(scopedResource.sampleAssetId) ?? "asset-voice-10s",
    ]),
    "x-uais-ppt-asset-ids": joinScopeValues([
      readNonEmptyString(scopedResource.pptAssetId) ?? "research-methods-unit-3",
    ]),
    "x-uais-voice-ref-ids": joinScopeValues([
      readNonEmptyString(scopedResource.voiceRefId) ??
        "qwen-voice-ref-teacher-kang-asset-voice-10s",
    ]),
    "x-uais-audio-manifest-ids": joinScopeValues([
      readNonEmptyString(scopedResource.audioManifestId) ??
        "audio-manifest-research-methods-unit-3",
    ]),
  });
}

function createLegacyScopedAiAdminAccessHeaders() {
  return {
    "x-uais-actor-id": "s22-route-smoke-legacy-admin",
    "x-uais-actor-role": "admin",
  };
}

function joinScopeValues(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))].join(",");
}

function compactHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers).filter(([, value]) => typeof value === "string" && value.trim()),
  );
}

function createUnsignedPptNarrationContractProbeBody({ teacherId, resource }) {
  const scopedResource = isRecord(resource) ? resource : {};
  const scopedTeacherId = readNonEmptyString(scopedResource.teacherId) ?? teacherId;
  const courseId = readNonEmptyString(scopedResource.courseId) ?? "research-methods";
  const sampleAssetId = readNonEmptyString(scopedResource.sampleAssetId) ?? "asset-voice-10s";
  const pptAssetId = readNonEmptyString(scopedResource.pptAssetId) ?? "research-methods-unit-3";
  const voiceRefId =
    readNonEmptyString(scopedResource.voiceRefId) ??
    "qwen-voice-ref-teacher-kang-asset-voice-10s";

  return {
    executionMode: "contract",
    voiceClone: {
      teacherId: scopedTeacherId,
      consentConfirmed: true,
      sampleAssetId,
      sampleDurationSeconds: 12,
      language: "zh-CN",
      targetVoiceLabel: "contract-direct-call-smoke",
    },
    pptNarration: {
      courseId,
      pptAssetId,
      clonedVoiceRef: voiceRefId,
      language: "zh-CN",
      slideScripts: [
        {
          slideId: "slide-direct-call-smoke",
          narrationText: "Direct-call denial smoke placeholder.",
        },
      ],
      targetModel: "qwen-tts",
    },
  };
}

function createUnsignedChatContractProbeBody({ resource }) {
  const scopedResource = isRecord(resource) ? resource : {};
  const courseId = readNonEmptyString(scopedResource.courseId) ?? "research-methods";

  return {
    executionMode: "contract",
    courseId,
    agents: [
      {
        id: "direct-call-smoke-agent",
        handle: "@direct-call-smoke",
        name: "Direct Call Smoke Agent",
        role: "assistant",
        providerRole: "text-reasoning",
        priority: 1,
        allowedActions: ["respond"],
      },
    ],
    messages: [
      {
        id: "direct-call-smoke-message",
        role: "student",
        content: "Direct-call denial smoke placeholder.",
      },
    ],
    maxAgentTurns: 1,
  };
}

function createUnsignedVoiceSampleContractProbeBody({ teacherId, resource }) {
  const scopedResource = isRecord(resource) ? resource : {};
  const scopedTeacherId = readNonEmptyString(scopedResource.teacherId) ?? teacherId;
  const sampleAssetId = readNonEmptyString(scopedResource.sampleAssetId) ?? "asset-voice-10s";

  return {
    executionMode: "contract",
    teacherId: scopedTeacherId,
    consentConfirmed: true,
    consentScope: "ppt-narration",
    sampleAssetId,
    sampleDurationSeconds: 12,
    mimeType: "audio/wav",
    sourceKind: "owner-provided",
  };
}

function createUnsignedVoiceClonePreflightContractProbeBody({ teacherId, resource }) {
  const scopedResource = isRecord(resource) ? resource : {};
  const scopedTeacherId = readNonEmptyString(scopedResource.teacherId) ?? teacherId;
  const sampleAssetId = readNonEmptyString(scopedResource.sampleAssetId) ?? "asset-voice-10s";

  return {
    liveProviderApproved: true,
    teacherId: scopedTeacherId,
    consentConfirmed: true,
    consentScope: "ppt-narration",
    sampleAssetId,
    sampleDurationSeconds: 12,
    mimeType: "audio/wav",
    sourceKind: "owner-provided",
    language: "zh-CN",
    targetVoiceLabel: "contract-direct-call-smoke",
  };
}

function createUnsignedVoiceCloneStatusContractProbeBody({ teacherId, resource }) {
  const scopedResource = isRecord(resource) ? resource : {};
  const scopedTeacherId = readNonEmptyString(scopedResource.teacherId) ?? teacherId;
  const sampleAssetId = readNonEmptyString(scopedResource.sampleAssetId) ?? "asset-voice-10s";

  return {
    executionMode: "contract",
    providerTaskId: "direct-call-smoke-task",
    providerStatus: "RUNNING",
    teacherId: scopedTeacherId,
    sampleAssetId,
  };
}

function createUnsignedVoiceCloneRevokeContractProbeBody({ teacherId, resource }) {
  const scopedResource = isRecord(resource) ? resource : {};
  const scopedTeacherId = readNonEmptyString(scopedResource.teacherId) ?? teacherId;
  const sampleAssetId = readNonEmptyString(scopedResource.sampleAssetId) ?? "asset-voice-10s";
  const voiceRefId =
    readNonEmptyString(scopedResource.voiceRefId) ??
    "qwen-voice-ref-teacher-kang-asset-voice-10s";

  return {
    executionMode: "contract",
    teacherId: scopedTeacherId,
    sampleAssetId,
    voiceRefId,
    deletionReason: "owner-request",
  };
}

function createUnsignedPptNarrationExportProbeRoute({ resource }) {
  const scopedResource = isRecord(resource) ? resource : {};
  const audioManifestId =
    readNonEmptyString(scopedResource.audioManifestId) ??
    "audio-manifest-research-methods-unit-3";
  return `/api/ai/ppt-narration/export/${encodeURIComponent(audioManifestId)}`;
}

function createUnsignedPptNarrationAudioProbeRoute({ resource }) {
  const scopedResource = isRecord(resource) ? resource : {};
  const audioManifestId =
    readNonEmptyString(scopedResource.audioManifestId) ??
    "audio-manifest-research-methods-unit-3";
  return `/api/ai/ppt-narration/audio/${encodeURIComponent(
    audioManifestId,
  )}/direct-call-smoke-audio`;
}

async function deriveTeacherAiSessionResourceFromOwnershipResponse(response, fallbackTeacherId) {
  const body = await response.json().catch(() => undefined);
  if (!isRecord(body) || !isRecord(body.ownership)) {
    return undefined;
  }
  return deriveTeacherAiSessionResourceFromOwnership(body.ownership, fallbackTeacherId);
}

function deriveTeacherAiSessionResourceFromOwnership(ownership, fallbackTeacherId) {
  const teacherId = readNonEmptyString(ownership.teacherId) ?? fallbackTeacherId;
  const completeChain = selectCompleteTeacherAiOwnershipChain(ownership);
  const sampleAsset = readFirstRecord(ownership.sampleAssets);
  const pptAsset = readFirstRecord(ownership.pptAssets);
  const voiceRef = readFirstRecord(ownership.clonedVoiceRefs);
  const audioManifest = readFirstRecord(ownership.audioManifests);
  const courseId =
    completeChain?.courseId ??
    readFirstString(ownership.courseIds) ??
    readNonEmptyString(sampleAsset?.courseId) ??
    readNonEmptyString(pptAsset?.courseId) ??
    readNonEmptyString(audioManifest?.courseId);
  return compactResource({
    teacherId,
    courseId,
    sampleAssetId:
      readNonEmptyString(completeChain?.sampleAsset?.sampleAssetId) ??
      readNonEmptyString(sampleAsset?.sampleAssetId),
    pptAssetId:
      readNonEmptyString(completeChain?.pptAsset?.pptAssetId) ??
      readNonEmptyString(completeChain?.audioManifest?.pptAssetId) ??
      readNonEmptyString(audioManifest?.pptAssetId) ?? readNonEmptyString(pptAsset?.pptAssetId),
    voiceRefId:
      readNonEmptyString(completeChain?.voiceRef?.voiceRefId) ??
      readNonEmptyString(completeChain?.audioManifest?.voiceRefId) ??
      readNonEmptyString(audioManifest?.voiceRefId) ?? readNonEmptyString(voiceRef?.voiceRefId),
    audioManifestId:
      readNonEmptyString(completeChain?.audioManifest?.audioManifestId) ??
      readNonEmptyString(audioManifest?.audioManifestId),
  });
}

function selectCompleteTeacherAiOwnershipChain(ownership) {
  const audioManifests = Array.isArray(ownership.audioManifests)
    ? ownership.audioManifests.filter(isRecord)
    : [];
  const pptAssets = Array.isArray(ownership.pptAssets)
    ? ownership.pptAssets.filter(isRecord)
    : [];
  const voiceRefs = Array.isArray(ownership.clonedVoiceRefs)
    ? ownership.clonedVoiceRefs.filter(isRecord)
    : [];
  const sampleAssets = Array.isArray(ownership.sampleAssets)
    ? ownership.sampleAssets.filter(isRecord)
    : [];

  for (const audioManifest of audioManifests) {
    const pptAsset = findCompleteChainPptAsset(pptAssets, audioManifest);
    const voiceRef = findCompleteChainVoiceRef(voiceRefs, audioManifest);
    const sampleAsset = voiceRef
      ? findCompleteChainSampleAsset(sampleAssets, voiceRef, audioManifest)
      : undefined;
    if (!pptAsset || !voiceRef || !sampleAsset) {
      continue;
    }
    const courseId =
      readNonEmptyString(audioManifest.courseId) ??
      readNonEmptyString(pptAsset.courseId) ??
      readNonEmptyString(sampleAsset.courseId);
    return {
      ...(courseId ? { courseId } : {}),
      sampleAsset,
      pptAsset,
      voiceRef,
      audioManifest,
    };
  }

  return undefined;
}

function findCompleteChainPptAsset(pptAssets, audioManifest) {
  const manifestPptAssetId = readNonEmptyString(audioManifest.pptAssetId);
  if (manifestPptAssetId) {
    return pptAssets.find((asset) => asset.pptAssetId === manifestPptAssetId);
  }
  const manifestCourseId = readNonEmptyString(audioManifest.courseId);
  return manifestCourseId
    ? pptAssets.find((asset) => asset.courseId === manifestCourseId)
    : undefined;
}

function findCompleteChainVoiceRef(voiceRefs, audioManifest) {
  const manifestVoiceRefId = readNonEmptyString(audioManifest.voiceRefId);
  return manifestVoiceRefId
    ? voiceRefs.find((reference) => reference.voiceRefId === manifestVoiceRefId)
    : undefined;
}

function findCompleteChainSampleAsset(sampleAssets, voiceRef, audioManifest) {
  const voiceRefSampleAssetId = readNonEmptyString(voiceRef.sampleAssetId);
  if (voiceRefSampleAssetId) {
    return sampleAssets.find((asset) => asset.sampleAssetId === voiceRefSampleAssetId);
  }
  const manifestCourseId = readNonEmptyString(audioManifest.courseId);
  return manifestCourseId
    ? sampleAssets.find((asset) => asset.courseId === manifestCourseId)
    : undefined;
}

async function validateRouteResponseShape(check, response) {
  if (check.id === "s22-teacher-auth-issuer-route") {
    return validateTeacherAuthIssuerResponseShape(response, check.responseShapeChecks);
  }
  if (check.id === "s22-teacher-ai-session-route") {
    return validateTeacherAiSessionResponseShape(response, check.responseShapeChecks);
  }
  if (check.id === "s22-teacher-ownership-route") {
    return validateTeacherOwnershipResponseShape(response, check.responseShapeChecks);
  }
  return validateTeacherPptWorkflowResponseShape(response, check.responseShapeChecks);
}

async function validateTeacherAuthIssuerResponseShape(response, responseShapeChecks) {
  if (!response.ok) {
    return createRouteResponseShape("skipped", {});
  }

  const body = await response.json().catch(() => undefined);
  if (!body || typeof body !== "object") {
    return createRouteResponseShape("failed", {});
  }

  const allFields = {
    teacherAuthSession: isRecord(body.teacherAuthSession) ? "present" : "missing",
    authProviderContract: isRecord(body.authProviderContract) ? "present" : "missing",
    s12TeacherAuthIssuerBoundary:
      Array.isArray(body.progress) &&
      body.progress.some(
        (progressItem) =>
          isRecord(progressItem) &&
          progressItem.type === "s12-trusted-teacher-auth-issuer" &&
          progressItem.responsibleSession === "S12",
      )
        ? "present"
        : "missing",
    signedContractDirectCallDenied: "missing",
  };
  const requiredFields = Object.fromEntries(
    responseShapeChecks.map((field) => [field, allFields[field] ?? "missing"]),
  );
  const status = Object.values(requiredFields).every((value) => value === "present")
    ? "ok"
    : "failed";
  return createRouteResponseShape(status, requiredFields);
}

async function validateTeacherAiSessionResponseShape(response, responseShapeChecks) {
  if (!response.ok) {
    return createRouteResponseShape("skipped", {});
  }

  const body = await response.json().catch(() => undefined);
  if (!body || typeof body !== "object") {
    return createRouteResponseShape("failed", {});
  }

  const allFields = {
    accessSession: isRecord(body.accessSession) ? "present" : "missing",
    accessPlan: isRecord(body.accessPlan) ? "present" : "missing",
    authProviderContract: isRecord(body.authProviderContract) ? "present" : "missing",
    s12TeacherAiSessionBoundary:
      Array.isArray(body.progress) &&
      body.progress.some(
        (progressItem) =>
          isRecord(progressItem) &&
          progressItem.type === "s12-teacher-ai-session-boundary" &&
          progressItem.responsibleSession === "S12",
      )
        ? "present"
        : "missing",
    signedContractDirectCallDenied: "missing",
  };
  const requiredFields = Object.fromEntries(
    responseShapeChecks.map((field) => [field, allFields[field] ?? "missing"]),
  );
  const status = Object.values(requiredFields).every((value) => value === "present")
    ? "ok"
    : "failed";
  return createRouteResponseShape(status, requiredFields);
}

async function validateTeacherOwnershipResponseShape(response, responseShapeChecks) {
  if (!response.ok) {
    return createRouteResponseShape("skipped", {});
  }

  const body = await response.json().catch(() => undefined);
  if (!body || typeof body !== "object") {
    return createRouteResponseShape("failed", {});
  }

  const allFields = {
    ownership: isRecord(body.ownership) ? "present" : "missing",
    consistency: isRecord(body.consistency) ? "present" : "missing",
    s12TeacherOwnershipSummary:
      Array.isArray(body.progress) &&
      body.progress.some(
        (progressItem) =>
          isRecord(progressItem) &&
          progressItem.type === "s12-teacher-ownership-auth-boundary" &&
          progressItem.responsibleSession === "S12",
      )
        ? "present"
        : "missing",
  };
  const requiredFields = Object.fromEntries(
    responseShapeChecks.map((field) => [field, allFields[field] ?? "missing"]),
  );
  const status = Object.values(requiredFields).every((value) => value === "present")
    ? "ok"
    : "failed";
  return createRouteResponseShape(status, requiredFields);
}

async function validateTeacherPptWorkflowResponseShape(response, responseShapeChecks) {
  if (!response.ok) {
    return createRouteResponseShape("skipped", {});
  }

  const body = await response.json().catch(() => undefined);
  if (!body || typeof body !== "object") {
    return createRouteResponseShape("failed", {});
  }

  const allFields = {
    workflow: isRecord(body.workflow) ? "present" : "missing",
    workflowReadyForDownloads:
      body.workflow?.status === "ready-for-downloads" &&
      body.workflow?.nextAction === "review-and-download-ppt-narration"
        ? "present"
        : "missing",
    workflowDownloadContract: isValidWorkflowDownloadContract(body.workflow?.downloads)
      ? "present"
      : "missing",
    workflowAudioDownloadPattern:
      isRecord(body.workflow?.downloads) &&
      typeof body.workflow.downloads.audioDownloadPattern === "string" &&
      /^\/api\/ai\/ppt-narration\/audio\/[A-Za-z0-9_-]+\/\{audioId\}$/.test(
        body.workflow.downloads.audioDownloadPattern,
      )
        ? "present"
        : "missing",
    workflowExportDownloadUrl:
      isRecord(body.workflow?.downloads) &&
      typeof body.workflow.downloads.exportDownloadUrl === "string" &&
      /^\/api\/ai\/ppt-narration\/export\/[A-Za-z0-9_-]+$/.test(
        body.workflow.downloads.exportDownloadUrl,
      )
        ? "present"
        : "missing",
    agentHandoffPlan: isRecord(body.agentHandoffPlan) ? "present" : "missing",
    agentHandoffPlanFramework:
      body.agentHandoffPlan?.framework === "openmaic-style-teacher-ppt-narration"
        ? "present"
        : "missing",
    s22ReleaseSmokeAgent:
      Array.isArray(body.agentHandoffPlan?.handoffs) &&
      body.agentHandoffPlan.handoffs.some(
        (handoff) =>
          isRecord(handoff) &&
          handoff.agentId === "s22-release-smoke-agent" &&
          handoff.responsibleSession === "S22",
      )
        ? "present"
        : "missing",
  };
  const requiredFields = Object.fromEntries(
    responseShapeChecks.map((field) => [field, allFields[field] ?? "missing"]),
  );
  const status = Object.values(requiredFields).every((value) => value === "present")
    ? "ok"
    : "failed";
  return createRouteResponseShape(status, requiredFields);
}

function isValidWorkflowDownloadContract(downloads) {
  if (!isRecord(downloads)) {
    return false;
  }
  if (
    typeof downloads.audioManifestId !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(downloads.audioManifestId)
  ) {
    return false;
  }
  return (
    downloads.exportDownloadUrl ===
      `/api/ai/ppt-narration/export/${downloads.audioManifestId}` &&
    downloads.audioDownloadPattern ===
      `/api/ai/ppt-narration/audio/${downloads.audioManifestId}/{audioId}`
  );
}

function createRouteResponseShape(status, requiredFields) {
  return {
    checked: true,
    status,
    requiredFields,
  };
}

function mergeRouteResponseShapeField(responseShape, field, value) {
  const requiredFields = { ...responseShape.requiredFields };
  if (!Object.prototype.hasOwnProperty.call(requiredFields, field)) {
    return responseShape;
  }

  requiredFields[field] = value;
  const status = Object.values(requiredFields).every((requiredValue) => requiredValue === "present")
    ? "ok"
    : "failed";
  return createRouteResponseShape(status, requiredFields);
}

function validateTeacherAuthIssueResponseHeaders(response, responseHeaderChecks) {
  if (!response.ok) {
    return createTeacherAuthIssueResponseHeaders("skipped", {});
  }

  const setCookieHeaders = readSetCookieHeaders(response.headers);
  const setCookieMaxAges = readSetCookieMaxAges(setCookieHeaders);
  const allHeaders = {
    teacherAuthClaimsSetCookie: setCookieHeaders.some((header) =>
      header.startsWith("uais_teacher_auth_claims="),
    )
      ? "present"
      : "missing",
    teacherAuthSignatureSetCookie: setCookieHeaders.some((header) =>
      header.startsWith("uais_teacher_auth_signature="),
    )
      ? "present"
      : "missing",
    httpOnlySameSiteSecureMaxAge:
      setCookieHeaders.length >= 2 &&
      setCookieHeaders.every(
        (header) =>
          /;\s*HttpOnly(?:;|$)/i.test(header) &&
          /;\s*SameSite=Lax(?:;|$)/i.test(header) &&
          /;\s*Max-Age=\d+(?:;|$)/i.test(header) &&
          /;\s*Secure(?:;|$)/i.test(header),
      )
        ? "present"
        : "missing",
    priorityHigh:
      setCookieHeaders.length >= 2 &&
      setCookieHeaders.every((header) => /;\s*Priority=High(?:;|$)/i.test(header))
        ? "present"
        : "missing",
    issuerProofBoundedMaxAge:
      setCookieHeaders.length >= 2 &&
      setCookieMaxAges.length === setCookieHeaders.length &&
      setCookieMaxAges.every((maxAge) => maxAge <= teacherAuthIssuerProofTtlSeconds)
        ? "present"
        : "missing",
  };
  const requiredHeaders = Object.fromEntries(
    responseHeaderChecks.map((field) => [field, allHeaders[field] ?? "missing"]),
  );
  const status = Object.values(requiredHeaders).every((value) => value === "present")
    ? "ok"
    : "failed";
  return createTeacherAuthIssueResponseHeaders(status, requiredHeaders);
}

function createTeacherAuthIssueResponseHeaders(status, requiredHeaders) {
  return {
    checked: true,
    status,
    requiredHeaders,
  };
}

function readSetCookieHeaders(headers) {
  const setCookies = headers.getSetCookie?.();
  if (setCookies?.length) {
    return setCookies;
  }

  const combined = headers.get("set-cookie");
  return combined
    ? combined.split(/,\s*(?=uais_teacher_auth_(?:claims|signature)=)/)
    : [];
}

function readSetCookieMaxAges(setCookieHeaders) {
  return setCookieHeaders.flatMap((header) => {
    const match = /;\s*Max-Age=(\d+)(?:;|$)/i.exec(header);
    return match ? [Number(match[1])] : [];
  });
}

function createTeacherCookieHeaderFromSetCookieHeaders(setCookieHeaders) {
  const cookiePairs = setCookieHeaders
    .map((header) => header.split(";")[0]?.trim())
    .filter(Boolean)
    .filter((cookiePair) =>
      cookiePair.startsWith("uais_teacher_auth_claims=") ||
      cookiePair.startsWith("uais_teacher_auth_signature="),
    );
  const hasClaims = cookiePairs.some((cookiePair) =>
    cookiePair.startsWith("uais_teacher_auth_claims="),
  );
  const hasSignature = cookiePairs.some((cookiePair) =>
    cookiePair.startsWith("uais_teacher_auth_signature="),
  );
  if (!hasClaims || !hasSignature) {
    throw new Error("Teacher auth issuer did not return both signed cookie headers.");
  }
  return cookiePairs.join("; ");
}

function createIssuedTeacherCookieHeaders(cookieHeader) {
  if (!hasValue(cookieHeader)) {
    throw new Error("Teacher workflow route smoke requires a cookie issued by the teacher auth route.");
  }
  return {
    cookie: cookieHeader,
  };
}

function createOidcBearerTokenHeaders(token) {
  if (!hasValue(token)) {
    throw new Error("OIDC route smoke requires UAIS_TEACHER_AUTH_OIDC_SMOKE_BEARER_TOKEN.");
  }
  return {
    authorization: `Bearer ${token}`,
  };
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFirstRecord(value) {
  return Array.isArray(value) && isRecord(value[0]) ? value[0] : undefined;
}

function readFirstString(value) {
  return Array.isArray(value) ? readNonEmptyString(value[0]) : undefined;
}

function readNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function compactResource(resource) {
  return Object.fromEntries(
    Object.entries(resource).filter(([, value]) => typeof value === "string" && value.trim()),
  );
}

function createSignedAdminHeaders({ actorId, secret }) {
  const issuedAt = new Date();
  const claims = {
    actor: {
      actorId,
      role: "admin",
    },
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + 300_000).toISOString(),
  };
  const claimsHeader = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signatureHeader = createHmac("sha256", secret).update(claimsHeader).digest("base64url");
  return {
    "x-uais-access-claims": claimsHeader,
    "x-uais-access-signature": signatureHeader,
  };
}

function createTrustedTeacherAuthIssuerHeaders({ teacherId, secret }) {
  const issuedAt = new Date();
  const claims = {
    issuerId: "trusted-cookie-issuer",
    teacherId,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(
      issuedAt.getTime() + teacherAuthIssuerProofTtlSeconds * 1000,
    ).toISOString(),
  };
  const claimsHeader = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signatureHeader = createHmac("sha256", secret).update(claimsHeader).digest("base64url");
  return {
    "x-uais-teacher-auth-issuer-claims": claimsHeader,
    "x-uais-teacher-auth-issuer-signature": signatureHeader,
  };
}

function assertLivePrerequisites({ baseUrl, env }) {
  const authProviderMode = normalizeTeacherAuthProvider(env.UAIS_TEACHER_AUTH_PROVIDER);
  if (!hasValue(baseUrl)) {
    throw new Error("Protected route smoke requires UAIS_DEPLOYMENT_BASE_URL or --base-url.");
  }
  if (!hasValue(env.UAIS_AI_ACCESS_SIGNING_SECRET)) {
    throw new Error("Protected route smoke requires UAIS_AI_ACCESS_SIGNING_SECRET.");
  }
  if (!isSupportedTeacherAuthProvider(authProviderMode)) {
    throw new Error(
      `Protected route smoke requires UAIS_TEACHER_AUTH_PROVIDER to be one of ${supportedTeacherAuthProviders.join(", ")}.`,
    );
  }
  if (!hasValue(env.UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET)) {
    throw new Error("Protected route smoke requires UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET.");
  }
  // Keyed on the SELECTED provider. Demanding the trusted issuer secret of a
  // database-account-cookie deployment asked it for a secret that selector does
  // not read and no service anywhere holds.
  for (const envName of readTeacherAuthProviderRequiredSmokeEnvNames(authProviderMode)) {
    if (!hasValue(env[envName])) {
      throw new Error(
        `Protected ${authProviderMode} route smoke requires ${envName}.`,
      );
    }
  }
}

function normalizeTeacherAuthProvider(value) {
  return value?.trim().toLowerCase() || "missing";
}

function isSupportedTeacherAuthProvider(value) {
  return supportedTeacherAuthProviders.includes(value);
}

function readTeacherAuthProviderRequiredSmokeEnvNames(authProviderMode) {
  return teacherAuthProviderRequiredSmokeEnvNames[authProviderMode] ?? [];
}

function teacherAuthProviderBlockedReason(value) {
  return hasValue(value)
    ? "non-production-UAIS_TEACHER_AUTH_PROVIDER"
    : "missing-UAIS_TEACHER_AUTH_PROVIDER";
}

function readRouteSmokeTeacherId({ env, authProviderMode }) {
  const teacherId = env.UAIS_TEACHER_AUTH_ROUTE_SMOKE_TEACHER_ID?.trim();
  if (teacherId) {
    return teacherId;
  }
  if (authProviderMode === "oidc-jwks") {
    const oidcTeacherId = env.UAIS_TEACHER_AUTH_OIDC_SMOKE_TEACHER_ID?.trim();
    if (oidcTeacherId) {
      return oidcTeacherId;
    }
  }

  return authProviderMode === "trusted-cookie-issuer"
    ? "teacher-kang"
    : "s22-route-smoke-teacher";
}

function parseArgs(args) {
  const options = {
    live: false,
    approved: false,
    environment: "unspecified",
    envFile: undefined,
    baseUrl: undefined,
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
    } else if (arg === "--teacher-auth-issuer-only") {
      options.teacherAuthIssuerOnly = true;
    } else if (arg === "--env-file") {
      options.envFile = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--base-url") {
      options.baseUrl = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--release-run-id") {
      options.releaseRunId = normalizeReleaseRunId(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === "--vercel-production-deployment") {
      options.vercelProductionDeployment = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--deployment-domain-reachability") {
      options.deploymentDomainReachability = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--teacher-auth-provider-readiness") {
      options.teacherAuthProviderReadiness = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node -- scripts/ai-route-smoke.mjs [--dry-run] [--live --approved --base-url URL] [--environment production|preview|local-production|unspecified] [--env-file PATH] [--release-run-id ID] [--vercel-production-deployment PATH] [--deployment-domain-reachability PATH] [--teacher-auth-provider-readiness PATH]",
          "       add [--teacher-auth-issuer-only] to prove only the deployed teacher-auth issuer route before provider readiness.",
          "",
          "Outputs redacted signed-admin route smoke JSON. Dry-run never uses network; live mode never prints secrets or response bodies.",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
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

function readArgValue(args, index, name) {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function normalizeReleaseRunId(value) {
  const releaseRunId = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(releaseRunId)) {
    throw new Error("--release-run-id must be a non-secret release identifier.");
  }
  return releaseRunId;
}

function readEnvFile(envFile) {
  if (!envFile) {
    return {};
  }

  const parsed = {};
  const content = readFileSync(envFile, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (key) {
      parsed[key] = stripQuotes(value);
    }
  }

  return parsed;
}

function readJsonEvidence(evidencePath) {
  if (!evidencePath) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(evidencePath, "utf8"));
  } catch {
    return null;
  }
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function stripTrailingSlash(value) {
  return value.replace(/\/$/, "");
}

function hasValue(value) {
  return typeof value === "string" && value.trim() !== "";
}

function classifyNetworkError(error) {
  const errorClass =
    error instanceof Error && hasValue(error.name) ? error.name : "UnknownError";
  return {
    class: sanitizeErrorClass(errorClass),
    valueRedacted: true,
  };
}

function sanitizeErrorClass(value) {
  const normalized = value.trim().replace(/[^A-Za-z0-9_.:-]/g, "-");
  return normalized === "" ? "UnknownError" : normalized.slice(0, 80);
}

function describeDeploymentOrigin(baseUrl) {
  const originClass = classifyDeploymentOrigin(baseUrl);
  return {
    status: originClass === "missing" ? "missing" : "present",
    originClass,
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

function describeOidcEndpointSecurity({ issuer, jwks }) {
  return {
    issuer: classifyEndpointSecurity(issuer),
    jwks: classifyEndpointSecurity(jwks),
    valueRedacted: true,
  };
}

function classifyEndpointSecurity(value) {
  if (!hasValue(value)) {
    return "missing";
  }

  try {
    const endpoint = new URL(value);
    const hostClass = classifyOriginHost(endpoint.hostname);
    if (hostClass !== "remote") {
      return hostClass;
    }
    return endpoint.protocol === "https:" ? "remote-https" : "insecure-http";
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

function createDeploymentFingerprint(baseUrl) {
  if (!hasValue(baseUrl)) {
    return { status: "missing" };
  }

  try {
    const origin = new URL(baseUrl).origin.toLowerCase();
    return {
      status: "present",
      value: `sha256:${createHash("sha256").update(origin).digest("hex").slice(0, 16)}`,
    };
  } catch {
    return { status: "missing" };
  }
}
