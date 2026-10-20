import type { InlineStudentPreviewSessionReceipt } from "@/components/pages/teaching-page-types";
import type { LocalizedText } from "@/i18n/copy";

export type TeachingOperationBackendArtifact =
  | {
      kind: "export-file";
      manifestId: string;
      downloadUrl: string;
      contentType: "application/json";
    }
  | {
      kind: "invite-code";
      code: string;
      status: "generated" | "published";
      joinUrl: string;
    }
  | {
      kind: string;
      [key: string]: unknown;
    };

export type TeachingOperationBackendReceipt = {
  receiptId?: string;
  operationId?: string;
  actionSlot?: "primary" | "secondary";
  courseId?: string;
  displayMessage?: LocalizedText;
  artifacts?: TeachingOperationBackendArtifact[];
  audit?: {
    authMode?: string;
    authSession?: {
      sessionId?: string;
      authenticatedAt?: string;
      expiresAt?: string;
    };
  };
};


export type TeachingOperationDomainPersistenceSummary = {
  status?: "persisted" | "missing-domain-objects" | "not-required";
  required?: boolean;
  operationReceiptId?: string;
  expectedObjectTypes?: string[];
  persistedObjectTypes?: string[];
  missingObjectTypes?: string[];
};

export type TeachingOperationAuditReadbackResponse = {
  actorId?: string;
  auditEventCount?: number;
  records?: Array<{
    recordId?: string;
    courseId?: string;
  }>;
  auditEvents?: Array<{
    traceId?: string;
    actorId?: string;
    courseId?: string;
    authSession?: {
      sessionId?: string;
      authenticatedAt?: string;
      expiresAt?: string;
    };
  }>;
  domainProjections?: Array<{
    objectId?: string;
    objectType?: string;
    courseId?: string;
    operationRecordId?: string;
    status?: string;
    updatedBy?: string;
    updatedAt?: string;
    previewedBy?: string;
    previewStatus?: string;
    previewId?: string;
    previewUrl?: string;
    previewScope?: string;
    previewPolicy?: string;
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
    syncedBy?: string;
    syncStatus?: string;
    sourceSystems?: string[];
    pendingTeacherReviewCount?: number;
    syncedAt?: string;
    queuedBy?: string;
    reviewStatus?: string;
    resourceSource?: string;
    title?: string;
    sourceFingerprint?: string;
    rightsBasis?: string;
    visibility?: string;
    reviewPolicy?: string;
    queuedAt?: string;
    publishedBy?: string;
    publicationStatus?: string;
    releaseScope?: string;
    publishedAt?: string;
    generatedBy?: string;
    suggestionStatus?: string;
    groupingBasis?: string[];
    draftStatus?: string;
    artifactId?: string;
    settingsStatus?: string;
    adminScopes?: string[];
    notificationStatus?: string;
    deliveryChannel?: string;
    outboxId?: string;
    deliveryPolicy?: string;
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
    refreshedBy?: string;
    refreshStatus?: string;
    visibleMetrics?: string[];
    refreshPolicy?: string;
    refreshedAt?: string;
    lockedBy?: string;
    snapshotStatus?: string;
    snapshotId?: string;
    snapshotScope?: string;
    retentionPolicy?: string;
    lockedAt?: string;
    flaggedBy?: string;
    flaggedSignals?: string[];
    flaggedAt?: string;
    queueStatus?: string;
    feedbackStatus?: string;
    feedbackScope?: string;
    inviteCode?: string;
    joinUrl?: string;
    invitePolicy?: string;
    enrollmentPolicy?: string;
  }>;
};

export type TeachingOperationPartialFailure = {
  operationReceiptId?: string;
  rollbackRoute?: string;
  compensation?: {
    status?: string;
    receipt?: {
      targetRecordId?: string;
    };
  };
};

export type TeachingOperationBackendResponse = {
  receipt?: TeachingOperationBackendReceipt;
  domainPersistenceSummary?: TeachingOperationDomainPersistenceSummary;
  studentPreviewSessionReceipt?: InlineStudentPreviewSessionReceipt;
  partialFailure?: TeachingOperationPartialFailure;
  access?: {
    reasonCode?: string;
  };
  error?: string;
  traceId?: string;
};
