import type { TeachingOperationId } from "@/components/teaching/teaching-operation-data";
import type { LocalizedText } from "@/i18n/copy";
// Type-only, so the pure-type module stays free of runtime imports and no cycle
// is created with the postgres store (which imports this store's normalizer).
import type { TeachingOperationRepository } from "./teaching-operations-postgres-store";

// All shared domain types for the teaching-operations store (Phase 3
// decomposition). Extracted as a pure type module (no runtime code); the store
// re-exports these via `export type *`, so existing consumers and the extracted
// helper modules keep importing them from the store unchanged.

export type TeachingOperationActionSlot = "primary" | "secondary";

export type TeachingOperationIdempotencyStatus = "created" | "already-persisted";

export type TeachingOperationActionId =
  | "save-course-settings"
  | "preview-student-view"
  | "save-agent-plan"
  | "run-permission-preflight"
  | "sync-knowledge-index"
  | "add-resource-placeholder"
  | "publish-course-content"
  | "generate-unit-draft"
  | "save-admin-settings"
  | "send-collaboration-invite"
  | "sync-roster"
  | "generate-group-suggestions"
  | "create-export-manifest"
  | "validate-redaction-scope"
  | "refresh-dashboard"
  | "lock-daily-snapshot"
  | "refresh-quiz-board"
  | "flag-low-quality-items"
  | "save-review-queue"
  | "generate-ai-feedback"
  | "generate-invite-code"
  | "publish-invite-code";

export type TeachingOperationRedaction = {
  secrets: "omitted";
  localFiles: "omitted";
  assets: "ids-only";
};

export type TeachingOperationRecordStoragePolicy =
  | "local-json-teaching-operation-database"
  | "external-redacted-teaching-operation-append"
  | "external-redacted-teaching-operation-rollback";

export type TeachingOperationRecordStorageWritePolicy =
  | "atomic-json-file-replace"
  | "external-append-only-operation-log"
  | "external-append-only-rollback-log";

export type TeachingOperationAuditStoragePolicy =
  | "local-json-teaching-operation-audit-log"
  | "external-redacted-teaching-operation-audit-log";

export type TeachingOperationDomainObjectType =
  | "course-settings"
  | "student-preview-session"
  | "agent-plan"
  | "permission-preflight"
  | "dashboard-state"
  | "admin-settings"
  | "quiz-board-state"
  | "resource-review-item"
  | "unit-draft"
  | "group-suggestions"
  | "ai-feedback-draft"
  | "dashboard-snapshot"
  | "quiz-item-review"
  | "export-manifest"
  | "redaction-validation"
  | "student-roster"
  | "invite-code-draft"
  | "enrollment-access"
  | "knowledge-index"
  | "course-content"
  | "grading-queue"
  | "gradebook-update"
  | "email-notification"
  | "grade-release-notification"
  | "grade-release-rollback-notification"
  | "operation-rollback";

export type TeachingOperationArtifact =
  | {
      kind: "database-record";
      table: string;
      recordId: string;
    }
  | {
      kind: "student-preview";
      previewId: string;
      previewUrl: string;
    }
  | {
      kind: "preflight";
      status: "passed";
      checkedPermissions: string[];
    }
  | {
      kind: "export-file";
      manifestId: string;
      downloadUrl: string;
      contentType: "application/json";
    }
  | {
      kind: "outbox";
      outboxId: string;
      channel: "collaboration-invite";
      deliveryStatus: "sent-to-local-outbox";
    }
  | {
      kind: "invite-code";
      code: string;
      status: "generated" | "published";
      joinUrl: string;
    }
  | {
      kind: "dashboard-snapshot";
      snapshotId: string;
      status: "locked";
    }
  | {
      kind: "redaction-check";
      status: "passed";
      checkedScopes: string[];
    }
  | {
      kind: "generated-draft" | "group-suggestions" | "ai-feedback";
      artifactId: string;
      status: "ready-for-teacher-review";
    }
  | {
      kind: "domain-object";
      objectType: TeachingOperationDomainObjectType;
      objectId: string;
    };

export type TeachingOperationCourseSettingsProjection = {
  objectId: string;
  objectType: "course-settings";
  courseId: string;
  updatedBy: string;
  status: "saved";
  operationRecordId: string;
  sourceAction?: string;
  appliedFields?: TeachingOperationCourseSettingsAppliedField[];
  courseName?: string;
  instructor?: string;
  unit?: string;
  department?: string;
  semester?: string;
  description?: string;
  updatedAt: string;
  storagePolicy: "domain-projection-teaching-course-settings";
  redaction: TeachingOperationRedaction;
};

export type TeachingOperationCourseSettingsAppliedField =
  | "courseName"
  | "instructor"
  | "unit"
  | "department"
  | "semester"
  | "description";

export type TeachingOperationStudentPreviewSessionProjection = {
  objectId: string;
  objectType: "student-preview-session";
  courseId: string;
  previewedBy: string;
  previewStatus: "generated";
  operationRecordId: string;
  sourceAction?: string;
  previewId: string;
  previewUrl: string;
  previewScope: "teacher-course-preview";
  previewPolicy: "teacher-visible-preview-only";
  generatedAt: string;
  storagePolicy: "domain-projection-teaching-student-preview-session";
  redaction: TeachingOperationRedaction;
};

export type TeachingOperationAgentPlanProjection = {
  objectId: string;
  objectType: "agent-plan";
  courseId: string;
  savedBy: string;
  planStatus: "saved";
  operationRecordId: string;
  sourceAction?: string;
  enabledAgents: ["research-assistant", "math-coach", "writing-mentor"];
  governancePolicy: "teacher-reviewed-agent-plan";
  savedAt: string;
  storagePolicy: "domain-projection-teaching-agent-plan";
  redaction: TeachingOperationRedaction;
};

export type TeachingOperationPermissionPreflightProjection = {
  objectId: string;
  objectType: "permission-preflight";
  courseId: string;
  checkedBy: string;
  preflightStatus: "passed";
  operationRecordId: string;
  sourceAction?: string;
  checkedPermissions: ["course-bindings", "agent-roles", "student-access"];
  preflightPolicy: "teacher-agent-permission-gate";
  checkedAt: string;
  storagePolicy: "domain-projection-teaching-permission-preflight";
  redaction: TeachingOperationRedaction;
};

export type TeachingOperationDashboardStateProjection = {
  objectId: string;
  objectType: "dashboard-state";
  courseId: string;
  refreshedBy: string;
  refreshStatus: "refreshed";
  operationRecordId: string;
  sourceAction?: string;
  visibleMetrics: ["engagement", "progress", "assessment-quality"];
  refreshPolicy: "teacher-visible-course-dashboard";
  refreshedAt: string;
  storagePolicy: "domain-projection-teaching-dashboard-state";
  redaction: TeachingOperationRedaction;
};

export type TeachingOperationAdminSettingsProjection = {
  objectId: string;
  objectType: "admin-settings";
  courseId: string;
  savedBy: string;
  settingsStatus: "saved";
  operationRecordId: string;
  sourceAction?: string;
  adminScopes: ["course-collaborators", "permission-boundary", "audit-routing"];
  governancePolicy: "teacher-controlled-admin-settings";
  savedAt: string;
  storagePolicy: "domain-projection-teaching-admin-settings";
  redaction: TeachingOperationRedaction;
};

export type TeachingOperationQuizBoardStateProjection = {
  objectId: string;
  objectType: "quiz-board-state";
  courseId: string;
  refreshedBy: string;
  refreshStatus: "refreshed";
  operationRecordId: string;
  sourceAction?: string;
  visibleMetrics: ["completion-rate", "item-quality", "misconception-clusters"];
  reviewPolicy: "teacher-visible-quiz-quality-board";
  refreshedAt: string;
  storagePolicy: "domain-projection-teaching-quiz-board-state";
  redaction: TeachingOperationRedaction;
};

export type TeachingOperationResourceReviewItemProjection = {
  objectId: string;
  objectType: "resource-review-item";
  courseId: string;
  queuedBy: string;
  reviewStatus: "pending-teacher-review";
  operationRecordId: string;
  sourceAction?: string;
  resourceSource: "teacher-placeholder";
  reviewPolicy: "teacher-review-before-knowledge-index";
  queuedAt: string;
  storagePolicy: "domain-projection-teaching-resource-review-item";
  redaction: TeachingOperationRedaction;
};

export type TeachingOperationUnitDraftProjection = {
  objectId: string;
  objectType: "unit-draft";
  courseId: string;
  generatedBy: string;
  draftStatus: "ready-for-teacher-review";
  operationRecordId: string;
  sourceAction?: string;
  artifactId: string;
  reviewPolicy: "teacher-review-before-course-publish";
  generatedAt: string;
  storagePolicy: "domain-projection-teaching-unit-draft";
  redaction: TeachingOperationRedaction;
};

export type TeachingOperationGroupSuggestionsProjection = {
  objectId: string;
  objectType: "group-suggestions";
  courseId: string;
  generatedBy: string;
  suggestionStatus: "ready-for-teacher-review";
  operationRecordId: string;
  sourceAction?: string;
  artifactId: string;
  groupingBasis: ["participation", "progress", "collaboration-balance"];
  reviewPolicy: "teacher-review-before-group-assignment";
  generatedAt: string;
  storagePolicy: "domain-projection-teaching-group-suggestions";
  redaction: TeachingOperationRedaction;
};

export type TeachingOperationAiFeedbackDraftProjection = {
  objectId: string;
  objectType: "ai-feedback-draft";
  courseId: string;
  generatedBy: string;
  feedbackStatus: "ready-for-teacher-review";
  operationRecordId: string;
  sourceAction?: string;
  artifactId: string;
  feedbackScope: "grading-review-queue";
  reviewPolicy: "teacher-review-before-student-release";
  generatedAt: string;
  storagePolicy: "domain-projection-teaching-ai-feedback-draft";
  redaction: TeachingOperationRedaction;
};

export type TeachingOperationDashboardSnapshotProjection = {
  objectId: string;
  objectType: "dashboard-snapshot";
  courseId: string;
  lockedBy: string;
  snapshotStatus: "locked";
  operationRecordId: string;
  sourceAction?: string;
  snapshotId: string;
  snapshotScope: "daily-course-dashboard";
  retentionPolicy: "teacher-locked-dashboard-snapshot";
  lockedAt: string;
  storagePolicy: "domain-projection-teaching-dashboard-snapshot";
  redaction: TeachingOperationRedaction;
};

export type TeachingOperationQuizItemReviewProjection = {
  objectId: string;
  objectType: "quiz-item-review";
  courseId: string;
  flaggedBy: string;
  reviewStatus: "flagged-for-review";
  operationRecordId: string;
  sourceAction?: string;
  flaggedSignals: ["low-discrimination", "high-error-rate", "teacher-review-needed"];
  reviewPolicy: "teacher-review-before-quiz-reuse";
  flaggedAt: string;
  storagePolicy: "domain-projection-teaching-quiz-item-review";
  redaction: TeachingOperationRedaction;
};

export type TeachingOperationExportManifestProjection = {
  objectId: string;
  objectType: "export-manifest";
  courseId: string;
  createdBy: string;
  exportStatus: "generated";
  operationRecordId: string;
  sourceAction?: string;
  manifestId: string;
  datasetScopes: ["learning-records", "chat-threads", "grades", "activities"];
  exportPolicy: "redacted-teacher-export-manifest";
  createdAt: string;
  storagePolicy: "domain-projection-teaching-export-manifest";
  redaction: TeachingOperationRedaction;
};

export type TeachingOperationRedactionValidationProjection = {
  objectId: string;
  objectType: "redaction-validation";
  courseId: string;
  validatedBy: string;
  validationStatus: "passed";
  operationRecordId: string;
  sourceAction?: string;
  checkedScopes: ["student-private-notes", "credentials", "local-paths"];
  validationPolicy: "exclude-private-and-secret-fields";
  validatedAt: string;
  storagePolicy: "domain-projection-teaching-redaction-validation";
  redaction: TeachingOperationRedaction;
};

// "Sync roster" imports nothing. The handler behind it recounts the memberships
// this deployment already holds and restamps the class/course totals - which is
// what `TeachingStudentRosterSyncRecord` has said since it was corrected to
// `local-recount`. This projection was left claiming the opposite: `synced`, out
// of an `sis-roster` that is not consulted, plus a `pendingTeacherReviewCount`
// hardcoded to the literal 3 for every course in every deployment. The three
// fields are now either the record's own honest values or gone: the builder that
// produces this projection has no snapshot to count from, and a number nobody
// counted is worse than no number at all - the real count lives on the roster
// record and reaches the teacher through `studentRosterSyncReceipt`.
export type TeachingOperationStudentRosterProjection = {
  objectId: string;
  objectType: "student-roster";
  courseId: string;
  syncedBy: string;
  syncStatus: "local-recount";
  operationRecordId: string;
  sourceAction?: string;
  sourceSystems: ["local-class-memberships", "local-class-records"];
  syncedAt: string;
  storagePolicy: "domain-projection-teaching-student-roster";
  redaction: TeachingOperationRedaction;
};

export type TeachingOperationInviteCodeDraftProjection = {
  objectId: string;
  objectType: "invite-code-draft";
  courseId: string;
  inviteCode: string;
  joinUrl: string;
  generatedBy: string;
  draftStatus: "generated";
  operationRecordId: string;
  sourceAction?: string;
  invitePolicy: "teacher-review-before-publication";
  generatedAt: string;
  storagePolicy: "domain-projection-teaching-invite-code-draft";
  redaction: TeachingOperationRedaction;
};

export type TeachingOperationEnrollmentAccessProjection = {
  objectId: string;
  objectType: "enrollment-access";
  courseId: string;
  inviteCode: string;
  joinUrl: string;
  publishedBy: string;
  publicationStatus: "published";
  operationRecordId: string;
  sourceAction?: string;
  enrollmentPolicy: "teacher-confirmed-course-scope";
  publishedAt: string;
  storagePolicy: "domain-projection-teaching-enrollment-access";
  redaction: TeachingOperationRedaction;
};

export type TeachingOperationKnowledgeIndexProjection = {
  objectId: string;
  objectType: "knowledge-index";
  courseId: string;
  syncedBy: string;
  syncStatus: "synced";
  operationRecordId: string;
  sourceAction?: string;
  sourceSystems: ["course-files", "teacher-resources", "agent-grounding-index"];
  syncedAt: string;
  storagePolicy: "domain-projection-teaching-knowledge-index";
  redaction: TeachingOperationRedaction;
};

export type TeachingOperationCourseContentProjection = {
  objectId: string;
  objectType: "course-content";
  courseId: string;
  publishedBy: string;
  publicationStatus: "published";
  operationRecordId: string;
  sourceAction?: string;
  releaseScope: "course-visible-content";
  publishedAt: string;
  storagePolicy: "domain-projection-teaching-course-content";
  redaction: TeachingOperationRedaction;
};

export type TeachingOperationGradingQueueProjection = {
  objectId: string;
  objectType: "grading-queue";
  courseId: string;
  savedBy: string;
  queueStatus: "saved";
  operationRecordId: string;
  sourceAction?: string;
  reviewPolicy: "teacher-review-before-release";
  savedAt: string;
  storagePolicy: "domain-projection-teaching-grading-queue";
  redaction: TeachingOperationRedaction;
};

export type TeachingOperationGradebookUpdateProjection = {
  objectId: string;
  objectType: "gradebook-update";
  courseId: string;
  updatedBy: string;
  updateStatus: "pending-release" | "released" | "release-rolled-back";
  operationRecordId: string;
  sourceAction?: string;
  releasePolicy: "teacher-confirmed-grade-release";
  updatedAt: string;
  releasedBy?: string;
  releasedAt?: string;
  providerStatus?: "gradebook-provider-released";
  providerReleaseId?: string;
  providerReleasedAt?: string;
  releaseRolledBackBy?: string;
  releaseRolledBackAt?: string;
  providerRollbackStatus?: "gradebook-provider-release-rolled-back";
  providerRollbackId?: string;
  providerRolledBackAt?: string;
  storagePolicy: "domain-projection-teaching-gradebook-update";
  redaction: TeachingOperationRedaction;
};

export type TeachingOperationEmailNotificationProjection = {
  objectId: string;
  objectType: "email-notification";
  courseId: string;
  queuedBy: string;
  notificationStatus: "queued";
  deliveryChannel: "collaboration-invite-email";
  outboxId: string;
  operationRecordId: string;
  sourceAction?: string;
  deliveryPolicy: "server-outbox-before-smtp-provider";
  queuedAt: string;
  storagePolicy: "domain-projection-teaching-email-notification";
  redaction: TeachingOperationRedaction;
};

export type TeachingOperationGradeReleaseNotificationProjection = {
  objectId: string;
  objectType: "grade-release-notification";
  courseId: string;
  gradebookUpdateId: string;
  queuedBy: string;
  notificationStatus: "queued";
  deliveryChannel: "student-grade-release-notification";
  operationRecordId: string;
  sourceAction?: string;
  deliveryPolicy: "teacher-confirmed-grade-release-before-student-notification";
  queuedAt: string;
  storagePolicy: "domain-projection-teaching-grade-release-notification";
  redaction: TeachingOperationRedaction;
};

export type TeachingOperationGradeReleaseRollbackNotificationProjection = {
  objectId: string;
  objectType: "grade-release-rollback-notification";
  courseId: string;
  gradebookUpdateId: string;
  queuedBy: string;
  notificationStatus: "queued";
  deliveryChannel: "student-grade-release-rollback-notification";
  operationRecordId: string;
  sourceAction?: string;
  deliveryPolicy: "teacher-confirmed-grade-release-rollback-before-student-notification";
  queuedAt: string;
  storagePolicy: "domain-projection-teaching-grade-release-rollback-notification";
  redaction: TeachingOperationRedaction;
};

export type TeachingOperationRollbackProjection = {
  objectId: string;
  objectType: "operation-rollback";
  courseId: string;
  targetRecordId: string;
  targetOperationId: TeachingOperationId;
  targetActionSlot: TeachingOperationActionSlot;
  targetActionId: TeachingOperationActionId;
  rollbackStatus: "rolled-back";
  rollbackReason: string;
  rolledBackBy: string;
  rolledBackAt: string;
  storagePolicy: "domain-projection-teaching-operation-rollback";
  redaction: TeachingOperationRedaction;
};

export type TeachingOperationDomainProjection =
  | TeachingOperationCourseSettingsProjection
  | TeachingOperationStudentPreviewSessionProjection
  | TeachingOperationAgentPlanProjection
  | TeachingOperationPermissionPreflightProjection
  | TeachingOperationDashboardStateProjection
  | TeachingOperationAdminSettingsProjection
  | TeachingOperationQuizBoardStateProjection
  | TeachingOperationResourceReviewItemProjection
  | TeachingOperationUnitDraftProjection
  | TeachingOperationGroupSuggestionsProjection
  | TeachingOperationAiFeedbackDraftProjection
  | TeachingOperationDashboardSnapshotProjection
  | TeachingOperationQuizItemReviewProjection
  | TeachingOperationExportManifestProjection
  | TeachingOperationRedactionValidationProjection
  | TeachingOperationStudentRosterProjection
  | TeachingOperationInviteCodeDraftProjection
  | TeachingOperationEnrollmentAccessProjection
  | TeachingOperationKnowledgeIndexProjection
  | TeachingOperationCourseContentProjection
  | TeachingOperationGradingQueueProjection
  | TeachingOperationGradebookUpdateProjection
  | TeachingOperationEmailNotificationProjection
  | TeachingOperationGradeReleaseNotificationProjection
  | TeachingOperationGradeReleaseRollbackNotificationProjection
  | TeachingOperationRollbackProjection;

export type TeachingOperationRecord = {
  recordId: string;
  operationId: TeachingOperationId;
  actionSlot: TeachingOperationActionSlot;
  actionId: TeachingOperationActionId;
  actorId: string;
  courseId?: string;
  sourceAction?: string;
  idempotencyKey?: string;
  createdAt: string;
  status: "persisted";
  appendSequence?: number;
  storagePolicy: TeachingOperationRecordStoragePolicy;
  redaction: TeachingOperationRedaction;
  artifacts: TeachingOperationArtifact[];
  domainProjections?: TeachingOperationDomainProjection[];
};

export type TeachingOperationAuditRequestSource = {
  userAgent: string;
  ipAddress: "redacted";
  originClass?: "remote-https" | "local-loopback" | "non-https" | "unknown";
  refererPath?: string;
};

export type TeachingOperationAuditAuthSession = {
  sessionId: string;
  authenticatedAt: string;
  expiresAt: string;
};

export type TeachingOperationPersistedAuditEvent = {
  auditId: string;
  traceId: string;
  eventType: "teaching-operation.persisted";
  actorId: string;
  actorRole: "teacher";
  authMode: "signed-teacher-session";
  authSession?: TeachingOperationAuditAuthSession;
  operationId: TeachingOperationId;
  actionSlot: TeachingOperationActionSlot;
  actionId: TeachingOperationActionId;
  courseId?: string;
  sourceAction?: string;
  requestSource: TeachingOperationAuditRequestSource;
  createdAt: string;
  redaction: TeachingOperationRedaction;
};

export type TeachingGradebookReleaseAuditEvent = {
  auditId: string;
  traceId: string;
  eventType:
    | "teaching-gradebook-update.released"
    | "teaching-gradebook-update.release-rolled-back";
  actorId: string;
  actorRole: "teacher";
  authMode: "signed-teacher-session";
  authSession?: TeachingOperationAuditAuthSession;
  courseId: string;
  gradebookUpdateId: string;
  requestSource: TeachingOperationAuditRequestSource;
  createdAt: string;
  redaction: TeachingOperationRedaction;
};

export type TeachingOperationBackupRestoreAuditEvent = {
  auditId: string;
  traceId: string;
  eventType: "teaching-operations-backup.restored";
  actorId: string;
  actorRole: "teacher";
  authMode: "signed-teacher-session";
  authSession?: TeachingOperationAuditAuthSession;
  backupId: string;
  impactedCourseIds: string[];
  requestSource: TeachingOperationAuditRequestSource;
  createdAt: string;
  redaction: TeachingOperationRedaction;
};

export type TeachingOperationRollbackAuditEvent = {
  auditId: string;
  traceId: string;
  eventType: "teaching-operation.rolled-back";
  actorId: string;
  actorRole: "teacher";
  authMode: "signed-teacher-session";
  authSession?: TeachingOperationAuditAuthSession;
  courseId: string;
  targetRecordId: string;
  operationId: TeachingOperationId;
  actionSlot: TeachingOperationActionSlot;
  actionId: TeachingOperationActionId;
  rollbackReason: string;
  requestSource: TeachingOperationAuditRequestSource;
  createdAt: string;
  redaction: TeachingOperationRedaction;
};

export type TeachingOperationAuditEvent =
  | TeachingOperationPersistedAuditEvent
  | TeachingGradebookReleaseAuditEvent
  | TeachingOperationBackupRestoreAuditEvent
  | TeachingOperationRollbackAuditEvent;

export type TeachingOperationReceiptAudit = {
  auditId: string;
  traceId: string;
  eventType: "teaching-operation.persisted";
  actor: {
    actorId: string;
    role: "teacher";
  };
  authMode: "signed-teacher-session";
  authSession?: TeachingOperationAuditAuthSession;
  requestSource: TeachingOperationAuditRequestSource;
  storagePolicy: TeachingOperationAuditStoragePolicy;
  redaction: TeachingOperationRedaction;
};

export type TeachingOperationExternalAppendReceipt = {
  teacherId: string;
  receiptId: string;
  status: "persisted";
  idempotencyStatus?: TeachingOperationIdempotencyStatus;
  appendSequence?: number;
  productionDatabaseAdapter?: TeachingOperationProductionDatabaseAdapterEvidence;
  storagePolicy: "external-redacted-teaching-operation-append";
  storageWritePolicy: "external-append-only-operation-log";
  responsibleSession: "S12";
  redaction: TeachingOperationRedaction;
};

export type TeachingOperationProductionDatabaseAdapterEvidence = {
  status: "ready";
  providerClass: "managed-database";
  migrationStatus: "up-to-date";
  backupPolicy: "point-in-time-restore";
  concurrencyControl: "transactional";
  valueRedacted: true;
};

export type TeachingOperationExternalRollbackReceipt = {
  teacherId: string;
  rollbackId: string;
  targetRecordId: string;
  courseId: string;
  status: "persisted";
  productionDatabaseAdapter?: TeachingOperationProductionDatabaseAdapterEvidence;
  storagePolicy: "external-redacted-teaching-operation-rollback";
  storageWritePolicy: "external-append-only-rollback-log";
  responsibleSession: "S12";
  redaction: TeachingOperationRedaction;
};

export type TeachingGradebookReleaseReceipt = {
  receiptId: string;
  action: "release-gradebook-update";
  actorId: string;
  courseId: string;
  gradebookUpdateId: string;
  traceId: string;
  status: "persisted";
  providerStatus?: "gradebook-provider-released";
  providerReleaseId?: string;
  providerReleasedAt?: string;
  storagePolicy:
    | "local-json-teaching-operation-database"
    | "external-redacted-teaching-operation-append";
  storageWritePolicy: "atomic-json-file-replace" | "external-append-only-operation-log";
  responsibleSession: "S12";
  createdAt: string;
  redaction: TeachingOperationRedaction;
};

export type TeachingGradebookReleaseProviderReceipt = {
  providerStatus: "gradebook-provider-released";
  providerReleaseId: string;
  providerReleasedAt: string;
};

export type TeachingGradebookReleaseRollbackProviderReceipt = {
  providerRollbackStatus: "gradebook-provider-release-rolled-back";
  providerRollbackId: string;
  providerRolledBackAt: string;
};

export type TeachingGradebookReleaseRollbackReceipt = {
  receiptId: string;
  action: "rollback-gradebook-release";
  actorId: string;
  courseId: string;
  gradebookUpdateId: string;
  traceId: string;
  status: "persisted";
  providerRollbackStatus?: "gradebook-provider-release-rolled-back";
  providerRollbackId?: string;
  providerRolledBackAt?: string;
  storagePolicy:
    | "local-json-teaching-operation-database"
    | "external-redacted-teaching-operation-append";
  storageWritePolicy: "atomic-json-file-replace" | "external-append-only-operation-log";
  responsibleSession: "S12";
  createdAt: string;
  redaction: TeachingOperationRedaction;
};

export type TeachingOperationBackupRestoreReceipt = {
  receiptId: string;
  action: "restore-teaching-operations-backup";
  backupId: string;
  actorId: string;
  impactedCourseIds: string[];
  traceId: string;
  status: "persisted";
  storagePolicy: "local-json-teaching-operation-database";
  storageWritePolicy: "atomic-json-file-replace";
  responsibleSession: "S12";
  createdAt: string;
  redaction: TeachingOperationRedaction;
};

export type TeachingOperationRollbackReceipt = {
  receiptId: string;
  action: "rollback-teaching-operation-record";
  actorId: string;
  courseId: string;
  targetRecordId: string;
  traceId: string;
  rollbackReason: string;
  status: "persisted";
  storagePolicy:
    | "local-json-teaching-operation-database"
    | "external-redacted-teaching-operation-rollback";
  storageWritePolicy: "atomic-json-file-replace" | "external-append-only-rollback-log";
  externalRollback?: TeachingOperationExternalRollbackReceipt;
  responsibleSession: "S12";
  createdAt: string;
  redaction: TeachingOperationRedaction;
};

export type TeachingOperationInviteCodeRecord = {
  inviteId: string;
  operationId: "invite-code";
  code: string;
  status: "generated" | "published";
  courseId?: string;
  actorId: string;
  createdAt: string;
};

export type TeachingOperationOutboxRecord = {
  outboxId: string;
  operationId: "admins";
  channel: "collaboration-invite";
  deliveryStatus: "sent-to-local-outbox";
  courseId?: string;
  actorId: string;
  createdAt: string;
};

export type TeachingOperationExportManifest = {
  manifestId: string;
  operationId: "data-export";
  courseId?: string;
  actorId: string;
  createdAt: string;
  datasets: string[];
  formats: string[];
  redactionScope: {
    studentPrivateNotes: "excluded";
    credentials: "excluded";
    localPaths: "excluded";
  };
  redaction: TeachingOperationRedaction;
};

export type TeachingOperationDatabase = {
  schemaVersion: "uais-teaching-operations-v1";
  updatedAt: string;
  records: TeachingOperationRecord[];
  auditEvents: TeachingOperationAuditEvent[];
  domainProjections: TeachingOperationDomainProjection[];
  inviteCodes: TeachingOperationInviteCodeRecord[];
  outbox: TeachingOperationOutboxRecord[];
  exportManifests: TeachingOperationExportManifest[];
};

export type TeachingOperationDatabaseBackup = {
  schemaVersion: "uais-teaching-operations-backup-v1";
  createdAt: string;
  sourceFile: "teaching-operations.json";
  reason: "before-atomic-replace";
  responsibleSession: "S12";
  redaction: TeachingOperationRedaction;
  database: TeachingOperationDatabase;
};

export type TeachingOperationReceipt = {
  receiptId: string;
  operationId: TeachingOperationId;
  actionSlot: TeachingOperationActionSlot;
  actionId: TeachingOperationActionId;
  actorId: string;
  courseId?: string;
  sourceAction?: string;
  idempotencyKey?: string;
  idempotencyStatus?: TeachingOperationIdempotencyStatus;
  status: "persisted";
  displayMessage: LocalizedText;
  artifacts: TeachingOperationArtifact[];
  storagePolicy: TeachingOperationRecordStoragePolicy;
  storageWritePolicy: TeachingOperationRecordStorageWritePolicy;
  externalAppend?: TeachingOperationExternalAppendReceipt;
  responsibleSession: "S12";
  createdAt: string;
  audit?: TeachingOperationReceiptAudit;
  redaction: TeachingOperationRedaction;
};

export type TeachingOperationActionDefinition = {
  actionId: TeachingOperationActionId;
  displayMessage: LocalizedText;
  table: string;
};

export type ExecuteTeachingOperationActionInput = {
  dataDir?: string;
  env?: Record<string, string | undefined>;
  // The same managed-snapshot injection seam the rollback and gradebook flows
  // take, so the guarded write below can be exercised against a repository that
  // loses the race on purpose. Unset - which is every route - resolution is
  // exactly the env switch it always was.
  repository?: TeachingOperationRepository;
  operationId: string;
  actionSlot: TeachingOperationActionSlot;
  actorId?: string;
  courseId?: string;
  sourceAction?: string;
  idempotencyKey?: string;
  courseSettingsPatch?: unknown;
  audit?: {
    traceId: string;
    actorRole: "teacher";
    authMode: "signed-teacher-session";
    authSession?: TeachingOperationAuditAuthSession;
    requestSource: TeachingOperationAuditRequestSource;
  };
  appendExternalTeachingOperation?: TeachingOperationExternalAppendAdapter;
  now?: Date;
};

export type ValidatedExecuteTeachingOperationActionInput = Omit<
  ExecuteTeachingOperationActionInput,
  "operationId"
> & {
  operationId: TeachingOperationId;
};

export type TeachingGradebookReleaseAuditInput = {
  traceId: string;
  actorRole: "teacher";
  authMode: "signed-teacher-session";
  authSession?: TeachingOperationAuditAuthSession;
  requestSource: TeachingOperationAuditRequestSource;
};

export type TeachingOperationExternalAppendAdapter = (input: {
  record: TeachingOperationRecord;
  auditEvent?: TeachingOperationAuditEvent;
}) => Promise<TeachingOperationExternalAppendReceipt>;

export type TeachingOperationExternalRollbackAdapter = (input: {
  teacherId: string;
  targetRecordId: string;
  courseId: string;
  rollbackReason: string;
  traceId: string;
  requestedAt: string;
  requestSource: TeachingOperationAuditRequestSource;
}) => Promise<TeachingOperationExternalRollbackReceipt>;

export type TeachingOperationExternalAuditReadback = {
  teacherId: string;
  records: TeachingOperationRecord[];
  auditEvents: TeachingOperationAuditEvent[];
  domainProjections: TeachingOperationDomainProjection[];
};

export type TeachingOperationExternalAuditReadAdapter = (input: {
  teacherId: string;
}) => Promise<TeachingOperationExternalAuditReadback>;

export type ReadTeachingOperationDatabaseInput = {
  dataDir?: string;
};

export type ReadTeachingOperationExportInput = {
  dataDir?: string;
  manifestId: string;
};
