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
  TeachingCourseContentPublishRecord,
  TeachingCourseDashboardSnapshotRecord,
  TeachingCourseDashboardStateRecord,
  TeachingCourseManagementAuditRequestSource,
  TeachingCourseManagementReceipt,
  TeachingCourseManagementRepository,
  TeachingCourseQuizAssessmentRecord,
  TeachingCourseQuizItemReviewRecord,
  TeachingCourseUnitDraftRecord,
  TeachingResourceReviewItemRecord,
} from "@/lib/server/teaching-course-management-types";

// Course-record handler family for the teaching-course-management store (Phase 3
// decomposition): resource review, content publish, unit draft, dashboard refresh/
// snapshot, quiz assessment/item review, admin/agent settings, agent preflight.
// Cycle-free: runtime deps are the extracted io/helpers/guards/error modules; store
// types are a type-only import.

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
        courseId,
      });
      return {
        resourceReviewItem,
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
        courseId,
      });
      return {
        contentPackage,
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
        courseId,
      });
      return {
        contentPackage,
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
        courseId,
      });
      return {
        unitDraft,
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
        courseId,
      });
      return {
        dashboardState,
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
        courseId,
      });
      return {
        dashboardSnapshot,
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
        courseId,
      });
      return {
        quizAssessment,
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
        courseId,
      });
      return {
        quizItemReview,
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
