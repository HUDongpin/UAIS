import { TeachingCourseManagementStoreError } from "./teaching-course-management-error";
import { createRedaction, requireSafeId } from "./teaching-course-management-guards";
import {
  createAuditEvent,
  createReceipt,
} from "./teaching-course-management-helpers";
import {
  localTeachingCourseManagementStorage,
  readTeachingCourseManagementSnapshot,
  resolveTeachingCourseManagementDataDir,
  writeTeachingCourseManagementSnapshot,
} from "./teaching-course-management-io";
import {
  createTeachingCourseManagementContentionError,
  createTeachingCourseManagementWriteRetry,
  teachingCourseManagementMaxWriteAttempts,
} from "./teaching-course-management-write-retry";
import type {
  TeachingCourseGradebookUpdateRecord,
  TeachingCourseGradingFeedbackDraftRecord,
  TeachingCourseGradingQueueRecord,
  TeachingCourseManagementAuditRequestSource,
  TeachingCourseManagementReceipt,
  TeachingCourseManagementRepository,
} from "@/lib/server/teaching-course-management-types";

// Grading save/mark handlers for the teaching-course-management store (Phase 3
// decomposition): grading queue, feedback draft, and provider-generated marking.
// Cycle-free: runtime deps are the extracted io/helpers/guards/error modules; store
// types are a type-only import.

export async function saveTeachingGradingQueueRecord(input: {
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
  gradingQueue: TeachingCourseGradingQueueRecord;
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
  const gradingQueueId = `grading-queue-${courseId}`;

  const writeRetry = createTeachingCourseManagementWriteRetry();
  for (let attempt = 0; attempt < teachingCourseManagementMaxWriteAttempts; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
      courseId,
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

    const gradingQueues = database.gradingQueues ?? [];
    const existingGradingQueueIndex = gradingQueues.findIndex(
      (item) => item.gradingQueueId === gradingQueueId,
    );
    const existingGradingQueue =
      existingGradingQueueIndex >= 0 ? gradingQueues[existingGradingQueueIndex] : undefined;
    const gradebookUpdateId = `gradebook-update-${courseId}`;
    const gradebookUpdates = database.gradebookUpdates ?? [];
    const existingGradebookUpdateIndex = gradebookUpdates.findIndex(
      (item) => item.objectId === gradebookUpdateId,
    );
    const existingGradebookUpdate =
      existingGradebookUpdateIndex >= 0
        ? gradebookUpdates[existingGradebookUpdateIndex]
        : undefined;
    if (
      existingGradingQueue?.operationRecordId === operationRecordId &&
      existingGradebookUpdate?.operationRecordId === operationRecordId
    ) {
      const receipt = createReceipt({
        action: "save-grading-queue",
        actorId,
        courseId,
        traceId: input.traceId,
        createdAt: existingGradingQueue.savedAt,
        storage,
      });
      return {
        gradingQueue: existingGradingQueue,
        receipt,
      };
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: savedAt,
    };

    const gradingQueue: TeachingCourseGradingQueueRecord = {
      gradingQueueId,
      courseId,
      ownerTeacherId: course.ownerTeacherId,
      savedBy: actorId,
      queueStatus: "saved",
      operationRecordId,
      ...(sourceAction ? { sourceAction } : {}),
      gradebookUpdateId: `gradebook-update-${courseId}`,
      reviewPolicy: "teacher-review-before-release",
      releasePolicy: "teacher-confirmed-grade-release",
      savedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    const gradebookUpdate: TeachingCourseGradebookUpdateRecord = {
      objectId: gradebookUpdateId,
      objectType: "gradebook-update",
      courseId,
      updatedBy: actorId,
      updateStatus: "pending-release",
      operationRecordId,
      ...(sourceAction ? { sourceAction } : {}),
      releasePolicy: "teacher-confirmed-grade-release",
      updatedAt: savedAt,
      storagePolicy: "domain-projection-teaching-gradebook-update",
      redaction: createRedaction(),
    };
    database.gradingQueues =
      existingGradingQueueIndex >= 0
        ? gradingQueues.map((item, index) =>
            index === existingGradingQueueIndex ? gradingQueue : item,
          )
        : [...gradingQueues, gradingQueue];
    database.gradebookUpdates =
      existingGradebookUpdateIndex >= 0
        ? gradebookUpdates.map((item, index) =>
            index === existingGradebookUpdateIndex ? gradebookUpdate : item,
          )
        : [...gradebookUpdates, gradebookUpdate];
    database.updatedAt = savedAt;

    const receipt = createReceipt({
      action: "save-grading-queue",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: savedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "save-grading-queue",
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
        courseId,
      });
      return {
        gradingQueue,
        receipt,
      };
    } catch (error) {
      if (input.repository && (await writeRetry.shouldRetry({ attempt, error }))) {
        continue;
      }
      // A conflict that survives the ladder is exhausted contention, not a
      // caller mistake: answer with the structured 409 rather than passing the
      // backend's own revision-mismatch prose through. The local file path has no
      // revisions and never lands here.
      throw input.repository && writeRetry.isConflict(error)
        ? createTeachingCourseManagementContentionError()
        : error;
    }
  }

  throw createTeachingCourseManagementContentionError();
}

export async function saveTeachingGradingFeedbackDraftRecord(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  operationRecordId: string;
  teachingOperationFeedbackArtifactId: string;
  sourceAction?: string;
  traceId?: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  now?: Date;
}): Promise<{
  gradingFeedbackDraft: TeachingCourseGradingFeedbackDraftRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const teachingOperationFeedbackArtifactId = requireSafeId(
    input.teachingOperationFeedbackArtifactId,
    "teaching operation feedback artifact id",
  );
  const sourceAction = input.sourceAction
    ? requireSafeId(input.sourceAction, "source action")
    : undefined;
  const now = input.now ?? new Date();
  const generatedAt = now.toISOString();
  const gradingFeedbackDraftId = `grading-feedback-draft-${courseId}`;

  const writeRetry = createTeachingCourseManagementWriteRetry();
  for (let attempt = 0; attempt < teachingCourseManagementMaxWriteAttempts; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
      courseId,
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

    const gradingFeedbackDrafts = database.gradingFeedbackDrafts ?? [];
    const existingDraftIndex = gradingFeedbackDrafts.findIndex(
      (item) => item.gradingFeedbackDraftId === gradingFeedbackDraftId,
    );
    const existingDraft =
      existingDraftIndex >= 0 ? gradingFeedbackDrafts[existingDraftIndex] : undefined;
    if (existingDraft?.operationRecordId === operationRecordId) {
      const receipt = createReceipt({
        action: "generate-grading-feedback-draft",
        actorId,
        courseId,
        traceId: input.traceId,
        createdAt: existingDraft.generatedAt,
        storage,
      });
      return {
        gradingFeedbackDraft: existingDraft,
        receipt,
      };
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: generatedAt,
    };

    const gradingFeedbackDraft: TeachingCourseGradingFeedbackDraftRecord = {
      gradingFeedbackDraftId,
      courseId,
      ownerTeacherId: course.ownerTeacherId,
      generatedBy: actorId,
      feedbackStatus: "generated",
      operationRecordId,
      ...(sourceAction ? { sourceAction } : {}),
      teachingOperationFeedbackArtifactId,
      feedbackScope: "grading-review-queue",
      reviewPolicy: "teacher-review-before-student-release",
      releasePolicy: "teacher-confirmed-feedback-release",
      generatedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    database.gradingFeedbackDrafts =
      existingDraftIndex >= 0
        ? gradingFeedbackDrafts.map((item, index) =>
            index === existingDraftIndex ? gradingFeedbackDraft : item,
          )
        : [...gradingFeedbackDrafts, gradingFeedbackDraft];
    database.updatedAt = generatedAt;

    const receipt = createReceipt({
      action: "generate-grading-feedback-draft",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: generatedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "generate-grading-feedback-draft",
      actorId,
      courseId,
      traceId: receipt.traceId,
      createdAt: generatedAt,
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
        courseId,
      });
      return {
        gradingFeedbackDraft,
        receipt,
      };
    } catch (error) {
      if (input.repository && (await writeRetry.shouldRetry({ attempt, error }))) {
        continue;
      }
      // A conflict that survives the ladder is exhausted contention, not a
      // caller mistake: answer with the structured 409 rather than passing the
      // backend's own revision-mismatch prose through. The local file path has no
      // revisions and never lands here.
      throw input.repository && writeRetry.isConflict(error)
        ? createTeachingCourseManagementContentionError()
        : error;
    }
  }

  throw createTeachingCourseManagementContentionError();
}

export async function markTeachingGradingFeedbackProviderGenerated(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  operationRecordId: string;
  providerFeedbackId: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  traceId?: string;
  now?: Date;
}): Promise<{
  gradingFeedbackDraft: TeachingCourseGradingFeedbackDraftRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const providerFeedbackId = requireSafeId(input.providerFeedbackId, "provider feedback id");
  const now = input.now ?? new Date();
  const providerGeneratedAt = now.toISOString();
  const gradingFeedbackDraftId = `grading-feedback-draft-${courseId}`;

  const writeRetry = createTeachingCourseManagementWriteRetry();
  for (let attempt = 0; attempt < teachingCourseManagementMaxWriteAttempts; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
      courseId,
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

    const gradingFeedbackDrafts = database.gradingFeedbackDrafts ?? [];
    const gradingFeedbackDraftIndex = gradingFeedbackDrafts.findIndex(
      (item) =>
        item.gradingFeedbackDraftId === gradingFeedbackDraftId &&
        item.operationRecordId === operationRecordId,
    );
    if (gradingFeedbackDraftIndex < 0) {
      throw new TeachingCourseManagementStoreError(
        404,
        "Teaching grading feedback draft record was not found.",
      );
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: providerGeneratedAt,
    };

    const gradingFeedbackDraft: TeachingCourseGradingFeedbackDraftRecord = {
      ...gradingFeedbackDrafts[gradingFeedbackDraftIndex],
      providerStatus: "feedback-provider-generated",
      providerFeedbackId,
      providerGeneratedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      redaction: createRedaction(),
    };
    database.gradingFeedbackDrafts = gradingFeedbackDrafts.map((item, index) =>
      index === gradingFeedbackDraftIndex ? gradingFeedbackDraft : item,
    );
    database.updatedAt = providerGeneratedAt;

    const receipt = createReceipt({
      action: "generate-grading-feedback-provider",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: providerGeneratedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "generate-grading-feedback-provider",
      actorId,
      courseId,
      traceId: receipt.traceId,
      requestSource: input.audit?.requestSource,
      createdAt: providerGeneratedAt,
      storage,
    });
    database.auditEvents.push(auditEvent);

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
        courseId,
      });
      return {
        gradingFeedbackDraft,
        receipt,
      };
    } catch (error) {
      if (input.repository && (await writeRetry.shouldRetry({ attempt, error }))) {
        continue;
      }
      // A conflict that survives the ladder is exhausted contention, not a
      // caller mistake: answer with the structured 409 rather than passing the
      // backend's own revision-mismatch prose through. The local file path has no
      // revisions and never lands here.
      throw input.repository && writeRetry.isConflict(error)
        ? createTeachingCourseManagementContentionError()
        : error;
    }
  }

  throw createTeachingCourseManagementContentionError();
}
