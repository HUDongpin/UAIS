import { TeachingCourseManagementStoreError } from "./teaching-course-management-error";
import {
  createRedaction,
  isRecord,
  normalizeAuditRequestSource,
  normalizeAuditStoragePolicy,
  normalizeRecordStoragePolicy,
  normalizeStorageWritePolicy,
  requireInviteCode,
  requireIsoDate,
  requireNonnegativeInteger,
  requireSafeId,
  requireSafeUrlPath,
  requireTrimmedString,
} from "./teaching-course-management-guards";
import type {
  TeachingClassInviteCodeDraftRecord,
  TeachingClassMembershipRecord,
  TeachingClassRecord,
  TeachingCourseAdminSettingsRecord,
  TeachingCourseAgentPermissionPreflightRecord,
  TeachingCourseAgentSettingsRecord,
  TeachingCourseCollaborationInviteNotificationRecord,
  TeachingCourseContentPublishRecord,
  TeachingCourseDashboardSnapshotRecord,
  TeachingCourseDashboardStateRecord,
  TeachingCourseExportManifestRecord,
  TeachingCourseExportRedactionValidationRecord,
  TeachingCourseGradebookUpdateRecord,
  TeachingCourseGradingFeedbackDraftRecord,
  TeachingCourseGradingQueueRecord,
  TeachingCourseManagementAction,
  TeachingCourseManagementAuditEvent,
  TeachingCourseManagementAuthSessionSummary,
  TeachingCourseQuizAssessmentRecord,
  TeachingCourseQuizItemReviewRecord,
  TeachingCourseRecord,
  TeachingCourseSettingsAppliedField,
  TeachingCourseSettingsRecord,
  TeachingCourseUnitDraftRecord,
  TeachingKnowledgeIndexSyncRecord,
  TeachingLearningGroupMember,
  TeachingLearningGroupRecord,
  TeachingResourceReviewItemRecord,
  TeachingStudentGroupSuggestionRecord,
  TeachingStudentPreviewSessionRecord,
  TeachingStudentRosterSyncRecord,
} from "@/lib/server/teaching-course-management-types";

// Record and audit normalizers for the teaching-course-management store (Phase 3
// decomposition). Cycle-free: runtime deps are the extracted guards + error
// modules; store types are a type-only import.

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
    value === "approve-class-membership" ||
    value === "create-learning-group" ||
    value === "update-learning-group-members" ||
    value === "rename-learning-group" ||
    value === "delete-learning-group"
  );
}

export function normalizeCourseRecord(value: unknown): TeachingCourseRecord {
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

export function normalizeClassRecord(value: unknown): TeachingClassRecord {
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

export function normalizeMembershipRecord(value: unknown): TeachingClassMembershipRecord {
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

export function normalizeInviteCodeDraftRecord(value: unknown): TeachingClassInviteCodeDraftRecord {
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

export function normalizeCourseSettingsRecord(value: unknown): TeachingCourseSettingsRecord {
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

export function normalizeCourseSettingsAppliedFields(
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

export function normalizeStudentPreviewSessionRecord(
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

export function normalizeStudentRosterSyncRecord(value: unknown): TeachingStudentRosterSyncRecord {
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

export function normalizeStudentGroupSuggestionRecord(
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

export function normalizeLearningGroupRecord(value: unknown): TeachingLearningGroupRecord {
  if (!isRecord(value)) {
    throw new TeachingCourseManagementStoreError(
      500,
      "Teaching learning group record is invalid.",
    );
  }
  if (!Array.isArray(value.members)) {
    throw new TeachingCourseManagementStoreError(
      500,
      "Teaching learning group members are invalid.",
    );
  }
  return {
    groupId: requireSafeId(value.groupId, "learning group id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ...(value.classId ? { classId: requireSafeId(value.classId, "class id") } : {}),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    groupName: requireTrimmedString(value.groupName, "learning group name", 120),
    // Member-count policy (2..12) is enforced on the write path, not here: a read
    // normalizer that rejected a stored count would brick the whole snapshot if
    // the bound ever moved. Shape is still validated strictly.
    members: value.members.map(normalizeLearningGroupMember),
    createdAt: requireIsoDate(value.createdAt, "createdAt"),
    updatedAt: requireIsoDate(value.updatedAt, "updatedAt"),
    storagePolicy: normalizeRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeLearningGroupMember(value: unknown): TeachingLearningGroupMember {
  if (!isRecord(value)) {
    throw new TeachingCourseManagementStoreError(
      500,
      "Teaching learning group member is invalid.",
    );
  }
  return {
    studentId: requireSafeId(value.studentId, "student id"),
    studentDisplayName: requireTrimmedString(
      value.studentDisplayName,
      "student display name",
      120,
    ),
    addedAt: requireIsoDate(value.addedAt, "addedAt"),
  };
}

export function normalizeKnowledgeIndexSyncRecord(value: unknown): TeachingKnowledgeIndexSyncRecord {
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

export function normalizeResourceReviewItemRecord(value: unknown): TeachingResourceReviewItemRecord {
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

export function normalizeCourseContentPublishRecord(value: unknown): TeachingCourseContentPublishRecord {
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

export function normalizeCourseUnitDraftRecord(value: unknown): TeachingCourseUnitDraftRecord {
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

export function normalizeDashboardStateRecord(value: unknown): TeachingCourseDashboardStateRecord {
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

export function normalizeDashboardSnapshotRecord(
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

export function normalizeQuizAssessmentRecord(value: unknown): TeachingCourseQuizAssessmentRecord {
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

export function normalizeQuizItemReviewRecord(value: unknown): TeachingCourseQuizItemReviewRecord {
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

export function normalizeAdminSettingsRecord(value: unknown): TeachingCourseAdminSettingsRecord {
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

export function normalizeAgentSettingsRecord(value: unknown): TeachingCourseAgentSettingsRecord {
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

export function normalizeAgentPermissionPreflightRecord(
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

export function normalizeCollaborationInviteNotificationRecord(
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

export function normalizeExportManifestRecord(value: unknown): TeachingCourseExportManifestRecord {
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

export function normalizeExportRedactionValidationRecord(
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

export function normalizeGradingQueueRecord(value: unknown): TeachingCourseGradingQueueRecord {
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

export function normalizeGradebookUpdateRecord(value: unknown): TeachingCourseGradebookUpdateRecord {
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

export function normalizeGradingFeedbackDraftRecord(
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

export function normalizeAuditEvent(value: unknown): TeachingCourseManagementAuditEvent {
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

export function normalizeAuthSessionSummary(
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
