import type { TeachingOperationId } from "@/components/teaching/teaching-operation-data";
import type { LocalizedText } from "@/i18n/copy";

// Teacher-workspace domain types plus the inline-operation domain-object
// expectation map (Phase 3 decomposition of teaching-page.tsx). Shared by the
// page and its extracted sub-components so response/receipt/status shapes have a
// single source of truth. Type-only except INLINE_OPERATION_EXPECTED_DOMAIN_OBJECT_TYPES,
// a pure lookup used to validate inline teaching-operation domain projections.

export type GeneratedCourseCover = {
  imageUrl: string;
  assetId?: string;
  provider?: string;
  model?: string;
  requestId?: string;
};

export type CourseCoverGenerationResponse = {
  cover?: {
    imageUrl?: string;
    model?: string;
    requestId?: string;
  };
  asset?: {
    assetId?: string;
    courseId?: string;
  };
  assetPersistence?: {
    status?: string;
    responsibleSession?: string;
  };
  audit?: {
    eventType?: string;
    assetId?: string;
    courseId?: string;
    authMode?: string;
    authSession?: {
      sessionId?: string;
      authenticatedAt?: string;
      expiresAt?: string;
    };
  };
  partialFailure?: {
    status?: string;
    failedStep?: string;
    courseId?: string;
    assetId?: string;
    recoveryAction?: string;
  };
  error?: string;
  traceId?: string;
  access?: {
    reasonCode?: string;
  };
};

export type TeacherCourseAction = "manage" | "continue";

export type WorkspaceMetric = {
  label: string;
  value: string;
  note: string;
};

export type WorkspaceLane = {
  title: string;
  items: string[];
};

export type EnterpriseWorkspaceConfig = {
  id: TeachingOperationId;
  title: string;
  subtitle: string;
  description: string;
  metrics: WorkspaceMetric[];
  lanes: WorkspaceLane[];
  records: string[];
};

export type InlineWorkspaceActionConfig = {
  readyMessage: string;
  primaryAction: string;
  primaryMessage: string;
  secondaryAction: string;
  secondaryMessage: string;
};

export type InlineInviteBackendArtifact = {
  kind?: string;
  code?: string;
  joinUrl?: string;
};

export type InlineInviteBackendReceipt = {
  displayMessage?: LocalizedText;
  receiptId?: string;
  courseId?: string;
  artifacts?: InlineInviteBackendArtifact[];
};

export type InlineInvitePublicationReceipt = {
  action?: string;
  actorId?: string;
  courseId?: string;
  classId?: string;
  status?: string;
  traceId?: string;
};

export type InlineInvitePartialFailure = {
  operationReceiptId?: string;
  rollbackRoute?: string;
  compensation?: {
    status?: string;
    rollbackReason?: string;
    receipt?: {
      receiptId?: string;
      targetRecordId?: string;
      status?: string;
    };
  };
};

export type InlineInviteOperationResponse = {
  receipt?: InlineInviteBackendReceipt;
  classInvitePublicationReceipt?: InlineInvitePublicationReceipt;
  partialFailure?: InlineInvitePartialFailure;
  error?: string;
  traceId?: string;
  access?: {
    reasonCode?: string;
  };
};

export type InlineTeachingOperationAuditAuthSession = {
  sessionId?: string;
  authenticatedAt?: string;
  expiresAt?: string;
};

export type InlineTeachingOperationBackendReceipt = {
  displayMessage?: LocalizedText;
  receiptId?: string;
  operationId?: string;
  actionSlot?: "primary" | "secondary";
  courseId?: string;
  status?: string;
  audit?: {
    authMode?: string;
    authSession?: InlineTeachingOperationAuditAuthSession;
  };
};

export type InlineTeachingOperationDomainPersistenceSummary = {
  status?: "persisted" | "missing-domain-objects" | "not-required";
  required?: boolean;
  operationReceiptId?: string;
  expectedObjectTypes?: string[];
  persistedObjectTypes?: string[];
  missingObjectTypes?: string[];
};

export type InlineTeachingOperationErrorResponse = {
  error?: string;
  traceId?: string;
  access?: {
    reasonCode?: string;
  };
  partialFailure?: InlineInvitePartialFailure;
};

export type InlineTeachingOperationAuditEvent = {
  traceId?: string;
  actorId?: string;
  authSession?: InlineTeachingOperationAuditAuthSession;
  courseId?: string;
};

export type InlineTeachingOperationRecord = {
  recordId?: string;
  courseId?: string;
  operationId?: TeachingOperationId;
  actionSlot?: "primary" | "secondary";
};

export type InlineTeachingOperationDomainProjection = {
  objectId?: string;
  objectType?: string;
  courseId?: string;
  operationRecordId?: string;
  status?: string;
  inviteCode?: string;
  joinUrl?: string;
  previewedBy?: string;
  previewStatus?: string;
  previewId?: string;
  previewUrl?: string;
  previewScope?: string;
  previewPolicy?: string;
  courseName?: string;
  semester?: string;
  description?: string;
  syncedBy?: string;
  syncStatus?: string;
  sourceSystems?: string[];
  pendingTeacherReviewCount?: number;
  syncedAt?: string;
  suggestionStatus?: string;
  groupingBasis?: string[];
  feedbackStatus?: string;
  feedbackScope?: string;
  refreshedBy?: string;
  refreshStatus?: string;
  visibleMetrics?: string[];
  refreshedAt?: string;
  flaggedBy?: string;
  flaggedSignals?: string[];
  flaggedAt?: string;
  lockedBy?: string;
  snapshotStatus?: string;
  snapshotId?: string;
  snapshotScope?: string;
  retentionPolicy?: string;
  lockedAt?: string;
  publishedBy?: string;
  publicationStatus?: string;
  releaseScope?: string;
  publishedAt?: string;
  generatedBy?: string;
  draftStatus?: string;
  artifactId?: string;
  generatedAt?: string;
  savedBy?: string;
  planStatus?: string;
  enabledAgents?: string[];
  governancePolicy?: string;
  savedAt?: string;
  checkedBy?: string;
  preflightStatus?: string;
  checkedPermissions?: string[];
  preflightPolicy?: string;
  checkedAt?: string;
  settingsStatus?: string;
  adminScopes?: string[];
  queueStatus?: string;
  queuedBy?: string;
  notificationStatus?: string;
  deliveryChannel?: string;
  outboxId?: string;
  deliveryPolicy?: string;
  reviewStatus?: string;
  resourceSource?: string;
  title?: string;
  sourceFingerprint?: string;
  rightsBasis?: string;
  visibility?: string;
  reviewPolicy?: string;
  queuedAt?: string;
  updateStatus?: string;
  updatedBy?: string;
  releasePolicy?: string;
  updatedAt?: string;
  createdBy?: string;
  exportStatus?: string;
  manifestId?: string;
  datasetScopes?: string[];
  exportPolicy?: string;
  createdAt?: string;
  validatedBy?: string;
  validationStatus?: string;
  checkedScopes?: string[];
  validationPolicy?: string;
  validatedAt?: string;
  invitePolicy?: string;
  enrollmentPolicy?: string;
};

export const INLINE_OPERATION_EXPECTED_DOMAIN_OBJECT_TYPES = {
  "course-settings": {
    primary: ["course-settings"],
    secondary: ["student-preview-session"],
  },
  agents: {
    primary: ["agent-plan"],
    secondary: ["permission-preflight"],
  },
  "knowledge-base": {
    primary: ["knowledge-index"],
    secondary: ["resource-review-item"],
  },
  content: {
    primary: ["course-content"],
    secondary: ["unit-draft"],
  },
  admins: {
    primary: ["admin-settings"],
    secondary: ["email-notification"],
  },
  students: {
    primary: ["student-roster"],
    secondary: ["group-suggestions"],
  },
  "data-export": {
    primary: ["export-manifest"],
    secondary: ["redaction-validation"],
  },
  dashboard: {
    primary: ["dashboard-state"],
    secondary: ["dashboard-snapshot"],
  },
  "quiz-board": {
    primary: ["quiz-board-state"],
    secondary: ["quiz-item-review"],
  },
  grading: {
    primary: ["grading-queue", "gradebook-update"],
    secondary: ["ai-feedback-draft"],
  },
  "invite-code": {
    primary: ["invite-code-draft"],
    secondary: ["enrollment-access"],
  },
} satisfies Record<TeachingOperationId, Record<"primary" | "secondary", readonly string[]>>;

export type InlineTeachingOperationAuditReadbackResponse = {
  actorId?: string;
  auditEventCount?: number;
  records?: InlineTeachingOperationRecord[];
  auditEvents?: InlineTeachingOperationAuditEvent[];
  domainProjections?: InlineTeachingOperationDomainProjection[];
};

export type InlineTeachingOperationAuditAlert = {
  alertId?: string;
  severity?: "high";
  reason?: "missing-course-context";
  traceId?: string;
  actorId?: string;
  operationId?: string;
  actionSlot?: "primary" | "secondary";
  actionId?: string;
};

export type InlineTeachingOperationAuditAlertSummaryResponse = {
  traceId?: string;
  status?: "attention-required" | "clear";
  alertCount?: number;
  alerts?: InlineTeachingOperationAuditAlert[];
  notificationRoute?: string;
};

export type InlineTeachingOperationAuditAlertNotificationResponse = {
  traceId?: string;
  status?: "queued" | "clear";
  notificationCount?: number;
  recordCount?: number;
  notifications?: {
    notificationId?: string;
    deliveryStatus?: "queued";
    alertId?: string;
  }[];
};

export type InlineWorkspaceAuditStatus = {
  status: "pending" | "verified" | "failed";
  traceId?: string;
  actorId?: string;
  authSession?: InlineTeachingOperationAuditAuthSession;
  auditEventCount?: number;
  recordId?: string;
  courseId?: string;
  domainObjectId?: string;
  domainObjectType?: string;
};

export type InlineWorkspaceAlertStatus = {
  status: "pending" | "attention-required" | "clear" | "failed";
  traceId?: string;
  alertCount?: number;
  alerts?: InlineTeachingOperationAuditAlert[];
  notificationRoute?: string;
};

export type InlineWorkspaceAlertNotificationStatus = {
  status: "pending" | "queued" | "verified" | "clear" | "failed";
  notificationCount?: number;
  message?: string;
};

export type InlineWorkspaceRollbackStatus = {
  status: "pending" | "rolled-back" | "failed";
  targetRecordId: string;
  message?: string;
};
