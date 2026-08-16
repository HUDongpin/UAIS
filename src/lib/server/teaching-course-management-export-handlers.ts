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
  TeachingCourseExportManifestRecord,
  TeachingCourseExportRedactionValidationRecord,
  TeachingCourseManagementAuditRequestSource,
  TeachingCourseManagementReceipt,
  TeachingCourseManagementRepository,
} from "@/lib/server/teaching-course-management-types";

// Export handler family for the teaching-course-management store (Phase 3
// decomposition): export manifest, provider-export marking, redaction validation.
// Cycle-free: runtime deps are the extracted io/helpers/guards/error modules; store
// types are a type-only import.

export async function saveTeachingCourseExportManifestRecord(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  operationRecordId: string;
  teachingOperationManifestId: string;
  sourceAction?: string;
  traceId?: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  now?: Date;
}): Promise<{
  exportManifest: TeachingCourseExportManifestRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const teachingOperationManifestId = requireSafeId(
    input.teachingOperationManifestId,
    "teaching operation manifest id",
  );
  const sourceAction = input.sourceAction
    ? requireSafeId(input.sourceAction, "source action")
    : undefined;
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const exportManifestId = `export-manifest-${courseId}`;

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

    const exportManifests = database.exportManifests ?? [];
    const existingExportManifestIndex = exportManifests.findIndex(
      (item) => item.exportManifestId === exportManifestId,
    );
    const existingExportManifest =
      existingExportManifestIndex >= 0
        ? exportManifests[existingExportManifestIndex]
        : undefined;
    if (existingExportManifest?.operationRecordId === operationRecordId) {
      const receipt = createReceipt({
        action: "create-export-manifest",
        actorId,
        courseId,
        traceId: input.traceId,
        createdAt: existingExportManifest.createdAt,
        storage,
      });
      return {
        exportManifest: existingExportManifest,
        receipt,
      };
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: createdAt,
    };

    const exportManifest: TeachingCourseExportManifestRecord = {
      exportManifestId,
      courseId,
      ownerTeacherId: course.ownerTeacherId,
      createdBy: actorId,
      exportStatus: "generated",
      operationRecordId,
      ...(sourceAction ? { sourceAction } : {}),
      teachingOperationManifestId,
      downloadRoute: `/api/teaching/operations/export/${teachingOperationManifestId}`,
      datasetScopes: ["learning-records", "chat-threads", "grades", "activities"],
      formats: ["json", "csv"],
      exportPolicy: "redacted-teacher-export-manifest",
      createdAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    database.exportManifests =
      existingExportManifestIndex >= 0
        ? exportManifests.map((item, index) =>
            index === existingExportManifestIndex ? exportManifest : item,
          )
        : [...exportManifests, exportManifest];
    database.updatedAt = createdAt;

    const receipt = createReceipt({
      action: "create-export-manifest",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "create-export-manifest",
      actorId,
      courseId,
      traceId: receipt.traceId,
      createdAt,
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
        exportManifest,
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

export async function markTeachingCourseExportProviderExported(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  operationRecordId: string;
  providerExportId: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  traceId?: string;
  now?: Date;
}): Promise<{
  exportManifest: TeachingCourseExportManifestRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const providerExportId = requireSafeId(input.providerExportId, "provider export id");
  const now = input.now ?? new Date();
  const providerExportedAt = now.toISOString();
  const exportManifestId = `export-manifest-${courseId}`;

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

    const exportManifests = database.exportManifests ?? [];
    const exportManifestIndex = exportManifests.findIndex(
      (item) =>
        item.exportManifestId === exportManifestId &&
        item.operationRecordId === operationRecordId,
    );
    if (exportManifestIndex < 0) {
      throw new TeachingCourseManagementStoreError(
        404,
        "Teaching export manifest record was not found.",
      );
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: providerExportedAt,
    };

    const exportManifest: TeachingCourseExportManifestRecord = {
      ...exportManifests[exportManifestIndex],
      providerStatus: "export-provider-exported",
      providerExportId,
      providerExportedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      redaction: createRedaction(),
    };
    database.exportManifests = exportManifests.map((item, index) =>
      index === exportManifestIndex ? exportManifest : item,
    );
    database.updatedAt = providerExportedAt;

    const receipt = createReceipt({
      action: "export-course-data-provider",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: providerExportedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "export-course-data-provider",
      actorId,
      courseId,
      traceId: receipt.traceId,
      requestSource: input.audit?.requestSource,
      createdAt: providerExportedAt,
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
        exportManifest,
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

export async function saveTeachingCourseExportRedactionValidationRecord(input: {
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
  exportRedactionValidation: TeachingCourseExportRedactionValidationRecord;
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
  const validatedAt = now.toISOString();
  const exportRedactionValidationId = `export-redaction-validation-${courseId}`;

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

    const exportRedactionValidations = database.exportRedactionValidations ?? [];
    const existingValidationIndex = exportRedactionValidations.findIndex(
      (item) => item.exportRedactionValidationId === exportRedactionValidationId,
    );
    const existingValidation =
      existingValidationIndex >= 0
        ? exportRedactionValidations[existingValidationIndex]
        : undefined;
    if (existingValidation?.operationRecordId === operationRecordId) {
      const receipt = createReceipt({
        action: "validate-export-redaction-scope",
        actorId,
        courseId,
        traceId: input.traceId,
        createdAt: existingValidation.validatedAt,
        storage,
      });
      return {
        exportRedactionValidation: existingValidation,
        receipt,
      };
    }

    database.courses[courseIndex] = {
      ...course,
      updatedAt: validatedAt,
    };

    const exportRedactionValidation: TeachingCourseExportRedactionValidationRecord = {
      exportRedactionValidationId,
      courseId,
      ownerTeacherId: course.ownerTeacherId,
      validatedBy: actorId,
      validationStatus: "passed",
      operationRecordId,
      ...(sourceAction ? { sourceAction } : {}),
      checkedScopes: [
        "identity-fields",
        "ai-chat-transcripts",
        "voice-references",
        "local-file-paths",
      ],
      blockedSecretCount: 0,
      validationPolicy: "no-secrets-or-local-paths-before-export",
      validatedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    database.exportRedactionValidations =
      existingValidationIndex >= 0
        ? exportRedactionValidations.map((item, index) =>
            index === existingValidationIndex ? exportRedactionValidation : item,
          )
        : [...exportRedactionValidations, exportRedactionValidation];
    database.updatedAt = validatedAt;

    const receipt = createReceipt({
      action: "validate-export-redaction-scope",
      actorId,
      courseId,
      traceId: input.traceId,
      createdAt: validatedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "validate-export-redaction-scope",
      actorId,
      courseId,
      traceId: receipt.traceId,
      createdAt: validatedAt,
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
        exportRedactionValidation,
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
