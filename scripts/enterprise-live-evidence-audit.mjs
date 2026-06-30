#!/usr/bin/env node

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const requiredSafetyFlags = [
  "valuesRedacted",
  "cookieValuesOmitted",
  "responseBodiesOmitted",
  "liveRequiresApproval",
  "remoteMutationRequiresApproval",
];
const requiredEnterpriseLiveEvidenceTargets = [
  "app-auth-provider-readiness",
  "teacher-auth-issuer-route-smoke",
  "teacher-auth-provider-readiness",
  "external-storage-persistence",
  "external-storage-service-readiness",
  "deployment-domain-reachability",
  "teacher-workflow-deployment-smoke",
  "teacher-workflow-browser-smoke",
  "teacher-workflow-live-generation-smoke",
  "learning-ppt-playback-deployment-smoke",
  "ppt-manual-playback-acceptance",
  "deployment-route-smoke",
  "teaching-operations-route-smoke",
  "teaching-operation-detail-browser-smoke",
  "teaching-course-management-route-smoke",
  "external-storage-smoke",
];
const acceptedTargetStatuses = {
  "app-auth-provider-readiness": "ready",
  "teacher-auth-provider-readiness": "ready",
  "external-storage-service-readiness": "ready",
  "deployment-domain-reachability": "reachable",
  "ppt-manual-playback-acceptance": "accepted",
};
const acceptedTargetModes = {
  "ppt-manual-playback-acceptance": "record",
};
const requiredAppAuthProviderReadinessResultKeys = [
  "appAuthProviderModeTrusted",
  "appAuthProviderEndpointRemoteHttps",
  "appAuthSessionCookieContract",
  "appAuthProviderVercelEnvSync",
  "trustedAccountProviderContract",
  "appAuthReadinessSafety",
];
const requiredTeacherAuthProviderReadinessResultKeys = [
  "teacherAuthProviderModeSupported",
  "teacherAuthSessionCookieContract",
  "teacherAuthProviderVercelEnvSync",
  "teacherAuthProviderSpecificContract",
  "teacherAuthProviderRouteBinding",
  "teacherAuthReadinessSafety",
];
const requiredExternalStorageServiceReadinessResultKeys = [
  "externalStorageEndpointRemoteHttps",
  "externalStorageHealthContract",
  "externalStorageOrdinaryTeachingSchemas",
  "externalStorageTeachingOperationsSchema",
  "externalStorageTeachingCourseManagementSchema",
  "externalStorageTeachingCourseAssetsSchema",
  "externalStorageVercelEnvSync",
  "externalStorageProductionLaunchContract",
  "externalStoragePersistenceEvidence",
  "externalStorageReadinessSafety",
];
const requiredDeploymentDomainReachabilityResultKeys = [
  "deploymentDomainOriginRemoteHttps",
  "deploymentDomainDnsOriginReachable",
  "deploymentDomainTransportConnected",
  "deploymentDomainRootHttpReachable",
  "deploymentDomainTeachingHttpReachable",
  "deploymentDomainLearningHttpReachable",
  "deploymentDomainFingerprintBound",
  "deploymentDomainReadinessSafety",
];
const requiredPptManualPlaybackAcceptanceResultKeys = [
  "manualPptMachinePreflightPassed",
  "manualPptOpenxmlIntegrityPassed",
  "manualPptRecordEvidenceComplete",
  "manualPptPackageIdentityMatched",
  "manualPptArtifactFingerprintMatched",
  "manualPptTimingValid",
  "manualPptHumanConfirmationAccepted",
  "manualPptTargetVoiceLabelPresent",
  "manualPptPowerPointPlaybackAccepted",
  "manualPptWpsPlaybackAccepted",
  "manualPptReleaseRunBound",
  "manualPptDeploymentFingerprintBound",
  "manualPptTestedAfterDeployment",
  "manualPptDeploymentEvidenceSourceProduction",
  "manualPptSafetyRedacted",
];
const requiredExternalStoragePersistenceResultIds = [
  "s22-external-storage-persistence-health",
  "s22-external-storage-persisted-ownership-read",
  "s24-external-storage-persisted-audit-read",
];
const requiredTeacherAuthIssuerRouteSmokeResultIds = [
  "s22-teacher-auth-issuer-route",
];
const releaseGateSource = readFileSync(
  new URL("./production-e2e-release-gate.mjs", import.meta.url),
  "utf8",
);
const teachingOperationsRouteSmokeSource = readFileSync(
  new URL("./teaching-operations-route-smoke.mjs", import.meta.url),
  "utf8",
);

function readConstStringArrayFromSource({ source, name, sourceLabel }) {
  const match = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  if (!match) {
    throw new Error(`Missing ${sourceLabel}: ${name}`);
  }

  return [...match[1].matchAll(/"([^"]+)"/g)].map(([, value]) => value);
}

function readReleaseGateRequiredResults(name) {
  return readConstStringArrayFromSource({
    source: releaseGateSource,
    name,
    sourceLabel: "production release gate result list",
  });
}

function readReleaseGateRequiredObjectValues(name, field) {
  const match = releaseGateSource.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  if (!match) {
    throw new Error(`Missing production release gate object list: ${name}`);
  }

  return [...match[1].matchAll(new RegExp(`${field}: "([^"]+)"`, "g"))].map(
    ([, value]) => value,
  );
}

const requiredTargetResultKeys = {
  "app-auth-provider-readiness": requiredAppAuthProviderReadinessResultKeys,
  "teacher-auth-provider-readiness": requiredTeacherAuthProviderReadinessResultKeys,
  "external-storage-service-readiness": requiredExternalStorageServiceReadinessResultKeys,
  "deployment-domain-reachability": requiredDeploymentDomainReachabilityResultKeys,
  "deployment-route-smoke": readReleaseGateRequiredResults(
    "requiredRouteSmokeIds",
  ),
  "teacher-auth-issuer-route-smoke": requiredTeacherAuthIssuerRouteSmokeResultIds,
  "teacher-workflow-deployment-smoke": readReleaseGateRequiredResults(
    "requiredDeployedTeacherWorkflowAnchors",
  ),
  "teacher-workflow-browser-smoke": readReleaseGateRequiredResults(
    "requiredTeacherWorkflowBrowserResults",
  ),
  "teacher-workflow-live-generation-smoke": readReleaseGateRequiredResults(
    "requiredTeacherWorkflowLiveGenerationResults",
  ),
  "learning-ppt-playback-deployment-smoke": readReleaseGateRequiredResults(
    "requiredLearningPptPlaybackResults",
  ),
  "ppt-manual-playback-acceptance": requiredPptManualPlaybackAcceptanceResultKeys,
  "external-storage-persistence": requiredExternalStoragePersistenceResultIds,
  "teaching-operations-route-smoke": readReleaseGateRequiredResults(
    "requiredTeachingOperationsRouteSmokeResults",
  ),
  "teaching-operation-detail-browser-smoke": readReleaseGateRequiredResults(
    "requiredTeachingOperationDetailBrowserResults",
  ),
  "teaching-course-management-route-smoke": readReleaseGateRequiredResults(
    "requiredTeachingCourseManagementRouteSmokeResults",
  ),
  "external-storage-smoke": readReleaseGateRequiredResults(
    "requiredExternalStorageSmokeIds",
  ),
};
const requiredTeachingOperationsRouteSmokeEnvKeys = readReleaseGateRequiredResults(
  "requiredTeachingOperationsRouteSmokeEnvNames",
);
const requiredTeachingOperationsRouteSmokeRoutes = readReleaseGateRequiredResults(
  "requiredTeachingOperationsRouteSmokeRoutes",
);
const requiredTeachingOperationsRouteSmokeRouteContractKeys =
  requiredTeachingOperationsRouteSmokeRoutes.map((route) => `route:${route}`);
const requiredTeachingCourseManagementRouteSmokeEnvKeys = readReleaseGateRequiredResults(
  "requiredTeachingCourseManagementRouteSmokeEnvNames",
);
const requiredTeachingCourseManagementRouteSmokeRoutes = readReleaseGateRequiredResults(
  "requiredTeachingCourseManagementRouteSmokeRoutes",
);
const requiredTeachingCourseManagementRouteSmokeRouteContractKeys =
  requiredTeachingCourseManagementRouteSmokeRoutes.map((route) => `route:${route}`);
const requiredTargetEnvKeys = {
  "teaching-operations-route-smoke": requiredTeachingOperationsRouteSmokeEnvKeys,
  "teaching-course-management-route-smoke":
    requiredTeachingCourseManagementRouteSmokeEnvKeys,
};
const requiredTeachingOperationDetailBrowserContractKeys = [
  "route",
  "operationId",
  "auth",
  "apiInterceptionPolicy",
  "deploymentOrigin",
  "vercelProductionDeploymentEvidence",
  "deploymentDomainReachabilityEvidence",
  "teacherAuthProviderReadinessEvidence",
  "appAuthProviderReadinessEvidence",
  "operationCoverage",
];
const requiredTeachingOperationDetailCoverageOperationIds =
  readReleaseGateRequiredObjectValues(
    "requiredTeachingOperationDetailCoverage",
    "operationId",
  );
const requiredTeachingOperationsRouteSmokeProofs = readConstStringArrayFromSource({
  source: teachingOperationsRouteSmokeSource,
  name: "proves",
  sourceLabel: "teaching operations route-smoke proof list",
});
const requiredTeachingCourseManagementRouteSmokeProofs = readReleaseGateRequiredResults(
  "requiredTeachingCourseManagementRouteSmokeProofs",
);
const requiredTargetContractKeys = {
  "teaching-operations-route-smoke": [
    ...requiredTeachingOperationsRouteSmokeProofs,
    ...requiredTeachingOperationsRouteSmokeRouteContractKeys,
  ],
  "teaching-course-management-route-smoke": [
    ...requiredTeachingCourseManagementRouteSmokeProofs,
    ...requiredTeachingCourseManagementRouteSmokeRouteContractKeys,
  ],
  "teaching-operation-detail-browser-smoke":
    requiredTeachingOperationDetailBrowserContractKeys,
};
const externalModeTeachingOperationsRouteSmokeEnvKeys = new Set([
  "UAIS_TEACHING_OPERATIONS_BACKEND",
  "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
  "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER",
  "UAIS_STUDENT_ROSTER_SYNC_PROVIDER",
  "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER",
  "UAIS_GRADEBOOK_RELEASE_PROVIDER",
  "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER",
  "UAIS_COURSE_EXPORT_PROVIDER",
  "UAIS_GRADING_FEEDBACK_PROVIDER",
]);
const redactedTeachingOperationsRouteSmokeEnvKeys = new Set([
  "UAIS_EXTERNAL_STORAGE_BASE_URL",
  "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
  "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_URL",
  "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN",
  "UAIS_COLLABORATION_INVITE_EMAIL_CALLBACK_TOKEN",
  "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_URL",
  "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_TOKEN",
  "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_URL",
  "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_TOKEN",
  "UAIS_GRADEBOOK_RELEASE_PROVIDER_URL",
  "UAIS_GRADEBOOK_RELEASE_PROVIDER_TOKEN",
  "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_URL",
  "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_TOKEN",
  "UAIS_COURSE_EXPORT_PROVIDER_URL",
  "UAIS_COURSE_EXPORT_PROVIDER_TOKEN",
  "UAIS_GRADING_FEEDBACK_PROVIDER_URL",
  "UAIS_GRADING_FEEDBACK_PROVIDER_TOKEN",
  "UAIS_TEACHING_OPERATIONS_SMOKE_COOKIE",
  "UAIS_TEACHING_OPERATIONS_SMOKE_STUDENT_COOKIE",
]);
const externalModeTeachingCourseManagementRouteSmokeEnvKeys = new Set([
  "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
  "UAIS_TEACHING_COURSE_ASSETS_BACKEND",
  "UAIS_TEACHING_OPERATIONS_BACKEND",
  "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
]);
const redactedTeachingCourseManagementRouteSmokeEnvKeys = new Set([
  "UAIS_EXTERNAL_STORAGE_BASE_URL",
  "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
  "UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_COOKIE",
  "UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_TEACHER_ID",
  "UAIS_TEACHING_COURSE_MANAGEMENT_OTHER_TEACHER_SMOKE_COOKIE",
  "UAIS_TEACHING_COURSE_MANAGEMENT_OTHER_TEACHER_SMOKE_TEACHER_ID",
  "UAIS_TEACHING_COURSE_MANAGEMENT_STUDENT_SMOKE_COOKIE",
  "UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_STUDENT_ID",
]);
const arrayResultTargets = new Set([
  "deployment-route-smoke",
  "teacher-auth-issuer-route-smoke",
  "external-storage-persistence",
  "external-storage-smoke",
]);
const presentResultTargets = new Set([
  "teacher-workflow-deployment-smoke",
]);

function readFlag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function failUsage(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 2;
}

function readNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "missing";
}

function readReleaseRunId(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  const releaseRunId = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(releaseRunId)
    ? releaseRunId
    : undefined;
}

function readReleaseRunIdStatus(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "missing";
  }
  return readReleaseRunId(value) ? "present" : "invalid";
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readAcceptedTargetStatus(target) {
  return acceptedTargetStatuses[target] ?? "passed";
}

function readAcceptedTargetMode(target) {
  return acceptedTargetModes[target] ?? "live";
}

function readEvidenceJson(filePath) {
  try {
    return { value: JSON.parse(readFileSync(filePath, "utf8")) };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "unknown-json-read-error",
    };
  }
}

function readSafetyStatus(evidence) {
  if (!evidence || typeof evidence !== "object") {
    return "missing";
  }
  const safety = evidence.safety;
  if (!safety || typeof safety !== "object") {
    return "missing";
  }
  return requiredSafetyFlags.every((flag) => safety[flag] === true) ? "proved" : "missing";
}

function readTargetResultProof({ evidence, target }) {
  const requiredKeys = requiredTargetResultKeys[target] ?? [];
  if (requiredKeys.length === 0) {
    return {
      targetResultStatus: "not-required",
      missingResultKeys: [],
    };
  }
  const results = evidence?.results;
  if (arrayResultTargets.has(target)) {
    if (!Array.isArray(results)) {
      return {
        targetResultStatus: "missing",
        missingResultKeys: requiredKeys,
      };
    }
    const okResultIds = new Set(
      results
        .filter(
          (result) =>
            result &&
            typeof result === "object" &&
            !Array.isArray(result) &&
            result.status === "ok" &&
            typeof result.id === "string",
        )
        .map((result) => result.id),
    );
    const missingResultKeys = requiredKeys.filter((key) => !okResultIds.has(key));
    return {
      targetResultStatus: missingResultKeys.length === 0 ? "proved" : "missing",
      missingResultKeys,
    };
  }
  if (presentResultTargets.has(target)) {
    if (!results || typeof results !== "object" || Array.isArray(results)) {
      return {
        targetResultStatus: "missing",
        missingResultKeys: requiredKeys,
      };
    }
    const missingResultKeys = requiredKeys.filter((key) => results[key] !== "present");
    return {
      targetResultStatus: missingResultKeys.length === 0 ? "proved" : "missing",
      missingResultKeys,
    };
  }
  if (!results || typeof results !== "object" || Array.isArray(results)) {
    return {
      targetResultStatus: "missing",
      missingResultKeys: requiredKeys,
    };
  }
  const missingResultKeys = requiredKeys.filter((key) => results[key] !== "passed");
  return {
    targetResultStatus: missingResultKeys.length === 0 ? "proved" : "missing",
    missingResultKeys,
  };
}

function readTargetEnvProof({ evidence, target }) {
  const requiredKeys = requiredTargetEnvKeys[target] ?? [];
  if (requiredKeys.length === 0) {
    return {
      targetEnvStatus: "not-required",
      missingEnvKeys: [],
    };
  }

  const entries = Array.isArray(evidence?.requiredEnv)
    ? evidence.requiredEnv.filter(
        (entry) => entry && typeof entry === "object" && !Array.isArray(entry),
      )
    : [];
  const entriesByName = new Map(
    entries
      .filter((entry) => typeof entry.name === "string")
      .map((entry) => [entry.name, entry]),
  );
  const missingEnvKeys = requiredKeys.filter((key) => {
    const entry = entriesByName.get(key);
    if (!entry || entry.status !== "present") {
      return true;
    }
    if (isTargetExternalModeEnvKey({ target, key }) && entry.requiredValue !== "external") {
      return true;
    }
    return isTargetRedactedEnvKey({ target, key }) && entry.valueRedacted !== true;
  });

  return {
    targetEnvStatus: missingEnvKeys.length === 0 ? "proved" : "missing",
    missingEnvKeys,
  };
}

function readTargetContractProof({ evidence, target }) {
  const requiredKeys = requiredTargetContractKeys[target] ?? [];
  if (requiredKeys.length === 0) {
    return {
      targetContractStatus: "not-required",
      missingContractKeys: [],
    };
  }

  if (target === "teaching-operations-route-smoke") {
    const proofSet = new Set(Array.isArray(evidence?.proves) ? evidence.proves : []);
    const routeSet = new Set(Array.isArray(evidence?.routes) ? evidence.routes : []);
    const missingProofKeys = requiredTeachingOperationsRouteSmokeProofs.filter(
      (key) => !proofSet.has(key),
    );
    const missingRouteKeys = requiredTeachingOperationsRouteSmokeRoutes
      .filter((route) => !routeSet.has(route))
      .map((route) => `route:${route}`);
    const missingContractKeys = [...missingProofKeys, ...missingRouteKeys];
    return {
      targetContractStatus: missingContractKeys.length === 0 ? "proved" : "missing",
      missingContractKeys,
    };
  }

  if (target === "teaching-course-management-route-smoke") {
    const proofSet = new Set(Array.isArray(evidence?.proves) ? evidence.proves : []);
    const routeSet = new Set(Array.isArray(evidence?.routes) ? evidence.routes : []);
    const missingProofKeys = requiredTeachingCourseManagementRouteSmokeProofs.filter(
      (key) => !proofSet.has(key),
    );
    const missingRouteKeys = requiredTeachingCourseManagementRouteSmokeRoutes
      .filter((route) => !routeSet.has(route))
      .map((route) => `route:${route}`);
    const missingContractKeys = [...missingProofKeys, ...missingRouteKeys];
    return {
      targetContractStatus: missingContractKeys.length === 0 ? "proved" : "missing",
      missingContractKeys,
    };
  }

  if (target !== "teaching-operation-detail-browser-smoke") {
    return {
      targetContractStatus: "missing",
      missingContractKeys: requiredKeys,
    };
  }

  const missingContractKeys = [];
  if (!(typeof evidence?.route === "string" && evidence.route.startsWith("/teaching/"))) {
    missingContractKeys.push("route");
  }
  if (!(typeof evidence?.operationId === "string" && evidence.operationId.trim())) {
    missingContractKeys.push("operationId");
  }
  if (evidence?.auth !== "issued-teacher-auth-cookie") {
    missingContractKeys.push("auth");
  }
  if (!isTeachingOperationDetailBrowserApiInterceptionPolicyProved(evidence)) {
    missingContractKeys.push("apiInterceptionPolicy");
  }
  if (!isTeachingOperationDetailBrowserDeploymentOriginProved(evidence)) {
    missingContractKeys.push("deploymentOrigin");
  }
  if (!isTeachingOperationDetailBrowserVercelDeploymentEvidenceProved(evidence)) {
    missingContractKeys.push("vercelProductionDeploymentEvidence");
  }
  if (!isTeachingOperationDetailBrowserDeploymentDomainEvidenceProved(evidence)) {
    missingContractKeys.push("deploymentDomainReachabilityEvidence");
  }
  if (!isTeachingOperationDetailBrowserTeacherAuthEvidenceProved(evidence)) {
    missingContractKeys.push("teacherAuthProviderReadinessEvidence");
  }
  if (!isTeachingOperationDetailBrowserAppAuthEvidenceProved(evidence)) {
    missingContractKeys.push("appAuthProviderReadinessEvidence");
  }
  if (!isTeachingOperationDetailBrowserCoverageProved(evidence)) {
    missingContractKeys.push("operationCoverage");
  }

  return {
    targetContractStatus: missingContractKeys.length === 0 ? "proved" : "missing",
    missingContractKeys,
  };
}

function isTeachingOperationDetailBrowserApiInterceptionPolicyProved(evidence) {
  const policy = isRecord(evidence?.apiInterceptionPolicy)
    ? evidence.apiInterceptionPolicy
    : {};
  return (
    policy.operationApi === "live-teaching-operations" &&
    policy.courseManagementApi === "live-teaching-course-management" &&
    policy.auditReadback === "live-teaching-operations" &&
    policy.auditAlertReadback === "live-teaching-operations" &&
    policy.alertNotificationOutbox === "live-teaching-operations" &&
    policy.failureProbe === "browser-negative-response" &&
    policy.remoteMutations === "live-approved-teaching-operation" &&
    policy.responseBodiesOmitted === true
  );
}

function isTeachingOperationDetailBrowserDeploymentOriginProved(evidence) {
  const deploymentOrigin = isRecord(evidence?.deploymentOrigin)
    ? evidence.deploymentOrigin
    : {};
  return (
    deploymentOrigin.status === "present" &&
    deploymentOrigin.originClass === "remote-https" &&
    deploymentOrigin.valueRedacted === true
  );
}

function isTeachingOperationDetailBrowserVercelDeploymentEvidenceProved(evidence) {
  const binding = isRecord(evidence?.vercelProductionDeploymentEvidence)
    ? evidence.vercelProductionDeploymentEvidence
    : {};
  return (
    binding.target === "vercel-production-deployment" &&
    (binding.status === "matched" || binding.status === "matched-via-domain-reachability") &&
    binding.deploymentObservationStatus === "observed" &&
    binding.releaseRunIdStatus === "matched" &&
    binding.valueRedacted === true
  );
}

function isTeachingOperationDetailBrowserDeploymentDomainEvidenceProved(evidence) {
  const binding = isRecord(evidence?.deploymentDomainReachabilityEvidence)
    ? evidence.deploymentDomainReachabilityEvidence
    : {};
  return (
    binding.target === "deployment-domain-reachability" &&
    binding.status === "matched" &&
    binding.releaseRunIdStatus === "matched" &&
    binding.deploymentFingerprintStatus === "matched" &&
    binding.valueRedacted === true
  );
}

function isTeachingOperationDetailBrowserTeacherAuthEvidenceProved(evidence) {
  const binding = isRecord(evidence?.teacherAuthProviderReadinessEvidence)
    ? evidence.teacherAuthProviderReadinessEvidence
    : {};
  return (
    binding.target === "teacher-auth-provider-readiness" &&
    binding.status === "matched" &&
    (binding.authProviderMode === "trusted-cookie-issuer" ||
      binding.authProviderMode === "oidc-jwks") &&
    binding.releaseRunIdStatus === "matched" &&
    binding.valueRedacted === true
  );
}

function isTeachingOperationDetailBrowserAppAuthEvidenceProved(evidence) {
  const binding = isRecord(evidence?.appAuthProviderReadinessEvidence)
    ? evidence.appAuthProviderReadinessEvidence
    : {};
  return (
    binding.target === "app-auth-provider-readiness" &&
    binding.status === "matched" &&
    binding.appAuthProviderMode === "trusted-account-provider" &&
    binding.releaseRunIdStatus === "matched" &&
    binding.valueRedacted === true
  );
}

function isTeachingOperationDetailBrowserCoverageProved(evidence) {
  if (!Array.isArray(evidence?.operationCoverage)) {
    return false;
  }

  const coverageByOperationId = new Map(
    evidence.operationCoverage
      .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
      .filter((entry) => typeof entry.operationId === "string")
      .map((entry) => [entry.operationId, entry]),
  );

  return requiredTeachingOperationDetailCoverageOperationIds.every((operationId) => {
    const entry = coverageByOperationId.get(operationId);
    return (
      isTeachingOperationDetailCoverageContractValue(entry?.primaryButtonClick) &&
      isTeachingOperationDetailCoverageContractValue(entry?.primaryPostPersisted) &&
      isTeachingOperationDetailCoverageContractValue(entry?.secondaryButtonClick) &&
      isTeachingOperationDetailCoverageContractValue(entry?.secondaryPostPersisted)
    );
  });
}

function isTeachingOperationDetailCoverageContractValue(value) {
  return value === "passed" || value === "pending";
}

function isTargetExternalModeEnvKey({ target, key }) {
  if (target === "teaching-operations-route-smoke") {
    return externalModeTeachingOperationsRouteSmokeEnvKeys.has(key);
  }
  if (target === "teaching-course-management-route-smoke") {
    return externalModeTeachingCourseManagementRouteSmokeEnvKeys.has(key);
  }
  return false;
}

function isTargetRedactedEnvKey({ target, key }) {
  if (target === "teaching-operations-route-smoke") {
    return redactedTeachingOperationsRouteSmokeEnvKeys.has(key);
  }
  if (target === "teaching-course-management-route-smoke") {
    return redactedTeachingCourseManagementRouteSmokeEnvKeys.has(key);
  }
  return false;
}

function readFilenameTarget(file) {
  const match = file.match(/^\d{4}-\d{2}-\d{2}-(.+)-production-live\.json$/);
  if (!match) {
    return "missing";
  }
  return match[1] === "route-smoke" ? "deployment-route-smoke" : match[1];
}

function createRow({ file, evidence, jsonError }) {
  const filenameTarget = readFilenameTarget(file);
  if (jsonError) {
    return {
      file,
      filenameTarget,
      target: "unreadable",
      mode: "missing",
      environment: "missing",
      status: "missing",
      expectedStatus: "missing",
      releaseRunIdStatus: "missing",
      safetyStatus: "missing",
      acceptanceStatus: "not-accepted-filename-only",
      blockedReasons: ["json-read-failed"],
    };
  }

  const target = readNonEmptyString(evidence?.target);
  const mode = readNonEmptyString(evidence?.mode);
  const environment = readNonEmptyString(evidence?.environment);
  const status = readNonEmptyString(evidence?.status);
  const expectedMode = readAcceptedTargetMode(target);
  const expectedStatus = readAcceptedTargetStatus(target);
  const releaseRunId = readReleaseRunId(evidence?.releaseRunId);
  const releaseRunIdStatus = readReleaseRunIdStatus(evidence?.releaseRunId);
  const safetyStatus = readSafetyStatus(evidence);
  const targetResultProof = readTargetResultProof({ evidence, target });
  const targetEnvProof = readTargetEnvProof({ evidence, target });
  const targetContractProof = readTargetContractProof({ evidence, target });

  const blockedReasons = [];
  if (mode !== expectedMode) {
    blockedReasons.push(`mode-not-${expectedMode}`);
  }
  if (environment !== "production") {
    blockedReasons.push("environment-not-production");
  }
  if (status !== expectedStatus) {
    blockedReasons.push(`status-not-${expectedStatus}`);
  }
  if (releaseRunIdStatus === "missing") {
    blockedReasons.push("release-run-missing");
  } else if (releaseRunIdStatus === "invalid") {
    blockedReasons.push("release-run-invalid");
  }
  if (safetyStatus !== "proved") {
    blockedReasons.push("safety-not-proven");
  }
  if (targetResultProof.targetResultStatus === "missing") {
    blockedReasons.push("target-result-proof-missing");
  }
  if (
    targetResultProof.targetResultStatus !== "missing" &&
    targetEnvProof.targetEnvStatus === "missing"
  ) {
    blockedReasons.push("target-env-proof-missing");
  }
  if (
    targetResultProof.targetResultStatus !== "missing" &&
    targetContractProof.targetContractStatus === "missing"
  ) {
    blockedReasons.push("target-contract-proof-missing");
  }
  if (!requiredEnterpriseLiveEvidenceTargets.includes(target)) {
    blockedReasons.push("target-not-required");
  }
  if (filenameTarget !== target) {
    blockedReasons.push("target-filename-mismatch");
  }

  return {
    row: {
      file,
      filenameTarget,
      target,
      mode,
      expectedMode,
      environment,
      status,
      expectedStatus,
      releaseRunIdStatus,
      safetyStatus,
      targetResultStatus: targetResultProof.targetResultStatus,
      targetEnvStatus: targetEnvProof.targetEnvStatus,
      targetContractStatus: targetContractProof.targetContractStatus,
      ...(targetResultProof.missingResultKeys.length > 0
        ? { missingResultKeys: targetResultProof.missingResultKeys }
        : {}),
      ...(targetEnvProof.missingEnvKeys.length > 0
        ? { missingEnvKeys: targetEnvProof.missingEnvKeys }
        : {}),
      ...(targetContractProof.missingContractKeys.length > 0
        ? { missingContractKeys: targetContractProof.missingContractKeys }
        : {}),
      acceptanceStatus: blockedReasons.length === 0
        ? "accepted-live-evidence"
        : "not-accepted-filename-only",
      blockedReasons,
    },
    releaseRunId,
  };
}

function listProductionLiveEvidenceFiles({ reportsDir, date }) {
  return readdirSync(reportsDir)
    .filter((file) => file.startsWith(`${date}-`))
    .filter((file) => file.includes("production-live"))
    .filter((file) => file.endsWith(".json"))
    .filter((file) => !isNonEvidenceProductionLiveTemplateFile(file))
    .sort();
}

function isNonEvidenceProductionLiveTemplateFile(file) {
  return file.endsWith("-record-template-production-live.json");
}

function createAudit({ reportsDir, date }) {
  const files = listProductionLiveEvidenceFiles({ reportsDir, date });
  const rowResults = files.map((file) => {
    const readResult = readEvidenceJson(join(reportsDir, file));
    return createRow({
      file: basename(file),
      evidence: readResult.value,
      jsonError: readResult.error,
    });
  });
  const rows = rowResults.map((result) => result.row);
  const acceptedLiveEvidence = rows.filter(
    (row) => row.acceptanceStatus === "accepted-live-evidence",
  ).length;
  const filenameOnlyOrBlocked = rows.length - acceptedLiveEvidence;
  const acceptedReleaseRunIds = rowResults
    .filter((result) => result.row.acceptanceStatus === "accepted-live-evidence")
    .map((result) => result.releaseRunId)
    .filter((value) => typeof value === "string");
  const distinctReleaseRunIdCount = new Set(acceptedReleaseRunIds).size;
  const releaseRunIdConsistency =
    acceptedLiveEvidence === 0
      ? "missing"
      : distinctReleaseRunIdCount === 1
        ? "matched"
        : "mismatched";
  const sharedReleaseRunIdStatus = releaseRunIdConsistency === "matched" ? "present" : "missing";
  const acceptedTargets = [
    ...new Set(
      rows
        .filter((row) => row.acceptanceStatus === "accepted-live-evidence")
        .map((row) => row.target)
        .filter((target) => typeof target === "string")
        .sort(),
    ),
  ];
  const acceptedTargetSet = new Set(acceptedTargets);
  const missingRequiredTargets = requiredEnterpriseLiveEvidenceTargets.filter(
    (target) => !acceptedTargetSet.has(target),
  );
  const unexpectedTargets = [
    ...new Set(
      rows
        .map((row) => row.target)
        .filter(
          (target) =>
            typeof target === "string" &&
            target !== "unreadable" &&
            target !== "missing" &&
            !requiredEnterpriseLiveEvidenceTargets.includes(target),
        )
        .sort(),
    ),
  ];
  const unexpectedEvidenceFiles = rows
    .filter((row) =>
      row.blockedReasons.includes("target-not-required") ||
      row.blockedReasons.includes("target-filename-mismatch") ||
      row.target === "missing" ||
      row.target === "unreadable"
    )
    .map((row) => row.file)
    .sort();
  const requiredTargetProofStatus =
    missingRequiredTargets.length === 0 ? "proved" : "missing";
  const blockedReasons = [];
  if (rows.length === 0) {
    blockedReasons.push("production-live-evidence-missing");
  }
  if (filenameOnlyOrBlocked > 0) {
    blockedReasons.push("filename-only-or-blocked-production-live-evidence");
  }
  if (releaseRunIdConsistency === "mismatched") {
    blockedReasons.push("production-live-release-run-id-mismatch");
  }
  if (requiredTargetProofStatus !== "proved") {
    blockedReasons.push("enterprise-live-required-targets-missing");
  }
  if (unexpectedTargets.length > 0) {
    blockedReasons.push("enterprise-live-unexpected-targets-present");
  }
  if (unexpectedEvidenceFiles.length > 0) {
    blockedReasons.push("enterprise-live-unexpected-evidence-files-present");
  }

  return {
    target: "enterprise-live-evidence-audit",
    date,
    status:
      rows.length > 0 &&
      filenameOnlyOrBlocked === 0 &&
      releaseRunIdConsistency === "matched" &&
      requiredTargetProofStatus === "proved"
        ? "ready"
        : "blocked",
    responsibleSessions: ["S22"],
    generatedAt: new Date().toISOString(),
    criteria: {
      filenamePattern: `${date}-*production-live*.json`,
      acceptedBodyFields: {
        mode: "live",
        acceptedTargetModes,
        environment: "production",
        defaultStatus: "passed",
        acceptedTargetStatuses,
        releaseRunId: "non-secret-release-id",
        sharedReleaseRunId: "same-non-secret-release-id",
        requiredSafetyFlags,
        requiredTargets: requiredEnterpriseLiveEvidenceTargets,
        requiredTargetResultKeys,
        requiredTargetEnvKeys,
        requiredTargetContractKeys,
      },
    },
    summary: {
      totalProductionLiveNamed: rows.length,
      acceptedLiveEvidence,
      filenameOnlyOrBlocked,
      releaseRunIdConsistency,
      sharedReleaseRunIdStatus,
      distinctReleaseRunIdCount,
      requiredTargetProofStatus,
      missingRequiredTargetCount: missingRequiredTargets.length,
      unexpectedTargetCount: unexpectedTargets.length,
      unexpectedEvidenceFileCount: unexpectedEvidenceFiles.length,
    },
    requiredTargets: requiredEnterpriseLiveEvidenceTargets,
    acceptedTargets,
    missingRequiredTargets,
    unexpectedTargets,
    unexpectedEvidenceFiles,
    blockedReasons,
    rows,
    safety: {
      valuesRedacted: true,
      cookieValuesOmitted: true,
      localPathsOmitted: true,
      fileNamesOnly: true,
      responseBodiesOmitted: true,
    },
  };
}

function main() {
  const args = process.argv.slice(2);
  const reportsDir = readFlag(args, "--reports-dir");
  const date = readFlag(args, "--date");
  const output = readFlag(args, "--output");

  if (!reportsDir) {
    return failUsage("Missing required --reports-dir <path>");
  }
  if (!date) {
    return failUsage("Missing required --date <YYYY-MM-DD>");
  }

  const audit = createAudit({ reportsDir, date });
  const payload = `${JSON.stringify(audit, null, 2)}\n`;
  if (output) {
    writeFileSync(output, payload);
  }
  process.stdout.write(payload);
}

main();
