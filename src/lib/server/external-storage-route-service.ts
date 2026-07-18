import { createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { UaisTeacherAiResourceOwnership } from "@/lib/server/ai-resource-grants";
import type { UaisAiActorRole } from "@/lib/server/ai-access-control";
import {
  normalizeTeachingCourseManagementDatabase,
  type TeachingCourseManagementDatabase,
} from "@/lib/server/teaching-course-management-store";
import {
  normalizeTeachingCourseAssetsDatabase,
  type TeachingCourseAssetsDatabase,
} from "@/lib/server/teaching-course-assets-store";
import { HttpError } from "./external-storage-http-error";
import {
  createErrorResponse,
  createRedaction,
  formatTimestampId,
  isPositiveInteger,
  isRecord,
  jsonResponse,
  mergeById,
  mergeIdList,
  requireSafeId,
} from "./external-storage-route-guards";
import {
  countTeachingCourseAssetsBackupSnapshot,
  countTeachingCourseManagementBackupSnapshot,
  countTeachingOperationBackupSnapshot,
  createEmptyTeachingCourseAssetsDatabase,
  createEmptyTeachingCourseManagementDatabase,
  createTeachingCourseAssetsBackupReceipt,
  createTeachingCourseAssetsRevision,
  createTeachingCourseAssetsSnapshot,
  createTeachingCourseManagementBackupReceipt,
  createTeachingCourseManagementRevision,
  createTeachingCourseManagementSnapshot,
  normalizeAlertNotificationRequest,
  normalizeLifecycleAuditEvent,
  normalizeOwnership,
  normalizeTeachingCourseAssetsBackup,
  normalizeTeachingCourseAssetsBackupRequest,
  normalizeTeachingCourseAssetsRestoreDrill,
  normalizeTeachingCourseAssetsRestoreDrillRequest,
  normalizeTeachingCourseManagementBackup,
  normalizeTeachingCourseManagementBackupRequest,
  normalizeTeachingCourseManagementRestoreDrill,
  normalizeTeachingCourseManagementRestoreDrillRequest,
  normalizeTeachingOperationAlertNotification,
  normalizeTeachingOperationAlertWebhookDelivery,
  normalizeTeachingOperationAuditEvent,
  normalizeTeachingOperationAuditLedgerEntry,
  normalizeTeachingOperationBackup,
  normalizeTeachingOperationBackupRequest,
  normalizeTeachingOperationRecord,
  normalizeTeachingOperationRestoreDrill,
  normalizeTeachingOperationRestoreDrillRequest,
  normalizeTeachingOperationRollbackLedgerEntry,
  normalizeTeachingOperationRollbackRecord,
  normalizeTeachingOperationRollbackRequest,
  type QwenVoiceLifecycleAuditEvent,
} from "./external-storage-serialization";
import {
  ensureWithinBase,
  resolveLifecycleAuditPath,
  resolveTeacherOwnershipPath,
  resolveTeachingCourseAssetsBackupPath,
  resolveTeachingCourseAssetsRestoreDrillLogPath,
  resolveTeachingCourseAssetsSnapshotPath,
  resolveTeachingCourseManagementBackupPath,
  resolveTeachingCourseManagementRestoreDrillLogPath,
  resolveTeachingCourseManagementSnapshotPath,
  resolveTeachingOperationAlertNotificationLogPath,
  resolveTeachingOperationAlertWebhookDeliveryLogPath,
  resolveTeachingOperationAuditLogPath,
  resolveTeachingOperationBackupPath,
  resolveTeachingOperationLogPath,
  resolveTeachingOperationRestoreDrillLogPath,
  resolveTeachingOperationRollbackLogPath,
} from "./external-storage-route-paths";

const externalStorageApiContractVersion = "uais-external-storage-v1";
const maxBodyBytes = 1_000_000;
const minProductionAccessTokenLength = 32;
const teachingOperationAppendWriteQueues = new Map<string, Promise<void>>();

type ExternalStorageServiceMode = "reference" | "production";

type ExternalStorageRouteConfig = {
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

async function readTeacherOwnership(input: {
  dataDir: string;
  teacherId: string;
}) {
  const filePath = resolveTeacherOwnershipPath(input.dataDir, input.teacherId);
  const raw = await readFile(filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  if (!raw) {
    return undefined;
  }
  const ownership = normalizeOwnership(JSON.parse(raw));
  if (ownership.teacherId !== input.teacherId) {
    throw new Error("Stored teacher AI ownership record id mismatch.");
  }
  return ownership;
}

async function writeTeacherOwnership(input: {
  dataDir: string;
  ownership: UaisTeacherAiResourceOwnership;
}) {
  const normalized = normalizeOwnership(input.ownership);
  const ownershipDir = resolve(input.dataDir, "teacher-ai-ownership");
  ensureWithinBase(input.dataDir, ownershipDir);
  await mkdir(ownershipDir, { recursive: true });
  const filePath = resolveTeacherOwnershipPath(input.dataDir, normalized.teacherId);
  const tempPath = resolve(
    ownershipDir,
    `.${normalized.teacherId}.${Date.now()}.${randomUUID()}.tmp`,
  );
  ensureWithinBase(input.dataDir, tempPath);

  try {
    await writeFile(tempPath, JSON.stringify(normalized, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readTeachingCourseManagementSnapshot(dataDir: string) {
  const filePath = resolveTeachingCourseManagementSnapshotPath(dataDir);
  const raw = await readFile(filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  if (!raw) {
    return createTeachingCourseManagementSnapshot(createEmptyTeachingCourseManagementDatabase());
  }
  const value = JSON.parse(raw) as {
    database?: unknown;
    revision?: unknown;
  };
  const database = normalizeTeachingCourseManagementDatabase(value.database);
  const revision =
    typeof value.revision === "string" && value.revision.trim()
      ? value.revision
      : createTeachingCourseManagementRevision(database);
  return createTeachingCourseManagementSnapshot(database, revision);
}

async function replaceTeachingCourseManagementSnapshot(input: {
  dataDir: string;
  expectedRevision: string;
  database: TeachingCourseManagementDatabase;
}) {
  const current = await readTeachingCourseManagementSnapshot(input.dataDir);
  if (current.revision !== input.expectedRevision) {
    throw new HttpError(409, "Teaching course management snapshot revision mismatch.");
  }

  const snapshot = createTeachingCourseManagementSnapshot(input.database);
  const snapshotDir = resolve(input.dataDir, "teaching-course-management");
  ensureWithinBase(input.dataDir, snapshotDir);
  await mkdir(snapshotDir, { recursive: true });
  const filePath = resolveTeachingCourseManagementSnapshotPath(input.dataDir);
  const tempPath = resolve(
    snapshotDir,
    `.database.${Date.now()}.${randomUUID()}.tmp`,
  );
  ensureWithinBase(input.dataDir, tempPath);
  try {
    await writeFile(tempPath, JSON.stringify(snapshot, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }

  return {
    status: "persisted",
    revision: snapshot.revision,
    storagePolicy: "external-redacted-teaching-course-management-snapshot",
    storageWritePolicy: "external-optimistic-snapshot-replace",
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

async function readTeachingCourseAssetsSnapshot(dataDir: string) {
  const filePath = resolveTeachingCourseAssetsSnapshotPath(dataDir);
  const raw = await readFile(filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  if (!raw) {
    return createTeachingCourseAssetsSnapshot(createEmptyTeachingCourseAssetsDatabase(), "rev-empty");
  }

  const value = JSON.parse(raw) as { database?: unknown; revision?: unknown };
  const database = normalizeTeachingCourseAssetsDatabase(value.database);
  const revision =
    typeof value.revision === "string" && value.revision.trim()
      ? value.revision
      : createTeachingCourseAssetsRevision(database);
  return createTeachingCourseAssetsSnapshot(database, revision);
}

async function replaceTeachingCourseAssetsSnapshot(input: {
  dataDir: string;
  expectedRevision: string;
  database: TeachingCourseAssetsDatabase;
}) {
  const current = await readTeachingCourseAssetsSnapshot(input.dataDir);
  if (current.revision !== input.expectedRevision) {
    throw new HttpError(409, "Teaching course assets snapshot revision mismatch.");
  }

  const snapshot = createTeachingCourseAssetsSnapshot(input.database);
  const snapshotDir = resolve(input.dataDir, "teaching-course-assets");
  ensureWithinBase(input.dataDir, snapshotDir);
  await mkdir(snapshotDir, { recursive: true });
  const filePath = resolveTeachingCourseAssetsSnapshotPath(input.dataDir);
  const tempPath = resolve(
    snapshotDir,
    `.database.${Date.now()}.${randomUUID()}.tmp`,
  );
  ensureWithinBase(input.dataDir, tempPath);
  try {
    await writeFile(tempPath, JSON.stringify(snapshot, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }

  return {
    status: "persisted",
    revision: snapshot.revision,
    storagePolicy: "external-redacted-teaching-course-cover-assets",
    storageWritePolicy: "external-optimistic-snapshot-replace",
    responsibleSession: "S12" as const,
    redaction: createRedaction(),
  };
}


async function createTeachingCourseManagementBackup(input: {
  dataDir: string;
  requestedBy: string;
  requestedAt: string;
  traceId: string;
}) {
  const snapshot = await readTeachingCourseManagementSnapshot(input.dataDir);
  const sourceRecordCounts = countTeachingCourseManagementBackupSnapshot(snapshot);
  const backupId = requireSafeId(
    `teaching-course-management-backup-${formatTimestampId(input.requestedAt)}`,
    "teaching course management backup id",
  );
  const backup = normalizeTeachingCourseManagementBackup({
    backupId,
    status: "persisted",
    eventType: "teaching-course-management-backup.created",
    traceId: input.traceId,
    requestedBy: input.requestedBy,
    requestedAt: input.requestedAt,
    sourceRecordCounts,
    snapshot,
    storagePolicy: "external-redacted-teaching-course-management-backup",
    storageWritePolicy: "external-atomic-backup-snapshot",
    responsibleSession: "S12",
    redaction: createRedaction(),
  });
  await writeTeachingCourseManagementBackup({
    dataDir: input.dataDir,
    backup,
  });

  return createTeachingCourseManagementBackupReceipt(backup);
}

async function verifyTeachingCourseManagementBackupRestoreDrill(input: {
  dataDir: string;
  backupId: string;
  requestedBy: string;
  requestedAt: string;
  traceId: string;
}) {
  const backup = await readTeachingCourseManagementBackup({
    dataDir: input.dataDir,
    backupId: input.backupId,
  });
  if (!backup) {
    throw new HttpError(404, "Teaching course management backup was not found.");
  }
  const drill = normalizeTeachingCourseManagementRestoreDrill({
    backupId: input.backupId,
    drillId: requireSafeId(
      `teaching-course-management-restore-drill-${input.backupId}`,
      "teaching course management restore drill id",
    ),
    status: "verified",
    eventType: "teaching-course-management-backup.restore-drill-verified",
    traceId: input.traceId,
    requestedBy: input.requestedBy,
    requestedAt: input.requestedAt,
    restoredRecordCounts: countTeachingCourseManagementBackupSnapshot(backup.snapshot),
    storagePolicy: "external-redacted-teaching-course-management-restore-drill",
    storageWritePolicy: "external-append-only-restore-drill-log",
    responsibleSession: "S12",
    redaction: createRedaction(),
  });
  await appendTeachingCourseManagementRestoreDrill({
    dataDir: input.dataDir,
    drill,
  });
  return drill;
}

async function createTeachingCourseAssetsBackup(input: {
  dataDir: string;
  requestedBy: string;
  requestedAt: string;
  traceId: string;
}) {
  const snapshot = await readTeachingCourseAssetsSnapshot(input.dataDir);
  const sourceRecordCounts = countTeachingCourseAssetsBackupSnapshot(snapshot);
  const backupId = requireSafeId(
    `teaching-course-assets-backup-${formatTimestampId(input.requestedAt)}`,
    "teaching course assets backup id",
  );
  const backup = normalizeTeachingCourseAssetsBackup({
    backupId,
    status: "persisted",
    eventType: "teaching-course-assets-backup.created",
    traceId: input.traceId,
    requestedBy: input.requestedBy,
    requestedAt: input.requestedAt,
    sourceRecordCounts,
    snapshot,
    storagePolicy: "external-redacted-teaching-course-assets-backup",
    storageWritePolicy: "external-atomic-backup-snapshot",
    responsibleSession: "S12",
    redaction: createRedaction(),
  });
  await writeTeachingCourseAssetsBackup({
    dataDir: input.dataDir,
    backup,
  });

  return createTeachingCourseAssetsBackupReceipt(backup);
}

async function verifyTeachingCourseAssetsBackupRestoreDrill(input: {
  dataDir: string;
  backupId: string;
  requestedBy: string;
  requestedAt: string;
  traceId: string;
}) {
  const backup = await readTeachingCourseAssetsBackup({
    dataDir: input.dataDir,
    backupId: input.backupId,
  });
  if (!backup) {
    throw new HttpError(404, "Teaching course assets backup was not found.");
  }
  const drill = normalizeTeachingCourseAssetsRestoreDrill({
    backupId: input.backupId,
    drillId: requireSafeId(
      `teaching-course-assets-restore-drill-${input.backupId}`,
      "teaching course assets restore drill id",
    ),
    status: "verified",
    eventType: "teaching-course-assets-backup.restore-drill-verified",
    traceId: input.traceId,
    requestedBy: input.requestedBy,
    requestedAt: input.requestedAt,
    restoredRecordCounts: countTeachingCourseAssetsBackupSnapshot(backup.snapshot),
    storagePolicy: "external-redacted-teaching-course-assets-restore-drill",
    storageWritePolicy: "external-append-only-restore-drill-log",
    responsibleSession: "S12",
    redaction: createRedaction(),
  });
  await appendTeachingCourseAssetsRestoreDrill({
    dataDir: input.dataDir,
    drill,
  });
  return drill;
}

async function writeTeachingCourseManagementBackup(input: {
  dataDir: string;
  backup: ReturnType<typeof normalizeTeachingCourseManagementBackup>;
}) {
  const backupDir = resolve(input.dataDir, "teaching-course-management-backups");
  ensureWithinBase(input.dataDir, backupDir);
  await mkdir(backupDir, { recursive: true });
  const filePath = resolveTeachingCourseManagementBackupPath(
    input.dataDir,
    input.backup.backupId,
  );
  const tempPath = resolve(
    backupDir,
    `.${input.backup.backupId}.${Date.now()}.${randomUUID()}.tmp`,
  );
  ensureWithinBase(input.dataDir, tempPath);
  try {
    await writeFile(tempPath, JSON.stringify(input.backup, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readTeachingCourseManagementBackup(input: {
  dataDir: string;
  backupId: string;
}) {
  const backupPath = resolveTeachingCourseManagementBackupPath(
    input.dataDir,
    input.backupId,
  );
  const raw = await readFile(backupPath, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    },
  );
  if (!raw) {
    return undefined;
  }
  const backup = normalizeTeachingCourseManagementBackup(JSON.parse(raw));
  if (backup.backupId !== input.backupId) {
    throw new Error("Stored teaching course management backup id mismatch.");
  }
  return backup;
}

async function appendTeachingCourseManagementRestoreDrill(input: {
  dataDir: string;
  drill: ReturnType<typeof normalizeTeachingCourseManagementRestoreDrill>;
}) {
  const normalizedDrill = normalizeTeachingCourseManagementRestoreDrill(input.drill);
  await mkdir(input.dataDir, { recursive: true });
  await appendFile(
    resolveTeachingCourseManagementRestoreDrillLogPath(input.dataDir),
    `${JSON.stringify(normalizedDrill)}\n`,
    "utf8",
  );
}

async function writeTeachingCourseAssetsBackup(input: {
  dataDir: string;
  backup: ReturnType<typeof normalizeTeachingCourseAssetsBackup>;
}) {
  const backupDir = resolve(input.dataDir, "teaching-course-assets-backups");
  ensureWithinBase(input.dataDir, backupDir);
  await mkdir(backupDir, { recursive: true });
  const filePath = resolveTeachingCourseAssetsBackupPath(
    input.dataDir,
    input.backup.backupId,
  );
  const tempPath = resolve(
    backupDir,
    `.${input.backup.backupId}.${Date.now()}.${randomUUID()}.tmp`,
  );
  ensureWithinBase(input.dataDir, tempPath);
  try {
    await writeFile(tempPath, JSON.stringify(input.backup, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readTeachingCourseAssetsBackup(input: {
  dataDir: string;
  backupId: string;
}) {
  const backupPath = resolveTeachingCourseAssetsBackupPath(
    input.dataDir,
    input.backupId,
  );
  const raw = await readFile(backupPath, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    },
  );
  if (!raw) {
    return undefined;
  }
  const backup = normalizeTeachingCourseAssetsBackup(JSON.parse(raw));
  if (backup.backupId !== input.backupId) {
    throw new Error("Stored teaching course assets backup id mismatch.");
  }
  return backup;
}

async function appendTeachingCourseAssetsRestoreDrill(input: {
  dataDir: string;
  drill: ReturnType<typeof normalizeTeachingCourseAssetsRestoreDrill>;
}) {
  const normalizedDrill = normalizeTeachingCourseAssetsRestoreDrill(input.drill);
  await mkdir(input.dataDir, { recursive: true });
  await appendFile(
    resolveTeachingCourseAssetsRestoreDrillLogPath(input.dataDir),
    `${JSON.stringify(normalizedDrill)}\n`,
    "utf8",
  );
}

async function appendLifecycleAuditEvent(input: {
  dataDir: string;
  event: QwenVoiceLifecycleAuditEvent;
}) {
  await mkdir(input.dataDir, { recursive: true });
  await appendFile(
    resolveLifecycleAuditPath(input.dataDir),
    `${JSON.stringify(input.event)}\n`,
    "utf8",
  );
}

async function appendTeachingOperation(input: {
  dataDir: string;
  teacherId: string;
  record: ReturnType<typeof normalizeTeachingOperationRecord>;
  auditEvent?: ReturnType<typeof normalizeTeachingOperationAuditEvent>;
}) {
  const operationLogPath = resolveTeachingOperationLogPath(input.dataDir, input.teacherId);
  return runWithTeachingOperationAppendWriteLock(operationLogPath, async () => {
    const existingRecords = await listTeachingOperationRecords(input.dataDir, input.teacherId);
    const existingRecordIndex = existingRecords.findIndex(
      (record) => record.recordId === input.record.recordId,
    );
    const existingRecord =
      existingRecordIndex >= 0 ? existingRecords[existingRecordIndex] : undefined;
    if (existingRecord) {
      if (areTeachingOperationRecordsEquivalent(existingRecord, input.record)) {
        return {
          idempotencyStatus: "already-persisted" as const,
          appendSequence: existingRecordIndex + 1,
        };
      }
      throw new HttpError(409, "Teaching operation record id already exists.");
    }

    const appendSequence = existingRecords.length + 1;
    const operationDir = resolve(input.dataDir, "teaching-operations");
    ensureWithinBase(input.dataDir, operationDir);
    await mkdir(operationDir, { recursive: true });
    await appendFile(
      operationLogPath,
      `${JSON.stringify({
        record: input.record,
        ...(input.auditEvent ? { auditEvent: input.auditEvent } : {}),
        appendSequence,
        storagePolicy: "external-redacted-teaching-operation-append",
        storageWritePolicy: "external-append-only-operation-log",
        responsibleSession: "S12",
        redaction: createRedaction(),
      })}\n`,
      "utf8",
    );
    if (input.auditEvent) {
      await appendTeachingOperationAuditEvent({
        dataDir: input.dataDir,
        teacherId: input.teacherId,
        auditEvent: input.auditEvent,
      });
    }
    return { idempotencyStatus: "created" as const, appendSequence };
  });
}

async function runWithTeachingOperationAppendWriteLock<T>(
  operationLogPath: string,
  action: () => Promise<T>,
): Promise<T> {
  const previous =
    teachingOperationAppendWriteQueues.get(operationLogPath) ?? Promise.resolve();
  let releaseCurrent: () => void = () => undefined;
  const current = new Promise<void>((resolveCurrent) => {
    releaseCurrent = resolveCurrent;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  teachingOperationAppendWriteQueues.set(operationLogPath, queued);

  await previous.catch(() => undefined);
  try {
    return await action();
  } finally {
    releaseCurrent();
    if (teachingOperationAppendWriteQueues.get(operationLogPath) === queued) {
      teachingOperationAppendWriteQueues.delete(operationLogPath);
    }
  }
}

function areTeachingOperationRecordsEquivalent(
  left: ReturnType<typeof normalizeTeachingOperationRecord> & { appendSequence?: number },
  right: ReturnType<typeof normalizeTeachingOperationRecord> & { appendSequence?: number },
) {
  return (
    JSON.stringify(stripTeachingOperationAppendSequence(left)) ===
    JSON.stringify(stripTeachingOperationAppendSequence(right))
  );
}

function stripTeachingOperationAppendSequence<T extends { appendSequence?: number }>(
  record: T,
) {
  const rest = { ...record };
  delete rest.appendSequence;
  return rest;
}

async function createTeachingOperationBackup(input: {
  dataDir: string;
  teacherId: string;
  requestedBy: string;
  requestedAt: string;
  traceId: string;
}) {
  const snapshot = {
    operations: await listTeachingOperationRecords(input.dataDir, input.teacherId),
    auditEvents: (await listTeachingOperationAuditEvents(input.dataDir, input.teacherId))
      .events,
    rollbacks: await listTeachingOperationRollbackRecords(input.dataDir, input.teacherId),
    alertNotifications: (
      await listTeachingOperationAlertNotifications(input.dataDir, input.teacherId)
    ).notifications,
  };
  const sourceRecordCounts = countTeachingOperationBackupSnapshot(snapshot);
  const backupId = requireSafeId(
    `teaching-operations-backup-${input.teacherId}-${formatTimestampId(
      input.requestedAt,
    )}`,
    "teaching operation backup id",
  );
  const backup = {
    teacherId: input.teacherId,
    backupId,
    status: "persisted" as const,
    eventType: "teaching-operation-backup.created" as const,
    traceId: input.traceId,
    requestedBy: input.requestedBy,
    requestedAt: input.requestedAt,
    sourceRecordCounts,
    snapshot,
    storagePolicy: "external-redacted-teaching-operation-backup" as const,
    storageWritePolicy: "external-atomic-backup-snapshot" as const,
    responsibleSession: "S12" as const,
    redaction: createRedaction(),
  };
  await writeTeachingOperationBackup({
    dataDir: input.dataDir,
    teacherId: input.teacherId,
    backup,
  });

  return createTeachingOperationBackupReceipt(backup);
}

async function rollbackTeachingOperation(input: {
  dataDir: string;
  teacherId: string;
  recordId: string;
  courseId: string;
  rollbackReason: string;
  traceId: string;
  requestedAt: string;
  requestSource: {
    userAgent: string;
    ipAddress: "redacted";
  };
}) {
  const record = await findTeachingOperationRecord({
    dataDir: input.dataDir,
    teacherId: input.teacherId,
    recordId: input.recordId,
  });
  if (!record) {
    throw new HttpError(404, "Teaching operation record was not found.");
  }
  if (!record.courseId) {
    throw new HttpError(409, "Teaching operation record has no course scope.");
  }
  if (record.courseId !== input.courseId) {
    throw new HttpError(409, "Teaching operation rollback course id mismatch.");
  }
  const existingRollbacks = await listTeachingOperationRollbackRecords(
    input.dataDir,
    input.teacherId,
  );
  if (existingRollbacks.some((rollback) => rollback.targetRecordId === input.recordId)) {
    throw new HttpError(409, "Teaching operation record has already been rolled back.");
  }

  const rollback = {
    rollbackId: requireSafeId(
      `teaching-operation-rollback-${input.recordId}`,
      "teaching operation rollback id",
    ),
    action: "rollback-teaching-operation-record" as const,
    teacherId: input.teacherId,
    targetRecordId: input.recordId,
    courseId: record.courseId,
    targetOperationId: record.operationId,
    targetActionSlot: record.actionSlot,
    targetActionId: record.actionId,
    rollbackReason: input.rollbackReason,
    status: "persisted" as const,
    rolledBackAt: input.requestedAt,
    storagePolicy: "external-redacted-teaching-operation-rollback" as const,
    storageWritePolicy: "external-append-only-rollback-log" as const,
    responsibleSession: "S12" as const,
    redaction: createRedaction(),
  };
  await appendTeachingOperationRollback({
    dataDir: input.dataDir,
    teacherId: input.teacherId,
    rollback,
  });
  await appendTeachingOperationAuditEvent({
    dataDir: input.dataDir,
    teacherId: input.teacherId,
    auditEvent: createTeachingOperationRollbackAuditEvent({
      teacherId: input.teacherId,
      record,
      courseId: record.courseId,
      rollbackReason: input.rollbackReason,
      traceId: input.traceId,
      requestedAt: input.requestedAt,
      requestSource: input.requestSource,
    }),
  });

  return rollback;
}

async function verifyTeachingOperationBackupRestoreDrill(input: {
  dataDir: string;
  teacherId: string;
  backupId: string;
  requestedBy: string;
  requestedAt: string;
  traceId: string;
}) {
  const backup = await readTeachingOperationBackup({
    dataDir: input.dataDir,
    teacherId: input.teacherId,
    backupId: input.backupId,
  });
  if (!backup) {
    throw new HttpError(404, "Teaching operation backup was not found.");
  }
  const restoredRecordCounts = countTeachingOperationBackupSnapshot(backup.snapshot);
  const drill = {
    teacherId: input.teacherId,
    backupId: input.backupId,
    drillId: requireSafeId(
      `teaching-operations-restore-drill-${input.backupId}`,
      "teaching operation restore drill id",
    ),
    status: "verified" as const,
    eventType: "teaching-operation-backup.restore-drill-verified" as const,
    traceId: input.traceId,
    requestedBy: input.requestedBy,
    requestedAt: input.requestedAt,
    restoredRecordCounts,
    storagePolicy: "external-redacted-teaching-operation-restore-drill" as const,
    storageWritePolicy: "external-append-only-restore-drill-log" as const,
    responsibleSession: "S12" as const,
    redaction: createRedaction(),
  };
  await appendTeachingOperationRestoreDrill({
    dataDir: input.dataDir,
    teacherId: input.teacherId,
    drill,
  });
  return drill;
}

async function findTeachingOperationRecord(input: {
  dataDir: string;
  teacherId: string;
  recordId: string;
}) {
  const operationPath = resolveTeachingOperationLogPath(input.dataDir, input.teacherId);
  const raw = await readFile(operationPath, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return "";
      }
      throw error;
    },
  );

  for (const line of raw.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    const entry = normalizeTeachingOperationLogEntry(
      JSON.parse(line),
      input.teacherId,
    );
    if (entry.record.recordId === input.recordId) {
      return entry.record;
    }
  }
  return undefined;
}

async function listTeachingOperationRecords(dataDir: string, teacherId: string) {
  const operationPath = resolveTeachingOperationLogPath(dataDir, teacherId);
  const raw = await readFile(operationPath, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return "";
      }
      throw error;
    },
  );
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => normalizeTeachingOperationLogEntry(JSON.parse(line), teacherId).record);
}

function normalizeTeachingOperationLogEntry(value: unknown, teacherId: string) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching operation log entry must be an object.");
  }
  if (
    value.storagePolicy !== "external-redacted-teaching-operation-append" ||
    value.storageWritePolicy !== "external-append-only-operation-log" ||
    value.responsibleSession !== "S12"
  ) {
    throw new HttpError(400, "Teaching operation log policy is invalid.");
  }
  const record = normalizeTeachingOperationRecord(value.record);
  if (record.actorId !== teacherId) {
    throw new Error("Stored teaching operation actor id mismatch.");
  }
  return {
    record: isPositiveInteger(value.appendSequence)
      ? { ...record, appendSequence: value.appendSequence }
      : record,
  };
}

async function writeTeachingOperationBackup(input: {
  dataDir: string;
  teacherId: string;
  backup: ReturnType<typeof normalizeTeachingOperationBackup>;
}) {
  const backupDir = resolve(
    input.dataDir,
    "teaching-operation-backups",
    input.teacherId,
  );
  ensureWithinBase(input.dataDir, backupDir);
  await mkdir(backupDir, { recursive: true });
  const filePath = resolveTeachingOperationBackupPath(
    input.dataDir,
    input.teacherId,
    input.backup.backupId,
  );
  const tempPath = resolve(
    backupDir,
    `.${input.backup.backupId}.${Date.now()}.${randomUUID()}.tmp`,
  );
  ensureWithinBase(input.dataDir, tempPath);
  try {
    await writeFile(tempPath, JSON.stringify(input.backup, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readTeachingOperationBackup(input: {
  dataDir: string;
  teacherId: string;
  backupId: string;
}) {
  const backupPath = resolveTeachingOperationBackupPath(
    input.dataDir,
    input.teacherId,
    input.backupId,
  );
  const raw = await readFile(backupPath, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    },
  );
  if (!raw) {
    return undefined;
  }
  const backup = normalizeTeachingOperationBackup(JSON.parse(raw));
  if (backup.teacherId !== input.teacherId || backup.backupId !== input.backupId) {
    throw new Error("Stored teaching operation backup id mismatch.");
  }
  return backup;
}

async function appendTeachingOperationRestoreDrill(input: {
  dataDir: string;
  teacherId: string;
  drill: ReturnType<typeof normalizeTeachingOperationRestoreDrill>;
}) {
  const normalizedDrill = normalizeTeachingOperationRestoreDrill(input.drill);
  const restoreDrillDir = resolve(input.dataDir, "teaching-operation-restore-drills");
  ensureWithinBase(input.dataDir, restoreDrillDir);
  await mkdir(restoreDrillDir, { recursive: true });
  await appendFile(
    resolveTeachingOperationRestoreDrillLogPath(input.dataDir, input.teacherId),
    `${JSON.stringify(normalizedDrill)}\n`,
    "utf8",
  );
}

async function appendTeachingOperationRollback(input: {
  dataDir: string;
  teacherId: string;
  rollback: ReturnType<typeof normalizeTeachingOperationRollbackRecord>;
}) {
  const rollbackDir = resolve(input.dataDir, "teaching-operation-rollbacks");
  ensureWithinBase(input.dataDir, rollbackDir);
  await mkdir(rollbackDir, { recursive: true });
  await appendFile(
    resolveTeachingOperationRollbackLogPath(input.dataDir, input.teacherId),
    `${JSON.stringify({
      rollback: input.rollback,
      storagePolicy: "external-redacted-teaching-operation-rollback",
      storageWritePolicy: "external-append-only-rollback-log",
      responsibleSession: "S12",
      redaction: createRedaction(),
    })}\n`,
    "utf8",
  );
}

async function appendTeachingOperationAuditEvent(input: {
  dataDir: string;
  teacherId: string;
  auditEvent: ReturnType<typeof normalizeTeachingOperationAuditEvent>;
}) {
  const auditDir = resolve(input.dataDir, "teaching-operations-audit");
  ensureWithinBase(input.dataDir, auditDir);
  await mkdir(auditDir, { recursive: true });
  await appendFile(
    resolveTeachingOperationAuditLogPath(input.dataDir, input.teacherId),
    `${JSON.stringify({
      auditEvent: input.auditEvent,
      storagePolicy: "external-redacted-teaching-operation-audit-log",
      storageWritePolicy: "external-append-only-audit-log",
      responsibleSession: "S12",
      redaction: createRedaction(),
    })}\n`,
    "utf8",
  );
}

async function listLifecycleAuditEvents(dataDir: string) {
  const auditPath = resolveLifecycleAuditPath(dataDir);
  const raw = await readFile(auditPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  });
  const events = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => normalizeLifecycleAuditEvent(JSON.parse(line)))
    .sort((left, right) => {
      const byTime = left.occurredAt.localeCompare(right.occurredAt);
      return byTime === 0 ? left.eventId.localeCompare(right.eventId) : byTime;
    });

  return {
    provider: "qwen",
    providerRole: "voice-clone",
    eventType: "qwen-voice-lifecycle",
    storagePolicy: "append-only-redacted-lifecycle-audit",
    recordCount: events.length,
    events,
    responsibleSession: "S12/S24",
    redaction: createRedaction(),
  };
}

async function listTeachingOperationAuditEvents(dataDir: string, teacherId: string) {
  const auditPath = resolveTeachingOperationAuditLogPath(dataDir, teacherId);
  const raw = await readFile(auditPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  });
  const events = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      normalizeTeachingOperationAuditLedgerEntry(JSON.parse(line), teacherId),
    )
    .sort((left, right) => {
      const byTime = left.createdAt.localeCompare(right.createdAt);
      return byTime === 0 ? left.auditId.localeCompare(right.auditId) : byTime;
    });

  return {
    teacherId,
    eventType: "teaching-operation-audit",
    storagePolicy: "external-redacted-teaching-operation-audit-log",
    storageWritePolicy: "external-append-only-audit-log",
    recordCount: events.length,
    events,
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

async function listTeachingOperationAuditReadback(dataDir: string, teacherId: string) {
  const audit = await listTeachingOperationAuditEvents(dataDir, teacherId);
  const records = await listTeachingOperationRecords(dataDir, teacherId);
  const rollbacks = await listTeachingOperationRollbackRecords(dataDir, teacherId);
  const domainProjections = records.flatMap((record) => record.domainProjections ?? []);

  return {
    ...audit,
    records,
    rollbacks,
    domainProjections,
    operationRecordCount: records.length,
    rollbackRecordCount: rollbacks.length,
    domainProjectionCount: domainProjections.length,
  };
}

async function summarizeTeachingOperationAuditAlerts(
  dataDir: string,
  teacherId: string,
) {
  const audit = await listTeachingOperationAuditEvents(dataDir, teacherId);
  const alerts = audit.events
    .filter((event) => event.eventType === "teaching-operation.persisted" && !event.courseId)
    .map((event) => {
      if (!event.operationId || !event.actionSlot || !event.actionId) {
        throw new HttpError(400, "Teaching operation audit alert source is invalid.");
      }
      return {
        alertId: `missing-course-context-${event.auditId}`,
        severity: "high" as const,
        reason: "missing-course-context" as const,
        auditId: event.auditId,
        traceId: event.traceId,
        actorId: event.actorId,
        operationId: event.operationId,
        actionSlot: event.actionSlot,
        actionId: event.actionId,
        createdAt: event.createdAt,
        redaction: createRedaction(),
      };
    });

  return {
    teacherId,
    status: alerts.length > 0 ? "attention-required" : "clear",
    eventType: "teaching-operation-audit-alert-summary",
    storagePolicy: "external-redacted-teaching-operation-audit-alerts",
    sourceStoragePolicy: "external-redacted-teaching-operation-audit-log",
    alertPolicy: {
      policyId: "s12-teaching-operation-audit-alerts-v1",
      checks: ["missing-course-context"],
    },
    sourceRecordCount: audit.recordCount,
    alertCount: alerts.length,
    alerts,
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

async function enqueueTeachingOperationAlertNotifications(input: {
  dataDir: string;
  teacherId: string;
  requestedBy: string;
  requestedAt: string;
  adminAlertWebhook?: ExternalStorageRouteConfig["adminAlertWebhook"];
  fetch: typeof fetch;
}) {
  const summary = await summarizeTeachingOperationAuditAlerts(
    input.dataDir,
    input.teacherId,
  );
  const notifications = summary.alerts.map((alert) =>
    createTeachingOperationAlertNotification({
      teacherId: input.teacherId,
      alert,
      requestedBy: input.requestedBy,
      requestedAt: input.requestedAt,
    }),
  );
  if (notifications.length > 0) {
    await appendTeachingOperationAlertNotifications({
      dataDir: input.dataDir,
      teacherId: input.teacherId,
      notifications,
    });
  }
  const externalDelivery =
    notifications.length > 0
      ? await deliverTeachingOperationAlertNotifications({
          dataDir: input.dataDir,
          teacherId: input.teacherId,
          notifications,
          requestedBy: input.requestedBy,
          requestedAt: input.requestedAt,
          adminAlertWebhook: input.adminAlertWebhook,
          fetch: input.fetch,
        })
      : undefined;

  return {
    teacherId: input.teacherId,
    status: notifications.length > 0 ? "queued" : "clear",
    eventType: "teaching-operation-audit-alert-notification-dispatch",
    deliveryChannel: "admin-outbox",
    storagePolicy:
      "external-redacted-teaching-operation-audit-alert-notification-outbox",
    storageWritePolicy: "external-append-only-notification-outbox",
    notificationCount: notifications.length,
    notifications,
    ...(externalDelivery ? { externalDelivery } : {}),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

async function appendTeachingOperationAlertNotifications(input: {
  dataDir: string;
  teacherId: string;
  notifications: ReturnType<typeof createTeachingOperationAlertNotification>[];
}) {
  const notificationDir = resolve(
    input.dataDir,
    "teaching-operation-alert-notifications",
  );
  ensureWithinBase(input.dataDir, notificationDir);
  await mkdir(notificationDir, { recursive: true });
  const payload = input.notifications
    .map((notification) => JSON.stringify(notification))
    .join("\n");
  await appendFile(
    resolveTeachingOperationAlertNotificationLogPath(
      input.dataDir,
      input.teacherId,
    ),
    `${payload}\n`,
    "utf8",
  );
}

async function deliverTeachingOperationAlertNotifications(input: {
  dataDir: string;
  teacherId: string;
  notifications: ReturnType<typeof createTeachingOperationAlertNotification>[];
  requestedBy: string;
  requestedAt: string;
  adminAlertWebhook?: ExternalStorageRouteConfig["adminAlertWebhook"];
  fetch: typeof fetch;
}) {
  if (!input.adminAlertWebhook) {
    return undefined;
  }

  const webhookBody = {
    eventType: "teaching-operation-audit-alert-notification-webhook" as const,
    teacherId: input.teacherId,
    requestedBy: input.requestedBy,
    requestedAt: input.requestedAt,
    notificationCount: input.notifications.length,
    notifications: input.notifications,
    responsibleSession: "S12" as const,
    redaction: createRedaction(),
  };
  const headers = new Headers({
    accept: "application/json",
    "content-type": "application/json",
  });
  if (input.adminAlertWebhook.token) {
    headers.set("authorization", `Bearer ${input.adminAlertWebhook.token}`);
  }

  let responseStatus = 0;
  let deliveryStatus: "delivered" | "failed" = "failed";
  try {
    const response = await input.fetch(input.adminAlertWebhook.url, {
      method: "POST",
      headers,
      body: JSON.stringify(webhookBody),
    });
    responseStatus = response.status;
    deliveryStatus = response.ok ? "delivered" : "failed";
  } catch {
    deliveryStatus = "failed";
  }

  const delivery = createTeachingOperationAlertWebhookDelivery({
    teacherId: input.teacherId,
    requestedBy: input.requestedBy,
    requestedAt: input.requestedAt,
    responseStatus,
    deliveryStatus,
    notifications: input.notifications,
  });
  await appendTeachingOperationAlertWebhookDelivery({
    dataDir: input.dataDir,
    teacherId: input.teacherId,
    delivery,
  });

  return delivery;
}

async function appendTeachingOperationAlertWebhookDelivery(input: {
  dataDir: string;
  teacherId: string;
  delivery: ReturnType<typeof createTeachingOperationAlertWebhookDelivery>;
}) {
  const deliveryDir = resolve(
    input.dataDir,
    "teaching-operation-alert-webhook-deliveries",
  );
  ensureWithinBase(input.dataDir, deliveryDir);
  await mkdir(deliveryDir, { recursive: true });
  await appendFile(
    resolveTeachingOperationAlertWebhookDeliveryLogPath(
      input.dataDir,
      input.teacherId,
    ),
    `${JSON.stringify(normalizeTeachingOperationAlertWebhookDelivery(input.delivery))}\n`,
    "utf8",
  );
}

async function listTeachingOperationAlertNotifications(
  dataDir: string,
  teacherId: string,
) {
  const notificationPath = resolveTeachingOperationAlertNotificationLogPath(
    dataDir,
    teacherId,
  );
  const raw = await readFile(notificationPath, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return "";
      }
      throw error;
    },
  );
  const notifications = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      normalizeTeachingOperationAlertNotification(JSON.parse(line), teacherId),
    )
    .sort((left, right) => {
      const byTime = left.queuedAt.localeCompare(right.queuedAt);
      return byTime === 0
        ? left.notificationId.localeCompare(right.notificationId)
        : byTime;
    });

  return {
    teacherId,
    eventType: "teaching-operation-audit-alert-notification-outbox",
    deliveryChannel: "admin-outbox",
    storagePolicy:
      "external-redacted-teaching-operation-audit-alert-notification-outbox",
    recordCount: notifications.length,
    notifications,
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

async function listTeachingOperationRollbackRecords(dataDir: string, teacherId: string) {
  const rollbackPath = resolveTeachingOperationRollbackLogPath(dataDir, teacherId);
  const raw = await readFile(rollbackPath, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return "";
      }
      throw error;
    },
  );
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => normalizeTeachingOperationRollbackLedgerEntry(JSON.parse(line), teacherId));
}

function createTeachingOperationAlertNotification(input: {
  teacherId: string;
  alert: {
    alertId: string;
    severity: "high";
    reason: "missing-course-context";
    auditId: string;
    traceId: string;
    actorId: string;
    operationId: string;
    actionSlot: "primary" | "secondary";
    actionId: string;
  };
  requestedBy: string;
  requestedAt: string;
}) {
  return {
    notificationId: requireSafeId(
      `alert-notification-${input.alert.alertId}`,
      "teaching operation alert notification id",
    ),
    eventType: "teaching-operation-audit-alert-notification" as const,
    deliveryChannel: "admin-outbox" as const,
    deliveryStatus: "queued" as const,
    teacherId: input.teacherId,
    alertId: input.alert.alertId,
    severity: input.alert.severity,
    reason: input.alert.reason,
    auditId: input.alert.auditId,
    traceId: input.alert.traceId,
    actorId: input.alert.actorId,
    operationId: input.alert.operationId,
    actionSlot: input.alert.actionSlot,
    actionId: input.alert.actionId,
    requestedBy: input.requestedBy,
    requestedAt: input.requestedAt,
    queuedAt: input.requestedAt,
    storagePolicy:
      "external-redacted-teaching-operation-audit-alert-notification-outbox" as const,
    responsibleSession: "S12" as const,
    redaction: createRedaction(),
  };
}

function createTeachingOperationAlertWebhookDelivery(input: {
  teacherId: string;
  requestedBy: string;
  requestedAt: string;
  responseStatus: number;
  deliveryStatus: "delivered" | "failed";
  notifications: ReturnType<typeof createTeachingOperationAlertNotification>[];
}) {
  const firstNotification = input.notifications[0];
  return {
    deliveryId: requireSafeId(
      firstNotification
        ? `alert-webhook-delivery-${firstNotification.alertId}`
        : `alert-webhook-delivery-${input.teacherId}`,
      "teaching operation alert webhook delivery id",
    ),
    eventType: "teaching-operation-audit-alert-webhook-delivery" as const,
    deliveryChannel: "admin-webhook" as const,
    deliveryStatus: input.deliveryStatus,
    provider: "configured-admin-alert-webhook" as const,
    endpoint: "redacted" as const,
    teacherId: input.teacherId,
    requestedBy: input.requestedBy,
    requestedAt: input.requestedAt,
    deliveredAt: new Date().toISOString(),
    responseStatus: input.responseStatus,
    notificationCount: input.notifications.length,
    notificationIds: input.notifications.map(
      (notification) => notification.notificationId,
    ),
    traceIds: input.notifications.map((notification) => notification.traceId),
    storagePolicy:
      "external-redacted-teaching-operation-audit-alert-webhook-delivery" as const,
    storageWritePolicy: "external-append-only-webhook-delivery-ledger" as const,
    responsibleSession: "S12" as const,
    redaction: createRedaction(),
  };
}

function createTeachingOperationRollbackAuditEvent(input: {
  teacherId: string;
  record: ReturnType<typeof normalizeTeachingOperationRecord>;
  courseId: string;
  rollbackReason: string;
  traceId: string;
  requestedAt: string;
  requestSource: {
    userAgent: string;
    ipAddress: "redacted";
  };
}) {
  return {
    auditId: requireSafeId(
      `audit-teaching-operation-rollback-${input.record.recordId}`,
      "teaching operation rollback audit id",
    ),
    traceId: input.traceId,
    eventType: "teaching-operation.rolled-back" as const,
    actorId: input.teacherId,
    actorRole: "teacher" as const,
    authMode: "signed-teacher-session" as const,
    courseId: input.courseId,
    targetRecordId: input.record.recordId,
    operationId: input.record.operationId,
    actionSlot: input.record.actionSlot,
    actionId: input.record.actionId,
    rollbackReason: input.rollbackReason,
    requestSource: input.requestSource,
    createdAt: input.requestedAt,
    redaction: createRedaction(),
  };
}

function createTeachingOperationBackupReceipt(
  backup: ReturnType<typeof normalizeTeachingOperationBackup>,
) {
  return {
    teacherId: backup.teacherId,
    backupId: backup.backupId,
    status: "persisted" as const,
    eventType: "teaching-operation-backup.created" as const,
    traceId: backup.traceId,
    requestedBy: backup.requestedBy,
    requestedAt: backup.requestedAt,
    sourceRecordCounts: backup.sourceRecordCounts,
    storagePolicy: "external-redacted-teaching-operation-backup" as const,
    storageWritePolicy: "external-atomic-backup-snapshot" as const,
    responsibleSession: "S12" as const,
    redaction: createRedaction(),
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
