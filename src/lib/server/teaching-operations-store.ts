import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  isTeachingOperationId,
  type TeachingOperationId,
} from "@/components/teaching/teaching-operation-data";
import type { LocalizedText } from "@/i18n/copy";
import {
  createUaisExternalStorageConfig,
  isExternalStorageBackendReadyContract,
  isLocalJsonFileStorageBackendContract,
  resolveUaisStorageBackendContract,
} from "@/lib/ai/storage-backend-contract";
import { resolveTeachingOperationDataDir } from "./teaching-operation-data-dir";

// Re-exported so existing consumers importing from this store keep working after
// the helper was extracted to its own module (Phase 3 decomposition).
export { resolveTeachingOperationDataDir };

export type TeachingOperationActionSlot = "primary" | "secondary";

type TeachingOperationIdempotencyStatus = "created" | "already-persisted";

type TeachingOperationActionId =
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

type TeachingOperationRedaction = {
  secrets: "omitted";
  localFiles: "omitted";
  assets: "ids-only";
};

type TeachingOperationRecordStoragePolicy =
  | "local-json-teaching-operation-database"
  | "external-redacted-teaching-operation-append"
  | "external-redacted-teaching-operation-rollback";

type TeachingOperationRecordStorageWritePolicy =
  | "atomic-json-file-replace"
  | "external-append-only-operation-log"
  | "external-append-only-rollback-log";

type TeachingOperationAuditStoragePolicy =
  | "local-json-teaching-operation-audit-log"
  | "external-redacted-teaching-operation-audit-log";

type TeachingOperationDomainObjectType =
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

export type TeachingOperationStudentRosterProjection = {
  objectId: string;
  objectType: "student-roster";
  courseId: string;
  syncedBy: string;
  syncStatus: "synced";
  operationRecordId: string;
  sourceAction?: string;
  sourceSystems: ["sis-roster", "invite-code-joins", "withdrawals"];
  pendingTeacherReviewCount: 3;
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

type TeachingOperationActionDefinition = {
  actionId: TeachingOperationActionId;
  displayMessage: LocalizedText;
  table: string;
};

type ExecuteTeachingOperationActionInput = {
  dataDir?: string;
  env?: Record<string, string | undefined>;
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

type ValidatedExecuteTeachingOperationActionInput = Omit<
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

type ReadTeachingOperationDatabaseInput = {
  dataDir?: string;
};

type ReadTeachingOperationExportInput = {
  dataDir?: string;
  manifestId: string;
};

const firstInviteCode = "55395057";
const maxSafeIdLength = 120;
const localTeachingOperationWriteQueues = new Map<string, Promise<void>>();

const actionDefinitions: Record<
  TeachingOperationId,
  Record<TeachingOperationActionSlot, TeachingOperationActionDefinition>
> = {
  "course-settings": {
    primary: action(
      "save-course-settings",
      "课程设置已由服务端持久化。",
      "Course settings persisted by the server.",
      "course_settings",
    ),
    secondary: action(
      "preview-student-view",
      "学生端预览已由服务端生成。",
      "Student preview generated by the server.",
      "student_previews",
    ),
  },
  agents: {
    primary: action(
      "save-agent-plan",
      "智能体方案已写入服务端。",
      "Agent plan saved by the server.",
      "agent_plans",
    ),
    secondary: action(
      "run-permission-preflight",
      "权限预检已由后端完成。",
      "Permission preflight completed by the backend.",
      "permission_preflights",
    ),
  },
  "knowledge-base": {
    primary: action(
      "sync-knowledge-index",
      "知识库索引已同步到服务端。",
      "Knowledge index synced to the server.",
      "knowledge_indexes",
    ),
    secondary: action(
      "add-resource-placeholder",
      "资料占位已写入审核队列。",
      "Resource placeholder written to the review queue.",
      "resource_placeholders",
    ),
  },
  content: {
    primary: action(
      "publish-course-content",
      "课程内容发布记录已保存。",
      "Course content publish record saved.",
      "course_content",
    ),
    secondary: action(
      "generate-unit-draft",
      "单元草稿已由后端生成。",
      "Unit draft generated by the backend.",
      "unit_drafts",
    ),
  },
  admins: {
    primary: action(
      "save-admin-settings",
      "管理员设置已保存并写入审计记录。",
      "Admin settings saved with an audit record.",
      "admin_settings",
    ),
    secondary: action(
      "send-collaboration-invite",
      "协作邀请已写入服务端发件队列。",
      "Collaboration invite written to the server outbox.",
      "collaboration_invites",
    ),
  },
  students: {
    primary: action(
      "sync-roster",
      "学生名单已同步到服务端。",
      "Roster synced to the server.",
      "student_rosters",
    ),
    secondary: action(
      "generate-group-suggestions",
      "分组建议已保存等待教师确认。",
      "Group suggestions saved for teacher confirmation.",
      "group_suggestions",
    ),
  },
  "data-export": {
    primary: action(
      "create-export-manifest",
      "导出清单文件已由服务端生成。",
      "Export manifest file generated by the server.",
      "export_manifests",
    ),
    secondary: action(
      "validate-redaction-scope",
      "脱敏范围已由后端校验通过。",
      "Redaction scope validated by the backend.",
      "redaction_checks",
    ),
  },
  dashboard: {
    primary: action(
      "refresh-dashboard",
      "数据看板已从后端刷新。",
      "Dashboard refreshed from the backend.",
      "dashboard_refreshes",
    ),
    secondary: action(
      "lock-daily-snapshot",
      "日报快照已锁定到服务端。",
      "Daily snapshot locked to the server.",
      "dashboard_snapshots",
    ),
  },
  "quiz-board": {
    primary: action(
      "refresh-quiz-board",
      "测验看板已从后端刷新。",
      "Quiz board refreshed from the backend.",
      "quiz_board_refreshes",
    ),
    secondary: action(
      "flag-low-quality-items",
      "低质题复核标记已保存。",
      "Low-quality item review flag saved.",
      "quiz_item_reviews",
    ),
  },
  grading: {
    primary: action(
      "save-review-queue",
      "批改队列已保存到服务端。",
      "Review queue saved to the server.",
      "grading_queues",
    ),
    secondary: action(
      "generate-ai-feedback",
      "AI 反馈建议已由后端生成。",
      "AI feedback suggestions generated by the backend.",
      "ai_feedback_suggestions",
    ),
  },
  "invite-code": {
    primary: action(
      "generate-invite-code",
      "邀请码已生成并保存，等待教师发布。",
      "Invite code generated and saved for teacher publishing.",
      "invite_codes",
    ),
    secondary: action(
      "publish-invite-code",
      "邀请码已发布到班级加入入口。",
      "Invite code published to the class join entry.",
      "invite_code_publications",
    ),
  },
};

export class TeachingOperationStoreError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "TeachingOperationStoreError";
    this.status = status;
  }
}

export async function executeTeachingOperationAction(
  input: ExecuteTeachingOperationActionInput,
): Promise<TeachingOperationReceipt> {
  if (!isTeachingOperationId(input.operationId)) {
    throw new TeachingOperationStoreError(400, "Unsupported teaching operation.");
  }
  if (input.actionSlot !== "primary" && input.actionSlot !== "secondary") {
    throw new TeachingOperationStoreError(400, "Unsupported teaching operation action.");
  }

  const operationId = input.operationId;
  const dataDir = resolveTeachingOperationDataDir(input.dataDir);
  const usingExternalPersistence = Boolean(input.appendExternalTeachingOperation);
  if (
    isTeachingOperationProductionRuntime(input.env ?? process.env) &&
    !usingExternalPersistence
  ) {
    throw new TeachingOperationStoreError(
      503,
      "Production teaching operation persistence requires external storage.",
    );
  }
  const validatedInput: ValidatedExecuteTeachingOperationActionInput = {
    ...input,
    operationId,
  };

  if (!usingExternalPersistence) {
    return runWithTeachingOperationLocalWriteLock(dataDir, () =>
      executeValidatedTeachingOperationAction({
        input: validatedInput,
        dataDir,
        usingExternalPersistence,
      }),
    );
  }

  return executeValidatedTeachingOperationAction({
    input: validatedInput,
    dataDir,
    usingExternalPersistence,
  });
}

async function executeValidatedTeachingOperationAction(input: {
  input: ValidatedExecuteTeachingOperationActionInput;
  dataDir: string;
  usingExternalPersistence: boolean;
}): Promise<TeachingOperationReceipt> {
  const { dataDir, usingExternalPersistence } = input;
  const database = usingExternalPersistence
    ? createEmptyDatabase()
    : await loadTeachingOperationDatabase({ dataDir });
  const now = input.input.now ?? new Date();
  const createdAt = now.toISOString();
  if (!input.input.actorId) {
    throw new TeachingOperationStoreError(
      401,
      "Signed teacher actor identity is required.",
    );
  }
  const actorId = requireSafeId(input.input.actorId, "actor id");
  const courseId = input.input.courseId
    ? requireSafeId(input.input.courseId, "course id")
    : undefined;
  const sourceAction = input.input.sourceAction
    ? requireSafeId(input.input.sourceAction, "source action")
    : undefined;
  const idempotencyKey = input.input.idempotencyKey
    ? requireSafeId(input.input.idempotencyKey, "idempotency key")
    : undefined;
  const definition = actionDefinitions[input.input.operationId][input.input.actionSlot];
  const storagePolicy: TeachingOperationRecordStoragePolicy =
    input.input.appendExternalTeachingOperation
      ? "external-redacted-teaching-operation-append"
      : "local-json-teaching-operation-database";
  const storageWritePolicy: TeachingOperationRecordStorageWritePolicy =
    input.input.appendExternalTeachingOperation
      ? "external-append-only-operation-log"
      : "atomic-json-file-replace";
  const auditStoragePolicy: TeachingOperationAuditStoragePolicy =
    input.input.appendExternalTeachingOperation
      ? "external-redacted-teaching-operation-audit-log"
      : "local-json-teaching-operation-audit-log";

  if (idempotencyKey) {
    const existingRecord = database.records.find(
      (record) => record.actorId === actorId && record.idempotencyKey === idempotencyKey,
    );
    if (existingRecord) {
      if (
        !isMatchingIdempotentTeachingOperationRecord(existingRecord, {
          operationId: input.input.operationId,
          actionSlot: input.input.actionSlot,
          courseId,
          sourceAction,
        })
      ) {
        throw new TeachingOperationStoreError(
          409,
          "Teaching operation idempotency key already exists.",
        );
      }

      return createTeachingOperationReceiptFromRecord({
        record: existingRecord,
        definition,
        storagePolicy,
        storageWritePolicy,
        auditStoragePolicy,
        auditEvent: findPersistedAuditEventForRecord(database.auditEvents, existingRecord),
        idempotencyStatus: "already-persisted",
      });
    }
  }

  const recordId = idempotencyKey
    ? createIdempotentRecordId(actorId, idempotencyKey)
    : createRecordId(input.input.operationId, definition.actionId, now);
  const artifacts = await createArtifacts({
    dataDir,
    database,
    writeLocalFiles: !usingExternalPersistence,
    operationId: input.input.operationId,
    actionSlot: input.input.actionSlot,
    actionId: definition.actionId,
    actorId,
    courseId,
    recordId,
    table: definition.table,
    now,
    createdAt,
  });
  const domainProjections = createDomainProjections({
    operationId: input.input.operationId,
    actionSlot: input.input.actionSlot,
    actionId: definition.actionId,
    actorId,
    courseId,
    sourceAction,
    courseSettingsPatch: input.input.courseSettingsPatch,
    recordId,
    createdAt,
    artifacts,
  });
  const artifactsWithDomainObjects = [
    ...artifacts,
    ...domainProjections.map(createDomainProjectionArtifact),
  ];
  const record: TeachingOperationRecord = {
    recordId,
    operationId: input.input.operationId,
    actionSlot: input.input.actionSlot,
    actionId: definition.actionId,
    actorId,
    ...(courseId ? { courseId } : {}),
    ...(sourceAction ? { sourceAction } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    createdAt,
    status: "persisted",
    storagePolicy: "local-json-teaching-operation-database",
    redaction: createRedaction(),
    artifacts: artifactsWithDomainObjects,
    ...(domainProjections.length > 0 ? { domainProjections } : {}),
  };
  const auditEvent = input.input.audit
    ? createAuditEvent({
        audit: input.input.audit,
        operationId: input.input.operationId,
        actionSlot: input.input.actionSlot,
        actionId: definition.actionId,
        actorId,
        courseId,
        sourceAction,
        createdAt,
        now,
      })
    : undefined;

  database.records.push(record);
  if (auditEvent) {
    database.auditEvents.push(auditEvent);
  }
  database.domainProjections.push(...domainProjections);
  database.updatedAt = createdAt;

  const externalAppend = input.input.appendExternalTeachingOperation
    ? normalizeExternalAppendReceipt(
        await input.input.appendExternalTeachingOperation({
          record: {
            ...record,
            storagePolicy,
          },
          auditEvent,
        }),
        {
          expectedTeacherId: actorId,
          expectedReceiptId: recordId,
        },
      )
    : undefined;

  if (!input.input.appendExternalTeachingOperation) {
    await persistTeachingOperationDatabase({ dataDir, database });
  }

  return createTeachingOperationReceiptFromRecord({
    record,
    definition,
    storagePolicy,
    storageWritePolicy,
    auditStoragePolicy,
    externalAppend,
    auditEvent,
    idempotencyStatus: externalAppend?.idempotencyStatus ?? (
      idempotencyKey ? "created" : undefined
    ),
  });
}

function createTeachingOperationReceiptFromRecord(input: {
  record: TeachingOperationRecord;
  definition: TeachingOperationActionDefinition;
  storagePolicy: TeachingOperationRecordStoragePolicy;
  storageWritePolicy: TeachingOperationRecordStorageWritePolicy;
  auditStoragePolicy: TeachingOperationAuditStoragePolicy;
  externalAppend?: TeachingOperationExternalAppendReceipt;
  auditEvent?: TeachingOperationPersistedAuditEvent;
  idempotencyStatus?: TeachingOperationIdempotencyStatus;
}): TeachingOperationReceipt {
  return {
    receiptId: input.record.recordId,
    operationId: input.record.operationId,
    actionSlot: input.record.actionSlot,
    actionId: input.record.actionId,
    actorId: input.record.actorId,
    ...(input.record.courseId ? { courseId: input.record.courseId } : {}),
    ...(input.record.sourceAction ? { sourceAction: input.record.sourceAction } : {}),
    ...(input.record.idempotencyKey ? { idempotencyKey: input.record.idempotencyKey } : {}),
    ...(input.idempotencyStatus ? { idempotencyStatus: input.idempotencyStatus } : {}),
    status: "persisted",
    displayMessage: input.definition.displayMessage,
    artifacts: input.record.artifacts,
    storagePolicy: input.storagePolicy,
    storageWritePolicy: input.storageWritePolicy,
    ...(input.externalAppend ? { externalAppend: input.externalAppend } : {}),
    responsibleSession: "S12",
    createdAt: input.record.createdAt,
    ...(input.auditEvent
      ? { audit: createReceiptAudit(input.auditEvent, input.auditStoragePolicy) }
      : {}),
    redaction: createRedaction(),
  };
}

function isMatchingIdempotentTeachingOperationRecord(
  record: TeachingOperationRecord,
  input: {
    operationId: TeachingOperationId;
    actionSlot: TeachingOperationActionSlot;
    courseId?: string;
    sourceAction?: string;
  },
) {
  return (
    record.operationId === input.operationId &&
    record.actionSlot === input.actionSlot &&
    (record.courseId ?? "") === (input.courseId ?? "") &&
    (record.sourceAction ?? "") === (input.sourceAction ?? "")
  );
}

function findPersistedAuditEventForRecord(
  auditEvents: TeachingOperationAuditEvent[],
  record: TeachingOperationRecord,
): TeachingOperationPersistedAuditEvent | undefined {
  return auditEvents.find(
    (event): event is TeachingOperationPersistedAuditEvent =>
      event.eventType === "teaching-operation.persisted" &&
      event.actorId === record.actorId &&
      event.operationId === record.operationId &&
      event.actionSlot === record.actionSlot &&
      event.actionId === record.actionId &&
      (event.courseId ?? "") === (record.courseId ?? "") &&
      (event.sourceAction ?? "") === (record.sourceAction ?? "") &&
      event.createdAt === record.createdAt,
  );
}

function normalizeExternalAppendReceipt(
  value: TeachingOperationExternalAppendReceipt,
  expected: {
    expectedTeacherId: string;
    expectedReceiptId: string;
  },
): TeachingOperationExternalAppendReceipt {
  if (!isRecord(value)) {
    throw new TeachingOperationStoreError(
      502,
      "External teaching operation persistence acknowledgement is invalid.",
    );
  }
  if (
    value.status !== "persisted" ||
    value.storagePolicy !== "external-redacted-teaching-operation-append" ||
    value.storageWritePolicy !== "external-append-only-operation-log" ||
    value.responsibleSession !== "S12"
  ) {
    throw new TeachingOperationStoreError(
      502,
      "External teaching operation persistence acknowledgement is invalid.",
    );
  }
  const teacherId = requireSafeId(value.teacherId, "external append teacher id");
  const receiptId = requireSafeId(value.receiptId, "external append receipt id");
  if (teacherId !== expected.expectedTeacherId || receiptId !== expected.expectedReceiptId) {
    throw new TeachingOperationStoreError(
      502,
      "External teaching operation persistence acknowledgement is invalid.",
    );
  }

  return {
    teacherId,
    receiptId,
    status: "persisted",
    ...(isTeachingOperationIdempotencyStatus(value.idempotencyStatus)
      ? { idempotencyStatus: value.idempotencyStatus }
      : {}),
    ...(isPositiveInteger(value.appendSequence)
      ? { appendSequence: value.appendSequence }
      : {}),
    ...(isTeachingOperationProductionDatabaseAdapterEvidence(value.productionDatabaseAdapter)
      ? { productionDatabaseAdapter: value.productionDatabaseAdapter }
      : {}),
    storagePolicy: "external-redacted-teaching-operation-append",
    storageWritePolicy: "external-append-only-operation-log",
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

export function isTeachingOperationProductionDatabaseAdapterEvidence(
  value: unknown,
): value is TeachingOperationProductionDatabaseAdapterEvidence {
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

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

async function runWithTeachingOperationLocalWriteLock<T>(
  dataDir: string,
  action: () => Promise<T>,
): Promise<T> {
  const previous = localTeachingOperationWriteQueues.get(dataDir) ?? Promise.resolve();
  let releaseCurrent: () => void = () => undefined;
  const current = new Promise<void>((resolveCurrent) => {
    releaseCurrent = resolveCurrent;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  localTeachingOperationWriteQueues.set(dataDir, queued);

  await previous.catch(() => undefined);
  try {
    return await action();
  } finally {
    releaseCurrent();
    if (localTeachingOperationWriteQueues.get(dataDir) === queued) {
      localTeachingOperationWriteQueues.delete(dataDir);
    }
  }
}

export async function readTeachingOperationDatabase(
  input: ReadTeachingOperationDatabaseInput = {},
): Promise<TeachingOperationDatabase> {
  const dataDir = resolveTeachingOperationDataDir(input.dataDir);
  const databasePath = resolveDatabasePath(dataDir);
  const raw = await readFile(databasePath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });

  if (!raw) {
    return createEmptyDatabase();
  }

  return normalizeDatabase(JSON.parse(raw));
}

// Exposed so the Postgres cutover adapter and parity checks normalize a snapshot
// the same way the file reader does (Phase 1 durable-data cutover).
export function normalizeTeachingOperationDatabase(
  value: unknown,
): TeachingOperationDatabase {
  return normalizeDatabase(value);
}

// Phase 1 durable-data cutover — backend-aware snapshot access (the "contract"
// read-switch). When UAIS_TEACHING_OPERATIONS_SNAPSHOT_BACKEND selects Postgres,
// the store's operational reads/writes route through the managed repository;
// otherwise they use the JSON file. This uses a DEDICATED var — not the
// external-append UAIS_TEACHING_OPERATIONS_BACKEND — so it cannot collide with
// the external storage-backend contract (which throws under `postgres`). Unset,
// it is byte-identical to the file path, so existing operations are unchanged.
// The postgres-store is imported dynamically to avoid a static import cycle.
function usesPostgresOperationSnapshot(env: Record<string, string | undefined>) {
  const selector = env.UAIS_TEACHING_OPERATIONS_SNAPSHOT_BACKEND?.trim().toLowerCase();
  return selector === "postgres" || selector === "managed";
}

export async function loadTeachingOperationDatabase(
  input: { dataDir?: string; env?: Record<string, string | undefined> } = {},
): Promise<TeachingOperationDatabase> {
  const env = input.env ?? process.env;
  if (usesPostgresOperationSnapshot(env)) {
    const { createUaisTeachingOperationPostgresRepository } = await import(
      "./teaching-operations-postgres-store"
    );
    const snapshot = await createUaisTeachingOperationPostgresRepository({ env }).read();
    return normalizeDatabase(snapshot.database);
  }
  return readTeachingOperationDatabase({ dataDir: input.dataDir });
}

export async function persistTeachingOperationDatabase(input: {
  dataDir?: string;
  database: TeachingOperationDatabase;
  env?: Record<string, string | undefined>;
}): Promise<void> {
  const env = input.env ?? process.env;
  if (usesPostgresOperationSnapshot(env)) {
    const { createUaisTeachingOperationPostgresRepository } = await import(
      "./teaching-operations-postgres-store"
    );
    await createUaisTeachingOperationPostgresRepository({ env }).write({
      database: input.database,
    });
    return;
  }
  await writeTeachingOperationDatabase({
    dataDir: resolveTeachingOperationDataDir(input.dataDir),
    database: input.database,
  });
}

export async function readTeachingOperationDatabaseBackup(input: {
  dataDir?: string;
  backupId: string;
}): Promise<TeachingOperationDatabaseBackup | undefined> {
  const dataDir = resolveTeachingOperationDataDir(input.dataDir);
  const filePath = resolveDatabaseBackupPath(dataDir, input.backupId);
  const raw = await readFile(filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });

  if (!raw) {
    return undefined;
  }

  return normalizeDatabaseBackup(JSON.parse(raw));
}

export function collectTeachingOperationDatabaseCourseIds(
  database: TeachingOperationDatabase,
) {
  const courseIds = new Set<string>();
  const addCourseId = (courseId: string | undefined) => {
    if (courseId) {
      courseIds.add(requireSafeId(courseId, "course id"));
    }
  };

  for (const record of database.records) addCourseId(record.courseId);
  for (const projection of database.domainProjections) addCourseId(projection.courseId);
  for (const inviteCode of database.inviteCodes) addCourseId(inviteCode.courseId);
  for (const outboxItem of database.outbox) addCourseId(outboxItem.courseId);
  for (const manifest of database.exportManifests) addCourseId(manifest.courseId);

  return [...courseIds].sort();
}

export async function readTeachingGradebookUpdate(input: {
  dataDir?: string;
  objectId: string;
}): Promise<TeachingOperationGradebookUpdateProjection | undefined> {
  const database = await loadTeachingOperationDatabase({ dataDir: input.dataDir });
  const objectId = requireSafeId(input.objectId, "gradebook update id");
  const projection = database.domainProjections.find(
    (item): item is TeachingOperationGradebookUpdateProjection =>
      item.objectType === "gradebook-update" && item.objectId === objectId,
  );
  return projection;
}

export async function restoreTeachingOperationDatabaseBackup(input: {
  dataDir?: string;
  backupId: string;
  actorId: string;
  audit: TeachingGradebookReleaseAuditInput;
  now?: Date;
}): Promise<{
  receipt: TeachingOperationBackupRestoreReceipt;
  database: TeachingOperationDatabase;
}> {
  const dataDir = resolveTeachingOperationDataDir(input.dataDir);
  return runWithTeachingOperationLocalWriteLock(dataDir, async () => {
    const backupId = requireSafeId(input.backupId, "backup id");
    const backup = await readTeachingOperationDatabaseBackup({ dataDir, backupId });
    if (!backup) {
      throw new TeachingOperationStoreError(404, "Teaching operation backup was not found.");
    }

    const actorId = requireSafeId(input.actorId, "actor id");
    const now = input.now ?? new Date();
    const restoredAt = now.toISOString();
    const impactedCourseIds = collectTeachingOperationDatabaseCourseIds(backup.database);
    const auditEvent = createBackupRestoreAuditEvent({
      audit: input.audit,
      actorId,
      backupId,
      impactedCourseIds,
      now,
      createdAt: restoredAt,
    });
    const restoredDatabase: TeachingOperationDatabase = {
      ...backup.database,
      updatedAt: restoredAt,
      auditEvents: [...backup.database.auditEvents, auditEvent],
    };
    const receipt: TeachingOperationBackupRestoreReceipt = {
      receiptId: `teaching-operations-backup-restore-${backupId}-${formatTimestampId(now)}`,
      action: "restore-teaching-operations-backup",
      backupId,
      actorId,
      impactedCourseIds,
      traceId: input.audit.traceId,
      status: "persisted",
      storagePolicy: "local-json-teaching-operation-database",
      storageWritePolicy: "atomic-json-file-replace",
      responsibleSession: "S12",
      createdAt: restoredAt,
      redaction: createRedaction(),
    };

    await persistTeachingOperationDatabase({ dataDir, database: restoredDatabase });
    return {
      receipt,
      database: restoredDatabase,
    };
  });
}

export async function rollbackTeachingOperationRecord(input: {
  dataDir?: string;
  recordId: string;
  actorId: string;
  rollbackReason: string;
  audit: TeachingGradebookReleaseAuditInput;
  now?: Date;
}): Promise<{
  receipt: TeachingOperationRollbackReceipt;
  database: TeachingOperationDatabase;
}> {
  const dataDir = resolveTeachingOperationDataDir(input.dataDir);
  return runWithTeachingOperationLocalWriteLock(dataDir, async () => {
    const recordId = requireSafeId(input.recordId, "teaching operation record id");
    const actorId = requireSafeId(input.actorId, "actor id");
    const rollbackReason = requireSafeId(input.rollbackReason, "rollback reason");
    const database = await loadTeachingOperationDatabase({ dataDir });
    const record = database.records.find((item) => item.recordId === recordId);
    if (!record) {
      throw new TeachingOperationStoreError(404, "Teaching operation record was not found.");
    }
    if (!record.courseId) {
      throw new TeachingOperationStoreError(
        409,
        "Teaching operation record has no course scope.",
      );
    }
    if (
      database.domainProjections.some(
        (projection) =>
          projection.objectType === "operation-rollback" &&
          projection.targetRecordId === recordId,
      )
    ) {
      throw new TeachingOperationStoreError(
        409,
        "Teaching operation record has already been rolled back.",
      );
    }

    const now = input.now ?? new Date();
    const rolledBackAt = now.toISOString();
    const auditEvent = createTeachingOperationRollbackAuditEvent({
      audit: input.audit,
      actorId,
      record,
      rollbackReason,
      now,
      createdAt: rolledBackAt,
    });
    const rollbackProjection: TeachingOperationRollbackProjection = {
      objectId: `operation-rollback-${recordId}`,
      objectType: "operation-rollback",
      courseId: record.courseId,
      targetRecordId: recordId,
      targetOperationId: record.operationId,
      targetActionSlot: record.actionSlot,
      targetActionId: record.actionId,
      rollbackStatus: "rolled-back",
      rollbackReason,
      rolledBackBy: actorId,
      rolledBackAt,
      storagePolicy: "domain-projection-teaching-operation-rollback",
      redaction: createRedaction(),
    };
    const nextDatabase: TeachingOperationDatabase = {
      ...database,
      updatedAt: rolledBackAt,
      auditEvents: [...database.auditEvents, auditEvent],
      domainProjections: [...database.domainProjections, rollbackProjection],
    };
    const receipt: TeachingOperationRollbackReceipt = {
      receiptId: `teaching-operation-rollback-${recordId}-${formatTimestampId(now)}`,
      action: "rollback-teaching-operation-record",
      actorId,
      courseId: record.courseId,
      targetRecordId: recordId,
      traceId: input.audit.traceId,
      rollbackReason,
      status: "persisted",
      storagePolicy: "local-json-teaching-operation-database",
      storageWritePolicy: "atomic-json-file-replace",
      responsibleSession: "S12",
      createdAt: rolledBackAt,
      redaction: createRedaction(),
    };

    await persistTeachingOperationDatabase({ dataDir, database: nextDatabase });
    return {
      receipt,
      database: nextDatabase,
    };
  });
}

export async function releaseTeachingGradebookUpdate(input: {
  dataDir?: string;
  objectId: string;
  actorId: string;
  audit: TeachingGradebookReleaseAuditInput;
  providerRelease?: TeachingGradebookReleaseProviderReceipt;
  now?: Date;
}): Promise<{
  gradebookUpdate: TeachingOperationGradebookUpdateProjection;
  notification: TeachingOperationGradeReleaseNotificationProjection;
  receipt: TeachingGradebookReleaseReceipt;
}> {
  const dataDir = resolveTeachingOperationDataDir(input.dataDir);
  const database = await loadTeachingOperationDatabase({ dataDir });
  const objectId = requireSafeId(input.objectId, "gradebook update id");
  const actorId = requireSafeId(input.actorId, "actor id");
  const providerRelease = input.providerRelease
    ? normalizeTeachingGradebookReleaseProviderReceipt(input.providerRelease)
    : undefined;
  const projectionIndex = database.domainProjections.findIndex(
    (item) => item.objectType === "gradebook-update" && item.objectId === objectId,
  );
  if (projectionIndex < 0) {
    throw new TeachingOperationStoreError(404, "Gradebook update was not found.");
  }

  const existingProjection = database.domainProjections[projectionIndex];
  if (existingProjection.objectType !== "gradebook-update") {
    throw new TeachingOperationStoreError(500, "Gradebook update projection is invalid.");
  }
  const now = input.now ?? new Date();
  const releasedAt = now.toISOString();
  const gradebookUpdate: TeachingOperationGradebookUpdateProjection = {
    ...existingProjection,
    updateStatus: "released",
    releasedBy: existingProjection.releasedBy ?? actorId,
    releasedAt: existingProjection.releasedAt ?? releasedAt,
    ...(providerRelease ?? {}),
  };
  const notification: TeachingOperationGradeReleaseNotificationProjection = {
    objectId: `grade-release-notification-${gradebookUpdate.courseId}`,
    objectType: "grade-release-notification",
    courseId: gradebookUpdate.courseId,
    gradebookUpdateId: gradebookUpdate.objectId,
    queuedBy: actorId,
    notificationStatus: "queued",
    deliveryChannel: "student-grade-release-notification",
    operationRecordId: gradebookUpdate.operationRecordId,
    ...(gradebookUpdate.sourceAction ? { sourceAction: gradebookUpdate.sourceAction } : {}),
    deliveryPolicy: "teacher-confirmed-grade-release-before-student-notification",
    queuedAt: releasedAt,
    storagePolicy: "domain-projection-teaching-grade-release-notification",
    redaction: createRedaction(),
  };
  const receipt: TeachingGradebookReleaseReceipt = {
    receiptId: `gradebook-release-${gradebookUpdate.objectId}-${formatTimestampId(now)}`,
    action: "release-gradebook-update",
    actorId,
    courseId: gradebookUpdate.courseId,
    gradebookUpdateId: gradebookUpdate.objectId,
    traceId: input.audit.traceId,
    status: "persisted",
    ...(providerRelease ?? {}),
    storagePolicy: "local-json-teaching-operation-database",
    storageWritePolicy: "atomic-json-file-replace",
    responsibleSession: "S12",
    createdAt: releasedAt,
    redaction: createRedaction(),
  };
  const auditEvent = createGradebookReleaseAuditEvent({
    audit: input.audit,
    actorId,
    courseId: gradebookUpdate.courseId,
    gradebookUpdateId: gradebookUpdate.objectId,
    now,
    createdAt: releasedAt,
  });
  const notificationIndex = database.domainProjections.findIndex(
    (item) => item.objectType === "grade-release-notification" && item.objectId === notification.objectId,
  );

  database.domainProjections[projectionIndex] = gradebookUpdate;
  if (notificationIndex >= 0) {
    database.domainProjections[notificationIndex] = notification;
  } else {
    database.domainProjections.push(notification);
  }
  database.auditEvents.push(auditEvent);
  database.updatedAt = releasedAt;
  await persistTeachingOperationDatabase({ dataDir, database });
  return {
    gradebookUpdate,
    notification,
    receipt,
  };
}

export async function rollbackTeachingGradebookRelease(input: {
  dataDir?: string;
  objectId: string;
  actorId: string;
  audit: TeachingGradebookReleaseAuditInput;
  providerRollback?: TeachingGradebookReleaseRollbackProviderReceipt;
  now?: Date;
}): Promise<{
  gradebookUpdate: TeachingOperationGradebookUpdateProjection;
  notification: TeachingOperationGradeReleaseRollbackNotificationProjection;
  receipt: TeachingGradebookReleaseRollbackReceipt;
}> {
  const dataDir = resolveTeachingOperationDataDir(input.dataDir);
  const database = await loadTeachingOperationDatabase({ dataDir });
  const objectId = requireSafeId(input.objectId, "gradebook update id");
  const actorId = requireSafeId(input.actorId, "actor id");
  const projectionIndex = database.domainProjections.findIndex(
    (item) => item.objectType === "gradebook-update" && item.objectId === objectId,
  );
  if (projectionIndex < 0) {
    throw new TeachingOperationStoreError(404, "Gradebook update was not found.");
  }

  const existingProjection = database.domainProjections[projectionIndex];
  if (existingProjection.objectType !== "gradebook-update") {
    throw new TeachingOperationStoreError(500, "Gradebook update projection is invalid.");
  }
  if (existingProjection.updateStatus !== "released") {
    throw new TeachingOperationStoreError(409, "Gradebook update is not released.");
  }

  const now = input.now ?? new Date();
  const rolledBackAt = now.toISOString();
  const providerRollback = input.providerRollback
    ? normalizeTeachingGradebookReleaseRollbackProviderReceipt(input.providerRollback)
    : undefined;
  const gradebookUpdate: TeachingOperationGradebookUpdateProjection = {
    ...existingProjection,
    updateStatus: "release-rolled-back",
    releaseRolledBackBy: actorId,
    releaseRolledBackAt: rolledBackAt,
    ...(providerRollback ?? {}),
  };
  const notification: TeachingOperationGradeReleaseRollbackNotificationProjection = {
    objectId: `grade-release-rollback-notification-${gradebookUpdate.courseId}`,
    objectType: "grade-release-rollback-notification",
    courseId: gradebookUpdate.courseId,
    gradebookUpdateId: gradebookUpdate.objectId,
    queuedBy: actorId,
    notificationStatus: "queued",
    deliveryChannel: "student-grade-release-rollback-notification",
    operationRecordId: gradebookUpdate.operationRecordId,
    ...(gradebookUpdate.sourceAction ? { sourceAction: gradebookUpdate.sourceAction } : {}),
    deliveryPolicy: "teacher-confirmed-grade-release-rollback-before-student-notification",
    queuedAt: rolledBackAt,
    storagePolicy: "domain-projection-teaching-grade-release-rollback-notification",
    redaction: createRedaction(),
  };
  const receipt: TeachingGradebookReleaseRollbackReceipt = {
    receiptId: `gradebook-release-rollback-${gradebookUpdate.objectId}-${formatTimestampId(now)}`,
    action: "rollback-gradebook-release",
    actorId,
    courseId: gradebookUpdate.courseId,
    gradebookUpdateId: gradebookUpdate.objectId,
    traceId: input.audit.traceId,
    status: "persisted",
    ...(providerRollback ?? {}),
    storagePolicy: "local-json-teaching-operation-database",
    storageWritePolicy: "atomic-json-file-replace",
    responsibleSession: "S12",
    createdAt: rolledBackAt,
    redaction: createRedaction(),
  };
  const auditEvent = createGradebookReleaseAuditEvent({
    audit: input.audit,
    eventType: "teaching-gradebook-update.release-rolled-back",
    actorId,
    courseId: gradebookUpdate.courseId,
    gradebookUpdateId: gradebookUpdate.objectId,
    now,
    createdAt: rolledBackAt,
  });
  const notificationIndex = database.domainProjections.findIndex(
    (item) =>
      item.objectType === "grade-release-rollback-notification" &&
      item.objectId === notification.objectId,
  );

  database.domainProjections[projectionIndex] = gradebookUpdate;
  if (notificationIndex >= 0) {
    database.domainProjections[notificationIndex] = notification;
  } else {
    database.domainProjections.push(notification);
  }
  database.auditEvents.push(auditEvent);
  database.updatedAt = rolledBackAt;
  await persistTeachingOperationDatabase({ dataDir, database });
  return {
    gradebookUpdate,
    notification,
    receipt,
  };
}

export async function releaseExternalTeachingGradebookUpdate(input: {
  gradebookUpdate: TeachingOperationGradebookUpdateProjection;
  actorId: string;
  audit: TeachingGradebookReleaseAuditInput;
  appendExternalTeachingOperation: TeachingOperationExternalAppendAdapter;
  providerRelease?: TeachingGradebookReleaseProviderReceipt;
  now?: Date;
}): Promise<{
  gradebookUpdate: TeachingOperationGradebookUpdateProjection;
  notification: TeachingOperationGradeReleaseNotificationProjection;
  receipt: TeachingGradebookReleaseReceipt;
}> {
  const actorId = requireSafeId(input.actorId, "actor id");
  const providerRelease = input.providerRelease
    ? normalizeTeachingGradebookReleaseProviderReceipt(input.providerRelease)
    : undefined;
  const now = input.now ?? new Date();
  const releasedAt = now.toISOString();
  const gradebookUpdate: TeachingOperationGradebookUpdateProjection = {
    ...input.gradebookUpdate,
    updateStatus: "released",
    releasedBy: input.gradebookUpdate.releasedBy ?? actorId,
    releasedAt: input.gradebookUpdate.releasedAt ?? releasedAt,
    ...(providerRelease ?? {}),
  };
  const notification: TeachingOperationGradeReleaseNotificationProjection = {
    objectId: `grade-release-notification-${gradebookUpdate.courseId}`,
    objectType: "grade-release-notification",
    courseId: gradebookUpdate.courseId,
    gradebookUpdateId: gradebookUpdate.objectId,
    queuedBy: actorId,
    notificationStatus: "queued",
    deliveryChannel: "student-grade-release-notification",
    operationRecordId: gradebookUpdate.operationRecordId,
    ...(gradebookUpdate.sourceAction ? { sourceAction: gradebookUpdate.sourceAction } : {}),
    deliveryPolicy: "teacher-confirmed-grade-release-before-student-notification",
    queuedAt: releasedAt,
    storagePolicy: "domain-projection-teaching-grade-release-notification",
    redaction: createRedaction(),
  };
  const receipt: TeachingGradebookReleaseReceipt = {
    receiptId: `gradebook-release-${gradebookUpdate.objectId}-${formatTimestampId(now)}`,
    action: "release-gradebook-update",
    actorId,
    courseId: gradebookUpdate.courseId,
    gradebookUpdateId: gradebookUpdate.objectId,
    traceId: input.audit.traceId,
    status: "persisted",
    ...(providerRelease ?? {}),
    storagePolicy: "external-redacted-teaching-operation-append",
    storageWritePolicy: "external-append-only-operation-log",
    responsibleSession: "S12",
    createdAt: releasedAt,
    redaction: createRedaction(),
  };
  const auditEvent = createGradebookReleaseAuditEvent({
    audit: input.audit,
    actorId,
    courseId: gradebookUpdate.courseId,
    gradebookUpdateId: gradebookUpdate.objectId,
    now,
    createdAt: releasedAt,
  });
  await input.appendExternalTeachingOperation({
    record: createGradebookReleaseExternalRecord({
      receiptId: receipt.receiptId,
      actionId: "save-review-queue",
      actorId,
      courseId: gradebookUpdate.courseId,
      sourceAction: gradebookUpdate.sourceAction,
      createdAt: releasedAt,
      domainProjections: [gradebookUpdate, notification],
    }),
    auditEvent,
  });

  return {
    gradebookUpdate,
    notification,
    receipt,
  };
}

export async function rollbackExternalTeachingGradebookRelease(input: {
  gradebookUpdate: TeachingOperationGradebookUpdateProjection;
  actorId: string;
  audit: TeachingGradebookReleaseAuditInput;
  appendExternalTeachingOperation: TeachingOperationExternalAppendAdapter;
  providerRollback?: TeachingGradebookReleaseRollbackProviderReceipt;
  now?: Date;
}): Promise<{
  gradebookUpdate: TeachingOperationGradebookUpdateProjection;
  notification: TeachingOperationGradeReleaseRollbackNotificationProjection;
  receipt: TeachingGradebookReleaseRollbackReceipt;
}> {
  if (input.gradebookUpdate.updateStatus !== "released") {
    throw new TeachingOperationStoreError(409, "Gradebook update is not released.");
  }

  const actorId = requireSafeId(input.actorId, "actor id");
  const now = input.now ?? new Date();
  const rolledBackAt = now.toISOString();
  const providerRollback = input.providerRollback
    ? normalizeTeachingGradebookReleaseRollbackProviderReceipt(input.providerRollback)
    : undefined;
  const gradebookUpdate: TeachingOperationGradebookUpdateProjection = {
    ...input.gradebookUpdate,
    updateStatus: "release-rolled-back",
    releaseRolledBackBy: actorId,
    releaseRolledBackAt: rolledBackAt,
    ...(providerRollback ?? {}),
  };
  const notification: TeachingOperationGradeReleaseRollbackNotificationProjection = {
    objectId: `grade-release-rollback-notification-${gradebookUpdate.courseId}`,
    objectType: "grade-release-rollback-notification",
    courseId: gradebookUpdate.courseId,
    gradebookUpdateId: gradebookUpdate.objectId,
    queuedBy: actorId,
    notificationStatus: "queued",
    deliveryChannel: "student-grade-release-rollback-notification",
    operationRecordId: gradebookUpdate.operationRecordId,
    ...(gradebookUpdate.sourceAction ? { sourceAction: gradebookUpdate.sourceAction } : {}),
    deliveryPolicy: "teacher-confirmed-grade-release-rollback-before-student-notification",
    queuedAt: rolledBackAt,
    storagePolicy: "domain-projection-teaching-grade-release-rollback-notification",
    redaction: createRedaction(),
  };
  const receipt: TeachingGradebookReleaseRollbackReceipt = {
    receiptId: `gradebook-release-rollback-${gradebookUpdate.objectId}-${formatTimestampId(now)}`,
    action: "rollback-gradebook-release",
    actorId,
    courseId: gradebookUpdate.courseId,
    gradebookUpdateId: gradebookUpdate.objectId,
    traceId: input.audit.traceId,
    status: "persisted",
    ...(providerRollback ?? {}),
    storagePolicy: "external-redacted-teaching-operation-append",
    storageWritePolicy: "external-append-only-operation-log",
    responsibleSession: "S12",
    createdAt: rolledBackAt,
    redaction: createRedaction(),
  };
  const auditEvent = createGradebookReleaseAuditEvent({
    audit: input.audit,
    eventType: "teaching-gradebook-update.release-rolled-back",
    actorId,
    courseId: gradebookUpdate.courseId,
    gradebookUpdateId: gradebookUpdate.objectId,
    now,
    createdAt: rolledBackAt,
  });
  await input.appendExternalTeachingOperation({
    record: createGradebookReleaseExternalRecord({
      receiptId: receipt.receiptId,
      actionId: "save-review-queue",
      actorId,
      courseId: gradebookUpdate.courseId,
      sourceAction: gradebookUpdate.sourceAction,
      createdAt: rolledBackAt,
      domainProjections: [gradebookUpdate, notification],
    }),
    auditEvent,
  });

  return {
    gradebookUpdate,
    notification,
    receipt,
  };
}

function createGradebookReleaseExternalRecord(input: {
  receiptId: string;
  actionId: TeachingOperationActionId;
  actorId: string;
  courseId: string;
  sourceAction?: string;
  createdAt: string;
  domainProjections: TeachingOperationDomainProjection[];
}): TeachingOperationRecord {
  return {
    recordId: input.receiptId,
    operationId: "grading",
    actionSlot: "primary",
    actionId: input.actionId,
    actorId: input.actorId,
    courseId: input.courseId,
    ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
    createdAt: input.createdAt,
    status: "persisted",
    storagePolicy: "external-redacted-teaching-operation-append",
    redaction: createRedaction(),
    artifacts: input.domainProjections.map(createDomainProjectionArtifact),
    domainProjections: input.domainProjections,
  };
}

function normalizeTeachingGradebookReleaseProviderReceipt(
  input: TeachingGradebookReleaseProviderReceipt,
): TeachingGradebookReleaseProviderReceipt {
  return {
    providerStatus: "gradebook-provider-released",
    providerReleaseId: requireSafeId(input.providerReleaseId, "provider release id"),
    providerReleasedAt: requireIsoDate(input.providerReleasedAt, "providerReleasedAt"),
  };
}

function normalizeTeachingGradebookReleaseRollbackProviderReceipt(
  input: TeachingGradebookReleaseRollbackProviderReceipt,
): TeachingGradebookReleaseRollbackProviderReceipt {
  return {
    providerRollbackStatus: "gradebook-provider-release-rolled-back",
    providerRollbackId: requireSafeId(input.providerRollbackId, "provider rollback id"),
    providerRolledBackAt: requireIsoDate(input.providerRolledBackAt, "providerRolledBackAt"),
  };
}

export async function readTeachingOperationExportManifest(
  input: ReadTeachingOperationExportInput,
): Promise<TeachingOperationExportManifest | undefined> {
  const dataDir = resolveTeachingOperationDataDir(input.dataDir);
  const manifestId = requireSafeId(input.manifestId, "manifest id");
  const filePath = resolveExportManifestPath(dataDir, manifestId);
  const raw = await readFile(filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });

  if (!raw) {
    return undefined;
  }

  return normalizeExportManifest(JSON.parse(raw));
}

export function createUaisTeachingOperationExternalAppendAdapter(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}): TeachingOperationExternalAppendAdapter | undefined {
  const backendContract = resolveUaisStorageBackendContract({
    envName: "UAIS_TEACHING_OPERATIONS_BACKEND",
    value: input.env.UAIS_TEACHING_OPERATIONS_BACKEND,
    responsibleSession: "S12",
    env: input.env,
  });

  if (isLocalJsonFileStorageBackendContract(backendContract)) {
    return undefined;
  }
  if (!isExternalStorageBackendReadyContract(backendContract)) {
    throw new TeachingOperationStoreError(
      503,
      "Teaching operation storage backend is not ready.",
    );
  }

  const config = createUaisExternalStorageConfig({ env: input.env });
  if (!config) {
    throw new TeachingOperationStoreError(
      503,
      "Teaching operation external storage is not configured.",
    );
  }
  const fetchImpl = input.fetch ?? fetch;

  return async ({ record, auditEvent }) => {
    const teacherId = requireSafeId(record.actorId, "teacher id");
    const response = await fetchImpl(
      `${config.baseUrl}/teaching-operations/${encodeURIComponent(teacherId)}/append`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${config.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "append-teaching-operation",
          record,
          ...(auditEvent ? { auditEvent } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok && response.status === 409) {
      throw new TeachingOperationStoreError(
        409,
        "Teaching operation idempotency key already exists.",
      );
    }
    if (!response.ok) {
      throw new TeachingOperationStoreError(
        502,
        "External teaching operation persistence failed.",
      );
    }
    const acknowledgement = await response.json().catch(() => undefined);
    if (
      isRecord(acknowledgement) &&
      (
        acknowledgement.status !== "persisted" ||
        acknowledgement.storagePolicy !== "external-redacted-teaching-operation-append" ||
        acknowledgement.storageWritePolicy !== "external-append-only-operation-log" ||
        acknowledgement.responsibleSession !== "S12"
      )
    ) {
      throw new TeachingOperationStoreError(
        502,
        "External teaching operation persistence acknowledgement is invalid.",
      );
    }
    const receiptId =
      isRecord(acknowledgement) && typeof acknowledgement.receiptId === "string"
        ? acknowledgement.receiptId
        : record.recordId;
    const appendSequence =
      isRecord(acknowledgement) && isPositiveInteger(acknowledgement.appendSequence)
        ? acknowledgement.appendSequence
        : undefined;
    if (!appendSequence) {
      throw new TeachingOperationStoreError(
        502,
        "External teaching operation persistence acknowledgement is missing append ledger sequence.",
      );
    }
    const idempotencyStatus =
      isRecord(acknowledgement) &&
      isTeachingOperationIdempotencyStatus(acknowledgement.idempotencyStatus)
        ? acknowledgement.idempotencyStatus
        : undefined;
    const productionDatabaseAdapter =
      isRecord(acknowledgement) &&
      isTeachingOperationProductionDatabaseAdapterEvidence(
        acknowledgement.productionDatabaseAdapter,
      )
        ? acknowledgement.productionDatabaseAdapter
        : undefined;
    if (isTeachingOperationProductionRuntime(input.env) && !productionDatabaseAdapter) {
      throw new TeachingOperationStoreError(
        502,
        "External teaching operation persistence acknowledgement is missing production database adapter evidence.",
      );
    }

    return {
      teacherId,
      receiptId,
      status: "persisted",
      ...(idempotencyStatus ? { idempotencyStatus } : {}),
      appendSequence,
      ...(productionDatabaseAdapter ? { productionDatabaseAdapter } : {}),
      storagePolicy: "external-redacted-teaching-operation-append",
      storageWritePolicy: "external-append-only-operation-log",
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
  };
}

function isTeachingOperationProductionRuntime(env: Record<string, string | undefined>) {
  return (
    env.VERCEL_ENV === "production" ||
    env.NODE_ENV === "production" ||
    env.UAIS_DEPLOYMENT_ENV === "production"
  );
}

export function createUaisTeachingOperationExternalAuditReadAdapter(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}): TeachingOperationExternalAuditReadAdapter | undefined {
  const backendContract = resolveUaisStorageBackendContract({
    envName: "UAIS_TEACHING_OPERATIONS_BACKEND",
    value: input.env.UAIS_TEACHING_OPERATIONS_BACKEND,
    responsibleSession: "S12",
    env: input.env,
  });

  if (isLocalJsonFileStorageBackendContract(backendContract)) {
    return undefined;
  }
  if (!isExternalStorageBackendReadyContract(backendContract)) {
    throw new TeachingOperationStoreError(
      503,
      "Teaching operation storage backend is not ready.",
    );
  }

  const config = createUaisExternalStorageConfig({ env: input.env });
  if (!config) {
    throw new TeachingOperationStoreError(
      503,
      "Teaching operation external storage is not configured.",
    );
  }
  const fetchImpl = input.fetch ?? fetch;

  return async ({ teacherId }) => {
    const normalizedTeacherId = requireSafeId(teacherId, "teacher id");
    const response = await fetchImpl(
      `${config.baseUrl}/teaching-operations/${encodeURIComponent(normalizedTeacherId)}/audit`,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${config.accessToken}`,
        },
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) {
      throw new TeachingOperationStoreError(
        502,
        "External teaching operation audit readback failed.",
      );
    }

    return normalizeExternalAuditReadback(await response.json(), {
      expectedTeacherId: normalizedTeacherId,
    });
  };
}

function normalizeExternalAuditReadback(
  value: unknown,
  expected: { expectedTeacherId: string },
): TeachingOperationExternalAuditReadback {
  if (!isRecord(value)) {
    throw new TeachingOperationStoreError(
      502,
      "External teaching operation audit readback response is invalid.",
    );
  }
  const teacherId =
    typeof value.teacherId === "string"
      ? requireSafeId(value.teacherId, "teacher id")
      : expected.expectedTeacherId;
  if (teacherId !== expected.expectedTeacherId) {
    throw new TeachingOperationStoreError(
      403,
      "External teaching operation audit teacher mismatch.",
    );
  }

  return {
    teacherId,
    records: Array.isArray(value.records)
      ? value.records.map(normalizeExternalTeachingOperationAuditReadbackRecord)
      : [],
    auditEvents: Array.isArray(value.auditEvents)
      ? value.auditEvents.map(normalizeTeachingOperationAuditReadbackEvent)
      : [],
    domainProjections: Array.isArray(value.domainProjections)
      ? value.domainProjections.map(normalizeTeachingOperationAuditReadbackDomainProjection)
      : [],
  };
}

export function createUaisTeachingOperationExternalRollbackAdapter(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}): TeachingOperationExternalRollbackAdapter | undefined {
  const backendContract = resolveUaisStorageBackendContract({
    envName: "UAIS_TEACHING_OPERATIONS_BACKEND",
    value: input.env.UAIS_TEACHING_OPERATIONS_BACKEND,
    responsibleSession: "S12",
    env: input.env,
  });

  if (isLocalJsonFileStorageBackendContract(backendContract)) {
    return undefined;
  }
  if (!isExternalStorageBackendReadyContract(backendContract)) {
    throw new TeachingOperationStoreError(
      503,
      "Teaching operation storage backend is not ready.",
    );
  }

  const config = createUaisExternalStorageConfig({ env: input.env });
  if (!config) {
    throw new TeachingOperationStoreError(
      503,
      "Teaching operation external storage is not configured.",
    );
  }
  const fetchImpl = input.fetch ?? fetch;

  return async ({
    teacherId,
    targetRecordId,
    courseId,
    rollbackReason,
    traceId,
    requestedAt,
    requestSource,
  }) => {
    const normalizedTeacherId = requireSafeId(teacherId, "teacher id");
    const normalizedTargetRecordId = requireSafeId(
      targetRecordId,
      "teaching operation record id",
    );
    const normalizedCourseId = requireSafeId(courseId, "course id");
    const response = await fetchImpl(
      `${config.baseUrl}/teaching-operations/${encodeURIComponent(
        normalizedTeacherId,
      )}/records/${encodeURIComponent(normalizedTargetRecordId)}/rollback`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${config.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "rollback-teaching-operation-record",
          courseId: normalizedCourseId,
          rollbackReason,
          traceId,
          requestedAt,
          requestSource,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) {
      throw new TeachingOperationStoreError(
        502,
        "External teaching operation rollback failed.",
      );
    }

    return normalizeExternalRollbackReceipt(await response.json(), {
      expectedTeacherId: normalizedTeacherId,
      expectedTargetRecordId: normalizedTargetRecordId,
      expectedCourseId: normalizedCourseId,
      productionRuntime: isTeachingOperationProductionRuntime(input.env),
    });
  };
}

function normalizeExternalRollbackReceipt(
  value: unknown,
  expected: {
    expectedTeacherId: string;
    expectedTargetRecordId: string;
    expectedCourseId: string;
    productionRuntime: boolean;
  },
): TeachingOperationExternalRollbackReceipt {
  if (!isRecord(value)) {
    throw new TeachingOperationStoreError(
      502,
      "External teaching operation rollback acknowledgement is invalid.",
    );
  }
  if (
    value.status !== "persisted" ||
    value.storagePolicy !== "external-redacted-teaching-operation-rollback" ||
    value.storageWritePolicy !== "external-append-only-rollback-log" ||
    value.responsibleSession !== "S12"
  ) {
    throw new TeachingOperationStoreError(
      502,
      "External teaching operation rollback acknowledgement is invalid.",
    );
  }
  const teacherId = requireSafeId(value.teacherId, "external rollback teacher id");
  const targetRecordId = requireSafeId(
    value.targetRecordId,
    "external rollback target record id",
  );
  const courseId = requireSafeId(value.courseId, "external rollback course id");
  if (
    teacherId !== expected.expectedTeacherId ||
    targetRecordId !== expected.expectedTargetRecordId ||
    courseId !== expected.expectedCourseId
  ) {
    throw new TeachingOperationStoreError(
      502,
      "External teaching operation rollback acknowledgement is invalid.",
    );
  }
  const productionDatabaseAdapter = isTeachingOperationProductionDatabaseAdapterEvidence(
    value.productionDatabaseAdapter,
  )
    ? value.productionDatabaseAdapter
    : undefined;
  if (expected.productionRuntime && !productionDatabaseAdapter) {
    throw new TeachingOperationStoreError(
      502,
      "External teaching operation rollback acknowledgement is missing production database adapter evidence.",
    );
  }

  return {
    teacherId,
    rollbackId: requireSafeId(value.rollbackId, "external rollback id"),
    targetRecordId,
    courseId,
    status: "persisted",
    ...(productionDatabaseAdapter ? { productionDatabaseAdapter } : {}),
    storagePolicy: "external-redacted-teaching-operation-rollback",
    storageWritePolicy: "external-append-only-rollback-log",
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function action(
  actionId: TeachingOperationActionId,
  zhText: string,
  enText: string,
  table: string,
): TeachingOperationActionDefinition {
  return {
    actionId,
    displayMessage: {
      "zh-CN": zhText,
      "en-US": enText,
    },
    table,
  };
}

async function createArtifacts(input: {
  dataDir: string;
  database: TeachingOperationDatabase;
  writeLocalFiles: boolean;
  operationId: TeachingOperationId;
  actionSlot: TeachingOperationActionSlot;
  actionId: TeachingOperationActionId;
  actorId: string;
  courseId?: string;
  recordId: string;
  table: string;
  now: Date;
  createdAt: string;
}): Promise<TeachingOperationArtifact[]> {
  const databaseRecord: TeachingOperationArtifact = {
    kind: "database-record",
    table: input.table,
    recordId: input.recordId,
  };

  if (input.actionId === "preview-student-view") {
    return [
      databaseRecord,
      {
        kind: "student-preview",
        previewId: `student-preview-${formatTimestampId(input.now)}`,
        previewUrl: `/learning?teacherPreview=1${
          input.courseId ? `&course=${encodeURIComponent(input.courseId)}` : ""
        }`,
      },
    ];
  }

  if (input.actionId === "run-permission-preflight") {
    return [
      databaseRecord,
      {
        kind: "preflight",
        status: "passed",
        checkedPermissions: ["course-bindings", "agent-roles", "student-access"],
      },
    ];
  }

  if (input.actionId === "generate-unit-draft") {
    return [
      databaseRecord,
      {
        kind: "generated-draft",
        artifactId: `unit-draft-${formatTimestampId(input.now)}`,
        status: "ready-for-teacher-review",
      },
    ];
  }

  if (input.actionId === "send-collaboration-invite") {
    const outboxItem: TeachingOperationOutboxRecord = {
      outboxId: `collaboration-invite-${input.actorId}-${formatTimestampId(input.now)}`,
      operationId: "admins",
      channel: "collaboration-invite",
      deliveryStatus: "sent-to-local-outbox",
      ...(input.courseId ? { courseId: input.courseId } : {}),
      actorId: input.actorId,
      createdAt: input.createdAt,
    };
    input.database.outbox.push(outboxItem);
    return [
      databaseRecord,
      {
        kind: "outbox",
        outboxId: outboxItem.outboxId,
        channel: "collaboration-invite",
        deliveryStatus: "sent-to-local-outbox",
      },
    ];
  }

  if (input.actionId === "generate-group-suggestions") {
    return [
      databaseRecord,
      {
        kind: "group-suggestions",
        artifactId: `group-suggestions-${formatTimestampId(input.now)}`,
        status: "ready-for-teacher-review",
      },
    ];
  }

  if (input.actionId === "create-export-manifest") {
    const manifest = createExportManifest(input);
    if (input.writeLocalFiles) {
      await writeExportManifest({ dataDir: input.dataDir, manifest });
    }
    input.database.exportManifests.push(manifest);
    return [
      databaseRecord,
      {
        kind: "export-file",
        manifestId: manifest.manifestId,
        downloadUrl: `/api/teaching/operations/export/${manifest.manifestId}`,
        contentType: "application/json",
      },
    ];
  }

  if (input.actionId === "validate-redaction-scope") {
    return [
      databaseRecord,
      {
        kind: "redaction-check",
        status: "passed",
        checkedScopes: ["student-private-notes", "credentials", "local-paths"],
      },
    ];
  }

  if (input.actionId === "lock-daily-snapshot") {
    return [
      databaseRecord,
      {
        kind: "dashboard-snapshot",
        snapshotId: `daily-snapshot-${formatTimestampId(input.now)}`,
        status: "locked",
      },
    ];
  }

  if (input.actionId === "generate-ai-feedback") {
    return [
      databaseRecord,
      {
        kind: "ai-feedback",
        artifactId: `ai-feedback-${formatTimestampId(input.now)}`,
        status: "ready-for-teacher-review",
      },
    ];
  }

  if (input.actionId === "generate-invite-code") {
    const code = createNextInviteCode(input.database);
    const inviteRecord: TeachingOperationInviteCodeRecord = {
      inviteId: `invite-${code}-${formatTimestampId(input.now)}`,
      operationId: "invite-code",
      code,
      status: "generated",
      ...(input.courseId ? { courseId: input.courseId } : {}),
      actorId: input.actorId,
      createdAt: input.createdAt,
    };
    input.database.inviteCodes.push(inviteRecord);
    return [
      databaseRecord,
      {
        kind: "invite-code",
        code,
        status: "generated",
        joinUrl: `/courses?invite=${code}`,
      },
    ];
  }

  if (input.actionId === "publish-invite-code") {
    const latestInvite = input.database.inviteCodes.at(-1);
    const code = latestInvite?.code ?? firstInviteCode;
    const inviteRecord: TeachingOperationInviteCodeRecord = {
      inviteId: `invite-published-${code}-${formatTimestampId(input.now)}`,
      operationId: "invite-code",
      code,
      status: "published",
      ...(input.courseId ?? latestInvite?.courseId
        ? { courseId: input.courseId ?? latestInvite?.courseId }
        : {}),
      actorId: input.actorId,
      createdAt: input.createdAt,
    };
    input.database.inviteCodes.push(inviteRecord);
    return [
      databaseRecord,
      {
        kind: "invite-code",
        code,
        status: "published",
        joinUrl: `/courses?invite=${code}`,
      },
    ];
  }

  return [databaseRecord];
}

function createDomainProjections(input: {
  operationId: TeachingOperationId;
  actionSlot: TeachingOperationActionSlot;
  actionId: TeachingOperationActionId;
  actorId: string;
  courseId?: string;
  sourceAction?: string;
  courseSettingsPatch?: unknown;
  recordId: string;
  createdAt: string;
  artifacts: TeachingOperationArtifact[];
}): TeachingOperationDomainProjection[] {
  if (
    input.operationId === "course-settings" &&
    input.actionSlot === "primary" &&
    input.actionId === "save-course-settings" &&
    input.courseId
  ) {
    const courseSettingsSnapshot = normalizeCourseSettingsPatchProjectionSnapshot(
      input.courseSettingsPatch,
    );
    return [
      {
        objectId: `course-settings-${input.courseId}`,
        objectType: "course-settings",
        courseId: input.courseId,
        updatedBy: input.actorId,
        status: "saved",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        ...courseSettingsSnapshot,
        updatedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-course-settings",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "course-settings" &&
    input.actionSlot === "secondary" &&
    input.actionId === "preview-student-view" &&
    input.courseId
  ) {
    const previewArtifact = input.artifacts.find(
      (
        artifact,
      ): artifact is {
        kind: "student-preview";
        previewId: string;
        previewUrl: string;
      } => artifact.kind === "student-preview" && "previewId" in artifact,
    );
    if (!previewArtifact) {
      return [];
    }

    return [
      {
        objectId: `student-preview-session-${input.courseId}`,
        objectType: "student-preview-session",
        courseId: input.courseId,
        previewedBy: input.actorId,
        previewStatus: "generated",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        previewId: previewArtifact.previewId,
        previewUrl: previewArtifact.previewUrl,
        previewScope: "teacher-course-preview",
        previewPolicy: "teacher-visible-preview-only",
        generatedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-student-preview-session",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "students" &&
    input.actionSlot === "primary" &&
    input.actionId === "sync-roster" &&
    input.courseId
  ) {
    return [
      {
        objectId: `student-roster-${input.courseId}`,
        objectType: "student-roster",
        courseId: input.courseId,
        syncedBy: input.actorId,
        syncStatus: "synced",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        sourceSystems: ["sis-roster", "invite-code-joins", "withdrawals"],
        pendingTeacherReviewCount: 3,
        syncedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-student-roster",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "agents" &&
    input.actionSlot === "secondary" &&
    input.actionId === "run-permission-preflight" &&
    input.courseId
  ) {
    const preflightArtifact = input.artifacts.find(
      (
        artifact,
      ): artifact is {
        kind: "preflight";
        status: "passed";
        checkedPermissions: string[];
      } => artifact.kind === "preflight" && "checkedPermissions" in artifact,
    );
    if (!preflightArtifact) {
      return [];
    }

    return [
      {
        objectId: `permission-preflight-${input.courseId}`,
        objectType: "permission-preflight",
        courseId: input.courseId,
        checkedBy: input.actorId,
        preflightStatus: "passed",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        checkedPermissions: ["course-bindings", "agent-roles", "student-access"],
        preflightPolicy: "teacher-agent-permission-gate",
        checkedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-permission-preflight",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "agents" &&
    input.actionSlot === "primary" &&
    input.actionId === "save-agent-plan" &&
    input.courseId
  ) {
    return [
      {
        objectId: `agent-plan-${input.courseId}`,
        objectType: "agent-plan",
        courseId: input.courseId,
        savedBy: input.actorId,
        planStatus: "saved",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        enabledAgents: ["research-assistant", "math-coach", "writing-mentor"],
        governancePolicy: "teacher-reviewed-agent-plan",
        savedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-agent-plan",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "dashboard" &&
    input.actionSlot === "primary" &&
    input.actionId === "refresh-dashboard" &&
    input.courseId
  ) {
    return [
      {
        objectId: `dashboard-state-${input.courseId}`,
        objectType: "dashboard-state",
        courseId: input.courseId,
        refreshedBy: input.actorId,
        refreshStatus: "refreshed",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        visibleMetrics: ["engagement", "progress", "assessment-quality"],
        refreshPolicy: "teacher-visible-course-dashboard",
        refreshedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-dashboard-state",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "dashboard" &&
    input.actionSlot === "secondary" &&
    input.actionId === "lock-daily-snapshot" &&
    input.courseId
  ) {
    const snapshotArtifact = input.artifacts.find(
      (
        artifact,
      ): artifact is {
        kind: "dashboard-snapshot";
        snapshotId: string;
        status: "locked";
      } => artifact.kind === "dashboard-snapshot" && "snapshotId" in artifact,
    );
    if (!snapshotArtifact) {
      return [];
    }

    return [
      {
        objectId: `dashboard-snapshot-${input.courseId}`,
        objectType: "dashboard-snapshot",
        courseId: input.courseId,
        lockedBy: input.actorId,
        snapshotStatus: "locked",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        snapshotId: snapshotArtifact.snapshotId,
        snapshotScope: "daily-course-dashboard",
        retentionPolicy: "teacher-locked-dashboard-snapshot",
        lockedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-dashboard-snapshot",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "admins" &&
    input.actionSlot === "primary" &&
    input.actionId === "save-admin-settings" &&
    input.courseId
  ) {
    return [
      {
        objectId: `admin-settings-${input.courseId}`,
        objectType: "admin-settings",
        courseId: input.courseId,
        savedBy: input.actorId,
        settingsStatus: "saved",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        adminScopes: ["course-collaborators", "permission-boundary", "audit-routing"],
        governancePolicy: "teacher-controlled-admin-settings",
        savedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-admin-settings",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "quiz-board" &&
    input.actionSlot === "primary" &&
    input.actionId === "refresh-quiz-board" &&
    input.courseId
  ) {
    return [
      {
        objectId: `quiz-board-state-${input.courseId}`,
        objectType: "quiz-board-state",
        courseId: input.courseId,
        refreshedBy: input.actorId,
        refreshStatus: "refreshed",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        visibleMetrics: ["completion-rate", "item-quality", "misconception-clusters"],
        reviewPolicy: "teacher-visible-quiz-quality-board",
        refreshedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-quiz-board-state",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "quiz-board" &&
    input.actionSlot === "secondary" &&
    input.actionId === "flag-low-quality-items" &&
    input.courseId
  ) {
    return [
      {
        objectId: `quiz-item-review-${input.courseId}`,
        objectType: "quiz-item-review",
        courseId: input.courseId,
        flaggedBy: input.actorId,
        reviewStatus: "flagged-for-review",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        flaggedSignals: ["low-discrimination", "high-error-rate", "teacher-review-needed"],
        reviewPolicy: "teacher-review-before-quiz-reuse",
        flaggedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-quiz-item-review",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "data-export" &&
    input.actionSlot === "primary" &&
    input.actionId === "create-export-manifest" &&
    input.courseId
  ) {
    const exportArtifact = input.artifacts.find(
      (
        artifact,
      ): artifact is Extract<TeachingOperationArtifact, { kind: "export-file" }> =>
        artifact.kind === "export-file",
    );
    if (!exportArtifact) {
      return [];
    }

    return [
      {
        objectId: `export-manifest-${input.courseId}`,
        objectType: "export-manifest",
        courseId: input.courseId,
        createdBy: input.actorId,
        exportStatus: "generated",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        manifestId: exportArtifact.manifestId,
        datasetScopes: ["learning-records", "chat-threads", "grades", "activities"],
        exportPolicy: "redacted-teacher-export-manifest",
        createdAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-export-manifest",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "data-export" &&
    input.actionSlot === "secondary" &&
    input.actionId === "validate-redaction-scope" &&
    input.courseId
  ) {
    const redactionArtifact = input.artifacts.find(
      (
        artifact,
      ): artifact is Extract<TeachingOperationArtifact, { kind: "redaction-check" }> =>
        artifact.kind === "redaction-check",
    );
    if (!redactionArtifact) {
      return [];
    }

    return [
      {
        objectId: `redaction-validation-${input.courseId}`,
        objectType: "redaction-validation",
        courseId: input.courseId,
        validatedBy: input.actorId,
        validationStatus: "passed",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        checkedScopes: ["student-private-notes", "credentials", "local-paths"],
        validationPolicy: "exclude-private-and-secret-fields",
        validatedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-redaction-validation",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "knowledge-base" &&
    input.actionSlot === "primary" &&
    input.actionId === "sync-knowledge-index" &&
    input.courseId
  ) {
    return [
      {
        objectId: `knowledge-index-${input.courseId}`,
        objectType: "knowledge-index",
        courseId: input.courseId,
        syncedBy: input.actorId,
        syncStatus: "synced",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        sourceSystems: ["course-files", "teacher-resources", "agent-grounding-index"],
        syncedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-knowledge-index",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "knowledge-base" &&
    input.actionSlot === "secondary" &&
    input.actionId === "add-resource-placeholder" &&
    input.courseId
  ) {
    return [
      {
        objectId: `resource-review-item-${input.courseId}`,
        objectType: "resource-review-item",
        courseId: input.courseId,
        queuedBy: input.actorId,
        reviewStatus: "pending-teacher-review",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        resourceSource: "teacher-placeholder",
        reviewPolicy: "teacher-review-before-knowledge-index",
        queuedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-resource-review-item",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "content" &&
    input.actionSlot === "primary" &&
    input.actionId === "publish-course-content" &&
    input.courseId
  ) {
    return [
      {
        objectId: `course-content-${input.courseId}`,
        objectType: "course-content",
        courseId: input.courseId,
        publishedBy: input.actorId,
        publicationStatus: "published",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        releaseScope: "course-visible-content",
        publishedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-course-content",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "content" &&
    input.actionSlot === "secondary" &&
    input.actionId === "generate-unit-draft" &&
    input.courseId
  ) {
    const draftArtifact = input.artifacts.find(
      (
        artifact,
      ): artifact is {
        kind: "generated-draft";
        artifactId: string;
        status: "ready-for-teacher-review";
      } => artifact.kind === "generated-draft" && "artifactId" in artifact,
    );
    if (!draftArtifact) {
      return [];
    }

    return [
      {
        objectId: `unit-draft-${input.courseId}`,
        objectType: "unit-draft",
        courseId: input.courseId,
        generatedBy: input.actorId,
        draftStatus: "ready-for-teacher-review",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        artifactId: draftArtifact.artifactId,
        reviewPolicy: "teacher-review-before-course-publish",
        generatedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-unit-draft",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "students" &&
    input.actionSlot === "secondary" &&
    input.actionId === "generate-group-suggestions" &&
    input.courseId
  ) {
    const suggestionsArtifact = input.artifacts.find(
      (
        artifact,
      ): artifact is {
        kind: "group-suggestions";
        artifactId: string;
        status: "ready-for-teacher-review";
      } => artifact.kind === "group-suggestions" && "artifactId" in artifact,
    );
    if (!suggestionsArtifact) {
      return [];
    }

    return [
      {
        objectId: `group-suggestions-${input.courseId}`,
        objectType: "group-suggestions",
        courseId: input.courseId,
        generatedBy: input.actorId,
        suggestionStatus: "ready-for-teacher-review",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        artifactId: suggestionsArtifact.artifactId,
        groupingBasis: ["participation", "progress", "collaboration-balance"],
        reviewPolicy: "teacher-review-before-group-assignment",
        generatedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-group-suggestions",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "admins" &&
    input.actionSlot === "secondary" &&
    input.actionId === "send-collaboration-invite" &&
    input.courseId
  ) {
    const outboxArtifact = input.artifacts.find(
      (artifact): artifact is Extract<TeachingOperationArtifact, { kind: "outbox" }> =>
        artifact.kind === "outbox" && artifact.channel === "collaboration-invite",
    );
    if (!outboxArtifact) {
      return [];
    }

    return [
      {
        objectId: `email-notification-${input.courseId}-collaboration-invite`,
        objectType: "email-notification",
        courseId: input.courseId,
        queuedBy: input.actorId,
        notificationStatus: "queued",
        deliveryChannel: "collaboration-invite-email",
        outboxId: outboxArtifact.outboxId,
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        deliveryPolicy: "server-outbox-before-smtp-provider",
        queuedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-email-notification",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "grading" &&
    input.actionSlot === "secondary" &&
    input.actionId === "generate-ai-feedback" &&
    input.courseId
  ) {
    const feedbackArtifact = input.artifacts.find(
      (
        artifact,
      ): artifact is {
        kind: "ai-feedback";
        artifactId: string;
        status: "ready-for-teacher-review";
      } => artifact.kind === "ai-feedback" && "artifactId" in artifact,
    );
    if (!feedbackArtifact) {
      return [];
    }

    return [
      {
        objectId: `ai-feedback-draft-${input.courseId}`,
        objectType: "ai-feedback-draft",
        courseId: input.courseId,
        generatedBy: input.actorId,
        feedbackStatus: "ready-for-teacher-review",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        artifactId: feedbackArtifact.artifactId,
        feedbackScope: "grading-review-queue",
        reviewPolicy: "teacher-review-before-student-release",
        generatedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-ai-feedback-draft",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "grading" &&
    input.actionSlot === "primary" &&
    input.actionId === "save-review-queue" &&
    input.courseId
  ) {
    return [
      {
        objectId: `grading-queue-${input.courseId}`,
        objectType: "grading-queue",
        courseId: input.courseId,
        savedBy: input.actorId,
        queueStatus: "saved",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        reviewPolicy: "teacher-review-before-release",
        savedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-grading-queue",
        redaction: createRedaction(),
      },
      {
        objectId: `gradebook-update-${input.courseId}`,
        objectType: "gradebook-update",
        courseId: input.courseId,
        updatedBy: input.actorId,
        updateStatus: "pending-release",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        releasePolicy: "teacher-confirmed-grade-release",
        updatedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-gradebook-update",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "invite-code" &&
    input.actionSlot === "primary" &&
    input.actionId === "generate-invite-code" &&
    input.courseId
  ) {
    const inviteArtifact = input.artifacts.find(
      (
        artifact,
      ): artifact is Extract<TeachingOperationArtifact, { kind: "invite-code" }> =>
        artifact.kind === "invite-code" && artifact.status === "generated",
    );
    if (!inviteArtifact) {
      return [];
    }

    return [
      {
        objectId: `invite-code-draft-${input.courseId}-${inviteArtifact.code}`,
        objectType: "invite-code-draft",
        courseId: input.courseId,
        inviteCode: inviteArtifact.code,
        joinUrl: inviteArtifact.joinUrl,
        generatedBy: input.actorId,
        draftStatus: "generated",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        invitePolicy: "teacher-review-before-publication",
        generatedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-invite-code-draft",
        redaction: createRedaction(),
      },
    ];
  }
  if (
    input.operationId === "invite-code" &&
    input.actionSlot === "secondary" &&
    input.actionId === "publish-invite-code" &&
    input.courseId
  ) {
    const inviteArtifact = input.artifacts.find(
      (
        artifact,
      ): artifact is Extract<TeachingOperationArtifact, { kind: "invite-code" }> =>
        artifact.kind === "invite-code" && artifact.status === "published",
    );
    if (!inviteArtifact) {
      return [];
    }

    return [
      {
        objectId: `enrollment-access-${input.courseId}-${inviteArtifact.code}`,
        objectType: "enrollment-access",
        courseId: input.courseId,
        inviteCode: inviteArtifact.code,
        joinUrl: inviteArtifact.joinUrl,
        publishedBy: input.actorId,
        publicationStatus: "published",
        operationRecordId: input.recordId,
        ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
        enrollmentPolicy: "teacher-confirmed-course-scope",
        publishedAt: input.createdAt,
        storagePolicy: "domain-projection-teaching-enrollment-access",
        redaction: createRedaction(),
      },
    ];
  }
  return [];
}

function createDomainProjectionArtifact(
  projection: TeachingOperationDomainProjection,
): TeachingOperationArtifact {
  return {
    kind: "domain-object",
    objectType: projection.objectType,
    objectId: projection.objectId,
  };
}

function createExportManifest(input: {
  operationId: TeachingOperationId;
  actorId: string;
  courseId?: string;
  now: Date;
  createdAt: string;
}): TeachingOperationExportManifest {
  return {
    manifestId: `export-manifest-${input.actorId}-${formatTimestampId(input.now)}`,
    operationId: "data-export",
    ...(input.courseId ? { courseId: input.courseId } : {}),
    actorId: input.actorId,
    createdAt: input.createdAt,
    datasets: ["learning-records", "chat-threads", "grades", "activities"],
    formats: ["json", "csv"],
    redactionScope: {
      studentPrivateNotes: "excluded",
      credentials: "excluded",
      localPaths: "excluded",
    },
    redaction: createRedaction(),
  };
}

function createAuditEvent(input: {
  audit: NonNullable<ExecuteTeachingOperationActionInput["audit"]>;
  operationId: TeachingOperationId;
  actionSlot: TeachingOperationActionSlot;
  actionId: TeachingOperationActionId;
  actorId: string;
  courseId?: string;
  sourceAction?: string;
  createdAt: string;
  now: Date;
}): TeachingOperationPersistedAuditEvent {
  return {
    auditId: `audit-${input.operationId}-${input.actionId}-${formatTimestampId(input.now)}`,
    traceId: requireSafeId(input.audit.traceId, "trace id"),
    eventType: "teaching-operation.persisted",
    actorId: input.actorId,
    actorRole: input.audit.actorRole,
    authMode: input.audit.authMode,
    ...(input.audit.authSession
      ? { authSession: normalizeAuditAuthSession(input.audit.authSession) }
      : {}),
    operationId: input.operationId,
    actionSlot: input.actionSlot,
    actionId: input.actionId,
    ...(input.courseId ? { courseId: input.courseId } : {}),
    ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
    requestSource: normalizeAuditRequestSource(input.audit.requestSource),
    createdAt: input.createdAt,
    redaction: createRedaction(),
  };
}

function createGradebookReleaseAuditEvent(input: {
  audit: TeachingGradebookReleaseAuditInput;
  eventType?: TeachingGradebookReleaseAuditEvent["eventType"];
  actorId: string;
  courseId: string;
  gradebookUpdateId: string;
  createdAt: string;
  now: Date;
}): TeachingGradebookReleaseAuditEvent {
  return {
    auditId: `audit-gradebook-release-${input.gradebookUpdateId}-${formatTimestampId(input.now)}`,
    traceId: requireSafeId(input.audit.traceId, "trace id"),
    eventType: input.eventType ?? "teaching-gradebook-update.released",
    actorId: input.actorId,
    actorRole: input.audit.actorRole,
    authMode: input.audit.authMode,
    ...(input.audit.authSession
      ? { authSession: normalizeAuditAuthSession(input.audit.authSession) }
      : {}),
    courseId: input.courseId,
    gradebookUpdateId: input.gradebookUpdateId,
    requestSource: normalizeAuditRequestSource(input.audit.requestSource),
    createdAt: input.createdAt,
    redaction: createRedaction(),
  };
}

function createBackupRestoreAuditEvent(input: {
  audit: TeachingGradebookReleaseAuditInput;
  actorId: string;
  backupId: string;
  impactedCourseIds: string[];
  now: Date;
  createdAt: string;
}): TeachingOperationBackupRestoreAuditEvent {
  return {
    auditId: `audit-teaching-operations-backup-restore-${input.backupId}-${formatTimestampId(
      input.now,
    )}`,
    traceId: input.audit.traceId,
    eventType: "teaching-operations-backup.restored",
    actorId: input.actorId,
    actorRole: input.audit.actorRole,
    authMode: input.audit.authMode,
    ...(input.audit.authSession
      ? { authSession: normalizeAuditAuthSession(input.audit.authSession) }
      : {}),
    backupId: input.backupId,
    impactedCourseIds: input.impactedCourseIds,
    requestSource: input.audit.requestSource,
    createdAt: input.createdAt,
    redaction: createRedaction(),
  };
}

function createTeachingOperationRollbackAuditEvent(input: {
  audit: TeachingGradebookReleaseAuditInput;
  actorId: string;
  record: TeachingOperationRecord;
  rollbackReason: string;
  now: Date;
  createdAt: string;
}): TeachingOperationRollbackAuditEvent {
  if (!input.record.courseId) {
    throw new TeachingOperationStoreError(
      409,
      "Teaching operation record has no course scope.",
    );
  }
  return {
    auditId: `audit-teaching-operation-rollback-${input.record.recordId}-${formatTimestampId(
      input.now,
    )}`,
    traceId: input.audit.traceId,
    eventType: "teaching-operation.rolled-back",
    actorId: input.actorId,
    actorRole: input.audit.actorRole,
    authMode: input.audit.authMode,
    ...(input.audit.authSession
      ? { authSession: normalizeAuditAuthSession(input.audit.authSession) }
      : {}),
    courseId: input.record.courseId,
    targetRecordId: input.record.recordId,
    operationId: input.record.operationId,
    actionSlot: input.record.actionSlot,
    actionId: input.record.actionId,
    rollbackReason: input.rollbackReason,
    requestSource: input.audit.requestSource,
    createdAt: input.createdAt,
    redaction: createRedaction(),
  };
}

function createReceiptAudit(
  event: TeachingOperationPersistedAuditEvent,
  storagePolicy: TeachingOperationAuditStoragePolicy,
): TeachingOperationReceiptAudit {
  return {
    auditId: event.auditId,
    traceId: event.traceId,
    eventType: event.eventType,
    actor: {
      actorId: event.actorId,
      role: event.actorRole,
    },
    authMode: event.authMode,
    ...(event.authSession ? { authSession: event.authSession } : {}),
    requestSource: event.requestSource,
    storagePolicy,
    redaction: createRedaction(),
  };
}

async function writeTeachingOperationDatabase(input: {
  dataDir: string;
  database: TeachingOperationDatabase;
}) {
  await mkdir(input.dataDir, { recursive: true });
  const filePath = resolveDatabasePath(input.dataDir);
  const existingRaw = await readFile(filePath, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    },
  );
  if (existingRaw) {
    await writeTeachingOperationDatabaseBackup({
      dataDir: input.dataDir,
      database: normalizeDatabase(JSON.parse(existingRaw)),
      createdAt: input.database.updatedAt,
    });
  }
  await writeAtomicJsonFile({
    dataDir: input.dataDir,
    filePath,
    fileNamePrefix: "teaching-operations",
    value: input.database,
  });
}

async function writeTeachingOperationDatabaseBackup(input: {
  dataDir: string;
  database: TeachingOperationDatabase;
  createdAt: string;
}) {
  const backupDir = resolve(input.dataDir, "backups");
  ensureWithinBase(input.dataDir, backupDir);
  await mkdir(backupDir, { recursive: true });
  const timestampId = formatTimestampId(new Date(input.createdAt));
  const backupPath = resolve(
    backupDir,
    `teaching-operations-backup-${timestampId}.json`,
  );
  ensureWithinBase(input.dataDir, backupPath);
  const backup: TeachingOperationDatabaseBackup = {
    schemaVersion: "uais-teaching-operations-backup-v1",
    createdAt: input.createdAt,
    sourceFile: "teaching-operations.json",
    reason: "before-atomic-replace",
    responsibleSession: "S12",
    redaction: createRedaction(),
    database: input.database,
  };

  await writeAtomicJsonFile({
    dataDir: input.dataDir,
    filePath: backupPath,
    fileNamePrefix: `teaching-operations-backup-${timestampId}`,
    value: backup,
  });
}

async function writeExportManifest(input: {
  dataDir: string;
  manifest: TeachingOperationExportManifest;
}) {
  const exportsDir = resolve(input.dataDir, "exports");
  ensureWithinBase(input.dataDir, exportsDir);
  await mkdir(exportsDir, { recursive: true });
  const filePath = resolveExportManifestPath(input.dataDir, input.manifest.manifestId);
  await writeAtomicJsonFile({
    dataDir: input.dataDir,
    filePath,
    fileNamePrefix: input.manifest.manifestId,
    value: input.manifest,
  });
}

async function writeAtomicJsonFile(input: {
  dataDir: string;
  filePath: string;
  fileNamePrefix: string;
  value: unknown;
}) {
  ensureWithinBase(input.dataDir, input.filePath);
  const targetDir = resolve(input.filePath, "..");
  ensureWithinBase(input.dataDir, targetDir);
  await mkdir(targetDir, { recursive: true });
  const tempPath = resolve(
    targetDir,
    `.${input.fileNamePrefix}.${Date.now()}.${randomUUID()}.tmp`,
  );
  ensureWithinBase(input.dataDir, tempPath);

  try {
    await writeFile(tempPath, JSON.stringify(input.value, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(tempPath, input.filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function resolveDatabasePath(dataDir: string) {
  const filePath = resolve(dataDir, "teaching-operations.json");
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

function resolveExportManifestPath(dataDir: string, manifestId: string) {
  const safeManifestId = requireSafeId(manifestId, "manifest id");
  const filePath = resolve(dataDir, "exports", `${safeManifestId}.json`);
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

function resolveDatabaseBackupPath(dataDir: string, backupId: string) {
  const safeBackupId = requireSafeId(backupId, "backup id");
  const filePath = resolve(dataDir, "backups", `${safeBackupId}.json`);
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

function createEmptyDatabase(): TeachingOperationDatabase {
  return {
    schemaVersion: "uais-teaching-operations-v1",
    updatedAt: "1970-01-01T00:00:00.000Z",
    records: [],
    auditEvents: [],
    domainProjections: [],
    inviteCodes: [],
    outbox: [],
    exportManifests: [],
  };
}

function normalizeDatabaseBackup(value: unknown): TeachingOperationDatabaseBackup {
  if (
    !isRecord(value) ||
    value.schemaVersion !== "uais-teaching-operations-backup-v1" ||
    value.sourceFile !== "teaching-operations.json" ||
    value.reason !== "before-atomic-replace" ||
    value.responsibleSession !== "S12"
  ) {
    throw new TeachingOperationStoreError(500, "Teaching operation backup is invalid.");
  }

  return {
    schemaVersion: "uais-teaching-operations-backup-v1",
    createdAt: requireIsoDate(value.createdAt, "createdAt"),
    sourceFile: "teaching-operations.json",
    reason: "before-atomic-replace",
    responsibleSession: "S12",
    redaction: createRedaction(),
    database: normalizeDatabase(value.database),
  };
}

function normalizeDatabase(value: unknown): TeachingOperationDatabase {
  if (!isRecord(value) || value.schemaVersion !== "uais-teaching-operations-v1") {
    throw new TeachingOperationStoreError(500, "Teaching operation database is invalid.");
  }

  return {
    schemaVersion: "uais-teaching-operations-v1",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString(),
    records: Array.isArray(value.records)
      ? value.records.map(normalizeRecord)
      : [],
    auditEvents: Array.isArray(value.auditEvents)
      ? value.auditEvents.map(normalizeAuditEvent)
      : [],
    domainProjections: Array.isArray(value.domainProjections)
      ? value.domainProjections.map(normalizeDomainProjection)
      : [],
    inviteCodes: Array.isArray(value.inviteCodes)
      ? value.inviteCodes.map(normalizeInviteCode)
      : [],
    outbox: Array.isArray(value.outbox) ? value.outbox.map(normalizeOutboxRecord) : [],
    exportManifests: Array.isArray(value.exportManifests)
      ? value.exportManifests.map(normalizeExportManifest)
      : [],
  };
}

function normalizeAuditEvent(value: unknown): TeachingOperationAuditEvent {
  if (!isRecord(value)) {
    throw new TeachingOperationStoreError(500, "Teaching operation audit event is invalid.");
  }
  if (value.eventType === "teaching-operations-backup.restored") {
    return {
      auditId: requireSafeId(value.auditId, "audit id"),
      traceId: requireSafeId(value.traceId, "trace id"),
      eventType: "teaching-operations-backup.restored",
      actorId: requireSafeId(value.actorId, "actor id"),
      actorRole: "teacher",
      authMode: "signed-teacher-session",
      ...(value.authSession
        ? { authSession: normalizeAuditAuthSession(value.authSession) }
        : {}),
      backupId: requireSafeId(value.backupId, "backup id"),
      impactedCourseIds: Array.isArray(value.impactedCourseIds)
        ? value.impactedCourseIds.map((courseId) => requireSafeId(courseId, "course id"))
        : [],
      requestSource: normalizeAuditRequestSource(value.requestSource),
      createdAt: requireIsoDate(value.createdAt, "createdAt"),
      redaction: createRedaction(),
    };
  }
  if (
    value.eventType === "teaching-gradebook-update.released" ||
    value.eventType === "teaching-gradebook-update.release-rolled-back"
  ) {
    return {
      auditId: requireSafeId(value.auditId, "audit id"),
      traceId: requireSafeId(value.traceId, "trace id"),
      eventType: value.eventType,
      actorId: requireSafeId(value.actorId, "actor id"),
      actorRole: "teacher",
      authMode: "signed-teacher-session",
      ...(value.authSession
        ? { authSession: normalizeAuditAuthSession(value.authSession) }
        : {}),
      courseId: requireSafeId(value.courseId, "course id"),
      gradebookUpdateId: requireSafeId(value.gradebookUpdateId, "gradebook update id"),
      requestSource: normalizeAuditRequestSource(value.requestSource),
      createdAt: requireIsoDate(value.createdAt, "createdAt"),
      redaction: createRedaction(),
    };
  }
  if (value.eventType === "teaching-operation.rolled-back") {
    const operationId = value.operationId;
    if (typeof operationId !== "string" || !isTeachingOperationId(operationId)) {
      throw new TeachingOperationStoreError(500, "Teaching operation audit event is invalid.");
    }
    const actionSlot = requireActionSlot(value.actionSlot);
    const definition = actionDefinitions[operationId][actionSlot];
    return {
      auditId: requireSafeId(value.auditId, "audit id"),
      traceId: requireSafeId(value.traceId, "trace id"),
      eventType: "teaching-operation.rolled-back",
      actorId: requireSafeId(value.actorId, "actor id"),
      actorRole: "teacher",
      authMode: "signed-teacher-session",
      ...(value.authSession
        ? { authSession: normalizeAuditAuthSession(value.authSession) }
        : {}),
      courseId: requireSafeId(value.courseId, "course id"),
      targetRecordId: requireSafeId(value.targetRecordId, "target record id"),
      operationId,
      actionSlot,
      actionId: definition.actionId,
      rollbackReason: requireSafeId(value.rollbackReason, "rollback reason"),
      requestSource: normalizeAuditRequestSource(value.requestSource),
      createdAt: requireIsoDate(value.createdAt, "createdAt"),
      redaction: createRedaction(),
    };
  }
  if (typeof value.operationId !== "string") {
    throw new TeachingOperationStoreError(500, "Teaching operation audit event is invalid.");
  }
  const operationId = value.operationId;
  if (!isTeachingOperationId(operationId)) {
    throw new TeachingOperationStoreError(500, "Teaching operation audit event is invalid.");
  }
  const actionSlot = requireActionSlot(value.actionSlot);
  const definition = actionDefinitions[operationId][actionSlot];

  return {
    auditId: requireSafeId(value.auditId, "audit id"),
    traceId: requireSafeId(value.traceId, "trace id"),
    eventType: "teaching-operation.persisted",
    actorId: requireSafeId(value.actorId, "actor id"),
    actorRole: "teacher",
    authMode: "signed-teacher-session",
    ...(value.authSession ? { authSession: normalizeAuditAuthSession(value.authSession) } : {}),
    operationId,
    actionSlot,
    actionId: definition.actionId,
    ...(value.courseId ? { courseId: requireSafeId(value.courseId, "course id") } : {}),
    ...(value.sourceAction
      ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
      : {}),
    requestSource: normalizeAuditRequestSource(value.requestSource),
    createdAt: requireIsoDate(value.createdAt, "createdAt"),
    redaction: createRedaction(),
  };
}

function normalizeRecord(value: unknown): TeachingOperationRecord {
  if (!isRecord(value) || typeof value.operationId !== "string") {
    throw new TeachingOperationStoreError(500, "Teaching operation record is invalid.");
  }
  const operationId = value.operationId;
  if (!isTeachingOperationId(operationId)) {
    throw new TeachingOperationStoreError(500, "Teaching operation record is invalid.");
  }
  const actionSlot = requireActionSlot(value.actionSlot);
  const definition = actionDefinitions[operationId][actionSlot];

  return {
    recordId: requireSafeId(value.recordId, "record id"),
    operationId,
    actionSlot,
    actionId: definition.actionId,
    actorId: requireSafeId(value.actorId, "actor id"),
    ...(value.courseId ? { courseId: requireSafeId(value.courseId, "course id") } : {}),
    ...(value.sourceAction
      ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
      : {}),
    ...(value.idempotencyKey
      ? { idempotencyKey: requireSafeId(value.idempotencyKey, "idempotency key") }
      : {}),
    createdAt: requireIsoDate(value.createdAt, "createdAt"),
    status: "persisted",
    ...(isPositiveInteger(value.appendSequence)
      ? { appendSequence: value.appendSequence }
      : {}),
    storagePolicy: "local-json-teaching-operation-database",
    redaction: createRedaction(),
    artifacts: Array.isArray(value.artifacts)
      ? value.artifacts.map(normalizeArtifact)
      : [],
    ...(Array.isArray(value.domainProjections)
      ? { domainProjections: value.domainProjections.map(normalizeDomainProjection) }
      : {}),
  };
}

export function normalizeExternalTeachingOperationAuditReadbackRecord(
  value: unknown,
): TeachingOperationRecord {
  const record = normalizeRecord(value);
  return {
    ...record,
    storagePolicy: "external-redacted-teaching-operation-append",
  };
}

export function normalizeTeachingOperationAuditReadbackEvent(
  value: unknown,
): TeachingOperationAuditEvent {
  return normalizeAuditEvent(value);
}

export function normalizeTeachingOperationAuditReadbackDomainProjection(
  value: unknown,
): TeachingOperationDomainProjection {
  return normalizeDomainProjection(value);
}

function normalizeDomainProjection(value: unknown): TeachingOperationDomainProjection {
  if (!isRecord(value)) {
    throw new TeachingOperationStoreError(500, "Teaching operation domain projection is invalid.");
  }
  if (value.objectType === "agent-plan") {
    return {
      objectId: requireSafeId(value.objectId, "domain object id"),
      objectType: "agent-plan",
      courseId: requireSafeId(value.courseId, "course id"),
      savedBy: requireSafeId(value.savedBy, "saved by"),
      planStatus: "saved",
      operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
      ...(value.sourceAction
        ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
        : {}),
      enabledAgents: ["research-assistant", "math-coach", "writing-mentor"],
      governancePolicy: "teacher-reviewed-agent-plan",
      savedAt: requireIsoDate(value.savedAt, "savedAt"),
      storagePolicy: "domain-projection-teaching-agent-plan",
      redaction: createRedaction(),
    };
  }
  if (value.objectType === "dashboard-state") {
    return {
      objectId: requireSafeId(value.objectId, "domain object id"),
      objectType: "dashboard-state",
      courseId: requireSafeId(value.courseId, "course id"),
      refreshedBy: requireSafeId(value.refreshedBy, "refreshed by"),
      refreshStatus: "refreshed",
      operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
      ...(value.sourceAction
        ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
        : {}),
      visibleMetrics: ["engagement", "progress", "assessment-quality"],
      refreshPolicy: "teacher-visible-course-dashboard",
      refreshedAt: requireIsoDate(value.refreshedAt, "refreshedAt"),
      storagePolicy: "domain-projection-teaching-dashboard-state",
      redaction: createRedaction(),
    };
  }
  if (value.objectType === "admin-settings") {
    return {
      objectId: requireSafeId(value.objectId, "domain object id"),
      objectType: "admin-settings",
      courseId: requireSafeId(value.courseId, "course id"),
      savedBy: requireSafeId(value.savedBy, "saved by"),
      settingsStatus: "saved",
      operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
      ...(value.sourceAction
        ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
        : {}),
      adminScopes: ["course-collaborators", "permission-boundary", "audit-routing"],
      governancePolicy: "teacher-controlled-admin-settings",
      savedAt: requireIsoDate(value.savedAt, "savedAt"),
      storagePolicy: "domain-projection-teaching-admin-settings",
      redaction: createRedaction(),
    };
  }
  if (value.objectType === "quiz-board-state") {
    return {
      objectId: requireSafeId(value.objectId, "domain object id"),
      objectType: "quiz-board-state",
      courseId: requireSafeId(value.courseId, "course id"),
      refreshedBy: requireSafeId(value.refreshedBy, "refreshed by"),
      refreshStatus: "refreshed",
      operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
      ...(value.sourceAction
        ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
        : {}),
      visibleMetrics: ["completion-rate", "item-quality", "misconception-clusters"],
      reviewPolicy: "teacher-visible-quiz-quality-board",
      refreshedAt: requireIsoDate(value.refreshedAt, "refreshedAt"),
      storagePolicy: "domain-projection-teaching-quiz-board-state",
      redaction: createRedaction(),
    };
  }
  if (value.objectType === "resource-review-item") {
    return {
      objectId: requireSafeId(value.objectId, "domain object id"),
      objectType: "resource-review-item",
      courseId: requireSafeId(value.courseId, "course id"),
      queuedBy: requireSafeId(value.queuedBy, "queued by"),
      reviewStatus: "pending-teacher-review",
      operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
      ...(value.sourceAction
        ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
        : {}),
      resourceSource: "teacher-placeholder",
      reviewPolicy: "teacher-review-before-knowledge-index",
      queuedAt: requireIsoDate(value.queuedAt, "queuedAt"),
      storagePolicy: "domain-projection-teaching-resource-review-item",
      redaction: createRedaction(),
    };
  }
  if (value.objectType === "unit-draft") {
    return {
      objectId: requireSafeId(value.objectId, "domain object id"),
      objectType: "unit-draft",
      courseId: requireSafeId(value.courseId, "course id"),
      generatedBy: requireSafeId(value.generatedBy, "generated by"),
      draftStatus: "ready-for-teacher-review",
      operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
      ...(value.sourceAction
        ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
        : {}),
      artifactId: requireSafeId(value.artifactId, "artifact id"),
      reviewPolicy: "teacher-review-before-course-publish",
      generatedAt: requireIsoDate(value.generatedAt, "generatedAt"),
      storagePolicy: "domain-projection-teaching-unit-draft",
      redaction: createRedaction(),
    };
  }
  if (value.objectType === "group-suggestions") {
    return {
      objectId: requireSafeId(value.objectId, "domain object id"),
      objectType: "group-suggestions",
      courseId: requireSafeId(value.courseId, "course id"),
      generatedBy: requireSafeId(value.generatedBy, "generated by"),
      suggestionStatus: "ready-for-teacher-review",
      operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
      ...(value.sourceAction
        ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
        : {}),
      artifactId: requireSafeId(value.artifactId, "artifact id"),
      groupingBasis: ["participation", "progress", "collaboration-balance"],
      reviewPolicy: "teacher-review-before-group-assignment",
      generatedAt: requireIsoDate(value.generatedAt, "generatedAt"),
      storagePolicy: "domain-projection-teaching-group-suggestions",
      redaction: createRedaction(),
    };
  }
  if (value.objectType === "ai-feedback-draft") {
    return {
      objectId: requireSafeId(value.objectId, "domain object id"),
      objectType: "ai-feedback-draft",
      courseId: requireSafeId(value.courseId, "course id"),
      generatedBy: requireSafeId(value.generatedBy, "generated by"),
      feedbackStatus: "ready-for-teacher-review",
      operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
      ...(value.sourceAction
        ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
        : {}),
      artifactId: requireSafeId(value.artifactId, "artifact id"),
      feedbackScope: "grading-review-queue",
      reviewPolicy: "teacher-review-before-student-release",
      generatedAt: requireIsoDate(value.generatedAt, "generatedAt"),
      storagePolicy: "domain-projection-teaching-ai-feedback-draft",
      redaction: createRedaction(),
    };
  }
  if (value.objectType === "dashboard-snapshot") {
    return {
      objectId: requireSafeId(value.objectId, "domain object id"),
      objectType: "dashboard-snapshot",
      courseId: requireSafeId(value.courseId, "course id"),
      lockedBy: requireSafeId(value.lockedBy, "locked by"),
      snapshotStatus: "locked",
      operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
      ...(value.sourceAction
        ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
        : {}),
      snapshotId: requireSafeId(value.snapshotId, "snapshot id"),
      snapshotScope: "daily-course-dashboard",
      retentionPolicy: "teacher-locked-dashboard-snapshot",
      lockedAt: requireIsoDate(value.lockedAt, "lockedAt"),
      storagePolicy: "domain-projection-teaching-dashboard-snapshot",
      redaction: createRedaction(),
    };
  }
  if (value.objectType === "quiz-item-review") {
    return {
      objectId: requireSafeId(value.objectId, "domain object id"),
      objectType: "quiz-item-review",
      courseId: requireSafeId(value.courseId, "course id"),
      flaggedBy: requireSafeId(value.flaggedBy, "flagged by"),
      reviewStatus: "flagged-for-review",
      operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
      ...(value.sourceAction
        ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
        : {}),
      flaggedSignals: ["low-discrimination", "high-error-rate", "teacher-review-needed"],
      reviewPolicy: "teacher-review-before-quiz-reuse",
      flaggedAt: requireIsoDate(value.flaggedAt, "flaggedAt"),
      storagePolicy: "domain-projection-teaching-quiz-item-review",
      redaction: createRedaction(),
    };
  }
  if (value.objectType === "export-manifest") {
    return {
      objectId: requireSafeId(value.objectId, "domain object id"),
      objectType: "export-manifest",
      courseId: requireSafeId(value.courseId, "course id"),
      createdBy: requireSafeId(value.createdBy, "created by"),
      exportStatus: "generated",
      operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
      ...(value.sourceAction
        ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
        : {}),
      manifestId: requireSafeId(value.manifestId, "manifest id"),
      datasetScopes: ["learning-records", "chat-threads", "grades", "activities"],
      exportPolicy: "redacted-teacher-export-manifest",
      createdAt: requireIsoDate(value.createdAt, "createdAt"),
      storagePolicy: "domain-projection-teaching-export-manifest",
      redaction: createRedaction(),
    };
  }
  if (value.objectType === "redaction-validation") {
    return {
      objectId: requireSafeId(value.objectId, "domain object id"),
      objectType: "redaction-validation",
      courseId: requireSafeId(value.courseId, "course id"),
      validatedBy: requireSafeId(value.validatedBy, "validated by"),
      validationStatus: "passed",
      operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
      ...(value.sourceAction
        ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
        : {}),
      checkedScopes: ["student-private-notes", "credentials", "local-paths"],
      validationPolicy: "exclude-private-and-secret-fields",
      validatedAt: requireIsoDate(value.validatedAt, "validatedAt"),
      storagePolicy: "domain-projection-teaching-redaction-validation",
      redaction: createRedaction(),
    };
  }
  if (value.objectType === "student-preview-session") {
    return {
      objectId: requireSafeId(value.objectId, "domain object id"),
      objectType: "student-preview-session",
      courseId: requireSafeId(value.courseId, "course id"),
      previewedBy: requireSafeId(value.previewedBy, "previewed by"),
      previewStatus: "generated",
      operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
      ...(value.sourceAction
        ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
        : {}),
      previewId: requireSafeId(value.previewId, "preview id"),
      previewUrl: requireSafeUrlPath(value.previewUrl, "preview url"),
      previewScope: "teacher-course-preview",
      previewPolicy: "teacher-visible-preview-only",
      generatedAt: requireIsoDate(value.generatedAt, "generatedAt"),
      storagePolicy: "domain-projection-teaching-student-preview-session",
      redaction: createRedaction(),
    };
  }
  if (value.objectType === "permission-preflight") {
    return {
      objectId: requireSafeId(value.objectId, "domain object id"),
      objectType: "permission-preflight",
      courseId: requireSafeId(value.courseId, "course id"),
      checkedBy: requireSafeId(value.checkedBy, "checked by"),
      preflightStatus: "passed",
      operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
      ...(value.sourceAction
        ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
        : {}),
      checkedPermissions: ["course-bindings", "agent-roles", "student-access"],
      preflightPolicy: "teacher-agent-permission-gate",
      checkedAt: requireIsoDate(value.checkedAt, "checkedAt"),
      storagePolicy: "domain-projection-teaching-permission-preflight",
      redaction: createRedaction(),
    };
  }
  if (value.objectType === "student-roster") {
    return {
      objectId: requireSafeId(value.objectId, "domain object id"),
      objectType: "student-roster",
      courseId: requireSafeId(value.courseId, "course id"),
      syncedBy: requireSafeId(value.syncedBy, "synced by"),
      syncStatus: "synced",
      operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
      ...(value.sourceAction
        ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
        : {}),
      sourceSystems: ["sis-roster", "invite-code-joins", "withdrawals"],
      pendingTeacherReviewCount: 3,
      syncedAt: requireIsoDate(value.syncedAt, "syncedAt"),
      storagePolicy: "domain-projection-teaching-student-roster",
      redaction: createRedaction(),
    };
  }
  if (value.objectType === "invite-code-draft") {
    return {
      objectId: requireSafeId(value.objectId, "domain object id"),
      objectType: "invite-code-draft",
      courseId: requireSafeId(value.courseId, "course id"),
      inviteCode: requireInviteCode(value.inviteCode),
      joinUrl: requireSafeUrlPath(value.joinUrl, "join url"),
      generatedBy: requireSafeId(value.generatedBy, "generated by"),
      draftStatus: "generated",
      operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
      ...(value.sourceAction
        ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
        : {}),
      invitePolicy: "teacher-review-before-publication",
      generatedAt: requireIsoDate(value.generatedAt, "generatedAt"),
      storagePolicy: "domain-projection-teaching-invite-code-draft",
      redaction: createRedaction(),
    };
  }
  if (value.objectType === "enrollment-access") {
    return {
      objectId: requireSafeId(value.objectId, "domain object id"),
      objectType: "enrollment-access",
      courseId: requireSafeId(value.courseId, "course id"),
      inviteCode: requireInviteCode(value.inviteCode),
      joinUrl: requireSafeUrlPath(value.joinUrl, "join url"),
      publishedBy: requireSafeId(value.publishedBy, "published by"),
      publicationStatus: "published",
      operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
      ...(value.sourceAction
        ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
        : {}),
      enrollmentPolicy: "teacher-confirmed-course-scope",
      publishedAt: requireIsoDate(value.publishedAt, "publishedAt"),
      storagePolicy: "domain-projection-teaching-enrollment-access",
      redaction: createRedaction(),
    };
  }
  if (value.objectType === "knowledge-index") {
    return {
      objectId: requireSafeId(value.objectId, "domain object id"),
      objectType: "knowledge-index",
      courseId: requireSafeId(value.courseId, "course id"),
      syncedBy: requireSafeId(value.syncedBy, "synced by"),
      syncStatus: "synced",
      operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
      ...(value.sourceAction
        ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
        : {}),
      sourceSystems: ["course-files", "teacher-resources", "agent-grounding-index"],
      syncedAt: requireIsoDate(value.syncedAt, "syncedAt"),
      storagePolicy: "domain-projection-teaching-knowledge-index",
      redaction: createRedaction(),
    };
  }
  if (value.objectType === "course-content") {
    return {
      objectId: requireSafeId(value.objectId, "domain object id"),
      objectType: "course-content",
      courseId: requireSafeId(value.courseId, "course id"),
      publishedBy: requireSafeId(value.publishedBy, "published by"),
      publicationStatus: "published",
      operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
      ...(value.sourceAction
        ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
        : {}),
      releaseScope: "course-visible-content",
      publishedAt: requireIsoDate(value.publishedAt, "publishedAt"),
      storagePolicy: "domain-projection-teaching-course-content",
      redaction: createRedaction(),
    };
  }
  if (value.objectType === "grading-queue") {
    return {
      objectId: requireSafeId(value.objectId, "domain object id"),
      objectType: "grading-queue",
      courseId: requireSafeId(value.courseId, "course id"),
      savedBy: requireSafeId(value.savedBy, "saved by"),
      queueStatus: "saved",
      operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
      ...(value.sourceAction
        ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
        : {}),
      reviewPolicy: "teacher-review-before-release",
      savedAt: requireIsoDate(value.savedAt, "savedAt"),
      storagePolicy: "domain-projection-teaching-grading-queue",
      redaction: createRedaction(),
    };
  }
  if (value.objectType === "gradebook-update") {
    return {
      objectId: requireSafeId(value.objectId, "domain object id"),
      objectType: "gradebook-update",
      courseId: requireSafeId(value.courseId, "course id"),
      updatedBy: requireSafeId(value.updatedBy, "updated by"),
      updateStatus:
        value.updateStatus === "release-rolled-back"
          ? "release-rolled-back"
          : value.updateStatus === "released"
            ? "released"
            : "pending-release",
      operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
      ...(value.sourceAction
        ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
        : {}),
      releasePolicy: "teacher-confirmed-grade-release",
      updatedAt: requireIsoDate(value.updatedAt, "updatedAt"),
      ...(value.releasedBy
        ? { releasedBy: requireSafeId(value.releasedBy, "released by") }
        : {}),
      ...(value.releasedAt ? { releasedAt: requireIsoDate(value.releasedAt, "releasedAt") } : {}),
      ...(value.providerStatus === "gradebook-provider-released"
        ? { providerStatus: "gradebook-provider-released" as const }
        : {}),
      ...(value.providerReleaseId
        ? { providerReleaseId: requireSafeId(value.providerReleaseId, "provider release id") }
        : {}),
      ...(value.providerReleasedAt
        ? { providerReleasedAt: requireIsoDate(value.providerReleasedAt, "providerReleasedAt") }
        : {}),
      ...(value.releaseRolledBackBy
        ? { releaseRolledBackBy: requireSafeId(value.releaseRolledBackBy, "release rolled back by") }
        : {}),
      ...(value.releaseRolledBackAt
        ? { releaseRolledBackAt: requireIsoDate(value.releaseRolledBackAt, "releaseRolledBackAt") }
        : {}),
      ...(value.providerRollbackStatus === "gradebook-provider-release-rolled-back"
        ? { providerRollbackStatus: "gradebook-provider-release-rolled-back" as const }
        : {}),
      ...(value.providerRollbackId
        ? { providerRollbackId: requireSafeId(value.providerRollbackId, "provider rollback id") }
        : {}),
      ...(value.providerRolledBackAt
        ? { providerRolledBackAt: requireIsoDate(value.providerRolledBackAt, "providerRolledBackAt") }
        : {}),
      storagePolicy: "domain-projection-teaching-gradebook-update",
      redaction: createRedaction(),
    };
  }
  if (value.objectType === "email-notification") {
    return {
      objectId: requireSafeId(value.objectId, "domain object id"),
      objectType: "email-notification",
      courseId: requireSafeId(value.courseId, "course id"),
      queuedBy: requireSafeId(value.queuedBy, "queued by"),
      notificationStatus: "queued",
      deliveryChannel: "collaboration-invite-email",
      outboxId: requireSafeId(value.outboxId, "outbox id"),
      operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
      ...(value.sourceAction
        ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
        : {}),
      deliveryPolicy: "server-outbox-before-smtp-provider",
      queuedAt: requireIsoDate(value.queuedAt, "queuedAt"),
      storagePolicy: "domain-projection-teaching-email-notification",
      redaction: createRedaction(),
    };
  }
  if (value.objectType === "grade-release-rollback-notification") {
    return {
      objectId: requireSafeId(value.objectId, "domain object id"),
      objectType: "grade-release-rollback-notification",
      courseId: requireSafeId(value.courseId, "course id"),
      gradebookUpdateId: requireSafeId(value.gradebookUpdateId, "gradebook update id"),
      queuedBy: requireSafeId(value.queuedBy, "queued by"),
      notificationStatus: "queued",
      deliveryChannel: "student-grade-release-rollback-notification",
      operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
      ...(value.sourceAction
        ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
        : {}),
      deliveryPolicy: "teacher-confirmed-grade-release-rollback-before-student-notification",
      queuedAt: requireIsoDate(value.queuedAt, "queuedAt"),
      storagePolicy: "domain-projection-teaching-grade-release-rollback-notification",
      redaction: createRedaction(),
    };
  }
  if (value.objectType === "grade-release-notification") {
    return {
      objectId: requireSafeId(value.objectId, "domain object id"),
      objectType: "grade-release-notification",
      courseId: requireSafeId(value.courseId, "course id"),
      gradebookUpdateId: requireSafeId(value.gradebookUpdateId, "gradebook update id"),
      queuedBy: requireSafeId(value.queuedBy, "queued by"),
      notificationStatus: "queued",
      deliveryChannel: "student-grade-release-notification",
      operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
      ...(value.sourceAction
        ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
        : {}),
      deliveryPolicy: "teacher-confirmed-grade-release-before-student-notification",
      queuedAt: requireIsoDate(value.queuedAt, "queuedAt"),
      storagePolicy: "domain-projection-teaching-grade-release-notification",
      redaction: createRedaction(),
    };
  }
  if (value.objectType === "operation-rollback") {
    const targetOperationId = value.targetOperationId;
    if (typeof targetOperationId !== "string" || !isTeachingOperationId(targetOperationId)) {
      throw new TeachingOperationStoreError(500, "Teaching operation domain projection is invalid.");
    }
    const targetActionSlot = requireActionSlot(value.targetActionSlot);
    const definition = actionDefinitions[targetOperationId][targetActionSlot];
    return {
      objectId: requireSafeId(value.objectId, "domain object id"),
      objectType: "operation-rollback",
      courseId: requireSafeId(value.courseId, "course id"),
      targetRecordId: requireSafeId(value.targetRecordId, "target record id"),
      targetOperationId,
      targetActionSlot,
      targetActionId: definition.actionId,
      rollbackStatus: "rolled-back",
      rollbackReason: requireSafeId(value.rollbackReason, "rollback reason"),
      rolledBackBy: requireSafeId(value.rolledBackBy, "rolled back by"),
      rolledBackAt: requireIsoDate(value.rolledBackAt, "rolledBackAt"),
      storagePolicy: "domain-projection-teaching-operation-rollback",
      redaction: createRedaction(),
    };
  }
  if (value.objectType !== "course-settings") {
    throw new TeachingOperationStoreError(500, "Teaching operation domain projection is invalid.");
  }
  return {
    objectId: requireSafeId(value.objectId, "domain object id"),
    objectType: "course-settings",
    courseId: requireSafeId(value.courseId, "course id"),
    updatedBy: requireSafeId(value.updatedBy, "updated by"),
    status: "saved",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction
      ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
      : {}),
    ...normalizeCourseSettingsPatchProjectionSnapshot(value),
    updatedAt: requireIsoDate(value.updatedAt, "updatedAt"),
    storagePolicy: "domain-projection-teaching-course-settings",
    redaction: createRedaction(),
  };
}

function normalizeInviteCode(value: unknown): TeachingOperationInviteCodeRecord {
  if (!isRecord(value) || value.operationId !== "invite-code") {
    throw new TeachingOperationStoreError(500, "Invite code record is invalid.");
  }

  return {
    inviteId: requireSafeId(value.inviteId, "invite id"),
    operationId: "invite-code",
    code: requireInviteCode(value.code),
    status: value.status === "published" ? "published" : "generated",
    ...(value.courseId ? { courseId: requireSafeId(value.courseId, "course id") } : {}),
    actorId: requireSafeId(value.actorId, "actor id"),
    createdAt: requireIsoDate(value.createdAt, "createdAt"),
  };
}

function normalizeOutboxRecord(value: unknown): TeachingOperationOutboxRecord {
  if (!isRecord(value) || value.operationId !== "admins") {
    throw new TeachingOperationStoreError(500, "Outbox record is invalid.");
  }

  return {
    outboxId: requireSafeId(value.outboxId, "outbox id"),
    operationId: "admins",
    channel: "collaboration-invite",
    deliveryStatus: "sent-to-local-outbox",
    ...(value.courseId ? { courseId: requireSafeId(value.courseId, "course id") } : {}),
    actorId: requireSafeId(value.actorId, "actor id"),
    createdAt: requireIsoDate(value.createdAt, "createdAt"),
  };
}

function normalizeExportManifest(value: unknown): TeachingOperationExportManifest {
  if (!isRecord(value) || value.operationId !== "data-export") {
    throw new TeachingOperationStoreError(500, "Export manifest is invalid.");
  }

  return {
    manifestId: requireSafeId(value.manifestId, "manifest id"),
    operationId: "data-export",
    ...(value.courseId ? { courseId: requireSafeId(value.courseId, "course id") } : {}),
    actorId: requireSafeId(value.actorId, "actor id"),
    createdAt: requireIsoDate(value.createdAt, "createdAt"),
    datasets: Array.isArray(value.datasets)
      ? value.datasets.map((item) => requireSafeId(item, "dataset id"))
      : [],
    formats: Array.isArray(value.formats)
      ? value.formats.map((item) => requireSafeId(item, "format id"))
      : [],
    redactionScope: {
      studentPrivateNotes: "excluded",
      credentials: "excluded",
      localPaths: "excluded",
    },
    redaction: createRedaction(),
  };
}

function normalizeArtifact(value: unknown): TeachingOperationArtifact {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new TeachingOperationStoreError(500, "Teaching operation artifact is invalid.");
  }

  if (value.kind === "database-record") {
    return {
      kind: "database-record",
      table: requireSafeId(value.table, "table"),
      recordId: requireSafeId(value.recordId, "record id"),
    };
  }
  if (value.kind === "student-preview") {
    return {
      kind: "student-preview",
      previewId: requireSafeId(value.previewId, "preview id"),
      previewUrl: requireSafeUrlPath(value.previewUrl, "preview url"),
    };
  }
  if (value.kind === "preflight") {
    return {
      kind: "preflight",
      status: "passed",
      checkedPermissions: Array.isArray(value.checkedPermissions)
        ? value.checkedPermissions.map((item) => requireSafeId(item, "permission id"))
        : [],
    };
  }
  if (value.kind === "export-file") {
    return {
      kind: "export-file",
      manifestId: requireSafeId(value.manifestId, "manifest id"),
      downloadUrl: requireSafeUrlPath(value.downloadUrl, "download url"),
      contentType: "application/json",
    };
  }
  if (value.kind === "outbox") {
    return {
      kind: "outbox",
      outboxId: requireSafeId(value.outboxId, "outbox id"),
      channel: "collaboration-invite",
      deliveryStatus: "sent-to-local-outbox",
    };
  }
  if (value.kind === "invite-code") {
    return {
      kind: "invite-code",
      code: requireInviteCode(value.code),
      status: value.status === "published" ? "published" : "generated",
      joinUrl: requireSafeUrlPath(value.joinUrl, "join url"),
    };
  }
  if (value.kind === "dashboard-snapshot") {
    return {
      kind: "dashboard-snapshot",
      snapshotId: requireSafeId(value.snapshotId, "snapshot id"),
      status: "locked",
    };
  }
  if (value.kind === "redaction-check") {
    return {
      kind: "redaction-check",
      status: "passed",
      checkedScopes: Array.isArray(value.checkedScopes)
        ? value.checkedScopes.map((item) => requireSafeId(item, "redaction scope"))
        : [],
    };
  }
  if (
    value.kind === "generated-draft" ||
    value.kind === "group-suggestions" ||
    value.kind === "ai-feedback"
  ) {
    return {
      kind: value.kind,
      artifactId: requireSafeId(value.artifactId, "artifact id"),
      status: "ready-for-teacher-review",
    };
  }
  if (value.kind === "domain-object") {
    let objectType: TeachingOperationDomainObjectType;
    if (value.objectType === "course-settings") {
      objectType = "course-settings";
    } else if (value.objectType === "student-preview-session") {
      objectType = "student-preview-session";
    } else if (value.objectType === "agent-plan") {
      objectType = "agent-plan";
    } else if (value.objectType === "permission-preflight") {
      objectType = "permission-preflight";
    } else if (value.objectType === "dashboard-state") {
      objectType = "dashboard-state";
    } else if (value.objectType === "admin-settings") {
      objectType = "admin-settings";
    } else if (value.objectType === "quiz-board-state") {
      objectType = "quiz-board-state";
    } else if (value.objectType === "resource-review-item") {
      objectType = "resource-review-item";
    } else if (value.objectType === "unit-draft") {
      objectType = "unit-draft";
    } else if (value.objectType === "group-suggestions") {
      objectType = "group-suggestions";
    } else if (value.objectType === "ai-feedback-draft") {
      objectType = "ai-feedback-draft";
    } else if (value.objectType === "dashboard-snapshot") {
      objectType = "dashboard-snapshot";
    } else if (value.objectType === "quiz-item-review") {
      objectType = "quiz-item-review";
    } else if (value.objectType === "export-manifest") {
      objectType = "export-manifest";
    } else if (value.objectType === "redaction-validation") {
      objectType = "redaction-validation";
    } else if (value.objectType === "student-roster") {
      objectType = "student-roster";
    } else if (value.objectType === "invite-code-draft") {
      objectType = "invite-code-draft";
    } else if (value.objectType === "enrollment-access") {
      objectType = "enrollment-access";
    } else if (value.objectType === "knowledge-index") {
      objectType = "knowledge-index";
    } else if (value.objectType === "course-content") {
      objectType = "course-content";
    } else if (value.objectType === "grading-queue") {
      objectType = "grading-queue";
    } else if (value.objectType === "gradebook-update") {
      objectType = "gradebook-update";
    } else if (value.objectType === "email-notification") {
      objectType = "email-notification";
    } else if (value.objectType === "grade-release-notification") {
      objectType = "grade-release-notification";
    } else if (value.objectType === "grade-release-rollback-notification") {
      objectType = "grade-release-rollback-notification";
    } else {
      throw new TeachingOperationStoreError(500, "Teaching operation domain artifact is invalid.");
    }
    return {
      kind: "domain-object",
      objectType,
      objectId: requireSafeId(value.objectId, "domain object id"),
    };
  }

  throw new TeachingOperationStoreError(500, "Teaching operation artifact kind is invalid.");
}

function requireActionSlot(value: unknown): TeachingOperationActionSlot {
  if (value === "primary" || value === "secondary") {
    return value;
  }
  throw new TeachingOperationStoreError(500, "Teaching operation action slot is invalid.");
}

function requireInviteCode(value: unknown) {
  if (typeof value !== "string" || !/^\d{8}$/.test(value)) {
    throw new TeachingOperationStoreError(500, "Invite code is invalid.");
  }
  return value;
}

function requireSafeId(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maxSafeIdLength ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)
  ) {
    throw new TeachingOperationStoreError(400, `Invalid ${label}.`);
  }
  return value;
}

function requireSafeUrlPath(value: unknown, label: string) {
  if (typeof value !== "string" || !value.startsWith("/") || value.includes("/Users/")) {
    throw new TeachingOperationStoreError(500, `Invalid ${label}.`);
  }
  return value;
}

function requireIsoDate(value: unknown, label: string) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new TeachingOperationStoreError(500, `Invalid ${label}.`);
  }
  return value;
}

function normalizeAuditRequestSource(value: unknown): TeachingOperationAuditRequestSource {
  if (!isRecord(value)) {
    return {
      userAgent: "unknown",
      ipAddress: "redacted",
    };
  }

  return {
    userAgent: requireSafeAuditSourceText(value.userAgent, "user agent"),
    ipAddress: "redacted",
    ...(typeof value.originClass === "string"
      ? { originClass: requireAuditOriginClass(value.originClass) }
      : {}),
    ...(typeof value.refererPath === "string"
      ? { refererPath: requireSafeAuditSourceText(value.refererPath, "referer path") }
      : {}),
  };
}

function requireAuditOriginClass(value: string): TeachingOperationAuditRequestSource["originClass"] {
  if (
    value === "remote-https" ||
    value === "local-loopback" ||
    value === "non-https" ||
    value === "unknown"
  ) {
    return value;
  }
  return "unknown";
}

function normalizeAuditAuthSession(value: unknown): TeachingOperationAuditAuthSession {
  if (!isRecord(value)) {
    throw new TeachingOperationStoreError(500, "Teaching operation audit auth session is invalid.");
  }

  return {
    sessionId: requireSafeId(value.sessionId, "auth session id"),
    authenticatedAt: requireIsoDate(value.authenticatedAt, "authenticatedAt"),
    expiresAt: requireIsoDate(value.expiresAt, "expiresAt"),
  };
}

function normalizeCourseSettingsPatchProjectionSnapshot(value: unknown) {
  if (!isRecord(value)) {
    return {};
  }

  const snapshot: Partial<
    Pick<
      TeachingOperationCourseSettingsProjection,
      | "appliedFields"
      | "courseName"
      | "instructor"
      | "unit"
      | "department"
      | "semester"
      | "description"
    >
  > = {};
  const appliedFields: TeachingOperationCourseSettingsAppliedField[] = [];
  for (const field of [
    "courseName",
    "instructor",
    "unit",
    "department",
    "semester",
    "description",
  ] as const) {
    const text = normalizeCourseSettingsProjectionText(value[field]);
    if (!text) {
      continue;
    }
    snapshot[field] = text;
    appliedFields.push(field);
  }
  if (appliedFields.length > 0) {
    snapshot.appliedFields = appliedFields;
  }
  return snapshot;
}

function normalizeCourseSettingsProjectionText(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }
  const text = value.trim();
  if (!text) {
    return undefined;
  }
  return text.slice(0, 500);
}

function requireSafeAuditSourceText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    return "unknown";
  }
  const normalized = value.trim().slice(0, 160);
  if (/\/Users\/|secret|api[_-]?key|token/i.test(normalized)) {
    throw new TeachingOperationStoreError(400, `Invalid ${label}.`);
  }
  return normalized;
}

function isTeachingOperationIdempotencyStatus(
  value: unknown,
): value is TeachingOperationIdempotencyStatus {
  return value === "created" || value === "already-persisted";
}

function createNextInviteCode(database: TeachingOperationDatabase) {
  const previous = database.inviteCodes.at(-1)?.code ?? firstInviteCode;
  return String(Number(previous) + 1).padStart(8, "0");
}

function createIdempotentRecordId(actorId: string, idempotencyKey: string) {
  const digest = createHash("sha256")
    .update(actorId)
    .update("\0")
    .update(idempotencyKey)
    .digest("hex")
    .slice(0, 24);
  return `teaching-operation-idempotent-${digest}`;
}

function createRecordId(
  operationId: TeachingOperationId,
  actionId: TeachingOperationActionId,
  now: Date,
) {
  return `${operationId}-${actionId}-${formatTimestampId(now)}-${randomUUID().slice(0, 8)}`;
}

function formatTimestampId(now: Date) {
  const [datePart, timePart = ""] = now.toISOString().split("T");
  return `${datePart.replace(/-/g, "")}-${timePart.slice(0, 8).replace(/:/g, "")}`;
}

function ensureWithinBase(baseDir: string, targetPath: string) {
  if (targetPath !== baseDir && !targetPath.startsWith(`${baseDir}/`)) {
    throw new TeachingOperationStoreError(
      400,
      "Resolved teaching operation path escapes the configured data directory.",
    );
  }
}

function createRedaction(): TeachingOperationRedaction {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
