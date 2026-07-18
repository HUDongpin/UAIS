import {
  createTeachingCourseId,
  isProvisionalTeachingCourseIdForActor,
} from "@/lib/teaching-course-id";
import type {
  TeachingClassDraftInput,
  TeachingClassInviteCodeDraftRecord,
  TeachingClassJoinInput,
  TeachingClassMembershipRecord,
  TeachingClassRecord,
  TeachingCourseCollaborationInviteNotificationRecord,
  TeachingCourseAdminSettingsRecord,
  TeachingCourseAgentPermissionPreflightRecord,
  TeachingCourseAgentSettingsRecord,
  TeachingCourseContentPublishRecord,
  TeachingCourseDashboardSnapshotRecord,
  TeachingCourseDashboardStateRecord,
  TeachingCourseDraftInput,
  TeachingCourseExportManifestRecord,
  TeachingCourseExportRedactionValidationRecord,
  TeachingCourseGradebookUpdateRecord,
  TeachingCourseGradingFeedbackDraftRecord,
  TeachingCourseGradingQueueRecord,
  TeachingCourseManagementAction,
  TeachingCourseManagementAuditEvent,
  TeachingCourseManagementAuditRequestSource,
  TeachingCourseManagementDatabase,
  TeachingCourseManagementRepository,
  TeachingCourseManagementRepositorySnapshot,
  TeachingCourseManagementStorageDescriptor,
  TeachingCourseManagementAuthSessionSummary,
  TeachingCourseManagementReceipt,
  TeachingCourseQuizAssessmentRecord,
  TeachingCourseQuizItemReviewRecord,
  TeachingCourseRecord,
  TeachingCourseSettingsAppliedField,
  TeachingCourseSettingsPatchInput,
  TeachingCourseSettingsRecord,
  TeachingCourseUnitDraftRecord,
  TeachingKnowledgeIndexSyncRecord,
  TeachingResourceReviewItemRecord,
  TeachingStudentGroupSuggestionRecord,
  TeachingStudentPreviewSessionRecord,
  TeachingStudentRosterSyncRecord,
} from "@/lib/server/teaching-course-management-types";
import { TeachingCourseManagementStoreError } from "./teaching-course-management-error";
import {
  createRedaction,
  ensureWithinBase,
  isRecord,
  normalizeAuditRequestSource,
  optionalTrimmedString,
  requireInviteCode,
  requireSafeId,
  requireTrimmedString,
} from "./teaching-course-management-guards";
import {
  normalizeAdminSettingsRecord,
  normalizeAgentPermissionPreflightRecord,
  normalizeAgentSettingsRecord,
  normalizeAuditEvent,
  normalizeAuthSessionSummary,
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
  normalizeMembershipRecord,
  normalizeQuizAssessmentRecord,
  normalizeQuizItemReviewRecord,
  normalizeResourceReviewItemRecord,
  normalizeStudentGroupSuggestionRecord,
  normalizeStudentPreviewSessionRecord,
  normalizeStudentRosterSyncRecord,
} from "./teaching-course-management-record-normalizers";
import {
  countApprovedMembershipsForClass,
  countApprovedStudentsForCourse,
  createAuditEvent,
  createClassInvitationCode,
  createReceipt,
  formatTimestampId,
  isTeachingCourseManagementOptimisticSnapshotConflict,
  isTeachingCourseManagementProductionRuntime,
  normalizeClassDraft,
  normalizeClassUniqueValue,
  normalizeCourseDraft,
  normalizeCourseSettingsPatch,
} from "./teaching-course-management-helpers";
import {
  createEmptyDatabase,
  normalizeTeachingCourseManagementDatabase,
} from "./teaching-course-management-database-normalizer";
import {
  localTeachingCourseManagementStorage,
  readTeachingCourseManagementSnapshot,
  resolveTeachingCourseManagementDataDir,
  writeTeachingCourseManagementSnapshot,
} from "./teaching-course-management-io";

// Re-exported so consumers importing these from the store keep working after they
// moved to their own modules (Phase 3 decomposition).
export { normalizeTeachingCourseManagementDatabase };
export { readTeachingCourseManagementSnapshot, resolveTeachingCourseManagementDataDir };
export { readTeachingCourseManagementDatabase } from "./teaching-course-management-io";
// Grading handlers moved to their own module; re-exported so the routes keep
// importing them from the store unchanged (Phase 3 decomposition).
export {
  markTeachingGradingFeedbackProviderGenerated,
  saveTeachingGradingFeedbackDraftRecord,
  saveTeachingGradingQueueRecord,
} from "./teaching-course-management-grading-handlers";
export {
  markTeachingCourseExportProviderExported,
  saveTeachingCourseExportManifestRecord,
  saveTeachingCourseExportRedactionValidationRecord,
} from "./teaching-course-management-export-handlers";
export {
  markTeachingCollaborationInviteNotificationDelivered,
  recordTeachingCollaborationInviteEmailDeliveryCallback,
  saveTeachingCollaborationInviteNotificationRecord,
} from "./teaching-course-management-collaboration-invite-handlers";
export {
  markTeachingKnowledgeIndexProviderSynced,
  markTeachingStudentRosterProviderSynced,
  saveTeachingKnowledgeIndexSyncRecord,
  saveTeachingStudentGroupSuggestionRecord,
  saveTeachingStudentPreviewSessionRecord,
  saveTeachingStudentRosterSyncRecord,
} from "./teaching-course-management-student-handlers";

// Re-exported so consumers importing the error from the store keep working after
// it was extracted to its own module (Phase 3 decomposition).
export { TeachingCourseManagementStoreError };

export type {
  TeachingClassDraftInput,
  TeachingClassInviteCodeDraftRecord,
  TeachingClassJoinInput,
  TeachingClassMembershipRecord,
  TeachingClassRecord,
  TeachingCourseCollaborationInviteNotificationRecord,
  TeachingCourseAdminSettingsRecord,
  TeachingCourseAgentPermissionPreflightRecord,
  TeachingCourseAgentSettingsRecord,
  TeachingCourseContentPublishRecord,
  TeachingCourseDashboardSnapshotRecord,
  TeachingCourseDashboardStateRecord,
  TeachingCourseDraftInput,
  TeachingCourseExportManifestRecord,
  TeachingCourseExportRedactionValidationRecord,
  TeachingCourseGradebookUpdateRecord,
  TeachingCourseGradingFeedbackDraftRecord,
  TeachingCourseGradingQueueRecord,
  TeachingCourseManagementAction,
  TeachingCourseManagementAuditEvent,
  TeachingCourseManagementAuditRequestSource,
  TeachingCourseManagementAuditStoragePolicy,
  TeachingCourseManagementDatabase,
  TeachingCourseManagementRecordStoragePolicy,
  TeachingCourseManagementRedaction,
  TeachingCourseManagementRepository,
  TeachingCourseManagementRepositorySnapshot,
  TeachingCourseManagementStorageDescriptor,
  TeachingCourseManagementStorageWritePolicy,
  TeachingCourseManagementAuthSessionSummary,
  TeachingCourseManagementReceipt,
  TeachingCourseQuizAssessmentRecord,
  TeachingCourseQuizItemReviewRecord,
  TeachingCourseRecord,
  TeachingCourseSettingsAppliedField,
  TeachingCourseSettingsPatchInput,
  TeachingCourseSettingsRecord,
  TeachingCourseUnitDraftRecord,
  TeachingKnowledgeIndexSyncRecord,
  TeachingResourceReviewItemRecord,
  TeachingStudentGroupSuggestionRecord,
  TeachingStudentPreviewSessionRecord,
  TeachingStudentRosterSyncRecord,
} from "@/lib/server/teaching-course-management-types";


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

