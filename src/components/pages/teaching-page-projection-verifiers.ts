// Pure inline teaching-operation domain-projection verifiers (Phase 3 decomposition of
// teaching-page.tsx). Extracted from the TeachingPage component body: these functions
// close over no component state (locale is threaded as a parameter where used), so they
// lift cleanly. They validate that a persisted domain projection matches the submitted
// business semantics before the UI treats an inline operation as durably applied.
import { localizedText } from "@/components/ui/localized-text";
import type { TeachingOperationId } from "@/components/teaching/teaching-operation-data";
import type { Locale } from "@/i18n/copy";
import type { CourseSettingsPatchPayload } from "@/lib/teaching/course-readback";
import {
  TEACHING_ADMIN_SETTINGS_READBACK_MISMATCH_MESSAGE,
  TEACHING_AGENT_PLAN_READBACK_MISMATCH_MESSAGE,
  TEACHING_AI_FEEDBACK_DRAFT_READBACK_MISMATCH_MESSAGE,
  TEACHING_COLLABORATION_INVITE_NOTIFICATION_READBACK_MISMATCH_MESSAGE,
  TEACHING_COURSE_CONTENT_READBACK_MISMATCH_MESSAGE,
  TEACHING_COURSE_SETTINGS_READBACK_MISMATCH_MESSAGE,
  TEACHING_DASHBOARD_SNAPSHOT_READBACK_MISMATCH_MESSAGE,
  TEACHING_DASHBOARD_STATE_READBACK_MISMATCH_MESSAGE,
  TEACHING_EXPORT_MANIFEST_READBACK_MISMATCH_MESSAGE,
  TEACHING_GRADING_QUEUE_READBACK_MISMATCH_MESSAGE,
  TEACHING_GROUP_SUGGESTIONS_READBACK_MISMATCH_MESSAGE,
  TEACHING_KNOWLEDGE_INDEX_READBACK_MISMATCH_MESSAGE,
  TEACHING_OPERATION_AUDIT_FAILED_MESSAGE,
  TEACHING_PERMISSION_PREFLIGHT_READBACK_MISMATCH_MESSAGE,
  TEACHING_QUIZ_BOARD_STATE_READBACK_MISMATCH_MESSAGE,
  TEACHING_QUIZ_ITEM_REVIEW_READBACK_MISMATCH_MESSAGE,
  TEACHING_REDACTION_VALIDATION_READBACK_MISMATCH_MESSAGE,
  TEACHING_RESOURCE_REVIEW_ITEM_READBACK_MISMATCH_MESSAGE,
  TEACHING_STUDENT_PREVIEW_SESSION_READBACK_MISMATCH_MESSAGE,
  TEACHING_STUDENT_ROSTER_READBACK_MISMATCH_MESSAGE,
  TEACHING_UNIT_DRAFT_READBACK_MISMATCH_MESSAGE,
} from "./teaching-page-messages";
import {
  INLINE_OPERATION_EXPECTED_DOMAIN_OBJECT_TYPES,
  type InlineTeachingOperationDomainProjection,
} from "./teaching-page-types";


export function findMatchingInlineDomainProjection(
  projections: InlineTeachingOperationDomainProjection[] | undefined,
  input: {
    courseId?: string;
    operationId: TeachingOperationId;
      actionSlot: "primary" | "secondary";
      recordId: string;
    },
  ) {
    const expectedObjectTypes =
      INLINE_OPERATION_EXPECTED_DOMAIN_OBJECT_TYPES[input.operationId][input.actionSlot];
    return projections?.find((projection) => {
      if (projection.operationRecordId !== input.recordId) {
        return false;
      }
      if (input.courseId && projection.courseId !== input.courseId) {
        return false;
      }
      if (!projection.objectType) {
        return false;
      }
      return expectedObjectTypes.includes(projection.objectType);
    });
  }

  export function findMatchingInlineDomainProjections(
    projections: InlineTeachingOperationDomainProjection[] | undefined,
    input: {
      courseId?: string;
      operationId: TeachingOperationId;
      actionSlot: "primary" | "secondary";
      recordId: string;
    },
  ) {
    const expectedObjectTypes =
      INLINE_OPERATION_EXPECTED_DOMAIN_OBJECT_TYPES[input.operationId][input.actionSlot];
    return expectedObjectTypes
      .map((objectType) =>
        projections?.find((projection) => {
          if (projection.operationRecordId !== input.recordId) {
            return false;
          }
          if (input.courseId && projection.courseId !== input.courseId) {
            return false;
          }
          return projection.objectType === objectType && typeof projection.objectId === "string";
        }),
      )
      .filter(
        (projection): projection is InlineTeachingOperationDomainProjection =>
          Boolean(projection),
      );
  }

  export function doesInlineCourseSettingsProjectionMatchPatch(
    projection: InlineTeachingOperationDomainProjection,
    courseSettingsPatch?: CourseSettingsPatchPayload,
  ) {
    if (!courseSettingsPatch || Object.keys(courseSettingsPatch).length === 0) {
      return true;
    }
    if (projection.objectType !== "course-settings") {
      return false;
    }
    return (["courseName", "semester", "description"] as const).every((field) => {
      const expectedValue = courseSettingsPatch[field]?.trim();
      if (!expectedValue) {
        return true;
      }
      return projection[field]?.trim() === expectedValue;
    });
  }

  export function doesInlineDomainProjectionMatchBusinessSemantics(
    projection: InlineTeachingOperationDomainProjection,
    input: {
      operationId: TeachingOperationId;
      actionSlot: "primary" | "secondary";
    },
  ) {
    if (input.operationId === "course-settings" && input.actionSlot === "primary") {
      return isVerifiedCourseSettingsProjection(projection);
    }
    if (input.operationId === "course-settings" && input.actionSlot === "secondary") {
      return isVerifiedStudentPreviewSessionProjection(projection);
    }
    if (input.operationId === "students" && input.actionSlot === "primary") {
      return isVerifiedStudentRosterProjection(projection);
    }
    if (input.operationId === "students" && input.actionSlot === "secondary") {
      return isVerifiedGroupSuggestionsProjection(projection);
    }
    if (input.operationId === "knowledge-base" && input.actionSlot === "primary") {
      return isVerifiedKnowledgeIndexProjection(projection);
    }
    if (input.operationId === "knowledge-base" && input.actionSlot === "secondary") {
      return isVerifiedResourceReviewItemProjection(projection);
    }
    if (input.operationId === "dashboard" && input.actionSlot === "primary") {
      return isVerifiedDashboardStateProjection(projection);
    }
    if (input.operationId === "dashboard" && input.actionSlot === "secondary") {
      return isVerifiedDashboardSnapshotProjection(projection);
    }
    if (input.operationId === "content" && input.actionSlot === "primary") {
      return isVerifiedCourseContentProjection(projection);
    }
    if (input.operationId === "content" && input.actionSlot === "secondary") {
      return isVerifiedUnitDraftProjection(projection);
    }
    if (input.operationId === "agents" && input.actionSlot === "primary") {
      return isVerifiedAgentPlanProjection(projection);
    }
    if (input.operationId === "agents" && input.actionSlot === "secondary") {
      return isVerifiedPermissionPreflightProjection(projection);
    }
    if (input.operationId === "admins" && input.actionSlot === "primary") {
      return isVerifiedAdminSettingsProjection(projection);
    }
    if (input.operationId === "admins" && input.actionSlot === "secondary") {
      return isVerifiedCollaborationInviteNotificationProjection(projection);
    }
    if (input.operationId === "quiz-board" && input.actionSlot === "primary") {
      return isVerifiedQuizBoardStateProjection(projection);
    }
    if (input.operationId === "quiz-board" && input.actionSlot === "secondary") {
      return isVerifiedQuizItemReviewProjection(projection);
    }
    if (input.operationId === "grading" && input.actionSlot === "primary") {
      if (projection.objectType === "grading-queue") {
        return isVerifiedGradingQueueProjection(projection);
      }
      if (projection.objectType === "gradebook-update") {
        return isVerifiedGradebookUpdateProjection(projection);
      }
      return false;
    }
    if (input.operationId === "grading" && input.actionSlot === "secondary") {
      return isVerifiedAiFeedbackDraftProjection(projection);
    }
    if (input.operationId === "invite-code" && input.actionSlot === "primary") {
      return isVerifiedInviteCodeDraftProjection(projection);
    }
    if (input.operationId === "invite-code" && input.actionSlot === "secondary") {
      return isVerifiedEnrollmentAccessProjection(projection);
    }
    if (input.operationId === "data-export" && input.actionSlot === "primary") {
      return isVerifiedExportManifestProjection(projection);
    }
    if (input.operationId === "data-export" && input.actionSlot === "secondary") {
      return isVerifiedRedactionValidationProjection(projection);
    }
    return true;
  }

  export function doesInlineDomainReadbackMatchBusinessSemantics(
    projections: InlineTeachingOperationDomainProjection[],
    input: {
      operationId: TeachingOperationId;
      actionSlot: "primary" | "secondary";
    },
  ) {
    const expectedObjectTypes =
      INLINE_OPERATION_EXPECTED_DOMAIN_OBJECT_TYPES[input.operationId][input.actionSlot];
    if (projections.length < expectedObjectTypes.length) {
      return false;
    }
    return expectedObjectTypes.every((objectType) => {
      const projection = projections.find(
        (candidateProjection) => candidateProjection.objectType === objectType,
      );
      return projection
        ? doesInlineDomainProjectionMatchBusinessSemantics(projection, input)
        : false;
    });
  }

  export function isVerifiedCourseSettingsProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    return (
      projection.objectType === "course-settings" &&
      projection.status === "saved" &&
      typeof projection.updatedBy === "string" &&
      projection.updatedBy.trim().length > 0 &&
      typeof projection.updatedAt === "string" &&
      projection.updatedAt.trim().length > 0
    );
  }

  export function isVerifiedStudentPreviewSessionProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    return (
      projection.objectType === "student-preview-session" &&
      projection.previewStatus === "generated" &&
      projection.previewScope === "teacher-course-preview" &&
      projection.previewPolicy === "teacher-visible-preview-only" &&
      typeof projection.previewedBy === "string" &&
      projection.previewedBy.trim().length > 0 &&
      typeof projection.previewId === "string" &&
      projection.previewId.trim().length > 0 &&
      typeof projection.previewUrl === "string" &&
      projection.previewUrl.trim().length > 0 &&
      typeof projection.generatedAt === "string" &&
      projection.generatedAt.trim().length > 0
    );
  }

  export function isVerifiedStudentRosterProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    const expectedSourceSystems = ["sis-roster", "invite-code-joins", "withdrawals"];
    return (
      projection.objectType === "student-roster" &&
      projection.syncStatus === "synced" &&
      typeof projection.syncedBy === "string" &&
      projection.syncedBy.trim().length > 0 &&
      typeof projection.syncedAt === "string" &&
      projection.syncedAt.trim().length > 0 &&
      typeof projection.pendingTeacherReviewCount === "number" &&
      Number.isFinite(projection.pendingTeacherReviewCount) &&
      projection.pendingTeacherReviewCount >= 0 &&
      Array.isArray(projection.sourceSystems) &&
      expectedSourceSystems.every((sourceSystem) =>
        projection.sourceSystems?.includes(sourceSystem),
      )
    );
  }

  export function isVerifiedKnowledgeIndexProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    const expectedSourceSystems = [
      "course-files",
      "teacher-resources",
      "agent-grounding-index",
    ];
    return (
      projection.objectType === "knowledge-index" &&
      projection.syncStatus === "synced" &&
      typeof projection.syncedBy === "string" &&
      projection.syncedBy.trim().length > 0 &&
      typeof projection.syncedAt === "string" &&
      projection.syncedAt.trim().length > 0 &&
      Array.isArray(projection.sourceSystems) &&
      expectedSourceSystems.every((sourceSystem) =>
        projection.sourceSystems?.includes(sourceSystem),
      )
    );
  }

  export function isVerifiedGroupSuggestionsProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    const expectedGroupingBasis = [
      "participation",
      "progress",
      "collaboration-balance",
    ];
    return (
      projection.objectType === "group-suggestions" &&
      projection.suggestionStatus === "ready-for-teacher-review" &&
      projection.reviewPolicy === "teacher-review-before-group-assignment" &&
      typeof projection.generatedBy === "string" &&
      projection.generatedBy.trim().length > 0 &&
      typeof projection.artifactId === "string" &&
      projection.artifactId.trim().length > 0 &&
      typeof projection.generatedAt === "string" &&
      projection.generatedAt.trim().length > 0 &&
      Array.isArray(projection.groupingBasis) &&
      expectedGroupingBasis.every((basis) => projection.groupingBasis?.includes(basis))
    );
  }

  export function isVerifiedResourceReviewItemProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    return (
      projection.objectType === "resource-review-item" &&
      projection.reviewStatus === "pending-teacher-review" &&
      projection.resourceSource === "teacher-placeholder" &&
      projection.reviewPolicy === "teacher-review-before-knowledge-index" &&
      typeof projection.queuedBy === "string" &&
      projection.queuedBy.trim().length > 0 &&
      typeof projection.queuedAt === "string" &&
      projection.queuedAt.trim().length > 0
    );
  }

  export function isVerifiedDashboardStateProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    const expectedVisibleMetrics = ["engagement", "progress", "assessment-quality"];
    return (
      projection.objectType === "dashboard-state" &&
      projection.refreshStatus === "refreshed" &&
      typeof projection.refreshedBy === "string" &&
      projection.refreshedBy.trim().length > 0 &&
      typeof projection.refreshedAt === "string" &&
      projection.refreshedAt.trim().length > 0 &&
      Array.isArray(projection.visibleMetrics) &&
      expectedVisibleMetrics.every((metric) => projection.visibleMetrics?.includes(metric))
    );
  }

  export function isVerifiedDashboardSnapshotProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    return (
      projection.objectType === "dashboard-snapshot" &&
      projection.snapshotStatus === "locked" &&
      projection.snapshotScope === "daily-course-dashboard" &&
      projection.retentionPolicy === "teacher-locked-dashboard-snapshot" &&
      typeof projection.lockedBy === "string" &&
      projection.lockedBy.trim().length > 0 &&
      typeof projection.snapshotId === "string" &&
      projection.snapshotId.trim().length > 0 &&
      typeof projection.lockedAt === "string" &&
      projection.lockedAt.trim().length > 0
    );
  }

  export function isVerifiedCourseContentProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    return (
      projection.objectType === "course-content" &&
      projection.publicationStatus === "published" &&
      projection.releaseScope === "course-visible-content" &&
      typeof projection.publishedBy === "string" &&
      projection.publishedBy.trim().length > 0 &&
      typeof projection.publishedAt === "string" &&
      projection.publishedAt.trim().length > 0
    );
  }

  export function isVerifiedUnitDraftProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    return (
      projection.objectType === "unit-draft" &&
      projection.draftStatus === "ready-for-teacher-review" &&
      projection.reviewPolicy === "teacher-review-before-course-publish" &&
      typeof projection.generatedBy === "string" &&
      projection.generatedBy.trim().length > 0 &&
      typeof projection.artifactId === "string" &&
      projection.artifactId.trim().length > 0 &&
      typeof projection.generatedAt === "string" &&
      projection.generatedAt.trim().length > 0
    );
  }

  export function isVerifiedAgentPlanProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    const expectedEnabledAgents = [
      "research-assistant",
      "math-coach",
      "writing-mentor",
    ];
    return (
      projection.objectType === "agent-plan" &&
      projection.planStatus === "saved" &&
      projection.governancePolicy === "teacher-reviewed-agent-plan" &&
      typeof projection.savedBy === "string" &&
      projection.savedBy.trim().length > 0 &&
      typeof projection.savedAt === "string" &&
      projection.savedAt.trim().length > 0 &&
      Array.isArray(projection.enabledAgents) &&
      expectedEnabledAgents.every((agent) => projection.enabledAgents?.includes(agent))
    );
  }

  export function isVerifiedPermissionPreflightProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    const expectedCheckedPermissions = [
      "course-bindings",
      "agent-roles",
      "student-access",
    ];
    return (
      projection.objectType === "permission-preflight" &&
      projection.preflightStatus === "passed" &&
      projection.preflightPolicy === "teacher-agent-permission-gate" &&
      typeof projection.checkedBy === "string" &&
      projection.checkedBy.trim().length > 0 &&
      typeof projection.checkedAt === "string" &&
      projection.checkedAt.trim().length > 0 &&
      Array.isArray(projection.checkedPermissions) &&
      expectedCheckedPermissions.every((permission) =>
        projection.checkedPermissions?.includes(permission),
      )
    );
  }

  export function isVerifiedAdminSettingsProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    const expectedAdminScopes = [
      "course-collaborators",
      "permission-boundary",
      "audit-routing",
    ];
    return (
      projection.objectType === "admin-settings" &&
      projection.settingsStatus === "saved" &&
      projection.governancePolicy === "teacher-controlled-admin-settings" &&
      typeof projection.savedBy === "string" &&
      projection.savedBy.trim().length > 0 &&
      typeof projection.savedAt === "string" &&
      projection.savedAt.trim().length > 0 &&
      Array.isArray(projection.adminScopes) &&
      expectedAdminScopes.every((scope) => projection.adminScopes?.includes(scope))
    );
  }

  export function isVerifiedCollaborationInviteNotificationProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    return (
      projection.objectType === "email-notification" &&
      projection.notificationStatus === "queued" &&
      projection.deliveryChannel === "collaboration-invite-email" &&
      projection.deliveryPolicy === "server-outbox-before-smtp-provider" &&
      typeof projection.queuedBy === "string" &&
      projection.queuedBy.trim().length > 0 &&
      typeof projection.outboxId === "string" &&
      projection.outboxId.trim().length > 0 &&
      typeof projection.queuedAt === "string" &&
      projection.queuedAt.trim().length > 0
    );
  }

  export function isVerifiedQuizBoardStateProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    const expectedVisibleMetrics = [
      "completion-rate",
      "item-quality",
      "misconception-clusters",
    ];
    return (
      projection.objectType === "quiz-board-state" &&
      projection.refreshStatus === "refreshed" &&
      projection.reviewPolicy === "teacher-visible-quiz-quality-board" &&
      typeof projection.refreshedBy === "string" &&
      projection.refreshedBy.trim().length > 0 &&
      typeof projection.refreshedAt === "string" &&
      projection.refreshedAt.trim().length > 0 &&
      Array.isArray(projection.visibleMetrics) &&
      expectedVisibleMetrics.every((metric) =>
        projection.visibleMetrics?.includes(metric),
      )
    );
  }

  export function isVerifiedQuizItemReviewProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    const expectedFlaggedSignals = [
      "low-discrimination",
      "high-error-rate",
      "teacher-review-needed",
    ];
    return (
      projection.objectType === "quiz-item-review" &&
      projection.reviewStatus === "flagged-for-review" &&
      projection.reviewPolicy === "teacher-review-before-quiz-reuse" &&
      typeof projection.flaggedBy === "string" &&
      projection.flaggedBy.trim().length > 0 &&
      typeof projection.flaggedAt === "string" &&
      projection.flaggedAt.trim().length > 0 &&
      Array.isArray(projection.flaggedSignals) &&
      expectedFlaggedSignals.every((signal) =>
        projection.flaggedSignals?.includes(signal),
      )
    );
  }

  export function isVerifiedGradingQueueProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    return (
      projection.objectType === "grading-queue" &&
      projection.queueStatus === "saved" &&
      projection.reviewPolicy === "teacher-review-before-release" &&
      typeof projection.savedBy === "string" &&
      projection.savedBy.trim().length > 0 &&
      typeof projection.savedAt === "string" &&
      projection.savedAt.trim().length > 0
    );
  }

  export function isVerifiedGradebookUpdateProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    return (
      projection.objectType === "gradebook-update" &&
      projection.updateStatus === "pending-release" &&
      projection.releasePolicy === "teacher-confirmed-grade-release" &&
      typeof projection.updatedBy === "string" &&
      projection.updatedBy.trim().length > 0 &&
      typeof projection.updatedAt === "string" &&
      projection.updatedAt.trim().length > 0
    );
  }

  export function isVerifiedAiFeedbackDraftProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    return (
      projection.objectType === "ai-feedback-draft" &&
      projection.feedbackStatus === "ready-for-teacher-review" &&
      projection.feedbackScope === "grading-review-queue" &&
      projection.reviewPolicy === "teacher-review-before-student-release" &&
      typeof projection.generatedBy === "string" &&
      projection.generatedBy.trim().length > 0 &&
      typeof projection.artifactId === "string" &&
      projection.artifactId.trim().length > 0 &&
      typeof projection.generatedAt === "string" &&
      projection.generatedAt.trim().length > 0
    );
  }

  export function isVerifiedInviteCodeDraftProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    return (
      projection.objectType === "invite-code-draft" &&
      projection.draftStatus === "generated" &&
      projection.invitePolicy === "teacher-review-before-publication" &&
      typeof projection.inviteCode === "string" &&
      projection.inviteCode.trim().length > 0 &&
      typeof projection.joinUrl === "string" &&
      projection.joinUrl.trim().length > 0 &&
      typeof projection.generatedBy === "string" &&
      projection.generatedBy.trim().length > 0 &&
      typeof projection.generatedAt === "string" &&
      projection.generatedAt.trim().length > 0
    );
  }

  export function isVerifiedEnrollmentAccessProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    return (
      projection.objectType === "enrollment-access" &&
      projection.publicationStatus === "published" &&
      projection.enrollmentPolicy === "teacher-confirmed-course-scope" &&
      typeof projection.inviteCode === "string" &&
      projection.inviteCode.trim().length > 0 &&
      typeof projection.joinUrl === "string" &&
      projection.joinUrl.trim().length > 0 &&
      typeof projection.publishedBy === "string" &&
      projection.publishedBy.trim().length > 0 &&
      typeof projection.publishedAt === "string" &&
      projection.publishedAt.trim().length > 0
    );
  }

  export function isVerifiedExportManifestProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    const expectedDatasetScopes = [
      "learning-records",
      "chat-threads",
      "grades",
      "activities",
    ];
    return (
      projection.objectType === "export-manifest" &&
      projection.exportStatus === "generated" &&
      projection.exportPolicy === "redacted-teacher-export-manifest" &&
      typeof projection.createdBy === "string" &&
      projection.createdBy.trim().length > 0 &&
      typeof projection.manifestId === "string" &&
      projection.manifestId.trim().length > 0 &&
      typeof projection.createdAt === "string" &&
      projection.createdAt.trim().length > 0 &&
      Array.isArray(projection.datasetScopes) &&
      expectedDatasetScopes.every((scope) => projection.datasetScopes?.includes(scope))
    );
  }

  export function isVerifiedRedactionValidationProjection(
    projection: InlineTeachingOperationDomainProjection,
  ) {
    const expectedCheckedScopes = [
      "student-private-notes",
      "credentials",
      "local-paths",
    ];
    return (
      projection.objectType === "redaction-validation" &&
      projection.validationStatus === "passed" &&
      projection.validationPolicy === "exclude-private-and-secret-fields" &&
      typeof projection.validatedBy === "string" &&
      projection.validatedBy.trim().length > 0 &&
      typeof projection.validatedAt === "string" &&
      projection.validatedAt.trim().length > 0 &&
      Array.isArray(projection.checkedScopes) &&
      expectedCheckedScopes.every((scope) => projection.checkedScopes?.includes(scope))
    );
  }

  export function getInlineDomainProjectionSemanticMismatchMessage(
    operationId: TeachingOperationId,
    actionSlot: "primary" | "secondary",
    locale: Locale,
  ) {
    if (operationId === "course-settings" && actionSlot === "primary") {
      return localizedText(TEACHING_COURSE_SETTINGS_READBACK_MISMATCH_MESSAGE, locale);
    }
    if (operationId === "course-settings" && actionSlot === "secondary") {
      return localizedText(
        TEACHING_STUDENT_PREVIEW_SESSION_READBACK_MISMATCH_MESSAGE,
        locale,
      );
    }
    if (operationId === "students" && actionSlot === "primary") {
      return localizedText(TEACHING_STUDENT_ROSTER_READBACK_MISMATCH_MESSAGE, locale);
    }
    if (operationId === "students" && actionSlot === "secondary") {
      return localizedText(TEACHING_GROUP_SUGGESTIONS_READBACK_MISMATCH_MESSAGE, locale);
    }
    if (operationId === "knowledge-base" && actionSlot === "primary") {
      return localizedText(TEACHING_KNOWLEDGE_INDEX_READBACK_MISMATCH_MESSAGE, locale);
    }
    if (operationId === "knowledge-base" && actionSlot === "secondary") {
      return localizedText(
        TEACHING_RESOURCE_REVIEW_ITEM_READBACK_MISMATCH_MESSAGE,
        locale,
      );
    }
    if (operationId === "dashboard" && actionSlot === "primary") {
      return localizedText(TEACHING_DASHBOARD_STATE_READBACK_MISMATCH_MESSAGE, locale);
    }
    if (operationId === "dashboard" && actionSlot === "secondary") {
      return localizedText(
        TEACHING_DASHBOARD_SNAPSHOT_READBACK_MISMATCH_MESSAGE,
        locale,
      );
    }
    if (operationId === "content" && actionSlot === "primary") {
      return localizedText(TEACHING_COURSE_CONTENT_READBACK_MISMATCH_MESSAGE, locale);
    }
    if (operationId === "content" && actionSlot === "secondary") {
      return localizedText(TEACHING_UNIT_DRAFT_READBACK_MISMATCH_MESSAGE, locale);
    }
    if (operationId === "agents" && actionSlot === "primary") {
      return localizedText(TEACHING_AGENT_PLAN_READBACK_MISMATCH_MESSAGE, locale);
    }
    if (operationId === "agents" && actionSlot === "secondary") {
      return localizedText(
        TEACHING_PERMISSION_PREFLIGHT_READBACK_MISMATCH_MESSAGE,
        locale,
      );
    }
    if (operationId === "admins" && actionSlot === "primary") {
      return localizedText(TEACHING_ADMIN_SETTINGS_READBACK_MISMATCH_MESSAGE, locale);
    }
    if (operationId === "admins" && actionSlot === "secondary") {
      return localizedText(
        TEACHING_COLLABORATION_INVITE_NOTIFICATION_READBACK_MISMATCH_MESSAGE,
        locale,
      );
    }
    if (operationId === "quiz-board" && actionSlot === "primary") {
      return localizedText(TEACHING_QUIZ_BOARD_STATE_READBACK_MISMATCH_MESSAGE, locale);
    }
    if (operationId === "quiz-board" && actionSlot === "secondary") {
      return localizedText(
        TEACHING_QUIZ_ITEM_REVIEW_READBACK_MISMATCH_MESSAGE,
        locale,
      );
    }
    if (operationId === "grading" && actionSlot === "primary") {
      return localizedText(TEACHING_GRADING_QUEUE_READBACK_MISMATCH_MESSAGE, locale);
    }
    if (operationId === "grading" && actionSlot === "secondary") {
      return localizedText(
        TEACHING_AI_FEEDBACK_DRAFT_READBACK_MISMATCH_MESSAGE,
        locale,
      );
    }
    if (operationId === "data-export" && actionSlot === "primary") {
      return localizedText(TEACHING_EXPORT_MANIFEST_READBACK_MISMATCH_MESSAGE, locale);
    }
    if (operationId === "data-export" && actionSlot === "secondary") {
      return localizedText(
        TEACHING_REDACTION_VALIDATION_READBACK_MISMATCH_MESSAGE,
        locale,
      );
    }
    return localizedText(TEACHING_OPERATION_AUDIT_FAILED_MESSAGE, locale);
  }

