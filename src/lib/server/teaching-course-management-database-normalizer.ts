import { TeachingCourseManagementStoreError } from "./teaching-course-management-error";
import { isRecord } from "./teaching-course-management-guards";
import {
  normalizeAdminSettingsRecord,
  normalizeAgentPermissionPreflightRecord,
  normalizeAgentSettingsRecord,
  normalizeAuditEvent,
  normalizeClassRecord,
  normalizeCollaborationInviteNotificationRecord,
  normalizeCourseContentPublishRecord,
  normalizeCourseRecord,
  normalizeCourseSettingsRecord,
  normalizeCourseUnitDraftRecord,
  normalizeDashboardSnapshotRecord,
  normalizeDashboardStateRecord,
  normalizeExportManifestRecord,
  normalizeExportRedactionValidationRecord,
  normalizeGradebookUpdateRecord,
  normalizeGradingFeedbackDraftRecord,
  normalizeGradingQueueRecord,
  normalizeInviteCodeDraftRecord,
  normalizeKnowledgeIndexSyncRecord,
  normalizeLearningGroupRecord,
  normalizeMembershipRecord,
  normalizeQuizAssessmentRecord,
  normalizeQuizItemReviewRecord,
  normalizeResourceReviewItemRecord,
  normalizeStudentGroupSuggestionRecord,
  normalizeStudentPreviewSessionRecord,
  normalizeStudentRosterSyncRecord,
} from "./teaching-course-management-record-normalizers";
import type { TeachingCourseManagementDatabase } from "@/lib/server/teaching-course-management-types";

// Whole-database normalizer + empty-database factory for the
// teaching-course-management store (Phase 3 decomposition). Maps each entity
// through the extracted record normalizers. Cycle-free: runtime deps are the
// extracted guards + record-normalizer + error modules; store types are type-only.

export function createEmptyDatabase(): TeachingCourseManagementDatabase {
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
    // Additive optional array (Phase 1 learning groups): absent on every snapshot
    // written before groups existed, so the key stays absent rather than becoming
    // an empty array — old snapshots normalize byte-identically.
    ...(Array.isArray(value.learningGroups)
      ? { learningGroups: value.learningGroups.map(normalizeLearningGroupRecord) }
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

