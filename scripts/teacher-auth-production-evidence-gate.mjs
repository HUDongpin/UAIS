#!/usr/bin/env node

import { readFileSync } from "node:fs";

const provedEvidence = [
  "vercel-env-sync-evidence-with-teacher-auth-env-present",
  "deployed-teacher-auth-issuer-route-smoke",
  "teacher-auth-provider-readiness-production-live-ready",
  "same-release-run-id-bound-to-teacher-auth-readiness",
];

const readinessResultKeys = [
  "teacherAuthProviderModeSupported",
  "teacherAuthSessionCookieContract",
  "teacherAuthProviderVercelEnvSync",
  "teacherAuthProviderSpecificContract",
  "teacherAuthProviderRouteBinding",
  "teacherAuthReadinessSafety",
];

function main() {
  const args = parseArgs(process.argv.slice(2));
  const teacherAuthPreflight = readJsonArg(args, "teacher-auth-preflight");
  const teacherAuthVercelEnvSyncEvidenceGate = readJsonArg(
    args,
    "teacher-auth-vercel-env-sync-evidence-gate",
  );
  const teacherAuthIssuerRouteSmoke =
    typeof args["teacher-auth-issuer-route-smoke"] === "string"
      ? readJsonArg(args, "teacher-auth-issuer-route-smoke")
      : undefined;
  const teacherAuthProviderReadiness =
    typeof args["teacher-auth-provider-readiness"] === "string"
      ? readJsonArg(args, "teacher-auth-provider-readiness")
      : undefined;
  const report = buildReport({
    teacherAuthPreflight,
    teacherAuthVercelEnvSyncEvidenceGate,
    teacherAuthIssuerRouteSmoke,
    teacherAuthProviderReadiness,
  });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(report));
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function buildReport({
  teacherAuthPreflight,
  teacherAuthVercelEnvSyncEvidenceGate,
  teacherAuthIssuerRouteSmoke,
  teacherAuthProviderReadiness,
}) {
  const approvedProviderMode = readString(teacherAuthPreflight.approvedProviderMode, "");
  const approvedReleaseRunIdLabel = readString(
    teacherAuthPreflight.approvedReleaseRunIdLabel,
    "",
  );
  const upstreamAppAuthEvidenceCleared =
    teacherAuthPreflight.summary?.upstreamAppAuthEvidenceCleared === true;
  const liveCookieIssuanceStillForbidden =
    teacherAuthPreflight.summary?.liveCookieIssuanceStillForbidden === true;
  const envSyncEvidenceAccepted =
    teacherAuthVercelEnvSyncEvidenceGate.summary?.applyEvidenceAccepted === true &&
    teacherAuthVercelEnvSyncEvidenceGate.summary?.teacherAuthReadinessMayProceed === true &&
    teacherAuthVercelEnvSyncEvidenceGate.vercelEnvSyncEvidenceStatus?.releaseRunIdStatus ===
      "matched";
  const issuerRouteSmokeStatus = evaluateIssuerRouteSmokeEvidence({
    evidence: teacherAuthIssuerRouteSmoke,
    approvedProviderMode,
    approvedReleaseRunIdLabel,
  });
  const readinessEvidenceStatus = evaluateReadinessEvidence({
    evidence: teacherAuthProviderReadiness,
    approvedProviderMode,
    approvedReleaseRunIdLabel,
  });
  const issuerRouteSmokeAccepted = issuerRouteSmokeStatus.status === "proved";
  const readinessEvidenceAccepted = readinessEvidenceStatus.status === "live-ready";
  const releaseRunBound =
    issuerRouteSmokeStatus.releaseRunIdStatus === "matched" &&
    readinessEvidenceStatus.releaseRunIdStatus === "matched";
  const teacherAuthProductionEvidenceCleared =
    upstreamAppAuthEvidenceCleared &&
    envSyncEvidenceAccepted &&
    issuerRouteSmokeAccepted &&
    readinessEvidenceAccepted &&
    releaseRunBound &&
    liveCookieIssuanceStillForbidden;
  const upstreamEnvSyncEvidenceRequired = !envSyncEvidenceAccepted;
  const upstreamOperatorInputRequired =
    upstreamEnvSyncEvidenceRequired &&
    teacherAuthVercelEnvSyncEvidenceGate.summary?.operatorInputRequired === true;
  const upstreamBlockingEvidence = upstreamEnvSyncEvidenceRequired
    ? {
        id: "upstream-teacher-auth-vercel-env-sync-evidence-gate",
        label: "teacher-auth-vercel-env-sync-evidence-gate",
        reason:
          "Teacher-auth production evidence must wait for accepted teacher-auth Vercel env-sync evidence before issuer smoke or provider readiness evidence can be requested.",
        valuesForbidden: true,
        upstreamStatus: readString(teacherAuthVercelEnvSyncEvidenceGate.status, "unknown"),
        safeNextAction: readString(teacherAuthVercelEnvSyncEvidenceGate.safeNextAction, ""),
        upstreamOperatorInputRequired,
        upstreamMissingEvidence: readStringArray(
          teacherAuthVercelEnvSyncEvidenceGate.upstreamBlockingEvidence?.upstreamMissingEvidence,
        ),
        upstreamOperatorInputPacket: readSafeOperatorInputPacket(
          teacherAuthVercelEnvSyncEvidenceGate.upstreamBlockingEvidence
            ?.upstreamOperatorInputPacket,
        ),
        upstreamSafeCommandTemplates: readSafeCommandTemplates(
          teacherAuthVercelEnvSyncEvidenceGate.upstreamBlockingEvidence
            ?.upstreamSafeCommandTemplates,
        ),
      }
    : null;
  const status = readStatus({
    teacherAuthProductionEvidenceCleared,
    upstreamAppAuthEvidenceCleared,
    envSyncEvidenceAccepted,
  });

  return {
    target: "teacher-auth-production-evidence-gate",
    status,
    releaseReady: false,
    responsibleSession: "S19/S22",
    approvedProviderMode,
    approvedServerOnlyEnvSourceLabel: readString(
      teacherAuthPreflight.approvedServerOnlyEnvSourceLabel,
      "",
    ),
    approvedReleaseRunIdLabel,
    summary: {
      operatorInputRequired: upstreamOperatorInputRequired,
      blockingInputRequired: upstreamOperatorInputRequired,
      upstreamAppAuthEvidenceCleared,
      envSyncEvidenceAccepted,
      issuerRouteSmokeProvided: teacherAuthIssuerRouteSmoke !== undefined,
      issuerRouteSmokeAccepted,
      readinessEvidenceProvided: teacherAuthProviderReadiness !== undefined,
      readinessEvidenceAccepted,
      releaseRunBound,
      teacherAuthProductionEvidenceCleared,
      liveCookieIssuanceStillForbidden,
      releaseReady: false,
    },
    issuerRouteSmokeStatus,
    readinessEvidenceStatus,
    upstreamBlockingEvidence,
    provedEvidence: teacherAuthProductionEvidenceCleared ? provedEvidence : [],
    blockedReasons: buildBlockedReasons({
      upstreamAppAuthEvidenceCleared,
      envSyncEvidenceAccepted,
      issuerRouteSmokeStatus,
      readinessEvidenceStatus,
      liveCookieIssuanceStillForbidden,
    }),
    safeNextAction: readSafeNextAction({
      teacherAuthProductionEvidenceCleared,
      upstreamAppAuthEvidenceCleared,
      envSyncEvidenceAccepted,
      upstreamBlockingEvidence,
    }),
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      credentialValuesOmitted: true,
      cookieValuesOmitted: true,
      responseBodiesOmitted: true,
      envFileRead: false,
      vercelApiCalled: false,
      providerNetworkCallPerformed: false,
      noCookieIssued: true,
      noEnvApplyPerformed: true,
      noDeploymentMutationPerformed: true,
      noLiveSmokePerformed: true,
      noReleaseRunBindingPerformed: true,
    },
  };
}

function readStatus({
  teacherAuthProductionEvidenceCleared,
  upstreamAppAuthEvidenceCleared,
  envSyncEvidenceAccepted,
}) {
  if (teacherAuthProductionEvidenceCleared) {
    return "teacher-auth-production-evidence-gate-cleared";
  }
  if (!upstreamAppAuthEvidenceCleared) {
    return "teacher-auth-production-evidence-gate-waiting-for-upstream-app-auth";
  }
  if (!envSyncEvidenceAccepted) {
    return "teacher-auth-production-evidence-gate-awaiting-env-sync-evidence";
  }
  return "teacher-auth-production-evidence-gate-awaiting-readiness-evidence";
}

function evaluateIssuerRouteSmokeEvidence({
  evidence,
  approvedProviderMode,
  approvedReleaseRunIdLabel,
}) {
  if (evidence === undefined) {
    return {
      target: "missing",
      status: "missing",
      environment: "missing",
      releaseRunIdStatus: "missing",
      valueRedacted: true,
    };
  }
  const base = {
    target: readString(evidence.target, "missing"),
    environment: readString(evidence.environment, "missing"),
    releaseRunIdStatus:
      evidence.releaseRunId === approvedReleaseRunIdLabel ? "matched" : "mismatched",
    valueRedacted: true,
  };
  if (base.target !== "teacher-auth-issuer-route-smoke") {
    return { ...base, status: "invalid-target" };
  }
  if (
    evidence.mode !== "live" ||
    evidence.environment !== "production" ||
    evidence.authProviderMode !== approvedProviderMode
  ) {
    return { ...base, status: "not-production-live" };
  }
  if (evidence.releaseRunId !== approvedReleaseRunIdLabel) {
    return { ...base, status: "release-run-id-mismatch" };
  }
  if (!hasIssuerRouteProof(evidence)) {
    return { ...base, status: "route-proof-missing" };
  }
  return {
    ...base,
    status: "proved",
  };
}

function evaluateReadinessEvidence({ evidence, approvedProviderMode, approvedReleaseRunIdLabel }) {
  if (evidence === undefined) {
    return {
      target: "missing",
      status: "missing",
      mode: "missing",
      environment: "missing",
      releaseRunIdStatus: "missing",
      valueRedacted: true,
    };
  }
  const base = {
    target: readString(evidence.target, "missing"),
    mode: readString(evidence.mode, "missing"),
    environment: readString(evidence.environment, "missing"),
    releaseRunIdStatus:
      evidence.releaseRunId === approvedReleaseRunIdLabel ? "matched" : "mismatched",
    valueRedacted: true,
  };
  if (base.target !== "teacher-auth-provider-readiness") {
    return { ...base, status: "invalid-target" };
  }
  if (
    evidence.mode !== "live" ||
    evidence.environment !== "production" ||
    evidence.status !== "ready"
  ) {
    return { ...base, status: "not-live-ready" };
  }
  if (evidence.releaseRunId !== approvedReleaseRunIdLabel) {
    return { ...base, status: "release-run-id-mismatch" };
  }
  if (evidence.authProviderMode !== approvedProviderMode) {
    return { ...base, status: "provider-mode-mismatch" };
  }
  if (!hasPassedReadinessResults(evidence.results)) {
    return { ...base, status: "result-proof-missing" };
  }
  if (!hasTrustedCookieIssuerReadinessProofs(evidence)) {
    return { ...base, status: "trusted-cookie-proof-missing" };
  }
  if (!hasReadinessSafety(evidence.safety)) {
    return { ...base, status: "redaction-safety-missing" };
  }
  return {
    ...base,
    status: "live-ready",
  };
}

function hasIssuerRouteProof(evidence) {
  const deployment = isRecord(evidence.vercelProductionDeploymentEvidence)
    ? evidence.vercelProductionDeploymentEvidence
    : {};
  const issuerRoute = readResultById(evidence.results, "s22-teacher-auth-issuer-route");
  const headers = isRecord(issuerRoute?.responseHeaders) ? issuerRoute.responseHeaders : {};
  const requiredHeaders = isRecord(headers.requiredHeaders) ? headers.requiredHeaders : {};
  const shape = isRecord(issuerRoute?.responseShape) ? issuerRoute.responseShape : {};
  const requiredFields = isRecord(shape.requiredFields) ? shape.requiredFields : {};
  return (
    (deployment.status === "matched" ||
      deployment.status === "matched-via-domain-reachability") &&
    deployment.deploymentObservationStatus === "observed" &&
    deployment.releaseRunIdStatus === "matched" &&
    deployment.valueRedacted === true &&
    issuerRoute?.status === "ok" &&
    issuerRoute.auth === "signed-admin-ai-access" &&
    headers.checked === true &&
    headers.status === "ok" &&
    requiredHeaders.teacherAuthClaimsSetCookie === "present" &&
    requiredHeaders.teacherAuthSignatureSetCookie === "present" &&
    requiredHeaders.httpOnlySameSiteSecureMaxAge === "present" &&
    requiredHeaders.priorityHigh === "present" &&
    requiredHeaders.issuerProofBoundedMaxAge === "present" &&
    shape.checked === true &&
    shape.status === "ok" &&
    requiredFields.teacherAuthSession === "present" &&
    requiredFields.authProviderContract === "present" &&
    requiredFields.s12TeacherAuthIssuerBoundary === "present"
  );
}

function hasPassedReadinessResults(results) {
  if (!isRecord(results)) {
    return false;
  }
  return readinessResultKeys.every((key) => results[key] === "passed");
}

function hasTrustedCookieIssuerReadinessProofs(evidence) {
  return (
    evidence.vercelEnvSyncEvidence?.status === "matched" &&
    evidence.vercelEnvSyncEvidence?.applyPreflight === "proved" &&
    evidence.vercelEnvSyncEvidence?.releaseRunIdStatus === "matched" &&
    evidence.trustedIssuerContract?.issuerSecretStrength === "sufficient" &&
    evidence.trustedIssuerContract?.sessionIssuerSecretSeparation === "proved" &&
    evidence.trustedIssuerContract?.issuerProofRequired === true &&
    evidence.trustedIssuerContract?.issuerProofMaxAgeSeconds === 300 &&
    evidence.trustedIssuerContract?.issuerProofBoundsCookieMaxAge === true &&
    evidence.trustedIssuerContract?.valueRedacted === true &&
    evidence.trustedCookieSessionRoundTrip?.status === "proved" &&
    evidence.trustedCookieSessionRoundTrip?.cookieValuesEmitted === false &&
    evidence.trustedCookieSessionRoundTrip?.valuesRedacted === true &&
    evidence.trustedTeacherAuthRouteSmokeEvidence?.target === "teacher-auth-issuer-route-smoke" &&
    evidence.trustedTeacherAuthRouteSmokeEvidence?.status === "proved" &&
    evidence.trustedTeacherAuthRouteSmokeEvidence?.releaseRunIdStatus === "matched" &&
    evidence.trustedTeacherAuthRouteSmokeEvidence?.deploymentBinding === "proved" &&
    evidence.trustedTeacherAuthRouteSmokeEvidence?.teacherAuthIssuerRoute === "proved" &&
    evidence.trustedTeacherAuthRouteSmokeEvidence?.responseHeaders === "proved" &&
    evidence.trustedTeacherAuthRouteSmokeEvidence?.responseShape === "proved"
  );
}

function hasReadinessSafety(safety) {
  return (
    isRecord(safety) &&
    safety.valuesRedacted === true &&
    safety.secretsOmitted === true &&
    safety.providerUrlsOmitted === true &&
    safety.responseBodiesOmitted === true &&
    safety.localPrivatePathsOmitted === true &&
    safety.liveRequiresApproval === true &&
    safety.remoteMutationRequiresApproval === true &&
    safety.cookieValuesOmitted === true &&
    safety.noCookieIssued === true &&
    safety.cookiesOmitted === true
  );
}

function buildBlockedReasons({
  upstreamAppAuthEvidenceCleared,
  envSyncEvidenceAccepted,
  issuerRouteSmokeStatus,
  readinessEvidenceStatus,
  liveCookieIssuanceStillForbidden,
}) {
  const reasons = [];
  if (!upstreamAppAuthEvidenceCleared) {
    reasons.push("upstream-app-auth-production-evidence-not-cleared");
  }
  if (!envSyncEvidenceAccepted) {
    reasons.push("teacher-auth-vercel-env-sync-evidence-not-accepted");
  }
  if (issuerRouteSmokeStatus.status === "missing") {
    reasons.push("teacher-auth-issuer-route-smoke-evidence-missing");
  } else if (issuerRouteSmokeStatus.status !== "proved") {
    reasons.push(`teacher-auth-issuer-route-smoke-${issuerRouteSmokeStatus.status}`);
  }
  if (readinessEvidenceStatus.status === "missing") {
    reasons.push("teacher-auth-provider-readiness-evidence-missing");
  } else if (readinessEvidenceStatus.status !== "live-ready") {
    reasons.push(`teacher-auth-provider-readiness-${readinessEvidenceStatus.status}`);
  }
  if (!liveCookieIssuanceStillForbidden) {
    reasons.push("teacher-auth-live-cookie-issuance-separate-approval-not-preserved");
  }
  return reasons;
}

function readSafeNextAction({
  teacherAuthProductionEvidenceCleared,
  upstreamAppAuthEvidenceCleared,
  envSyncEvidenceAccepted,
  upstreamBlockingEvidence,
}) {
  if (teacherAuthProductionEvidenceCleared) {
    return "advance-external-storage-production-evidence-preflight";
  }
  if (!upstreamAppAuthEvidenceCleared) {
    return readString(
      upstreamBlockingEvidence?.safeNextAction,
      "wait-for-app-auth-production-evidence-before-teacher-auth",
    );
  }
  if (!envSyncEvidenceAccepted) {
    return readString(
      upstreamBlockingEvidence?.safeNextAction,
      "produce-teacher-auth-vercel-env-sync-evidence",
    );
  }
  return "produce-teacher-auth-route-smoke-and-provider-readiness-evidence";
}

function renderMarkdown(report) {
  const lines = [
    "# UAIS Teacher Auth Production Evidence Gate",
    "",
    `Status: \`${report.status}\``,
    `Env source label: \`${report.approvedServerOnlyEnvSourceLabel}\``,
    `Provider mode: \`${report.approvedProviderMode}\``,
    `Operator input required: \`${report.summary.operatorInputRequired}\``,
    `Safe next action: \`${report.safeNextAction}\``,
    `Teacher-auth evidence cleared: \`${report.summary.teacherAuthProductionEvidenceCleared}\``,
    `Release ready: \`${report.summary.releaseReady}\``,
    "",
    "## Issuer Route Smoke",
    "",
    `- Target: \`${report.issuerRouteSmokeStatus.target}\``,
    `- Status: \`${report.issuerRouteSmokeStatus.status}\``,
    `- Environment: \`${report.issuerRouteSmokeStatus.environment}\``,
    `- Release run: \`${report.issuerRouteSmokeStatus.releaseRunIdStatus}\``,
    "",
    "## Readiness Evidence",
    "",
    `- Target: \`${report.readinessEvidenceStatus.target}\``,
    `- Status: \`${report.readinessEvidenceStatus.status}\``,
    `- Mode: \`${report.readinessEvidenceStatus.mode}\``,
    `- Environment: \`${report.readinessEvidenceStatus.environment}\``,
    `- Release run: \`${report.readinessEvidenceStatus.releaseRunIdStatus}\``,
    "",
    "## Upstream Blocking Evidence",
    "",
    ...(report.upstreamBlockingEvidence
      ? [
          `- \`${report.upstreamBlockingEvidence.id}\`: \`${report.upstreamBlockingEvidence.label}\``,
        ]
      : ["- `none-recorded`"]),
    ...(report.upstreamBlockingEvidence &&
    Object.keys(report.upstreamBlockingEvidence.upstreamOperatorInputPacket ?? {}).length > 0
      ? [
          "",
          "## Upstream Operator Input Packet",
          "",
          `- Status: \`${report.upstreamBlockingEvidence.upstreamOperatorInputPacket.status}\``,
          `- First required input: \`${report.upstreamBlockingEvidence.upstreamOperatorInputPacket.firstRequiredInputId}\``,
          `- Next safe action: \`${report.upstreamBlockingEvidence.upstreamOperatorInputPacket.nextSafeAction}\``,
          `- Next command template: \`${report.upstreamBlockingEvidence.upstreamOperatorInputPacket.nextSafeCommandTemplateKey}\``,
          `- Values forbidden: \`${report.upstreamBlockingEvidence.upstreamOperatorInputPacket.valuesForbidden}\``,
          `- Preferred input mode: \`${report.upstreamBlockingEvidence.upstreamOperatorInputPacket.preferredInputMode ?? "not-recorded"}\``,
          `- Safe input instruction: ${report.upstreamBlockingEvidence.upstreamOperatorInputPacket.safeInputInstruction ?? "not-recorded"}`,
          `- Approved source label is evidence: \`${report.upstreamBlockingEvidence.upstreamOperatorInputPacket.approvedSourceLabelIsNotEvidence === true ? "false" : "not-recorded"}\``,
        ]
      : []),
    ...(report.upstreamBlockingEvidence &&
    Object.keys(report.upstreamBlockingEvidence.upstreamSafeCommandTemplates ?? {}).length > 0
      ? [
          "",
          "## Upstream Safe Operator Command Templates",
          "",
          ...Object.entries(report.upstreamBlockingEvidence.upstreamSafeCommandTemplates).map(
            ([name, command]) => `- \`${name}\`: \`${command}\``,
          ),
        ]
      : []),
    "",
    "## Blocked Reasons",
    "",
    ...(report.blockedReasons.length > 0
      ? report.blockedReasons.map((reason) => `- \`${reason}\``)
      : ["- None"]),
  ];

  return `${lines.join("\n")}\n`;
}

function readResultById(results, id) {
  return Array.isArray(results)
    ? results.find((result) => isRecord(result) && result.id === id)
    : undefined;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function readJsonArg(args, key) {
  const path = args[key];
  if (typeof path !== "string" || path.length === 0) {
    throw new Error(`Missing required --${key}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function readStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function readSafeCommandTemplates(value) {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      ([name, command]) =>
        /^[A-Za-z0-9._:-]+$/.test(name) &&
        typeof command === "string" &&
        !/\/Users\/|https?:\/\/|(?:SECRET|TOKEN|KEY|PASSWORD|COOKIE|CREDENTIAL)\s*=/i.test(
          command,
        ),
    ),
  );
}

function readSafeOperatorInputPacket(value) {
  if (!isRecord(value)) {
    return {};
  }
  return {
    target: readString(value.target, ""),
    status: readString(value.status, ""),
    firstRequiredInputId: readString(value.firstRequiredInputId, ""),
    approvedServerOnlyEnvSourceLabel: readString(value.approvedServerOnlyEnvSourceLabel, ""),
    acceptedInputModes: readStringArray(value.acceptedInputModes),
    requiredServerOnlyEnvNames: readStringArray(value.requiredServerOnlyEnvNames),
    nextSafeAction: readString(value.nextSafeAction, ""),
    nextSafeCommandTemplateKey: readString(value.nextSafeCommandTemplateKey, ""),
    ...(readString(value.preferredInputMode, "").length > 0
      ? { preferredInputMode: readString(value.preferredInputMode, "") }
      : {}),
    ...(readString(value.safeInputInstruction, "").length > 0
      ? { safeInputInstruction: readString(value.safeInputInstruction, "") }
      : {}),
    ...(value.approvedSourceLabelIsNotEvidence === true
      ? { approvedSourceLabelIsNotEvidence: true }
      : {}),
    valuesForbidden: value.valuesForbidden === true,
  };
}

main();
