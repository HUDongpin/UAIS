import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const auditRequiredSafetyFlagLiterals = [
  "valuesRedacted: true",
  "cookieValuesOmitted: true",
  "responseBodiesOmitted: true",
  "liveRequiresApproval: true",
  "remoteMutationRequiresApproval: true",
];

function extractConstStringArray(source: string, name: string): string[] {
  const match = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));

  if (!match) {
    throw new Error(`Missing string array constant: ${name}`);
  }

  return [...match[1].matchAll(/"([^"]+)"/g)].map(([, value]) => value);
}

function extractConstObjectStringValues(
  source: string,
  name: string,
  field: string,
): string[] {
  const match = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));

  if (!match) {
    throw new Error(`Missing object array constant: ${name}`);
  }

  return [...match[1].matchAll(new RegExp(`${field}: "([^"]+)"`, "g"))].map(
    ([, value]) => value,
  );
}

function readRequiredEnterpriseLiveEvidenceTargets() {
  return extractConstStringArray(
    readFileSync(join(process.cwd(), "scripts/enterprise-live-evidence-audit.mjs"), "utf8"),
    "requiredEnterpriseLiveEvidenceTargets",
  );
}

function targetFromProductionLiveEvidenceName(fileName: string) {
  const target = fileName
    .replace(/^\d{4}-\d{2}-\d{2}-/, "")
    .replace(/-production-live\.json$/, "");

  return target === "route-smoke" ? "deployment-route-smoke" : target;
}

function scriptPathFromCommand(command: string) {
  const match = command.match(/\bnode -- (scripts\/[^ ]+\.mjs)\b/);

  if (!match) {
    throw new Error(`Could not derive script path from command: ${command}`);
  }

  return match[1];
}

const releaseGateResultConstByTarget: Record<string, string> = {
  "deployment-route-smoke": "requiredRouteSmokeIds",
  "teacher-workflow-deployment-smoke": "requiredDeployedTeacherWorkflowAnchors",
  "teacher-workflow-browser-smoke": "requiredTeacherWorkflowBrowserResults",
  "teacher-workflow-live-generation-smoke": "requiredTeacherWorkflowLiveGenerationResults",
  "learning-ppt-playback-deployment-smoke": "requiredLearningPptPlaybackResults",
  "teaching-operations-route-smoke": "requiredTeachingOperationsRouteSmokeResults",
  "teaching-operation-detail-browser-smoke": "requiredTeachingOperationDetailBrowserResults",
  "teaching-course-management-route-smoke": "requiredTeachingCourseManagementRouteSmokeResults",
  "external-storage-smoke": "requiredExternalStorageSmokeIds",
};
const arrayResultTargets = new Set(["deployment-route-smoke", "external-storage-smoke"]);
const presentResultTargets = new Set(["teacher-workflow-deployment-smoke"]);
const acceptedTargetStatuses: Record<string, string> = {
  "app-auth-provider-readiness": "ready",
  "teacher-auth-provider-readiness": "ready",
  "external-storage-service-readiness": "ready",
  "deployment-domain-reachability": "reachable",
  "ppt-manual-playback-acceptance": "accepted",
};
const acceptedTargetModes: Record<string, string> = {
  "ppt-manual-playback-acceptance": "record",
};
const appAuthProviderReadinessResultKeys = [
  "appAuthProviderModeTrusted",
  "appAuthProviderEndpointRemoteHttps",
  "appAuthSessionCookieContract",
  "appAuthProviderVercelEnvSync",
  "trustedAccountProviderContract",
  "appAuthReadinessSafety",
];
const teacherAuthProviderReadinessResultKeys = [
  "teacherAuthProviderModeSupported",
  "teacherAuthSessionCookieContract",
  "teacherAuthProviderVercelEnvSync",
  "teacherAuthProviderSpecificContract",
  "teacherAuthProviderRouteBinding",
  "teacherAuthReadinessSafety",
];
const externalStorageServiceReadinessResultKeys = [
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
const deploymentDomainReachabilityResultKeys = [
  "deploymentDomainOriginRemoteHttps",
  "deploymentDomainDnsOriginReachable",
  "deploymentDomainTransportConnected",
  "deploymentDomainRootHttpReachable",
  "deploymentDomainTeachingHttpReachable",
  "deploymentDomainLearningHttpReachable",
  "deploymentDomainFingerprintBound",
  "deploymentDomainReadinessSafety",
];
const pptManualPlaybackAcceptanceResultKeys = [
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
const teacherAuthIssuerRouteSmokeResultIds = ["s22-teacher-auth-issuer-route"];
const externalStoragePersistenceResultIds = [
  "s22-external-storage-persistence-health",
  "s22-external-storage-persisted-ownership-read",
  "s24-external-storage-persisted-audit-read",
];

function acceptedTargetStatus(target: string) {
  return acceptedTargetStatuses[target] ?? "passed";
}

function acceptedTargetMode(target: string) {
  return acceptedTargetModes[target] ?? "live";
}

function readReleaseGateRequiredResultKeys(target: string) {
  const constName = releaseGateResultConstByTarget[target];
  if (!constName) {
    return undefined;
  }

  return extractConstStringArray(
    readFileSync(join(process.cwd(), "scripts/production-e2e-release-gate.mjs"), "utf8"),
    constName,
  );
}

function readReleaseGateRequiredTeachingOperationsEnvKeys() {
  return extractConstStringArray(
    readFileSync(join(process.cwd(), "scripts/production-e2e-release-gate.mjs"), "utf8"),
    "requiredTeachingOperationsRouteSmokeEnvNames",
  );
}

function readReleaseGateRequiredTeachingOperationsProofs() {
  return extractConstStringArray(
    readFileSync(join(process.cwd(), "scripts/teaching-operations-route-smoke.mjs"), "utf8"),
    "proves",
  );
}

function readReleaseGateRequiredTeachingOperationsRoutes() {
  return extractConstStringArray(
    readFileSync(join(process.cwd(), "scripts/production-e2e-release-gate.mjs"), "utf8"),
    "requiredTeachingOperationsRouteSmokeRoutes",
  );
}

function readReleaseGateRequiredTeachingCourseManagementEnvKeys() {
  return extractConstStringArray(
    readFileSync(join(process.cwd(), "scripts/production-e2e-release-gate.mjs"), "utf8"),
    "requiredTeachingCourseManagementRouteSmokeEnvNames",
  );
}

function readReleaseGateRequiredTeachingCourseManagementProofs() {
  return extractConstStringArray(
    readFileSync(join(process.cwd(), "scripts/production-e2e-release-gate.mjs"), "utf8"),
    "requiredTeachingCourseManagementRouteSmokeProofs",
  );
}

function readReleaseGateRequiredTeachingCourseManagementRoutes() {
  return extractConstStringArray(
    readFileSync(
      join(process.cwd(), "scripts/production-e2e-release-gate.mjs"),
      "utf8",
    ),
    "requiredTeachingCourseManagementRouteSmokeRoutes",
  );
}

function readReleaseGateRequiredTeachingOperationDetailCoverageIds() {
  return extractConstObjectStringValues(
    readFileSync(join(process.cwd(), "scripts/production-e2e-release-gate.mjs"), "utf8"),
    "requiredTeachingOperationDetailCoverage",
    "operationId",
  );
}

const teachingOperationsRouteSmokeExternalModeEnvNames = new Set([
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
const teachingOperationsRouteSmokeRedactedEnvNames = new Set([
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
const teachingCourseManagementRouteSmokeExternalModeEnvNames = new Set([
  "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
  "UAIS_TEACHING_COURSE_ASSETS_BACKEND",
  "UAIS_TEACHING_OPERATIONS_BACKEND",
  "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
]);
const teachingCourseManagementRouteSmokeRedactedEnvNames = new Set([
  "UAIS_EXTERNAL_STORAGE_BASE_URL",
  "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
  "UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_COOKIE",
  "UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_TEACHER_ID",
  "UAIS_TEACHING_COURSE_MANAGEMENT_OTHER_TEACHER_SMOKE_COOKIE",
  "UAIS_TEACHING_COURSE_MANAGEMENT_OTHER_TEACHER_SMOKE_TEACHER_ID",
  "UAIS_TEACHING_COURSE_MANAGEMENT_STUDENT_SMOKE_COOKIE",
  "UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_STUDENT_ID",
]);
const acceptedTeachingOperationDetailBrowserApiInterceptionPolicy = {
  operationApi: "live-teaching-operations",
  courseManagementApi: "live-teaching-course-management",
  auditReadback: "live-teaching-operations",
  auditAlertReadback: "live-teaching-operations",
  alertNotificationOutbox: "live-teaching-operations",
  failureProbe: "browser-negative-response",
  remoteMutations: "live-approved-teaching-operation",
  responseBodiesOmitted: true,
};

function acceptedTargetRequiredEnv(target: string) {
  if (target === "teaching-operations-route-smoke") {
    return readReleaseGateRequiredTeachingOperationsEnvKeys().map((name) => ({
      name,
      status: "present",
      ...(teachingOperationsRouteSmokeExternalModeEnvNames.has(name)
        ? { requiredValue: "external" }
        : {}),
      ...(teachingOperationsRouteSmokeRedactedEnvNames.has(name)
        ? { valueRedacted: true }
        : {}),
    }));
  }

  if (target === "teaching-course-management-route-smoke") {
    return readReleaseGateRequiredTeachingCourseManagementEnvKeys().map((name) => ({
      name,
      status: "present",
      ...(teachingCourseManagementRouteSmokeExternalModeEnvNames.has(name)
        ? { requiredValue: "external" }
        : {}),
      ...(teachingCourseManagementRouteSmokeRedactedEnvNames.has(name)
        ? { valueRedacted: true }
        : {}),
    }));
  }

  return undefined;
}

function acceptedTargetContractProof(target: string) {
  if (target === "teaching-operations-route-smoke") {
    return {
      proves: readReleaseGateRequiredTeachingOperationsProofs(),
      routes: readReleaseGateRequiredTeachingOperationsRoutes(),
    };
  }

  if (target === "teaching-course-management-route-smoke") {
    return {
      proves: readReleaseGateRequiredTeachingCourseManagementProofs(),
      routes: readReleaseGateRequiredTeachingCourseManagementRoutes(),
    };
  }

  if (target !== "teaching-operation-detail-browser-smoke") {
    return undefined;
  }

  return {
    route: "/teaching/course-settings",
    operationId: "course-settings",
    auth: "issued-teacher-auth-cookie",
    apiInterceptionPolicy: acceptedTeachingOperationDetailBrowserApiInterceptionPolicy,
    deploymentOrigin: {
      status: "present",
      originClass: "remote-https",
      valueRedacted: true,
    },
    vercelProductionDeploymentEvidence: {
      target: "vercel-production-deployment",
      status: "matched",
      deploymentObservationStatus: "observed",
      releaseRunIdStatus: "matched",
      valueRedacted: true,
    },
    deploymentDomainReachabilityEvidence: {
      target: "deployment-domain-reachability",
      status: "matched",
      releaseRunIdStatus: "matched",
      deploymentFingerprintStatus: "matched",
      valueRedacted: true,
    },
    teacherAuthProviderReadinessEvidence: {
      target: "teacher-auth-provider-readiness",
      status: "matched",
      authProviderMode: "trusted-cookie-issuer",
      releaseRunIdStatus: "matched",
      valueRedacted: true,
    },
    appAuthProviderReadinessEvidence: {
      target: "app-auth-provider-readiness",
      status: "matched",
      appAuthProviderMode: "trusted-account-provider",
      releaseRunIdStatus: "matched",
      valueRedacted: true,
    },
    operationCoverage: readReleaseGateRequiredTeachingOperationDetailCoverageIds().map(
      (operationId) => ({
        operationId,
        route: `/teaching/${operationId}`,
        primaryButtonClick: "passed",
        primaryPostPersisted: "passed",
        secondaryButtonClick: "passed",
        secondaryPostPersisted: "passed",
      }),
    ),
  };
}

function acceptedTargetResults(target: string) {
  if (target === "app-auth-provider-readiness") {
    return Object.fromEntries(
      appAuthProviderReadinessResultKeys.map((key) => [key, "passed"]),
    );
  }
  if (target === "teacher-auth-provider-readiness") {
    return Object.fromEntries(
      teacherAuthProviderReadinessResultKeys.map((key) => [key, "passed"]),
    );
  }
  if (target === "external-storage-service-readiness") {
    return Object.fromEntries(
      externalStorageServiceReadinessResultKeys.map((key) => [key, "passed"]),
    );
  }
  if (target === "deployment-domain-reachability") {
    return Object.fromEntries(
      deploymentDomainReachabilityResultKeys.map((key) => [key, "passed"]),
    );
  }
  if (target === "ppt-manual-playback-acceptance") {
    return Object.fromEntries(
      pptManualPlaybackAcceptanceResultKeys.map((key) => [key, "passed"]),
    );
  }
  if (target === "teacher-auth-issuer-route-smoke") {
    return teacherAuthIssuerRouteSmokeResultIds.map((id) => ({ id, status: "ok" }));
  }
  if (target === "external-storage-persistence") {
    return externalStoragePersistenceResultIds.map((id) => ({ id, status: "ok" }));
  }

  const requiredResultKeys = readReleaseGateRequiredResultKeys(target);
  if (arrayResultTargets.has(target)) {
    return requiredResultKeys?.map((id) => ({ id, status: "ok" }));
  }
  if (presentResultTargets.has(target)) {
    return requiredResultKeys
      ? Object.fromEntries(requiredResultKeys.map((key) => [key, "present"]))
      : undefined;
  }

  return requiredResultKeys
    ? Object.fromEntries(requiredResultKeys.map((key) => [key, "passed"]))
    : undefined;
}

function writeProductionLiveEvidence(input: {
  reportsDir: string;
  target: string;
  releaseRunId?: string;
}) {
  const results = acceptedTargetResults(input.target);
  const requiredEnv = acceptedTargetRequiredEnv(input.target);
  const contractProof = acceptedTargetContractProof(input.target);

  writeFileSync(
    join(input.reportsDir, `2026-06-28-${input.target}-production-live.json`),
    JSON.stringify({
      target: input.target,
      mode: acceptedTargetMode(input.target),
      environment: "production",
      status: acceptedTargetStatus(input.target),
      releaseRunId: input.releaseRunId ?? "uais-release-2026-06-28T000000Z",
      ...(results ? { results } : {}),
      ...(requiredEnv ? { requiredEnv } : {}),
      ...(contractProof ? contractProof : {}),
      safety: {
        valuesRedacted: true,
        cookieValuesOmitted: true,
        responseBodiesOmitted: true,
        liveRequiresApproval: true,
        remoteMutationRequiresApproval: true,
      },
    }),
  );
}

describe("enterprise live evidence audit", () => {
  it("keeps production-live evidence generators aligned with audit-required safety flags", () => {
    const requiredTargets = readRequiredEnterpriseLiveEvidenceTargets();
    const orchestratorOutput = execFileSync("node", [
      "scripts/production-e2e-orchestrator.mjs",
      "--dry-run",
      "--report-date",
      "2026-06-28",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const orchestrator = JSON.parse(orchestratorOutput) as {
      steps: Array<{ command: string; evidence: string }>;
    };
    const targetToScriptPath = new Map<string, string>();

    for (const step of orchestrator.steps) {
      if (!step.evidence.endsWith("-production-live.json")) {
        continue;
      }

      targetToScriptPath.set(
        targetFromProductionLiveEvidenceName(step.evidence),
        scriptPathFromCommand(step.command),
      );
    }

    expect([...targetToScriptPath.keys()].sort()).toEqual([...requiredTargets].sort());

    for (const [target, scriptPath] of targetToScriptPath) {
      const source = readFileSync(join(process.cwd(), scriptPath), "utf8");
      expect(source, `${scriptPath} should declare target ${target}`).toContain(`"${target}"`);

      for (const flagLiteral of auditRequiredSafetyFlagLiterals) {
        expect(source, `${scriptPath} should declare ${flagLiteral}`).toContain(flagLiteral);
      }
    }
  });

  it("uses the production release gate as the target result-proof source of truth", () => {
    const reportsDir = mkdtempSync(join(tmpdir(), "uais-live-evidence-audit-result-source-"));
    const stdout = execFileSync("node", [
      "scripts/enterprise-live-evidence-audit.mjs",
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-06-28",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(stdout);
    const requiredTargetResultKeys =
      body.criteria.acceptedBodyFields.requiredTargetResultKeys;
    const requiredTargetEnvKeys =
      body.criteria.acceptedBodyFields.requiredTargetEnvKeys;
    const requiredTargetContractKeys =
      body.criteria.acceptedBodyFields.requiredTargetContractKeys;

    expect(body.criteria.acceptedBodyFields).toEqual(
      expect.objectContaining({
        defaultStatus: "passed",
        acceptedTargetStatuses,
        acceptedTargetModes,
        releaseRunId: "non-secret-release-id",
        sharedReleaseRunId: "same-non-secret-release-id",
      }),
    );

    for (const target of Object.keys(releaseGateResultConstByTarget)) {
      expect(requiredTargetResultKeys[target]).toEqual(
        readReleaseGateRequiredResultKeys(target),
      );
    }
    expect(requiredTargetEnvKeys["teaching-operations-route-smoke"]).toEqual(
      readReleaseGateRequiredTeachingOperationsEnvKeys(),
    );
    expect(requiredTargetEnvKeys["teaching-course-management-route-smoke"]).toEqual(
      readReleaseGateRequiredTeachingCourseManagementEnvKeys(),
    );
    expect(requiredTargetEnvKeys["teaching-operations-route-smoke"]).toEqual(
      expect.arrayContaining([
        "UAIS_TEACHING_OPERATIONS_BACKEND",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN",
        "UAIS_GRADING_FEEDBACK_PROVIDER_TOKEN",
      ]),
    );
    expect(requiredTargetEnvKeys["teaching-course-management-route-smoke"]).toEqual(
      expect.arrayContaining([
        "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
        "UAIS_TEACHING_COURSE_ASSETS_BACKEND",
        "UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_COOKIE",
      ]),
    );
    expect(requiredTargetContractKeys["teaching-operation-detail-browser-smoke"]).toEqual([
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
    ]);

    expect(requiredTargetResultKeys["app-auth-provider-readiness"]).toEqual(
      appAuthProviderReadinessResultKeys,
    );
    const appAuthProviderReadiness = readFileSync(
      join(process.cwd(), "scripts/app-auth-provider-readiness.mjs"),
      "utf8",
    );
    for (const resultKey of appAuthProviderReadinessResultKeys) {
      expect(appAuthProviderReadiness).toContain(resultKey);
    }
    expect(requiredTargetResultKeys["teacher-auth-provider-readiness"]).toEqual(
      teacherAuthProviderReadinessResultKeys,
    );
    const teacherAuthProviderReadiness = readFileSync(
      join(process.cwd(), "scripts/teacher-auth-provider-readiness.mjs"),
      "utf8",
    );
    for (const resultKey of teacherAuthProviderReadinessResultKeys) {
      expect(teacherAuthProviderReadiness).toContain(resultKey);
    }
    expect(requiredTargetResultKeys["external-storage-service-readiness"]).toEqual(
      externalStorageServiceReadinessResultKeys,
    );
    const externalStorageServiceReadiness = readFileSync(
      join(process.cwd(), "scripts/external-storage-service-readiness.mjs"),
      "utf8",
    );
    for (const resultKey of externalStorageServiceReadinessResultKeys) {
      expect(externalStorageServiceReadiness).toContain(resultKey);
    }
    expect(requiredTargetResultKeys["deployment-domain-reachability"]).toEqual(
      deploymentDomainReachabilityResultKeys,
    );
    const deploymentReachabilityDiagnostics = readFileSync(
      join(process.cwd(), "scripts/deployment-reachability-diagnostics.mjs"),
      "utf8",
    );
    for (const resultKey of deploymentDomainReachabilityResultKeys) {
      expect(deploymentReachabilityDiagnostics).toContain(resultKey);
    }
    expect(requiredTargetResultKeys["ppt-manual-playback-acceptance"]).toEqual(
      pptManualPlaybackAcceptanceResultKeys,
    );
    const pptManualPlaybackAcceptance = readFileSync(
      join(process.cwd(), "scripts/ppt-manual-playback-acceptance.mjs"),
      "utf8",
    );
    for (const resultKey of pptManualPlaybackAcceptanceResultKeys) {
      expect(pptManualPlaybackAcceptance).toContain(resultKey);
    }
    expect(requiredTargetResultKeys["teaching-operations-route-smoke"]).toEqual(
      expect.arrayContaining([
        "unauthenticatedPostDenied",
        "unauthenticatedPostNoWriteSideEffects",
        "forbiddenCourseScopeDenied",
        "idempotencyConflictDenied",
        "externalRestoreDrillVerifiedReturned",
      ]),
    );
    expect(
      requiredTargetResultKeys["teaching-course-management-route-smoke"],
    ).toEqual(
      expect.arrayContaining([
        "signedOtherTeacherCourseCoverDenied",
        "duplicateStudentInviteJoinIdempotentReturned",
        "signedOtherTeacherMembershipApprovalNoWriteSideEffects",
      ]),
    );
    expect(requiredTargetResultKeys["deployment-route-smoke"]).toEqual([
      "s22-retention-readiness-route",
      "s22-voice-lifecycle-audit-route",
      "s22-ai-readiness-route",
      "s22-ai-smoke-plan-route",
      "s22-teacher-auth-issuer-route",
      "s22-teacher-ai-session-route",
      "s22-teacher-ownership-route",
      "s22-teacher-ppt-workflow-route",
    ]);
    expect(requiredTargetResultKeys["teacher-auth-issuer-route-smoke"]).toEqual(
      teacherAuthIssuerRouteSmokeResultIds,
    );
    const aiRouteSmoke = readFileSync(
      join(process.cwd(), "scripts/ai-route-smoke.mjs"),
      "utf8",
    );
    for (const resultId of teacherAuthIssuerRouteSmokeResultIds) {
      expect(aiRouteSmoke).toContain(`id: "${resultId}"`);
    }
    expect(requiredTargetResultKeys["teacher-workflow-deployment-smoke"]).toEqual(
      expect.arrayContaining([
        "teacherWorkflowTitle",
        "voiceSampleUpload",
        "pptNarrationGenerate",
        "serverWorkflowStatus",
      ]),
    );
    expect(requiredTargetResultKeys["teacher-workflow-browser-smoke"]).toEqual(
      expect.arrayContaining([
        "signedSessionBootstrap",
        "voiceSampleSubmit",
        "pptNarrationSubmit",
        "perSlideWavDownloadHrefContract",
      ]),
    );
    expect(
      requiredTargetResultKeys["teacher-workflow-live-generation-smoke"],
    ).toEqual(
      expect.arrayContaining([
        "voiceCloneStatusSucceeded",
        "generatedAudioManifest",
        "generatedZipExport",
        "perSlideAudioDownload",
      ]),
    );
    expect(
      requiredTargetResultKeys["learning-ppt-playback-deployment-smoke"],
    ).toEqual([
      "learningPageHttp200",
      "playbackManifestKangXiaVoice",
      "playbackManifestSlideCount",
      "playbackManifestStudentSafeRedaction",
      "firstSlideAudioWavHeaders",
    ]);
    expect(requiredTargetResultKeys["external-storage-persistence"]).toEqual(
      externalStoragePersistenceResultIds,
    );
    const externalStoragePersistenceSmoke = readFileSync(
      join(process.cwd(), "scripts/external-storage-persistence-smoke.mjs"),
      "utf8",
    );
    for (const resultId of externalStoragePersistenceResultIds) {
      expect(externalStoragePersistenceSmoke).toContain(resultId);
    }
    expect(requiredTargetResultKeys["external-storage-smoke"]).toEqual([
      "s22-external-storage-health",
      "s12-external-teacher-ownership-merge",
      "s12-external-teacher-ownership-read",
      "s12-external-course-management-backup-restore-drill",
      "s12-external-course-assets-backup-restore-drill",
      "s12-external-teaching-operations-backup-restore-drill",
      "s12-external-teaching-operations-concurrent-append-readback",
      "s12-external-teaching-operations-unauthenticated-append-denied",
      "s12-external-teaching-operations-invalid-token-append-denied",
      "s24-external-lifecycle-audit-append",
      "s24-external-lifecycle-audit-read",
    ]);
  });

  it("rejects production-live filenames unless JSON body fields prove live production acceptance", () => {
    const scriptPath = join(process.cwd(), "scripts/enterprise-live-evidence-audit.mjs");
    expect(existsSync(scriptPath), "audit script should exist").toBe(true);

    const reportsDir = mkdtempSync(join(tmpdir(), "uais-live-evidence-audit-"));
    const outputPath = join(reportsDir, "audit-output.json");

    writeFileSync(
      join(reportsDir, "2026-06-28-teaching-operations-route-smoke-production-live.json"),
      JSON.stringify({
        target: "teaching-operations-route-smoke",
        mode: "dry-run",
        environment: "production",
        status: "blocked",
        blockedReasons: ["live-run-not-approved"],
        safety: {
          valuesRedacted: true,
          cookieValuesOmitted: true,
          responseBodiesOmitted: true,
          liveRequiresApproval: true,
          remoteMutationRequiresApproval: true,
        },
      }),
    );
    writeFileSync(
      join(reportsDir, "2026-06-28-teacher-workflow-browser-smoke-production-live.json"),
      JSON.stringify({
        target: "teacher-workflow-browser-smoke",
        mode: "live",
        environment: "production",
        status: "passed",
        releaseRunId: "uais-release-2026-06-28T000000Z",
        safety: {
          valuesRedacted: true,
          cookieValuesOmitted: true,
          responseBodiesOmitted: true,
          liveRequiresApproval: true,
          remoteMutationRequiresApproval: true,
        },
      }),
    );
    writeFileSync(
      join(reportsDir, "2026-06-27-stale-production-live.json"),
      JSON.stringify({
        target: "stale-evidence",
        mode: "live",
        environment: "production",
        status: "passed",
      }),
    );

    const stdout = execFileSync("node", [
      "scripts/enterprise-live-evidence-audit.mjs",
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-06-28",
      "--output",
      outputPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(stdout);
    const writtenBody = JSON.parse(readFileSync(outputPath, "utf8"));

    expect(body).toEqual(writtenBody);
    expect(body).toEqual(
      expect.objectContaining({
        target: "enterprise-live-evidence-audit",
        date: "2026-06-28",
        status: "blocked",
        safety: {
          valuesRedacted: true,
          cookieValuesOmitted: true,
          localPathsOmitted: true,
          fileNamesOnly: true,
          responseBodiesOmitted: true,
        },
      }),
    );
    expect(body.summary).toEqual(
      expect.objectContaining({
        totalProductionLiveNamed: 2,
        acceptedLiveEvidence: 0,
        filenameOnlyOrBlocked: 2,
        releaseRunIdConsistency: "missing",
        sharedReleaseRunIdStatus: "missing",
        distinctReleaseRunIdCount: 0,
        requiredTargetProofStatus: "missing",
      }),
    );
    expect(body.missingRequiredTargets).toEqual(
      expect.arrayContaining([
        "teaching-operation-detail-browser-smoke",
        "teaching-course-management-route-smoke",
        "teacher-workflow-live-generation-smoke",
      ]),
    );
    expect(body.rows).toEqual([
      expect.objectContaining({
        file: "2026-06-28-teacher-workflow-browser-smoke-production-live.json",
        target: "teacher-workflow-browser-smoke",
        mode: "live",
        environment: "production",
        status: "passed",
        releaseRunIdStatus: "present",
        safetyStatus: "proved",
        targetResultStatus: "missing",
        acceptanceStatus: "not-accepted-filename-only",
        blockedReasons: ["target-result-proof-missing"],
        missingResultKeys: expect.arrayContaining([
          "openTeachingPage",
          "signedSessionBootstrap",
          "pptNarrationSubmit",
        ]),
      }),
      expect.objectContaining({
        file: "2026-06-28-teaching-operations-route-smoke-production-live.json",
        target: "teaching-operations-route-smoke",
        mode: "dry-run",
        environment: "production",
        status: "blocked",
        releaseRunIdStatus: "missing",
        safetyStatus: "proved",
        targetResultStatus: "missing",
        acceptanceStatus: "not-accepted-filename-only",
        blockedReasons: expect.arrayContaining([
          "mode-not-live",
          "status-not-passed",
          "release-run-missing",
          "target-result-proof-missing",
        ]),
        missingResultKeys: expect.arrayContaining([
          "authorizedOperationPersisted",
          "domainProjectionReadbackReturned",
        ]),
      }),
    ]);
    expect(stdout).not.toContain(reportsDir);
    expect(stdout).not.toContain("/Users/");
  });

  it("blocks otherwise accepted production-live evidence when release-run ids differ", () => {
    const reportsDir = mkdtempSync(join(tmpdir(), "uais-live-evidence-audit-run-mismatch-"));

    writeFileSync(
      join(reportsDir, "2026-06-28-teaching-operations-route-smoke-production-live.json"),
      JSON.stringify({
        target: "teaching-operations-route-smoke",
        mode: "live",
        environment: "production",
        status: "passed",
        releaseRunId: "uais-release-2026-06-28T000000Z",
        results: acceptedTargetResults("teaching-operations-route-smoke"),
        requiredEnv: acceptedTargetRequiredEnv("teaching-operations-route-smoke"),
        proves: readReleaseGateRequiredTeachingOperationsProofs(),
        routes: readReleaseGateRequiredTeachingOperationsRoutes(),
        safety: {
          valuesRedacted: true,
          cookieValuesOmitted: true,
          responseBodiesOmitted: true,
          liveRequiresApproval: true,
          remoteMutationRequiresApproval: true,
        },
      }),
    );
    writeFileSync(
      join(reportsDir, "2026-06-28-teaching-course-management-route-smoke-production-live.json"),
      JSON.stringify({
        target: "teaching-course-management-route-smoke",
        mode: "live",
        environment: "production",
        status: "passed",
        releaseRunId: "uais-release-2026-06-28T010000Z",
        results: acceptedTargetResults("teaching-course-management-route-smoke"),
        requiredEnv: acceptedTargetRequiredEnv("teaching-course-management-route-smoke"),
        proves: readReleaseGateRequiredTeachingCourseManagementProofs(),
        routes: readReleaseGateRequiredTeachingCourseManagementRoutes(),
        safety: {
          valuesRedacted: true,
          cookieValuesOmitted: true,
          responseBodiesOmitted: true,
          liveRequiresApproval: true,
          remoteMutationRequiresApproval: true,
        },
      }),
    );

    const stdout = execFileSync("node", [
      "scripts/enterprise-live-evidence-audit.mjs",
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-06-28",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(stdout);

    expect(body.status).toBe("blocked");
    expect(body.summary).toEqual(
      expect.objectContaining({
        totalProductionLiveNamed: 2,
        acceptedLiveEvidence: 2,
        filenameOnlyOrBlocked: 0,
        releaseRunIdConsistency: "mismatched",
        sharedReleaseRunIdStatus: "missing",
        distinctReleaseRunIdCount: 2,
      }),
    );
    expect(body.blockedReasons).toContain("production-live-release-run-id-mismatch");
    expect(body.blockedReasons).toContain("enterprise-live-required-targets-missing");
    expect(stdout).not.toContain("uais-release-2026-06-28T000000Z");
    expect(stdout).not.toContain("uais-release-2026-06-28T010000Z");
    expect(stdout).not.toContain(reportsDir);
  });

  it("rejects production-live evidence with an invalid release-run id format", () => {
    const reportsDir = mkdtempSync(join(tmpdir(), "uais-live-evidence-audit-run-invalid-"));
    const unsafeReleaseRunId = "secret value /Users/dongpinhu/token";

    writeFileSync(
      join(reportsDir, "2026-06-28-teaching-operations-route-smoke-production-live.json"),
      JSON.stringify({
        target: "teaching-operations-route-smoke",
        mode: "live",
        environment: "production",
        status: "passed",
        releaseRunId: unsafeReleaseRunId,
        results: acceptedTargetResults("teaching-operations-route-smoke"),
        requiredEnv: acceptedTargetRequiredEnv("teaching-operations-route-smoke"),
        proves: readReleaseGateRequiredTeachingOperationsProofs(),
        routes: readReleaseGateRequiredTeachingOperationsRoutes(),
        safety: {
          valuesRedacted: true,
          cookieValuesOmitted: true,
          responseBodiesOmitted: true,
          liveRequiresApproval: true,
          remoteMutationRequiresApproval: true,
        },
      }),
    );

    const stdout = execFileSync("node", [
      "scripts/enterprise-live-evidence-audit.mjs",
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-06-28",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(stdout);

    expect(body.status).toBe("blocked");
    expect(body.summary).toEqual(
      expect.objectContaining({
        totalProductionLiveNamed: 1,
        acceptedLiveEvidence: 0,
        filenameOnlyOrBlocked: 1,
        releaseRunIdConsistency: "missing",
        sharedReleaseRunIdStatus: "missing",
        distinctReleaseRunIdCount: 0,
      }),
    );
    expect(body.rows).toEqual([
      expect.objectContaining({
        file: "2026-06-28-teaching-operations-route-smoke-production-live.json",
        target: "teaching-operations-route-smoke",
        releaseRunIdStatus: "invalid",
        targetResultStatus: "proved",
        targetEnvStatus: "proved",
        targetContractStatus: "proved",
        acceptanceStatus: "not-accepted-filename-only",
        blockedReasons: ["release-run-invalid"],
      }),
    ]);
    expect(stdout).not.toContain(unsafeReleaseRunId);
    expect(stdout).not.toContain("/Users/");
    expect(stdout).not.toContain(reportsDir);
  });

  it("rejects production-live evidence when cookie redaction is not body-proven", () => {
    const reportsDir = mkdtempSync(join(tmpdir(), "uais-live-evidence-audit-cookie-safety-"));

    writeFileSync(
      join(reportsDir, "2026-06-28-teacher-workflow-browser-smoke-production-live.json"),
      JSON.stringify({
        target: "teacher-workflow-browser-smoke",
        mode: "live",
        environment: "production",
        status: "passed",
        releaseRunId: "uais-release-2026-06-28T000000Z",
        safety: {
          valuesRedacted: true,
          responseBodiesOmitted: true,
          liveRequiresApproval: true,
          remoteMutationRequiresApproval: true,
        },
      }),
    );

    const stdout = execFileSync("node", [
      "scripts/enterprise-live-evidence-audit.mjs",
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-06-28",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(stdout);

    expect(body.status).toBe("blocked");
    expect(body.summary).toEqual(
      expect.objectContaining({
        totalProductionLiveNamed: 1,
        acceptedLiveEvidence: 0,
        filenameOnlyOrBlocked: 1,
      }),
    );
    expect(body.rows).toEqual([
      expect.objectContaining({
        file: "2026-06-28-teacher-workflow-browser-smoke-production-live.json",
        target: "teacher-workflow-browser-smoke",
        mode: "live",
        environment: "production",
        status: "passed",
        releaseRunIdStatus: "present",
        safetyStatus: "missing",
        targetResultStatus: "missing",
        acceptanceStatus: "not-accepted-filename-only",
        blockedReasons: ["safety-not-proven", "target-result-proof-missing"],
        missingResultKeys: expect.arrayContaining([
          "openTeachingPage",
          "signedSessionBootstrap",
          "pptNarrationSubmit",
        ]),
      }),
    ]);
    expect(stdout).not.toContain("uais-release-2026-06-28T000000Z");
    expect(stdout).not.toContain(reportsDir);
    expect(stdout).not.toContain("/Users/");
  });

  it("rejects ordinary teaching production-live evidence without key result proof", () => {
    const reportsDir = mkdtempSync(join(tmpdir(), "uais-live-evidence-audit-result-proof-"));

    writeFileSync(
      join(reportsDir, "2026-06-28-teaching-operations-route-smoke-production-live.json"),
      JSON.stringify({
        target: "teaching-operations-route-smoke",
        mode: "live",
        environment: "production",
        status: "passed",
        releaseRunId: "uais-release-2026-06-28T000000Z",
        safety: {
          valuesRedacted: true,
          cookieValuesOmitted: true,
          responseBodiesOmitted: true,
          liveRequiresApproval: true,
          remoteMutationRequiresApproval: true,
        },
      }),
    );

    const stdout = execFileSync("node", [
      "scripts/enterprise-live-evidence-audit.mjs",
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-06-28",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(stdout);

    expect(body.status).toBe("blocked");
    expect(body.rows).toEqual([
      expect.objectContaining({
        file: "2026-06-28-teaching-operations-route-smoke-production-live.json",
        target: "teaching-operations-route-smoke",
        targetResultStatus: "missing",
        acceptanceStatus: "not-accepted-filename-only",
        blockedReasons: ["target-result-proof-missing"],
        missingResultKeys: expect.arrayContaining([
          "authorizedOperationPersisted",
          "domainProjectionReadbackReturned",
          "courseContentProviderPublishReturned",
        ]),
      }),
    ]);
    expect(stdout).not.toContain("uais-release-2026-06-28T000000Z");
    expect(stdout).not.toContain(reportsDir);
  });

  it("rejects ordinary teaching production-live evidence without required env proof", () => {
    const reportsDir = mkdtempSync(join(tmpdir(), "uais-live-evidence-audit-env-proof-"));

    writeFileSync(
      join(reportsDir, "2026-06-28-teaching-operations-route-smoke-production-live.json"),
      JSON.stringify({
        target: "teaching-operations-route-smoke",
        mode: "live",
        environment: "production",
        status: "passed",
        releaseRunId: "uais-release-2026-06-28T000000Z",
        results: acceptedTargetResults("teaching-operations-route-smoke"),
        proves: readReleaseGateRequiredTeachingOperationsProofs(),
        routes: readReleaseGateRequiredTeachingOperationsRoutes(),
        safety: {
          valuesRedacted: true,
          cookieValuesOmitted: true,
          responseBodiesOmitted: true,
          liveRequiresApproval: true,
          remoteMutationRequiresApproval: true,
        },
      }),
    );

    const stdout = execFileSync("node", [
      "scripts/enterprise-live-evidence-audit.mjs",
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-06-28",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(stdout);

    expect(body.status).toBe("blocked");
    expect(body.rows).toEqual([
      expect.objectContaining({
        file: "2026-06-28-teaching-operations-route-smoke-production-live.json",
        target: "teaching-operations-route-smoke",
        targetResultStatus: "proved",
        targetEnvStatus: "missing",
        acceptanceStatus: "not-accepted-filename-only",
        blockedReasons: ["target-env-proof-missing"],
        missingEnvKeys: expect.arrayContaining([
          "UAIS_TEACHING_OPERATIONS_BACKEND",
          "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER",
          "UAIS_GRADING_FEEDBACK_PROVIDER_TOKEN",
        ]),
      }),
    ]);
    expect(stdout).not.toContain("uais-release-2026-06-28T000000Z");
    expect(stdout).not.toContain(reportsDir);
  });

  it("rejects ordinary teaching production-live evidence without route-smoke proof contract", () => {
    const reportsDir = mkdtempSync(join(tmpdir(), "uais-live-evidence-audit-proof-contract-"));

    writeFileSync(
      join(reportsDir, "2026-06-28-teaching-operations-route-smoke-production-live.json"),
      JSON.stringify({
        target: "teaching-operations-route-smoke",
        mode: "live",
        environment: "production",
        status: "passed",
        releaseRunId: "uais-release-2026-06-28T000000Z",
        results: acceptedTargetResults("teaching-operations-route-smoke"),
        requiredEnv: acceptedTargetRequiredEnv("teaching-operations-route-smoke"),
        safety: {
          valuesRedacted: true,
          cookieValuesOmitted: true,
          responseBodiesOmitted: true,
          liveRequiresApproval: true,
          remoteMutationRequiresApproval: true,
        },
      }),
    );

    const stdout = execFileSync("node", [
      "scripts/enterprise-live-evidence-audit.mjs",
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-06-28",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(stdout);

    expect(body.status).toBe("blocked");
    expect(body.rows).toEqual([
      expect.objectContaining({
        file: "2026-06-28-teaching-operations-route-smoke-production-live.json",
        target: "teaching-operations-route-smoke",
        targetResultStatus: "proved",
        targetEnvStatus: "proved",
        targetContractStatus: "missing",
        acceptanceStatus: "not-accepted-filename-only",
        blockedReasons: ["target-contract-proof-missing"],
        missingContractKeys: expect.arrayContaining([
          "signed-teacher-cookie-required",
          "gradebook-provider-rollback-returned",
        ]),
      }),
    ]);
    expect(stdout).not.toContain("uais-release-2026-06-28T000000Z");
    expect(stdout).not.toContain(reportsDir);
  });

  it("rejects ordinary teaching production-live evidence without route coverage proof", () => {
    const reportsDir = mkdtempSync(join(tmpdir(), "uais-live-evidence-audit-route-coverage-"));

    writeFileSync(
      join(reportsDir, "2026-06-28-teaching-operations-route-smoke-production-live.json"),
      JSON.stringify({
        target: "teaching-operations-route-smoke",
        mode: "live",
        environment: "production",
        status: "passed",
        releaseRunId: "uais-release-2026-06-28T000000Z",
        results: acceptedTargetResults("teaching-operations-route-smoke"),
        requiredEnv: acceptedTargetRequiredEnv("teaching-operations-route-smoke"),
        proves: readReleaseGateRequiredTeachingOperationsProofs(),
        safety: {
          valuesRedacted: true,
          cookieValuesOmitted: true,
          responseBodiesOmitted: true,
          liveRequiresApproval: true,
          remoteMutationRequiresApproval: true,
        },
      }),
    );

    const stdout = execFileSync("node", [
      "scripts/enterprise-live-evidence-audit.mjs",
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-06-28",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(stdout);

    expect(body.status).toBe("blocked");
    expect(body.rows).toEqual([
      expect.objectContaining({
        file: "2026-06-28-teaching-operations-route-smoke-production-live.json",
        target: "teaching-operations-route-smoke",
        targetResultStatus: "proved",
        targetEnvStatus: "proved",
        targetContractStatus: "missing",
        acceptanceStatus: "not-accepted-filename-only",
        blockedReasons: ["target-contract-proof-missing"],
        missingContractKeys: expect.arrayContaining([
          "route:/api/teaching/operations/audit",
          "route:/api/teaching/operations/records/{recordId}/rollback",
          "route:/api/teaching/operations/backups/{backupId}/restore",
        ]),
      }),
    ]);
    expect(stdout).not.toContain("uais-release-2026-06-28T000000Z");
    expect(stdout).not.toContain(reportsDir);
  });

  it("rejects teaching course management production-live evidence without required env proof", () => {
    const reportsDir = mkdtempSync(join(tmpdir(), "uais-live-evidence-audit-course-env-"));

    writeFileSync(
      join(reportsDir, "2026-06-28-teaching-course-management-route-smoke-production-live.json"),
      JSON.stringify({
        target: "teaching-course-management-route-smoke",
        mode: "live",
        environment: "production",
        status: "passed",
        releaseRunId: "uais-release-2026-06-28T000000Z",
        results: acceptedTargetResults("teaching-course-management-route-smoke"),
        proves: readReleaseGateRequiredTeachingCourseManagementProofs(),
        routes: readReleaseGateRequiredTeachingCourseManagementRoutes(),
        safety: {
          valuesRedacted: true,
          cookieValuesOmitted: true,
          responseBodiesOmitted: true,
          liveRequiresApproval: true,
          remoteMutationRequiresApproval: true,
        },
      }),
    );

    const stdout = execFileSync("node", [
      "scripts/enterprise-live-evidence-audit.mjs",
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-06-28",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(stdout);

    expect(body.status).toBe("blocked");
    expect(body.rows).toEqual([
      expect.objectContaining({
        file: "2026-06-28-teaching-course-management-route-smoke-production-live.json",
        target: "teaching-course-management-route-smoke",
        targetResultStatus: "proved",
        targetEnvStatus: "missing",
        acceptanceStatus: "not-accepted-filename-only",
        blockedReasons: ["target-env-proof-missing"],
        missingEnvKeys: expect.arrayContaining([
          "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
          "UAIS_TEACHING_COURSE_ASSETS_BACKEND",
          "UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_COOKIE",
        ]),
      }),
    ]);
    expect(stdout).not.toContain("uais-release-2026-06-28T000000Z");
    expect(stdout).not.toContain(reportsDir);
  });

  it("rejects teaching course management production-live evidence without route-smoke proof contract", () => {
    const reportsDir = mkdtempSync(
      join(tmpdir(), "uais-live-evidence-audit-course-proof-contract-"),
    );

    writeFileSync(
      join(reportsDir, "2026-06-28-teaching-course-management-route-smoke-production-live.json"),
      JSON.stringify({
        target: "teaching-course-management-route-smoke",
        mode: "live",
        environment: "production",
        status: "passed",
        releaseRunId: "uais-release-2026-06-28T000000Z",
        results: acceptedTargetResults("teaching-course-management-route-smoke"),
        requiredEnv: acceptedTargetRequiredEnv("teaching-course-management-route-smoke"),
        safety: {
          valuesRedacted: true,
          cookieValuesOmitted: true,
          responseBodiesOmitted: true,
          liveRequiresApproval: true,
          remoteMutationRequiresApproval: true,
        },
      }),
    );

    const stdout = execFileSync("node", [
      "scripts/enterprise-live-evidence-audit.mjs",
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-06-28",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(stdout);

    expect(body.status).toBe("blocked");
    expect(body.rows).toEqual([
      expect.objectContaining({
        file: "2026-06-28-teaching-course-management-route-smoke-production-live.json",
        target: "teaching-course-management-route-smoke",
        targetResultStatus: "proved",
        targetEnvStatus: "proved",
        targetContractStatus: "missing",
        acceptanceStatus: "not-accepted-filename-only",
        blockedReasons: ["target-contract-proof-missing"],
        missingContractKeys: expect.arrayContaining([
          "signed-teacher-cookie-required",
          "created-course-bound-generated-cover-asset",
          "student-invite-join-persisted",
          "teacher-membership-approval-persisted",
        ]),
      }),
    ]);
    expect(stdout).not.toContain("uais-release-2026-06-28T000000Z");
    expect(stdout).not.toContain(reportsDir);
  });

  it("rejects teaching course management production-live evidence without route coverage proof", () => {
    const reportsDir = mkdtempSync(
      join(tmpdir(), "uais-live-evidence-audit-course-route-contract-"),
    );

    writeFileSync(
      join(reportsDir, "2026-06-28-teaching-course-management-route-smoke-production-live.json"),
      JSON.stringify({
        target: "teaching-course-management-route-smoke",
        mode: "live",
        environment: "production",
        status: "passed",
        releaseRunId: "uais-release-2026-06-28T000000Z",
        results: acceptedTargetResults("teaching-course-management-route-smoke"),
        requiredEnv: acceptedTargetRequiredEnv("teaching-course-management-route-smoke"),
        proves: readReleaseGateRequiredTeachingCourseManagementProofs(),
        safety: {
          valuesRedacted: true,
          cookieValuesOmitted: true,
          responseBodiesOmitted: true,
          liveRequiresApproval: true,
          remoteMutationRequiresApproval: true,
        },
      }),
    );

    const stdout = execFileSync("node", [
      "scripts/enterprise-live-evidence-audit.mjs",
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-06-28",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(stdout);

    expect(body.status).toBe("blocked");
    expect(body.rows).toEqual([
      expect.objectContaining({
        file: "2026-06-28-teaching-course-management-route-smoke-production-live.json",
        target: "teaching-course-management-route-smoke",
        targetResultStatus: "proved",
        targetEnvStatus: "proved",
        targetContractStatus: "missing",
        acceptanceStatus: "not-accepted-filename-only",
        blockedReasons: ["target-contract-proof-missing"],
        missingContractKeys: expect.arrayContaining(
          readReleaseGateRequiredTeachingCourseManagementRoutes().map(
            (route) => `route:${route}`,
          ),
        ),
      }),
    ]);
    expect(stdout).not.toContain("uais-release-2026-06-28T000000Z");
    expect(stdout).not.toContain(reportsDir);
  });

  it("rejects operation detail browser production-live evidence without release-gate contract proof", () => {
    const reportsDir = mkdtempSync(join(tmpdir(), "uais-live-evidence-audit-detail-contract-"));

    writeFileSync(
      join(reportsDir, "2026-06-28-teaching-operation-detail-browser-smoke-production-live.json"),
      JSON.stringify({
        target: "teaching-operation-detail-browser-smoke",
        mode: "live",
        environment: "production",
        status: "passed",
        releaseRunId: "uais-release-2026-06-28T000000Z",
        results: acceptedTargetResults("teaching-operation-detail-browser-smoke"),
        safety: {
          valuesRedacted: true,
          cookieValuesOmitted: true,
          responseBodiesOmitted: true,
          liveRequiresApproval: true,
          remoteMutationRequiresApproval: true,
        },
      }),
    );

    const stdout = execFileSync("node", [
      "scripts/enterprise-live-evidence-audit.mjs",
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-06-28",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(stdout);

    expect(body.status).toBe("blocked");
    expect(body.rows).toEqual([
      expect.objectContaining({
        file: "2026-06-28-teaching-operation-detail-browser-smoke-production-live.json",
        target: "teaching-operation-detail-browser-smoke",
        targetResultStatus: "proved",
        targetContractStatus: "missing",
        acceptanceStatus: "not-accepted-filename-only",
        blockedReasons: ["target-contract-proof-missing"],
        missingContractKeys: expect.arrayContaining([
          "auth",
          "apiInterceptionPolicy",
          "deploymentOrigin",
          "appAuthProviderReadinessEvidence",
          "operationCoverage",
        ]),
      }),
    ]);
    expect(stdout).not.toContain("uais-release-2026-06-28T000000Z");
    expect(stdout).not.toContain(reportsDir);
  });

  it("rejects manual PPT playback acceptance without key result proof", () => {
    const reportsDir = mkdtempSync(join(tmpdir(), "uais-live-evidence-audit-ppt-results-"));

    writeFileSync(
      join(reportsDir, "2026-06-28-ppt-manual-playback-acceptance-production-live.json"),
      JSON.stringify({
        target: "ppt-manual-playback-acceptance",
        mode: "record",
        environment: "production",
        status: "accepted",
        releaseRunId: "uais-release-2026-06-28T000000Z",
        safety: {
          valuesRedacted: true,
          cookieValuesOmitted: true,
          responseBodiesOmitted: true,
          liveRequiresApproval: true,
          remoteMutationRequiresApproval: true,
        },
      }),
    );

    const stdout = execFileSync("node", [
      "scripts/enterprise-live-evidence-audit.mjs",
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-06-28",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(stdout);

    expect(body.status).toBe("blocked");
    expect(body.rows).toEqual([
      expect.objectContaining({
        file: "2026-06-28-ppt-manual-playback-acceptance-production-live.json",
        target: "ppt-manual-playback-acceptance",
        mode: "record",
        status: "accepted",
        targetResultStatus: "missing",
        missingResultKeys: pptManualPlaybackAcceptanceResultKeys,
        acceptanceStatus: "not-accepted-filename-only",
        blockedReasons: ["target-result-proof-missing"],
      }),
    ]);
    expect(stdout).not.toContain("uais-release-2026-06-28T000000Z");
    expect(stdout).not.toContain(reportsDir);
  });

  it("rejects teacher-auth issuer route production-live evidence without route result proof", () => {
    const reportsDir = mkdtempSync(join(tmpdir(), "uais-live-evidence-audit-issuer-route-"));

    writeFileSync(
      join(reportsDir, "2026-06-28-teacher-auth-issuer-route-smoke-production-live.json"),
      JSON.stringify({
        target: "teacher-auth-issuer-route-smoke",
        mode: "live",
        environment: "production",
        status: "passed",
        releaseRunId: "uais-release-2026-06-28T000000Z",
        safety: {
          valuesRedacted: true,
          cookieValuesOmitted: true,
          responseBodiesOmitted: true,
          liveRequiresApproval: true,
          remoteMutationRequiresApproval: true,
        },
      }),
    );

    const stdout = execFileSync("node", [
      "scripts/enterprise-live-evidence-audit.mjs",
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-06-28",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(stdout);

    expect(body.status).toBe("blocked");
    expect(body.rows).toEqual([
      expect.objectContaining({
        file: "2026-06-28-teacher-auth-issuer-route-smoke-production-live.json",
        target: "teacher-auth-issuer-route-smoke",
        targetResultStatus: "missing",
        acceptanceStatus: "not-accepted-filename-only",
        blockedReasons: ["target-result-proof-missing"],
        missingResultKeys: teacherAuthIssuerRouteSmokeResultIds,
      }),
    ]);
    expect(stdout).not.toContain("uais-release-2026-06-28T000000Z");
    expect(stdout).not.toContain(reportsDir);
  });

  it("rejects external-storage-persistence production-live evidence without readback results", () => {
    const reportsDir = mkdtempSync(join(tmpdir(), "uais-live-evidence-audit-persistence-result-"));

    writeFileSync(
      join(reportsDir, "2026-06-28-external-storage-persistence-production-live.json"),
      JSON.stringify({
        target: "external-storage-persistence",
        mode: "live",
        environment: "production",
        status: "passed",
        releaseRunId: "uais-release-2026-06-28T000000Z",
        safety: {
          valuesRedacted: true,
          cookieValuesOmitted: true,
          responseBodiesOmitted: true,
          liveRequiresApproval: true,
          remoteMutationRequiresApproval: true,
        },
      }),
    );

    const stdout = execFileSync("node", [
      "scripts/enterprise-live-evidence-audit.mjs",
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-06-28",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(stdout);

    expect(body.status).toBe("blocked");
    expect(body.rows).toEqual([
      expect.objectContaining({
        file: "2026-06-28-external-storage-persistence-production-live.json",
        target: "external-storage-persistence",
        targetResultStatus: "missing",
        acceptanceStatus: "not-accepted-filename-only",
        blockedReasons: ["target-result-proof-missing"],
        missingResultKeys: externalStoragePersistenceResultIds,
      }),
    ]);
    expect(stdout).not.toContain("uais-release-2026-06-28T000000Z");
    expect(stdout).not.toContain(reportsDir);
  });

  it("rejects app-auth readiness production-live evidence without readiness result proof", () => {
    const reportsDir = mkdtempSync(join(tmpdir(), "uais-live-evidence-audit-app-auth-results-"));

    writeFileSync(
      join(reportsDir, "2026-06-28-app-auth-provider-readiness-production-live.json"),
      JSON.stringify({
        target: "app-auth-provider-readiness",
        mode: "live",
        environment: "production",
        status: "ready",
        releaseRunId: "uais-release-2026-06-28T000000Z",
        safety: {
          valuesRedacted: true,
          cookieValuesOmitted: true,
          responseBodiesOmitted: true,
          liveRequiresApproval: true,
          remoteMutationRequiresApproval: true,
        },
      }),
    );

    const stdout = execFileSync("node", [
      "scripts/enterprise-live-evidence-audit.mjs",
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-06-28",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(stdout);

    expect(body.status).toBe("blocked");
    expect(body.rows).toEqual([
      expect.objectContaining({
        file: "2026-06-28-app-auth-provider-readiness-production-live.json",
        target: "app-auth-provider-readiness",
        targetResultStatus: "missing",
        acceptanceStatus: "not-accepted-filename-only",
        blockedReasons: ["target-result-proof-missing"],
        missingResultKeys: appAuthProviderReadinessResultKeys,
      }),
    ]);
    expect(stdout).not.toContain("uais-release-2026-06-28T000000Z");
    expect(stdout).not.toContain(reportsDir);
  });

  it("rejects teacher-auth readiness production-live evidence without readiness result proof", () => {
    const reportsDir = mkdtempSync(join(tmpdir(), "uais-live-evidence-audit-teacher-auth-results-"));

    writeFileSync(
      join(reportsDir, "2026-06-28-teacher-auth-provider-readiness-production-live.json"),
      JSON.stringify({
        target: "teacher-auth-provider-readiness",
        mode: "live",
        environment: "production",
        status: "ready",
        releaseRunId: "uais-release-2026-06-28T000000Z",
        safety: {
          valuesRedacted: true,
          cookieValuesOmitted: true,
          responseBodiesOmitted: true,
          liveRequiresApproval: true,
          remoteMutationRequiresApproval: true,
        },
      }),
    );

    const stdout = execFileSync("node", [
      "scripts/enterprise-live-evidence-audit.mjs",
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-06-28",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(stdout);

    expect(body.status).toBe("blocked");
    expect(body.rows).toEqual([
      expect.objectContaining({
        file: "2026-06-28-teacher-auth-provider-readiness-production-live.json",
        target: "teacher-auth-provider-readiness",
        targetResultStatus: "missing",
        acceptanceStatus: "not-accepted-filename-only",
        blockedReasons: ["target-result-proof-missing"],
        missingResultKeys: teacherAuthProviderReadinessResultKeys,
      }),
    ]);
    expect(stdout).not.toContain("uais-release-2026-06-28T000000Z");
    expect(stdout).not.toContain(reportsDir);
  });

  it("rejects external-storage service readiness production-live evidence without readiness result proof", () => {
    const reportsDir = mkdtempSync(join(tmpdir(), "uais-live-evidence-audit-storage-service-results-"));

    writeFileSync(
      join(reportsDir, "2026-06-28-external-storage-service-readiness-production-live.json"),
      JSON.stringify({
        target: "external-storage-service-readiness",
        mode: "live",
        environment: "production",
        status: "ready",
        releaseRunId: "uais-release-2026-06-28T000000Z",
        safety: {
          valuesRedacted: true,
          cookieValuesOmitted: true,
          responseBodiesOmitted: true,
          liveRequiresApproval: true,
          remoteMutationRequiresApproval: true,
        },
      }),
    );

    const stdout = execFileSync("node", [
      "scripts/enterprise-live-evidence-audit.mjs",
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-06-28",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(stdout);

    expect(body.status).toBe("blocked");
    expect(body.rows).toEqual([
      expect.objectContaining({
        file: "2026-06-28-external-storage-service-readiness-production-live.json",
        target: "external-storage-service-readiness",
        targetResultStatus: "missing",
        acceptanceStatus: "not-accepted-filename-only",
        blockedReasons: ["target-result-proof-missing"],
        missingResultKeys: externalStorageServiceReadinessResultKeys,
      }),
    ]);
    expect(stdout).not.toContain("uais-release-2026-06-28T000000Z");
    expect(stdout).not.toContain(reportsDir);
  });

  it("rejects deployment-domain reachability production-live evidence without domain result proof", () => {
    const reportsDir = mkdtempSync(join(tmpdir(), "uais-live-evidence-audit-domain-results-"));

    writeFileSync(
      join(reportsDir, "2026-06-28-deployment-domain-reachability-production-live.json"),
      JSON.stringify({
        target: "deployment-domain-reachability",
        mode: "live",
        environment: "production",
        status: "reachable",
        releaseRunId: "uais-release-2026-06-28T000000Z",
        safety: {
          valuesRedacted: true,
          cookieValuesOmitted: true,
          responseBodiesOmitted: true,
          liveRequiresApproval: true,
          remoteMutationRequiresApproval: true,
        },
      }),
    );

    const stdout = execFileSync("node", [
      "scripts/enterprise-live-evidence-audit.mjs",
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-06-28",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(stdout);

    expect(body.status).toBe("blocked");
    expect(body.rows).toEqual([
      expect.objectContaining({
        file: "2026-06-28-deployment-domain-reachability-production-live.json",
        target: "deployment-domain-reachability",
        expectedStatus: "reachable",
        targetResultStatus: "missing",
        acceptanceStatus: "not-accepted-filename-only",
        blockedReasons: ["target-result-proof-missing"],
        missingResultKeys: deploymentDomainReachabilityResultKeys,
      }),
    ]);
    expect(stdout).not.toContain("uais-release-2026-06-28T000000Z");
    expect(stdout).not.toContain(reportsDir);
  });

  it("requires target-specific statuses and modes instead of generic live/passed", () => {
    const reportsDir = mkdtempSync(join(tmpdir(), "uais-live-evidence-audit-ready-status-"));

    writeFileSync(
      join(reportsDir, "2026-06-28-app-auth-provider-readiness-production-live.json"),
      JSON.stringify({
        target: "app-auth-provider-readiness",
        mode: "live",
        environment: "production",
        status: "passed",
        releaseRunId: "uais-release-2026-06-28T000000Z",
        safety: {
          valuesRedacted: true,
          cookieValuesOmitted: true,
          responseBodiesOmitted: true,
          liveRequiresApproval: true,
          remoteMutationRequiresApproval: true,
        },
      }),
    );
    writeFileSync(
      join(reportsDir, "2026-06-28-ppt-manual-playback-acceptance-production-live.json"),
      JSON.stringify({
        target: "ppt-manual-playback-acceptance",
        mode: "live",
        environment: "production",
        status: "passed",
        releaseRunId: "uais-release-2026-06-28T000000Z",
        safety: {
          valuesRedacted: true,
          cookieValuesOmitted: true,
          responseBodiesOmitted: true,
          liveRequiresApproval: true,
          remoteMutationRequiresApproval: true,
        },
      }),
    );

    const stdout = execFileSync("node", [
      "scripts/enterprise-live-evidence-audit.mjs",
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-06-28",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(stdout);

    expect(body.status).toBe("blocked");
    expect(body.rows).toEqual([
      expect.objectContaining({
        file: "2026-06-28-app-auth-provider-readiness-production-live.json",
        target: "app-auth-provider-readiness",
        mode: "live",
        expectedMode: "live",
        status: "passed",
        expectedStatus: "ready",
        targetResultStatus: "missing",
        missingResultKeys: appAuthProviderReadinessResultKeys,
        acceptanceStatus: "not-accepted-filename-only",
        blockedReasons: ["status-not-ready", "target-result-proof-missing"],
      }),
      expect.objectContaining({
        file: "2026-06-28-ppt-manual-playback-acceptance-production-live.json",
        target: "ppt-manual-playback-acceptance",
          mode: "live",
          expectedMode: "record",
          status: "passed",
          expectedStatus: "accepted",
          targetResultStatus: "missing",
          missingResultKeys: pptManualPlaybackAcceptanceResultKeys,
          acceptanceStatus: "not-accepted-filename-only",
          blockedReasons: [
            "mode-not-record",
            "status-not-accepted",
            "target-result-proof-missing",
          ],
        }),
    ]);
    expect(stdout).not.toContain("uais-release-2026-06-28T000000Z");
    expect(stdout).not.toContain(reportsDir);
  });

  it("marks the audit ready only when all required enterprise live targets are accepted", () => {
    const reportsDir = mkdtempSync(join(tmpdir(), "uais-live-evidence-audit-required-targets-"));
    const outputPath = join(reportsDir, "audit-output.json");
    const requiredEnterpriseLiveEvidenceTargets =
      readRequiredEnterpriseLiveEvidenceTargets();

    for (const target of requiredEnterpriseLiveEvidenceTargets) {
      writeProductionLiveEvidence({ reportsDir, target });
    }

    const stdout = execFileSync("node", [
      "scripts/enterprise-live-evidence-audit.mjs",
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-06-28",
      "--output",
      outputPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(stdout);
    const writtenBody = JSON.parse(readFileSync(outputPath, "utf8"));

    expect(body).toEqual(writtenBody);
    expect(body.status).toBe("ready");
    expect(body.summary).toEqual(
      expect.objectContaining({
        totalProductionLiveNamed: requiredEnterpriseLiveEvidenceTargets.length,
        acceptedLiveEvidence: requiredEnterpriseLiveEvidenceTargets.length,
        filenameOnlyOrBlocked: 0,
        releaseRunIdConsistency: "matched",
        sharedReleaseRunIdStatus: "present",
        distinctReleaseRunIdCount: 1,
        requiredTargetProofStatus: "proved",
        missingRequiredTargetCount: 0,
      }),
    );
    expect(body.requiredTargets).toEqual(requiredEnterpriseLiveEvidenceTargets);
    expect(body.acceptedTargets).toEqual([...requiredEnterpriseLiveEvidenceTargets].sort());
    expect(body.missingRequiredTargets).toEqual([]);
    expect(body.blockedReasons).toEqual([]);
    expect(stdout).not.toContain("uais-release-2026-06-28T000000Z");
    expect(stdout).not.toContain(reportsDir);
    expect(stdout).not.toContain("/Users/");
  });

    it("blocks otherwise ready production-live evidence when an unexpected target is present", () => {
      const reportsDir = mkdtempSync(join(tmpdir(), "uais-live-evidence-audit-extra-target-"));
      const requiredEnterpriseLiveEvidenceTargets =
        readRequiredEnterpriseLiveEvidenceTargets();

    for (const target of requiredEnterpriseLiveEvidenceTargets) {
      writeProductionLiveEvidence({ reportsDir, target });
    }
    writeProductionLiveEvidence({ reportsDir, target: "shadow-live-smoke" });

    const stdout = execFileSync("node", [
      "scripts/enterprise-live-evidence-audit.mjs",
      "--reports-dir",
      reportsDir,
      "--date",
      "2026-06-28",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(stdout);

    expect(body.status).toBe("blocked");
    expect(body.summary).toEqual(
      expect.objectContaining({
        totalProductionLiveNamed: requiredEnterpriseLiveEvidenceTargets.length + 1,
        acceptedLiveEvidence: requiredEnterpriseLiveEvidenceTargets.length,
        filenameOnlyOrBlocked: 1,
          requiredTargetProofStatus: "proved",
          missingRequiredTargetCount: 0,
          unexpectedTargetCount: 1,
          unexpectedEvidenceFileCount: 1,
        }),
      );
      expect(body.blockedReasons).toEqual(
        expect.arrayContaining([
          "filename-only-or-blocked-production-live-evidence",
          "enterprise-live-unexpected-targets-present",
          "enterprise-live-unexpected-evidence-files-present",
        ]),
      );
      expect(body.unexpectedTargets).toEqual(["shadow-live-smoke"]);
      expect(body.unexpectedEvidenceFiles).toEqual([
        "2026-06-28-shadow-live-smoke-production-live.json",
      ]);
      expect(body.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file: "2026-06-28-shadow-live-smoke-production-live.json",
            target: "shadow-live-smoke",
            acceptanceStatus: "not-accepted-filename-only",
            blockedReasons: ["target-not-required"],
          }),
        ]),
      );
      expect(stdout).not.toContain(reportsDir);
      expect(stdout).not.toContain("/Users/");
    });

    it("ignores non-evidence templates that are named like production-live files", () => {
      const reportsDir = mkdtempSync(join(tmpdir(), "uais-live-evidence-audit-template-file-"));
      const requiredEnterpriseLiveEvidenceTargets =
        readRequiredEnterpriseLiveEvidenceTargets();

      for (const target of requiredEnterpriseLiveEvidenceTargets) {
        writeProductionLiveEvidence({ reportsDir, target });
      }
      writeFileSync(
        join(
          reportsDir,
          "2026-06-28-ppt-manual-playback-acceptance-record-template-production-live.json",
        ),
        JSON.stringify({
          recordType: "manual-ppt-playback-acceptance-template",
          status: "template-not-accepted",
        }),
      );

      const stdout = execFileSync("node", [
        "scripts/enterprise-live-evidence-audit.mjs",
        "--reports-dir",
        reportsDir,
        "--date",
        "2026-06-28",
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
      });
      const body = JSON.parse(stdout);

      expect(body.status).toBe("ready");
      expect(body.summary).toEqual(
        expect.objectContaining({
          totalProductionLiveNamed: requiredEnterpriseLiveEvidenceTargets.length,
          acceptedLiveEvidence: requiredEnterpriseLiveEvidenceTargets.length,
          filenameOnlyOrBlocked: 0,
          requiredTargetProofStatus: "proved",
          missingRequiredTargetCount: 0,
          unexpectedTargetCount: 0,
          unexpectedEvidenceFileCount: 0,
        }),
      );
      expect(body.unexpectedTargets).toEqual([]);
      expect(body.unexpectedEvidenceFiles).toEqual([]);
      expect(body.blockedReasons).toEqual([]);
      expect(body.rows).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file: "2026-06-28-ppt-manual-playback-acceptance-record-template-production-live.json",
          }),
        ]),
      );
      expect(stdout).not.toContain(reportsDir);
      expect(stdout).not.toContain("/Users/");
    });

    it("blocks otherwise ready production-live evidence when filename and body targets differ", () => {
      const reportsDir = mkdtempSync(join(tmpdir(), "uais-live-evidence-audit-target-mismatch-"));
      const requiredEnterpriseLiveEvidenceTargets =
        readRequiredEnterpriseLiveEvidenceTargets();
      const [firstTarget, secondTarget, ...remainingTargets] =
        requiredEnterpriseLiveEvidenceTargets;

      writeFileSync(
        join(reportsDir, `2026-06-28-${firstTarget}-production-live.json`),
        JSON.stringify({
          target: secondTarget,
          mode: "live",
          environment: "production",
          status: acceptedTargetStatus(secondTarget),
          releaseRunId: "uais-release-2026-06-28T000000Z",
          safety: {
            valuesRedacted: true,
            cookieValuesOmitted: true,
            responseBodiesOmitted: true,
            liveRequiresApproval: true,
            remoteMutationRequiresApproval: true,
          },
        }),
      );
      writeFileSync(
        join(reportsDir, `2026-06-28-${secondTarget}-production-live.json`),
        JSON.stringify({
          target: firstTarget,
          mode: "live",
          environment: "production",
          status: acceptedTargetStatus(firstTarget),
          releaseRunId: "uais-release-2026-06-28T000000Z",
          safety: {
            valuesRedacted: true,
            cookieValuesOmitted: true,
            responseBodiesOmitted: true,
            liveRequiresApproval: true,
            remoteMutationRequiresApproval: true,
          },
        }),
      );
      for (const target of remainingTargets) {
        writeProductionLiveEvidence({ reportsDir, target });
      }

      const stdout = execFileSync("node", [
        "scripts/enterprise-live-evidence-audit.mjs",
        "--reports-dir",
        reportsDir,
        "--date",
        "2026-06-28",
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
      });
      const body = JSON.parse(stdout);

      expect(body.status).toBe("blocked");
      expect(body.summary).toEqual(
        expect.objectContaining({
          totalProductionLiveNamed: requiredEnterpriseLiveEvidenceTargets.length,
          acceptedLiveEvidence: requiredEnterpriseLiveEvidenceTargets.length - 2,
          filenameOnlyOrBlocked: 2,
          requiredTargetProofStatus: "missing",
          missingRequiredTargetCount: 2,
          unexpectedEvidenceFileCount: 2,
        }),
      );
      expect(body.blockedReasons).toEqual(
        expect.arrayContaining([
          "filename-only-or-blocked-production-live-evidence",
          "enterprise-live-required-targets-missing",
          "enterprise-live-unexpected-evidence-files-present",
        ]),
      );
      expect(body.unexpectedEvidenceFiles).toEqual([
        `2026-06-28-${firstTarget}-production-live.json`,
        `2026-06-28-${secondTarget}-production-live.json`,
      ]);
      expect(body.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file: `2026-06-28-${firstTarget}-production-live.json`,
            filenameTarget: firstTarget,
            target: secondTarget,
            acceptanceStatus: "not-accepted-filename-only",
            blockedReasons: expect.arrayContaining([
              "target-result-proof-missing",
              "target-filename-mismatch",
            ]),
            missingResultKeys: teacherAuthIssuerRouteSmokeResultIds,
          }),
          expect.objectContaining({
            file: `2026-06-28-${secondTarget}-production-live.json`,
            filenameTarget: secondTarget,
            target: firstTarget,
            acceptanceStatus: "not-accepted-filename-only",
            blockedReasons: expect.arrayContaining([
              "target-result-proof-missing",
              "target-filename-mismatch",
            ]),
            missingResultKeys: appAuthProviderReadinessResultKeys,
          }),
        ]),
      );
      expect(stdout).not.toContain(reportsDir);
      expect(stdout).not.toContain("/Users/");
    });
});
