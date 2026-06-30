#!/usr/bin/env node

import { readFileSync } from "node:fs";

const enterpriseLiveEvidenceAuditSource = readFileSync(
  new URL("./enterprise-live-evidence-audit.mjs", import.meta.url),
  "utf8",
);
const teachingOperationsRouteSmokeSource = readFileSync(
  new URL("./teaching-operations-route-smoke.mjs", import.meta.url),
  "utf8",
);

function extractConstStringArray(source, name) {
  const match = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));

  if (!match) {
    throw new Error(`Missing string array constant: ${name}`);
  }

  return [...match[1].matchAll(/"([^"]+)"/g)].map(([, value]) => value);
}

function extractConstStringObject(source, name) {
  const match = source.match(new RegExp(`const ${name} = \\{([\\s\\S]*?)\\};`));

  if (!match) {
    throw new Error(`Missing string object constant: ${name}`);
  }

  return Object.fromEntries(
    [...match[1].matchAll(/"([^"]+)":\s*"([^"]+)"/g)].map(([, key, value]) => [
      key,
      value,
    ]),
  );
}

const commonRequiredVercelEnvNames = [
  "UAIS_LIVE_AI_APPROVAL_TOKEN",
  "UAIS_AI_ACCESS_SIGNING_SECRET",
  "UAIS_APP_SESSION_SIGNING_SECRET",
  "UAIS_APP_AUTH_PROVIDER",
  "UAIS_APP_AUTH_PROVIDER_URL",
  "UAIS_APP_AUTH_PROVIDER_TOKEN",
  "UAIS_TEACHER_AUTH_PROVIDER",
  "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
  "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
  "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND",
  "UAIS_TEACHING_OPERATIONS_BACKEND",
  "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
  "UAIS_TEACHING_COURSE_ASSETS_BACKEND",
  "UAIS_EXTERNAL_STORAGE_BASE_URL",
  "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
  "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER",
  "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_URL",
  "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN",
  "UAIS_COLLABORATION_INVITE_EMAIL_CALLBACK_TOKEN",
  "UAIS_STUDENT_ROSTER_SYNC_PROVIDER",
  "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_URL",
  "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_TOKEN",
  "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER",
  "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_URL",
  "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_TOKEN",
  "UAIS_GRADEBOOK_RELEASE_PROVIDER",
  "UAIS_GRADEBOOK_RELEASE_PROVIDER_URL",
  "UAIS_GRADEBOOK_RELEASE_PROVIDER_TOKEN",
  "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER",
  "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_URL",
  "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_TOKEN",
  "UAIS_COURSE_EXPORT_PROVIDER",
  "UAIS_COURSE_EXPORT_PROVIDER_URL",
  "UAIS_COURSE_EXPORT_PROVIDER_TOKEN",
  "UAIS_GRADING_FEEDBACK_PROVIDER",
  "UAIS_GRADING_FEEDBACK_PROVIDER_URL",
  "UAIS_GRADING_FEEDBACK_PROVIDER_TOKEN",
  "DEEPSEEK_API_KEY",
  "DASHSCOPE_API_KEY",
];

const authProviderRequiredVercelEnvNames = {
  "trusted-cookie-issuer": ["UAIS_TEACHER_AUTH_ISSUER_SECRET"],
  "oidc-jwks": [
    "UAIS_TEACHER_AUTH_OIDC_ISSUER",
    "UAIS_TEACHER_AUTH_OIDC_AUDIENCE",
    "UAIS_TEACHER_AUTH_OIDC_JWKS_URL",
    "UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM",
  ],
};

const minimumProductionSecretLength = 32;
const commonProductionSecretStrengthNames = [
  "UAIS_LIVE_AI_APPROVAL_TOKEN",
  "UAIS_AI_ACCESS_SIGNING_SECRET",
  "UAIS_APP_SESSION_SIGNING_SECRET",
  "UAIS_APP_AUTH_PROVIDER_TOKEN",
  "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
  "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
  "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN",
  "UAIS_COLLABORATION_INVITE_EMAIL_CALLBACK_TOKEN",
  "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_TOKEN",
  "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_TOKEN",
  "UAIS_GRADEBOOK_RELEASE_PROVIDER_TOKEN",
  "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_TOKEN",
  "UAIS_COURSE_EXPORT_PROVIDER_TOKEN",
  "UAIS_GRADING_FEEDBACK_PROVIDER_TOKEN",
];
const authProviderProductionSecretStrengthNames = {
  "trusted-cookie-issuer": ["UAIS_TEACHER_AUTH_ISSUER_SECRET"],
  "oidc-jwks": [],
};

const requiredVercelEnvTargets = ["production", "preview"];

const requiredRouteSmokeIds = [
  "s22-retention-readiness-route",
  "s22-voice-lifecycle-audit-route",
  "s22-ai-readiness-route",
  "s22-ai-smoke-plan-route",
  "s22-teacher-auth-issuer-route",
  "s22-teacher-ai-session-route",
  "s22-teacher-ownership-route",
  "s22-teacher-ppt-workflow-route",
];
const requiredEnterpriseLiveEvidenceAuditTargets = extractConstStringArray(
  enterpriseLiveEvidenceAuditSource,
  "requiredEnterpriseLiveEvidenceTargets",
);
const requiredEnterpriseLiveEvidenceAuditSafetyFlags = extractConstStringArray(
  enterpriseLiveEvidenceAuditSource,
  "requiredSafetyFlags",
);
const acceptedEnterpriseLiveEvidenceAuditTargetStatuses = extractConstStringObject(
  enterpriseLiveEvidenceAuditSource,
  "acceptedTargetStatuses",
);
const acceptedEnterpriseLiveEvidenceAuditTargetModes = extractConstStringObject(
  enterpriseLiveEvidenceAuditSource,
  "acceptedTargetModes",
);
const requiredAppAuthProviderReadinessResultKeys = extractConstStringArray(
  enterpriseLiveEvidenceAuditSource,
  "requiredAppAuthProviderReadinessResultKeys",
);
const requiredTeacherAuthProviderReadinessResultKeys = extractConstStringArray(
  enterpriseLiveEvidenceAuditSource,
  "requiredTeacherAuthProviderReadinessResultKeys",
);
const requiredExternalStorageServiceReadinessResultKeys = extractConstStringArray(
  enterpriseLiveEvidenceAuditSource,
  "requiredExternalStorageServiceReadinessResultKeys",
);
const requiredDeploymentDomainReachabilityResultKeys = extractConstStringArray(
  enterpriseLiveEvidenceAuditSource,
  "requiredDeploymentDomainReachabilityResultKeys",
);
const requiredPptManualPlaybackAcceptanceResultKeys = extractConstStringArray(
  enterpriseLiveEvidenceAuditSource,
  "requiredPptManualPlaybackAcceptanceResultKeys",
);
const requiredExternalStoragePersistenceResultIds = extractConstStringArray(
  enterpriseLiveEvidenceAuditSource,
  "requiredExternalStoragePersistenceResultIds",
);
const requiredTeacherAuthIssuerRouteSmokeResultIds = extractConstStringArray(
  enterpriseLiveEvidenceAuditSource,
  "requiredTeacherAuthIssuerRouteSmokeResultIds",
);
const requiredTeachingOperationDetailBrowserContractKeys = extractConstStringArray(
  enterpriseLiveEvidenceAuditSource,
  "requiredTeachingOperationDetailBrowserContractKeys",
);

function readEnterpriseLiveEvidenceAuditExpectedStatus(target) {
  return acceptedEnterpriseLiveEvidenceAuditTargetStatuses[target] ?? "passed";
}

function readEnterpriseLiveEvidenceAuditExpectedMode(target) {
  return acceptedEnterpriseLiveEvidenceAuditTargetModes[target] ?? "live";
}

function readEnterpriseLiveEvidenceAuditRequiredTargetResultKeys() {
  return {
    "app-auth-provider-readiness": requiredAppAuthProviderReadinessResultKeys,
    "teacher-auth-issuer-route-smoke": requiredTeacherAuthIssuerRouteSmokeResultIds,
    "teacher-auth-provider-readiness": requiredTeacherAuthProviderReadinessResultKeys,
    "external-storage-persistence": requiredExternalStoragePersistenceResultIds,
    "external-storage-service-readiness": requiredExternalStorageServiceReadinessResultKeys,
    "deployment-domain-reachability": requiredDeploymentDomainReachabilityResultKeys,
    "deployment-route-smoke": requiredRouteSmokeIds,
    "teacher-workflow-deployment-smoke": requiredDeployedTeacherWorkflowAnchors,
    "teacher-workflow-browser-smoke": requiredTeacherWorkflowBrowserResults,
    "teacher-workflow-live-generation-smoke": requiredTeacherWorkflowLiveGenerationResults,
    "learning-ppt-playback-deployment-smoke": requiredLearningPptPlaybackResults,
    "ppt-manual-playback-acceptance": requiredPptManualPlaybackAcceptanceResultKeys,
    "teaching-operations-route-smoke": requiredTeachingOperationsRouteSmokeResults,
    "teaching-operation-detail-browser-smoke": requiredTeachingOperationDetailBrowserResults,
    "teaching-course-management-route-smoke": requiredTeachingCourseManagementRouteSmokeResults,
    "external-storage-smoke": requiredExternalStorageSmokeIds,
  };
}

function readEnterpriseLiveEvidenceAuditRequiredTargetResultKeysForTarget(target) {
  return readEnterpriseLiveEvidenceAuditRequiredTargetResultKeys()[target] ?? [];
}

function readEnterpriseLiveEvidenceAuditExpectedTargetResultStatus(target) {
  return readEnterpriseLiveEvidenceAuditRequiredTargetResultKeysForTarget(target).length > 0
    ? "proved"
    : "not-required";
}

function readEnterpriseLiveEvidenceAuditRequiredTargetEnvKeys() {
  return {
    "teaching-operations-route-smoke": requiredTeachingOperationsRouteSmokeEnvNames,
    "teaching-course-management-route-smoke":
      requiredTeachingCourseManagementRouteSmokeEnvNames,
  };
}

function readEnterpriseLiveEvidenceAuditRequiredTargetEnvKeysForTarget(target) {
  return readEnterpriseLiveEvidenceAuditRequiredTargetEnvKeys()[target] ?? [];
}

function readEnterpriseLiveEvidenceAuditExpectedTargetEnvStatus(target) {
  return readEnterpriseLiveEvidenceAuditRequiredTargetEnvKeysForTarget(target).length > 0
    ? "proved"
    : "not-required";
}

function readEnterpriseLiveEvidenceAuditRequiredTargetContractKeys() {
  return {
    "teaching-operations-route-smoke": requiredTeachingOperationsRouteSmokeProofs,
    "teaching-course-management-route-smoke":
      requiredTeachingCourseManagementRouteSmokeProofs,
    "teaching-operation-detail-browser-smoke":
      requiredTeachingOperationDetailBrowserContractKeys,
  };
}

function readEnterpriseLiveEvidenceAuditRequiredTargetContractKeysForTarget(target) {
  return readEnterpriseLiveEvidenceAuditRequiredTargetContractKeys()[target] ?? [];
}

function readEnterpriseLiveEvidenceAuditExpectedTargetContractStatus(target) {
  return readEnterpriseLiveEvidenceAuditRequiredTargetContractKeysForTarget(target).length > 0
    ? "proved"
    : "not-required";
}

const acceptedTeacherAuthProviderModes = ["trusted-cookie-issuer", "oidc-jwks"];
const acceptedAppAuthProviderModes = ["trusted-account-provider"];
const acceptedOidcEndpointClasses = [
  "remote-https",
  "insecure-http",
  "local-loopback",
  "private-network",
  "invalid",
  "missing",
];
const acceptedStorageNetworkClasses = [
  "remote",
  "local-loopback",
  "private-network",
  "invalid",
  "missing",
];

const expectedIssuerRouteAuthByProvider = {
  "trusted-cookie-issuer": "signed-admin-ai-access",
  "oidc-jwks": "oidc-jwks-bearer-token",
};

const requiredTeacherAuthIssuerHeaderChecks = [
  "teacherAuthClaimsSetCookie",
  "teacherAuthSignatureSetCookie",
  "httpOnlySameSiteSecureMaxAge",
  "priorityHigh",
  "issuerProofBoundedMaxAge",
];

const requiredTrustedRouteResponseShapes = [
  {
    key: "teacherAuthIssuer",
    routeId: "s22-teacher-auth-issuer-route",
    requiredFields: [
      "teacherAuthSession",
      "authProviderContract",
      "s12TeacherAuthIssuerBoundary",
    ],
  },
  {
    key: "teacherAiSession",
    routeId: "s22-teacher-ai-session-route",
    requiredFields: [
      "accessSession",
      "accessPlan",
      "authProviderContract",
      "s12TeacherAiSessionBoundary",
      "signedContractDirectCallDenied",
    ],
  },
  {
    key: "teacherOwnership",
    routeId: "s22-teacher-ownership-route",
    requiredFields: ["ownership", "consistency", "s12TeacherOwnershipSummary"],
  },
  {
    key: "teacherPptWorkflow",
    routeId: "s22-teacher-ppt-workflow-route",
    requiredFields: [
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

const requiredTeacherAiDirectCallBoundaryProbes = [
  {
    route: "/api/ai/ppt-narration",
    method: "POST",
  },
  {
    route: "/api/ai/chat",
    method: "POST",
  },
  {
    route: "/api/ai/voice-sample",
    method: "POST",
  },
  {
    route: "/api/ai/voice-clone/preflight",
    method: "POST",
  },
  {
    route: "/api/ai/voice-clone/status",
    method: "POST",
  },
  {
    route: "/api/ai/voice-clone/revoke",
    method: "POST",
  },
  {
    route: "/api/ai/ppt-narration/export/{audioManifestId}",
    method: "GET",
  },
  {
    route: "/api/ai/ppt-narration/audio/{audioManifestId}/{audioId}",
    method: "GET",
  },
];

const requiredTeacherAiTeacherCookieRouteProbes = [
  {
    route: "/api/ai/teacher-ownership",
    method: "GET",
    expectedStatus: 401,
    reasonCode: "authenticated-session-required",
  },
  {
    route: "/api/ai/teacher-ppt-workflow",
    method: "GET",
    expectedStatus: 401,
    reasonCode: "authenticated-session-required",
  },
];

const requiredTeacherAiAdminRouteDirectCallProbes = [
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

const requiredExternalStorageSmokeIds = [
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
];

const requiredLocalProductionE2eSmokeCheckIds = [
  "s22-local-external-storage-reference-service",
  "s22-next-production-build",
  "s22-next-start-local-production-server",
  "s22-local-learning-ppt-playback-smoke",
  "s22-local-teacher-workflow-page-smoke",
  "s22-local-teacher-workflow-browser-smoke",
  "s22-local-protected-route-smoke",
  "s22-local-app-auth-provider-readiness",
  "s22-local-teaching-operations-route-smoke",
  "s22-local-teaching-course-management-route-smoke",
  "s22-local-teaching-operation-detail-browser-smoke",
];

const requiredTeachingOperationsRouteSmokeResults = [
  "unauthenticatedPostDenied",
  "unauthenticatedPostNoWriteSideEffects",
  "signedStudentPostDenied",
  "signedStudentNoWriteSideEffects",
  "unsafeAppSessionPostDenied",
  "unsafeAppSessionPostTraceHeaderReturned",
  "unsafeAppSessionPostNoWriteSideEffects",
  "signedTeacherCourseIdRequired",
  "signedTeacherCourseIdRequiredNoWriteSideEffects",
  "forbiddenCourseScopeDenied",
  "forbiddenCourseScopeNoWriteSideEffects",
  "authorizedOperationPersisted",
  "durableExternalPersistenceReturned",
  "domainPersistenceSummaryReturned",
  "operationsSchemaMigrationPolicyReturned",
  "appendLedgerSequenceReturned",
  "appendLedgerSequenceReadbackReturned",
  "signedActorReturned",
  "courseBindingReturned",
  "auditTraceReturned",
  "auditAuthSessionReturned",
  "auditRequestSourceProvenanceReturned",
  "unauthenticatedTraceHeaderReturned",
  "signedStudentTraceHeaderReturned",
  "unauthenticatedAuditReadbackDenied",
  "unauthenticatedAuditReadbackTraceHeaderReturned",
  "signedStudentAuditReadbackDenied",
  "signedStudentAuditReadbackTraceHeaderReturned",
  "unsafeAppSessionAuditReadbackDenied",
  "unsafeAppSessionAuditReadbackTraceHeaderReturned",
  "unauthenticatedAlertNotificationEnqueueDenied",
  "unauthenticatedAlertNotificationTraceHeaderReturned",
  "signedStudentAlertNotificationEnqueueDenied",
  "signedStudentAlertNotificationTraceHeaderReturned",
  "unauthenticatedAlertNotificationNoWriteSideEffects",
  "signedStudentAlertNotificationNoWriteSideEffects",
  "unauthenticatedAlertNotificationReadbackDenied",
  "unauthenticatedAlertNotificationReadbackTraceHeaderReturned",
  "signedStudentAlertNotificationReadbackDenied",
  "signedStudentAlertNotificationReadbackTraceHeaderReturned",
  "authorizedTraceHeaderReturned",
  "auditReadbackReturned",
  "auditAuthSessionReadbackReturned",
  "auditReadbackTraceHeaderReturned",
  "domainProjectionReadbackReturned",
  "externalDomainProjectionReadbackReturned",
  "courseSettingsDomainObjectReturned",
  "courseSettingsPatchReadbackReturned",
  "studentPreviewSessionDomainObjectReturned",
  "studentPreviewSessionAuditSourceReturned",
  "studentRosterSyncDomainObjectReturned",
  "studentRosterDomainPersistenceSummaryReturned",
  "studentRosterProviderSyncReturned",
  "studentRosterProviderSyncAuditSourceReturned",
  "studentGroupSuggestionDomainObjectReturned",
  "studentGroupSuggestionAuditSourceReturned",
  "knowledgeIndexSyncDomainObjectReturned",
  "knowledgeIndexDomainPersistenceSummaryReturned",
  "knowledgeIndexProviderSyncReturned",
  "knowledgeIndexProviderSyncAuditSourceReturned",
  "resourceReviewItemDomainObjectReturned",
  "resourceReviewItemAuditSourceReturned",
  "courseContentPublishDomainObjectReturned",
  "courseContentDomainPersistenceSummaryReturned",
  "courseContentProviderPublishReturned",
  "courseContentProviderPublishAuditSourceReturned",
  "courseUnitDraftDomainObjectReturned",
  "courseUnitDraftAuditSourceReturned",
  "dashboardRefreshDomainObjectReturned",
  "dashboardRefreshDomainPersistenceSummaryReturned",
  "dashboardRefreshAuditSourceReturned",
  "dashboardSnapshotDomainObjectReturned",
  "dashboardSnapshotAuditSourceReturned",
  "quizAssessmentDomainObjectReturned",
  "quizAssessmentDomainPersistenceSummaryReturned",
  "quizItemReviewDomainObjectReturned",
  "quizItemReviewDomainPersistenceSummaryReturned",
  "quizItemReviewAuditSourceReturned",
  "agentSettingsDomainObjectReturned",
  "agentSettingsAuditSourceReturned",
  "agentPermissionPreflightDomainObjectReturned",
  "agentPermissionPreflightAuditSourceReturned",
  "adminSettingsDomainObjectReturned",
  "adminSettingsAuditSourceReturned",
  "collaborationInviteNotificationDomainObjectReturned",
  "collaborationInviteDomainPersistenceSummaryReturned",
  "collaborationInviteEmailDeliveryReturned",
  "collaborationInviteEmailDeliveryAuditSourceReturned",
  "unauthenticatedCollaborationInviteEmailBounceCallbackDenied",
  "unauthenticatedCollaborationInviteEmailBounceCallbackTraceHeaderReturned",
  "unauthenticatedCollaborationInviteEmailBounceCallbackNoWriteSideEffects",
  "signedStudentCollaborationInviteEmailBounceCallbackDenied",
  "signedStudentCollaborationInviteEmailBounceCallbackTraceHeaderReturned",
  "signedStudentCollaborationInviteEmailBounceCallbackNoWriteSideEffects",
  "invalidTokenCollaborationInviteEmailBounceCallbackDenied",
  "invalidTokenCollaborationInviteEmailBounceCallbackTraceHeaderReturned",
  "invalidTokenCollaborationInviteEmailBounceCallbackNoWriteSideEffects",
  "unsafeCollaborationInviteEmailBounceCallbackDenied",
  "unsafeCollaborationInviteEmailBounceCallbackTraceHeaderReturned",
  "unsafeCollaborationInviteEmailBounceCallbackNoWriteSideEffects",
  "collaborationInviteEmailBounceCallbackReturned",
  "collaborationInviteEmailCallbackAuditSourceReturned",
  "courseExportManifestDomainObjectReturned",
  "courseExportProviderReturned",
  "courseExportProviderAuditSourceReturned",
  "courseExportManifestAuditSourceReturned",
  "unauthenticatedExportManifestDownloadDenied",
  "unauthenticatedExportManifestDownloadTraceHeaderReturned",
  "signedStudentExportManifestDownloadDenied",
  "signedStudentExportManifestDownloadTraceHeaderReturned",
  "exportManifestDownloadReadbackReturned",
  "unsafeExportManifestIdDenied",
  "courseExportRedactionValidationDomainObjectReturned",
  "exportRedactionValidationAuditSourceReturned",
  "gradingQueueDomainObjectReturned",
  "gradebookUpdateDomainObjectReturned",
  "gradingDomainPersistenceSummaryReturned",
  "gradingFeedbackDraftDomainObjectReturned",
  "gradingFeedbackProviderReturned",
  "gradingFeedbackProviderAuditSourceReturned",
  "idempotentRetryReturned",
  "idempotentRetryAppendSequenceStableReturned",
  "concurrentIdempotentRetryAppendSequenceStableReturned",
  "idempotencyConflictDenied",
  "unauthenticatedRollbackDenied",
  "unauthenticatedRollbackTraceHeaderReturned",
  "unauthenticatedRollbackNoWriteSideEffects",
  "signedStudentRollbackDenied",
  "signedStudentRollbackTraceHeaderReturned",
  "signedStudentRollbackNoWriteSideEffects",
  "rollbackPersistedReturned",
  "rollbackProductionDatabaseAdapterReturned",
  "rollbackTraceHeaderReturned",
  "rollbackTraceClosureReturned",
  "rollbackReadbackReturned",
  "rollbackReadbackTraceHeaderReturned",
  "unauthenticatedAlertSummaryReadbackDenied",
  "unauthenticatedAlertSummaryReadbackTraceHeaderReturned",
  "signedStudentAlertSummaryReadbackDenied",
  "signedStudentAlertSummaryReadbackTraceHeaderReturned",
  "alertSummaryReadbackReturned",
  "alertNotificationQueuedReturned",
  "alertNotificationReadbackReturned",
  "inviteCodeDraftDomainObjectReturned",
  "inviteCodeDraftAuditSourceReturned",
  "invitePublishClassJoinEntryReturned",
  "invitePublishDomainPersistenceSummaryReturned",
  "inviteCodePublishAuditSourceReturned",
  "studentInviteJoinReturned",
  "unauthenticatedGradebookReleaseDenied",
  "unauthenticatedGradebookReleaseTraceHeaderReturned",
  "unauthenticatedGradebookRollbackDenied",
  "unauthenticatedGradebookRollbackTraceHeaderReturned",
  "signedStudentGradebookReleaseDenied",
  "signedStudentGradebookReleaseTraceHeaderReturned",
  "signedStudentGradebookRollbackDenied",
  "signedStudentGradebookRollbackTraceHeaderReturned",
  "unauthenticatedGradebookReleaseNoWriteSideEffects",
  "unauthenticatedGradebookRollbackNoWriteSideEffects",
  "signedStudentGradebookReleaseNoWriteSideEffects",
  "signedStudentGradebookRollbackNoWriteSideEffects",
  "unsafeGradebookReleaseObjectIdDenied",
  "unsafeGradebookRollbackObjectIdDenied",
  "gradebookReleaseTraceClosureReturned",
  "gradebookReleaseAuditSourceReturned",
  "gradebookReleaseExternalStorageReturned",
  "gradebookProviderReleaseReturned",
  "gradebookRollbackTraceClosureReturned",
  "gradebookRollbackAuditSourceReturned",
  "gradebookRollbackExternalStorageReturned",
  "gradebookProviderRollbackReturned",
  "externalBackupCreatedReturned",
  "unauthenticatedBackupRestoreDenied",
  "unauthenticatedBackupRestoreTraceHeaderReturned",
  "unauthenticatedBackupRestoreNoWriteSideEffects",
  "signedStudentBackupRestoreDenied",
  "signedStudentBackupRestoreTraceHeaderReturned",
  "signedStudentBackupRestoreNoWriteSideEffects",
  "directBackupRestoreDisabledReturned",
  "directBackupRestoreTraceClosureReturned",
  "directBackupRestoreNoWriteSideEffects",
  "unsafeBackupRestoreIdDenied",
  "unsafeBackupRestoreNoWriteSideEffects",
  "externalRestoreDrillVerifiedReturned",
];

const requiredTeachingOperationsRouteSmokeRoutes = [
  "/api/teaching/operations",
  "/api/teaching/operations/audit",
  "/api/teaching/operations/audit/alerts",
  "/api/teaching/operations/audit/alerts/notifications",
  "/api/teaching/operations/collaboration-invite-deliveries",
  "/api/teaching/invite-codes/{code}/join",
  "/api/teaching/operations/records/{recordId}/rollback",
  "/api/teaching/operations/export/{manifestId}",
  "/api/teaching/gradebook-updates/{gradebookUpdateId}/{action}",
  "/api/teaching/operations/backups/{backupId}/restore",
];

const requiredTeachingOperationsRouteSmokeProofs = extractConstStringArray(
  teachingOperationsRouteSmokeSource,
  "proves",
);

const requiredTeachingOperationsRouteSmokeSafetyFlags = [
  "valuesRedacted",
  "cookieValuesOmitted",
  "responseBodiesOmitted",
  "liveRequiresApproval",
  "remoteMutationRequiresApproval",
];

const requiredTeachingOperationsRouteSmokeEnvNames = [
  "UAIS_DEPLOYMENT_BASE_URL",
  "UAIS_TEACHING_OPERATIONS_BACKEND",
  "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
  "UAIS_EXTERNAL_STORAGE_BASE_URL",
  "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
  "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER",
  "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_URL",
  "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN",
  "UAIS_COLLABORATION_INVITE_EMAIL_CALLBACK_TOKEN",
  "UAIS_STUDENT_ROSTER_SYNC_PROVIDER",
  "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_URL",
  "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_TOKEN",
  "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER",
  "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_URL",
  "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_TOKEN",
  "UAIS_GRADEBOOK_RELEASE_PROVIDER",
  "UAIS_GRADEBOOK_RELEASE_PROVIDER_URL",
  "UAIS_GRADEBOOK_RELEASE_PROVIDER_TOKEN",
  "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER",
  "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_URL",
  "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_TOKEN",
  "UAIS_COURSE_EXPORT_PROVIDER",
  "UAIS_COURSE_EXPORT_PROVIDER_URL",
  "UAIS_COURSE_EXPORT_PROVIDER_TOKEN",
  "UAIS_GRADING_FEEDBACK_PROVIDER",
  "UAIS_GRADING_FEEDBACK_PROVIDER_URL",
  "UAIS_GRADING_FEEDBACK_PROVIDER_TOKEN",
  "UAIS_TEACHING_OPERATIONS_SMOKE_COOKIE",
  "UAIS_TEACHING_OPERATIONS_SMOKE_STUDENT_COOKIE",
  "UAIS_TEACHING_OPERATIONS_SMOKE_TEACHER_ID",
  "UAIS_TEACHING_OPERATIONS_SMOKE_COURSE_ID",
  "UAIS_TEACHING_OPERATIONS_SMOKE_CLASS_ID",
];

const externalModeTeachingOperationsRouteSmokeEnvNames = new Set([
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

const redactedTeachingOperationsRouteSmokeEnvNames = new Set([
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

const requiredTeachingOperationDetailBrowserResults = [
  "openOperationPage",
  "browserHydration",
  "signedTeacherSessionBootstrap",
  "operationButtonClick",
  "operationPostPersisted",
  "secondaryOperationButtonClick",
  "secondaryOperationPostPersisted",
  "auditReadbackVerified",
  "domainProjectionVerified",
  "traceVisible",
  "actorVisible",
  "authSessionVisible",
  "duplicateSubmitBlocked",
  "operationFailureAlertVerified",
  "operationInviteArtifactAuditGated",
  "openMainTeachingPage",
  "mainInlineWorkspaceHydration",
  "mainCourseCreateButtonClick",
  "mainCourseCoverGenerateButtonClick",
  "mainCourseCoverGenerated",
  "mainCourseCoverAssetAuditGated",
  "mainCourseCoverAssetBoundToCourseCreate",
  "mainCourseCreatePersisted",
  "mainCourseCreateReceiptAuthSessionReturned",
  "mainCourseCreateReadbackVerified",
  "mainClassCreateButtonClick",
  "mainClassCreatePersisted",
  "mainClassCreateReceiptAuthSessionReturned",
  "mainClassCreateReadbackVerified",
  "mainInlineOperationButtonClick",
  "mainInlineDuplicateSubmitBlocked",
  "mainInlineCourseSettingsPatchSubmitted",
  "mainInlineOperationPostPersisted",
  "mainInlineOperationReceiptAuthSessionReturned",
  "mainInlineOperationFailureAlertVerified",
  "mainInlineAuditPendingBeforeSuccess",
  "mainInlineCourseSettingsCardAuditGated",
  "mainInlineAuditReadbackVerified",
  "mainInlineDomainProjectionVerified",
  "mainInlineAlertPendingBeforeSuccess",
  "mainInlineKnowledgeIndexSyncSubmitted",
  "mainInlineStudentRosterSyncSubmitted",
  "mainInlineDashboardRefreshSubmitted",
  "mainInlineStudentPreviewSubmitted",
  "mainInlineAgentPermissionPreflightSubmitted",
  "mainInlineResourcePlaceholderSubmitted",
  "mainInlineUnitDraftSubmitted",
  "mainInlineCollaborationInviteSubmitted",
  "mainInlineStudentGroupSuggestionSubmitted",
  "mainInlineExportRedactionValidationSubmitted",
  "mainInlineDashboardSnapshotSubmitted",
  "mainInlineQuizItemReviewSubmitted",
  "mainInlineGradingFeedbackDraftSubmitted",
  "mainInlineAgentPlanSubmitted",
  "mainInlineContentPublishSubmitted",
  "mainInlineAdminSettingsSubmitted",
  "mainInlineExportManifestSubmitted",
  "mainInlineQuizBoardRefreshSubmitted",
  "mainInlineGradingQueueSubmitted",
  "mainInlineAuditAlertReadbackVerified",
  "mainInlineAlertNotificationButtonClick",
  "mainInlineAlertNotificationReadbackVerified",
  "mainInlineRollbackButtonClick",
  "mainInlineRollbackPersisted",
  "mainInviteWorkspaceHydration",
  "mainInviteGenerateButtonClick",
  "mainInviteAuditPendingBeforeArtifact",
  "mainInviteAuditReadbackVerified",
  "mainInviteDraftArtifactReturned",
  "mainInvitePublishButtonClick",
  "mainInvitePublishAuditReadbackVerified",
  "mainInvitePublishArtifactReturned",
  "mainInvitePublishClassReadbackVerified",
  "operationDetailCoverageVerified",
];

const requiredTeachingOperationDetailCoverage = [
  {
    operationId: "course-settings",
    key: "courseSettings",
    route: "/teaching/course-settings",
  },
  {
    operationId: "agents",
    key: "agents",
    route: "/teaching/agents",
  },
  {
    operationId: "knowledge-base",
    key: "knowledgeBase",
    route: "/teaching/knowledge-base",
  },
  {
    operationId: "content",
    key: "content",
    route: "/teaching/content",
  },
  {
    operationId: "admins",
    key: "admins",
    route: "/teaching/admins",
  },
  {
    operationId: "students",
    key: "students",
    route: "/teaching/students",
  },
  {
    operationId: "data-export",
    key: "dataExport",
    route: "/teaching/data-export",
  },
  {
    operationId: "dashboard",
    key: "dashboard",
    route: "/teaching/dashboard",
  },
  {
    operationId: "quiz-board",
    key: "quizBoard",
    route: "/teaching/quiz-board",
  },
  {
    operationId: "grading",
    key: "grading",
    route: "/teaching/grading",
  },
  {
    operationId: "invite-code",
    key: "inviteCode",
    route: "/teaching/invite-code",
  },
];

const requiredTeachingOperationDetailBrowserSafetyFlags = [
  "valuesRedacted",
  "cookieValuesOmitted",
  "responseBodiesOmitted",
  "liveRequiresApproval",
  "remoteMutationRequiresApproval",
];

const requiredTeachingCourseManagementRouteSmokeResults = [
  "unauthenticatedCourseListDenied",
  "unauthenticatedCourseCoverDenied",
  "unauthenticatedCourseCoverNoWriteSideEffects",
  "unauthenticatedCourseCreateDenied",
  "unauthenticatedCourseCreateNoWriteSideEffects",
  "signedStudentCourseCreateDenied",
  "signedStudentCourseCreateNoWriteSideEffects",
  "signedStudentCourseCoverDenied",
  "signedStudentCourseCoverNoWriteSideEffects",
  "signedTeacherForeignCourseCreateDenied",
  "signedTeacherForeignCourseCreateNoWriteSideEffects",
  "signedOtherTeacherCourseCoverDenied",
  "signedOtherTeacherCourseCoverNoWriteSideEffects",
  "unauthenticatedClassCreateDenied",
  "unauthenticatedClassCreateNoWriteSideEffects",
  "signedStudentClassCreateDenied",
  "signedStudentClassCreateNoWriteSideEffects",
  "signedOtherTeacherClassCreateDenied",
  "signedOtherTeacherClassCreateNoWriteSideEffects",
  "signedTeacherCourseCoverGenerated",
  "externalCoverAssetPersistenceReturned",
  "courseCoverAssetReadbackRevisionReturned",
  "courseCoverAssetReadbackDatabaseAdapterReturned",
  "signedTeacherCourseCoverAuditAuthSessionReturned",
  "courseCoverExternalAssetAuditReadbackReturned",
  "courseCoverAssetRevisionRetryContractReturned",
  "signedTeacherCourseCoverTraceHeaderReturned",
  "signedTeacherCourseCreated",
  "duplicateCourseCreateDenied",
  "duplicateCourseCreateNoDuplicateSideEffects",
  "courseCreateExternalSnapshotPolicyReturned",
  "courseCreateAuditSourceReadbackReturned",
  "courseCreateAuthSessionReadbackReturned",
  "createdCourseUsedCoverDraftScope",
  "createdCourseBoundGeneratedCoverAsset",
  "existingCourseCoverBindingReadbackReturned",
  "existingCourseCoverListedReadbackReturned",
  "existingCourseCoverExternalAssetAuditReadbackReturned",
  "existingCourseCoverBindingAuditSourceReturned",
  "externalOwnershipMerged",
  "createdCourseTeachingOperationAccepted",
  "signedTeacherClassCreated",
  "duplicateClassCreateDenied",
  "duplicateClassCreateNoDuplicateSideEffects",
  "classCreateExternalSnapshotPolicyReturned",
  "classCreateAuditSourceReadbackReturned",
  "classCreateAuthSessionReadbackReturned",
  "signedTeacherCourseListReturned",
  "createdCourseListed",
  "createdClassListed",
  "signedOtherTeacherCourseListReturned",
  "otherTeacherCourseHidden",
  "otherTeacherClassHidden",
  "studentCourseHiddenBeforeMembership",
  "unauthenticatedInviteJoinDenied",
  "unauthenticatedInviteJoinNoWriteSideEffects",
  "signedStudentInviteJoined",
  "duplicateStudentInviteJoinIdempotentReturned",
  "duplicateStudentInviteJoinNoDuplicateSideEffects",
  "studentPendingCourseHiddenBeforeApproval",
  "studentPendingClassHiddenBeforeApproval",
  "studentPendingMembershipHiddenBeforeApproval",
  "signedStudentPendingCourseListTraceHeaderReturned",
  "signedStudentInviteJoinAuditSourceReturned",
  "signedStudentInviteJoinAuthSessionReturned",
  "signedStudentInviteJoinAuthSessionReadbackReturned",
  "unauthenticatedMembershipApprovalDenied",
  "unauthenticatedMembershipApprovalNoWriteSideEffects",
  "signedStudentMembershipApprovalDenied",
  "signedStudentMembershipApprovalNoWriteSideEffects",
  "signedOtherTeacherMembershipApprovalDenied",
  "signedOtherTeacherMembershipApprovalActorResourceReturned",
  "signedOtherTeacherMembershipApprovalNoWriteSideEffects",
  "signedTeacherMembershipApproved",
  "duplicateMembershipApprovalIdempotentReturned",
  "duplicateMembershipApprovalNoDuplicateSideEffects",
  "signedTeacherMembershipApprovalAuditSourceReturned",
  "signedTeacherMembershipApprovalAuthSessionReturned",
  "signedTeacherMembershipApprovalAuthSessionReadbackReturned",
  "signedStudentCourseListReturned",
  "approvedCourseVisibleForStudent",
  "approvedMembershipListedForStudent",
  "unauthenticatedCourseListTraceHeaderReturned",
  "unauthenticatedCourseCoverTraceHeaderReturned",
  "unauthenticatedCourseCreateTraceHeaderReturned",
  "signedStudentCourseCreateTraceHeaderReturned",
  "signedStudentCourseCoverTraceHeaderReturned",
  "signedOtherTeacherCourseCoverTraceHeaderReturned",
  "unauthenticatedClassCreateTraceHeaderReturned",
  "signedStudentClassCreateTraceHeaderReturned",
  "signedOtherTeacherClassCreateTraceHeaderReturned",
  "signedTeacherCourseCreateTraceHeaderReturned",
  "signedTeacherCourseCreateTraceBodyReturned",
  "signedTeacherClassCreateTraceHeaderReturned",
  "signedTeacherClassCreateTraceBodyReturned",
  "signedTeacherCourseListTraceHeaderReturned",
  "signedOtherTeacherCourseListTraceHeaderReturned",
  "signedStudentPreJoinCourseListTraceHeaderReturned",
  "unauthenticatedInviteJoinTraceHeaderReturned",
  "signedStudentInviteJoinTraceHeaderReturned",
  "signedStudentInviteJoinTraceBodyReturned",
  "unauthenticatedMembershipApprovalTraceHeaderReturned",
  "signedStudentMembershipApprovalTraceHeaderReturned",
  "signedOtherTeacherMembershipApprovalTraceHeaderReturned",
  "signedTeacherMembershipApproveTraceHeaderReturned",
  "signedTeacherMembershipApproveTraceBodyReturned",
  "signedStudentCourseListTraceHeaderReturned",
];

const requiredTeachingCourseManagementRouteSmokeProofs = [
  "unauthenticated-course-list-denied",
  "unauthenticated-course-cover-denied",
  "unauthenticated-course-cover-no-write-side-effects",
  "unauthenticated-course-create-denied",
  "unauthenticated-course-create-no-write-side-effects",
  "signed-student-course-create-denied",
  "signed-student-course-create-no-write-side-effects",
  "signed-student-course-cover-denied",
  "signed-student-course-cover-no-write-side-effects",
  "signed-teacher-foreign-course-create-denied",
  "signed-teacher-foreign-course-create-no-write-side-effects",
  "signed-other-teacher-course-cover-denied",
  "signed-other-teacher-course-cover-no-write-side-effects",
  "unauthenticated-class-create-denied",
  "unauthenticated-class-create-no-write-side-effects",
  "signed-student-class-create-denied",
  "signed-student-class-create-no-write-side-effects",
  "signed-other-teacher-class-create-denied",
  "signed-other-teacher-class-create-no-write-side-effects",
  "signed-teacher-cookie-required",
  "course-cover-asset-generated",
  "course-cover-asset-external-storage-returned",
  "course-cover-asset-readback-revision-returned",
  "course-cover-asset-readback-managed-database-adapter-returned",
  "course-cover-audit-auth-session-returned",
  "course-cover-asset-audit-external-readback-returned",
  "course-cover-asset-revision-retry-contract-returned",
  "signed-course-cover-trace-header-returned",
  "teacher-owned-course-created",
  "duplicate-course-create-denied",
  "duplicate-course-create-no-duplicate-side-effects",
  "course-create-external-snapshot-policy-returned",
  "course-create-audit-source-readback-returned",
  "course-create-auth-session-readback-returned",
  "created-course-used-cover-draft-scope",
  "created-course-bound-generated-cover-asset",
  "existing-course-cover-binding-readback-returned",
  "existing-course-cover-listed-readback-returned",
  "existing-course-cover-asset-audit-external-readback-returned",
  "existing-course-cover-binding-audit-source-returned",
  "external-ownership-merge-returned",
  "teacher-owned-class-created",
  "duplicate-class-create-denied",
  "duplicate-class-create-no-duplicate-side-effects",
  "class-create-external-snapshot-policy-returned",
  "class-create-audit-source-readback-returned",
  "class-create-auth-session-readback-returned",
  "created-course-and-class-readable-after-write",
  "signed-other-teacher-course-list-returned",
  "other-teacher-course-hidden",
  "other-teacher-class-hidden",
  "student-course-hidden-before-membership",
  "unauthenticated-invite-join-denied",
  "unauthenticated-invite-join-no-write-side-effects",
  "student-invite-join-persisted",
  "duplicate-student-invite-join-idempotent-returned",
  "duplicate-student-invite-join-no-duplicate-side-effects",
  "student-pending-course-hidden-before-approval",
  "student-pending-class-hidden-before-approval",
  "student-pending-membership-hidden-before-approval",
  "signed-student-pending-course-list-trace-header-returned",
  "student-invite-join-audit-source-returned",
  "student-invite-join-auth-session-returned",
  "student-invite-join-auth-session-readback-returned",
  "created-course-teaching-operation-accepted",
  "unauthenticated-membership-approval-denied",
  "unauthenticated-membership-approval-no-write-side-effects",
  "signed-student-membership-approval-denied",
  "signed-student-membership-approval-no-write-side-effects",
  "signed-other-teacher-membership-approval-denied",
  "signed-other-teacher-membership-approval-actor-resource-returned",
  "signed-other-teacher-membership-approval-no-write-side-effects",
  "teacher-membership-approval-persisted",
  "duplicate-membership-approval-idempotent-returned",
  "duplicate-membership-approval-no-duplicate-side-effects",
  "teacher-membership-approval-audit-source-returned",
  "teacher-membership-approval-auth-session-returned",
  "teacher-membership-approval-auth-session-readback-returned",
  "approved-course-visible-for-student",
  "approved-membership-readable-for-student",
  "unauthenticated-course-list-trace-header-returned",
  "unauthenticated-course-cover-trace-header-returned",
  "unauthenticated-course-create-trace-header-returned",
  "signed-student-course-create-trace-header-returned",
  "signed-student-course-cover-trace-header-returned",
  "signed-other-teacher-course-cover-trace-header-returned",
  "unauthenticated-class-create-trace-header-returned",
  "signed-student-class-create-trace-header-returned",
  "signed-other-teacher-class-create-trace-header-returned",
  "signed-course-create-trace-header-returned",
  "signed-course-create-trace-body-returned",
  "signed-class-create-trace-header-returned",
  "signed-class-create-trace-body-returned",
  "signed-course-list-trace-header-returned",
  "signed-other-teacher-course-list-trace-header-returned",
  "signed-student-prejoin-course-list-trace-header-returned",
  "unauthenticated-invite-join-trace-header-returned",
  "signed-student-invite-join-trace-header-returned",
  "signed-student-invite-join-trace-body-returned",
  "unauthenticated-membership-approval-trace-header-returned",
  "signed-student-membership-approval-trace-header-returned",
  "signed-other-teacher-membership-approval-trace-header-returned",
  "signed-teacher-membership-approval-trace-header-returned",
  "signed-teacher-membership-approval-trace-body-returned",
  "signed-student-course-list-trace-header-returned",
  "response-values-redacted",
  "release-run-id-bound",
  "same-teacher-auth-provider-readiness-bound",
  "same-app-auth-provider-readiness-bound",
  "same-vercel-production-deployment-bound",
  "same-deployment-domain-reachability-bound",
  "same-external-storage-service-readiness-bound",
];

const requiredTeachingCourseManagementRouteSmokeRoutes = [
  "/api/teaching/course-cover",
  "/api/teaching/courses",
  "/api/teaching/operations",
  "/api/teaching/courses/{courseId}/classes",
  "/api/teaching/invite-codes/{code}/join",
  "/api/teaching/classes/{classId}/memberships/{membershipId}/approve",
];

const requiredTeachingCourseManagementRouteSmokeSafetyFlags = [
  "valuesRedacted",
  "cookieValuesOmitted",
  "responseBodiesOmitted",
  "liveRequiresApproval",
  "remoteMutationRequiresApproval",
];

const requiredTeachingCourseManagementRouteSmokeEnvNames = [
  "UAIS_DEPLOYMENT_BASE_URL",
  "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
  "UAIS_TEACHING_COURSE_ASSETS_BACKEND",
  "UAIS_TEACHING_OPERATIONS_BACKEND",
  "UAIS_EXTERNAL_STORAGE_BASE_URL",
  "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
  "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
  "UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_COOKIE",
  "UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_TEACHER_ID",
  "UAIS_TEACHING_COURSE_MANAGEMENT_OTHER_TEACHER_SMOKE_COOKIE",
  "UAIS_TEACHING_COURSE_MANAGEMENT_OTHER_TEACHER_SMOKE_TEACHER_ID",
  "UAIS_TEACHING_COURSE_MANAGEMENT_STUDENT_SMOKE_COOKIE",
  "UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_STUDENT_ID",
];

const externalModeTeachingCourseManagementRouteSmokeEnvNames = new Set([
  "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
  "UAIS_TEACHING_COURSE_ASSETS_BACKEND",
  "UAIS_TEACHING_OPERATIONS_BACKEND",
  "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
]);

const redactedTeachingCourseManagementRouteSmokeEnvNames = new Set([
  "UAIS_EXTERNAL_STORAGE_BASE_URL",
  "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
  "UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_COOKIE",
  "UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_TEACHER_ID",
  "UAIS_TEACHING_COURSE_MANAGEMENT_OTHER_TEACHER_SMOKE_COOKIE",
  "UAIS_TEACHING_COURSE_MANAGEMENT_OTHER_TEACHER_SMOKE_TEACHER_ID",
  "UAIS_TEACHING_COURSE_MANAGEMENT_STUDENT_SMOKE_COOKIE",
  "UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_STUDENT_ID",
]);

const requiredExternalStorageResponseShapes = [
  {
    key: "health",
    checkId: "s22-external-storage-health",
    requiredFields: [
      "status",
      "target",
      "apiContractVersion",
      "durableBackingStore",
      "teachingOperationsStorageSchema",
      "teachingOperationsStorageSchema.status",
      "teachingOperationsStorageSchema.schemaVersion",
      "teachingOperationsStorageSchema.migrationStatus",
      "teachingOperationsStorageSchema.operationLedger",
      "teachingOperationsStorageSchema.auditLedger",
      "teachingOperationsStorageSchema.rollbackLedger",
      "teachingOperationsStorageSchema.backupStore",
      "teachingOperationsStorageSchema.restoreDrillLog",
      "teachingOperationsStorageSchema.concurrencyControl",
      "teachingOperationsStorageSchema.productionDatabaseAdapter",
      "teachingOperationsStorageSchema.productionDatabaseAdapter.status",
      "teachingOperationsStorageSchema.productionDatabaseAdapter.providerClass",
      "teachingOperationsStorageSchema.productionDatabaseAdapter.migrationStatus",
      "teachingOperationsStorageSchema.productionDatabaseAdapter.backupPolicy",
      "teachingOperationsStorageSchema.productionDatabaseAdapter.concurrencyControl",
      "teachingOperationsStorageSchema.productionDatabaseAdapter.valueRedacted",
      "teachingOperationsStorageSchema.valueRedacted",
      "teachingCourseManagementStorageSchema",
      "teachingCourseManagementStorageSchema.status",
      "teachingCourseManagementStorageSchema.schemaVersion",
      "teachingCourseManagementStorageSchema.migrationStatus",
      "teachingCourseManagementStorageSchema.snapshotStore",
      "teachingCourseManagementStorageSchema.auditLog",
      "teachingCourseManagementStorageSchema.backupStore",
      "teachingCourseManagementStorageSchema.restoreDrillLog",
      "teachingCourseManagementStorageSchema.revisionControl",
      "teachingCourseManagementStorageSchema.concurrencyControl",
      "teachingCourseManagementStorageSchema.valueRedacted",
      "teachingCourseAssetsStorageSchema",
      "teachingCourseAssetsStorageSchema.status",
      "teachingCourseAssetsStorageSchema.schemaVersion",
      "teachingCourseAssetsStorageSchema.migrationStatus",
      "teachingCourseAssetsStorageSchema.snapshotStore",
      "teachingCourseAssetsStorageSchema.auditLog",
      "teachingCourseAssetsStorageSchema.backupStore",
      "teachingCourseAssetsStorageSchema.restoreDrillLog",
      "teachingCourseAssetsStorageSchema.revisionControl",
      "teachingCourseAssetsStorageSchema.concurrencyControl",
      "teachingCourseAssetsStorageSchema.valueRedacted",
      "redaction",
    ],
  },
  {
    key: "teacherOwnershipMerge",
    checkId: "s12-external-teacher-ownership-merge",
    requiredFields: ["status", "storageWritePolicy", "redaction"],
  },
  {
    key: "teacherOwnershipRead",
    checkId: "s12-external-teacher-ownership-read",
    requiredFields: [
      "teacherId",
      "courseIds",
      "assetCollections",
      "smokeGrantMerged",
      "runScopedSmokeGrant",
      "privateFieldsOmitted",
    ],
  },
  {
    key: "courseManagementBackupRestoreDrill",
    checkId: "s12-external-course-management-backup-restore-drill",
    requiredFields: [
      "backupId",
      "restoreDrillBackupId",
      "backupStatus",
      "restoreDrillStatus",
      "backupEventType",
      "restoreDrillEventType",
      "backupStoragePolicy",
      "restoreDrillStoragePolicy",
      "backupStorageWritePolicy",
      "restoreDrillStorageWritePolicy",
      "sourceRecordCounts",
      "restoredRecordCounts",
      "redaction",
    ],
  },
  {
    key: "courseAssetsBackupRestoreDrill",
    checkId: "s12-external-course-assets-backup-restore-drill",
    requiredFields: [
      "backupId",
      "restoreDrillBackupId",
      "backupStatus",
      "restoreDrillStatus",
      "backupEventType",
      "restoreDrillEventType",
      "backupStoragePolicy",
      "restoreDrillStoragePolicy",
      "backupStorageWritePolicy",
      "restoreDrillStorageWritePolicy",
      "sourceRecordCounts",
      "restoredRecordCounts",
      "redaction",
    ],
  },
  {
    key: "teachingOperationsBackupRestoreDrill",
    checkId: "s12-external-teaching-operations-backup-restore-drill",
    requiredFields: [
      "backupId",
      "restoreDrillBackupId",
      "backupStatus",
      "restoreDrillStatus",
      "backupEventType",
      "restoreDrillEventType",
      "backupStoragePolicy",
      "restoreDrillStoragePolicy",
      "backupStorageWritePolicy",
      "restoreDrillStorageWritePolicy",
      "sourceRecordCounts",
      "restoredRecordCounts",
      "redaction",
    ],
  },
  {
    key: "teachingOperationsConcurrentAppendReadback",
    checkId: "s12-external-teaching-operations-concurrent-append-readback",
    requiredFields: [
      "bothAppendsPersisted",
      "appendSequencesReturned",
      "appendSequencesDistinct",
      "auditReadbackReturned",
      "operationRecordsPresent",
      "auditEventsPresent",
      "domainProjectionsPresent",
      "redaction",
    ],
  },
  {
    key: "lifecycleAuditAppend",
    checkId: "s24-external-lifecycle-audit-append",
    requiredFields: ["status", "provider", "redaction"],
  },
  {
    key: "lifecycleAuditRead",
    checkId: "s24-external-lifecycle-audit-read",
    requiredFields: [
      "provider",
      "eventType",
      "eventsArray",
      "smokeAuditEventPresent",
      "runScopedSmokeAuditEvent",
      "redaction",
    ],
  },
];

const requiredTeacherWorkflowFeatures = [
  "voiceSampleUpload",
  "uploadedSampleAudioPayload",
  "voiceSampleDurationGate",
  "voiceSampleSelect",
  "selectedSampleIdentity",
  "preflight",
  "voiceRefDisplay",
  "pptNarrationGenerate",
  "perSlideWavDownloads",
  "workflowStepGating",
  "signedSessionBootstrap",
  "signedSessionReadiness",
  "authFailClosed",
  "serverWorkflowStatus",
];

const requiredDeployedTeacherWorkflowAnchors = [
  "teacherWorkflowTitle",
  "voiceSampleUpload",
  "voiceSampleSelect",
  "uploadedSampleAudioPayload",
  "voiceSampleDurationGate",
  "selectedSampleIdentity",
  "preflight",
  "pptNarrationGenerate",
  "perSlideWavDownloads",
  "signedSessionBootstrap",
  "signedSessionReadiness",
  "workflowSessionActions",
  "serverWorkflowStatus",
  "serverWorkflowProgress",
];

const requiredTeacherWorkflowBrowserResults = [
  "openTeachingPage",
  "browserHydration",
  "voiceSampleDurationGate",
  "voiceSampleFileSelection",
  "serverWorkflowRefresh",
  "signedSessionBootstrap",
  "voiceSampleSubmit",
  "voiceClonePreflight",
  "voiceCloneStatus",
  "pptNarrationSubmit",
  "pptNarrationSlidePayload",
  "perSlideWavDownloadLinks",
  "perSlideWavDownloadHrefContract",
];

const requiredTeacherWorkflowLiveGenerationResults = [
  "signedSessionBootstrap",
  "voiceSampleSubmit",
  "voiceClonePreflight",
  "voiceCloneStatusSucceeded",
  "pptNarrationSubmit",
  "generatedAudioManifest",
  "generatedZipExport",
  "perSlideAudioDownload",
];

const requiredLearningPptPlaybackResults = [
  "learningPageHttp200",
  "playbackManifestKangXiaVoice",
  "playbackManifestSlideCount",
  "playbackManifestStudentSafeRedaction",
  "firstSlideAudioWavHeaders",
];
const expectedLearningPptAudioManifestId =
  "audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1";
const expectedLearningPptFirstAudioUrl =
  `/api/learning/ppt-playback/audio/${expectedLearningPptAudioManifestId}/tts_natural-number-ordinal-theory-ppt1_slide-01`;
const minimumLearningPptFirstAudioContentLength = 1024;

const requiredVercelProjectReadinessChecks = [
  "s22-vercel-cli",
  "s22-vercel-auth",
  "s22-vercel-team-scope",
  "s22-vercel-project-candidate",
  "s22-vercel-project-link",
  "s22-vercelignore-upload-hygiene",
];

const requiredVercelProjectReadinessSafetyFlags = [
  "valuesRedacted",
  "projectIdsOmitted",
  "orgIdsOmitted",
  "accountNamesOmitted",
  "teamIdsOmitted",
  "teamSlugsOmitted",
  "projectNamesOmitted",
  "deploymentUrlsOmitted",
  "localPrivatePathsOmitted",
];

const requiredVercelProductionDeploymentSafetyFlags = [
  "valuesRedacted",
  "deploymentUrlOmitted",
  "deploymentUrlsOmitted",
  "projectIdsOmitted",
  "orgIdsOmitted",
  "accountNamesOmitted",
  "teamIdsOmitted",
  "tokenOmitted",
  "projectReadinessEvidencePathOmitted",
  "envSyncEvidencePathOmitted",
  "localPrivatePathsOmitted",
];

const requiredTeacherAuthProviderReadinessSafetyFlags = [
  "valuesRedacted",
  "secretsOmitted",
  "providerUrlsOmitted",
  "responseBodiesOmitted",
  "localPrivatePathsOmitted",
  "liveRequiresApproval",
  "noCookieIssued",
];

const requiredAppAuthProviderReadinessSafetyFlags = [
  "valuesRedacted",
  "secretsOmitted",
  "passwordsOmitted",
  "providerUrlsOmitted",
  "responseBodiesOmitted",
  "localPrivatePathsOmitted",
  "liveRequiresApproval",
  "cookieValuesOmitted",
];

const requiredTeacherAuthSessionCookiePair = [
  {
    name: "uais_teacher_auth_claims",
    purpose: "signed-session-claims",
  },
  {
    name: "uais_teacher_auth_signature",
    purpose: "hmac-sha256-signature",
  },
];

const requiredAppSessionCookiePair = [
  {
    name: "uais_app_session",
    purpose: "signed-app-session-claims",
  },
  {
    name: "uais_app_session_signature",
    purpose: "hmac-sha256-signature",
  },
];

const requiredExternalStorageServiceReadinessSafetyFlags = [
  "valuesRedacted",
  "serviceUrlOmitted",
  "responseBodiesOmitted",
  "localPrivatePathsOmitted",
  "liveRequiresApproval",
  "noWriteOperations",
];

try {
  const options = parseArgs(process.argv.slice(2));
  const evidence = {
    teacherWorkflowUi: readOptionalJson(options.teacherWorkflowUi),
    deployedTeacherWorkflowUi: readOptionalJson(options.deployedTeacherWorkflowUi),
    teacherWorkflowBrowserUi: readOptionalJson(options.teacherWorkflowBrowserUi),
    teacherWorkflowLiveGeneration: readOptionalJson(options.teacherWorkflowLiveGeneration),
    learningPptPlayback: readOptionalJson(options.learningPptPlayback),
    vercelProjectReadiness: readOptionalJson(options.vercelProjectReadiness),
    vercelEnvSync: readOptionalJson(options.vercelEnvSync),
    vercelEnvInventory: readOptionalJson(options.vercelEnvInventory),
    appAuthProviderReadiness: readOptionalJson(options.appAuthProviderReadiness),
    trustedTeacherAuthRouteChain: readOptionalJson(options.trustedTeacherAuthRouteChain),
    teacherAuthProviderReadiness: readOptionalJson(options.teacherAuthProviderReadiness),
    externalStorageProductionLaunchContract: readOptionalJson(
      options.externalStorageProductionLaunchContract,
    ),
    externalStorageContainerBuildReadiness: readOptionalJson(
      options.externalStorageContainerBuildReadiness,
    ),
    externalStorageServiceReadiness: readOptionalJson(options.externalStorageServiceReadiness),
    vercelProductionDeployment: readOptionalJson(options.vercelProductionDeployment),
    routeSmoke: readOptionalJson(options.routeSmoke),
    teachingOperationsRouteSmoke: readOptionalJson(options.teachingOperationsRouteSmoke),
    teachingOperationDetailBrowserSmoke: readOptionalJson(
      options.teachingOperationDetailBrowserSmoke,
    ),
    teachingCourseManagementRouteSmoke: readOptionalJson(
      options.teachingCourseManagementRouteSmoke,
    ),
    externalStorageSmoke: readOptionalJson(options.externalStorageSmoke),
    pptAcceptance: readOptionalJson(options.pptAcceptance),
    enterpriseLiveEvidenceAudit: readOptionalJson(options.enterpriseLiveEvidenceAudit),
    localProductionE2eSmoke: readOptionalJson(options.localProductionE2eSmoke),
  };
  const requirements = [
    evaluateTeacherWorkflowUi(evidence.teacherWorkflowUi),
    evaluateDeployedTeacherWorkflowUi(
      evidence.deployedTeacherWorkflowUi,
      evidence.vercelProductionDeployment,
    ),
    evaluateTeacherWorkflowBrowserUi(
      evidence.teacherWorkflowBrowserUi,
      evidence.deployedTeacherWorkflowUi,
    ),
    evaluateTeacherWorkflowLiveGeneration(
      evidence.teacherWorkflowLiveGeneration,
      evidence.teacherWorkflowBrowserUi,
      evidence.deployedTeacherWorkflowUi,
      evidence.vercelProductionDeployment,
    ),
    evaluateLearningPptPlayback(
      evidence.learningPptPlayback,
      evidence.vercelProductionDeployment,
    ),
    evaluateVercelProjectReadiness(evidence.vercelProjectReadiness),
    evaluateVercelEnvSync(evidence.vercelEnvSync, evidence.vercelEnvInventory),
    evaluateAppAuthProviderReadiness(evidence.appAuthProviderReadiness),
    evaluateTrustedTeacherAuthRouteChain(evidence.trustedTeacherAuthRouteChain),
    evaluateTeacherAuthProviderReadiness(evidence.teacherAuthProviderReadiness),
    evaluateExternalStorageProductionLaunchContract(
      evidence.externalStorageProductionLaunchContract,
    ),
    evaluateExternalStorageContainerBuildReadiness(
      evidence.externalStorageContainerBuildReadiness,
    ),
    evaluateExternalStorageServiceReadiness(evidence.externalStorageServiceReadiness),
    evaluateVercelProductionDeployment(evidence.vercelProductionDeployment),
    evaluateRouteSmoke(evidence.routeSmoke, evidence.deployedTeacherWorkflowUi),
    evaluateTeacherAuthProviderConsistency({
      vercelEnvSync: evidence.vercelEnvSync,
      teacherAuthProviderReadiness: evidence.teacherAuthProviderReadiness,
      routeSmoke: evidence.routeSmoke,
    }),
    evaluateTeachingOperationsRouteSmoke(evidence.teachingOperationsRouteSmoke),
    evaluateTeachingOperationDetailBrowserSmoke(
      evidence.teachingOperationDetailBrowserSmoke,
    ),
    evaluateTeachingCourseManagementRouteSmoke(
      evidence.teachingCourseManagementRouteSmoke,
    ),
    evaluateExternalStorageSmoke(evidence.externalStorageSmoke),
    evaluateExternalStorageServiceConsistency({
      vercelEnvSync: evidence.vercelEnvSync,
      externalStorageServiceReadiness: evidence.externalStorageServiceReadiness,
      externalStorageSmoke: evidence.externalStorageSmoke,
    }),
    evaluatePptAcceptance(evidence.pptAcceptance, evidence.vercelProductionDeployment),
    evaluateEnterpriseLiveEvidenceAudit(evidence.enterpriseLiveEvidenceAudit),
    evaluateProductionReleaseRunConsistency({
      vercelEnvSync: evidence.vercelEnvSync,
      vercelProductionDeployment: evidence.vercelProductionDeployment,
      deployedTeacherWorkflowUi: evidence.deployedTeacherWorkflowUi,
      teacherWorkflowBrowserUi: evidence.teacherWorkflowBrowserUi,
      teacherWorkflowLiveGeneration: evidence.teacherWorkflowLiveGeneration,
      learningPptPlayback: evidence.learningPptPlayback,
      appAuthProviderReadiness: evidence.appAuthProviderReadiness,
      teacherAuthProviderReadiness: evidence.teacherAuthProviderReadiness,
      externalStorageContainerBuildReadiness:
        evidence.externalStorageContainerBuildReadiness,
      externalStorageServiceReadiness: evidence.externalStorageServiceReadiness,
      routeSmoke: evidence.routeSmoke,
      teachingOperationsRouteSmoke: evidence.teachingOperationsRouteSmoke,
      teachingOperationDetailBrowserSmoke:
        evidence.teachingOperationDetailBrowserSmoke,
      teachingCourseManagementRouteSmoke: evidence.teachingCourseManagementRouteSmoke,
      externalStorageSmoke: evidence.externalStorageSmoke,
      pptAcceptance: evidence.pptAcceptance,
    }),
  ];
  const blockedReasons = [
    ...new Set(
      requirements.flatMap((requirement) =>
        requirement.status === "satisfied" ||
        typeof requirement.blockedReason !== "string" ||
        (typeof requirement.evidenceStatus === "string" &&
          requirement.evidenceStatus.startsWith("waiting-for-"))
          ? []
          : [requirement.blockedReason],
      ),
    ),
  ];
  const blockedRequirements = requirements.filter(
    (requirement) => requirement.status === "blocked",
  );
  const blockedRequirementReasons = [
    ...new Set(
      blockedRequirements.flatMap((requirement) =>
        typeof requirement.blockedReason === "string"
          ? [requirement.blockedReason]
          : [],
      ),
    ),
  ];

  process.stdout.write(
    `${JSON.stringify(
      {
        target: "uais-production-e2e-release-gate",
        status: blockedRequirements.length === 0 ? "ready" : "blocked",
        responsibleSession: "S22",
        requirements,
        ordinaryTeachingEvidenceSummary:
          buildOrdinaryTeachingEvidenceSummary(requirements),
        localProductionPreflightSummary: buildLocalProductionPreflightSummary(
          evidence.localProductionE2eSmoke,
        ),
        blockedReasons,
        blockedRequirementCount: blockedRequirements.length,
        blockedRequirementReasons,
        safety: {
          secretsRedacted: true,
          evidenceValuesRedacted: true,
          responseBodiesOmitted: true,
          localPrivatePathsOmitted: true,
        },
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Production E2E release gate failed."}\n`);
  process.exitCode = 1;
}

function buildLocalProductionPreflightSummary(evidence) {
  const base = {
    id: "local-production-e2e-smoke-preflight",
    acceptanceRole: "pre-production-only",
    productionAcceptance: false,
    productionGateEligible: false,
    requiredCheckIds: requiredLocalProductionE2eSmokeCheckIds,
    proofLimitations: [
      "not-production-live",
      "not-vercel-deployment-evidence",
      "not-remote-provider-readback",
      "not-manual-ppt-playback-acceptance",
    ],
  };

  if (!isRecord(evidence)) {
    return {
      ...base,
      status: "missing",
      evidenceStatus: "missing",
      checkStatuses: {},
      checksSummary: {
        allRequiredChecksPassed: false,
        operationDetailCoverageVerified: "missing",
      },
      missingCheckIds: requiredLocalProductionE2eSmokeCheckIds,
      failedCheckIds: [],
      blockedReasons: [],
    };
  }

  const checks = Array.isArray(evidence.checks)
    ? evidence.checks.filter((check) => isRecord(check))
    : [];
  const checkById = new Map(
    checks
      .filter((check) => typeof check.id === "string")
      .map((check) => [check.id, check]),
  );
  const readCheckStatus = (id) => {
    const check = checkById.get(id);
    return isRecord(check) && typeof check.status === "string"
      ? check.status
      : "missing";
  };
  const checkStatuses = Object.fromEntries(
    requiredLocalProductionE2eSmokeCheckIds.map((id) => [id, readCheckStatus(id)]),
  );
  const missingCheckIds = requiredLocalProductionE2eSmokeCheckIds.filter(
    (id) => checkStatuses[id] === "missing",
  );
  const failedCheckIds = requiredLocalProductionE2eSmokeCheckIds.filter(
    (id) => checkStatuses[id] !== "passed" && checkStatuses[id] !== "missing",
  );
  const detailCheck = checkById.get(
    "s22-local-teaching-operation-detail-browser-smoke",
  );
  const detailResults = isRecord(detailCheck) && isRecord(detailCheck.results)
    ? detailCheck.results
    : undefined;
  const operationDetailCoverageVerified =
    isRecord(detailResults) &&
    typeof detailResults.operationDetailCoverageVerified === "string"
      ? detailResults.operationDetailCoverageVerified
      : "missing";
  const blockedReasons = [];

  if (evidence.target !== "local-production-e2e-smoke") {
    blockedReasons.push("local-production-e2e-smoke-target-mismatch");
  }
  if (evidence.mode !== "live") {
    blockedReasons.push("local-production-e2e-smoke-not-live");
  }
  if (evidence.environment !== "local-production") {
    blockedReasons.push("local-production-e2e-smoke-environment-mismatch");
  }
  if (evidence.status !== "passed") {
    blockedReasons.push("local-production-e2e-smoke-not-passed");
  }
  if (missingCheckIds.length > 0) {
    blockedReasons.push("local-production-e2e-smoke-required-checks-missing");
  }
  if (failedCheckIds.length > 0) {
    blockedReasons.push("local-production-e2e-smoke-required-checks-not-passed");
  }
  if (operationDetailCoverageVerified !== "passed") {
    blockedReasons.push("local-production-operation-detail-coverage-not-passed");
  }

  return {
    ...base,
    status: blockedReasons.length === 0 ? "passed" : "blocked",
    evidenceStatus: readEvidenceStatus(evidence),
    source: {
      target: typeof evidence.target === "string" ? evidence.target : "missing",
      mode: typeof evidence.mode === "string" ? evidence.mode : "missing",
      environment:
        typeof evidence.environment === "string" ? evidence.environment : "missing",
      status: typeof evidence.status === "string" ? evidence.status : "missing",
    },
    checkCount: checks.length,
    requiredCheckCount: requiredLocalProductionE2eSmokeCheckIds.length,
    checkStatuses,
    checksSummary: {
      allRequiredChecksPassed:
        missingCheckIds.length === 0 && failedCheckIds.length === 0,
      nextProductionBuild: checkStatuses["s22-next-production-build"],
      ordinaryTeachingRouteSmoke:
        checkStatuses["s22-local-teaching-operations-route-smoke"],
      teachingCourseManagementRouteSmoke:
        checkStatuses["s22-local-teaching-course-management-route-smoke"],
      teachingOperationDetailBrowserSmoke:
        checkStatuses["s22-local-teaching-operation-detail-browser-smoke"],
      operationDetailCoverageVerified,
    },
    missingCheckIds,
    failedCheckIds,
    blockedReasons,
  };
}

function buildOrdinaryTeachingEvidenceSummary(requirements) {
  const requirementIds = [
    "teaching-operations-route-smoke",
    "teaching-operation-detail-browser-smoke",
    "teaching-course-management-route-smoke",
  ];
  const dependencyRequirementIds = [
    "vercel-production-deployment",
    "deployment-route-smoke",
    "app-auth-provider-readiness",
    "teacher-auth-provider-readiness",
    "external-storage-service-readiness",
  ];
  const requirementById = new Map(
    requirements.map((requirement) => [requirement.id, requirement]),
  );
  const readRequirement = (id) => requirementById.get(id);
  const trackedRequirements = [...requirementIds, ...dependencyRequirementIds]
    .map(readRequirement)
    .filter((requirement) => isRecord(requirement));
  const blockedReasons = [
    ...new Set(
      trackedRequirements.flatMap((requirement) =>
        requirement.status === "blocked" && typeof requirement.blockedReason === "string"
          ? [requirement.blockedReason]
          : [],
      ),
    ),
  ];
  const readEvidenceStatus = (id) => {
    const requirement = readRequirement(id);
    return isRecord(requirement) && typeof requirement.evidenceStatus === "string"
      ? requirement.evidenceStatus
      : "missing";
  };
  const readDependencyStatus = (id) => {
    const requirement = readRequirement(id);
    return isRecord(requirement) && typeof requirement.status === "string"
      ? requirement.status
      : "missing";
  };
  const readDeploymentDomainReachabilityBinding = (id) => {
    const requirement = readRequirement(id);
    const reachabilityEvidence = isRecord(requirement)
      ? requirement.deploymentDomainReachabilityEvidence
      : undefined;
    if (
      isRecord(reachabilityEvidence) &&
      typeof reachabilityEvidence.status === "string"
    ) {
      return reachabilityEvidence.status;
    }
    const binding = isRecord(requirement)
      ? requirement.vercelProductionDeploymentBinding
      : undefined;
    return isRecord(binding) &&
      typeof binding.deploymentDomainReachabilityStatus === "string"
      ? binding.deploymentDomainReachabilityStatus
      : "missing";
  };

  return {
    id: "ordinary-teaching-production-evidence",
    status: blockedReasons.length === 0 ? "satisfied" : "blocked",
    requirementIds,
    dependencyRequirementIds,
    blockedReasons,
    evidenceStatuses: {
      teachingOperationsRouteSmoke: readEvidenceStatus(
        "teaching-operations-route-smoke",
      ),
      teachingOperationDetailBrowserSmoke: readEvidenceStatus(
        "teaching-operation-detail-browser-smoke",
      ),
      teachingCourseManagementRouteSmoke: readEvidenceStatus(
        "teaching-course-management-route-smoke",
      ),
    },
    dependencyStatuses: Object.fromEntries(
      dependencyRequirementIds.map((id) => [id, readDependencyStatus(id)]),
    ),
    deploymentDomainReachabilityBindings: {
      teachingOperationsRouteSmoke: readDeploymentDomainReachabilityBinding(
        "teaching-operations-route-smoke",
      ),
      teachingOperationDetailBrowserSmoke: readDeploymentDomainReachabilityBinding(
        "teaching-operation-detail-browser-smoke",
      ),
      teachingCourseManagementRouteSmoke: readDeploymentDomainReachabilityBinding(
        "teaching-course-management-route-smoke",
      ),
    },
    releaseGateRequiredResults: {
      teachingOperationsRouteSmoke: requiredTeachingOperationsRouteSmokeResults,
      teachingOperationDetailBrowserSmoke: requiredTeachingOperationDetailBrowserResults,
      teachingCourseManagementRouteSmoke: requiredTeachingCourseManagementRouteSmokeResults,
    },
    proofNeeded: [
      "live-teaching-operations-route-smoke",
      "live-teaching-operation-detail-browser-smoke",
      "live-teaching-course-management-route-smoke",
      "same-release-run-production-deployment",
      "same-deployment-domain-reachability-bound-to-ordinary-teaching-smokes",
      "live-app-auth-provider-readiness",
      "live-teacher-auth-provider-readiness",
      "issued-teacher-auth-cookie-route-smoke-provenance",
      "live-external-storage-service-readiness",
      "provider-side-effects-and-external-readback",
      "audit-trace-rollback-alert-closure",
      "external-backup-restore-drill-evidence",
    ],
  };
}

function parseArgs(args) {
  const options = {
    teacherWorkflowUi: undefined,
    deployedTeacherWorkflowUi: undefined,
    teacherWorkflowBrowserUi: undefined,
    teacherWorkflowLiveGeneration: undefined,
    learningPptPlayback: undefined,
    vercelProjectReadiness: undefined,
    vercelEnvSync: undefined,
    vercelEnvInventory: undefined,
    appAuthProviderReadiness: undefined,
    trustedTeacherAuthRouteChain: undefined,
    teacherAuthProviderReadiness: undefined,
    externalStorageProductionLaunchContract: undefined,
    externalStorageContainerBuildReadiness: undefined,
    externalStorageServiceReadiness: undefined,
    vercelProductionDeployment: undefined,
    routeSmoke: undefined,
    teachingOperationsRouteSmoke: undefined,
    teachingOperationDetailBrowserSmoke: undefined,
    teachingCourseManagementRouteSmoke: undefined,
    externalStorageSmoke: undefined,
    pptAcceptance: undefined,
    enterpriseLiveEvidenceAudit: undefined,
    localProductionE2eSmoke: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--teacher-workflow-ui") {
      options.teacherWorkflowUi = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--deployed-teacher-workflow-ui") {
      options.deployedTeacherWorkflowUi = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--teacher-workflow-browser-ui") {
      options.teacherWorkflowBrowserUi = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--teacher-workflow-live-generation") {
      options.teacherWorkflowLiveGeneration = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--learning-ppt-playback") {
      options.learningPptPlayback = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--vercel-project-readiness") {
      options.vercelProjectReadiness = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--vercel-env-sync") {
      options.vercelEnvSync = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--vercel-env-inventory") {
      options.vercelEnvInventory = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--app-auth-provider-readiness") {
      options.appAuthProviderReadiness = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--trusted-teacher-auth-route-chain") {
      options.trustedTeacherAuthRouteChain = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--teacher-auth-provider-readiness") {
      options.teacherAuthProviderReadiness = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--external-storage-production-launch-contract") {
      options.externalStorageProductionLaunchContract = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--external-storage-container-build-readiness") {
      options.externalStorageContainerBuildReadiness = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--external-storage-service-readiness") {
      options.externalStorageServiceReadiness = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--vercel-production-deployment") {
      options.vercelProductionDeployment = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--route-smoke") {
      options.routeSmoke = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--teaching-operations-route-smoke") {
      options.teachingOperationsRouteSmoke = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--teaching-operation-detail-browser-smoke") {
      options.teachingOperationDetailBrowserSmoke = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--teaching-course-management-route-smoke") {
      options.teachingCourseManagementRouteSmoke = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--external-storage-smoke") {
      options.externalStorageSmoke = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--ppt-acceptance") {
      options.pptAcceptance = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--enterprise-live-evidence-audit") {
      options.enterpriseLiveEvidenceAudit = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--local-production-e2e-smoke") {
      options.localProductionE2eSmoke = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node -- scripts/production-e2e-release-gate.mjs [--teacher-workflow-ui PATH] [--deployed-teacher-workflow-ui PATH] [--teacher-workflow-browser-ui PATH] [--teacher-workflow-live-generation PATH] [--learning-ppt-playback PATH] [--vercel-project-readiness PATH] [--vercel-env-sync PATH] [--vercel-env-inventory PATH] [--app-auth-provider-readiness PATH] [--trusted-teacher-auth-route-chain PATH] [--teacher-auth-provider-readiness PATH] [--external-storage-production-launch-contract PATH] [--external-storage-container-build-readiness PATH] [--external-storage-service-readiness PATH] [--vercel-production-deployment PATH] [--route-smoke PATH] [--teaching-operations-route-smoke PATH] [--teaching-operation-detail-browser-smoke PATH] [--teaching-course-management-route-smoke PATH] [--external-storage-smoke PATH] [--ppt-acceptance PATH] [--enterprise-live-evidence-audit PATH] [--local-production-e2e-smoke PATH]",
          "",
          "Aggregates redacted UAIS production E2E evidence. Dry-run or missing evidence keeps the gate blocked.",
          "Local-production E2E smoke is summarized as pre-production proof only and never satisfies production-live acceptance.",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error("Unknown option.");
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

function readOptionalJson(path) {
  if (!path) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("Unable to read evidence JSON.");
  }
}

function evaluateTeacherWorkflowUi(evidence) {
  const id = "website-teacher-workflow-ui";
  if (!isRecord(evidence)) {
    return blockedRequirement(id, "teacher-workflow-ui-evidence-missing", "missing");
  }
  if (evidence.target !== "teacher-workflow-ui-smoke") {
    return blockedRequirement(id, "teacher-workflow-ui-evidence-target-mismatch", readEvidenceStatus(evidence), {
      evidenceTarget: typeof evidence.target === "string" ? evidence.target : "missing",
    });
  }
  const missingFeatures = requiredTeacherWorkflowFeatures.filter(
    (feature) => evidence.features?.[feature] !== true,
  );
  const featureEvidenceStatus =
    typeof evidence.evidenceStatus === "string" ? evidence.evidenceStatus : "missing";
  if (missingFeatures.length > 0) {
    return blockedRequirement(id, "teacher-workflow-ui-evidence-missing", readEvidenceStatus(evidence), {
      missingFeatures,
      featureEvidenceStatus,
    });
  }
  if (evidence.status === "accepted" && featureEvidenceStatus === "feature-evidence-passed") {
    return satisfiedRequirement(id, featureEvidenceStatus, {
      requiredFeatures: requiredTeacherWorkflowFeatures,
    });
  }
  return blockedRequirement(id, "teacher-workflow-ui-feature-evidence-not-proven", readEvidenceStatus(evidence), {
    missingFeatures,
    featureEvidenceStatus,
  });
}

function evaluateDeployedTeacherWorkflowUi(evidence, vercelProductionDeployment) {
  const id = "deployed-teacher-workflow-page";
  if (!isRecord(evidence)) {
    return blockedRequirement(id, "deployed-teacher-workflow-page-not-live-passed", "missing");
  }
  if (evidence.target !== "teacher-workflow-deployment-smoke") {
    return blockedRequirement(
      id,
      "deployed-teacher-workflow-page-evidence-target-mismatch",
      readEvidenceStatus(evidence),
      {
        evidenceTarget: typeof evidence.target === "string" ? evidence.target : "missing",
      },
    );
  }
  const results = isRecord(evidence.results) ? evidence.results : {};
  const missingAnchors = requiredDeployedTeacherWorkflowAnchors.filter(
    (anchor) => results[anchor] !== "present",
  );
  const evidenceEnvironment = typeof evidence.environment === "string" ? evidence.environment : "unspecified";
  const deploymentFingerprint = readDeploymentFingerprint(evidence);
  const renderedPageFingerprint = readRenderedPageFingerprint(evidence);
  const deploymentOrigin = readDeploymentOrigin(evidence);
  const vercelDeploymentFingerprint = evaluateVercelDeploymentFingerprintMatch({
    deployedTeacherWorkflowUi: evidence,
    vercelProductionDeployment,
  });
  const vercelProductionDeploymentBinding =
    readDeployedTeacherWorkflowVercelProductionDeploymentBinding(evidence);
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingAnchors.length === 0 &&
    evidenceEnvironment !== "production"
  ) {
    return blockedRequirement(
      id,
      "deployed-teacher-workflow-page-not-production",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingAnchors,
        deploymentOrigin,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingAnchors.length === 0 &&
    evidenceEnvironment === "production" &&
    !deploymentFingerprint
  ) {
    return blockedRequirement(
      id,
      "deployed-teacher-workflow-page-fingerprint-missing",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingAnchors,
        deploymentFingerprint: {
          deployedTeacherWorkflowUi: "missing",
        },
        deploymentOrigin,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingAnchors.length === 0 &&
    evidenceEnvironment === "production" &&
    deploymentFingerprint &&
    !renderedPageFingerprint
  ) {
    return blockedRequirement(
      id,
      "deployed-teacher-workflow-page-rendered-fingerprint-missing",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingAnchors,
        deploymentFingerprint: {
          deployedTeacherWorkflowUi: "present",
        },
        renderedPageFingerprint: {
          deployedTeacherWorkflowUi: "missing",
        },
        deploymentOrigin,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingAnchors.length === 0 &&
    evidenceEnvironment === "production" &&
    deploymentFingerprint &&
    renderedPageFingerprint &&
    deploymentOrigin.originClass !== "remote-https"
  ) {
    return blockedRequirement(
      id,
      "deployed-teacher-workflow-page-origin-not-remote-https",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingAnchors,
        deploymentFingerprint: {
          deployedTeacherWorkflowUi: "present",
        },
        renderedPageFingerprint: {
          deployedTeacherWorkflowUi: "present",
        },
        deploymentOrigin,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingAnchors.length === 0 &&
    evidenceEnvironment === "production" &&
    deploymentFingerprint &&
    renderedPageFingerprint &&
    deploymentOrigin.originClass === "remote-https" &&
    vercelDeploymentFingerprint.status === "blocked"
  ) {
    return blockedRequirement(
      id,
      vercelDeploymentFingerprint.blockedReason,
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingAnchors,
        deploymentFingerprint: vercelDeploymentFingerprint.details,
        renderedPageFingerprint: {
          deployedTeacherWorkflowUi: "present",
        },
        deploymentOrigin,
        vercelProductionDeploymentBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingAnchors.length === 0 &&
    evidenceEnvironment === "production" &&
    deploymentOrigin.originClass === "remote-https" &&
    isDeployedTeacherWorkflowVercelProductionDeploymentBindingMatchedExceptReleaseRun(
      vercelProductionDeploymentBinding,
    ) &&
    vercelProductionDeploymentBinding.releaseRunIdStatus !== "matched"
  ) {
    return blockedRequirement(
      id,
      "deployed-teacher-workflow-page-vercel-deployment-release-run-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingAnchors,
        deploymentFingerprint: {
          deployedTeacherWorkflowUi: "present",
          ...(vercelDeploymentFingerprint.status === "matched"
            ? {
                vercelProductionDeployment: "present",
                match: true,
              }
            : {}),
        },
        renderedPageFingerprint: {
          deployedTeacherWorkflowUi: "present",
        },
        deploymentOrigin,
        vercelProductionDeploymentBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingAnchors.length === 0 &&
    evidenceEnvironment === "production" &&
    deploymentOrigin.originClass === "remote-https" &&
    !isDeployedTeacherWorkflowVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    )
  ) {
    return blockedRequirement(
      id,
      "deployed-teacher-workflow-page-vercel-deployment-binding-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingAnchors,
        deploymentFingerprint: {
          deployedTeacherWorkflowUi: "present",
          ...(vercelDeploymentFingerprint.status === "matched"
            ? {
                vercelProductionDeployment: "present",
                match: true,
              }
            : {}),
        },
        renderedPageFingerprint: {
          deployedTeacherWorkflowUi: "present",
        },
        deploymentOrigin,
        vercelProductionDeploymentBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingAnchors.length === 0 &&
    evidenceEnvironment === "production" &&
    deploymentOrigin.originClass === "remote-https" &&
    isDeployedTeacherWorkflowVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    )
  ) {
    return satisfiedRequirement(id, "live-passed", {
      requiredAnchors: requiredDeployedTeacherWorkflowAnchors,
      evidenceEnvironment,
      deploymentFingerprint: {
        deployedTeacherWorkflowUi: "present",
        ...(vercelDeploymentFingerprint.status === "matched"
          ? {
              vercelProductionDeployment: "present",
              match: true,
            }
          : {}),
      },
      renderedPageFingerprint: {
        deployedTeacherWorkflowUi: "present",
      },
      deploymentOrigin,
      vercelProductionDeploymentBinding,
    });
  }
  return blockedRequirement(
    id,
    "deployed-teacher-workflow-page-not-live-passed",
    readEvidenceStatus(evidence),
    {
      evidenceEnvironment,
      missingAnchors,
      deploymentOrigin,
    },
  );
}

function readDeployedTeacherWorkflowVercelProductionDeploymentBinding(evidence) {
  if (!isRecord(evidence.vercelProductionDeploymentEvidence)) {
    return {
      target: "missing",
      status: "missing",
      deploymentObservationStatus: "missing",
      releaseRunIdStatus: "missing",
      valueRedacted: false,
    };
  }
  const binding = evidence.vercelProductionDeploymentEvidence;
  return {
    target: typeof binding.target === "string" ? binding.target : "missing",
    status: typeof binding.status === "string" ? binding.status : "missing",
    deploymentObservationStatus:
      typeof binding.deploymentObservationStatus === "string"
        ? binding.deploymentObservationStatus
        : "missing",
    releaseRunIdStatus:
      typeof binding.releaseRunIdStatus === "string"
        ? binding.releaseRunIdStatus
        : "missing",
    valueRedacted: binding.valueRedacted === true,
  };
}

function isDeployedTeacherWorkflowVercelProductionDeploymentBindingProved(binding) {
  return (
    binding.target === "vercel-production-deployment" &&
    binding.status === "matched" &&
    binding.deploymentObservationStatus === "observed" &&
    binding.releaseRunIdStatus === "matched" &&
    binding.valueRedacted === true
  );
}

function isDeployedTeacherWorkflowVercelProductionDeploymentBindingMatchedExceptReleaseRun(binding) {
  return (
    binding.target === "vercel-production-deployment" &&
    binding.status === "matched" &&
    binding.deploymentObservationStatus === "observed" &&
    binding.valueRedacted === true
  );
}

function evaluateTeacherWorkflowBrowserUi(evidence, deployedTeacherWorkflowUi) {
  const id = "teacher-workflow-browser-smoke";
  if (!isProductionLivePassed(deployedTeacherWorkflowUi)) {
    return blockedRequirement(id, "deployed-teacher-workflow-page-not-live-passed", "waiting-for-deployed-page", {
      upstreamRequirement: "deployed-teacher-workflow-page",
    });
  }
  if (!isRecord(evidence)) {
    return blockedRequirement(id, "teacher-workflow-browser-smoke-not-live-passed", "missing");
  }
  if (evidence.target !== "teacher-workflow-browser-smoke") {
    return blockedRequirement(
      id,
      "teacher-workflow-browser-smoke-target-mismatch",
      readEvidenceStatus(evidence),
      {
        evidenceTarget: typeof evidence.target === "string" ? evidence.target : "missing",
      },
    );
  }

  const evidenceEnvironment = typeof evidence.environment === "string" ? evidence.environment : "unspecified";
  const results = isRecord(evidence.results) ? evidence.results : {};
  const missingInteractions = requiredTeacherWorkflowBrowserResults.filter(
    (interaction) => results[interaction] !== "passed",
  );
  const deploymentOrigin = readDeploymentOrigin(evidence);
  const deploymentFingerprint = evaluateBrowserDeploymentFingerprintMatch({
    browserSmoke: evidence,
    deployedTeacherWorkflowUi,
  });
  const apiInterceptionPolicy = readBrowserApiInterceptionPolicy(evidence);
  const apiInterceptionProved =
    apiInterceptionPolicy.workflowApis === "live-workflow-status" &&
    apiInterceptionPolicy.remoteMutations === "fixture-blocked" &&
    apiInterceptionPolicy.responseBodiesOmitted === true;
  const vercelProductionDeploymentBinding =
    readTeacherWorkflowBrowserVercelProductionDeploymentBinding(evidence);

  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingInteractions.length === 0 &&
    evidenceEnvironment !== "production"
  ) {
    return blockedRequirement(
      id,
      "teacher-workflow-browser-smoke-not-production",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingInteractions,
        deploymentOrigin,
        apiInterceptionPolicy,
        vercelProductionDeploymentBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingInteractions.length === 0 &&
    evidenceEnvironment === "production" &&
    deploymentFingerprint.status === "blocked"
  ) {
    return blockedRequirement(
      id,
      deploymentFingerprint.blockedReason,
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingInteractions,
        deploymentFingerprint: deploymentFingerprint.details,
        deploymentOrigin,
        apiInterceptionPolicy,
        vercelProductionDeploymentBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingInteractions.length === 0 &&
    evidenceEnvironment === "production" &&
    deploymentFingerprint.status === "matched" &&
    deploymentOrigin.originClass !== "remote-https"
  ) {
    return blockedRequirement(
      id,
      "teacher-workflow-browser-smoke-origin-not-remote-https",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingInteractions,
        deploymentFingerprint: deploymentFingerprint.details,
        deploymentOrigin,
        apiInterceptionPolicy,
        vercelProductionDeploymentBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingInteractions.length === 0 &&
    evidenceEnvironment === "production" &&
    deploymentFingerprint.status === "matched" &&
    deploymentOrigin.originClass === "remote-https" &&
    !apiInterceptionProved
  ) {
    return blockedRequirement(
      id,
      "teacher-workflow-browser-smoke-api-interception-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingInteractions,
        deploymentFingerprint: deploymentFingerprint.details,
        deploymentOrigin,
        apiInterceptionPolicy,
        vercelProductionDeploymentBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingInteractions.length === 0 &&
    evidenceEnvironment === "production" &&
    deploymentFingerprint.status === "matched" &&
    deploymentOrigin.originClass === "remote-https" &&
    apiInterceptionProved &&
    isTeacherWorkflowBrowserVercelProductionDeploymentBindingMatchedExceptReleaseRun(
      vercelProductionDeploymentBinding,
    ) &&
    vercelProductionDeploymentBinding.releaseRunIdStatus !== "matched"
  ) {
    return blockedRequirement(
      id,
      "teacher-workflow-browser-smoke-vercel-deployment-release-run-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingInteractions,
        deploymentFingerprint: deploymentFingerprint.details,
        deploymentOrigin,
        apiInterceptionPolicy,
        vercelProductionDeploymentBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingInteractions.length === 0 &&
    evidenceEnvironment === "production" &&
    deploymentFingerprint.status === "matched" &&
    deploymentOrigin.originClass === "remote-https" &&
    apiInterceptionProved &&
    !isTeacherWorkflowBrowserVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    )
  ) {
    return blockedRequirement(
      id,
      "teacher-workflow-browser-smoke-vercel-deployment-binding-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingInteractions,
        deploymentFingerprint: deploymentFingerprint.details,
        deploymentOrigin,
        apiInterceptionPolicy,
        vercelProductionDeploymentBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingInteractions.length === 0 &&
    evidenceEnvironment === "production" &&
    deploymentFingerprint.status === "matched" &&
    deploymentOrigin.originClass === "remote-https" &&
    apiInterceptionProved &&
    isTeacherWorkflowBrowserVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    )
  ) {
    return satisfiedRequirement(id, "live-passed", {
      requiredInteractions: requiredTeacherWorkflowBrowserResults,
      evidenceEnvironment,
      deploymentFingerprint: deploymentFingerprint.details,
      deploymentOrigin,
      apiInterceptionPolicy,
      vercelProductionDeploymentBinding,
    });
  }

  return blockedRequirement(
    id,
    "teacher-workflow-browser-smoke-not-live-passed",
    readEvidenceStatus(evidence),
    {
      evidenceEnvironment,
      missingInteractions,
      deploymentOrigin,
      apiInterceptionPolicy,
      vercelProductionDeploymentBinding,
    },
  );
}

function evaluateTeacherWorkflowLiveGeneration(
  evidence,
  teacherWorkflowBrowserUi,
  deployedTeacherWorkflowUi,
  vercelProductionDeployment,
) {
  const id = "teacher-workflow-live-generation-smoke";
  const upstreamBrowserSmoke = readBrowserApiInterceptionPolicy(teacherWorkflowBrowserUi);
  if (
    !isTeacherWorkflowBrowserUiProductionPassed(
      teacherWorkflowBrowserUi,
      deployedTeacherWorkflowUi,
      vercelProductionDeployment,
    )
  ) {
    return blockedRequirement(
      id,
      "teacher-workflow-browser-smoke-not-live-passed",
      "waiting-for-browser-smoke",
      { upstreamBrowserSmoke },
    );
  }
  if (!isRecord(evidence)) {
    return blockedRequirement(
      id,
      "teacher-workflow-live-generation-smoke-not-live-passed",
      "missing",
      { upstreamBrowserSmoke },
    );
  }
  if (evidence.target !== "teacher-workflow-live-generation-smoke") {
    return blockedRequirement(
      id,
      "teacher-workflow-live-generation-smoke-target-mismatch",
      readEvidenceStatus(evidence),
      {
        evidenceTarget: typeof evidence.target === "string" ? evidence.target : "missing",
        upstreamBrowserSmoke,
      },
    );
  }

  const evidenceEnvironment = typeof evidence.environment === "string" ? evidence.environment : "unspecified";
  const results = isRecord(evidence.results) ? evidence.results : {};
  const missingResults = requiredTeacherWorkflowLiveGenerationResults.filter(
    (result) => results[result] !== "passed",
  );
  const deploymentOrigin = readDeploymentOrigin(evidence);
  const providerMutationPolicy = readLiveGenerationProviderMutationPolicy(evidence);
  const providerMutationPolicyProved =
    providerMutationPolicy.workflowApis === "live-workflow-status" &&
    providerMutationPolicy.remoteMutations === "live-provider-approved" &&
    providerMutationPolicy.liveProviderApproved === true &&
    providerMutationPolicy.responseBodiesOmitted === true &&
    providerMutationPolicy.providerTaskIdsRedacted === true;
  const safety = readLiveGenerationSafety(evidence);
  const safetyProved = Object.values(safety).every((status) => status === "proved");
  const vercelProductionDeploymentBinding =
    readTeacherWorkflowBrowserVercelProductionDeploymentBinding(evidence);
  const teacherAuthProviderReadinessBinding =
    readRouteSmokeTeacherAuthProviderReadinessBinding(evidence);
  const auth =
    evidence.auth === "issued-teacher-auth-cookie"
      ? "issued-teacher-auth-cookie"
      : evidence.auth === "signed-teacher-auth-cookie"
        ? "signed-teacher-auth-cookie"
        : "missing";
  const externalStorageServiceReadinessBinding =
    readRouteSmokeExternalStorageServiceReadinessBinding(evidence);

  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingResults.length === 0 &&
    evidenceEnvironment !== "production"
  ) {
    return blockedRequirement(
      id,
      "teacher-workflow-live-generation-smoke-not-production",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingResults,
        deploymentOrigin,
        providerMutationPolicy,
        safety,
        upstreamBrowserSmoke,
        vercelProductionDeploymentBinding,
        teacherAuthProviderReadinessBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingResults.length === 0 &&
    evidenceEnvironment === "production" &&
    deploymentOrigin.originClass === "remote-https" &&
    providerMutationPolicyProved &&
    safetyProved &&
    isTeacherWorkflowBrowserVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    ) &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    auth !== "issued-teacher-auth-cookie"
  ) {
    return blockedRequirement(
      id,
      "teacher-workflow-live-generation-auth-not-issued-teacher-cookie",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingResults,
        deploymentOrigin,
        providerMutationPolicy,
        safety,
        upstreamBrowserSmoke,
        vercelProductionDeploymentBinding,
        teacherAuthProviderReadinessBinding,
        auth,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingResults.length === 0 &&
    evidenceEnvironment === "production" &&
    deploymentOrigin.originClass !== "remote-https"
  ) {
    return blockedRequirement(
      id,
      "teacher-workflow-live-generation-smoke-origin-not-remote-https",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingResults,
        deploymentOrigin,
        providerMutationPolicy,
        safety,
        upstreamBrowserSmoke,
        vercelProductionDeploymentBinding,
        teacherAuthProviderReadinessBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingResults.length === 0 &&
    evidenceEnvironment === "production" &&
    deploymentOrigin.originClass === "remote-https" &&
    !providerMutationPolicyProved
  ) {
    return blockedRequirement(
      id,
      "teacher-workflow-live-generation-provider-mutation-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingResults,
        deploymentOrigin,
        providerMutationPolicy,
        safety,
        upstreamBrowserSmoke,
        vercelProductionDeploymentBinding,
        teacherAuthProviderReadinessBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingResults.length === 0 &&
    evidenceEnvironment === "production" &&
    deploymentOrigin.originClass === "remote-https" &&
    providerMutationPolicyProved &&
    !safetyProved
  ) {
    return blockedRequirement(
      id,
      "teacher-workflow-live-generation-redaction-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingResults,
        deploymentOrigin,
        providerMutationPolicy,
        safety,
        upstreamBrowserSmoke,
        vercelProductionDeploymentBinding,
        teacherAuthProviderReadinessBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingResults.length === 0 &&
    evidenceEnvironment === "production" &&
    deploymentOrigin.originClass === "remote-https" &&
    providerMutationPolicyProved &&
    safetyProved &&
    isTeacherWorkflowBrowserVercelProductionDeploymentBindingMatchedExceptReleaseRun(
      vercelProductionDeploymentBinding,
    ) &&
    vercelProductionDeploymentBinding.releaseRunIdStatus !== "matched"
  ) {
    return blockedRequirement(
      id,
      "teacher-workflow-live-generation-vercel-deployment-release-run-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingResults,
        deploymentOrigin,
        providerMutationPolicy,
        safety,
        upstreamBrowserSmoke,
        vercelProductionDeploymentBinding,
        teacherAuthProviderReadinessBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingResults.length === 0 &&
    evidenceEnvironment === "production" &&
    deploymentOrigin.originClass === "remote-https" &&
    providerMutationPolicyProved &&
    safetyProved &&
    !isTeacherWorkflowBrowserVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    )
  ) {
    return blockedRequirement(
      id,
      "teacher-workflow-live-generation-vercel-deployment-binding-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingResults,
        deploymentOrigin,
        providerMutationPolicy,
        safety,
        upstreamBrowserSmoke,
        vercelProductionDeploymentBinding,
        teacherAuthProviderReadinessBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingResults.length === 0 &&
    evidenceEnvironment === "production" &&
    deploymentOrigin.originClass === "remote-https" &&
    providerMutationPolicyProved &&
    safetyProved &&
    isTeacherWorkflowBrowserVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    ) &&
    isRouteSmokeTeacherAuthProviderReadinessBindingMatchedExceptReleaseRun(
      teacherAuthProviderReadinessBinding,
    ) &&
    teacherAuthProviderReadinessBinding.releaseRunIdStatus !== "matched"
  ) {
    return blockedRequirement(
      id,
      "teacher-workflow-live-generation-teacher-auth-readiness-release-run-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingResults,
        deploymentOrigin,
        providerMutationPolicy,
        safety,
        upstreamBrowserSmoke,
        vercelProductionDeploymentBinding,
        teacherAuthProviderReadinessBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingResults.length === 0 &&
    evidenceEnvironment === "production" &&
    deploymentOrigin.originClass === "remote-https" &&
    providerMutationPolicyProved &&
    safetyProved &&
    isTeacherWorkflowBrowserVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    ) &&
    !isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    )
  ) {
    return blockedRequirement(
      id,
      "teacher-workflow-live-generation-teacher-auth-readiness-binding-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingResults,
        deploymentOrigin,
        providerMutationPolicy,
        safety,
        upstreamBrowserSmoke,
        vercelProductionDeploymentBinding,
        teacherAuthProviderReadinessBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingResults.length === 0 &&
    evidenceEnvironment === "production" &&
    deploymentOrigin.originClass === "remote-https" &&
    providerMutationPolicyProved &&
    safetyProved &&
    isTeacherWorkflowBrowserVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    ) &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    isRouteSmokeExternalStorageServiceReadinessBindingMatchedExceptReleaseRun(
      externalStorageServiceReadinessBinding,
    ) &&
    externalStorageServiceReadinessBinding.releaseRunIdStatus !== "matched"
  ) {
    return blockedRequirement(
      id,
      "teacher-workflow-live-generation-storage-readiness-release-run-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingResults,
        deploymentOrigin,
        providerMutationPolicy,
        safety,
        upstreamBrowserSmoke,
        vercelProductionDeploymentBinding,
        teacherAuthProviderReadinessBinding,
        externalStorageServiceReadinessBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingResults.length === 0 &&
    evidenceEnvironment === "production" &&
    deploymentOrigin.originClass === "remote-https" &&
    providerMutationPolicyProved &&
    safetyProved &&
    isTeacherWorkflowBrowserVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    ) &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    !isRouteSmokeExternalStorageServiceReadinessBindingProved(
      externalStorageServiceReadinessBinding,
    )
  ) {
    return blockedRequirement(
      id,
      "teacher-workflow-live-generation-storage-readiness-binding-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingResults,
        deploymentOrigin,
        providerMutationPolicy,
        safety,
        upstreamBrowserSmoke,
        vercelProductionDeploymentBinding,
        teacherAuthProviderReadinessBinding,
        externalStorageServiceReadinessBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingResults.length === 0 &&
    evidenceEnvironment === "production" &&
    deploymentOrigin.originClass === "remote-https" &&
    providerMutationPolicyProved &&
    safetyProved &&
    isTeacherWorkflowBrowserVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    ) &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    isRouteSmokeExternalStorageServiceReadinessBindingProved(
      externalStorageServiceReadinessBinding,
    )
  ) {
    return satisfiedRequirement(id, "live-passed", {
      requiredResults: requiredTeacherWorkflowLiveGenerationResults,
      evidenceEnvironment,
      deploymentOrigin,
      providerMutationPolicy,
      safety,
      upstreamBrowserSmoke,
      vercelProductionDeploymentBinding,
      teacherAuthProviderReadinessBinding,
      auth,
      externalStorageServiceReadinessBinding,
    });
  }

  return blockedRequirement(
    id,
    "teacher-workflow-live-generation-smoke-not-live-passed",
    readEvidenceStatus(evidence),
    {
      evidenceEnvironment,
      missingResults,
      deploymentOrigin,
      providerMutationPolicy,
      safety,
      upstreamBrowserSmoke,
      vercelProductionDeploymentBinding,
      teacherAuthProviderReadinessBinding,
      auth,
    },
  );
}

function readTeacherWorkflowBrowserVercelProductionDeploymentBinding(evidence) {
  if (!isRecord(evidence.vercelProductionDeploymentEvidence)) {
    return {
      target: "missing",
      status: "missing",
      deploymentObservationStatus: "missing",
      releaseRunIdStatus: "missing",
      valueRedacted: false,
    };
  }
  const binding = evidence.vercelProductionDeploymentEvidence;
  return {
    target: typeof binding.target === "string" ? binding.target : "missing",
    status: typeof binding.status === "string" ? binding.status : "missing",
    deploymentObservationStatus:
      typeof binding.deploymentObservationStatus === "string"
        ? binding.deploymentObservationStatus
        : "missing",
    releaseRunIdStatus:
      typeof binding.releaseRunIdStatus === "string"
        ? binding.releaseRunIdStatus
        : "missing",
    valueRedacted: binding.valueRedacted === true,
  };
}

function isTeacherWorkflowBrowserVercelProductionDeploymentBindingProved(binding) {
  return (
    binding.target === "vercel-production-deployment" &&
    binding.status === "matched" &&
    binding.deploymentObservationStatus === "observed" &&
    binding.releaseRunIdStatus === "matched" &&
    binding.valueRedacted === true
  );
}

function isTeacherWorkflowBrowserVercelProductionDeploymentBindingMatchedExceptReleaseRun(binding) {
  return (
    binding.target === "vercel-production-deployment" &&
    binding.status === "matched" &&
    binding.deploymentObservationStatus === "observed" &&
    binding.valueRedacted === true
  );
}

function evaluateLearningPptPlayback(evidence, vercelProductionDeployment) {
  const id = "deployed-learning-ppt-playback";
  if (!isRecord(evidence)) {
    if (isProductionDeploymentDeployed(vercelProductionDeployment)) {
      return blockedRequirement(id, "deployed-learning-ppt-playback-not-live-passed", "missing");
    }

    return blockedRequirement(id, "vercel-production-deployment-not-proven", "waiting-for-production-deployment", {
      upstreamRequirement: "vercel-production-deployment",
    });
  }
  if (evidence.target !== "learning-ppt-playback-deployment-smoke") {
    return blockedRequirement(
      id,
      "deployed-learning-ppt-playback-target-mismatch",
      readEvidenceStatus(evidence),
      {
        evidenceTarget: typeof evidence.target === "string" ? evidence.target : "missing",
      },
    );
  }

  const evidenceEnvironment = typeof evidence.environment === "string" ? evidence.environment : "unspecified";
  const results = isRecord(evidence.results) ? evidence.results : {};
  const missingResults = requiredLearningPptPlaybackResults.filter(
    (result) => results[result] !== "passed",
  );
  const deploymentOrigin = readDeploymentOrigin(evidence);
  const deploymentFingerprint = evaluateLearningPptDeploymentFingerprintMatch({
    learningPptPlayback: evidence,
    vercelProductionDeployment,
  });
  const vercelProductionDeploymentBinding =
    readLearningPptVercelProductionDeploymentBinding(evidence);
  const playback = isRecord(evidence.playback) ? evidence.playback : {};
  const audio = isRecord(evidence.audio) ? evidence.audio : {};
  const httpStatus = readLearningPptPlaybackHttpStatus(evidence);
  const httpStatusContract = isLearningPptPlaybackHttpStatusProved(httpStatus);
  const playbackContract =
    playback.courseId === "elementary-math-research" &&
    playback.audioManifestId === expectedLearningPptAudioManifestId &&
    playback.teacherName === "康霞博士" &&
    playback.voiceLabel === "康霞博士克隆声音" &&
    playback.slideCount === 19 &&
    playback.firstSlideTitle === "自然数的序数理论" &&
    playback.lastSlideTitle === "作业布置" &&
    playback.firstAudioUrl === expectedLearningPptFirstAudioUrl;
  const audioContract =
    isLearningPptAudioContentType(audio.contentType) &&
    Number.isFinite(audio.contentLength) &&
    audio.contentLength >= minimumLearningPptFirstAudioContentLength &&
    audio.wavHeader === "RIFF/WAVE";

  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingResults.length === 0 &&
    evidenceEnvironment !== "production"
  ) {
    return blockedRequirement(
      id,
      "deployed-learning-ppt-playback-not-production",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingResults,
        deploymentOrigin,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingResults.length === 0 &&
    evidenceEnvironment === "production" &&
    deploymentFingerprint.status === "blocked"
  ) {
    return blockedRequirement(
      id,
      "deployed-learning-ppt-playback-not-live-passed",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingResults,
        deploymentFingerprint: deploymentFingerprint.details,
        deploymentOrigin,
        vercelProductionDeploymentBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingResults.length === 0 &&
    evidenceEnvironment === "production" &&
    deploymentOrigin.originClass !== "remote-https"
  ) {
    return blockedRequirement(
      id,
      "deployed-learning-ppt-playback-origin-not-remote-https",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingResults,
        deploymentFingerprint: deploymentFingerprint.details,
        deploymentOrigin,
        vercelProductionDeploymentBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingResults.length === 0 &&
    evidenceEnvironment === "production" &&
    deploymentOrigin.originClass === "remote-https" &&
    !httpStatusContract
  ) {
    return blockedRequirement(
      id,
      "deployed-learning-ppt-playback-http-status-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingResults,
        deploymentFingerprint: deploymentFingerprint.details,
        deploymentOrigin,
        vercelProductionDeploymentBinding,
        httpStatus,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingResults.length === 0 &&
    evidenceEnvironment === "production" &&
    deploymentOrigin.originClass === "remote-https" &&
    httpStatusContract &&
    (!playbackContract || !audioContract)
  ) {
    return blockedRequirement(
      id,
      "deployed-learning-ppt-playback-contract-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingResults,
        deploymentFingerprint: deploymentFingerprint.details,
        deploymentOrigin,
        vercelProductionDeploymentBinding,
        httpStatus,
        playbackContract: playbackContract ? "passed" : "failed",
        audioContract: audioContract ? "passed" : "failed",
        minimumFirstAudioContentLength: minimumLearningPptFirstAudioContentLength,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingResults.length === 0 &&
    evidenceEnvironment === "production" &&
    deploymentOrigin.originClass === "remote-https" &&
    httpStatusContract &&
    playbackContract &&
    audioContract &&
    isLearningPptVercelProductionDeploymentBindingMatchedExceptReleaseRun(
      vercelProductionDeploymentBinding,
    ) &&
    vercelProductionDeploymentBinding.releaseRunIdStatus !== "matched"
  ) {
    return blockedRequirement(
      id,
      "deployed-learning-ppt-playback-vercel-deployment-release-run-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingResults,
        deploymentFingerprint: deploymentFingerprint.details,
        deploymentOrigin,
        vercelProductionDeploymentBinding,
        httpStatus,
        playbackContract: "passed",
        audioContract: "passed",
        minimumFirstAudioContentLength: minimumLearningPptFirstAudioContentLength,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingResults.length === 0 &&
    evidenceEnvironment === "production" &&
    deploymentOrigin.originClass === "remote-https" &&
    httpStatusContract &&
    playbackContract &&
    audioContract &&
    !isLearningPptVercelProductionDeploymentBindingProved(vercelProductionDeploymentBinding)
  ) {
    return blockedRequirement(
      id,
      "deployed-learning-ppt-playback-vercel-deployment-binding-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingResults,
        deploymentFingerprint: deploymentFingerprint.details,
        deploymentOrigin,
        vercelProductionDeploymentBinding,
        httpStatus,
        playbackContract: "passed",
        audioContract: "passed",
        minimumFirstAudioContentLength: minimumLearningPptFirstAudioContentLength,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingResults.length === 0 &&
    evidenceEnvironment === "production" &&
    deploymentOrigin.originClass === "remote-https" &&
    httpStatusContract &&
    playbackContract &&
    audioContract
  ) {
    return satisfiedRequirement(id, "live-passed", {
      evidenceEnvironment,
      requiredResults: requiredLearningPptPlaybackResults,
      deploymentFingerprint: deploymentFingerprint.details,
      deploymentOrigin,
      vercelProductionDeploymentBinding,
      httpStatus,
      playbackContract: "passed",
      audioContract: "passed",
      minimumFirstAudioContentLength: minimumLearningPptFirstAudioContentLength,
    });
  }

  return blockedRequirement(id, "deployed-learning-ppt-playback-not-live-passed", readEvidenceStatus(evidence), {
    evidenceEnvironment,
    missingResults,
    deploymentOrigin,
    vercelProductionDeploymentBinding,
    httpStatus,
    playbackContract: playbackContract ? "passed" : "failed",
    audioContract: audioContract ? "passed" : "failed",
  });
}

function readLearningPptVercelProductionDeploymentBinding(evidence) {
  if (!isRecord(evidence.vercelProductionDeploymentEvidence)) {
    return {
      target: "missing",
      status: "missing",
      deploymentObservationStatus: "missing",
      releaseRunIdStatus: "missing",
      valueRedacted: false,
    };
  }
  const binding = evidence.vercelProductionDeploymentEvidence;
  return {
    target:
      typeof binding.target === "string"
        ? binding.target
        : "missing",
    status:
      typeof binding.status === "string"
        ? binding.status
        : "missing",
    deploymentObservationStatus:
      typeof binding.deploymentObservationStatus === "string"
        ? binding.deploymentObservationStatus
        : "missing",
    releaseRunIdStatus:
      typeof binding.releaseRunIdStatus === "string"
        ? binding.releaseRunIdStatus
        : "missing",
    valueRedacted: binding.valueRedacted === true,
  };
}

function isLearningPptVercelProductionDeploymentBindingProved(binding) {
  return (
    binding.target === "vercel-production-deployment" &&
    binding.status === "matched" &&
    binding.deploymentObservationStatus === "observed" &&
    binding.releaseRunIdStatus === "matched" &&
    binding.valueRedacted === true
  );
}

function isLearningPptVercelProductionDeploymentBindingMatchedExceptReleaseRun(binding) {
  return (
    binding.target === "vercel-production-deployment" &&
    binding.status === "matched" &&
    binding.deploymentObservationStatus === "observed" &&
    binding.valueRedacted === true
  );
}

function readLearningPptPlaybackHttpStatus(evidence) {
  const httpStatus = isRecord(evidence.httpStatus) ? evidence.httpStatus : {};
  return {
    learningPage:
      Number.isInteger(httpStatus.learningPage) ? httpStatus.learningPage : "missing",
    playbackManifest:
      Number.isInteger(httpStatus.playbackManifest) ? httpStatus.playbackManifest : "missing",
    firstSlideAudio:
      Number.isInteger(httpStatus.firstSlideAudio) ? httpStatus.firstSlideAudio : "missing",
  };
}

function isLearningPptPlaybackHttpStatusProved(httpStatus) {
  return (
    httpStatus.learningPage === 200 &&
    httpStatus.playbackManifest === 200 &&
    httpStatus.firstSlideAudio === 200
  );
}

function evaluateVercelProjectReadiness(evidence) {
  const id = "vercel-project-readiness";
  if (!isRecord(evidence)) {
    return blockedRequirement(id, "vercel-project-readiness-evidence-missing", "missing");
  }
  if (evidence.target !== "vercel-project-readiness") {
    return blockedRequirement(id, "vercel-project-readiness-evidence-target-mismatch", readEvidenceStatus(evidence), {
      evidenceTarget: typeof evidence.target === "string" ? evidence.target : "missing",
    });
  }
  const presentCheckIds = new Set(
    (Array.isArray(evidence.checks) ? evidence.checks : [])
      .filter((check) => isRecord(check) && check.status === "present" && typeof check.id === "string")
      .map((check) => check.id),
  );
  const missingChecks = requiredVercelProjectReadinessChecks.filter(
    (checkId) => !presentCheckIds.has(checkId),
  );
  const redactionSafety = readVercelProjectReadinessSafety(evidence);
  const redactionSafetyProved = Object.values(redactionSafety).every(
    (status) => status === "proved",
  );
  if (evidence.status === "ready" && missingChecks.length === 0) {
    if (!redactionSafetyProved) {
      return blockedRequirement(
        id,
        "vercel-project-readiness-redaction-not-proven",
        readEvidenceStatus(evidence),
        {
          requiredChecks: requiredVercelProjectReadinessChecks,
          redactionSafety,
        },
      );
    }
    return satisfiedRequirement(id, readEvidenceStatus(evidence), {
      requiredChecks: requiredVercelProjectReadinessChecks,
      redactionSafety,
    });
  }
  return blockedRequirement(
    id,
    chooseVercelProjectReadinessBlockedReason(evidence, missingChecks),
    readEvidenceStatus(evidence),
    { missingChecks, redactionSafety },
  );
}

function readVercelProjectReadinessSafety(evidence) {
  const safety = isRecord(evidence) && isRecord(evidence.safety) ? evidence.safety : {};
  return Object.fromEntries(
    requiredVercelProjectReadinessSafetyFlags.map((flag) => [
      flag,
      safety[flag] === true ? "proved" : "missing",
    ]),
  );
}

function evaluateVercelProductionDeployment(evidence) {
  const id = "vercel-production-deployment";
  if (!isRecord(evidence)) {
    return blockedRequirement(id, "vercel-production-deployment-not-proven", "missing");
  }
  if (evidence.target !== "vercel-production-deployment") {
    return blockedRequirement(
      id,
      "vercel-production-deployment-evidence-target-mismatch",
      readEvidenceStatus(evidence),
      {
        evidenceTarget: typeof evidence.target === "string" ? evidence.target : "missing",
      },
    );
  }
  const evidenceEnvironment = typeof evidence.environment === "string" ? evidence.environment : "unspecified";
  const deploymentFingerprint = readDeploymentFingerprint(evidence);
  const deploymentOrigin = readDeploymentOrigin(evidence);
  const deploymentObservationStatus = readVercelProductionDeploymentObservationStatus(evidence);
  const redactionSafety = readVercelProductionDeploymentSafety(evidence);
  const projectReadinessGuard = readVercelProductionDeploymentProjectReadinessGuard(evidence);
  const envSyncGuard = readVercelProductionDeploymentEnvSyncGuard(evidence);
  const envSyncApplyPreflightGuard =
    readVercelProductionDeploymentEnvSyncApplyPreflightGuard(evidence);
  const deploymentScope =
    typeof evidence.deploymentScope === "string" ? evidence.deploymentScope : "full";
  const operationStatus =
    isRecord(evidence.operation) && typeof evidence.operation.status === "string"
      ? evidence.operation.status
      : "missing";
  const redactionSafetyProved = Object.values(redactionSafety).every(
    (status) => status === "proved",
  );

  if (deploymentScope !== "full") {
    return blockedRequirement(
      id,
      "vercel-production-deployment-scoped-env-only",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        deploymentScope,
        deploymentFingerprint: {
          vercelProductionDeployment: deploymentFingerprint ? "present" : "missing",
        },
        deploymentOrigin,
        deploymentObservationStatus,
        projectReadinessGuard,
        envSyncGuard,
        envSyncApplyPreflightGuard,
        operationStatus,
        redactionSafety,
      },
    );
  }

  if (evidence.mode === "live" && evidence.status === "deployed" && evidenceEnvironment !== "production") {
    return blockedRequirement(
      id,
      "vercel-production-deployment-not-production",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        deploymentFingerprint: {
          vercelProductionDeployment: deploymentFingerprint ? "present" : "missing",
        },
        deploymentOrigin,
        deploymentObservationStatus,
        projectReadinessGuard,
        envSyncGuard,
        envSyncApplyPreflightGuard,
        redactionSafety,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "blocked" &&
    evidenceEnvironment === "production" &&
    projectReadinessGuard === "proved" &&
    envSyncGuard !== "proved"
  ) {
    return blockedRequirement(
      id,
      "vercel-production-deployment-env-sync-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        deploymentFingerprint: {
          vercelProductionDeployment: deploymentFingerprint ? "present" : "missing",
        },
        deploymentOrigin,
        deploymentObservationStatus,
        projectReadinessGuard,
        envSyncGuard,
        envSyncApplyPreflightGuard,
        operationStatus,
        redactionSafety,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "blocked" &&
    evidenceEnvironment === "production" &&
    projectReadinessGuard === "proved" &&
    envSyncGuard === "proved" &&
    envSyncApplyPreflightGuard !== "proved"
  ) {
    return blockedRequirement(
      id,
      "vercel-production-deployment-env-sync-apply-preflight-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        deploymentFingerprint: {
          vercelProductionDeployment: deploymentFingerprint ? "present" : "missing",
        },
        deploymentOrigin,
        deploymentObservationStatus,
        projectReadinessGuard,
        envSyncGuard,
        envSyncApplyPreflightGuard,
        operationStatus,
        redactionSafety,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "deployed" &&
    evidenceEnvironment === "production" &&
    !deploymentFingerprint
  ) {
    return blockedRequirement(
      id,
      "vercel-production-deployment-fingerprint-missing",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        deploymentFingerprint: {
          vercelProductionDeployment: "missing",
        },
        deploymentOrigin,
        deploymentObservationStatus,
        projectReadinessGuard,
        envSyncGuard,
        envSyncApplyPreflightGuard,
        redactionSafety,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "deployed" &&
    evidenceEnvironment === "production" &&
    deploymentFingerprint &&
    deploymentOrigin.originClass !== "remote-https"
  ) {
    return blockedRequirement(
      id,
      "vercel-production-deployment-origin-not-remote-https",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        deploymentFingerprint: {
          vercelProductionDeployment: "present",
        },
        deploymentOrigin,
        deploymentObservationStatus,
        projectReadinessGuard,
        envSyncGuard,
        envSyncApplyPreflightGuard,
        redactionSafety,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "deployed" &&
    evidenceEnvironment === "production" &&
    deploymentFingerprint &&
    deploymentOrigin.originClass === "remote-https" &&
    projectReadinessGuard !== "proved"
  ) {
    return blockedRequirement(
      id,
      "vercel-production-deployment-project-readiness-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        deploymentFingerprint: {
          vercelProductionDeployment: "present",
        },
        deploymentOrigin,
        deploymentObservationStatus,
        projectReadinessGuard,
        envSyncGuard,
        envSyncApplyPreflightGuard,
        redactionSafety,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "deployed" &&
    evidenceEnvironment === "production" &&
    deploymentFingerprint &&
    deploymentOrigin.originClass === "remote-https" &&
    projectReadinessGuard === "proved" &&
    envSyncGuard !== "proved"
  ) {
    return blockedRequirement(
      id,
      "vercel-production-deployment-env-sync-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        deploymentFingerprint: {
          vercelProductionDeployment: "present",
        },
        deploymentOrigin,
        deploymentObservationStatus,
        projectReadinessGuard,
        envSyncGuard,
        envSyncApplyPreflightGuard,
        redactionSafety,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "deployed" &&
    evidenceEnvironment === "production" &&
    deploymentFingerprint &&
    deploymentOrigin.originClass === "remote-https" &&
    projectReadinessGuard === "proved" &&
    envSyncGuard === "proved" &&
    envSyncApplyPreflightGuard !== "proved"
  ) {
    return blockedRequirement(
      id,
      "vercel-production-deployment-env-sync-apply-preflight-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        deploymentFingerprint: {
          vercelProductionDeployment: "present",
        },
        deploymentOrigin,
        deploymentObservationStatus,
        projectReadinessGuard,
        envSyncGuard,
        envSyncApplyPreflightGuard,
        redactionSafety,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "deployed" &&
    evidenceEnvironment === "production" &&
    deploymentFingerprint &&
    deploymentOrigin.originClass === "remote-https" &&
    projectReadinessGuard === "proved" &&
    envSyncGuard === "proved" &&
    envSyncApplyPreflightGuard === "proved" &&
    deploymentObservationStatus !== "proved"
  ) {
    return blockedRequirement(
      id,
      "vercel-production-deployment-observation-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        deploymentFingerprint: {
          vercelProductionDeployment: "present",
        },
        deploymentOrigin,
        projectReadinessGuard,
        envSyncGuard,
        envSyncApplyPreflightGuard,
        deploymentObservationStatus,
        redactionSafety,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "deployed" &&
    evidenceEnvironment === "production" &&
    deploymentFingerprint &&
    deploymentOrigin.originClass === "remote-https" &&
    projectReadinessGuard === "proved" &&
    envSyncGuard === "proved" &&
    envSyncApplyPreflightGuard === "proved" &&
    deploymentObservationStatus === "proved" &&
    !redactionSafetyProved
  ) {
    return blockedRequirement(
      id,
      "vercel-production-deployment-redaction-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        deploymentFingerprint: {
          vercelProductionDeployment: "present",
        },
        deploymentOrigin,
        projectReadinessGuard,
        envSyncGuard,
        envSyncApplyPreflightGuard,
        deploymentObservationStatus,
        redactionSafety,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "deployed" &&
    evidenceEnvironment === "production" &&
    deploymentFingerprint &&
    deploymentOrigin.originClass === "remote-https" &&
    projectReadinessGuard === "proved" &&
    envSyncGuard === "proved" &&
    envSyncApplyPreflightGuard === "proved" &&
    deploymentObservationStatus === "proved" &&
    redactionSafetyProved
  ) {
    return satisfiedRequirement(id, readEvidenceStatus(evidence), {
      evidenceEnvironment,
      deploymentFingerprint: {
        vercelProductionDeployment: "present",
      },
      deploymentOrigin,
      projectReadinessGuard,
      envSyncGuard,
      envSyncApplyPreflightGuard,
      deploymentObservationStatus,
      redactionSafety,
    });
  }
  return blockedRequirement(id, "vercel-production-deployment-not-proven", readEvidenceStatus(evidence), {
    evidenceEnvironment,
    deploymentFingerprint: {
      vercelProductionDeployment: deploymentFingerprint ? "present" : "missing",
    },
    deploymentOrigin,
    projectReadinessGuard,
    envSyncGuard,
    envSyncApplyPreflightGuard,
    deploymentObservationStatus,
    redactionSafety,
  });
}

function readVercelProductionDeploymentSafety(evidence) {
  const safety = isRecord(evidence) && isRecord(evidence.safety) ? evidence.safety : {};
  return Object.fromEntries(
    requiredVercelProductionDeploymentSafetyFlags.map((flag) => [
      flag,
      safety[flag] === true ? "proved" : "missing",
    ]),
  );
}

function readVercelProductionDeploymentProjectReadinessGuard(evidence) {
  if (!isRecord(evidence) || !Array.isArray(evidence.prerequisites)) {
    return "missing";
  }
  const guard = evidence.prerequisites.find(
    (prerequisite) =>
      isRecord(prerequisite) && prerequisite.id === "s22-vercel-project-readiness",
  );
  return isRecord(guard) && guard.status === "ready" ? "proved" : "missing";
}

function readVercelProductionDeploymentEnvSyncGuard(evidence) {
  if (!isRecord(evidence) || !Array.isArray(evidence.prerequisites)) {
    return "missing";
  }
  const guard = evidence.prerequisites.find(
    (prerequisite) =>
      isRecord(prerequisite) && prerequisite.id === "s19-vercel-env-sync-apply-evidence",
  );
  return isRecord(guard) && guard.status === "applied" ? "proved" : "missing";
}

function readVercelProductionDeploymentEnvSyncApplyPreflightGuard(evidence) {
  if (!isRecord(evidence) || !isRecord(evidence.envSyncApplyPreflightGuard)) {
    return "missing";
  }
  const guard = evidence.envSyncApplyPreflightGuard;
  return guard.status === "proved" &&
    guard.requiredEvidence === "vercel-env-sync.applyPreflight" &&
    guard.valuesRedacted === true &&
    guard.cliSafeToInvoke === true
    ? "proved"
    : "missing";
}

function readVercelProductionDeploymentObservationStatus(evidence) {
  if (!isRecord(evidence) || !isRecord(evidence.deploymentObservation)) {
    return "missing";
  }
  const observation = evidence.deploymentObservation;
  const observedAt =
    typeof observation.observedAt === "string" ? observation.observedAt.trim() : "";
  const source = typeof observation.source === "string" ? observation.source.trim() : "";
  return observation.status === "observed" &&
    observedAt.length > 0 &&
    !Number.isNaN(Date.parse(observedAt)) &&
    source.length > 0
    ? "proved"
    : "missing";
}

function evaluateTrustedTeacherAuthRouteChain(evidence) {
  const id = "trusted-teacher-auth-route-chain";
  if (!isRecord(evidence)) {
    return blockedRequirement(
      id,
      "trusted-teacher-auth-route-chain-missing",
      "waiting-for-trusted-route-chain-evidence",
    );
  }
  if (evidence.target !== "trusted-teacher-auth-route-chain-contract") {
    return blockedRequirement(
      id,
      "trusted-teacher-auth-route-chain-target-mismatch",
      readEvidenceStatus(evidence),
      {
        evidenceTarget:
          typeof evidence.target === "string" ? evidence.target : "missing",
      },
    );
  }

  const routeEvidence = isRecord(evidence.evidence) ? evidence.evidence : {};
  const releaseImpact = isRecord(evidence.releaseImpact) ? evidence.releaseImpact : {};
  const safety = readTrustedTeacherAuthRouteChainSafety(evidence);
  const routeChain = readTrustedTeacherAuthRouteChainRoutes(routeEvidence.routeChain);
  const issuerProofValidation =
    readTrustedTeacherAuthRouteChainIssuerProofValidation(
      routeEvidence.issuerProofValidation,
    );
  const issuerCookieHardening =
    readTrustedTeacherAuthRouteChainIssuerCookieHardening(
      routeEvidence.issuerCookieHardening,
    );
  const sessionCookiePair = readTrustedTeacherAuthRouteChainCookiePair(
    routeEvidence.sessionCookiePair,
  );
  const authProvider =
    routeEvidence.authProvider === "trusted-cookie-issuer"
      ? "trusted-cookie-issuer"
      : "missing";
  const downstreamAiSession =
    routeEvidence.downstreamAiSession === "scoped-teacher-ai-session-issued"
      ? "scoped-teacher-ai-session-issued"
      : "missing";
  const workflowAction =
    routeEvidence.workflowAction === "ppt-narration-submit"
      ? "ppt-narration-submit"
      : "missing";
  const localTrustedCookieRouteWiring =
    releaseImpact.localTrustedCookieRouteWiring === "proved"
      ? "proved"
      : "missing";
  const releaseGateEligible = releaseImpact.releaseGateEligible === true;
  const details = {
    authProvider,
    routeChain,
    issuerProofValidation,
    issuerCookieHardening,
    sessionCookiePair,
    downstreamAiSession,
    workflowAction,
    localTrustedCookieRouteWiring,
    releaseGateEligible,
    safety,
  };
  const routeContractProved =
    routeChain.length === 2 &&
    routeChain[0] === "/api/ai/teacher-auth/issue" &&
    routeChain[1] === "/api/ai/session" &&
    issuerProofValidation === "proved" &&
    issuerCookieHardening === "proved" &&
    sessionCookiePair.length === 2 &&
    sessionCookiePair[0] === "uais_teacher_auth_claims" &&
    sessionCookiePair[1] === "uais_teacher_auth_signature" &&
    authProvider === "trusted-cookie-issuer" &&
    downstreamAiSession === "scoped-teacher-ai-session-issued" &&
    workflowAction === "ppt-narration-submit" &&
    localTrustedCookieRouteWiring === "proved";
  const safetyProved = Object.values(safety).every((status) =>
    status === "proved" || status === "proved-not-performed",
  );

  if (evidence.status !== "proved-locally") {
    return blockedRequirement(
      id,
      "trusted-teacher-auth-route-chain-not-proved",
      readEvidenceStatus(evidence),
      details,
    );
  }
  if (!routeContractProved) {
    return blockedRequirement(
      id,
      "trusted-teacher-auth-route-chain-contract-not-proven",
      readEvidenceStatus(evidence),
      details,
    );
  }
  if (!safetyProved) {
    return blockedRequirement(
      id,
      "trusted-teacher-auth-route-chain-redaction-not-proven",
      readEvidenceStatus(evidence),
      details,
    );
  }

  return satisfiedRequirement(id, readEvidenceStatus(evidence), details);
}

function readTrustedTeacherAuthRouteChainRoutes(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const allowedRoutes = new Set([
    "/api/ai/teacher-auth/issue",
    "/api/ai/session",
  ]);
  return value.filter((route) => typeof route === "string" && allowedRoutes.has(route));
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
    return [];
  }
  const allowedCookies = new Set([
    "uais_teacher_auth_claims",
    "uais_teacher_auth_signature",
  ]);
  return value.filter((cookie) => typeof cookie === "string" && allowedCookies.has(cookie));
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

function readTrustedTeacherAuthRouteChainSafety(evidence) {
  const safety = isRecord(evidence.safety) ? evidence.safety : {};
  return {
    secretsRedacted: safety.secretsRedacted === true ? "proved" : "missing",
    cookieValuesOmitted:
      safety.cookieValuesOmitted === true ? "proved" : "missing",
    sessionIdsOmitted: safety.sessionIdsOmitted === true ? "proved" : "missing",
    commandOutputOmitted:
      safety.commandOutputOmitted === true ? "proved" : "missing",
    localPrivatePathsOmitted:
      safety.localPrivatePathsOmitted === true ? "proved" : "missing",
    productionMutationPerformed:
      safety.productionMutationPerformed === false
        ? "proved-not-performed"
        : "missing",
  };
}

function evaluateAppAuthProviderReadiness(evidence) {
  const id = "app-auth-provider-readiness";
  if (!isRecord(evidence)) {
    return blockedRequirement(id, "app-auth-provider-readiness-missing", "missing");
  }
  if (evidence.target !== "app-auth-provider-readiness") {
    return blockedRequirement(
      id,
      "app-auth-provider-readiness-target-mismatch",
      readEvidenceStatus(evidence),
      {
        evidenceTarget: typeof evidence.target === "string" ? evidence.target : "missing",
      },
    );
  }

  const evidenceEnvironment =
    typeof evidence.environment === "string" ? evidence.environment : "missing";
  const appAuthProviderMode =
    evidence.appAuthProviderMode === "trusted-account-provider"
      ? "trusted-account-provider"
      : typeof evidence.appAuthProviderMode === "string"
        ? evidence.appAuthProviderMode
        : "missing";
  const endpointSecurity =
    typeof evidence.endpointSecurity === "string" ? evidence.endpointSecurity : "missing";
  const appSessionCookieContract = readAppSessionCookieContract(evidence);
  const trustedAccountProviderContract =
    readTrustedAccountProviderContract(evidence);
  const vercelEnvSyncEvidence = readAppAuthProviderVercelEnvSyncEvidence(evidence);
  const redactionSafety = readAppAuthProviderReadinessSafety(evidence);
  const redactionSafetyProved =
    Object.entries(redactionSafety).every(([key, status]) =>
      key === "providerNetworkCallPerformed"
        ? status === "proved-not-performed"
        : status === "proved",
    );
  const trustedAccountProviderProved =
    trustedAccountProviderContract.providerKind === "trusted-account-provider" &&
    trustedAccountProviderContract.endpoint === "configured" &&
    trustedAccountProviderContract.bearerCredential === "configured" &&
    trustedAccountProviderContract.accessTokenStrength === "sufficient" &&
    trustedAccountProviderContract.requestMethod === "POST" &&
    trustedAccountProviderContract.responseUserShape === "proved" &&
    trustedAccountProviderContract.valueRedacted === true;

  const details = {
    evidenceEnvironment,
    appAuthProviderMode,
    endpointSecurity,
    appSessionCookieContract,
    trustedAccountProviderContract,
    vercelEnvSyncEvidence,
    redactionSafety,
  };

  if (evidence.mode === "live" && evidence.status === "ready" && evidenceEnvironment !== "production") {
    return blockedRequirement(
      id,
      "app-auth-provider-readiness-not-production",
      readEvidenceStatus(evidence),
      details,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "ready" &&
    appAuthProviderMode !== "trusted-account-provider"
  ) {
    return blockedRequirement(
      id,
      "app-auth-provider-selector-not-proven",
      readEvidenceStatus(evidence),
      details,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "ready" &&
    endpointSecurity !== "remote-https"
  ) {
    return blockedRequirement(
      id,
      "app-auth-provider-endpoint-not-remote-https",
      readEvidenceStatus(evidence),
      details,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "ready" &&
    appSessionCookieContract.signingSecretStrength !== "sufficient"
  ) {
    return blockedRequirement(
      id,
      "app-auth-session-cookie-contract-not-proven",
      readEvidenceStatus(evidence),
      details,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "ready" &&
    appSessionCookieContract.cookiePair !== "proved"
  ) {
    return blockedRequirement(
      id,
      "app-auth-session-cookie-pair-contract-not-proven",
      readEvidenceStatus(evidence),
      details,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "ready" &&
    isAppAuthProviderVercelEnvSyncEvidenceMatchedExceptReleaseRun(
      vercelEnvSyncEvidence,
    ) &&
    vercelEnvSyncEvidence.releaseRunIdStatus !== "matched"
  ) {
    return blockedRequirement(
      id,
      "app-auth-provider-vercel-env-sync-release-run-not-proven",
      readEvidenceStatus(evidence),
      details,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "ready" &&
    !isAppAuthProviderVercelEnvSyncEvidenceProved(vercelEnvSyncEvidence)
  ) {
    return blockedRequirement(
      id,
      "app-auth-provider-vercel-env-sync-not-proven",
      readEvidenceStatus(evidence),
      details,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "ready" &&
    !trustedAccountProviderProved
  ) {
    return blockedRequirement(
      id,
      "app-auth-provider-specific-readiness-not-proven",
      readEvidenceStatus(evidence),
      details,
    );
  }
  if (evidence.mode === "live" && evidence.status === "ready" && !redactionSafetyProved) {
    return blockedRequirement(
      id,
      "app-auth-provider-readiness-redaction-not-proven",
      readEvidenceStatus(evidence),
      details,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "ready" &&
    evidenceEnvironment === "production" &&
    appAuthProviderMode === "trusted-account-provider" &&
    endpointSecurity === "remote-https" &&
    appSessionCookieContract.signingSecretStrength === "sufficient" &&
    appSessionCookieContract.cookiePair === "proved" &&
    isAppAuthProviderVercelEnvSyncEvidenceProved(vercelEnvSyncEvidence) &&
    trustedAccountProviderProved &&
    redactionSafetyProved
  ) {
    return satisfiedRequirement(id, readEvidenceStatus(evidence), details);
  }

  return blockedRequirement(
    id,
    "app-auth-provider-readiness-not-live-ready",
    readEvidenceStatus(evidence),
    details,
  );
}

function evaluateTeacherAuthProviderReadiness(evidence) {
  const id = "teacher-auth-provider-readiness";
  if (!isRecord(evidence)) {
    return blockedRequirement(id, "teacher-auth-provider-readiness-missing", "missing");
  }
  if (evidence.target !== "teacher-auth-provider-readiness") {
    return blockedRequirement(
      id,
      "teacher-auth-provider-readiness-target-mismatch",
      readEvidenceStatus(evidence),
      {
        evidenceTarget: typeof evidence.target === "string" ? evidence.target : "missing",
      },
    );
  }

  const evidenceEnvironment =
    typeof evidence.environment === "string" ? evidence.environment : "missing";
  const authProviderMode =
    acceptedTeacherAuthProviderModes.includes(evidence.authProviderMode)
      ? evidence.authProviderMode
      : "missing";
  const sessionCookieContract = readTeacherAuthSessionCookieContract(evidence);
  const trustedIssuerContract = readTrustedIssuerContract(evidence);
  const trustedCookieSessionRoundTrip = readTrustedCookieSessionRoundTrip(evidence);
  const trustedTeacherAuthRouteChainEvidence =
    readTeacherAuthProviderTrustedRouteChainEvidence(evidence);
  const trustedTeacherAuthRouteSmokeEvidence =
    readTeacherAuthProviderTrustedRouteSmokeEvidence(evidence);
  const oidcEndpointSecurity = readOidcEndpointSecurity(evidence);
  const oidcProviderContract = readOidcProviderContract(evidence);
  const oidcJwksReadiness = readOidcJwksReadiness(evidence);
  const vercelEnvSyncEvidence = readTeacherAuthProviderVercelEnvSyncEvidence(evidence);
  const redactionSafety = readTeacherAuthProviderReadinessSafety(evidence);
  const redactionSafetyProved = Object.values(redactionSafety).every((status) => status === "proved");
  const oidcProviderContractProved =
    oidcEndpointSecurity.issuer === "remote-https" &&
    oidcEndpointSecurity.jwks === "remote-https" &&
    oidcProviderContract.audience === "present" &&
    oidcProviderContract.teacherIdClaim === "present";
  const oidcJwksSigningKeyProved =
    oidcJwksReadiness.status === "ready" &&
    oidcJwksReadiness.keys === "present" &&
    oidcJwksReadiness.signingKeys === "present";
  const providerSpecificProved =
    authProviderMode === "trusted-cookie-issuer"
      ? trustedIssuerContract.issuerSecretStrength === "sufficient" &&
        trustedIssuerContract.sessionIssuerSecretSeparation === "proved" &&
        trustedIssuerContract.issuerProofRequired === true &&
        trustedIssuerContract.issuerProofBoundsCookieMaxAge === true &&
        isTrustedCookieSessionRoundTripProved(trustedCookieSessionRoundTrip)
      : authProviderMode === "oidc-jwks"
        ? oidcProviderContractProved && oidcJwksSigningKeyProved
        : false;
  const trustedRouteChainProved =
    authProviderMode !== "trusted-cookie-issuer" ||
    isTeacherAuthProviderTrustedRouteChainEvidenceProved(
      trustedTeacherAuthRouteChainEvidence,
    );
  const trustedRouteSmokeProved =
    authProviderMode !== "trusted-cookie-issuer" ||
    isTeacherAuthProviderTrustedRouteSmokeEvidenceProved(
      trustedTeacherAuthRouteSmokeEvidence,
    );

  const details = {
    evidenceEnvironment,
    authProviderMode,
    sessionCookieContract,
    vercelEnvSyncEvidence,
    ...(authProviderMode === "trusted-cookie-issuer"
      ? {
          trustedIssuerContract,
          trustedCookieSessionRoundTrip,
          trustedTeacherAuthRouteChainEvidence,
          trustedTeacherAuthRouteSmokeEvidence,
        }
      : {}),
    ...(authProviderMode === "oidc-jwks"
      ? { oidcEndpointSecurity, oidcProviderContract, oidcJwksReadiness }
      : {}),
    redactionSafety,
  };

  if (evidence.mode === "live" && evidence.status === "ready" && evidenceEnvironment !== "production") {
    return blockedRequirement(
      id,
      "teacher-auth-provider-readiness-not-production",
      readEvidenceStatus(evidence),
      details,
    );
  }
  if (evidence.mode === "live" && evidence.status === "ready" && !acceptedTeacherAuthProviderModes.includes(authProviderMode)) {
    return blockedRequirement(
      id,
      "teacher-auth-provider-selector-not-proven",
      readEvidenceStatus(evidence),
      details,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "ready" &&
    sessionCookieContract.signingSecretStrength !== "sufficient"
  ) {
    return blockedRequirement(
      id,
      "teacher-auth-session-cookie-contract-not-proven",
      readEvidenceStatus(evidence),
      details,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "ready" &&
    sessionCookieContract.cookiePair !== "proved"
  ) {
    return blockedRequirement(
      id,
      "teacher-auth-session-cookie-pair-contract-not-proven",
      readEvidenceStatus(evidence),
      details,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "ready" &&
    authProviderMode === "trusted-cookie-issuer" &&
    trustedIssuerContract.issuerSecretStrength === "sufficient" &&
    trustedIssuerContract.sessionIssuerSecretSeparation !== "proved"
  ) {
    return blockedRequirement(
      id,
      "teacher-auth-session-issuer-secret-separation-not-proven",
      readEvidenceStatus(evidence),
      details,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "ready" &&
    authProviderMode === "trusted-cookie-issuer" &&
    !isTrustedCookieSessionRoundTripProved(trustedCookieSessionRoundTrip)
  ) {
    return blockedRequirement(
      id,
      "teacher-auth-session-cookie-round-trip-not-proven",
      readEvidenceStatus(evidence),
      details,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "ready" &&
    authProviderMode === "oidc-jwks" &&
    oidcProviderContractProved &&
    !oidcJwksSigningKeyProved
  ) {
    return blockedRequirement(
      id,
      "teacher-auth-oidc-jwks-signing-key-not-proven",
      readEvidenceStatus(evidence),
      details,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "ready" &&
    isTeacherAuthProviderVercelEnvSyncEvidenceMatchedExceptReleaseRun(
      vercelEnvSyncEvidence,
    ) &&
    vercelEnvSyncEvidence.releaseRunIdStatus !== "matched"
  ) {
    return blockedRequirement(
      id,
      "teacher-auth-provider-vercel-env-sync-release-run-not-proven",
      readEvidenceStatus(evidence),
      details,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "ready" &&
    !isTeacherAuthProviderVercelEnvSyncEvidenceProved(vercelEnvSyncEvidence)
  ) {
    return blockedRequirement(
      id,
      "teacher-auth-provider-vercel-env-sync-not-proven",
      readEvidenceStatus(evidence),
      details,
    );
  }
  if (evidence.mode === "live" && evidence.status === "ready" && !providerSpecificProved) {
    return blockedRequirement(
      id,
      "teacher-auth-provider-specific-readiness-not-proven",
      readEvidenceStatus(evidence),
      details,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "ready" &&
    authProviderMode === "trusted-cookie-issuer" &&
    !trustedRouteChainProved
  ) {
    return blockedRequirement(
      id,
      "teacher-auth-provider-trusted-route-chain-not-proven",
      readEvidenceStatus(evidence),
      details,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "ready" &&
    authProviderMode === "trusted-cookie-issuer" &&
    !trustedRouteSmokeProved
  ) {
    return blockedRequirement(
      id,
      "teacher-auth-provider-issuer-route-smoke-not-proven",
      readEvidenceStatus(evidence),
      details,
    );
  }
  if (evidence.mode === "live" && evidence.status === "ready" && !redactionSafetyProved) {
    return blockedRequirement(
      id,
      "teacher-auth-provider-readiness-redaction-not-proven",
      readEvidenceStatus(evidence),
      details,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "ready" &&
    evidenceEnvironment === "production" &&
    sessionCookieContract.signingSecretStrength === "sufficient" &&
    sessionCookieContract.cookiePair === "proved" &&
    providerSpecificProved &&
    trustedRouteChainProved &&
    trustedRouteSmokeProved &&
    isTeacherAuthProviderVercelEnvSyncEvidenceProved(vercelEnvSyncEvidence) &&
    redactionSafetyProved
  ) {
    return satisfiedRequirement(id, readEvidenceStatus(evidence), details);
  }

  return blockedRequirement(
    id,
    "teacher-auth-provider-readiness-not-live-ready",
    readEvidenceStatus(evidence),
    details,
  );
}

function evaluateTeacherAuthProviderConsistency({
  vercelEnvSync,
  teacherAuthProviderReadiness,
  routeSmoke,
}) {
  const id = "teacher-auth-provider-consistency";
  const teacherAuthProviderReadinessState =
    readTeacherAuthProviderReadinessConsistencyState(teacherAuthProviderReadiness);
  const authProviderModes = {
    vercelEnvSync: readAppliedVercelEnvAuthProviderMode(vercelEnvSync),
    teacherAuthProviderReadiness: teacherAuthProviderReadinessState.authProviderMode,
    routeSmoke: readPassedRouteSmokeAuthProviderMode(routeSmoke),
  };
  const allModesPresent = Object.values(authProviderModes).every((mode) =>
    acceptedTeacherAuthProviderModes.includes(mode),
  );

  if (teacherAuthProviderReadinessState.status === "not-live-ready") {
    return blockedRequirement(
      id,
      "teacher-auth-provider-readiness-not-live-ready",
      "waiting-for-live-ready-auth-provider-evidence",
      {
        authProviderModes: {
          ...authProviderModes,
          match: "waiting",
        },
      },
    );
  }

  if (!allModesPresent) {
    return blockedRequirement(id, "teacher-auth-provider-readiness-missing", "waiting-for-auth-provider-evidence", {
      authProviderModes: {
        ...authProviderModes,
        match: "waiting",
      },
    });
  }

  const match =
    authProviderModes.vercelEnvSync === authProviderModes.teacherAuthProviderReadiness &&
    authProviderModes.vercelEnvSync === authProviderModes.routeSmoke;

  if (!match) {
    return blockedRequirement(id, "teacher-auth-provider-selector-mismatch", "mismatched", {
      authProviderModes: {
        ...authProviderModes,
        match: false,
      },
    });
  }

  return satisfiedRequirement(id, "matched", {
    authProviderModes: {
      ...authProviderModes,
      match: true,
    },
  });
}

function readTeacherAuthProviderReadinessConsistencyState(evidence) {
  if (!isRecord(evidence) || evidence.target !== "teacher-auth-provider-readiness") {
    return {
      status: "missing",
      authProviderMode: "missing",
    };
  }
  const authProviderMode = acceptedTeacherAuthProviderModes.includes(evidence.authProviderMode)
    ? evidence.authProviderMode
    : "missing";
  if (isTeacherAuthProviderReadinessProductionReady(evidence)) {
    return {
      status: "ready",
      authProviderMode,
    };
  }
  return {
    status: "not-live-ready",
    authProviderMode,
  };
}

function readAppliedVercelEnvAuthProviderMode(evidence) {
  if (!isRecord(evidence) || evidence.target !== "vercel-env-sync" || evidence.mode !== "apply") {
    return "missing";
  }
  const authProviderMode = readVercelEnvAuthProviderMode(evidence);
  return acceptedTeacherAuthProviderModes.includes(authProviderMode)
    ? authProviderMode
    : "missing";
}

function isTeacherAuthProviderReadinessProductionReady(evidence) {
  const readinessRequirement = evaluateTeacherAuthProviderReadiness(evidence);
  return (
    readinessRequirement.status === "satisfied" &&
    readinessRequirement.evidenceStatus === "live-ready"
  );
}

function isAppAuthProviderReadinessProductionReady(evidence) {
  const readinessRequirement = evaluateAppAuthProviderReadiness(evidence);
  return (
    readinessRequirement.status === "satisfied" &&
    readinessRequirement.evidenceStatus === "live-ready"
  );
}

function readPassedRouteSmokeAuthProviderMode(evidence) {
  if (
    !isRecord(evidence) ||
    evidence.target !== "deployment-route-smoke" ||
    evidence.mode !== "live" ||
    evidence.environment !== "production" ||
    evidence.status !== "passed"
  ) {
    return "missing";
  }
  return acceptedTeacherAuthProviderModes.includes(evidence.authProviderMode)
    ? evidence.authProviderMode
    : "missing";
}

function evaluateProductionReleaseRunConsistency({
  vercelEnvSync,
  vercelProductionDeployment,
  deployedTeacherWorkflowUi,
  teacherWorkflowBrowserUi,
  teacherWorkflowLiveGeneration,
  learningPptPlayback,
  appAuthProviderReadiness,
  teacherAuthProviderReadiness,
  externalStorageContainerBuildReadiness,
  externalStorageServiceReadiness,
  routeSmoke,
  teachingOperationsRouteSmoke,
  teachingOperationDetailBrowserSmoke,
  teachingCourseManagementRouteSmoke,
  externalStorageSmoke,
  pptAcceptance,
}) {
  const id = "production-release-run-consistency";
  const evidenceByName = {
    vercelEnvSync,
    vercelProductionDeployment,
    deployedTeacherWorkflowUi,
    teacherWorkflowBrowserUi,
    teacherWorkflowLiveGeneration,
    learningPptPlayback,
    appAuthProviderReadiness,
    teacherAuthProviderReadiness,
    externalStorageContainerBuildReadiness,
    externalStorageServiceReadiness,
    routeSmoke,
    ...(isRecord(teachingOperationsRouteSmoke) ? { teachingOperationsRouteSmoke } : {}),
    ...(isRecord(teachingOperationDetailBrowserSmoke)
      ? { teachingOperationDetailBrowserSmoke }
      : {}),
    ...(isRecord(teachingCourseManagementRouteSmoke)
      ? { teachingCourseManagementRouteSmoke }
      : {}),
    externalStorageSmoke,
    pptAcceptance,
  };
  const readiness = {
    vercelEnvSync: isVercelEnvSyncProductionApplied(vercelEnvSync),
    vercelProductionDeployment: isProductionDeploymentDeployed(vercelProductionDeployment),
    deployedTeacherWorkflowUi: isDeployedTeacherWorkflowUiProductionPassed(
      deployedTeacherWorkflowUi,
      vercelProductionDeployment,
    ),
    teacherWorkflowBrowserUi: isTeacherWorkflowBrowserUiProductionPassed(
      teacherWorkflowBrowserUi,
      deployedTeacherWorkflowUi,
      vercelProductionDeployment,
    ),
    teacherWorkflowLiveGeneration: isTeacherWorkflowLiveGenerationProductionPassed(
      teacherWorkflowLiveGeneration,
      teacherWorkflowBrowserUi,
      deployedTeacherWorkflowUi,
      vercelProductionDeployment,
    ),
    learningPptPlayback: isLearningPptPlaybackProductionPassed(learningPptPlayback),
    appAuthProviderReadiness:
      isAppAuthProviderReadinessProductionReady(appAuthProviderReadiness),
    teacherAuthProviderReadiness:
      isTeacherAuthProviderReadinessProductionReady(teacherAuthProviderReadiness),
    externalStorageContainerBuildReadiness:
      isExternalStorageContainerBuildReadinessReady(externalStorageContainerBuildReadiness),
    externalStorageServiceReadiness:
      isExternalStorageServiceReadinessProductionReady(externalStorageServiceReadiness),
    routeSmoke: isRouteSmokeProductionPassed(
      routeSmoke,
      deployedTeacherWorkflowUi,
      vercelProductionDeployment,
    ),
    ...(isRecord(teachingOperationsRouteSmoke)
      ? {
          teachingOperationsRouteSmoke:
            isTeachingOperationsRouteSmokeProductionPassed(teachingOperationsRouteSmoke),
        }
      : {}),
    ...(isRecord(teachingOperationDetailBrowserSmoke)
      ? {
          teachingOperationDetailBrowserSmoke:
            isTeachingOperationDetailBrowserSmokeProductionPassed(
              teachingOperationDetailBrowserSmoke,
            ),
        }
      : {}),
    ...(isRecord(teachingCourseManagementRouteSmoke)
      ? {
          teachingCourseManagementRouteSmoke:
            isTeachingCourseManagementRouteSmokeProductionPassed(
              teachingCourseManagementRouteSmoke,
            ),
        }
      : {}),
    externalStorageSmoke: isExternalStorageSmokeProductionPassed(externalStorageSmoke),
    pptAcceptance: isPptManualAcceptanceAccepted(
      pptAcceptance,
      vercelProductionDeployment,
    ),
  };
  const releaseRunIds = Object.fromEntries(
    Object.entries(readiness).map(([name, ready]) => [
      name,
      ready ? (readReleaseRunId(evidenceByName[name]) ? "present" : "missing") : "waiting",
    ]),
  );

  if (Object.values(releaseRunIds).some((status) => status === "waiting")) {
    return blockedRequirement(id, "vercel-production-deployment-not-proven", "waiting-for-production-evidence", {
      releaseRunIds: {
        ...releaseRunIds,
        match: "waiting",
      },
    });
  }

  if (Object.values(releaseRunIds).some((status) => status === "missing")) {
    return blockedRequirement(id, "production-release-run-id-missing", "missing", {
      releaseRunIds: {
        ...releaseRunIds,
        match: "missing",
      },
    });
  }

  const runIds = Object.values(evidenceByName).map((evidence) => readReleaseRunId(evidence));
  const match = new Set(runIds).size === 1;
  if (!match) {
    return blockedRequirement(id, "production-release-run-id-mismatch", "mismatched", {
      releaseRunIds: {
        ...releaseRunIds,
        match: false,
      },
    });
  }

  return satisfiedRequirement(id, "matched", {
    releaseRunIds: {
      ...releaseRunIds,
      match: true,
    },
  });
}

function isExternalStorageContainerBuildReadinessReady(evidence) {
  return evaluateExternalStorageContainerBuildReadiness(evidence).status === "satisfied";
}

function isVercelEnvSyncProductionApplied(evidence) {
  if (!isRecord(evidence)) {
    return false;
  }
  const entries = Array.isArray(evidence.entries) ? evidence.entries : [];
  const presentNames = new Set(
    entries
      .filter((entry) => isRecord(entry) && entry.status === "present" && typeof entry.name === "string")
      .map((entry) => entry.name),
  );
  const authProviderMode = readVercelEnvAuthProviderMode(evidence);
  const requiredAuthProviderEnv = authProviderRequiredVercelEnvNames[authProviderMode] ?? [];
  const requiredEnv = [...commonRequiredVercelEnvNames, ...requiredAuthProviderEnv];
  const missingEnv = requiredEnv.filter((name) => !presentNames.has(name));
  const targets = Array.isArray(evidence.targets)
    ? evidence.targets.filter((target) => typeof target === "string")
    : [];
  const projectReadinessEvidenceStatus =
    typeof evidence.projectReadinessEvidenceStatus === "string"
      ? evidence.projectReadinessEvidenceStatus
      : "missing";
  const localOnlySmokeEnvNotSynced =
    isRecord(evidence.safety) && evidence.safety.localOnlySmokeEnvNotSynced === true
      ? "proved"
      : "missing";
  const externalStorageEndpoint = readExternalStorageEndpoint(evidence);
  const externalStorageServiceFingerprint = readVercelExternalStorageServiceFingerprint(evidence);
  const oidcEndpointSecurity = readOidcEndpointSecurity(evidence);
  const oidcEndpointSecurityProved =
    authProviderMode !== "oidc-jwks" ||
    (oidcEndpointSecurity.issuer === "remote-https" &&
      oidcEndpointSecurity.jwks === "remote-https");
  const requiredSecretStrengthNames = [
    ...commonProductionSecretStrengthNames,
    ...(authProviderProductionSecretStrengthNames[authProviderMode] ?? []),
  ];
  const secretStrength = readVercelSecretStrength(evidence, requiredSecretStrengthNames);
  const applySummary = readVercelApplySummary(evidence);
  const applyPreflight = readVercelApplyPreflight(evidence);
  return (
    evidence.target === "vercel-env-sync" &&
    evidence.mode === "apply" &&
    missingEnv.length === 0 &&
    acceptedTeacherAuthProviderModes.includes(authProviderMode) &&
    projectReadinessEvidenceStatus === "ready" &&
    requiredVercelEnvTargets.every((target) => targets.includes(target)) &&
    localOnlySmokeEnvNotSynced === "proved" &&
    externalStorageEndpoint.endpointClass === "remote-https" &&
    Boolean(externalStorageServiceFingerprint) &&
    oidcEndpointSecurityProved &&
    secretStrength.insufficientSecrets.length === 0 &&
    isVercelApplySummaryProved(applySummary) &&
    isVercelApplyPreflightProved(applyPreflight)
  );
}

function isPptManualAcceptanceAccepted(evidence, vercelProductionDeployment) {
  const pptRequirement = evaluatePptAcceptance(evidence, vercelProductionDeployment);
  return (
    pptRequirement.status === "satisfied" &&
    pptRequirement.evidenceStatus === "accepted"
  );
}

function readReleaseRunId(evidence) {
  if (!isRecord(evidence) || typeof evidence.releaseRunId !== "string") {
    return undefined;
  }
  const releaseRunId = evidence.releaseRunId.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(releaseRunId)
    ? releaseRunId
    : undefined;
}

function readTeacherAuthSessionCookieContract(evidence) {
  if (!isRecord(evidence.sessionCookieContract)) {
    return {
      signingSecretStrength: "missing",
      httpOnly: "missing",
      sameSite: "missing",
      secureInProduction: false,
      maxAgeBounded: false,
      cookiePair: "missing",
      valueRedacted: false,
    };
  }
  const cookiePair = readTeacherAuthSessionCookiePairContract(evidence.sessionCookieContract);
  return {
    signingSecretStrength:
      evidence.sessionCookieContract.signingSecretStrength === "sufficient"
        ? "sufficient"
        : "missing",
    httpOnly: evidence.sessionCookieContract.httpOnly === "required" ? "required" : "missing",
    sameSite: evidence.sessionCookieContract.sameSite === "lax" ? "lax" : "missing",
    secureInProduction: evidence.sessionCookieContract.secureInProduction === true,
    maxAgeBounded: evidence.sessionCookieContract.maxAgeBounded === true,
    cookiePair,
    valueRedacted: evidence.sessionCookieContract.valueRedacted === true,
  };
}

function readTeacherAuthProviderVercelEnvSyncEvidence(evidence) {
  if (!isRecord(evidence.vercelEnvSyncEvidence)) {
    return {
      target: "missing",
      status: "missing",
      valueRedacted: true,
      applyPreflight: "missing",
      releaseRunIdStatus: "missing",
    };
  }
  const guard = evidence.vercelEnvSyncEvidence;
  return {
    target: guard.target === "vercel-env-sync" ? "vercel-env-sync" : "missing",
    status: guard.status === "matched" ? "matched" : "missing",
    valueRedacted: guard.valueRedacted === true,
    applyPreflight: guard.applyPreflight === "proved" ? "proved" : "missing",
    releaseRunIdStatus:
      typeof guard.releaseRunIdStatus === "string"
        ? guard.releaseRunIdStatus
        : "missing",
  };
}

function isTeacherAuthProviderVercelEnvSyncEvidenceProved(evidence) {
  return (
    evidence.target === "vercel-env-sync" &&
    evidence.status === "matched" &&
    evidence.valueRedacted === true &&
    evidence.applyPreflight === "proved" &&
    evidence.releaseRunIdStatus === "matched"
  );
}

function isTeacherAuthProviderVercelEnvSyncEvidenceMatchedExceptReleaseRun(evidence) {
  return (
    evidence.target === "vercel-env-sync" &&
    evidence.status === "matched" &&
    evidence.valueRedacted === true &&
    evidence.applyPreflight === "proved"
  );
}

function readTeacherAuthSessionCookiePairContract(sessionCookieContract) {
  if (!Array.isArray(sessionCookieContract.cookiePair)) {
    return "missing";
  }
  const cookiesByName = new Map(
    sessionCookieContract.cookiePair
      .filter((cookie) => isRecord(cookie) && typeof cookie.name === "string")
      .map((cookie) => [cookie.name, cookie]),
  );
  return requiredTeacherAuthSessionCookiePair.every((requiredCookie) => {
    const cookie = cookiesByName.get(requiredCookie.name);
    return (
      isRecord(cookie) &&
      cookie.purpose === requiredCookie.purpose &&
      cookie.httpOnly === true &&
      cookie.sameSite === "Lax" &&
      cookie.secure === "required-in-production" &&
      cookie.path === "/" &&
      cookie.maxAge === "bounded-by-session-ttl" &&
      cookie.priority === "High" &&
      cookie.valueRedacted === true
    );
  })
    ? "proved"
    : "missing";
}

function readAppSessionCookieContract(evidence) {
  if (!isRecord(evidence.appSessionCookieContract)) {
    return {
      signingSecretStrength: "missing",
      httpOnly: "missing",
      sameSite: "missing",
      secureInProduction: false,
      maxAgeBounded: false,
      cookiePair: "missing",
      valueRedacted: false,
    };
  }
  const cookiePair = readAppSessionCookiePairContract(evidence.appSessionCookieContract);
  return {
    signingSecretStrength:
      evidence.appSessionCookieContract.signingSecretStrength === "sufficient"
        ? "sufficient"
        : "missing",
    httpOnly:
      evidence.appSessionCookieContract.httpOnly === "required"
        ? "required"
        : "missing",
    sameSite:
      evidence.appSessionCookieContract.sameSite === "lax" ? "lax" : "missing",
    secureInProduction: evidence.appSessionCookieContract.secureInProduction === true,
    maxAgeBounded: evidence.appSessionCookieContract.maxAgeBounded === true,
    cookiePair,
    valueRedacted: evidence.appSessionCookieContract.valueRedacted === true,
  };
}

function readAppSessionCookiePairContract(appSessionCookieContract) {
  if (!Array.isArray(appSessionCookieContract.cookiePair)) {
    return "missing";
  }
  const cookiesByName = new Map(
    appSessionCookieContract.cookiePair
      .filter((cookie) => isRecord(cookie) && typeof cookie.name === "string")
      .map((cookie) => [cookie.name, cookie]),
  );
  return requiredAppSessionCookiePair.every((requiredCookie) => {
    const cookie = cookiesByName.get(requiredCookie.name);
    return (
      isRecord(cookie) &&
      cookie.purpose === requiredCookie.purpose &&
      cookie.httpOnly === true &&
      cookie.sameSite === "Lax" &&
      cookie.secure === "required-in-production" &&
      cookie.path === "/" &&
      cookie.maxAge === "bounded-by-session-ttl" &&
      cookie.priority === "High" &&
      cookie.valueRedacted === true
    );
  })
    ? "proved"
    : "missing";
}

function readTrustedAccountProviderContract(evidence) {
  if (!isRecord(evidence.trustedAccountProviderContract)) {
    return {
      providerKind: "missing",
      endpoint: "missing",
      bearerCredential: "missing",
      accessTokenStrength: "missing",
      requestMethod: "missing",
      responseUserShape: "missing",
      valueRedacted: false,
    };
  }
  const contract = evidence.trustedAccountProviderContract;
  return {
    providerKind:
      contract.providerKind === "trusted-account-provider"
        ? "trusted-account-provider"
        : "missing",
    endpoint: contract.endpoint === "configured" ? "configured" : "missing",
    bearerCredential:
      contract.bearerCredential === "configured" ? "configured" : "missing",
    accessTokenStrength:
      contract.accessTokenStrength === "sufficient" ? "sufficient" : "missing",
    requestMethod: contract.requestMethod === "POST" ? "POST" : "missing",
    responseUserShape: isTrustedAccountProviderResponseShapeProved(
      contract.responseUserShape,
    )
      ? "proved"
      : "missing",
    valueRedacted: contract.valueRedacted === true,
  };
}

function isTrustedAccountProviderResponseShapeProved(value) {
  if (!Array.isArray(value)) {
    return false;
  }
  const fields = new Set(value.filter((field) => typeof field === "string"));
  return (
    value.length === 4 &&
    fields.has("account") &&
    fields.has("role") &&
    fields.has("displayName") &&
    fields.has("department")
  );
}

function readAppAuthProviderVercelEnvSyncEvidence(evidence) {
  if (!isRecord(evidence.vercelEnvSyncEvidence)) {
    return {
      target: "missing",
      status: "missing",
      valueRedacted: true,
      applyPreflight: "missing",
      releaseRunIdStatus: "missing",
      requiredAppAuthEnvStatus: "missing",
    };
  }
  const guard = evidence.vercelEnvSyncEvidence;
  return {
    target: guard.target === "vercel-env-sync" ? "vercel-env-sync" : "missing",
    status: guard.status === "matched" ? "matched" : "missing",
    valueRedacted: guard.valueRedacted === true,
    applyPreflight: guard.applyPreflight === "proved" ? "proved" : "missing",
    releaseRunIdStatus:
      typeof guard.releaseRunIdStatus === "string"
        ? guard.releaseRunIdStatus
        : "missing",
    requiredAppAuthEnvStatus:
      guard.requiredAppAuthEnvStatus === "present" ? "present" : "missing",
  };
}

function isAppAuthProviderVercelEnvSyncEvidenceProved(evidence) {
  return (
    evidence.target === "vercel-env-sync" &&
    evidence.status === "matched" &&
    evidence.valueRedacted === true &&
    evidence.applyPreflight === "proved" &&
    evidence.releaseRunIdStatus === "matched" &&
    evidence.requiredAppAuthEnvStatus === "present"
  );
}

function isAppAuthProviderVercelEnvSyncEvidenceMatchedExceptReleaseRun(evidence) {
  return (
    evidence.target === "vercel-env-sync" &&
    evidence.status === "matched" &&
    evidence.valueRedacted === true &&
    evidence.applyPreflight === "proved" &&
    evidence.requiredAppAuthEnvStatus === "present"
  );
}

function readTrustedIssuerContract(evidence) {
  if (!isRecord(evidence.trustedIssuerContract)) {
    return {
      issuerSecretStrength: "missing",
      sessionIssuerSecretSeparation: "missing",
      issuerProofRequired: false,
      issuerProofMaxAgeSeconds: "missing",
      issuerProofBoundsCookieMaxAge: false,
      valueRedacted: false,
    };
  }
  return {
    issuerSecretStrength:
      evidence.trustedIssuerContract.issuerSecretStrength === "sufficient"
        ? "sufficient"
        : "missing",
    sessionIssuerSecretSeparation:
      evidence.trustedIssuerContract.sessionIssuerSecretSeparation === "proved"
        ? "proved"
        : "missing",
    issuerProofRequired: evidence.trustedIssuerContract.issuerProofRequired === true,
    issuerProofMaxAgeSeconds:
      typeof evidence.trustedIssuerContract.issuerProofMaxAgeSeconds === "number"
        ? evidence.trustedIssuerContract.issuerProofMaxAgeSeconds
        : "missing",
    issuerProofBoundsCookieMaxAge:
      evidence.trustedIssuerContract.issuerProofBoundsCookieMaxAge === true,
    valueRedacted: evidence.trustedIssuerContract.valueRedacted === true,
  };
}

function readTrustedCookieSessionRoundTrip(evidence) {
  if (!isRecord(evidence.trustedCookieSessionRoundTrip)) {
    return {
      status: "missing",
      cookiePair: "missing",
      claimsCookie: "missing",
      signatureCookie: "missing",
      signatureVerification: "missing",
      expiryCheck: "missing",
      tamperCheck: "missing",
      sessionIdRedacted: false,
      cookieValuesEmitted: true,
      valuesRedacted: false,
    };
  }
  const proof = evidence.trustedCookieSessionRoundTrip;
  return {
    status: proof.status === "proved" ? "proved" : "missing",
    cookiePair:
      proof.cookiePair === "created-and-verified-in-memory"
        ? "created-and-verified-in-memory"
        : "missing",
    claimsCookie:
      proof.claimsCookie === "signed-session-claims"
        ? "signed-session-claims"
        : "missing",
    signatureCookie:
      proof.signatureCookie === "hmac-sha256-signature"
        ? "hmac-sha256-signature"
        : "missing",
    signatureVerification:
      proof.signatureVerification === "passed" ? "passed" : "missing",
    expiryCheck: proof.expiryCheck === "passed" ? "passed" : "missing",
    tamperCheck: proof.tamperCheck === "passed" ? "passed" : "missing",
    sessionIdRedacted: proof.sessionIdRedacted === true,
    cookieValuesEmitted: proof.cookieValuesEmitted === false ? false : true,
    valuesRedacted: proof.valuesRedacted === true,
  };
}

function isTrustedCookieSessionRoundTripProved(proof) {
  return (
    proof.status === "proved" &&
    proof.cookiePair === "created-and-verified-in-memory" &&
    proof.claimsCookie === "signed-session-claims" &&
    proof.signatureCookie === "hmac-sha256-signature" &&
    proof.signatureVerification === "passed" &&
    proof.expiryCheck === "passed" &&
    proof.tamperCheck === "passed" &&
    proof.sessionIdRedacted === true &&
    proof.cookieValuesEmitted === false &&
    proof.valuesRedacted === true
  );
}

function readTeacherAuthProviderTrustedRouteChainEvidence(evidence) {
  if (!isRecord(evidence.trustedTeacherAuthRouteChainEvidence)) {
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
  const guard = evidence.trustedTeacherAuthRouteChainEvidence;
  return {
    target:
      guard.target === "trusted-teacher-auth-route-chain-contract"
        ? "trusted-teacher-auth-route-chain-contract"
        : "missing",
    status: guard.status === "proved" ? "proved" : "missing",
    valueRedacted: guard.valueRedacted === true,
    authProvider:
      guard.authProvider === "trusted-cookie-issuer"
        ? "trusted-cookie-issuer"
        : "missing",
    routeChain: guard.routeChain === "proved" ? "proved" : "missing",
    issuerProofValidation:
      guard.issuerProofValidation === "proved" ? "proved" : "missing",
    issuerCookieHardening:
      guard.issuerCookieHardening === "proved" ? "proved" : "missing",
    sessionCookiePair:
      guard.sessionCookiePair === "proved" ? "proved" : "missing",
    downstreamAiSession:
      guard.downstreamAiSession === "proved" ? "proved" : "missing",
    workflowAction: guard.workflowAction === "proved" ? "proved" : "missing",
    localTrustedCookieRouteWiring:
      guard.localTrustedCookieRouteWiring === "proved" ? "proved" : "missing",
    redactionSafety: guard.redactionSafety === "proved" ? "proved" : "missing",
  };
}

function isTeacherAuthProviderTrustedRouteChainEvidenceProved(evidence) {
  return (
    evidence.target === "trusted-teacher-auth-route-chain-contract" &&
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
    evidence.redactionSafety === "proved"
  );
}

function readTeacherAuthProviderTrustedRouteSmokeEvidence(evidence) {
  if (!isRecord(evidence.trustedTeacherAuthRouteSmokeEvidence)) {
    return {
      target: "missing",
      status: "missing",
      valueRedacted: true,
      releaseRunIdStatus: "missing",
      deploymentBinding: "missing",
      teacherAuthIssuerRoute: "missing",
      responseHeaders: "missing",
      responseShape: "missing",
    };
  }
  const guard = evidence.trustedTeacherAuthRouteSmokeEvidence;
  return {
    target:
      guard.target === "teacher-auth-issuer-route-smoke"
        ? "teacher-auth-issuer-route-smoke"
        : "missing",
    status: guard.status === "proved" ? "proved" : "missing",
    valueRedacted: guard.valueRedacted === true,
    releaseRunIdStatus:
      typeof guard.releaseRunIdStatus === "string"
        ? guard.releaseRunIdStatus
        : "missing",
    deploymentBinding:
      guard.deploymentBinding === "proved" ? "proved" : "missing",
    teacherAuthIssuerRoute:
      guard.teacherAuthIssuerRoute === "proved" ? "proved" : "missing",
    responseHeaders: guard.responseHeaders === "proved" ? "proved" : "missing",
    responseShape: guard.responseShape === "proved" ? "proved" : "missing",
  };
}

function isTeacherAuthProviderTrustedRouteSmokeEvidenceProved(evidence) {
  return (
    evidence.target === "teacher-auth-issuer-route-smoke" &&
    evidence.status === "proved" &&
    evidence.valueRedacted === true &&
    evidence.releaseRunIdStatus === "matched" &&
    evidence.deploymentBinding === "proved" &&
    evidence.teacherAuthIssuerRoute === "proved" &&
    evidence.responseHeaders === "proved" &&
    evidence.responseShape === "proved"
  );
}

function readOidcProviderContract(evidence) {
  if (!isRecord(evidence.oidcProviderContract)) {
    return {
      audience: "missing",
      teacherIdClaim: "missing",
      bearerTokenNotRequiredForReadiness: false,
      providerValuesRedacted: false,
    };
  }
  return {
    audience: evidence.oidcProviderContract.audience === "present" ? "present" : "missing",
    teacherIdClaim:
      evidence.oidcProviderContract.teacherIdClaim === "present" ? "present" : "missing",
    bearerTokenNotRequiredForReadiness:
      evidence.oidcProviderContract.bearerTokenNotRequiredForReadiness === true,
    providerValuesRedacted: evidence.oidcProviderContract.providerValuesRedacted === true,
  };
}

function readOidcJwksReadiness(evidence) {
  if (!isRecord(evidence.oidcJwksReadiness)) {
    return {
      status: "missing",
      keys: "missing",
      signingKeys: "missing",
    };
  }
  return {
    status: evidence.oidcJwksReadiness.status === "ready" ? "ready" : "blocked",
    keys: evidence.oidcJwksReadiness.keys === "present" ? "present" : "missing",
    signingKeys:
      evidence.oidcJwksReadiness.signingKeys === "present" ? "present" : "missing",
  };
}

function readTeacherAuthProviderReadinessSafety(evidence) {
  const safety = isRecord(evidence) && isRecord(evidence.safety) ? evidence.safety : {};
  return Object.fromEntries(
    requiredTeacherAuthProviderReadinessSafetyFlags.map((flag) => [
      flag,
      safety[flag] === true ? "proved" : "missing",
    ]),
  );
}

function readAppAuthProviderReadinessSafety(evidence) {
  const safety = isRecord(evidence) && isRecord(evidence.safety) ? evidence.safety : {};
  return {
    ...Object.fromEntries(
      requiredAppAuthProviderReadinessSafetyFlags.map((flag) => [
        flag,
        safety[flag] === true ? "proved" : "missing",
      ]),
    ),
    providerNetworkCallPerformed:
      safety.providerNetworkCallPerformed === false
        ? "proved-not-performed"
        : "missing",
  };
}

function evaluateExternalStorageProductionLaunchContract(evidence) {
  const id = "external-storage-production-launch-contract";
  if (!isRecord(evidence)) {
    return blockedRequirement(
      id,
      "external-storage-production-launch-contract-missing",
      "waiting-for-external-storage-production-launch-contract",
    );
  }
  if (evidence.target !== "external-storage-service-production-launcher") {
    return blockedRequirement(
      id,
      "external-storage-production-launch-contract-target-mismatch",
      readEvidenceStatus(evidence),
      {
        evidenceTarget:
          typeof evidence.target === "string" && evidence.target.length > 0
            ? "unexpected"
            : "missing",
      },
    );
  }

  const runtime = isRecord(evidence.runtime) ? evidence.runtime : {};
  const launch = isRecord(evidence.launch) ? evidence.launch : {};
  const artifact = readExternalStorageProductionLaunchArtifact(evidence);
  const requiredEnv = readExternalStorageProductionLaunchRequiredEnv(evidence);
  const safety = readExternalStorageProductionLaunchSafety(evidence);
  const details = {
    serviceMode: evidence.serviceMode === "production" ? "production" : "missing",
    runtimeNode: runtime.node === "required" ? "required" : "missing",
    runtimeLongRunningProcess: runtime.longRunningProcess === true,
    healthEndpoint: runtime.healthEndpoint === "/healthz" ? "/healthz" : "missing",
    serviceTarget:
      runtime.serviceTarget === "uais-external-storage-production-service"
        ? "uais-external-storage-production-service"
        : "missing",
    portSource: launch.portSource === "PORT" ? "PORT" : "missing",
    dataDirSource:
      launch.dataDirSource === "UAIS_EXTERNAL_STORAGE_DATA_DIR"
        ? "UAIS_EXTERNAL_STORAGE_DATA_DIR"
        : "missing",
    persistentVolumeRequired: launch.persistentVolumeRequired === true,
    dataDirPersistence:
      launch.dataDirPersistence === "persistent-volume" ? "persistent-volume" : "missing",
    containerArtifact: artifact,
    requiredEnv,
    blockedReasons: readExternalStorageProductionLaunchBlockedReasons(evidence),
    safety,
  };

  if (evidence.status !== "ready") {
    return blockedRequirement(
      id,
      "external-storage-production-launch-contract-not-ready",
      readEvidenceStatus(evidence),
      details,
    );
  }
  if (
    details.serviceMode !== "production" ||
    details.runtimeNode !== "required" ||
    details.runtimeLongRunningProcess !== true ||
    details.healthEndpoint !== "/healthz" ||
    details.serviceTarget !== "uais-external-storage-production-service"
  ) {
    return blockedRequirement(
      id,
      "external-storage-production-launch-runtime-not-proven",
      readEvidenceStatus(evidence),
      details,
    );
  }
  if (
    details.portSource !== "PORT" ||
    details.dataDirSource !== "UAIS_EXTERNAL_STORAGE_DATA_DIR" ||
    details.persistentVolumeRequired !== true ||
    details.dataDirPersistence !== "persistent-volume" ||
    details.requiredEnv.accessToken !== "present-sufficient" ||
    details.requiredEnv.dataDir !== "present-persistent-volume" ||
    details.requiredEnv.databaseAdapterProviderClass !== "present-managed-database" ||
    details.requiredEnv.databaseAdapterMigrationStatus !== "present-up-to-date" ||
    details.requiredEnv.databaseAdapterBackupPolicy !== "present-point-in-time-restore" ||
    details.requiredEnv.databaseAdapterConcurrencyControl !== "present-transactional"
  ) {
    return blockedRequirement(
      id,
      "external-storage-production-launch-env-contract-not-proven",
      readEvidenceStatus(evidence),
      details,
    );
  }
  if (
    details.containerArtifact.dockerfile !== "Dockerfile.external-storage" ||
    details.containerArtifact.dockerignore !== ".dockerignore" ||
    details.containerArtifact.persistentVolumePath !== "/data/uais-external-storage" ||
    details.containerArtifact.imageSecretsPolicy !== "env-only-at-runtime"
  ) {
    return blockedRequirement(
      id,
      "external-storage-production-launch-container-artifact-not-proven",
      readEvidenceStatus(evidence),
      details,
    );
  }
  if (!Object.values(details.safety).every((status) => status === "proved")) {
    return blockedRequirement(
      id,
      "external-storage-production-launch-redaction-not-proven",
      readEvidenceStatus(evidence),
      details,
    );
  }

  return satisfiedRequirement(id, readEvidenceStatus(evidence), details);
}

function readExternalStorageProductionLaunchArtifact(evidence) {
  const artifact = isRecord(evidence.containerArtifact) ? evidence.containerArtifact : {};
  return {
    dockerfile:
      artifact.dockerfile === "Dockerfile.external-storage"
        ? "Dockerfile.external-storage"
        : "missing",
    dockerignore: artifact.dockerignore === ".dockerignore" ? ".dockerignore" : "missing",
    persistentVolumePath:
      artifact.persistentVolumePath === "/data/uais-external-storage"
        ? "/data/uais-external-storage"
        : "missing",
    imageSecretsPolicy:
      artifact.imageSecretsPolicy === "env-only-at-runtime"
        ? "env-only-at-runtime"
        : "missing",
  };
}

function readExternalStorageProductionLaunchRequiredEnv(evidence) {
  const entries = Array.isArray(evidence.requiredEnv) ? evidence.requiredEnv : [];
  const accessToken = entries.find(
    (entry) => isRecord(entry) && entry.name === "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
  );
  const dataDir = entries.find(
    (entry) => isRecord(entry) && entry.name === "UAIS_EXTERNAL_STORAGE_DATA_DIR",
  );
  const databaseAdapterProviderClass = readExpectedRequiredEnvValue(
    entries,
    "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS",
    "managed-database",
  );
  const databaseAdapterMigrationStatus = readExpectedRequiredEnvValue(
    entries,
    "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS",
    "up-to-date",
  );
  const databaseAdapterBackupPolicy = readExpectedRequiredEnvValue(
    entries,
    "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY",
    "point-in-time-restore",
  );
  const databaseAdapterConcurrencyControl = readExpectedRequiredEnvValue(
    entries,
    "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL",
    "transactional",
  );
  const tokenStatus =
    isRecord(accessToken) && accessToken.status === "present" ? "present" : "missing";
  const tokenStrength =
    isRecord(accessToken) && accessToken.strength === "sufficient"
      ? "sufficient"
      : isRecord(accessToken) && accessToken.strength === "insufficient"
        ? "insufficient"
        : "missing";
  return {
    accessToken:
      tokenStatus === "present" ? `${tokenStatus}-${tokenStrength}` : tokenStatus,
    dataDir:
      isRecord(dataDir) && dataDir.status === "present"
        ? dataDir.persistence === "persistent-volume"
          ? "present-persistent-volume"
          : "present"
        : "missing",
    databaseAdapterProviderClass,
    databaseAdapterMigrationStatus,
    databaseAdapterBackupPolicy,
    databaseAdapterConcurrencyControl,
  };
}

function readExpectedRequiredEnvValue(entries, name, expected) {
  const entry = entries.find((value) => isRecord(value) && value.name === name);
  if (!isRecord(entry) || entry.status !== "present") {
    return "missing";
  }
  return entry.expected === expected ? `present-${expected}` : "present-invalid";
}

function readExternalStorageProductionLaunchSafety(evidence) {
  const safety = isRecord(evidence.safety) ? evidence.safety : {};
  return {
    accessTokenOmitted: safety.accessTokenOmitted === true ? "proved" : "missing",
    dataDirOmitted: safety.dataDirOmitted === true ? "proved" : "missing",
    localPrivatePathsOmitted:
      safety.localPrivatePathsOmitted === true ? "proved" : "missing",
    startupOutputRedacted:
      safety.startupOutputRedacted === true ? "proved" : "missing",
    productionServiceModeForced:
      safety.productionServiceModeForced === true ? "proved" : "missing",
  };
}

function readExternalStorageProductionLaunchBlockedReasons(evidence) {
  const acceptedReasons = new Set([
    "missing-UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
    "external-storage-access-token-weak",
    "missing-UAIS_EXTERNAL_STORAGE_DATA_DIR",
    "external-storage-data-dir-persistent-volume-not-proven",
    "external-storage-port-invalid",
    "missing-UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS",
    "missing-UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS",
    "missing-UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY",
    "missing-UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL",
    "external-storage-uais-external-storage-database-adapter-provider-class-not-proven",
    "external-storage-uais-external-storage-database-adapter-migration-status-not-proven",
    "external-storage-uais-external-storage-database-adapter-backup-policy-not-proven",
    "external-storage-uais-external-storage-database-adapter-concurrency-control-not-proven",
  ]);
  return Array.isArray(evidence.blockedReasons)
    ? evidence.blockedReasons.filter((reason) => acceptedReasons.has(reason))
    : [];
}

function evaluateExternalStorageContainerBuildReadiness(evidence) {
  const id = "external-storage-container-build-readiness";
  if (!isRecord(evidence)) {
    return blockedRequirement(
      id,
      "external-storage-container-build-readiness-missing",
      "waiting-for-external-storage-container-build-readiness",
    );
  }
  if (evidence.target !== "external-storage-container-build-readiness") {
    return blockedRequirement(
      id,
      "external-storage-container-build-readiness-target-mismatch",
      readEvidenceStatus(evidence),
      {
        evidenceTarget:
          typeof evidence.target === "string" && evidence.target.length > 0
            ? "unexpected"
            : "missing",
      },
    );
  }

  const dockerfile = isRecord(evidence.dockerfile) ? evidence.dockerfile : {};
  const dockerignore = isRecord(evidence.dockerignore) ? evidence.dockerignore : {};
  const docker = isRecord(evidence.docker) ? evidence.docker : {};
  const build = isRecord(evidence.build) ? evidence.build : {};
  const mode =
    evidence.mode === "build" || evidence.mode === "dry-run" ? evidence.mode : "missing";
  const dockerDaemon =
    docker.daemon === "available" ||
    docker.daemon === "unavailable" ||
    docker.daemon === "not-checked"
      ? docker.daemon
      : "missing";
  const buildStatus =
    build.status === "passed" || build.status === "not-run" || build.status === "failed"
      ? build.status
      : "missing";
  const safety = readExternalStorageContainerBuildReadinessSafety(evidence);
  const details = {
    mode,
    dockerfileContract: dockerfile.contract === "passed" ? "passed" : "missing",
    dockerignoreSecretExclusion:
      dockerignore.secretExclusion === "passed" ? "passed" : "missing",
    dockerignoreGeneratedOutputExclusion:
      dockerignore.generatedOutputExclusion === "passed" ? "passed" : "missing",
    dockerClient: docker.client === "present" ? "present" : "missing",
    dockerDaemon,
    buildStatus,
    buildInvoked: build.invoked === true,
    blockedReasons: readExternalStorageContainerBuildReadinessBlockedReasons(evidence),
    safety,
  };

  if (evidence.status !== "ready") {
    return blockedRequirement(
      id,
      "external-storage-container-build-readiness-not-ready",
      readEvidenceStatus(evidence),
      details,
    );
  }
  if (
    details.dockerfileContract !== "passed" ||
    details.dockerignoreSecretExclusion !== "passed" ||
    details.dockerignoreGeneratedOutputExclusion !== "passed"
  ) {
    return blockedRequirement(
      id,
      "external-storage-container-build-contract-not-proven",
      readEvidenceStatus(evidence),
      details,
    );
  }
  if (details.dockerClient !== "present" || details.dockerDaemon !== "available") {
    return blockedRequirement(
      id,
      "external-storage-container-build-runtime-not-proven",
      readEvidenceStatus(evidence),
      details,
    );
  }
  if (
    details.mode !== "build" ||
    details.buildStatus !== "passed" ||
    details.buildInvoked !== true ||
    details.safety.buildRunInApprovedMode !== "proved"
  ) {
    return blockedRequirement(
      id,
      "external-storage-container-build-not-proven",
      readEvidenceStatus(evidence),
      details,
    );
  }
  if (!Object.values(details.safety).every((status) => status === "proved")) {
    return blockedRequirement(
      id,
      "external-storage-container-build-redaction-not-proven",
      readEvidenceStatus(evidence),
      details,
    );
  }

  return satisfiedRequirement(id, readEvidenceStatus(evidence), details);
}

function readExternalStorageContainerBuildReadinessSafety(evidence) {
  const safety = isRecord(evidence.safety) ? evidence.safety : {};
  return {
    imageTagOmitted: safety.imageTagOmitted === true ? "proved" : "missing",
    dockerOutputOmitted: safety.dockerOutputOmitted === true ? "proved" : "missing",
    localPrivatePathsOmitted:
      safety.localPrivatePathsOmitted === true ? "proved" : "missing",
    secretsExcludedFromContext:
      safety.secretsExcludedFromContext === true ? "proved" : "missing",
    buildRunInApprovedMode:
      safety.buildRunInApprovedMode === true ? "proved" : "missing",
  };
}

function readExternalStorageContainerBuildReadinessBlockedReasons(evidence) {
  const acceptedReasons = new Set([
    "docker-client-missing",
    "docker-daemon-unavailable",
    "dockerfile-contract-failed",
    "dockerfile-missing",
    "dockerignore-generated-output-exclusion-missing",
    "dockerignore-missing",
    "dockerignore-secret-exclusion-missing",
    "build-failed",
    "build-not-approved",
    "build-not-run",
    "redaction-not-proven",
  ]);
  return Array.isArray(evidence.blockedReasons)
    ? evidence.blockedReasons.filter((reason) => acceptedReasons.has(reason))
    : [];
}

function evaluateExternalStorageServiceReadiness(evidence) {
  const id = "external-storage-service-readiness";
  if (!isRecord(evidence)) {
    return blockedRequirement(id, "external-storage-service-readiness-missing", "missing");
  }
  if (evidence.target !== "external-storage-service-readiness") {
    return blockedRequirement(
      id,
      "external-storage-service-readiness-target-mismatch",
      readEvidenceStatus(evidence),
      {
        evidenceTarget: typeof evidence.target === "string" ? evidence.target : "missing",
      },
    );
  }

  const evidenceEnvironment =
    typeof evidence.environment === "string" ? evidence.environment : "missing";
  const storageEndpoint = readStorageEndpoint(evidence.storageEndpoint);
  const storageServiceFingerprint = readStorageServiceFingerprint(evidence) ? "present" : "missing";
  const health = readExternalStorageServiceHealth(evidence);
  const vercelEnvSyncEvidence = readExternalStorageServiceVercelEnvSyncEvidence(evidence);
  const productionLaunchContractEvidence =
    readExternalStorageServiceProductionLaunchContractEvidence(evidence);
  const persistenceEvidence = readExternalStorageServicePersistenceEvidence(evidence);
  const redactionSafety = readExternalStorageServiceReadinessSafety(evidence);
  const redactionSafetyProved = Object.values(redactionSafety).every((status) => status === "proved");
  const ordinaryCourseSchemasReady = areExternalStorageServiceOrdinaryCourseSchemasReady(health);
  const baseDetails = {
    evidenceEnvironment,
    storageEndpoint,
    storageServiceFingerprint,
    health,
    vercelEnvSyncEvidence,
    productionLaunchContractEvidence,
    persistenceEvidence,
    redactionSafety,
  };

  if (evidence.mode === "live" && evidence.status === "ready" && evidenceEnvironment !== "production") {
    return blockedRequirement(
      id,
      "external-storage-service-readiness-not-production",
      readEvidenceStatus(evidence),
      baseDetails,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "ready" &&
    evidenceEnvironment === "production" &&
    storageEndpoint.endpointClass !== "remote-https"
  ) {
    return blockedRequirement(
      id,
      "external-storage-service-endpoint-not-remote-https",
      readEvidenceStatus(evidence),
      baseDetails,
    );
  }
    if (
      evidence.mode === "live" &&
      evidence.status === "ready" &&
      evidenceEnvironment === "production" &&
      storageEndpoint.endpointClass === "remote-https" &&
    health.productionServiceIdentity !== "proved"
  ) {
    return blockedRequirement(
      id,
      "external-storage-service-production-identity-not-proven",
      readEvidenceStatus(evidence),
      baseDetails,
      );
    }
    if (
      evidence.mode === "live" &&
      evidence.status === "ready" &&
      evidenceEnvironment === "production" &&
    storageEndpoint.endpointClass === "remote-https" &&
    health.productionServiceIdentity === "proved" &&
    health.apiContractVersion !== "matched"
  ) {
    return blockedRequirement(
      id,
      "external-storage-service-api-contract-not-proven",
      readEvidenceStatus(evidence),
      baseDetails,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "ready" &&
    evidenceEnvironment === "production" &&
    storageEndpoint.endpointClass === "remote-https" &&
    health.productionServiceIdentity === "proved" &&
    health.apiContractVersion === "matched" &&
    health.cacheControl !== "no-store"
  ) {
    return blockedRequirement(
      id,
      "external-storage-service-cache-control-not-proven",
      readEvidenceStatus(evidence),
      baseDetails,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "ready" &&
    evidenceEnvironment === "production" &&
    storageEndpoint.endpointClass === "remote-https" &&
    health.productionServiceIdentity === "proved" &&
    health.apiContractVersion === "matched" &&
    health.durableBackingStore !== "ready"
  ) {
    return blockedRequirement(
      id,
      "external-storage-service-durable-backing-store-not-ready",
      readEvidenceStatus(evidence),
      baseDetails,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "ready" &&
    evidenceEnvironment === "production" &&
    storageEndpoint.endpointClass === "remote-https" &&
    health.productionServiceIdentity === "proved" &&
    health.apiContractVersion === "matched" &&
    health.durableBackingStore === "ready" &&
    !isExternalStorageServiceTeachingOperationsSchemaHealthReady(
      health.teachingOperationsStorageSchema,
    )
  ) {
    return blockedRequirement(
      id,
      "external-storage-service-teaching-operations-schema-not-proven",
      readEvidenceStatus(evidence),
      baseDetails,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "ready" &&
    evidenceEnvironment === "production" &&
    storageEndpoint.endpointClass === "remote-https" &&
    health.productionServiceIdentity === "proved" &&
    health.apiContractVersion === "matched" &&
    health.durableBackingStore === "ready" &&
    isExternalStorageServiceTeachingOperationsSchemaHealthReady(
      health.teachingOperationsStorageSchema,
    ) &&
    !isExternalStorageServiceProductionDatabaseAdapterHealthReady(
      health.teachingOperationsStorageSchema.productionDatabaseAdapter,
    )
  ) {
    return blockedRequirement(
      id,
      "external-storage-service-teaching-operations-database-adapter-not-proven",
      readEvidenceStatus(evidence),
      baseDetails,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "ready" &&
    evidenceEnvironment === "production" &&
    storageEndpoint.endpointClass === "remote-https" &&
    health.productionServiceIdentity === "proved" &&
    health.apiContractVersion === "matched" &&
    health.durableBackingStore === "ready" &&
    isExternalStorageServiceTeachingOperationsSchemaHealthReady(
      health.teachingOperationsStorageSchema,
    ) &&
    !isExternalStorageServiceSnapshotSchemaHealthReady(
      health.teachingCourseManagementStorageSchema,
    )
  ) {
    return blockedRequirement(
      id,
      "external-storage-service-teaching-course-management-schema-not-proven",
      readEvidenceStatus(evidence),
      baseDetails,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "ready" &&
    evidenceEnvironment === "production" &&
    storageEndpoint.endpointClass === "remote-https" &&
    health.productionServiceIdentity === "proved" &&
    health.apiContractVersion === "matched" &&
    health.durableBackingStore === "ready" &&
    isExternalStorageServiceTeachingOperationsSchemaHealthReady(
      health.teachingOperationsStorageSchema,
    ) &&
    isExternalStorageServiceSnapshotSchemaHealthReady(
      health.teachingCourseManagementStorageSchema,
    ) &&
    !isExternalStorageServiceSnapshotSchemaHealthReady(
      health.teachingCourseAssetsStorageSchema,
    )
  ) {
    return blockedRequirement(
      id,
        "external-storage-service-teaching-course-assets-schema-not-proven",
        readEvidenceStatus(evidence),
        baseDetails,
      );
    }
    if (
      evidence.mode === "live" &&
      evidence.status === "ready" &&
      evidenceEnvironment === "production" &&
      storageEndpoint.endpointClass === "remote-https" &&
      health.productionServiceIdentity === "proved" &&
      health.apiContractVersion === "matched" &&
      health.durableBackingStore === "ready" &&
      isExternalStorageServiceTeachingOperationsSchemaHealthReady(
        health.teachingOperationsStorageSchema,
      ) &&
      isExternalStorageServiceSnapshotSchemaHealthReady(
        health.teachingCourseManagementStorageSchema,
      ) &&
      isExternalStorageServiceSnapshotSchemaHealthReady(
        health.teachingCourseAssetsStorageSchema,
      ) &&
      !isExternalStorageServiceProductionDatabaseAdapterHealthReady(
        health.teachingCourseManagementStorageSchema.productionDatabaseAdapter,
      )
    ) {
      return blockedRequirement(
        id,
        "external-storage-service-teaching-course-management-database-adapter-not-proven",
        readEvidenceStatus(evidence),
        baseDetails,
      );
    }
    if (
      evidence.mode === "live" &&
      evidence.status === "ready" &&
      evidenceEnvironment === "production" &&
      storageEndpoint.endpointClass === "remote-https" &&
      health.productionServiceIdentity === "proved" &&
      health.apiContractVersion === "matched" &&
      health.durableBackingStore === "ready" &&
      isExternalStorageServiceTeachingOperationsSchemaHealthReady(
        health.teachingOperationsStorageSchema,
      ) &&
      isExternalStorageServiceSnapshotSchemaHealthReady(
        health.teachingCourseManagementStorageSchema,
      ) &&
      isExternalStorageServiceSnapshotSchemaHealthReady(
        health.teachingCourseAssetsStorageSchema,
      ) &&
      isExternalStorageServiceProductionDatabaseAdapterHealthReady(
        health.teachingCourseManagementStorageSchema.productionDatabaseAdapter,
      ) &&
      !isExternalStorageServiceProductionDatabaseAdapterHealthReady(
        health.teachingCourseAssetsStorageSchema.productionDatabaseAdapter,
      )
    ) {
      return blockedRequirement(
        id,
        "external-storage-service-teaching-course-assets-database-adapter-not-proven",
        readEvidenceStatus(evidence),
        baseDetails,
      );
    }
    if (
      evidence.mode === "live" &&
    evidence.status === "ready" &&
    evidenceEnvironment === "production" &&
    storageEndpoint.endpointClass === "remote-https" &&
    health.productionServiceIdentity === "proved" &&
    health.apiContractVersion === "matched" &&
    health.durableBackingStore === "ready" &&
    isExternalStorageServiceTeachingOperationsSchemaHealthReady(
      health.teachingOperationsStorageSchema,
    ) &&
    ordinaryCourseSchemasReady &&
    health.redaction !== "present"
  ) {
    return blockedRequirement(
      id,
      "external-storage-service-redaction-not-proven",
      readEvidenceStatus(evidence),
      baseDetails,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "ready" &&
    evidenceEnvironment === "production" &&
    storageEndpoint.endpointClass === "remote-https" &&
    health.productionServiceIdentity === "proved" &&
    health.apiContractVersion === "matched" &&
    health.durableBackingStore === "ready" &&
    isExternalStorageServiceTeachingOperationsSchemaHealthReady(
      health.teachingOperationsStorageSchema,
    ) &&
    ordinaryCourseSchemasReady &&
    health.redaction === "present" &&
    storageServiceFingerprint !== "present"
  ) {
    return blockedRequirement(
      id,
      "external-storage-service-readiness-fingerprint-not-proven",
      readEvidenceStatus(evidence),
      baseDetails,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "ready" &&
    evidenceEnvironment === "production" &&
    storageEndpoint.endpointClass === "remote-https" &&
    health.productionServiceIdentity === "proved" &&
    health.apiContractVersion === "matched" &&
    health.durableBackingStore === "ready" &&
    isExternalStorageServiceTeachingOperationsSchemaHealthReady(
      health.teachingOperationsStorageSchema,
    ) &&
    ordinaryCourseSchemasReady &&
    health.redaction === "present" &&
    storageServiceFingerprint === "present" &&
    isExternalStorageServiceVercelEnvSyncEvidenceMatchedExceptReleaseRun(
      vercelEnvSyncEvidence,
    ) &&
    vercelEnvSyncEvidence.releaseRunIdStatus !== "matched"
  ) {
    return blockedRequirement(
      id,
      "external-storage-service-vercel-env-sync-release-run-not-proven",
      readEvidenceStatus(evidence),
      baseDetails,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "ready" &&
    evidenceEnvironment === "production" &&
    storageEndpoint.endpointClass === "remote-https" &&
    health.productionServiceIdentity === "proved" &&
    health.apiContractVersion === "matched" &&
    health.durableBackingStore === "ready" &&
    isExternalStorageServiceTeachingOperationsSchemaHealthReady(
      health.teachingOperationsStorageSchema,
    ) &&
    ordinaryCourseSchemasReady &&
    health.redaction === "present" &&
    storageServiceFingerprint === "present" &&
    !isExternalStorageServiceVercelEnvSyncEvidenceProved(vercelEnvSyncEvidence)
  ) {
    return blockedRequirement(
      id,
      "external-storage-service-vercel-env-sync-not-proven",
      readEvidenceStatus(evidence),
      baseDetails,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "ready" &&
    evidenceEnvironment === "production" &&
    storageEndpoint.endpointClass === "remote-https" &&
    health.productionServiceIdentity === "proved" &&
    health.apiContractVersion === "matched" &&
    health.durableBackingStore === "ready" &&
    isExternalStorageServiceTeachingOperationsSchemaHealthReady(
      health.teachingOperationsStorageSchema,
    ) &&
    ordinaryCourseSchemasReady &&
    health.redaction === "present" &&
    storageServiceFingerprint === "present" &&
    isExternalStorageServiceVercelEnvSyncEvidenceProved(vercelEnvSyncEvidence) &&
    productionLaunchContractEvidence.status !== "ready"
  ) {
    return blockedRequirement(
      id,
      "external-storage-service-production-launch-contract-not-proven",
      readEvidenceStatus(evidence),
      baseDetails,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "ready" &&
    evidenceEnvironment === "production" &&
    storageEndpoint.endpointClass === "remote-https" &&
    health.productionServiceIdentity === "proved" &&
    health.apiContractVersion === "matched" &&
    health.durableBackingStore === "ready" &&
    isExternalStorageServiceTeachingOperationsSchemaHealthReady(
      health.teachingOperationsStorageSchema,
    ) &&
    ordinaryCourseSchemasReady &&
    health.redaction === "present" &&
    storageServiceFingerprint === "present" &&
    isExternalStorageServiceVercelEnvSyncEvidenceProved(vercelEnvSyncEvidence) &&
    productionLaunchContractEvidence.status === "ready" &&
    !isExternalStorageServicePersistenceEvidenceProved(persistenceEvidence)
  ) {
    return blockedRequirement(
      id,
      "external-storage-service-persistence-not-proven",
      readEvidenceStatus(evidence),
      baseDetails,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "ready" &&
    evidenceEnvironment === "production" &&
    storageEndpoint.endpointClass === "remote-https" &&
    health.productionServiceIdentity === "proved" &&
    health.apiContractVersion === "matched" &&
    health.durableBackingStore === "ready" &&
    isExternalStorageServiceTeachingOperationsSchemaHealthReady(
      health.teachingOperationsStorageSchema,
    ) &&
    ordinaryCourseSchemasReady &&
    health.redaction === "present" &&
    storageServiceFingerprint === "present" &&
    isExternalStorageServiceVercelEnvSyncEvidenceProved(vercelEnvSyncEvidence) &&
    productionLaunchContractEvidence.status === "ready" &&
    isExternalStorageServicePersistenceEvidenceProved(persistenceEvidence) &&
    !redactionSafetyProved
  ) {
    return blockedRequirement(
      id,
      "external-storage-service-readiness-redaction-not-proven",
      readEvidenceStatus(evidence),
      baseDetails,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "ready" &&
    evidenceEnvironment === "production" &&
    storageEndpoint.endpointClass === "remote-https" &&
    health.productionServiceIdentity === "proved" &&
    health.apiContractVersion === "matched" &&
    health.durableBackingStore === "ready" &&
    isExternalStorageServiceTeachingOperationsSchemaHealthReady(
      health.teachingOperationsStorageSchema,
    ) &&
    ordinaryCourseSchemasReady &&
    health.redaction === "present" &&
    storageServiceFingerprint === "present" &&
    isExternalStorageServiceVercelEnvSyncEvidenceProved(vercelEnvSyncEvidence) &&
    productionLaunchContractEvidence.status === "ready" &&
    isExternalStorageServicePersistenceEvidenceProved(persistenceEvidence) &&
    redactionSafetyProved
  ) {
    return satisfiedRequirement(id, readEvidenceStatus(evidence), baseDetails);
  }

  return blockedRequirement(
    id,
    "external-storage-service-readiness-not-live-ready",
    readEvidenceStatus(evidence),
    baseDetails,
  );
}

function readExternalStorageServiceProductionLaunchContractEvidence(evidence) {
  if (!isRecord(evidence.productionLaunchContractEvidence)) {
    return {
      target: "missing",
      status: "missing",
      valueRedacted: true,
      serviceMode: "missing",
      runtime: "missing",
      envContract: "missing",
      containerArtifact: "missing",
      redactionSafety: "missing",
    };
  }
  const guard = evidence.productionLaunchContractEvidence;
  return {
    target:
      guard.target === "external-storage-service-production-launcher"
        ? "external-storage-service-production-launcher"
        : "missing",
    status: guard.status === "ready" ? "ready" : "missing",
    valueRedacted: guard.valueRedacted === true,
    serviceMode: guard.serviceMode === "production" ? "production" : "missing",
    runtime: guard.runtime === "proved" ? "proved" : "missing",
    envContract: guard.envContract === "proved" ? "proved" : "missing",
    containerArtifact: guard.containerArtifact === "proved" ? "proved" : "missing",
    redactionSafety: guard.redactionSafety === "proved" ? "proved" : "missing",
  };
}

function readExternalStorageServicePersistenceEvidence(evidence) {
  if (!isRecord(evidence.persistenceEvidence)) {
    return {
      target: "missing",
      status: "missing",
      valueRedacted: true,
      releaseRunIdStatus: "missing",
    };
  }
  const guard = evidence.persistenceEvidence;
  return {
    target:
      guard.target === "external-storage-persistence"
        ? "external-storage-persistence"
        : "missing",
    status: guard.status === "matched" ? "matched" : "missing",
    valueRedacted: guard.valueRedacted === true,
    releaseRunIdStatus:
      typeof guard.releaseRunIdStatus === "string"
        ? guard.releaseRunIdStatus
        : "missing",
  };
}

function isExternalStorageServicePersistenceEvidenceProved(evidence) {
  return (
    evidence.target === "external-storage-persistence" &&
    evidence.status === "matched" &&
    evidence.valueRedacted === true &&
    evidence.releaseRunIdStatus === "matched"
  );
}

function readExternalStorageServiceVercelEnvSyncEvidence(evidence) {
  if (!isRecord(evidence.vercelEnvSyncEvidence)) {
    return {
      target: "missing",
      status: "missing",
      valueRedacted: true,
      applyPreflight: "missing",
      releaseRunIdStatus: "missing",
    };
  }
  const guard = evidence.vercelEnvSyncEvidence;
  return {
    target: guard.target === "vercel-env-sync" ? "vercel-env-sync" : "missing",
    status: typeof guard.status === "string" ? guard.status : "missing",
    valueRedacted: guard.valueRedacted === true,
    applyPreflight: guard.applyPreflight === "proved" ? "proved" : "missing",
    releaseRunIdStatus:
      typeof guard.releaseRunIdStatus === "string"
        ? guard.releaseRunIdStatus
        : "missing",
  };
}

function isExternalStorageServiceVercelEnvSyncEvidenceProved(evidence) {
  return (
    evidence.target === "vercel-env-sync" &&
    evidence.status === "matched" &&
    evidence.valueRedacted === true &&
    evidence.applyPreflight === "proved" &&
    evidence.releaseRunIdStatus === "matched"
  );
}

function isExternalStorageServiceVercelEnvSyncEvidenceMatchedExceptReleaseRun(evidence) {
  return (
    evidence.target === "vercel-env-sync" &&
    evidence.status === "matched" &&
    evidence.valueRedacted === true &&
    evidence.applyPreflight === "proved"
  );
}

function readExternalStorageServiceHealth(evidence) {
  if (!isRecord(evidence.health)) {
    return {
      httpStatus: "missing",
      status: "missing",
      target: "missing",
      productionServiceIdentity: "missing",
      apiContractVersion: "missing",
      cacheControl: "missing",
      durableBackingStore: "missing",
      teachingOperationsStorageSchema: readExternalStorageServiceTeachingOperationsSchemaHealth(undefined),
      teachingCourseManagementStorageSchema:
        readExternalStorageServiceTeachingCourseManagementSchemaHealth(undefined),
      teachingCourseAssetsStorageSchema:
        readExternalStorageServiceTeachingCourseAssetsSchemaHealth(undefined),
      redaction: "missing",
    };
  }
  return {
    httpStatus:
      typeof evidence.health.httpStatus === "number" ? evidence.health.httpStatus : "missing",
    status: evidence.health.status === "ok" ? "ok" : "missing",
    target: typeof evidence.health.target === "string" ? evidence.health.target : "missing",
    productionServiceIdentity:
      evidence.health.productionServiceIdentity === "proved" ? "proved" : "missing",
    apiContractVersion:
      evidence.health.apiContractVersion === "matched" ? "matched" : "missing",
    cacheControl:
      evidence.health.cacheControl === "no-store" ? "no-store" : "missing",
    durableBackingStore:
      evidence.health.durableBackingStore === "ready" ? "ready" : "not-ready",
    teachingOperationsStorageSchema: readExternalStorageServiceTeachingOperationsSchemaHealth(
      evidence.health.teachingOperationsStorageSchema,
    ),
    teachingCourseManagementStorageSchema:
      readExternalStorageServiceTeachingCourseManagementSchemaHealth(
        evidence.health.teachingCourseManagementStorageSchema,
      ),
    teachingCourseAssetsStorageSchema:
      readExternalStorageServiceTeachingCourseAssetsSchemaHealth(
        evidence.health.teachingCourseAssetsStorageSchema,
      ),
    redaction: evidence.health.redaction === "present" ? "present" : "missing",
  };
}

function isExternalStorageServiceTeachingOperationsSchemaHealthReady(schema) {
  return (
    isRecord(schema) &&
    schema.status === "ready" &&
    schema.schemaVersion === "matched" &&
    schema.migrationStatus === "up-to-date" &&
    schema.operationLedger === "jsonl-append-only" &&
    schema.auditLedger === "jsonl-append-only" &&
    schema.rollbackLedger === "jsonl-append-only" &&
    schema.backupStore === "json-atomic-snapshot" &&
    schema.restoreDrillLog === "jsonl-append-only" &&
    schema.concurrencyControl === "atomic-append-and-rename" &&
    schema.valueRedacted === true
  );
}

function readExternalStorageServiceTeachingOperationsSchemaHealth(value) {
  return {
    status: value?.status === "ready" ? "ready" : "missing",
    schemaVersion:
      value?.schemaVersion === "uais-teaching-operations-v1" || value?.schemaVersion === "matched"
        ? "matched"
        : "missing",
    migrationStatus:
      value?.migrationStatus === "up-to-date" ? "up-to-date" : "missing",
    operationLedger:
      value?.operationLedger === "jsonl-append-only" ? "jsonl-append-only" : "missing",
    auditLedger:
      value?.auditLedger === "jsonl-append-only" ? "jsonl-append-only" : "missing",
    rollbackLedger:
      value?.rollbackLedger === "jsonl-append-only" ? "jsonl-append-only" : "missing",
    backupStore:
      value?.backupStore === "json-atomic-snapshot" ? "json-atomic-snapshot" : "missing",
    restoreDrillLog:
      value?.restoreDrillLog === "jsonl-append-only" ? "jsonl-append-only" : "missing",
    concurrencyControl:
      value?.concurrencyControl === "atomic-append-and-rename"
        ? "atomic-append-and-rename"
        : "missing",
    productionDatabaseAdapter:
      readExternalStorageServiceProductionDatabaseAdapterHealth(
        value?.productionDatabaseAdapter,
      ),
    valueRedacted: value?.valueRedacted === true,
  };
}

function isExternalStorageServiceProductionDatabaseAdapterHealthReady(adapter) {
  return (
    isRecord(adapter) &&
    adapter.status === "ready" &&
    adapter.providerClass === "managed-database" &&
    adapter.migrationStatus === "up-to-date" &&
    adapter.backupPolicy === "point-in-time-restore" &&
    adapter.concurrencyControl === "transactional" &&
    adapter.valueRedacted === true
  );
}

function readExternalStorageServiceProductionDatabaseAdapterHealth(value) {
  return {
    status: value?.status === "ready" ? "ready" : "missing",
    providerClass:
      value?.providerClass === "managed-database" ? "managed-database" : "missing",
    migrationStatus:
      value?.migrationStatus === "up-to-date" ? "up-to-date" : "missing",
    backupPolicy:
      value?.backupPolicy === "point-in-time-restore"
        ? "point-in-time-restore"
        : "missing",
    concurrencyControl:
      value?.concurrencyControl === "transactional" ? "transactional" : "missing",
    valueRedacted: value?.valueRedacted === true,
  };
}

function areExternalStorageServiceOrdinaryCourseSchemasReady(health) {
  return (
    isExternalStorageServiceSnapshotSchemaHealthReady(
      health.teachingCourseManagementStorageSchema,
    ) &&
    isExternalStorageServiceSnapshotSchemaHealthReady(
      health.teachingCourseAssetsStorageSchema,
    )
  );
}

function isExternalStorageServiceSnapshotSchemaHealthReady(schema) {
  return (
    isRecord(schema) &&
    schema.status === "ready" &&
    schema.schemaVersion === "matched" &&
      schema.migrationStatus === "up-to-date" &&
      schema.snapshotStore === "json-atomic-snapshot" &&
      schema.auditLog === "jsonl-append-only" &&
      schema.backupStore === "json-atomic-snapshot" &&
      schema.restoreDrillLog === "jsonl-append-only" &&
      schema.revisionControl === "optimistic-revision" &&
      schema.concurrencyControl === "atomic-rename-with-revision-check" &&
      schema.valueRedacted === true
    );
  }

function readExternalStorageServiceTeachingCourseManagementSchemaHealth(value) {
  return readExternalStorageServiceSnapshotSchemaHealth(
    value,
    "uais-teaching-course-management-v1",
  );
}

function readExternalStorageServiceTeachingCourseAssetsSchemaHealth(value) {
  return readExternalStorageServiceSnapshotSchemaHealth(
    value,
    "uais-teaching-course-assets-v1",
  );
}

function readExternalStorageServiceSnapshotSchemaHealth(value, expectedSchemaVersion) {
  return {
    status: value?.status === "ready" ? "ready" : "missing",
    schemaVersion:
      value?.schemaVersion === expectedSchemaVersion || value?.schemaVersion === "matched"
        ? "matched"
        : "missing",
    migrationStatus:
      value?.migrationStatus === "up-to-date" ? "up-to-date" : "missing",
    snapshotStore:
      value?.snapshotStore === "json-atomic-snapshot" ? "json-atomic-snapshot" : "missing",
    auditLog:
      value?.auditLog === "jsonl-append-only" ? "jsonl-append-only" : "missing",
    backupStore:
      value?.backupStore === "json-atomic-snapshot" ? "json-atomic-snapshot" : "missing",
    restoreDrillLog:
      value?.restoreDrillLog === "jsonl-append-only" ? "jsonl-append-only" : "missing",
      revisionControl:
        value?.revisionControl === "optimistic-revision" ? "optimistic-revision" : "missing",
      concurrencyControl:
        value?.concurrencyControl === "atomic-rename-with-revision-check"
          ? "atomic-rename-with-revision-check"
          : "missing",
      productionDatabaseAdapter:
        readExternalStorageServiceProductionDatabaseAdapterHealth(
          value?.productionDatabaseAdapter,
        ),
      valueRedacted: value?.valueRedacted === true,
    };
  }

function readExternalStorageServiceReadinessSafety(evidence) {
  const safety = isRecord(evidence) && isRecord(evidence.safety) ? evidence.safety : {};
  return Object.fromEntries(
    requiredExternalStorageServiceReadinessSafetyFlags.map((flag) => [
      flag,
      safety[flag] === true ? "proved" : "missing",
    ]),
  );
}

function evaluateVercelEnvSync(evidence, vercelEnvInventory) {
  const id = "vercel-env-placement";
  const remoteEnvInventory = readVercelEnvInventorySummary(vercelEnvInventory);
  const remoteEnvInventoryDetails = {
    remoteEnvInventory: remoteEnvInventory ?? "missing",
  };
  if (!isRecord(evidence)) {
    return blockedRequirement(id, "vercel-env-evidence-missing", "missing", {
      ...remoteEnvInventoryDetails,
    });
  }
  if (evidence.target !== "vercel-env-sync") {
    return blockedRequirement(id, "vercel-env-evidence-target-mismatch", readEvidenceStatus(evidence), {
      ...remoteEnvInventoryDetails,
      evidenceTarget: typeof evidence.target === "string" ? evidence.target : "missing",
    });
  }
  const entries = Array.isArray(evidence.entries) ? evidence.entries : [];
  const presentNames = new Set(
    entries
      .filter((entry) => isRecord(entry) && entry.status === "present" && typeof entry.name === "string")
      .map((entry) => entry.name),
  );
  const authProviderMode = readVercelEnvAuthProviderMode(evidence);
  const requiredAuthProviderEnv = authProviderRequiredVercelEnvNames[authProviderMode] ?? [];
  const requiredEnv = [...commonRequiredVercelEnvNames, ...requiredAuthProviderEnv];
  const missingEnv = requiredEnv.filter((name) => !presentNames.has(name));
  const authProviderModeProved = acceptedTeacherAuthProviderModes.includes(authProviderMode);
  const envTargets = Array.isArray(evidence.targets)
    ? evidence.targets.filter((target) => typeof target === "string")
    : [];
  const missingTargets = requiredVercelEnvTargets.filter((target) => !envTargets.includes(target));
  const projectReadinessEvidenceStatus =
    typeof evidence.projectReadinessEvidenceStatus === "string"
      ? evidence.projectReadinessEvidenceStatus
      : "missing";
  const localOnlySmokeEnvNotSynced =
    isRecord(evidence.safety) && evidence.safety.localOnlySmokeEnvNotSynced === true
      ? "proved"
      : "missing";
  const oidcEndpointSecurity = readOidcEndpointSecurity(evidence);
  const oidcEndpointSecurityProved =
    authProviderMode !== "oidc-jwks" ||
    (oidcEndpointSecurity.issuer === "remote-https" &&
      oidcEndpointSecurity.jwks === "remote-https");
  const externalStorageEndpoint = readExternalStorageEndpoint(evidence);
  const externalStorageEndpointProved =
    externalStorageEndpoint.endpointClass === "remote-https";
  const externalStorageServiceFingerprint = readVercelExternalStorageServiceFingerprint(evidence);
  const externalStorageServiceFingerprintStatus = externalStorageServiceFingerprint
    ? "present"
    : "missing";
  const externalStorageDatabaseAdapterProof =
    readVercelExternalStorageDatabaseAdapterProof(evidence);
  const externalStorageDatabaseAdapterProofProved =
    isVercelExternalStorageDatabaseAdapterProofReady(
      externalStorageDatabaseAdapterProof,
    );
  const requiredSecretStrengthNames = [
    ...commonProductionSecretStrengthNames,
    ...(authProviderProductionSecretStrengthNames[authProviderMode] ?? []),
  ];
  const secretStrength = readVercelSecretStrength(evidence, requiredSecretStrengthNames);
  const secretStrengthProved = secretStrength.insufficientSecrets.length === 0;
  const applySummary = readVercelApplySummary(evidence);
  const applyPreflight = readVercelApplyPreflight(evidence);
  const remoteEnvInventoryObserved = isVercelEnvInventoryObserved(
    remoteEnvInventory,
    requiredEnv,
    requiredVercelEnvTargets,
  );
  const oidcEndpointDetails =
    authProviderMode === "oidc-jwks" ? { oidcEndpointSecurity } : {};
  const endpointDetails = {
    externalStorageEndpoint,
    externalStorageServiceFingerprint: externalStorageServiceFingerprintStatus,
    externalStorageDatabaseAdapterProof,
    ...oidcEndpointDetails,
  };
  if (evidence.mode === "apply" && missingEnv.length === 0 && !authProviderModeProved) {
    return blockedRequirement(id, "vercel-env-auth-provider-mode-not-proven", readEvidenceStatus(evidence), {
      ...remoteEnvInventoryDetails,
      authProviderMode,
      requiredEnv,
      requiredAuthProviderEnv,
      missingEnv,
      projectReadinessEvidenceStatus,
      envTargets,
      missingTargets,
      secretStrength: secretStrength.evidence,
      ...endpointDetails,
    });
  }
  if (evidence.mode === "apply" && missingEnv.length === 0 && projectReadinessEvidenceStatus !== "ready") {
    return blockedRequirement(id, "vercel-env-project-readiness-not-proven", readEvidenceStatus(evidence), {
      ...remoteEnvInventoryDetails,
      authProviderMode,
      requiredEnv,
      requiredAuthProviderEnv,
      missingEnv,
      projectReadinessEvidenceStatus,
      secretStrength: secretStrength.evidence,
      ...endpointDetails,
    });
  }
  if (
    evidence.mode === "apply" &&
    missingEnv.length === 0 &&
    projectReadinessEvidenceStatus === "ready" &&
    missingTargets.length > 0
  ) {
    return blockedRequirement(id, "vercel-env-target-coverage-not-proven", readEvidenceStatus(evidence), {
      ...remoteEnvInventoryDetails,
      authProviderMode,
      requiredEnv,
      requiredAuthProviderEnv,
      missingEnv,
      projectReadinessEvidenceStatus,
      envTargets,
      missingTargets,
      secretStrength: secretStrength.evidence,
      ...endpointDetails,
    });
  }
  if (
    evidence.mode === "apply" &&
    missingEnv.length === 0 &&
    projectReadinessEvidenceStatus === "ready" &&
    missingTargets.length === 0 &&
    localOnlySmokeEnvNotSynced !== "proved"
  ) {
    return blockedRequirement(id, "vercel-env-local-only-smoke-exclusion-not-proven", readEvidenceStatus(evidence), {
      ...remoteEnvInventoryDetails,
      authProviderMode,
      requiredEnv,
      requiredAuthProviderEnv,
      missingEnv,
      projectReadinessEvidenceStatus,
      envTargets,
      missingTargets,
      localOnlySmokeEnvNotSynced,
      secretStrength: secretStrength.evidence,
      ...endpointDetails,
    });
  }
  if (
    evidence.mode === "apply" &&
    missingEnv.length === 0 &&
    projectReadinessEvidenceStatus === "ready" &&
    missingTargets.length === 0 &&
    localOnlySmokeEnvNotSynced === "proved" &&
    !externalStorageEndpointProved
  ) {
    return blockedRequirement(id, "vercel-env-external-storage-endpoint-not-proven", readEvidenceStatus(evidence), {
      ...remoteEnvInventoryDetails,
      authProviderMode,
      requiredEnv,
      requiredAuthProviderEnv,
      missingEnv,
      projectReadinessEvidenceStatus,
      envTargets,
      missingTargets,
      localOnlySmokeEnvNotSynced,
      secretStrength: secretStrength.evidence,
      ...endpointDetails,
    });
  }
  if (
    evidence.mode === "apply" &&
    missingEnv.length === 0 &&
    projectReadinessEvidenceStatus === "ready" &&
    missingTargets.length === 0 &&
    localOnlySmokeEnvNotSynced === "proved" &&
    externalStorageEndpointProved &&
    externalStorageServiceFingerprintStatus !== "present"
  ) {
    return blockedRequirement(id, "vercel-env-external-storage-fingerprint-not-proven", readEvidenceStatus(evidence), {
      ...remoteEnvInventoryDetails,
      authProviderMode,
      requiredEnv,
      requiredAuthProviderEnv,
      missingEnv,
      projectReadinessEvidenceStatus,
      envTargets,
      missingTargets,
      localOnlySmokeEnvNotSynced,
      secretStrength: secretStrength.evidence,
      ...endpointDetails,
    });
  }
  if (
    evidence.mode === "apply" &&
    missingEnv.length === 0 &&
    projectReadinessEvidenceStatus === "ready" &&
    missingTargets.length === 0 &&
    localOnlySmokeEnvNotSynced === "proved" &&
    externalStorageEndpointProved &&
    externalStorageServiceFingerprintStatus === "present" &&
    !externalStorageDatabaseAdapterProofProved
  ) {
    return blockedRequirement(
      id,
      "vercel-env-external-storage-database-adapter-proof-not-proven",
      readEvidenceStatus(evidence),
      {
        ...remoteEnvInventoryDetails,
        authProviderMode,
        requiredEnv,
        requiredAuthProviderEnv,
        missingEnv,
        projectReadinessEvidenceStatus,
        envTargets,
        missingTargets,
        localOnlySmokeEnvNotSynced,
        secretStrength: secretStrength.evidence,
        ...endpointDetails,
      },
    );
  }
  if (
    evidence.mode === "apply" &&
    missingEnv.length === 0 &&
    projectReadinessEvidenceStatus === "ready" &&
    missingTargets.length === 0 &&
    localOnlySmokeEnvNotSynced === "proved" &&
    externalStorageEndpointProved &&
    externalStorageServiceFingerprintStatus === "present" &&
    externalStorageDatabaseAdapterProofProved &&
    !oidcEndpointSecurityProved
  ) {
    return blockedRequirement(id, "vercel-env-oidc-endpoint-security-not-proven", readEvidenceStatus(evidence), {
      ...remoteEnvInventoryDetails,
      authProviderMode,
      requiredEnv,
      requiredAuthProviderEnv,
      missingEnv,
      projectReadinessEvidenceStatus,
      envTargets,
      missingTargets,
      localOnlySmokeEnvNotSynced,
      secretStrength: secretStrength.evidence,
      ...endpointDetails,
    });
  }
  if (
    evidence.mode === "apply" &&
    missingEnv.length === 0 &&
    projectReadinessEvidenceStatus === "ready" &&
    missingTargets.length === 0 &&
    localOnlySmokeEnvNotSynced === "proved" &&
    externalStorageEndpointProved &&
    externalStorageServiceFingerprintStatus === "present" &&
    externalStorageDatabaseAdapterProofProved &&
    oidcEndpointSecurityProved &&
    !secretStrengthProved
  ) {
    return blockedRequirement(id, "vercel-env-secret-strength-not-proven", readEvidenceStatus(evidence), {
      ...remoteEnvInventoryDetails,
      authProviderMode,
      requiredEnv,
      requiredAuthProviderEnv,
      missingEnv,
      projectReadinessEvidenceStatus,
      envTargets,
      missingTargets,
      localOnlySmokeEnvNotSynced,
      insufficientSecrets: secretStrength.insufficientSecrets,
      secretStrength: secretStrength.evidence,
      ...endpointDetails,
    });
  }
  if (
    evidence.mode === "apply" &&
    missingEnv.length === 0 &&
    projectReadinessEvidenceStatus === "ready" &&
    missingTargets.length === 0 &&
    localOnlySmokeEnvNotSynced === "proved" &&
    externalStorageEndpointProved &&
    externalStorageServiceFingerprintStatus === "present" &&
    externalStorageDatabaseAdapterProofProved &&
    oidcEndpointSecurityProved &&
    secretStrengthProved &&
    !isVercelApplySummaryProved(applySummary)
  ) {
    return blockedRequirement(id, "vercel-env-apply-summary-not-proven", readEvidenceStatus(evidence), {
      ...remoteEnvInventoryDetails,
      authProviderMode,
      requiredEnv,
      requiredAuthProviderEnv,
      missingEnv,
      projectReadinessEvidenceStatus,
      envTargets,
      missingTargets,
      localOnlySmokeEnvNotSynced,
      secretStrength: secretStrength.evidence,
      applySummary,
      ...endpointDetails,
    });
  }
  if (
    evidence.mode === "apply" &&
    missingEnv.length === 0 &&
    projectReadinessEvidenceStatus === "ready" &&
    missingTargets.length === 0 &&
    localOnlySmokeEnvNotSynced === "proved" &&
    externalStorageEndpointProved &&
    externalStorageServiceFingerprintStatus === "present" &&
    externalStorageDatabaseAdapterProofProved &&
    oidcEndpointSecurityProved &&
    secretStrengthProved &&
    isVercelApplySummaryProved(applySummary) &&
    !isVercelApplyPreflightProved(applyPreflight)
  ) {
    return blockedRequirement(id, "vercel-env-apply-preflight-not-proven", readEvidenceStatus(evidence), {
      ...remoteEnvInventoryDetails,
      authProviderMode,
      requiredEnv,
      requiredAuthProviderEnv,
      missingEnv,
      projectReadinessEvidenceStatus,
      envTargets,
      missingTargets,
      localOnlySmokeEnvNotSynced,
      secretStrength: secretStrength.evidence,
      applySummary,
      applyPreflight,
      ...endpointDetails,
    });
  }
  if (
    evidence.mode === "apply" &&
    missingEnv.length === 0 &&
    projectReadinessEvidenceStatus === "ready" &&
    missingTargets.length === 0 &&
    localOnlySmokeEnvNotSynced === "proved" &&
    externalStorageEndpointProved &&
    externalStorageServiceFingerprintStatus === "present" &&
    externalStorageDatabaseAdapterProofProved &&
    oidcEndpointSecurityProved &&
    secretStrengthProved &&
    isVercelApplySummaryProved(applySummary) &&
    isVercelApplyPreflightProved(applyPreflight) &&
    !remoteEnvInventoryObserved
  ) {
    return blockedRequirement(id, "vercel-env-inventory-not-observed", readEvidenceStatus(evidence), {
      ...remoteEnvInventoryDetails,
      authProviderMode,
      requiredEnv,
      requiredAuthProviderEnv,
      missingEnv,
      projectReadinessEvidenceStatus,
      envTargets,
      missingTargets,
      localOnlySmokeEnvNotSynced,
      secretStrength: secretStrength.evidence,
      applySummary,
      applyPreflight,
      ...endpointDetails,
    });
  }
  if (
    evidence.mode === "apply" &&
    missingEnv.length === 0 &&
    projectReadinessEvidenceStatus === "ready" &&
    missingTargets.length === 0 &&
    localOnlySmokeEnvNotSynced === "proved" &&
    externalStorageEndpointProved &&
    externalStorageServiceFingerprintStatus === "present" &&
    externalStorageDatabaseAdapterProofProved &&
    oidcEndpointSecurityProved &&
    secretStrengthProved &&
    isVercelApplySummaryProved(applySummary) &&
    isVercelApplyPreflightProved(applyPreflight) &&
    remoteEnvInventoryObserved
  ) {
    return satisfiedRequirement(id, "apply", {
      ...remoteEnvInventoryDetails,
      authProviderMode,
      requiredEnv,
      requiredAuthProviderEnv,
      requiredEnvCount: requiredEnv.length,
      projectReadinessEvidenceStatus,
      requiredTargets: requiredVercelEnvTargets,
      localOnlySmokeEnvNotSynced,
      secretStrength: secretStrength.evidence,
      applySummary,
      applyPreflight,
      ...endpointDetails,
    });
  }
  return blockedRequirement(id, "vercel-env-not-applied", readEvidenceStatus(evidence), {
    ...remoteEnvInventoryDetails,
    localSourceSummary: readVercelEnvLocalSourceSummary(evidence),
    authProviderMode,
    requiredEnv,
    requiredAuthProviderEnv,
    missingEnv,
    projectReadinessEvidenceStatus,
    envTargets,
    missingTargets,
    localOnlySmokeEnvNotSynced,
    secretStrength: secretStrength.evidence,
    ...endpointDetails,
  });
}

function readVercelEnvLocalSourceSummary(evidence) {
  const summary = isRecord(evidence.localSourceSummary) ? evidence.localSourceSummary : undefined;
  if (!summary || summary.valuesRedacted !== true) {
    return "missing";
  }
  const deploymentEntries = isRecord(summary.deploymentEntries)
    ? summary.deploymentEntries
    : {};
  const selectedAuthProvider = isRecord(summary.selectedAuthProvider)
    ? summary.selectedAuthProvider
    : {};
  const productionSecretStrength = isRecord(summary.productionSecretStrength)
    ? summary.productionSecretStrength
    : {};
  const externalStorage = isRecord(summary.externalStorage) ? summary.externalStorage : {};
  const externalStorageDatabaseAdapterProof =
    readVercelExternalStorageDatabaseAdapterProofValue(
      summary.externalStorageDatabaseAdapterProof,
    );
  const localOnlyEntries = isRecord(summary.localOnlyEntries) ? summary.localOnlyEntries : {};

  return {
    status: readSafeString(summary.status),
    valuesRedacted: true,
    deploymentEntries: {
      total: readSafeCount(deploymentEntries.total),
      present: readSafeCount(deploymentEntries.present),
      missing: readSafeCount(deploymentEntries.missing),
      missingNames: readSafeNameList(deploymentEntries.missingNames),
    },
    selectedAuthProvider: {
      mode: readSafeString(selectedAuthProvider.mode),
      requiredPresent: readSafeCount(selectedAuthProvider.requiredPresent),
      requiredMissing: readSafeCount(selectedAuthProvider.requiredMissing),
      missingRequiredNames: readSafeNameList(selectedAuthProvider.missingRequiredNames),
    },
    productionSecretStrength: {
      minimumLength: readSafeCount(productionSecretStrength.minimumLength),
      sufficient: readSafeCount(productionSecretStrength.sufficient),
      weak: readSafeCount(productionSecretStrength.weak),
      missing: readSafeCount(productionSecretStrength.missing),
      weakNames: readSafeNameList(productionSecretStrength.weakNames),
      missingNames: readSafeNameList(productionSecretStrength.missingNames),
    },
    externalStorage: {
      endpointClass: readSafeString(externalStorage.endpointClass),
      fingerprintStatus: readSafeString(externalStorage.fingerprintStatus),
    },
    externalStorageDatabaseAdapterProof,
    localOnlyEntries: {
      total: readSafeCount(localOnlyEntries.total),
      present: readSafeCount(localOnlyEntries.present),
      ignored: readSafeCount(localOnlyEntries.ignored),
    },
  };
}

function readSafeString(value) {
  return typeof value === "string" ? value : "missing";
}

function readSafeCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : "missing";
}

function readSafeNameList(value) {
  return Array.isArray(value)
    ? value.filter((name) => typeof name === "string")
    : [];
}

function readVercelEnvInventorySummary(evidence) {
  if (!isRecord(evidence)) {
    return undefined;
  }
  const counts = isRecord(evidence.remoteEnvCounts) ? evidence.remoteEnvCounts : {};
  const names = isRecord(evidence.remoteEnvNames) ? evidence.remoteEnvNames : {};
  const command = readVercelEnvInventoryCommandSummary(evidence.command);
  const missingRequiredEnv = Array.isArray(evidence.missingRequiredEnv)
    ? evidence.missingRequiredEnv
        .filter((entry) => isRecord(entry))
        .map((entry) => ({
          name: typeof entry.name === "string" ? entry.name : "missing",
          environment: typeof entry.environment === "string" ? entry.environment : "missing",
          valueRedacted: true,
        }))
    : [];
  const unobservedRequiredEnv = Array.isArray(evidence.unobservedRequiredEnv)
    ? evidence.unobservedRequiredEnv
        .filter((entry) => isRecord(entry))
        .map((entry) => ({
          name: typeof entry.name === "string" ? entry.name : "missing",
          environment: typeof entry.environment === "string" ? entry.environment : "missing",
          valueRedacted: true,
        }))
    : [];
  const safety = isRecord(evidence.safety) ? evidence.safety : {};

  return {
    target: evidence.target === "vercel-env-inventory" ? "vercel-env-inventory" : "mismatch",
    status: typeof evidence.status === "string" ? evidence.status : "missing",
    mode: typeof evidence.mode === "string" ? evidence.mode : "missing",
    remoteEnvCounts: {
      production: Number.isInteger(counts.production) ? counts.production : "missing",
      preview: Number.isInteger(counts.preview) ? counts.preview : "missing",
    },
    remoteEnvNames: {
      production: readVercelEnvInventoryNames(names.production),
      preview: readVercelEnvInventoryNames(names.preview),
    },
    ...(command ? { command } : {}),
    missingRequiredEnvCount: missingRequiredEnv.length,
    missingRequiredEnv,
    unobservedRequiredEnvCount: unobservedRequiredEnv.length,
    unobservedRequiredEnv,
    safety: {
      valuesRedacted: safety.valuesRedacted === true ? "proved" : "missing",
      rawCliOutputOmitted: safety.rawCliOutputOmitted === true ? "proved" : "missing",
      localPrivatePathsOmitted:
        safety.localPrivatePathsOmitted === true ? "proved" : "missing",
      noMutation: safety.noMutation === true ? "proved" : "missing",
    },
  };
}

function readVercelEnvInventoryNames(value) {
  return Array.isArray(value)
    ? value.filter((name) => typeof name === "string")
    : [];
}

function readVercelEnvInventoryCommandSummary(command) {
  if (!isRecord(command)) {
    return undefined;
  }
  const statusByEnvironment = isRecord(command.statusByEnvironment)
    ? command.statusByEnvironment
    : {};
  const failureClassByEnvironment = isRecord(command.failureClassByEnvironment)
    ? command.failureClassByEnvironment
    : {};
  const attemptsByEnvironment = isRecord(command.attemptsByEnvironment)
    ? command.attemptsByEnvironment
    : {};
  return {
    name: readVercelEnvInventoryCommandName(command.name),
    format: command.format === "json" ? "json" : "missing",
    statusByEnvironment: {
      production: readVercelEnvInventoryCommandStatus(statusByEnvironment.production),
      preview: readVercelEnvInventoryCommandStatus(statusByEnvironment.preview),
    },
    failureClassByEnvironment: {
      production: readVercelEnvInventoryFailureClass(failureClassByEnvironment.production),
      preview: readVercelEnvInventoryFailureClass(failureClassByEnvironment.preview),
    },
    attemptsByEnvironment: {
      production: readVercelEnvInventoryAttempts(attemptsByEnvironment.production),
      preview: readVercelEnvInventoryAttempts(attemptsByEnvironment.preview),
    },
    stdoutOmitted: command.stdoutOmitted === true ? "proved" : "missing",
    stderrOmitted: command.stderrOmitted === true ? "proved" : "missing",
    ...(command.name === "vercel-env-rest-list"
      ? { apiOutputOmitted: command.apiOutputOmitted === true ? "proved" : "missing" }
      : {}),
  };
}

function readVercelEnvInventoryCommandName(value) {
  return value === "vercel-env-list" || value === "vercel-env-rest-list"
    ? value
    : "mismatch";
}

function readVercelEnvInventoryCommandStatus(value) {
  return value === "passed" || value === "failed" ? value : "missing";
}

function readVercelEnvInventoryFailureClass(value) {
  return [
    "none",
    "auth-required",
    "project-not-linked",
    "unsupported-format",
    "network-error",
    "cli-not-found",
    "unknown",
  ].includes(value)
    ? value
    : "unknown";
}

function readVercelEnvInventoryAttempts(value) {
  return Number.isInteger(value) && value > 0 ? value : "missing";
}

function isVercelEnvInventoryObserved(summary, requiredEnv, requiredTargets) {
  if (!isRecord(summary)) {
    return false;
  }
  const safety = isRecord(summary.safety) ? summary.safety : {};
  const remoteEnvNames = isRecord(summary.remoteEnvNames)
    ? summary.remoteEnvNames
    : {};
  const requiredEnvPresentInEveryTarget = requiredTargets.every((target) => {
    const names = Array.isArray(remoteEnvNames[target])
      ? remoteEnvNames[target]
      : [];
    return requiredEnv.every((name) => names.includes(name));
  });
  return (
    summary.target === "vercel-env-inventory" &&
    summary.status === "observed" &&
    summary.mode === "live" &&
    summary.missingRequiredEnvCount === 0 &&
    summary.unobservedRequiredEnvCount === 0 &&
    requiredEnvPresentInEveryTarget &&
    safety.valuesRedacted === "proved" &&
    safety.rawCliOutputOmitted === "proved" &&
    safety.localPrivatePathsOmitted === "proved" &&
    safety.noMutation === "proved"
  );
}

function readVercelApplySummary(evidence) {
  const summary = isRecord(evidence.applySummary) ? evidence.applySummary : {};
  const appliedByTarget = isRecord(summary.appliedByTarget) ? summary.appliedByTarget : {};
  return {
    status: summary.status === "applied" ? "applied" : "missing",
    appliedActions:
      Number.isInteger(summary.appliedActions) && summary.appliedActions > 0
        ? summary.appliedActions
        : "missing",
    appliedByTarget: {
      production:
        Number.isInteger(appliedByTarget.production) && appliedByTarget.production > 0
          ? appliedByTarget.production
          : "missing",
      preview:
        Number.isInteger(appliedByTarget.preview) && appliedByTarget.preview > 0
          ? appliedByTarget.preview
          : "missing",
    },
    localOnlyEntriesSkipped:
      Number.isInteger(summary.localOnlyEntriesSkipped) && summary.localOnlyEntriesSkipped >= 0
        ? summary.localOnlyEntriesSkipped
        : "missing",
    valuesRedacted: summary.valuesRedacted === true ? "proved" : "missing",
    cliOutputOmitted: summary.cliOutputOmitted === true ? "proved" : "missing",
  };
}

function isVercelApplySummaryProved(summary) {
  return (
    summary.status === "applied" &&
    summary.appliedActions !== "missing" &&
    summary.appliedByTarget.production !== "missing" &&
    summary.appliedByTarget.preview !== "missing" &&
    summary.localOnlyEntriesSkipped !== "missing" &&
    summary.valuesRedacted === "proved" &&
    summary.cliOutputOmitted === "proved"
  );
}

function readVercelApplyPreflight(evidence) {
  const preflight = isRecord(evidence.applyPreflight) ? evidence.applyPreflight : {};
  const blockedReasons = Array.isArray(preflight.blockedReasons)
    ? preflight.blockedReasons.filter((reason) => typeof reason === "string")
    : "missing";
  return {
    status: preflight.status === "passed" ? "passed" : "missing",
    blockedReasons,
    valuesRedacted: preflight.valuesRedacted === true ? "proved" : "missing",
    cliSafeToInvoke: preflight.cliSafeToInvoke === true ? "proved" : "missing",
  };
}

function isVercelApplyPreflightProved(preflight) {
  return (
    preflight.status === "passed" &&
    Array.isArray(preflight.blockedReasons) &&
    preflight.blockedReasons.length === 0 &&
    preflight.valuesRedacted === "proved" &&
    preflight.cliSafeToInvoke === "proved"
  );
}

function readVercelEnvAuthProviderMode(evidence) {
  if (typeof evidence.authProviderMode === "string" && acceptedTeacherAuthProviderModes.includes(evidence.authProviderMode)) {
    return evidence.authProviderMode;
  }
  if (evidence.authProviderMode === "missing" || evidence.authProviderMode === "unsupported") {
    return evidence.authProviderMode;
  }
  return typeof evidence.authProviderMode === "string" ? "unsupported" : "missing";
}

function readVercelSecretStrength(evidence, requiredNames) {
  const checks = isRecord(evidence.secretStrength) && Array.isArray(evidence.secretStrength.checks)
    ? evidence.secretStrength.checks
    : [];
  const byName = new Map(
    checks
      .filter((check) => isRecord(check) && typeof check.name === "string")
      .map((check) => [
        check.name,
        {
          name: check.name,
          status: readSecretStrengthStatus(check.status),
          valueRedacted: check.valueRedacted === true,
        },
      ]),
  );
  const normalizedChecks = requiredNames.map((name) => (
    byName.get(name) ?? {
      name,
      status: "missing-proof",
      valueRedacted: false,
    }
  ));
  const insufficientSecrets = normalizedChecks
    .filter((check) => check.status !== "sufficient" || check.valueRedacted !== true)
    .map((check) => check.name);
  const minimumLength =
    isRecord(evidence.secretStrength) && evidence.secretStrength.minimumLength === minimumProductionSecretLength
      ? minimumProductionSecretLength
      : minimumProductionSecretLength;
  return {
    evidence: {
      minimumLength,
      valuesRedacted: isRecord(evidence.secretStrength) && evidence.secretStrength.valuesRedacted === true,
      checks: normalizedChecks,
    },
    insufficientSecrets,
  };
}

function readSecretStrengthStatus(value) {
  if (value === "sufficient" || value === "weak" || value === "missing") {
    return value;
  }
  return "missing-proof";
}

function readOidcEndpointSecurity(evidence) {
  if (!isRecord(evidence.oidcEndpointSecurity)) {
    return {
      issuer: "missing",
      jwks: "missing",
    };
  }
  return {
    issuer: readOidcEndpointClass(evidence.oidcEndpointSecurity.issuer),
    jwks: readOidcEndpointClass(evidence.oidcEndpointSecurity.jwks),
  };
}

function readOidcEndpointClass(value) {
  if (typeof value !== "string") {
    return "missing";
  }
  return acceptedOidcEndpointClasses.includes(value) ? value : "invalid";
}

function readExternalStorageEndpoint(evidence) {
  if (!isRecord(evidence.externalStorageEndpoint)) {
    return {
      status: "missing",
      endpointClass: "missing",
      valueRedacted: false,
    };
  }
  const endpointClass = readOidcEndpointClass(evidence.externalStorageEndpoint.endpointClass);
  const status =
    evidence.externalStorageEndpoint.status === "present" ||
    evidence.externalStorageEndpoint.status === "missing"
      ? evidence.externalStorageEndpoint.status
      : endpointClass === "missing"
      ? "missing"
      : "present";
  return {
    status,
    endpointClass,
    valueRedacted: evidence.externalStorageEndpoint.valueRedacted === true,
  };
}

function readVercelExternalStorageDatabaseAdapterProof(evidence) {
  return readVercelExternalStorageDatabaseAdapterProofValue(
    isRecord(evidence) ? evidence.externalStorageDatabaseAdapterProof : undefined,
  );
}

function readVercelExternalStorageDatabaseAdapterProofValue(value) {
  if (!isRecord(value)) {
    return {
      status: "missing",
      providerClass: "missing",
      migrationStatus: "missing",
      backupPolicy: "missing",
      concurrencyControl: "missing",
      valuesRedacted: false,
    };
  }
  return {
    status: readDatabaseAdapterProofStatus(value.status),
    providerClass: readDatabaseAdapterProofField(value.providerClass, "managed-database"),
    migrationStatus: readDatabaseAdapterProofField(value.migrationStatus, "up-to-date"),
    backupPolicy: readDatabaseAdapterProofField(
      value.backupPolicy,
      "point-in-time-restore",
    ),
    concurrencyControl: readDatabaseAdapterProofField(
      value.concurrencyControl,
      "transactional",
    ),
    valuesRedacted: value.valuesRedacted === true,
  };
}

function readDatabaseAdapterProofStatus(value) {
  if (value === "ready" || value === "blocked" || value === "not-required-for-scope") {
    return value;
  }
  return "missing";
}

function readDatabaseAdapterProofField(value, expected) {
  if (value === expected || value === "not-required-for-scope") {
    return value;
  }
  return "missing";
}

function isVercelExternalStorageDatabaseAdapterProofReady(proof) {
  return (
    proof.status === "ready" &&
    proof.providerClass === "managed-database" &&
    proof.migrationStatus === "up-to-date" &&
    proof.backupPolicy === "point-in-time-restore" &&
    proof.concurrencyControl === "transactional" &&
    proof.valuesRedacted === true
  );
}

function readStorageEndpoint(value) {
  if (!isRecord(value)) {
    return {
      status: "missing",
      networkClass: "missing",
      endpointClass: "missing",
      valueRedacted: false,
    };
  }
  const endpointClass = readOidcEndpointClass(value.endpointClass);
  const networkClass =
    typeof value.networkClass === "string" &&
    acceptedStorageNetworkClasses.includes(value.networkClass)
      ? value.networkClass
      : "missing";
  const status =
    value.status === "present" || value.status === "missing"
      ? value.status
      : endpointClass === "missing"
      ? "missing"
      : "present";
  return {
    status,
    networkClass,
    endpointClass,
    valueRedacted: value.valueRedacted === true,
  };
}

function readDeploymentOrigin(evidence) {
  if (!isRecord(evidence.deploymentOrigin)) {
    return {
      status: "missing",
      originClass: "missing",
      valueRedacted: false,
    };
  }
  const originClass = readOidcEndpointClass(evidence.deploymentOrigin.originClass);
  const status =
    evidence.deploymentOrigin.status === "present" ||
    evidence.deploymentOrigin.status === "missing"
      ? evidence.deploymentOrigin.status
      : originClass === "missing"
      ? "missing"
      : "present";
  return {
    status,
    originClass,
    valueRedacted: evidence.deploymentOrigin.valueRedacted === true,
  };
}

function evaluateRouteSmoke(evidence, deployedTeacherWorkflowEvidence) {
  const id = "deployment-route-smoke";
  if (!isRecord(evidence)) {
    return blockedRequirement(id, "deployment-route-smoke-evidence-missing", "missing");
  }
  if (evidence.target !== "deployment-route-smoke") {
    return blockedRequirement(id, "deployment-route-smoke-evidence-target-mismatch", readEvidenceStatus(evidence), {
      evidenceTarget: typeof evidence.target === "string" ? evidence.target : "missing",
    });
  }
  const routeResults = Array.isArray(evidence.results) ? evidence.results : [];
  const okRouteIds = new Set(
    routeResults
      .filter((result) => isRecord(result) && result.status === "ok" && typeof result.id === "string")
      .map((result) => result.id),
  );
  const missingRouteChecks = requiredRouteSmokeIds.filter((routeId) => !okRouteIds.has(routeId));
  const workflowRouteResult = routeResults.find(
    (result) => isRecord(result) && result.id === "s22-teacher-ppt-workflow-route",
  );
  const ownershipRouteResult = routeResults.find(
    (result) => isRecord(result) && result.id === "s22-teacher-ownership-route",
  );
  const teacherAiSessionRouteResult = routeResults.find(
    (result) => isRecord(result) && result.id === "s22-teacher-ai-session-route",
  );
  const issuerRouteResult = routeResults.find(
    (result) => isRecord(result) && result.id === "s22-teacher-auth-issuer-route",
  );
  const authProviderMode =
    typeof evidence.authProviderMode === "string" ? evidence.authProviderMode : "unspecified";
  const issuerRouteAuth =
    isRecord(issuerRouteResult) && typeof issuerRouteResult.auth === "string"
      ? issuerRouteResult.auth
      : "missing";
  const workflowRouteAuth =
    isRecord(workflowRouteResult) && typeof workflowRouteResult.auth === "string"
      ? workflowRouteResult.auth
      : "missing";
  const ownershipRouteAuth =
    isRecord(ownershipRouteResult) && typeof ownershipRouteResult.auth === "string"
      ? ownershipRouteResult.auth
      : "missing";
  const issuerCookieHardening = readIssuerCookieHardeningStatus(issuerRouteResult);
  const routeResponseShapes = Object.fromEntries(
    requiredTrustedRouteResponseShapes.map((shapeContract) => {
      const routeResult = routeResults.find(
        (result) => isRecord(result) && result.id === shapeContract.routeId,
      );
      return [
        shapeContract.key,
        readResponseShapeStatus(routeResult, shapeContract.requiredFields),
      ];
    }),
  );
  const routeResponseShapesProved = Object.values(routeResponseShapes).every(
    (status) => status === "proved",
  );
  const routeDirectCallBoundary = readTeacherAiDirectCallBoundaryStatus(
    teacherAiSessionRouteResult,
  );
  const routeDirectCallBoundaryProved = routeDirectCallBoundary === "proved";
  const routeHelperAuthBoundary = readTeacherAiHelperAuthBoundaryStatus(
    teacherAiSessionRouteResult,
  );
  const routeHelperAuthBoundaryProved = routeHelperAuthBoundary === "proved";
  const authProviderModeProved = acceptedTeacherAuthProviderModes.includes(authProviderMode);
  const expectedIssuerRouteAuth = expectedIssuerRouteAuthByProvider[authProviderMode] ?? "missing";
  const issuerRouteAuthMatchesProvider = issuerRouteAuth === expectedIssuerRouteAuth;
  const evidenceEnvironment = typeof evidence.environment === "string" ? evidence.environment : "unspecified";
  const deploymentOrigin = readDeploymentOrigin(evidence);
  const teacherAuthProviderReadinessBinding =
    readRouteSmokeTeacherAuthProviderReadinessBinding(evidence);
  const vercelProductionDeploymentBinding =
    readRouteSmokeVercelProductionDeploymentBinding(evidence);
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingRouteChecks.length === 0 &&
    ownershipRouteAuth === "issued-teacher-auth-cookie" &&
    workflowRouteAuth === "issued-teacher-auth-cookie" &&
    evidenceEnvironment !== "production"
  ) {
    return blockedRequirement(
      id,
      "deployment-route-smoke-not-production",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingRouteChecks,
        authProviderMode,
        issuerRouteAuth,
        issuerCookieHardening,
        ownershipRouteAuth,
        workflowRouteAuth,
        routeResponseShapes,
        deploymentOrigin,
        teacherAuthProviderReadinessBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingRouteChecks.length === 0 &&
    ownershipRouteAuth === "issued-teacher-auth-cookie" &&
    workflowRouteAuth === "issued-teacher-auth-cookie" &&
    authProviderModeProved &&
    issuerRouteAuthMatchesProvider &&
    routeResponseShapesProved &&
    routeDirectCallBoundaryProved &&
    routeHelperAuthBoundaryProved &&
    deploymentOrigin.originClass === "remote-https" &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    isRouteSmokeVercelProductionDeploymentBindingMatchedExceptReleaseRun(
      vercelProductionDeploymentBinding,
    ) &&
    vercelProductionDeploymentBinding.releaseRunIdStatus !== "matched"
  ) {
    return blockedRequirement(
      id,
      "deployment-route-smoke-vercel-deployment-release-run-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingRouteChecks,
        authProviderMode,
        issuerRouteAuth,
        issuerCookieHardening,
        ownershipRouteAuth,
        workflowRouteAuth,
        routeResponseShapes,
        routeDirectCallBoundary,
        routeHelperAuthBoundary,
        deploymentOrigin,
        teacherAuthProviderReadinessBinding,
        vercelProductionDeploymentBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingRouteChecks.length === 0 &&
    ownershipRouteAuth === "issued-teacher-auth-cookie" &&
    workflowRouteAuth === "issued-teacher-auth-cookie" &&
    authProviderModeProved &&
    issuerRouteAuthMatchesProvider &&
    routeResponseShapesProved &&
    routeDirectCallBoundaryProved &&
    routeHelperAuthBoundaryProved &&
    deploymentOrigin.originClass === "remote-https" &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    !isRouteSmokeVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    )
  ) {
    return blockedRequirement(
      id,
      "deployment-route-smoke-vercel-deployment-binding-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingRouteChecks,
        authProviderMode,
        issuerRouteAuth,
        issuerCookieHardening,
        ownershipRouteAuth,
        workflowRouteAuth,
        routeResponseShapes,
        routeDirectCallBoundary,
        routeHelperAuthBoundary,
        deploymentOrigin,
        teacherAuthProviderReadinessBinding,
        vercelProductionDeploymentBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingRouteChecks.length === 0 &&
    (ownershipRouteAuth !== "issued-teacher-auth-cookie" ||
      workflowRouteAuth !== "issued-teacher-auth-cookie")
  ) {
    return blockedRequirement(
      id,
      "deployment-route-smoke-auth-chain-not-issued",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingRouteChecks,
        authProviderMode,
        issuerRouteAuth,
        issuerCookieHardening,
        ownershipRouteAuth,
        workflowRouteAuth,
        routeResponseShapes,
        deploymentOrigin,
        teacherAuthProviderReadinessBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingRouteChecks.length === 0 &&
    ownershipRouteAuth === "issued-teacher-auth-cookie" &&
    workflowRouteAuth === "issued-teacher-auth-cookie" &&
    evidenceEnvironment === "production" &&
    issuerCookieHardening === "proved" &&
    routeResponseShapesProved &&
    !authProviderModeProved
  ) {
    return blockedRequirement(
      id,
      "deployment-route-smoke-auth-provider-mode-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingRouteChecks,
        authProviderMode,
        acceptedAuthProviderModes: acceptedTeacherAuthProviderModes,
        issuerRouteAuth,
        expectedIssuerRouteAuth,
        issuerCookieHardening,
        ownershipRouteAuth,
        workflowRouteAuth,
        routeResponseShapes,
        deploymentOrigin,
        teacherAuthProviderReadinessBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingRouteChecks.length === 0 &&
    ownershipRouteAuth === "issued-teacher-auth-cookie" &&
    workflowRouteAuth === "issued-teacher-auth-cookie" &&
    evidenceEnvironment === "production" &&
    issuerCookieHardening === "proved" &&
    routeResponseShapesProved &&
    authProviderMode === "trusted-cookie-issuer" &&
    !issuerRouteAuthMatchesProvider
  ) {
    return blockedRequirement(
      id,
      "deployment-route-smoke-trusted-issuer-auth-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingRouteChecks,
        authProviderMode,
        issuerRouteAuth,
        expectedIssuerRouteAuth,
        issuerCookieHardening,
        ownershipRouteAuth,
        workflowRouteAuth,
        routeResponseShapes,
        deploymentOrigin,
        teacherAuthProviderReadinessBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingRouteChecks.length === 0 &&
    ownershipRouteAuth === "issued-teacher-auth-cookie" &&
    workflowRouteAuth === "issued-teacher-auth-cookie" &&
    evidenceEnvironment === "production" &&
    authProviderMode === "oidc-jwks" &&
    !issuerRouteAuthMatchesProvider
  ) {
    return blockedRequirement(
      id,
      "deployment-route-smoke-oidc-issuer-auth-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingRouteChecks,
        authProviderMode,
        issuerRouteAuth,
        expectedIssuerRouteAuth,
        issuerCookieHardening,
        ownershipRouteAuth,
        workflowRouteAuth,
        routeResponseShapes,
        deploymentOrigin,
        teacherAuthProviderReadinessBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingRouteChecks.length === 0 &&
    ownershipRouteAuth === "issued-teacher-auth-cookie" &&
    workflowRouteAuth === "issued-teacher-auth-cookie" &&
    evidenceEnvironment === "production" &&
    issuerCookieHardening !== "proved"
  ) {
    return blockedRequirement(
      id,
      "deployment-route-smoke-issuer-cookie-hardening-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingRouteChecks,
        authProviderMode,
        issuerRouteAuth,
        issuerCookieHardening,
        ownershipRouteAuth,
        workflowRouteAuth,
        routeResponseShapes,
        deploymentOrigin,
        teacherAuthProviderReadinessBinding,
      },
    );
  }
  const deploymentFingerprint = evaluateDeploymentFingerprintMatch({
    routeSmoke: evidence,
    deployedTeacherWorkflowUi: deployedTeacherWorkflowEvidence,
  });
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingRouteChecks.length === 0 &&
    ownershipRouteAuth === "issued-teacher-auth-cookie" &&
    workflowRouteAuth === "issued-teacher-auth-cookie" &&
    deploymentFingerprint.status === "blocked"
  ) {
    return blockedRequirement(
      id,
      deploymentFingerprint.blockedReason,
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingRouteChecks,
        authProviderMode,
        issuerRouteAuth,
        issuerCookieHardening,
        ownershipRouteAuth,
        workflowRouteAuth,
        routeResponseShapes,
        deploymentFingerprint: deploymentFingerprint.details,
        deploymentOrigin,
        teacherAuthProviderReadinessBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingRouteChecks.length === 0 &&
    ownershipRouteAuth === "issued-teacher-auth-cookie" &&
    workflowRouteAuth === "issued-teacher-auth-cookie" &&
    evidenceEnvironment === "production" &&
    issuerCookieHardening === "proved" &&
    !routeResponseShapesProved
  ) {
    return blockedRequirement(
      id,
      "deployment-route-smoke-response-shape-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingRouteChecks,
        authProviderMode,
        issuerRouteAuth,
        issuerCookieHardening,
        ownershipRouteAuth,
        workflowRouteAuth,
        routeResponseShapes,
        deploymentOrigin,
        teacherAuthProviderReadinessBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingRouteChecks.length === 0 &&
    ownershipRouteAuth === "issued-teacher-auth-cookie" &&
    workflowRouteAuth === "issued-teacher-auth-cookie" &&
    evidenceEnvironment === "production" &&
    issuerCookieHardening === "proved" &&
    authProviderModeProved &&
    issuerRouteAuthMatchesProvider &&
    routeResponseShapesProved &&
    !routeDirectCallBoundaryProved
  ) {
    return blockedRequirement(
      id,
      "deployment-route-smoke-direct-call-boundary-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingRouteChecks,
        authProviderMode,
        issuerRouteAuth,
        issuerCookieHardening,
        ownershipRouteAuth,
        workflowRouteAuth,
        routeResponseShapes,
        routeDirectCallBoundary,
        routeHelperAuthBoundary,
        deploymentOrigin,
        teacherAuthProviderReadinessBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingRouteChecks.length === 0 &&
    ownershipRouteAuth === "issued-teacher-auth-cookie" &&
    workflowRouteAuth === "issued-teacher-auth-cookie" &&
    evidenceEnvironment === "production" &&
    issuerCookieHardening === "proved" &&
    authProviderModeProved &&
    issuerRouteAuthMatchesProvider &&
    routeResponseShapesProved &&
    routeDirectCallBoundaryProved &&
    !routeHelperAuthBoundaryProved
  ) {
    return blockedRequirement(
      id,
      "deployment-route-smoke-helper-auth-boundary-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingRouteChecks,
        authProviderMode,
        issuerRouteAuth,
        issuerCookieHardening,
        ownershipRouteAuth,
        workflowRouteAuth,
        routeResponseShapes,
        routeDirectCallBoundary,
        routeHelperAuthBoundary,
        deploymentOrigin,
        teacherAuthProviderReadinessBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingRouteChecks.length === 0 &&
    ownershipRouteAuth === "issued-teacher-auth-cookie" &&
    workflowRouteAuth === "issued-teacher-auth-cookie" &&
    evidenceEnvironment === "production" &&
    issuerCookieHardening === "proved" &&
    authProviderModeProved &&
    issuerRouteAuthMatchesProvider &&
    routeResponseShapesProved &&
    routeDirectCallBoundaryProved &&
    routeHelperAuthBoundaryProved &&
    deploymentOrigin.originClass !== "remote-https"
  ) {
    return blockedRequirement(
      id,
      "deployment-route-smoke-origin-not-remote-https",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingRouteChecks,
        authProviderMode,
        issuerRouteAuth,
        issuerCookieHardening,
        ownershipRouteAuth,
        workflowRouteAuth,
        routeResponseShapes,
        routeDirectCallBoundary,
        routeHelperAuthBoundary,
        deploymentOrigin,
        teacherAuthProviderReadinessBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingRouteChecks.length === 0 &&
    ownershipRouteAuth === "issued-teacher-auth-cookie" &&
    workflowRouteAuth === "issued-teacher-auth-cookie" &&
    evidenceEnvironment === "production" &&
    issuerCookieHardening === "proved" &&
    authProviderModeProved &&
    issuerRouteAuthMatchesProvider &&
    routeResponseShapesProved &&
    routeDirectCallBoundaryProved &&
    routeHelperAuthBoundaryProved &&
    deploymentOrigin.originClass === "remote-https" &&
    isRouteSmokeTeacherAuthProviderReadinessBindingMatchedExceptReleaseRun(
      teacherAuthProviderReadinessBinding,
    ) &&
    teacherAuthProviderReadinessBinding.releaseRunIdStatus !== "matched"
  ) {
    return blockedRequirement(
      id,
      "deployment-route-smoke-teacher-auth-readiness-release-run-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingRouteChecks,
        authProviderMode,
        issuerRouteAuth,
        issuerCookieHardening,
        ownershipRouteAuth,
        workflowRouteAuth,
        routeResponseShapes,
        routeDirectCallBoundary,
        routeHelperAuthBoundary,
        deploymentOrigin,
        teacherAuthProviderReadinessBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingRouteChecks.length === 0 &&
    ownershipRouteAuth === "issued-teacher-auth-cookie" &&
    workflowRouteAuth === "issued-teacher-auth-cookie" &&
    evidenceEnvironment === "production" &&
    issuerCookieHardening === "proved" &&
    authProviderModeProved &&
    issuerRouteAuthMatchesProvider &&
    routeResponseShapesProved &&
    routeDirectCallBoundaryProved &&
    routeHelperAuthBoundaryProved &&
    deploymentOrigin.originClass === "remote-https" &&
    !isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    )
  ) {
    return blockedRequirement(
      id,
      "deployment-route-smoke-teacher-auth-readiness-binding-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingRouteChecks,
        authProviderMode,
        issuerRouteAuth,
        issuerCookieHardening,
        ownershipRouteAuth,
        workflowRouteAuth,
        routeResponseShapes,
        routeDirectCallBoundary,
        routeHelperAuthBoundary,
        deploymentOrigin,
        teacherAuthProviderReadinessBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    missingRouteChecks.length === 0 &&
    ownershipRouteAuth === "issued-teacher-auth-cookie" &&
    workflowRouteAuth === "issued-teacher-auth-cookie" &&
    authProviderModeProved &&
    issuerRouteAuthMatchesProvider &&
    routeResponseShapesProved &&
    routeDirectCallBoundaryProved &&
    routeHelperAuthBoundaryProved &&
    deploymentOrigin.originClass === "remote-https" &&
    isRouteSmokeVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    )
  ) {
    return satisfiedRequirement(id, "live-passed", {
      requiredRouteChecks: requiredRouteSmokeIds,
      evidenceEnvironment,
      authProviderMode,
      issuerRouteAuth,
      issuerCookieHardening,
      ownershipRouteAuth,
      workflowRouteAuth,
      routeResponseShapes,
      routeDirectCallBoundary,
      routeHelperAuthBoundary,
      deploymentOrigin,
      teacherAuthProviderReadinessBinding,
      vercelProductionDeploymentBinding,
      ...(deploymentFingerprint.status === "matched"
        ? { deploymentFingerprint: deploymentFingerprint.details }
        : {}),
    });
  }
  return blockedRequirement(id, "deployment-route-smoke-not-live-passed", readEvidenceStatus(evidence), {
    evidenceEnvironment,
    missingRouteChecks,
    authProviderMode,
    issuerRouteAuth,
    issuerCookieHardening,
    ownershipRouteAuth,
    workflowRouteAuth,
    routeResponseShapes,
    deploymentOrigin,
    teacherAuthProviderReadinessBinding,
    vercelProductionDeploymentBinding,
    ...readRouteSmokeUpstreamBlockers(evidence),
  });
}

function readRouteSmokeUpstreamBlockers(evidence) {
  const upstreamBlockedReasons = Array.isArray(evidence.blockedReasons)
    ? evidence.blockedReasons.filter((reason) => typeof reason === "string")
    : [];
  const upstreamPrerequisites = Array.isArray(evidence.prerequisites)
    ? evidence.prerequisites
        .filter(isRecord)
        .map((prerequisite) => ({
          ...(typeof prerequisite.id === "string" ? { id: prerequisite.id } : {}),
          ...(typeof prerequisite.responsibleSession === "string"
            ? { responsibleSession: prerequisite.responsibleSession }
            : {}),
          ...(typeof prerequisite.requiredEnv === "string"
            ? { requiredEnv: prerequisite.requiredEnv }
            : {}),
          ...(typeof prerequisite.requiredEvidence === "string"
            ? { requiredEvidence: prerequisite.requiredEvidence }
            : {}),
          ...(typeof prerequisite.runtime === "string" ? { runtime: prerequisite.runtime } : {}),
          ...(typeof prerequisite.status === "string" ? { status: prerequisite.status } : {}),
          ...(prerequisite.valueRedacted === true ? { valueRedacted: true } : {}),
        }))
        .filter((prerequisite) => Object.keys(prerequisite).length > 0)
    : [];
  return {
    ...(upstreamBlockedReasons.length > 0 ? { upstreamBlockedReasons } : {}),
    ...(upstreamPrerequisites.length > 0 ? { upstreamPrerequisites } : {}),
  };
}

function readRouteSmokeVercelProductionDeploymentBinding(evidence) {
  if (!isRecord(evidence.vercelProductionDeploymentEvidence)) {
    return {
      target: "missing",
      status: "missing",
      deploymentObservationStatus: "missing",
      releaseRunIdStatus: "missing",
      valueRedacted: false,
    };
  }
  const binding = evidence.vercelProductionDeploymentEvidence;
  return {
    target:
      typeof binding.target === "string"
        ? binding.target
        : "missing",
    status:
      typeof binding.status === "string"
        ? binding.status
        : "missing",
    deploymentObservationStatus:
      typeof binding.deploymentObservationStatus === "string"
        ? binding.deploymentObservationStatus
        : "missing",
    releaseRunIdStatus:
      typeof binding.releaseRunIdStatus === "string"
        ? binding.releaseRunIdStatus
        : "missing",
    ...(typeof binding.deploymentDomainReachabilityStatus === "string"
      ? { deploymentDomainReachabilityStatus: binding.deploymentDomainReachabilityStatus }
      : {}),
    valueRedacted: binding.valueRedacted === true,
  };
}

function readDeploymentDomainReachabilityEvidence(evidence) {
  if (!isRecord(evidence.deploymentDomainReachabilityEvidence)) {
    return {
      target: "missing",
      status: "missing",
      releaseRunIdStatus: "missing",
      deploymentFingerprintStatus: "missing",
      valueRedacted: false,
    };
  }
  const binding = evidence.deploymentDomainReachabilityEvidence;
  return {
    target: typeof binding.target === "string" ? binding.target : "missing",
    status: typeof binding.status === "string" ? binding.status : "missing",
    releaseRunIdStatus:
      typeof binding.releaseRunIdStatus === "string"
        ? binding.releaseRunIdStatus
        : "missing",
    deploymentFingerprintStatus:
      typeof binding.deploymentFingerprintStatus === "string"
        ? binding.deploymentFingerprintStatus
        : "missing",
    valueRedacted: binding.valueRedacted === true,
  };
}

function isDeploymentDomainReachabilityEvidenceProved(binding) {
  return (
    binding.target === "deployment-domain-reachability" &&
    binding.status === "matched" &&
    binding.releaseRunIdStatus === "matched" &&
    binding.deploymentFingerprintStatus === "matched" &&
    binding.valueRedacted === true
  );
}

function isDeploymentDomainReachabilityEvidenceMatchedExceptReleaseRun(binding) {
  return (
    binding.target === "deployment-domain-reachability" &&
    binding.status === "matched" &&
    binding.deploymentFingerprintStatus === "matched" &&
    binding.valueRedacted === true
  );
}

function isRouteSmokeVercelProductionDeploymentBindingProved(binding) {
  return (
    binding.target === "vercel-production-deployment" &&
    (binding.status === "matched" || binding.status === "matched-via-domain-reachability") &&
    binding.deploymentObservationStatus === "observed" &&
    binding.releaseRunIdStatus === "matched" &&
    binding.valueRedacted === true
  );
}

function isRouteSmokeVercelProductionDeploymentBindingMatchedExceptReleaseRun(binding) {
  return (
    binding.target === "vercel-production-deployment" &&
    (binding.status === "matched" || binding.status === "matched-via-domain-reachability") &&
    binding.deploymentObservationStatus === "observed" &&
    binding.valueRedacted === true
  );
}

function readRouteSmokeTeacherAuthProviderReadinessBinding(evidence) {
  if (!isRecord(evidence.teacherAuthProviderReadinessEvidence)) {
    return {
      target: "missing",
      status: "missing",
      authProviderMode: "missing",
      releaseRunIdStatus: "missing",
      valueRedacted: false,
    };
  }
  const binding = evidence.teacherAuthProviderReadinessEvidence;
  return {
    target:
      typeof binding.target === "string"
        ? binding.target
        : "missing",
    status:
      typeof binding.status === "string"
        ? binding.status
        : "missing",
    authProviderMode:
      typeof binding.authProviderMode === "string"
        ? binding.authProviderMode
        : "missing",
    releaseRunIdStatus:
      typeof binding.releaseRunIdStatus === "string"
        ? binding.releaseRunIdStatus
        : "missing",
    valueRedacted: binding.valueRedacted === true,
  };
}

function isRouteSmokeTeacherAuthProviderReadinessBindingProved(binding) {
  return (
    binding.target === "teacher-auth-provider-readiness" &&
    binding.status === "matched" &&
    acceptedTeacherAuthProviderModes.includes(binding.authProviderMode) &&
    binding.releaseRunIdStatus === "matched" &&
    binding.valueRedacted === true
  );
}

function isRouteSmokeTeacherAuthProviderReadinessBindingMatchedExceptReleaseRun(binding) {
  return (
    binding.target === "teacher-auth-provider-readiness" &&
    binding.status === "matched" &&
    acceptedTeacherAuthProviderModes.includes(binding.authProviderMode) &&
    binding.valueRedacted === true
  );
}

function readRouteSmokeAppAuthProviderReadinessBinding(evidence) {
  if (!isRecord(evidence.appAuthProviderReadinessEvidence)) {
    return {
      target: "missing",
      status: "missing",
      appAuthProviderMode: "missing",
      releaseRunIdStatus: "missing",
      valueRedacted: false,
    };
  }
  const binding = evidence.appAuthProviderReadinessEvidence;
  return {
    target:
      typeof binding.target === "string"
        ? binding.target
        : "missing",
    status:
      typeof binding.status === "string"
        ? binding.status
        : "missing",
    appAuthProviderMode:
      typeof binding.appAuthProviderMode === "string"
        ? binding.appAuthProviderMode
        : "missing",
    releaseRunIdStatus:
      typeof binding.releaseRunIdStatus === "string"
        ? binding.releaseRunIdStatus
        : "missing",
    valueRedacted: binding.valueRedacted === true,
  };
}

function isRouteSmokeAppAuthProviderReadinessBindingProved(binding) {
  return (
    binding.target === "app-auth-provider-readiness" &&
    binding.status === "matched" &&
    acceptedAppAuthProviderModes.includes(binding.appAuthProviderMode) &&
    binding.releaseRunIdStatus === "matched" &&
    binding.valueRedacted === true
  );
}

function isRouteSmokeAppAuthProviderReadinessBindingMatchedExceptReleaseRun(binding) {
  return (
    binding.target === "app-auth-provider-readiness" &&
    binding.status === "matched" &&
    acceptedAppAuthProviderModes.includes(binding.appAuthProviderMode) &&
    binding.valueRedacted === true
  );
}

function readRouteSmokeExternalStorageServiceReadinessBinding(evidence) {
  if (!isRecord(evidence.externalStorageServiceReadinessEvidence)) {
    return {
      target: "missing",
      status: "missing",
      valueRedacted: false,
      releaseRunIdStatus: "missing",
    };
  }
  const binding = evidence.externalStorageServiceReadinessEvidence;
  const normalized = {
    target:
      typeof binding.target === "string"
        ? binding.target
        : "missing",
    status:
      typeof binding.status === "string"
        ? binding.status
        : "missing",
    valueRedacted: binding.valueRedacted === true,
    releaseRunIdStatus:
      typeof binding.releaseRunIdStatus === "string"
        ? binding.releaseRunIdStatus
        : "missing",
  };
  if (isRecord(binding.productionDatabaseAdapters)) {
    return {
      ...normalized,
      productionDatabaseAdapterStatus:
        typeof binding.productionDatabaseAdapterStatus === "string"
          ? binding.productionDatabaseAdapterStatus
          : "missing",
      productionDatabaseAdapters: {
        teachingOperations: readProductionDatabaseAdapterSummary(
          binding.productionDatabaseAdapters.teachingOperations,
        ),
        teachingCourseManagement: readProductionDatabaseAdapterSummary(
          binding.productionDatabaseAdapters.teachingCourseManagement,
        ),
        teachingCourseAssets: readProductionDatabaseAdapterSummary(
          binding.productionDatabaseAdapters.teachingCourseAssets,
        ),
      },
    };
  }
  return {
    ...normalized,
    ...(typeof binding.productionDatabaseAdapterStatus === "string"
      ? { productionDatabaseAdapterStatus: binding.productionDatabaseAdapterStatus }
      : {}),
    productionDatabaseAdapters: {
      teachingOperations: { status: "missing" },
      teachingCourseManagement: { status: "missing" },
      teachingCourseAssets: { status: "missing" },
    },
  };
}

function isRouteSmokeExternalStorageServiceReadinessBindingProved(binding) {
  return (
    binding.target === "external-storage-service-readiness" &&
    binding.status === "matched" &&
    binding.valueRedacted === true &&
    binding.releaseRunIdStatus === "matched"
  );
}

function isRouteSmokeExternalStorageServiceReadinessBindingMatchedExceptReleaseRun(binding) {
  return (
    binding.target === "external-storage-service-readiness" &&
    binding.status === "matched" &&
    binding.valueRedacted === true
  );
}

function isTeachingOperationsRouteSmokeStorageDatabaseAdapterBindingProved(binding) {
  return (
    binding.productionDatabaseAdapterStatus === "ready" &&
    isProductionDatabaseAdapterSummaryReady(
      binding.productionDatabaseAdapters?.teachingOperations,
    ) &&
    isProductionDatabaseAdapterSummaryReady(
      binding.productionDatabaseAdapters?.teachingCourseManagement,
    ) &&
    isProductionDatabaseAdapterSummaryReady(
      binding.productionDatabaseAdapters?.teachingCourseAssets,
    )
  );
}

function readProductionDatabaseAdapterSummary(value) {
  if (!isRecord(value)) {
    return { status: "missing" };
  }
  return {
    status: typeof value.status === "string" ? value.status : "missing",
    providerClass:
      typeof value.providerClass === "string" ? value.providerClass : "missing",
    migrationStatus:
      typeof value.migrationStatus === "string" ? value.migrationStatus : "missing",
    backupPolicy:
      typeof value.backupPolicy === "string" ? value.backupPolicy : "missing",
    concurrencyControl:
      typeof value.concurrencyControl === "string"
        ? value.concurrencyControl
        : "missing",
    valueRedacted: value.valueRedacted === true,
  };
}

function isProductionDatabaseAdapterSummaryReady(value) {
  return (
    isRecord(value) &&
    value.status === "ready" &&
    value.providerClass === "managed-database" &&
    value.migrationStatus === "up-to-date" &&
    value.backupPolicy === "point-in-time-restore" &&
    value.concurrencyControl === "transactional" &&
    value.valueRedacted === true
  );
}

function readIssuerCookieHardeningStatus(routeResult) {
  if (!isRecord(routeResult)) {
    return "missing";
  }
  if (!isRecord(routeResult.responseHeaders)) {
    return "missing";
  }
  if (routeResult.responseHeaders.status !== "ok") {
    return "failed";
  }
  const requiredHeaders = routeResult.responseHeaders.requiredHeaders;
  if (!isRecord(requiredHeaders)) {
    return "missing";
  }
  return requiredTeacherAuthIssuerHeaderChecks.every(
    (checkName) => requiredHeaders[checkName] === "present",
  )
    ? "proved"
    : "failed";
}

function readResponseShapeStatus(result, requiredFields) {
  if (!isRecord(result)) {
    return "missing";
  }
  if (!isRecord(result.responseShape)) {
    return "missing";
  }
  if (result.responseShape.checked !== true || result.responseShape.status !== "ok") {
    return "failed";
  }
  const presentFields = result.responseShape.requiredFields;
  if (!isRecord(presentFields)) {
    return "missing";
  }
  return requiredFields.every((field) => presentFields[field] === "present")
    ? "proved"
    : "failed";
}

function readTeacherAiDirectCallBoundaryStatus(routeResult) {
  if (!isRecord(routeResult)) {
    return "missing";
  }
  if (!isRecord(routeResult.directCallBoundary)) {
    return "missing";
  }
  const boundary = routeResult.directCallBoundary;
  if (
    boundary.checked !== true ||
    boundary.status !== "ok" ||
    boundary.valuesRedacted !== true ||
    !isSignedSessionDeniedProbe(boundary, requiredTeacherAiDirectCallBoundaryProbes[0])
  ) {
    return "failed";
  }
  const probes = Array.isArray(boundary.probes) ? boundary.probes : [];
  const allRequiredProbesPassed = requiredTeacherAiDirectCallBoundaryProbes.every(
    (requiredProbe) => probes.some((probe) => isSignedSessionDeniedProbe(probe, requiredProbe)),
  );
  const legacyScopedHeaderPolicyProved =
    isRecord(boundary.legacyScopedHeaderPolicy) &&
    boundary.legacyScopedHeaderPolicy.actorHeaders === "legacy-scoped-ai-access" &&
    boundary.legacyScopedHeaderPolicy.expectedResult === "signed-session-required" &&
    boundary.legacyScopedHeaderPolicy.valuesRedacted === true;
  const legacyScopedHeaderProbes = Array.isArray(boundary.legacyScopedHeaderProbes)
    ? boundary.legacyScopedHeaderProbes
    : [];
  const allRequiredLegacyScopedHeaderProbesPassed =
    requiredTeacherAiDirectCallBoundaryProbes.every((requiredProbe) =>
      legacyScopedHeaderProbes.some((probe) =>
        isSignedSessionDeniedProbe(probe, requiredProbe),
      ),
    );
  const adminRoutePolicyProved =
    isRecord(boundary.adminRoutePolicy) &&
    boundary.adminRoutePolicy.routes === "signed-admin-ai-access-required" &&
    boundary.adminRoutePolicy.expectedResult === "signed-session-required" &&
    boundary.adminRoutePolicy.valuesRedacted === true;
  const adminRouteProbes = Array.isArray(boundary.adminRouteProbes)
    ? boundary.adminRouteProbes
    : [];
  const allRequiredAdminRouteProbesPassed =
    requiredTeacherAiAdminRouteDirectCallProbes.every((requiredProbe) =>
      adminRouteProbes.some((probe) => isSignedSessionDeniedProbe(probe, requiredProbe)),
    );
  const legacyScopedHeaderAdminRouteProbes = Array.isArray(
    boundary.legacyScopedHeaderAdminRouteProbes,
  )
    ? boundary.legacyScopedHeaderAdminRouteProbes
    : [];
  const allRequiredLegacyScopedHeaderAdminRouteProbesPassed =
    requiredTeacherAiAdminRouteDirectCallProbes.every((requiredProbe) =>
      legacyScopedHeaderAdminRouteProbes.some((probe) =>
        isSignedSessionDeniedProbe(probe, requiredProbe),
      ),
    );
  return allRequiredProbesPassed &&
    legacyScopedHeaderPolicyProved &&
    allRequiredLegacyScopedHeaderProbesPassed &&
    adminRoutePolicyProved &&
    allRequiredAdminRouteProbesPassed &&
    allRequiredLegacyScopedHeaderAdminRouteProbesPassed
    ? "proved"
    : "failed";
}

function readTeacherAiHelperAuthBoundaryStatus(routeResult) {
  if (!isRecord(routeResult)) {
    return "missing";
  }
  if (!isRecord(routeResult.directCallBoundary)) {
    return "missing";
  }
  const boundary = routeResult.directCallBoundary;
  const teacherCookieRoutePolicyProved =
    isRecord(boundary.teacherCookieRoutePolicy) &&
    boundary.teacherCookieRoutePolicy.routes === "signed-teacher-cookie-required" &&
    boundary.teacherCookieRoutePolicy.expectedResult === "authenticated-session-required" &&
    boundary.teacherCookieRoutePolicy.valuesRedacted === true;
  const teacherCookieRouteProbes = Array.isArray(boundary.teacherCookieRouteProbes)
    ? boundary.teacherCookieRouteProbes
    : [];
  const allRequiredTeacherCookieRouteProbesPassed =
    requiredTeacherAiTeacherCookieRouteProbes.every((requiredProbe) =>
      teacherCookieRouteProbes.some((probe) =>
        isExpectedDeniedProbe(probe, requiredProbe),
      ),
    );
  const legacyScopedHeaderTeacherCookieRouteProbes = Array.isArray(
    boundary.legacyScopedHeaderTeacherCookieRouteProbes,
  )
    ? boundary.legacyScopedHeaderTeacherCookieRouteProbes
    : [];
  const allRequiredLegacyScopedHeaderTeacherCookieRouteProbesPassed =
    requiredTeacherAiTeacherCookieRouteProbes.every((requiredProbe) =>
      legacyScopedHeaderTeacherCookieRouteProbes.some((probe) =>
        isExpectedDeniedProbe(probe, requiredProbe),
      ),
    );
  if (
    !isRecord(boundary.teacherCookieRoutePolicy) ||
    teacherCookieRouteProbes.length === 0 ||
    legacyScopedHeaderTeacherCookieRouteProbes.length === 0
  ) {
    return "missing";
  }
  return (
    teacherCookieRoutePolicyProved &&
    allRequiredTeacherCookieRouteProbesPassed &&
    allRequiredLegacyScopedHeaderTeacherCookieRouteProbesPassed
  )
    ? "proved"
    : "failed";
}

function isSignedSessionDeniedProbe(probe, requiredProbe) {
  return isExpectedDeniedProbe(probe, {
    ...requiredProbe,
    expectedStatus: 403,
    reasonCode: "signed-session-required",
  });
}

function isExpectedDeniedProbe(probe, requiredProbe) {
  return (
    isRecord(probe) &&
    probe.status === "ok" &&
    probe.route === requiredProbe.route &&
    probe.method === requiredProbe.method &&
    probe.expectedStatus === requiredProbe.expectedStatus &&
    probe.httpStatus === requiredProbe.expectedStatus &&
    probe.reasonCode === requiredProbe.reasonCode &&
    probe.valuesRedacted === true
  );
}

function evaluateDeploymentFingerprintMatch({ routeSmoke, deployedTeacherWorkflowUi }) {
  if (
    !isProductionLivePassed(routeSmoke) ||
    !isProductionLivePassed(deployedTeacherWorkflowUi)
  ) {
    return { status: "not-applicable" };
  }

  const routeFingerprint = readDeploymentFingerprint(routeSmoke);
  const pageFingerprint = readDeploymentFingerprint(deployedTeacherWorkflowUi);
  if (!routeFingerprint || !pageFingerprint) {
    return {
      status: "blocked",
      blockedReason: "deployment-fingerprint-missing",
      details: {
        routeSmoke: routeFingerprint ? "present" : "missing",
        deployedTeacherWorkflowUi: pageFingerprint ? "present" : "missing",
      },
    };
  }

  if (routeFingerprint !== pageFingerprint) {
    return {
      status: "blocked",
      blockedReason: "deployment-fingerprint-mismatch",
      details: {
        routeSmoke: "present",
        deployedTeacherWorkflowUi: "present",
        match: false,
      },
    };
  }

  return {
    status: "matched",
    details: {
      routeSmoke: "present",
      deployedTeacherWorkflowUi: "present",
      match: true,
    },
  };
}

function evaluateVercelDeploymentFingerprintMatch({ deployedTeacherWorkflowUi, vercelProductionDeployment }) {
  if (
    !isProductionLivePassed(deployedTeacherWorkflowUi) ||
    !isProductionDeploymentDeployed(vercelProductionDeployment)
  ) {
    return { status: "not-applicable" };
  }

  const pageFingerprint = readDeploymentFingerprint(deployedTeacherWorkflowUi);
  const vercelFingerprint = readDeploymentFingerprint(vercelProductionDeployment);
  if (!pageFingerprint || !vercelFingerprint) {
    return {
      status: "blocked",
      blockedReason: "vercel-production-deployment-fingerprint-missing",
      details: {
        vercelProductionDeployment: vercelFingerprint ? "present" : "missing",
        deployedTeacherWorkflowUi: pageFingerprint ? "present" : "missing",
      },
    };
  }

  if (pageFingerprint !== vercelFingerprint) {
    return {
      status: "blocked",
      blockedReason: "vercel-production-deployment-fingerprint-mismatch",
      details: {
        vercelProductionDeployment: "present",
        deployedTeacherWorkflowUi: "present",
        match: false,
      },
    };
  }

  return {
    status: "matched",
    details: {
      vercelProductionDeployment: "present",
      deployedTeacherWorkflowUi: "present",
      match: true,
    },
  };
}

function evaluateBrowserDeploymentFingerprintMatch({ browserSmoke, deployedTeacherWorkflowUi }) {
  const browserFingerprint = readDeploymentFingerprint(browserSmoke);
  const pageFingerprint = readDeploymentFingerprint(deployedTeacherWorkflowUi);
  if (!browserFingerprint || !pageFingerprint) {
    return {
      status: "blocked",
      blockedReason: "teacher-workflow-browser-smoke-fingerprint-missing",
      details: {
        teacherWorkflowBrowserUi: browserFingerprint ? "present" : "missing",
        deployedTeacherWorkflowUi: pageFingerprint ? "present" : "missing",
      },
    };
  }

  if (browserFingerprint !== pageFingerprint) {
    return {
      status: "blocked",
      blockedReason: "teacher-workflow-browser-smoke-fingerprint-mismatch",
      details: {
        teacherWorkflowBrowserUi: "present",
        deployedTeacherWorkflowUi: "present",
        match: false,
      },
    };
  }

  return {
    status: "matched",
    details: {
      teacherWorkflowBrowserUi: "present",
      deployedTeacherWorkflowUi: "present",
      match: true,
    },
  };
}

function evaluateLearningPptDeploymentFingerprintMatch({
  learningPptPlayback,
  vercelProductionDeployment,
}) {
  if (!isProductionDeploymentDeployed(vercelProductionDeployment)) {
    return { status: "not-applicable" };
  }

  const learningFingerprint = readDeploymentFingerprint(learningPptPlayback);
  const vercelFingerprint = readDeploymentFingerprint(vercelProductionDeployment);
  if (!learningFingerprint || !vercelFingerprint) {
    return {
      status: "blocked",
      details: {
        learningPptPlayback: learningFingerprint ? "present" : "missing",
        vercelProductionDeployment: vercelFingerprint ? "present" : "missing",
      },
    };
  }

  if (learningFingerprint !== vercelFingerprint) {
    return {
      status: "blocked",
      details: {
        learningPptPlayback: "present",
        vercelProductionDeployment: "present",
        match: false,
      },
    };
  }

  return {
    status: "matched",
    details: {
      learningPptPlayback: "present",
      vercelProductionDeployment: "present",
      match: true,
    },
  };
}

function evaluatePptDeploymentFingerprintMatch({ pptAcceptance, vercelProductionDeployment }) {
  if (!isProductionDeploymentDeployed(vercelProductionDeployment)) {
    return { status: "not-applicable" };
  }

  const pptFingerprint = readDeploymentFingerprint(pptAcceptance);
  const vercelFingerprint = readDeploymentFingerprint(vercelProductionDeployment);
  if (!pptFingerprint || !vercelFingerprint) {
    return {
      status: "blocked",
      details: {
        pptAcceptance: pptFingerprint ? "present" : "missing",
        vercelProductionDeployment: vercelFingerprint ? "present" : "missing",
      },
    };
  }

  if (pptFingerprint !== vercelFingerprint) {
    return {
      status: "blocked",
      details: {
        pptAcceptance: "present",
        vercelProductionDeployment: "present",
        match: false,
      },
    };
  }

  return {
    status: "matched",
    details: {
      pptAcceptance: "present",
      vercelProductionDeployment: "present",
      match: true,
    },
  };
}

function isProductionLivePassed(evidence) {
  return (
    isRecord(evidence) &&
    evidence.mode === "live" &&
    evidence.environment === "production" &&
    evidence.status === "passed"
  );
}

function isDeployedTeacherWorkflowUiProductionPassed(evidence, vercelProductionDeployment) {
  if (!isProductionLivePassed(evidence)) {
    return false;
  }
  if (evidence.target !== "teacher-workflow-deployment-smoke") {
    return false;
  }
  const results = isRecord(evidence.results) ? evidence.results : {};
  const hasRequiredAnchors = requiredDeployedTeacherWorkflowAnchors.every(
    (anchor) => results[anchor] === "present",
  );
  if (!hasRequiredAnchors) {
    return false;
  }
  if (!readDeploymentFingerprint(evidence) || !readRenderedPageFingerprint(evidence)) {
    return false;
  }
  const deploymentOrigin = readDeploymentOrigin(evidence);
  if (deploymentOrigin.originClass !== "remote-https") {
    return false;
  }
  const vercelDeploymentFingerprint = evaluateVercelDeploymentFingerprintMatch({
    deployedTeacherWorkflowUi: evidence,
    vercelProductionDeployment,
  });
  if (vercelDeploymentFingerprint.status === "blocked") {
    return false;
  }
  return isDeployedTeacherWorkflowVercelProductionDeploymentBindingProved(
    readDeployedTeacherWorkflowVercelProductionDeploymentBinding(evidence),
  );
}

function isTeacherWorkflowBrowserUiProductionPassed(
  evidence,
  deployedTeacherWorkflowUi,
  vercelProductionDeployment,
) {
  if (!isProductionLivePassed(evidence)) {
    return false;
  }
  if (evidence.target !== "teacher-workflow-browser-smoke") {
    return false;
  }
  if (
    !isDeployedTeacherWorkflowUiProductionPassed(
      deployedTeacherWorkflowUi,
      vercelProductionDeployment,
    )
  ) {
    return false;
  }
  const results = isRecord(evidence.results) ? evidence.results : {};
  const hasRequiredInteractions = requiredTeacherWorkflowBrowserResults.every(
    (interaction) => results[interaction] === "passed",
  );
  if (!hasRequiredInteractions) {
    return false;
  }
  const deploymentFingerprint = evaluateBrowserDeploymentFingerprintMatch({
    browserSmoke: evidence,
    deployedTeacherWorkflowUi,
  });
  if (deploymentFingerprint.status !== "matched") {
    return false;
  }
  const deploymentOrigin = readDeploymentOrigin(evidence);
  if (deploymentOrigin.originClass !== "remote-https") {
    return false;
  }
  const apiInterceptionPolicy = readBrowserApiInterceptionPolicy(evidence);
  const vercelProductionDeploymentBinding =
    readTeacherWorkflowBrowserVercelProductionDeploymentBinding(evidence);
  return (
    apiInterceptionPolicy.workflowApis === "live-workflow-status" &&
    apiInterceptionPolicy.remoteMutations === "fixture-blocked" &&
    apiInterceptionPolicy.responseBodiesOmitted === true &&
    isTeacherWorkflowBrowserVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    )
  );
}

function isTeacherWorkflowLiveGenerationProductionPassed(
  evidence,
  teacherWorkflowBrowserUi,
  deployedTeacherWorkflowUi,
  vercelProductionDeployment,
) {
  const requirement = evaluateTeacherWorkflowLiveGeneration(
    evidence,
    teacherWorkflowBrowserUi,
    deployedTeacherWorkflowUi,
    vercelProductionDeployment,
  );
  return (
    requirement.status === "satisfied" &&
    requirement.evidenceStatus === "live-passed"
  );
}

function isRouteSmokeProductionPassed(
  evidence,
  deployedTeacherWorkflowUi,
  vercelProductionDeployment,
) {
  if (
    !isDeployedTeacherWorkflowUiProductionPassed(
      deployedTeacherWorkflowUi,
      vercelProductionDeployment,
    )
  ) {
    return false;
  }
  const routeRequirement = evaluateRouteSmoke(evidence, deployedTeacherWorkflowUi);
  return (
    routeRequirement.status === "satisfied" &&
    routeRequirement.evidenceStatus === "live-passed"
  );
}

function isLearningPptPlaybackProductionPassed(evidence) {
  if (!isProductionLivePassed(evidence)) {
    return false;
  }
  if (evidence.target !== "learning-ppt-playback-deployment-smoke") {
    return false;
  }
  const deploymentOrigin = readDeploymentOrigin(evidence);
  if (deploymentOrigin.originClass !== "remote-https") {
    return false;
  }
  if (!readDeploymentFingerprint(evidence)) {
    return false;
  }
  if (
    !isLearningPptVercelProductionDeploymentBindingProved(
      readLearningPptVercelProductionDeploymentBinding(evidence),
    )
  ) {
    return false;
  }
  const results = isRecord(evidence.results) ? evidence.results : {};
  if (!requiredLearningPptPlaybackResults.every((result) => results[result] === "passed")) {
    return false;
  }
  const playback = isRecord(evidence.playback) ? evidence.playback : {};
  const audio = isRecord(evidence.audio) ? evidence.audio : {};
  const httpStatus = readLearningPptPlaybackHttpStatus(evidence);
  if (!isLearningPptPlaybackHttpStatusProved(httpStatus)) {
    return false;
  }
  return (
    playback.courseId === "elementary-math-research" &&
    playback.audioManifestId === expectedLearningPptAudioManifestId &&
    playback.teacherName === "康霞博士" &&
    playback.voiceLabel === "康霞博士克隆声音" &&
    playback.slideCount === 19 &&
    playback.firstSlideTitle === "自然数的序数理论" &&
    playback.lastSlideTitle === "作业布置" &&
    playback.firstAudioUrl === expectedLearningPptFirstAudioUrl &&
    isLearningPptAudioContentType(audio.contentType) &&
    Number.isFinite(audio.contentLength) &&
    audio.contentLength >= minimumLearningPptFirstAudioContentLength &&
    audio.wavHeader === "RIFF/WAVE"
  );
}

function isLearningPptAudioContentType(value) {
  return typeof value === "string" && /^audio\/(wav|wave|x-wav)(?:\s*;|$)/i.test(value);
}

function isProductionDeploymentDeployed(evidence) {
  if (!isRecord(evidence)) {
    return false;
  }
  const deploymentFingerprint = readDeploymentFingerprint(evidence);
  const deploymentOrigin = readDeploymentOrigin(evidence);
  const redactionSafety = readVercelProductionDeploymentSafety(evidence);
  const redactionSafetyProved = Object.values(redactionSafety).every(
    (status) => status === "proved",
  );
  const projectReadinessGuard = readVercelProductionDeploymentProjectReadinessGuard(evidence);
  const envSyncGuard = readVercelProductionDeploymentEnvSyncGuard(evidence);
  const envSyncApplyPreflightGuard =
    readVercelProductionDeploymentEnvSyncApplyPreflightGuard(evidence);
  const deploymentObservationStatus = readVercelProductionDeploymentObservationStatus(evidence);
  return (
    evidence.target === "vercel-production-deployment" &&
    evidence.mode === "live" &&
    evidence.environment === "production" &&
    evidence.status === "deployed" &&
    Boolean(deploymentFingerprint) &&
    deploymentOrigin.originClass === "remote-https" &&
    projectReadinessGuard === "proved" &&
    envSyncGuard === "proved" &&
    envSyncApplyPreflightGuard === "proved" &&
    deploymentObservationStatus === "proved" &&
    redactionSafetyProved
  );
}

function readDeploymentFingerprint(evidence) {
  if (!isRecord(evidence) || !isRecord(evidence.deploymentFingerprint)) {
    return undefined;
  }
  const fingerprint = evidence.deploymentFingerprint;
  if (
    fingerprint.status === "present" &&
    typeof fingerprint.value === "string" &&
    /^sha256:[a-f0-9]{16}$/.test(fingerprint.value)
  ) {
    return fingerprint.value;
  }
  return undefined;
}

function readRenderedPageFingerprint(evidence) {
  if (!isRecord(evidence) || !isRecord(evidence.renderedPageFingerprint)) {
    return undefined;
  }
  const fingerprint = evidence.renderedPageFingerprint;
  if (
    fingerprint.status === "present" &&
    typeof fingerprint.value === "string" &&
    /^sha256:[a-f0-9]{16}$/.test(fingerprint.value)
  ) {
    return fingerprint.value;
  }
  return undefined;
}

function readStorageServiceFingerprint(evidence) {
  if (!isRecord(evidence) || !isRecord(evidence.storageServiceFingerprint)) {
    return undefined;
  }
  return readOriginSha256Fingerprint(evidence.storageServiceFingerprint);
}

function readOriginSha256Fingerprint(fingerprint) {
  if (
    isRecord(fingerprint) &&
    fingerprint.status === "present" &&
    typeof fingerprint.value === "string" &&
    /^sha256:[a-f0-9]{16}$/.test(fingerprint.value) &&
    fingerprint.source === "origin" &&
    fingerprint.valueRedacted === true
  ) {
    return fingerprint.value;
  }
  return undefined;
}

function readBrowserApiInterceptionPolicy(evidence) {
  if (!isRecord(evidence) || !isRecord(evidence.apiInterceptionPolicy)) {
    return {
      workflowApis: "missing",
      remoteMutations: "missing",
      responseBodiesOmitted: false,
    };
  }
  return {
    workflowApis:
      typeof evidence.apiInterceptionPolicy.workflowApis === "string"
        ? evidence.apiInterceptionPolicy.workflowApis
        : "missing",
    remoteMutations:
      typeof evidence.apiInterceptionPolicy.remoteMutations === "string"
        ? evidence.apiInterceptionPolicy.remoteMutations
        : "missing",
    responseBodiesOmitted: evidence.apiInterceptionPolicy.responseBodiesOmitted === true,
  };
}

function readLiveGenerationProviderMutationPolicy(evidence) {
  if (!isRecord(evidence) || !isRecord(evidence.providerMutationPolicy)) {
    return {
      workflowApis: "missing",
      remoteMutations: "missing",
      liveProviderApproved: false,
      responseBodiesOmitted: false,
      providerTaskIdsRedacted: false,
    };
  }
  return {
    workflowApis:
      typeof evidence.providerMutationPolicy.workflowApis === "string"
        ? evidence.providerMutationPolicy.workflowApis
        : "missing",
    remoteMutations:
      typeof evidence.providerMutationPolicy.remoteMutations === "string"
        ? evidence.providerMutationPolicy.remoteMutations
        : "missing",
    liveProviderApproved: evidence.providerMutationPolicy.liveProviderApproved === true,
    responseBodiesOmitted: evidence.providerMutationPolicy.responseBodiesOmitted === true,
    providerTaskIdsRedacted:
      evidence.providerMutationPolicy.providerTaskIdsRedacted === true,
  };
}

function readLiveGenerationSafety(evidence) {
  const safety = isRecord(evidence) && isRecord(evidence.safety) ? evidence.safety : {};
  return {
    valuesRedacted: safety.valuesRedacted === true ? "proved" : "missing",
    providerTaskIdsRedacted:
      safety.providerTaskIdsRedacted === true ? "proved" : "missing",
    cookieValuesOmitted:
      safety.cookieValuesOmitted === true ? "proved" : "missing",
    responseBodiesOmitted:
      safety.responseBodiesOmitted === true ? "proved" : "missing",
    liveRequiresApproval:
      safety.liveRequiresApproval === true ? "proved" : "missing",
    remoteMutationRequiresApproval:
      safety.remoteMutationRequiresApproval === true ? "proved" : "missing",
  };
}

function evaluateTeachingOperationsRouteSmoke(evidence) {
  const id = "teaching-operations-route-smoke";
  if (!isRecord(evidence)) {
    return blockedRequirement(
      id,
      "teaching-operations-route-smoke-evidence-missing",
      "missing",
    );
  }
  if (evidence.target !== "teaching-operations-route-smoke") {
    return blockedRequirement(
      id,
      "teaching-operations-route-smoke-evidence-target-mismatch",
      readEvidenceStatus(evidence),
      {
        evidenceTarget: typeof evidence.target === "string" ? evidence.target : "missing",
      },
    );
  }

  const evidenceEnvironment =
    typeof evidence.environment === "string" ? evidence.environment : "unspecified";
  const requiredResults = readTeachingOperationsRouteSmokeResults(evidence);
  const resultsProved = Object.values(requiredResults).every((status) => status === "passed");
  const requiredProofs = readTeachingOperationsRouteSmokeProofs(evidence);
  const proofContractProved = Object.values(requiredProofs).every(
    (status) => status === "proved",
  );
  const requiredEnv = readTeachingOperationsRouteSmokeRequiredEnv(evidence);
  const requiredEnvProved = Object.values(requiredEnv).every(
    (status) => status === "present",
  );
  const safety = readTeachingOperationsRouteSmokeSafety(evidence);
  const safetyProved = Object.values(safety).every((status) => status === "proved");
  const route = evidence.route === "/api/teaching/operations" ? evidence.route : "missing";
  const routeStatus = readTeachingOperationsRouteSmokeRouteStatus(evidence);
  const releaseRunIdStatus = readReleaseRunId(evidence) ? "present" : "missing";
  const vercelProductionDeploymentBinding =
    readRouteSmokeVercelProductionDeploymentBinding(evidence);
  const deploymentDomainReachabilityEvidence =
    readDeploymentDomainReachabilityEvidence(evidence);
  const teacherAuthProviderReadinessBinding =
    readRouteSmokeTeacherAuthProviderReadinessBinding(evidence);
  const appAuthProviderReadinessBinding =
    readRouteSmokeAppAuthProviderReadinessBinding(evidence);
  const externalStorageServiceReadinessEvidence =
    readRouteSmokeExternalStorageServiceReadinessBinding(evidence);
  const deploymentOrigin = readDeploymentOrigin(evidence);
  const teachingOperationsBackend =
    evidence.teachingOperationsBackend === "external" ? "external" : "missing";
  const teachingCourseManagementBackend =
    evidence.teachingCourseManagementBackend === "external" ? "external" : "missing";
  const teacherIdStatus =
    typeof evidence.teacherId === "string" &&
    evidence.teacherId.trim().length > 0 &&
    evidence.teacherId !== "not-proven"
      ? "present"
      : "missing";
  const auth =
    evidence.auth === "issued-teacher-auth-cookie"
      ? "issued-teacher-auth-cookie"
      : evidence.auth === "signed-teacher-auth-cookie"
        ? "signed-teacher-auth-cookie"
        : "missing";
  const teachingOperationsDetails = {
    evidenceEnvironment,
    route,
    routes: routeStatus,
    requiredResults,
    requiredProofs,
    requiredEnv,
    safety,
    releaseRunIdStatus,
    vercelProductionDeploymentBinding,
    deploymentDomainReachabilityEvidence,
    teacherAuthProviderReadinessBinding,
    appAuthProviderReadinessBinding,
    externalStorageServiceReadinessEvidence,
    deploymentOrigin,
    teachingOperationsBackend,
    teachingCourseManagementBackend,
    teacherIdStatus,
    auth,
  };

  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    resultsProved &&
    evidenceEnvironment !== "production"
  ) {
    return blockedRequirement(
      id,
      "teaching-operations-route-smoke-not-production",
      readEvidenceStatus(evidence),
      teachingOperationsDetails,
    );
  }
    if (
      evidence.mode === "live" &&
      evidence.status === "passed" &&
      evidenceEnvironment === "production" &&
    !resultsProved
  ) {
    return blockedRequirement(
      id,
      "teaching-operations-route-smoke-results-not-proven",
      readEvidenceStatus(evidence),
      teachingOperationsDetails,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route !== "/api/teaching/operations"
  ) {
    return blockedRequirement(
      id,
      "teaching-operations-route-smoke-route-not-proven",
      readEvidenceStatus(evidence),
      teachingOperationsDetails,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route === "/api/teaching/operations" &&
    safetyProved &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    ) &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    isRouteSmokeAppAuthProviderReadinessBindingMatchedExceptReleaseRun(
      appAuthProviderReadinessBinding,
    ) &&
    appAuthProviderReadinessBinding.releaseRunIdStatus !== "matched"
  ) {
    return blockedRequirement(
      id,
      "teaching-operations-route-smoke-app-auth-readiness-release-run-not-proven",
      readEvidenceStatus(evidence),
      teachingOperationsDetails,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route === "/api/teaching/operations" &&
    safetyProved &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    ) &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    isRouteSmokeAppAuthProviderReadinessBindingProved(
      appAuthProviderReadinessBinding,
    ) &&
    auth !== "issued-teacher-auth-cookie"
  ) {
    return blockedRequirement(
      id,
      "teaching-operations-route-smoke-auth-not-issued-teacher-cookie",
      readEvidenceStatus(evidence),
      teachingOperationsDetails,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route === "/api/teaching/operations" &&
    safetyProved &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    ) &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    !isRouteSmokeAppAuthProviderReadinessBindingProved(
      appAuthProviderReadinessBinding,
    )
  ) {
    return blockedRequirement(
      id,
      "teaching-operations-route-smoke-app-auth-readiness-binding-not-proven",
      readEvidenceStatus(evidence),
      teachingOperationsDetails,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route === "/api/teaching/operations" &&
    !safetyProved
  ) {
    return blockedRequirement(
      id,
      "teaching-operations-route-smoke-redaction-not-proven",
      readEvidenceStatus(evidence),
      teachingOperationsDetails,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route === "/api/teaching/operations" &&
    safetyProved &&
    releaseRunIdStatus !== "present"
  ) {
    return blockedRequirement(
      id,
      "teaching-operations-route-smoke-release-run-not-proven",
      readEvidenceStatus(evidence),
      teachingOperationsDetails,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route === "/api/teaching/operations" &&
    safetyProved &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeVercelProductionDeploymentBindingMatchedExceptReleaseRun(
      vercelProductionDeploymentBinding,
    ) &&
    !isRouteSmokeVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    )
  ) {
    return blockedRequirement(
      id,
      "teaching-operations-route-smoke-vercel-deployment-release-run-not-proven",
      readEvidenceStatus(evidence),
      teachingOperationsDetails,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route === "/api/teaching/operations" &&
    safetyProved &&
    releaseRunIdStatus === "present" &&
    !isRouteSmokeVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    )
  ) {
    return blockedRequirement(
      id,
      "teaching-operations-route-smoke-vercel-deployment-binding-not-proven",
      readEvidenceStatus(evidence),
      teachingOperationsDetails,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route === "/api/teaching/operations" &&
    safetyProved &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    ) &&
    isRouteSmokeTeacherAuthProviderReadinessBindingMatchedExceptReleaseRun(
      teacherAuthProviderReadinessBinding,
    ) &&
    teacherAuthProviderReadinessBinding.releaseRunIdStatus !== "matched"
  ) {
    return blockedRequirement(
      id,
      "teaching-operations-route-smoke-teacher-auth-readiness-release-run-not-proven",
      readEvidenceStatus(evidence),
      teachingOperationsDetails,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route === "/api/teaching/operations" &&
    safetyProved &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    ) &&
    !isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    )
  ) {
    return blockedRequirement(
      id,
      "teaching-operations-route-smoke-teacher-auth-readiness-binding-not-proven",
      readEvidenceStatus(evidence),
      teachingOperationsDetails,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route === "/api/teaching/operations" &&
    safetyProved &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    ) &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    teachingCourseManagementBackend !== "external"
  ) {
    return blockedRequirement(
      id,
      "teaching-operations-route-smoke-course-management-backend-not-proven",
      readEvidenceStatus(evidence),
      teachingOperationsDetails,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route === "/api/teaching/operations" &&
    safetyProved &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    ) &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    teachingCourseManagementBackend === "external" &&
    deploymentOrigin.originClass !== "remote-https"
  ) {
    return blockedRequirement(
      id,
      "teaching-operations-route-smoke-origin-not-remote-https",
      readEvidenceStatus(evidence),
      teachingOperationsDetails,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route === "/api/teaching/operations" &&
    safetyProved &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    ) &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    teachingCourseManagementBackend === "external" &&
    deploymentOrigin.originClass === "remote-https" &&
    teachingOperationsBackend !== "external"
  ) {
    return blockedRequirement(
      id,
      "teaching-operations-route-smoke-operations-backend-not-proven",
      readEvidenceStatus(evidence),
      teachingOperationsDetails,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route === "/api/teaching/operations" &&
    safetyProved &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    ) &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    teachingCourseManagementBackend === "external" &&
    deploymentOrigin.originClass === "remote-https" &&
    teachingOperationsBackend === "external" &&
    teacherIdStatus !== "present"
  ) {
    return blockedRequirement(
      id,
      "teaching-operations-route-smoke-teacher-id-not-proven",
      readEvidenceStatus(evidence),
      teachingOperationsDetails,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route === "/api/teaching/operations" &&
    safetyProved &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    ) &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    teachingCourseManagementBackend === "external" &&
    deploymentOrigin.originClass === "remote-https" &&
    teachingOperationsBackend === "external" &&
    teacherIdStatus === "present" &&
    isRouteSmokeExternalStorageServiceReadinessBindingMatchedExceptReleaseRun(
      externalStorageServiceReadinessEvidence,
    ) &&
    externalStorageServiceReadinessEvidence.releaseRunIdStatus !== "matched"
  ) {
    return blockedRequirement(
      id,
      "teaching-operations-route-smoke-storage-readiness-release-run-not-proven",
      readEvidenceStatus(evidence),
      teachingOperationsDetails,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route === "/api/teaching/operations" &&
    safetyProved &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    ) &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    teachingCourseManagementBackend === "external" &&
    deploymentOrigin.originClass === "remote-https" &&
    teachingOperationsBackend === "external" &&
    teacherIdStatus === "present" &&
    !isRouteSmokeExternalStorageServiceReadinessBindingProved(
      externalStorageServiceReadinessEvidence,
    )
  ) {
    return blockedRequirement(
      id,
      "teaching-operations-route-smoke-storage-readiness-binding-not-proven",
      readEvidenceStatus(evidence),
      teachingOperationsDetails,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route === "/api/teaching/operations" &&
    safetyProved &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    ) &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    teachingCourseManagementBackend === "external" &&
    deploymentOrigin.originClass === "remote-https" &&
    teachingOperationsBackend === "external" &&
    teacherIdStatus === "present" &&
    isRouteSmokeExternalStorageServiceReadinessBindingProved(
      externalStorageServiceReadinessEvidence,
    ) &&
    !isTeachingOperationsRouteSmokeStorageDatabaseAdapterBindingProved(
      externalStorageServiceReadinessEvidence,
    )
  ) {
    return blockedRequirement(
      id,
      "teaching-operations-route-smoke-storage-database-adapter-binding-not-proven",
      readEvidenceStatus(evidence),
      teachingOperationsDetails,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route === "/api/teaching/operations" &&
    safetyProved &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    ) &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    teachingCourseManagementBackend === "external" &&
    deploymentOrigin.originClass === "remote-https" &&
    teachingOperationsBackend === "external" &&
    teacherIdStatus === "present" &&
    isRouteSmokeExternalStorageServiceReadinessBindingProved(
      externalStorageServiceReadinessEvidence,
    ) &&
    isTeachingOperationsRouteSmokeStorageDatabaseAdapterBindingProved(
      externalStorageServiceReadinessEvidence,
    ) &&
    isDeploymentDomainReachabilityEvidenceMatchedExceptReleaseRun(
      deploymentDomainReachabilityEvidence,
    ) &&
    deploymentDomainReachabilityEvidence.releaseRunIdStatus !== "matched"
  ) {
    return blockedRequirement(
      id,
      "teaching-operations-route-smoke-deployment-domain-reachability-release-run-not-proven",
      readEvidenceStatus(evidence),
      teachingOperationsDetails,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route === "/api/teaching/operations" &&
    safetyProved &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    ) &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    teachingCourseManagementBackend === "external" &&
    deploymentOrigin.originClass === "remote-https" &&
    teachingOperationsBackend === "external" &&
    teacherIdStatus === "present" &&
    isRouteSmokeExternalStorageServiceReadinessBindingProved(
      externalStorageServiceReadinessEvidence,
    ) &&
    isTeachingOperationsRouteSmokeStorageDatabaseAdapterBindingProved(
      externalStorageServiceReadinessEvidence,
    ) &&
    !isDeploymentDomainReachabilityEvidenceProved(
      deploymentDomainReachabilityEvidence,
    )
  ) {
    return blockedRequirement(
      id,
      "teaching-operations-route-smoke-deployment-domain-reachability-binding-not-proven",
      readEvidenceStatus(evidence),
      teachingOperationsDetails,
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route === "/api/teaching/operations" &&
    safetyProved &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    ) &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    teachingCourseManagementBackend === "external" &&
    deploymentOrigin.originClass === "remote-https" &&
    teachingOperationsBackend === "external" &&
    teacherIdStatus === "present" &&
    isRouteSmokeExternalStorageServiceReadinessBindingProved(
      externalStorageServiceReadinessEvidence,
    ) &&
    isTeachingOperationsRouteSmokeStorageDatabaseAdapterBindingProved(
      externalStorageServiceReadinessEvidence,
    ) &&
    isDeploymentDomainReachabilityEvidenceProved(
      deploymentDomainReachabilityEvidence,
    )
  ) {
    if (!requiredEnvProved) {
      return blockedRequirement(
        id,
        "teaching-operations-route-smoke-required-env-not-proven",
        readEvidenceStatus(evidence),
        teachingOperationsDetails,
      );
    }
    if (!proofContractProved) {
      return blockedRequirement(
        id,
        "teaching-operations-route-smoke-proof-contract-not-proven",
        readEvidenceStatus(evidence),
        teachingOperationsDetails,
      );
    }
    if (routeStatus.status !== "proved") {
      return blockedRequirement(
        id,
        "teaching-operations-route-smoke-routes-not-proven",
        readEvidenceStatus(evidence),
        teachingOperationsDetails,
      );
    }
    return satisfiedRequirement(id, "live-passed", teachingOperationsDetails);
  }
  return blockedRequirement(
    id,
    "teaching-operations-route-smoke-not-live-passed",
    readEvidenceStatus(evidence),
    teachingOperationsDetails,
  );
}

function readTeachingOperationsRouteSmokeResults(evidence) {
  const results = isRecord(evidence.results) ? evidence.results : {};
  return Object.fromEntries(
    requiredTeachingOperationsRouteSmokeResults.map((resultName) => [
      resultName,
      results[resultName] === "passed"
        ? "passed"
        : typeof results[resultName] === "string"
          ? results[resultName]
          : "missing",
    ]),
  );
}

function readTeachingOperationsRouteSmokeProofs(evidence) {
  const proofSet = new Set(Array.isArray(evidence.proves) ? evidence.proves : []);
  return Object.fromEntries(
    requiredTeachingOperationsRouteSmokeProofs.map((proofName) => [
      proofName,
      proofSet.has(proofName) ? "proved" : "missing",
    ]),
  );
}

function readTeachingOperationsRouteSmokeRouteStatus(evidence) {
  const routeSet = new Set(Array.isArray(evidence.routes) ? evidence.routes : []);
  const missingRoutes = requiredTeachingOperationsRouteSmokeRoutes.filter(
    (requiredRoute) => !routeSet.has(requiredRoute),
  );
  return {
    status: missingRoutes.length === 0 ? "proved" : "missing",
    requiredRoutes: requiredTeachingOperationsRouteSmokeRoutes,
    missingRoutes,
  };
}

function readTeachingOperationsRouteSmokeRequiredEnv(evidence) {
  const entries = Array.isArray(evidence.requiredEnv)
    ? evidence.requiredEnv.filter((entry) => isRecord(entry))
    : [];
  const entriesByName = new Map(
    entries
      .filter((entry) => typeof entry.name === "string")
      .map((entry) => [entry.name, entry]),
  );

  return Object.fromEntries(
    requiredTeachingOperationsRouteSmokeEnvNames.map((name) => {
      const entry = entriesByName.get(name);
      if (!entry) {
        return [name, "missing"];
      }
      if (entry.status !== "present") {
        return [
          name,
          typeof entry.status === "string" && entry.status.length > 0
            ? entry.status
            : "missing",
        ];
      }
      if (
        externalModeTeachingOperationsRouteSmokeEnvNames.has(name) &&
        entry.requiredValue !== "external"
      ) {
        return [name, "required-value-missing"];
      }
      if (
        redactedTeachingOperationsRouteSmokeEnvNames.has(name) &&
        entry.valueRedacted !== true
      ) {
        return [name, "value-redaction-missing"];
      }
      return [name, "present"];
    }),
  );
}

function readTeachingOperationsRouteSmokeSafety(evidence) {
  const safety = isRecord(evidence.safety) ? evidence.safety : {};
  return Object.fromEntries(
    requiredTeachingOperationsRouteSmokeSafetyFlags.map((flag) => [
      flag,
      safety[flag] === true ? "proved" : "missing",
    ]),
  );
}

function isTeachingOperationsRouteSmokeProductionPassed(evidence) {
  const requirement = evaluateTeachingOperationsRouteSmoke(evidence);
  return (
    requirement.status === "satisfied" &&
    requirement.evidenceStatus === "live-passed"
  );
}

function evaluateTeachingOperationDetailBrowserSmoke(evidence) {
  const id = "teaching-operation-detail-browser-smoke";
  if (!isRecord(evidence)) {
    return blockedRequirement(
      id,
      "teaching-operation-detail-browser-smoke-not-live-passed",
      "missing",
    );
  }
  if (evidence.target !== "teaching-operation-detail-browser-smoke") {
    return blockedRequirement(
      id,
      "teaching-operation-detail-browser-smoke-target-mismatch",
      readEvidenceStatus(evidence),
      {
        evidenceTarget: typeof evidence.target === "string" ? evidence.target : "missing",
      },
    );
  }

  const evidenceEnvironment =
    typeof evidence.environment === "string" ? evidence.environment : "unspecified";
  const requiredResults = readTeachingOperationDetailBrowserResults(evidence);
  const resultsProved = Object.values(requiredResults).every((status) => status === "passed");
  const safety = readTeachingOperationDetailBrowserSafety(evidence);
  const safetyProved = Object.values(safety).every((status) => status === "proved");
  const route =
    typeof evidence.route === "string" && evidence.route.startsWith("/teaching/")
      ? evidence.route
      : "missing";
  const operationId =
    typeof evidence.operationId === "string" && evidence.operationId.trim()
      ? "present"
      : "missing";
  const releaseRunIdStatus = readReleaseRunId(evidence) ? "present" : "missing";
  const deploymentOrigin = readDeploymentOrigin(evidence);
  const vercelProductionDeploymentBinding =
    readTeachingOperationDetailBrowserVercelProductionDeploymentBinding(evidence);
  const deploymentDomainReachabilityEvidence =
    readDeploymentDomainReachabilityEvidence(evidence);
  const teacherAuthProviderReadinessBinding =
    readRouteSmokeTeacherAuthProviderReadinessBinding(evidence);
  const appAuthProviderReadinessBinding =
    readRouteSmokeAppAuthProviderReadinessBinding(evidence);
  const auth =
    evidence.auth === "issued-teacher-auth-cookie"
      ? "issued-teacher-auth-cookie"
      : evidence.auth === "signed-teacher-auth-cookie"
        ? "signed-teacher-auth-cookie"
        : "missing";
  const apiInterceptionPolicy = readTeachingOperationDetailBrowserApiInterceptionPolicy(evidence);
  const apiInterceptionProved =
    apiInterceptionPolicy.operationApi === "live-teaching-operations" &&
    apiInterceptionPolicy.courseManagementApi === "live-teaching-course-management" &&
    apiInterceptionPolicy.auditReadback === "live-teaching-operations" &&
    apiInterceptionPolicy.auditAlertReadback === "live-teaching-operations" &&
    apiInterceptionPolicy.alertNotificationOutbox === "live-teaching-operations" &&
    apiInterceptionPolicy.failureProbe === "browser-negative-response" &&
    apiInterceptionPolicy.remoteMutations === "live-approved-teaching-operation" &&
    apiInterceptionPolicy.responseBodiesOmitted === true;
  const detailOperationCoverage = readTeachingOperationDetailCoverage(evidence);
  const detailOperationCoverageProved = Object.values(detailOperationCoverage).every(
    (status) => status === "passed",
  );

  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    resultsProved &&
    evidenceEnvironment !== "production"
  ) {
    return blockedRequirement(
      id,
      "teaching-operation-detail-browser-smoke-not-production",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        route,
        operationId,
        requiredResults,
        safety,
        apiInterceptionPolicy,
        releaseRunIdStatus,
        deploymentOrigin,
        vercelProductionDeploymentBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route !== "missing" &&
    operationId === "present" &&
    safetyProved &&
    apiInterceptionProved &&
    deploymentOrigin.originClass === "remote-https" &&
    isTeachingOperationDetailBrowserVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    ) &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeTeacherAuthProviderReadinessBindingMatchedExceptReleaseRun(
      teacherAuthProviderReadinessBinding,
    ) &&
    teacherAuthProviderReadinessBinding.releaseRunIdStatus !== "matched"
  ) {
    return blockedRequirement(
      id,
      "teaching-operation-detail-browser-smoke-teacher-auth-readiness-release-run-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        route,
        operationId,
        requiredResults,
        safety,
        apiInterceptionPolicy,
        releaseRunIdStatus,
        deploymentOrigin,
        vercelProductionDeploymentBinding,
        teacherAuthProviderReadinessBinding,
        appAuthProviderReadinessBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route !== "missing" &&
    operationId === "present" &&
    safetyProved &&
    apiInterceptionProved &&
    deploymentOrigin.originClass === "remote-https" &&
    isTeachingOperationDetailBrowserVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    ) &&
    releaseRunIdStatus === "present" &&
    !isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    )
  ) {
    return blockedRequirement(
      id,
      "teaching-operation-detail-browser-smoke-teacher-auth-readiness-binding-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        route,
        operationId,
        requiredResults,
        safety,
        apiInterceptionPolicy,
        releaseRunIdStatus,
        deploymentOrigin,
        vercelProductionDeploymentBinding,
        teacherAuthProviderReadinessBinding,
        appAuthProviderReadinessBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route !== "missing" &&
    operationId === "present" &&
    safetyProved &&
    apiInterceptionProved &&
    deploymentOrigin.originClass === "remote-https" &&
    isTeachingOperationDetailBrowserVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    ) &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    isRouteSmokeAppAuthProviderReadinessBindingMatchedExceptReleaseRun(
      appAuthProviderReadinessBinding,
    ) &&
    appAuthProviderReadinessBinding.releaseRunIdStatus !== "matched"
  ) {
    return blockedRequirement(
      id,
      "teaching-operation-detail-browser-smoke-app-auth-readiness-release-run-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        route,
        operationId,
        requiredResults,
        safety,
        apiInterceptionPolicy,
        releaseRunIdStatus,
        deploymentOrigin,
        vercelProductionDeploymentBinding,
        teacherAuthProviderReadinessBinding,
        appAuthProviderReadinessBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route !== "missing" &&
    operationId === "present" &&
    safetyProved &&
    apiInterceptionProved &&
    deploymentOrigin.originClass === "remote-https" &&
    isTeachingOperationDetailBrowserVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    ) &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    !isRouteSmokeAppAuthProviderReadinessBindingProved(
      appAuthProviderReadinessBinding,
    )
  ) {
    return blockedRequirement(
      id,
      "teaching-operation-detail-browser-smoke-app-auth-readiness-binding-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        route,
        operationId,
        requiredResults,
        safety,
        apiInterceptionPolicy,
        releaseRunIdStatus,
        deploymentOrigin,
        vercelProductionDeploymentBinding,
        teacherAuthProviderReadinessBinding,
        appAuthProviderReadinessBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route !== "missing" &&
    operationId === "present" &&
    safetyProved &&
    apiInterceptionProved &&
    deploymentOrigin.originClass === "remote-https" &&
    isTeachingOperationDetailBrowserVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    ) &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    isRouteSmokeAppAuthProviderReadinessBindingProved(
      appAuthProviderReadinessBinding,
    ) &&
    auth !== "issued-teacher-auth-cookie"
  ) {
    return blockedRequirement(
      id,
      "teaching-operation-detail-browser-smoke-auth-not-issued-teacher-cookie",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        route,
        operationId,
        requiredResults,
        safety,
        apiInterceptionPolicy,
        releaseRunIdStatus,
        deploymentOrigin,
        vercelProductionDeploymentBinding,
        teacherAuthProviderReadinessBinding,
        appAuthProviderReadinessBinding,
        auth,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    !resultsProved
  ) {
    return blockedRequirement(
      id,
      "teaching-operation-detail-browser-smoke-results-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        route,
        operationId,
        requiredResults,
        safety,
        apiInterceptionPolicy,
        releaseRunIdStatus,
        deploymentOrigin,
        vercelProductionDeploymentBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route !== "missing" &&
    operationId === "present" &&
    safetyProved &&
    apiInterceptionProved &&
    deploymentOrigin.originClass === "remote-https" &&
    isTeachingOperationDetailBrowserVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    ) &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    isRouteSmokeAppAuthProviderReadinessBindingProved(
      appAuthProviderReadinessBinding,
    ) &&
    !detailOperationCoverageProved
  ) {
    return blockedRequirement(
      id,
      "teaching-operation-detail-browser-smoke-operation-coverage-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        route,
        operationId,
        requiredResults,
        safety,
        apiInterceptionPolicy,
        releaseRunIdStatus,
        deploymentOrigin,
        vercelProductionDeploymentBinding,
        teacherAuthProviderReadinessBinding,
        appAuthProviderReadinessBinding,
        detailOperationCoverage,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route !== "missing" &&
    operationId === "present" &&
    safetyProved &&
    apiInterceptionProved &&
    deploymentOrigin.originClass === "remote-https" &&
    isTeachingOperationDetailBrowserVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    ) &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    isRouteSmokeAppAuthProviderReadinessBindingProved(
      appAuthProviderReadinessBinding,
    ) &&
    detailOperationCoverageProved &&
    isDeploymentDomainReachabilityEvidenceMatchedExceptReleaseRun(
      deploymentDomainReachabilityEvidence,
    ) &&
    deploymentDomainReachabilityEvidence.releaseRunIdStatus !== "matched"
  ) {
    return blockedRequirement(
      id,
      "teaching-operation-detail-browser-smoke-deployment-domain-reachability-release-run-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        route,
        operationId,
        requiredResults,
        safety,
        apiInterceptionPolicy,
        releaseRunIdStatus,
        deploymentOrigin,
        vercelProductionDeploymentBinding,
        deploymentDomainReachabilityEvidence,
        teacherAuthProviderReadinessBinding,
        appAuthProviderReadinessBinding,
        detailOperationCoverage,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route !== "missing" &&
    operationId === "present" &&
    safetyProved &&
    apiInterceptionProved &&
    deploymentOrigin.originClass === "remote-https" &&
    isTeachingOperationDetailBrowserVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    ) &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    isRouteSmokeAppAuthProviderReadinessBindingProved(
      appAuthProviderReadinessBinding,
    ) &&
    detailOperationCoverageProved &&
    !isDeploymentDomainReachabilityEvidenceProved(
      deploymentDomainReachabilityEvidence,
    )
  ) {
    return blockedRequirement(
      id,
      "teaching-operation-detail-browser-smoke-deployment-domain-reachability-binding-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        route,
        operationId,
        requiredResults,
        safety,
        apiInterceptionPolicy,
        releaseRunIdStatus,
        deploymentOrigin,
        vercelProductionDeploymentBinding,
        deploymentDomainReachabilityEvidence,
        teacherAuthProviderReadinessBinding,
        appAuthProviderReadinessBinding,
        detailOperationCoverage,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route === "missing"
  ) {
    return blockedRequirement(
      id,
      "teaching-operation-detail-browser-smoke-route-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        route,
        operationId,
        requiredResults,
        safety,
        releaseRunIdStatus,
        deploymentOrigin,
        vercelProductionDeploymentBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route !== "missing" &&
    operationId !== "present"
  ) {
    return blockedRequirement(
      id,
      "teaching-operation-detail-browser-smoke-operation-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        route,
        operationId,
        requiredResults,
        safety,
        releaseRunIdStatus,
        deploymentOrigin,
        vercelProductionDeploymentBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route !== "missing" &&
    operationId === "present" &&
    !safetyProved
  ) {
    return blockedRequirement(
      id,
      "teaching-operation-detail-browser-smoke-redaction-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        route,
        operationId,
        requiredResults,
        safety,
        releaseRunIdStatus,
        deploymentOrigin,
        vercelProductionDeploymentBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route !== "missing" &&
    operationId === "present" &&
    safetyProved &&
    !apiInterceptionProved
  ) {
    return blockedRequirement(
      id,
      "teaching-operation-detail-browser-smoke-live-api-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        route,
        operationId,
        requiredResults,
        safety,
        apiInterceptionPolicy,
        releaseRunIdStatus,
        deploymentOrigin,
        vercelProductionDeploymentBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route !== "missing" &&
    operationId === "present" &&
    safetyProved &&
    apiInterceptionProved &&
    deploymentOrigin.originClass !== "remote-https"
  ) {
    return blockedRequirement(
      id,
      "teaching-operation-detail-browser-smoke-origin-not-remote-https",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        route,
        operationId,
        requiredResults,
        safety,
        apiInterceptionPolicy,
        releaseRunIdStatus,
        deploymentOrigin,
        vercelProductionDeploymentBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route !== "missing" &&
    operationId === "present" &&
    safetyProved &&
    apiInterceptionProved &&
    deploymentOrigin.originClass === "remote-https" &&
    !isTeachingOperationDetailBrowserVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    )
  ) {
    return blockedRequirement(
      id,
      "teaching-operation-detail-browser-smoke-vercel-deployment-binding-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        route,
        operationId,
        requiredResults,
        safety,
        apiInterceptionPolicy,
        releaseRunIdStatus,
        deploymentOrigin,
        vercelProductionDeploymentBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route !== "missing" &&
    operationId === "present" &&
    safetyProved &&
    apiInterceptionProved &&
    deploymentOrigin.originClass === "remote-https" &&
    isTeachingOperationDetailBrowserVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    ) &&
    releaseRunIdStatus !== "present"
  ) {
    return blockedRequirement(
      id,
      "teaching-operation-detail-browser-smoke-release-run-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        route,
        operationId,
        requiredResults,
        safety,
        apiInterceptionPolicy,
        releaseRunIdStatus,
        deploymentOrigin,
        vercelProductionDeploymentBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    route !== "missing" &&
    operationId === "present" &&
    safetyProved &&
    apiInterceptionProved &&
    deploymentOrigin.originClass === "remote-https" &&
    isTeachingOperationDetailBrowserVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    ) &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    isRouteSmokeAppAuthProviderReadinessBindingProved(
      appAuthProviderReadinessBinding,
    ) &&
    isDeploymentDomainReachabilityEvidenceProved(
      deploymentDomainReachabilityEvidence,
    )
  ) {
    return satisfiedRequirement(id, "live-passed", {
      evidenceEnvironment,
      route,
      operationId,
      requiredResults,
      safety,
      apiInterceptionPolicy,
      releaseRunIdStatus,
      deploymentOrigin,
      vercelProductionDeploymentBinding,
      deploymentDomainReachabilityEvidence,
      teacherAuthProviderReadinessBinding,
      appAuthProviderReadinessBinding,
      auth,
      detailOperationCoverage,
    });
  }
  return blockedRequirement(
    id,
    "teaching-operation-detail-browser-smoke-not-live-passed",
    readEvidenceStatus(evidence),
    {
      evidenceEnvironment,
      route,
      operationId,
      requiredResults,
      safety,
      apiInterceptionPolicy,
      releaseRunIdStatus,
      deploymentOrigin,
      vercelProductionDeploymentBinding,
      teacherAuthProviderReadinessBinding,
      appAuthProviderReadinessBinding,
      auth,
    },
  );
}

function readTeachingOperationDetailBrowserResults(evidence) {
  const results = isRecord(evidence.results) ? evidence.results : {};
  return Object.fromEntries(
    requiredTeachingOperationDetailBrowserResults.map((resultName) => [
      resultName,
      results[resultName] === "passed"
        ? "passed"
        : typeof results[resultName] === "string"
          ? results[resultName]
          : "missing",
    ]),
  );
}

function readTeachingOperationDetailCoverage(evidence) {
  const coverage = Array.isArray(evidence.detailOperationCoverage)
    ? evidence.detailOperationCoverage
    : [];
  return Object.fromEntries(
    requiredTeachingOperationDetailCoverage.map((required) => {
      const item = coverage.find(
        (entry) =>
          isRecord(entry) &&
          entry.operationId === required.operationId &&
          entry.route === required.route,
      );
      const status =
        isRecord(item) &&
        item.primaryButtonClick === "passed" &&
        item.primaryPostPersisted === "passed" &&
        item.secondaryButtonClick === "passed" &&
        item.secondaryPostPersisted === "passed"
          ? "passed"
          : "missing";
      return [required.key, status];
    }),
  );
}

function readTeachingOperationDetailBrowserSafety(evidence) {
  const safety = isRecord(evidence.safety) ? evidence.safety : {};
  return Object.fromEntries(
    requiredTeachingOperationDetailBrowserSafetyFlags.map((flag) => [
      flag,
      safety[flag] === true ? "proved" : "missing",
    ]),
  );
}

function readTeachingOperationDetailBrowserApiInterceptionPolicy(evidence) {
  const policy = isRecord(evidence.apiInterceptionPolicy)
    ? evidence.apiInterceptionPolicy
    : {};
  return {
    operationApi:
      typeof policy.operationApi === "string" ? policy.operationApi : "missing",
    courseManagementApi:
      typeof policy.courseManagementApi === "string"
        ? policy.courseManagementApi
        : "missing",
    auditReadback:
      typeof policy.auditReadback === "string" ? policy.auditReadback : "missing",
    auditAlertReadback:
      typeof policy.auditAlertReadback === "string"
        ? policy.auditAlertReadback
        : "missing",
    alertNotificationOutbox:
      typeof policy.alertNotificationOutbox === "string"
        ? policy.alertNotificationOutbox
        : "missing",
    failureProbe:
      typeof policy.failureProbe === "string" ? policy.failureProbe : "missing",
    remoteMutations:
      typeof policy.remoteMutations === "string" ? policy.remoteMutations : "missing",
    responseBodiesOmitted: policy.responseBodiesOmitted === true,
  };
}

function readTeachingOperationDetailBrowserVercelProductionDeploymentBinding(evidence) {
  if (!isRecord(evidence.vercelProductionDeploymentEvidence)) {
    return {
      target: "missing",
      status: "missing",
      deploymentObservationStatus: "missing",
      releaseRunIdStatus: "missing",
      valueRedacted: false,
    };
  }
  const binding = evidence.vercelProductionDeploymentEvidence;
  return {
    target: typeof binding.target === "string" ? binding.target : "missing",
    status: typeof binding.status === "string" ? binding.status : "missing",
    deploymentObservationStatus:
      typeof binding.deploymentObservationStatus === "string"
        ? binding.deploymentObservationStatus
        : "missing",
    releaseRunIdStatus:
      typeof binding.releaseRunIdStatus === "string"
        ? binding.releaseRunIdStatus
        : "missing",
    ...(typeof binding.deploymentDomainReachabilityStatus === "string"
      ? { deploymentDomainReachabilityStatus: binding.deploymentDomainReachabilityStatus }
      : {}),
    valueRedacted: binding.valueRedacted === true,
  };
}

function isTeachingOperationDetailBrowserVercelProductionDeploymentBindingProved(binding) {
  return (
    binding.target === "vercel-production-deployment" &&
    (binding.status === "matched" || binding.status === "matched-via-domain-reachability") &&
    binding.deploymentObservationStatus === "observed" &&
    binding.releaseRunIdStatus === "matched" &&
    binding.valueRedacted === true
  );
}

function isTeachingOperationDetailBrowserSmokeProductionPassed(evidence) {
  const requirement = evaluateTeachingOperationDetailBrowserSmoke(evidence);
  return (
    requirement.status === "satisfied" &&
    requirement.evidenceStatus === "live-passed"
  );
}

function evaluateTeachingCourseManagementRouteSmoke(evidence) {
  const id = "teaching-course-management-route-smoke";
  if (!isRecord(evidence)) {
    return blockedRequirement(
      id,
      "teaching-course-management-route-smoke-evidence-missing",
      "missing",
    );
  }
  if (evidence.target !== "teaching-course-management-route-smoke") {
    return blockedRequirement(
      id,
      "teaching-course-management-route-smoke-evidence-target-mismatch",
      readEvidenceStatus(evidence),
      {
        evidenceTarget: typeof evidence.target === "string" ? evidence.target : "missing",
      },
    );
  }

  const evidenceEnvironment =
    typeof evidence.environment === "string" ? evidence.environment : "unspecified";
  const requiredResults = readTeachingCourseManagementRouteSmokeResults(evidence);
  const resultsProved = Object.values(requiredResults).every((status) => status === "passed");
  const requiredProofs = readTeachingCourseManagementRouteSmokeProofs(evidence);
  const proofContractProved = Object.values(requiredProofs).every(
    (status) => status === "proved",
  );
  const safety = readTeachingCourseManagementRouteSmokeSafety(evidence);
  const safetyProved = Object.values(safety).every((status) => status === "proved");
  const requiredEnv = readTeachingCourseManagementRouteSmokeRequiredEnv(evidence);
  const requiredEnvProved = Object.values(requiredEnv).every(
    (status) => status === "present",
  );
  const routeStatus = readTeachingCourseManagementRouteSmokeRouteStatus(evidence);
  const releaseRunIdStatus = readReleaseRunId(evidence) ? "present" : "missing";
  const teacherAuthProviderReadinessBinding =
    readRouteSmokeTeacherAuthProviderReadinessBinding(evidence);
  const appAuthProviderReadinessBinding =
    readRouteSmokeAppAuthProviderReadinessBinding(evidence);
  const vercelProductionDeploymentBinding =
    readRouteSmokeVercelProductionDeploymentBinding(evidence);
  const deploymentDomainReachabilityEvidence =
    readDeploymentDomainReachabilityEvidence(evidence);
  const externalStorageServiceReadinessEvidence =
    readRouteSmokeExternalStorageServiceReadinessBinding(evidence);
  const deploymentOrigin = readDeploymentOrigin(evidence);
  const courseManagementBackend =
    evidence.courseManagementBackend === "external" ? "external" : "missing";
  const courseAssetsBackend =
    evidence.courseAssetsBackend === "external" ? "external" : "missing";
  const teachingOperationsBackend =
    evidence.teachingOperationsBackend === "external" ? "external" : "missing";
  const teacherAiOwnershipBackend =
    evidence.teacherAiOwnershipBackend === "external" ? "external" : "missing";
  const teachingCourseManagementExternalBackendsProved =
    courseManagementBackend === "external" &&
    courseAssetsBackend === "external" &&
    teachingOperationsBackend === "external" &&
    teacherAiOwnershipBackend === "external";
  const auth =
    evidence.auth === "issued-teacher-auth-cookie"
      ? "issued-teacher-auth-cookie"
      : evidence.auth === "signed-teacher-auth-cookie"
        ? "signed-teacher-auth-cookie"
        : "missing";

  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    resultsProved &&
    evidenceEnvironment !== "production"
  ) {
    return blockedRequirement(
      id,
      "teaching-course-management-route-smoke-not-production",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
          routes: routeStatus,
          requiredResults,
          requiredProofs,
          safety,
          releaseRunIdStatus,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    routeStatus.status === "proved" &&
    safetyProved &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeTeacherAuthProviderReadinessBindingMatchedExceptReleaseRun(
      teacherAuthProviderReadinessBinding,
    ) &&
    teacherAuthProviderReadinessBinding.releaseRunIdStatus !== "matched"
  ) {
    return blockedRequirement(
      id,
      "teaching-course-management-route-smoke-teacher-auth-readiness-release-run-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        routes: routeStatus,
        requiredResults,
        requiredProofs,
        safety,
        releaseRunIdStatus,
        teacherAuthProviderReadinessBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    routeStatus.status === "proved" &&
    safetyProved &&
    releaseRunIdStatus === "present" &&
    !isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    )
  ) {
    return blockedRequirement(
      id,
      "teaching-course-management-route-smoke-teacher-auth-readiness-binding-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        routes: routeStatus,
        requiredResults,
        requiredProofs,
        safety,
        releaseRunIdStatus,
        teacherAuthProviderReadinessBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    routeStatus.status === "proved" &&
    safetyProved &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    isRouteSmokeAppAuthProviderReadinessBindingMatchedExceptReleaseRun(
      appAuthProviderReadinessBinding,
    ) &&
    appAuthProviderReadinessBinding.releaseRunIdStatus !== "matched"
  ) {
    return blockedRequirement(
      id,
      "teaching-course-management-route-smoke-app-auth-readiness-release-run-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        routes: routeStatus,
        requiredResults,
        requiredProofs,
        safety,
        releaseRunIdStatus,
        teacherAuthProviderReadinessBinding,
        appAuthProviderReadinessBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    routeStatus.status === "proved" &&
    safetyProved &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    !isRouteSmokeAppAuthProviderReadinessBindingProved(
      appAuthProviderReadinessBinding,
    )
  ) {
    return blockedRequirement(
      id,
      "teaching-course-management-route-smoke-app-auth-readiness-binding-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        routes: routeStatus,
        requiredResults,
        requiredProofs,
        safety,
        releaseRunIdStatus,
        teacherAuthProviderReadinessBinding,
        appAuthProviderReadinessBinding,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    !resultsProved
  ) {
    return blockedRequirement(
      id,
      "teaching-course-management-route-smoke-results-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        routes: routeStatus,
        requiredResults,
        requiredProofs,
        safety,
        releaseRunIdStatus,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    routeStatus.status === "proved" &&
    safetyProved &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    isRouteSmokeAppAuthProviderReadinessBindingProved(
      appAuthProviderReadinessBinding,
    ) &&
    auth !== "issued-teacher-auth-cookie"
  ) {
    return blockedRequirement(
      id,
      "teaching-course-management-route-smoke-auth-not-issued-teacher-cookie",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        routes: routeStatus,
        requiredResults,
        requiredProofs,
        safety,
        releaseRunIdStatus,
        teacherAuthProviderReadinessBinding,
        appAuthProviderReadinessBinding,
        auth,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    routeStatus.status === "proved" &&
    safetyProved &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    isRouteSmokeAppAuthProviderReadinessBindingProved(
      appAuthProviderReadinessBinding,
    ) &&
    !teachingCourseManagementExternalBackendsProved
  ) {
    return blockedRequirement(
      id,
      "teaching-course-management-route-smoke-external-backends-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        routes: routeStatus,
        requiredResults,
        requiredProofs,
        safety,
        releaseRunIdStatus,
        teacherAuthProviderReadinessBinding,
        appAuthProviderReadinessBinding,
        courseManagementBackend,
        courseAssetsBackend,
        teachingOperationsBackend,
        teacherAiOwnershipBackend,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    routeStatus.status === "proved" &&
    safetyProved &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    isRouteSmokeAppAuthProviderReadinessBindingProved(
      appAuthProviderReadinessBinding,
    ) &&
    teachingCourseManagementExternalBackendsProved &&
    isRouteSmokeExternalStorageServiceReadinessBindingMatchedExceptReleaseRun(
      externalStorageServiceReadinessEvidence,
    ) &&
    externalStorageServiceReadinessEvidence.releaseRunIdStatus !== "matched"
  ) {
    return blockedRequirement(
      id,
      "teaching-course-management-route-smoke-storage-readiness-release-run-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        routes: routeStatus,
        requiredResults,
        requiredProofs,
        safety,
        releaseRunIdStatus,
        teacherAuthProviderReadinessBinding,
        appAuthProviderReadinessBinding,
        externalStorageServiceReadinessEvidence,
        courseManagementBackend,
        courseAssetsBackend,
        teachingOperationsBackend,
        teacherAiOwnershipBackend,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    routeStatus.status === "proved" &&
    safetyProved &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    isRouteSmokeAppAuthProviderReadinessBindingProved(
      appAuthProviderReadinessBinding,
    ) &&
    teachingCourseManagementExternalBackendsProved &&
    !isRouteSmokeExternalStorageServiceReadinessBindingProved(
      externalStorageServiceReadinessEvidence,
    )
  ) {
    return blockedRequirement(
      id,
      "teaching-course-management-route-smoke-storage-readiness-binding-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        routes: routeStatus,
        requiredResults,
        requiredProofs,
        safety,
        releaseRunIdStatus,
        teacherAuthProviderReadinessBinding,
        appAuthProviderReadinessBinding,
        externalStorageServiceReadinessEvidence,
        courseManagementBackend,
        courseAssetsBackend,
        teachingOperationsBackend,
        teacherAiOwnershipBackend,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    routeStatus.status === "proved" &&
    safetyProved &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    isRouteSmokeAppAuthProviderReadinessBindingProved(
      appAuthProviderReadinessBinding,
    ) &&
    teachingCourseManagementExternalBackendsProved &&
    isRouteSmokeExternalStorageServiceReadinessBindingProved(
      externalStorageServiceReadinessEvidence,
    ) &&
    isRouteSmokeVercelProductionDeploymentBindingMatchedExceptReleaseRun(
      vercelProductionDeploymentBinding,
    ) &&
    !isRouteSmokeVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    )
  ) {
    return blockedRequirement(
      id,
      "teaching-course-management-route-smoke-vercel-deployment-release-run-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        routes: routeStatus,
        requiredResults,
        requiredProofs,
        safety,
        releaseRunIdStatus,
        teacherAuthProviderReadinessBinding,
        appAuthProviderReadinessBinding,
        externalStorageServiceReadinessEvidence,
        vercelProductionDeploymentBinding,
        courseManagementBackend,
        courseAssetsBackend,
        teachingOperationsBackend,
        teacherAiOwnershipBackend,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    routeStatus.status === "proved" &&
    safetyProved &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    isRouteSmokeAppAuthProviderReadinessBindingProved(
      appAuthProviderReadinessBinding,
    ) &&
    teachingCourseManagementExternalBackendsProved &&
    isRouteSmokeExternalStorageServiceReadinessBindingProved(
      externalStorageServiceReadinessEvidence,
    ) &&
    isRouteSmokeVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    ) &&
    deploymentOrigin.originClass !== "remote-https"
  ) {
    return blockedRequirement(
      id,
      "teaching-course-management-route-smoke-origin-not-remote-https",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        routes: routeStatus,
        requiredResults,
        safety,
        releaseRunIdStatus,
        teacherAuthProviderReadinessBinding,
        appAuthProviderReadinessBinding,
        externalStorageServiceReadinessEvidence,
        vercelProductionDeploymentBinding,
        deploymentOrigin,
        courseManagementBackend,
        courseAssetsBackend,
        teachingOperationsBackend,
        teacherAiOwnershipBackend,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    routeStatus.status === "proved" &&
    safetyProved &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    isRouteSmokeAppAuthProviderReadinessBindingProved(
      appAuthProviderReadinessBinding,
    ) &&
    teachingCourseManagementExternalBackendsProved &&
    isRouteSmokeExternalStorageServiceReadinessBindingProved(
      externalStorageServiceReadinessEvidence,
    ) &&
    !isRouteSmokeVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    )
  ) {
    return blockedRequirement(
      id,
      "teaching-course-management-route-smoke-vercel-deployment-binding-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        routes: routeStatus,
        requiredResults,
        safety,
        releaseRunIdStatus,
        teacherAuthProviderReadinessBinding,
        appAuthProviderReadinessBinding,
        externalStorageServiceReadinessEvidence,
        vercelProductionDeploymentBinding,
        courseManagementBackend,
        courseAssetsBackend,
        teachingOperationsBackend,
        teacherAiOwnershipBackend,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    routeStatus.status !== "proved"
  ) {
    return blockedRequirement(
      id,
      "teaching-course-management-route-smoke-routes-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        routes: routeStatus,
        requiredResults,
        safety,
        releaseRunIdStatus,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    routeStatus.status === "proved" &&
    !safetyProved
  ) {
    return blockedRequirement(
      id,
      "teaching-course-management-route-smoke-redaction-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        routes: routeStatus,
        requiredResults,
        safety,
        releaseRunIdStatus,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    routeStatus.status === "proved" &&
    safetyProved &&
    releaseRunIdStatus !== "present"
  ) {
    return blockedRequirement(
      id,
      "teaching-course-management-route-smoke-release-run-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        routes: routeStatus,
        requiredResults,
        safety,
        releaseRunIdStatus,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    routeStatus.status === "proved" &&
    safetyProved &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    isRouteSmokeAppAuthProviderReadinessBindingProved(
      appAuthProviderReadinessBinding,
    ) &&
    teachingCourseManagementExternalBackendsProved &&
    isRouteSmokeExternalStorageServiceReadinessBindingProved(
      externalStorageServiceReadinessEvidence,
    ) &&
    isRouteSmokeVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    ) &&
    deploymentOrigin.originClass === "remote-https" &&
    isDeploymentDomainReachabilityEvidenceMatchedExceptReleaseRun(
      deploymentDomainReachabilityEvidence,
    ) &&
    deploymentDomainReachabilityEvidence.releaseRunIdStatus !== "matched"
  ) {
    return blockedRequirement(
      id,
      "teaching-course-management-route-smoke-deployment-domain-reachability-release-run-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        routes: routeStatus,
        requiredResults,
        safety,
        releaseRunIdStatus,
        teacherAuthProviderReadinessBinding,
        appAuthProviderReadinessBinding,
        externalStorageServiceReadinessEvidence,
        vercelProductionDeploymentBinding,
        deploymentDomainReachabilityEvidence,
        deploymentOrigin,
        courseManagementBackend,
        courseAssetsBackend,
        teachingOperationsBackend,
        teacherAiOwnershipBackend,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    routeStatus.status === "proved" &&
    safetyProved &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    isRouteSmokeAppAuthProviderReadinessBindingProved(
      appAuthProviderReadinessBinding,
    ) &&
    teachingCourseManagementExternalBackendsProved &&
    isRouteSmokeExternalStorageServiceReadinessBindingProved(
      externalStorageServiceReadinessEvidence,
    ) &&
    isRouteSmokeVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    ) &&
    deploymentOrigin.originClass === "remote-https" &&
    !isDeploymentDomainReachabilityEvidenceProved(
      deploymentDomainReachabilityEvidence,
    )
  ) {
    return blockedRequirement(
      id,
      "teaching-course-management-route-smoke-deployment-domain-reachability-binding-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        routes: routeStatus,
        requiredResults,
        safety,
        releaseRunIdStatus,
        teacherAuthProviderReadinessBinding,
        appAuthProviderReadinessBinding,
        externalStorageServiceReadinessEvidence,
        vercelProductionDeploymentBinding,
        deploymentDomainReachabilityEvidence,
        deploymentOrigin,
        courseManagementBackend,
        courseAssetsBackend,
        teachingOperationsBackend,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.status === "passed" &&
    evidenceEnvironment === "production" &&
    resultsProved &&
    routeStatus.status === "proved" &&
    safetyProved &&
    releaseRunIdStatus === "present" &&
    isRouteSmokeTeacherAuthProviderReadinessBindingProved(
      teacherAuthProviderReadinessBinding,
    ) &&
    isRouteSmokeAppAuthProviderReadinessBindingProved(
      appAuthProviderReadinessBinding,
    ) &&
    teachingCourseManagementExternalBackendsProved &&
    isRouteSmokeExternalStorageServiceReadinessBindingProved(
      externalStorageServiceReadinessEvidence,
    ) &&
    isRouteSmokeVercelProductionDeploymentBindingProved(
      vercelProductionDeploymentBinding,
    ) &&
    deploymentOrigin.originClass === "remote-https" &&
    isDeploymentDomainReachabilityEvidenceProved(
      deploymentDomainReachabilityEvidence,
    )
  ) {
    if (!requiredEnvProved) {
      return blockedRequirement(
        id,
        "teaching-course-management-route-smoke-required-env-not-proven",
        readEvidenceStatus(evidence),
        {
          evidenceEnvironment,
          routes: routeStatus,
          requiredResults,
          requiredProofs,
          requiredEnv,
          safety,
          releaseRunIdStatus,
          teacherAuthProviderReadinessBinding,
          appAuthProviderReadinessBinding,
          externalStorageServiceReadinessEvidence,
          vercelProductionDeploymentBinding,
          deploymentDomainReachabilityEvidence,
          deploymentOrigin,
          courseManagementBackend,
          courseAssetsBackend,
          teachingOperationsBackend,
          teacherAiOwnershipBackend,
        },
      );
    }
    if (!proofContractProved) {
      return blockedRequirement(
        id,
        "teaching-course-management-route-smoke-proof-contract-not-proven",
        readEvidenceStatus(evidence),
        {
          evidenceEnvironment,
          routes: routeStatus,
          requiredResults,
          requiredProofs,
          requiredEnv,
          safety,
          releaseRunIdStatus,
          teacherAuthProviderReadinessBinding,
          appAuthProviderReadinessBinding,
          externalStorageServiceReadinessEvidence,
          vercelProductionDeploymentBinding,
          deploymentDomainReachabilityEvidence,
          deploymentOrigin,
          courseManagementBackend,
          courseAssetsBackend,
          teachingOperationsBackend,
          teacherAiOwnershipBackend,
        },
      );
    }
    return satisfiedRequirement(id, "live-passed", {
      evidenceEnvironment,
      routes: routeStatus,
      requiredResults,
      requiredProofs,
      requiredEnv,
      safety,
      releaseRunIdStatus,
      teacherAuthProviderReadinessBinding,
      appAuthProviderReadinessBinding,
      externalStorageServiceReadinessEvidence,
      vercelProductionDeploymentBinding,
      deploymentDomainReachabilityEvidence,
      deploymentOrigin,
      courseManagementBackend,
      courseAssetsBackend,
      teachingOperationsBackend,
      teacherAiOwnershipBackend,
    });
  }
  return blockedRequirement(
    id,
    "teaching-course-management-route-smoke-not-live-passed",
    readEvidenceStatus(evidence),
    {
      evidenceEnvironment,
      routes: routeStatus,
      requiredResults,
      requiredProofs,
      safety,
      releaseRunIdStatus,
      teacherAuthProviderReadinessBinding,
      appAuthProviderReadinessBinding,
      externalStorageServiceReadinessEvidence,
      vercelProductionDeploymentBinding,
      deploymentOrigin,
      courseManagementBackend,
      courseAssetsBackend,
      teachingOperationsBackend,
      teacherAiOwnershipBackend,
    },
  );
}

function readTeachingCourseManagementRouteSmokeResults(evidence) {
  const results = isRecord(evidence.results) ? evidence.results : {};
  return Object.fromEntries(
    requiredTeachingCourseManagementRouteSmokeResults.map((resultName) => [
      resultName,
      results[resultName] === "passed"
        ? "passed"
        : typeof results[resultName] === "string"
          ? results[resultName]
          : "missing",
    ]),
  );
}

function readTeachingCourseManagementRouteSmokeProofs(evidence) {
  const proofSet = new Set(Array.isArray(evidence.proves) ? evidence.proves : []);
  return Object.fromEntries(
    requiredTeachingCourseManagementRouteSmokeProofs.map((proofName) => [
      proofName,
      proofSet.has(proofName) ? "proved" : "missing",
    ]),
  );
}

function readTeachingCourseManagementRouteSmokeSafety(evidence) {
  const safety = isRecord(evidence.safety) ? evidence.safety : {};
  return Object.fromEntries(
    requiredTeachingCourseManagementRouteSmokeSafetyFlags.map((flag) => [
      flag,
      safety[flag] === true ? "proved" : "missing",
    ]),
  );
}

function readTeachingCourseManagementRouteSmokeRequiredEnv(evidence) {
  const entries = Array.isArray(evidence.requiredEnv)
    ? evidence.requiredEnv.filter((entry) => isRecord(entry))
    : [];
  const entriesByName = new Map(
    entries
      .filter((entry) => typeof entry.name === "string")
      .map((entry) => [entry.name, entry]),
  );

  return Object.fromEntries(
    requiredTeachingCourseManagementRouteSmokeEnvNames.map((name) => {
      const entry = entriesByName.get(name);
      if (!entry) {
        return [name, "missing"];
      }
      if (entry.status !== "present") {
        return [
          name,
          typeof entry.status === "string" && entry.status.length > 0
            ? entry.status
            : "missing",
        ];
      }
      if (
        externalModeTeachingCourseManagementRouteSmokeEnvNames.has(name) &&
        entry.requiredValue !== "external"
      ) {
        return [name, "required-value-missing"];
      }
      if (
        redactedTeachingCourseManagementRouteSmokeEnvNames.has(name) &&
        entry.valueRedacted !== true
      ) {
        return [name, "value-redaction-missing"];
      }
      return [name, "present"];
    }),
  );
}

function readTeachingCourseManagementRouteSmokeRouteStatus(evidence) {
  const routeSet = new Set(Array.isArray(evidence.routes) ? evidence.routes : []);
  const missingRoutes = requiredTeachingCourseManagementRouteSmokeRoutes.filter(
    (route) => !routeSet.has(route),
  );
  return {
    status: missingRoutes.length === 0 ? "proved" : "missing",
    requiredRoutes: requiredTeachingCourseManagementRouteSmokeRoutes,
    missingRoutes,
  };
}

function isTeachingCourseManagementRouteSmokeProductionPassed(evidence) {
  const requirement = evaluateTeachingCourseManagementRouteSmoke(evidence);
  return (
    requirement.status === "satisfied" &&
    requirement.evidenceStatus === "live-passed"
  );
}

function evaluateExternalStorageSmoke(evidence) {
  const id = "external-durable-storage-smoke";
  if (!isRecord(evidence)) {
    return blockedRequirement(id, "external-storage-smoke-evidence-missing", "missing");
  }
  if (evidence.target !== "external-storage-smoke") {
    return blockedRequirement(id, "external-storage-smoke-evidence-target-mismatch", readEvidenceStatus(evidence), {
      evidenceTarget: typeof evidence.target === "string" ? evidence.target : "missing",
    });
  }
  const okCheckIds = new Set(
    (Array.isArray(evidence.results) ? evidence.results : [])
      .filter((result) => isRecord(result) && result.status === "ok" && typeof result.id === "string")
      .map((result) => result.id),
  );
  const missingStorageChecks = requiredExternalStorageSmokeIds.filter((checkId) => !okCheckIds.has(checkId));
  const storageResponseShapes = Object.fromEntries(
    requiredExternalStorageResponseShapes.map((shapeContract) => {
      const checkResult = (Array.isArray(evidence.results) ? evidence.results : []).find(
        (result) => isRecord(result) && result.id === shapeContract.checkId,
      );
      return [
        shapeContract.key,
        readResponseShapeStatus(checkResult, shapeContract.requiredFields),
      ];
    }),
  );
  const storageResponseShapesProved = Object.values(storageResponseShapes).every(
    (status) => status === "proved",
  );
  const evidenceEnvironment = typeof evidence.environment === "string" ? evidence.environment : "unspecified";
  const storageEndpointNetworkClass =
    isRecord(evidence.storageEndpoint) && typeof evidence.storageEndpoint.networkClass === "string"
      ? evidence.storageEndpoint.networkClass
      : "missing";
  const storageEndpointClass =
    isRecord(evidence.storageEndpoint) && typeof evidence.storageEndpoint.endpointClass === "string"
      ? evidence.storageEndpoint.endpointClass
      : "missing";
  const externalStorageServiceReadinessEvidence =
    readExternalStorageSmokeServiceReadinessEvidence(evidence);
  if (
    evidence.mode === "live" &&
    evidence.environment !== "production" &&
    evidence.status === "passed" &&
    missingStorageChecks.length === 0
  ) {
    return blockedRequirement(
      id,
      "external-storage-smoke-not-production",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingStorageChecks,
        storageResponseShapes,
        storageEndpointNetworkClass,
        storageEndpointClass,
        externalStorageServiceReadinessEvidence,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.environment === "production" &&
    evidence.status === "passed" &&
    missingStorageChecks.length === 0 &&
    !storageResponseShapesProved
  ) {
    return blockedRequirement(
      id,
      "external-storage-smoke-response-shape-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingStorageChecks,
        storageResponseShapes,
        storageEndpointNetworkClass,
        storageEndpointClass,
        externalStorageServiceReadinessEvidence,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.environment === "production" &&
    evidence.status === "passed" &&
    missingStorageChecks.length === 0 &&
    storageResponseShapesProved &&
    storageEndpointNetworkClass !== "remote"
  ) {
    return blockedRequirement(
      id,
      "external-storage-smoke-endpoint-not-remote",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingStorageChecks,
        storageResponseShapes,
        storageEndpointNetworkClass,
        storageEndpointClass,
        externalStorageServiceReadinessEvidence,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.environment === "production" &&
    evidence.status === "passed" &&
    missingStorageChecks.length === 0 &&
    storageResponseShapesProved &&
    storageEndpointNetworkClass === "remote" &&
    storageEndpointClass !== "remote-https"
  ) {
    return blockedRequirement(
      id,
      "external-storage-smoke-endpoint-not-remote-https",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingStorageChecks,
        storageResponseShapes,
        storageEndpointNetworkClass,
        storageEndpointClass,
        externalStorageServiceReadinessEvidence,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.environment === "production" &&
    evidence.status === "passed" &&
    missingStorageChecks.length === 0 &&
    storageResponseShapesProved &&
    storageEndpointNetworkClass === "remote" &&
    storageEndpointClass === "remote-https" &&
    isExternalStorageSmokeServiceReadinessEvidenceMatchedExceptReleaseRun(
      externalStorageServiceReadinessEvidence,
    ) &&
    externalStorageServiceReadinessEvidence.releaseRunIdStatus !== "matched"
  ) {
    return blockedRequirement(
      id,
      "external-storage-smoke-service-readiness-release-run-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingStorageChecks,
        storageResponseShapes,
        storageEndpointNetworkClass,
        storageEndpointClass,
        externalStorageServiceReadinessEvidence,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.environment === "production" &&
    evidence.status === "passed" &&
    missingStorageChecks.length === 0 &&
    storageResponseShapesProved &&
    storageEndpointNetworkClass === "remote" &&
    storageEndpointClass === "remote-https" &&
    !isExternalStorageSmokeServiceReadinessEvidenceProved(
      externalStorageServiceReadinessEvidence,
    )
  ) {
    return blockedRequirement(
      id,
      "external-storage-smoke-service-readiness-not-proven",
      readEvidenceStatus(evidence),
      {
        evidenceEnvironment,
        missingStorageChecks,
        storageResponseShapes,
        storageEndpointNetworkClass,
        storageEndpointClass,
        externalStorageServiceReadinessEvidence,
      },
    );
  }
  if (
    evidence.mode === "live" &&
    evidence.environment === "production" &&
    evidence.status === "passed" &&
    missingStorageChecks.length === 0 &&
    storageResponseShapesProved &&
    storageEndpointNetworkClass === "remote" &&
    storageEndpointClass === "remote-https" &&
    isExternalStorageSmokeServiceReadinessEvidenceProved(
      externalStorageServiceReadinessEvidence,
    )
  ) {
    return satisfiedRequirement(id, "live-passed", {
      requiredStorageChecks: requiredExternalStorageSmokeIds,
      evidenceEnvironment,
      storageResponseShapes,
      storageEndpointNetworkClass,
      storageEndpointClass,
      externalStorageServiceReadinessEvidence,
    });
  }
  return blockedRequirement(id, "external-storage-smoke-not-live-passed", readEvidenceStatus(evidence), {
    evidenceEnvironment,
    missingStorageChecks,
    storageResponseShapes,
    storageEndpointNetworkClass,
    storageEndpointClass,
    externalStorageServiceReadinessEvidence,
  });
}

function readExternalStorageSmokeServiceReadinessEvidence(evidence) {
  if (!isRecord(evidence.externalStorageServiceReadinessEvidence)) {
    return {
      target: "missing",
      status: "missing",
      valueRedacted: true,
      releaseRunIdStatus: "missing",
    };
  }
  const readinessEvidence = evidence.externalStorageServiceReadinessEvidence;
  return {
    target:
      readinessEvidence.target === "external-storage-service-readiness"
        ? "external-storage-service-readiness"
        : "missing",
    status:
      typeof readinessEvidence.status === "string"
        ? readinessEvidence.status
        : "missing",
    valueRedacted: readinessEvidence.valueRedacted === true,
    releaseRunIdStatus:
      typeof readinessEvidence.releaseRunIdStatus === "string"
        ? readinessEvidence.releaseRunIdStatus
        : "missing",
  };
}

function isExternalStorageSmokeServiceReadinessEvidenceProved(evidence) {
  return (
    evidence.target === "external-storage-service-readiness" &&
    evidence.status === "matched" &&
    evidence.valueRedacted === true &&
    evidence.releaseRunIdStatus === "matched"
  );
}

function isExternalStorageSmokeServiceReadinessEvidenceMatchedExceptReleaseRun(evidence) {
  return (
    evidence.target === "external-storage-service-readiness" &&
    evidence.status === "matched" &&
    evidence.valueRedacted === true
  );
}

function evaluateExternalStorageServiceConsistency({
  vercelEnvSync,
  externalStorageServiceReadiness,
  externalStorageSmoke,
}) {
  const id = "external-storage-service-consistency";
  const readinessState = readExternalStorageServiceReadinessConsistencyState(
    externalStorageServiceReadiness,
  );
  const storageSmokePassed = isExternalStorageSmokeProductionPassed(externalStorageSmoke);
  if (
    readinessState.status !== "ready" ||
    !storageSmokePassed
  ) {
    return blockedRequirement(
      id,
      readinessState.status === "blocked"
        ? "external-storage-service-readiness-not-live-ready"
        : "external-storage-service-readiness-missing",
      readinessState.status === "blocked"
        ? "waiting-for-live-ready-storage-evidence"
        : "waiting-for-production-storage-evidence",
      {
        storageServiceFingerprints: {
          readiness:
            readinessState.status === "ready"
              ? "ready"
              : readinessState.status === "blocked"
                ? "blocked"
                : "waiting",
          smoke: storageSmokePassed ? "passed" : "waiting",
          match: "waiting",
        },
      },
    );
  }

  const envSyncApplied = isVercelEnvSyncProductionApplied(vercelEnvSync);
  const envSyncFingerprint = envSyncApplied
    ? readVercelExternalStorageServiceFingerprint(vercelEnvSync)
    : undefined;
  const readinessFingerprint = readStorageServiceFingerprint(externalStorageServiceReadiness);
  const smokeFingerprint = readStorageServiceFingerprint(externalStorageSmoke);
  const fingerprintStatuses = {
    ...(envSyncApplied ? { vercelEnvSync: envSyncFingerprint ? "present" : "missing" } : {}),
    readiness: readinessFingerprint ? "present" : "missing",
    smoke: smokeFingerprint ? "present" : "missing",
    match: "missing",
  };

  if ((envSyncApplied && !envSyncFingerprint) || !readinessFingerprint || !smokeFingerprint) {
    return blockedRequirement(id, "external-storage-service-fingerprint-missing", "missing", {
      storageServiceFingerprints: fingerprintStatuses,
    });
  }

  if (
    readinessFingerprint !== smokeFingerprint ||
    (envSyncApplied && envSyncFingerprint !== readinessFingerprint)
  ) {
    return blockedRequirement(id, "external-storage-service-fingerprint-mismatch", "mismatched", {
      storageServiceFingerprints: {
        ...(envSyncApplied ? { vercelEnvSync: "present" } : {}),
        readiness: "present",
        smoke: "present",
        match: false,
      },
    });
  }

  return satisfiedRequirement(id, "matched", {
    storageServiceFingerprints: {
      ...(envSyncApplied ? { vercelEnvSync: "present" } : {}),
      readiness: "present",
      smoke: "present",
      match: true,
    },
  });
}

function readExternalStorageServiceReadinessConsistencyState(evidence) {
  if (!isRecord(evidence) || evidence.target !== "external-storage-service-readiness") {
    return { status: "missing" };
  }
  if (isExternalStorageServiceReadinessProductionReady(evidence)) {
    return { status: "ready" };
  }
  return { status: "blocked" };
}

function readVercelExternalStorageServiceFingerprint(evidence) {
  if (!isRecord(evidence) || !isRecord(evidence.externalStorageServiceFingerprint)) {
    return undefined;
  }
  return readOriginSha256Fingerprint(evidence.externalStorageServiceFingerprint);
}

function isExternalStorageServiceReadinessProductionReady(evidence) {
  if (!isRecord(evidence)) {
    return false;
  }
  const storageEndpoint = readStorageEndpoint(evidence?.storageEndpoint);
  const storageServiceFingerprint = readStorageServiceFingerprint(evidence) ? "present" : "missing";
  const health = readExternalStorageServiceHealth(evidence);
  const vercelEnvSyncEvidence = readExternalStorageServiceVercelEnvSyncEvidence(evidence);
  const productionLaunchContractEvidence =
    readExternalStorageServiceProductionLaunchContractEvidence(evidence);
  const persistenceEvidence = readExternalStorageServicePersistenceEvidence(evidence);
  const redactionSafety = readExternalStorageServiceReadinessSafety(evidence);
  const redactionSafetyProved = Object.values(redactionSafety).every((status) => status === "proved");
  return (
    isRecord(evidence) &&
    evidence.target === "external-storage-service-readiness" &&
    evidence.mode === "live" &&
    evidence.environment === "production" &&
    evidence.status === "ready" &&
    storageEndpoint.endpointClass === "remote-https" &&
    health.productionServiceIdentity === "proved" &&
    health.apiContractVersion === "matched" &&
    health.cacheControl === "no-store" &&
    health.durableBackingStore === "ready" &&
    isExternalStorageServiceTeachingOperationsSchemaHealthReady(
      health.teachingOperationsStorageSchema,
    ) &&
    isExternalStorageServiceProductionDatabaseAdapterHealthReady(
      health.teachingOperationsStorageSchema.productionDatabaseAdapter,
    ) &&
    areExternalStorageServiceOrdinaryCourseSchemasReady(health) &&
    health.redaction === "present" &&
    storageServiceFingerprint === "present" &&
    isExternalStorageServiceVercelEnvSyncEvidenceProved(vercelEnvSyncEvidence) &&
    productionLaunchContractEvidence.status === "ready" &&
    persistenceEvidence.status === "matched" &&
    redactionSafetyProved
  );
}

function isExternalStorageSmokeProductionPassed(evidence) {
  if (!isRecord(evidence)) {
    return false;
  }
  const okCheckIds = new Set(
    (Array.isArray(evidence.results) ? evidence.results : [])
      .filter((result) => isRecord(result) && result.status === "ok" && typeof result.id === "string")
      .map((result) => result.id),
  );
  const missingStorageChecks = requiredExternalStorageSmokeIds.filter((checkId) => !okCheckIds.has(checkId));
  const storageResponseShapes = Object.fromEntries(
    requiredExternalStorageResponseShapes.map((shapeContract) => {
      const checkResult = (Array.isArray(evidence.results) ? evidence.results : []).find(
        (result) => isRecord(result) && result.id === shapeContract.checkId,
      );
      return [
        shapeContract.key,
        readResponseShapeStatus(checkResult, shapeContract.requiredFields),
      ];
    }),
  );
  const storageResponseShapesProved = Object.values(storageResponseShapes).every(
    (status) => status === "proved",
  );
  const storageEndpointNetworkClass =
    isRecord(evidence.storageEndpoint) && typeof evidence.storageEndpoint.networkClass === "string"
      ? evidence.storageEndpoint.networkClass
      : "missing";
  const storageEndpointClass =
    isRecord(evidence.storageEndpoint) && typeof evidence.storageEndpoint.endpointClass === "string"
      ? evidence.storageEndpoint.endpointClass
      : "missing";
  const externalStorageServiceReadinessEvidence =
    readExternalStorageSmokeServiceReadinessEvidence(evidence);
  return (
    evidence.target === "external-storage-smoke" &&
    evidence.mode === "live" &&
    evidence.environment === "production" &&
    evidence.status === "passed" &&
    missingStorageChecks.length === 0 &&
    storageResponseShapesProved &&
    storageEndpointNetworkClass === "remote" &&
    storageEndpointClass === "remote-https" &&
    isExternalStorageSmokeServiceReadinessEvidenceProved(
      externalStorageServiceReadinessEvidence,
    )
  );
}

function chooseVercelProjectReadinessBlockedReason(evidence, missingChecks) {
  if (missingChecks.includes("s22-vercel-cli")) {
    return "vercel-cli-missing";
  }
  if (missingChecks.includes("s22-vercel-auth")) {
    return "vercel-auth-missing";
  }
  if (missingChecks.includes("s22-vercel-team-scope")) {
    return "vercel-team-scope-missing";
  }
  if (missingChecks.includes("s22-vercel-project-candidate")) {
    return "vercel-project-candidate-missing";
  }
  if (missingChecks.includes("s22-vercel-project-link")) {
    return "vercel-project-not-linked";
  }
  if (missingChecks.includes("s22-vercelignore-upload-hygiene")) {
    return "vercelignore-upload-hygiene-incomplete";
  }
  const evidenceBlockedReasons = Array.isArray(evidence.blockedReasons)
    ? evidence.blockedReasons.filter((reason) => typeof reason === "string")
    : [];
  return evidenceBlockedReasons[0] ?? "vercel-project-readiness-not-ready";
}

function evaluatePptAcceptance(evidence, vercelProductionDeployment) {
  const id = "ppt-manual-playback-acceptance";
  if (!isRecord(evidence)) {
    return blockedRequirement(id, "ppt-manual-acceptance-evidence-missing", "missing");
  }
  if (evidence.target !== "ppt-manual-playback-acceptance") {
    return blockedRequirement(id, "ppt-manual-acceptance-target-mismatch", readEvidenceStatus(evidence), {
      evidenceTarget: typeof evidence.target === "string" ? evidence.target : "missing",
    });
  }
  const acceptedApplications = Array.isArray(evidence.acceptedApplications)
    ? evidence.acceptedApplications.filter((value) => typeof value === "string")
    : [];
  const hasPowerPoint = acceptedApplications.includes("Microsoft PowerPoint");
  const hasWps = acceptedApplications.includes("WPS Presentation");
  const manualRecordEvidenceStatus =
    typeof evidence.manualRecordEvidenceStatus === "string" ? evidence.manualRecordEvidenceStatus : "missing";
  const machinePreflightStatus =
    typeof evidence.machinePreflightStatus === "string" ? evidence.machinePreflightStatus : "missing";
  const expectedSlideCount = Number.isInteger(evidence.expectedSlideCount)
    ? evidence.expectedSlideCount
    : "missing";
  const checklistSlideChecks =
    isRecord(evidence.checklist) && Number.isInteger(evidence.checklist.slideChecks)
      ? evidence.checklist.slideChecks
      : "missing";
  const requiredChecklistApplications =
    isRecord(evidence.checklist) && Array.isArray(evidence.checklist.requiredApplications)
      ? evidence.checklist.requiredApplications.filter((value) => typeof value === "string")
      : [];
  const packageIdentity =
    typeof evidence.packageId === "string" && evidence.packageId.trim() ? "present" : "missing";
  const packageArtifactFingerprintStatus =
    evidence.packageArtifactFingerprintStatus === "present" ? "present" : "missing";
  const packageTargetVoiceLabelStatus =
    typeof evidence.packageTargetVoiceLabelStatus === "string"
      ? evidence.packageTargetVoiceLabelStatus
      : "missing";
  const manualRecordPackageIdentityStatus =
    typeof evidence.manualRecordPackageIdentityStatus === "string"
      ? evidence.manualRecordPackageIdentityStatus
      : "missing";
  const manualRecordArtifactFingerprintStatus =
    typeof evidence.manualRecordArtifactFingerprintStatus === "string"
      ? evidence.manualRecordArtifactFingerprintStatus
      : "missing";
  const manualRecordReleaseRunStatus =
    typeof evidence.manualRecordReleaseRunStatus === "string"
      ? evidence.manualRecordReleaseRunStatus
      : "missing";
  const manualRecordDeploymentFingerprintStatus =
    typeof evidence.manualRecordDeploymentFingerprintStatus === "string"
      ? evidence.manualRecordDeploymentFingerprintStatus
      : "missing";
  const manualRecordAfterDeploymentStatus =
    typeof evidence.manualRecordAfterDeploymentStatus === "string"
      ? evidence.manualRecordAfterDeploymentStatus
      : "missing";
  const manualRecordTimingStatus =
    typeof evidence.manualRecordTimingStatus === "string" ? evidence.manualRecordTimingStatus : "missing";
  const manualRecordConfirmationStatus =
    typeof evidence.manualRecordConfirmationStatus === "string"
      ? evidence.manualRecordConfirmationStatus
      : "missing";
  const deploymentEvidenceSource =
    typeof evidence.deploymentEvidenceSource === "string"
      ? evidence.deploymentEvidenceSource
      : "missing";
  const deploymentObservationBindingStatus =
    typeof evidence.deploymentObservationBindingStatus === "string"
      ? evidence.deploymentObservationBindingStatus
      : "missing";
  const hasRequiredChecklistApplications =
    requiredChecklistApplications.includes("Microsoft PowerPoint") &&
    requiredChecklistApplications.includes("WPS Presentation");
  const hasCompleteDetailProof =
    evidence.mode === "record" &&
    machinePreflightStatus === "passed" &&
    expectedSlideCount === 19 &&
    checklistSlideChecks === 19 &&
    hasRequiredChecklistApplications;
  const releaseRunIdStatus = readReleaseRunId(evidence) ? "present" : "missing";
  const deploymentFingerprint = evaluatePptDeploymentFingerprintMatch({
    pptAcceptance: evidence,
    vercelProductionDeployment,
  });
  const manualRecordTemplate = readPptManualRecordTemplate(evidence);
  if (
    evidence.status === "accepted" &&
    evidence.manualAcceptanceStatus === "accepted" &&
    hasPowerPoint &&
    hasWps &&
    manualRecordEvidenceStatus !== "complete"
  ) {
    return blockedRequirement(id, "manual-ppt-record-evidence-incomplete", readEvidenceStatus(evidence), {
      acceptedApplications,
      manualRecordEvidenceStatus,
    });
  }
  if (
    evidence.status === "accepted" &&
    evidence.manualAcceptanceStatus === "accepted" &&
    hasPowerPoint &&
    hasWps &&
    manualRecordEvidenceStatus === "complete" &&
    !hasCompleteDetailProof
  ) {
    return blockedRequirement(id, "manual-ppt-evidence-detail-not-proven", readEvidenceStatus(evidence), {
      acceptedApplications,
      manualRecordEvidenceStatus,
      machinePreflightStatus,
      expectedSlideCount,
      checklistSlideChecks,
      requiredChecklistApplications,
    });
  }
  if (
    evidence.status === "accepted" &&
    evidence.manualAcceptanceStatus === "accepted" &&
    hasPowerPoint &&
    hasWps &&
    manualRecordEvidenceStatus === "complete" &&
    hasCompleteDetailProof &&
    (packageIdentity === "missing" || manualRecordPackageIdentityStatus !== "matched")
  ) {
    return blockedRequirement(id, "manual-ppt-package-identity-not-proven", readEvidenceStatus(evidence), {
      acceptedApplications,
      manualRecordEvidenceStatus,
      manualRecordPackageIdentityStatus,
      machinePreflightStatus,
      expectedSlideCount,
      checklistSlideChecks,
      requiredChecklistApplications,
      packageIdentity,
      packageArtifactFingerprintStatus,
      manualRecordArtifactFingerprintStatus,
      manualRecordTimingStatus,
      manualRecordConfirmationStatus,
    });
  }
  if (
    evidence.status === "accepted" &&
    evidence.manualAcceptanceStatus === "accepted" &&
    hasPowerPoint &&
    hasWps &&
    manualRecordEvidenceStatus === "complete" &&
    hasCompleteDetailProof &&
    packageIdentity === "present" &&
    manualRecordPackageIdentityStatus === "matched" &&
    manualRecordTimingStatus !== "valid-past-or-present"
  ) {
    return blockedRequirement(id, "manual-ppt-tested-at-timing-not-proven", readEvidenceStatus(evidence), {
      acceptedApplications,
      manualRecordEvidenceStatus,
      manualRecordPackageIdentityStatus,
      machinePreflightStatus,
      expectedSlideCount,
      checklistSlideChecks,
      requiredChecklistApplications,
      packageIdentity,
      packageArtifactFingerprintStatus,
      manualRecordArtifactFingerprintStatus,
      manualRecordTimingStatus,
      manualRecordConfirmationStatus,
    });
  }
  if (
    evidence.status === "accepted" &&
    evidence.manualAcceptanceStatus === "accepted" &&
    hasPowerPoint &&
    hasWps &&
    manualRecordEvidenceStatus === "complete" &&
    hasCompleteDetailProof &&
    packageIdentity === "present" &&
    manualRecordPackageIdentityStatus === "matched" &&
    manualRecordTimingStatus === "valid-past-or-present" &&
    (packageArtifactFingerprintStatus !== "present" ||
      manualRecordArtifactFingerprintStatus !== "matched")
  ) {
    return blockedRequirement(id, "manual-ppt-artifact-fingerprint-not-proven", readEvidenceStatus(evidence), {
      acceptedApplications,
      manualRecordEvidenceStatus,
      manualRecordPackageIdentityStatus,
      packageArtifactFingerprintStatus,
      manualRecordArtifactFingerprintStatus,
      machinePreflightStatus,
      expectedSlideCount,
      checklistSlideChecks,
      requiredChecklistApplications,
      packageIdentity,
      manualRecordTimingStatus,
      manualRecordConfirmationStatus,
    });
  }
  if (
    evidence.status === "accepted" &&
    evidence.manualAcceptanceStatus === "accepted" &&
    hasPowerPoint &&
    hasWps &&
    manualRecordEvidenceStatus === "complete" &&
    hasCompleteDetailProof &&
    packageIdentity === "present" &&
    manualRecordPackageIdentityStatus === "matched" &&
    manualRecordTimingStatus === "valid-past-or-present" &&
    packageArtifactFingerprintStatus === "present" &&
    manualRecordArtifactFingerprintStatus === "matched" &&
    manualRecordConfirmationStatus !== "accepted-after-human-playback"
  ) {
    return blockedRequirement(id, "manual-ppt-human-confirmation-not-proven", readEvidenceStatus(evidence), {
      acceptedApplications,
      manualRecordEvidenceStatus,
      manualRecordPackageIdentityStatus,
      packageArtifactFingerprintStatus,
      manualRecordArtifactFingerprintStatus,
      manualRecordTimingStatus,
      manualRecordConfirmationStatus,
      machinePreflightStatus,
      expectedSlideCount,
      checklistSlideChecks,
      requiredChecklistApplications,
      packageIdentity,
    });
  }
  if (
    evidence.status === "accepted" &&
    evidence.manualAcceptanceStatus === "accepted" &&
    hasPowerPoint &&
    hasWps &&
    manualRecordEvidenceStatus === "complete" &&
    hasCompleteDetailProof &&
    packageIdentity === "present" &&
    manualRecordPackageIdentityStatus === "matched" &&
    manualRecordTimingStatus === "valid-past-or-present" &&
    packageArtifactFingerprintStatus === "present" &&
    manualRecordArtifactFingerprintStatus === "matched" &&
    manualRecordConfirmationStatus === "accepted-after-human-playback" &&
    packageTargetVoiceLabelStatus !== "present"
  ) {
    return blockedRequirement(id, "manual-ppt-target-voice-label-not-proven", readEvidenceStatus(evidence), {
      acceptedApplications,
      manualRecordEvidenceStatus,
      manualRecordPackageIdentityStatus,
      packageArtifactFingerprintStatus,
      manualRecordArtifactFingerprintStatus,
      manualRecordTimingStatus,
      manualRecordConfirmationStatus,
      packageTargetVoiceLabelStatus,
      machinePreflightStatus,
      expectedSlideCount,
      checklistSlideChecks,
      requiredChecklistApplications,
      packageIdentity,
    });
  }
  if (
    evidence.status === "accepted" &&
    evidence.manualAcceptanceStatus === "accepted" &&
    hasPowerPoint &&
    hasWps &&
    manualRecordEvidenceStatus === "complete" &&
    hasCompleteDetailProof &&
    packageIdentity === "present" &&
    manualRecordPackageIdentityStatus === "matched" &&
    manualRecordTimingStatus === "valid-past-or-present" &&
    packageArtifactFingerprintStatus === "present" &&
    manualRecordArtifactFingerprintStatus === "matched" &&
    manualRecordConfirmationStatus === "accepted-after-human-playback" &&
    releaseRunIdStatus === "present" &&
    manualRecordReleaseRunStatus === "matched" &&
    (manualRecordDeploymentFingerprintStatus !== "matched" ||
      deploymentFingerprint.status === "blocked")
  ) {
    return blockedRequirement(
      id,
      "manual-ppt-deployment-fingerprint-binding-not-proven",
      readEvidenceStatus(evidence),
      {
        acceptedApplications,
        manualRecordEvidenceStatus,
        manualRecordPackageIdentityStatus,
        packageArtifactFingerprintStatus,
        manualRecordArtifactFingerprintStatus,
        manualRecordReleaseRunStatus,
        releaseRunIdStatus,
        deploymentFingerprint: deploymentFingerprint.details,
        manualRecordDeploymentFingerprintStatus,
        manualRecordAfterDeploymentStatus,
        manualRecordTimingStatus,
        manualRecordConfirmationStatus,
        machinePreflightStatus,
        expectedSlideCount,
        checklistSlideChecks,
        requiredChecklistApplications,
        packageIdentity,
      },
    );
  }
  if (
    evidence.status === "accepted" &&
    evidence.manualAcceptanceStatus === "accepted" &&
    hasPowerPoint &&
    hasWps &&
    manualRecordEvidenceStatus === "complete" &&
    hasCompleteDetailProof &&
    packageIdentity === "present" &&
    manualRecordPackageIdentityStatus === "matched" &&
    manualRecordTimingStatus === "valid-past-or-present" &&
    packageArtifactFingerprintStatus === "present" &&
    manualRecordArtifactFingerprintStatus === "matched" &&
    manualRecordConfirmationStatus === "accepted-after-human-playback" &&
    (releaseRunIdStatus !== "present" || manualRecordReleaseRunStatus !== "matched")
  ) {
    return blockedRequirement(id, "manual-ppt-release-run-binding-not-proven", readEvidenceStatus(evidence), {
      acceptedApplications,
      manualRecordEvidenceStatus,
      manualRecordPackageIdentityStatus,
      packageArtifactFingerprintStatus,
      manualRecordArtifactFingerprintStatus,
      manualRecordReleaseRunStatus,
      releaseRunIdStatus,
      manualRecordTimingStatus,
      manualRecordConfirmationStatus,
      machinePreflightStatus,
      expectedSlideCount,
      checklistSlideChecks,
      requiredChecklistApplications,
      packageIdentity,
    });
  }
  if (
    evidence.status === "accepted" &&
    evidence.manualAcceptanceStatus === "accepted" &&
    hasPowerPoint &&
    hasWps &&
    manualRecordEvidenceStatus === "complete" &&
    hasCompleteDetailProof &&
    packageIdentity === "present" &&
    manualRecordPackageIdentityStatus === "matched" &&
    manualRecordTimingStatus === "valid-past-or-present" &&
    packageArtifactFingerprintStatus === "present" &&
    manualRecordArtifactFingerprintStatus === "matched" &&
    manualRecordConfirmationStatus === "accepted-after-human-playback" &&
    releaseRunIdStatus === "present" &&
    manualRecordReleaseRunStatus === "matched" &&
    deploymentFingerprint.status !== "blocked" &&
    (deploymentFingerprint.status !== "matched" ||
      manualRecordDeploymentFingerprintStatus === "matched") &&
    manualRecordAfterDeploymentStatus !== "proved"
  ) {
    return blockedRequirement(id, "manual-ppt-tested-after-deployment-not-proven", readEvidenceStatus(evidence), {
      acceptedApplications,
      manualRecordEvidenceStatus,
      manualRecordPackageIdentityStatus,
      packageArtifactFingerprintStatus,
      manualRecordArtifactFingerprintStatus,
      manualRecordReleaseRunStatus,
      releaseRunIdStatus,
      manualRecordDeploymentFingerprintStatus,
      manualRecordAfterDeploymentStatus,
      manualRecordTimingStatus,
      manualRecordConfirmationStatus,
      machinePreflightStatus,
      expectedSlideCount,
      checklistSlideChecks,
      requiredChecklistApplications,
      packageIdentity,
    });
  }
  if (
    evidence.status === "accepted" &&
    evidence.manualAcceptanceStatus === "accepted" &&
    hasPowerPoint &&
    hasWps &&
    manualRecordEvidenceStatus === "complete" &&
    hasCompleteDetailProof &&
    packageIdentity === "present" &&
    manualRecordPackageIdentityStatus === "matched" &&
    manualRecordTimingStatus === "valid-past-or-present" &&
    packageArtifactFingerprintStatus === "present" &&
    manualRecordArtifactFingerprintStatus === "matched" &&
    manualRecordConfirmationStatus === "accepted-after-human-playback" &&
    releaseRunIdStatus === "present" &&
    manualRecordReleaseRunStatus === "matched" &&
    deploymentFingerprint.status !== "blocked" &&
    (deploymentFingerprint.status !== "matched" ||
      manualRecordDeploymentFingerprintStatus === "matched") &&
    manualRecordAfterDeploymentStatus === "proved"
  ) {
    if (
      deploymentEvidenceSource !== "vercel-production-deployment" ||
      deploymentObservationBindingStatus !== "proved"
    ) {
      return blockedRequirement(
        id,
        "manual-ppt-deployment-evidence-source-not-proven",
        readEvidenceStatus(evidence),
        {
          acceptedApplications,
          manualRecordEvidenceStatus,
          manualRecordPackageIdentityStatus,
          packageArtifactFingerprintStatus,
          manualRecordArtifactFingerprintStatus,
          manualRecordReleaseRunStatus,
          releaseRunIdStatus,
          manualRecordDeploymentFingerprintStatus,
          manualRecordAfterDeploymentStatus,
          deploymentEvidenceSource,
          deploymentObservationBindingStatus,
          manualRecordTimingStatus,
          manualRecordConfirmationStatus,
          machinePreflightStatus,
          expectedSlideCount,
          checklistSlideChecks,
          requiredChecklistApplications,
          packageIdentity,
          packageTargetVoiceLabelStatus,
          ...(deploymentFingerprint.status === "matched"
            ? { deploymentFingerprint: deploymentFingerprint.details }
            : {}),
        },
      );
    }
    return satisfiedRequirement(id, "accepted", {
      acceptedApplications,
      manualRecordEvidenceStatus,
      manualRecordPackageIdentityStatus,
      packageArtifactFingerprintStatus,
      manualRecordArtifactFingerprintStatus,
      manualRecordReleaseRunStatus,
      releaseRunIdStatus,
      manualRecordDeploymentFingerprintStatus,
      manualRecordAfterDeploymentStatus,
      deploymentEvidenceSource,
      deploymentObservationBindingStatus,
      machinePreflightStatus,
      expectedSlideCount,
      checklistSlideChecks,
      requiredChecklistApplications,
      packageIdentity,
      packageArtifactFingerprintStatus,
      packageTargetVoiceLabelStatus,
      manualRecordArtifactFingerprintStatus,
      manualRecordTimingStatus,
      manualRecordConfirmationStatus,
      ...(deploymentFingerprint.status === "matched"
        ? { deploymentFingerprint: deploymentFingerprint.details }
        : {}),
    });
  }
  return blockedRequirement(id, "manual-ppt-playback-not-accepted", readEvidenceStatus(evidence), {
    acceptedApplications,
    manualRecordEvidenceStatus,
    manualRecordPackageIdentityStatus,
    machinePreflightStatus,
    expectedSlideCount,
    checklistSlideChecks,
    packageArtifactFingerprintStatus,
    packageTargetVoiceLabelStatus,
    manualRecordArtifactFingerprintStatus,
    manualRecordReleaseRunStatus,
    manualRecordAfterDeploymentStatus,
    manualRecordTimingStatus,
    manualRecordConfirmationStatus,
    ...(manualRecordTemplate ? { manualRecordTemplate } : {}),
  });
}

function readPptManualRecordTemplate(evidence) {
  const template = isRecord(evidence.manualRecordTemplate)
    ? evidence.manualRecordTemplate
    : undefined;
  if (!template || template.valuesRedacted !== true) {
    return undefined;
  }
  return {
    fileName: typeof template.fileName === "string" ? template.fileName : "missing",
    status: template.status === "created" ? "created" : "missing",
    accepted: template.accepted === true,
    applications: Array.isArray(template.applications)
      ? template.applications.filter((value) => typeof value === "string")
      : [],
    slideChecksPerApplication: Number.isInteger(template.slideChecksPerApplication)
      ? template.slideChecksPerApplication
      : "missing",
    valuesRedacted: true,
  };
}

function evaluateEnterpriseLiveEvidenceAudit(evidence) {
  const id = "enterprise-live-evidence-audit";
  if (!isRecord(evidence)) {
    return blockedRequirement(id, "enterprise-live-evidence-audit-missing", "missing");
  }

  const auditDate = typeof evidence.date === "string" ? evidence.date : "missing";
  const summary = readEnterpriseLiveEvidenceAuditSummary(evidence.summary);
  const rowProof = readEnterpriseLiveEvidenceAuditRowProof(evidence.rows, summary, auditDate);
  const summaryTargetProofStatus =
    readEnterpriseLiveEvidenceAuditSummaryTargetProofStatus(summary, rowProof);
  const unexpectedTargetProof =
    readEnterpriseLiveEvidenceAuditUnexpectedTargetProof(evidence, summary);
  const unexpectedEvidenceFileProof =
    readEnterpriseLiveEvidenceAuditUnexpectedEvidenceFileProof(evidence, summary);
  const topLevelTargetListStatus =
    readEnterpriseLiveEvidenceAuditTopLevelTargetListStatus(evidence, rowProof);
  const filenamePatternCriteriaStatus =
    readEnterpriseLiveEvidenceAuditFilenamePatternStatus(evidence.criteria, auditDate);
  const acceptedTargetStatusCriteriaStatus =
    readEnterpriseLiveEvidenceAuditAcceptedTargetStatusesStatus(evidence.criteria);
  const acceptedTargetModeCriteriaStatus =
    readEnterpriseLiveEvidenceAuditAcceptedTargetModesStatus(evidence.criteria);
  const acceptedBodyFieldCriteriaStatus =
    readEnterpriseLiveEvidenceAuditAcceptedBodyFieldCriteriaStatus(
      evidence.criteria,
      acceptedTargetStatusCriteriaStatus,
      acceptedTargetModeCriteriaStatus,
    );
  const requiredTargetCriteriaStatus =
    readEnterpriseLiveEvidenceAuditRequiredTargetsStatus(evidence.criteria);
  const requiredTargetResultCriteriaStatus =
    readEnterpriseLiveEvidenceAuditRequiredTargetResultKeysStatus(evidence.criteria);
  const requiredTargetEnvCriteriaStatus =
    readEnterpriseLiveEvidenceAuditRequiredTargetEnvKeysStatus(evidence.criteria);
  const requiredTargetContractCriteriaStatus =
    readEnterpriseLiveEvidenceAuditRequiredTargetContractKeysStatus(evidence.criteria);
  const safety = readEnterpriseLiveEvidenceAuditSafety(evidence.safety, evidence.criteria);
  const auditBlockedReasons = Array.isArray(evidence.blockedReasons)
    ? evidence.blockedReasons.filter((reason) => typeof reason === "string")
    : [];
  const details = {
    totalProductionLiveNamed: summary.totalProductionLiveNamed,
    acceptedLiveEvidence: summary.acceptedLiveEvidence,
    filenameOnlyOrBlocked: summary.filenameOnlyOrBlocked,
    releaseRunIdConsistency: summary.releaseRunIdConsistency,
    sharedReleaseRunIdStatus: summary.sharedReleaseRunIdStatus,
    distinctReleaseRunIdCount: summary.distinctReleaseRunIdCount,
    rowProofStatus: rowProof.rowProofStatus,
    rowCount: rowProof.rowCount,
    acceptedRowCount: rowProof.acceptedRowCount,
    blockedRowCount: rowProof.blockedRowCount,
    requiredTargetProofStatus: rowProof.requiredTargetProofStatus,
    summaryTargetProofStatus,
    unexpectedTargetCount: summary.unexpectedTargetCount,
    unexpectedTargetProofStatus: unexpectedTargetProof.unexpectedTargetProofStatus,
    unexpectedTargets: unexpectedTargetProof.unexpectedTargets,
    unexpectedEvidenceFileCount: summary.unexpectedEvidenceFileCount,
    unexpectedEvidenceFileProofStatus:
      unexpectedEvidenceFileProof.unexpectedEvidenceFileProofStatus,
    unexpectedEvidenceFiles: unexpectedEvidenceFileProof.unexpectedEvidenceFiles,
    topLevelTargetListStatus,
    filenamePatternCriteriaStatus,
    acceptedTargetStatusCriteriaStatus,
    acceptedTargetModeCriteriaStatus,
    acceptedBodyFieldCriteriaStatus,
    requiredTargetCriteriaStatus,
    requiredTargetResultCriteriaStatus,
    requiredTargetEnvCriteriaStatus,
    requiredTargetContractCriteriaStatus,
    requiredTargets: requiredEnterpriseLiveEvidenceAuditTargets,
    acceptedTargets: rowProof.acceptedTargets,
    missingRequiredTargets: rowProof.missingRequiredTargets,
    auditBlockedReasons,
    safety,
  };

  if (evidence.target !== "enterprise-live-evidence-audit") {
    return blockedRequirement(
      id,
      "enterprise-live-evidence-audit-target-mismatch",
      readEvidenceStatus(evidence),
      details,
    );
  }
  if (summary.totalProductionLiveNamed <= 0) {
    return blockedRequirement(
      id,
      "enterprise-live-evidence-audit-empty",
      readEvidenceStatus(evidence),
      details,
    );
  }
  if (
    evidence.status === "ready" &&
    summary.filenameOnlyOrBlocked === 0 &&
    summary.acceptedLiveEvidence === summary.totalProductionLiveNamed &&
    summary.releaseRunIdConsistency === "matched" &&
    summary.sharedReleaseRunIdStatus === "present" &&
    rowProof.rowProofStatus === "proved" &&
    rowProof.blockedRowCount === 0 &&
    rowProof.requiredTargetProofStatus === "proved" &&
    summaryTargetProofStatus === "proved" &&
    unexpectedTargetProof.unexpectedTargetProofStatus === "proved" &&
    unexpectedEvidenceFileProof.unexpectedEvidenceFileProofStatus === "proved" &&
    topLevelTargetListStatus === "proved" &&
    filenamePatternCriteriaStatus === "proved" &&
    acceptedBodyFieldCriteriaStatus === "proved" &&
    requiredTargetCriteriaStatus === "proved" &&
    requiredTargetResultCriteriaStatus === "proved" &&
    requiredTargetEnvCriteriaStatus === "proved" &&
    requiredTargetContractCriteriaStatus === "proved" &&
    auditBlockedReasons.length === 0 &&
    isEnterpriseLiveEvidenceAuditSafetyProved(safety)
  ) {
    return satisfiedRequirement(id, "ready", details);
  }

  return blockedRequirement(
    id,
    "enterprise-live-evidence-audit-not-ready",
    readEvidenceStatus(evidence),
    details,
  );
}

function readEnterpriseLiveEvidenceAuditSummary(summary) {
  if (!isRecord(summary)) {
    return {
      totalProductionLiveNamed: 0,
      acceptedLiveEvidence: 0,
      filenameOnlyOrBlocked: 0,
      releaseRunIdConsistency: "missing",
      sharedReleaseRunIdStatus: "missing",
      distinctReleaseRunIdCount: 0,
      requiredTargetProofStatus: "missing",
      missingRequiredTargetCount: null,
      unexpectedTargetCount: null,
      unexpectedEvidenceFileCount: null,
    };
  }
  return {
    totalProductionLiveNamed: Number.isInteger(summary.totalProductionLiveNamed)
      ? summary.totalProductionLiveNamed
      : 0,
    acceptedLiveEvidence: Number.isInteger(summary.acceptedLiveEvidence)
      ? summary.acceptedLiveEvidence
      : 0,
    filenameOnlyOrBlocked: Number.isInteger(summary.filenameOnlyOrBlocked)
      ? summary.filenameOnlyOrBlocked
      : 0,
    releaseRunIdConsistency:
      summary.releaseRunIdConsistency === "matched" ||
      summary.releaseRunIdConsistency === "mismatched" ||
      summary.releaseRunIdConsistency === "missing"
        ? summary.releaseRunIdConsistency
        : "missing",
    sharedReleaseRunIdStatus:
      summary.sharedReleaseRunIdStatus === "present" ? "present" : "missing",
    distinctReleaseRunIdCount: Number.isInteger(summary.distinctReleaseRunIdCount)
      ? summary.distinctReleaseRunIdCount
      : 0,
    requiredTargetProofStatus:
      summary.requiredTargetProofStatus === "proved" ||
      summary.requiredTargetProofStatus === "missing"
        ? summary.requiredTargetProofStatus
        : "missing",
    missingRequiredTargetCount: Number.isInteger(summary.missingRequiredTargetCount)
      ? summary.missingRequiredTargetCount
      : null,
    unexpectedTargetCount: Number.isInteger(summary.unexpectedTargetCount)
      ? summary.unexpectedTargetCount
      : null,
    unexpectedEvidenceFileCount: Number.isInteger(summary.unexpectedEvidenceFileCount)
      ? summary.unexpectedEvidenceFileCount
      : null,
  };
}

function readEnterpriseLiveEvidenceAuditRowProof(rows, summary, auditDate) {
  if (!Array.isArray(rows)) {
    return {
      rowProofStatus: "missing",
      rowCount: 0,
      acceptedRowCount: 0,
      blockedRowCount: 0,
      requiredTargetProofStatus: "missing",
      acceptedTargets: [],
      missingRequiredTargets: requiredEnterpriseLiveEvidenceAuditTargets,
    };
  }
  const rowCount = rows.length;
  const acceptedRows = rows.filter((row) =>
    isAcceptedEnterpriseLiveEvidenceAuditRow(row, auditDate),
  );
  const acceptedRowCount = acceptedRows.length;
  const blockedRowCount = rowCount - acceptedRowCount;
  const summaryMatched =
    rowCount === summary.totalProductionLiveNamed &&
    acceptedRowCount === summary.acceptedLiveEvidence &&
    blockedRowCount === summary.filenameOnlyOrBlocked;
  const acceptedTargets = [
    ...new Set(
      acceptedRows
        .map((row) => row.target)
        .filter((target) => typeof target === "string")
        .sort(),
    ),
  ];
  const acceptedTargetSet = new Set(acceptedTargets);
  const missingRequiredTargets = requiredEnterpriseLiveEvidenceAuditTargets.filter(
    (target) => !acceptedTargetSet.has(target),
  );
  return {
    rowProofStatus: summaryMatched ? "proved" : "contradicted",
    rowCount,
    acceptedRowCount,
    blockedRowCount,
    requiredTargetProofStatus:
      missingRequiredTargets.length === 0 ? "proved" : "missing",
    acceptedTargets,
    missingRequiredTargets,
  };
}

function readEnterpriseLiveEvidenceAuditSummaryTargetProofStatus(summary, rowProof) {
  return summary.requiredTargetProofStatus === rowProof.requiredTargetProofStatus &&
    summary.missingRequiredTargetCount === rowProof.missingRequiredTargets.length
    ? "proved"
    : "contradicted";
}

function readEnterpriseLiveEvidenceAuditUnexpectedTargetProof(evidence, summary) {
  const unexpectedTargets = Array.isArray(evidence.unexpectedTargets)
    ? evidence.unexpectedTargets.filter((target) => typeof target === "string")
    : [];
  if (!Array.isArray(evidence.unexpectedTargets) || summary.unexpectedTargetCount === null) {
    return {
      unexpectedTargetProofStatus: "missing",
      unexpectedTargets,
    };
  }
  if (summary.unexpectedTargetCount !== unexpectedTargets.length) {
    return {
      unexpectedTargetProofStatus: "contradicted",
      unexpectedTargets,
    };
  }
  return {
    unexpectedTargetProofStatus:
      unexpectedTargets.length === 0 ? "proved" : "unexpected-present",
    unexpectedTargets,
  };
}

function readEnterpriseLiveEvidenceAuditUnexpectedEvidenceFileProof(evidence, summary) {
  const unexpectedEvidenceFiles = Array.isArray(evidence.unexpectedEvidenceFiles)
    ? evidence.unexpectedEvidenceFiles.filter((file) => typeof file === "string")
    : [];
  if (
    !Array.isArray(evidence.unexpectedEvidenceFiles) ||
    summary.unexpectedEvidenceFileCount === null
  ) {
    return {
      unexpectedEvidenceFileProofStatus: "missing",
      unexpectedEvidenceFiles,
    };
  }
  if (summary.unexpectedEvidenceFileCount !== unexpectedEvidenceFiles.length) {
    return {
      unexpectedEvidenceFileProofStatus: "contradicted",
      unexpectedEvidenceFiles,
    };
  }
  return {
    unexpectedEvidenceFileProofStatus:
      unexpectedEvidenceFiles.length === 0 ? "proved" : "unexpected-present",
    unexpectedEvidenceFiles,
  };
}

function readEnterpriseLiveEvidenceAuditTopLevelTargetListStatus(evidence, rowProof) {
  const requiredTargets = Array.isArray(evidence.requiredTargets)
    ? evidence.requiredTargets.filter((target) => typeof target === "string")
    : [];
  const acceptedTargets = Array.isArray(evidence.acceptedTargets)
    ? evidence.acceptedTargets
      .filter((target) => typeof target === "string")
      .sort()
    : [];
  const missingRequiredTargets = Array.isArray(evidence.missingRequiredTargets)
    ? evidence.missingRequiredTargets
      .filter((target) => typeof target === "string")
      .sort()
    : [];
  const expectedAcceptedTargets = [...rowProof.acceptedTargets].sort();
  const expectedMissingRequiredTargets = [...rowProof.missingRequiredTargets].sort();
  const requiredTargetsMatch =
    requiredTargets.length === requiredEnterpriseLiveEvidenceAuditTargets.length &&
    requiredEnterpriseLiveEvidenceAuditTargets.every(
      (target, index) => requiredTargets[index] === target,
    );
  const acceptedTargetsMatch =
    acceptedTargets.length === expectedAcceptedTargets.length &&
    expectedAcceptedTargets.every((target, index) => acceptedTargets[index] === target);
  const missingRequiredTargetsMatch =
    missingRequiredTargets.length === expectedMissingRequiredTargets.length &&
    expectedMissingRequiredTargets.every(
      (target, index) => missingRequiredTargets[index] === target,
    );

  return requiredTargetsMatch && acceptedTargetsMatch && missingRequiredTargetsMatch
    ? "proved"
    : "contradicted";
}

function isAcceptedEnterpriseLiveEvidenceAuditRow(row, auditDate) {
  if (!isRecord(row)) {
    return false;
  }
  const blockedReasons = Array.isArray(row.blockedReasons)
    ? row.blockedReasons.filter((reason) => typeof reason === "string")
    : [];
  const missingResultKeys = Array.isArray(row.missingResultKeys)
    ? row.missingResultKeys.filter((key) => typeof key === "string")
    : [];
  const missingContractKeys = Array.isArray(row.missingContractKeys)
    ? row.missingContractKeys.filter((key) => typeof key === "string")
    : [];
  return (
    typeof row.file === "string" &&
    isEnterpriseLiveEvidenceAuditFileNameOnly(row.file) &&
    readEnterpriseLiveEvidenceAuditFilenameDate(row.file) === auditDate &&
    typeof row.target === "string" &&
    isEnterpriseLiveEvidenceAuditTarget(row.target) &&
    row.filenameTarget === readEnterpriseLiveEvidenceAuditFilenameTarget(row.file) &&
    readEnterpriseLiveEvidenceAuditFilenameTarget(row.file) === row.target &&
    requiredEnterpriseLiveEvidenceAuditTargets.includes(row.target) &&
    row.mode === readEnterpriseLiveEvidenceAuditExpectedMode(row.target) &&
    row.expectedMode === readEnterpriseLiveEvidenceAuditExpectedMode(row.target) &&
    row.environment === "production" &&
    row.status === readEnterpriseLiveEvidenceAuditExpectedStatus(row.target) &&
    row.expectedStatus === readEnterpriseLiveEvidenceAuditExpectedStatus(row.target) &&
    row.targetResultStatus ===
      readEnterpriseLiveEvidenceAuditExpectedTargetResultStatus(row.target) &&
    missingResultKeys.length === 0 &&
    row.targetEnvStatus === readEnterpriseLiveEvidenceAuditExpectedTargetEnvStatus(row.target) &&
    !hasEnterpriseLiveEvidenceAuditMissingEnvKeys(row) &&
    row.targetContractStatus ===
      readEnterpriseLiveEvidenceAuditExpectedTargetContractStatus(row.target) &&
    missingContractKeys.length === 0 &&
    row.releaseRunIdStatus === "present" &&
    row.safetyStatus === "proved" &&
    row.acceptanceStatus === "accepted-live-evidence" &&
    blockedReasons.length === 0
  );
}

function hasEnterpriseLiveEvidenceAuditMissingEnvKeys(row) {
  const missingEnvKeys = Array.isArray(row.missingEnvKeys)
    ? row.missingEnvKeys.filter((key) => typeof key === "string")
    : [];
  return missingEnvKeys.length > 0;
}

function readEnterpriseLiveEvidenceAuditFilenameDate(file) {
  if (typeof file !== "string") {
    return "missing";
  }
  const match = file.match(/^(\d{4}-\d{2}-\d{2})-.+-production-live\.json$/);
  return match ? match[1] : "missing";
}

function isEnterpriseLiveEvidenceAuditTarget(target) {
  return (
    typeof target === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(target) &&
    !target.includes("..")
  );
}

function readEnterpriseLiveEvidenceAuditFilenameTarget(file) {
  if (typeof file !== "string") {
    return "missing";
  }
  const match = file.match(/^\d{4}-\d{2}-\d{2}-(.+)-production-live\.json$/);
  if (!match) {
    return "missing";
  }
  return match[1] === "route-smoke" ? "deployment-route-smoke" : match[1];
}

function isEnterpriseLiveEvidenceAuditFileNameOnly(file) {
  return (
    typeof file === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(file) &&
    !file.includes("..")
  );
}

function readEnterpriseLiveEvidenceAuditSafety(safety, criteria) {
  return {
    valuesRedacted: isRecord(safety) && safety.valuesRedacted === true ? "proved" : "missing",
    cookieValuesOmitted:
      isRecord(safety) && safety.cookieValuesOmitted === true ? "proved" : "missing",
    localPathsOmitted:
      isRecord(safety) && safety.localPathsOmitted === true ? "proved" : "missing",
    fileNamesOnly: isRecord(safety) && safety.fileNamesOnly === true ? "proved" : "missing",
    responseBodiesOmitted:
      isRecord(safety) && safety.responseBodiesOmitted === true ? "proved" : "missing",
    requiredSafetyFlags:
      readEnterpriseLiveEvidenceAuditRequiredSafetyFlagsStatus(criteria),
  };
}

function isEnterpriseLiveEvidenceAuditSafetyProved(safety) {
  return Object.values(safety).every((status) => status === "proved");
}

function readEnterpriseLiveEvidenceAuditRequiredSafetyFlagsStatus(criteria) {
  const acceptedBodyFields = isRecord(criteria) && isRecord(criteria.acceptedBodyFields)
    ? criteria.acceptedBodyFields
    : undefined;
  const requiredSafetyFlags = Array.isArray(acceptedBodyFields?.requiredSafetyFlags)
    ? acceptedBodyFields.requiredSafetyFlags.filter((flag) => typeof flag === "string")
    : [];
  const expected = requiredEnterpriseLiveEvidenceAuditSafetyFlags;
  const matches =
    requiredSafetyFlags.length === expected.length &&
    expected.every((flag, index) => requiredSafetyFlags[index] === flag);

  return matches ? "proved" : "missing";
}

function readEnterpriseLiveEvidenceAuditFilenamePatternStatus(criteria, auditDate) {
  if (!isRecord(criteria)) {
    return "missing";
  }
  return criteria.filenamePattern === `${auditDate}-*production-live*.json`
    ? "proved"
    : "missing";
}

function readEnterpriseLiveEvidenceAuditAcceptedTargetStatusesStatus(criteria) {
  const acceptedBodyFields = isRecord(criteria) && isRecord(criteria.acceptedBodyFields)
    ? criteria.acceptedBodyFields
    : undefined;
  const acceptedTargetStatuses = isRecord(acceptedBodyFields?.acceptedTargetStatuses)
    ? acceptedBodyFields.acceptedTargetStatuses
    : {};
  const expectedEntries = Object.entries(
    acceptedEnterpriseLiveEvidenceAuditTargetStatuses,
  ).sort(([left], [right]) => left.localeCompare(right));
  const actualEntries = Object.entries(acceptedTargetStatuses)
    .filter(([, value]) => typeof value === "string")
    .sort(([left], [right]) => left.localeCompare(right));
  const matches =
    actualEntries.length === expectedEntries.length &&
    expectedEntries.every(
      ([target, status], index) =>
        actualEntries[index][0] === target && actualEntries[index][1] === status,
    );

  return matches ? "proved" : "missing";
}

function readEnterpriseLiveEvidenceAuditAcceptedTargetModesStatus(criteria) {
  const acceptedBodyFields = isRecord(criteria) && isRecord(criteria.acceptedBodyFields)
    ? criteria.acceptedBodyFields
    : undefined;
  const acceptedTargetModes = isRecord(acceptedBodyFields?.acceptedTargetModes)
    ? acceptedBodyFields.acceptedTargetModes
    : {};
  const expectedEntries = Object.entries(
    acceptedEnterpriseLiveEvidenceAuditTargetModes,
  ).sort(([left], [right]) => left.localeCompare(right));
  const actualEntries = Object.entries(acceptedTargetModes)
    .filter(([, value]) => typeof value === "string")
    .sort(([left], [right]) => left.localeCompare(right));
  const matches =
    actualEntries.length === expectedEntries.length &&
    expectedEntries.every(
      ([target, mode], index) =>
        actualEntries[index][0] === target && actualEntries[index][1] === mode,
    );

  return matches ? "proved" : "missing";
}

function readEnterpriseLiveEvidenceAuditAcceptedBodyFieldCriteriaStatus(
  criteria,
  acceptedTargetStatusCriteriaStatus,
  acceptedTargetModeCriteriaStatus,
) {
  const acceptedBodyFields = isRecord(criteria) && isRecord(criteria.acceptedBodyFields)
    ? criteria.acceptedBodyFields
    : undefined;
  return acceptedBodyFields?.mode === "live" &&
    acceptedBodyFields?.environment === "production" &&
    acceptedBodyFields?.defaultStatus === "passed" &&
    acceptedTargetStatusCriteriaStatus === "proved" &&
    acceptedTargetModeCriteriaStatus === "proved" &&
    acceptedBodyFields?.releaseRunId === "non-secret-release-id" &&
    acceptedBodyFields?.sharedReleaseRunId === "same-non-secret-release-id"
    ? "proved"
    : "missing";
}

function readEnterpriseLiveEvidenceAuditRequiredTargetsStatus(criteria) {
  const acceptedBodyFields = isRecord(criteria) && isRecord(criteria.acceptedBodyFields)
    ? criteria.acceptedBodyFields
    : undefined;
  const requiredTargets = Array.isArray(acceptedBodyFields?.requiredTargets)
    ? acceptedBodyFields.requiredTargets.filter((target) => typeof target === "string")
    : [];
  const expected = requiredEnterpriseLiveEvidenceAuditTargets;
  const matches =
    requiredTargets.length === expected.length &&
    expected.every((target, index) => requiredTargets[index] === target);

  return matches ? "proved" : "missing";
}

function readEnterpriseLiveEvidenceAuditRequiredTargetResultKeysStatus(criteria) {
  const acceptedBodyFields = isRecord(criteria) && isRecord(criteria.acceptedBodyFields)
    ? criteria.acceptedBodyFields
    : undefined;
  const requiredTargetResultKeys = isRecord(acceptedBodyFields?.requiredTargetResultKeys)
    ? acceptedBodyFields.requiredTargetResultKeys
    : {};
  const expected = readEnterpriseLiveEvidenceAuditRequiredTargetResultKeys();
  const expectedEntries = Object.entries(expected).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const actualEntries = Object.entries(requiredTargetResultKeys)
    .filter(([, value]) => Array.isArray(value))
    .sort(([left], [right]) => left.localeCompare(right));
  const matches =
    actualEntries.length === expectedEntries.length &&
    expectedEntries.every(([target, keys], index) => {
      const [actualTarget, actualKeys] = actualEntries[index];

      return (
        actualTarget === target &&
        Array.isArray(actualKeys) &&
        actualKeys.length === keys.length &&
        keys.every((key, keyIndex) => actualKeys[keyIndex] === key)
      );
    });

  return matches ? "proved" : "missing";
}

function readEnterpriseLiveEvidenceAuditRequiredTargetEnvKeysStatus(criteria) {
  const acceptedBodyFields = isRecord(criteria) && isRecord(criteria.acceptedBodyFields)
    ? criteria.acceptedBodyFields
    : undefined;
  const requiredTargetEnvKeys = isRecord(acceptedBodyFields?.requiredTargetEnvKeys)
    ? acceptedBodyFields.requiredTargetEnvKeys
    : {};
  const expected = readEnterpriseLiveEvidenceAuditRequiredTargetEnvKeys();
  const expectedEntries = Object.entries(expected).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const actualEntries = Object.entries(requiredTargetEnvKeys)
    .filter(([, value]) => Array.isArray(value))
    .sort(([left], [right]) => left.localeCompare(right));
  const matches =
    actualEntries.length === expectedEntries.length &&
    expectedEntries.every(([target, keys], index) => {
      const [actualTarget, actualKeys] = actualEntries[index];

      return (
        actualTarget === target &&
        Array.isArray(actualKeys) &&
        actualKeys.length === keys.length &&
        keys.every((key, keyIndex) => actualKeys[keyIndex] === key)
      );
    });

  return matches ? "proved" : "missing";
}

function readEnterpriseLiveEvidenceAuditRequiredTargetContractKeysStatus(criteria) {
  const acceptedBodyFields = isRecord(criteria) && isRecord(criteria.acceptedBodyFields)
    ? criteria.acceptedBodyFields
    : undefined;
  const requiredTargetContractKeys = isRecord(acceptedBodyFields?.requiredTargetContractKeys)
    ? acceptedBodyFields.requiredTargetContractKeys
    : {};
  const expected = readEnterpriseLiveEvidenceAuditRequiredTargetContractKeys();
  const expectedEntries = Object.entries(expected).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const actualEntries = Object.entries(requiredTargetContractKeys)
    .filter(([, value]) => Array.isArray(value))
    .sort(([left], [right]) => left.localeCompare(right));
  const matches =
    actualEntries.length === expectedEntries.length &&
    expectedEntries.every(([target, keys], index) => {
      const [actualTarget, actualKeys] = actualEntries[index];

      return (
        actualTarget === target &&
        Array.isArray(actualKeys) &&
        actualKeys.length === keys.length &&
        keys.every((key, keyIndex) => actualKeys[keyIndex] === key)
      );
    });

  return matches ? "proved" : "missing";
}

function satisfiedRequirement(id, evidenceStatus, details = {}) {
  return {
    id,
    status: "satisfied",
    evidenceStatus,
    ...details,
  };
}

function blockedRequirement(id, blockedReason, evidenceStatus, details = {}) {
  return {
    id,
    status: "blocked",
    evidenceStatus,
    blockedReason,
    ...details,
  };
}

function readEvidenceStatus(evidence) {
  if (!isRecord(evidence)) {
    return "missing";
  }
  if (typeof evidence.mode === "string" && typeof evidence.status === "string") {
    return `${evidence.mode}-${evidence.status}`;
  }
  if (typeof evidence.mode === "string") {
    return evidence.mode;
  }
  if (typeof evidence.status === "string") {
    return evidence.status;
  }
  return "unknown";
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
