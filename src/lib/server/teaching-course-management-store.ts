import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { cwd } from "node:process";
import {
  createTeachingCourseId,
  isProvisionalTeachingCourseIdForActor,
} from "@/lib/teaching-course-id";

type TeachingCourseManagementRedaction = {
  secrets: "omitted";
  localFiles: "omitted";
  assets: "ids-only";
};

export type TeachingCourseManagementRecordStoragePolicy =
  | "local-json-teaching-course-management"
  | "external-redacted-teaching-course-management-snapshot";

export type TeachingCourseManagementAuditStoragePolicy =
  | "local-json-teaching-course-management-audit-log"
  | "external-redacted-teaching-course-management-audit-log";

export type TeachingCourseManagementStorageWritePolicy =
  | "atomic-json-file-replace"
  | "external-optimistic-snapshot-replace";

export type TeachingCourseManagementStorageDescriptor = {
  recordStoragePolicy: TeachingCourseManagementRecordStoragePolicy;
  auditStoragePolicy: TeachingCourseManagementAuditStoragePolicy;
  storageWritePolicy: TeachingCourseManagementStorageWritePolicy;
};

export type TeachingCourseManagementRepositorySnapshot = {
  database: TeachingCourseManagementDatabase;
  revision?: string;
};

export type TeachingCourseManagementRepository = {
  storage: TeachingCourseManagementStorageDescriptor;
  read: () => Promise<TeachingCourseManagementRepositorySnapshot>;
  write: (input: {
    database: TeachingCourseManagementDatabase;
    expectedRevision?: string;
  }) => Promise<void>;
};

export type TeachingCourseManagementAction =
  | "create-course"
  | "bind-course-cover-asset"
  | "create-class"
  | "save-course-settings"
  | "generate-student-preview-session"
  | "sync-student-roster"
  | "sync-student-roster-provider"
  | "generate-student-group-suggestions"
  | "sync-knowledge-index"
  | "sync-knowledge-index-provider"
  | "queue-resource-review-item"
  | "publish-course-content"
  | "publish-course-content-provider"
  | "generate-course-unit-draft"
  | "refresh-dashboard"
  | "lock-dashboard-snapshot"
  | "refresh-quiz-assessment"
  | "flag-quiz-item-review"
  | "save-agent-settings"
  | "record-agent-permission-preflight"
  | "save-admin-settings"
  | "queue-collaboration-invite-notification"
  | "deliver-collaboration-invite-email"
  | "record-collaboration-invite-email-delivery-callback"
  | "create-export-manifest"
  | "export-course-data-provider"
  | "validate-export-redaction-scope"
  | "save-grading-queue"
  | "generate-grading-feedback-draft"
  | "generate-grading-feedback-provider"
  | "generate-class-invite-code-draft"
  | "publish-class-invite-code"
  | "join-class-by-invite"
  | "approve-class-membership";

export type TeachingCourseRecord = {
  courseId: string;
  ownerTeacherId: string;
  courseName: string;
  instructor: string;
  unit: string;
  department: string;
  semester: string;
  description?: string;
  coverAssetId?: string;
  status: "draft";
  students: number;
  createdAt: string;
  updatedAt: string;
  storagePolicy: TeachingCourseManagementRecordStoragePolicy;
  storageWritePolicy: TeachingCourseManagementStorageWritePolicy;
  responsibleSession: "S12";
  redaction: TeachingCourseManagementRedaction;
};

export type TeachingClassRecord = {
  classId: string;
  courseId: string;
  ownerTeacherId: string;
  className: string;
  students: number;
  semester: string;
  invitationCode: string;
  joinUrl: string;
  createdAt: string;
  updatedAt: string;
  storagePolicy: TeachingCourseManagementRecordStoragePolicy;
  storageWritePolicy: TeachingCourseManagementStorageWritePolicy;
  responsibleSession: "S12";
  redaction: TeachingCourseManagementRedaction;
};

export type TeachingClassMembershipRecord = {
  membershipId: string;
  courseId: string;
  classId: string;
  invitationCode: string;
  studentId: string;
  studentDisplayName: string;
  membershipStatus: "pending-teacher-review" | "approved";
  approvedAt?: string;
  approvedByTeacherId?: string;
  joinedAt: string;
  storagePolicy: TeachingCourseManagementRecordStoragePolicy;
  storageWritePolicy: TeachingCourseManagementStorageWritePolicy;
  responsibleSession: "S12";
  redaction: TeachingCourseManagementRedaction;
};

export type TeachingClassInviteCodeDraftRecord = {
  inviteCodeDraftId: string;
  courseId: string;
  classId: string;
  ownerTeacherId: string;
  generatedBy: string;
  draftStatus: "generated";
  operationRecordId: string;
  sourceAction?: string;
  inviteCode: string;
  joinUrl: string;
  invitePolicy: "teacher-review-before-publication";
  generatedAt: string;
  storagePolicy: TeachingCourseManagementRecordStoragePolicy;
  storageWritePolicy: TeachingCourseManagementStorageWritePolicy;
  responsibleSession: "S12";
  redaction: TeachingCourseManagementRedaction;
};

export type TeachingCourseSettingsRecord = {
  settingsId: string;
  courseId: string;
  ownerTeacherId: string;
  updatedBy: string;
  settingsStatus: "saved";
  operationRecordId: string;
  sourceAction?: string;
  appliedFields: TeachingCourseSettingsAppliedField[];
  courseName?: string;
  instructor?: string;
  unit?: string;
  department?: string;
  semester?: string;
  description?: string;
  updatedAt: string;
  storagePolicy: TeachingCourseManagementRecordStoragePolicy;
  storageWritePolicy: TeachingCourseManagementStorageWritePolicy;
  responsibleSession: "S12";
  redaction: TeachingCourseManagementRedaction;
};

export type TeachingCourseSettingsAppliedField =
  | "courseName"
  | "instructor"
  | "unit"
  | "department"
  | "semester"
  | "description";

export type TeachingCourseSettingsPatchInput = Partial<
  Record<TeachingCourseSettingsAppliedField, string>
>;

type NormalizedTeachingCourseSettingsPatch = TeachingCourseSettingsPatchInput & {
  appliedFields: TeachingCourseSettingsAppliedField[];
};

export type TeachingStudentPreviewSessionRecord = {
  previewSessionId: string;
  courseId: string;
  ownerTeacherId: string;
  previewedBy: string;
  previewStatus: "generated";
  operationRecordId: string;
  sourceAction?: string;
  previewId: string;
  previewUrl: string;
  previewScope: "teacher-course-preview";
  previewPolicy: "teacher-visible-preview-only";
  generatedAt: string;
  storagePolicy: TeachingCourseManagementRecordStoragePolicy;
  storageWritePolicy: TeachingCourseManagementStorageWritePolicy;
  responsibleSession: "S12";
  redaction: TeachingCourseManagementRedaction;
};

export type TeachingStudentRosterSyncRecord = {
  rosterId: string;
  courseId: string;
  ownerTeacherId: string;
  syncedBy: string;
  syncStatus: "synced";
  operationRecordId: string;
  sourceAction?: string;
  approvedStudentCount: number;
  pendingTeacherReviewCount: number;
  classCount: number;
  sourceSystems: ["sis-roster", "invite-code-joins", "withdrawals"];
  providerStatus?: "sis-provider-synced";
  providerSyncId?: string;
  providerSyncedAt?: string;
  syncedAt: string;
  storagePolicy: TeachingCourseManagementRecordStoragePolicy;
  storageWritePolicy: TeachingCourseManagementStorageWritePolicy;
  responsibleSession: "S12";
  redaction: TeachingCourseManagementRedaction;
};

export type TeachingStudentGroupSuggestionRecord = {
  groupSuggestionId: string;
  courseId: string;
  ownerTeacherId: string;
  generatedBy: string;
  suggestionStatus: "generated";
  operationRecordId: string;
  sourceAction?: string;
  suggestionScope: "teacher-editable-student-groups";
  sourceSignals: ["learning-progress", "participation-frequency", "role-preferences"];
  reviewPolicy: "teacher-review-before-group-assignment";
  generatedAt: string;
  storagePolicy: TeachingCourseManagementRecordStoragePolicy;
  storageWritePolicy: TeachingCourseManagementStorageWritePolicy;
  responsibleSession: "S12";
  redaction: TeachingCourseManagementRedaction;
};

export type TeachingKnowledgeIndexSyncRecord = {
  indexId: string;
  courseId: string;
  ownerTeacherId: string;
  syncedBy: string;
  syncStatus: "synced";
  operationRecordId: string;
  sourceAction?: string;
  sourceSystems: ["course-files", "teacher-resources", "agent-grounding-index"];
  providerStatus?: "knowledge-provider-synced";
  providerSyncId?: string;
  providerSyncedAt?: string;
  syncedAt: string;
  storagePolicy: TeachingCourseManagementRecordStoragePolicy;
  storageWritePolicy: TeachingCourseManagementStorageWritePolicy;
  responsibleSession: "S12";
  redaction: TeachingCourseManagementRedaction;
};

export type TeachingResourceReviewItemRecord = {
  resourceReviewItemId: string;
  courseId: string;
  ownerTeacherId: string;
  queuedBy: string;
  reviewStatus: "pending-teacher-review";
  operationRecordId: string;
  sourceAction?: string;
  resourceSource: "teacher-placeholder";
  reviewPolicy: "teacher-review-before-knowledge-index";
  queuedAt: string;
  storagePolicy: TeachingCourseManagementRecordStoragePolicy;
  storageWritePolicy: TeachingCourseManagementStorageWritePolicy;
  responsibleSession: "S12";
  redaction: TeachingCourseManagementRedaction;
};

export type TeachingCourseContentPublishRecord = {
  contentId: string;
  courseId: string;
  ownerTeacherId: string;
  publishedBy: string;
  publicationStatus: "published";
  operationRecordId: string;
  sourceAction?: string;
  releaseScope: "course-visible-content";
  publishedAt: string;
  providerStatus?: "content-provider-published";
  providerPublishId?: string;
  providerPublishedAt?: string;
  storagePolicy: TeachingCourseManagementRecordStoragePolicy;
  storageWritePolicy: TeachingCourseManagementStorageWritePolicy;
  responsibleSession: "S12";
  redaction: TeachingCourseManagementRedaction;
};

export type TeachingCourseUnitDraftRecord = {
  unitDraftId: string;
  courseId: string;
  ownerTeacherId: string;
  generatedBy: string;
  draftStatus: "generated";
  operationRecordId: string;
  sourceAction?: string;
  draftScope: "teacher-editable-unit-plan";
  sourceSystems: ["course-knowledge-index", "teaching-objectives", "quiz-bank"];
  reviewPolicy: "teacher-review-before-student-release";
  generatedAt: string;
  storagePolicy: TeachingCourseManagementRecordStoragePolicy;
  storageWritePolicy: TeachingCourseManagementStorageWritePolicy;
  responsibleSession: "S12";
  redaction: TeachingCourseManagementRedaction;
};

export type TeachingCourseDashboardStateRecord = {
  dashboardStateId: string;
  courseId: string;
  ownerTeacherId: string;
  refreshedBy: string;
  refreshStatus: "refreshed";
  operationRecordId: string;
  sourceAction?: string;
  visibleMetrics: ["engagement", "progress", "assessment-quality"];
  refreshPolicy: "teacher-visible-course-dashboard";
  refreshedAt: string;
  storagePolicy: TeachingCourseManagementRecordStoragePolicy;
  storageWritePolicy: TeachingCourseManagementStorageWritePolicy;
  responsibleSession: "S12";
  redaction: TeachingCourseManagementRedaction;
};

export type TeachingCourseDashboardSnapshotRecord = {
  dashboardSnapshotId: string;
  courseId: string;
  ownerTeacherId: string;
  lockedBy: string;
  snapshotStatus: "locked";
  operationRecordId: string;
  sourceAction?: string;
  teachingOperationSnapshotId: string;
  snapshotScope: "daily-course-dashboard";
  retentionPolicy: "teacher-locked-dashboard-snapshot";
  lockedAt: string;
  storagePolicy: TeachingCourseManagementRecordStoragePolicy;
  storageWritePolicy: TeachingCourseManagementStorageWritePolicy;
  responsibleSession: "S12";
  redaction: TeachingCourseManagementRedaction;
};

export type TeachingCourseQuizAssessmentRecord = {
  quizAssessmentId: string;
  courseId: string;
  ownerTeacherId: string;
  refreshedBy: string;
  assessmentStatus: "refreshed";
  operationRecordId: string;
  sourceAction?: string;
  quizBoardStateId: string;
  visibleMetrics: ["completion-rate", "item-quality", "misconception-clusters"];
  reviewPolicy: "teacher-visible-quiz-quality-board";
  reusePolicy: "teacher-review-before-quiz-reuse";
  refreshedAt: string;
  storagePolicy: TeachingCourseManagementRecordStoragePolicy;
  storageWritePolicy: TeachingCourseManagementStorageWritePolicy;
  responsibleSession: "S12";
  redaction: TeachingCourseManagementRedaction;
};

export type TeachingCourseQuizItemReviewRecord = {
  quizItemReviewId: string;
  courseId: string;
  ownerTeacherId: string;
  flaggedBy: string;
  reviewStatus: "flagged-for-review";
  operationRecordId: string;
  sourceAction?: string;
  flaggedSignals: ["low-discrimination", "high-error-rate", "teacher-review-needed"];
  reviewPolicy: "teacher-review-before-quiz-reuse";
  flaggedAt: string;
  storagePolicy: TeachingCourseManagementRecordStoragePolicy;
  storageWritePolicy: TeachingCourseManagementStorageWritePolicy;
  responsibleSession: "S12";
  redaction: TeachingCourseManagementRedaction;
};

export type TeachingCourseAdminSettingsRecord = {
  adminSettingsId: string;
  courseId: string;
  ownerTeacherId: string;
  savedBy: string;
  settingsStatus: "saved";
  operationRecordId: string;
  sourceAction?: string;
  adminScopes: ["course-collaborators", "permission-boundary", "audit-routing"];
  governancePolicy: "teacher-controlled-admin-settings";
  savedAt: string;
  storagePolicy: TeachingCourseManagementRecordStoragePolicy;
  storageWritePolicy: TeachingCourseManagementStorageWritePolicy;
  responsibleSession: "S12";
  redaction: TeachingCourseManagementRedaction;
};

export type TeachingCourseAgentSettingsRecord = {
  agentSettingsId: string;
  courseId: string;
  ownerTeacherId: string;
  savedBy: string;
  settingsStatus: "saved";
  operationRecordId: string;
  sourceAction?: string;
  agentScopes: ["research-agent", "method-agent", "writing-agent", "math-agent"];
  governancePolicy: "teacher-controlled-agent-settings";
  savedAt: string;
  storagePolicy: TeachingCourseManagementRecordStoragePolicy;
  storageWritePolicy: TeachingCourseManagementStorageWritePolicy;
  responsibleSession: "S12";
  redaction: TeachingCourseManagementRedaction;
};

export type TeachingCourseAgentPermissionPreflightRecord = {
  preflightId: string;
  courseId: string;
  ownerTeacherId: string;
  checkedBy: string;
  preflightStatus: "passed";
  operationRecordId: string;
  sourceAction?: string;
  checkedPermissions: ["course-bindings", "agent-roles", "student-access"];
  preflightPolicy: "teacher-agent-permission-gate";
  checkedAt: string;
  storagePolicy: TeachingCourseManagementRecordStoragePolicy;
  storageWritePolicy: TeachingCourseManagementStorageWritePolicy;
  responsibleSession: "S12";
  redaction: TeachingCourseManagementRedaction;
};

export type TeachingCourseCollaborationInviteNotificationRecord = {
  notificationId: string;
  courseId: string;
  ownerTeacherId: string;
  queuedBy: string;
  notificationStatus: "queued-for-provider" | "delivered-to-provider" | "delivery-failed";
  operationRecordId: string;
  sourceAction?: string;
  outboxId: string;
  deliveryChannel: "collaboration-invite-email";
  providerStatus:
    | "smtp-provider-pending"
    | "smtp-provider-delivered"
    | "smtp-provider-bounced";
  providerDeliveryId?: string;
  deliveryFailureReason?: string;
  providerCallbackAt?: string;
  deliveryPolicy: "server-outbox-before-smtp-provider";
  queuedAt: string;
  deliveredAt?: string;
  storagePolicy: TeachingCourseManagementRecordStoragePolicy;
  storageWritePolicy: TeachingCourseManagementStorageWritePolicy;
  responsibleSession: "S12";
  redaction: TeachingCourseManagementRedaction;
};

export type TeachingCourseExportManifestRecord = {
  exportManifestId: string;
  courseId: string;
  ownerTeacherId: string;
  createdBy: string;
  exportStatus: "generated";
  operationRecordId: string;
  sourceAction?: string;
  teachingOperationManifestId: string;
  downloadRoute: string;
  datasetScopes: ["learning-records", "chat-threads", "grades", "activities"];
  formats: ["json", "csv"];
  exportPolicy: "redacted-teacher-export-manifest";
  providerStatus?: "export-provider-exported";
  providerExportId?: string;
  providerExportedAt?: string;
  createdAt: string;
  storagePolicy: TeachingCourseManagementRecordStoragePolicy;
  storageWritePolicy: TeachingCourseManagementStorageWritePolicy;
  responsibleSession: "S12";
  redaction: TeachingCourseManagementRedaction;
};

export type TeachingCourseExportRedactionValidationRecord = {
  exportRedactionValidationId: string;
  courseId: string;
  ownerTeacherId: string;
  validatedBy: string;
  validationStatus: "passed";
  operationRecordId: string;
  sourceAction?: string;
  checkedScopes: [
    "identity-fields",
    "ai-chat-transcripts",
    "voice-references",
    "local-file-paths",
  ];
  blockedSecretCount: 0;
  validationPolicy: "no-secrets-or-local-paths-before-export";
  validatedAt: string;
  storagePolicy: TeachingCourseManagementRecordStoragePolicy;
  storageWritePolicy: TeachingCourseManagementStorageWritePolicy;
  responsibleSession: "S12";
  redaction: TeachingCourseManagementRedaction;
};

export type TeachingCourseGradingQueueRecord = {
  gradingQueueId: string;
  courseId: string;
  ownerTeacherId: string;
  savedBy: string;
  queueStatus: "saved";
  operationRecordId: string;
  sourceAction?: string;
  gradebookUpdateId: string;
  reviewPolicy: "teacher-review-before-release";
  releasePolicy: "teacher-confirmed-grade-release";
  savedAt: string;
  storagePolicy: TeachingCourseManagementRecordStoragePolicy;
  storageWritePolicy: TeachingCourseManagementStorageWritePolicy;
  responsibleSession: "S12";
  redaction: TeachingCourseManagementRedaction;
};

export type TeachingCourseGradebookUpdateRecord = {
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
  storagePolicy: "domain-projection-teaching-gradebook-update";
  redaction: TeachingCourseManagementRedaction;
};

export type TeachingCourseGradingFeedbackDraftRecord = {
  gradingFeedbackDraftId: string;
  courseId: string;
  ownerTeacherId: string;
  generatedBy: string;
  feedbackStatus: "generated";
  operationRecordId: string;
  sourceAction?: string;
  teachingOperationFeedbackArtifactId: string;
  feedbackScope: "grading-review-queue";
  reviewPolicy: "teacher-review-before-student-release";
  releasePolicy: "teacher-confirmed-feedback-release";
  providerStatus?: "feedback-provider-generated";
  providerFeedbackId?: string;
  providerGeneratedAt?: string;
  generatedAt: string;
  storagePolicy: TeachingCourseManagementRecordStoragePolicy;
  storageWritePolicy: TeachingCourseManagementStorageWritePolicy;
  responsibleSession: "S12";
  redaction: TeachingCourseManagementRedaction;
};

export type TeachingCourseManagementAuditEvent = {
  auditId: string;
  action: TeachingCourseManagementAction;
  actorId: string;
  courseId: string;
  classId?: string;
  traceId: string;
  actorRole: "teacher" | "student";
  authMode: "signed-teacher-session" | "app-student-session";
  authSession?: TeachingCourseManagementAuthSessionSummary;
  createdAt: string;
  rollbackStatus?: "rolled-back";
  rolledBackAt?: string;
  requestSource: TeachingCourseManagementAuditRequestSource;
  storagePolicy: TeachingCourseManagementAuditStoragePolicy;
  redaction: TeachingCourseManagementRedaction;
};

export type TeachingCourseManagementAuthSessionSummary = {
  sessionId: string;
  authenticatedAt: string;
  expiresAt: string;
};

export type TeachingCourseManagementAuditRequestSource = {
  userAgent: string;
  ipAddress: "redacted";
};

export type TeachingCourseManagementReceipt = {
  receiptId: string;
  action: TeachingCourseManagementAction;
  actorId: string;
  courseId: string;
  classId?: string;
  traceId: string;
  status: "persisted";
  authSession?: TeachingCourseManagementAuthSessionSummary;
  storagePolicy: TeachingCourseManagementRecordStoragePolicy;
  storageWritePolicy: TeachingCourseManagementStorageWritePolicy;
  responsibleSession: "S12";
  createdAt: string;
  redaction: TeachingCourseManagementRedaction;
};

export type TeachingCourseManagementDatabase = {
  schemaVersion: "uais-teaching-course-management-v1";
  updatedAt: string;
  courses: TeachingCourseRecord[];
  classes: TeachingClassRecord[];
  memberships: TeachingClassMembershipRecord[];
  inviteCodeDrafts?: TeachingClassInviteCodeDraftRecord[];
  courseSettings?: TeachingCourseSettingsRecord[];
  studentPreviewSessions?: TeachingStudentPreviewSessionRecord[];
  studentRosters?: TeachingStudentRosterSyncRecord[];
  studentGroupSuggestions?: TeachingStudentGroupSuggestionRecord[];
  knowledgeIndexes?: TeachingKnowledgeIndexSyncRecord[];
  resourceReviewItems?: TeachingResourceReviewItemRecord[];
  contentPackages?: TeachingCourseContentPublishRecord[];
  courseUnitDrafts?: TeachingCourseUnitDraftRecord[];
  dashboardStates?: TeachingCourseDashboardStateRecord[];
  dashboardSnapshots?: TeachingCourseDashboardSnapshotRecord[];
  quizAssessments?: TeachingCourseQuizAssessmentRecord[];
  quizItemReviews?: TeachingCourseQuizItemReviewRecord[];
  agentSettings?: TeachingCourseAgentSettingsRecord[];
  agentPermissionPreflights?: TeachingCourseAgentPermissionPreflightRecord[];
  adminSettings?: TeachingCourseAdminSettingsRecord[];
  collaborationInviteNotifications?: TeachingCourseCollaborationInviteNotificationRecord[];
  exportManifests?: TeachingCourseExportManifestRecord[];
  exportRedactionValidations?: TeachingCourseExportRedactionValidationRecord[];
  gradingQueues?: TeachingCourseGradingQueueRecord[];
  gradebookUpdates?: TeachingCourseGradebookUpdateRecord[];
  gradingFeedbackDrafts?: TeachingCourseGradingFeedbackDraftRecord[];
  auditEvents: TeachingCourseManagementAuditEvent[];
};

export type TeachingCourseDraftInput = {
  courseId?: string;
  name: string;
  instructor: string;
  unit: string;
  department: string;
  semester: string;
  description?: string;
  coverAssetId?: string;
};

export type TeachingClassDraftInput = {
  className: string;
  semester?: string;
};

export type TeachingClassJoinInput = {
  invitationCode: string;
  studentId: string;
  studentDisplayName: string;
};

type NormalizedTeachingCourseDraft = Required<Omit<TeachingCourseDraftInput, "courseId">> & {
  courseId?: string;
};

const localTeachingCourseManagementStorage: TeachingCourseManagementStorageDescriptor = {
  recordStoragePolicy: "local-json-teaching-course-management",
  auditStoragePolicy: "local-json-teaching-course-management-audit-log",
  storageWritePolicy: "atomic-json-file-replace",
};

export class TeachingCourseManagementStoreError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly diagnostics?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function assertTeachingCourseManagementLocalJsonRuntimeAllowed(
  env: Record<string, string | undefined>,
) {
  if (!isTeachingCourseManagementProductionRuntime(env)) {
    return;
  }

  throw new TeachingCourseManagementStoreError(
    503,
    "Production teaching course management persistence requires external storage.",
  );
}

export async function createTeachingCourseRecord(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  draft: TeachingCourseDraftInput;
  traceId?: string;
  now?: Date;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
    authSession?: TeachingCourseManagementAuthSessionSummary;
  };
}): Promise<{
  course: TeachingCourseRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const draft = normalizeCourseDraft(input.draft);
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  if (draft.courseId && !isProvisionalTeachingCourseIdForActor(draft.courseId, actorId)) {
    throw new TeachingCourseManagementStoreError(
      403,
      "Teaching course provisional id must belong to the signed teacher.",
    );
  }
  const courseId = draft.courseId ?? createTeachingCourseId(draft.name, now);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    if (database.courses.some((course) => course.courseId === courseId)) {
      throw new TeachingCourseManagementStoreError(409, "Teaching course already exists.");
    }

    const course: TeachingCourseRecord = {
      courseId,
      ownerTeacherId: actorId,
      courseName: draft.name,
      instructor: draft.instructor,
      unit: draft.unit,
      department: draft.department,
      semester: draft.semester,
      ...(draft.description ? { description: draft.description } : {}),
      ...(draft.coverAssetId ? { coverAssetId: draft.coverAssetId } : {}),
      status: "draft",
      students: 0,
      createdAt,
      updatedAt: createdAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    const receipt = createReceipt({
      action: "create-course",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt,
      authSession: input.audit?.authSession,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "create-course",
      actorId,
      courseId,
      traceId: receipt.traceId,
      createdAt,
      requestSource: input.audit?.requestSource,
      authSession: input.audit?.authSession,
      storage,
    });

    database.courses.push(course);
    database.auditEvents.push(auditEvent);
    database.updatedAt = createdAt;
    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return { course, receipt };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function bindTeachingCourseCoverAssetRecord(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  coverAssetId: string;
  traceId?: string;
  now?: Date;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
    authSession?: TeachingCourseManagementAuthSessionSummary;
  };
}): Promise<{
  course: TeachingCourseRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const coverAssetId = requireSafeId(input.coverAssetId, "cover asset id");
  const now = input.now ?? new Date();
  const updatedAt = now.toISOString();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((course) => course.courseId === courseId);
    if (courseIndex < 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
    }

    const course = database.courses[courseIndex];
    if (course.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(403, "Teaching course ownership is required.");
    }

    const nextCourse: TeachingCourseRecord = {
      ...course,
      coverAssetId,
      updatedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      redaction: createRedaction(),
    };
    const receipt = createReceipt({
      action: "bind-course-cover-asset",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: updatedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "bind-course-cover-asset",
      actorId,
      courseId,
      traceId: receipt.traceId,
      createdAt: updatedAt,
      requestSource: input.audit?.requestSource,
      storage,
    });

    database.courses[courseIndex] = nextCourse;
    database.auditEvents.push(auditEvent);
    database.updatedAt = updatedAt;
    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return { course: nextCourse, receipt };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function createTeachingClassRecord(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  draft: TeachingClassDraftInput;
  traceId?: string;
  now?: Date;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
    authSession?: TeachingCourseManagementAuthSessionSummary;
  };
}): Promise<{
  classItem: TeachingClassRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const draft = normalizeClassDraft(input.draft);
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((item) => item.courseId === courseId);
    const course = courseIndex >= 0 ? database.courses[courseIndex] : undefined;
    if (!course) {
      throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
    }
    if (course.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(403, "Teaching course ownership is required.");
    }

    const classSemester = draft.semester ?? course.semester;
    const duplicateClass = database.classes.find(
      (item) =>
        item.courseId === courseId &&
        normalizeClassUniqueValue(item.className) === normalizeClassUniqueValue(draft.className) &&
        normalizeClassUniqueValue(item.semester) === normalizeClassUniqueValue(classSemester),
    );
    if (duplicateClass) {
      throw new TeachingCourseManagementStoreError(409, "Teaching class already exists.");
    }

    const existingClassCount = database.classes.filter((item) => item.courseId === courseId).length;
    const invitationCode = createClassInvitationCode(database);
    const classId = `${courseId}-class-${existingClassCount + 1}`;
    const classItem: TeachingClassRecord = {
      classId,
      courseId,
      ownerTeacherId: actorId,
      className: draft.className,
      students: 0,
      semester: classSemester,
      invitationCode,
      joinUrl: `/courses?invite=${invitationCode}`,
      createdAt,
      updatedAt: createdAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    const receipt = createReceipt({
      action: "create-class",
      actorId,
      courseId,
      classId,
      traceId: input.traceId,
      createdAt,
      authSession: input.audit?.authSession,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "create-class",
      actorId,
      courseId,
      classId,
      traceId: receipt.traceId,
      createdAt,
      requestSource: input.audit?.requestSource,
      authSession: input.audit?.authSession,
      storage,
    });

    database.classes.push(classItem);
    database.courses[courseIndex] = {
      ...course,
      updatedAt: createdAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      redaction: createRedaction(),
    };
    database.auditEvents.push(auditEvent);
    database.updatedAt = createdAt;
    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return { classItem, receipt };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function saveTeachingCourseSettingsRecord(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  operationRecordId: string;
  sourceAction?: string;
  settingsPatch?: unknown;
  traceId?: string;
  now?: Date;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
    authSession?: TeachingCourseManagementAuthSessionSummary;
  };
}): Promise<{
  courseSettings: TeachingCourseSettingsRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const sourceAction = input.sourceAction
    ? requireSafeId(input.sourceAction, "source action")
    : undefined;
  const settingsPatch = normalizeCourseSettingsPatch(input.settingsPatch);
  const now = input.now ?? new Date();
  const updatedAt = now.toISOString();
  const settingsId = `course-settings-${courseId}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const existingCourseIndex = database.courses.findIndex(
      (course) => course.courseId === courseId,
    );
    const existingCourse =
      existingCourseIndex >= 0 ? database.courses[existingCourseIndex] : undefined;
    if (existingCourse && existingCourse.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(
        403,
        "Teaching course ownership is required.",
      );
    }
    if (!existingCourse && settingsPatch.appliedFields.length > 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
    }

    const courseSettings: TeachingCourseSettingsRecord = {
      settingsId,
      courseId,
      ownerTeacherId: existingCourse?.ownerTeacherId ?? actorId,
      updatedBy: actorId,
      settingsStatus: "saved",
      operationRecordId,
      ...(sourceAction ? { sourceAction } : {}),
      appliedFields: settingsPatch.appliedFields,
      ...(settingsPatch.courseName ? { courseName: settingsPatch.courseName } : {}),
      ...(settingsPatch.instructor ? { instructor: settingsPatch.instructor } : {}),
      ...(settingsPatch.unit ? { unit: settingsPatch.unit } : {}),
      ...(settingsPatch.department ? { department: settingsPatch.department } : {}),
      ...(settingsPatch.semester ? { semester: settingsPatch.semester } : {}),
      ...(settingsPatch.description !== undefined
        ? { description: settingsPatch.description }
        : {}),
      updatedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    const settings = database.courseSettings ?? [];
    const existingSettingsIndex = settings.findIndex(
      (item) => item.settingsId === settingsId,
    );
    const existingSettings =
      existingSettingsIndex >= 0 ? settings[existingSettingsIndex] : undefined;
    if (existingSettings?.operationRecordId === operationRecordId) {
      const receipt = createReceipt({
        action: "save-course-settings",
        actorId,
        courseId,
        traceId: input.traceId,
        createdAt: existingSettings.updatedAt,
        storage,
      });
      return {
        courseSettings: existingSettings,
        receipt,
      };
    }
    database.courseSettings =
      existingSettingsIndex >= 0
        ? settings.map((item, index) =>
            index === existingSettingsIndex ? courseSettings : item,
          )
        : [...settings, courseSettings];
    if (existingCourse && existingCourseIndex >= 0) {
      database.courses[existingCourseIndex] = {
        ...existingCourse,
        ...(settingsPatch.courseName ? { courseName: settingsPatch.courseName } : {}),
        ...(settingsPatch.instructor ? { instructor: settingsPatch.instructor } : {}),
        ...(settingsPatch.unit ? { unit: settingsPatch.unit } : {}),
        ...(settingsPatch.department ? { department: settingsPatch.department } : {}),
        ...(settingsPatch.semester ? { semester: settingsPatch.semester } : {}),
        ...(settingsPatch.description !== undefined
          ? settingsPatch.description
            ? { description: settingsPatch.description }
            : { description: undefined }
          : {}),
        updatedAt,
        storagePolicy: storage.recordStoragePolicy,
        storageWritePolicy: storage.storageWritePolicy,
        redaction: createRedaction(),
      };
    }
    database.updatedAt = updatedAt;

    const receipt = createReceipt({
      action: "save-course-settings",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: updatedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "save-course-settings",
      actorId,
      courseId,
      traceId: receipt.traceId,
      createdAt: updatedAt,
      requestSource: input.audit?.requestSource,
      storage,
    });
    database.auditEvents.push(auditEvent);

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return {
        courseSettings,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function saveTeachingStudentPreviewSessionRecord(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  operationRecordId: string;
  sourceAction?: string;
  traceId?: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  now?: Date;
}): Promise<{
  studentPreviewSession: TeachingStudentPreviewSessionRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const sourceAction = input.sourceAction
    ? requireSafeId(input.sourceAction, "source action")
    : undefined;
  const now = input.now ?? new Date();
  const generatedAt = now.toISOString();
  const previewSessionId = `student-preview-session-${courseId}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((course) => course.courseId === courseId);
    if (courseIndex < 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
    }

    const course = database.courses[courseIndex];
    if (course.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(
        403,
        "Teaching course ownership is required.",
      );
    }

    const studentPreviewSessions = database.studentPreviewSessions ?? [];
    const existingPreviewSessionIndex = studentPreviewSessions.findIndex(
      (session) => session.previewSessionId === previewSessionId,
    );
    const existingPreviewSession =
      existingPreviewSessionIndex >= 0
        ? studentPreviewSessions[existingPreviewSessionIndex]
        : undefined;
    if (existingPreviewSession?.operationRecordId === operationRecordId) {
      const receipt = createReceipt({
        action: "generate-student-preview-session",
        actorId,
        courseId,
        traceId: input.traceId,
        createdAt: existingPreviewSession.generatedAt,
        storage,
      });
      return {
        studentPreviewSession: existingPreviewSession,
        receipt,
      };
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: generatedAt,
    };

    const studentPreviewSession: TeachingStudentPreviewSessionRecord = {
      previewSessionId,
      courseId,
      ownerTeacherId: course.ownerTeacherId,
      previewedBy: actorId,
      previewStatus: "generated",
      operationRecordId,
      ...(sourceAction ? { sourceAction } : {}),
      previewId: `student-preview-${formatTimestampId(now)}`,
      previewUrl: `/learning?teacherPreview=1&course=${courseId}`,
      previewScope: "teacher-course-preview",
      previewPolicy: "teacher-visible-preview-only",
      generatedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    database.studentPreviewSessions =
      existingPreviewSessionIndex >= 0
        ? studentPreviewSessions.map((session, index) =>
            index === existingPreviewSessionIndex ? studentPreviewSession : session,
          )
        : [...studentPreviewSessions, studentPreviewSession];
    database.updatedAt = generatedAt;

    const receipt = createReceipt({
      action: "generate-student-preview-session",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: generatedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "generate-student-preview-session",
      actorId,
      courseId,
      traceId: receipt.traceId,
      createdAt: generatedAt,
      storage,
      requestSource: input.audit?.requestSource,
    });
    database.auditEvents.push(auditEvent);

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return {
        studentPreviewSession,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function saveTeachingStudentRosterSyncRecord(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  operationRecordId: string;
  sourceAction?: string;
  traceId?: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  now?: Date;
}): Promise<{
  studentRoster: TeachingStudentRosterSyncRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const sourceAction = input.sourceAction
    ? requireSafeId(input.sourceAction, "source action")
    : undefined;
  const now = input.now ?? new Date();
  const syncedAt = now.toISOString();
  const rosterId = `student-roster-${courseId}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((course) => course.courseId === courseId);
    if (courseIndex < 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
    }

    const course = database.courses[courseIndex];
    if (course.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(
        403,
        "Teaching course ownership is required.",
      );
    }

    const studentRosters = database.studentRosters ?? [];
    const existingRosterIndex = studentRosters.findIndex((item) => item.rosterId === rosterId);
    const existingRoster =
      existingRosterIndex >= 0 ? studentRosters[existingRosterIndex] : undefined;
    if (existingRoster?.operationRecordId === operationRecordId) {
      const receipt = createReceipt({
        action: "sync-student-roster",
        actorId,
        courseId,
        traceId: input.traceId,
        createdAt: existingRoster.syncedAt,
        storage,
      });
      return {
        studentRoster: existingRoster,
        receipt,
      };
    }

    const courseClasses = database.classes.filter((classItem) => classItem.courseId === courseId);
    const classIds = new Set(courseClasses.map((classItem) => classItem.classId));
    for (const classItem of courseClasses) {
      const classIndex = database.classes.findIndex((item) => item.classId === classItem.classId);
      if (classIndex >= 0) {
        database.classes[classIndex] = {
          ...database.classes[classIndex],
          students: countApprovedMembershipsForClass(database, classItem.classId),
          updatedAt: syncedAt,
        };
      }
    }

    const approvedStudentCount = countApprovedStudentsForCourse(database, courseId);
    const pendingTeacherReviewCount = database.memberships.filter(
      (membership) =>
        classIds.has(membership.classId) &&
        membership.membershipStatus === "pending-teacher-review",
    ).length;
    database.courses[courseIndex] = {
      ...course,
      students: approvedStudentCount,
      updatedAt: syncedAt,
    };

    const studentRoster: TeachingStudentRosterSyncRecord = {
      rosterId,
      courseId,
      ownerTeacherId: course.ownerTeacherId,
      syncedBy: actorId,
      syncStatus: "synced",
      operationRecordId,
      ...(sourceAction ? { sourceAction } : {}),
      approvedStudentCount,
      pendingTeacherReviewCount,
      classCount: courseClasses.length,
      sourceSystems: ["sis-roster", "invite-code-joins", "withdrawals"],
      syncedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    database.studentRosters =
      existingRosterIndex >= 0
        ? studentRosters.map((item, index) =>
            index === existingRosterIndex ? studentRoster : item,
          )
        : [...studentRosters, studentRoster];
    database.updatedAt = syncedAt;

    const receipt = createReceipt({
      action: "sync-student-roster",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: syncedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "sync-student-roster",
      actorId,
      courseId,
      traceId: receipt.traceId,
      createdAt: syncedAt,
      storage,
      requestSource: input.audit?.requestSource,
    });
    database.auditEvents.push(auditEvent);

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return {
        studentRoster,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function markTeachingStudentRosterProviderSynced(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  operationRecordId: string;
  providerSyncId: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  traceId?: string;
  now?: Date;
}): Promise<{
  studentRoster: TeachingStudentRosterSyncRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const providerSyncId = requireSafeId(input.providerSyncId, "provider sync id");
  const now = input.now ?? new Date();
  const providerSyncedAt = now.toISOString();
  const rosterId = `student-roster-${courseId}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((course) => course.courseId === courseId);
    if (courseIndex < 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
    }

    const course = database.courses[courseIndex];
    if (course.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(
        403,
        "Teaching course ownership is required.",
      );
    }

    const studentRosters = database.studentRosters ?? [];
    const rosterIndex = studentRosters.findIndex(
      (item) => item.rosterId === rosterId && item.operationRecordId === operationRecordId,
    );
    if (rosterIndex < 0) {
      throw new TeachingCourseManagementStoreError(
        404,
        "Teaching student roster sync record was not found.",
      );
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: providerSyncedAt,
    };

    const studentRoster: TeachingStudentRosterSyncRecord = {
      ...studentRosters[rosterIndex],
      providerStatus: "sis-provider-synced",
      providerSyncId,
      providerSyncedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      redaction: createRedaction(),
    };
    database.studentRosters = studentRosters.map((item, index) =>
      index === rosterIndex ? studentRoster : item,
    );
    database.updatedAt = providerSyncedAt;

    const receipt = createReceipt({
      action: "sync-student-roster-provider",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: providerSyncedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "sync-student-roster-provider",
      actorId,
      courseId,
      traceId: receipt.traceId,
      requestSource: input.audit?.requestSource,
      createdAt: providerSyncedAt,
      storage,
    });
    database.auditEvents.push(auditEvent);

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return {
        studentRoster,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function markTeachingKnowledgeIndexProviderSynced(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  operationRecordId: string;
  providerSyncId: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  traceId?: string;
  now?: Date;
}): Promise<{
  knowledgeIndex: TeachingKnowledgeIndexSyncRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const providerSyncId = requireSafeId(input.providerSyncId, "provider sync id");
  const now = input.now ?? new Date();
  const providerSyncedAt = now.toISOString();
  const indexId = `knowledge-index-${courseId}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((course) => course.courseId === courseId);
    if (courseIndex < 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
    }

    const course = database.courses[courseIndex];
    if (course.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(
        403,
        "Teaching course ownership is required.",
      );
    }

    const knowledgeIndexes = database.knowledgeIndexes ?? [];
    const knowledgeIndexIndex = knowledgeIndexes.findIndex(
      (item) => item.indexId === indexId && item.operationRecordId === operationRecordId,
    );
    if (knowledgeIndexIndex < 0) {
      throw new TeachingCourseManagementStoreError(
        404,
        "Teaching knowledge index sync record was not found.",
      );
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: providerSyncedAt,
    };

    const knowledgeIndex: TeachingKnowledgeIndexSyncRecord = {
      ...knowledgeIndexes[knowledgeIndexIndex],
      providerStatus: "knowledge-provider-synced",
      providerSyncId,
      providerSyncedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      redaction: createRedaction(),
    };
    database.knowledgeIndexes = knowledgeIndexes.map((item, index) =>
      index === knowledgeIndexIndex ? knowledgeIndex : item,
    );
    database.updatedAt = providerSyncedAt;

    const receipt = createReceipt({
      action: "sync-knowledge-index-provider",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: providerSyncedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "sync-knowledge-index-provider",
      actorId,
      courseId,
      traceId: receipt.traceId,
      requestSource: input.audit?.requestSource,
      createdAt: providerSyncedAt,
      storage,
    });
    database.auditEvents.push(auditEvent);

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return {
        knowledgeIndex,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function saveTeachingStudentGroupSuggestionRecord(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  operationRecordId: string;
  sourceAction?: string;
  traceId?: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  now?: Date;
}): Promise<{
  studentGroupSuggestion: TeachingStudentGroupSuggestionRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const sourceAction = input.sourceAction
    ? requireSafeId(input.sourceAction, "source action")
    : undefined;
  const now = input.now ?? new Date();
  const generatedAt = now.toISOString();
  const groupSuggestionId = `group-suggestion-${courseId}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((course) => course.courseId === courseId);
    if (courseIndex < 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
    }

    const course = database.courses[courseIndex];
    if (course.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(
        403,
        "Teaching course ownership is required.",
      );
    }

    const studentGroupSuggestions = database.studentGroupSuggestions ?? [];
    const existingSuggestionIndex = studentGroupSuggestions.findIndex(
      (item) => item.groupSuggestionId === groupSuggestionId,
    );
    const existingSuggestion =
      existingSuggestionIndex >= 0
        ? studentGroupSuggestions[existingSuggestionIndex]
        : undefined;
    if (existingSuggestion?.operationRecordId === operationRecordId) {
      const receipt = createReceipt({
        action: "generate-student-group-suggestions",
        actorId,
        courseId,
        traceId: input.traceId,
        createdAt: existingSuggestion.generatedAt,
        storage,
      });
      return {
        studentGroupSuggestion: existingSuggestion,
        receipt,
      };
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: generatedAt,
    };

    const studentGroupSuggestion: TeachingStudentGroupSuggestionRecord = {
      groupSuggestionId,
      courseId,
      ownerTeacherId: course.ownerTeacherId,
      generatedBy: actorId,
      suggestionStatus: "generated",
      operationRecordId,
      ...(sourceAction ? { sourceAction } : {}),
      suggestionScope: "teacher-editable-student-groups",
      sourceSignals: ["learning-progress", "participation-frequency", "role-preferences"],
      reviewPolicy: "teacher-review-before-group-assignment",
      generatedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    database.studentGroupSuggestions =
      existingSuggestionIndex >= 0
        ? studentGroupSuggestions.map((item, index) =>
            index === existingSuggestionIndex ? studentGroupSuggestion : item,
          )
        : [...studentGroupSuggestions, studentGroupSuggestion];
    database.updatedAt = generatedAt;

    const receipt = createReceipt({
      action: "generate-student-group-suggestions",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: generatedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "generate-student-group-suggestions",
      actorId,
      courseId,
      traceId: receipt.traceId,
      createdAt: generatedAt,
      storage,
      requestSource: input.audit?.requestSource,
    });
    database.auditEvents.push(auditEvent);

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return {
        studentGroupSuggestion,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function saveTeachingKnowledgeIndexSyncRecord(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  operationRecordId: string;
  sourceAction?: string;
  traceId?: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  now?: Date;
}): Promise<{
  knowledgeIndex: TeachingKnowledgeIndexSyncRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const sourceAction = input.sourceAction
    ? requireSafeId(input.sourceAction, "source action")
    : undefined;
  const now = input.now ?? new Date();
  const syncedAt = now.toISOString();
  const indexId = `knowledge-index-${courseId}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((course) => course.courseId === courseId);
    if (courseIndex < 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
    }

    const course = database.courses[courseIndex];
    if (course.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(
        403,
        "Teaching course ownership is required.",
      );
    }

    const knowledgeIndexes = database.knowledgeIndexes ?? [];
    const existingIndex = knowledgeIndexes.findIndex((item) => item.indexId === indexId);
    const existingKnowledgeIndex =
      existingIndex >= 0 ? knowledgeIndexes[existingIndex] : undefined;
    if (existingKnowledgeIndex?.operationRecordId === operationRecordId) {
      const receipt = createReceipt({
        action: "sync-knowledge-index",
        actorId,
        courseId,
        traceId: input.traceId,
        createdAt: existingKnowledgeIndex.syncedAt,
        storage,
      });
      return {
        knowledgeIndex: existingKnowledgeIndex,
        receipt,
      };
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: syncedAt,
    };

    const knowledgeIndex: TeachingKnowledgeIndexSyncRecord = {
      indexId,
      courseId,
      ownerTeacherId: course.ownerTeacherId,
      syncedBy: actorId,
      syncStatus: "synced",
      operationRecordId,
      ...(sourceAction ? { sourceAction } : {}),
      sourceSystems: ["course-files", "teacher-resources", "agent-grounding-index"],
      syncedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    database.knowledgeIndexes =
      existingIndex >= 0
        ? knowledgeIndexes.map((item, index) =>
            index === existingIndex ? knowledgeIndex : item,
          )
        : [...knowledgeIndexes, knowledgeIndex];
    database.updatedAt = syncedAt;

    const receipt = createReceipt({
      action: "sync-knowledge-index",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: syncedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "sync-knowledge-index",
      actorId,
      courseId,
      traceId: receipt.traceId,
      createdAt: syncedAt,
      storage,
      requestSource: input.audit?.requestSource,
    });
    database.auditEvents.push(auditEvent);

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return {
        knowledgeIndex,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function saveTeachingResourceReviewItemRecord(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  operationRecordId: string;
  sourceAction?: string;
  traceId?: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  now?: Date;
}): Promise<{
  resourceReviewItem: TeachingResourceReviewItemRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const sourceAction = input.sourceAction
    ? requireSafeId(input.sourceAction, "source action")
    : undefined;
  const now = input.now ?? new Date();
  const queuedAt = now.toISOString();
  const resourceReviewItemId = `resource-review-item-${courseId}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((course) => course.courseId === courseId);
    if (courseIndex < 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
    }

    const course = database.courses[courseIndex];
    if (course.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(
        403,
        "Teaching course ownership is required.",
      );
    }

    const resourceReviewItems = database.resourceReviewItems ?? [];
    const existingItemIndex = resourceReviewItems.findIndex(
      (item) => item.resourceReviewItemId === resourceReviewItemId,
    );
    const existingItem =
      existingItemIndex >= 0
        ? resourceReviewItems[existingItemIndex]
        : undefined;
    if (existingItem?.operationRecordId === operationRecordId) {
      const receipt = createReceipt({
        action: "queue-resource-review-item",
        actorId,
        courseId,
        traceId: input.traceId,
        createdAt: existingItem.queuedAt,
        storage,
      });
      return {
        resourceReviewItem: existingItem,
        receipt,
      };
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: queuedAt,
    };

    const resourceReviewItem: TeachingResourceReviewItemRecord = {
      resourceReviewItemId,
      courseId,
      ownerTeacherId: course.ownerTeacherId,
      queuedBy: actorId,
      reviewStatus: "pending-teacher-review",
      operationRecordId,
      ...(sourceAction ? { sourceAction } : {}),
      resourceSource: "teacher-placeholder",
      reviewPolicy: "teacher-review-before-knowledge-index",
      queuedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    database.resourceReviewItems =
      existingItemIndex >= 0
        ? resourceReviewItems.map((item, index) =>
            index === existingItemIndex ? resourceReviewItem : item,
          )
        : [...resourceReviewItems, resourceReviewItem];
    database.updatedAt = queuedAt;

    const receipt = createReceipt({
      action: "queue-resource-review-item",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: queuedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "queue-resource-review-item",
      actorId,
      courseId,
      traceId: receipt.traceId,
      createdAt: queuedAt,
      storage,
      requestSource: input.audit?.requestSource,
    });
    database.auditEvents.push(auditEvent);

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return {
        resourceReviewItem,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function saveTeachingCourseContentPublishRecord(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  operationRecordId: string;
  sourceAction?: string;
  traceId?: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  now?: Date;
}): Promise<{
  contentPackage: TeachingCourseContentPublishRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const sourceAction = input.sourceAction
    ? requireSafeId(input.sourceAction, "source action")
    : undefined;
  const now = input.now ?? new Date();
  const publishedAt = now.toISOString();
  const contentId = `course-content-${courseId}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((course) => course.courseId === courseId);
    if (courseIndex < 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
    }

    const course = database.courses[courseIndex];
    if (course.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(
        403,
        "Teaching course ownership is required.",
      );
    }

    const contentPackages = database.contentPackages ?? [];
    const existingContentIndex = contentPackages.findIndex((item) => item.contentId === contentId);
    const existingContentPackage =
      existingContentIndex >= 0 ? contentPackages[existingContentIndex] : undefined;
    if (existingContentPackage?.operationRecordId === operationRecordId) {
      const receipt = createReceipt({
        action: "publish-course-content",
        actorId,
        courseId,
        traceId: input.traceId,
        createdAt: existingContentPackage.publishedAt,
        storage,
      });
      return {
        contentPackage: existingContentPackage,
        receipt,
      };
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: publishedAt,
    };

    const contentPackage: TeachingCourseContentPublishRecord = {
      contentId,
      courseId,
      ownerTeacherId: course.ownerTeacherId,
      publishedBy: actorId,
      publicationStatus: "published",
      operationRecordId,
      ...(sourceAction ? { sourceAction } : {}),
      releaseScope: "course-visible-content",
      publishedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    database.contentPackages =
      existingContentIndex >= 0
        ? contentPackages.map((item, index) =>
            index === existingContentIndex ? contentPackage : item,
          )
        : [...contentPackages, contentPackage];
    database.updatedAt = publishedAt;

    const receipt = createReceipt({
      action: "publish-course-content",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: publishedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "publish-course-content",
      actorId,
      courseId,
      traceId: receipt.traceId,
      createdAt: publishedAt,
      storage,
      requestSource: input.audit?.requestSource,
    });
    database.auditEvents.push(auditEvent);

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return {
        contentPackage,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function markTeachingCourseContentProviderPublished(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  operationRecordId: string;
  providerPublishId: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  traceId?: string;
  now?: Date;
}): Promise<{
  contentPackage: TeachingCourseContentPublishRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const providerPublishId = requireSafeId(input.providerPublishId, "provider publish id");
  const now = input.now ?? new Date();
  const providerPublishedAt = now.toISOString();
  const contentId = `course-content-${courseId}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((course) => course.courseId === courseId);
    if (courseIndex < 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
    }

    const course = database.courses[courseIndex];
    if (course.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(
        403,
        "Teaching course ownership is required.",
      );
    }

    const contentPackages = database.contentPackages ?? [];
    const contentPackageIndex = contentPackages.findIndex(
      (item) => item.contentId === contentId && item.operationRecordId === operationRecordId,
    );
    if (contentPackageIndex < 0) {
      throw new TeachingCourseManagementStoreError(
        404,
        "Teaching course content publish record was not found.",
      );
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: providerPublishedAt,
    };

    const contentPackage: TeachingCourseContentPublishRecord = {
      ...contentPackages[contentPackageIndex],
      providerStatus: "content-provider-published",
      providerPublishId,
      providerPublishedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      redaction: createRedaction(),
    };
    database.contentPackages = contentPackages.map((item, index) =>
      index === contentPackageIndex ? contentPackage : item,
    );
    database.updatedAt = providerPublishedAt;

    const receipt = createReceipt({
      action: "publish-course-content-provider",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: providerPublishedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "publish-course-content-provider",
      actorId,
      courseId,
      traceId: receipt.traceId,
      requestSource: input.audit?.requestSource,
      createdAt: providerPublishedAt,
      storage,
    });
    database.auditEvents.push(auditEvent);

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return {
        contentPackage,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function saveTeachingCourseUnitDraftRecord(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  operationRecordId: string;
  sourceAction?: string;
  traceId?: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  now?: Date;
}): Promise<{
  unitDraft: TeachingCourseUnitDraftRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const sourceAction = input.sourceAction
    ? requireSafeId(input.sourceAction, "source action")
    : undefined;
  const now = input.now ?? new Date();
  const generatedAt = now.toISOString();
  const unitDraftId = `course-unit-draft-${courseId}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((course) => course.courseId === courseId);
    if (courseIndex < 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
    }

    const course = database.courses[courseIndex];
    if (course.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(
        403,
        "Teaching course ownership is required.",
      );
    }

    const unitDrafts = database.courseUnitDrafts ?? [];
    const existingUnitDraftIndex = unitDrafts.findIndex(
      (item) => item.unitDraftId === unitDraftId,
    );
    const existingUnitDraft =
      existingUnitDraftIndex >= 0
        ? unitDrafts[existingUnitDraftIndex]
        : undefined;
    if (existingUnitDraft?.operationRecordId === operationRecordId) {
      const receipt = createReceipt({
        action: "generate-course-unit-draft",
        actorId,
        courseId,
        traceId: input.traceId,
        createdAt: existingUnitDraft.generatedAt,
        storage,
      });
      return {
        unitDraft: existingUnitDraft,
        receipt,
      };
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: generatedAt,
    };

    const unitDraft: TeachingCourseUnitDraftRecord = {
      unitDraftId,
      courseId,
      ownerTeacherId: course.ownerTeacherId,
      generatedBy: actorId,
      draftStatus: "generated",
      operationRecordId,
      ...(sourceAction ? { sourceAction } : {}),
      draftScope: "teacher-editable-unit-plan",
      sourceSystems: ["course-knowledge-index", "teaching-objectives", "quiz-bank"],
      reviewPolicy: "teacher-review-before-student-release",
      generatedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    database.courseUnitDrafts =
      existingUnitDraftIndex >= 0
        ? unitDrafts.map((item, index) =>
            index === existingUnitDraftIndex ? unitDraft : item,
          )
        : [...unitDrafts, unitDraft];
    database.updatedAt = generatedAt;

    const receipt = createReceipt({
      action: "generate-course-unit-draft",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: generatedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "generate-course-unit-draft",
      actorId,
      courseId,
      traceId: receipt.traceId,
      createdAt: generatedAt,
      storage,
      requestSource: input.audit?.requestSource,
    });
    database.auditEvents.push(auditEvent);

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return {
        unitDraft,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function saveTeachingCourseDashboardRefreshRecord(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  operationRecordId: string;
  sourceAction?: string;
  traceId?: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  now?: Date;
}): Promise<{
  dashboardState: TeachingCourseDashboardStateRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const sourceAction = input.sourceAction
    ? requireSafeId(input.sourceAction, "source action")
    : undefined;
  const now = input.now ?? new Date();
  const refreshedAt = now.toISOString();
  const dashboardStateId = `dashboard-state-${courseId}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((course) => course.courseId === courseId);
    if (courseIndex < 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
    }

    const course = database.courses[courseIndex];
    if (course.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(
        403,
        "Teaching course ownership is required.",
      );
    }

    const dashboardStates = database.dashboardStates ?? [];
    const existingDashboardStateIndex = dashboardStates.findIndex(
      (item) => item.dashboardStateId === dashboardStateId,
    );
    const existingDashboardState =
      existingDashboardStateIndex >= 0 ? dashboardStates[existingDashboardStateIndex] : undefined;
    if (existingDashboardState?.operationRecordId === operationRecordId) {
      const receipt = createReceipt({
        action: "refresh-dashboard",
        actorId,
        courseId,
        traceId: input.traceId,
        createdAt: existingDashboardState.refreshedAt,
        storage,
      });
      return {
        dashboardState: existingDashboardState,
        receipt,
      };
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: refreshedAt,
    };

    const dashboardState: TeachingCourseDashboardStateRecord = {
      dashboardStateId,
      courseId,
      ownerTeacherId: course.ownerTeacherId,
      refreshedBy: actorId,
      refreshStatus: "refreshed",
      operationRecordId,
      ...(sourceAction ? { sourceAction } : {}),
      visibleMetrics: ["engagement", "progress", "assessment-quality"],
      refreshPolicy: "teacher-visible-course-dashboard",
      refreshedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    database.dashboardStates =
      existingDashboardStateIndex >= 0
        ? dashboardStates.map((item, index) =>
            index === existingDashboardStateIndex ? dashboardState : item,
          )
        : [...dashboardStates, dashboardState];
    database.updatedAt = refreshedAt;

    const receipt = createReceipt({
      action: "refresh-dashboard",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: refreshedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "refresh-dashboard",
      actorId,
      courseId,
      traceId: receipt.traceId,
      createdAt: refreshedAt,
      storage,
      requestSource: input.audit?.requestSource,
    });
    database.auditEvents.push(auditEvent);

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return {
        dashboardState,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function saveTeachingCourseDashboardSnapshotRecord(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  operationRecordId: string;
  teachingOperationSnapshotId: string;
  sourceAction?: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  traceId?: string;
  now?: Date;
}): Promise<{
  dashboardSnapshot: TeachingCourseDashboardSnapshotRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const teachingOperationSnapshotId = requireSafeId(
    input.teachingOperationSnapshotId,
    "teaching operation dashboard snapshot id",
  );
  const sourceAction = input.sourceAction
    ? requireSafeId(input.sourceAction, "source action")
    : undefined;
  const now = input.now ?? new Date();
  const lockedAt = now.toISOString();
  const dashboardSnapshotId = `dashboard-snapshot-${courseId}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((course) => course.courseId === courseId);
    if (courseIndex < 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
    }

    const course = database.courses[courseIndex];
    if (course.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(
        403,
        "Teaching course ownership is required.",
      );
    }

    const dashboardSnapshots = database.dashboardSnapshots ?? [];
    const existingDashboardSnapshotIndex = dashboardSnapshots.findIndex(
      (item) => item.dashboardSnapshotId === dashboardSnapshotId,
    );
    const existingDashboardSnapshot =
      existingDashboardSnapshotIndex >= 0
        ? dashboardSnapshots[existingDashboardSnapshotIndex]
        : undefined;
    if (existingDashboardSnapshot?.operationRecordId === operationRecordId) {
      const receipt = createReceipt({
        action: "lock-dashboard-snapshot",
        actorId,
        courseId,
        traceId: input.traceId,
        createdAt: existingDashboardSnapshot.lockedAt,
        storage,
      });
      return {
        dashboardSnapshot: existingDashboardSnapshot,
        receipt,
      };
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: lockedAt,
    };

    const dashboardSnapshot: TeachingCourseDashboardSnapshotRecord = {
      dashboardSnapshotId,
      courseId,
      ownerTeacherId: course.ownerTeacherId,
      lockedBy: actorId,
      snapshotStatus: "locked",
      operationRecordId,
      ...(sourceAction ? { sourceAction } : {}),
      teachingOperationSnapshotId,
      snapshotScope: "daily-course-dashboard",
      retentionPolicy: "teacher-locked-dashboard-snapshot",
      lockedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    database.dashboardSnapshots =
      existingDashboardSnapshotIndex >= 0
        ? dashboardSnapshots.map((item, index) =>
            index === existingDashboardSnapshotIndex ? dashboardSnapshot : item,
          )
        : [...dashboardSnapshots, dashboardSnapshot];
    database.updatedAt = lockedAt;

    const receipt = createReceipt({
      action: "lock-dashboard-snapshot",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: lockedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "lock-dashboard-snapshot",
      actorId,
      courseId,
      traceId: receipt.traceId,
      requestSource: input.audit?.requestSource,
      createdAt: lockedAt,
      storage,
    });
    database.auditEvents.push(auditEvent);

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return {
        dashboardSnapshot,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function saveTeachingCourseQuizAssessmentRecord(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  operationRecordId: string;
  sourceAction?: string;
  traceId?: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  now?: Date;
}): Promise<{
  quizAssessment: TeachingCourseQuizAssessmentRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const sourceAction = input.sourceAction
    ? requireSafeId(input.sourceAction, "source action")
    : undefined;
  const now = input.now ?? new Date();
  const refreshedAt = now.toISOString();
  const quizAssessmentId = `quiz-assessment-${courseId}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((course) => course.courseId === courseId);
    if (courseIndex < 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
    }

    const course = database.courses[courseIndex];
    if (course.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(
        403,
        "Teaching course ownership is required.",
      );
    }

    const quizAssessments = database.quizAssessments ?? [];
    const existingQuizAssessmentIndex = quizAssessments.findIndex(
      (item) => item.quizAssessmentId === quizAssessmentId,
    );
    const existingQuizAssessment =
      existingQuizAssessmentIndex >= 0 ? quizAssessments[existingQuizAssessmentIndex] : undefined;
    if (existingQuizAssessment?.operationRecordId === operationRecordId) {
      const receipt = createReceipt({
        action: "refresh-quiz-assessment",
        actorId,
        courseId,
        traceId: input.traceId,
        createdAt: existingQuizAssessment.refreshedAt,
        storage,
      });
      return {
        quizAssessment: existingQuizAssessment,
        receipt,
      };
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: refreshedAt,
    };

    const quizAssessment: TeachingCourseQuizAssessmentRecord = {
      quizAssessmentId,
      courseId,
      ownerTeacherId: course.ownerTeacherId,
      refreshedBy: actorId,
      assessmentStatus: "refreshed",
      operationRecordId,
      ...(sourceAction ? { sourceAction } : {}),
      quizBoardStateId: `quiz-board-state-${courseId}`,
      visibleMetrics: ["completion-rate", "item-quality", "misconception-clusters"],
      reviewPolicy: "teacher-visible-quiz-quality-board",
      reusePolicy: "teacher-review-before-quiz-reuse",
      refreshedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    database.quizAssessments =
      existingQuizAssessmentIndex >= 0
        ? quizAssessments.map((item, index) =>
            index === existingQuizAssessmentIndex ? quizAssessment : item,
          )
        : [...quizAssessments, quizAssessment];
    database.updatedAt = refreshedAt;

    const receipt = createReceipt({
      action: "refresh-quiz-assessment",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: refreshedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "refresh-quiz-assessment",
      actorId,
      courseId,
      traceId: receipt.traceId,
      createdAt: refreshedAt,
      storage,
      requestSource: input.audit?.requestSource,
    });
    database.auditEvents.push(auditEvent);

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return {
        quizAssessment,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function saveTeachingCourseQuizItemReviewRecord(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  operationRecordId: string;
  sourceAction?: string;
  traceId?: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  now?: Date;
}): Promise<{
  quizItemReview: TeachingCourseQuizItemReviewRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const sourceAction = input.sourceAction
    ? requireSafeId(input.sourceAction, "source action")
    : undefined;
  const now = input.now ?? new Date();
  const flaggedAt = now.toISOString();
  const quizItemReviewId = `quiz-item-review-${courseId}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((course) => course.courseId === courseId);
    if (courseIndex < 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
    }

    const course = database.courses[courseIndex];
    if (course.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(
        403,
        "Teaching course ownership is required.",
      );
    }

    const quizItemReviews = database.quizItemReviews ?? [];
    const existingQuizItemReviewIndex = quizItemReviews.findIndex(
      (item) => item.quizItemReviewId === quizItemReviewId,
    );
    const existingQuizItemReview =
      existingQuizItemReviewIndex >= 0 ? quizItemReviews[existingQuizItemReviewIndex] : undefined;
    if (existingQuizItemReview?.operationRecordId === operationRecordId) {
      const receipt = createReceipt({
        action: "flag-quiz-item-review",
        actorId,
        courseId,
        traceId: input.traceId,
        createdAt: existingQuizItemReview.flaggedAt,
        storage,
      });
      return {
        quizItemReview: existingQuizItemReview,
        receipt,
      };
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: flaggedAt,
    };

    const quizItemReview: TeachingCourseQuizItemReviewRecord = {
      quizItemReviewId,
      courseId,
      ownerTeacherId: course.ownerTeacherId,
      flaggedBy: actorId,
      reviewStatus: "flagged-for-review",
      operationRecordId,
      ...(sourceAction ? { sourceAction } : {}),
      flaggedSignals: ["low-discrimination", "high-error-rate", "teacher-review-needed"],
      reviewPolicy: "teacher-review-before-quiz-reuse",
      flaggedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    database.quizItemReviews =
      existingQuizItemReviewIndex >= 0
        ? quizItemReviews.map((item, index) =>
            index === existingQuizItemReviewIndex ? quizItemReview : item,
          )
        : [...quizItemReviews, quizItemReview];
    database.updatedAt = flaggedAt;

    const receipt = createReceipt({
      action: "flag-quiz-item-review",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: flaggedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "flag-quiz-item-review",
      actorId,
      courseId,
      traceId: receipt.traceId,
      createdAt: flaggedAt,
      storage,
      requestSource: input.audit?.requestSource,
    });
    database.auditEvents.push(auditEvent);

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return {
        quizItemReview,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function saveTeachingAdminSettingsRecord(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  operationRecordId: string;
  sourceAction?: string;
  traceId?: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  now?: Date;
}): Promise<{
  adminSettings: TeachingCourseAdminSettingsRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const sourceAction = input.sourceAction
    ? requireSafeId(input.sourceAction, "source action")
    : undefined;
  const now = input.now ?? new Date();
  const savedAt = now.toISOString();
  const adminSettingsId = `admin-settings-${courseId}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((course) => course.courseId === courseId);
    if (courseIndex < 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
    }

    const course = database.courses[courseIndex];
    if (course.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(
        403,
        "Teaching course ownership is required.",
      );
    }

    const adminSettingsRecords = database.adminSettings ?? [];
    const existingAdminSettingsIndex = adminSettingsRecords.findIndex(
      (item) => item.adminSettingsId === adminSettingsId,
    );
    const existingAdminSettings =
      existingAdminSettingsIndex >= 0 ? adminSettingsRecords[existingAdminSettingsIndex] : undefined;
    if (existingAdminSettings?.operationRecordId === operationRecordId) {
      const receipt = createReceipt({
        action: "save-admin-settings",
        actorId,
        courseId,
        traceId: input.traceId,
        createdAt: existingAdminSettings.savedAt,
        storage,
      });
      return {
        adminSettings: existingAdminSettings,
        receipt,
      };
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: savedAt,
    };

    const adminSettings: TeachingCourseAdminSettingsRecord = {
      adminSettingsId,
      courseId,
      ownerTeacherId: course.ownerTeacherId,
      savedBy: actorId,
      settingsStatus: "saved",
      operationRecordId,
      ...(sourceAction ? { sourceAction } : {}),
      adminScopes: ["course-collaborators", "permission-boundary", "audit-routing"],
      governancePolicy: "teacher-controlled-admin-settings",
      savedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    database.adminSettings =
      existingAdminSettingsIndex >= 0
        ? adminSettingsRecords.map((item, index) =>
            index === existingAdminSettingsIndex ? adminSettings : item,
          )
        : [...adminSettingsRecords, adminSettings];
    database.updatedAt = savedAt;

    const receipt = createReceipt({
      action: "save-admin-settings",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: savedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "save-admin-settings",
      actorId,
      courseId,
      traceId: receipt.traceId,
      createdAt: savedAt,
      storage,
      requestSource: input.audit?.requestSource,
    });
    database.auditEvents.push(auditEvent);

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return {
        adminSettings,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function saveTeachingAgentSettingsRecord(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  operationRecordId: string;
  sourceAction?: string;
  traceId?: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  now?: Date;
}): Promise<{
  agentSettings: TeachingCourseAgentSettingsRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const sourceAction = input.sourceAction
    ? requireSafeId(input.sourceAction, "source action")
    : undefined;
  const now = input.now ?? new Date();
  const savedAt = now.toISOString();
  const agentSettingsId = `agent-settings-${courseId}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((course) => course.courseId === courseId);
    if (courseIndex < 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
    }

    const course = database.courses[courseIndex];
    if (course.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(
        403,
        "Teaching course ownership is required.",
      );
    }

    const agentSettingsRecords = database.agentSettings ?? [];
    const existingAgentSettingsIndex = agentSettingsRecords.findIndex(
      (item) => item.agentSettingsId === agentSettingsId,
    );
    const existingAgentSettings =
      existingAgentSettingsIndex >= 0 ? agentSettingsRecords[existingAgentSettingsIndex] : undefined;
    if (existingAgentSettings?.operationRecordId === operationRecordId) {
      const receipt = createReceipt({
        action: "save-agent-settings",
        actorId,
        courseId,
        traceId: input.traceId,
        createdAt: existingAgentSettings.savedAt,
        storage,
      });
      return {
        agentSettings: existingAgentSettings,
        receipt,
      };
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: savedAt,
    };

    const agentSettings: TeachingCourseAgentSettingsRecord = {
      agentSettingsId,
      courseId,
      ownerTeacherId: course.ownerTeacherId,
      savedBy: actorId,
      settingsStatus: "saved",
      operationRecordId,
      ...(sourceAction ? { sourceAction } : {}),
      agentScopes: ["research-agent", "method-agent", "writing-agent", "math-agent"],
      governancePolicy: "teacher-controlled-agent-settings",
      savedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    database.agentSettings =
      existingAgentSettingsIndex >= 0
        ? agentSettingsRecords.map((item, index) =>
            index === existingAgentSettingsIndex ? agentSettings : item,
          )
        : [...agentSettingsRecords, agentSettings];
    database.updatedAt = savedAt;

    const receipt = createReceipt({
      action: "save-agent-settings",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: savedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "save-agent-settings",
      actorId,
      courseId,
      traceId: receipt.traceId,
      createdAt: savedAt,
      storage,
      requestSource: input.audit?.requestSource,
    });
    database.auditEvents.push(auditEvent);

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return {
        agentSettings,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function saveTeachingAgentPermissionPreflightRecord(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  operationRecordId: string;
  sourceAction?: string;
  traceId?: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  now?: Date;
}): Promise<{
  agentPermissionPreflight: TeachingCourseAgentPermissionPreflightRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const sourceAction = input.sourceAction
    ? requireSafeId(input.sourceAction, "source action")
    : undefined;
  const now = input.now ?? new Date();
  const checkedAt = now.toISOString();
  const preflightId = `agent-permission-preflight-${courseId}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((course) => course.courseId === courseId);
    if (courseIndex < 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
    }

    const course = database.courses[courseIndex];
    if (course.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(
        403,
        "Teaching course ownership is required.",
      );
    }

    const agentPermissionPreflightRecords = database.agentPermissionPreflights ?? [];
    const existingPreflightIndex = agentPermissionPreflightRecords.findIndex(
      (item) => item.preflightId === preflightId,
    );
    const existingPreflight =
      existingPreflightIndex >= 0 ? agentPermissionPreflightRecords[existingPreflightIndex] : undefined;
    if (existingPreflight?.operationRecordId === operationRecordId) {
      const receipt = createReceipt({
        action: "record-agent-permission-preflight",
        actorId,
        courseId,
        traceId: input.traceId,
        createdAt: existingPreflight.checkedAt,
        storage,
      });
      return {
        agentPermissionPreflight: existingPreflight,
        receipt,
      };
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: checkedAt,
    };

    const agentPermissionPreflight: TeachingCourseAgentPermissionPreflightRecord = {
      preflightId,
      courseId,
      ownerTeacherId: course.ownerTeacherId,
      checkedBy: actorId,
      preflightStatus: "passed",
      operationRecordId,
      ...(sourceAction ? { sourceAction } : {}),
      checkedPermissions: ["course-bindings", "agent-roles", "student-access"],
      preflightPolicy: "teacher-agent-permission-gate",
      checkedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    database.agentPermissionPreflights =
      existingPreflightIndex >= 0
        ? agentPermissionPreflightRecords.map((item, index) =>
            index === existingPreflightIndex ? agentPermissionPreflight : item,
          )
        : [...agentPermissionPreflightRecords, agentPermissionPreflight];
    database.updatedAt = checkedAt;

    const receipt = createReceipt({
      action: "record-agent-permission-preflight",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: checkedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "record-agent-permission-preflight",
      actorId,
      courseId,
      traceId: receipt.traceId,
      createdAt: checkedAt,
      storage,
      requestSource: input.audit?.requestSource,
    });
    database.auditEvents.push(auditEvent);

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return {
        agentPermissionPreflight,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function saveTeachingCollaborationInviteNotificationRecord(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  operationRecordId: string;
  outboxId: string;
  sourceAction?: string;
  traceId?: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  now?: Date;
}): Promise<{
  notification: TeachingCourseCollaborationInviteNotificationRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const outboxId = requireSafeId(input.outboxId, "outbox id");
  const sourceAction = input.sourceAction
    ? requireSafeId(input.sourceAction, "source action")
    : undefined;
  const now = input.now ?? new Date();
  const queuedAt = now.toISOString();
  const notificationId = `collaboration-invite-notification-${courseId}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((course) => course.courseId === courseId);
    if (courseIndex < 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
    }

    const course = database.courses[courseIndex];
    if (course.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(
        403,
        "Teaching course ownership is required.",
      );
    }

    const notifications = database.collaborationInviteNotifications ?? [];
    const existingNotificationIndex = notifications.findIndex(
      (item) => item.notificationId === notificationId,
    );
    const existingNotification =
      existingNotificationIndex >= 0 ? notifications[existingNotificationIndex] : undefined;
    if (
      existingNotification?.operationRecordId === operationRecordId &&
      existingNotification.outboxId === outboxId
    ) {
      const receipt = createReceipt({
        action: "queue-collaboration-invite-notification",
        actorId,
        courseId,
        traceId: input.traceId,
        createdAt: existingNotification.queuedAt,
        storage,
      });
      return {
        notification: existingNotification,
        receipt,
      };
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: queuedAt,
    };

    const notification: TeachingCourseCollaborationInviteNotificationRecord = {
      notificationId,
      courseId,
      ownerTeacherId: course.ownerTeacherId,
      queuedBy: actorId,
      notificationStatus: "queued-for-provider",
      operationRecordId,
      ...(sourceAction ? { sourceAction } : {}),
      outboxId,
      deliveryChannel: "collaboration-invite-email",
      providerStatus: "smtp-provider-pending",
      deliveryPolicy: "server-outbox-before-smtp-provider",
      queuedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    database.collaborationInviteNotifications =
      existingNotificationIndex >= 0
        ? notifications.map((item, index) =>
            index === existingNotificationIndex ? notification : item,
          )
        : [...notifications, notification];
    database.updatedAt = queuedAt;

    const receipt = createReceipt({
      action: "queue-collaboration-invite-notification",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: queuedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "queue-collaboration-invite-notification",
      actorId,
      courseId,
      traceId: receipt.traceId,
      createdAt: queuedAt,
      requestSource: input.audit?.requestSource,
      storage,
    });
    database.auditEvents.push(auditEvent);

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return {
        notification,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function markTeachingCollaborationInviteNotificationDelivered(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  operationRecordId: string;
  outboxId: string;
  providerDeliveryId: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  traceId?: string;
  now?: Date;
}): Promise<{
  notification: TeachingCourseCollaborationInviteNotificationRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const outboxId = requireSafeId(input.outboxId, "outbox id");
  const providerDeliveryId = requireSafeId(input.providerDeliveryId, "provider delivery id");
  const now = input.now ?? new Date();
  const deliveredAt = now.toISOString();
  const notificationId = `collaboration-invite-notification-${courseId}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((course) => course.courseId === courseId);
    if (courseIndex < 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
    }

    const course = database.courses[courseIndex];
    if (course.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(
        403,
        "Teaching course ownership is required.",
      );
    }

    const notifications = database.collaborationInviteNotifications ?? [];
    const existingNotificationIndex = notifications.findIndex(
      (item) =>
        item.notificationId === notificationId &&
        item.operationRecordId === operationRecordId &&
        item.outboxId === outboxId,
    );
    if (existingNotificationIndex < 0) {
      throw new TeachingCourseManagementStoreError(
        404,
        "Teaching collaboration invite notification was not found.",
      );
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: deliveredAt,
    };

    const notification: TeachingCourseCollaborationInviteNotificationRecord = {
      ...notifications[existingNotificationIndex],
      notificationStatus: "delivered-to-provider",
      providerStatus: "smtp-provider-delivered",
      providerDeliveryId,
      deliveredAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      redaction: createRedaction(),
    };
    database.collaborationInviteNotifications = notifications.map((item, index) =>
      index === existingNotificationIndex ? notification : item,
    );
    database.updatedAt = deliveredAt;

    const receipt = createReceipt({
      action: "deliver-collaboration-invite-email",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: deliveredAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "deliver-collaboration-invite-email",
      actorId,
      courseId,
      traceId: receipt.traceId,
      requestSource: input.audit?.requestSource,
      createdAt: deliveredAt,
      storage,
    });
    database.auditEvents.push(auditEvent);

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return {
        notification,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function recordTeachingCollaborationInviteEmailDeliveryCallback(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  courseId: string;
  operationRecordId: string;
  outboxId: string;
  providerDeliveryId: string;
  providerStatus: "bounced";
  failureReason: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  traceId?: string;
  now?: Date;
}): Promise<{
  notification: TeachingCourseCollaborationInviteNotificationRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const outboxId = requireSafeId(input.outboxId, "outbox id");
  const providerDeliveryId = requireSafeId(input.providerDeliveryId, "provider delivery id");
  const failureReason = requireSafeId(input.failureReason, "delivery failure reason");
  const callbackAt = (input.now ?? new Date()).toISOString();
  const notificationId = `collaboration-invite-notification-${courseId}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((course) => course.courseId === courseId);
    if (courseIndex < 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
    }

    const course = database.courses[courseIndex];
    const notifications = database.collaborationInviteNotifications ?? [];
    const existingNotificationIndex = notifications.findIndex(
      (item) =>
        item.notificationId === notificationId &&
        item.operationRecordId === operationRecordId &&
        item.outboxId === outboxId &&
        item.providerDeliveryId === providerDeliveryId,
    );
    if (existingNotificationIndex < 0) {
      throw new TeachingCourseManagementStoreError(
        404,
        "Teaching collaboration invite notification delivery was not found.",
      );
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: callbackAt,
    };

    const notification: TeachingCourseCollaborationInviteNotificationRecord = {
      ...notifications[existingNotificationIndex],
      notificationStatus: "delivery-failed",
      providerStatus: "smtp-provider-bounced",
      providerDeliveryId,
      deliveryFailureReason: failureReason,
      providerCallbackAt: callbackAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      redaction: createRedaction(),
    };
    database.collaborationInviteNotifications = notifications.map((item, index) =>
      index === existingNotificationIndex ? notification : item,
    );
    database.updatedAt = callbackAt;

    const receipt = createReceipt({
      action: "record-collaboration-invite-email-delivery-callback",
      actorId: course.ownerTeacherId,
      courseId,
      traceId: input.traceId,
      createdAt: callbackAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "record-collaboration-invite-email-delivery-callback",
      actorId: course.ownerTeacherId,
      courseId,
      traceId: receipt.traceId,
      requestSource: input.audit?.requestSource,
      createdAt: callbackAt,
      storage,
    });
    database.auditEvents.push(auditEvent);

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return {
        notification,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function saveTeachingCourseExportManifestRecord(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  operationRecordId: string;
  teachingOperationManifestId: string;
  sourceAction?: string;
  traceId?: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  now?: Date;
}): Promise<{
  exportManifest: TeachingCourseExportManifestRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const teachingOperationManifestId = requireSafeId(
    input.teachingOperationManifestId,
    "teaching operation manifest id",
  );
  const sourceAction = input.sourceAction
    ? requireSafeId(input.sourceAction, "source action")
    : undefined;
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const exportManifestId = `export-manifest-${courseId}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((course) => course.courseId === courseId);
    if (courseIndex < 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
    }

    const course = database.courses[courseIndex];
    if (course.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(
        403,
        "Teaching course ownership is required.",
      );
    }

    const exportManifests = database.exportManifests ?? [];
    const existingExportManifestIndex = exportManifests.findIndex(
      (item) => item.exportManifestId === exportManifestId,
    );
    const existingExportManifest =
      existingExportManifestIndex >= 0
        ? exportManifests[existingExportManifestIndex]
        : undefined;
    if (existingExportManifest?.operationRecordId === operationRecordId) {
      const receipt = createReceipt({
        action: "create-export-manifest",
        actorId,
        courseId,
        traceId: input.traceId,
        createdAt: existingExportManifest.createdAt,
        storage,
      });
      return {
        exportManifest: existingExportManifest,
        receipt,
      };
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: createdAt,
    };

    const exportManifest: TeachingCourseExportManifestRecord = {
      exportManifestId,
      courseId,
      ownerTeacherId: course.ownerTeacherId,
      createdBy: actorId,
      exportStatus: "generated",
      operationRecordId,
      ...(sourceAction ? { sourceAction } : {}),
      teachingOperationManifestId,
      downloadRoute: `/api/teaching/operations/export/${teachingOperationManifestId}`,
      datasetScopes: ["learning-records", "chat-threads", "grades", "activities"],
      formats: ["json", "csv"],
      exportPolicy: "redacted-teacher-export-manifest",
      createdAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    database.exportManifests =
      existingExportManifestIndex >= 0
        ? exportManifests.map((item, index) =>
            index === existingExportManifestIndex ? exportManifest : item,
          )
        : [...exportManifests, exportManifest];
    database.updatedAt = createdAt;

    const receipt = createReceipt({
      action: "create-export-manifest",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "create-export-manifest",
      actorId,
      courseId,
      traceId: receipt.traceId,
      createdAt,
      requestSource: input.audit?.requestSource,
      storage,
    });
    database.auditEvents.push(auditEvent);

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return {
        exportManifest,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function markTeachingCourseExportProviderExported(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  operationRecordId: string;
  providerExportId: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  traceId?: string;
  now?: Date;
}): Promise<{
  exportManifest: TeachingCourseExportManifestRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const providerExportId = requireSafeId(input.providerExportId, "provider export id");
  const now = input.now ?? new Date();
  const providerExportedAt = now.toISOString();
  const exportManifestId = `export-manifest-${courseId}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((course) => course.courseId === courseId);
    if (courseIndex < 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
    }

    const course = database.courses[courseIndex];
    if (course.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(
        403,
        "Teaching course ownership is required.",
      );
    }

    const exportManifests = database.exportManifests ?? [];
    const exportManifestIndex = exportManifests.findIndex(
      (item) =>
        item.exportManifestId === exportManifestId &&
        item.operationRecordId === operationRecordId,
    );
    if (exportManifestIndex < 0) {
      throw new TeachingCourseManagementStoreError(
        404,
        "Teaching export manifest record was not found.",
      );
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: providerExportedAt,
    };

    const exportManifest: TeachingCourseExportManifestRecord = {
      ...exportManifests[exportManifestIndex],
      providerStatus: "export-provider-exported",
      providerExportId,
      providerExportedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      redaction: createRedaction(),
    };
    database.exportManifests = exportManifests.map((item, index) =>
      index === exportManifestIndex ? exportManifest : item,
    );
    database.updatedAt = providerExportedAt;

    const receipt = createReceipt({
      action: "export-course-data-provider",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: providerExportedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "export-course-data-provider",
      actorId,
      courseId,
      traceId: receipt.traceId,
      requestSource: input.audit?.requestSource,
      createdAt: providerExportedAt,
      storage,
    });
    database.auditEvents.push(auditEvent);

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return {
        exportManifest,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function saveTeachingCourseExportRedactionValidationRecord(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  operationRecordId: string;
  sourceAction?: string;
  traceId?: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  now?: Date;
}): Promise<{
  exportRedactionValidation: TeachingCourseExportRedactionValidationRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const sourceAction = input.sourceAction
    ? requireSafeId(input.sourceAction, "source action")
    : undefined;
  const now = input.now ?? new Date();
  const validatedAt = now.toISOString();
  const exportRedactionValidationId = `export-redaction-validation-${courseId}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((course) => course.courseId === courseId);
    if (courseIndex < 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
    }

    const course = database.courses[courseIndex];
    if (course.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(
        403,
        "Teaching course ownership is required.",
      );
    }

    const exportRedactionValidations = database.exportRedactionValidations ?? [];
    const existingValidationIndex = exportRedactionValidations.findIndex(
      (item) => item.exportRedactionValidationId === exportRedactionValidationId,
    );
    const existingValidation =
      existingValidationIndex >= 0
        ? exportRedactionValidations[existingValidationIndex]
        : undefined;
    if (existingValidation?.operationRecordId === operationRecordId) {
      const receipt = createReceipt({
        action: "validate-export-redaction-scope",
        actorId,
        courseId,
        traceId: input.traceId,
        createdAt: existingValidation.validatedAt,
        storage,
      });
      return {
        exportRedactionValidation: existingValidation,
        receipt,
      };
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: validatedAt,
    };

    const exportRedactionValidation: TeachingCourseExportRedactionValidationRecord = {
      exportRedactionValidationId,
      courseId,
      ownerTeacherId: course.ownerTeacherId,
      validatedBy: actorId,
      validationStatus: "passed",
      operationRecordId,
      ...(sourceAction ? { sourceAction } : {}),
      checkedScopes: [
        "identity-fields",
        "ai-chat-transcripts",
        "voice-references",
        "local-file-paths",
      ],
      blockedSecretCount: 0,
      validationPolicy: "no-secrets-or-local-paths-before-export",
      validatedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    database.exportRedactionValidations =
      existingValidationIndex >= 0
        ? exportRedactionValidations.map((item, index) =>
            index === existingValidationIndex ? exportRedactionValidation : item,
          )
        : [...exportRedactionValidations, exportRedactionValidation];
    database.updatedAt = validatedAt;

    const receipt = createReceipt({
      action: "validate-export-redaction-scope",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: validatedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "validate-export-redaction-scope",
      actorId,
      courseId,
      traceId: receipt.traceId,
      createdAt: validatedAt,
      requestSource: input.audit?.requestSource,
      storage,
    });
    database.auditEvents.push(auditEvent);

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return {
        exportRedactionValidation,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function saveTeachingGradingQueueRecord(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  operationRecordId: string;
  sourceAction?: string;
  traceId?: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  now?: Date;
}): Promise<{
  gradingQueue: TeachingCourseGradingQueueRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const sourceAction = input.sourceAction
    ? requireSafeId(input.sourceAction, "source action")
    : undefined;
  const now = input.now ?? new Date();
  const savedAt = now.toISOString();
  const gradingQueueId = `grading-queue-${courseId}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((course) => course.courseId === courseId);
    if (courseIndex < 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
    }

    const course = database.courses[courseIndex];
    if (course.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(
        403,
        "Teaching course ownership is required.",
      );
    }

    const gradingQueues = database.gradingQueues ?? [];
    const existingGradingQueueIndex = gradingQueues.findIndex(
      (item) => item.gradingQueueId === gradingQueueId,
    );
    const existingGradingQueue =
      existingGradingQueueIndex >= 0 ? gradingQueues[existingGradingQueueIndex] : undefined;
    const gradebookUpdateId = `gradebook-update-${courseId}`;
    const gradebookUpdates = database.gradebookUpdates ?? [];
    const existingGradebookUpdateIndex = gradebookUpdates.findIndex(
      (item) => item.objectId === gradebookUpdateId,
    );
    const existingGradebookUpdate =
      existingGradebookUpdateIndex >= 0
        ? gradebookUpdates[existingGradebookUpdateIndex]
        : undefined;
    if (
      existingGradingQueue?.operationRecordId === operationRecordId &&
      existingGradebookUpdate?.operationRecordId === operationRecordId
    ) {
      const receipt = createReceipt({
        action: "save-grading-queue",
        actorId,
        courseId,
        traceId: input.traceId,
        createdAt: existingGradingQueue.savedAt,
        storage,
      });
      return {
        gradingQueue: existingGradingQueue,
        receipt,
      };
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: savedAt,
    };

    const gradingQueue: TeachingCourseGradingQueueRecord = {
      gradingQueueId,
      courseId,
      ownerTeacherId: course.ownerTeacherId,
      savedBy: actorId,
      queueStatus: "saved",
      operationRecordId,
      ...(sourceAction ? { sourceAction } : {}),
      gradebookUpdateId: `gradebook-update-${courseId}`,
      reviewPolicy: "teacher-review-before-release",
      releasePolicy: "teacher-confirmed-grade-release",
      savedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    const gradebookUpdate: TeachingCourseGradebookUpdateRecord = {
      objectId: gradebookUpdateId,
      objectType: "gradebook-update",
      courseId,
      updatedBy: actorId,
      updateStatus: "pending-release",
      operationRecordId,
      ...(sourceAction ? { sourceAction } : {}),
      releasePolicy: "teacher-confirmed-grade-release",
      updatedAt: savedAt,
      storagePolicy: "domain-projection-teaching-gradebook-update",
      redaction: createRedaction(),
    };
    database.gradingQueues =
      existingGradingQueueIndex >= 0
        ? gradingQueues.map((item, index) =>
            index === existingGradingQueueIndex ? gradingQueue : item,
          )
        : [...gradingQueues, gradingQueue];
    database.gradebookUpdates =
      existingGradebookUpdateIndex >= 0
        ? gradebookUpdates.map((item, index) =>
            index === existingGradebookUpdateIndex ? gradebookUpdate : item,
          )
        : [...gradebookUpdates, gradebookUpdate];
    database.updatedAt = savedAt;

    const receipt = createReceipt({
      action: "save-grading-queue",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: savedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "save-grading-queue",
      actorId,
      courseId,
      traceId: receipt.traceId,
      createdAt: savedAt,
      storage,
      requestSource: input.audit?.requestSource,
    });
    database.auditEvents.push(auditEvent);

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return {
        gradingQueue,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function saveTeachingGradingFeedbackDraftRecord(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  operationRecordId: string;
  teachingOperationFeedbackArtifactId: string;
  sourceAction?: string;
  traceId?: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  now?: Date;
}): Promise<{
  gradingFeedbackDraft: TeachingCourseGradingFeedbackDraftRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const teachingOperationFeedbackArtifactId = requireSafeId(
    input.teachingOperationFeedbackArtifactId,
    "teaching operation feedback artifact id",
  );
  const sourceAction = input.sourceAction
    ? requireSafeId(input.sourceAction, "source action")
    : undefined;
  const now = input.now ?? new Date();
  const generatedAt = now.toISOString();
  const gradingFeedbackDraftId = `grading-feedback-draft-${courseId}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((course) => course.courseId === courseId);
    if (courseIndex < 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
    }

    const course = database.courses[courseIndex];
    if (course.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(
        403,
        "Teaching course ownership is required.",
      );
    }

    const gradingFeedbackDrafts = database.gradingFeedbackDrafts ?? [];
    const existingDraftIndex = gradingFeedbackDrafts.findIndex(
      (item) => item.gradingFeedbackDraftId === gradingFeedbackDraftId,
    );
    const existingDraft =
      existingDraftIndex >= 0 ? gradingFeedbackDrafts[existingDraftIndex] : undefined;
    if (existingDraft?.operationRecordId === operationRecordId) {
      const receipt = createReceipt({
        action: "generate-grading-feedback-draft",
        actorId,
        courseId,
        traceId: input.traceId,
        createdAt: existingDraft.generatedAt,
        storage,
      });
      return {
        gradingFeedbackDraft: existingDraft,
        receipt,
      };
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: generatedAt,
    };

    const gradingFeedbackDraft: TeachingCourseGradingFeedbackDraftRecord = {
      gradingFeedbackDraftId,
      courseId,
      ownerTeacherId: course.ownerTeacherId,
      generatedBy: actorId,
      feedbackStatus: "generated",
      operationRecordId,
      ...(sourceAction ? { sourceAction } : {}),
      teachingOperationFeedbackArtifactId,
      feedbackScope: "grading-review-queue",
      reviewPolicy: "teacher-review-before-student-release",
      releasePolicy: "teacher-confirmed-feedback-release",
      generatedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    database.gradingFeedbackDrafts =
      existingDraftIndex >= 0
        ? gradingFeedbackDrafts.map((item, index) =>
            index === existingDraftIndex ? gradingFeedbackDraft : item,
          )
        : [...gradingFeedbackDrafts, gradingFeedbackDraft];
    database.updatedAt = generatedAt;

    const receipt = createReceipt({
      action: "generate-grading-feedback-draft",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: generatedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "generate-grading-feedback-draft",
      actorId,
      courseId,
      traceId: receipt.traceId,
      createdAt: generatedAt,
      requestSource: input.audit?.requestSource,
      storage,
    });
    database.auditEvents.push(auditEvent);

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return {
        gradingFeedbackDraft,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function markTeachingGradingFeedbackProviderGenerated(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  operationRecordId: string;
  providerFeedbackId: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  traceId?: string;
  now?: Date;
}): Promise<{
  gradingFeedbackDraft: TeachingCourseGradingFeedbackDraftRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const providerFeedbackId = requireSafeId(input.providerFeedbackId, "provider feedback id");
  const now = input.now ?? new Date();
  const providerGeneratedAt = now.toISOString();
  const gradingFeedbackDraftId = `grading-feedback-draft-${courseId}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((course) => course.courseId === courseId);
    if (courseIndex < 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
    }

    const course = database.courses[courseIndex];
    if (course.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(
        403,
        "Teaching course ownership is required.",
      );
    }

    const gradingFeedbackDrafts = database.gradingFeedbackDrafts ?? [];
    const gradingFeedbackDraftIndex = gradingFeedbackDrafts.findIndex(
      (item) =>
        item.gradingFeedbackDraftId === gradingFeedbackDraftId &&
        item.operationRecordId === operationRecordId,
    );
    if (gradingFeedbackDraftIndex < 0) {
      throw new TeachingCourseManagementStoreError(
        404,
        "Teaching grading feedback draft record was not found.",
      );
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: providerGeneratedAt,
    };

    const gradingFeedbackDraft: TeachingCourseGradingFeedbackDraftRecord = {
      ...gradingFeedbackDrafts[gradingFeedbackDraftIndex],
      providerStatus: "feedback-provider-generated",
      providerFeedbackId,
      providerGeneratedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      redaction: createRedaction(),
    };
    database.gradingFeedbackDrafts = gradingFeedbackDrafts.map((item, index) =>
      index === gradingFeedbackDraftIndex ? gradingFeedbackDraft : item,
    );
    database.updatedAt = providerGeneratedAt;

    const receipt = createReceipt({
      action: "generate-grading-feedback-provider",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: providerGeneratedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "generate-grading-feedback-provider",
      actorId,
      courseId,
      traceId: receipt.traceId,
      requestSource: input.audit?.requestSource,
      createdAt: providerGeneratedAt,
      storage,
    });
    database.auditEvents.push(auditEvent);

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return {
        gradingFeedbackDraft,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function rollbackTeachingCourseCreation(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  traceId: string;
  rolledBackAt?: string;
}) {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const snapshot = await readTeachingCourseManagementSnapshot({
    dataDir,
    repository: input.repository,
  });
  const database = snapshot.database;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const rolledBackAt = input.rolledBackAt ?? new Date().toISOString();
  const nextDatabase: TeachingCourseManagementDatabase = {
    schemaVersion: "uais-teaching-course-management-v1",
    updatedAt: rolledBackAt,
    courses: database.courses.filter(
      (course) => !(course.courseId === courseId && course.ownerTeacherId === actorId),
    ),
    classes: database.classes.filter((classItem) => classItem.courseId !== courseId),
    memberships: database.memberships.filter((membership) => membership.courseId !== courseId),
    ...(database.inviteCodeDrafts
      ? {
          inviteCodeDrafts: database.inviteCodeDrafts.filter(
            (draft) => draft.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.courseSettings
      ? {
          courseSettings: database.courseSettings.filter(
            (settings) => settings.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.studentPreviewSessions
      ? {
          studentPreviewSessions: database.studentPreviewSessions.filter(
            (session) => session.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.studentRosters
      ? {
          studentRosters: database.studentRosters.filter(
            (roster) => roster.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.studentGroupSuggestions
      ? {
          studentGroupSuggestions: database.studentGroupSuggestions.filter(
            (suggestion) => suggestion.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.knowledgeIndexes
      ? {
          knowledgeIndexes: database.knowledgeIndexes.filter(
            (index) => index.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.resourceReviewItems
      ? {
          resourceReviewItems: database.resourceReviewItems.filter(
            (item) => item.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.contentPackages
      ? {
          contentPackages: database.contentPackages.filter(
            (content) => content.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.courseUnitDrafts
      ? {
          courseUnitDrafts: database.courseUnitDrafts.filter(
            (draft) => draft.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.dashboardStates
      ? {
          dashboardStates: database.dashboardStates.filter(
            (state) => state.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.dashboardSnapshots
      ? {
          dashboardSnapshots: database.dashboardSnapshots.filter(
            (snapshot) => snapshot.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.quizAssessments
      ? {
          quizAssessments: database.quizAssessments.filter(
            (assessment) => assessment.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.quizItemReviews
      ? {
          quizItemReviews: database.quizItemReviews.filter(
            (review) => review.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.agentSettings
      ? {
          agentSettings: database.agentSettings.filter(
            (settings) => settings.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.agentPermissionPreflights
      ? {
          agentPermissionPreflights: database.agentPermissionPreflights.filter(
            (preflight) => preflight.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.adminSettings
      ? {
          adminSettings: database.adminSettings.filter(
            (settings) => settings.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.collaborationInviteNotifications
      ? {
          collaborationInviteNotifications: database.collaborationInviteNotifications.filter(
            (notification) => notification.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.exportManifests
      ? {
          exportManifests: database.exportManifests.filter(
            (manifest) => manifest.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.exportRedactionValidations
      ? {
          exportRedactionValidations: database.exportRedactionValidations.filter(
            (validation) => validation.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.gradingQueues
      ? {
          gradingQueues: database.gradingQueues.filter(
            (queue) => queue.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.gradebookUpdates
      ? {
          gradebookUpdates: database.gradebookUpdates.filter(
            (update) => update.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.gradingFeedbackDrafts
      ? {
          gradingFeedbackDrafts: database.gradingFeedbackDrafts.filter(
            (draft) => draft.courseId !== courseId,
          ),
        }
      : {}),
    auditEvents: database.auditEvents.map((event) =>
      event.action === "create-course" &&
      event.actorId === actorId &&
      event.courseId === courseId &&
      event.traceId === input.traceId
        ? {
            ...event,
            rollbackStatus: "rolled-back" as const,
            rolledBackAt,
          }
        : event,
    ),
  };
  await writeTeachingCourseManagementSnapshot({
    dataDir,
    repository: input.repository,
    database: nextDatabase,
    expectedRevision: snapshot.revision,
  });
}

export async function saveTeachingClassInviteCodeDraftRecord(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  classId: string;
  operationRecordId: string;
  invitationCode: string;
  sourceAction?: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  traceId?: string;
  now?: Date;
}): Promise<{
  inviteCodeDraft: TeachingClassInviteCodeDraftRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const classId = requireSafeId(input.classId, "class id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const invitationCode = requireInviteCode(input.invitationCode, 400);
  const sourceAction = input.sourceAction
    ? requireSafeId(input.sourceAction, "source action")
    : undefined;
  const now = input.now ?? new Date();
  const generatedAt = now.toISOString();
  const inviteCodeDraftId = `invite-code-draft-${courseId}-${invitationCode}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((item) => item.courseId === courseId);
    const course = courseIndex >= 0 ? database.courses[courseIndex] : undefined;
    if (course && course.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(403, "Teaching course ownership is required.");
    }

    const classIndex = database.classes.findIndex(
      (item) => item.classId === classId && item.courseId === courseId,
    );
    if (classIndex < 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching class was not found.");
    }

    const classItem = database.classes[classIndex];
    if (classItem.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(403, "Teaching class ownership is required.");
    }

    const inviteCodeDrafts = database.inviteCodeDrafts ?? [];
    const existingDraftIndex = inviteCodeDrafts.findIndex(
      (item) => item.inviteCodeDraftId === inviteCodeDraftId,
    );
    const existingDraft =
      existingDraftIndex >= 0
        ? inviteCodeDrafts[existingDraftIndex]
        : undefined;
    if (existingDraft?.operationRecordId === operationRecordId) {
      const receipt = createReceipt({
        action: "generate-class-invite-code-draft",
        actorId,
        courseId,
        classId,
        traceId: input.traceId,
        createdAt: existingDraft.generatedAt,
        storage,
      });
      return {
        inviteCodeDraft: existingDraft,
        receipt,
      };
    }

    database.classes[classIndex] = {
      ...classItem,
      updatedAt: generatedAt,
    };
    if (course && courseIndex >= 0) {
      database.courses[courseIndex] = {
        ...course,
        updatedAt: generatedAt,
        storagePolicy: storage.recordStoragePolicy,
        storageWritePolicy: storage.storageWritePolicy,
        redaction: createRedaction(),
      };
    }

    const inviteCodeDraft: TeachingClassInviteCodeDraftRecord = {
      inviteCodeDraftId,
      courseId,
      classId,
      ownerTeacherId: classItem.ownerTeacherId,
      generatedBy: actorId,
      draftStatus: "generated",
      operationRecordId,
      ...(sourceAction ? { sourceAction } : {}),
      inviteCode: invitationCode,
      joinUrl: `/courses?invite=${invitationCode}`,
      invitePolicy: "teacher-review-before-publication",
      generatedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    database.inviteCodeDrafts =
      existingDraftIndex >= 0
        ? inviteCodeDrafts.map((item, index) =>
            index === existingDraftIndex ? inviteCodeDraft : item,
          )
        : [...inviteCodeDrafts, inviteCodeDraft];

    const receipt = createReceipt({
      action: "generate-class-invite-code-draft",
      actorId,
      courseId,
      classId,
      traceId: input.traceId,
      createdAt: generatedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "generate-class-invite-code-draft",
      actorId,
      courseId,
      classId,
      traceId: receipt.traceId,
      requestSource: input.audit?.requestSource,
      createdAt: generatedAt,
      storage,
    });
    database.auditEvents.push(auditEvent);
    database.updatedAt = generatedAt;

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return {
        inviteCodeDraft,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function publishTeachingClassInviteCode(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  classId: string;
  invitationCode: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  traceId?: string;
  now?: Date;
}): Promise<{
  classItem: TeachingClassRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const classId = requireSafeId(input.classId, "class id");
  const invitationCode = requireInviteCode(input.invitationCode, 400);
  const now = input.now ?? new Date();
  const publishedAt = now.toISOString();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((item) => item.courseId === courseId);
    const course = courseIndex >= 0 ? database.courses[courseIndex] : undefined;
    if (course && course.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(403, "Teaching course ownership is required.");
    }

    const classIndex = database.classes.findIndex(
      (item) => item.classId === classId && item.courseId === courseId,
    );
    if (classIndex < 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching class was not found.");
    }

    const classItem = database.classes[classIndex];
    if (classItem.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(403, "Teaching class ownership is required.");
    }

    const duplicateClass = database.classes.find(
      (item) => item.invitationCode === invitationCode && item.classId !== classId,
    );
    if (duplicateClass) {
      throw new TeachingCourseManagementStoreError(
        409,
        "Teaching class invite code already exists.",
      );
    }

    const joinUrl = `/courses?invite=${invitationCode}`;
    const existingPublishEvent = [...database.auditEvents].reverse().find(
      (event) =>
        event.action === "publish-class-invite-code" &&
        event.actorId === actorId &&
        event.courseId === courseId &&
        event.classId === classId,
    );
    if (
      existingPublishEvent &&
      classItem.invitationCode === invitationCode &&
      classItem.joinUrl === joinUrl
    ) {
      const receipt = createReceipt({
        action: "publish-class-invite-code",
        actorId,
        courseId,
        classId,
        traceId: input.traceId,
        createdAt: existingPublishEvent.createdAt,
        storage,
      });
      return {
        classItem,
        receipt,
      };
    }

    const updatedClass: TeachingClassRecord = {
      ...classItem,
      invitationCode,
      joinUrl,
      updatedAt: publishedAt,
    };
    database.classes[classIndex] = updatedClass;
    if (course && courseIndex >= 0) {
      database.courses[courseIndex] = {
        ...course,
        updatedAt: publishedAt,
        storagePolicy: storage.recordStoragePolicy,
        storageWritePolicy: storage.storageWritePolicy,
        redaction: createRedaction(),
      };
    }

    const receipt = createReceipt({
      action: "publish-class-invite-code",
      actorId,
      courseId,
      classId,
      traceId: input.traceId,
      createdAt: publishedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "publish-class-invite-code",
      actorId,
      courseId,
      classId,
      traceId: receipt.traceId,
      requestSource: input.audit?.requestSource,
      createdAt: publishedAt,
      storage,
    });

    database.auditEvents.push(auditEvent);
    database.updatedAt = publishedAt;
    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return {
        classItem: updatedClass,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function assertTeachingClassInviteCodePublishTarget(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  classId: string;
}) {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const { database } = await readTeachingCourseManagementSnapshot({
    dataDir,
    repository: input.repository,
  });
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const classId = requireSafeId(input.classId, "class id");
  const classItem = database.classes.find(
    (item) => item.classId === classId && item.courseId === courseId,
  );
  if (!classItem) {
    throw new TeachingCourseManagementStoreError(404, "Teaching class was not found.");
  }
  if (classItem.ownerTeacherId !== actorId) {
    throw new TeachingCourseManagementStoreError(403, "Teaching class ownership is required.");
  }
}

export async function joinTeachingClassByInviteCode(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  join: TeachingClassJoinInput;
  traceId?: string;
  now?: Date;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
    authSession?: TeachingCourseManagementAuthSessionSummary;
  };
}): Promise<{
  membership: TeachingClassMembershipRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const invitationCode = requireInviteCode(input.join.invitationCode, 400);
  const studentId = requireSafeId(input.join.studentId, "student id");
  const studentDisplayName = requireTrimmedString(
    input.join.studentDisplayName,
    "student display name",
    160,
  );
  const now = input.now ?? new Date();
  const joinedAt = now.toISOString();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const classItem = database.classes.find((item) => item.invitationCode === invitationCode);
    if (!classItem) {
      throw new TeachingCourseManagementStoreError(
        404,
        "Teaching class invite code was not found.",
      );
    }
    const classIndex = database.classes.findIndex((item) => item.classId === classItem.classId);
    const courseIndex = database.courses.findIndex(
      (item) => item.courseId === classItem.courseId,
    );
    if (courseIndex < 0) {
      throw new TeachingCourseManagementStoreError(500, "Teaching class course is missing.");
    }

    const membershipId = `membership-${classItem.classId}-${studentId}`;
    const existingMembership = database.memberships.find(
      (membership) => membership.membershipId === membershipId,
    );
    if (existingMembership) {
      return {
        membership: existingMembership,
        receipt: createReceipt({
          action: "join-class-by-invite",
          actorId: studentId,
          courseId: existingMembership.courseId,
          classId: existingMembership.classId,
          traceId: input.traceId,
          createdAt: joinedAt,
          authSession: input.audit?.authSession,
          storage,
        }),
      };
    }

    const existingCourseMembership = database.memberships.find(
      (membership) =>
        membership.studentId === studentId &&
        membership.courseId === classItem.courseId &&
        membership.classId !== classItem.classId &&
        (membership.membershipStatus === "pending-teacher-review" ||
          membership.membershipStatus === "approved"),
    );
    if (existingCourseMembership) {
      throw new TeachingCourseManagementStoreError(
        409,
        "Student already has a membership in this teaching course.",
      );
    }

    const membership: TeachingClassMembershipRecord = {
      membershipId,
      courseId: classItem.courseId,
      classId: classItem.classId,
      invitationCode,
      studentId,
      studentDisplayName,
      membershipStatus: "pending-teacher-review",
      joinedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    const receipt = createReceipt({
      action: "join-class-by-invite",
      actorId: studentId,
      courseId: classItem.courseId,
      classId: classItem.classId,
      traceId: input.traceId,
      createdAt: joinedAt,
      authSession: input.audit?.authSession,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "join-class-by-invite",
      actorId: studentId,
      courseId: classItem.courseId,
      classId: classItem.classId,
      traceId: receipt.traceId,
      actorRole: "student",
      authMode: "app-student-session",
      createdAt: joinedAt,
      requestSource: input.audit?.requestSource,
      authSession: input.audit?.authSession,
      storage,
    });

    database.memberships.push(membership);
    database.classes[classIndex] = {
      ...classItem,
      updatedAt: joinedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      redaction: createRedaction(),
    };
    database.courses[courseIndex] = {
      ...database.courses[courseIndex],
      updatedAt: joinedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      redaction: createRedaction(),
    };
    database.auditEvents.push(auditEvent);
    database.updatedAt = joinedAt;
    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return { membership, receipt };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function approveTeachingClassMembership(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  classId: string;
  membershipId: string;
  traceId?: string;
  now?: Date;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
    authSession?: TeachingCourseManagementAuthSessionSummary;
  };
}): Promise<{
  membership: TeachingClassMembershipRecord;
  classItem: TeachingClassRecord;
  course: TeachingCourseRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const classId = requireSafeId(input.classId, "class id");
  const membershipId = requireSafeId(input.membershipId, "membership id");
  const now = input.now ?? new Date();
  const approvedAt = now.toISOString();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const classIndex = database.classes.findIndex((item) => item.classId === classId);
    if (classIndex < 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching class was not found.");
    }

    const classItem = database.classes[classIndex];
    if (classItem.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(403, "Teaching class ownership is required.");
    }

    const courseIndex = database.courses.findIndex((item) => item.courseId === classItem.courseId);
    if (courseIndex < 0) {
      throw new TeachingCourseManagementStoreError(500, "Teaching class course is missing.");
    }

    const membershipIndex = database.memberships.findIndex(
      (membership) => membership.membershipId === membershipId && membership.classId === classId,
    );
    if (membershipIndex < 0) {
      throw new TeachingCourseManagementStoreError(
        404,
        "Teaching class membership was not found.",
      );
    }

    const existingMembership = database.memberships[membershipIndex];
    if (existingMembership.membershipStatus === "approved") {
      return {
        membership: existingMembership,
        classItem,
        course: database.courses[courseIndex],
        receipt: createReceipt({
          action: "approve-class-membership",
          actorId,
          courseId: classItem.courseId,
          classId,
          traceId: input.traceId,
          createdAt: existingMembership.approvedAt ?? approvedAt,
          authSession: input.audit?.authSession,
          storage,
        }),
      };
    }

    const membership: TeachingClassMembershipRecord = {
      ...existingMembership,
      membershipStatus: "approved",
      approvedAt,
      approvedByTeacherId: actorId,
    };
    database.memberships[membershipIndex] = membership;

    const updatedClass: TeachingClassRecord = {
      ...classItem,
      students: countApprovedMembershipsForClass(database, classId),
      updatedAt: approvedAt,
    };
    database.classes[classIndex] = updatedClass;

    const updatedCourse: TeachingCourseRecord = {
      ...database.courses[courseIndex],
      students: countApprovedStudentsForCourse(database, classItem.courseId),
      updatedAt: approvedAt,
    };
    database.courses[courseIndex] = updatedCourse;

    const receipt = createReceipt({
      action: "approve-class-membership",
      actorId,
      courseId: classItem.courseId,
      classId,
      traceId: input.traceId,
      createdAt: approvedAt,
      authSession: input.audit?.authSession,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "approve-class-membership",
      actorId,
      courseId: classItem.courseId,
      classId,
      traceId: receipt.traceId,
      createdAt: approvedAt,
      requestSource: input.audit?.requestSource,
      authSession: input.audit?.authSession,
      storage,
    });

    database.auditEvents.push(auditEvent);
    database.updatedAt = approvedAt;
    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return {
        membership,
        classItem: updatedClass,
        course: updatedCourse,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function readTeachingCourseManagementDatabase(input: {
  dataDir?: string;
}): Promise<TeachingCourseManagementDatabase> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const filePath = resolveDatabasePath(dataDir);
  const raw = await readFile(filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  if (!raw) {
    return createEmptyDatabase();
  }
  return normalizeTeachingCourseManagementDatabase(JSON.parse(raw));
}

export async function readTeachingCourseManagementSnapshot(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
}): Promise<TeachingCourseManagementRepositorySnapshot> {
  if (input.repository) {
    const snapshot = await input.repository.read();
    return {
      database: normalizeTeachingCourseManagementDatabase(snapshot.database),
      ...(snapshot.revision ? { revision: requireSafeId(snapshot.revision, "revision") } : {}),
    };
  }

  return {
    database: await readTeachingCourseManagementDatabase({ dataDir: input.dataDir }),
  };
}

async function writeTeachingCourseManagementSnapshot(input: {
  dataDir: string;
  repository?: TeachingCourseManagementRepository;
  database: TeachingCourseManagementDatabase;
  expectedRevision?: string;
}) {
  if (input.repository) {
    await input.repository.write({
      database: normalizeTeachingCourseManagementDatabase(input.database),
      ...(input.expectedRevision ? { expectedRevision: input.expectedRevision } : {}),
    });
    return;
  }

  await writeTeachingCourseManagementDatabase({
    dataDir: input.dataDir,
    database: input.database,
  });
}

export function resolveTeachingCourseManagementDataDir(configuredDataDir?: string) {
  return configuredDataDir?.trim()
    ? resolve(/*turbopackIgnore: true*/ configuredDataDir)
    : join(
        /*turbopackIgnore: true*/ cwd(),
        ".tmp",
        "uais-teaching-course-management-db",
      );
}

function isTeachingCourseManagementProductionRuntime(
  env: Record<string, string | undefined>,
) {
  return (
    env.VERCEL_ENV === "production" ||
    env.NODE_ENV === "production" ||
    env.UAIS_DEPLOYMENT_ENV === "production"
  );
}

function isTeachingCourseManagementOptimisticSnapshotConflict(error: unknown) {
  return error instanceof TeachingCourseManagementStoreError && error.status === 409;
}

function normalizeCourseDraft(input: TeachingCourseDraftInput): NormalizedTeachingCourseDraft {
  return {
    ...(input.courseId ? { courseId: requireSafeId(input.courseId, "course id") } : {}),
    name: requireTrimmedString(input.name, "course name", 200),
    instructor: requireTrimmedString(input.instructor, "instructor", 120),
    unit: requireTrimmedString(input.unit, "unit", 160),
    department: requireTrimmedString(input.department, "department", 160),
    semester: requireTrimmedString(input.semester, "semester", 120),
    description: optionalTrimmedString(input.description, 600) ?? "",
    coverAssetId: input.coverAssetId ? requireSafeId(input.coverAssetId, "cover asset id") : "",
  };
}

function normalizeCourseSettingsPatch(
  input: unknown,
): NormalizedTeachingCourseSettingsPatch {
  if (!isRecord(input)) {
    return { appliedFields: [] };
  }

  const appliedFields: TeachingCourseSettingsAppliedField[] = [];
  const patch: TeachingCourseSettingsPatchInput = {};
  const stringFields = [
    ["courseName", "course name", 200],
    ["instructor", "instructor", 120],
    ["unit", "unit", 160],
    ["department", "department", 160],
    ["semester", "semester", 120],
  ] as const;

  for (const [field, label, maxLength] of stringFields) {
    if (Object.hasOwn(input, field)) {
      patch[field] = requireTrimmedString(input[field], label, maxLength);
      appliedFields.push(field);
    }
  }
  if (Object.hasOwn(input, "description")) {
    if (typeof input.description !== "string") {
      throw new TeachingCourseManagementStoreError(400, "Invalid description.");
    }
    patch.description = input.description.trim().slice(0, 600);
    appliedFields.push("description");
  }

  return {
    ...patch,
    appliedFields,
  };
}

function normalizeClassDraft(input: TeachingClassDraftInput): TeachingClassDraftInput {
  return {
    className: requireTrimmedString(input.className, "class name", 160),
    ...(input.semester ? { semester: requireTrimmedString(input.semester, "semester", 120) } : {}),
  };
}

function normalizeClassUniqueValue(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function countApprovedMembershipsForClass(
  database: TeachingCourseManagementDatabase,
  classId: string,
) {
  return database.memberships.filter(
    (membership) => membership.classId === classId && membership.membershipStatus === "approved",
  ).length;
}

function countApprovedStudentsForCourse(
  database: TeachingCourseManagementDatabase,
  courseId: string,
) {
  const classIds = new Set(
    database.classes.filter((classItem) => classItem.courseId === courseId).map((item) => item.classId),
  );
  return new Set(
    database.memberships
      .filter(
        (membership) =>
          membership.membershipStatus === "approved" && classIds.has(membership.classId),
      )
      .map((membership) => membership.studentId),
  ).size;
}

function createReceipt(input: {
  action: TeachingCourseManagementAction;
  actorId: string;
  courseId: string;
  classId?: string;
  traceId?: string;
  createdAt: string;
  authSession?: TeachingCourseManagementAuthSessionSummary;
  storage: TeachingCourseManagementStorageDescriptor;
}): TeachingCourseManagementReceipt {
  return {
    receiptId: `${input.action}-${input.courseId}-${formatTimestampId(new Date(input.createdAt))}`,
    action: input.action,
    actorId: input.actorId,
    courseId: input.courseId,
    ...(input.classId ? { classId: input.classId } : {}),
    traceId: input.traceId ?? `trace-${randomUUID()}`,
    status: "persisted",
    ...(input.authSession ? { authSession: normalizeAuthSessionSummary(input.authSession) } : {}),
    storagePolicy: input.storage.recordStoragePolicy,
    storageWritePolicy: input.storage.storageWritePolicy,
    responsibleSession: "S12",
    createdAt: input.createdAt,
    redaction: createRedaction(),
  };
}

function createAuditEvent(input: {
  action: TeachingCourseManagementAction;
  actorId: string;
  courseId: string;
  classId?: string;
  traceId: string;
  actorRole?: "teacher" | "student";
  authMode?: "signed-teacher-session" | "app-student-session";
  authSession?: TeachingCourseManagementAuthSessionSummary;
  createdAt: string;
  requestSource?: TeachingCourseManagementAuditRequestSource;
  storage: TeachingCourseManagementStorageDescriptor;
}): TeachingCourseManagementAuditEvent {
  return {
    auditId: `audit-${input.action}-${formatTimestampId(new Date(input.createdAt))}`,
    action: input.action,
    actorId: input.actorId,
    courseId: input.courseId,
    ...(input.classId ? { classId: input.classId } : {}),
    traceId: input.traceId,
    actorRole: input.actorRole ?? "teacher",
    authMode: input.authMode ?? "signed-teacher-session",
    ...(input.authSession ? { authSession: normalizeAuthSessionSummary(input.authSession) } : {}),
    createdAt: input.createdAt,
    requestSource: normalizeAuditRequestSource(input.requestSource),
    storagePolicy: input.storage.auditStoragePolicy,
    redaction: createRedaction(),
  };
}

function createClassInvitationCode(database: TeachingCourseManagementDatabase) {
  const usedInviteCodes = new Set<string>();
  for (const classItem of database.classes) {
    usedInviteCodes.add(classItem.invitationCode);
  }
  for (const inviteCodeDraft of database.inviteCodeDrafts ?? []) {
    usedInviteCodes.add(inviteCodeDraft.inviteCode);
  }
  for (const membership of database.memberships) {
    usedInviteCodes.add(membership.invitationCode);
  }

  for (let code = 55395057; code <= 99999999; code += 1) {
    const invitationCode = String(code).padStart(8, "0");
    if (!usedInviteCodes.has(invitationCode)) {
      return invitationCode;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching class invite code capacity is exhausted.",
  );
}

function formatTimestampId(now: Date) {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "").replace("T", "-");
}

async function writeTeachingCourseManagementDatabase(input: {
  dataDir: string;
  database: TeachingCourseManagementDatabase;
}) {
  await mkdir(input.dataDir, { recursive: true });
  const filePath = resolveDatabasePath(input.dataDir);
  await writeAtomicJsonFile({
    dataDir: input.dataDir,
    filePath,
    fileNamePrefix: "teaching-course-management",
    value: input.database,
  });
}

function createEmptyDatabase(): TeachingCourseManagementDatabase {
  return {
    schemaVersion: "uais-teaching-course-management-v1",
    updatedAt: "1970-01-01T00:00:00.000Z",
    courses: [],
    classes: [],
    memberships: [],
    auditEvents: [],
  };
}

export function normalizeTeachingCourseManagementDatabase(
  value: unknown,
): TeachingCourseManagementDatabase {
  if (!isRecord(value) || value.schemaVersion !== "uais-teaching-course-management-v1") {
    throw new TeachingCourseManagementStoreError(
      500,
      "Teaching course management database is invalid.",
    );
  }
  return {
    schemaVersion: "uais-teaching-course-management-v1",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString(),
    courses: Array.isArray(value.courses) ? value.courses.map(normalizeCourseRecord) : [],
    classes: Array.isArray(value.classes) ? value.classes.map(normalizeClassRecord) : [],
    memberships: Array.isArray(value.memberships)
      ? value.memberships.map(normalizeMembershipRecord)
      : [],
    ...(Array.isArray(value.inviteCodeDrafts)
      ? { inviteCodeDrafts: value.inviteCodeDrafts.map(normalizeInviteCodeDraftRecord) }
      : {}),
    ...(Array.isArray(value.courseSettings)
      ? { courseSettings: value.courseSettings.map(normalizeCourseSettingsRecord) }
      : {}),
    ...(Array.isArray(value.studentPreviewSessions)
      ? {
          studentPreviewSessions: value.studentPreviewSessions.map(
            normalizeStudentPreviewSessionRecord,
          ),
        }
      : {}),
    ...(Array.isArray(value.studentRosters)
      ? { studentRosters: value.studentRosters.map(normalizeStudentRosterSyncRecord) }
      : {}),
    ...(Array.isArray(value.studentGroupSuggestions)
      ? {
          studentGroupSuggestions: value.studentGroupSuggestions.map(
            normalizeStudentGroupSuggestionRecord,
          ),
        }
      : {}),
    ...(Array.isArray(value.knowledgeIndexes)
      ? { knowledgeIndexes: value.knowledgeIndexes.map(normalizeKnowledgeIndexSyncRecord) }
      : {}),
    ...(Array.isArray(value.resourceReviewItems)
      ? {
          resourceReviewItems: value.resourceReviewItems.map(
            normalizeResourceReviewItemRecord,
          ),
        }
      : {}),
    ...(Array.isArray(value.contentPackages)
      ? { contentPackages: value.contentPackages.map(normalizeCourseContentPublishRecord) }
      : {}),
    ...(Array.isArray(value.courseUnitDrafts)
      ? { courseUnitDrafts: value.courseUnitDrafts.map(normalizeCourseUnitDraftRecord) }
      : {}),
    ...(Array.isArray(value.dashboardStates)
      ? { dashboardStates: value.dashboardStates.map(normalizeDashboardStateRecord) }
      : {}),
    ...(Array.isArray(value.dashboardSnapshots)
      ? { dashboardSnapshots: value.dashboardSnapshots.map(normalizeDashboardSnapshotRecord) }
      : {}),
    ...(Array.isArray(value.quizAssessments)
      ? { quizAssessments: value.quizAssessments.map(normalizeQuizAssessmentRecord) }
      : {}),
    ...(Array.isArray(value.quizItemReviews)
      ? { quizItemReviews: value.quizItemReviews.map(normalizeQuizItemReviewRecord) }
      : {}),
    ...(Array.isArray(value.agentSettings)
      ? { agentSettings: value.agentSettings.map(normalizeAgentSettingsRecord) }
      : {}),
    ...(Array.isArray(value.agentPermissionPreflights)
      ? {
          agentPermissionPreflights: value.agentPermissionPreflights.map(
            normalizeAgentPermissionPreflightRecord,
          ),
        }
      : {}),
    ...(Array.isArray(value.adminSettings)
      ? { adminSettings: value.adminSettings.map(normalizeAdminSettingsRecord) }
      : {}),
    ...(Array.isArray(value.collaborationInviteNotifications)
      ? {
          collaborationInviteNotifications: value.collaborationInviteNotifications.map(
            normalizeCollaborationInviteNotificationRecord,
          ),
        }
      : {}),
    ...(Array.isArray(value.exportManifests)
      ? { exportManifests: value.exportManifests.map(normalizeExportManifestRecord) }
      : {}),
    ...(Array.isArray(value.exportRedactionValidations)
      ? {
          exportRedactionValidations: value.exportRedactionValidations.map(
            normalizeExportRedactionValidationRecord,
          ),
        }
      : {}),
    ...(Array.isArray(value.gradingQueues)
      ? { gradingQueues: value.gradingQueues.map(normalizeGradingQueueRecord) }
      : {}),
    ...(Array.isArray(value.gradebookUpdates)
      ? { gradebookUpdates: value.gradebookUpdates.map(normalizeGradebookUpdateRecord) }
      : {}),
    ...(Array.isArray(value.gradingFeedbackDrafts)
      ? {
          gradingFeedbackDrafts: value.gradingFeedbackDrafts.map(
            normalizeGradingFeedbackDraftRecord,
          ),
        }
      : {}),
    auditEvents: Array.isArray(value.auditEvents)
      ? value.auditEvents.map(normalizeAuditEvent)
      : [],
  };
}

function normalizeCourseRecord(value: unknown): TeachingCourseRecord {
  if (!isRecord(value)) {
    throw new TeachingCourseManagementStoreError(500, "Teaching course record is invalid.");
  }
  return {
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    courseName: requireTrimmedString(value.courseName, "course name", 200),
    instructor: requireTrimmedString(value.instructor, "instructor", 120),
    unit: requireTrimmedString(value.unit, "unit", 160),
    department: requireTrimmedString(value.department, "department", 160),
    semester: requireTrimmedString(value.semester, "semester", 120),
    ...(value.description
      ? { description: requireTrimmedString(value.description, "description", 600) }
      : {}),
    ...(value.coverAssetId
      ? { coverAssetId: requireSafeId(value.coverAssetId, "cover asset id") }
      : {}),
    status: "draft",
    students: requireNonnegativeInteger(value.students, "students"),
    createdAt: requireIsoDate(value.createdAt, "createdAt"),
    updatedAt: requireIsoDate(value.updatedAt, "updatedAt"),
    storagePolicy: normalizeRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeClassRecord(value: unknown): TeachingClassRecord {
  if (!isRecord(value)) {
    throw new TeachingCourseManagementStoreError(500, "Teaching class record is invalid.");
  }
  return {
    classId: requireSafeId(value.classId, "class id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    className: requireTrimmedString(value.className, "class name", 160),
    students: requireNonnegativeInteger(value.students, "students"),
    semester: requireTrimmedString(value.semester, "semester", 120),
    invitationCode: requireInviteCode(value.invitationCode),
    joinUrl: requireSafeUrlPath(value.joinUrl, "join url"),
    createdAt: requireIsoDate(value.createdAt, "createdAt"),
    updatedAt: requireIsoDate(value.updatedAt, "updatedAt"),
    storagePolicy: normalizeRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeMembershipRecord(value: unknown): TeachingClassMembershipRecord {
  if (!isRecord(value)) {
    throw new TeachingCourseManagementStoreError(500, "Teaching class membership is invalid.");
  }
  return {
    membershipId: requireSafeId(value.membershipId, "membership id"),
    courseId: requireSafeId(value.courseId, "course id"),
    classId: requireSafeId(value.classId, "class id"),
    invitationCode: requireInviteCode(value.invitationCode),
    studentId: requireSafeId(value.studentId, "student id"),
    studentDisplayName: requireTrimmedString(
      value.studentDisplayName,
      "student display name",
      160,
    ),
    membershipStatus: value.membershipStatus === "approved" ? "approved" : "pending-teacher-review",
    ...(value.approvedAt ? { approvedAt: requireIsoDate(value.approvedAt, "approvedAt") } : {}),
    ...(value.approvedByTeacherId
      ? {
          approvedByTeacherId: requireSafeId(
            value.approvedByTeacherId,
            "approved by teacher id",
          ),
        }
      : {}),
    joinedAt: requireIsoDate(value.joinedAt, "joinedAt"),
    storagePolicy: normalizeRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeInviteCodeDraftRecord(value: unknown): TeachingClassInviteCodeDraftRecord {
  if (!isRecord(value)) {
    throw new TeachingCourseManagementStoreError(
      500,
      "Teaching invite code draft record is invalid.",
    );
  }
  return {
    inviteCodeDraftId: requireSafeId(value.inviteCodeDraftId, "invite code draft id"),
    courseId: requireSafeId(value.courseId, "course id"),
    classId: requireSafeId(value.classId, "class id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    generatedBy: requireSafeId(value.generatedBy, "generated by teacher id"),
    draftStatus: "generated",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction
      ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
      : {}),
    inviteCode: requireInviteCode(value.inviteCode),
    joinUrl:
      typeof value.joinUrl === "string" && value.joinUrl.trim()
        ? value.joinUrl.trim()
        : `/courses?invite=${requireInviteCode(value.inviteCode)}`,
    invitePolicy: "teacher-review-before-publication",
    generatedAt: requireIsoDate(value.generatedAt, "generatedAt"),
    storagePolicy: normalizeRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeCourseSettingsRecord(value: unknown): TeachingCourseSettingsRecord {
  if (!isRecord(value)) {
    throw new TeachingCourseManagementStoreError(
      500,
      "Teaching course settings record is invalid.",
    );
  }
  return {
    settingsId: requireSafeId(value.settingsId, "course settings id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    updatedBy: requireSafeId(value.updatedBy, "updated by teacher id"),
    settingsStatus: "saved",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction
      ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
      : {}),
    appliedFields: normalizeCourseSettingsAppliedFields(value.appliedFields),
    ...(value.courseName
      ? { courseName: requireTrimmedString(value.courseName, "course name", 200) }
      : {}),
    ...(value.instructor
      ? { instructor: requireTrimmedString(value.instructor, "instructor", 120) }
      : {}),
    ...(value.unit ? { unit: requireTrimmedString(value.unit, "unit", 160) } : {}),
    ...(value.department
      ? { department: requireTrimmedString(value.department, "department", 160) }
      : {}),
    ...(value.semester
      ? { semester: requireTrimmedString(value.semester, "semester", 120) }
      : {}),
    ...(typeof value.description === "string"
      ? { description: value.description.trim().slice(0, 600) }
      : {}),
    updatedAt: requireIsoDate(value.updatedAt, "updatedAt"),
    storagePolicy: normalizeRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeCourseSettingsAppliedFields(
  value: unknown,
): TeachingCourseSettingsAppliedField[] {
  const allowed = new Set<TeachingCourseSettingsAppliedField>([
    "courseName",
    "instructor",
    "unit",
    "department",
    "semester",
    "description",
  ]);
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((field): field is TeachingCourseSettingsAppliedField =>
    typeof field === "string" && allowed.has(field as TeachingCourseSettingsAppliedField),
  );
}

function normalizeStudentPreviewSessionRecord(
  value: unknown,
): TeachingStudentPreviewSessionRecord {
  if (!isRecord(value)) {
    throw new TeachingCourseManagementStoreError(
      500,
      "Teaching student preview session record is invalid.",
    );
  }
  return {
    previewSessionId: requireSafeId(value.previewSessionId, "student preview session id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    previewedBy: requireSafeId(value.previewedBy, "previewed by teacher id"),
    previewStatus: "generated",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction
      ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
      : {}),
    previewId: requireSafeId(value.previewId, "student preview id"),
    previewUrl: requireTrimmedString(value.previewUrl, "student preview url", 240),
    previewScope: "teacher-course-preview",
    previewPolicy: "teacher-visible-preview-only",
    generatedAt: requireIsoDate(value.generatedAt, "generatedAt"),
    storagePolicy: normalizeRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeStudentRosterSyncRecord(value: unknown): TeachingStudentRosterSyncRecord {
  if (!isRecord(value)) {
    throw new TeachingCourseManagementStoreError(
      500,
      "Teaching student roster sync record is invalid.",
    );
  }
  return {
    rosterId: requireSafeId(value.rosterId, "student roster id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    syncedBy: requireSafeId(value.syncedBy, "synced by teacher id"),
    syncStatus: "synced",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction
      ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
      : {}),
    approvedStudentCount: requireNonnegativeInteger(
      value.approvedStudentCount,
      "approved student count",
    ),
    pendingTeacherReviewCount: requireNonnegativeInteger(
      value.pendingTeacherReviewCount,
      "pending teacher review count",
    ),
    classCount: requireNonnegativeInteger(value.classCount, "class count"),
    sourceSystems: ["sis-roster", "invite-code-joins", "withdrawals"],
    ...(value.providerStatus === "sis-provider-synced"
      ? { providerStatus: "sis-provider-synced" as const }
      : {}),
    ...(value.providerSyncId
      ? { providerSyncId: requireSafeId(value.providerSyncId, "provider sync id") }
      : {}),
    ...(value.providerSyncedAt
      ? { providerSyncedAt: requireIsoDate(value.providerSyncedAt, "providerSyncedAt") }
      : {}),
    syncedAt: requireIsoDate(value.syncedAt, "syncedAt"),
    storagePolicy: normalizeRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeStudentGroupSuggestionRecord(
  value: unknown,
): TeachingStudentGroupSuggestionRecord {
  if (!isRecord(value)) {
    throw new TeachingCourseManagementStoreError(
      500,
      "Teaching student group suggestion record is invalid.",
    );
  }
  return {
    groupSuggestionId: requireSafeId(value.groupSuggestionId, "student group suggestion id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    generatedBy: requireSafeId(value.generatedBy, "generated by teacher id"),
    suggestionStatus: "generated",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction
      ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
      : {}),
    suggestionScope: "teacher-editable-student-groups",
    sourceSignals: ["learning-progress", "participation-frequency", "role-preferences"],
    reviewPolicy: "teacher-review-before-group-assignment",
    generatedAt: requireIsoDate(value.generatedAt, "generatedAt"),
    storagePolicy: normalizeRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeKnowledgeIndexSyncRecord(value: unknown): TeachingKnowledgeIndexSyncRecord {
  if (!isRecord(value)) {
    throw new TeachingCourseManagementStoreError(
      500,
      "Teaching knowledge index sync record is invalid.",
    );
  }
  return {
    indexId: requireSafeId(value.indexId, "knowledge index id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    syncedBy: requireSafeId(value.syncedBy, "synced by teacher id"),
    syncStatus: "synced",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction
      ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
      : {}),
    sourceSystems: ["course-files", "teacher-resources", "agent-grounding-index"],
    ...(value.providerStatus === "knowledge-provider-synced"
      ? { providerStatus: "knowledge-provider-synced" as const }
      : {}),
    ...(value.providerSyncId
      ? { providerSyncId: requireSafeId(value.providerSyncId, "provider sync id") }
      : {}),
    ...(value.providerSyncedAt
      ? { providerSyncedAt: requireIsoDate(value.providerSyncedAt, "providerSyncedAt") }
      : {}),
    syncedAt: requireIsoDate(value.syncedAt, "syncedAt"),
    storagePolicy: normalizeRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeResourceReviewItemRecord(value: unknown): TeachingResourceReviewItemRecord {
  if (!isRecord(value)) {
    throw new TeachingCourseManagementStoreError(
      500,
      "Teaching resource review item record is invalid.",
    );
  }
  return {
    resourceReviewItemId: requireSafeId(value.resourceReviewItemId, "resource review item id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    queuedBy: requireSafeId(value.queuedBy, "queued by teacher id"),
    reviewStatus: "pending-teacher-review",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction
      ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
      : {}),
    resourceSource: "teacher-placeholder",
    reviewPolicy: "teacher-review-before-knowledge-index",
    queuedAt: requireIsoDate(value.queuedAt, "queuedAt"),
    storagePolicy: normalizeRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeCourseContentPublishRecord(value: unknown): TeachingCourseContentPublishRecord {
  if (!isRecord(value)) {
    throw new TeachingCourseManagementStoreError(
      500,
      "Teaching course content publish record is invalid.",
    );
  }
  return {
    contentId: requireSafeId(value.contentId, "course content id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    publishedBy: requireSafeId(value.publishedBy, "published by teacher id"),
    publicationStatus: "published",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction
      ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
      : {}),
    releaseScope: "course-visible-content",
    publishedAt: requireIsoDate(value.publishedAt, "publishedAt"),
    ...(value.providerStatus === "content-provider-published"
      ? { providerStatus: "content-provider-published" as const }
      : {}),
    ...(value.providerPublishId
      ? { providerPublishId: requireSafeId(value.providerPublishId, "provider publish id") }
      : {}),
    ...(value.providerPublishedAt
      ? { providerPublishedAt: requireIsoDate(value.providerPublishedAt, "providerPublishedAt") }
      : {}),
    storagePolicy: normalizeRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeCourseUnitDraftRecord(value: unknown): TeachingCourseUnitDraftRecord {
  if (!isRecord(value)) {
    throw new TeachingCourseManagementStoreError(
      500,
      "Teaching course unit draft record is invalid.",
    );
  }
  return {
    unitDraftId: requireSafeId(value.unitDraftId, "course unit draft id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    generatedBy: requireSafeId(value.generatedBy, "generated by teacher id"),
    draftStatus: "generated",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction
      ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
      : {}),
    draftScope: "teacher-editable-unit-plan",
    sourceSystems: ["course-knowledge-index", "teaching-objectives", "quiz-bank"],
    reviewPolicy: "teacher-review-before-student-release",
    generatedAt: requireIsoDate(value.generatedAt, "generatedAt"),
    storagePolicy: normalizeRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeDashboardStateRecord(value: unknown): TeachingCourseDashboardStateRecord {
  if (!isRecord(value)) {
    throw new TeachingCourseManagementStoreError(
      500,
      "Teaching dashboard state record is invalid.",
    );
  }
  return {
    dashboardStateId: requireSafeId(value.dashboardStateId, "dashboard state id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    refreshedBy: requireSafeId(value.refreshedBy, "refreshed by teacher id"),
    refreshStatus: "refreshed",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction
      ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
      : {}),
    visibleMetrics: ["engagement", "progress", "assessment-quality"],
    refreshPolicy: "teacher-visible-course-dashboard",
    refreshedAt: requireIsoDate(value.refreshedAt, "refreshedAt"),
    storagePolicy: normalizeRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeDashboardSnapshotRecord(
  value: unknown,
): TeachingCourseDashboardSnapshotRecord {
  if (!isRecord(value)) {
    throw new TeachingCourseManagementStoreError(
      500,
      "Teaching dashboard snapshot record is invalid.",
    );
  }
  return {
    dashboardSnapshotId: requireSafeId(value.dashboardSnapshotId, "dashboard snapshot id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    lockedBy: requireSafeId(value.lockedBy, "locked by teacher id"),
    snapshotStatus: "locked",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction
      ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
      : {}),
    teachingOperationSnapshotId: requireSafeId(
      value.teachingOperationSnapshotId,
      "teaching operation dashboard snapshot id",
    ),
    snapshotScope: "daily-course-dashboard",
    retentionPolicy: "teacher-locked-dashboard-snapshot",
    lockedAt: requireIsoDate(value.lockedAt, "lockedAt"),
    storagePolicy: normalizeRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeQuizAssessmentRecord(value: unknown): TeachingCourseQuizAssessmentRecord {
  if (!isRecord(value)) {
    throw new TeachingCourseManagementStoreError(
      500,
      "Teaching quiz assessment record is invalid.",
    );
  }
  return {
    quizAssessmentId: requireSafeId(value.quizAssessmentId, "quiz assessment id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    refreshedBy: requireSafeId(value.refreshedBy, "refreshed by teacher id"),
    assessmentStatus: "refreshed",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction
      ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
      : {}),
    quizBoardStateId: requireSafeId(value.quizBoardStateId, "quiz board state id"),
    visibleMetrics: ["completion-rate", "item-quality", "misconception-clusters"],
    reviewPolicy: "teacher-visible-quiz-quality-board",
    reusePolicy: "teacher-review-before-quiz-reuse",
    refreshedAt: requireIsoDate(value.refreshedAt, "refreshedAt"),
    storagePolicy: normalizeRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeQuizItemReviewRecord(value: unknown): TeachingCourseQuizItemReviewRecord {
  if (!isRecord(value)) {
    throw new TeachingCourseManagementStoreError(
      500,
      "Teaching quiz item review record is invalid.",
    );
  }
  return {
    quizItemReviewId: requireSafeId(value.quizItemReviewId, "quiz item review id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    flaggedBy: requireSafeId(value.flaggedBy, "flagged by teacher id"),
    reviewStatus: "flagged-for-review",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction
      ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
      : {}),
    flaggedSignals: ["low-discrimination", "high-error-rate", "teacher-review-needed"],
    reviewPolicy: "teacher-review-before-quiz-reuse",
    flaggedAt: requireIsoDate(value.flaggedAt, "flaggedAt"),
    storagePolicy: normalizeRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeAdminSettingsRecord(value: unknown): TeachingCourseAdminSettingsRecord {
  if (!isRecord(value)) {
    throw new TeachingCourseManagementStoreError(
      500,
      "Teaching admin settings record is invalid.",
    );
  }
  return {
    adminSettingsId: requireSafeId(value.adminSettingsId, "admin settings id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    savedBy: requireSafeId(value.savedBy, "saved by teacher id"),
    settingsStatus: "saved",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction
      ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
      : {}),
    adminScopes: ["course-collaborators", "permission-boundary", "audit-routing"],
    governancePolicy: "teacher-controlled-admin-settings",
    savedAt: requireIsoDate(value.savedAt, "savedAt"),
    storagePolicy: normalizeRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeAgentSettingsRecord(value: unknown): TeachingCourseAgentSettingsRecord {
  if (!isRecord(value)) {
    throw new TeachingCourseManagementStoreError(
      500,
      "Teaching agent settings record is invalid.",
    );
  }
  return {
    agentSettingsId: requireSafeId(value.agentSettingsId, "agent settings id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    savedBy: requireSafeId(value.savedBy, "saved by teacher id"),
    settingsStatus: "saved",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction
      ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
      : {}),
    agentScopes: ["research-agent", "method-agent", "writing-agent", "math-agent"],
    governancePolicy: "teacher-controlled-agent-settings",
    savedAt: requireIsoDate(value.savedAt, "savedAt"),
    storagePolicy: normalizeRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeAgentPermissionPreflightRecord(
  value: unknown,
): TeachingCourseAgentPermissionPreflightRecord {
  if (!isRecord(value)) {
    throw new TeachingCourseManagementStoreError(
      500,
      "Teaching agent permission preflight record is invalid.",
    );
  }
  return {
    preflightId: requireSafeId(value.preflightId, "agent permission preflight id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    checkedBy: requireSafeId(value.checkedBy, "checked by teacher id"),
    preflightStatus: "passed",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction
      ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
      : {}),
    checkedPermissions: ["course-bindings", "agent-roles", "student-access"],
    preflightPolicy: "teacher-agent-permission-gate",
    checkedAt: requireIsoDate(value.checkedAt, "checkedAt"),
    storagePolicy: normalizeRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeCollaborationInviteNotificationRecord(
  value: unknown,
): TeachingCourseCollaborationInviteNotificationRecord {
  if (!isRecord(value)) {
    throw new TeachingCourseManagementStoreError(
      500,
      "Teaching collaboration invite notification record is invalid.",
    );
  }
  return {
    notificationId: requireSafeId(value.notificationId, "notification id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    queuedBy: requireSafeId(value.queuedBy, "queued by teacher id"),
    notificationStatus:
      value.notificationStatus === "delivery-failed"
        ? "delivery-failed"
        : value.notificationStatus === "delivered-to-provider"
        ? "delivered-to-provider"
        : "queued-for-provider",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction
      ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
      : {}),
    outboxId: requireSafeId(value.outboxId, "outbox id"),
    deliveryChannel: "collaboration-invite-email",
    providerStatus:
      value.providerStatus === "smtp-provider-bounced"
        ? "smtp-provider-bounced"
        : value.providerStatus === "smtp-provider-delivered"
        ? "smtp-provider-delivered"
        : "smtp-provider-pending",
    ...(value.providerDeliveryId
      ? { providerDeliveryId: requireSafeId(value.providerDeliveryId, "provider delivery id") }
      : {}),
    ...(value.deliveryFailureReason
      ? {
          deliveryFailureReason: requireSafeId(
            value.deliveryFailureReason,
            "delivery failure reason",
          ),
        }
      : {}),
    ...(value.providerCallbackAt
      ? { providerCallbackAt: requireIsoDate(value.providerCallbackAt, "providerCallbackAt") }
      : {}),
    deliveryPolicy: "server-outbox-before-smtp-provider",
    queuedAt: requireIsoDate(value.queuedAt, "queuedAt"),
    ...(value.deliveredAt ? { deliveredAt: requireIsoDate(value.deliveredAt, "deliveredAt") } : {}),
    storagePolicy: normalizeRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeExportManifestRecord(value: unknown): TeachingCourseExportManifestRecord {
  if (!isRecord(value)) {
    throw new TeachingCourseManagementStoreError(
      500,
      "Teaching export manifest record is invalid.",
    );
  }
  const teachingOperationManifestId = requireSafeId(
    value.teachingOperationManifestId,
    "teaching operation manifest id",
  );
  return {
    exportManifestId: requireSafeId(value.exportManifestId, "export manifest id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    createdBy: requireSafeId(value.createdBy, "created by teacher id"),
    exportStatus: "generated",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction
      ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
      : {}),
    teachingOperationManifestId,
    downloadRoute:
      typeof value.downloadRoute === "string" && value.downloadRoute.trim()
        ? value.downloadRoute.trim()
        : `/api/teaching/operations/export/${teachingOperationManifestId}`,
    datasetScopes: ["learning-records", "chat-threads", "grades", "activities"],
    formats: ["json", "csv"],
    exportPolicy: "redacted-teacher-export-manifest",
    ...(value.providerStatus === "export-provider-exported"
      ? { providerStatus: "export-provider-exported" as const }
      : {}),
    ...(value.providerExportId
      ? { providerExportId: requireSafeId(value.providerExportId, "provider export id") }
      : {}),
    ...(value.providerExportedAt
      ? { providerExportedAt: requireIsoDate(value.providerExportedAt, "providerExportedAt") }
      : {}),
    createdAt: requireIsoDate(value.createdAt, "createdAt"),
    storagePolicy: normalizeRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeExportRedactionValidationRecord(
  value: unknown,
): TeachingCourseExportRedactionValidationRecord {
  if (!isRecord(value)) {
    throw new TeachingCourseManagementStoreError(
      500,
      "Teaching export redaction validation record is invalid.",
    );
  }
  return {
    exportRedactionValidationId: requireSafeId(
      value.exportRedactionValidationId,
      "export redaction validation id",
    ),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    validatedBy: requireSafeId(value.validatedBy, "validated by teacher id"),
    validationStatus: "passed",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction
      ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
      : {}),
    checkedScopes: [
      "identity-fields",
      "ai-chat-transcripts",
      "voice-references",
      "local-file-paths",
    ],
    blockedSecretCount: 0,
    validationPolicy: "no-secrets-or-local-paths-before-export",
    validatedAt: requireIsoDate(value.validatedAt, "validatedAt"),
    storagePolicy: normalizeRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeGradingQueueRecord(value: unknown): TeachingCourseGradingQueueRecord {
  if (!isRecord(value)) {
    throw new TeachingCourseManagementStoreError(
      500,
      "Teaching grading queue record is invalid.",
    );
  }
  return {
    gradingQueueId: requireSafeId(value.gradingQueueId, "grading queue id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    savedBy: requireSafeId(value.savedBy, "saved by teacher id"),
    queueStatus: "saved",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction
      ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
      : {}),
    gradebookUpdateId: requireSafeId(value.gradebookUpdateId, "gradebook update id"),
    reviewPolicy: "teacher-review-before-release",
    releasePolicy: "teacher-confirmed-grade-release",
    savedAt: requireIsoDate(value.savedAt, "savedAt"),
    storagePolicy: normalizeRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeGradebookUpdateRecord(value: unknown): TeachingCourseGradebookUpdateRecord {
  if (!isRecord(value)) {
    throw new TeachingCourseManagementStoreError(
      500,
      "Teaching gradebook update record is invalid.",
    );
  }
  return {
    objectId: requireSafeId(value.objectId, "gradebook update id"),
    objectType: "gradebook-update",
    courseId: requireSafeId(value.courseId, "course id"),
    updatedBy: requireSafeId(value.updatedBy, "updated by teacher id"),
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
    ...(value.releasedBy ? { releasedBy: requireSafeId(value.releasedBy, "released by") } : {}),
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
    storagePolicy: "domain-projection-teaching-gradebook-update",
    redaction: createRedaction(),
  };
}

function normalizeGradingFeedbackDraftRecord(
  value: unknown,
): TeachingCourseGradingFeedbackDraftRecord {
  if (!isRecord(value)) {
    throw new TeachingCourseManagementStoreError(
      500,
      "Teaching grading feedback draft record is invalid.",
    );
  }
  return {
    gradingFeedbackDraftId: requireSafeId(
      value.gradingFeedbackDraftId,
      "grading feedback draft id",
    ),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    generatedBy: requireSafeId(value.generatedBy, "generated by teacher id"),
    feedbackStatus: "generated",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction
      ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
      : {}),
    teachingOperationFeedbackArtifactId: requireSafeId(
      value.teachingOperationFeedbackArtifactId,
      "teaching operation feedback artifact id",
    ),
    feedbackScope: "grading-review-queue",
    reviewPolicy: "teacher-review-before-student-release",
    releasePolicy: "teacher-confirmed-feedback-release",
    ...(value.providerStatus === "feedback-provider-generated"
      ? { providerStatus: "feedback-provider-generated" as const }
      : {}),
    ...(value.providerFeedbackId
      ? { providerFeedbackId: requireSafeId(value.providerFeedbackId, "provider feedback id") }
      : {}),
    ...(value.providerGeneratedAt
      ? { providerGeneratedAt: requireIsoDate(value.providerGeneratedAt, "providerGeneratedAt") }
      : {}),
    generatedAt: requireIsoDate(value.generatedAt, "generatedAt"),
    storagePolicy: normalizeRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeAuditEvent(value: unknown): TeachingCourseManagementAuditEvent {
  if (!isRecord(value)) {
    throw new TeachingCourseManagementStoreError(500, "Teaching course audit event is invalid.");
  }
  const action = isTeachingCourseManagementAction(value.action) ? value.action : "create-course";
  return {
    auditId: requireSafeId(value.auditId, "audit id"),
    action,
    actorId: requireSafeId(value.actorId, "actor id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ...(value.classId ? { classId: requireSafeId(value.classId, "class id") } : {}),
    traceId: requireSafeId(value.traceId, "trace id"),
    actorRole: value.actorRole === "student" ? "student" : "teacher",
    authMode:
      value.authMode === "app-student-session"
        ? "app-student-session"
        : "signed-teacher-session",
    ...(value.authSession
      ? { authSession: normalizeAuthSessionSummary(value.authSession) }
      : {}),
    createdAt: requireIsoDate(value.createdAt, "createdAt"),
    ...(value.rollbackStatus === "rolled-back"
      ? {
          rollbackStatus: "rolled-back",
          rolledBackAt: value.rolledBackAt
            ? requireIsoDate(value.rolledBackAt, "rolledBackAt")
            : requireIsoDate(value.createdAt, "createdAt"),
        }
      : {}),
    requestSource: normalizeAuditRequestSource(value.requestSource),
    storagePolicy: normalizeAuditStoragePolicy(value.storagePolicy),
    redaction: createRedaction(),
  };
}

function normalizeAuthSessionSummary(
  value: TeachingCourseManagementAuthSessionSummary | unknown,
): TeachingCourseManagementAuthSessionSummary {
  if (!isRecord(value)) {
    throw new TeachingCourseManagementStoreError(500, "Teaching auth session summary is invalid.");
  }
  return {
    sessionId: requireSafeId(value.sessionId, "auth session id"),
    authenticatedAt: requireIsoDate(value.authenticatedAt, "authenticatedAt"),
    expiresAt: requireIsoDate(value.expiresAt, "expiresAt"),
  };
}

function isTeachingCourseManagementAction(
  value: unknown,
): value is TeachingCourseManagementAction {
  return (
    value === "create-course" ||
    value === "bind-course-cover-asset" ||
    value === "create-class" ||
    value === "save-course-settings" ||
    value === "generate-student-preview-session" ||
    value === "sync-student-roster" ||
    value === "sync-student-roster-provider" ||
    value === "generate-student-group-suggestions" ||
    value === "sync-knowledge-index" ||
    value === "queue-resource-review-item" ||
    value === "publish-course-content" ||
    value === "generate-course-unit-draft" ||
    value === "refresh-dashboard" ||
    value === "lock-dashboard-snapshot" ||
    value === "refresh-quiz-assessment" ||
    value === "flag-quiz-item-review" ||
    value === "save-agent-settings" ||
    value === "record-agent-permission-preflight" ||
    value === "save-admin-settings" ||
    value === "queue-collaboration-invite-notification" ||
    value === "deliver-collaboration-invite-email" ||
    value === "record-collaboration-invite-email-delivery-callback" ||
    value === "create-export-manifest" ||
    value === "export-course-data-provider" ||
    value === "validate-export-redaction-scope" ||
    value === "save-grading-queue" ||
    value === "generate-grading-feedback-draft" ||
    value === "generate-grading-feedback-provider" ||
    value === "generate-class-invite-code-draft" ||
    value === "publish-class-invite-code" ||
    value === "join-class-by-invite" ||
    value === "approve-class-membership"
  );
}

function resolveDatabasePath(dataDir: string) {
  const filePath = resolve(dataDir, "teaching-course-management.json");
  ensureWithinBase(dataDir, filePath);
  return filePath;
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

function ensureWithinBase(baseDir: string, filePath: string) {
  const normalizedBase = resolve(baseDir);
  const normalizedPath = resolve(filePath);
  if (normalizedPath !== normalizedBase && !normalizedPath.startsWith(`${normalizedBase}/`)) {
    throw new TeachingCourseManagementStoreError(
      400,
      "Teaching course management path escapes the configured data directory.",
    );
  }
}

function requireSafeId(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 160 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)
  ) {
    throw new TeachingCourseManagementStoreError(400, `Invalid ${label}.`);
  }
  return value;
}

function requireTrimmedString(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TeachingCourseManagementStoreError(400, `Invalid ${label}.`);
  }
  return value.trim().slice(0, maxLength);
}

function requireNonnegativeInteger(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TeachingCourseManagementStoreError(500, `Invalid ${label}.`);
  }
  return value;
}

function optionalTrimmedString(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : undefined;
}

function requireIsoDate(value: unknown, label: string) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new TeachingCourseManagementStoreError(500, `Invalid ${label}.`);
  }
  return value;
}

function normalizeAuditRequestSource(
  value: unknown,
): TeachingCourseManagementAuditRequestSource {
  if (!isRecord(value)) {
    return {
      userAgent: "unknown",
      ipAddress: "redacted",
    };
  }

  return {
    userAgent: sanitizeAuditSourceText(value.userAgent),
    ipAddress: "redacted",
  };
}

function sanitizeAuditSourceText(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return "unknown";
  }
  const normalized = value.trim().slice(0, 160);
  if (/\/Users\/|secret|api[_-]?key|token/i.test(normalized)) {
    return "redacted";
  }
  return normalized;
}

function requireInviteCode(value: unknown, status = 500) {
  if (typeof value !== "string" || !/^\d{8}$/.test(value)) {
    throw new TeachingCourseManagementStoreError(status, "Invite code is invalid.");
  }
  return value;
}

function requireSafeUrlPath(value: unknown, label: string) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    throw new TeachingCourseManagementStoreError(500, `Invalid ${label}.`);
  }
  return value;
}

function normalizeRecordStoragePolicy(
  value: unknown,
): TeachingCourseManagementRecordStoragePolicy {
  return value === "external-redacted-teaching-course-management-snapshot"
    ? "external-redacted-teaching-course-management-snapshot"
    : "local-json-teaching-course-management";
}

function normalizeAuditStoragePolicy(
  value: unknown,
): TeachingCourseManagementAuditStoragePolicy {
  return value === "external-redacted-teaching-course-management-audit-log"
    ? "external-redacted-teaching-course-management-audit-log"
    : "local-json-teaching-course-management-audit-log";
}

function normalizeStorageWritePolicy(
  value: unknown,
): TeachingCourseManagementStorageWritePolicy {
  return value === "external-optimistic-snapshot-replace"
    ? "external-optimistic-snapshot-replace"
    : "atomic-json-file-replace";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createRedaction(): TeachingCourseManagementRedaction {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };
}
