import { isTeachingOperationId } from "@/components/teaching/teaching-operation-data";
import { actionDefinitions } from "./teaching-operations-action-catalog";
import { TeachingOperationStoreError } from "./teaching-operations-error";
import {
  createRedaction,
  isRecord,
  requireActionSlot,
  requireInviteCode,
  requireIsoDate,
  requireSafeId,
  requireSafeUrlPath,
} from "./teaching-operations-guards";
import { normalizeCourseSettingsPatchProjectionSnapshot } from "./teaching-operations-input-normalizers";
import type { TeachingOperationDomainProjection } from "./teaching-operations-store";

// Domain-projection normalizer for the teaching-operations store (Phase 3
// decomposition). Extracted as a single self-contained function; its runtime
// dependencies are the extracted guards/error/input-normalizer modules and
// teaching-operation-data, with store types via a type-only import (no runtime
// cycle). Behavior is identical to the previous inline definition.

export function normalizeDomainProjection(value: unknown): TeachingOperationDomainProjection {
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
