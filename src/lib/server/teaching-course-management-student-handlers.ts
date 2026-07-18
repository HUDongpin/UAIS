import { TeachingCourseManagementStoreError } from "./teaching-course-management-error";
import { createRedaction, requireSafeId } from "./teaching-course-management-guards";
import {
  countApprovedMembershipsForClass,
  countApprovedStudentsForCourse,
  createAuditEvent,
  createReceipt,
  formatTimestampId,
  isTeachingCourseManagementOptimisticSnapshotConflict,
} from "./teaching-course-management-helpers";
import {
  localTeachingCourseManagementStorage,
  readTeachingCourseManagementSnapshot,
  resolveTeachingCourseManagementDataDir,
  writeTeachingCourseManagementSnapshot,
} from "./teaching-course-management-io";
import type {
  TeachingCourseManagementAuditRequestSource,
  TeachingCourseManagementReceipt,
  TeachingCourseManagementRepository,
  TeachingKnowledgeIndexSyncRecord,
  TeachingStudentGroupSuggestionRecord,
  TeachingStudentPreviewSessionRecord,
  TeachingStudentRosterSyncRecord,
} from "@/lib/server/teaching-course-management-types";

// Student roster / knowledge-index / group-suggestion handler family for the
// teaching-course-management store (Phase 3 decomposition). Cycle-free: runtime
// deps are the extracted io/helpers/guards/error modules; store types are a
// type-only import.

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
