import { timingSafeEqual, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { UaisTeacherAiResourceOwnership } from "@/lib/server/ai-resource-grants";
import {
  normalizeTeachingCourseManagementDatabase,
} from "@/lib/server/teaching-course-management-store";
import {
  normalizeTeachingCourseAssetsDatabase,
} from "@/lib/server/teaching-course-assets-store";
import {
  learningChatroomShareSchemaVersion,
  normalizeLearningChatroomShareDatabase,
} from "@/lib/server/learning-chatroom-share-store";
import {
  learningChatroomTranscriptLegacySchemaVersion,
  learningChatroomTranscriptSchemaVersion,
  normalizeLearningChatroomTranscriptDatabase,
} from "@/lib/server/learning-chatroom-transcript-store";
import {
  readLearningChatroomSharesSnapshot,
  replaceLearningChatroomSharesSnapshot,
} from "./external-storage-route-share-store";
import { HttpError } from "./external-storage-http-error";
import {
  createErrorResponse,
  createRedaction,
  isRecord,
  jsonResponse,
  mergeById,
  mergeIdList,
  requireSafeId,
} from "./external-storage-route-guards";
import {
  normalizeAlertNotificationRequest,
  normalizeLifecycleAuditEvent,
  normalizeOwnership,
  normalizeTeachingCourseAssetsBackupRequest,
  normalizeTeachingCourseAssetsRestoreDrillRequest,
  normalizeTeachingCourseManagementBackupRequest,
  normalizeTeachingCourseManagementRestoreDrillRequest,
  normalizeTeachingOperationAuditEvent,
  normalizeTeachingOperationBackupRequest,
  normalizeTeachingOperationRecord,
  normalizeTeachingOperationRestoreDrillRequest,
  normalizeTeachingOperationRollbackRequest,
} from "./external-storage-serialization";
import {
  appendLifecycleAuditEvent,
  appendTeachingOperation,
  createTeachingCourseAssetsBackup,
  createTeachingCourseManagementBackup,
  createTeachingOperationBackup,
  enqueueTeachingOperationAlertNotifications,
  listLifecycleAuditEvents,
  listTeachingOperationAlertNotifications,
  listTeachingOperationAuditReadback,
  readLearningChatroomTranscriptsSnapshot,
  readTeacherOwnership,
  readTeachingCourseAssetsSnapshot,
  readTeachingCourseManagementSnapshot,
  replaceLearningChatroomTranscriptsSnapshot,
  replaceTeachingCourseAssetsSnapshot,
  replaceTeachingCourseManagementSnapshot,
  rollbackTeachingOperation,
  summarizeTeachingOperationAuditAlerts,
  verifyTeachingCourseAssetsBackupRestoreDrill,
  verifyTeachingCourseManagementBackupRestoreDrill,
  verifyTeachingOperationBackupRestoreDrill,
  writeTeacherOwnership,
} from "./external-storage-route-store";
import {
  ensureWithinBase,
} from "./external-storage-route-paths";

const externalStorageApiContractVersion = "uais-external-storage-v1";
const maxBodyBytes = 1_000_000;
const minProductionAccessTokenLength = 32;

type ExternalStorageServiceMode = "reference" | "production";

export type ExternalStorageRouteConfig = {
  dataDir: string;
  accessToken?: string;
  accessTokenStatus: "present" | "missing" | "weak";
  adminAlertWebhook?: {
    url: string;
    token?: string;
  };
  serviceMode: ExternalStorageServiceMode;
  serviceTarget:
    | "uais-external-storage-reference-service"
    | "uais-external-storage-production-service";
  productionDatabaseAdapter: ExternalStorageProductionDatabaseAdapterProof;
};

type ExternalStorageProductionDatabaseAdapterProof = {
  status: "ready" | "blocked";
  providerClass: "managed-database" | "not-configured" | string;
  migrationStatus: "up-to-date" | "blocked" | string;
  backupPolicy: "point-in-time-restore" | "not-configured" | string;
  concurrencyControl: "transactional" | "blocked" | string;
  valueRedacted: true;
};

type ExternalStorageRouteContext<TParams extends Record<string, string>> = {
  params: TParams | Promise<TParams>;
};

type ExternalStorageRouteDeps = {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
};


export function createExternalStorageHealthGetHandler(
  deps: ExternalStorageRouteDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function GET() {
    const config = createExternalStorageRouteConfig(env);
    const durableBackingStore = await probeDurableBackingStore(config.dataDir);
    const tokenReady = config.accessTokenStatus === "present";
    const adapterReady =
      config.serviceMode !== "production" ||
      isProductionDatabaseAdapterReady(config.productionDatabaseAdapter);
    const ready = durableBackingStore.status === "ready" && tokenReady && adapterReady;

    return jsonResponse(ready ? 200 : 503, {
      status: ready ? "ok" : "blocked",
      target: config.serviceTarget,
      productionServiceIdentity: createProductionServiceIdentity(config),
      apiContractVersion: externalStorageApiContractVersion,
      durableBackingStore,
      teachingOperationsStorageSchema: createTeachingOperationsStorageSchema(
        ready,
        config.productionDatabaseAdapter,
      ),
      teachingCourseManagementStorageSchema:
        createTeachingCourseManagementStorageSchema(
          ready,
          config.productionDatabaseAdapter,
        ),
      teachingCourseAssetsStorageSchema: createTeachingCourseAssetsStorageSchema(
        ready,
        config.productionDatabaseAdapter,
      ),
      learningChatroomStorageSchema: createLearningChatroomStorageSchema(
        ready,
        config.productionDatabaseAdapter,
      ),
      accessToken: {
        status: config.accessTokenStatus,
        minimumProductionLength: minProductionAccessTokenLength,
        valueRedacted: true,
      },
      redaction: createRedaction(),
    });
  };
}

export function createExternalStorageTeacherOwnershipGetHandler(
  deps: ExternalStorageRouteDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function GET(
    request: Request,
    context: ExternalStorageRouteContext<{ teacherId: string }>,
  ) {
    try {
      const config = createExternalStorageRouteConfig(env);
      const unauthorized = authorizeExternalStorageRequest(request, config);
      if (unauthorized) {
        return unauthorized;
      }
      const params = await context.params;
      const teacherId = requireSafeId(params.teacherId, "teacher id");
      const ownership = await readTeacherOwnership({
        dataDir: config.dataDir,
        teacherId,
      });
      if (!ownership) {
        return jsonResponse(404, {
          error: "Teacher AI ownership record not found.",
          redaction: createRedaction(),
        });
      }

      return jsonResponse(200, ownership);
    } catch (error) {
      return createErrorResponse(error);
    }
  };
}

export function createExternalStorageTeacherOwnershipMergePostHandler(
  deps: ExternalStorageRouteDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function POST(
    request: Request,
    context: ExternalStorageRouteContext<{ teacherId: string }>,
  ) {
    try {
      const config = createExternalStorageRouteConfig(env);
      const unauthorized = authorizeExternalStorageRequest(request, config);
      if (unauthorized) {
        return unauthorized;
      }
      const params = await context.params;
      const teacherId = requireSafeId(params.teacherId, "teacher id");
      const body = await readJsonBody(request);
      if (!isRecord(body) || body.action !== "merge-teacher-ai-ownership") {
        throw new HttpError(400, "Unsupported teacher ownership action.");
      }
      const incoming = normalizeOwnership(body.ownership);
      if (incoming.teacherId !== teacherId) {
        throw new HttpError(400, "Teacher AI ownership record id mismatch.");
      }
      const existing = await readTeacherOwnership({
        dataDir: config.dataDir,
        teacherId,
      });
      const merged = mergeOwnership(existing, incoming);
      await writeTeacherOwnership({ dataDir: config.dataDir, ownership: merged });

      return jsonResponse(200, {
        teacherId,
        courseIds: merged.courseIds,
        status: "merged",
        storagePolicy: "external-redacted-teacher-ai-ownership-merge",
        storageWritePolicy: "external-atomic-merge",
        responsibleSession: "S12",
        updatedAt:
          typeof body.updatedAt === "string" && body.updatedAt.trim()
            ? body.updatedAt
            : new Date().toISOString(),
        redaction: createRedaction(),
      });
    } catch (error) {
      return createErrorResponse(error);
    }
  };
}

export function createExternalStorageTeachingCourseManagementDatabaseGetHandler(
  deps: ExternalStorageRouteDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function GET(request: Request) {
    try {
      const config = createExternalStorageRouteConfig(env);
      const unauthorized = authorizeExternalStorageRequest(request, config);
      if (unauthorized) {
        return unauthorized;
      }
      assertProductionDatabaseAdapterReadyForSnapshotReadback(config);

      return jsonResponse(
        200,
        withProductionDatabaseAdapterEvidence(
          await readTeachingCourseManagementSnapshot(config.dataDir),
          config,
        ),
      );
    } catch (error) {
      return createErrorResponse(error);
    }
  };
}

export function createExternalStorageTeachingCourseManagementDatabasePutHandler(
  deps: ExternalStorageRouteDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function PUT(request: Request) {
    try {
      const config = createExternalStorageRouteConfig(env);
      const unauthorized = authorizeExternalStorageRequest(request, config);
      if (unauthorized) {
        return unauthorized;
      }
      const body = await readJsonBody(request);
      if (
        !isRecord(body) ||
        body.action !== "replace-teaching-course-management-database"
      ) {
        throw new HttpError(400, "Unsupported teaching course management action.");
      }
      if (typeof body.expectedRevision !== "string" || !body.expectedRevision.trim()) {
        throw new HttpError(400, "Teaching course management expected revision is required.");
      }
      assertProductionDatabaseAdapterReadyForSnapshotReplace(config);

      return jsonResponse(
        200,
        withProductionDatabaseAdapterEvidence(
          await replaceTeachingCourseManagementSnapshot({
            dataDir: config.dataDir,
            expectedRevision: body.expectedRevision,
            database: normalizeTeachingCourseManagementDatabase(body.database),
          }),
          config,
        ),
      );
    } catch (error) {
      return createErrorResponse(error);
    }
  };
}

export function createExternalStorageTeachingCourseManagementBackupPostHandler(
  deps: ExternalStorageRouteDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function POST(request: Request) {
    try {
      const config = createExternalStorageRouteConfig(env);
      const unauthorized = authorizeExternalStorageRequest(request, config);
      if (unauthorized) {
        return unauthorized;
      }
      assertProductionDatabaseAdapterReadyForBackupAndRestoreDrill(config);
      const backupRequest = normalizeTeachingCourseManagementBackupRequest(
        await readJsonBody(request),
      );

      return jsonResponse(
        200,
        withProductionDatabaseAdapterEvidence(
          await createTeachingCourseManagementBackup({
            dataDir: config.dataDir,
            ...backupRequest,
          }),
          config,
        ),
      );
    } catch (error) {
      return createErrorResponse(error);
    }
  };
}

export function createExternalStorageTeachingCourseManagementBackupRestoreDrillPostHandler(
  deps: ExternalStorageRouteDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function POST(
    request: Request,
    context: ExternalStorageRouteContext<{ backupId: string }>,
  ) {
    try {
      const config = createExternalStorageRouteConfig(env);
      const unauthorized = authorizeExternalStorageRequest(request, config);
      if (unauthorized) {
        return unauthorized;
      }
      assertProductionDatabaseAdapterReadyForBackupAndRestoreDrill(config);
      const params = await context.params;
      const backupId = requireSafeId(
        params.backupId,
        "teaching course management backup id",
      );
      const restoreDrillRequest = normalizeTeachingCourseManagementRestoreDrillRequest(
        await readJsonBody(request),
      );

      return jsonResponse(
        200,
        withProductionDatabaseAdapterEvidence(
          await verifyTeachingCourseManagementBackupRestoreDrill({
            dataDir: config.dataDir,
            backupId,
            ...restoreDrillRequest,
          }),
          config,
        ),
      );
    } catch (error) {
      return createErrorResponse(error);
    }
  };
}

export function createExternalStorageTeachingCourseAssetsDatabaseGetHandler(
  deps: ExternalStorageRouteDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function GET(request: Request) {
    try {
      const config = createExternalStorageRouteConfig(env);
      const unauthorized = authorizeExternalStorageRequest(request, config);
      if (unauthorized) {
        return unauthorized;
      }
      assertProductionDatabaseAdapterReadyForSnapshotReadback(config);

      return jsonResponse(
        200,
        withProductionDatabaseAdapterEvidence(
          await readTeachingCourseAssetsSnapshot(config.dataDir),
          config,
        ),
      );
    } catch (error) {
      return createErrorResponse(error);
    }
  };
}

export function createExternalStorageTeachingCourseAssetsDatabasePutHandler(
  deps: ExternalStorageRouteDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function PUT(request: Request) {
    try {
      const config = createExternalStorageRouteConfig(env);
      const unauthorized = authorizeExternalStorageRequest(request, config);
      if (unauthorized) {
        return unauthorized;
      }
      const body = await readJsonBody(request);
      if (
        !isRecord(body) ||
        body.action !== "replace-teaching-course-assets-database"
      ) {
        throw new HttpError(400, "Unsupported teaching course assets action.");
      }
      if (typeof body.expectedRevision !== "string" || !body.expectedRevision.trim()) {
        throw new HttpError(400, "Teaching course assets expected revision is required.");
      }
      assertProductionDatabaseAdapterReadyForSnapshotReplace(config);

      return jsonResponse(
        200,
        withProductionDatabaseAdapterEvidence(
          await replaceTeachingCourseAssetsSnapshot({
            dataDir: config.dataDir,
            expectedRevision: body.expectedRevision,
            database: normalizeTeachingCourseAssetsDatabase(body.database),
          }),
          config,
        ),
      );
    } catch (error) {
      return createErrorResponse(error);
    }
  };
}

export function createExternalStorageLearningChatroomSharesDatabaseGetHandler(
  deps: ExternalStorageRouteDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function GET(request: Request) {
    try {
      const config = createExternalStorageRouteConfig(env);
      const unauthorized = authorizeExternalStorageRequest(request, config);
      if (unauthorized) {
        return unauthorized;
      }
      assertProductionDatabaseAdapterReadyForSnapshotReadback(config);

      return jsonResponse(
        200,
        withProductionDatabaseAdapterEvidence(
          await readLearningChatroomSharesSnapshot(config.dataDir),
          config,
        ),
      );
    } catch (error) {
      return createErrorResponse(error);
    }
  };
}

export function createExternalStorageLearningChatroomSharesDatabasePutHandler(
  deps: ExternalStorageRouteDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function PUT(request: Request) {
    try {
      const config = createExternalStorageRouteConfig(env);
      const unauthorized = authorizeExternalStorageRequest(request, config);
      if (unauthorized) {
        return unauthorized;
      }
      const body = await readJsonBody(request);
      if (!isRecord(body) || body.action !== "replace-learning-chatroom-shares-database") {
        throw new HttpError(400, "Unsupported learning chatroom shares action.");
      }
      if (typeof body.expectedRevision !== "string" || !body.expectedRevision.trim()) {
        throw new HttpError(400, "Learning chatroom shares expected revision is required.");
      }
      assertProductionDatabaseAdapterReadyForSnapshotReplace(config);

      return jsonResponse(
        200,
        withProductionDatabaseAdapterEvidence(
          await replaceLearningChatroomSharesSnapshot({
            dataDir: config.dataDir,
            expectedRevision: body.expectedRevision,
            database: normalizeLearningChatroomShareDatabase(body.database),
          }),
          config,
        ),
      );
    } catch (error) {
      return createErrorResponse(error);
    }
  };
}

export function createExternalStorageLearningChatroomTranscriptsDatabaseGetHandler(
  deps: ExternalStorageRouteDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function GET(request: Request) {
    try {
      const config = createExternalStorageRouteConfig(env);
      const unauthorized = authorizeExternalStorageRequest(request, config);
      if (unauthorized) {
        return unauthorized;
      }
      assertProductionDatabaseAdapterReadyForSnapshotReadback(config);

      return jsonResponse(
        200,
        withProductionDatabaseAdapterEvidence(
          await readLearningChatroomTranscriptsSnapshot(config.dataDir),
          config,
        ),
      );
    } catch (error) {
      return createErrorResponse(error);
    }
  };
}

export function createExternalStorageLearningChatroomTranscriptsDatabasePutHandler(
  deps: ExternalStorageRouteDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function PUT(request: Request) {
    try {
      const config = createExternalStorageRouteConfig(env);
      const unauthorized = authorizeExternalStorageRequest(request, config);
      if (unauthorized) {
        return unauthorized;
      }
      const body = await readJsonBody(request);
      if (
        !isRecord(body) ||
        body.action !== "replace-learning-chatroom-transcripts-database"
      ) {
        throw new HttpError(400, "Unsupported learning chatroom transcripts action.");
      }
      if (typeof body.expectedRevision !== "string" || !body.expectedRevision.trim()) {
        throw new HttpError(
          400,
          "Learning chatroom transcripts expected revision is required.",
        );
      }
      assertProductionDatabaseAdapterReadyForSnapshotReplace(config);

      return jsonResponse(
        200,
        withProductionDatabaseAdapterEvidence(
          await replaceLearningChatroomTranscriptsSnapshot({
            dataDir: config.dataDir,
            expectedRevision: body.expectedRevision,
            database: normalizeLearningChatroomTranscriptDatabase(body.database),
          }),
          config,
        ),
      );
    } catch (error) {
      return createErrorResponse(error);
    }
  };
}

export function createExternalStorageTeachingCourseAssetsBackupPostHandler(
  deps: ExternalStorageRouteDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function POST(request: Request) {
    try {
      const config = createExternalStorageRouteConfig(env);
      const unauthorized = authorizeExternalStorageRequest(request, config);
      if (unauthorized) {
        return unauthorized;
      }
      assertProductionDatabaseAdapterReadyForBackupAndRestoreDrill(config);
      const backupRequest = normalizeTeachingCourseAssetsBackupRequest(
        await readJsonBody(request),
      );

      return jsonResponse(
        200,
        withProductionDatabaseAdapterEvidence(
          await createTeachingCourseAssetsBackup({
            dataDir: config.dataDir,
            ...backupRequest,
          }),
          config,
        ),
      );
    } catch (error) {
      return createErrorResponse(error);
    }
  };
}

export function createExternalStorageTeachingCourseAssetsBackupRestoreDrillPostHandler(
  deps: ExternalStorageRouteDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function POST(
    request: Request,
    context: ExternalStorageRouteContext<{ backupId: string }>,
  ) {
    try {
      const config = createExternalStorageRouteConfig(env);
      const unauthorized = authorizeExternalStorageRequest(request, config);
      if (unauthorized) {
        return unauthorized;
      }
      assertProductionDatabaseAdapterReadyForBackupAndRestoreDrill(config);
      const params = await context.params;
      const backupId = requireSafeId(
        params.backupId,
        "teaching course assets backup id",
      );
      const restoreDrillRequest = normalizeTeachingCourseAssetsRestoreDrillRequest(
        await readJsonBody(request),
      );

      return jsonResponse(
        200,
        withProductionDatabaseAdapterEvidence(
          await verifyTeachingCourseAssetsBackupRestoreDrill({
            dataDir: config.dataDir,
            backupId,
            ...restoreDrillRequest,
          }),
          config,
        ),
      );
    } catch (error) {
      return createErrorResponse(error);
    }
  };
}

export function createExternalStorageTeachingOperationAppendPostHandler(
  deps: ExternalStorageRouteDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function POST(
    request: Request,
    context: ExternalStorageRouteContext<{ teacherId: string }>,
  ) {
    try {
      const config = createExternalStorageRouteConfig(env);
      const unauthorized = authorizeExternalStorageRequest(request, config);
      if (unauthorized) {
        return unauthorized;
      }
      const params = await context.params;
      const teacherId = requireSafeId(params.teacherId, "teacher id");
      assertProductionDatabaseAdapterReadyForAppend(config);
      const body = await readJsonBody(request);
      if (!isRecord(body) || body.action !== "append-teaching-operation") {
        throw new HttpError(400, "Unsupported teaching operation action.");
      }
      const record = normalizeTeachingOperationRecord(body.record);
      if (record.actorId !== teacherId) {
        throw new HttpError(400, "Teaching operation actor id mismatch.");
      }
      const auditEvent = body.auditEvent
        ? normalizeTeachingOperationAuditEvent(body.auditEvent)
        : undefined;
      if (
        auditEvent &&
        ![
          "teaching-operation.persisted",
          "teaching-gradebook-update.released",
          "teaching-gradebook-update.release-rolled-back",
        ].includes(auditEvent.eventType)
      ) {
        throw new HttpError(400, "Teaching operation append audit event type is invalid.");
      }
      if (auditEvent && auditEvent.actorId !== teacherId) {
        throw new HttpError(400, "Teaching operation audit actor id mismatch.");
      }
      const appendResult = await appendTeachingOperation({
        dataDir: config.dataDir,
        teacherId,
        record,
        auditEvent,
      });

      return jsonResponse(200, {
        teacherId,
        receiptId: record.recordId,
        status: "persisted",
        idempotencyStatus: appendResult.idempotencyStatus,
        appendSequence: appendResult.appendSequence,
        storagePolicy: "external-redacted-teaching-operation-append",
        storageWritePolicy: "external-append-only-operation-log",
        productionDatabaseAdapter: config.productionDatabaseAdapter,
        responsibleSession: "S12",
        redaction: createRedaction(),
      });
    } catch (error) {
      return createErrorResponse(error);
    }
  };
}

export function createExternalStorageTeachingOperationRollbackPostHandler(
  deps: ExternalStorageRouteDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function POST(
    request: Request,
    context: ExternalStorageRouteContext<{ teacherId: string; recordId: string }>,
  ) {
    try {
      const config = createExternalStorageRouteConfig(env);
      const unauthorized = authorizeExternalStorageRequest(request, config);
      if (unauthorized) {
        return unauthorized;
      }
      assertProductionDatabaseAdapterReadyForRollback(config);
      const params = await context.params;
      const teacherId = requireSafeId(params.teacherId, "teacher id");
      const recordId = requireSafeId(params.recordId, "teaching operation record id");
      const rollbackRequest = normalizeTeachingOperationRollbackRequest(
        await readJsonBody(request),
      );

      return jsonResponse(
        200,
        withProductionDatabaseAdapterEvidence(
          await rollbackTeachingOperation({
            dataDir: config.dataDir,
            teacherId,
            recordId,
            ...rollbackRequest,
          }),
          config,
        ),
      );
    } catch (error) {
      return createErrorResponse(error);
    }
  };
}

export function createExternalStorageTeachingOperationBackupPostHandler(
  deps: ExternalStorageRouteDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function POST(
    request: Request,
    context: ExternalStorageRouteContext<{ teacherId: string }>,
  ) {
    try {
      const config = createExternalStorageRouteConfig(env);
      const unauthorized = authorizeExternalStorageRequest(request, config);
      if (unauthorized) {
        return unauthorized;
      }
      assertProductionDatabaseAdapterReadyForBackupAndRestoreDrill(config);
      const params = await context.params;
      const teacherId = requireSafeId(params.teacherId, "teacher id");
      const backupRequest = normalizeTeachingOperationBackupRequest(
        await readJsonBody(request),
      );

      return jsonResponse(
        200,
        withProductionDatabaseAdapterEvidence(
          await createTeachingOperationBackup({
            dataDir: config.dataDir,
            teacherId,
            ...backupRequest,
          }),
          config,
        ),
      );
    } catch (error) {
      return createErrorResponse(error);
    }
  };
}

export function createExternalStorageTeachingOperationBackupRestoreDrillPostHandler(
  deps: ExternalStorageRouteDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function POST(
    request: Request,
    context: ExternalStorageRouteContext<{ teacherId: string; backupId: string }>,
  ) {
    try {
      const config = createExternalStorageRouteConfig(env);
      const unauthorized = authorizeExternalStorageRequest(request, config);
      if (unauthorized) {
        return unauthorized;
      }
      assertProductionDatabaseAdapterReadyForBackupAndRestoreDrill(config);
      const params = await context.params;
      const teacherId = requireSafeId(params.teacherId, "teacher id");
      const backupId = requireSafeId(params.backupId, "teaching operation backup id");
      const restoreDrillRequest = normalizeTeachingOperationRestoreDrillRequest(
        await readJsonBody(request),
      );

      return jsonResponse(
        200,
        withProductionDatabaseAdapterEvidence(
          await verifyTeachingOperationBackupRestoreDrill({
            dataDir: config.dataDir,
            teacherId,
            backupId,
            ...restoreDrillRequest,
          }),
          config,
        ),
      );
    } catch (error) {
      return createErrorResponse(error);
    }
  };
}

export function createExternalStorageTeachingOperationAuditGetHandler(
  deps: ExternalStorageRouteDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function GET(
    request: Request,
    context: ExternalStorageRouteContext<{ teacherId: string }>,
  ) {
    try {
      const config = createExternalStorageRouteConfig(env);
      const unauthorized = authorizeExternalStorageRequest(request, config);
      if (unauthorized) {
        return unauthorized;
      }
      const params = await context.params;
      const teacherId = requireSafeId(params.teacherId, "teacher id");
      assertProductionDatabaseAdapterReadyForAuditReadback(config);

      return jsonResponse(
        200,
        withProductionDatabaseAdapterEvidence(
          await listTeachingOperationAuditReadback(config.dataDir, teacherId),
          config,
        ),
      );
    } catch (error) {
      return createErrorResponse(error);
    }
  };
}

export function createExternalStorageTeachingOperationAuditAlertsGetHandler(
  deps: ExternalStorageRouteDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function GET(
    request: Request,
    context: ExternalStorageRouteContext<{ teacherId: string }>,
  ) {
    try {
      const config = createExternalStorageRouteConfig(env);
      const unauthorized = authorizeExternalStorageRequest(request, config);
      if (unauthorized) {
        return unauthorized;
      }
      const params = await context.params;
      const teacherId = requireSafeId(params.teacherId, "teacher id");
      assertProductionDatabaseAdapterReadyForAuditAlerts(config);

      return jsonResponse(
        200,
        withProductionDatabaseAdapterEvidence(
          await summarizeTeachingOperationAuditAlerts(config.dataDir, teacherId),
          config,
        ),
      );
    } catch (error) {
      return createErrorResponse(error);
    }
  };
}

export function createExternalStorageTeachingOperationAuditAlertNotificationsGetHandler(
  deps: ExternalStorageRouteDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function GET(
    request: Request,
    context: ExternalStorageRouteContext<{ teacherId: string }>,
  ) {
    try {
      const config = createExternalStorageRouteConfig(env);
      const unauthorized = authorizeExternalStorageRequest(request, config);
      if (unauthorized) {
        return unauthorized;
      }
      const params = await context.params;
      const teacherId = requireSafeId(params.teacherId, "teacher id");
      assertProductionDatabaseAdapterReadyForAuditAlertNotifications(config);

      return jsonResponse(
        200,
        withProductionDatabaseAdapterEvidence(
          await listTeachingOperationAlertNotifications(config.dataDir, teacherId),
          config,
        ),
      );
    } catch (error) {
      return createErrorResponse(error);
    }
  };
}

export function createExternalStorageTeachingOperationAuditAlertNotificationsPostHandler(
  deps: ExternalStorageRouteDeps = {},
) {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetch ?? fetch;

  return async function POST(
    request: Request,
    context: ExternalStorageRouteContext<{ teacherId: string }>,
  ) {
    try {
      const config = createExternalStorageRouteConfig(env);
      const unauthorized = authorizeExternalStorageRequest(request, config);
      if (unauthorized) {
        return unauthorized;
      }
      const params = await context.params;
      const teacherId = requireSafeId(params.teacherId, "teacher id");
      assertProductionDatabaseAdapterReadyForAuditAlertNotifications(config);
      const notificationRequest = normalizeAlertNotificationRequest(
        await readJsonBody(request),
      );

      return jsonResponse(
        200,
        withProductionDatabaseAdapterEvidence(
          await enqueueTeachingOperationAlertNotifications({
            dataDir: config.dataDir,
            teacherId,
            adminAlertWebhook: config.adminAlertWebhook,
            fetch: fetchImpl,
            ...notificationRequest,
          }),
          config,
        ),
      );
    } catch (error) {
      return createErrorResponse(error);
    }
  };
}

export function createExternalStorageLifecycleAuditGetHandler(
  deps: ExternalStorageRouteDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function GET(request: Request) {
    try {
      const config = createExternalStorageRouteConfig(env);
      const unauthorized = authorizeExternalStorageRequest(request, config);
      if (unauthorized) {
        return unauthorized;
      }
      return jsonResponse(200, await listLifecycleAuditEvents(config.dataDir));
    } catch (error) {
      return createErrorResponse(error);
    }
  };
}

export function createExternalStorageLifecycleAuditPostHandler(
  deps: ExternalStorageRouteDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function POST(request: Request) {
    try {
      const config = createExternalStorageRouteConfig(env);
      const unauthorized = authorizeExternalStorageRequest(request, config);
      if (unauthorized) {
        return unauthorized;
      }
      const event = normalizeLifecycleAuditEvent(await readJsonBody(request));
      await appendLifecycleAuditEvent({ dataDir: config.dataDir, event });

      return jsonResponse(200, {
        eventId: event.eventId,
        provider: "qwen",
        providerRole: "voice-clone",
        action: "voice-clone-revoke",
        status: "recorded",
        storagePolicy: "append-only-redacted-lifecycle-audit",
        responsibleSession: "S12/S24",
        redaction: createRedaction(),
      });
    } catch (error) {
      return createErrorResponse(error);
    }
  };
}

function createExternalStorageRouteConfig(
  env: Record<string, string | undefined>,
): ExternalStorageRouteConfig {
  const serviceMode =
    env.UAIS_EXTERNAL_STORAGE_SERVICE_MODE?.trim() === "production"
      ? "production"
      : "reference";
  const accessToken = env.UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN?.trim();
  const accessTokenStatus = classifyAccessToken(accessToken, serviceMode);
  const configuredDataDir = env.UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR?.trim();
  const adminAlertWebhookUrl =
    env.UAIS_EXTERNAL_STORAGE_ADMIN_ALERT_WEBHOOK_URL?.trim();
  const adminAlertWebhookToken =
    env.UAIS_EXTERNAL_STORAGE_ADMIN_ALERT_WEBHOOK_TOKEN?.trim();

  return {
    dataDir: configuredDataDir
      ? resolve(/*turbopackIgnore: true*/ configuredDataDir)
      : createDefaultExternalStorageRouteDataDir(),
    ...(accessToken ? { accessToken } : {}),
    ...(adminAlertWebhookUrl
      ? {
          adminAlertWebhook: {
            url: normalizeAdminAlertWebhookUrl(adminAlertWebhookUrl),
            ...(adminAlertWebhookToken
              ? { token: adminAlertWebhookToken }
              : {}),
          },
        }
      : {}),
    accessTokenStatus,
    serviceMode,
    serviceTarget:
      serviceMode === "production"
        ? "uais-external-storage-production-service"
        : "uais-external-storage-reference-service",
    productionDatabaseAdapter: createProductionDatabaseAdapterProofFromEnv({
      env,
      serviceMode,
    }),
  };
}

function createProductionDatabaseAdapterProofFromEnv(input: {
  env: Record<string, string | undefined>;
  serviceMode: ExternalStorageServiceMode;
}): ExternalStorageProductionDatabaseAdapterProof {
  if (input.serviceMode !== "production") {
    return createBlockedProductionDatabaseAdapter();
  }
  const adapter: ExternalStorageProductionDatabaseAdapterProof = {
    status: "ready",
    providerClass:
      input.env.UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS ?? "",
    migrationStatus:
      input.env.UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS ?? "",
    backupPolicy:
      input.env.UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY ?? "",
    concurrencyControl:
      input.env.UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL ?? "",
    valueRedacted: true,
  };
  return isProductionDatabaseAdapterReady(adapter)
    ? adapter
    : createBlockedProductionDatabaseAdapter();
}

function isProductionDatabaseAdapterReady(
  adapter: ExternalStorageProductionDatabaseAdapterProof,
) {
  return (
    adapter.status === "ready" &&
    adapter.providerClass === "managed-database" &&
    adapter.migrationStatus === "up-to-date" &&
    adapter.backupPolicy === "point-in-time-restore" &&
    adapter.concurrencyControl === "transactional" &&
    adapter.valueRedacted === true
  );
}

function assertProductionDatabaseAdapterReadyForAppend(
  config: ExternalStorageRouteConfig,
) {
  if (
    config.serviceMode === "production" &&
    !isProductionDatabaseAdapterReady(config.productionDatabaseAdapter)
  ) {
    throw new HttpError(
      503,
      "Production external storage append requires ready managed database adapter proof.",
    );
  }
}

function assertProductionDatabaseAdapterReadyForSnapshotReplace(
  config: ExternalStorageRouteConfig,
) {
  if (
    config.serviceMode === "production" &&
    !isProductionDatabaseAdapterReady(config.productionDatabaseAdapter)
  ) {
    throw new HttpError(
      503,
      "Production external storage snapshot replace requires ready managed database adapter proof.",
    );
  }
}

function assertProductionDatabaseAdapterReadyForSnapshotReadback(
  config: ExternalStorageRouteConfig,
) {
  if (
    config.serviceMode === "production" &&
    !isProductionDatabaseAdapterReady(config.productionDatabaseAdapter)
  ) {
    throw new HttpError(
      503,
      "Production external storage snapshot readback requires ready managed database adapter proof.",
    );
  }
}

function assertProductionDatabaseAdapterReadyForBackupAndRestoreDrill(
  config: ExternalStorageRouteConfig,
) {
  if (
    config.serviceMode === "production" &&
    !isProductionDatabaseAdapterReady(config.productionDatabaseAdapter)
  ) {
    throw new HttpError(
      503,
      "Production external storage backup and restore drill require ready managed database adapter proof.",
    );
  }
}

function assertProductionDatabaseAdapterReadyForRollback(
  config: ExternalStorageRouteConfig,
) {
  if (
    config.serviceMode === "production" &&
    !isProductionDatabaseAdapterReady(config.productionDatabaseAdapter)
  ) {
    throw new HttpError(
      503,
      "Production external storage rollback requires ready managed database adapter proof.",
    );
  }
}

function assertProductionDatabaseAdapterReadyForAuditReadback(
  config: ExternalStorageRouteConfig,
) {
  if (
    config.serviceMode === "production" &&
    !isProductionDatabaseAdapterReady(config.productionDatabaseAdapter)
  ) {
    throw new HttpError(
      503,
      "Production external storage audit readback requires ready managed database adapter proof.",
    );
  }
}

function assertProductionDatabaseAdapterReadyForAuditAlerts(
  config: ExternalStorageRouteConfig,
) {
  if (
    config.serviceMode === "production" &&
    !isProductionDatabaseAdapterReady(config.productionDatabaseAdapter)
  ) {
    throw new HttpError(
      503,
      "Production external storage audit alerts require ready managed database adapter proof.",
    );
  }
}

function assertProductionDatabaseAdapterReadyForAuditAlertNotifications(
  config: ExternalStorageRouteConfig,
) {
  if (
    config.serviceMode === "production" &&
    !isProductionDatabaseAdapterReady(config.productionDatabaseAdapter)
  ) {
    throw new HttpError(
      503,
      "Production external storage audit alert notifications require ready managed database adapter proof.",
    );
  }
}

function withProductionDatabaseAdapterEvidence<T extends Record<string, unknown>>(
  value: T,
  config: ExternalStorageRouteConfig,
) {
  return {
    ...value,
    productionDatabaseAdapter: config.productionDatabaseAdapter,
  };
}

function normalizeAdminAlertWebhookUrl(value: string) {
  try {
    const parsed = new URL(value);
    const isLocalHttp =
      parsed.protocol === "http:" &&
      (parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "localhost" ||
        parsed.hostname === "::1");
    if (parsed.protocol !== "https:" && !isLocalHttp) {
      throw new Error("Admin alert webhook must use HTTPS unless it is localhost.");
    }
    return parsed.toString();
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(error.message);
    }
    throw new Error("Admin alert webhook URL is invalid.");
  }
}

function classifyAccessToken(
  token: string | undefined,
  serviceMode: ExternalStorageServiceMode,
): ExternalStorageRouteConfig["accessTokenStatus"] {
  if (!token) {
    return "missing";
  }
  return serviceMode === "production" && token.length < minProductionAccessTokenLength
    ? "weak"
    : "present";
}

function createDefaultExternalStorageRouteDataDir() {
  return join(
    /*turbopackIgnore: true*/ process.cwd(),
    ".tmp",
    "uais-external-storage-service",
  );
}

function authorizeExternalStorageRequest(
  request: Request,
  config: ExternalStorageRouteConfig,
) {
  if (config.accessTokenStatus !== "present" || !config.accessToken) {
    return jsonResponse(503, {
      error: "External storage service access token is not configured.",
      redaction: createRedaction(),
    });
  }
  const header = request.headers.get("authorization");
  const prefix = "Bearer ";
  if (!header?.startsWith(prefix)) {
    return jsonResponse(401, {
      error: "External storage authorization is required.",
      redaction: createRedaction(),
    });
  }
  const actual = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(config.accessToken);
  const authorized =
    actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
  if (!authorized) {
    return jsonResponse(401, {
      error: "External storage authorization is required.",
      redaction: createRedaction(),
    });
  }
  return undefined;
}

async function probeDurableBackingStore(dataDir: string) {
  try {
    const probeDir = resolve(dataDir, ".health-probes");
    ensureWithinBase(dataDir, probeDir);
    await mkdir(probeDir, { recursive: true });
    const probePath = resolve(probeDir, `${randomUUID()}.json`);
    ensureWithinBase(dataDir, probePath);
    const probePayload = JSON.stringify({
      target: "uais-external-storage-health-probe",
      value: "redacted",
    });
    await writeFile(probePath, probePayload, { encoding: "utf8", flag: "wx" });
    const persistedProbe = await readFile(probePath, "utf8");
    await rm(probePath, { force: true });
    return {
      status: persistedProbe === probePayload ? "ready" : "blocked",
      storageMode: "file-backed",
      probe: "write-read-delete",
      ownershipWritePolicy: "external-atomic-merge",
      lifecycleAuditWritePolicy: "append-only-redacted-lifecycle-audit",
      valueRedacted: true,
    };
  } catch {
    return {
      status: "blocked",
      storageMode: "file-backed",
      probe: "write-read-delete",
      ownershipWritePolicy: "external-atomic-merge",
      lifecycleAuditWritePolicy: "append-only-redacted-lifecycle-audit",
      valueRedacted: true,
    };
  }
}

function createTeachingOperationsStorageSchema(
  ready: boolean,
  productionDatabaseAdapter = createBlockedProductionDatabaseAdapter(),
) {
  return {
    status: ready ? "ready" : "blocked",
    schemaVersion: "uais-teaching-operations-v1",
    migrationStatus: ready ? "up-to-date" : "blocked",
    operationLedger: "jsonl-append-only",
    auditLedger: "jsonl-append-only",
    rollbackLedger: "jsonl-append-only",
    backupStore: "json-atomic-snapshot",
    restoreDrillLog: "jsonl-append-only",
    concurrencyControl: "atomic-append-and-rename",
    productionDatabaseAdapter,
    valueRedacted: true,
  };
}

// Declares which learning-chatroom schema versions this service speaks, so a
// deployment can be checked for compatibility BEFORE the first write instead of
// discovering it as a rejected round. The app always emits v2 and the shared
// normalizer still accepts v1; a service built from older code simply will not
// carry this field, which is itself the signal that it predates v2.
function createLearningChatroomStorageSchema(
  ready: boolean,
  productionDatabaseAdapter = createBlockedProductionDatabaseAdapter(),
) {
  return {
    status: ready ? "ready" : "blocked",
    transcripts: {
      schemaVersion: learningChatroomTranscriptSchemaVersion,
      acceptedSchemaVersions: [
        learningChatroomTranscriptSchemaVersion,
        learningChatroomTranscriptLegacySchemaVersion,
      ],
    },
    shares: {
      schemaVersion: learningChatroomShareSchemaVersion,
      acceptedSchemaVersions: [learningChatroomShareSchemaVersion],
    },
    snapshotStore: "json-atomic-snapshot",
    revisionControl: "optimistic-revision",
    concurrencyControl: "atomic-rename-with-revision-check",
    productionDatabaseAdapter,
    valueRedacted: true,
  };
}

function createTeachingCourseManagementStorageSchema(
  ready: boolean,
  productionDatabaseAdapter = createBlockedProductionDatabaseAdapter(),
) {
  return {
    status: ready ? "ready" : "blocked",
    schemaVersion: "uais-teaching-course-management-v1",
    migrationStatus: ready ? "up-to-date" : "blocked",
    snapshotStore: "json-atomic-snapshot",
    auditLog: "jsonl-append-only",
    backupStore: "json-atomic-snapshot",
    restoreDrillLog: "jsonl-append-only",
    revisionControl: "optimistic-revision",
    concurrencyControl: "atomic-rename-with-revision-check",
    productionDatabaseAdapter,
    valueRedacted: true,
  };
}

function createTeachingCourseAssetsStorageSchema(
  ready: boolean,
  productionDatabaseAdapter = createBlockedProductionDatabaseAdapter(),
) {
  return {
    status: ready ? "ready" : "blocked",
    schemaVersion: "uais-teaching-course-assets-v1",
    migrationStatus: ready ? "up-to-date" : "blocked",
    snapshotStore: "json-atomic-snapshot",
    auditLog: "jsonl-append-only",
    backupStore: "json-atomic-snapshot",
    restoreDrillLog: "jsonl-append-only",
    revisionControl: "optimistic-revision",
    concurrencyControl: "atomic-rename-with-revision-check",
    productionDatabaseAdapter,
    valueRedacted: true,
  };
}

function createBlockedProductionDatabaseAdapter(): ExternalStorageProductionDatabaseAdapterProof {
  return {
    status: "blocked",
    providerClass: "not-configured",
    migrationStatus: "blocked",
    backupPolicy: "not-configured",
    concurrencyControl: "blocked",
    valueRedacted: true,
  };
}


function mergeOwnership(
  existing: UaisTeacherAiResourceOwnership | undefined,
  incoming: UaisTeacherAiResourceOwnership,
): UaisTeacherAiResourceOwnership {
  if (!existing) {
    return incoming;
  }
  if (existing.teacherId !== incoming.teacherId) {
    throw new HttpError(
      400,
      "Teacher AI ownership records cannot be merged across teachers.",
    );
  }
  return {
    teacherId: incoming.teacherId,
    courseIds: mergeIdList(existing.courseIds, incoming.courseIds),
    sampleAssets: mergeById(existing.sampleAssets, incoming.sampleAssets, "sampleAssetId"),
    pptAssets: mergeById(existing.pptAssets, incoming.pptAssets, "pptAssetId"),
    clonedVoiceRefs: mergeById(
      existing.clonedVoiceRefs,
      incoming.clonedVoiceRefs,
      "voiceRefId",
    ),
    audioManifests: mergeById(
      existing.audioManifests,
      incoming.audioManifests,
      "audioManifestId",
    ),
  };
}

async function readJsonBody(request: Request) {
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBodyBytes) {
    throw new HttpError(413, "Request body is too large.");
  }
  if (!text.trim()) {
    throw new HttpError(400, "Request body is required.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Request body must be JSON.");
  }
}


function createProductionServiceIdentity(config: ExternalStorageRouteConfig) {
  return {
    status: config.serviceMode === "production" ? "proved" : "not-production",
    serviceMode: config.serviceMode,
    serviceTarget: config.serviceTarget,
    valueRedacted: true,
  };
}
