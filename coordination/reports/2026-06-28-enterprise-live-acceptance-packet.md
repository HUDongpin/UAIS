# UAIS Enterprise Live Acceptance Packet

Date: 2026-06-28
Scope: enterprise run-through for the ordinary teaching-management chain plus the AI/PPT production gate dependencies.
Authority: the JSON body of each evidence file is authoritative; filenames such as `production-live` are not acceptance proof.

## Current Decision

Status: **not accepted / gate blocked**

Authoritative current aggregate gate:

- `coordination/reports/2026-06-28-production-e2e-release-gate-current-live-filenames-refresh.json`

Freshly verified blocker shape:

- Aggregate gate status: `blocked`
- Ordinary teaching evidence summary status: `blocked`
- Ordinary teaching route smoke status: `dry-run-blocked`
- Ordinary teaching detail browser smoke status: `dry-run-blocked`
- Ordinary teaching course-management smoke status: `dry-run-blocked`
- Enterprise live evidence audit status: `blocked`, with `enterprise-live-evidence-audit-not-ready`
- Enterprise live audit result/env/contract criteria are enabled; current rows remain non-accepted until required target results, route-smoke env, and route-smoke `proves` entries are body-proven
- Release-run consistency: `waiting`, blocked by `vercel-production-deployment-not-proven`

Do not mark the enterprise goal complete until the aggregate gate reports `status: "ready"` and every production requirement reports `status: "satisfied"`.

## Body-Field Proof Required

JSON body fields required before accepting any production-live-named evidence:

- `mode: "live"`
- `environment: "production"`
- default target status `passed`
- readiness target status `ready` for app auth, teacher auth, and external storage service readiness
- manual PPT playback acceptance status `accepted` with `mode: "record"`
- a non-empty `releaseRunId` shared by every live evidence file
- required `safety` redaction flags proved in the JSON body
- `cookieValuesOmitted: true`
- for target-specific result evidence, `targetResultStatus: "proved"` with required workflow/page anchors as `present`, object-result keys as `passed`, and route/storage smoke result ids as `ok`
- for operation-detail browser evidence, `targetContractStatus: "proved"` with live teaching APIs, an issuer-issued teacher auth cookie, remote HTTPS deployment origin, Vercel/deployment-domain/teacher-auth/app-auth bindings, and full 11-operation primary/secondary button coverage
- for ordinary teaching route-smoke evidence, `targetContractStatus: "proved"` with the required `proves` proof-contract entries and `routes` subroute coverage from the release gate
- ordinary teaching route-smoke `requiredEnv` entries for external backends, external provider URLs/tokens, smoke cookies, teacher/course/class ids, and deployment base URL must be body-proved as `present`; provider/backend mode entries must declare `requiredValue: "external"`, and URL/token/cookie entries must keep values redacted
- no unexpected production-live evidence files; templates, mismatched body targets, and unknown targets must not be mixed into the final evidence set

Any file named `*-production-live.json` that reports `mode: "dry-run"`, `status: "blocked"`, missing release-run binding, missing safety proof, or missing required result keys remains non-acceptance evidence.

## Required Enterprise Live Evidence Targets

The enterprise live evidence audit accepts the run only when every required target below is body-proved as `mode: "live"`, `environment: "production"`, safety-redacted, and bound to the shared release-run id. Most targets must be body-proved with `status: "passed"`; readiness targets must be body-proved with `status: "ready"`; deployment-domain reachability must be body-proved with `status: "reachable"`; the manual PPT playback target must be body-proved with `mode: "record"` and `status: "accepted"`:

- `app-auth-provider-readiness`
- `teacher-auth-issuer-route-smoke`
- `teacher-auth-provider-readiness`
- `external-storage-persistence`
- `external-storage-service-readiness`
- `deployment-domain-reachability`
- `teacher-workflow-deployment-smoke`
- `teacher-workflow-browser-smoke`
- `teacher-workflow-live-generation-smoke`
- `learning-ppt-playback-deployment-smoke`
- `ppt-manual-playback-acceptance`
- `deployment-route-smoke`
- `teaching-operations-route-smoke`
- `teaching-operation-detail-browser-smoke`
- `teaching-course-management-route-smoke`
- `external-storage-smoke`

Manual PPT playback acceptance additionally requires `results` entries with value `passed` for:

- `manualPptMachinePreflightPassed`
- `manualPptOpenxmlIntegrityPassed`
- `manualPptRecordEvidenceComplete`
- `manualPptPackageIdentityMatched`
- `manualPptArtifactFingerprintMatched`
- `manualPptTimingValid`
- `manualPptHumanConfirmationAccepted`
- `manualPptTargetVoiceLabelPresent`
- `manualPptPowerPointPlaybackAccepted`
- `manualPptWpsPlaybackAccepted`
- `manualPptReleaseRunBound`
- `manualPptDeploymentFingerprintBound`
- `manualPptTestedAfterDeployment`
- `manualPptDeploymentEvidenceSourceProduction`
- `manualPptSafetyRedacted`

## Why Current Evidence Is Not Enough

The current files named `*-production-live.json` are currently content-wise dry-run blockers for the decisive production paths. The blocker is not local UI/backend implementation evidence; it is missing same-run, owner-approved, live production execution against the intended deployment, auth, storage, and provider environment.

Current ordinary teaching proof still needed:

- `live-teaching-operations-route-smoke`
- `live-teaching-operation-detail-browser-smoke`
- `live-teaching-course-management-route-smoke`
- `same-release-run-production-deployment`
- `same-deployment-domain-reachability-bound-to-ordinary-teaching-smokes`
- `live-app-auth-provider-readiness`
- `live-teacher-auth-provider-readiness`
- `live-external-storage-service-readiness`
- `provider-side-effects-and-external-readback`
- `audit-trace-rollback-alert-closure`

Current evidence hygiene blocker:

- `coordination/reports/2026-06-28-ppt-manual-playback-acceptance-record-template-production-live.json` is a non-evidence template whose basename matches the production-live audit glob.
- Detailed cleanup guidance is in `coordination/reports/2026-06-28-enterprise-live-evidence-hygiene-blocker.md`.
- Do not delete or rename the template without owner/S22 cleanup authorization; after authorized cleanup, regenerate the enterprise live evidence audit and aggregate release gate.

## Local-Production Continuation Evidence

The current local-production continuation evidence is:

- `coordination/reports/2026-06-30-local-production-e2e-smoke-enterprise-continuation.json`

This evidence is a pre-production closed-loop proof, not production-live acceptance. It is useful for narrowing the remaining production work: the ordinary teaching implementation and local production harness no longer appear to be the main blocker.

Current local-production proof summary:

- target `local-production-e2e-smoke`
- mode `live`
- environment `local-production`
- top-level status `passed`
- all 11 local-production checks are `passed`
- `s22-next-production-build` is `passed` in the same evidence file
- ordinary teaching route smoke is `passed`
- teaching course-management route smoke is `passed`
- teaching operation detail browser smoke is `passed`
- `operationDetailCoverageVerified: "passed"` for the 11 operation pages with primary and secondary actions

This does not change the final acceptance rule: production-live evidence must still be produced against the intended Vercel deployment, external storage, auth providers, and manual PPT playback process on one shared release-run id.

## Required Live Sequence

Use a single non-secret release-run id for every live evidence file. The full command source is:

- `coordination/reports/2026-06-28-production-e2e-orchestrator-dry-run-current-enterprise-refresh.json`

Run the live sequence in dependency order:

1. Vercel project readiness and server-only env apply/inventory.
2. App auth readiness and teacher auth route-chain/readiness.
3. External storage launch contract, approved container build, persistence readback, and service readiness.
4. Vercel production deployment, then deployment-domain reachability.
5. Protected AI route smoke and teacher workflow deployed page/browser/live-generation smokes.
6. Learning PPT playback deployment smoke.
7. Ordinary teaching route smoke.
8. Ordinary teaching detail browser smoke with `--api-mode live-teaching-operations`.
9. Ordinary teaching course-management route smoke.
10. External storage smoke.
11. Manual PPT playback acceptance as `ppt-manual-playback-acceptance-production-live.json`.
12. Final aggregate release gate.

Remote-mutating steps require explicit owner approval and approved env/cookie/token sources. Do not inspect, print, commit, or copy real secret values.

## Ordinary Teaching Acceptance Criteria

The ordinary teaching bundle is accepted only when all three ordinary teaching evidence files are live production passes on the same release-run id:

- `coordination/reports/2026-06-28-teaching-operations-route-smoke-production-live.json`
- `coordination/reports/2026-06-28-teaching-operation-detail-browser-smoke-production-live.json`
- `coordination/reports/2026-06-28-teaching-course-management-route-smoke-production-live.json`

Each must be bound to:

- the same Vercel production deployment evidence,
- the same deployment-domain reachability evidence,
- live teacher-auth readiness,
- live app-auth readiness where student flows are involved,
- live external-storage service readiness,
- redacted safety flags,
- ordinary teaching result proof,
- ordinary teaching route-smoke proof-contract proof,
- operation-detail browser target-contract proof,
- ordinary teaching route-smoke required-env preflight proof,
- and a non-missing release-run id.

## Target Result Proof Keys

The enterprise live evidence audit now rejects target-specific production-live files unless the JSON body proves the required `results` entries below. Workflow/page anchors must be present as `present`; object result keys must be present as `passed`; route/storage smoke result ids must be present in the results array as `status: "ok"`. Missing keys produce `targetResultStatus: "missing"` and `target-result-proof-missing`. For operation-detail browser evidence and ordinary teaching route-smoke evidence, the audit also requires the target contract listed below; missing proof or route-coverage keys produce `targetContractStatus: "missing"` and `target-contract-proof-missing`.

### `app-auth-provider-readiness`

- `appAuthProviderModeTrusted`
- `appAuthProviderEndpointRemoteHttps`
- `appAuthSessionCookieContract`
- `appAuthProviderVercelEnvSync`
- `trustedAccountProviderContract`
- `appAuthReadinessSafety`

### `deployment-route-smoke`

- `s22-retention-readiness-route`
- `s22-voice-lifecycle-audit-route`
- `s22-ai-readiness-route`
- `s22-ai-smoke-plan-route`
- `s22-teacher-auth-issuer-route`
- `s22-teacher-ai-session-route`
- `s22-teacher-ownership-route`
- `s22-teacher-ppt-workflow-route`

### `teacher-auth-issuer-route-smoke`

- `s22-teacher-auth-issuer-route`

### `teacher-auth-provider-readiness`

- `teacherAuthProviderModeSupported`
- `teacherAuthSessionCookieContract`
- `teacherAuthProviderVercelEnvSync`
- `teacherAuthProviderSpecificContract`
- `teacherAuthProviderRouteBinding`
- `teacherAuthReadinessSafety`

### `external-storage-service-readiness`

- `externalStorageEndpointRemoteHttps`
- `externalStorageHealthContract`
- `externalStorageOrdinaryTeachingSchemas`
- `externalStorageTeachingOperationsSchema`
- `externalStorageTeachingCourseManagementSchema`
- `externalStorageTeachingCourseAssetsSchema`
- `externalStorageVercelEnvSync`
- `externalStorageProductionLaunchContract`
- `externalStoragePersistenceEvidence`
- `externalStorageReadinessSafety`

### `deployment-domain-reachability`

- `deploymentDomainOriginRemoteHttps`
- `deploymentDomainDnsOriginReachable`
- `deploymentDomainTransportConnected`
- `deploymentDomainRootHttpReachable`
- `deploymentDomainTeachingHttpReachable`
- `deploymentDomainLearningHttpReachable`
- `deploymentDomainFingerprintBound`
- `deploymentDomainReadinessSafety`

### `teacher-workflow-deployment-smoke`

- `teacherWorkflowTitle`
- `voiceSampleUpload`
- `voiceSampleSelect`
- `uploadedSampleAudioPayload`
- `voiceSampleDurationGate`
- `selectedSampleIdentity`
- `preflight`
- `pptNarrationGenerate`
- `perSlideWavDownloads`
- `signedSessionBootstrap`
- `signedSessionReadiness`
- `workflowSessionActions`
- `serverWorkflowStatus`
- `serverWorkflowProgress`

### `teacher-workflow-browser-smoke`

- `openTeachingPage`
- `browserHydration`
- `voiceSampleDurationGate`
- `voiceSampleFileSelection`
- `serverWorkflowRefresh`
- `signedSessionBootstrap`
- `voiceSampleSubmit`
- `voiceClonePreflight`
- `voiceCloneStatus`
- `pptNarrationSubmit`
- `pptNarrationSlidePayload`
- `perSlideWavDownloadLinks`
- `perSlideWavDownloadHrefContract`

### `teacher-workflow-live-generation-smoke`

- `signedSessionBootstrap`
- `voiceSampleSubmit`
- `voiceClonePreflight`
- `voiceCloneStatusSucceeded`
- `pptNarrationSubmit`
- `generatedAudioManifest`
- `generatedZipExport`
- `perSlideAudioDownload`

### `learning-ppt-playback-deployment-smoke`

- `learningPageHttp200`
- `playbackManifestKangXiaVoice`
- `playbackManifestSlideCount`
- `playbackManifestStudentSafeRedaction`
- `firstSlideAudioWavHeaders`

### `external-storage-persistence`

- `s22-external-storage-persistence-health`
- `s22-external-storage-persisted-ownership-read`
- `s24-external-storage-persisted-audit-read`

### `teaching-operations-route-smoke`

- `unauthenticatedPostDenied`
- `unauthenticatedPostNoWriteSideEffects`
- `signedStudentPostDenied`
- `signedStudentNoWriteSideEffects`
- `unsafeAppSessionPostDenied`
- `unsafeAppSessionPostTraceHeaderReturned`
- `unsafeAppSessionPostNoWriteSideEffects`
- `signedTeacherCourseIdRequired`
- `signedTeacherCourseIdRequiredNoWriteSideEffects`
- `forbiddenCourseScopeDenied`
- `forbiddenCourseScopeNoWriteSideEffects`
- `authorizedOperationPersisted`
- `durableExternalPersistenceReturned`
- `domainPersistenceSummaryReturned`
- `operationsSchemaMigrationPolicyReturned`
- `appendLedgerSequenceReturned`
- `appendLedgerSequenceReadbackReturned`
- `signedActorReturned`
- `courseBindingReturned`
- `auditTraceReturned`
- `auditAuthSessionReturned`
- `auditRequestSourceProvenanceReturned`
- `unauthenticatedTraceHeaderReturned`
- `signedStudentTraceHeaderReturned`
- `unauthenticatedAuditReadbackDenied`
- `unauthenticatedAuditReadbackTraceHeaderReturned`
- `signedStudentAuditReadbackDenied`
- `signedStudentAuditReadbackTraceHeaderReturned`
- `unsafeAppSessionAuditReadbackDenied`
- `unsafeAppSessionAuditReadbackTraceHeaderReturned`
- `unauthenticatedAlertNotificationEnqueueDenied`
- `unauthenticatedAlertNotificationTraceHeaderReturned`
- `signedStudentAlertNotificationEnqueueDenied`
- `signedStudentAlertNotificationTraceHeaderReturned`
- `unauthenticatedAlertNotificationNoWriteSideEffects`
- `signedStudentAlertNotificationNoWriteSideEffects`
- `unauthenticatedAlertNotificationReadbackDenied`
- `unauthenticatedAlertNotificationReadbackTraceHeaderReturned`
- `signedStudentAlertNotificationReadbackDenied`
- `signedStudentAlertNotificationReadbackTraceHeaderReturned`
- `authorizedTraceHeaderReturned`
- `auditReadbackReturned`
- `auditAuthSessionReadbackReturned`
- `auditReadbackTraceHeaderReturned`
- `domainProjectionReadbackReturned`
- `externalDomainProjectionReadbackReturned`
- `courseSettingsDomainObjectReturned`
- `courseSettingsPatchReadbackReturned`
- `studentPreviewSessionDomainObjectReturned`
- `studentPreviewSessionAuditSourceReturned`
- `studentRosterSyncDomainObjectReturned`
- `studentRosterDomainPersistenceSummaryReturned`
- `studentRosterProviderSyncReturned`
- `studentRosterProviderSyncAuditSourceReturned`
- `studentGroupSuggestionDomainObjectReturned`
- `studentGroupSuggestionAuditSourceReturned`
- `knowledgeIndexSyncDomainObjectReturned`
- `knowledgeIndexDomainPersistenceSummaryReturned`
- `knowledgeIndexProviderSyncReturned`
- `knowledgeIndexProviderSyncAuditSourceReturned`
- `resourceReviewItemDomainObjectReturned`
- `resourceReviewItemAuditSourceReturned`
- `courseContentPublishDomainObjectReturned`
- `courseContentDomainPersistenceSummaryReturned`
- `courseContentProviderPublishReturned`
- `courseContentProviderPublishAuditSourceReturned`
- `courseUnitDraftDomainObjectReturned`
- `courseUnitDraftAuditSourceReturned`
- `dashboardRefreshDomainObjectReturned`
- `dashboardRefreshDomainPersistenceSummaryReturned`
- `dashboardRefreshAuditSourceReturned`
- `dashboardSnapshotDomainObjectReturned`
- `dashboardSnapshotAuditSourceReturned`
- `quizAssessmentDomainObjectReturned`
- `quizAssessmentDomainPersistenceSummaryReturned`
- `quizItemReviewDomainObjectReturned`
- `quizItemReviewDomainPersistenceSummaryReturned`
- `quizItemReviewAuditSourceReturned`
- `agentSettingsDomainObjectReturned`
- `agentSettingsAuditSourceReturned`
- `agentPermissionPreflightDomainObjectReturned`
- `agentPermissionPreflightAuditSourceReturned`
- `adminSettingsDomainObjectReturned`
- `adminSettingsAuditSourceReturned`
- `collaborationInviteNotificationDomainObjectReturned`
- `collaborationInviteDomainPersistenceSummaryReturned`
- `collaborationInviteEmailDeliveryReturned`
- `collaborationInviteEmailDeliveryAuditSourceReturned`
- `unauthenticatedCollaborationInviteEmailBounceCallbackDenied`
- `unauthenticatedCollaborationInviteEmailBounceCallbackTraceHeaderReturned`
- `unauthenticatedCollaborationInviteEmailBounceCallbackNoWriteSideEffects`
- `signedStudentCollaborationInviteEmailBounceCallbackDenied`
- `signedStudentCollaborationInviteEmailBounceCallbackTraceHeaderReturned`
- `signedStudentCollaborationInviteEmailBounceCallbackNoWriteSideEffects`
- `invalidTokenCollaborationInviteEmailBounceCallbackDenied`
- `invalidTokenCollaborationInviteEmailBounceCallbackTraceHeaderReturned`
- `invalidTokenCollaborationInviteEmailBounceCallbackNoWriteSideEffects`
- `unsafeCollaborationInviteEmailBounceCallbackDenied`
- `unsafeCollaborationInviteEmailBounceCallbackTraceHeaderReturned`
- `unsafeCollaborationInviteEmailBounceCallbackNoWriteSideEffects`
- `collaborationInviteEmailBounceCallbackReturned`
- `collaborationInviteEmailCallbackAuditSourceReturned`
- `courseExportManifestDomainObjectReturned`
- `courseExportProviderReturned`
- `courseExportProviderAuditSourceReturned`
- `courseExportManifestAuditSourceReturned`
- `unauthenticatedExportManifestDownloadDenied`
- `unauthenticatedExportManifestDownloadTraceHeaderReturned`
- `signedStudentExportManifestDownloadDenied`
- `signedStudentExportManifestDownloadTraceHeaderReturned`
- `exportManifestDownloadReadbackReturned`
- `unsafeExportManifestIdDenied`
- `courseExportRedactionValidationDomainObjectReturned`
- `exportRedactionValidationAuditSourceReturned`
- `gradingQueueDomainObjectReturned`
- `gradebookUpdateDomainObjectReturned`
- `gradingDomainPersistenceSummaryReturned`
- `gradingFeedbackDraftDomainObjectReturned`
- `gradingFeedbackProviderReturned`
- `gradingFeedbackProviderAuditSourceReturned`
- `idempotentRetryReturned`
- `idempotentRetryAppendSequenceStableReturned`
- `concurrentIdempotentRetryAppendSequenceStableReturned`
- `idempotencyConflictDenied`
- `unauthenticatedRollbackDenied`
- `unauthenticatedRollbackTraceHeaderReturned`
- `unauthenticatedRollbackNoWriteSideEffects`
- `signedStudentRollbackDenied`
- `signedStudentRollbackTraceHeaderReturned`
- `signedStudentRollbackNoWriteSideEffects`
- `rollbackPersistedReturned`
- `rollbackProductionDatabaseAdapterReturned`
- `rollbackTraceHeaderReturned`
- `rollbackTraceClosureReturned`
- `rollbackReadbackReturned`
- `rollbackReadbackTraceHeaderReturned`
- `unauthenticatedAlertSummaryReadbackDenied`
- `unauthenticatedAlertSummaryReadbackTraceHeaderReturned`
- `signedStudentAlertSummaryReadbackDenied`
- `signedStudentAlertSummaryReadbackTraceHeaderReturned`
- `alertSummaryReadbackReturned`
- `alertNotificationQueuedReturned`
- `alertNotificationReadbackReturned`
- `inviteCodeDraftDomainObjectReturned`
- `inviteCodeDraftAuditSourceReturned`
- `invitePublishClassJoinEntryReturned`
- `invitePublishDomainPersistenceSummaryReturned`
- `inviteCodePublishAuditSourceReturned`
- `studentInviteJoinReturned`
- `unauthenticatedGradebookReleaseDenied`
- `unauthenticatedGradebookReleaseTraceHeaderReturned`
- `unauthenticatedGradebookRollbackDenied`
- `unauthenticatedGradebookRollbackTraceHeaderReturned`
- `signedStudentGradebookReleaseDenied`
- `signedStudentGradebookReleaseTraceHeaderReturned`
- `signedStudentGradebookRollbackDenied`
- `signedStudentGradebookRollbackTraceHeaderReturned`
- `unauthenticatedGradebookReleaseNoWriteSideEffects`
- `unauthenticatedGradebookRollbackNoWriteSideEffects`
- `signedStudentGradebookReleaseNoWriteSideEffects`
- `signedStudentGradebookRollbackNoWriteSideEffects`
- `unsafeGradebookReleaseObjectIdDenied`
- `unsafeGradebookRollbackObjectIdDenied`
- `gradebookReleaseTraceClosureReturned`
- `gradebookReleaseAuditSourceReturned`
- `gradebookReleaseExternalStorageReturned`
- `gradebookProviderReleaseReturned`
- `gradebookRollbackTraceClosureReturned`
- `gradebookRollbackAuditSourceReturned`
- `gradebookRollbackExternalStorageReturned`
- `gradebookProviderRollbackReturned`
- `externalBackupCreatedReturned`
- `unauthenticatedBackupRestoreDenied`
- `unauthenticatedBackupRestoreTraceHeaderReturned`
- `unauthenticatedBackupRestoreNoWriteSideEffects`
- `signedStudentBackupRestoreDenied`
- `signedStudentBackupRestoreTraceHeaderReturned`
- `signedStudentBackupRestoreNoWriteSideEffects`
- `directBackupRestoreDisabledReturned`
- `directBackupRestoreTraceClosureReturned`
- `directBackupRestoreNoWriteSideEffects`
- `unsafeBackupRestoreIdDenied`
- `unsafeBackupRestoreNoWriteSideEffects`
- `externalRestoreDrillVerifiedReturned`


### `teaching-operation-detail-browser-smoke`

- `openOperationPage`
- `browserHydration`
- `signedTeacherSessionBootstrap`
- `operationButtonClick`
- `operationPostPersisted`
- `secondaryOperationButtonClick`
- `secondaryOperationPostPersisted`
- `auditReadbackVerified`
- `domainProjectionVerified`
- `traceVisible`
- `actorVisible`
- `authSessionVisible`
- `duplicateSubmitBlocked`
- `operationFailureAlertVerified`
- `operationInviteArtifactAuditGated`
- `openMainTeachingPage`
- `mainInlineWorkspaceHydration`
- `mainCourseCreateButtonClick`
- `mainCourseCoverGenerateButtonClick`
- `mainCourseCoverGenerated`
- `mainCourseCoverAssetAuditGated`
- `mainCourseCoverAssetBoundToCourseCreate`
- `mainCourseCreatePersisted`
- `mainCourseCreateReceiptAuthSessionReturned`
- `mainCourseCreateReadbackVerified`
- `mainClassCreateButtonClick`
- `mainClassCreatePersisted`
- `mainClassCreateReceiptAuthSessionReturned`
- `mainClassCreateReadbackVerified`
- `mainInlineOperationButtonClick`
- `mainInlineDuplicateSubmitBlocked`
- `mainInlineCourseSettingsPatchSubmitted`
- `mainInlineOperationPostPersisted`
- `mainInlineOperationReceiptAuthSessionReturned`
- `mainInlineOperationFailureAlertVerified`
- `mainInlineAuditPendingBeforeSuccess`
- `mainInlineCourseSettingsCardAuditGated`
- `mainInlineAuditReadbackVerified`
- `mainInlineDomainProjectionVerified`
- `mainInlineAlertPendingBeforeSuccess`
- `mainInlineKnowledgeIndexSyncSubmitted`
- `mainInlineStudentRosterSyncSubmitted`
- `mainInlineDashboardRefreshSubmitted`
- `mainInlineStudentPreviewSubmitted`
- `mainInlineAgentPermissionPreflightSubmitted`
- `mainKnowledgeSourceRegistrationSubmitted`
- `mainInlineUnitDraftSubmitted`
- `mainInlineCollaborationInviteSubmitted`
- `mainInlineStudentGroupSuggestionSubmitted`
- `mainInlineExportRedactionValidationSubmitted`
- `mainInlineDashboardSnapshotSubmitted`
- `mainInlineQuizItemReviewSubmitted`
- `mainInlineGradingFeedbackDraftSubmitted`
- `mainInlineAgentPlanSubmitted`
- `mainInlineContentPublishSubmitted`
- `mainInlineAdminSettingsSubmitted`
- `mainInlineExportManifestSubmitted`
- `mainInlineQuizBoardRefreshSubmitted`
- `mainInlineGradingQueueSubmitted`
- `mainInlineAuditAlertReadbackVerified`
- `mainInlineAlertNotificationButtonClick`
- `mainInlineAlertNotificationReadbackVerified`
- `mainInlineRollbackButtonClick`
- `mainInlineRollbackPersisted`
- `mainInviteWorkspaceHydration`
- `mainInviteGenerateButtonClick`
- `mainInviteAuditPendingBeforeArtifact`
- `mainInviteAuditReadbackVerified`
- `mainInviteDraftArtifactReturned`
- `mainInvitePublishButtonClick`
- `mainInvitePublishAuditReadbackVerified`
- `mainInvitePublishArtifactReturned`
- `mainInvitePublishClassReadbackVerified`
- `operationDetailCoverageVerified`
### `teaching-course-management-route-smoke`

- `unauthenticatedCourseListDenied`
- `unauthenticatedCourseCoverDenied`
- `unauthenticatedCourseCoverNoWriteSideEffects`
- `unauthenticatedCourseCreateDenied`
- `unauthenticatedCourseCreateNoWriteSideEffects`
- `signedStudentCourseCreateDenied`
- `signedStudentCourseCreateNoWriteSideEffects`
- `signedStudentCourseCoverDenied`
- `signedStudentCourseCoverNoWriteSideEffects`
- `signedTeacherForeignCourseCreateDenied`
- `signedTeacherForeignCourseCreateNoWriteSideEffects`
- `signedOtherTeacherCourseCoverDenied`
- `signedOtherTeacherCourseCoverNoWriteSideEffects`
- `unauthenticatedClassCreateDenied`
- `unauthenticatedClassCreateNoWriteSideEffects`
- `signedStudentClassCreateDenied`
- `signedStudentClassCreateNoWriteSideEffects`
- `signedOtherTeacherClassCreateDenied`
- `signedOtherTeacherClassCreateNoWriteSideEffects`
- `signedTeacherCourseCoverGenerated`
- `externalCoverAssetPersistenceReturned`
- `courseCoverAssetReadbackRevisionReturned`
- `courseCoverAssetReadbackDatabaseAdapterReturned`
- `signedTeacherCourseCoverAuditAuthSessionReturned`
- `courseCoverExternalAssetAuditReadbackReturned`
- `courseCoverAssetRevisionRetryContractReturned`
- `signedTeacherCourseCoverTraceHeaderReturned`
- `signedTeacherCourseCreated`
- `duplicateCourseCreateDenied`
- `duplicateCourseCreateNoDuplicateSideEffects`
- `courseCreateExternalSnapshotPolicyReturned`
- `courseCreateAuditSourceReadbackReturned`
- `courseCreateAuthSessionReadbackReturned`
- `createdCourseUsedCoverDraftScope`
- `createdCourseBoundGeneratedCoverAsset`
- `existingCourseCoverBindingReadbackReturned`
- `existingCourseCoverListedReadbackReturned`
- `existingCourseCoverExternalAssetAuditReadbackReturned`
- `existingCourseCoverBindingAuditSourceReturned`
- `externalOwnershipMerged`
- `createdCourseTeachingOperationAccepted`
- `signedTeacherClassCreated`
- `duplicateClassCreateDenied`
- `duplicateClassCreateNoDuplicateSideEffects`
- `classCreateExternalSnapshotPolicyReturned`
- `classCreateAuditSourceReadbackReturned`
- `classCreateAuthSessionReadbackReturned`
- `signedTeacherCourseListReturned`
- `createdCourseListed`
- `createdClassListed`
- `signedOtherTeacherCourseListReturned`
- `otherTeacherCourseHidden`
- `otherTeacherClassHidden`
- `studentCourseHiddenBeforeMembership`
- `unauthenticatedInviteJoinDenied`
- `unauthenticatedInviteJoinNoWriteSideEffects`
- `signedStudentInviteJoined`
- `duplicateStudentInviteJoinIdempotentReturned`
- `duplicateStudentInviteJoinNoDuplicateSideEffects`
- `studentPendingCourseHiddenBeforeApproval`
- `studentPendingClassHiddenBeforeApproval`
- `studentPendingMembershipHiddenBeforeApproval`
- `signedStudentPendingCourseListTraceHeaderReturned`
- `signedStudentInviteJoinAuditSourceReturned`
- `signedStudentInviteJoinAuthSessionReturned`
- `signedStudentInviteJoinAuthSessionReadbackReturned`
- `unauthenticatedMembershipApprovalDenied`
- `unauthenticatedMembershipApprovalNoWriteSideEffects`
- `signedStudentMembershipApprovalDenied`
- `signedStudentMembershipApprovalNoWriteSideEffects`
- `signedOtherTeacherMembershipApprovalDenied`
- `signedOtherTeacherMembershipApprovalActorResourceReturned`
- `signedOtherTeacherMembershipApprovalNoWriteSideEffects`
- `signedTeacherMembershipApproved`
- `duplicateMembershipApprovalIdempotentReturned`
- `duplicateMembershipApprovalNoDuplicateSideEffects`
- `signedTeacherMembershipApprovalAuditSourceReturned`
- `signedTeacherMembershipApprovalAuthSessionReturned`
- `signedTeacherMembershipApprovalAuthSessionReadbackReturned`
- `signedStudentCourseListReturned`
- `approvedCourseVisibleForStudent`
- `approvedMembershipListedForStudent`
- `unauthenticatedCourseListTraceHeaderReturned`
- `unauthenticatedCourseCoverTraceHeaderReturned`
- `unauthenticatedCourseCreateTraceHeaderReturned`
- `signedStudentCourseCreateTraceHeaderReturned`
- `signedStudentCourseCoverTraceHeaderReturned`
- `signedOtherTeacherCourseCoverTraceHeaderReturned`
- `unauthenticatedClassCreateTraceHeaderReturned`
- `signedStudentClassCreateTraceHeaderReturned`
- `signedOtherTeacherClassCreateTraceHeaderReturned`
- `signedTeacherCourseCreateTraceHeaderReturned`
- `signedTeacherCourseCreateTraceBodyReturned`
- `signedTeacherClassCreateTraceHeaderReturned`
- `signedTeacherClassCreateTraceBodyReturned`
- `signedTeacherCourseListTraceHeaderReturned`
- `signedOtherTeacherCourseListTraceHeaderReturned`
- `signedStudentPreJoinCourseListTraceHeaderReturned`
- `unauthenticatedInviteJoinTraceHeaderReturned`
- `signedStudentInviteJoinTraceHeaderReturned`
- `signedStudentInviteJoinTraceBodyReturned`
- `unauthenticatedMembershipApprovalTraceHeaderReturned`
- `signedStudentMembershipApprovalTraceHeaderReturned`
- `signedOtherTeacherMembershipApprovalTraceHeaderReturned`
- `signedTeacherMembershipApproveTraceHeaderReturned`
- `signedTeacherMembershipApproveTraceBodyReturned`
- `signedStudentCourseListTraceHeaderReturned`

### `external-storage-smoke`

- `s22-external-storage-health`
- `s12-external-teacher-ownership-merge`
- `s12-external-teacher-ownership-read`
- `s12-external-course-management-backup-restore-drill`
- `s12-external-course-assets-backup-restore-drill`
- `s12-external-teaching-operations-backup-restore-drill`
- `s12-external-teaching-operations-concurrent-append-readback`
- `s12-external-teaching-operations-unauthenticated-append-denied`
- `s12-external-teaching-operations-invalid-token-append-denied`
- `s24-external-lifecycle-audit-append`
- `s24-external-lifecycle-audit-read`

## Operation Detail Browser Contract Keys

The operation-detail browser production-live evidence must include these contract entries in addition to the required `results` object.

### `teaching-operation-detail-browser-smoke`

- `route`
- `operationId`
- `auth`
- `apiInterceptionPolicy`
- `deploymentOrigin`
- `vercelProductionDeploymentEvidence`
- `deploymentDomainReachabilityEvidence`
- `teacherAuthProviderReadinessEvidence`
- `appAuthProviderReadinessEvidence`
- `operationCoverage`

## Ordinary Teaching Route-Smoke Proof Contract Keys

The ordinary teaching route-smoke production-live evidence must include these `proves` entries in addition to the required `results` object. It must also include a `routes` array covering the relevant ordinary teaching subroute surface.

Required `routes` for `teaching-operations-route-smoke`:

- `/api/teaching/operations`
- `/api/teaching/operations/audit`
- `/api/teaching/operations/audit/alerts`
- `/api/teaching/operations/audit/alerts/notifications`
- `/api/teaching/operations/collaboration-invite-deliveries`
- `/api/teaching/invite-codes/{code}/join`
- `/api/teaching/operations/records/{recordId}/rollback`
- `/api/teaching/operations/export/{manifestId}`
- `/api/teaching/gradebook-updates/{gradebookUpdateId}/{action}`
- `/api/teaching/operations/backups/{backupId}/restore`

Required `routes` for `teaching-course-management-route-smoke`:

- `/api/teaching/course-cover`
- `/api/teaching/courses`
- `/api/teaching/operations`
- `/api/teaching/courses/{courseId}/classes`
- `/api/teaching/invite-codes/{code}/join`
- `/api/teaching/classes/{classId}/memberships/{membershipId}/approve`

### `teaching-operations-route-smoke`

- `unauthenticated-post-denied`
- `unauthenticated-post-no-write-side-effects`
- `signed-teacher-cookie-required`
- `signed-student-post-denied`
- `signed-student-post-no-write-side-effects`
- `unsafe-app-session-post-denied`
- `unsafe-app-session-post-trace-header-returned`
- `unsafe-app-session-post-no-write-side-effects`
- `signed-teacher-course-id-required`
- `signed-teacher-course-id-required-no-write-side-effects`
- `signed-teacher-course-scope-denied`
- `signed-teacher-course-scope-no-write-side-effects`
- `course-ownership-bound-operation-persisted`
- `durable-external-persistence-returned`
- `domain-persistence-summary-returned`
- `operations-schema-migration-policy-returned`
- `append-ledger-sequence-returned`
- `append-ledger-sequence-readback-returned`
- `audit-trace-returned`
- `audit-auth-session-returned`
- `audit-request-source-provenance-returned`
- `unauthenticated-response-trace-header-returned`
- `signed-student-response-trace-header-returned`
- `unauthenticated-audit-readback-denied`
- `unauthenticated-audit-readback-trace-header-returned`
- `signed-student-audit-readback-denied`
- `signed-student-audit-readback-trace-header-returned`
- `unsafe-app-session-audit-readback-denied`
- `unsafe-app-session-audit-readback-trace-header-returned`
- `unauthenticated-alert-notification-enqueue-denied`
- `unauthenticated-alert-notification-trace-header-returned`
- `signed-student-alert-notification-enqueue-denied`
- `signed-student-alert-notification-trace-header-returned`
- `unauthenticated-alert-notification-readback-denied`
- `unauthenticated-alert-notification-readback-trace-header-returned`
- `signed-student-alert-notification-readback-denied`
- `signed-student-alert-notification-readback-trace-header-returned`
- `authorized-response-trace-header-returned`
- `audit-readback-returned`
- `audit-auth-session-readback-returned`
- `audit-readback-response-trace-header-returned`
- `domain-projection-readback-returned`
- `external-domain-projection-readback-returned`
- `course-settings-domain-object-returned`
- `course-settings-patch-readback-returned`
- `student-preview-session-domain-object-returned`
- `student-preview-session-audit-source-returned`
- `student-roster-domain-object-returned`
- `student-roster-domain-persistence-summary-returned`
- `student-roster-provider-sync-returned`
- `student-roster-provider-sync-audit-source-returned`
- `student-group-suggestion-domain-object-returned`
- `student-group-suggestion-audit-source-returned`
- `knowledge-index-domain-object-returned`
- `knowledge-index-domain-persistence-summary-returned`
- `knowledge-index-provider-sync-returned`
- `knowledge-index-provider-sync-audit-source-returned`
- `resource-review-item-domain-object-returned`
- `resource-review-item-audit-source-returned`
- `course-content-domain-object-returned`
- `course-content-domain-persistence-summary-returned`
- `course-content-provider-publish-returned`
- `course-content-provider-publish-audit-source-returned`
- `course-unit-draft-domain-object-returned`
- `course-unit-draft-audit-source-returned`
- `dashboard-state-domain-object-returned`
- `dashboard-state-domain-persistence-summary-returned`
- `dashboard-state-audit-source-returned`
- `dashboard-snapshot-domain-object-returned`
- `dashboard-snapshot-audit-source-returned`
- `quiz-assessment-domain-object-returned`
- `quiz-assessment-domain-persistence-summary-returned`
- `quiz-item-review-domain-object-returned`
- `quiz-item-review-domain-persistence-summary-returned`
- `quiz-item-review-audit-source-returned`
- `agent-settings-domain-object-returned`
- `agent-settings-audit-source-returned`
- `agent-permission-preflight-domain-object-returned`
- `agent-permission-preflight-audit-source-returned`
- `admin-settings-domain-object-returned`
- `admin-settings-audit-source-returned`
- `collaboration-invite-notification-domain-object-returned`
- `collaboration-invite-domain-persistence-summary-returned`
- `collaboration-invite-email-delivery-returned`
- `collaboration-invite-email-delivery-audit-source-returned`
- `unauthenticated-collaboration-invite-email-callback-denied`
- `unauthenticated-collaboration-invite-email-callback-trace-header-returned`
- `unauthenticated-collaboration-invite-email-callback-no-write-side-effects`
- `signed-student-collaboration-invite-email-callback-denied`
- `signed-student-collaboration-invite-email-callback-trace-header-returned`
- `signed-student-collaboration-invite-email-callback-no-write-side-effects`
- `invalid-token-collaboration-invite-email-callback-denied`
- `invalid-token-collaboration-invite-email-callback-trace-header-returned`
- `invalid-token-collaboration-invite-email-callback-no-write-side-effects`
- `unsafe-collaboration-invite-email-callback-denied`
- `unsafe-collaboration-invite-email-callback-trace-header-returned`
- `unsafe-collaboration-invite-email-callback-no-write-side-effects`
- `collaboration-invite-email-bounce-callback-returned`
- `collaboration-invite-email-callback-audit-source-returned`
- `course-export-manifest-domain-object-returned`
- `course-export-provider-returned`
- `course-export-provider-audit-source-returned`
- `course-export-manifest-audit-source-returned`
- `unauthenticated-export-manifest-download-denied`
- `unauthenticated-export-manifest-download-trace-header-returned`
- `signed-student-export-manifest-download-denied`
- `signed-student-export-manifest-download-trace-header-returned`
- `export-manifest-download-readback-returned`
- `unsafe-export-manifest-id-denied`
- `export-redaction-validation-domain-object-returned`
- `export-redaction-validation-audit-source-returned`
- `grading-queue-domain-object-returned`
- `gradebook-update-domain-object-returned`
- `grading-domain-persistence-summary-returned`
- `grading-feedback-draft-domain-object-returned`
- `grading-feedback-provider-returned`
- `grading-feedback-provider-audit-source-returned`
- `idempotent-retry-returned`
- `idempotent-retry-append-sequence-stable-returned`
- `concurrent-idempotent-retry-append-sequence-stable-returned`
- `idempotency-conflict-denied`
- `unauthenticated-rollback-denied`
- `unauthenticated-rollback-trace-header-returned`
- `unauthenticated-rollback-no-write-side-effects`
- `signed-student-rollback-denied`
- `signed-student-rollback-trace-header-returned`
- `signed-student-rollback-no-write-side-effects`
- `rollback-record-persisted`
- `rollback-production-database-adapter-returned`
- `rollback-response-trace-header-returned`
- `rollback-trace-closure-returned`
- `rollback-readback-returned`
- `rollback-readback-response-trace-header-returned`
- `unauthenticated-alert-summary-readback-denied`
- `unauthenticated-alert-summary-readback-trace-header-returned`
- `signed-student-alert-summary-readback-denied`
- `signed-student-alert-summary-readback-trace-header-returned`
- `alert-summary-readback-returned`
- `unauthenticated-alert-notification-no-write-side-effects`
- `signed-student-alert-notification-no-write-side-effects`
- `alert-notification-queued-returned`
- `alert-notification-readback-returned`
- `invite-code-draft-domain-object-returned`
- `invite-code-draft-audit-source-returned`
- `invite-publish-class-join-entry-returned`
- `invite-publish-domain-persistence-summary-returned`
- `invite-code-publish-audit-source-returned`
- `student-invite-join-returned`
- `unauthenticated-gradebook-release-denied`
- `unauthenticated-gradebook-release-trace-header-returned`
- `unauthenticated-gradebook-rollback-denied`
- `unauthenticated-gradebook-rollback-trace-header-returned`
- `signed-student-gradebook-release-denied`
- `signed-student-gradebook-release-trace-header-returned`
- `signed-student-gradebook-rollback-denied`
- `signed-student-gradebook-rollback-trace-header-returned`
- `unauthenticated-gradebook-release-no-write-side-effects`
- `unauthenticated-gradebook-rollback-no-write-side-effects`
- `signed-student-gradebook-release-no-write-side-effects`
- `signed-student-gradebook-rollback-no-write-side-effects`
- `unsafe-gradebook-release-object-id-denied`
- `unsafe-gradebook-rollback-object-id-denied`
- `gradebook-release-trace-closure-returned`
- `gradebook-release-audit-source-returned`
- `gradebook-release-external-storage-returned`
- `gradebook-provider-release-returned`
- `gradebook-rollback-trace-closure-returned`
- `gradebook-rollback-audit-source-returned`
- `gradebook-rollback-external-storage-returned`
- `gradebook-provider-rollback-returned`
- `external-backup-created-returned`
- `unauthenticated-backup-restore-denied`
- `unauthenticated-backup-restore-trace-header-returned`
- `unauthenticated-backup-restore-no-write-side-effects`
- `signed-student-backup-restore-denied`
- `signed-student-backup-restore-trace-header-returned`
- `signed-student-backup-restore-no-write-side-effects`
- `direct-backup-restore-disabled-returned`
- `direct-backup-restore-trace-closure-returned`
- `direct-backup-restore-no-write-side-effects`
- `unsafe-backup-restore-id-denied`
- `unsafe-backup-restore-no-write-side-effects`
- `external-restore-drill-verified-returned`
- `response-values-redacted`
- `release-run-id-bound`
- `same-vercel-production-deployment-bound`
- `same-teacher-auth-provider-readiness-bound`
- `same-app-auth-provider-readiness-bound`
- `same-external-storage-service-readiness-bound`

### `teaching-course-management-route-smoke`

- `unauthenticated-course-list-denied`
- `unauthenticated-course-cover-denied`
- `unauthenticated-course-cover-no-write-side-effects`
- `unauthenticated-course-create-denied`
- `unauthenticated-course-create-no-write-side-effects`
- `signed-student-course-create-denied`
- `signed-student-course-create-no-write-side-effects`
- `signed-student-course-cover-denied`
- `signed-student-course-cover-no-write-side-effects`
- `signed-teacher-foreign-course-create-denied`
- `signed-teacher-foreign-course-create-no-write-side-effects`
- `signed-other-teacher-course-cover-denied`
- `signed-other-teacher-course-cover-no-write-side-effects`
- `unauthenticated-class-create-denied`
- `unauthenticated-class-create-no-write-side-effects`
- `signed-student-class-create-denied`
- `signed-student-class-create-no-write-side-effects`
- `signed-other-teacher-class-create-denied`
- `signed-other-teacher-class-create-no-write-side-effects`
- `signed-teacher-cookie-required`
- `course-cover-asset-generated`
- `course-cover-asset-external-storage-returned`
- `course-cover-asset-readback-revision-returned`
- `course-cover-asset-readback-managed-database-adapter-returned`
- `course-cover-audit-auth-session-returned`
- `course-cover-asset-audit-external-readback-returned`
- `course-cover-asset-revision-retry-contract-returned`
- `signed-course-cover-trace-header-returned`
- `teacher-owned-course-created`
- `duplicate-course-create-denied`
- `duplicate-course-create-no-duplicate-side-effects`
- `course-create-external-snapshot-policy-returned`
- `course-create-audit-source-readback-returned`
- `course-create-auth-session-readback-returned`
- `created-course-used-cover-draft-scope`
- `created-course-bound-generated-cover-asset`
- `existing-course-cover-binding-readback-returned`
- `existing-course-cover-listed-readback-returned`
- `existing-course-cover-asset-audit-external-readback-returned`
- `existing-course-cover-binding-audit-source-returned`
- `external-ownership-merge-returned`
- `teacher-owned-class-created`
- `duplicate-class-create-denied`
- `duplicate-class-create-no-duplicate-side-effects`
- `class-create-external-snapshot-policy-returned`
- `class-create-audit-source-readback-returned`
- `class-create-auth-session-readback-returned`
- `created-course-and-class-readable-after-write`
- `signed-other-teacher-course-list-returned`
- `other-teacher-course-hidden`
- `other-teacher-class-hidden`
- `student-course-hidden-before-membership`
- `unauthenticated-invite-join-denied`
- `unauthenticated-invite-join-no-write-side-effects`
- `student-invite-join-persisted`
- `duplicate-student-invite-join-idempotent-returned`
- `duplicate-student-invite-join-no-duplicate-side-effects`
- `student-pending-course-hidden-before-approval`
- `student-pending-class-hidden-before-approval`
- `student-pending-membership-hidden-before-approval`
- `signed-student-pending-course-list-trace-header-returned`
- `student-invite-join-audit-source-returned`
- `student-invite-join-auth-session-returned`
- `student-invite-join-auth-session-readback-returned`
- `created-course-teaching-operation-accepted`
- `unauthenticated-membership-approval-denied`
- `unauthenticated-membership-approval-no-write-side-effects`
- `signed-student-membership-approval-denied`
- `signed-student-membership-approval-no-write-side-effects`
- `signed-other-teacher-membership-approval-denied`
- `signed-other-teacher-membership-approval-actor-resource-returned`
- `signed-other-teacher-membership-approval-no-write-side-effects`
- `teacher-membership-approval-persisted`
- `duplicate-membership-approval-idempotent-returned`
- `duplicate-membership-approval-no-duplicate-side-effects`
- `teacher-membership-approval-audit-source-returned`
- `teacher-membership-approval-auth-session-returned`
- `teacher-membership-approval-auth-session-readback-returned`
- `approved-course-visible-for-student`
- `approved-membership-readable-for-student`
- `unauthenticated-course-list-trace-header-returned`
- `unauthenticated-course-cover-trace-header-returned`
- `unauthenticated-course-create-trace-header-returned`
- `signed-student-course-create-trace-header-returned`
- `signed-student-course-cover-trace-header-returned`
- `signed-other-teacher-course-cover-trace-header-returned`
- `unauthenticated-class-create-trace-header-returned`
- `signed-student-class-create-trace-header-returned`
- `signed-other-teacher-class-create-trace-header-returned`
- `signed-course-create-trace-header-returned`
- `signed-course-create-trace-body-returned`
- `signed-class-create-trace-header-returned`
- `signed-class-create-trace-body-returned`
- `signed-course-list-trace-header-returned`
- `signed-other-teacher-course-list-trace-header-returned`
- `signed-student-prejoin-course-list-trace-header-returned`
- `unauthenticated-invite-join-trace-header-returned`
- `signed-student-invite-join-trace-header-returned`
- `signed-student-invite-join-trace-body-returned`
- `unauthenticated-membership-approval-trace-header-returned`
- `signed-student-membership-approval-trace-header-returned`
- `signed-other-teacher-membership-approval-trace-header-returned`
- `signed-teacher-membership-approval-trace-header-returned`
- `signed-teacher-membership-approval-trace-body-returned`
- `signed-student-course-list-trace-header-returned`
- `response-values-redacted`
- `release-run-id-bound`
- `same-teacher-auth-provider-readiness-bound`
- `same-app-auth-provider-readiness-bound`
- `same-vercel-production-deployment-bound`
- `same-deployment-domain-reachability-bound`
- `same-external-storage-service-readiness-bound`

## Final Gate Command

After live evidence is produced, rerun the aggregate gate using the current evidence paths:

```sh
node -- scripts/production-e2e-release-gate.mjs \
  --teacher-workflow-ui coordination/reports/2026-06-28-teacher-workflow-ui-smoke-current.json \
  --deployed-teacher-workflow-ui coordination/reports/2026-06-28-teacher-workflow-deployment-smoke-production-live.json \
  --teacher-workflow-browser-ui coordination/reports/2026-06-28-teacher-workflow-browser-smoke-production-live.json \
  --teacher-workflow-live-generation coordination/reports/2026-06-28-teacher-workflow-live-generation-smoke-production-live.json \
  --learning-ppt-playback coordination/reports/2026-06-28-learning-ppt-playback-deployment-smoke-production-live.json \
  --vercel-project-readiness coordination/reports/2026-06-28-vercel-project-readiness.json \
  --vercel-env-sync coordination/reports/2026-06-28-vercel-env-sync-production-apply.json \
  --vercel-env-inventory coordination/reports/2026-06-28-vercel-env-inventory-production-observed.json \
  --app-auth-provider-readiness coordination/reports/2026-06-28-app-auth-provider-readiness-production-live.json \
  --trusted-teacher-auth-route-chain coordination/reports/2026-06-28-trusted-teacher-auth-route-chain-contract.json \
  --teacher-auth-provider-readiness coordination/reports/2026-06-28-teacher-auth-provider-readiness-production-live.json \
  --external-storage-production-launch-contract coordination/reports/2026-06-28-external-storage-production-launch-contract.json \
  --external-storage-container-build-readiness coordination/reports/2026-06-28-external-storage-container-build-readiness-approved-build-release-run-bound.json \
  --external-storage-service-readiness coordination/reports/2026-06-28-external-storage-service-readiness-production-live.json \
  --vercel-production-deployment coordination/reports/2026-06-28-vercel-production-deployment.json \
  --route-smoke coordination/reports/2026-06-28-route-smoke-production-live.json \
  --teaching-operations-route-smoke coordination/reports/2026-06-28-teaching-operations-route-smoke-production-live.json \
  --teaching-operation-detail-browser-smoke coordination/reports/2026-06-28-teaching-operation-detail-browser-smoke-production-live.json \
  --teaching-course-management-route-smoke coordination/reports/2026-06-28-teaching-course-management-route-smoke-production-live.json \
  --external-storage-smoke coordination/reports/2026-06-28-external-storage-smoke-production-live.json \
  --ppt-acceptance coordination/reports/2026-06-28-ppt-manual-playback-acceptance-production-live.json \
  --enterprise-live-evidence-audit coordination/reports/2026-06-28-enterprise-live-evidence-audit.json \
  --local-production-e2e-smoke coordination/reports/2026-06-30-local-production-e2e-smoke-enterprise-continuation.json \
  > coordination/reports/2026-06-28-production-e2e-release-gate.json
```

Acceptance condition:

- top-level `status` is `ready`;
- `blockedReasons` is empty;
- every requirement status is `satisfied`;
- `ordinaryTeachingEvidenceSummary.status` is `satisfied`;
- ordinary teaching evidence statuses are all `live-passed`;
- `localProductionPreflightSummary.status` may be `passed`, but `localProductionPreflightSummary.productionAcceptance` must remain `false`;
- release-run consistency reports `match: true`;
- enterprise audit `unexpectedEvidenceFiles` is empty;
- the output contains no secret values, cookies, private local paths, or raw response bodies.
