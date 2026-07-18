import {
  createTeachingCourseId,
  isProvisionalTeachingCourseIdForActor,
} from "@/lib/teaching-course-id";
import type {
  TeachingClassDraftInput,
  TeachingClassRecord,
  TeachingCourseDraftInput,
  TeachingCourseManagementAuditRequestSource,
  TeachingCourseManagementRepository,
  TeachingCourseManagementAuthSessionSummary,
  TeachingCourseManagementReceipt,
  TeachingCourseRecord,
  TeachingCourseSettingsRecord,
} from "@/lib/server/teaching-course-management-types";
import { TeachingCourseManagementStoreError } from "./teaching-course-management-error";
import {
  createRedaction,
  requireSafeId,
} from "./teaching-course-management-guards";
import {
  createAuditEvent,
  createClassInvitationCode,
  createReceipt,
  isTeachingCourseManagementOptimisticSnapshotConflict,
  isTeachingCourseManagementProductionRuntime,
  normalizeClassDraft,
  normalizeClassUniqueValue,
  normalizeCourseDraft,
  normalizeCourseSettingsPatch,
} from "./teaching-course-management-helpers";
import {
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
export {
  markTeachingCourseContentProviderPublished,
  saveTeachingCourseContentPublishRecord,
  saveTeachingCourseDashboardRefreshRecord,
  saveTeachingCourseDashboardSnapshotRecord,
  saveTeachingCourseQuizAssessmentRecord,
  saveTeachingCourseQuizItemReviewRecord,
  saveTeachingCourseUnitDraftRecord,
  saveTeachingResourceReviewItemRecord,
} from "./teaching-course-management-course-record-handlers";
export {
  saveTeachingAdminSettingsRecord,
  saveTeachingAgentPermissionPreflightRecord,
  saveTeachingAgentSettingsRecord,
} from "./teaching-course-management-settings-handlers";
export {
  approveTeachingClassMembership,
  assertTeachingClassInviteCodePublishTarget,
  joinTeachingClassByInviteCode,
  publishTeachingClassInviteCode,
  rollbackTeachingCourseCreation,
  saveTeachingClassInviteCodeDraftRecord,
} from "./teaching-course-management-class-handlers";

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

