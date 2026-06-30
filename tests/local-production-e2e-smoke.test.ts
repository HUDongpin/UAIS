import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const extractConstStringArray = (source: string, name: string): string[] => {
  const match = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));

  if (!match) {
    throw new Error(`Missing string array constant: ${name}`);
  }

  return [...match[1].matchAll(/"([^"]+)"/g)].map(([, value]) => value);
};

describe("local production E2E smoke harness", () => {
  it("keeps the local teacher workflow fixture aligned with the teaching page default PPT asset", () => {
    const source = readFileSync("scripts/local-production-e2e-smoke.mjs", "utf8");

    expect(source).toContain('const LOCAL_PRODUCTION_TEACHING_SMOKE_COURSE_ID = "research-methods";');
    expect(source).toContain('pptAssetId: "research-methods-unit-3"');
    expect(source).toContain('audioManifestId: "audio-manifest-research-methods-unit-3"');
    expect(source).toContain('pptAssetId: "kang-xia-ppt-19"');
    expect(source).toContain('audioManifestId: "audio-manifest-kang-xia-ppt-19"');
  });

  it("prints a redacted dry-run plan for local production build and smoke checks", () => {
    const output = execFileSync("node", [
      "scripts/local-production-e2e-smoke.mjs",
      "--dry-run",
      "--port",
      "43123",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "local-production-e2e-smoke",
        mode: "dry-run",
        environment: "local-production",
        network: "disabled",
        status: "ready",
        responsibleSession: "S22",
        server: {
          host: "127.0.0.1",
          port: "redacted",
          startCommand: "next start -H 127.0.0.1 -p <redacted-port>",
        },
        blockedReasons: [],
        safety: {
          secretsRedacted: true,
          localPrivatePathsOmitted: true,
          tempEnvFileOmitted: true,
          responseBodiesOmitted: true,
          productionGateEligible: false,
          liveRequiresApproval: true,
        },
      }),
    );
    expect(body.checks.map((check: { id: string }) => check.id)).toEqual([
      "s22-next-production-build",
      "s22-local-external-storage-reference-service",
      "s22-next-start-local-production-server",
      "s22-local-learning-ppt-playback-smoke",
      "s22-local-teacher-workflow-page-smoke",
      "s22-local-teacher-workflow-browser-smoke",
      "s22-local-protected-route-smoke",
      "s22-local-app-auth-provider-readiness",
      "s22-local-teaching-course-management-route-smoke",
      "s22-local-teaching-operations-route-smoke",
      "s22-local-teaching-operation-detail-browser-smoke",
    ]);
    expect(body.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "s22-next-production-build",
        status: "planned",
        command: "npm run build",
      }),
      expect.objectContaining({
        id: "s22-local-external-storage-reference-service",
        status: "planned",
        environment: "local-production",
        command:
          "node scripts/external-storage-service.mjs --host 127.0.0.1 --port <redacted-port> --data-dir <ephemeral-dir> --service-mode production",
        serviceMode: "production",
        storageBackends: [
          "teacher-ai-ownership:external",
          "qwen-voice-lifecycle-audit:external",
          "teaching-operations:external",
          "teaching-course-management:external",
          "teaching-course-assets:external",
        ],
        requiredFixtureEnv: [
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
        ],
      }),
      expect.objectContaining({
        id: "s22-next-start-local-production-server",
        status: "planned",
        command: "next start -H 127.0.0.1 -p <redacted-port>",
      }),
      expect.objectContaining({
        id: "s22-local-learning-ppt-playback-smoke",
        status: "planned",
        environment: "local-production",
        command:
          "fetch /learning, /api/learning/ppt-playback/<course-id>, and first published WAV from <local-production-url>",
        learningPlaybackProofSummary: [
          "learningPage.http200",
          "playbackManifest.kangXiaVoice",
          "playbackManifest.slideCount",
          "playbackManifest.studentSafeRedaction",
          "firstSlideAudio.wavHeadersAndMinimumLength",
        ],
      }),
      expect.objectContaining({
        id: "s22-local-teacher-workflow-page-smoke",
        status: "planned",
        environment: "local-production",
        command:
          "node scripts/teacher-workflow-deployment-smoke.mjs --live --approved --environment local-production --base-url <local-production-url> --env-file <ephemeral-env>",
        requiredFixtureEnv: [
          "UAIS_TEACHER_WORKFLOW_SMOKE_COOKIE",
        ],
      }),
      expect.objectContaining({
        id: "s22-local-teacher-workflow-browser-smoke",
        status: "planned",
        environment: "local-production",
        command:
          "node scripts/teacher-workflow-browser-smoke.mjs --live --approved --environment local-production --base-url <local-production-url> --api-mode live-workflow-status",
        fallbackCommand:
          "npx --yes --package playwright --call <redacted-transient-browser-smoke-command>",
        browserInteractions: [
          "verify-short-voice-sample-duration-gate",
          "submit-voice-sample-with-signed-session",
          "run-voice-clone-preflight",
          "save-voice-ref",
          "submit-ppt-narration",
          "verify-ppt-narration-slide-payload",
          "verify-per-slide-wav-download-links",
          "verify-per-slide-wav-download-href-contract",
        ],
        browserProofSummary: [
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
        ],
        apiInterceptionPolicy: {
          workflowApis: "live-workflow-status",
          remoteMutations: "fixture-blocked",
          responseBodiesOmitted: true,
        },
      }),
      expect.objectContaining({
        id: "s22-local-protected-route-smoke",
        status: "planned",
        environment: "local-production",
        command:
          "node scripts/ai-route-smoke.mjs --live --approved --environment local-production --base-url <local-production-url> --env-file <ephemeral-env>",
        authChain: [
          "signed-admin-ai-access",
          "signed-trusted-issuer-proof",
          "issued-teacher-auth-cookie",
          "teacher-ai-session",
          "teacher-ppt-workflow",
        ],
        requiredFixtureEnv: [
          "UAIS_AI_ACCESS_SIGNING_SECRET",
          "UAIS_TEACHER_AUTH_PROVIDER",
          "UAIS_TEACHER_AUTH_ROUTE_SMOKE_TEACHER_ID",
          "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
          "UAIS_TEACHER_AUTH_ISSUER_SECRET",
          "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
          "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND",
          "UAIS_EXTERNAL_STORAGE_BASE_URL",
          "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
        ],
        storageBackends: [
          "teacher-ai-ownership:external",
          "qwen-voice-lifecycle-audit:external",
          "teaching-operations:external",
          "teaching-course-management:external",
          "teaching-course-assets:external",
        ],
        routeProofSummary: [
          "teacherAuthIssuer.responseHeaders",
          "teacherAiSession.authProviderContract",
          "teacherOwnership.responseShape",
          "teacherPptWorkflow.responseShape",
          "teacherPptWorkflow.downloadContract",
          "signedContractDirectCallDenied",
        ],
      }),
      expect.objectContaining({
        id: "s22-local-app-auth-provider-readiness",
        status: "planned",
        environment: "local-production",
        command:
          "node scripts/app-auth-provider-readiness.mjs --live --approved --environment local-production --env-file <ephemeral-env>",
        requiredFixtureEnv: [
          "UAIS_APP_SESSION_SIGNING_SECRET",
          "UAIS_APP_AUTH_PROVIDER",
          "UAIS_APP_AUTH_PROVIDER_URL",
          "UAIS_APP_AUTH_PROVIDER_TOKEN",
        ],
        evidence: "<local-app-auth-provider-readiness-evidence>",
        productionGateEligible: false,
      }),
      expect.objectContaining({
        id: "s22-local-teaching-operations-route-smoke",
        status: "planned",
        environment: "local-production",
        command:
          "node scripts/teaching-operations-route-smoke.mjs --live --approved --environment local-production --base-url <local-production-url> --env-file <ephemeral-env> --app-auth-provider-readiness <local-app-auth-provider-readiness-evidence>",
        routeProofSummary: [
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
        ],
        requiredFixtureEnv: [
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
        ],
      }),
      expect.objectContaining({
        id: "s22-local-teaching-operation-detail-browser-smoke",
        status: "planned",
        environment: "local-production",
        command:
          "node scripts/teaching-operation-detail-browser-smoke.mjs --live --approved --environment local-production --base-url <local-production-url> --env-file <ephemeral-env> --api-mode live-teaching-operations",
        fallbackCommand:
          "npx --yes --package playwright --call <redacted-transient-browser-smoke-command>",
        browserProofSummary: expect.arrayContaining([
          "openMainTeachingPage",
          "mainInlineWorkspaceHydration",
          "mainCourseCreatePersisted",
          "mainCourseCreateReceiptAuthSessionReturned",
          "mainClassCreatePersisted",
          "mainClassCreateReceiptAuthSessionReturned",
          "mainInlineOperationPostPersisted",
          "mainInlineOperationReceiptAuthSessionReturned",
          "mainInlineAuditReadbackVerified",
          "mainInlineDomainProjectionVerified",
          "mainInlineOperationFailureAlertVerified",
          "mainInlineRollbackPersisted",
          "mainInvitePublishArtifactReturned",
          "mainInvitePublishClassReadbackVerified",
          "operationDetailCoverageVerified",
        ]),
        apiInterceptionPolicy: {
          operationApi: "live-teaching-operations",
          courseManagementApi: "live-teaching-course-management",
          auditReadback: "live-teaching-operations",
          auditAlertReadback: "live-teaching-operations",
          alertNotificationOutbox: "live-teaching-operations",
          failureProbe: "browser-negative-response",
          remoteMutations: "live-approved-teaching-operation",
          responseBodiesOmitted: true,
        },
        requiredFixtureEnv: expect.arrayContaining([
          "UAIS_DEPLOYMENT_ENV",
          "UAIS_LOCAL_PRODUCTION_E2E_ALLOW_INSECURE_TEACHING_PROVIDER_FIXTURE",
          "UAIS_AI_ACCESS_SIGNING_SECRET",
          "UAIS_TEACHER_AUTH_PROVIDER",
          "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
          "UAIS_TEACHER_AUTH_ISSUER_SECRET",
          "UAIS_TEACHING_OPERATION_BROWSER_SMOKE_TEACHER_ID",
          "UAIS_TEACHING_OPERATIONS_BACKEND",
          "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
          "UAIS_TEACHING_COURSE_ASSETS_BACKEND",
          "UAIS_EXTERNAL_STORAGE_BASE_URL",
          "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
          "DASHSCOPE_API_KEY",
        ]),
      }),
      expect.objectContaining({
        id: "s22-local-teaching-course-management-route-smoke",
        status: "planned",
        environment: "local-production",
        command:
          "node scripts/teaching-course-management-route-smoke.mjs --live --approved --environment local-production --base-url <local-production-url> --env-file <ephemeral-env> --app-auth-provider-readiness <local-app-auth-provider-readiness-evidence>",
        routeProofSummary: [
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
        ],
        requiredFixtureEnv: [
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
        ],
      }),
    ]));
    expect(output).not.toContain("43123");
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("secret-");
  });

  it("uses a signed student cookie and approved membership for local learning PPT playback", () => {
    const source = readFileSync("scripts/local-production-e2e-smoke.mjs", "utf8");

    expect(source).toContain(
      "studentCookie: fixture.env.UAIS_TEACHING_COURSE_MANAGEMENT_STUDENT_SMOKE_COOKIE,",
    );
    expect(source).toContain("cookie: studentCookie,");
    expect(source).toContain("membershipId: `membership-${playbackClassId}-route-smoke-student`,");
    expect(source).toContain("courseId: LOCAL_PRODUCTION_LEARNING_PPT_PLAYBACK.courseId,");
    expect(source).toContain('membershipStatus: "approved",');
  });

  it("rejects live local production smoke without explicit approval", () => {
    expect(() =>
      execFileSync("node", [
        "scripts/local-production-e2e-smoke.mjs",
        "--live",
        "--skip-build",
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).toThrow("explicit owner approval");
  });

  it("prints an explicit skipped browser check when Playwright automation is unavailable", () => {
    const output = execFileSync("node", [
      "scripts/local-production-e2e-smoke.mjs",
      "--dry-run",
      "--skip-browser",
      "--port",
      "43123",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s22-local-teacher-workflow-browser-smoke",
          status: "skipped",
          command: "skipped",
          skipReason: "browser-automation-runtime-unavailable",
          apiInterceptionPolicy: {
            workflowApis: "live-workflow-status",
            remoteMutations: "fixture-blocked",
            responseBodiesOmitted: true,
          },
        }),
        expect.objectContaining({
          id: "s22-local-teaching-operation-detail-browser-smoke",
          status: "skipped",
          command: "skipped",
          skipReason: "browser-automation-runtime-unavailable",
          browserProofSummary: expect.arrayContaining([
            "openMainTeachingPage",
            "mainInlineWorkspaceHydration",
            "mainInlineOperationPostPersisted",
            "mainInlineOperationReceiptAuthSessionReturned",
            "operationDetailCoverageVerified",
          ]),
          apiInterceptionPolicy: {
            operationApi: "live-teaching-operations",
            courseManagementApi: "live-teaching-course-management",
            auditReadback: "live-teaching-operations",
            auditAlertReadback: "live-teaching-operations",
            alertNotificationOutbox: "live-teaching-operations",
            failureProbe: "browser-negative-response",
            remoteMutations: "live-approved-teaching-operation",
            responseBodiesOmitted: true,
          },
        }),
      ]),
    );
    expect(body.diagnostics).toEqual(
      expect.objectContaining({
        browserAutomationRequiredForFullE2E: true,
        browserAutomationSkipped: true,
      }),
    );
    expect(output).not.toContain("43123");
    expect(output).not.toContain("/Users/");
  });

  it("wires planned ordinary teaching route and browser smokes into the live local-production harness", () => {
    const source = readFileSync("scripts/local-production-e2e-smoke.mjs", "utf8");
    const appAuthProviderReadinessRun = source.indexOf(
      "const appAuthProviderReadiness = await runJsonCommand({",
    );
    const appAuthProviderReadinessFile = source.indexOf(
      "const appAuthProviderReadinessEvidenceFile = join(",
    );
    const teachingOperationsRun = source.indexOf(
      'const teachingOperationsRouteSmoke = await runJsonCommand({',
    );
    const teachingOperationsCheck = source.indexOf(
      "checks.push(createTeachingOperationsRouteSmokeCheck(teachingOperationsRouteSmoke));",
    );
    const teachingOperationDetailBrowserRun = source.indexOf(
      "const teachingOperationDetailBrowserSmoke =",
    );
    const teachingOperationDetailBrowserCheck = source.indexOf(
      "createTeachingOperationDetailBrowserCheck(teachingOperationDetailBrowserSmoke)",
    );
    const teachingCourseManagementRun = source.indexOf(
      'const teachingCourseManagementRouteSmoke = await runJsonCommand({',
    );
    const teachingCourseManagementCheck = source.indexOf(
      "checks.push(createTeachingCourseManagementRouteSmokeCheck(teachingCourseManagementRouteSmoke));",
    );
    const failedChecks = source.indexOf("const failedChecks = checks.filter");

    expect(appAuthProviderReadinessRun).toBeGreaterThan(0);
    expect(appAuthProviderReadinessFile).toBeGreaterThan(appAuthProviderReadinessRun);
    expect(teachingOperationsRun).toBeGreaterThan(0);
    expect(teachingOperationsRun).toBeGreaterThan(appAuthProviderReadinessFile);
    expect(teachingOperationsCheck).toBeGreaterThan(teachingOperationsRun);
    expect(teachingCourseManagementRun).toBeGreaterThan(teachingOperationsCheck);
    expect(teachingCourseManagementCheck).toBeGreaterThan(teachingCourseManagementRun);
    expect(teachingOperationDetailBrowserRun).toBeGreaterThan(teachingCourseManagementCheck);
    expect(teachingOperationDetailBrowserCheck).toBeGreaterThan(
      teachingOperationDetailBrowserRun,
    );
    expect(failedChecks).toBeGreaterThan(teachingOperationDetailBrowserCheck);
    expect(source).toContain('"--app-auth-provider-readiness",');
    expect(source).toContain("appAuthProviderReadinessEvidenceFile,");
    expect(source).toContain('"scripts/teaching-operation-detail-browser-smoke.mjs",');
    expect(source).toContain('"live-teaching-operations",');
  });

  it("preserves course-management route-smoke diagnostics in local-production evidence", () => {
    const source = readFileSync("scripts/local-production-e2e-smoke.mjs", "utf8");
    const checkStart = source.indexOf("function createTeachingCourseManagementRouteSmokeCheck");
    const checkEnd = source.indexOf("async function runLearningPptPlaybackSmoke");
    const checkSource = source.slice(checkStart, checkEnd);

    expect(checkStart).toBeGreaterThan(0);
    expect(checkEnd).toBeGreaterThan(checkStart);
    expect(checkSource).toContain("diagnostics: result.body.diagnostics");
  });

  it("keeps ordinary teaching proof summary in sync with the production release gate", () => {
    const localSource = readFileSync("scripts/local-production-e2e-smoke.mjs", "utf8");
    const productionGateSource = readFileSync(
      "scripts/production-e2e-release-gate.mjs",
      "utf8",
    );

    const localProofSummary = extractConstStringArray(
      localSource,
      "LOCAL_PRODUCTION_TEACHING_OPERATIONS_ROUTE_PROOF_SUMMARY",
    );
    const requiredProductionProofs = extractConstStringArray(
      productionGateSource,
      "requiredTeachingOperationsRouteSmokeResults",
    );

    expect(localProofSummary).toEqual(requiredProductionProofs);
  });

  it("keeps course-management proof summary in sync with the production release gate", () => {
    const localSource = readFileSync("scripts/local-production-e2e-smoke.mjs", "utf8");
    const productionGateSource = readFileSync(
      "scripts/production-e2e-release-gate.mjs",
      "utf8",
    );

    const localProofSummary = extractConstStringArray(
      localSource,
      "LOCAL_PRODUCTION_TEACHING_COURSE_MANAGEMENT_ROUTE_PROOF_SUMMARY",
    );
    const requiredProductionProofs = extractConstStringArray(
      productionGateSource,
      "requiredTeachingCourseManagementRouteSmokeResults",
    );

    expect(localProofSummary).toEqual(requiredProductionProofs);
  });

  it("keeps ordinary teaching browser proof summary in sync with the production release gate", () => {
    const localSource = readFileSync("scripts/local-production-e2e-smoke.mjs", "utf8");
    const productionGateSource = readFileSync(
      "scripts/production-e2e-release-gate.mjs",
      "utf8",
    );

    const localProofSummary = extractConstStringArray(
      localSource,
      "LOCAL_PRODUCTION_TEACHING_OPERATION_DETAIL_BROWSER_PROOF_SUMMARY",
    );
    const requiredProductionProofs = extractConstStringArray(
      productionGateSource,
      "requiredTeachingOperationDetailBrowserResults",
    );

    expect(localProofSummary).toEqual(requiredProductionProofs);
  });

  it("keeps teacher workflow browser proof summary in sync with the production release gate", () => {
    const localSource = readFileSync("scripts/local-production-e2e-smoke.mjs", "utf8");
    const productionGateSource = readFileSync(
      "scripts/production-e2e-release-gate.mjs",
      "utf8",
    );

    const localProofSummary = extractConstStringArray(
      localSource,
      "LOCAL_PRODUCTION_BROWSER_PROOF_SUMMARY",
    );
    const requiredProductionProofs = extractConstStringArray(
      productionGateSource,
      "requiredTeacherWorkflowBrowserResults",
    );

    expect(localProofSummary).toEqual(requiredProductionProofs);
  });
});
