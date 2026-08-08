export type TeachingCourseManagementRedaction = {
  secrets: "omitted";
  localFiles: "omitted";
  assets: "ids-only";
};

export type TeachingCourseManagementRecordStoragePolicy =
  | "local-json-teaching-course-management"
  | "external-redacted-teaching-course-management-snapshot"
  | "postgres-teaching-course-management-snapshot";

export type TeachingCourseManagementAuditStoragePolicy =
  | "local-json-teaching-course-management-audit-log"
  | "external-redacted-teaching-course-management-audit-log"
  | "postgres-teaching-course-management-audit-log";

export type TeachingCourseManagementStorageWritePolicy =
  | "atomic-json-file-replace"
  | "external-optimistic-snapshot-replace"
  | "postgres-transactional-snapshot-replace";

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
  | "approve-class-membership"
  | "create-learning-group"
  | "update-learning-group-members"
  | "rename-learning-group"
  | "delete-learning-group";

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

// A teacher-assigned learning group: the durable membership list behind a shared
// group chatroom room. Every member must hold an APPROVED membership in
// `courseId` (and in `classId` when the group is scoped to one class), which the
// group handlers enforce on every write. `studentDisplayName` is a snapshot taken
// from the approved membership record at assignment time, never from a request
// body, so the student-visible group projection cannot be used to inject names.
export type TeachingLearningGroupMember = {
  studentId: string;
  studentDisplayName: string;
  addedAt: string;
};

export type TeachingLearningGroupRecord = {
  groupId: string;
  courseId: string;
  classId?: string;
  ownerTeacherId: string;
  groupName: string;
  members: TeachingLearningGroupMember[];
  createdAt: string;
  updatedAt: string;
  storagePolicy: TeachingCourseManagementRecordStoragePolicy;
  storageWritePolicy: TeachingCourseManagementStorageWritePolicy;
  responsibleSession: "S12";
  redaction: TeachingCourseManagementRedaction;
};

// Members may be supplied as bare student ids or as `{ studentId }` objects; both
// normalize to the same student-id list. Display names are resolved server-side.
export type TeachingLearningGroupMemberInput = string | { studentId: string };

export type TeachingLearningGroupDraftInput = {
  groupName: string;
  classId?: string;
  members: TeachingLearningGroupMemberInput[];
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
  // Optional and additive: snapshots written before learning groups existed stay
  // valid and normalize unchanged (the key is simply absent).
  learningGroups?: TeachingLearningGroupRecord[];
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
