#!/usr/bin/env node

import { readFileSync } from "node:fs";

const provedEvidence = [
  "live-teaching-operations-route-smoke",
  "live-teaching-operation-detail-browser-smoke",
  "live-teaching-course-management-route-smoke",
  "issued-teacher-auth-cookie-bound-to-ordinary-teaching-smokes",
  "same-vercel-production-deployment-bound-to-ordinary-teaching-smokes",
  "app-auth-provider-readiness-bound-to-ordinary-teaching-smokes",
  "teacher-auth-provider-readiness-bound-to-ordinary-teaching-smokes",
  "external-storage-readiness-bound-to-ordinary-teaching-smokes",
];

const smokeDefinitions = [
  {
    target: "teaching-operations-route-smoke",
    arg: "teaching-operations-route-smoke",
    statusKey: "teachingOperationsRouteSmokeStatus",
    providedKey: "teachingOperationsRouteSmokeProvided",
    acceptedKey: "teachingOperationsRouteSmokeAccepted",
    requiredFields: {
      teachingOperationsBackend: "external",
      teachingCourseManagementBackend: "external",
    },
  },
  {
    target: "teaching-operation-detail-browser-smoke",
    arg: "teaching-operation-detail-browser-smoke",
    statusKey: "operationDetailBrowserSmokeStatus",
    providedKey: "operationDetailBrowserSmokeProvided",
    acceptedKey: "operationDetailBrowserSmokeAccepted",
    requiredFields: {
      apiMode: "live-teaching-operations",
      teachingOperationDetailBackend: "external",
    },
  },
  {
    target: "teaching-course-management-route-smoke",
    arg: "teaching-course-management-route-smoke",
    statusKey: "courseManagementRouteSmokeStatus",
    providedKey: "courseManagementRouteSmokeProvided",
    acceptedKey: "courseManagementRouteSmokeAccepted",
    requiredFields: {
      teacherAiOwnershipBackend: "external",
      courseManagementBackend: "external",
      courseAssetsBackend: "external",
      teachingOperationsBackend: "external",
    },
  },
];

function main() {
  const args = parseArgs(process.argv.slice(2));
  const ordinaryTeachingPreflight = readJsonArg(args, "ordinary-teaching-preflight");
  const vercelEnvDeployProductionEvidenceGate =
    typeof args["vercel-env-deploy-production-evidence-gate"] === "string"
      ? readJsonArg(args, "vercel-env-deploy-production-evidence-gate")
      : undefined;
  const smokes = Object.fromEntries(
    smokeDefinitions.map((definition) => [
      definition.target,
      typeof args[definition.arg] === "string" ? readJsonArg(args, definition.arg) : undefined,
    ]),
  );
  const report = buildReport({
    ordinaryTeachingPreflight,
    vercelEnvDeployProductionEvidenceGate,
    smokes,
  });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(report));
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function buildReport({ ordinaryTeachingPreflight, vercelEnvDeployProductionEvidenceGate, smokes }) {
  const summary = isRecord(ordinaryTeachingPreflight.summary)
    ? ordinaryTeachingPreflight.summary
    : {};
  const ownerResponseAccepted = summary.ownerResponseAccepted === true;
  const ownerPrerequisitesAccepted = summary.ownerPrerequisitesAccepted === true;
  const upstreamProductionEvidenceCleared = summary.upstreamProductionEvidenceCleared === true;
  const smokeTargetsCleared = summary.smokeTargetsCleared === true;
  const ordinaryOwnerResponseCanBeAccepted = summary.ordinaryOwnerResponseCanBeAccepted === true;
  const approvedReleaseRunIdLabel = readString(
    ordinaryTeachingPreflight.approvedReleaseRunIdLabel,
    "",
  );
  const preflightReady =
    readString(ordinaryTeachingPreflight.status, "") ===
      "ordinary-teaching-production-evidence-preflight-ready" &&
    ownerResponseAccepted &&
    ownerPrerequisitesAccepted &&
    upstreamProductionEvidenceCleared &&
    smokeTargetsCleared &&
    ordinaryOwnerResponseCanBeAccepted;

  const smokeStatuses = Object.fromEntries(
    smokeDefinitions.map((definition) => [
      definition.statusKey,
      evaluateSmokeEvidence({
        definition,
        evidence: smokes[definition.target],
        approvedReleaseRunIdLabel,
      }),
    ]),
  );
  const evaluatedSmokes = smokeDefinitions.map((definition) => ({
    definition,
    evidence: smokes[definition.target],
    status: smokeStatuses[definition.statusKey],
  }));
  const acceptedByTarget = Object.fromEntries(
    evaluatedSmokes.map(({ definition, status }) => [
      definition.acceptedKey,
      status.status === "live-passed",
    ]),
  );
  const providedByTarget = Object.fromEntries(
    evaluatedSmokes.map(({ definition, evidence }) => [definition.providedKey, evidence !== undefined]),
  );
  const releaseRunBound = evaluatedSmokes.every(
    ({ status }) => status.releaseRunIdStatus === "matched",
  );
  const deploymentFingerprints = evaluatedSmokes
    .map(({ evidence }) => readDeploymentFingerprint(evidence))
    .filter((fingerprint) => fingerprint.length > 0);
  const deploymentBound =
    deploymentFingerprints.length === smokeDefinitions.length &&
    new Set(deploymentFingerprints).size === 1 &&
    evaluatedSmokes.every(({ status }) => status.deploymentBindingStatus === "matched");
  const ordinaryTeachingProductionEvidenceCleared =
    preflightReady &&
    Object.values(acceptedByTarget).every(Boolean) &&
    releaseRunBound &&
    deploymentBound;
  const upstreamProductionEvidenceRequired = !upstreamProductionEvidenceCleared && !preflightReady;
  const upstreamOperatorInputRequired =
    upstreamProductionEvidenceRequired &&
    vercelEnvDeployProductionEvidenceGate?.summary?.operatorInputRequired === true;
  const upstreamBlockingEvidence = upstreamProductionEvidenceRequired
    ? {
        id: "upstream-vercel-env-deploy-production-evidence-gate",
        label: "vercel-env-deploy-production-evidence-gate",
        reason:
          "Ordinary teaching production evidence must wait for auth, external storage, and Vercel deployment evidence before live teaching smokes can be requested.",
        valuesForbidden: true,
        upstreamStatus: readString(vercelEnvDeployProductionEvidenceGate?.status, "unknown"),
        safeNextAction: readString(vercelEnvDeployProductionEvidenceGate?.safeNextAction, ""),
        upstreamOperatorInputRequired,
        upstreamMissingEvidence: readStringArray(
          vercelEnvDeployProductionEvidenceGate?.upstreamBlockingEvidence
            ?.upstreamMissingEvidence,
        ),
        upstreamOperatorInputPacket: readSafeOperatorInputPacket(
          vercelEnvDeployProductionEvidenceGate?.upstreamBlockingEvidence
            ?.upstreamOperatorInputPacket,
        ),
        upstreamSafeCommandTemplates: readSafeCommandTemplates(
          vercelEnvDeployProductionEvidenceGate?.upstreamBlockingEvidence
            ?.upstreamSafeCommandTemplates,
        ),
      }
    : null;

  return {
    target: "ordinary-teaching-production-evidence-gate",
    status: readStatus({
      ordinaryTeachingProductionEvidenceCleared,
      preflightReady,
    }),
    releaseReady: false,
    responsibleSession: "S22/S11/S24",
    approvedReleaseRunIdLabel,
    summary: {
      operatorInputRequired: upstreamOperatorInputRequired,
      blockingInputRequired: upstreamOperatorInputRequired,
      ownerResponseAccepted,
      ownerPrerequisitesAccepted,
      upstreamProductionEvidenceCleared,
      preflightReady,
      ...providedByTarget,
      ...acceptedByTarget,
      releaseRunBound,
      deploymentBound,
      ordinaryTeachingProductionEvidenceCleared,
      releaseReady: false,
    },
    ...smokeStatuses,
    upstreamBlockingEvidence,
    provedEvidence: ordinaryTeachingProductionEvidenceCleared ? provedEvidence : [],
    blockedReasons: buildBlockedReasons({
      ownerResponseAccepted,
      ownerPrerequisitesAccepted,
      upstreamProductionEvidenceCleared,
      smokeTargetsCleared,
      preflightReady,
      evaluatedSmokes,
      releaseRunBound,
      deploymentBound,
      ordinaryTeachingProductionEvidenceCleared,
    }),
    safeNextAction: readSafeNextAction({
      ordinaryTeachingProductionEvidenceCleared,
      preflightReady,
      upstreamBlockingEvidence,
    }),
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      deploymentUrlsOmitted: true,
      credentialValuesOmitted: true,
      cookieValuesOmitted: true,
      responseBodiesOmitted: true,
      envFileRead: false,
      vercelApiCalled: false,
      providerNetworkCallPerformed: false,
      noRemoteWritePerformed: true,
      noLiveSmokePerformed: true,
      noDeploymentMutationPerformed: true,
      noReleaseRunBindingPerformed: true,
    },
  };
}

function readStatus({ ordinaryTeachingProductionEvidenceCleared, preflightReady }) {
  if (ordinaryTeachingProductionEvidenceCleared) {
    return "ordinary-teaching-production-evidence-gate-cleared";
  }
  if (!preflightReady) {
    return "ordinary-teaching-production-evidence-gate-waiting-for-upstream-production-evidence";
  }
  return "ordinary-teaching-production-evidence-gate-awaiting-live-smoke-evidence";
}

function evaluateSmokeEvidence({ definition, evidence, approvedReleaseRunIdLabel }) {
  if (evidence === undefined) {
    return {
      target: definition.target,
      status: "missing",
      environment: "missing",
      releaseRunIdStatus: "missing",
      deploymentBindingStatus: "missing",
      valueRedacted: true,
    };
  }

  const base = {
    target: readString(evidence.target, "missing"),
    environment: readString(evidence.environment, "missing"),
    releaseRunIdStatus:
      evidence.releaseRunId === approvedReleaseRunIdLabel ? "matched" : "mismatched",
    deploymentBindingStatus: readDeploymentBindingStatus(evidence),
    valueRedacted: true,
  };
  if (base.target !== definition.target) {
    return { ...base, status: "invalid-target" };
  }
  if (evidence.mode !== "live" || evidence.environment !== "production" || evidence.status !== "passed") {
    return { ...base, status: "not-live-production-passed" };
  }
  if (base.releaseRunIdStatus !== "matched") {
    return { ...base, status: "release-run-id-mismatch" };
  }
  if (base.deploymentBindingStatus !== "matched") {
    return { ...base, status: "deployment-binding-missing" };
  }
  if (!hasMatchedReadinessEvidence(evidence.appAuthProviderReadinessEvidence, "app-auth-provider-readiness")) {
    return { ...base, status: "app-auth-readiness-binding-missing" };
  }
  if (
    !hasMatchedReadinessEvidence(
      evidence.teacherAuthProviderReadinessEvidence,
      "teacher-auth-provider-readiness",
    )
  ) {
    return { ...base, status: "teacher-auth-readiness-binding-missing" };
  }
  if (
    !hasMatchedReadinessEvidence(
      evidence.externalStorageServiceReadinessEvidence,
      "external-storage-service-readiness",
    )
  ) {
    return { ...base, status: "external-storage-readiness-binding-missing" };
  }
  if (evidence.teacherAuthCookieStatus !== "issued-redacted") {
    return { ...base, status: "teacher-auth-cookie-not-issued-redacted" };
  }
  if (!hasRequiredFields(evidence, definition.requiredFields)) {
    return { ...base, status: "ordinary-teaching-backend-proof-missing" };
  }
  if (!hasOkResult(evidence.results, `${definition.target}-live-check`)) {
    return { ...base, status: "result-proof-missing" };
  }
  if (!hasSafety(evidence.safety)) {
    return { ...base, status: "redaction-safety-missing" };
  }
  return { ...base, status: "live-passed" };
}

function readDeploymentBindingStatus(evidence) {
  const deploymentEvidence = isRecord(evidence?.vercelProductionDeploymentEvidence)
    ? evidence.vercelProductionDeploymentEvidence
    : {};
  const deploymentFingerprint = readDeploymentFingerprint(evidence);
  const deploymentEvidenceFingerprint = readString(
    deploymentEvidence.deploymentFingerprint,
    "",
  );
  return readString(deploymentEvidence.target, "") === "vercel-production-deployment" &&
    readString(deploymentEvidence.status, "") === "matched" &&
    readString(deploymentEvidence.releaseRunIdStatus, "") === "matched" &&
    readString(deploymentEvidence.deploymentFingerprintStatus, "") === "matched" &&
    deploymentFingerprint.length > 0 &&
    deploymentEvidenceFingerprint === deploymentFingerprint
    ? "matched"
    : "missing";
}

function hasMatchedReadinessEvidence(evidence, target) {
  return (
    isRecord(evidence) &&
    readString(evidence.target, "") === target &&
    readString(evidence.status, "") === "matched" &&
    readString(evidence.releaseRunIdStatus, "") === "matched" &&
    evidence.valueRedacted === true
  );
}

function hasRequiredFields(evidence, requiredFields) {
  return Object.entries(requiredFields).every(([fieldName, expectedValue]) => {
    return evidence[fieldName] === expectedValue;
  });
}

function hasOkResult(results, expectedId) {
  return (
    Array.isArray(results) &&
    results.some((result) => isRecord(result) && result.id === expectedId && result.status === "ok")
  );
}

function hasSafety(safety) {
  return (
    isRecord(safety) &&
    safety.secretsRedacted === true &&
    safety.deploymentUrlOmitted === true &&
    safety.cookieValuesOmitted === true &&
    safety.responseBodiesOmitted === true &&
    safety.localPrivatePathsOmitted === true
  );
}

function readDeploymentFingerprint(evidence) {
  return isRecord(evidence) ? readString(evidence.deploymentFingerprint, "") : "";
}

function buildBlockedReasons({
  ownerResponseAccepted,
  ownerPrerequisitesAccepted,
  upstreamProductionEvidenceCleared,
  smokeTargetsCleared,
  preflightReady,
  evaluatedSmokes,
  releaseRunBound,
  deploymentBound,
  ordinaryTeachingProductionEvidenceCleared,
}) {
  if (ordinaryTeachingProductionEvidenceCleared) {
    return [];
  }
  return uniqueStrings([
    ...(!upstreamProductionEvidenceCleared ? ["upstream-production-evidence-not-cleared"] : []),
    ...(!ownerResponseAccepted ? ["ordinary-owner-response-not-accepted"] : []),
    ...(!ownerPrerequisitesAccepted ? ["ordinary-owner-prerequisites-not-accepted"] : []),
    ...(!smokeTargetsCleared ? ["ordinary-live-smoke-targets-not-cleared"] : []),
    ...evaluatedSmokes
      .filter(({ status }) => status.status !== "live-passed")
      .map(({ definition, status }) =>
        status.status === "missing" ? `${definition.target}-missing` : `${definition.target}-${status.status}`,
      ),
    ...(preflightReady && !releaseRunBound ? ["ordinary-teaching-release-run-binding-missing"] : []),
    ...(preflightReady && !deploymentBound ? ["ordinary-teaching-deployment-binding-missing"] : []),
  ]);
}

function readSafeNextAction({
  ordinaryTeachingProductionEvidenceCleared,
  preflightReady,
  upstreamBlockingEvidence,
}) {
  if (ordinaryTeachingProductionEvidenceCleared) {
    return "advance-enterprise-live-evidence-audit-preflight";
  }
  if (!preflightReady) {
    return readString(
      upstreamBlockingEvidence?.safeNextAction,
      "wait-for-auth-storage-and-vercel-deployment-evidence",
    );
  }
  return "run-live-ordinary-teaching-smokes-with-issued-teacher-auth-cookie";
}

function renderMarkdown(report) {
  const lines = [
    "# UAIS Ordinary Teaching Production Evidence Gate",
    "",
    `Status: \`${report.status}\``,
    `Release ready: \`${report.summary.releaseReady}\``,
    `Operator input required: \`${report.summary.operatorInputRequired}\``,
    `Safe next action: \`${report.safeNextAction}\``,
    `Preflight ready: \`${report.summary.preflightReady}\``,
    `Upstream production evidence cleared: \`${report.summary.upstreamProductionEvidenceCleared}\``,
    `Teaching operations smoke accepted: \`${report.summary.teachingOperationsRouteSmokeAccepted}\``,
    `Operation detail smoke accepted: \`${report.summary.operationDetailBrowserSmokeAccepted}\``,
    `Course management smoke accepted: \`${report.summary.courseManagementRouteSmokeAccepted}\``,
    `Release run bound: \`${report.summary.releaseRunBound}\``,
    `Deployment bound: \`${report.summary.deploymentBound}\``,
    "",
    "This gate reads only redacted evidence reports. It does not read env files, print URLs, issue cookies, call Vercel, perform live smokes, deploy, or bind a release run.",
    "",
    "## Smoke Status",
    "",
    "| Smoke | Status | Release run | Deployment |",
    "| --- | --- | --- | --- |",
    ...smokeDefinitions.map((definition) => {
      const status = report[definition.statusKey];
      return `| \`${definition.target}\` | \`${status.status}\` | \`${status.releaseRunIdStatus}\` | \`${status.deploymentBindingStatus}\` |`;
    }),
    "",
    "## Proved Evidence",
    "",
    ...formatBullets(report.provedEvidence),
    "",
    "## Blocked Reasons",
    "",
    ...formatBullets(report.blockedReasons),
    "",
    "## Safe Next Action",
    "",
    `- \`${report.safeNextAction}\``,
    "",
  ];

  if (report.upstreamBlockingEvidence) {
    lines.push(
      "## Upstream Blocking Evidence",
      "",
      `- \`${report.upstreamBlockingEvidence.id}\`: \`${report.upstreamBlockingEvidence.label}\``,
      `- Safe next action: \`${report.upstreamBlockingEvidence.safeNextAction}\``,
      "",
    );
    if (Object.keys(report.upstreamBlockingEvidence.upstreamOperatorInputPacket ?? {}).length > 0) {
      lines.push(
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
        "",
      );
    }
    if (
      Object.keys(report.upstreamBlockingEvidence.upstreamSafeCommandTemplates ?? {}).length > 0
    ) {
      lines.push(
        "## Upstream Safe Operator Command Templates",
        "",
        ...Object.entries(report.upstreamBlockingEvidence.upstreamSafeCommandTemplates).map(
          ([name, command]) => `- \`${name}\`: \`${command}\``,
        ),
        "",
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

function formatBullets(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return ["- `none-recorded`"];
  }
  return values.map((value) => `- \`${value}\``);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (typeof next === "string" && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function readJsonArg(args, key) {
  const filePath = args[key];
  if (typeof filePath !== "string") {
    throw new Error(`Missing required --${key} path`);
  }
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readString(value, fallback = "") {
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

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
