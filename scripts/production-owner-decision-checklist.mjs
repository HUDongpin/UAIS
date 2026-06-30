#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const LOCAL_PRODUCTION_DIAGNOSTIC_CONTRACT = readLocalProductionDiagnosticContract();
const LOCAL_PRODUCTION_REQUIRED_CHECKS = LOCAL_PRODUCTION_DIAGNOSTIC_CONTRACT.requiredChecks;
const LOCAL_PRODUCTION_BROWSER_CHECK_IDS =
  LOCAL_PRODUCTION_DIAGNOSTIC_CONTRACT.browserCheckIds;
const LOCAL_PRODUCTION_REQUIRED_BROWSER_RESULTS =
  LOCAL_PRODUCTION_DIAGNOSTIC_CONTRACT.requiredBrowserResults;
const LOCAL_PRODUCTION_REQUIREMENT_SOURCE =
  LOCAL_PRODUCTION_DIAGNOSTIC_CONTRACT.requirementSource;

try {
  const options = parseArgs(process.argv.slice(2));
  const evidence = {
    releaseGate: readOptionalJson(options.releaseGate),
    vercelProjectReadiness: readOptionalJson(options.vercelProjectReadiness),
    alternateVercelProjectReadiness: readOptionalJson(options.alternateVercelProjectReadiness),
    localProductionE2e: readOptionalJson(options.localProductionE2e),
    externalStorageContainerBuildReadiness: readOptionalJson(
      options.externalStorageContainerBuildReadiness,
    ),
    trustedTeacherAuthRouteChain: readOptionalJson(options.trustedTeacherAuthRouteChain),
  };
  const decisions = buildDecisions(evidence);
  const openDecisions = decisions.filter((decision) => decision.status !== "satisfied");

  process.stdout.write(
    `${JSON.stringify(
      {
        target: "production-owner-decision-checklist",
        status: openDecisions.length > 0 ? "owner-decisions-required" : "ready-for-live-proof",
        responsibleSession: "S22",
        releaseGateStatus: readStatus(evidence.releaseGate),
        localProductionDiagnostic: summarizeLocalProductionDiagnostic(evidence.localProductionE2e),
        releaseGateBlockedRequirements: summarizeReleaseGateBlockedRequirements(
          evidence.releaseGate,
        ),
        releaseGateWaitingRequirements: summarizeReleaseGateWaitingRequirements(
          evidence.releaseGate,
        ),
        decisions,
        safety: {
          valuesRedacted: true,
          evidencePathsOmitted: true,
          projectNamesOmitted: true,
          projectIdsOmitted: true,
          deploymentUrlsOmitted: true,
          localPrivatePathsOmitted: true,
          tokensOmitted: true,
        },
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Production owner decision checklist failed."}\n`,
  );
  process.exitCode = 1;
}

function buildDecisions(evidence) {
  const blockedReasons = new Set(readBlockedReasons(evidence.releaseGate));
  const decisions = [
    buildVercelProjectDecision({
      vercelProjectReadiness: evidence.vercelProjectReadiness,
      alternateVercelProjectReadiness: evidence.alternateVercelProjectReadiness,
      blockedReasons,
    }),
    buildAppAuthProviderDecision(blockedReasons, evidence.releaseGate),
    buildTeacherAuthProviderDecision({
      blockedReasons,
      releaseGate: evidence.releaseGate,
      trustedTeacherAuthRouteChain: evidence.trustedTeacherAuthRouteChain,
    }),
    buildExternalStorageDecision(
      blockedReasons,
      evidence.externalStorageContainerBuildReadiness,
      evidence.releaseGate,
    ),
    buildVercelEnvAndDeploymentDecision(blockedReasons),
    buildOrdinaryTeachingProductionEvidenceDecision(blockedReasons),
    buildEnterpriseLiveEvidenceAuditDecision(blockedReasons, evidence.releaseGate),
    buildManualPptDecision(blockedReasons),
    buildProductionReleaseRunDecision(blockedReasons),
  ];
  return decisions.filter(Boolean);
}

function buildVercelProjectDecision({
  vercelProjectReadiness,
  alternateVercelProjectReadiness,
  blockedReasons,
}) {
  const readinessSummary = summarizeVercelProjectReadiness(
    vercelProjectReadiness,
    alternateVercelProjectReadiness,
  );
  const readinessBlockedReasons = new Set([
    ...readBlockedReasons(vercelProjectReadiness),
    ...readBlockedReasons(alternateVercelProjectReadiness),
  ]);
  const status =
    readinessSummary.teamScope === "present" &&
    readinessSummary.projectCandidate === "present" &&
    readinessSummary.projectLink === "present"
      ? "satisfied"
      : "owner-decision-needed";
  const projectBlockedReasons = filterResolvedVercelProjectReasons(
    mergeReasons([
      ...filterReasons(blockedReasons, [
        "vercel-project-candidate-missing",
        "vercel-project-not-linked",
        "vercel-project-candidate-ambiguous",
        "vercel-team-scope-missing",
        "vercel-team-scope-ambiguous",
        "vercel-cli-missing",
        "vercel-auth-missing",
        "vercel-project-readiness-evidence-missing",
        "vercel-project-readiness-evidence-target-mismatch",
        "vercel-project-readiness-not-ready",
        "vercel-project-readiness-redaction-not-proven",
        "vercelignore-upload-hygiene-incomplete",
      ]),
      ...filterReasons(readinessBlockedReasons, [
        "vercel-project-candidate-missing",
        "vercel-project-not-linked",
        "vercel-project-candidate-ambiguous",
        "vercel-team-scope-missing",
        "vercel-team-scope-ambiguous",
        "vercel-cli-missing",
        "vercel-auth-missing",
        "vercel-project-readiness-evidence-missing",
        "vercel-project-readiness-evidence-target-mismatch",
        "vercel-project-readiness-not-ready",
        "vercel-project-readiness-redaction-not-proven",
        "vercelignore-upload-hygiene-incomplete",
      ]),
    ]),
    readinessSummary,
  );

  return {
    id: "vercel-project-selection",
    status,
    responsibleSessions: ["Owner", "S22"],
    blockedReasons: projectBlockedReasons,
    readinessSummary,
    ownerDecisionNeeded:
      status === "satisfied"
        ? "none"
        : "confirm-or-create-intended-vercel-project-and-approve-link",
    safeNextActions:
      status === "satisfied"
        ? ["continue-to-vercel-env-apply-readiness"]
        : [
            ...(readinessSummary.teamScope === "present"
              ? []
              : ["select-or-confirm-current-vercel-team-scope"]),
            "rerun-redacted-project-readiness-with-approved-project-name-or-project-id",
            "after-owner-approval-run-vercel-link",
            "rerun-project-readiness-before-env-apply",
          ],
    forbiddenUntilApproved:
      status === "satisfied"
        ? ["vercel-env-apply", "vercel-production-deploy"]
        : ["vercel-link", "vercel-env-apply", "vercel-production-deploy"],
  };
}

function filterResolvedVercelProjectReasons(reasons, readinessSummary) {
  return reasons.filter((reason) => {
    if (
      readinessSummary.teamScope === "present" &&
      (reason === "vercel-team-scope-missing" || reason === "vercel-team-scope-ambiguous")
    ) {
      return false;
    }
    if (
      readinessSummary.projectCandidate === "present" &&
      (reason === "vercel-project-candidate-missing" ||
        reason === "vercel-project-candidate-ambiguous")
    ) {
      return false;
    }
    if (readinessSummary.projectLink === "present" && reason === "vercel-project-not-linked") {
      return false;
    }
    if (readinessSummary.cli === "present" && reason === "vercel-cli-missing") {
      return false;
    }
    if (readinessSummary.auth === "present" && reason === "vercel-auth-missing") {
      return false;
    }
    if (
      readinessSummary.uploadHygiene === "present" &&
      reason === "vercelignore-upload-hygiene-incomplete"
    ) {
      return false;
    }
    return true;
  });
}

function buildAppAuthProviderDecision(blockedReasons, releaseGate) {
  const reasons = filterReasons(blockedReasons, [
    "app-auth-provider-readiness-not-live-ready",
    "app-auth-provider-readiness-not-production",
    "app-auth-provider-readiness-missing",
    "app-auth-provider-readiness-target-mismatch",
    "app-auth-provider-selector-not-proven",
    "app-auth-provider-endpoint-not-remote-https",
    "app-auth-session-cookie-contract-not-proven",
    "app-auth-session-cookie-pair-contract-not-proven",
    "app-auth-provider-vercel-env-sync-not-proven",
    "app-auth-provider-vercel-env-sync-release-run-not-proven",
    "app-auth-provider-specific-readiness-not-proven",
    "app-auth-provider-readiness-redaction-not-proven",
    "teaching-operations-route-smoke-app-auth-readiness-release-run-not-proven",
    "teaching-operations-route-smoke-app-auth-readiness-binding-not-proven",
    "teaching-operation-detail-browser-smoke-app-auth-readiness-release-run-not-proven",
    "teaching-operation-detail-browser-smoke-app-auth-readiness-binding-not-proven",
    "teaching-course-management-route-smoke-app-auth-readiness-release-run-not-proven",
    "teaching-course-management-route-smoke-app-auth-readiness-binding-not-proven",
  ]);
  if (reasons.length === 0) {
    return null;
  }

  return {
    id: "app-auth-provider-production-selector",
    status: "owner-decision-needed",
    responsibleSessions: ["Owner", "S12", "S19", "S22"],
    blockedReasons: reasons,
    appAuthProviderReadinessSummary:
      summarizeAppAuthProviderReadiness(releaseGate),
    acceptedOptions: ["trusted-account-provider"],
    ownerDecisionNeeded:
      "choose-production-app-auth-provider-and-approved-server-only-env-source",
    safeNextActions: [
      "confirm-production-app-auth-provider-mode",
      "bind-server-only-app-auth-env-through-s19-vercel-env-sync",
      "run-approved-app-auth-provider-readiness-after-env-sync",
      "run-ordinary-teaching-smokes-only-after-app-auth-readiness-is-live-ready",
    ],
    forbiddenUntilApproved: [
      "inspect-or-print-app-auth-credential-values",
      "run-live-app-auth-provider-network-call",
      "run-production-smokes-dependent-on-app-auth",
    ],
    proofNeeded: [
      "app-auth-provider-readiness-live-production-ready",
      "trusted-account-provider-remote-https-endpoint",
      "app-session-signing-secret-strength",
      "app-session-cookie-pair-contract",
      "trusted-account-provider-token-strength",
      "trusted-account-provider-response-user-shape",
      "vercel-env-sync-app-auth-selector-and-env-binding",
      "same-release-run-id-bound-to-app-auth-readiness",
      "ordinary-teaching-app-auth-readiness-binding",
      "app-auth-provider-redaction-safety",
    ],
  };
}

function summarizeAppAuthProviderReadiness(releaseGate) {
  const requirement = readRequirementById(releaseGate, "app-auth-provider-readiness");
  const appSessionCookieContract = isRecord(requirement.appSessionCookieContract)
    ? requirement.appSessionCookieContract
    : {};
  const trustedAccountProviderContract = isRecord(
    requirement.trustedAccountProviderContract,
  )
    ? requirement.trustedAccountProviderContract
    : {};
  const vercelEnvSyncEvidence = isRecord(requirement.vercelEnvSyncEvidence)
    ? requirement.vercelEnvSyncEvidence
    : {};
  const redactionSafety = isRecord(requirement.redactionSafety)
    ? requirement.redactionSafety
    : {};

  return {
    evidenceStatus: readKnownString(requirement.evidenceStatus, [
      "live-ready",
      "dry-run-ready",
      "dry-run-blocked",
      "ready",
      "blocked",
      "missing",
    ]),
    blockedReason: readKnownString(requirement.blockedReason, [
      "app-auth-provider-readiness-missing",
      "app-auth-provider-readiness-target-mismatch",
      "app-auth-provider-readiness-not-production",
      "app-auth-provider-selector-not-proven",
      "app-auth-provider-endpoint-not-remote-https",
      "app-auth-session-cookie-contract-not-proven",
      "app-auth-session-cookie-pair-contract-not-proven",
      "app-auth-provider-vercel-env-sync-release-run-not-proven",
      "app-auth-provider-vercel-env-sync-not-proven",
      "app-auth-provider-specific-readiness-not-proven",
      "app-auth-provider-readiness-redaction-not-proven",
      "app-auth-provider-readiness-not-live-ready",
      "missing",
    ]),
    evidenceEnvironment: readKnownString(requirement.evidenceEnvironment, [
      "production",
      "preview",
      "local-production",
      "missing",
    ]),
    appAuthProviderMode: readKnownString(requirement.appAuthProviderMode, [
      "trusted-account-provider",
      "local-demo",
      "unsupported",
      "missing",
    ]),
    endpointSecurity: readKnownString(requirement.endpointSecurity, [
      "remote-https",
      "insecure-http",
      "private-network",
      "local-loopback",
      "invalid",
      "missing",
    ]),
    appSessionCookieContract: {
      signingSecretStrength: readKnownString(
        appSessionCookieContract.signingSecretStrength,
        ["sufficient", "weak", "missing"],
      ),
      cookiePair: readKnownString(appSessionCookieContract.cookiePair, [
        "proved",
        "missing",
      ]),
      valueRedacted: appSessionCookieContract.valueRedacted === true,
    },
    trustedAccountProviderContract: {
      providerKind: readKnownString(trustedAccountProviderContract.providerKind, [
        "trusted-account-provider",
        "missing",
      ]),
      endpoint: readKnownString(trustedAccountProviderContract.endpoint, [
        "configured",
        "missing",
      ]),
      bearerCredential: readKnownString(
        trustedAccountProviderContract.bearerCredential,
        ["configured", "missing"],
      ),
      accessTokenStrength: readKnownString(
        trustedAccountProviderContract.accessTokenStrength,
        ["sufficient", "weak", "missing"],
      ),
      responseUserShape: readKnownString(
        trustedAccountProviderContract.responseUserShape,
        ["proved", "missing"],
      ),
      valueRedacted: trustedAccountProviderContract.valueRedacted === true,
    },
    vercelEnvSyncEvidence: {
      status: readKnownString(vercelEnvSyncEvidence.status, [
        "matched",
        "not-applied",
        "apply-preflight-missing",
        "release-run-id-mismatch",
        "app-auth-provider-selector-mismatch",
        "app-auth-env-missing",
        "missing",
      ]),
      applyPreflight: readKnownString(vercelEnvSyncEvidence.applyPreflight, [
        "proved",
        "missing",
      ]),
      releaseRunIdStatus: readKnownString(
        vercelEnvSyncEvidence.releaseRunIdStatus,
        ["matched", "mismatched", "missing"],
      ),
      requiredAppAuthEnvStatus: readKnownString(
        vercelEnvSyncEvidence.requiredAppAuthEnvStatus,
        ["present", "missing"],
      ),
      valueRedacted: vercelEnvSyncEvidence.valueRedacted === true,
    },
    redactionSafety: {
      valuesRedacted: readKnownString(redactionSafety.valuesRedacted, [
        "proved",
        "missing",
      ]),
      secretsOmitted: readKnownString(redactionSafety.secretsOmitted, [
        "proved",
        "missing",
      ]),
      providerUrlsOmitted: readKnownString(
        redactionSafety.providerUrlsOmitted,
        ["proved", "missing"],
      ),
      responseBodiesOmitted: readKnownString(
        redactionSafety.responseBodiesOmitted,
        ["proved", "missing"],
      ),
      localPrivatePathsOmitted: readKnownString(
        redactionSafety.localPrivatePathsOmitted,
        ["proved", "missing"],
      ),
      liveRequiresApproval: readKnownString(
        redactionSafety.liveRequiresApproval,
        ["proved", "missing"],
      ),
      cookieValuesOmitted: readKnownString(redactionSafety.cookieValuesOmitted, [
        "proved",
        "missing",
      ]),
      providerNetworkCallPerformed: readKnownString(
        redactionSafety.providerNetworkCallPerformed,
        ["proved-not-performed", "missing"],
      ),
    },
  };
}

function buildTeacherAuthProviderDecision({
  blockedReasons,
  releaseGate,
  trustedTeacherAuthRouteChain,
}) {
  const reasons = filterReasons(blockedReasons, [
    "teacher-auth-provider-readiness-not-live-ready",
    "teacher-auth-provider-readiness-not-production",
    "teacher-auth-provider-readiness-missing",
    "teacher-auth-provider-readiness-target-mismatch",
    "teacher-auth-provider-selector-mismatch",
    "teacher-auth-provider-selector-not-proven",
    "teacher-auth-session-cookie-contract-not-proven",
    "teacher-auth-session-cookie-pair-contract-not-proven",
    "teacher-auth-session-issuer-secret-separation-not-proven",
    "teacher-auth-session-cookie-round-trip-not-proven",
    "teacher-auth-oidc-jwks-signing-key-not-proven",
    "teacher-auth-provider-vercel-env-sync-not-proven",
    "teacher-auth-provider-vercel-env-sync-release-run-not-proven",
    "teacher-auth-provider-specific-readiness-not-proven",
    "teacher-auth-provider-trusted-route-chain-not-proven",
    "teacher-auth-provider-issuer-route-smoke-not-proven",
    "teacher-auth-provider-readiness-redaction-not-proven",
    "trusted-teacher-auth-route-chain-contract-not-proven",
    "trusted-teacher-auth-route-chain-missing",
    "trusted-teacher-auth-route-chain-not-proved",
    "trusted-teacher-auth-route-chain-redaction-not-proven",
    "trusted-teacher-auth-route-chain-target-mismatch",
    "deployment-route-smoke-teacher-auth-readiness-binding-not-proven",
    "teaching-operations-route-smoke-teacher-auth-readiness-release-run-not-proven",
    "teaching-operations-route-smoke-teacher-auth-readiness-binding-not-proven",
    "teaching-operations-route-smoke-auth-not-issued-teacher-cookie",
    "teaching-operation-detail-browser-smoke-teacher-auth-readiness-release-run-not-proven",
    "teaching-operation-detail-browser-smoke-teacher-auth-readiness-binding-not-proven",
    "teaching-operation-detail-browser-smoke-auth-not-issued-teacher-cookie",
    "teaching-course-management-route-smoke-teacher-auth-readiness-release-run-not-proven",
    "teaching-course-management-route-smoke-teacher-auth-readiness-binding-not-proven",
    "teaching-course-management-route-smoke-auth-not-issued-teacher-cookie",
  ]);
  return {
    id: "teacher-auth-provider-production-selector",
    status: reasons.length > 0 ? "owner-decision-needed" : "waiting-for-live-evidence",
    responsibleSessions: ["Owner", "S12", "S19", "S22"],
    blockedReasons: reasons,
    teacherAuthProviderReadinessSummary:
      summarizeTeacherAuthProviderReadiness(releaseGate),
    ...(isRecord(trustedTeacherAuthRouteChain)
      ? {
          trustedRouteChainSummary:
            summarizeTrustedTeacherAuthRouteChain(trustedTeacherAuthRouteChain),
        }
      : {}),
    acceptedOptions: ["trusted-cookie-issuer", "oidc-jwks"],
    ownerDecisionNeeded:
      "choose-production-teacher-auth-provider-and-approved-server-only-env-source",
    safeNextActions: [
      "confirm-production-teacher-auth-provider-mode",
      "bind-server-only-teacher-auth-env-through-s19-vercel-env-sync",
      "run-approved-teacher-auth-provider-readiness-after-env-sync",
      "run-deployed-teacher-auth-issuer-route-smoke-after-production-deploy",
      "run-production-smokes-only-after-teacher-auth-readiness-is-live-ready",
    ],
    forbiddenUntilApproved: [
      "inspect-or-print-teacher-auth-credential-values",
      "issue-live-teacher-auth-cookie",
      "run-live-teacher-auth-provider-network-call",
      "run-production-smokes-dependent-on-teacher-auth",
    ],
    proofNeeded: [
      "teacher-auth-provider-readiness-live-production-ready",
      "production-session-cookie-pair-contract",
      "trusted-cookie-session-issuer-separation-if-selected",
      "trusted-cookie-session-round-trip-proof-if-selected",
      "trusted-cookie-route-chain-binding-proof-if-selected",
      "deployed-teacher-auth-issuer-route-smoke-proof",
      "oidc-jwks-signing-key-readiness-if-oidc-selected",
      "vercel-env-sync-selector-matches-readiness",
      "route-smoke-selector-matches-readiness",
      "teacher-auth-provider-specific-readiness-proof",
      "teacher-auth-provider-redaction-safety",
    ],
  };
}

function summarizeTeacherAuthProviderReadiness(releaseGate) {
  const requirement = readRequirementById(releaseGate, "teacher-auth-provider-readiness");
  const sessionCookieContract = isRecord(requirement.sessionCookieContract)
    ? requirement.sessionCookieContract
    : {};
  const vercelEnvSyncEvidence = isRecord(requirement.vercelEnvSyncEvidence)
    ? requirement.vercelEnvSyncEvidence
    : {};
  const trustedIssuerContract = isRecord(requirement.trustedIssuerContract)
    ? requirement.trustedIssuerContract
    : {};
  const trustedCookieSessionRoundTrip = isRecord(
    requirement.trustedCookieSessionRoundTrip,
  )
    ? requirement.trustedCookieSessionRoundTrip
    : {};
  const trustedTeacherAuthRouteChainEvidence = isRecord(
    requirement.trustedTeacherAuthRouteChainEvidence,
  )
    ? requirement.trustedTeacherAuthRouteChainEvidence
    : {};
  const trustedTeacherAuthRouteSmokeEvidence = isRecord(
    requirement.trustedTeacherAuthRouteSmokeEvidence,
  )
    ? requirement.trustedTeacherAuthRouteSmokeEvidence
    : {};
  const redactionSafety = isRecord(requirement.redactionSafety)
    ? requirement.redactionSafety
    : {};

  return {
    evidenceStatus: readKnownString(requirement.evidenceStatus, [
      "live-ready",
      "dry-run-ready",
      "dry-run-blocked",
      "ready",
      "blocked",
      "missing",
    ]),
    blockedReason: readKnownString(requirement.blockedReason, [
      "teacher-auth-provider-readiness-missing",
      "teacher-auth-provider-readiness-target-mismatch",
      "teacher-auth-provider-readiness-not-production",
      "teacher-auth-provider-selector-not-proven",
      "teacher-auth-session-cookie-contract-not-proven",
      "teacher-auth-session-cookie-pair-contract-not-proven",
      "teacher-auth-session-issuer-secret-separation-not-proven",
      "teacher-auth-session-cookie-round-trip-not-proven",
      "teacher-auth-oidc-jwks-signing-key-not-proven",
      "teacher-auth-provider-vercel-env-sync-release-run-not-proven",
      "teacher-auth-provider-vercel-env-sync-not-proven",
      "teacher-auth-provider-specific-readiness-not-proven",
      "teacher-auth-provider-trusted-route-chain-not-proven",
      "teacher-auth-provider-issuer-route-smoke-not-proven",
      "teacher-auth-provider-readiness-redaction-not-proven",
      "teacher-auth-provider-readiness-not-live-ready",
      "missing",
    ]),
    evidenceEnvironment: readKnownString(requirement.evidenceEnvironment, [
      "production",
      "preview",
      "local-production",
      "missing",
    ]),
    authProviderMode: readKnownString(requirement.authProviderMode, [
      "trusted-cookie-issuer",
      "oidc-jwks",
      "missing",
    ]),
    sessionCookieContract: {
      signingSecretStrength: readKnownString(
        sessionCookieContract.signingSecretStrength,
        ["sufficient", "weak", "missing"],
      ),
      cookiePair: readKnownString(sessionCookieContract.cookiePair, [
        "proved",
        "missing",
      ]),
      valueRedacted: sessionCookieContract.valueRedacted === true,
    },
    vercelEnvSyncEvidence: {
      status: readKnownString(vercelEnvSyncEvidence.status, [
        "matched",
        "not-applied",
        "apply-preflight-missing",
        "release-run-id-mismatch",
        "mismatched",
        "missing",
      ]),
      applyPreflight: readKnownString(vercelEnvSyncEvidence.applyPreflight, [
        "proved",
        "missing",
      ]),
      releaseRunIdStatus: readKnownString(
        vercelEnvSyncEvidence.releaseRunIdStatus,
        ["matched", "mismatched", "missing"],
      ),
      valueRedacted: vercelEnvSyncEvidence.valueRedacted === true,
    },
    trustedIssuerContract: {
      issuerSecretStrength: readKnownString(
        trustedIssuerContract.issuerSecretStrength,
        ["sufficient", "weak", "missing"],
      ),
      sessionIssuerSecretSeparation: readKnownString(
        trustedIssuerContract.sessionIssuerSecretSeparation,
        ["proved", "missing"],
      ),
      issuerProofRequired: trustedIssuerContract.issuerProofRequired === true,
      issuerProofBoundsCookieMaxAge:
        trustedIssuerContract.issuerProofBoundsCookieMaxAge === true,
      valueRedacted: trustedIssuerContract.valueRedacted === true,
    },
    trustedCookieSessionRoundTrip: {
      status: readKnownString(trustedCookieSessionRoundTrip.status, [
        "proved",
        "blocked",
        "missing",
      ]),
      signatureVerification: readKnownString(
        trustedCookieSessionRoundTrip.signatureVerification,
        ["passed", "failed", "missing"],
      ),
      expiryCheck: readKnownString(trustedCookieSessionRoundTrip.expiryCheck, [
        "passed",
        "failed",
        "missing",
      ]),
      tamperCheck: readKnownString(trustedCookieSessionRoundTrip.tamperCheck, [
        "passed",
        "failed",
        "missing",
      ]),
      sessionIdRedacted: trustedCookieSessionRoundTrip.sessionIdRedacted === true,
      cookieValuesEmitted:
        trustedCookieSessionRoundTrip.cookieValuesEmitted === true,
      valuesRedacted: trustedCookieSessionRoundTrip.valuesRedacted === true,
    },
    trustedTeacherAuthRouteChainEvidence: {
      status: readKnownString(trustedTeacherAuthRouteChainEvidence.status, [
        "proved",
        "not-proven",
        "missing",
      ]),
      routeChain: readKnownString(trustedTeacherAuthRouteChainEvidence.routeChain, [
        "proved",
        "missing",
      ]),
      issuerProofValidation: readKnownString(
        trustedTeacherAuthRouteChainEvidence.issuerProofValidation,
        ["proved", "missing"],
      ),
      redactionSafety: readKnownString(
        trustedTeacherAuthRouteChainEvidence.redactionSafety,
        ["proved", "missing"],
      ),
      valueRedacted: trustedTeacherAuthRouteChainEvidence.valueRedacted === true,
    },
    trustedTeacherAuthRouteSmokeEvidence: {
      status: readKnownString(trustedTeacherAuthRouteSmokeEvidence.status, [
        "proved",
        "not-proven",
        "missing",
      ]),
      releaseRunIdStatus: readKnownString(
        trustedTeacherAuthRouteSmokeEvidence.releaseRunIdStatus,
        ["matched", "mismatched", "missing"],
      ),
      deploymentBinding: readKnownString(
        trustedTeacherAuthRouteSmokeEvidence.deploymentBinding,
        ["proved", "missing"],
      ),
      teacherAuthIssuerRoute: readKnownString(
        trustedTeacherAuthRouteSmokeEvidence.teacherAuthIssuerRoute,
        ["proved", "missing"],
      ),
      responseHeaders: readKnownString(
        trustedTeacherAuthRouteSmokeEvidence.responseHeaders,
        ["proved", "missing"],
      ),
      responseShape: readKnownString(
        trustedTeacherAuthRouteSmokeEvidence.responseShape,
        ["proved", "missing"],
      ),
      valueRedacted: trustedTeacherAuthRouteSmokeEvidence.valueRedacted === true,
    },
    redactionSafety: {
      valuesRedacted: readKnownString(redactionSafety.valuesRedacted, [
        "proved",
        "missing",
      ]),
      secretsOmitted: readKnownString(redactionSafety.secretsOmitted, [
        "proved",
        "missing",
      ]),
      providerUrlsOmitted: readKnownString(redactionSafety.providerUrlsOmitted, [
        "proved",
        "missing",
      ]),
      responseBodiesOmitted: readKnownString(
        redactionSafety.responseBodiesOmitted,
        ["proved", "missing"],
      ),
      localPrivatePathsOmitted: readKnownString(
        redactionSafety.localPrivatePathsOmitted,
        ["proved", "missing"],
      ),
      liveRequiresApproval: readKnownString(redactionSafety.liveRequiresApproval, [
        "proved",
        "missing",
      ]),
      noCookieIssued: readKnownString(redactionSafety.noCookieIssued, [
        "proved",
        "missing",
      ]),
    },
  };
}

function summarizeTrustedTeacherAuthRouteChain(evidence) {
  const routeEvidence = isRecord(evidence.evidence) ? evidence.evidence : {};
  const releaseImpact = isRecord(evidence.releaseImpact) ? evidence.releaseImpact : {};
  const safety = isRecord(evidence.safety) ? evidence.safety : {};
  return {
    evidenceStatus: readKnownString(evidence.status, [
      "proved-locally",
      "blocked",
      "missing",
      "invalid",
    ]),
    authProvider: readKnownString(routeEvidence.authProvider, ["trusted-cookie-issuer"]),
    providerContract: readKnownString(routeEvidence.providerContract, [
      "production-ready-with-fixture-secrets",
      "missing",
    ]),
    issuerProof: readKnownString(routeEvidence.issuerProof, [
      "signed-admin-ai-access-plus-trusted-issuer-proof",
      "missing",
    ]),
    issuerCookieHardening:
      hasTrustedTeacherAuthIssuerCookieHardening(routeEvidence.issuerCookieHardening)
        ? "proved"
        : "missing",
    routeChain: readKnownReasons(routeEvidence.routeChain, [
      "/api/ai/teacher-auth/issue",
      "/api/ai/session",
    ]),
    sessionCookiePair: readKnownReasons(routeEvidence.sessionCookiePair, [
      "uais_teacher_auth_claims",
      "uais_teacher_auth_signature",
    ]),
    downstreamAiSession: readKnownString(routeEvidence.downstreamAiSession, [
      "scoped-teacher-ai-session-issued",
      "missing",
    ]),
    workflowAction: readKnownString(routeEvidence.workflowAction, [
      "ppt-narration-submit",
      "missing",
    ]),
    localTrustedCookieRouteWiring: readKnownString(
      releaseImpact.localTrustedCookieRouteWiring,
      ["proved", "missing"],
    ),
    productionTeacherAuthReadiness: readKnownString(
      releaseImpact.productionTeacherAuthReadiness,
      [
        "still-blocked-without-owner-approved-vercel-env-and-live-route-smoke",
        "missing",
      ],
    ),
    releaseGateEligible: releaseImpact.releaseGateEligible === true,
    safety: {
      secretsRedacted: safety.secretsRedacted === true,
      cookieValuesOmitted: safety.cookieValuesOmitted === true,
      sessionIdsOmitted: safety.sessionIdsOmitted === true,
      localPrivatePathsOmitted: safety.localPrivatePathsOmitted === true,
      productionMutationPerformed: safety.productionMutationPerformed === true,
    },
  };
}

function buildExternalStorageDecision(blockedReasons, containerBuildReadiness, releaseGate) {
  const reasons = filterReasons(blockedReasons, [
    "external-storage-container-build-readiness-not-ready",
    "external-storage-container-build-readiness-missing",
    "external-storage-container-build-readiness-target-mismatch",
    "external-storage-container-build-contract-not-proven",
    "external-storage-container-build-runtime-not-proven",
    "external-storage-container-build-not-proven",
    "external-storage-container-build-redaction-not-proven",
    "build-failed",
    "build-not-approved",
    "build-not-run",
    "dockerfile-contract-failed",
    "dockerfile-missing",
    "dockerignore-generated-output-exclusion-missing",
    "dockerignore-missing",
    "dockerignore-secret-exclusion-missing",
    "external-storage-port-invalid",
    "external-storage-production-launch-container-artifact-not-proven",
    "external-storage-production-launch-contract-missing",
    "external-storage-production-launch-contract-not-ready",
    "external-storage-production-launch-contract-target-mismatch",
    "external-storage-production-launch-env-contract-not-proven",
    "external-storage-production-launch-redaction-not-proven",
    "external-storage-production-launch-runtime-not-proven",
    "external-storage-service-readiness-not-live-ready",
    "external-storage-service-readiness-missing",
    "external-storage-service-readiness-target-mismatch",
    "external-storage-service-readiness-not-production",
    "external-storage-service-endpoint-not-remote-https",
    "external-storage-service-production-launch-contract-not-proven",
    "external-storage-service-production-identity-not-proven",
    "external-storage-service-api-contract-not-proven",
    "external-storage-service-cache-control-not-proven",
    "external-storage-service-durable-backing-store-not-ready",
    "external-storage-service-teaching-operations-schema-not-proven",
    "external-storage-service-teaching-operations-database-adapter-not-proven",
    "external-storage-service-teaching-course-management-schema-not-proven",
    "external-storage-service-teaching-course-management-database-adapter-not-proven",
    "external-storage-service-teaching-course-assets-schema-not-proven",
    "external-storage-service-teaching-course-assets-database-adapter-not-proven",
    "external-storage-service-redaction-not-proven",
    "external-storage-service-readiness-fingerprint-not-proven",
    "external-storage-service-vercel-env-sync-not-proven",
    "external-storage-service-vercel-env-sync-release-run-not-proven",
    "external-storage-service-persistence-not-proven",
    "external-storage-service-readiness-redaction-not-proven",
    "external-storage-service-fingerprint-missing",
    "external-storage-service-fingerprint-mismatch",
    "external-storage-smoke-evidence-missing",
    "external-storage-smoke-evidence-target-mismatch",
    "external-storage-smoke-not-live-passed",
    "external-storage-smoke-not-production",
    "external-storage-smoke-response-shape-not-proven",
    "external-storage-smoke-endpoint-not-remote",
    "external-storage-smoke-endpoint-not-remote-https",
    "external-storage-smoke-service-readiness-not-proven",
    "external-storage-smoke-service-readiness-release-run-not-proven",
    "teaching-operations-route-smoke-course-management-backend-not-proven",
    "teaching-course-management-route-smoke-external-backends-not-proven",
  ]);
  return {
    id: "external-storage-production-service",
    status: reasons.length > 0 ? "owner-decision-needed" : "waiting-for-live-evidence",
    responsibleSessions: ["Owner", "S12", "S19", "S22", "S24"],
    blockedReasons: reasons,
    ...(isRecord(containerBuildReadiness)
      ? {
          containerBuildReadinessSummary:
            summarizeExternalStorageContainerBuildReadiness(containerBuildReadiness),
        }
      : {}),
    ...(isRecord(releaseGate)
      ? {
          externalStorageServiceReadinessSummary:
            summarizeExternalStorageServiceReadiness(releaseGate),
        }
      : {}),
    ownerDecisionNeeded:
      "provision-approved-remote-https-external-storage-service-and-env",
    safeNextActions: [
      "confirm-approved-remote-https-external-storage-service",
      "bind-server-only-external-storage-env-through-s19-vercel-env-sync",
      "run-approved-external-storage-persistence-read-after-restart-smoke",
      "run-external-storage-service-readiness-after-env-sync-launch-and-persistence-evidence",
      "run-external-storage-smoke-only-after-service-readiness-is-live-ready",
    ],
    forbiddenUntilApproved: [
      "inspect-or-print-external-storage-secret-values",
      "run-live-external-storage-service-readiness",
      "run-live-external-storage-smoke",
      "run-production-smokes-dependent-on-external-storage",
    ],
    proofNeeded: [
      "service-readiness-live-production-ready",
      "remote-https-endpoint-class",
      "production-launcher-env-contract",
      "container-runtime-artifact",
      "container-build-readiness-evidence",
      "production-service-mode-health-target",
      "production-service-identity",
      "service-api-contract-version-proof",
      "service-health-cache-control-no-store-proof",
      "durable-backing-store-ready",
      "teaching-operations-schema-migration-health-proof",
      "teaching-operations-production-database-adapter-proof",
      "teaching-operations-backup-restore-drill-proof",
      "teaching-course-management-schema-migration-health-proof",
      "teaching-course-management-production-database-adapter-proof",
      "teaching-course-management-backup-restore-drill-proof",
      "teaching-course-assets-schema-migration-health-proof",
      "teaching-course-assets-production-database-adapter-proof",
      "teaching-course-assets-backup-restore-drill-proof",
      "ordinary-course-management-external-backend-proof",
      "teacher-ai-ownership-external-backend-proof",
      "same-service-write-read-smoke",
      "external-storage-persistence-read-after-restart-proof",
      "storage-readiness-vercel-env-sync-binding",
      "external-storage-service-fingerprint-consistency",
      "external-storage-smoke-readiness-binding",
      "external-storage-response-shape-contract",
      "external-storage-redaction-safety",
    ],
  };
}

function summarizeExternalStorageServiceReadiness(releaseGate) {
  const requirement = readRequirementById(releaseGate, "external-storage-service-readiness");
  const health = isRecord(requirement.health) ? requirement.health : {};
  return {
    evidenceStatus: readKnownString(requirement.evidenceStatus, [
      "live-ready",
      "dry-run-ready",
      "dry-run-blocked",
      "ready",
      "blocked",
      "missing",
    ]),
    blockedReason: readKnownString(requirement.blockedReason, [
      "external-storage-service-readiness-missing",
      "external-storage-service-readiness-target-mismatch",
      "external-storage-service-readiness-not-production",
      "external-storage-service-endpoint-not-remote-https",
      "external-storage-service-production-launch-contract-not-proven",
      "external-storage-service-production-identity-not-proven",
      "external-storage-service-api-contract-not-proven",
      "external-storage-service-cache-control-not-proven",
      "external-storage-service-durable-backing-store-not-ready",
      "external-storage-service-teaching-operations-schema-not-proven",
      "external-storage-service-teaching-operations-database-adapter-not-proven",
      "external-storage-service-teaching-course-management-schema-not-proven",
      "external-storage-service-teaching-course-management-database-adapter-not-proven",
      "external-storage-service-teaching-course-assets-schema-not-proven",
      "external-storage-service-teaching-course-assets-database-adapter-not-proven",
      "external-storage-service-redaction-not-proven",
      "external-storage-service-readiness-fingerprint-not-proven",
      "external-storage-service-vercel-env-sync-not-proven",
      "external-storage-service-vercel-env-sync-release-run-not-proven",
      "external-storage-service-persistence-not-proven",
      "external-storage-service-readiness-redaction-not-proven",
      "external-storage-service-readiness-not-live-ready",
      "missing",
    ]),
    evidenceEnvironment: readKnownString(requirement.evidenceEnvironment, [
      "production",
      "preview",
      "local-production",
      "local-reference",
      "missing",
    ]),
    health: {
      httpStatus: Number.isInteger(health.httpStatus) ? health.httpStatus : 0,
      status: readKnownString(health.status, ["ok", "blocked", "missing"]),
      target: readKnownString(health.target, [
        "uais-external-storage-production-service",
        "uais-external-storage-reference-service",
        "missing",
      ]),
      productionServiceIdentity: readKnownString(health.productionServiceIdentity, [
        "proved",
        "missing",
      ]),
      apiContractVersion: readKnownString(health.apiContractVersion, [
        "matched",
        "missing",
      ]),
      cacheControl: readKnownString(health.cacheControl, ["no-store", "unsafe", "missing"]),
      durableBackingStore: readKnownString(health.durableBackingStore, [
        "ready",
        "blocked",
        "missing",
      ]),
      teachingOperationsStorageSchema: summarizeExternalStorageSchemaHealth(
        health.teachingOperationsStorageSchema,
      ),
      teachingCourseManagementStorageSchema: summarizeExternalStorageSchemaHealth(
        health.teachingCourseManagementStorageSchema,
      ),
      teachingCourseAssetsStorageSchema: summarizeExternalStorageSchemaHealth(
        health.teachingCourseAssetsStorageSchema,
      ),
      redaction: readKnownString(health.redaction, ["present", "missing"]),
    },
  };
}

function summarizeExternalStorageSchemaHealth(schema) {
  const value = isRecord(schema) ? schema : {};
  const databaseAdapter = isRecord(value.productionDatabaseAdapter)
    ? value.productionDatabaseAdapter
    : {};
  return {
    status: readKnownString(value.status, ["ready", "blocked", "missing"]),
    schemaVersion: readKnownString(value.schemaVersion, [
      "matched",
      "missing",
      "uais-teaching-operations-v1",
      "uais-teaching-course-management-v1",
      "uais-teaching-course-assets-v1",
    ]),
    migrationStatus: readKnownString(value.migrationStatus, [
      "up-to-date",
      "blocked",
      "missing",
    ]),
    backupStore: readKnownString(value.backupStore, [
      "json-atomic-snapshot",
      "missing",
    ]),
    restoreDrillLog: readKnownString(value.restoreDrillLog, [
      "jsonl-append-only",
      "missing",
    ]),
    productionDatabaseAdapterStatus: readKnownString(databaseAdapter.status, [
      "ready",
      "blocked",
      "missing",
    ]),
    productionDatabaseAdapterBackupPolicy: readKnownString(
      databaseAdapter.backupPolicy,
      ["point-in-time-restore", "missing"],
    ),
    valueRedacted: value.valueRedacted === true,
  };
}

function readRequirementById(evidence, id) {
  if (!isRecord(evidence) || !Array.isArray(evidence.requirements)) {
    return {};
  }
  const requirement = evidence.requirements.find(
    (entry) => isRecord(entry) && entry.id === id,
  );
  return isRecord(requirement) ? requirement : {};
}

function hasTrustedTeacherAuthIssuerCookieHardening(value) {
  return (
    isRecord(value) &&
    value.httpOnly === "required" &&
    value.sameSite === "lax" &&
    value.secureInProduction === true &&
    value.path === "/" &&
    value.maxAge === "bounded-by-session-ttl" &&
    value.priority === "High" &&
    value.valuesRedacted === true
  );
}

function summarizeExternalStorageContainerBuildReadiness(evidence) {
  const rawEvidence = normalizeRawExternalStorageContainerBuildReadiness(evidence);
  const currentHostEvidence = rawEvidence.currentHostEvidence;
  const releaseImpact = rawEvidence.releaseImpact;
  const safety = rawEvidence.safety;
  return {
    evidenceStatus: readKnownString(evidence.status, [
      "harness-hardened",
      "ready",
      "blocked",
      "missing",
      "invalid",
    ]),
    harness: readKnownString(releaseImpact.containerBuildHarness, [
      "ready-for-approved-build-attempt",
      "not-proven",
      "missing",
    ]),
    currentMode: readKnownString(currentHostEvidence.mode, ["dry-run", "build", "missing"]),
    currentStatus: readKnownString(currentHostEvidence.status, [
      "ready",
      "blocked",
      "passed",
      "failed",
      "missing",
    ]),
    dockerClient: readKnownString(currentHostEvidence.dockerClient, [
      "present",
      "missing",
      "not-checked",
    ]),
    dockerDaemon: readKnownString(currentHostEvidence.dockerDaemon, [
      "available",
      "unavailable",
      "not-checked",
      "missing",
    ]),
    dockerfileContract: readKnownString(currentHostEvidence.dockerfileContract, [
      "passed",
      "failed",
      "missing",
    ]),
    dockerignoreSecretExclusion: readKnownString(
      currentHostEvidence.dockerignoreSecretExclusion,
      ["passed", "failed", "missing"],
    ),
    dockerignoreGeneratedOutputExclusion: readKnownString(
      currentHostEvidence.dockerignoreGeneratedOutputExclusion,
      ["passed", "failed", "missing"],
    ),
    buildInvoked: currentHostEvidence.buildInvoked === true,
    localImageBuild: readKnownString(releaseImpact.localImageBuild, [
      "passed",
      "not-proven",
      "not-proven-docker-daemon-unavailable",
      "missing",
    ]),
    releaseGateEligible: releaseImpact.releaseGateEligible === true,
    blockedReasons: readKnownReasons(currentHostEvidence.blockedReasons, [
      "docker-client-missing",
      "docker-daemon-unavailable",
      "external-storage-dockerfile-missing",
      "external-storage-dockerfile-contract-failed",
      "external-storage-dockerignore-missing",
      "external-storage-dockerignore-secret-exclusion-failed",
      "external-storage-dockerignore-generated-output-exclusion-failed",
      "external-storage-container-build-approval-missing",
      "external-storage-container-image-tag-missing",
      "external-storage-container-build-failed",
    ]),
    safety: {
      secretsRedacted: safety.secretsRedacted === true,
      imageTagsOmitted: safety.imageTagsOmitted === true,
      dockerOutputOmitted: safety.dockerOutputOmitted === true,
      localPrivatePathsOmitted: safety.localPrivatePathsOmitted === true,
      productionMutationPerformed: safety.productionMutationPerformed === true,
      vercelMutationPerformed: safety.vercelMutationPerformed === true,
    },
  };
}

function normalizeRawExternalStorageContainerBuildReadiness(evidence) {
  if (evidence.target !== "external-storage-container-build-readiness") {
    return {
      currentHostEvidence: isRecord(evidence.currentHostEvidence)
        ? evidence.currentHostEvidence
        : {},
      releaseImpact: isRecord(evidence.releaseImpact) ? evidence.releaseImpact : {},
      safety: isRecord(evidence.safety) ? evidence.safety : {},
    };
  }

  const dockerfile = isRecord(evidence.dockerfile) ? evidence.dockerfile : {};
  const dockerignore = isRecord(evidence.dockerignore) ? evidence.dockerignore : {};
  const docker = isRecord(evidence.docker) ? evidence.docker : {};
  const build = isRecord(evidence.build) ? evidence.build : {};
  const safety = isRecord(evidence.safety) ? evidence.safety : {};
  const localImageBuild =
    build.status === "passed"
      ? "passed"
      : docker.daemon === "unavailable"
        ? "not-proven-docker-daemon-unavailable"
        : "not-proven";

  return {
    currentHostEvidence: {
      mode: evidence.mode,
      status: evidence.status,
      dockerClient: docker.client,
      dockerDaemon: docker.daemon,
      dockerfileContract: dockerfile.contract,
      dockerignoreSecretExclusion: dockerignore.secretExclusion,
      dockerignoreGeneratedOutputExclusion: dockerignore.generatedOutputExclusion,
      buildInvoked: build.invoked === true,
      blockedReasons: Array.isArray(evidence.blockedReasons)
        ? evidence.blockedReasons
        : [],
    },
    releaseImpact: {
      containerBuildHarness:
        dockerfile.contract === "passed" &&
        dockerignore.secretExclusion === "passed" &&
        dockerignore.generatedOutputExclusion === "passed"
          ? "ready-for-approved-build-attempt"
          : "not-proven",
      localImageBuild,
      releaseGateEligible: evidence.status === "ready" && build.status === "passed",
    },
    safety: {
      secretsRedacted: safety.secretsExcludedFromContext === true,
      imageTagsOmitted: safety.imageTagOmitted === true,
      dockerOutputOmitted: safety.dockerOutputOmitted === true,
      localPrivatePathsOmitted: safety.localPrivatePathsOmitted === true,
      productionMutationPerformed: false,
      vercelMutationPerformed: false,
    },
  };
}

function buildVercelEnvAndDeploymentDecision(blockedReasons) {
  const reasons = filterReasons(blockedReasons, [
    "vercel-env-not-applied",
    "vercel-env-evidence-missing",
    "vercel-env-evidence-target-mismatch",
    "vercel-env-target-coverage-not-proven",
    "vercel-env-local-only-smoke-exclusion-not-proven",
    "vercel-env-auth-provider-mode-not-proven",
    "vercel-env-oidc-endpoint-security-not-proven",
    "vercel-env-external-storage-endpoint-not-proven",
    "vercel-env-external-storage-fingerprint-not-proven",
    "vercel-env-secret-strength-not-proven",
    "vercel-env-project-readiness-not-proven",
    "vercel-env-apply-preflight-not-proven",
    "vercel-env-apply-summary-not-proven",
    "vercel-production-deployment-not-proven",
    "vercel-production-deployment-evidence-target-mismatch",
    "vercel-production-deployment-project-readiness-not-proven",
    "vercel-production-deployment-env-sync-not-proven",
    "vercel-production-deployment-env-sync-apply-preflight-not-proven",
    "vercel-production-deployment-observation-not-proven",
    "vercel-production-deployment-not-production",
    "vercel-production-deployment-origin-not-remote-https",
    "vercel-production-deployment-redaction-not-proven",
    "deployed-teacher-workflow-page-not-live-passed",
    "deployed-teacher-workflow-page-evidence-target-mismatch",
    "deployed-teacher-workflow-page-not-production",
    "deployed-teacher-workflow-page-fingerprint-missing",
    "deployed-teacher-workflow-page-rendered-fingerprint-missing",
    "deployed-teacher-workflow-page-origin-not-remote-https",
    "deployed-teacher-workflow-page-vercel-deployment-release-run-not-proven",
    "deployed-teacher-workflow-page-vercel-deployment-binding-not-proven",
    "vercel-production-deployment-fingerprint-missing",
    "vercel-production-deployment-fingerprint-mismatch",
    "teacher-workflow-browser-smoke-not-live-passed",
    "teacher-workflow-browser-smoke-target-mismatch",
    "teacher-workflow-browser-smoke-not-production",
    "teacher-workflow-browser-smoke-fingerprint-missing",
    "teacher-workflow-browser-smoke-fingerprint-mismatch",
    "teacher-workflow-browser-smoke-origin-not-remote-https",
    "teacher-workflow-browser-smoke-api-interception-not-proven",
    "teacher-workflow-browser-smoke-vercel-deployment-release-run-not-proven",
    "teacher-workflow-browser-smoke-vercel-deployment-binding-not-proven",
    "teacher-workflow-live-generation-smoke-not-live-passed",
    "teacher-workflow-live-generation-smoke-target-mismatch",
    "teacher-workflow-live-generation-smoke-not-production",
    "teacher-workflow-live-generation-smoke-origin-not-remote-https",
    "teacher-workflow-live-generation-provider-mutation-not-proven",
    "teacher-workflow-live-generation-redaction-not-proven",
    "teacher-workflow-live-generation-vercel-deployment-release-run-not-proven",
    "teacher-workflow-live-generation-vercel-deployment-binding-not-proven",
    "teacher-workflow-live-generation-auth-not-issued-teacher-cookie",
    "deployed-learning-ppt-playback-not-live-passed",
    "deployed-learning-ppt-playback-target-mismatch",
    "deployed-learning-ppt-playback-not-production",
    "deployed-learning-ppt-playback-origin-not-remote-https",
    "deployed-learning-ppt-playback-http-status-not-proven",
    "deployed-learning-ppt-playback-contract-not-proven",
    "deployed-learning-ppt-playback-vercel-deployment-release-run-not-proven",
    "deployed-learning-ppt-playback-vercel-deployment-binding-not-proven",
    "deployment-route-smoke-not-live-passed",
    "deployment-route-smoke-evidence-missing",
    "deployment-route-smoke-evidence-target-mismatch",
    "deployment-route-smoke-not-production",
    "deployment-route-smoke-vercel-deployment-release-run-not-proven",
    "deployment-route-smoke-vercel-deployment-binding-not-proven",
    "teaching-operations-route-smoke-not-live-passed",
    "teaching-operations-route-smoke-evidence-missing",
    "teaching-operations-route-smoke-evidence-target-mismatch",
    "teaching-operations-route-smoke-not-production",
    "teaching-operations-route-smoke-results-not-proven",
    "teaching-operations-route-smoke-route-not-proven",
    "teaching-operations-route-smoke-routes-not-proven",
    "teaching-operations-route-smoke-redaction-not-proven",
    "teaching-operations-route-smoke-release-run-not-proven",
    "teaching-operations-route-smoke-teacher-auth-readiness-release-run-not-proven",
    "teaching-operations-route-smoke-teacher-auth-readiness-binding-not-proven",
    "teaching-operations-route-smoke-auth-not-issued-teacher-cookie",
    "teaching-operations-route-smoke-course-management-backend-not-proven",
    "teaching-operations-route-smoke-origin-not-remote-https",
    "teaching-operations-route-smoke-vercel-deployment-release-run-not-proven",
    "teaching-operations-route-smoke-vercel-deployment-binding-not-proven",
    "teaching-operation-detail-browser-smoke-not-live-passed",
    "teaching-operation-detail-browser-smoke-target-mismatch",
    "teaching-operation-detail-browser-smoke-not-production",
    "teaching-operation-detail-browser-smoke-results-not-proven",
    "teaching-operation-detail-browser-smoke-route-not-proven",
    "teaching-operation-detail-browser-smoke-operation-not-proven",
    "teaching-operation-detail-browser-smoke-redaction-not-proven",
    "teaching-operation-detail-browser-smoke-live-api-not-proven",
    "teaching-operation-detail-browser-smoke-origin-not-remote-https",
    "teaching-operation-detail-browser-smoke-release-run-not-proven",
    "teaching-operation-detail-browser-smoke-teacher-auth-readiness-release-run-not-proven",
    "teaching-operation-detail-browser-smoke-teacher-auth-readiness-binding-not-proven",
    "teaching-operation-detail-browser-smoke-auth-not-issued-teacher-cookie",
    "teaching-operation-detail-browser-smoke-vercel-deployment-binding-not-proven",
    "teaching-course-management-route-smoke-not-live-passed",
    "teaching-course-management-route-smoke-evidence-missing",
    "teaching-course-management-route-smoke-evidence-target-mismatch",
    "teaching-course-management-route-smoke-not-production",
    "teaching-course-management-route-smoke-results-not-proven",
    "teaching-course-management-route-smoke-external-backends-not-proven",
    "teaching-course-management-route-smoke-vercel-deployment-release-run-not-proven",
    "teaching-course-management-route-smoke-origin-not-remote-https",
    "teaching-course-management-route-smoke-vercel-deployment-binding-not-proven",
    "teaching-course-management-route-smoke-routes-not-proven",
    "teaching-course-management-route-smoke-redaction-not-proven",
    "teaching-course-management-route-smoke-release-run-not-proven",
    "teaching-course-management-route-smoke-teacher-auth-readiness-release-run-not-proven",
    "teaching-course-management-route-smoke-teacher-auth-readiness-binding-not-proven",
    "teaching-course-management-route-smoke-auth-not-issued-teacher-cookie",
    "deployment-route-smoke-auth-chain-not-issued",
    "deployment-route-smoke-auth-provider-mode-not-proven",
    "deployment-route-smoke-trusted-issuer-auth-not-proven",
    "deployment-route-smoke-oidc-issuer-auth-not-proven",
    "deployment-route-smoke-issuer-cookie-hardening-not-proven",
    "deployment-route-smoke-response-shape-not-proven",
    "deployment-route-smoke-direct-call-boundary-not-proven",
    "deployment-route-smoke-origin-not-remote-https",
    "deployment-route-smoke-teacher-auth-readiness-release-run-not-proven",
    "deployment-route-smoke-teacher-auth-readiness-binding-not-proven",
  ]);
  return {
    id: "vercel-env-deploy-and-smoke-chain",
    status: reasons.length > 0 ? "waiting-for-upstream-owner-decisions" : "waiting-for-live-evidence",
    responsibleSessions: ["Owner", "S19", "S22"],
    blockedReasons: reasons,
    safeNextActions: [
      "confirm-s19-vercel-env-apply-approval",
      "run-redacted-vercel-env-sync-apply-with-approved-project-and-release-run-id",
      "run-production-deployment-only-after-env-sync-evidence-is-applied",
      "run-deployed-route-smokes-only-after-production-deployment-is-proven",
      "run-ordinary-teaching-smokes-only-after-auth-storage-and-deployment-evidence-are-live-ready",
    ],
    forbiddenUntilApproved: [
      "run-vercel-env-apply-without-owner-approval",
      "run-vercel-production-deploy-without-owner-approval",
      "run-live-provider-generation-smoke-before-browser-smoke-and-owner-approval",
      "run-deployed-route-smokes-before-production-deployment-evidence",
      "print-or-log-vercel-env-secret-values",
    ],
    proofNeeded: [
      "vercel-env-sync-apply-production-and-preview",
      "vercel-env-apply-summary-redacted-counts",
      "vercel-env-external-storage-fingerprint-bound",
      "deployment-harness-env-sync-storage-fingerprint-guard",
      "vercel-production-deployment-evidence",
      "deployed-teaching-page-smoke",
      "deployed-browser-interaction-smoke",
      "deployed-ordinary-teaching-operation-detail-browser-smoke",
      "deployed-course-management-route-smoke",
      "deployed-browser-live-workflow-status-read",
      "owner-approved-teacher-workflow-live-provider-mutation",
      "teacher-workflow-live-generation-provider-mutation-proof",
      "teacher-workflow-live-generation-cookie-redaction-and-remote-approval-safety-proof",
      "teacher-workflow-live-generation-issued-teacher-auth-cookie",
      "same-release-run-id-bound-to-live-provider-generation",
      "deployed-learning-ppt-playback-smoke",
      "protected-route-smoke",
      "protected-route-teacher-workflow-download-contract",
      "protected-route-signed-session-direct-call-denial",
      "protected-route-legacy-scoped-header-direct-call-denial",
      "ordinary-teaching-operation-clicks-use-live-operations-api",
      "course-cover-and-course-management-external-backend-readback",
      "teacher-ai-ownership-external-backend-proof",
      "same-vercel-production-deployment-bound-to-browser-learning-and-route-smokes",
    ],
    sequencing:
      "project-readiness-before-env-apply-before-production-deploy-before-smokes",
  };
}

function buildOrdinaryTeachingProductionEvidenceDecision(blockedReasons) {
  const reasons = filterReasons(blockedReasons, [
    "teaching-operations-route-smoke-not-live-passed",
    "teaching-operations-route-smoke-evidence-missing",
    "teaching-operations-route-smoke-evidence-target-mismatch",
    "teaching-operations-route-smoke-not-production",
    "teaching-operations-route-smoke-results-not-proven",
    "teaching-operations-route-smoke-route-not-proven",
    "teaching-operations-route-smoke-routes-not-proven",
    "teaching-operations-route-smoke-redaction-not-proven",
    "teaching-operations-route-smoke-release-run-not-proven",
    "teaching-operations-route-smoke-teacher-auth-readiness-release-run-not-proven",
    "teaching-operations-route-smoke-teacher-auth-readiness-binding-not-proven",
    "teaching-operations-route-smoke-auth-not-issued-teacher-cookie",
    "teaching-operations-route-smoke-course-management-backend-not-proven",
    "teaching-operations-route-smoke-origin-not-remote-https",
    "teaching-operations-route-smoke-vercel-deployment-release-run-not-proven",
    "teaching-operations-route-smoke-vercel-deployment-binding-not-proven",
    "teaching-operations-route-smoke-storage-readiness-binding-not-proven",
    "teaching-operations-route-smoke-storage-database-adapter-binding-not-proven",
    "teaching-operations-route-smoke-operations-backend-not-proven",
    "teaching-operations-route-smoke-course-management-backend-not-proven",
    "teaching-operations-route-smoke-app-auth-readiness-binding-not-proven",
    "teaching-operation-detail-browser-smoke-not-live-passed",
    "teaching-operation-detail-browser-smoke-target-mismatch",
    "teaching-operation-detail-browser-smoke-not-production",
    "teaching-operation-detail-browser-smoke-results-not-proven",
    "teaching-operation-detail-browser-smoke-route-not-proven",
    "teaching-operation-detail-browser-smoke-operation-not-proven",
    "teaching-operation-detail-browser-smoke-redaction-not-proven",
    "teaching-operation-detail-browser-smoke-live-api-not-proven",
    "teaching-operation-detail-browser-smoke-origin-not-remote-https",
    "teaching-operation-detail-browser-smoke-release-run-not-proven",
    "teaching-operation-detail-browser-smoke-teacher-auth-readiness-release-run-not-proven",
    "teaching-operation-detail-browser-smoke-teacher-auth-readiness-binding-not-proven",
    "teaching-operation-detail-browser-smoke-auth-not-issued-teacher-cookie",
    "teaching-operation-detail-browser-smoke-vercel-deployment-binding-not-proven",
    "teaching-course-management-route-smoke-not-live-passed",
    "teaching-course-management-route-smoke-evidence-missing",
    "teaching-course-management-route-smoke-evidence-target-mismatch",
    "teaching-course-management-route-smoke-not-production",
    "teaching-course-management-route-smoke-results-not-proven",
    "teaching-course-management-route-smoke-external-backends-not-proven",
    "teaching-course-management-route-smoke-vercel-deployment-release-run-not-proven",
    "teaching-course-management-route-smoke-origin-not-remote-https",
    "teaching-course-management-route-smoke-vercel-deployment-binding-not-proven",
    "teaching-course-management-route-smoke-routes-not-proven",
    "teaching-course-management-route-smoke-redaction-not-proven",
    "teaching-course-management-route-smoke-release-run-not-proven",
    "teaching-course-management-route-smoke-teacher-auth-readiness-release-run-not-proven",
    "teaching-course-management-route-smoke-teacher-auth-readiness-binding-not-proven",
    "teaching-course-management-route-smoke-auth-not-issued-teacher-cookie",
    "external-storage-service-teaching-operations-schema-not-proven",
    "external-storage-service-teaching-operations-database-adapter-not-proven",
    "external-storage-service-teaching-course-management-schema-not-proven",
    "external-storage-service-teaching-course-management-database-adapter-not-proven",
    "external-storage-service-teaching-course-assets-schema-not-proven",
    "external-storage-service-teaching-course-assets-database-adapter-not-proven",
  ]);
  if (reasons.length === 0) {
    return undefined;
  }
  return {
    id: "ordinary-teaching-production-evidence",
    status: "waiting-for-live-evidence",
    responsibleSessions: ["S05", "S12", "S13", "S19", "S22"],
    blockedReasons: reasons,
    safeNextActions: [
      "confirm-ordinary-teaching-live-smoke-prerequisites",
      "wait-for-auth-storage-and-vercel-deployment-evidence",
      "run-live-teaching-operations-route-smoke-after-auth-storage-deployment-readiness",
      "run-live-operation-detail-and-course-management-smokes-with-issued-teacher-auth-cookie",
      "collect-release-run-bound-ordinary-teaching-evidence-for-enterprise-audit",
    ],
    forbiddenUntilApproved: [
      "run-live-ordinary-teaching-smokes-before-auth-storage-and-deployment-readiness",
      "call-live-teaching-operations-api-without-issued-teacher-auth-cookie",
      "run-provider-backed-side-effect-smokes-without-owner-approval",
      "accept-local-production-smoke-as-production-live-evidence",
      "print-or-log-teacher-auth-cookie-or-backend-secret-values",
    ],
    proofNeeded: [
      "live-teaching-operations-route-smoke",
      "live-teaching-operation-detail-browser-smoke",
      "live-teaching-course-management-route-smoke",
      "issued-teacher-auth-cookie-bound-to-ordinary-teaching-smokes",
      "ordinary-teaching-operation-clicks-use-live-operations-api",
      "ordinary-teaching-route-smoke-provider-backed-side-effects",
      "ordinary-teaching-audit-readback-rollback-alerts",
      "ordinary-teaching-external-backup-restore-drills",
      "course-cover-and-course-management-external-backend-readback",
      "teacher-ai-ownership-external-backend-proof",
      "same-release-run-id-bound-to-ordinary-teaching-evidence",
      "same-vercel-production-deployment-bound-to-ordinary-teaching-smokes",
      "teacher-auth-provider-readiness-bound-to-ordinary-teaching-smokes",
      "external-storage-readiness-bound-to-ordinary-teaching-smokes",
    ],
    sequencing:
      "external-storage-and-auth-readiness-before-live-ordinary-teaching-smokes",
  };
}

function buildManualPptDecision(blockedReasons) {
  const reasons = filterReasons(blockedReasons, [
    "manual-ppt-playback-not-accepted",
    "ppt-manual-acceptance-evidence-missing",
    "ppt-manual-acceptance-target-mismatch",
    "manual-ppt-record-evidence-incomplete",
    "manual-ppt-evidence-detail-not-proven",
    "manual-ppt-package-identity-not-proven",
    "manual-ppt-tested-at-timing-not-proven",
    "manual-ppt-artifact-fingerprint-not-proven",
    "manual-ppt-human-confirmation-not-proven",
    "manual-ppt-target-voice-label-not-proven",
    "manual-ppt-deployment-fingerprint-binding-not-proven",
    "manual-ppt-release-run-binding-not-proven",
    "manual-ppt-tested-after-deployment-not-proven",
    "manual-ppt-deployment-evidence-source-not-proven",
  ]);
  return {
    id: "manual-ppt-playback-acceptance",
    status: reasons.length > 0 ? "human-qa-needed" : "waiting-for-accepted-evidence",
    responsibleSessions: ["S24"],
    blockedReasons: reasons,
    safeNextActions: [
      "package-manual-ppt-playback-evidence-for-human-review",
      "verify-powerpoint-and-wps-playback-after-production-deployment",
      "bind-manual-ppt-record-to-release-run-and-vercel-deployment",
      "confirm-target-cloned-voice-label-and-per-slide-audio",
      "submit-human-accepted-playback-record-for-release-gate",
    ],
    forbiddenUntilApproved: [
      "mark-manual-ppt-accepted-before-human-playback",
      "reuse-manual-ppt-record-from-different-release-run",
      "reuse-manual-ppt-record-from-different-vercel-deployment",
      "accept-missing-target-voice-label-or-slide-audio",
      "log-private-ppt-package-paths-or-audio-urls",
    ],
    proofNeeded: [
      "human-powerpoint-playback-accepted",
      "human-wps-playback-accepted",
      "explicit-accepted-after-human-playback-status",
      "valid-tested-at-timestamp",
      "same-release-run-id-bound-to-manual-record",
      "same-vercel-production-deployment-bound-to-manual-playback-record",
      "all-19-slide-audio-checks-true",
      "target-cloned-voice-label-present",
      "target-cloned-voice-heard-per-slide",
    ],
  };
}

function buildEnterpriseLiveEvidenceAuditDecision(blockedReasons, releaseGate) {
  const reasons = filterReasons(blockedReasons, [
    "enterprise-live-evidence-audit-missing",
    "enterprise-live-evidence-audit-target-mismatch",
    "enterprise-live-evidence-audit-empty",
    "enterprise-live-evidence-audit-not-ready",
    "production-live-evidence-missing",
    "filename-only-or-blocked-production-live-evidence",
    "production-live-release-run-id-mismatch",
    "enterprise-live-required-targets-missing",
  ]);
  if (reasons.length === 0) {
    return undefined;
  }
  const enterpriseAuditSummary =
    summarizeEnterpriseLiveEvidenceAuditRequirement(
      readRequirementById(releaseGate, "enterprise-live-evidence-audit"),
    );
  return {
    id: "enterprise-live-evidence-audit",
    status: "waiting-for-live-evidence",
    responsibleSessions: ["S22"],
    blockedReasons: reasons,
    enterpriseAuditSummary,
    safeNextActions: [
      "wait-for-approved-production-live-evidence-files",
      "run-enterprise-live-evidence-audit-after-all-target-evidence-exists",
      "reject-filename-only-or-blocked-evidence-records",
      "verify-shared-release-run-id-across-production-live-evidence",
      "attach-audit-summary-before-final-release-run",
    ],
    forbiddenUntilApproved: [
      "mark-enterprise-audit-ready-with-missing-required-targets",
      "accept-filename-only-production-live-evidence",
      "accept-mismatched-release-run-id-production-evidence",
      "publish-audit-with-local-private-paths-or-raw-urls",
      "treat-local-or-dry-run-evidence-as-live-production-evidence",
    ],
    proofNeeded: [
      "body-level-production-live-evidence-audit-proof",
      "all-orchestrated-production-live-targets-present",
      "shared-release-run-id-across-production-live-evidence",
      "required-production-live-safety-redaction-flags",
      "target-specific-result-proof-keys-body-proven",
      "target-specific-contract-proof-keys-body-proven",
      "filename-only-production-live-evidence-rejected",
    ],
    sequencing:
      "run-enterprise-live-evidence-audit-after-all-approved-production-live-evidence-files-exist",
  };
}

function summarizeEnterpriseLiveEvidenceAuditRequirement(requirement) {
  if (!isRecord(requirement)) {
    return {
      evidenceStatus: "missing",
      acceptedLiveEvidence: 0,
      filenameOnlyOrBlocked: 0,
      releaseRunIdConsistency: "missing",
      requiredTargetProofStatus: "missing",
      requiredTargetResultCriteriaStatus: "missing",
      requiredTargetContractCriteriaStatus: "missing",
      missingRequiredTargetCount: 0,
      acceptedTargetStatusCriteriaStatus: "missing",
      acceptedTargetModeCriteriaStatus: "missing",
      acceptedBodyFieldCriteriaStatus: "missing",
    };
  }

  const missingRequiredTargets = Array.isArray(requirement.missingRequiredTargets)
    ? requirement.missingRequiredTargets.filter((target) => typeof target === "string")
    : [];

  return {
    evidenceStatus:
      typeof requirement.evidenceStatus === "string"
        ? requirement.evidenceStatus
        : "missing",
    acceptedLiveEvidence: readSafeCount(requirement.acceptedLiveEvidence),
    filenameOnlyOrBlocked: readSafeCount(requirement.filenameOnlyOrBlocked),
    releaseRunIdConsistency: readKnownString(requirement.releaseRunIdConsistency, [
      "matched",
      "mismatched",
      "missing",
    ]),
    requiredTargetProofStatus: readKnownString(requirement.requiredTargetProofStatus, [
      "proved",
      "missing",
    ]),
    requiredTargetResultCriteriaStatus: readKnownString(
      requirement.requiredTargetResultCriteriaStatus,
      ["proved", "missing"],
    ),
    requiredTargetContractCriteriaStatus: readKnownString(
      requirement.requiredTargetContractCriteriaStatus,
      ["proved", "missing"],
    ),
    missingRequiredTargetCount: missingRequiredTargets.length,
    missingRequiredTargets,
    acceptedTargetStatusCriteriaStatus: readKnownString(
      requirement.acceptedTargetStatusCriteriaStatus,
      ["proved", "missing"],
    ),
    acceptedTargetModeCriteriaStatus: readKnownString(
      requirement.acceptedTargetModeCriteriaStatus,
      ["proved", "missing"],
    ),
    acceptedBodyFieldCriteriaStatus: readKnownString(
      requirement.acceptedBodyFieldCriteriaStatus,
      ["proved", "missing"],
    ),
  };
}

function buildProductionReleaseRunDecision(blockedReasons) {
  const productionEvidenceMissing = blockedReasons.size > 0;
  return {
    id: "production-release-run",
    status: productionEvidenceMissing
      ? "waiting-for-upstream-evidence"
      : "ready-to-bind-release-run-id",
    responsibleSessions: ["S22", "S24"],
    blockedReasons: [...blockedReasons],
    safeNextActions: [
      "wait-for-final-release-gate-ready",
      "bind-one-public-release-run-id-after-all-production-evidence-is-ready",
      "verify-owner-checklist-has-no-waiting-or-blocked-decisions",
      "publish-release-run-summary-with-redacted-evidence-only",
    ],
    forbiddenUntilApproved: [
      "bind-release-run-id-while-release-gate-blocked",
      "mix-production-evidence-from-multiple-release-run-ids",
      "include-local-private-paths-or-secret-values-in-release-run-summary",
      "treat-owner-decisions-required-as-release-ready",
    ],
    proofNeeded: [
      "one-public-release-run-id-used-across-production-evidence",
      "final-release-gate-ready",
    ],
  };
}

function summarizeVercelProjectReadiness(evidence, alternateEvidence) {
  const checks = readChecksById(evidence);
  const alternateChecks = readChecksById(alternateEvidence);
  const candidate = checks.get("s22-vercel-project-candidate");
  const alternateCandidate = alternateChecks.get("s22-vercel-project-candidate");
  return {
    cli: readCheckStatus(checks, "s22-vercel-cli"),
    auth: readCheckStatus(checks, "s22-vercel-auth"),
    teamScope: readCheckStatus(checks, "s22-vercel-team-scope"),
    projectCandidate: readCheckStatus(checks, "s22-vercel-project-candidate"),
    projectLink: readCheckStatus(checks, "s22-vercel-project-link"),
    uploadHygiene: readCheckStatus(checks, "s22-vercelignore-upload-hygiene"),
    filteredProjectCount: readSafeCount(candidate?.filteredProjectCount),
    exactProjectNameCount: readSafeCount(candidate?.exactProjectNameCount),
    alternateExactProjectNameCount: readSafeCount(alternateCandidate?.exactProjectNameCount),
  };
}

function summarizeLocalProductionDiagnostic(evidence) {
  if (!isRecord(evidence)) {
    return {
      status: "missing",
      evidenceFreshness: "missing",
      releaseEligible: false,
      requirementSource: LOCAL_PRODUCTION_REQUIREMENT_SOURCE,
      requiredChecks: LOCAL_PRODUCTION_REQUIRED_CHECKS,
      missingRequiredChecks: LOCAL_PRODUCTION_REQUIRED_CHECKS,
      browserProofStatus: "missing",
      requiredBrowserResults: LOCAL_PRODUCTION_REQUIRED_BROWSER_RESULTS,
      missingBrowserResults: LOCAL_PRODUCTION_REQUIRED_BROWSER_RESULTS,
      passedChecks: [],
    };
  }
  const checks = readChecksById(evidence);
  const browserResults = Object.assign(
    {},
    ...LOCAL_PRODUCTION_BROWSER_CHECK_IDS.map((checkId) => {
      const browserCheck = checks.get(checkId);
      return isRecord(browserCheck?.results) ? browserCheck.results : {};
    }),
  );
  const missingRequiredChecks = LOCAL_PRODUCTION_REQUIRED_CHECKS.filter(
    (checkId) => checks.get(checkId)?.status !== "passed",
  );
  const missingBrowserChecks = LOCAL_PRODUCTION_BROWSER_CHECK_IDS.filter(
    (checkId) => checks.get(checkId)?.status !== "passed",
  );
  const missingBrowserResults = LOCAL_PRODUCTION_REQUIRED_BROWSER_RESULTS.filter(
    (resultKey) => browserResults[resultKey] !== "passed",
  );
  const browserProofStatus =
    missingBrowserChecks.length > 0
      ? "missing"
      : missingBrowserResults.length === 0
        ? "passed"
        : "incomplete";
  const evidenceFreshness =
    readStatus(evidence) === "passed" &&
    missingRequiredChecks.length === 0 &&
    missingBrowserResults.length === 0
      ? "current"
      : "stale";
  return {
    status: readStatus(evidence),
    evidenceFreshness,
    releaseEligible: false,
    requirementSource: LOCAL_PRODUCTION_REQUIREMENT_SOURCE,
    requiredChecks: LOCAL_PRODUCTION_REQUIRED_CHECKS,
    missingRequiredChecks,
    browserProofStatus,
    requiredBrowserResults: LOCAL_PRODUCTION_REQUIRED_BROWSER_RESULTS,
    missingBrowserResults,
    passedChecks: (Array.isArray(evidence.checks) ? evidence.checks : [])
      .filter((check) => isRecord(check) && check.status === "passed")
      .map((check) => check.id)
      .filter((id) => typeof id === "string"),
  };
}

function readLocalProductionDiagnosticContract() {
  const localSmokeScript = fileURLToPath(new URL("./local-production-e2e-smoke.mjs", import.meta.url));
  const output = execFileSync(process.execPath, [
    localSmokeScript,
    "--dry-run",
    "--port",
    "43123",
  ], {
    encoding: "utf8",
  });
  const body = JSON.parse(output);
  const checks = Array.isArray(body.checks) ? body.checks : [];
  const requiredChecks = checks
    .map((check) => (isRecord(check) ? check.id : undefined))
    .filter((id) => typeof id === "string");
  const browserChecks = checks.filter(
    (check) => isRecord(check) && Array.isArray(check.browserProofSummary),
  );
  const browserCheckIds = browserChecks
    .map((check) => check.id)
    .filter((id) => typeof id === "string");
  const requiredBrowserResults = [
    ...new Set(
      browserChecks.flatMap((check) =>
        check.browserProofSummary.filter((result) => typeof result === "string"),
      ),
    ),
  ];

  if (
    requiredChecks.length === 0 ||
    browserCheckIds.length === 0 ||
    requiredBrowserResults.length === 0
  ) {
    throw new Error("Local production diagnostic contract could not be read from dry-run plan.");
  }

  return {
    requirementSource: "local-production-e2e-smoke-dry-run",
    requiredChecks,
    browserCheckIds,
    requiredBrowserResults,
  };
}

function summarizeReleaseGateWaitingRequirements(evidence) {
  if (!isRecord(evidence) || !Array.isArray(evidence.requirements)) {
    return [];
  }
  return evidence.requirements
    .filter(
      (requirement) =>
        isRecord(requirement) &&
        requirement.status === "blocked" &&
        typeof requirement.id === "string" &&
        typeof requirement.evidenceStatus === "string" &&
        requirement.evidenceStatus.startsWith("waiting-for-"),
    )
    .map((requirement) => ({
      id: requirement.id,
      evidenceStatus: requirement.evidenceStatus,
      ...(typeof requirement.blockedReason === "string"
        ? { blockedReason: requirement.blockedReason }
        : {}),
      ...(typeof requirement.upstreamRequirement === "string"
        ? { upstreamRequirement: requirement.upstreamRequirement }
        : {}),
    }));
}

function summarizeReleaseGateBlockedRequirements(evidence) {
  if (!isRecord(evidence) || !Array.isArray(evidence.requirements)) {
    return [];
  }
  return evidence.requirements
    .filter(
      (requirement) =>
        isRecord(requirement) &&
        requirement.status === "blocked" &&
        typeof requirement.id === "string",
    )
    .map((requirement) => ({
      id: requirement.id,
      ...(typeof requirement.evidenceStatus === "string"
        ? { evidenceStatus: requirement.evidenceStatus }
        : {}),
      ...(typeof requirement.blockedReason === "string"
        ? { blockedReason: requirement.blockedReason }
        : {}),
      ...(typeof requirement.upstreamRequirement === "string"
        ? { upstreamRequirement: requirement.upstreamRequirement }
        : {}),
    }));
}

function readChecksById(evidence) {
  const checks = new Map();
  if (!isRecord(evidence) || !Array.isArray(evidence.checks)) {
    return checks;
  }
  for (const check of evidence.checks) {
    if (isRecord(check) && typeof check.id === "string") {
      checks.set(check.id, check);
    }
  }
  return checks;
}

function readCheckStatus(checks, id) {
  const status = checks.get(id)?.status;
  return typeof status === "string" ? status : "missing";
}

function readKnownString(value, allowedValues) {
  return typeof value === "string" && allowedValues.includes(value) ? value : "missing";
}

function readKnownReasons(value, allowedReasons) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((reason) => typeof reason === "string" && allowedReasons.includes(reason));
}

function readSafeCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function readBlockedReasons(evidence) {
  if (!isRecord(evidence)) {
    return [];
  }
  return mergeReasons([
    ...(Array.isArray(evidence.blockedReasons) ? evidence.blockedReasons : []),
    ...(Array.isArray(evidence.blockedRequirementReasons)
      ? evidence.blockedRequirementReasons
      : []),
  ].filter((reason) => typeof reason === "string"));
}

function filterReasons(reasonSet, allowedReasons) {
  return allowedReasons.filter((reason) => reasonSet.has(reason));
}

function mergeReasons(reasons) {
  return [...new Set(reasons)];
}

function readStatus(evidence) {
  return isRecord(evidence) && typeof evidence.status === "string" ? evidence.status : "missing";
}

function readOptionalJson(path) {
  if (!hasValue(path)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("Unable to read evidence JSON.");
  }
}

function parseArgs(args) {
  const options = {
    releaseGate: undefined,
    vercelProjectReadiness: undefined,
    alternateVercelProjectReadiness: undefined,
    localProductionE2e: undefined,
    externalStorageContainerBuildReadiness: undefined,
    trustedTeacherAuthRouteChain: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--release-gate") {
      options.releaseGate = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--vercel-project-readiness") {
      options.vercelProjectReadiness = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--alternate-vercel-project-readiness") {
      options.alternateVercelProjectReadiness = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--local-production-e2e") {
      options.localProductionE2e = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--external-storage-container-build-readiness") {
      options.externalStorageContainerBuildReadiness = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--trusted-teacher-auth-route-chain") {
      options.trustedTeacherAuthRouteChain = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node scripts/production-owner-decision-checklist.mjs --release-gate PATH [--vercel-project-readiness PATH] [--alternate-vercel-project-readiness PATH] [--local-production-e2e PATH] [--external-storage-container-build-readiness PATH] [--trusted-teacher-auth-route-chain PATH]",
          "",
          "Outputs a redacted owner-decision checklist from production release evidence.",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function readArgValue(args, index, name) {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
