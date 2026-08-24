#!/usr/bin/env node

import { createHmac } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const HOST = "127.0.0.1";
const ENVIRONMENT = "local-production";
const DEFAULT_TIMEOUT_MS = 120_000;
const LOCAL_PRODUCTION_ROUTE_SMOKE_TEACHER_ID = "teacher-kang";
const LOCAL_PRODUCTION_TEACHING_SMOKE_COURSE_ID = "research-methods";
const LOCAL_PRODUCTION_TEACHING_SMOKE_CLASS_ID = "research-methods-class-1";
const LOCAL_PRODUCTION_TEACHING_SMOKE_STUDENT_ID = "route-smoke-student";
const LOCAL_PRODUCTION_TEACHING_SMOKE_OTHER_TEACHER_ID = "route-smoke-other-teacher";
const LOCAL_PRODUCTION_TEACHING_SMOKE_INVITATION_CODE = "88442211";
const LOCAL_PRODUCTION_TEACHING_COURSE_MANAGEMENT_SMOKE_COURSE_ID =
  "teacher-draft-course-teacher-kang-course-management-route-smoke-isolated";
const LOCAL_PRODUCTION_ROUTE_SMOKE_AUTH_CHAIN = [
  "signed-admin-ai-access",
  "signed-trusted-issuer-proof",
  "issued-teacher-auth-cookie",
  "teacher-ai-session",
  "teacher-ppt-workflow",
];
// Everything the protected route smoke needs whichever teacher auth provider
// the fixture selects.
const LOCAL_PRODUCTION_ROUTE_SMOKE_COMMON_REQUIRED_ENV = [
  "UAIS_AI_ACCESS_SIGNING_SECRET",
  "UAIS_TEACHER_AUTH_PROVIDER",
  "UAIS_TEACHER_AUTH_ROUTE_SMOKE_TEACHER_ID",
  "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
  "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
  "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND",
  "UAIS_EXTERNAL_STORAGE_BASE_URL",
  "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
];
// Keyed on the selected provider, mirroring scripts/ai-route-smoke.mjs. The
// issuer secret belongs to trusted-cookie-issuer alone; listing it flatly meant
// a database-account-cookie posture was reported as needing a secret that
// selector never reads.
const LOCAL_PRODUCTION_ROUTE_SMOKE_PROVIDER_REQUIRED_ENV = {
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
// The fixture harness selects this provider; it signs its own issuer proof
// rather than standing up a database, so the local lane stays hermetic.
const LOCAL_PRODUCTION_TEACHER_AUTH_PROVIDER = "trusted-cookie-issuer";

// The plan is written before anything runs, so it can only speak for the
// provider this lane pins. The EVIDENCE is written from a run that reported the
// provider it actually used, and passes it: without that every entry in the map
// but `trusted-cookie-issuer` was unreachable, so a lane pointed at a
// database-account-cookie deployment still published "requires the issuer
// secret" as its required-env evidence.
function readLocalProductionRouteSmokeRequiredEnv(authProviderMode) {
  const selector =
    authProviderMode?.trim().toLowerCase() || LOCAL_PRODUCTION_TEACHER_AUTH_PROVIDER;
  return [
    ...LOCAL_PRODUCTION_ROUTE_SMOKE_COMMON_REQUIRED_ENV,
    ...(LOCAL_PRODUCTION_ROUTE_SMOKE_PROVIDER_REQUIRED_ENV[selector] ?? []),
  ];
}
const LOCAL_PRODUCTION_EXTERNAL_STORAGE_REQUIRED_ENV = [
  "UAIS_EXTERNAL_STORAGE_BASE_URL",
  "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
  "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
  "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND",
  "UAIS_TEACHING_OPERATIONS_BACKEND",
  "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
  "UAIS_TEACHING_COURSE_ASSETS_BACKEND",
  "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS",
  "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS",
  "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY",
  "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL",
];
const LOCAL_PRODUCTION_EXTERNAL_STORAGE_BACKENDS = [
  "teacher-ai-ownership:external",
  "qwen-voice-lifecycle-audit:external",
  "teaching-operations:external",
  "teaching-course-management:external",
  "teaching-course-assets:external",
];
const LOCAL_PRODUCTION_ROUTE_PROOF_SUMMARY = [
  "teacherAuthIssuer.responseHeaders",
  "teacherAiSession.authProviderContract",
  "teacherOwnership.responseShape",
  "teacherPptWorkflow.responseShape",
  "teacherPptWorkflow.downloadContract",
  "signedContractDirectCallDenied",
];
const LOCAL_PRODUCTION_TEACHER_WORKFLOW_PAGE_REQUIRED_ENV = [
  "UAIS_TEACHER_WORKFLOW_SMOKE_COOKIE",
];
const LOCAL_PRODUCTION_TEACHING_OPERATIONS_ROUTE_REQUIRED_ENV = [
  "UAIS_DEPLOYMENT_ENV",
  "UAIS_LOCAL_PRODUCTION_E2E_ALLOW_INSECURE_TEACHING_PROVIDER_FIXTURE",
  "UAIS_APP_AUTH_PROVIDER",
  "UAIS_APP_AUTH_PROVIDER_URL",
  "UAIS_APP_AUTH_PROVIDER_TOKEN",
  "UAIS_APP_SESSION_SIGNING_SECRET",
  "UAIS_EXTERNAL_STORAGE_BASE_URL",
  "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
  "UAIS_TEACHING_OPERATIONS_BACKEND",
  "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
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
  "UAIS_TEACHING_OPERATIONS_SMOKE_COURSE_ID",
  "UAIS_TEACHING_OPERATIONS_SMOKE_CLASS_ID",
];
const LOCAL_PRODUCTION_APP_AUTH_PROVIDER_READINESS_REQUIRED_ENV = [
  "UAIS_APP_SESSION_SIGNING_SECRET",
  "UAIS_APP_AUTH_PROVIDER",
  "UAIS_APP_AUTH_PROVIDER_URL",
  "UAIS_APP_AUTH_PROVIDER_TOKEN",
];
const LOCAL_PRODUCTION_TEACHING_OPERATIONS_ROUTE_PROOF_SUMMARY = [
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
const LOCAL_PRODUCTION_TEACHING_COURSE_MANAGEMENT_ROUTE_REQUIRED_ENV = [
  "UAIS_APP_AUTH_PROVIDER",
  "UAIS_APP_AUTH_PROVIDER_URL",
  "UAIS_APP_AUTH_PROVIDER_TOKEN",
  "UAIS_APP_SESSION_SIGNING_SECRET",
  "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
  "UAIS_TEACHING_COURSE_ASSETS_BACKEND",
  "UAIS_EXTERNAL_STORAGE_BASE_URL",
  "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
  "UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_COOKIE",
  "UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_TEACHER_ID",
  "UAIS_TEACHING_COURSE_MANAGEMENT_OTHER_TEACHER_SMOKE_COOKIE",
  "UAIS_TEACHING_COURSE_MANAGEMENT_OTHER_TEACHER_SMOKE_TEACHER_ID",
  "UAIS_TEACHING_COURSE_MANAGEMENT_STUDENT_SMOKE_COOKIE",
  "UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_STUDENT_ID",
  "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
];
const LOCAL_PRODUCTION_TEACHING_COURSE_MANAGEMENT_ROUTE_PROOF_SUMMARY = [
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
const LOCAL_PRODUCTION_TEACHING_OPERATION_DETAIL_BROWSER_REQUIRED_ENV = [
  "UAIS_DEPLOYMENT_ENV",
  "UAIS_LOCAL_PRODUCTION_E2E_ALLOW_INSECURE_TEACHING_PROVIDER_FIXTURE",
  "UAIS_AI_ACCESS_SIGNING_SECRET",
  "UAIS_TEACHER_AUTH_PROVIDER",
  "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
  "UAIS_TEACHER_AUTH_ISSUER_SECRET",
  "UAIS_TEACHING_OPERATION_BROWSER_SMOKE_TEACHER_ID",
  "UAIS_EXTERNAL_STORAGE_BASE_URL",
  "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
  "UAIS_TEACHING_OPERATIONS_BACKEND",
  "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
  "UAIS_TEACHING_COURSE_ASSETS_BACKEND",
  "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER",
  "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_URL",
  "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN",
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
  "DASHSCOPE_API_KEY",
  "DASHSCOPE_BASE_URL",
];
const LOCAL_PRODUCTION_TEACHING_OPERATION_DETAIL_BROWSER_PROOF_SUMMARY = [
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
  "mainKnowledgeSourceRegistrationSubmitted",
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
const LOCAL_PRODUCTION_TEACHING_OPERATION_DETAIL_BROWSER_API_INTERCEPTION_POLICY = {
  operationApi: "live-teaching-operations",
  courseManagementApi: "live-teaching-course-management",
  auditReadback: "live-teaching-operations",
  auditAlertReadback: "live-teaching-operations",
  alertNotificationOutbox: "live-teaching-operations",
  failureProbe: "browser-negative-response",
  remoteMutations: "live-approved-teaching-operation",
  responseBodiesOmitted: true,
};
const LOCAL_PRODUCTION_BROWSER_INTERACTIONS = [
  "verify-short-voice-sample-duration-gate",
  "submit-voice-sample-with-signed-session",
  "run-voice-clone-preflight",
  "save-voice-ref",
  "submit-ppt-narration",
  "verify-ppt-narration-slide-payload",
  "verify-per-slide-wav-download-links",
  "verify-per-slide-wav-download-href-contract",
];
const LOCAL_PRODUCTION_BROWSER_PROOF_SUMMARY = [
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
const LOCAL_PRODUCTION_LEARNING_PPT_PLAYBACK = {
  courseId: "elementary-math-research",
  manifestId: "audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1",
  teacherName: "康霞博士",
  voiceLabel: "康霞博士克隆声音",
  slideCount: 19,
  firstSlideId: "slide-01",
  firstSlideTitle: "自然数的序数理论",
  firstAudioId: "tts_natural-number-ordinal-theory-ppt1_slide-01",
  lastSlideTitle: "作业布置",
};
const LOCAL_PRODUCTION_FIRST_SLIDE_AUDIO_MINIMUM_CONTENT_LENGTH = 1024;
const LOCAL_PRODUCTION_LEARNING_PLAYBACK_PROOF_SUMMARY = [
  "learningPage.http200",
  "playbackManifest.kangXiaVoice",
  "playbackManifest.slideCount",
  "playbackManifest.studentSafeRedaction",
  "firstSlideAudio.wavHeadersAndMinimumLength",
];
const LOCAL_PRODUCTION_BROWSER_API_INTERCEPTION_POLICY = {
  workflowApis: "live-workflow-status",
  remoteMutations: "fixture-blocked",
  responseBodiesOmitted: true,
};

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.live && options.approved !== true) {
    throw new Error("Local production E2E smoke requires explicit owner approval.");
  }

  const mode = options.live ? "live" : "dry-run";
  const port = options.port ?? 0;
  const plan = buildPlan({
    mode,
    port,
    skipBuild: options.skipBuild,
    skipBrowser: options.skipBrowser,
  });

  if (mode === "dry-run") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exit(0);
  }

  const result = await runLocalProductionSmoke({
    skipBuild: options.skipBuild,
    skipBrowser: options.skipBrowser,
    requestedPort: port,
    timeoutMs: options.timeoutMs,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== "passed") {
    process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Local production E2E smoke failed."}\n`,
  );
  process.exitCode = 1;
}

function buildPlan({ mode, port, skipBuild, skipBrowser }) {
  return {
    target: "local-production-e2e-smoke",
    mode,
    environment: ENVIRONMENT,
    network: mode === "live" ? "local-only" : "disabled",
    status: "ready",
    responsibleSession: "S22",
    server: {
      host: HOST,
      port: "redacted",
      startCommand: "next start -H 127.0.0.1 -p <redacted-port>",
    },
    checks: [
      {
        id: "s22-next-production-build",
        status: skipBuild ? "skipped" : "planned",
        command: skipBuild ? "skipped" : "npm run build",
      },
      {
        id: "s22-local-external-storage-reference-service",
        status: "planned",
        environment: ENVIRONMENT,
        command:
          "node scripts/external-storage-service.mjs --host 127.0.0.1 --port <redacted-port> --data-dir <ephemeral-dir> --service-mode production",
        serviceMode: "production",
        storageBackends: LOCAL_PRODUCTION_EXTERNAL_STORAGE_BACKENDS,
        requiredFixtureEnv: LOCAL_PRODUCTION_EXTERNAL_STORAGE_REQUIRED_ENV,
      },
      {
        id: "s22-next-start-local-production-server",
        status: "planned",
        command: "next start -H 127.0.0.1 -p <redacted-port>",
      },
      {
        id: "s22-local-learning-ppt-playback-smoke",
        status: "planned",
        environment: ENVIRONMENT,
        command:
          "fetch /learning, /api/learning/ppt-playback/<course-id>, and first published WAV from <local-production-url>",
        learningPlaybackProofSummary: LOCAL_PRODUCTION_LEARNING_PLAYBACK_PROOF_SUMMARY,
      },
      {
        id: "s22-local-teacher-workflow-page-smoke",
        status: "planned",
        environment: ENVIRONMENT,
        command:
          "node scripts/teacher-workflow-deployment-smoke.mjs --live --approved --environment local-production --base-url <local-production-url> --env-file <ephemeral-env>",
        requiredFixtureEnv: LOCAL_PRODUCTION_TEACHER_WORKFLOW_PAGE_REQUIRED_ENV,
      },
      {
        id: "s22-local-teacher-workflow-browser-smoke",
        status: skipBrowser ? "skipped" : "planned",
        environment: ENVIRONMENT,
        command: skipBrowser
          ? "skipped"
          : "node scripts/teacher-workflow-browser-smoke.mjs --live --approved --environment local-production --base-url <local-production-url> --api-mode live-workflow-status",
        ...(skipBrowser
          ? { skipReason: "browser-automation-runtime-unavailable" }
          : {
              fallbackCommand:
                "npx --yes --package playwright --call <redacted-transient-browser-smoke-command>",
            }),
        browserInteractions: LOCAL_PRODUCTION_BROWSER_INTERACTIONS,
        browserProofSummary: LOCAL_PRODUCTION_BROWSER_PROOF_SUMMARY,
        apiInterceptionPolicy: LOCAL_PRODUCTION_BROWSER_API_INTERCEPTION_POLICY,
      },
      {
        id: "s22-local-protected-route-smoke",
        status: "planned",
        environment: ENVIRONMENT,
        command:
          "node scripts/ai-route-smoke.mjs --live --approved --environment local-production --base-url <local-production-url> --env-file <ephemeral-env>",
        authChain: LOCAL_PRODUCTION_ROUTE_SMOKE_AUTH_CHAIN,
        requiredFixtureEnv: readLocalProductionRouteSmokeRequiredEnv(),
        storageBackends: LOCAL_PRODUCTION_EXTERNAL_STORAGE_BACKENDS,
        routeProofSummary: LOCAL_PRODUCTION_ROUTE_PROOF_SUMMARY,
      },
      {
        id: "s22-local-app-auth-provider-readiness",
        status: "planned",
        environment: ENVIRONMENT,
        command:
          "node scripts/app-auth-provider-readiness.mjs --live --approved --environment local-production --env-file <ephemeral-env>",
        requiredFixtureEnv: LOCAL_PRODUCTION_APP_AUTH_PROVIDER_READINESS_REQUIRED_ENV,
        evidence: "<local-app-auth-provider-readiness-evidence>",
        productionGateEligible: false,
      },
      {
        id: "s22-local-teaching-course-management-route-smoke",
        status: "planned",
        environment: ENVIRONMENT,
        command:
          "node scripts/teaching-course-management-route-smoke.mjs --live --approved --environment local-production --base-url <local-production-url> --env-file <ephemeral-env> --app-auth-provider-readiness <local-app-auth-provider-readiness-evidence>",
        routeProofSummary: LOCAL_PRODUCTION_TEACHING_COURSE_MANAGEMENT_ROUTE_PROOF_SUMMARY,
        requiredFixtureEnv: LOCAL_PRODUCTION_TEACHING_COURSE_MANAGEMENT_ROUTE_REQUIRED_ENV,
      },
      {
        id: "s22-local-teaching-operations-route-smoke",
        status: "planned",
        environment: ENVIRONMENT,
        command:
          "node scripts/teaching-operations-route-smoke.mjs --live --approved --environment local-production --base-url <local-production-url> --env-file <ephemeral-env> --app-auth-provider-readiness <local-app-auth-provider-readiness-evidence>",
        routeProofSummary: LOCAL_PRODUCTION_TEACHING_OPERATIONS_ROUTE_PROOF_SUMMARY,
        requiredFixtureEnv: LOCAL_PRODUCTION_TEACHING_OPERATIONS_ROUTE_REQUIRED_ENV,
      },
      {
        id: "s22-local-teaching-operation-detail-browser-smoke",
        status: skipBrowser ? "skipped" : "planned",
        environment: ENVIRONMENT,
        command: skipBrowser
          ? "skipped"
          : "node scripts/teaching-operation-detail-browser-smoke.mjs --live --approved --environment local-production --base-url <local-production-url> --env-file <ephemeral-env> --api-mode live-teaching-operations",
        ...(skipBrowser
          ? { skipReason: "browser-automation-runtime-unavailable" }
          : {
              fallbackCommand:
                "npx --yes --package playwright --call <redacted-transient-browser-smoke-command>",
            }),
        browserProofSummary: LOCAL_PRODUCTION_TEACHING_OPERATION_DETAIL_BROWSER_PROOF_SUMMARY,
        apiInterceptionPolicy:
          LOCAL_PRODUCTION_TEACHING_OPERATION_DETAIL_BROWSER_API_INTERCEPTION_POLICY,
        requiredFixtureEnv: LOCAL_PRODUCTION_TEACHING_OPERATION_DETAIL_BROWSER_REQUIRED_ENV,
      },
    ],
    blockedReasons: [],
    safety: createSafety(),
    diagnostics: {
      requestedPort: port === 0 ? "ephemeral" : "redacted",
      nextBuildRequiredBeforeStart: true,
      browserAutomationRequiredForFullE2E: true,
      browserAutomationSkipped: skipBrowser,
    },
  };
}

async function runLocalProductionSmoke({ skipBuild, skipBrowser, requestedPort, timeoutMs }) {
  const tempDir = await mkdtemp(join(tmpdir(), "uais-local-production-e2e-"));
  let serverProcess;
  let externalStorageProcess;
  let collaborationInviteEmailProvider;

  try {
    const port = requestedPort === 0 ? await allocatePort() : requestedPort;
    const externalStoragePort = await allocatePort();
    const collaborationInviteEmailProviderPort = await allocatePort();
    const baseUrl = `http://${HOST}:${port}`;
    const externalStorageBaseUrl = `http://${HOST}:${externalStoragePort}`;
    const collaborationInviteEmailProviderBaseUrl =
      `http://${HOST}:${collaborationInviteEmailProviderPort}`;
    const fixture = await createLocalProductionFixture(tempDir, {
      externalStorageBaseUrl,
      collaborationInviteEmailProviderBaseUrl,
    });
    const checks = [];
    const externalStorage = await startExternalStorageReferenceService({
      port: externalStoragePort,
      dataDir: fixture.externalStorageDataDir,
      accessToken: fixture.externalStorageAccessToken,
      timeoutMs,
    });
    externalStorageProcess = externalStorage.process;
    checks.push(createExternalStorageServiceCheck(externalStorage.ready));
    collaborationInviteEmailProvider = await startCollaborationInviteEmailProvider({
      port: collaborationInviteEmailProviderPort,
      accessToken: fixture.collaborationInviteEmailProviderToken,
      appAuthProviderToken: fixture.appAuthProviderToken,
      qwenApiKey: fixture.dashscopeApiKey,
      studentRosterSyncProviderToken: fixture.studentRosterSyncProviderToken,
      knowledgeIndexSyncProviderToken: fixture.knowledgeIndexSyncProviderToken,
      gradebookReleaseProviderToken: fixture.gradebookReleaseProviderToken,
      courseContentPublishProviderToken: fixture.courseContentPublishProviderToken,
      courseExportProviderToken: fixture.courseExportProviderToken,
      gradingFeedbackProviderToken: fixture.gradingFeedbackProviderToken,
      timeoutMs,
    });

    if (skipBuild) {
      checks.push({
        id: "s22-next-production-build",
        status: "skipped",
        command: "skipped",
      });
    } else {
      const build = await runCommand({
        command: "npm",
        args: ["run", "build"],
        env: fixture.env,
        timeoutMs,
      });
      checks.push({
        id: "s22-next-production-build",
        status: build.ok ? "passed" : "failed",
        command: "npm run build",
      });
      if (!build.ok) {
        return createLiveResult({ checks, status: "failed", blockedReasons: ["next-build-failed"] });
      }
    }

    serverProcess = spawn(
      process.execPath,
      ["node_modules/next/dist/bin/next", "start", "-H", HOST, "-p", String(port)],
      {
        cwd: process.cwd(),
        env: fixture.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    consumeProcessOutput(serverProcess);
    await waitForServerReady({ baseUrl, timeoutMs });
    checks.push({
      id: "s22-next-start-local-production-server",
      status: "passed",
      command: "next start -H 127.0.0.1 -p <redacted-port>",
    });

    const learningPptPlaybackSmoke = await runLearningPptPlaybackSmoke({
      baseUrl,
      studentCookie: fixture.env.UAIS_TEACHING_COURSE_MANAGEMENT_STUDENT_SMOKE_COOKIE,
      timeoutMs,
    });
    checks.push(createLearningPptPlaybackCheck(learningPptPlaybackSmoke));

    const teacherPageSmoke = await runJsonCommand({
      command: process.execPath,
      args: [
        "scripts/teacher-workflow-deployment-smoke.mjs",
        "--live",
        "--approved",
        "--environment",
        ENVIRONMENT,
        "--base-url",
        baseUrl,
        "--env-file",
        fixture.envFile,
      ],
      env: fixture.env,
      timeoutMs,
    });
    checks.push(createTeacherPageCheck(teacherPageSmoke));

    if (skipBrowser) {
      checks.push(createTeacherBrowserSkippedCheck());
    } else {
      const teacherBrowserSmoke = await runTeacherBrowserSmoke({
        baseUrl,
        env: fixture.env,
        timeoutMs,
      });
      checks.push(createTeacherBrowserCheck(teacherBrowserSmoke));
    }

    const routeSmoke = await runJsonCommand({
      command: process.execPath,
      args: [
        "scripts/ai-route-smoke.mjs",
        "--live",
        "--approved",
        "--environment",
        ENVIRONMENT,
        "--base-url",
        baseUrl,
        "--env-file",
        fixture.envFile,
      ],
      env: fixture.env,
      timeoutMs,
    });
    checks.push(createRouteSmokeCheck(routeSmoke));

    const appAuthProviderReadiness = await runJsonCommand({
      command: process.execPath,
      args: [
        "scripts/app-auth-provider-readiness.mjs",
        "--live",
        "--approved",
        "--environment",
        ENVIRONMENT,
        "--env-file",
        fixture.envFile,
      ],
      env: fixture.env,
      timeoutMs,
    });
    checks.push(createAppAuthProviderReadinessCheck(appAuthProviderReadiness));
    const appAuthProviderReadinessEvidenceFile = join(
      tempDir,
      "local-app-auth-provider-readiness.json",
    );
    if (appAuthProviderReadiness.body?.status !== "ready") {
      return createLiveResult({
        checks,
        status: "failed",
        blockedReasons: ["s22-local-app-auth-provider-readiness-failed"],
      });
    }
    await writeFile(
      appAuthProviderReadinessEvidenceFile,
      `${JSON.stringify(appAuthProviderReadiness.body, null, 2)}\n`,
    );

    const teachingOperationsRouteSmoke = await runJsonCommand({
      command: process.execPath,
      args: [
        "scripts/teaching-operations-route-smoke.mjs",
        "--live",
        "--approved",
        "--environment",
        ENVIRONMENT,
        "--base-url",
        baseUrl,
        "--env-file",
        fixture.envFile,
        "--app-auth-provider-readiness",
        appAuthProviderReadinessEvidenceFile,
      ],
      env: fixture.env,
      timeoutMs,
    });
    checks.push(createTeachingOperationsRouteSmokeCheck(teachingOperationsRouteSmoke));

    const teachingCourseManagementRouteSmoke = await runJsonCommand({
      command: process.execPath,
      args: [
        "scripts/teaching-course-management-route-smoke.mjs",
        "--live",
        "--approved",
        "--environment",
        ENVIRONMENT,
        "--base-url",
        baseUrl,
        "--env-file",
        fixture.envFile,
        "--app-auth-provider-readiness",
        appAuthProviderReadinessEvidenceFile,
      ],
      env: fixture.env,
      timeoutMs,
    });
    checks.push(createTeachingCourseManagementRouteSmokeCheck(teachingCourseManagementRouteSmoke));

    if (skipBrowser) {
      checks.push(createTeachingOperationDetailBrowserSkippedCheck());
    } else {
      const teachingOperationDetailBrowserSmoke =
        await runTeachingOperationDetailBrowserSmoke({
          baseUrl,
          env: fixture.env,
          envFile: fixture.envFile,
          timeoutMs,
        });
      checks.push(
        createTeachingOperationDetailBrowserCheck(teachingOperationDetailBrowserSmoke),
      );
    }

    const failedChecks = checks.filter((check) => check.status === "failed");
    return createLiveResult({
      checks,
      status: failedChecks.length === 0 ? "passed" : "failed",
      blockedReasons: failedChecks.map((check) => `${check.id}-failed`),
    });
  } finally {
    if (serverProcess) {
      await stopProcess(serverProcess);
    }
    if (externalStorageProcess) {
      await stopProcess(externalStorageProcess);
    }
    if (collaborationInviteEmailProvider) {
      await closeHttpServer(collaborationInviteEmailProvider);
    }
    await rm(tempDir, { recursive: true, force: true });
  }
}

function createExternalStorageServiceCheck(ready) {
  return {
    id: "s22-local-external-storage-reference-service",
    status: ready.status === "listening" ? "passed" : "failed",
    environment: ENVIRONMENT,
    command:
      "node scripts/external-storage-service.mjs --host 127.0.0.1 --port <redacted-port> --data-dir <ephemeral-dir> --service-mode production",
    serviceMode: ready.serviceMode === "production" ? "production" : "not-proven",
    target: ready.target,
    responsibleSession: ready.responsibleSession,
    endpoints: ready.endpoints,
    storageBackends: LOCAL_PRODUCTION_EXTERNAL_STORAGE_BACKENDS,
    requiredFixtureEnv: LOCAL_PRODUCTION_EXTERNAL_STORAGE_REQUIRED_ENV,
    safety: ready.safety,
  };
}

function createTeacherPageCheck(result) {
  if (!result.body) {
    return {
      id: "s22-local-teacher-workflow-page-smoke",
      status: "failed",
      environment: ENVIRONMENT,
      command:
        "node scripts/teacher-workflow-deployment-smoke.mjs --live --approved --environment local-production --base-url <local-production-url> --env-file <ephemeral-env>",
      requiredFixtureEnv: LOCAL_PRODUCTION_TEACHER_WORKFLOW_PAGE_REQUIRED_ENV,
      error: result.error,
    };
  }
  return {
    id: "s22-local-teacher-workflow-page-smoke",
    status: result.body.status === "passed" ? "passed" : "failed",
    environment: result.body.environment,
    command:
      "node scripts/teacher-workflow-deployment-smoke.mjs --live --approved --environment local-production --base-url <local-production-url> --env-file <ephemeral-env>",
    requiredFixtureEnv: LOCAL_PRODUCTION_TEACHER_WORKFLOW_PAGE_REQUIRED_ENV,
    httpStatus: result.body.httpStatus,
    results: result.body.results,
  };
}

function createLearningPptPlaybackCheck(result) {
  if (!result.body) {
    return {
      id: "s22-local-learning-ppt-playback-smoke",
      status: "failed",
      environment: ENVIRONMENT,
      command:
        "fetch /learning, /api/learning/ppt-playback/<course-id>, and first published WAV from <local-production-url>",
      learningPlaybackProofSummary: LOCAL_PRODUCTION_LEARNING_PLAYBACK_PROOF_SUMMARY,
      error: result.error,
    };
  }
  return {
    id: "s22-local-learning-ppt-playback-smoke",
    status: result.body.status === "passed" ? "passed" : "failed",
    environment: result.body.environment,
    command:
      "fetch /learning, /api/learning/ppt-playback/<course-id>, and first published WAV from <local-production-url>",
    learningPlaybackProofSummary: LOCAL_PRODUCTION_LEARNING_PLAYBACK_PROOF_SUMMARY,
    httpStatus: result.body.httpStatus,
    playback: result.body.playback,
    audio: result.body.audio,
    results: result.body.results,
    blockedReasons: result.body.blockedReasons,
  };
}

function createTeacherBrowserCheck(result) {
  if (!result.body) {
    return {
      id: "s22-local-teacher-workflow-browser-smoke",
      status: "failed",
      environment: ENVIRONMENT,
      command:
        "node scripts/teacher-workflow-browser-smoke.mjs --live --approved --environment local-production --base-url <local-production-url> --api-mode live-workflow-status",
      fallbackCommand:
        "npx --yes --package playwright --call <redacted-transient-browser-smoke-command>",
      browserInteractions: LOCAL_PRODUCTION_BROWSER_INTERACTIONS,
      browserProofSummary: LOCAL_PRODUCTION_BROWSER_PROOF_SUMMARY,
      apiInterceptionPolicy: LOCAL_PRODUCTION_BROWSER_API_INTERCEPTION_POLICY,
      error: result.error,
    };
  }
  return {
    id: "s22-local-teacher-workflow-browser-smoke",
    status: result.body.status === "passed" ? "passed" : "failed",
    environment: result.body.environment,
    command:
      "node scripts/teacher-workflow-browser-smoke.mjs --live --approved --environment local-production --base-url <local-production-url> --api-mode live-workflow-status",
    fallbackCommand:
      "npx --yes --package playwright --call <redacted-transient-browser-smoke-command>",
    browserInteractions: LOCAL_PRODUCTION_BROWSER_INTERACTIONS,
    browserProofSummary: LOCAL_PRODUCTION_BROWSER_PROOF_SUMMARY,
    deploymentOrigin: result.body.deploymentOrigin,
    apiInterceptionPolicy:
      result.body.apiInterceptionPolicy ?? LOCAL_PRODUCTION_BROWSER_API_INTERCEPTION_POLICY,
    runtimeSetup: result.body.runtimeSetup
      ? {
          packageName: result.body.runtimeSetup.packageName,
          moduleResolution: result.body.runtimeSetup.moduleResolution,
          moduleStatus: result.body.runtimeSetup.moduleStatus,
          npxStatus: result.body.runtimeSetup.npxStatus,
        }
      : undefined,
    prerequisites: result.body.prerequisites,
    results: result.body.results,
    failureDiagnostics: result.body.failureDiagnostics,
    blockedReasons: result.body.blockedReasons,
  };
}

function createTeacherBrowserSkippedCheck() {
  return {
    id: "s22-local-teacher-workflow-browser-smoke",
    status: "skipped",
    environment: ENVIRONMENT,
    command: "skipped",
    skipReason: "browser-automation-runtime-unavailable",
    browserInteractions: LOCAL_PRODUCTION_BROWSER_INTERACTIONS,
    browserProofSummary: LOCAL_PRODUCTION_BROWSER_PROOF_SUMMARY,
    apiInterceptionPolicy: LOCAL_PRODUCTION_BROWSER_API_INTERCEPTION_POLICY,
  };
}

function createTeachingOperationDetailBrowserCheck(result) {
  if (!result.body) {
    return {
      id: "s22-local-teaching-operation-detail-browser-smoke",
      status: "failed",
      environment: ENVIRONMENT,
      command:
        "node scripts/teaching-operation-detail-browser-smoke.mjs --live --approved --environment local-production --base-url <local-production-url> --env-file <ephemeral-env> --api-mode live-teaching-operations",
      fallbackCommand:
        "npx --yes --package playwright --call <redacted-transient-browser-smoke-command>",
      browserProofSummary: LOCAL_PRODUCTION_TEACHING_OPERATION_DETAIL_BROWSER_PROOF_SUMMARY,
      apiInterceptionPolicy:
        LOCAL_PRODUCTION_TEACHING_OPERATION_DETAIL_BROWSER_API_INTERCEPTION_POLICY,
      requiredFixtureEnv: LOCAL_PRODUCTION_TEACHING_OPERATION_DETAIL_BROWSER_REQUIRED_ENV,
      error: result.error,
    };
  }
  return {
    id: "s22-local-teaching-operation-detail-browser-smoke",
    status: result.body.status === "passed" ? "passed" : "failed",
    environment: result.body.environment,
    command:
      "node scripts/teaching-operation-detail-browser-smoke.mjs --live --approved --environment local-production --base-url <local-production-url> --env-file <ephemeral-env> --api-mode live-teaching-operations",
    fallbackCommand:
      "npx --yes --package playwright --call <redacted-transient-browser-smoke-command>",
    browserProofSummary: LOCAL_PRODUCTION_TEACHING_OPERATION_DETAIL_BROWSER_PROOF_SUMMARY,
    apiInterceptionPolicy:
      result.body.apiInterceptionPolicy ??
      LOCAL_PRODUCTION_TEACHING_OPERATION_DETAIL_BROWSER_API_INTERCEPTION_POLICY,
    requiredFixtureEnv: LOCAL_PRODUCTION_TEACHING_OPERATION_DETAIL_BROWSER_REQUIRED_ENV,
    deploymentOrigin: result.body.deploymentOrigin,
    runtimeSetup: result.body.runtimeSetup
      ? {
          packageName: result.body.runtimeSetup.packageName,
          moduleResolution: result.body.runtimeSetup.moduleResolution,
          moduleStatus: result.body.runtimeSetup.moduleStatus,
          npxStatus: result.body.runtimeSetup.npxStatus,
        }
      : undefined,
    prerequisites: result.body.prerequisites,
    results: result.body.results,
    detailOperationCoverage: result.body.detailOperationCoverage,
    liveTeachingOperationsApiBindingStatus:
      result.body.liveTeachingOperationsApiBindingStatus,
    productionReleaseEligible: result.body.productionReleaseEligible === true,
    failureDiagnostics: result.body.failureDiagnostics,
    blockedReasons: result.body.blockedReasons,
  };
}

function createTeachingOperationDetailBrowserSkippedCheck() {
  return {
    id: "s22-local-teaching-operation-detail-browser-smoke",
    status: "skipped",
    environment: ENVIRONMENT,
    command: "skipped",
    skipReason: "browser-automation-runtime-unavailable",
    browserProofSummary: LOCAL_PRODUCTION_TEACHING_OPERATION_DETAIL_BROWSER_PROOF_SUMMARY,
    apiInterceptionPolicy:
      LOCAL_PRODUCTION_TEACHING_OPERATION_DETAIL_BROWSER_API_INTERCEPTION_POLICY,
    requiredFixtureEnv: LOCAL_PRODUCTION_TEACHING_OPERATION_DETAIL_BROWSER_REQUIRED_ENV,
  };
}

function createRouteSmokeCheck(result) {
  if (!result.body) {
    return {
      id: "s22-local-protected-route-smoke",
      status: "failed",
      environment: ENVIRONMENT,
      command:
        "node scripts/ai-route-smoke.mjs --live --approved --environment local-production --base-url <local-production-url> --env-file <ephemeral-env>",
      error: result.error,
    };
  }
  return {
    id: "s22-local-protected-route-smoke",
    status: result.body.status === "passed" ? "passed" : "failed",
    environment: result.body.environment,
    command:
      "node scripts/ai-route-smoke.mjs --live --approved --environment local-production --base-url <local-production-url> --env-file <ephemeral-env>",
    authChain: LOCAL_PRODUCTION_ROUTE_SMOKE_AUTH_CHAIN,
    requiredFixtureEnv: readLocalProductionRouteSmokeRequiredEnv(
      result.body.authProviderMode,
    ),
    storageBackends: LOCAL_PRODUCTION_EXTERNAL_STORAGE_BACKENDS,
    routeProofSummary: LOCAL_PRODUCTION_ROUTE_PROOF_SUMMARY,
    routeResults: Array.isArray(result.body.results)
      ? result.body.results.map((routeResult) => ({
          id: routeResult.id,
          status: routeResult.status,
          httpStatus: routeResult.httpStatus,
          auth: routeResult.auth,
          ...(routeResult.responseShape ? { responseShape: routeResult.responseShape } : {}),
          ...(routeResult.responseHeaders ? { responseHeaders: routeResult.responseHeaders } : {}),
        }))
      : [],
  };
}

function createAppAuthProviderReadinessCheck(result) {
  if (!result.body) {
    return {
      id: "s22-local-app-auth-provider-readiness",
      status: "failed",
      environment: ENVIRONMENT,
      command:
        "node scripts/app-auth-provider-readiness.mjs --live --approved --environment local-production --env-file <ephemeral-env>",
      requiredFixtureEnv: LOCAL_PRODUCTION_APP_AUTH_PROVIDER_READINESS_REQUIRED_ENV,
      evidence: "<local-app-auth-provider-readiness-evidence>",
      productionGateEligible: false,
      error: result.error,
    };
  }
  return {
    id: "s22-local-app-auth-provider-readiness",
    status: result.body.status === "ready" ? "passed" : "failed",
    environment: result.body.environment,
    command:
      "node scripts/app-auth-provider-readiness.mjs --live --approved --environment local-production --env-file <ephemeral-env>",
    requiredFixtureEnv: LOCAL_PRODUCTION_APP_AUTH_PROVIDER_READINESS_REQUIRED_ENV,
    evidence: "<local-app-auth-provider-readiness-evidence>",
    productionGateEligible: false,
    appAuthProviderMode: result.body.appAuthProviderMode,
    endpointSecurity: result.body.endpointSecurity,
    appSessionCookieContract: result.body.appSessionCookieContract,
    trustedAccountProviderContract: result.body.trustedAccountProviderContract,
    blockedReasons: result.body.blockedReasons,
    safety: result.body.safety,
  };
}

function createTeachingOperationsRouteSmokeCheck(result) {
  if (!result.body) {
    return {
      id: "s22-local-teaching-operations-route-smoke",
      status: "failed",
      environment: ENVIRONMENT,
      command:
        "node scripts/teaching-operations-route-smoke.mjs --live --approved --environment local-production --base-url <local-production-url> --env-file <ephemeral-env> --app-auth-provider-readiness <local-app-auth-provider-readiness-evidence>",
      routeProofSummary: LOCAL_PRODUCTION_TEACHING_OPERATIONS_ROUTE_PROOF_SUMMARY,
      requiredFixtureEnv: LOCAL_PRODUCTION_TEACHING_OPERATIONS_ROUTE_REQUIRED_ENV,
      error: result.error,
    };
  }
  return {
    id: "s22-local-teaching-operations-route-smoke",
    status: result.body.status === "passed" ? "passed" : "failed",
    environment: result.body.environment,
    command:
      "node scripts/teaching-operations-route-smoke.mjs --live --approved --environment local-production --base-url <local-production-url> --env-file <ephemeral-env> --app-auth-provider-readiness <local-app-auth-provider-readiness-evidence>",
    routeProofSummary: LOCAL_PRODUCTION_TEACHING_OPERATIONS_ROUTE_PROOF_SUMMARY,
    requiredFixtureEnv: LOCAL_PRODUCTION_TEACHING_OPERATIONS_ROUTE_REQUIRED_ENV,
    teachingOperationsBackend: result.body.teachingOperationsBackend,
    teachingCourseManagementBackend: result.body.teachingCourseManagementBackend,
    httpStatus: result.body.httpStatus,
    appAuthProviderReadinessEvidence: result.body.appAuthProviderReadinessEvidence,
    failureDiagnostics: result.body.failureDiagnostics,
    results: result.body.results,
    blockedReasons: result.body.blockedReasons,
  };
}

function createTeachingCourseManagementRouteSmokeCheck(result) {
  if (!result.body) {
    return {
      id: "s22-local-teaching-course-management-route-smoke",
      status: "failed",
      environment: ENVIRONMENT,
      command:
        "node scripts/teaching-course-management-route-smoke.mjs --live --approved --environment local-production --base-url <local-production-url> --env-file <ephemeral-env> --app-auth-provider-readiness <local-app-auth-provider-readiness-evidence>",
      routeProofSummary: LOCAL_PRODUCTION_TEACHING_COURSE_MANAGEMENT_ROUTE_PROOF_SUMMARY,
      requiredFixtureEnv: LOCAL_PRODUCTION_TEACHING_COURSE_MANAGEMENT_ROUTE_REQUIRED_ENV,
      error: result.error,
    };
  }
  return {
    id: "s22-local-teaching-course-management-route-smoke",
    status: result.body.status === "passed" ? "passed" : "failed",
    environment: result.body.environment,
    command:
      "node scripts/teaching-course-management-route-smoke.mjs --live --approved --environment local-production --base-url <local-production-url> --env-file <ephemeral-env> --app-auth-provider-readiness <local-app-auth-provider-readiness-evidence>",
    routeProofSummary: LOCAL_PRODUCTION_TEACHING_COURSE_MANAGEMENT_ROUTE_PROOF_SUMMARY,
    requiredFixtureEnv: LOCAL_PRODUCTION_TEACHING_COURSE_MANAGEMENT_ROUTE_REQUIRED_ENV,
    courseManagementBackend: result.body.courseManagementBackend,
    courseAssetsBackend: result.body.courseAssetsBackend,
    teacherAiOwnershipBackend: result.body.teacherAiOwnershipBackend,
    httpStatus: result.body.httpStatus,
    appAuthProviderReadinessEvidence: result.body.appAuthProviderReadinessEvidence,
    diagnostics: result.body.diagnostics,
    results: result.body.results,
    blockedReasons: result.body.blockedReasons,
  };
}

async function runLearningPptPlaybackSmoke({ baseUrl, studentCookie, timeoutMs }) {
  try {
    const signalTimeout = Math.min(timeoutMs, 20_000);
    const learningPage = await fetch(`${baseUrl}/learning`, {
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(signalTimeout),
    });
    const manifestResponse = await fetch(
      `${baseUrl}/api/learning/ppt-playback/${LOCAL_PRODUCTION_LEARNING_PPT_PLAYBACK.courseId}`,
      {
        headers: {
          accept: "application/json",
          cookie: studentCookie,
        },
        signal: AbortSignal.timeout(signalTimeout),
      },
    );
    const manifestBody = manifestResponse.ok ? await manifestResponse.json() : undefined;
    const playback = isRecord(manifestBody?.playback) ? manifestBody.playback : undefined;
    const slides = Array.isArray(playback?.slides) ? playback.slides : [];
    const firstSlide = isRecord(slides[0]) ? slides[0] : undefined;
    const lastSlide = isRecord(slides.at(-1)) ? slides.at(-1) : undefined;
    const serializedPlayback = JSON.stringify(playback ?? {});
    const studentSafeRedaction =
      !serializedPlayback.includes("/api/ai/ppt-narration/audio") &&
      !serializedPlayback.includes("server-side-cloned-qwen-voice") &&
      !serializedPlayback.includes("DASHSCOPE_API_KEY") &&
      !serializedPlayback.includes("/Users/") &&
      !/data:audio\/[^"',}\]\s]+base64/i.test(serializedPlayback);
    const manifestMatchesPublishedPlayback =
      manifestResponse.ok &&
      playback?.status === "ready" &&
      playback.courseId === LOCAL_PRODUCTION_LEARNING_PPT_PLAYBACK.courseId &&
      playback.audioManifestId === LOCAL_PRODUCTION_LEARNING_PPT_PLAYBACK.manifestId &&
      playback.teacherName === LOCAL_PRODUCTION_LEARNING_PPT_PLAYBACK.teacherName &&
      playback.voiceLabel === LOCAL_PRODUCTION_LEARNING_PPT_PLAYBACK.voiceLabel &&
      playback.slideCount === LOCAL_PRODUCTION_LEARNING_PPT_PLAYBACK.slideCount &&
      slides.length === LOCAL_PRODUCTION_LEARNING_PPT_PLAYBACK.slideCount &&
      firstSlide?.slideId === LOCAL_PRODUCTION_LEARNING_PPT_PLAYBACK.firstSlideId &&
      firstSlide?.slideTitle === LOCAL_PRODUCTION_LEARNING_PPT_PLAYBACK.firstSlideTitle &&
      firstSlide?.audioId === LOCAL_PRODUCTION_LEARNING_PPT_PLAYBACK.firstAudioId &&
      typeof firstSlide?.audioUrl === "string" &&
      firstSlide.audioUrl.startsWith("/api/learning/ppt-playback/audio/") &&
      lastSlide?.slideTitle === LOCAL_PRODUCTION_LEARNING_PPT_PLAYBACK.lastSlideTitle;
    const audio = await verifyFirstLearningPptAudio({
      baseUrl,
      audioUrl: typeof firstSlide?.audioUrl === "string" ? firstSlide.audioUrl : undefined,
      studentCookie,
      timeoutMs: signalTimeout,
    });
    const results = {
      learningPageHttp200: learningPage.ok ? "passed" : "failed",
      playbackManifestKangXiaVoice: manifestMatchesPublishedPlayback ? "passed" : "failed",
      playbackManifestStudentSafeRedaction: studentSafeRedaction ? "passed" : "failed",
      firstSlideAudioWavHeaders: audio.status,
    };
    const blockedReasons = Object.entries(results)
      .filter(([, status]) => status !== "passed")
      .map(([key]) => `${key}-failed`);

    return {
      body: {
        status: blockedReasons.length === 0 ? "passed" : "failed",
        environment: ENVIRONMENT,
        httpStatus: {
          learningPage: learningPage.status,
          playbackManifest: manifestResponse.status,
          firstSlideAudio: audio.httpStatus,
        },
        playback: playback
          ? {
              courseId: playback.courseId,
              audioManifestId: playback.audioManifestId,
              teacherName: playback.teacherName,
              voiceLabel: playback.voiceLabel,
              slideCount: playback.slideCount,
              firstSlideTitle: firstSlide?.slideTitle,
              lastSlideTitle: lastSlide?.slideTitle,
              firstAudioUrl: firstSlide?.audioUrl,
            }
          : undefined,
        audio: {
          contentType: audio.contentType,
          contentLength: audio.contentLength,
          wavHeader: audio.wavHeader,
        },
        results,
        blockedReasons,
      },
    };
  } catch {
    return { ok: false, error: "learning-ppt-playback-smoke-failed" };
  }
}

async function verifyFirstLearningPptAudio({ baseUrl, audioUrl, studentCookie, timeoutMs }) {
  if (!audioUrl) {
    return {
      status: "failed",
      httpStatus: undefined,
      contentType: undefined,
      contentLength: undefined,
      wavHeader: "missing",
    };
  }
  const url = new URL(audioUrl, baseUrl);
  const headResponse = await fetch(url, {
    method: "HEAD",
    headers: {
      cookie: studentCookie,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const getResponse = await fetch(url, {
    headers: {
      accept: "audio/wav",
      cookie: studentCookie,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const bytes = new Uint8Array(await getResponse.arrayBuffer());
  const header = Buffer.from(bytes.slice(0, 12)).toString("ascii");
  const contentType = headResponse.headers.get("content-type") ?? getResponse.headers.get("content-type");
  const contentLength = Number(headResponse.headers.get("content-length") ?? bytes.byteLength);
  const hasWavHeader = header.startsWith("RIFF") && header.includes("WAVE");
  return {
    status:
      headResponse.ok &&
      getResponse.ok &&
      contentType === "audio/wav" &&
      Number.isFinite(contentLength) &&
      contentLength >= LOCAL_PRODUCTION_FIRST_SLIDE_AUDIO_MINIMUM_CONTENT_LENGTH &&
      hasWavHeader
        ? "passed"
        : "failed",
    httpStatus: headResponse.status,
    contentType,
    contentLength: Number.isFinite(contentLength) ? contentLength : undefined,
    wavHeader: hasWavHeader ? "RIFF/WAVE" : "missing",
  };
}

async function runTeacherBrowserSmoke({ baseUrl, env, timeoutMs }) {
  const direct = await runJsonCommand({
    command: process.execPath,
    args: createTeacherBrowserSmokeArgs(baseUrl),
    env,
    timeoutMs,
  });
  if (!shouldRetryWithTransientPlaywright(direct)) {
    return direct;
  }

  return runJsonCommand({
    command: "npx",
    args: [
      "--yes",
      "--package",
      "playwright",
      "--call",
      [
        'NODE_PATH="$(dirname "$(dirname "$(command -v playwright)")")"',
        process.execPath,
        ...createTeacherBrowserSmokeArgs(baseUrl),
      ].join(" "),
    ],
    env: {
      ...env,
      npm_config_loglevel: "silent",
      NO_UPDATE_NOTIFIER: "1",
    },
    timeoutMs,
  });
}

function createTeacherBrowserSmokeArgs(baseUrl) {
  return [
    "scripts/teacher-workflow-browser-smoke.mjs",
    "--live",
    "--approved",
    "--environment",
    ENVIRONMENT,
    "--base-url",
    baseUrl,
    "--api-mode",
    "live-workflow-status",
  ];
}

async function runTeachingOperationDetailBrowserSmoke({ baseUrl, env, envFile, timeoutMs }) {
  const direct = await runJsonCommand({
    command: process.execPath,
    args: createTeachingOperationDetailBrowserSmokeArgs(baseUrl, envFile),
    env,
    timeoutMs,
  });
  if (!shouldRetryWithTransientPlaywright(direct)) {
    return direct;
  }

  return runJsonCommand({
    command: "npx",
    args: [
      "--yes",
      "--package",
      "playwright",
      "--call",
      [
        'NODE_PATH="$(dirname "$(dirname "$(command -v playwright)")")"',
        process.execPath,
        ...createTeachingOperationDetailBrowserSmokeArgs(baseUrl, envFile),
      ].join(" "),
    ],
    env: {
      ...env,
      npm_config_loglevel: "silent",
      NO_UPDATE_NOTIFIER: "1",
    },
    timeoutMs,
  });
}

function createTeachingOperationDetailBrowserSmokeArgs(baseUrl, envFile) {
  return [
    "scripts/teaching-operation-detail-browser-smoke.mjs",
    "--live",
    "--approved",
    "--environment",
    ENVIRONMENT,
    "--base-url",
    baseUrl,
    "--env-file",
    envFile,
    "--api-mode",
    "live-teaching-operations",
  ];
}

function shouldRetryWithTransientPlaywright(result) {
  return (
    result.body?.blockedReasons?.includes("teacher-workflow-browser-runtime-missing") ||
    result.body?.blockedReasons?.includes("teaching-operation-detail-browser-runtime-missing") ||
    result.error === "invalid-json-output"
  );
}

function createLiveResult({ checks, status, blockedReasons }) {
  return {
    target: "local-production-e2e-smoke",
    mode: "live",
    environment: ENVIRONMENT,
    network: "local-only",
    status,
    responsibleSession: "S22",
    server: {
      host: HOST,
      port: "redacted",
      startCommand: "next start -H 127.0.0.1 -p <redacted-port>",
    },
    checks,
    blockedReasons,
    safety: createSafety(),
    diagnostics: {
      browserAutomationRequiredForFullE2E: true,
      browserAutomationSkipped: checks.some(
        (check) =>
          (check.id === "s22-local-teacher-workflow-browser-smoke" ||
            check.id === "s22-local-teaching-operation-detail-browser-smoke") &&
          check.status === "skipped",
      ),
    },
  };
}

async function createLocalProductionFixture(
  tempDir,
  { externalStorageBaseUrl, collaborationInviteEmailProviderBaseUrl },
) {
  const externalStorageDataDir = join(tempDir, "external-storage");
  const externalStorageOwnershipDir = join(externalStorageDataDir, "teacher-ai-ownership");
  const externalStorageCourseManagementDir = join(
    externalStorageDataDir,
    "teaching-course-management",
  );
  const teacherVoiceSampleDir = join(tempDir, "teacher-voice-samples");
  const clonedVoiceRegistryDir = join(tempDir, "qwen-cloned-voices");
  const pptNarrationAudioDir = join(tempDir, "ppt-narration");
  const externalStorageAccessToken = "uais-local-production-external-storage-fixture";
  const teacherAuthSessionSecret = "uais-local-production-teacher-auth-fixture";
  const appSessionSecret = "uais-local-production-app-session-fixture";
  const collaborationInviteEmailProviderToken =
    "uais-local-production-collaboration-email-token-fixture";
  const collaborationInviteEmailCallbackToken =
    "uais-local-production-collaboration-callback-token-fixture";
  const appAuthProviderToken =
    "uais-local-production-app-auth-provider-token-fixture";
  const studentRosterSyncProviderToken =
    "uais-local-production-student-roster-sync-provider-token-fixture";
  const knowledgeIndexSyncProviderToken =
    "uais-local-production-knowledge-index-sync-provider-token-fixture";
  const gradebookReleaseProviderToken =
    "uais-local-production-gradebook-release-provider-token-fixture";
  const courseContentPublishProviderToken =
    "uais-local-production-course-content-publish-provider-token-fixture";
  const courseExportProviderToken =
    "uais-local-production-course-export-provider-token-fixture";
  const gradingFeedbackProviderToken =
    "uais-local-production-grading-feedback-provider-token-fixture";
  const dashscopeApiKey = "uais-local-production-qwen-fixture";
  const now = new Date();
  const teacherCookie = createTeacherAuthSessionCookie({
    actorId: LOCAL_PRODUCTION_ROUTE_SMOKE_TEACHER_ID,
    sessionId: "local-production-teacher-route-smoke",
    secret: teacherAuthSessionSecret,
    now,
  });
  const otherTeacherCookie = createTeacherAuthSessionCookie({
    actorId: LOCAL_PRODUCTION_TEACHING_SMOKE_OTHER_TEACHER_ID,
    sessionId: "local-production-other-teacher-route-smoke",
    secret: teacherAuthSessionSecret,
    now,
  });
  const studentCookie = createAppSessionCookie({
    account: LOCAL_PRODUCTION_TEACHING_SMOKE_STUDENT_ID,
    role: "student",
    displayName: "Route Smoke Student",
    department: "Production Reliability",
    sessionId: "local-production-student-route-smoke",
    secret: appSessionSecret,
    now,
  });
  await Promise.all([
    mkdir(externalStorageOwnershipDir, { recursive: true }),
    mkdir(externalStorageCourseManagementDir, { recursive: true }),
    mkdir(teacherVoiceSampleDir, { recursive: true }),
    mkdir(clonedVoiceRegistryDir, { recursive: true }),
    mkdir(pptNarrationAudioDir, { recursive: true }),
  ]);
  await writeFile(
    join(externalStorageOwnershipDir, `${LOCAL_PRODUCTION_ROUTE_SMOKE_TEACHER_ID}.json`),
    `${JSON.stringify(createTeacherOwnershipFixture(), null, 2)}\n`,
  );
  await writeFile(
    join(externalStorageCourseManagementDir, "database.json"),
    `${JSON.stringify(createTeachingCourseManagementSnapshotFixture(now), null, 2)}\n`,
  );
  const envFile = join(tempDir, "local-production-route-smoke.env");
  const fixtureEnv = {
    NODE_ENV: "production",
    UAIS_DEPLOYMENT_ENV: "local-production",
    UAIS_LOCAL_PRODUCTION_E2E_ALLOW_INSECURE_TEACHING_PROVIDER_FIXTURE: "1",
    UAIS_AI_ACCESS_SIGNING_SECRET: "uais-local-production-ai-access-fixture",
    UAIS_TEACHER_AUTH_PROVIDER: LOCAL_PRODUCTION_TEACHER_AUTH_PROVIDER,
    UAIS_TEACHER_AUTH_ROUTE_SMOKE_TEACHER_ID: LOCAL_PRODUCTION_ROUTE_SMOKE_TEACHER_ID,
    UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSessionSecret,
    UAIS_TEACHER_AUTH_ISSUER_SECRET: "uais-local-production-teacher-auth-issuer-fixture",
    UAIS_TEACHING_OPERATION_BROWSER_SMOKE_TEACHER_ID:
      LOCAL_PRODUCTION_ROUTE_SMOKE_TEACHER_ID,
    UAIS_APP_AUTH_PROVIDER: "trusted-account-provider",
    UAIS_APP_AUTH_PROVIDER_URL: `${collaborationInviteEmailProviderBaseUrl}/app-auth`,
    UAIS_APP_AUTH_PROVIDER_TOKEN: appAuthProviderToken,
    UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
    UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "external",
    UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND: "external",
    UAIS_TEACHING_OPERATIONS_BACKEND: "external",
    UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
    UAIS_TEACHING_COURSE_ASSETS_BACKEND: "external",
    UAIS_EXTERNAL_STORAGE_BASE_URL: externalStorageBaseUrl,
    UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalStorageAccessToken,
    UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER: "external",
    UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_URL:
      `${collaborationInviteEmailProviderBaseUrl}/collaboration-invite-email`,
    UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN: collaborationInviteEmailProviderToken,
    UAIS_COLLABORATION_INVITE_EMAIL_CALLBACK_TOKEN: collaborationInviteEmailCallbackToken,
    UAIS_STUDENT_ROSTER_SYNC_PROVIDER: "external",
    UAIS_STUDENT_ROSTER_SYNC_PROVIDER_URL:
      `${collaborationInviteEmailProviderBaseUrl}/student-roster-sync`,
    UAIS_STUDENT_ROSTER_SYNC_PROVIDER_TOKEN: studentRosterSyncProviderToken,
    UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER: "external",
    UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_URL:
      `${collaborationInviteEmailProviderBaseUrl}/knowledge-index-sync`,
    UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_TOKEN: knowledgeIndexSyncProviderToken,
    UAIS_GRADEBOOK_RELEASE_PROVIDER: "external",
    UAIS_GRADEBOOK_RELEASE_PROVIDER_URL:
      `${collaborationInviteEmailProviderBaseUrl}/gradebook-release`,
    UAIS_GRADEBOOK_RELEASE_PROVIDER_TOKEN: gradebookReleaseProviderToken,
    UAIS_COURSE_CONTENT_PUBLISH_PROVIDER: "external",
    UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_URL:
      `${collaborationInviteEmailProviderBaseUrl}/course-content-publish`,
    UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_TOKEN: courseContentPublishProviderToken,
    UAIS_COURSE_EXPORT_PROVIDER: "external",
    UAIS_COURSE_EXPORT_PROVIDER_URL:
      `${collaborationInviteEmailProviderBaseUrl}/course-export`,
    UAIS_COURSE_EXPORT_PROVIDER_TOKEN: courseExportProviderToken,
    UAIS_GRADING_FEEDBACK_PROVIDER: "external",
    UAIS_GRADING_FEEDBACK_PROVIDER_URL:
      `${collaborationInviteEmailProviderBaseUrl}/grading-feedback`,
    UAIS_GRADING_FEEDBACK_PROVIDER_TOKEN: gradingFeedbackProviderToken,
    UAIS_TEACHING_OPERATIONS_SMOKE_COOKIE: teacherCookie,
    UAIS_TEACHER_WORKFLOW_SMOKE_COOKIE: teacherCookie,
    UAIS_TEACHING_OPERATIONS_SMOKE_STUDENT_COOKIE: studentCookie,
    UAIS_TEACHING_OPERATIONS_SMOKE_COURSE_ID: LOCAL_PRODUCTION_TEACHING_SMOKE_COURSE_ID,
    UAIS_TEACHING_OPERATIONS_SMOKE_CLASS_ID: LOCAL_PRODUCTION_TEACHING_SMOKE_CLASS_ID,
    UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_COOKIE: teacherCookie,
    UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_TEACHER_ID:
      LOCAL_PRODUCTION_ROUTE_SMOKE_TEACHER_ID,
    UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_COVER_COURSE_ID:
      LOCAL_PRODUCTION_TEACHING_COURSE_MANAGEMENT_SMOKE_COURSE_ID,
    UAIS_TEACHING_COURSE_MANAGEMENT_OTHER_TEACHER_SMOKE_COOKIE: otherTeacherCookie,
    UAIS_TEACHING_COURSE_MANAGEMENT_OTHER_TEACHER_SMOKE_TEACHER_ID:
      LOCAL_PRODUCTION_TEACHING_SMOKE_OTHER_TEACHER_ID,
    UAIS_TEACHING_COURSE_MANAGEMENT_STUDENT_SMOKE_COOKIE: studentCookie,
    UAIS_TEACHING_COURSE_MANAGEMENT_SMOKE_STUDENT_ID:
      LOCAL_PRODUCTION_TEACHING_SMOKE_STUDENT_ID,
    UAIS_TEACHER_VOICE_SAMPLE_DIR: teacherVoiceSampleDir,
    UAIS_QWEN_CLONED_VOICE_REGISTRY_DIR: clonedVoiceRegistryDir,
    UAIS_PPT_NARRATION_AUDIO_DIR: pptNarrationAudioDir,
    DASHSCOPE_API_KEY: dashscopeApiKey,
    DASHSCOPE_BASE_URL: collaborationInviteEmailProviderBaseUrl,
  };
  const env = {
    ...process.env,
    ...fixtureEnv,
  };
  await writeFile(
    envFile,
    `${Object.entries(fixtureEnv).map(([name, value]) => `${name}=${value}`).join("\n")}\n`,
  );
  return {
    env,
    envFile,
    externalStorageDataDir,
    externalStorageAccessToken,
    appAuthProviderToken,
    collaborationInviteEmailProviderToken,
    studentRosterSyncProviderToken,
    knowledgeIndexSyncProviderToken,
    gradebookReleaseProviderToken,
    courseContentPublishProviderToken,
    courseExportProviderToken,
    gradingFeedbackProviderToken,
    dashscopeApiKey,
  };
}

function createTeachingCourseManagementSnapshotFixture(now) {
  const timestamp = now.toISOString();
  const playbackClassId = `${LOCAL_PRODUCTION_LEARNING_PPT_PLAYBACK.courseId}-playback-class-1`;
  return {
    database: {
      schemaVersion: "uais-teaching-course-management-v1",
      updatedAt: timestamp,
      courses: [
        {
          courseId: LOCAL_PRODUCTION_TEACHING_SMOKE_COURSE_ID,
          ownerTeacherId: LOCAL_PRODUCTION_ROUTE_SMOKE_TEACHER_ID,
          courseName: "Research Methods Route Smoke",
          instructor: "S22 Route Smoke",
          unit: "UAIS",
          department: "Production Reliability",
          semester: "2026 Smoke",
          description:
            "Seed course for local production ordinary teaching route smoke coverage.",
          students: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          storageWritePolicy: "external-optimistic-snapshot-replace",
        },
        {
          courseId: LOCAL_PRODUCTION_LEARNING_PPT_PLAYBACK.courseId,
          ownerTeacherId: LOCAL_PRODUCTION_ROUTE_SMOKE_TEACHER_ID,
          courseName: "Elementary Math Research Playback",
          instructor: "Kang Xia",
          unit: "UAIS",
          department: "Production Reliability",
          semester: "2026 Smoke",
          description:
            "Seed course for local production learning PPT playback authorization coverage.",
          students: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          storageWritePolicy: "external-optimistic-snapshot-replace",
        },
      ],
      classes: [
        {
          classId: playbackClassId,
          courseId: LOCAL_PRODUCTION_LEARNING_PPT_PLAYBACK.courseId,
          ownerTeacherId: LOCAL_PRODUCTION_ROUTE_SMOKE_TEACHER_ID,
          className: "Learning PPT Playback Fixture Class",
          students: 1,
          semester: "2026 Smoke",
          invitationCode: "88442214",
          joinUrl: "/courses?invite=88442214",
          createdAt: timestamp,
          updatedAt: timestamp,
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          storageWritePolicy: "external-optimistic-snapshot-replace",
        },
        {
          classId: `${LOCAL_PRODUCTION_TEACHING_COURSE_MANAGEMENT_SMOKE_COURSE_ID}-fixture-class-1`,
          courseId: LOCAL_PRODUCTION_TEACHING_COURSE_MANAGEMENT_SMOKE_COURSE_ID,
          ownerTeacherId: LOCAL_PRODUCTION_ROUTE_SMOKE_TEACHER_ID,
          className: "Course Management Route Smoke Fixture Class 1",
          students: 0,
          semester: "2026 Smoke",
          invitationCode: "88442212",
          joinUrl: "/courses?invite=88442212",
          createdAt: timestamp,
          updatedAt: timestamp,
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          storageWritePolicy: "external-optimistic-snapshot-replace",
        },
        {
          classId: `${LOCAL_PRODUCTION_TEACHING_COURSE_MANAGEMENT_SMOKE_COURSE_ID}-fixture-class-2`,
          courseId: LOCAL_PRODUCTION_TEACHING_COURSE_MANAGEMENT_SMOKE_COURSE_ID,
          ownerTeacherId: LOCAL_PRODUCTION_ROUTE_SMOKE_TEACHER_ID,
          className: "Course Management Route Smoke Fixture Class 2",
          students: 0,
          semester: "2026 Smoke",
          invitationCode: "88442213",
          joinUrl: "/courses?invite=88442213",
          createdAt: timestamp,
          updatedAt: timestamp,
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          storageWritePolicy: "external-optimistic-snapshot-replace",
        },
        {
          classId: LOCAL_PRODUCTION_TEACHING_SMOKE_CLASS_ID,
          courseId: LOCAL_PRODUCTION_TEACHING_SMOKE_COURSE_ID,
          ownerTeacherId: LOCAL_PRODUCTION_ROUTE_SMOKE_TEACHER_ID,
          className: "Route Smoke Class",
          students: 0,
          semester: "2026 Smoke",
          invitationCode: LOCAL_PRODUCTION_TEACHING_SMOKE_INVITATION_CODE,
          joinUrl: `/courses?invite=${LOCAL_PRODUCTION_TEACHING_SMOKE_INVITATION_CODE}`,
          createdAt: timestamp,
          updatedAt: timestamp,
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          storageWritePolicy: "external-optimistic-snapshot-replace",
        },
      ],
      memberships: [
        {
          membershipId: `membership-${playbackClassId}-route-smoke-student`,
          courseId: LOCAL_PRODUCTION_LEARNING_PPT_PLAYBACK.courseId,
          classId: playbackClassId,
          invitationCode: "88442214",
          studentId: LOCAL_PRODUCTION_TEACHING_SMOKE_STUDENT_ID,
          studentDisplayName: "Route Smoke Student",
          membershipStatus: "approved",
          joinedAt: timestamp,
          approvedAt: timestamp,
          approvedByTeacherId: LOCAL_PRODUCTION_ROUTE_SMOKE_TEACHER_ID,
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          storageWritePolicy: "external-optimistic-snapshot-replace",
          responsibleSession: "S12",
          redaction: createRedaction(),
        },
      ],
      auditEvents: [],
    },
    storagePolicy: "external-redacted-teaching-course-management-snapshot",
    redaction: createRedaction(),
  };
}

function createTeacherOwnershipFixture() {
  return {
    teacherId: LOCAL_PRODUCTION_ROUTE_SMOKE_TEACHER_ID,
    courseIds: [LOCAL_PRODUCTION_TEACHING_SMOKE_COURSE_ID],
    sampleAssets: [
      {
        sampleAssetId: "asset-voice-10s",
        courseId: LOCAL_PRODUCTION_TEACHING_SMOKE_COURSE_ID,
      },
    ],
    pptAssets: [
      {
        pptAssetId: "research-methods-unit-3",
        courseId: LOCAL_PRODUCTION_TEACHING_SMOKE_COURSE_ID,
      },
      {
        pptAssetId: "kang-xia-ppt-19",
        courseId: LOCAL_PRODUCTION_TEACHING_SMOKE_COURSE_ID,
      },
    ],
    clonedVoiceRefs: [
      {
        voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
        sampleAssetId: "asset-voice-10s",
      },
    ],
    audioManifests: [
      {
        audioManifestId: "audio-manifest-research-methods-unit-3",
        courseId: LOCAL_PRODUCTION_TEACHING_SMOKE_COURSE_ID,
        pptAssetId: "research-methods-unit-3",
        voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
      },
      {
        audioManifestId: "audio-manifest-kang-xia-ppt-19",
        courseId: LOCAL_PRODUCTION_TEACHING_SMOKE_COURSE_ID,
        pptAssetId: "kang-xia-ppt-19",
        voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
      },
    ],
    storagePolicy: "local-server-teacher-ai-ownership-registry",
    storageWritePolicy: "atomic-json-file-replace",
    responsibleSession: "S12",
    updatedAt: "2026-06-17T00:00:00.000Z",
    redaction: {
      secrets: "omitted",
      localFiles: "omitted",
      assets: "ids-only",
    },
  };
}

function createTeacherAuthSessionCookie({ actorId, sessionId, secret, now }) {
  return createSignedCookieHeader({
    claims: {
      sessionId,
      actorId,
      role: "teacher",
      authenticatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString(),
    },
    cookieName: "uais_teacher_auth_claims",
    signatureCookieName: "uais_teacher_auth_signature",
    secret,
  });
}

function createAppSessionCookie({
  account,
  role,
  displayName,
  department,
  sessionId,
  secret,
  now,
}) {
  return createSignedCookieHeader({
    claims: {
      account,
      role,
      displayName,
      department,
      sessionId,
      authenticatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString(),
    },
    cookieName: "uais_app_session",
    signatureCookieName: "uais_app_session_signature",
    secret,
  });
}

function createSignedCookieHeader({ claims, cookieName, signatureCookieName, secret }) {
  const encodedClaims = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(encodedClaims).digest("base64url");
  return `${cookieName}=${encodedClaims}; ${signatureCookieName}=${signature}`;
}

async function waitForServerReady({ baseUrl, timeoutMs }) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const ready = await fetch(`${baseUrl}/teaching`, {
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(2_000),
    })
      .then((response) => response.ok)
      .catch(() => false);
    if (ready) {
      return;
    }
    await sleep(500);
  }
  throw new Error("Local production Next server did not become ready.");
}

function startExternalStorageReferenceService({ port, dataDir, accessToken, timeoutMs }) {
  const childProcess = spawn(
    process.execPath,
    [
      "scripts/external-storage-service.mjs",
      "--host",
      HOST,
      "--port",
      String(port),
      "--data-dir",
      dataDir,
      "--service-mode",
      "production",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
        UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS: "managed-database",
        UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS: "up-to-date",
        UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY: "point-in-time-restore",
        UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL: "transactional",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`External storage service did not become ready. ${stderr}`));
    }, Math.min(timeoutMs, 10_000));

    const resolveOnce = (ready) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ process: childProcess, ready });
    };
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };

    childProcess.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    childProcess.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
      const line = stdout.split(/\r?\n/).find((candidate) => candidate.trim().startsWith("{"));
      if (!line) return;
      try {
        const ready = JSON.parse(line);
        if (
          ![
            "uais-external-storage-reference-service",
            "uais-external-storage-production-service",
          ].includes(ready?.target) ||
          ready?.status !== "listening"
        ) {
          rejectOnce(new Error("External storage service ready line had an unexpected shape."));
          return;
        }
        resolveOnce(ready);
      } catch (error) {
        rejectOnce(error);
      }
    });
    childProcess.on("exit", (code) => {
      rejectOnce(new Error(`External storage service exited before ready with code ${code}. ${stderr}`));
    });
  });
}

function startCollaborationInviteEmailProvider({
  port,
  accessToken,
  appAuthProviderToken,
  qwenApiKey,
  studentRosterSyncProviderToken,
  knowledgeIndexSyncProviderToken,
  gradebookReleaseProviderToken,
  courseContentPublishProviderToken,
  courseExportProviderToken,
  gradingFeedbackProviderToken,
  timeoutMs,
}) {
  const server = createHttpServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${HOST}:${port}`);
      if (request.method !== "POST") {
        sendFixtureJson(response, 404, {
          error: "fixture route not found",
          redaction: createRedaction(),
        });
        return;
      }

      const authorization = request.headers.authorization ?? "";
      if (
        url.pathname === "/collaboration-invite-email" &&
        authorization !== `Bearer ${accessToken}`
      ) {
        await readFixtureRequestBody(request);
        sendFixtureJson(response, 401, {
          error: "fixture authorization failed",
          redaction: createRedaction(),
        });
        return;
      }
      if (
        url.pathname === "/api/v1/services/aigc/multimodal-generation/generation" &&
        authorization !== `Bearer ${qwenApiKey}`
      ) {
        await readFixtureRequestBody(request);
        sendFixtureJson(response, 401, {
          error: "fixture qwen authorization failed",
          redaction: createRedaction(),
        });
        return;
      }
      const providerTokens = {
        "/app-auth": appAuthProviderToken,
        "/student-roster-sync": studentRosterSyncProviderToken,
        "/knowledge-index-sync": knowledgeIndexSyncProviderToken,
        "/gradebook-release": gradebookReleaseProviderToken,
        "/course-content-publish": courseContentPublishProviderToken,
        "/course-export": courseExportProviderToken,
        "/grading-feedback": gradingFeedbackProviderToken,
      };
      const expectedProviderToken = providerTokens[url.pathname];
      if (expectedProviderToken && authorization !== `Bearer ${expectedProviderToken}`) {
        await readFixtureRequestBody(request);
        sendFixtureJson(response, 401, {
          error: "fixture provider authorization failed",
          redaction: createRedaction(),
        });
        return;
      }

      const rawFixtureRequestBody = await readFixtureRequestBody(request);
      const fixtureRequestBody = parseFixtureJson(rawFixtureRequestBody);
      if (url.pathname === "/collaboration-invite-email") {
        sendFixtureJson(response, 200, {
          status: "delivered",
          deliveryId: "email-delivery-collaboration-invite-route-smoke",
          redaction: createRedaction(),
        });
        return;
      }
      if (url.pathname === "/app-auth") {
        sendFixtureJson(response, 200, {
          user: {
            account: LOCAL_PRODUCTION_TEACHING_SMOKE_STUDENT_ID,
            role: "student",
            displayName: "Route Smoke Student",
            department: "Production Reliability",
          },
          redaction: createRedaction(),
        });
        return;
      }
      if (url.pathname === "/student-roster-sync") {
        sendFixtureJson(response, 200, {
          status: "synced",
          syncId: "student-roster-sync-route-smoke",
          redaction: createRedaction(),
        });
        return;
      }
      if (url.pathname === "/knowledge-index-sync") {
        sendFixtureJson(response, 200, {
          status: "synced",
          syncId: "knowledge-index-sync-route-smoke",
          redaction: createRedaction(),
        });
        return;
      }
      if (url.pathname === "/gradebook-release") {
        if (fixtureRequestBody?.action === "rollback-gradebook-release") {
          sendFixtureJson(response, 200, {
            status: "release-rolled-back",
            rollbackId: "gradebook-rollback-route-smoke",
            redaction: createRedaction(),
          });
          return;
        }
        sendFixtureJson(response, 200, {
          status: "released",
          releaseId: "gradebook-release-route-smoke",
          redaction: createRedaction(),
        });
        return;
      }
      if (url.pathname === "/course-content-publish") {
        sendFixtureJson(response, 200, {
          status: "published",
          publishId: "course-content-publish-route-smoke",
          redaction: createRedaction(),
        });
        return;
      }
      if (url.pathname === "/course-export") {
        sendFixtureJson(response, 200, {
          status: "exported",
          exportId: "course-export-route-smoke",
          redaction: createRedaction(),
        });
        return;
      }
      if (url.pathname === "/grading-feedback") {
        sendFixtureJson(response, 200, {
          status: "generated",
          feedbackId: "grading-feedback-route-smoke",
          redaction: createRedaction(),
        });
        return;
      }
      if (url.pathname === "/api/v1/services/aigc/multimodal-generation/generation") {
        sendFixtureJson(response, 200, {
          output: {
            choices: [
              {
                message: {
                  content: [
                    {
                      image: "https://assets.uais.local/course-cover-route-smoke.png",
                    },
                  ],
                },
              },
            ],
          },
          usage: {
            width: 800,
            height: 480,
            image_count: 1,
          },
          request_id: "local-production-qwen-cover-route-smoke",
        });
        return;
      }

      sendFixtureJson(response, 404, {
        error: "fixture route not found",
        redaction: createRedaction(),
      });
    } catch {
      sendFixtureJson(response, 500, {
        error: "fixture request failed",
        redaction: createRedaction(),
      });
    }
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      server.close();
      reject(new Error("Local collaboration invite email fixture did not become ready."));
    }, Math.min(timeoutMs, 10_000));

    server.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    server.listen(port, HOST, () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(server);
    });
  });
}

function readFixtureRequestBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 100_000) {
        request.destroy(new Error("Fixture request body is too large."));
      }
    });
    request.on("end", () => resolve(raw));
    request.on("error", reject);
  });
}

function parseFixtureJson(raw) {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function sendFixtureJson(response, statusCode, body) {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function closeHttpServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function runCommand({ command, args, env, timeoutMs }) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        cwd: process.cwd(),
        env,
        encoding: "utf8",
        timeout: timeoutMs,
        maxBuffer: 2_000_000,
      },
      (error) => {
        resolve({ ok: !error });
      },
    );
  });
}

function runJsonCommand({ command, args, env, timeoutMs }) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        cwd: process.cwd(),
        env,
        encoding: "utf8",
        timeout: timeoutMs,
        maxBuffer: 2_000_000,
      },
      (error, stdout) => {
        try {
          resolve({
            ok: !error,
            body: JSON.parse(stdout),
            ...(error ? { error: "command-failed" } : {}),
          });
        } catch {
          resolve({ ok: false, error: "invalid-json-output" });
        }
      },
    );
  });
}

async function allocatePort() {
  const server = createNetServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to allocate local TCP port."));
        return;
      }
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function consumeProcessOutput(childProcess) {
  childProcess.stdout?.on("data", () => {});
  childProcess.stderr?.on("data", () => {});
}

function stopProcess(childProcess) {
  return new Promise((resolve) => {
    if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      childProcess.kill("SIGKILL");
      resolve();
    }, 2_000);
    childProcess.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    childProcess.kill("SIGTERM");
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createSafety() {
  return {
    secretsRedacted: true,
    localPrivatePathsOmitted: true,
    tempEnvFileOmitted: true,
    responseBodiesOmitted: true,
    productionGateEligible: false,
    liveRequiresApproval: true,
  };
}

function createRedaction() {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };
}

function parseArgs(args) {
  const options = {
    live: false,
    approved: false,
    skipBuild: false,
    skipBrowser: false,
    port: undefined,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      options.live = false;
    } else if (arg === "--live") {
      options.live = true;
    } else if (arg === "--approved") {
      options.approved = true;
    } else if (arg === "--skip-build") {
      options.skipBuild = true;
    } else if (arg === "--skip-browser") {
      options.skipBrowser = true;
    } else if (arg === "--port") {
      options.port = parsePort(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = parseTimeout(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node scripts/local-production-e2e-smoke.mjs [--dry-run] [--live --approved] [--skip-build] [--skip-browser] [--port PORT] [--timeout-ms MS]",
          "",
          "Runs a local-only Next production server smoke and tags evidence as local-production. Output is not production release-gate eligible.",
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

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("--port must be an integer from 0 to 65535.");
  }
  return port;
}

function parseTimeout(value) {
  const timeout = Number(value);
  if (!Number.isInteger(timeout) || timeout < 1_000) {
    throw new Error("--timeout-ms must be an integer of at least 1000.");
  }
  return timeout;
}
